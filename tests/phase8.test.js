import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { createDatabase, fixture, teacherA, teacherB, asUser, write } from './helpers/database.js';
import { progressReport } from '../src/progress-report.js';
import { createProgressReportPdf } from '../src/progress-report-pdf.js';
import { createDashboardController } from '../src/dashboard.js';

const snapshot = (db, user, workspace, student, group, from = '2026-08-01', to = '2026-08-31') =>
  asUser(db, user, async tx => (await tx.query(
    'select public.student_progress_report($1::uuid,$2::uuid,$3::uuid,$4::date,$5::date) as report',
    [workspace, student, group, from, to]
  )).rows[0].report);

test('report snapshot counts saved student entries, actual dates, and only eligible records', async () => {
  const db = await createDatabase();
  try {
    const { workspace, group, slot, student } = await fixture(db);
    const second = await write(db, teacherA, workspace.id, 'save_student', { name: 'Other student', expected_revision: 0 });
    await write(db, teacherA, workspace.id, 'save_enrollment', {
      group_id: group.id, student_id: second.id, starts_on: '2026-01-01', expected_revision: 0
    });
    const moved = await write(db, teacherA, workspace.id, 'reschedule_meeting', {
      schedule_slot_id: slot.id, original_date: '2026-08-03', actual_date: '2026-08-04',
      start_time: '09:00', end_time: '10:00', room: '101', expected_revision: 0
    });
    assert.equal(moved.meeting.actual_date, '2026-08-04');
    for (const [date, attendance, participation] of [
      ['2026-08-03', 'present', 1], ['2026-08-10', 'present', -1],
      ['2026-08-17', 'present', 1], ['2026-08-24', 'absent', 0]
    ]) {
      await write(db, teacherA, workspace.id, 'save_attendance', {
        schedule_slot_id: slot.id, original_date: date, expected_revision: 0,
        entries: [
          { student_id: student.id, attendance, participation, note: 'Индивидуальная заметка' },
          { student_id: second.id, attendance: 'present', participation: 1, note: 'OTHER STUDENT SECRET' }
        ]
      });
    }
    await write(db, teacherA, workspace.id, 'save_attendance', {
      schedule_slot_id: slot.id, original_date: '2026-08-31', expected_revision: 0,
      entries: [
        { student_id: student.id, attendance: 'present', participation: 1, note: 'Cancelled entry' },
        { student_id: second.id, attendance: 'present', participation: 1 }
      ]
    });
    await write(db, teacherA, workspace.id, 'save_lesson_record', {
      schedule_slot_id: slot.id, original_date: '2026-08-31', expected_revision: 0,
      notes: 'GENERAL CLASS SECRET', status: 'Cancelled'
    });
    await write(db, teacherA, workspace.id, 'save_lesson_record', {
      schedule_slot_id: slot.id, original_date: '2026-09-07', expected_revision: 0, status: 'Skipped'
    });
    await write(db, teacherA, workspace.id, 'save_lesson_record', {
      schedule_slot_id: slot.id, original_date: '2026-09-14', expected_revision: 0, status: 'Done'
    });
    const data = await snapshot(db, teacherA, workspace.id, student.id, group.id);
    assert.equal(data.meetings.length, 4);
    assert.equal(data.meetings[0].actual_date, '2026-08-04');
    assert.equal(JSON.stringify(data).includes('OTHER STUDENT SECRET'), false);
    assert.equal(JSON.stringify(data).includes('GENERAL CLASS SECRET'), false);
    const report = progressReport(data);
    assert.deepEqual(report.totals, { present: 3, absent: 1, attendance: '75.0%', participation: 1,
      absenceDeductions: -1, combined: 0 });
    assert.ok(report.meetings.every(item => item.note === ''));
    assert.equal(progressReport(data, new Set([data.meetings[0].id])).meetings.filter(item => item.note).length, 1);
    const extended = progressReport(await snapshot(db, teacherA, workspace.id, student.id, group.id, '2026-08-01', '2026-09-14'));
    assert.equal(extended.meetings.length, 5);
    assert.equal(extended.meetings.at(-1).attendance, null);
    assert.equal(extended.totals.attendance, '75.0%');
    await assert.rejects(snapshot(db, teacherB, workspace.id, student.id, group.id), { code: 'TD003' });
    await assert.rejects(snapshot(db, null, workspace.id, student.id, group.id), { code: 'TD001' });
  } finally { await db.close(); }
});

test('empty attendance has an explicit label and Unicode multipage PDF uses bundled font', async () => {
  const report = progressReport({ teacher: { name: 'Учитель' }, student: { name: 'Иван Smith' },
    group: { name: 'Группа А', subject: 'Math' }, from: '2026-08-01', to: '2026-08-31', meetings: [] });
  assert.equal(report.totals.attendance, 'No recorded attendance');
  const long = 'Длинная заметка '.repeat(35);
  report.meetings = Array.from({ length: 45 }, (_, index) => ({ id: String(index), actual_date: '2026-08-04',
    lesson_type: 'Урок', status: 'Done', attendance: 'present', score: 1, note: long }));
  const font = (await readFile(new URL('../assets/DejaVuSans.ttf', import.meta.url))).toString('base64');
  const pdf = await createProgressReportPdf(report, font);
  assert.ok(pdf.internal.getNumberOfPages() > 1);
  assert.match(pdf.output(), /\/Type \/Page/);
});

test('history preview uses the month default and includes only selected student notes', async () => {
  const dom = new JSDOM('<div id="app"></div>');
  globalThis.document = dom.window.document;
  globalThis.window = dom.window;
  globalThis.FormData = dom.window.FormData;
  const $ = selector => dom.window.document.querySelector(selector);
  const settle = () => new Promise(resolve => setImmediate(resolve));
  const calls = [];
  const source = { teacher: { name: 'Учитель' }, student: { name: 'Иван' },
    group: { name: 'Math', subject: 'Algebra' }, from: '2026-09-01', to: '2026-09-28',
    meetings: [{ id: 'one', actual_date: '2026-09-14', lesson_type: null, status: null,
      attendance: 'present', participation: 1, note: 'Private note' }] };
  const access = {
    async listGroups() { return [{ id: 'g', name: 'Math', subject: 'Algebra', slots: [], archived: false }]; },
    async listStudents() { return { students: [{ id: 's', name: 'Иван' }],
      enrollments: [{ id: 'e', student_id: 's', group_id: 'g', starts_on: '2026-01-01' }] }; },
    async listMeetings() { return []; },
    async studentHistory() { return { items: [], nextOffset: null }; },
    async studentScoreTotals() { return { group: 0, overall: 0 }; },
    async studentProgressReport(...args) { calls.push(args); return source; }
  };
  const controller = createDashboardController({ access, render: element => $('#app').replaceChildren(element),
    now: () => new Date('2026-09-28T12:00:00Z') });
  controller.open({ id: 'w', timezone: 'UTC', display_name: 'Teacher' }, 'teacher');
  await settle(); await settle();
  $('[data-section="students"]').click(); await settle();
  $('[data-action="select-student-group"]').click();
  $('[data-action="history"]').click(); await settle(); await settle();
  $('[data-action="open-report"]').click();
  assert.equal($('[data-report-field="from"]').value, '2026-09-01');
  assert.equal($('[data-report-field="to"]').value, '2026-09-28');
  $('[data-action="preview-report"]').click(); await settle(); await settle();
  assert.deepEqual(calls[0], ['w', 's', 'g', '2026-09-01', '2026-09-28']);
  assert.match($('.dashboard-report-totals').textContent, /100.0%/);
  assert.doesNotMatch($('.dashboard-report').textContent, /Private note/);
  const note = $('[data-report-field="note"]'); note.checked = true;
  note.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  assert.match($('.dashboard-report').textContent, /Private note/);
  const originalFetch = globalThis.fetch;
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;
  const urls = [];
  const revoked = [];
  try {
    globalThis.fetch = async () => new Response(await readFile(new URL('../assets/DejaVuSans.ttf', import.meta.url)));
    URL.createObjectURL = blob => { urls.push(blob); return `blob:report-${urls.length}`; };
    URL.revokeObjectURL = url => revoked.push(url);
    $('[data-action="download-report"]').click();
    for (let attempt = 0; attempt < 30 && !$('a[download]'); attempt++) await settle();
    const link = $('a[download]');
    assert.ok(link, 'PDF preparation exposes a real download link');
    assert.equal(link.getAttribute('href'), 'blob:report-1');
    assert.equal(link.download, 'progress-report-2026-09-01-2026-09-28.pdf');
    assert.equal(urls[0].type, 'application/pdf');
    assert.ok(urls[0].size > 1000);
    const includedNote = $('[data-report-field="note"]'); includedNote.checked = false;
    includedNote.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    assert.equal($('a[download]'), null);
    assert.deepEqual(revoked, ['blob:report-1']);
  } finally {
    globalThis.fetch = originalFetch;
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
  }
  controller.close();
});
