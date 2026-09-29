import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDatabase, teacherA, teacherB, write } from './helpers/database.js';
import { prepareLegacyExport, migrationSql } from '../scripts/migrate-legacy.js';

const workspaceId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const snapshot = {
  classes: [
    { id: 'a', name: 'Same', subject: 'Math', weekday: 1, start: '09:00', end: '10:00', room: 'Old', active: true },
    { id: 'b', name: 'Same', subject: 'Math', weekday: 3, start: '11:00', end: '12:00', room: '', active: false }
  ],
  students: [{ id: 's1', name: 'Алиса' }, { id: 's2', name: 'Алиса' }],
  enrollments: [
    { classId: 'a', studentId: 's1', joinedOn: '2025-01-01', leftOn: '' },
    { classId: 'b', studentId: 's2', joinedOn: '2024-01-01', leftOn: '2025-02-01' }
  ],
  logs: [{ classId: 'a', date: '2025-02-04', className: 'Former title', subject: 'Math', start: '08:30', end: '09:30', room: 'Old room', notes: 'Historical note', rating: 4, lessonType: 'Lesson', lessonStatus: 'Done' }],
  checklists: [{ classId: 'a', date: '2025-02-04', revision: 'canonical-v2', classInfo: { id: 'a', name: 'Earlier title', subject: 'Math', start: '08:30', end: '09:30', room: 'Old room' }, records: [
    { studentId: 's1', studentName: 'Алиса', attendance: 'present', participation: 1, note: 'Well done' },
    { studentId: 's2', studentName: 'Алиса', attendance: 'absent', participation: 0, note: '' }
  ] }],
  studentRecords: []
};

test('migration rehearses historical records, snapshots, totals, and repeat safety', async () => {
  const db = await createDatabase();
  try {
    await write(db, teacherA, null, 'ensure_workspace', { display_name: 'Owner' });
    // Explicitly selected workspace is the one already owned by the teacher.
    const ownerWorkspace = (await db.query('select id from public.workspaces where owner_id = $1', [teacherA])).rows[0].id;
    const prepared = prepareLegacyExport({ formatVersion: 1, exportedAt: '2026-09-29T00:00:00Z', snapshot },
      { ownerId: teacherA, workspaceId: ownerWorkspace, scheduleStartDate: '2026-01-01' });
    assert.equal(prepared.mapped.groups.length, 2);
    assert.equal(prepared.mapped.students.length, 2);
    assert.equal(prepared.mapped.meetings[0].original_date, '2025-02-04');
    assert.equal(prepared.mapped.meetings[0].group_name, 'Former title');
    assert.equal(prepared.mapped.identity_map.canonical_checklist_revision_by_class_date['a|2025-02-04'], 'canonical-v2');
    const sql = migrationSql(prepared, { ownerId: teacherA, workspaceId: ownerWorkspace });
    await db.exec(sql);
    await db.exec(sql);
    for (const [table, expected] of Object.entries(prepared.expected)) {
      const result = await db.query(`select count(*)::integer as n from public.${table} where workspace_id = $1`, [ownerWorkspace]);
      assert.equal(result.rows[0].n, expected, table);
    }
    const entries = (await db.query('select attendance, participation, student_name from public.attendance_entries where workspace_id = $1 order by attendance', [ownerWorkspace])).rows;
    assert.deepEqual(entries.map(item => item.attendance), ['absent', 'present']);
    assert.deepEqual(entries.map(item => item.student_name), ['Алиса', 'Алиса']);
    // Existing target edits cannot be hidden by conflict-ignore reruns.
    await db.query('update public.lesson_records set notes = $1 where workspace_id = $2', ['Changed after import', ownerWorkspace]);
    await assert.rejects(db.exec(sql), /MIGRATION_ROW_MISMATCH/);
    await db.exec('rollback;');
    await db.query('update public.lesson_records set notes = $1 where workspace_id = $2', ['Historical note', ownerWorkspace]);
    await assert.rejects(db.exec(sql.replace(`owner_id = '${teacherA}'`, `owner_id = '${teacherB}'`)), /OWNER_WORKSPACE_MISMATCH/);
  } finally { await db.close(); }
});

test('migration rejects sensitive export fields and unknown references', () => {
  const base = { formatVersion: 1, exportedAt: '2026-09-29T00:00:00Z', snapshot };
  const options = { ownerId: teacherA, workspaceId, scheduleStartDate: '2026-01-01' };
  assert.throws(() => prepareLegacyExport({ ...base, snapshot: { ...snapshot, sessionToken: 'no' } }, options), /Sensitive field/);
  assert.throws(() => prepareLegacyExport({ ...base, snapshot: { ...snapshot, enrollments: [{ classId: 'missing', studentId: 's1', joinedOn: '2025-01-01' }] } }, options), /unknown class/);
});
