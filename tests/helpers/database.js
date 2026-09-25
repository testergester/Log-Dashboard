import { PGlite } from '@electric-sql/pglite';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';
import { readFile, readdir } from 'node:fs/promises';

export const teacherA = '11111111-1111-4111-8111-111111111111';
export const teacherB = '22222222-2222-4222-8222-222222222222';
export const tables = ['workspaces', 'groups', 'schedule_slots', 'schedule_slot_versions', 'meetings', 'students',
  'enrollments', 'lesson_records', 'attendance_checklists', 'attendance_entries'];

export async function createDatabase() {
  const db = new PGlite({ extensions: { btree_gist } });
  // Test-only stand-in for the auth schema/roles that Supabase creates. No
  // authentication mocks appear in migrations or in the production frontend.
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create schema auth;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
    $$;
    grant usage on schema auth, public to anon, authenticated;
    grant execute on function auth.uid() to anon, authenticated;
    insert into auth.users(id) values ('${teacherA}'), ('${teacherB}');
  `);
  const directory = new URL('../../supabase/migrations/', import.meta.url);
  for (const file of (await readdir(directory)).filter(file => file.endsWith('.sql')).sort()) {
    await db.transaction(async tx => { await tx.exec(await readFile(new URL(file, directory), 'utf8')); });
  }
  return db;
}

export async function asUser(db, user, callback, role = 'authenticated') {
  // SET LOCAL and claims are transaction-scoped, just like an API request.
  return db.transaction(async tx => {
    await tx.exec(`set local role ${role};`);
    await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [user || '']);
    return callback(tx);
  });
}

export async function write(db, user, workspace, action, payload, operation = crypto.randomUUID()) {
  return asUser(db, user, async tx => {
    const result = await tx.query('select public.dashboard_write($1::uuid, $2::uuid, $3, $4::jsonb) as result',
      [workspace, operation, action, JSON.stringify(payload)]);
    return result.rows[0].result;
  });
}

export async function meetings(db, user, workspace, from, to) {
  return asUser(db, user, async tx => (await tx.query(
    'select public.list_meetings($1::uuid, $2::date, $3::date) as meeting', [workspace, from, to]
  )).rows.map(row => row.meeting));
}

export async function fixture(db, user = teacherA) {
  const workspace = await write(db, user, null, 'ensure_workspace', {display_name: 'Teacher'});
  const group = await write(db, user, workspace.id, 'save_group', {name: 'Math', subject: 'Algebra', expected_revision: 0});
  const slot = await write(db, user, workspace.id, 'save_schedule_slot', {
    group_id: group.id, weekday: 1, start_time: '09:00', end_time: '10:00', room: '101', effective_from: '2026-01-01', expected_revision: 0
  });
  const student = await write(db, user, workspace.id, 'save_student', {name: 'Иван Smith', expected_revision: 0});
  const enrollment = await write(db, user, workspace.id, 'save_enrollment', {
    group_id: group.id, student_id: student.id, starts_on: '2026-01-01', expected_revision: 0
  });
  return {workspace, group, slot, student, enrollment};
}
