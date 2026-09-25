import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDatabase, teacherA, teacherB, tables, asUser, write, meetings, fixture } from './helpers/database.js';

const rejectsCode = (promise, code) => assert.rejects(promise, error => {
  assert.equal(error.code, code, error.message);
  return true;
});

test('migrations apply and the normal teaching workflow uses transactional records', async () => {
  const db = await createDatabase();
  try {
    const {workspace, slot, student} = await fixture(db);
    const initial = await meetings(db, teacherA, workspace.id, '2026-09-21', '2026-09-27');
    assert.equal(initial.length, 1);
    assert.equal(initial[0].id, null);
    const lesson = await write(db, teacherA, workspace.id, 'save_lesson_record', {
      schedule_slot_id: slot.id, original_date: '2026-09-21', expected_revision: 0, notes: 'Introduction', rating: 4, status: 'Late'
    });
    const attendance = await write(db, teacherA, workspace.id, 'save_attendance', {
      schedule_slot_id: slot.id, original_date: '2026-09-21', expected_revision: 0,
      entries: [{student_id: student.id, attendance: 'present', participation: 1, note: 'Good work'}]
    });
    assert.equal(lesson.meeting.id, attendance.meeting.id);
    assert.equal(lesson.record.status, 'Late');
    assert.equal(attendance.entries[0].student_name, student.name);
    assert.equal((await meetings(db, teacherA, workspace.id, '2026-09-21', '2026-09-27'))[0].id, lesson.meeting.id);
  } finally { await db.close(); }
});

async function saveRecords(db, data, user = teacherA, date = '2026-09-21') {
  const base = {schedule_slot_id: data.slot.id, original_date: date, expected_revision: 0};
  const lesson = await write(db, user, data.workspace.id, 'save_lesson_record', {...base, notes: 'Private lesson'});
  const attendance = await write(db, user, data.workspace.id, 'save_attendance', {...base,
    entries: [{student_id: data.student.id, attendance: 'present', participation: 1, note: 'Private student note'}]
  });
  return {lesson, attendance};
}

async function count(db, relation, workspace) {
  return Number((await db.query(`select count(*) as total from ${relation} where workspace_id = $1`, [workspace])).rows[0].total);
}

test('two teachers are isolated on every table and all RPC writes', async () => {
  const db = await createDatabase();
  try {
    const a = await fixture(db);
    const b = await fixture(db, teacherB);
    await saveRecords(db, a);
    await saveRecords(db, b, teacherB);
    for (const [user, own, other] of [[teacherA, a, b], [teacherB, b, a]]) {
      for (const table of tables) {
        const column = table === 'workspaces' ? 'id' : 'workspace_id';
        const visible = await asUser(db, user, tx => tx.query(`select * from public.${table}`));
        assert.ok(visible.rows.length > 0, `${table} has own rows`);
        assert.ok(visible.rows.every(row => row[column] === own.workspace.id), `${table} is isolated`);
        const hidden = await asUser(db, user, tx => tx.query(`select * from public.${table} where ${column} = $1`, [other.workspace.id]));
        assert.equal(hidden.rows.length, 0);
      }
      for (const action of ['save_workspace', 'save_group', 'save_student', 'save_enrollment', 'save_schedule_slot', 'save_lesson_record', 'save_attendance']) {
        await rejectsCode(write(db, user, other.workspace.id, action, {expected_revision: 0}), 'TD003');
      }
      await rejectsCode(meetings(db, user, other.workspace.id, '2026-09-21', '2026-09-27'), 'TD003');
      await rejectsCode(write(db, user, own.workspace.id, 'save_student', {id: other.student.id, name: 'Attack', expected_revision: 1}), 'TD003');
      await rejectsCode(write(db, user, own.workspace.id, 'save_group', {id: other.group.id, name: 'Attack', subject: 'X', expected_revision: 1}), 'TD003');
      await rejectsCode(write(db, user, own.workspace.id, 'save_enrollment', {
        student_id: other.student.id, group_id: own.group.id, starts_on: '2026-09-01', expected_revision: 0
      }), 'TD003');
      await rejectsCode(write(db, user, own.workspace.id, 'save_enrollment', {
        student_id: own.student.id, group_id: other.group.id, starts_on: '2026-09-01', expected_revision: 0
      }), 'TD003');
      await rejectsCode(write(db, user, own.workspace.id, 'save_lesson_record', {
        schedule_slot_id: other.slot.id, original_date: '2026-09-21', expected_revision: 0, notes: 'Attack'
      }), 'TD003');
    }
  } finally { await db.close(); }
});

test('browser roles cannot bypass validation with direct SQL or private helpers', async () => {
  const db = await createDatabase();
  try {
    const data = await fixture(db);
    await saveRecords(db, data);
    for (const role of ['authenticated', 'anon']) {
      for (const table of tables) {
        const column = table === 'workspaces' ? 'id' : 'workspace_id';
        for (const command of [
          `insert into public.${table} default values`,
          `update public.${table} set ${column} = ${column}`,
          `delete from public.${table}`,
          `truncate public.${table} cascade`
        ]) await rejectsCode(asUser(db, teacherA, tx => tx.exec(command), role), '42501');
      }
      await rejectsCode(asUser(db, teacherA, tx => tx.query('select * from dashboard_private.operations'), role), '42501');
      await rejectsCode(asUser(db, teacherA, tx => tx.query("select dashboard_private.save_student($1, '{}'::jsonb)", [data.workspace.id]), role), '42501');
    }
    await rejectsCode(asUser(db, null, tx => tx.query('select * from public.workspaces'), 'anon'), '42501');
    await rejectsCode(asUser(db, null, tx => tx.query("select public.dashboard_write(null, $1, 'ensure_workspace', '{}'::jsonb)", [crypto.randomUUID()]), 'anon'), '42501');
    await rejectsCode(write(db, null, data.workspace.id, 'save_student', {name: 'No user', expected_revision: 0}), 'TD001');
    await rejectsCode(meetings(db, null, data.workspace.id, '2026-09-21', '2026-09-27'), 'TD001');
    assert.equal((await asUser(db, null, tx => tx.query('select * from public.students'))).rows.length, 0);
    const configs = (await db.query(`select p.proname, p.prosecdef, p.proconfig from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('dashboard_write','list_meetings')`)).rows;
    assert.equal(configs.length, 2);
    assert.ok(configs.every(row => row.proconfig.includes('search_path=""')));
    assert.equal(configs.find(row => row.proname === 'dashboard_write').prosecdef, true);
    assert.equal(configs.find(row => row.proname === 'list_meetings').prosecdef, false);
  } finally { await db.close(); }
});

test('database foreign keys reject cross-workspace relationships even for a privileged writer', async () => {
  const db = await createDatabase();
  try {
    const a = await fixture(db);
    const b = await fixture(db, teacherB);
    const ar = await saveRecords(db, a);
    const br = await saveRecords(db, b, teacherB);
    const ws = a.workspace.id;
    const cases = [
      ['insert into public.schedule_slots(workspace_id, group_id) values ($1,$2)', [ws, b.group.id]],
      ["insert into public.schedule_slot_versions(workspace_id,schedule_slot_id,weekday,start_time,end_time,effective_from) values ($1,$2,1,'09:00','10:00','2027-01-01')", [ws, b.slot.id]],
      ["insert into public.enrollments(workspace_id,group_id,student_id,starts_on) values ($1,$2,$3,'2027-01-01')", [ws, a.group.id, b.student.id]],
      ["insert into public.enrollments(workspace_id,group_id,student_id,starts_on) values ($1,$2,$3,'2027-01-01')", [ws, b.group.id, a.student.id]],
      ['insert into public.lesson_records(workspace_id,meeting_id) values ($1,$2)', [ws, br.lesson.meeting.id]],
      ['insert into public.attendance_checklists(workspace_id,meeting_id) values ($1,$2)', [ws, br.lesson.meeting.id]],
      ["insert into public.attendance_entries(workspace_id,meeting_id,student_id,student_name,attendance,participation) values ($1,$2,$3,'Snapshot','present',0)", [ws, ar.lesson.meeting.id, b.student.id]],
      ["insert into public.attendance_entries(workspace_id,meeting_id,student_id,student_name,attendance,participation) values ($1,$2,$3,'Snapshot','present',0)", [ws, br.lesson.meeting.id, a.student.id]],
      ["insert into public.meetings(workspace_id,schedule_slot_id,slot_version_id,group_id,original_date,actual_date,start_time,end_time,group_name,subject,room) values ($1,$2,$3,$4,'2026-09-28','2026-09-28','09:00','10:00','Snapshot','Math','')", [ws, a.slot.id, b.slot.version.id, a.group.id]],
      ["insert into public.meetings(workspace_id,schedule_slot_id,slot_version_id,group_id,original_date,actual_date,start_time,end_time,group_name,subject,room) values ($1,$2,$3,$4,'2026-09-28','2026-09-28','09:00','10:00','Snapshot','Math','')", [ws, a.slot.id, a.slot.version.id, b.group.id]]
    ];
    for (const [sql, parameters] of cases) await rejectsCode(db.query(sql, parameters), '23503');
    // A mismatched group in the SAME workspace also fails the slot/group FK.
    const otherGroup = await write(db, teacherA, ws, 'save_group', {name: 'Other', subject: 'Other', expected_revision: 0});
    const [sql, parameters] = cases.at(-1);
    await rejectsCode(db.query(sql, [...parameters.slice(0, 3), otherGroup.id]), '23503');
  } finally { await db.close(); }
});

test('one workspace per owner and operation receipts make retries repeat-safe', async () => {
  const db = await createDatabase();
  try {
    const operation = crypto.randomUUID();
    const bootstrap = {display_name: 'Teacher'};
    const first = await write(db, teacherA, null, 'ensure_workspace', bootstrap, operation);
    assert.deepEqual(await write(db, teacherA, null, 'ensure_workspace', bootstrap, operation), first);
    assert.equal((await write(db, teacherA, null, 'ensure_workspace', {display_name: 'Different'})).id, first.id);
    await rejectsCode(db.query("insert into public.workspaces(owner_id, display_name) values ($1, 'Duplicate')", [teacherA]), '23505');
    await rejectsCode(write(db, teacherA, null, 'ensure_workspace', {display_name: 'Changed'}, operation), 'TD005');
    const createOperation = crypto.randomUUID();
    const create = {name: 'New', expected_revision: 0};
    const student = await write(db, teacherA, first.id, 'save_student', create, createOperation);
    const replay = await write(db, teacherA, first.id, 'save_student', create, createOperation);
    assert.deepEqual(replay, student);
    assert.equal(await count(db, 'public.students', first.id), 1);
    await rejectsCode(write(db, teacherA, first.id, 'save_student', {...create, name: 'Different'}, createOperation), 'TD005');
    await rejectsCode(write(db, teacherA, first.id, 'save_group', {name: 'New', subject: 'Math', expected_revision: 0}, createOperation), 'TD005');
    const updateOperation = crypto.randomUUID();
    const update = {id: student.id, name: 'Updated', expected_revision: 1};
    const updated = await write(db, teacherA, first.id, 'save_student', update, updateOperation);
    assert.equal(updated.revision, 2);
    assert.deepEqual(await write(db, teacherA, first.id, 'save_student', update, updateOperation), updated);
    assert.deepEqual(await write(db, teacherA, first.id, 'save_student', create, createOperation), student);
    assert.equal((await db.query('select name,revision from public.students')).rows[0].revision, 2);
    // A failed transaction consumes neither the operation ID nor partial data.
    const retryOperation = crypto.randomUUID();
    await rejectsCode(write(db, teacherA, first.id, 'save_student', {name: '', expected_revision: 0}, retryOperation), 'TD002');
    await write(db, teacherA, first.id, 'save_student', {name: 'Fixed', expected_revision: 0}, retryOperation);
    assert.equal(await count(db, 'public.students', first.id), 2);
  } finally { await db.close(); }
});

test('revision checks cover all mutable entities and separate lesson/attendance records', async () => {
  const db = await createDatabase();
  try {
    const d = await fixture(db);
    const ws = d.workspace.id;
    const {lesson} = await saveRecords(db, d);
    const cases = [
      ['save_workspace', {display_name: 'New name'}],
      ['save_group', {id: d.group.id, name: 'New group', subject: 'Math'}],
      ['save_student', {id: d.student.id, name: 'New student'}],
      ['save_enrollment', {id: d.enrollment.id, group_id: d.group.id, student_id: d.student.id, starts_on: '2026-01-01', ends_on: '2027-01-01'}],
      ['save_schedule_slot', {id: d.slot.id, group_id: d.group.id, weekday: 1, start_time: '10:00', end_time: '11:00', effective_from: '2090-01-01'}],
      ['save_lesson_record', {schedule_slot_id: d.slot.id, original_date: '2026-09-21', notes: 'New notes'}],
      ['save_attendance', {schedule_slot_id: d.slot.id, original_date: '2026-09-21', entries: [{student_id: d.student.id, attendance: 'absent', participation: 0}]}]
    ];
    for (const [action, payload] of cases) {
      await rejectsCode(write(db, teacherA, ws, action, {...payload, expected_revision: 0}), 'TD004');
      const saved = await write(db, teacherA, ws, action, {...payload, expected_revision: 1});
      assert.equal(saved.record?.revision || saved.checklist?.revision || saved.revision, 2);
      await rejectsCode(write(db, teacherA, ws, action, {...payload, expected_revision: 1}), 'TD004');
      await rejectsCode(write(db, teacherA, ws, action, payload), 'TD002');
    }
    assert.equal(await count(db, 'public.meetings', ws), 1);
    assert.equal((await db.query('select revision from public.meetings where id = $1', [lesson.meeting.id])).rows[0].revision, 1);
  } finally { await db.close(); }
});

test('occurrence reads create no rows and preserve stable keys, versions, and saved snapshots', async () => {
  const db = await createDatabase();
  try {
    const d = await fixture(db);
    const ws = d.workspace.id;
    const second = await write(db, teacherA, ws, 'save_schedule_slot', {
      group_id: d.group.id, weekday: 1, start_time: '10:00', end_time: '11:00', effective_from: '2026-01-01', expected_revision: 0
    });
    const generated = await meetings(db, teacherA, ws, '2026-09-21', '2026-09-21');
    assert.equal(generated.length, 2);
    assert.equal(new Set(generated.map(row => row.meeting_key)).size, 2);
    assert.ok(generated.every(row => row.id === null));
    assert.equal(await count(db, 'public.meetings', ws), 0);
    const record = await write(db, teacherA, ws, 'save_lesson_record', {
      schedule_slot_id: d.slot.id, original_date: '2026-09-21', expected_revision: 0, notes: ''
    });
    await write(db, teacherA, ws, 'save_group', {id: d.group.id, expected_revision: 1, name: 'Renamed', subject: 'Geometry'});
    const saved = (await meetings(db, teacherA, ws, '2026-09-21', '2026-09-21')).find(row => row.schedule_slot_id === d.slot.id);
    assert.equal(saved.meeting_key, generated[0].meeting_key);
    assert.equal(saved.group_name, 'Math');
    assert.equal(saved.subject, 'Algebra');
    const version = await write(db, teacherA, ws, 'save_schedule_slot', {
      id: d.slot.id, group_id: d.group.id, weekday: 3, start_time: '12:00', end_time: '13:00',
      effective_from: '2090-01-01', expected_revision: 1
    });
    assert.equal(version.id, d.slot.id);
    assert.notEqual(version.version.id, d.slot.version.id);
    assert.equal((await meetings(db, teacherA, ws, '2026-09-21', '2026-09-21')).find(row => row.id === record.meeting.id).start_time, '09:00:00');
    const future = await meetings(db, teacherA, ws, '2090-01-01', '2090-01-07');
    assert.ok(future.some(row => row.schedule_slot_id === d.slot.id && row.start_time === '12:00:00'));
    assert.ok(future.some(row => row.schedule_slot_id === second.id));
    // Privileged fixture simulates a future reschedule; no reschedule RPC ships in Phase Two.
    await db.query("update public.meetings set actual_date = '2026-10-01', is_rescheduled = true where workspace_id = $1 and id = $2", [ws, record.meeting.id]);
    assert.equal((await meetings(db, teacherA, ws, '2026-09-21', '2026-09-21')).length, 1);
    const moved = await meetings(db, teacherA, ws, '2026-10-01', '2026-10-01');
    assert.equal(moved.length, 1);
    assert.equal(moved[0].meeting_key, saved.meeting_key);
    assert.equal(moved[0].original_date, '2026-09-21');
    assert.equal(moved[0].actual_date, '2026-10-01');
    assert.equal(await count(db, 'public.meetings', ws), 1);
    await rejectsCode(meetings(db, teacherA, ws, '2026-01-01', '2027-01-01'), 'TD002');
  } finally { await db.close(); }
});

test('rosters use half-open enrollment dates and remain frozen on correction', async () => {
  const db = await createDatabase();
  try {
    const d = await fixture(db);
    const ws = d.workspace.id;
    await write(db, teacherA, ws, 'save_enrollment', {id: d.enrollment.id, group_id: d.group.id,
      student_id: d.student.id, starts_on: '2026-09-21', ends_on: '2026-09-28', expected_revision: 1});
    const payload = {schedule_slot_id: d.slot.id, original_date: '2026-09-21', expected_revision: 0,
      entries: [{student_id: d.student.id, attendance: 'present', participation: 0}]};
    await rejectsCode(write(db, teacherA, ws, 'save_attendance', {...payload, original_date: '2026-09-14'}), 'TD007');
    await rejectsCode(write(db, teacherA, ws, 'save_attendance', {...payload, original_date: '2026-09-28'}), 'TD007');
    assert.equal(await count(db, 'public.meetings', ws), 0);
    const saved = await write(db, teacherA, ws, 'save_attendance', payload);
    const newcomer = await write(db, teacherA, ws, 'save_student', {name: 'New arrival', expected_revision: 0});
    await write(db, teacherA, ws, 'save_enrollment', {group_id: d.group.id, student_id: newcomer.id, starts_on: '2026-09-01', expected_revision: 0});
    await write(db, teacherA, ws, 'save_student', {id: d.student.id, name: 'Renamed student', expected_revision: 1});
    const corrected = await write(db, teacherA, ws, 'save_attendance', {...payload, expected_revision: 1});
    assert.equal(corrected.entries.length, 1);
    assert.equal(corrected.entries[0].student_name, saved.entries[0].student_name);
    await rejectsCode(write(db, teacherA, ws, 'save_attendance', {...payload, expected_revision: 2,
      entries: [...payload.entries, {student_id: newcomer.id, attendance: 'present', participation: 0}]}), 'TD007');
    const later = await write(db, teacherA, ws, 'save_attendance', {...payload, original_date: '2026-09-28',
      entries: [{student_id: newcomer.id, attendance: 'absent', participation: 0}]});
    assert.equal(later.entries[0].student_id, newcomer.id);
  } finally { await db.close(); }
});

test('invalid attendance is atomic, including rollback of lazy meeting creation and receipts', async () => {
  const db = await createDatabase();
  try {
    const d = await fixture(db);
    const ws = d.workspace.id;
    const newcomer = await write(db, teacherA, ws, 'save_student', {name: 'Second', expected_revision: 0});
    await write(db, teacherA, ws, 'save_enrollment', {group_id: d.group.id, student_id: newcomer.id, starts_on: '2026-01-01', expected_revision: 0});
    const operation = crypto.randomUUID();
    const base = {schedule_slot_id: d.slot.id, original_date: '2026-09-21', expected_revision: 0};
    const entries = [
      {student_id: d.student.id, attendance: 'present', participation: 1},
      {student_id: newcomer.id, attendance: 'absent', participation: 1}
    ];
    const receipts = await count(db, 'dashboard_private.operations', ws);
    await rejectsCode(write(db, teacherA, ws, 'save_attendance', {...base, entries}, operation), 'TD002');
    for (const table of ['meetings','attendance_checklists','attendance_entries']) assert.equal(await count(db, `public.${table}`, ws), 0);
    assert.equal(await count(db, 'dashboard_private.operations', ws), receipts);
    entries[1].participation = 0;
    const saved = await write(db, teacherA, ws, 'save_attendance', {...base, entries}, operation);
    assert.deepEqual(await write(db, teacherA, ws, 'save_attendance', {...base, entries}, operation), saved);
    assert.equal(await count(db, 'public.attendance_entries', ws), 2);
    for (const invalid of [null, {}, [], [entries[0], entries[0]], Array(101).fill(entries[0])]) {
      await rejectsCode(write(db, teacherA, ws, 'save_attendance', {...base, entries: invalid}), 'TD002');
    }
    await rejectsCode(write(db, teacherA, ws, 'save_attendance', {...base, expected_revision: 1,
      entries: [{...entries[0], note: 'x'.repeat(301)}, entries[1]]}), 'TD002');
    assert.equal((await db.query('select revision from public.attendance_checklists')).rows[0].revision, 1);
  } finally { await db.close(); }
});

test('schedule and enrollment constraints reject overlap but allow adjacent ranges', async () => {
  const db = await createDatabase();
  try {
    const d = await fixture(db);
    const ws = d.workspace.id;
    const other = await write(db, teacherA, ws, 'save_group', {name: 'Science', subject: 'Science', expected_revision: 0});
    const slot = {group_id: other.id, weekday: 1, start_time: '09:30', end_time: '10:30', effective_from: '2026-01-01', expected_revision: 0};
    await rejectsCode(write(db, teacherA, ws, 'save_schedule_slot', slot), 'TD006');
    assert.equal(await count(db, 'public.schedule_slots', ws), 1);
    await write(db, teacherA, ws, 'save_schedule_slot', {...slot, start_time: '10:00'});
    await rejectsCode(write(db, teacherA, ws, 'save_schedule_slot', {...slot, weekday: 8}), 'TD002');
    await rejectsCode(write(db, teacherA, ws, 'save_schedule_slot', {...slot, start_time: '11:00', end_time: '10:00'}), 'TD002');
    await rejectsCode(write(db, teacherA, ws, 'save_enrollment', {group_id: d.group.id, student_id: d.student.id,
      starts_on: '2026-02-01', expected_revision: 0}), 'TD002');
    await write(db, teacherA, ws, 'save_enrollment', {id: d.enrollment.id, group_id: d.group.id, student_id: d.student.id,
      starts_on: '2026-01-01', ends_on: '2026-09-21', expected_revision: 1});
    await write(db, teacherA, ws, 'save_enrollment', {group_id: d.group.id, student_id: d.student.id,
      starts_on: '2026-09-21', expected_revision: 0});
    await rejectsCode(db.query("insert into public.schedule_slot_versions(workspace_id,schedule_slot_id,weekday,start_time,end_time,effective_from) values ($1,$2,2,'11:00','12:00','2026-02-01')", [ws, d.slot.id]), '23P01');
    await rejectsCode(write(db, teacherA, ws, 'save_workspace', {display_name: 'Teacher', timezone: 'UTC', expected_revision: 1}), 'TD002');
    await rejectsCode(write(db, teacherA, ws, 'save_workspace', {display_name: 'Teacher', timezone: 'Not/A_Zone', expected_revision: 1}), 'TD002');
  } finally { await db.close(); }
});

test('archives retain history and allow corrections without new records', async () => {
  const db = await createDatabase();
  try {
    const d = await fixture(db);
    const ws = d.workspace.id;
    await saveRecords(db, d);
    await write(db, teacherA, ws, 'save_group', {id: d.group.id, name: d.group.name, subject: d.group.subject, archived: true, expected_revision: 1});
    const visible = await meetings(db, teacherA, ws, '2026-09-21', '2026-09-30');
    assert.equal(visible.length, 1);
    assert.equal(visible[0].original_date, '2026-09-21');
    await write(db, teacherA, ws, 'save_lesson_record', {schedule_slot_id: d.slot.id, original_date: '2026-09-21', expected_revision: 1, notes: 'Correction'});
    await rejectsCode(write(db, teacherA, ws, 'save_lesson_record', {schedule_slot_id: d.slot.id, original_date: '2026-09-28', expected_revision: 0}), 'TD003');
    assert.equal(await count(db, 'public.meetings', ws), 1);
  } finally { await db.close(); }
});

test('validation bounds, roster capacity, and independent same-day records are enforced', async () => {
  const db = await createDatabase();
  try {
    const d = await fixture(db);
    const ws = d.workspace.id;
    for (const name of ['', ' ', 'x'.repeat(121)]) {
      await rejectsCode(write(db, teacherA, ws, 'save_student', {name, expected_revision: 0}), 'TD002');
    }
    await rejectsCode(write(db, teacherB, null, 'ensure_workspace', {display_name: 'Teacher', timezone: 'Wrong/Zone'}), 'TD002');
    assert.equal((await db.query('select * from public.workspaces where owner_id = $1', [teacherB])).rows.length, 0);
    await rejectsCode(write(db, teacherA, ws, 'unknown_action', {}), 'TD002');
    await rejectsCode(write(db, teacherA, ws, 'save_student', []), 'TD002');
    await rejectsCode(write(db, teacherA, ws, 'save_student', {name: 'Student', expected_revision: 0}, null), 'TD002');
    const firstPayload = {schedule_slot_id: d.slot.id, original_date: '2026-09-21', expected_revision: 0};
    for (const invalid of [{notes: 'x'.repeat(5001)}, {lesson_type: 'x'.repeat(61)}, {status: 'Unknown'}, {rating: 6}, {rating: 1.5}]) {
      await rejectsCode(write(db, teacherA, ws, 'save_lesson_record', {...firstPayload, ...invalid}), 'TD002');
    }
    assert.equal(await count(db, 'public.meetings', ws), 0);
    const secondSlot = await write(db, teacherA, ws, 'save_schedule_slot', {group_id: d.group.id,
      weekday: 1, start_time: '10:00', end_time: '11:00', effective_from: '2026-01-01', expected_revision: 0});
    const morning = await write(db, teacherA, ws, 'save_lesson_record', {...firstPayload, notes: 'First meeting'});
    const later = await write(db, teacherA, ws, 'save_lesson_record', {...firstPayload, schedule_slot_id: secondSlot.id, notes: 'Second meeting'});
    assert.notEqual(morning.meeting.id, later.meeting.id);
    assert.equal(await count(db, 'public.lesson_records', ws), 2);
    // Populate the remaining 99 roster places as an administrative test fixture.
    await db.query(`with added as (
      insert into public.students(workspace_id, name) select $1, 'Student ' || n from generate_series(1, 99) n returning id
    ) insert into public.enrollments(workspace_id,group_id,student_id,starts_on)
      select $1, $2, id, '2026-01-01' from added`, [ws, d.group.id]);
    const extra = await write(db, teacherA, ws, 'save_student', {name: 'Over capacity', expected_revision: 0});
    await rejectsCode(write(db, teacherA, ws, 'save_enrollment', {group_id: d.group.id, student_id: extra.id,
      starts_on: '2026-09-01', expected_revision: 0}), 'TD007');
    assert.equal(await count(db, 'public.enrollments', ws), 100);
  } finally { await db.close(); }
});
