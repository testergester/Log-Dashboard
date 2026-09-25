-- Read-only occurrence generation. Persisted snapshots override recurrence;
-- moved-in rows appear on their actual date, while moved-out originals vanish.
create function public.list_meetings(p_workspace_id uuid, p_from date, p_to date)
returns setof jsonb language plpgsql stable security invoker set search_path = '' as $$
begin
  if auth.uid() is null then raise exception using errcode = 'TD001', message = 'AUTH_REQUIRED'; end if;
  if not exists (select 1 from public.workspaces where id = p_workspace_id and owner_id = auth.uid()) then
    raise exception using errcode = 'TD003', message = 'NOT_FOUND';
  end if;
  if p_from is null or p_to is null or not isfinite(p_from) or not isfinite(p_to)
    or p_to < p_from or p_to - p_from > 92 then
    raise exception using errcode = 'TD002', message = 'VALIDATION_ERROR', detail = 'Use an inclusive date range of at most 93 days.';
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
    select to_jsonb(o) || jsonb_build_object('meeting_key', o.schedule_slot_id::text || ':' || to_char(o.original_date, 'YYYY-MM-DD'))
      from occurrences o order by o.actual_date, o.start_time, o.schedule_slot_id;
end;
$$;

revoke all on function public.list_meetings(uuid, date, date) from public, anon, authenticated;
grant execute on function public.list_meetings(uuid, date, date) to authenticated;
