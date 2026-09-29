-- Phase 7: the existing dashboard_write workspace lock and operation receipt
-- make the entire confirmed import atomic and replay-safe.
create function dashboard_private.import_students(ws uuid, payload jsonb)
returns jsonb language plpgsql set search_path = '' as $$
declare group_key uuid := (payload->>'group_id')::uuid;
  start_date date := (payload->>'starts_on')::date;
  group_row public.groups; student_row public.students;
  item jsonb; item_index integer; action text; supplied_name text; supplied_external text;
  selected_id uuid; selected_revision integer;
  created_count integer := 0; reused_count integer := 0;
  enrolled_count integer := 0; skipped_count integer := 0;
  seen_students uuid[] := array[]::uuid[];
begin
  if group_key is null or start_date is null or not isfinite(start_date)
    or jsonb_typeof(payload->'rows') <> 'array'
    or jsonb_array_length(payload->'rows') not between 1 and 100 then
    raise exception using errcode = 'TD002', message = 'VALIDATION_ERROR', detail = 'Import requires 1 to 100 rows and a finite enrollment date.';
  end if;
  select * into group_row from public.groups where workspace_id = ws and id = group_key and not archived;
  if not found then raise exception using errcode = 'TD003', message = 'NOT_FOUND'; end if;
  perform dashboard_private.assert_revision((payload->>'expected_group_revision')::integer, group_row.revision);
  for item, item_index in select value, ordinality::integer from jsonb_array_elements(payload->'rows') with ordinality loop
    if jsonb_typeof(item) <> 'object' then
      raise exception using errcode = 'TD002', message = 'VALIDATION_ERROR', detail = 'Each import row must be an object.';
    end if;
    action := item->>'action';
    if action = 'skip' then skipped_count := skipped_count + 1; continue; end if;
    supplied_name := btrim(item->>'name');
    supplied_external := nullif(btrim(item->>'external_id'), '');
    if supplied_name is null or length(supplied_name) not between 1 and 120
      or length(supplied_external) > 120 then
      raise exception using errcode = 'TD002', message = 'VALIDATION_ERROR', detail = 'Invalid name or external ID in import row.';
    end if;
    if action = 'create' then
      if supplied_external is not null and exists (
        select 1 from public.students where workspace_id = ws and external_id = supplied_external) then
        raise exception using errcode = 'TD007', message = 'ROSTER_CONFLICT', detail = 'External ID already belongs to a student.';
      end if;
      insert into public.students(workspace_id, name, external_id)
        values (ws, supplied_name, supplied_external) returning * into student_row;
      created_count := created_count + 1;
    elsif action = 'use_existing' then
      selected_id := (item->>'student_id')::uuid;
      selected_revision := (item->>'expected_student_revision')::integer;
      select * into student_row from public.students where workspace_id = ws and id = selected_id;
      if not found then raise exception using errcode = 'TD007', message = 'ROSTER_CONFLICT', detail = 'Selected student changed or disappeared.'; end if;
      perform dashboard_private.assert_revision(selected_revision, student_row.revision);
      if supplied_external is not null and supplied_external is distinct from student_row.external_id then
        raise exception using errcode = 'TD007', message = 'ROSTER_CONFLICT', detail = 'External ID no longer matches the selected student.';
      end if;
      reused_count := reused_count + 1;
    else
      raise exception using errcode = 'TD002', message = 'VALIDATION_ERROR', detail = 'Choose Create separate, Use existing, or Skip for each row.';
    end if;
    if student_row.id = any(seen_students) then
      raise exception using errcode = 'TD007', message = 'ROSTER_CONFLICT', detail = 'The same student was selected twice.';
    end if;
    seen_students := array_append(seen_students, student_row.id);
    if not exists (select 1 from public.enrollments where workspace_id = ws and group_id = group_key
      and student_id = student_row.id and starts_on <= start_date
      and (ends_on is null or start_date < ends_on)) then
      perform dashboard_private.save_enrollment(ws, jsonb_build_object('group_id', group_key,
        'student_id', student_row.id, 'starts_on', start_date, 'expected_revision', 0));
      enrolled_count := enrolled_count + 1;
    end if;
  end loop;
  return jsonb_build_object('group_id', group_key, 'created', created_count, 'reused', reused_count,
    'enrolled', enrolled_count, 'skipped', skipped_count);
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
    when 'import_students' then result := dashboard_private.import_students(workspace.id, p_payload);
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

revoke all on function dashboard_private.import_students(uuid, jsonb) from public, anon, authenticated;
