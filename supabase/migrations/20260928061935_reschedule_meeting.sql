-- A moved meeting retains its original slot/date identity. dashboard_write holds
-- the workspace row lock before calling either helper.
create function dashboard_private.meeting_conflicts(ws uuid, moving_slot uuid, moving_date date,
  destination date, begins time, finishes time)
returns boolean language sql stable set search_path = '' as $$
  select exists (
    select 1 from public.meetings m
    where m.workspace_id = ws and m.actual_date = destination
      and (m.schedule_slot_id, m.original_date) <> (moving_slot, moving_date)
      and begins < m.end_time and finishes > m.start_time
  ) or exists (
    select 1 from public.schedule_slot_versions v
    join public.schedule_slots s on s.workspace_id = v.workspace_id and s.id = v.schedule_slot_id
    join public.groups g on g.workspace_id = s.workspace_id and g.id = s.group_id
    where v.workspace_id = ws and not g.archived
      and destination >= v.effective_from and (v.effective_to is null or destination < v.effective_to)
      and extract(isodow from destination) = v.weekday
      and (s.id, destination) <> (moving_slot, moving_date)
      and begins < v.end_time and finishes > v.start_time
      and not exists (select 1 from public.meetings m where m.workspace_id = ws
        and m.schedule_slot_id = s.id and m.original_date = destination)
  );
$$;

create function dashboard_private.change_meeting_schedule(ws uuid, payload jsonb, restoring boolean)
returns jsonb language plpgsql set search_path = '' as $$
declare slot_key uuid := (payload->>'schedule_slot_id')::uuid;
  source_date date := (payload->>'original_date')::date;
  target_date date; begins time; finishes time; target_room text;
  version public.schedule_slot_versions; group_row public.groups; saved public.meetings;
  previous_date date; original_revision integer;
begin
  if slot_key is null or source_date is null or not isfinite(source_date) then
    raise exception using errcode = 'TD002', message = 'VALIDATION_ERROR';
  end if;
  select v.* into version from public.schedule_slot_versions v
    where v.workspace_id = ws and v.schedule_slot_id = slot_key
      and source_date >= v.effective_from and (v.effective_to is null or source_date < v.effective_to)
      and extract(isodow from source_date) = v.weekday;
  if not found then raise exception using errcode = 'TD003', message = 'NOT_FOUND'; end if;
  select g.* into group_row from public.groups g join public.schedule_slots s
    on s.workspace_id = g.workspace_id and s.group_id = g.id
    where s.workspace_id = ws and s.id = slot_key and not g.archived;
  if not found then raise exception using errcode = 'TD003', message = 'NOT_FOUND'; end if;
  select * into saved from public.meetings where workspace_id = ws
    and schedule_slot_id = slot_key and original_date = source_date;
  perform dashboard_private.assert_revision((payload->>'expected_revision')::integer, coalesce(saved.revision, 0));
  if saved.id is not null and (exists (select 1 from public.lesson_records where workspace_id = ws and meeting_id = saved.id)
    or exists (select 1 from public.attendance_checklists where workspace_id = ws and meeting_id = saved.id)) then
    raise exception using errcode = 'TD008', message = 'MEETING_HAS_SAVED_RECORDS';
  end if;
  previous_date := coalesce(saved.actual_date, source_date);
  if restoring then
    if saved.id is null or not saved.is_rescheduled then
      raise exception using errcode = 'TD003', message = 'NOT_FOUND';
    end if;
    target_date := source_date; begins := version.start_time; finishes := version.end_time; target_room := version.room;
  else
    if payload->>'actual_date' is null or payload->>'start_time' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
      or payload->>'end_time' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
      raise exception using errcode = 'TD002', message = 'VALIDATION_ERROR';
    end if;
    target_date := (payload->>'actual_date')::date;
    begins := (payload->>'start_time')::time; finishes := (payload->>'end_time')::time;
    target_room := coalesce(btrim(payload->>'room'), '');
  end if;
  if target_date is null or not isfinite(target_date) or begins >= finishes
    or length(target_room) > 120 then
    raise exception using errcode = 'TD002', message = 'VALIDATION_ERROR';
  end if;
  if dashboard_private.meeting_conflicts(ws, slot_key, source_date, target_date, begins, finishes) then
    raise exception using errcode = 'TD006', message = 'SCHEDULE_CONFLICT';
  end if;
  original_revision := coalesce(saved.revision, 0);
  if restoring then
    delete from public.meetings where workspace_id = ws and id = saved.id;
    return jsonb_build_object('meeting', jsonb_build_object(
      'id', null, 'workspace_id', ws, 'schedule_slot_id', slot_key, 'slot_version_id', version.id,
      'group_id', group_row.id, 'original_date', source_date, 'actual_date', source_date,
      'start_time', begins, 'end_time', finishes, 'group_name', group_row.name,
      'subject', group_row.subject, 'room', target_room, 'is_rescheduled', false,
      'revision', 0, 'meeting_key', slot_key::text || ':' || source_date::text),
      'previous_date', previous_date, 'original_date', source_date);
  end if;
  if saved.id is null then
    insert into public.meetings(workspace_id, schedule_slot_id, slot_version_id, group_id,
      original_date, actual_date, start_time, end_time, group_name, subject, room, is_rescheduled)
    values (ws, slot_key, version.id, group_row.id, source_date, target_date,
      begins, finishes, group_row.name, group_row.subject, target_room, true) returning * into saved;
  else
    update public.meetings set actual_date = target_date, start_time = begins,
      end_time = finishes, room = target_room, is_rescheduled = true,
      revision = original_revision + 1, updated_at = now()
    where workspace_id = ws and id = saved.id returning * into saved;
  end if;
  return jsonb_build_object('meeting', to_jsonb(saved) || jsonb_build_object(
    'meeting_key', slot_key::text || ':' || source_date::text),
    'previous_date', previous_date, 'original_date', source_date);
end;
$$;

create or replace function public.dashboard_write(p_workspace_id uuid, p_operation_id uuid, p_action text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid(); workspace public.workspaces; receipt dashboard_private.operations;
  fingerprint bytea; result jsonb; zone text;
begin
  if actor is null then raise exception using errcode = 'TD001', message = 'AUTH_REQUIRED'; end if;
  if p_operation_id is null or p_action is null or p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception using errcode = 'TD002', message = 'VALIDATION_ERROR';
  end if;
  if p_action = 'ensure_workspace' then
    if p_workspace_id is not null then raise exception using errcode = 'TD002', message = 'VALIDATION_ERROR'; end if;
    perform pg_advisory_xact_lock(hashtextextended(actor::text, 0));
    select * into workspace from public.workspaces where owner_id = actor for update;
    if not found then
      zone := coalesce(p_payload->>'timezone', 'Asia/Tashkent');
      perform dashboard_private.assert_timezone(zone);
      insert into public.workspaces(owner_id, display_name, timezone)
        values (actor, btrim(p_payload->>'display_name'), zone) returning * into workspace;
    end if;
  else
    select * into workspace from public.workspaces where id = p_workspace_id and owner_id = actor for update;
    if not found then raise exception using errcode = 'TD003', message = 'NOT_FOUND'; end if;
  end if;
  fingerprint := sha256(convert_to(jsonb_build_object('action', p_action, 'payload', p_payload)::text, 'UTF8'));
  select * into receipt from dashboard_private.operations where workspace_id = workspace.id and operation_id = p_operation_id;
  if found then
    if receipt.request_hash <> fingerprint then raise exception using errcode = 'TD005', message = 'OPERATION_CONFLICT'; end if;
    return receipt.response;
  end if;
  case p_action
    when 'ensure_workspace' then result := to_jsonb(workspace);
    when 'save_workspace' then result := dashboard_private.save_workspace(workspace.id, p_payload);
    when 'save_group' then result := dashboard_private.save_group(workspace.id, p_payload);
    when 'save_student' then result := dashboard_private.save_student(workspace.id, p_payload);
    when 'save_enrollment' then result := dashboard_private.save_enrollment(workspace.id, p_payload);
    when 'save_schedule_slot' then result := dashboard_private.save_schedule_slot(workspace.id, p_payload);
    when 'save_lesson_record' then result := dashboard_private.save_lesson_record(workspace.id, p_payload);
    when 'save_attendance' then result := dashboard_private.save_attendance(workspace.id, p_payload);
    when 'reschedule_meeting' then result := dashboard_private.change_meeting_schedule(workspace.id, p_payload, false);
    when 'restore_meeting' then result := dashboard_private.change_meeting_schedule(workspace.id, p_payload, true);
    else raise exception using errcode = 'TD002', message = 'VALIDATION_ERROR', detail = 'Unknown action.';
  end case;
  insert into dashboard_private.operations(workspace_id, operation_id, request_hash, response)
    values (workspace.id, p_operation_id, fingerprint, result);
  return result;
exception
  when check_violation or not_null_violation or unique_violation or exclusion_violation or data_exception then
    raise exception using errcode = 'TD002', message = 'VALIDATION_ERROR';
  when foreign_key_violation then
    raise exception using errcode = 'TD003', message = 'NOT_FOUND';
end;
$$;

create or replace function public.list_meetings(p_workspace_id uuid, p_from date, p_to date)
returns setof jsonb language plpgsql stable security invoker set search_path = '' as $$
begin
  if auth.uid() is null then raise exception using errcode = 'TD001', message = 'AUTH_REQUIRED'; end if;
  if not exists (select 1 from public.workspaces where id = p_workspace_id and owner_id = auth.uid()) then
    raise exception using errcode = 'TD003', message = 'NOT_FOUND';
  end if;
  if p_from is null or p_to is null or not isfinite(p_from) or not isfinite(p_to)
    or p_to < p_from or p_to - p_from > 92 then
    raise exception using errcode = 'TD002', message = 'VALIDATION_ERROR';
  end if;
  return query
    with days as (select p_from + offset_days as day from generate_series(0, p_to - p_from) offset_days),
    occurrences as (
      select null::uuid as id, s.workspace_id, s.id as schedule_slot_id, v.id as slot_version_id, s.group_id,
        days.day as original_date, days.day as actual_date, v.start_time, v.end_time,
        g.name as group_name, g.subject, v.room, false as is_rescheduled, 0 as revision
      from public.schedule_slots s
      join public.groups g on g.workspace_id = s.workspace_id and g.id = s.group_id
      join public.schedule_slot_versions v on v.workspace_id = s.workspace_id and v.schedule_slot_id = s.id
      join days on days.day >= v.effective_from and (v.effective_to is null or days.day < v.effective_to)
        and extract(isodow from days.day) = v.weekday
      where s.workspace_id = p_workspace_id and not g.archived
        and not exists (select 1 from public.meetings m where m.workspace_id = s.workspace_id
          and m.schedule_slot_id = s.id and m.original_date = days.day)
      union all
      select m.id, m.workspace_id, m.schedule_slot_id, m.slot_version_id, m.group_id,
        m.original_date, m.actual_date, m.start_time, m.end_time, m.group_name, m.subject, m.room, m.is_rescheduled, m.revision
      from public.meetings m where m.workspace_id = p_workspace_id and m.actual_date between p_from and p_to
    )
    select to_jsonb(o) || jsonb_build_object('meeting_key', o.schedule_slot_id::text || ':' || o.original_date::text,
      'is_marker', false) from occurrences o
    union all
    select jsonb_build_object('meeting_key', m.schedule_slot_id::text || ':' || m.original_date::text,
      'is_marker', true, 'original_date', m.original_date, 'actual_date', m.actual_date,
      'start_time', m.start_time, 'end_time', m.end_time, 'group_name', m.group_name,
      'subject', m.subject, 'room', m.room) from public.meetings m
      where m.workspace_id = p_workspace_id and m.is_rescheduled and m.original_date <> m.actual_date
        and m.original_date between p_from and p_to;
end;
$$;

revoke all on function dashboard_private.meeting_conflicts(uuid, uuid, date, date, time, time) from public, anon, authenticated;
revoke all on function dashboard_private.change_meeting_schedule(uuid, jsonb, boolean) from public, anon, authenticated;
