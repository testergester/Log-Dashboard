import test from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase, fixture, teacherA, write } from './helpers/database.js';
import { parseStudentInput, previewStudentImport, IMPORT_ROW_LIMIT, IMPORT_TEMPLATE } from '../src/import-students.js';

const code = (promise, expected) => assert.rejects(promise, error => error.code === expected);

test('Papa Parse accepts UTF-8 BOM, quoted commas, Unicode, and blank lines', () => {
  assert.equal(IMPORT_TEMPLATE.split('\r\n')[0], 'name,external_id');
  const parsed = parseStudentInput('\ufeffname,external_id\r\n"Zoë, 李",A-1\r\n\r\nЖанна,A-2\r\n');
  assert.equal(parsed.error, undefined);
  assert.equal(parsed.hasHeader, true);
  assert.deepEqual(parsed.data.map(row => row.cells[0]), ['name', 'Zoë, 李', 'Жанна']);
  const names = parseStudentInput('Ada Rahim\n\nBekzod Karimov');
  assert.equal(names.hasHeader, false);
  assert.deepEqual(names.data.map(row => row.cells[0]), ['Ada Rahim', 'Bekzod Karimov']);
});

test('preview flags conflicts while keeping same-name students separate', () => {
  const parsed = parseStudentInput('name,external_id\nAda Rahim,A-1\nAda Rahim,\nNew Name,');
  const students = [{ id: 'one', name: 'Different name', external_id: 'A-1', revision: 1 },
    { id: 'two', name: 'Ada Rahim', external_id: null, revision: 1 }];
  const preview = previewStudentImport({ ...parsed, students, enrollments: [], groupId: 'g', startsOn: '2026-09-28' });
  assert.equal(preview.rows.length, 3);
  assert.equal(preview.rows[0].action, '');
  assert.match(preview.rows[0].issues.join(' '), /belongs to Different name/);
  assert.equal(preview.rows[1].action, '');
  assert.equal(preview.rows[2].action, 'create');
  const decided = previewStudentImport({ ...parsed, students, enrollments: [], groupId: 'g', startsOn: '2026-09-28',
    decisions: { 2: { action: 'use_existing', studentId: 'one' }, 3: { action: 'create' } } });
  assert.equal(decided.rows[0].blocking, false);
  assert.equal(decided.rows[1].blocking, false);
  assert.equal(IMPORT_ROW_LIMIT, 100);
});

test('row limits, duplicate IDs, corrected names, and explicit skips gate submission', () => {
  assert.match(parseStudentInput('x'.repeat(1024 * 1024 + 1)).error, /1 MB/);
  const many = parseStudentInput(Array.from({ length: 101 }, (_, index) => `Student ${index}`).join('\n'));
  assert.match(previewStudentImport({ ...many, students: [], enrollments: [], groupId: 'g', startsOn: '2026-09-28' }).error, /100 rows/);
  const parsed = parseStudentInput('name,external_id\n,BAD-1\nZoë,BAD-2\nLi,BAD-2');
  let preview = previewStudentImport({ ...parsed, students: [], enrollments: [], groupId: 'g', startsOn: '2026-09-28' });
  assert.equal(preview.rows[0].blocking, true);
  assert.equal(preview.rows[1].blocking, true);
  parsed.data[1].cells[0] = 'Corrected';
  preview = previewStudentImport({ ...parsed, students: [], enrollments: [], groupId: 'g', startsOn: '2026-09-28',
    decisions: { 4: { action: 'skip' } } });
  assert.equal(preview.rows.every(row => !row.blocking), true);
  assert.equal(preview.rows[2].action, 'skip');
});

test('confirmed import is atomic, replay-safe, and preserves existing names', async () => {
  const db = await createDatabase();
  try {
    const { workspace, group, student } = await fixture(db);
    const other = await write(db, teacherA, workspace.id, 'save_group', { name: 'Second group', subject: 'Math', expected_revision: 0 });
    const payload = { group_id: other.id, expected_group_revision: other.revision, starts_on: '2026-09-28', rows: [
      { action: 'use_existing', name: 'Иван Smith', student_id: student.id, expected_student_revision: student.revision },
      { action: 'create', name: 'Иван Smith', external_id: 'distinct-1' },
      { action: 'skip', name: '' }
    ] };
    const op = crypto.randomUUID();
    const first = await write(db, teacherA, workspace.id, 'import_students', payload, op);
    assert.deepEqual(first, { group_id: other.id, created: 1, reused: 1, enrolled: 2, skipped: 1 });
    assert.deepEqual(await write(db, teacherA, workspace.id, 'import_students', payload, op), first);
    const names = await db.query('select name from public.students where workspace_id=$1 order by name', [workspace.id]);
    assert.equal(names.rows.length, 2);
    assert.deepEqual(names.rows.map(row => row.name), ['Иван Smith', 'Иван Smith']);
    const memberships = await db.query('select count(*)::integer as count from public.enrollments where workspace_id=$1 and group_id=$2', [workspace.id, other.id]);
    assert.equal(memberships.rows[0].count, 2);
    await code(write(db, teacherA, workspace.id, 'import_students', { ...payload, starts_on: '2026-09-29' }, op), 'TD005');
    assert.equal(group.name, 'Math');
  } finally { await db.close(); }
});

test('invalid later rows and roster overflow roll back the entire import', async () => {
  const db = await createDatabase();
  try {
    const { workspace, group } = await fixture(db);
    const base = { group_id: group.id, expected_group_revision: group.revision, starts_on: '2026-09-28' };
    await code(write(db, teacherA, workspace.id, 'import_students', { ...base, rows: [
      { action: 'create', name: 'Valid first', external_id: 'rollback-1' }, { action: 'create', name: '', external_id: 'rollback-2' }
    ] }), 'TD002');
    assert.equal((await db.query("select count(*)::integer as n from public.students where external_id like 'rollback-%' ")).rows[0].n, 0);
    const rows = Array.from({ length: 100 }, (_, index) => ({ action: 'create', name: `Overflow ${index}`, external_id: `overflow-${index}` }));
    await code(write(db, teacherA, workspace.id, 'import_students', { ...base, rows }), 'TD007');
    assert.equal((await db.query("select count(*)::integer as n from public.students where external_id like 'overflow-%' ")).rows[0].n, 0);
  } finally { await db.close(); }
});

test('imports recheck references and enrollment state at commit', async () => {
  const db = await createDatabase();
  try {
    const { workspace, group, student } = await fixture(db);
    const row = { action: 'use_existing', name: student.name, student_id: student.id,
      expected_student_revision: student.revision };
    const payload = { group_id: group.id, expected_group_revision: group.revision,
      starts_on: '2026-09-28', rows: [row] };
    assert.deepEqual(await write(db, teacherA, workspace.id, 'import_students', payload),
      { group_id: group.id, created: 0, reused: 1, enrolled: 0, skipped: 0 });
    await code(write(db, teacherA, workspace.id, 'import_students', { ...payload,
      rows: [{ ...row, student_id: crypto.randomUUID() }] }), 'TD007');
    await code(write(db, teacherA, workspace.id, 'import_students', { ...payload,
      rows: [{ ...row, expected_student_revision: student.revision + 1 }] }), 'TD004');
    await code(write(db, teacherA, workspace.id, 'import_students', { ...payload,
      rows: [{ action: 'create', name: 'New student', external_id: 'a' }, { action: 'create', name: 'Other', external_id: 'a' }] }), 'TD007');
    assert.equal((await db.query("select count(*)::integer as n from public.students where external_id='a'")).rows[0].n, 0);
  } finally { await db.close(); }
});
