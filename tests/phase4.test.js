import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createAuthAccess } from '../src/data/supabase.js';
import { createDashboardController } from '../src/dashboard.js';
import { mapLegacyDashboard } from '../supabase/legacy-mapping.js';
import { createDatabase, teacherA, write } from './helpers/database.js';

const settle = () => new Promise(resolve => setImmediate(resolve));
const ws = id => ({ id, timezone: 'UTC' });
const meeting = { id: 'meeting-1', meeting_key: 'slot-1:2026-09-28', schedule_slot_id: 'slot-1',
  group_id: 'group-1', group_name: 'Group A', subject: 'Math', original_date: '2026-09-28', actual_date: '2026-09-28',
  start_time: '09:00:00', end_time: '10:00:00', room: 'Room 1' };

function fakeClient(rows) {
  return { from(table) {
    let selected = [...(rows[table] || [])];
    const orderBy = [];
    const query = {
      select() { return query; },
      eq(key, value) { selected = selected.filter(row => row[key] === value); return query; },
      lt(key, value) { selected = selected.filter(row => row[key] < value); return query; },
      lte(key, value) { selected = selected.filter(row => row[key] <= value); return query; },
      in(key, values) { selected = selected.filter(row => values.includes(row[key])); return query; },
      or() { return query; },
      order(key, options = {}) {
        orderBy.push([key, options.ascending === false ? -1 : 1]);
        selected.sort((a, b) => {
          for (const [field, direction] of orderBy) {
            const compared = String(a[field]).localeCompare(String(b[field]));
            if (compared) return compared * direction;
          }
          return 0;
        });
        return query;
      },
      limit(count) { selected = selected.slice(0, count); return query; },
      range(start, end) { selected = selected.slice(start, end + 1); return query; },
      maybeSingle() { return Promise.resolve({ data: selected[0] || null, error: null }); },
      then(resolve, reject) { return Promise.resolve({ data: selected, error: null }).then(resolve, reject); }
    };
    return query;
  } };
}

test('saved attendance reopens with its frozen roster', async () => {
  const access = createAuthAccess(fakeClient({
    meetings: [], lesson_records: [], attendance_checklists: [{ workspace_id: 'ws', meeting_id: 'meeting-1', revision: 1 }],
    attendance_entries: [{ workspace_id: 'ws', meeting_id: 'meeting-1', student_id: 'student-1', student_name: 'Original name', attendance: 'absent', participation: 0, note: 'Away' }]
  }));
  const detail = await access.meetingDetails('ws', meeting);
  assert.equal(detail.roster.length, 1);
  assert.equal(detail.roster[0].student_name, 'Original name');
  assert.equal(detail.roster[0].attendance, 'absent');
});

test('previous group notes skip attendance-only meetings and page older lessons', async () => {
  const access = createAuthAccess(fakeClient({
    meetings: [
      { workspace_id: 'ws', group_id: 'group-1', id: 'newer', actual_date: '2026-09-28' },
      { workspace_id: 'ws', group_id: 'group-1', id: 'attendance-only', actual_date: '2026-09-21' },
      { workspace_id: 'ws', group_id: 'group-1', id: 'older', actual_date: '2026-09-14' }
    ], lesson_records: [
      { workspace_id: 'ws', meeting_id: 'newer', notes: 'Recent' },
      { workspace_id: 'ws', meeting_id: 'older', notes: 'Earlier' }
    ]
  }));
  const first = await access.groupHistory('ws', 'group-1', '2026-10-01', 0, 1);
  assert.deepEqual(first.items.map(item => item.lesson.notes), ['Recent']);
  const second = await access.groupHistory('ws', 'group-1', '2026-10-01', first.nextOffset, 1);
  assert.deepEqual(second.items.map(item => item.lesson.notes), ['Earlier']);
  assert.equal(second.nextOffset, null);
});

test('student history excludes meetings outside enrollment dates and pages eligible rows', async () => {
  const access = createAuthAccess(fakeClient({
    enrollments: [{ workspace_id: 'ws', group_id: 'group-1', student_id: 'student-1', starts_on: '2026-09-21', ends_on: '2026-10-01' }],
    meetings: [
      { workspace_id: 'ws', group_id: 'group-1', id: 'after', actual_date: '2026-10-05' },
      { workspace_id: 'ws', group_id: 'group-1', id: 'during-2', actual_date: '2026-09-28' },
      { workspace_id: 'ws', group_id: 'group-1', id: 'during-1', actual_date: '2026-09-22' },
      { workspace_id: 'ws', group_id: 'group-1', id: 'before', actual_date: '2026-09-14' }
    ], lesson_records: [], attendance_entries: []
  }));
  const first = await access.studentHistory('ws', 'student-1', 0, 1);
  assert.deepEqual(first.items.map(item => item.id), ['during-2']);
  assert.equal(first.nextOffset, 2);
  const second = await access.studentHistory('ws', 'student-1', first.nextOffset, 1);
  assert.deepEqual(second.items.map(item => item.id), ['during-1']);
  assert.equal(second.nextOffset, null);
});

test('frozen attendance stays in history after an enrollment date is corrected', async () => {
  const access = createAuthAccess(fakeClient({
    enrollments: [{ workspace_id: 'ws', group_id: 'group-1', student_id: 'student-1', starts_on: '2026-09-21', ends_on: null }],
    meetings: [{ workspace_id: 'ws', group_id: 'group-1', id: 'historical', actual_date: '2026-09-14' }],
    lesson_records: [], attendance_entries: [{ workspace_id: 'ws', meeting_id: 'historical', student_id: 'student-1', attendance: 'absent', participation: 0 }]
  }));
  const page = await access.studentHistory('ws', 'student-1');
  assert.equal(page.items[0].id, 'historical');
  assert.deepEqual(await access.studentScoreTotals('ws', 'student-1', 'group-1'), { group: -1, overall: -1 });
});

function dashboardHarness(overrides = {}) {
  const dom = new JSDOM('<div id="app"></div>');
  globalThis.document = dom.window.document;
  globalThis.window = dom.window;
  globalThis.FormData = dom.window.FormData;
  const calls = [];
  const access = {
    async listGroups() { return [{ id: 'group-1', name: 'Group A', subject: 'Math', archived: false, slots: [], revision: 1 }]; },
    async listStudents() { return { students: [{ id: 'student-1', name: 'Sam', revision: 1 }],
      enrollments: [{ id: 'enrollment-1', group_id: 'group-1', student_id: 'student-1', starts_on: '2026-01-01', ends_on: null, revision: 1 }] }; },
    async listMeetings(_workspace, start, end) { calls.push(['week', start, end]); return start <= meeting.actual_date && end >= meeting.actual_date ? [meeting] : []; },
    async meetingDetails() { return { key: meeting.meeting_key, lesson: null, attendance: null, previousNotes: [],
      roster: [{ student_id: 'student-1', student_name: 'Sam', attendance: 'present', participation: 0, note: '' }] }; },
    async studentHistory() { calls.push(['history']); return { items: [], nextOffset: null }; },
    async studentScoreTotals() { return { group: 0, overall: 0 }; },
    async save() { throw Error('unexpected save'); }
  };
  Object.assign(access, overrides);
  const controller = createDashboardController({ access, render: node => dom.window.document.querySelector('#app').replaceChildren(node),
    now: () => new Date('2026-09-27T12:00:00Z') });
  return { dom, controller, calls, $: selector => dom.window.document.querySelector(selector) };
}

test('history loads and changing accounts clears the old group draft', async () => {
  const h = dashboardHarness();
  h.controller.open(ws('workspace-a')); await settle(); await settle();
  h.$('[data-action="history"]').click(); await settle(); await settle();
  assert.equal(h.calls.filter(call => call[0] === 'history').length, 1);
  assert.equal(h.$('.dashboard-history-item'), null);
  h.$('[data-action="new-group"]').click();
  h.$('#new-group-form [name="name"]').value = 'Private draft';
  h.controller.close();
  h.controller.open(ws('workspace-b')); await settle(); await settle();
  h.$('[data-action="new-group"]').click();
  assert.equal(h.$('#new-group-form [name="name"]').value, '');
});

test('day controls move one day and week view renders timetable rows', async () => {
  const h = dashboardHarness();
  h.controller.open(ws('workspace-a')); await settle(); await settle();
  const initial = h.$('.dashboard-section-heading h3').textContent;
  h.$('[data-action="next"]').click(); await settle(); await settle();
  assert.notEqual(h.$('.dashboard-section-heading h3').textContent, initial);
  h.$('[data-action="toggle-view"]').click();
  assert.ok(h.$('.dashboard-week-grid'));
  assert.ok(h.$('.dashboard-week-time'));
});

test('lesson and attendance saves keep edits typed while requests are pending', async () => {
  let finishSave;
  const h = dashboardHarness({ save: () => new Promise(resolve => { finishSave = resolve; }) });
  h.controller.open(ws('workspace-a')); await settle(); await settle();
  h.$('[data-action="next"]').click(); await settle(); await settle();
  h.$('[data-action="meeting"]').click(); await settle(); await settle();
  h.$('[data-form="attendance"] [data-action="history"]').click(); await settle(); await settle();
  const change = (selector, value) => {
    const element = h.$(selector); element.value = value;
    element.dispatchEvent(new h.dom.window.Event('input', { bubbles: true }));
  };
  const submit = selector => h.$(selector).dispatchEvent(new h.dom.window.Event('submit', { bubbles: true, cancelable: true }));
  change('[data-form="lesson"] [name="notes"]', 'Submitted notes');
  submit('[data-form="lesson"]'); await settle();
  assert.equal(typeof finishSave, 'function', h.$('.dashboard-message')?.textContent || 'save was not called');
  change('[data-form="lesson"] [name="notes"]', 'Newer notes');
  finishSave({ meeting, record: { notes: 'Submitted notes', rating: null, lesson_type: 'Lesson', status: 'Done', revision: 1 } });
  await settle(); await settle(); await settle();
  assert.equal(h.$('[data-form="lesson"] [name="notes"]').value, 'Newer notes');
  assert.match(h.$('.dashboard-history-item').textContent, /Submitted notes/);
  change('[data-form="attendance"] [name="note"]', 'Submitted attendance');
  submit('[data-form="attendance"]'); await settle();
  change('[data-form="attendance"] [name="note"]', 'Newer attendance');
  finishSave({ meeting, checklist: { revision: 1 }, entries: [{ student_id: 'student-1', student_name: 'Sam', attendance: 'present', participation: 0, note: 'Submitted attendance' }] });
  await settle(); await settle(); await settle();
  assert.equal(h.$('[data-form="attendance"] [name="note"]').value, 'Newer attendance');
  assert.match(h.$('.dashboard-history-item').textContent, /Submitted attendance/);
});

test('attendance redraw and save preserve each student’s own fields', async () => {
  let submitted;
  const roster = [
    { student_id: 'student-1', student_name: 'Sam', attendance: 'present', participation: 0, note: '' },
    { student_id: 'student-2', student_name: 'Lee', attendance: 'present', participation: 0, note: '' }
  ];
  const h = dashboardHarness({
    async meetingDetails() { return { lesson: null, attendance: null, previousNotes: [], roster }; },
    async save(action, _workspace, payload) {
      assert.equal(action, 'save_attendance');
      submitted = payload;
      return { meeting, checklist: { revision: 1 }, entries: payload.entries.map(entry => ({
        ...entry, student_name: roster.find(student => student.student_id === entry.student_id).student_name
      })) };
    }
  });
  h.controller.open(ws('workspace-a')); await settle(); await settle();
  h.$('[data-action="next"]').click(); await settle(); await settle();
  h.$('[data-action="meeting"]').click(); await settle(); await settle();
  const rows = [...h.dom.window.document.querySelectorAll('.dashboard-attendance-row')];
  rows[0].querySelector('[name="attendance"]').value = 'absent';
  rows[0].querySelector('[name="note"]').value = 'Away';
  rows[1].querySelector('[name="participation"]').value = '1';
  rows[1].querySelector('[name="note"]').value = 'Great answer';
  h.$('[data-action="toggle-view"]').click();
  const redrawn = [...h.dom.window.document.querySelectorAll('.dashboard-attendance-row')];
  assert.deepEqual(redrawn.map(row => [row.dataset.student, row.querySelector('[name="attendance"]').value,
    row.querySelector('[name="note"]').value]), [
    ['student-1', 'absent', 'Away'], ['student-2', 'present', 'Great answer']
  ]);
  assert.equal(redrawn[0].querySelector('[name="participation"]').disabled, true);
  assert.equal(redrawn[1].querySelector('[name="participation"]').value, '1');
  h.$('[data-form="attendance"]').dispatchEvent(new h.dom.window.Event('submit', { bubbles: true, cancelable: true }));
  await settle(); await settle();
  assert.deepEqual(submitted.entries, [
    { student_id: 'student-1', attendance: 'absent', participation: 0, note: 'Away' },
    { student_id: 'student-2', attendance: 'present', participation: 1, note: 'Great answer' }
  ]);
});

test('editing attendance outside the loaded history page keeps scores and pagination correct', async () => {
  const oldEntry = { student_id: 'student-1', student_name: 'Sam', attendance: 'absent', participation: 0, note: '' };
  const h = dashboardHarness({
    async meetingDetails() { return { lesson: null, attendance: { revision: 1, entries: [oldEntry] },
      previousNotes: [], roster: [oldEntry] }; },
    async studentHistory(_workspace, _student, offset) {
      if (offset === 0) return { items: [{ id: 'newer-meeting', group_id: 'group-1', group_name: 'Group A',
        actual_date: '2026-10-05', lesson: null, attendance: null }], nextOffset: 20 };
      return { items: [
        { id: 'between-meeting', group_id: 'group-1', group_name: 'Group A', actual_date: '2026-10-01', lesson: null, attendance: null },
        { ...meeting, lesson: null, attendance: { attendance: 'present', participation: 1, note: '' } }
      ], nextOffset: null };
    },
    async studentScoreTotals() { return { group: 5, overall: 5 }; },
    async save(action, _workspace, payload) {
      assert.equal(action, 'save_attendance');
      return { meeting, checklist: { revision: 2 }, entries: payload.entries.map(entry => ({ ...entry, student_name: 'Sam' })) };
    }
  });
  h.controller.open(ws('workspace-a')); await settle(); await settle();
  h.$('[data-action="next"]').click(); await settle(); await settle();
  h.$('[data-action="meeting"]').click(); await settle(); await settle();
  h.$('[data-form="attendance"] [data-action="history"]').click(); await settle(); await settle();
  const row = h.$('.dashboard-attendance-row');
  row.querySelector('[name="attendance"]').value = 'present';
  row.querySelector('[name="participation"]').value = '1';
  h.$('[data-form="attendance"]').dispatchEvent(new h.dom.window.Event('submit', { bubbles: true, cancelable: true }));
  await settle(); await settle(); await settle();
  assert.match(h.dom.window.document.body.textContent, /This group: 7 points · Overall: 7 points/);
  h.$('[data-action="more-history"]').click(); await settle(); await settle();
  const dates = [...h.dom.window.document.querySelectorAll('.dashboard-history-item strong')].map(item => item.textContent);
  assert.equal(dates.length, 3);
  assert.match(dates[0], /Oct 5/);
  assert.match(dates[1], /Oct 1/);
  assert.match(dates[2], /Sep 28/);
});

test('adding a student from a group also enrolls them and leaves them editable', async () => {
  const students = [{ id: 'student-1', name: 'Sam', revision: 1 }];
  const enrollments = [{ id: 'enrollment-1', group_id: 'group-1', student_id: 'student-1', starts_on: '2026-01-01', ends_on: null, revision: 1 }];
  const actions = [];
  const h = dashboardHarness({
    async listStudents() { return { students: [...students], enrollments: [...enrollments] }; },
    async save(action, _workspace, payload) {
      actions.push(action);
      if (action === 'save_student') {
        const student = { id: 'student-2', name: payload.name, revision: 1 }; students.push(student); return student;
      }
      const enrollment = { id: 'enrollment-2', group_id: payload.group_id, student_id: payload.student_id,
        starts_on: payload.starts_on, ends_on: null, revision: 1 };
      enrollments.push(enrollment); return enrollment;
    }
  });
  h.controller.open(ws('workspace-a')); await settle(); await settle();
  const form = h.$('[data-form="student"][data-group="group-1"]');
  form.querySelector('[name="name"]').value = 'Alex';
  form.dispatchEvent(new h.dom.window.Event('submit', { bubbles: true, cancelable: true }));
  await settle(); await settle(); await settle();
  assert.deepEqual(actions, ['save_student', 'save_enrollment']);
  assert.match(h.$('.dashboard-roster-list').textContent, /Alex/);
  assert.ok(h.$('[data-form="edit-student"][data-student="student-2"]'));
});

test('legacy class/date pairs map to separate meetings and retain saved snapshots', () => {
  const result = mapLegacyDashboard({
    classes: [
      { id: 'monday', name: 'Group A', subject: 'Math', weekday: 1, start: '09:00', end: '10:00', active: true },
      { id: 'wednesday', name: 'Group A', subject: 'Math', weekday: 3, start: '09:00', end: '10:00', active: true }
    ], students: [{ id: 'sam', name: 'Sam' }],
    enrollments: [
      { classId: 'monday', studentId: 'sam', joinedOn: '2026-09-01', leftOn: '' },
      { classId: 'wednesday', studentId: 'sam', joinedOn: '2026-09-01', leftOn: '' }
    ], logs: [{ classId: 'monday', date: '2026-09-21', className: 'Group A', subject: 'Math', start: '08:30', end: '09:30', notes: 'Older time', lessonType: 'Quiz', lessonStatus: 'Done' }],
    checklists: [{ classId: 'wednesday', date: '2026-09-23', records: [{ studentId: 'sam', studentName: 'Sam then', attendance: 'absent', participation: 0, note: 'Away' }] }]
  }, { workspaceId: '00000000-0000-4000-8000-000000000001', scheduleStartDate: '2026-09-01' });
  assert.equal(result.groups.length, 2);
  assert.equal(result.schedule_slots.length, 2);
  assert.equal(result.enrollments.length, 2);
  assert.equal(result.meetings.length, 2);
  assert.equal(result.meetings[0].start_time, '08:30');
  assert.equal(result.attendance_entries[0].student_name, 'Sam then');
});

test('mapped legacy rows fit the Supabase schema without a production migration', async () => {
  const db = await createDatabase();
  try {
    const workspace = await write(db, teacherA, null, 'ensure_workspace', { display_name: 'Teacher' });
    const mapped = mapLegacyDashboard({
      classes: [{ id: 'old-class', name: 'Group A', subject: 'Math', weekday: 1, start: '09:00', end: '10:00', active: true }],
      students: [{ id: 'old-student', name: 'Sam' }],
      enrollments: [{ classId: 'old-class', studentId: 'old-student', joinedOn: '2026-09-01', leftOn: '' }],
      logs: [{ classId: 'old-class', date: '2026-09-21', className: 'Group A', subject: 'Math', start: '08:30', end: '09:30', notes: 'Saved snapshot' }],
      checklists: [{ classId: 'old-class', date: '2026-09-21', records: [{ studentId: 'old-student', studentName: 'Sam then', attendance: 'present', participation: 1 }] }]
    }, { workspaceId: workspace.id, scheduleStartDate: '2026-09-01' });
    const tables = ['groups', 'schedule_slots', 'schedule_slot_versions', 'students', 'enrollments', 'meetings',
      'lesson_records', 'attendance_checklists', 'attendance_entries'];
    await db.transaction(async tx => {
      for (const table of tables) for (const row of mapped[table]) {
        const columns = Object.keys(row);
        const values = Object.values(row);
        await tx.query(`insert into public.${table} (${columns.join(',')}) values (${columns.map((_, index) => `$${index + 1}`).join(',')})`, values);
      }
    });
    const result = await db.query('select m.start_time, l.notes, a.student_name from public.meetings m join public.lesson_records l on l.workspace_id = m.workspace_id and l.meeting_id = m.id join public.attendance_entries a on a.workspace_id = m.workspace_id and a.meeting_id = m.id');
    assert.equal(result.rows[0].start_time, '08:30:00');
    assert.equal(result.rows[0].notes, 'Saved snapshot');
    assert.equal(result.rows[0].student_name, 'Sam then');
  } finally { await db.close(); }
});
