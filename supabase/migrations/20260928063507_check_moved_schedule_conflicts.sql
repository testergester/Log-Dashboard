-- A new recurring version must also avoid meetings moved in from an earlier
-- occurrence of the same slot. The workspace lock in dashboard_write keeps
-- this check serialized with reschedules and record saves.
create or replace function dashboard_private.save_schedule_slot(ws uuid, payload jsonb)
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
    if starts is null or starts < today or starts < previous.effective_from then
      raise exception using errcode = 'TD002', message = 'VALIDATION_ERROR', detail = 'Edit from today or later, no earlier than the latest version start.';
    end if;
    if exists (select 1 from public.meetings where workspace_id = ws and schedule_slot_id = entity and original_date >= starts) then
      raise exception using errcode = 'TD006', message = 'SCHEDULE_CONFLICT', detail = 'The changed range already contains saved meetings.';
    end if;
    if starts = previous.effective_from then
      if exists (select 1 from public.meetings where workspace_id = ws and slot_version_id = previous.id) then
        raise exception using errcode = 'TD006', message = 'SCHEDULE_CONFLICT', detail = 'A saved meeting uses this version.';
      end if;
      delete from public.schedule_slot_versions where workspace_id = ws and id = previous.id;
    else
      update public.schedule_slot_versions set effective_to = starts
        where workspace_id = ws and id = previous.id and (effective_to is null or effective_to > starts);
    end if;
    update public.schedule_slots set revision = revision + 1
      where workspace_id = ws and id = entity returning * into slot;
  end if;
  insert into public.schedule_slot_versions(workspace_id, schedule_slot_id, weekday, start_time, end_time, room, effective_from, effective_to)
    values (ws, slot.id, day_number, begins, finishes, coalesce(btrim(payload->>'room'), ''), starts, ends) returning * into saved;
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
  ) then
    raise exception using errcode = 'TD006', message = 'SCHEDULE_CONFLICT';
  end if;
  return to_jsonb(slot) || jsonb_build_object('version', to_jsonb(saved));
end;
$$;
