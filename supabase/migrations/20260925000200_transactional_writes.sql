-- Stable errors: TD001 auth, TD002 validation, TD003 missing/not owned,
-- TD004 stale revision, TD005 operation-ID reuse, TD006 schedule, TD007 roster.
-- Helpers are private, SECURITY INVOKER, and callable only by the RPC's owner.
create function dashboard_private.assert_revision(expected integer, actual integer)
returns void language plpgsql set search_path = '' as $$
begin
  if expected is null or expected < 0 then
    raise exception using errcode = 'TD002', message = 'VALIDATION_ERROR', detail = 'expected_revision is required (0 for creation).';
  end if;
  if expected <> actual then
    raise exception using errcode = 'TD004', message = 'REVISION_CONFLICT';
  end if;
end;
$$;

create function dashboard_private.assert_timezone(value text)
returns void language plpgsql set search_path = '' as $$
begin
  if value is null or not exists (select 1 from pg_catalog.pg_timezone_names where name = value) then
    raise exception using errcode = 'TD002', message = 'VALIDATION_ERROR', detail = 'Unknown timezone.';
  end if;
end;
$$;

create function dashboard_private.save_workspace(ws uuid, payload jsonb)
returns jsonb language plpgsql set search_path = '' as $$
declare saved public.workspaces; zone text;
begin
  select * into strict saved from public.workspaces where id = ws;
  perform dashboard_private.assert_revision((payload->>'expected_revision')::integer, saved.revision);
  zone := coalesce(payload->>'timezone', saved.timezone);
  perform dashboard_private.assert_timezone(zone);
  if zone <> saved.timezone and exists (select 1 from public.schedule_slots where workspace_id = ws) then
    raise exception using errcode = 'TD002', message = 'VALIDATION_ERROR', detail = 'Timezone cannot change after schedules exist.';
  end if;
  update public.workspaces set display_name = btrim(payload->>'display_name'), timezone = zone,
    revision = revision + 1, updated_at = now() where id = ws returning * into saved;
  return to_jsonb(saved);
end;
$$;

create function dashboard_private.save_group(ws uuid, payload jsonb)
returns jsonb language plpgsql set search_path = '' as $$
declare saved public.groups; entity uuid := (payload->>'id')::uuid;
begin
  if entity is null then
    perform dashboard_private.assert_revision((payload->>'expected_revision')::integer, 0);
    insert into public.groups(workspace_id, name, subject, code, archived)
    values (ws, btrim(payload->>'name'), btrim(payload->>'subject'), nullif(btrim(payload->>'code'), ''),
      coalesce((payload->>'archived')::boolean, false)) returning * into saved;
  else
    select * into saved from public.groups where workspace_id = ws and id = entity;
    if not found then raise exception using errcode = 'TD003', message = 'NOT_FOUND'; end if;
    perform dashboard_private.assert_revision((payload->>'expected_revision')::integer, saved.revision);
    -- Unarchiving with old schedules could introduce overlapping commitments.
    -- A dedicated checked restore operation belongs with the scheduling UI.
    if saved.archived and payload->>'archived' = 'false' then
      raise exception using errcode = 'TD002', message = 'VALIDATION_ERROR', detail = 'Archived groups cannot be restored by save_group.';
    end if;
    update public.groups set name = btrim(payload->>'name'), subject = btrim(payload->>'subject'),
      code = nullif(btrim(payload->>'code'), ''), archived = coalesce((payload->>'archived')::boolean, saved.archived),
      revision = revision + 1, updated_at = now()
      where workspace_id = ws and id = entity returning * into saved;
  end if;
  return to_jsonb(saved);
end;
$$;

create function dashboard_private.save_student(ws uuid, payload jsonb)
returns jsonb language plpgsql set search_path = '' as $$
declare saved public.students; entity uuid := (payload->>'id')::uuid;
begin
  if entity is null then
    perform dashboard_private.assert_revision((payload->>'expected_revision')::integer, 0);
    insert into public.students(workspace_id, name, external_id)
      values (ws, btrim(payload->>'name'), nullif(btrim(payload->>'external_id'), '')) returning * into saved;
  else
    select * into saved from public.students where workspace_id = ws and id = entity;
    if not found then raise exception using errcode = 'TD003', message = 'NOT_FOUND'; end if;
    perform dashboard_private.assert_revision((payload->>'expected_revision')::integer, saved.revision);
    update public.students set name = btrim(payload->>'name'), external_id = nullif(btrim(payload->>'external_id'), ''),
      revision = revision + 1, updated_at = now()
      where workspace_id = ws and id = entity returning * into saved;
  end if;
  return to_jsonb(saved);
end;
$$;

create function dashboard_private.save_enrollment(ws uuid, payload jsonb)
returns jsonb language plpgsql set search_path = '' as $$
declare saved public.enrollments; entity uuid := (payload->>'id')::uuid;
  group_key uuid := (payload->>'group_id')::uuid; student_key uuid := (payload->>'student_id')::uuid;
begin
  if not exists (select 1 from public.groups where workspace_id = ws and id = group_key and not archived)
    or not exists (select 1 from public.students where workspace_id = ws and id = student_key) then
    raise exception using errcode = 'TD003', message = 'NOT_FOUND';
  end if;
  if entity is null then
    perform dashboard_private.assert_revision((payload->>'expected_revision')::integer, 0);
    insert into public.enrollments(workspace_id, group_id, student_id, starts_on, ends_on)
      values (ws, group_key, student_key, (payload->>'starts_on')::date, (payload->>'ends_on')::date) returning * into saved;
  else
    select * into saved from public.enrollments where workspace_id = ws and id = entity
      and group_id = group_key and student_id = student_key;
    if not found then raise exception using errcode = 'TD003', message = 'NOT_FOUND'; end if;
    perform dashboard_private.assert_revision((payload->>'expected_revision')::integer, saved.revision);
    update public.enrollments set starts_on = (payload->>'starts_on')::date, ends_on = (payload->>'ends_on')::date,
      revision = revision + 1, updated_at = now()
      where workspace_id = ws and id = entity returning * into saved;
  end if;
  -- A roster's size can increase only at an enrollment start boundary.
  if exists (
    select 1 from public.enrollments boundary join public.enrollments member
      on member.workspace_id = boundary.workspace_id and member.group_id = boundary.group_id
      and member.starts_on <= boundary.starts_on and (member.ends_on is null or boundary.starts_on < member.ends_on)
    where boundary.workspace_id = ws and boundary.group_id = group_key
    group by boundary.starts_on having count(distinct member.student_id) > 100
  ) then
    raise exception using errcode = 'TD007', message = 'ROSTER_CONFLICT', detail = 'A group can have at most 100 students on any date.';
  end if;
  return to_jsonb(saved);
end;
$$;

create function dashboard_private.save_schedule_slot(ws uuid, payload jsonb)
returns jsonb language plpgsql set search_path = '' as $$
declare slot public.schedule_slots; previous public.schedule_slot_versions; saved public.schedule_slot_versions;
  entity uuid := (payload->>'id')::uuid; group_key uuid := (payload->>'group_id')::uuid;
  starts date := (payload->>'effective_from')::date; ends date := (payload->>'effective_to')::date;
  day_number integer := (payload->>'weekday')::integer;
  begins time := (payload->>'start_time')::time; finishes time := (payload->>'end_time')::time;
  today date;
begin
  if not exists (select 1 from public.groups where workspace_id = ws and id = group_key and not archived) then
    raise exception using errcode = 'TD003', message = 'NOT_FOUND';
  end if;
  select (now() at time zone timezone)::date into today from public.workspaces where id = ws;
  if entity is null then
    perform dashboard_private.assert_revision((payload->>'expected_revision')::integer, 0);
    insert into public.schedule_slots(workspace_id, group_id) values (ws, group_key) returning * into slot;
  else
    select * into slot from public.schedule_slots where workspace_id = ws and id = entity and group_id = group_key;
    if not found then raise exception using errcode = 'TD003', message = 'NOT_FOUND'; end if;
    perform dashboard_private.assert_revision((payload->>'expected_revision')::integer, slot.revision);
    select * into strict previous from public.schedule_slot_versions where workspace_id = ws and schedule_slot_id = entity
      order by effective_from desc limit 1;
    if starts is null or starts < today or starts <= previous.effective_from then
      raise exception using errcode = 'TD002', message = 'VALIDATION_ERROR', detail = 'Append schedule versions from today or later, after the last version starts.';
    end if;
    -- Saved occurrences keep their snapshots. Never cut a saved occurrence out
    -- of the version it references; a future UI can choose a later boundary.
    if exists (select 1 from public.meetings where workspace_id = ws and schedule_slot_id = entity and original_date >= starts) then
      raise exception using errcode = 'TD006', message = 'SCHEDULE_CONFLICT', detail = 'The changed range already contains saved meetings.';
    end if;
    update public.schedule_slot_versions set effective_to = starts
      where workspace_id = ws and id = previous.id and (effective_to is null or effective_to > starts);
    update public.schedule_slots set revision = revision + 1
      where workspace_id = ws and id = entity returning * into slot;
  end if;
  insert into public.schedule_slot_versions(workspace_id, schedule_slot_id, weekday, start_time, end_time, room, effective_from, effective_to)
    values (ws, slot.id, day_number, begins, finishes, coalesce(btrim(payload->>'room'), ''), starts, ends) returning * into saved;
  -- Check that the overlapping date range actually contains the common weekday.
  if exists (
    select 1 from public.schedule_slot_versions v join public.schedule_slots s
      on s.workspace_id = v.workspace_id and s.id = v.schedule_slot_id
      join public.groups g on g.workspace_id = s.workspace_id and g.id = s.group_id
    where v.workspace_id = ws and v.schedule_slot_id <> slot.id and not g.archived
      and v.weekday = day_number and begins < v.end_time and finishes > v.start_time
      and (greatest(v.effective_from, starts) +
        ((day_number - extract(isodow from greatest(v.effective_from, starts))::integer + 7) % 7))
        < least(coalesce(v.effective_to, 'infinity'::date), coalesce(ends, 'infinity'::date))
  ) or exists (
    select 1 from public.meetings m where m.workspace_id = ws
      and m.actual_date >= starts and (ends is null or m.actual_date < ends)
      and extract(isodow from m.actual_date) = day_number and begins < m.end_time and finishes > m.start_time
      and m.schedule_slot_id <> slot.id
  ) then
    raise exception using errcode = 'TD006', message = 'SCHEDULE_CONFLICT';
  end if;
  return to_jsonb(slot) || jsonb_build_object('version', to_jsonb(saved));
end;
$$;

-- Called only during a record write. Reads never materialize a meeting.
create function dashboard_private.ensure_meeting(ws uuid, slot_key uuid, occurrence date)
returns public.meetings language plpgsql set search_path = '' as $$
declare saved public.meetings; version public.schedule_slot_versions; group_row public.groups;
begin
  if slot_key is null or occurrence is null or not isfinite(occurrence) then
    raise exception using errcode = 'TD002', message = 'VALIDATION_ERROR', detail = 'A slot ID and finite original date are required.';
  end if;
  select * into saved from public.meetings where workspace_id = ws and schedule_slot_id = slot_key and original_date = occurrence;
  if found then return saved; end if;
  select v.* into version from public.schedule_slot_versions v where v.workspace_id = ws and v.schedule_slot_id = slot_key
    and v.effective_from <= occurrence and (v.effective_to is null or occurrence < v.effective_to)
    and v.weekday = extract(isodow from occurrence);
  if not found then raise exception using errcode = 'TD003', message = 'NOT_FOUND', detail = 'No scheduled occurrence.'; end if;
  select g.* into group_row from public.groups g join public.schedule_slots s
    on s.workspace_id = g.workspace_id and s.group_id = g.id
    where s.workspace_id = ws and s.id = slot_key and not g.archived;
  if not found then raise exception using errcode = 'TD003', message = 'NOT_FOUND'; end if;
  insert into public.meetings(workspace_id, schedule_slot_id, slot_version_id, group_id, original_date, actual_date,
    start_time, end_time, group_name, subject, room)
  values (ws, slot_key, version.id, group_row.id, occurrence, occurrence,
    version.start_time, version.end_time, group_row.name, group_row.subject, version.room) returning * into saved;
  return saved;
end;
$$;

create function dashboard_private.save_lesson_record(ws uuid, payload jsonb)
returns jsonb language plpgsql set search_path = '' as $$
declare meeting public.meetings; saved public.lesson_records; actual integer;
begin
  meeting := dashboard_private.ensure_meeting(ws, (payload->>'schedule_slot_id')::uuid, (payload->>'original_date')::date);
  select revision into actual from public.lesson_records where workspace_id = ws and meeting_id = meeting.id;
  perform dashboard_private.assert_revision((payload->>'expected_revision')::integer, coalesce(actual, 0));
  if actual is null and exists (select 1 from public.groups where workspace_id = ws and id = meeting.group_id and archived) then
    raise exception using errcode = 'TD002', message = 'VALIDATION_ERROR', detail = 'Cannot create a record in an archived group.';
  end if;
  insert into public.lesson_records(workspace_id, meeting_id, notes, rating, lesson_type, status)
  values (ws, meeting.id, coalesce(payload->>'notes', ''), (payload->>'rating')::smallint,
    coalesce(payload->>'lesson_type', 'Lesson'), coalesce(payload->>'status', 'Done'))
  on conflict (workspace_id, meeting_id) do update set notes = excluded.notes, rating = excluded.rating,
    lesson_type = excluded.lesson_type, status = excluded.status, revision = public.lesson_records.revision + 1, updated_at = now()
  returning * into saved;
  return jsonb_build_object('meeting', to_jsonb(meeting), 'record', to_jsonb(saved));
end;
$$;

create function dashboard_private.save_attendance(ws uuid, payload jsonb)
returns jsonb language plpgsql set search_path = '' as $$
declare meeting public.meetings; saved public.attendance_checklists; actual integer;
  records jsonb := payload->'entries'; submitted uuid[]; expected uuid[]; entry jsonb;
begin
  if records is null or jsonb_typeof(records) <> 'array' then
    raise exception using errcode = 'TD002', message = 'VALIDATION_ERROR', detail = 'entries must be an array.';
  end if;
  if jsonb_array_length(records) not between 1 and 100 then
    raise exception using errcode = 'TD002', message = 'VALIDATION_ERROR', detail = 'A checklist needs 1 to 100 students.';
  end if;
  select array_agg((item->>'student_id')::uuid order by (item->>'student_id')::uuid) into submitted from jsonb_array_elements(records) item;
  if array_position(submitted, null) is not null or cardinality(submitted) <> (select count(distinct id) from unnest(submitted) id) then
    raise exception using errcode = 'TD002', message = 'VALIDATION_ERROR', detail = 'Student IDs must be present and unique.';
  end if;
  meeting := dashboard_private.ensure_meeting(ws, (payload->>'schedule_slot_id')::uuid, (payload->>'original_date')::date);
  select revision into actual from public.attendance_checklists where workspace_id = ws and meeting_id = meeting.id;
  perform dashboard_private.assert_revision((payload->>'expected_revision')::integer, coalesce(actual, 0));
  if actual is null then
    if exists (select 1 from public.groups where workspace_id = ws and id = meeting.group_id and archived) then
      raise exception using errcode = 'TD002', message = 'VALIDATION_ERROR', detail = 'Cannot create attendance in an archived group.';
    end if;
    select array_agg(student_id order by student_id) into expected from public.enrollments
      where workspace_id = ws and group_id = meeting.group_id and starts_on <= meeting.actual_date
      and (ends_on is null or meeting.actual_date < ends_on);
  else
    select array_agg(student_id order by student_id) into expected from public.attendance_entries
      where workspace_id = ws and meeting_id = meeting.id;
  end if;
  if submitted is distinct from expected then
    raise exception using errcode = 'TD007', message = 'ROSTER_CONFLICT';
  end if;
  insert into public.attendance_checklists(workspace_id, meeting_id) values (ws, meeting.id)
    on conflict (workspace_id, meeting_id) do update set revision = public.attendance_checklists.revision + 1, updated_at = now()
    returning * into saved;
  for entry in select value from jsonb_array_elements(records) loop
    insert into public.attendance_entries(workspace_id, meeting_id, student_id, student_name, attendance, participation, note)
    select ws, meeting.id, s.id, s.name, entry->>'attendance', (entry->>'participation')::smallint, coalesce(entry->>'note', '')
      from public.students s where s.workspace_id = ws and s.id = (entry->>'student_id')::uuid
    on conflict (workspace_id, meeting_id, student_id) do update set attendance = excluded.attendance,
      participation = excluded.participation, note = excluded.note;
  end loop;
  return jsonb_build_object('meeting', to_jsonb(meeting), 'checklist', to_jsonb(saved),
    'entries', (select jsonb_agg(to_jsonb(e) order by e.student_id) from public.attendance_entries e
      where e.workspace_id = ws and e.meeting_id = meeting.id));
end;
$$;

-- Single authenticated write gateway. All operations run in the caller's one
-- database transaction, including the meeting, records, and retry receipt.
create function public.dashboard_write(p_workspace_id uuid, p_operation_id uuid, p_action text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid(); workspace public.workspaces; receipt dashboard_private.operations;
  fingerprint bytea; result jsonb; zone text;
begin
  if actor is null then raise exception using errcode = 'TD001', message = 'AUTH_REQUIRED'; end if;
  if p_operation_id is null or p_action is null or p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception using errcode = 'TD002', message = 'VALIDATION_ERROR';
  end if;
  -- Serialize first-use creation, even before there is a workspace row to lock.
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
    -- Ownership is checked before reading the operation receipt or any data.
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
    else raise exception using errcode = 'TD002', message = 'VALIDATION_ERROR', detail = 'Unknown action.';
  end case;
  insert into dashboard_private.operations(workspace_id, operation_id, request_hash, response)
    values (workspace.id, p_operation_id, fingerprint, result);
  return result;
exception
  -- Never return payloads or constraint details containing teaching data.
  when check_violation or not_null_violation or unique_violation or exclusion_violation or data_exception then
    raise exception using errcode = 'TD002', message = 'VALIDATION_ERROR';
  when foreign_key_violation then
    raise exception using errcode = 'TD003', message = 'NOT_FOUND';
end;
$$;

revoke all on all functions in schema dashboard_private from public, anon, authenticated;
revoke all on function public.dashboard_write(uuid, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.dashboard_write(uuid, uuid, text, jsonb) to authenticated;
