-- Phase Two: database foundation. No legacy data is imported by these migrations.
create schema if not exists extensions;
create extension if not exists btree_gist with schema extensions;

create schema if not exists dashboard_private;
revoke all on schema dashboard_private from public, anon, authenticated;
alter default privileges in schema dashboard_private revoke execute on functions from public;

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique references auth.users(id) on delete cascade,
  display_name text not null check (length(btrim(display_name)) between 1 and 120),
  timezone text not null default 'Asia/Tashkent',
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.groups (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  id uuid not null default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 120),
  subject text not null check (length(btrim(subject)) between 1 and 120),
  code text check (length(btrim(code)) between 1 and 80),
  archived boolean not null default false,
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, id),
  unique (workspace_id, code)
);

-- Slot identity survives edits. Versions carry half-open effective date ranges.
create table public.schedule_slots (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  id uuid not null default gen_random_uuid(),
  group_id uuid not null,
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  primary key (workspace_id, id),
  unique (workspace_id, id, group_id),
  foreign key (workspace_id, group_id) references public.groups(workspace_id, id)
);

create table public.schedule_slot_versions (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  id uuid not null default gen_random_uuid(),
  schedule_slot_id uuid not null,
  weekday smallint not null check (weekday between 1 and 7),
  start_time time not null,
  end_time time not null,
  room text not null default '' check (length(room) <= 120),
  effective_from date not null check (isfinite(effective_from)),
  effective_to date check (isfinite(effective_to)),
  created_at timestamptz not null default now(),
  primary key (workspace_id, id),
  unique (workspace_id, schedule_slot_id, id),
  unique (workspace_id, schedule_slot_id, effective_from),
  foreign key (workspace_id, schedule_slot_id) references public.schedule_slots(workspace_id, id),
  check (start_time < end_time and end_time < time '24:00'),
  check (extract(second from start_time) = 0 and extract(second from end_time) = 0),
  check (effective_to is null or effective_to > effective_from)
);

alter table public.schedule_slot_versions add constraint slot_versions_no_overlap
  exclude using gist (workspace_id with =, schedule_slot_id with =,
    daterange(effective_from, effective_to, '[)') with &&);

create table public.meetings (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  id uuid not null default gen_random_uuid(),
  schedule_slot_id uuid not null,
  slot_version_id uuid not null,
  group_id uuid not null,
  original_date date not null check (isfinite(original_date)),
  actual_date date not null check (isfinite(actual_date)),
  start_time time not null,
  end_time time not null,
  group_name text not null check (length(btrim(group_name)) between 1 and 120),
  subject text not null,
  room text not null,
  is_rescheduled boolean not null default false,
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, id),
  unique (workspace_id, schedule_slot_id, original_date),
  foreign key (workspace_id, schedule_slot_id, group_id)
    references public.schedule_slots(workspace_id, id, group_id),
  foreign key (workspace_id, schedule_slot_id, slot_version_id)
    references public.schedule_slot_versions(workspace_id, schedule_slot_id, id),
  check (start_time < end_time and end_time < time '24:00')
);

create table public.students (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  id uuid not null default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 120),
  external_id text check (length(btrim(external_id)) between 1 and 120),
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, id),
  unique (workspace_id, external_id)
);

create table public.enrollments (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  id uuid not null default gen_random_uuid(),
  group_id uuid not null,
  student_id uuid not null,
  starts_on date not null check (isfinite(starts_on)),
  ends_on date check (isfinite(ends_on)),
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, id),
  foreign key (workspace_id, group_id) references public.groups(workspace_id, id),
  foreign key (workspace_id, student_id) references public.students(workspace_id, id),
  check (ends_on is null or ends_on > starts_on)
);

alter table public.enrollments add constraint enrollments_no_overlap
  exclude using gist (workspace_id with =, group_id with =, student_id with =,
    daterange(starts_on, ends_on, '[)') with &&);

create table public.lesson_records (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  meeting_id uuid not null,
  notes text not null default '' check (length(notes) <= 5000),
  rating smallint check (rating between 1 and 5),
  lesson_type text not null default 'Lesson' check (length(btrim(lesson_type)) between 1 and 60),
  status text not null default 'Done' check (status in ('Done', 'Late', 'Cancelled', 'Skipped')),
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, meeting_id),
  foreign key (workspace_id, meeting_id) references public.meetings(workspace_id, id)
);

create table public.attendance_checklists (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  meeting_id uuid not null,
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, meeting_id),
  foreign key (workspace_id, meeting_id) references public.meetings(workspace_id, id)
);

-- These rows are also the frozen roster: corrections retain IDs and names.
create table public.attendance_entries (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  meeting_id uuid not null,
  student_id uuid not null,
  student_name text not null check (length(btrim(student_name)) between 1 and 120),
  attendance text not null check (attendance in ('present', 'absent')),
  participation smallint not null check (participation between -1 and 1),
  note text not null default '' check (length(note) <= 300),
  primary key (workspace_id, meeting_id, student_id),
  foreign key (workspace_id, meeting_id) references public.attendance_checklists(workspace_id, meeting_id),
  foreign key (workspace_id, student_id) references public.students(workspace_id, id),
  check (attendance <> 'absent' or participation = 0)
);

create table dashboard_private.operations (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  operation_id uuid not null,
  request_hash bytea not null,
  response jsonb not null,
  created_at timestamptz not null default now(),
  primary key (workspace_id, operation_id)
);
alter table dashboard_private.operations enable row level security;
revoke all on dashboard_private.operations from public, anon, authenticated;

-- Composite PKs index all workspace ownership filters; these cover date/history joins.
create index groups_active_idx on public.groups(workspace_id, archived);
create index slots_group_idx on public.schedule_slots(workspace_id, group_id);
create index slot_versions_dates_idx on public.schedule_slot_versions(workspace_id, effective_from, effective_to);
create index meetings_dates_idx on public.meetings(workspace_id, actual_date, start_time);
create index meetings_group_dates_idx on public.meetings(workspace_id, group_id, actual_date);
create index enrollments_roster_idx on public.enrollments(workspace_id, group_id, starts_on, ends_on);
create index enrollments_student_idx on public.enrollments(workspace_id, student_id, group_id);
create index attendance_student_history_idx on public.attendance_entries(workspace_id, student_id, meeting_id);

-- Reads use RLS; browser roles have NO table write privileges or write policies.
alter table public.workspaces enable row level security;
revoke all on public.workspaces from public, anon, authenticated;
grant select on public.workspaces to authenticated;
create policy owner_read on public.workspaces for select to authenticated
  using (owner_id = (select auth.uid()));

do $$
declare relation text;
begin
  foreach relation in array array['groups', 'schedule_slots', 'schedule_slot_versions',
    'meetings', 'students', 'enrollments', 'lesson_records', 'attendance_checklists', 'attendance_entries']
  loop
    execute format('alter table public.%I enable row level security', relation);
    execute format('revoke all on public.%I from public, anon, authenticated', relation);
    execute format('grant select on public.%I to authenticated', relation);
    execute format('create policy owner_read on public.%I for select to authenticated using
      (workspace_id in (select id from public.workspaces where owner_id = (select auth.uid())))', relation);
  end loop;
end;
$$;
