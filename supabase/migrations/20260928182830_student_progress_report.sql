-- A single statement produces one MVCC snapshot for both the preview and PDF.
create function public.student_progress_report(
  p_workspace_id uuid, p_student_id uuid, p_group_id uuid, p_from date, p_to date
) returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare result jsonb;
begin
  if auth.uid() is null then
    raise exception using errcode = 'TD001', message = 'AUTH_REQUIRED';
  end if;
  if not exists (select 1 from public.workspaces where id = p_workspace_id and owner_id = auth.uid()) then
    raise exception using errcode = 'TD003', message = 'NOT_FOUND';
  end if;
  if p_from is null or p_to is null or not isfinite(p_from) or not isfinite(p_to)
     or p_to < p_from or p_to - p_from > 3659 then
    raise exception using errcode = 'TD002', message = 'VALIDATION_ERROR';
  end if;
  if not exists (select 1 from public.students where workspace_id = p_workspace_id and id = p_student_id)
     or not exists (select 1 from public.groups where workspace_id = p_workspace_id and id = p_group_id)
     or not exists (select 1 from public.enrollments where workspace_id = p_workspace_id
       and student_id = p_student_id and group_id = p_group_id) then
    raise exception using errcode = 'TD003', message = 'NOT_FOUND';
  end if;

  select jsonb_build_object(
    'teacher', jsonb_build_object('name', w.display_name, 'timezone', w.timezone),
    'student', jsonb_build_object('id', s.id, 'name', s.name, 'external_id', s.external_id),
    'group', jsonb_build_object('id', g.id, 'name', g.name, 'subject', g.subject, 'code', g.code),
    'from', p_from, 'to', p_to,
    'meetings', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', m.id, 'actual_date', m.actual_date, 'start_time', m.start_time,
        'group_name', m.group_name, 'subject', m.subject,
        'lesson_type', l.lesson_type, 'status', l.status, 'rating', l.rating,
        'attendance', a.attendance, 'participation', a.participation, 'note', a.note
      ) order by m.actual_date, m.start_time, m.id)
      from public.meetings m
      left join public.lesson_records l on l.workspace_id = m.workspace_id and l.meeting_id = m.id
      left join public.attendance_entries a on a.workspace_id = m.workspace_id and a.meeting_id = m.id
        and a.student_id = p_student_id
      where m.workspace_id = p_workspace_id and m.group_id = p_group_id
        and m.actual_date between p_from and least(p_to, (now() at time zone w.timezone)::date)
        and (l.meeting_id is null or l.status not in ('Cancelled', 'Skipped'))
        and (a.meeting_id is not null or (l.meeting_id is not null and exists (
          select 1 from public.enrollments e where e.workspace_id = p_workspace_id
            and e.group_id = p_group_id and e.student_id = p_student_id
            and e.starts_on <= m.actual_date and (e.ends_on is null or e.ends_on > m.actual_date)
        )))
    ), '[]'::jsonb)
  ) into result
  from public.workspaces w
  join public.students s on s.workspace_id = w.id and s.id = p_student_id
  join public.groups g on g.workspace_id = w.id and g.id = p_group_id
  where w.id = p_workspace_id;
  return result;
end;
$$;

revoke all on function public.student_progress_report(uuid, uuid, uuid, date, date) from public, anon, authenticated;
grant execute on function public.student_progress_report(uuid, uuid, uuid, date, date) to authenticated;
