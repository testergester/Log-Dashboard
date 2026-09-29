import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createDatabase, fixture, meetings, teacherA, teacherB, write } from './helpers/database.js';
import { createDashboardController } from '../src/dashboard.js';
import { draftKey } from '../src/drafts.js';

const move = (slot, date, destination, revision = 0, time = '11:00') => ({
  schedule_slot_id: slot.id, original_date: date, actual_date: destination,
  start_time: time, end_time: time === '11:00' ? '12:00' : '10:00', room: 'New room', expected_revision: revision
});
const code = async (promise, expected) => assert.rejects(promise, error => error.code === expected);

test('one occurrence moves across weeks and months, stays keyed to its source, then restores', async () => {
  const db = await createDatabase();
  try {
    const { workspace, slot } = await fixture(db);
    const moved = await write(db, teacherA, workspace.id, 'reschedule_meeting', move(slot, '2026-09-28', '2026-10-06'));
    assert.equal(moved.meeting.meeting_key, `${slot.id}:2026-09-28`);
    assert.equal(moved.meeting.revision, 1);
    const source = await meetings(db, teacherA, workspace.id, '2026-09-28', '2026-09-28');
    assert.deepEqual(source.map(item => item.is_marker), [true]);
    assert.equal(source[0].actual_date, '2026-10-06');
    const destination = await meetings(db, teacherA, workspace.id, '2026-10-06', '2026-10-06');
    assert.equal(destination.length, 1);
    assert.equal(destination[0].meeting_key, moved.meeting.meeting_key);
    assert.equal(destination[0].is_marker, false);
    assert.equal((await meetings(db, teacherA, workspace.id, '2026-10-05', '2026-10-05')).length, 1);
    await code(write(db, teacherB, workspace.id, 'restore_meeting', {
      schedule_slot_id: slot.id, original_date: '2026-09-28', expected_revision: 1
    }), 'TD003');
    const restored = await write(db, teacherA, workspace.id, 'restore_meeting', {
      schedule_slot_id: slot.id, original_date: '2026-09-28', expected_revision: 1
    });
    assert.equal(restored.meeting.revision, 0);
    assert.equal(restored.meeting.id, null);
    assert.equal((await meetings(db, teacherA, workspace.id, '2026-09-28', '2026-09-28'))[0].is_marker, false);
    assert.equal((await meetings(db, teacherA, workspace.id, '2026-10-06', '2026-10-06')).length, 0);
  } finally { await db.close(); }
});

test('conflicts, revisions, saved records, and retries guard schedule changes', async () => {
  const db = await createDatabase();
  try {
    const { workspace, slot } = await fixture(db);
    const ws = workspace.id;
    await code(write(db, teacherA, ws, 'reschedule_meeting', move(slot, '2026-09-28', '2026-10-05', 0, '09:00')), 'TD006');
    assert.equal((await meetings(db, teacherA, ws, '2026-09-28', '2026-09-28'))[0].id, null);
    const payload = move(slot, '2026-09-28', '2026-10-06');
    const operation = crypto.randomUUID();
    const first = await write(db, teacherA, ws, 'reschedule_meeting', payload, operation);
    assert.deepEqual(await write(db, teacherA, ws, 'reschedule_meeting', payload, operation), first);
    await code(write(db, teacherA, ws, 'reschedule_meeting', payload), 'TD004');
    await write(db, teacherA, ws, 'save_lesson_record', {
      schedule_slot_id: slot.id, original_date: '2026-09-28', expected_revision: 0, notes: ''
    });
    await code(write(db, teacherA, ws, 'restore_meeting', {
      schedule_slot_id: slot.id, original_date: '2026-09-28', expected_revision: 1
    }), 'TD008');
    await code(write(db, teacherA, ws, 'reschedule_meeting', move(slot, '2026-09-28', '2026-10-07', 1)), 'TD008');
    const saved = await meetings(db, teacherA, ws, '2026-10-06', '2026-10-06');
    assert.equal(saved[0].meeting_key, first.meeting.meeting_key);
    assert.equal(saved[0].actual_date, '2026-10-06');
  } finally { await db.close(); }
});

test('attendance-only saves block moves, while same-day changes remain one occurrence', async () => {
  const db = await createDatabase();
  try {
    const { workspace, slot, student } = await fixture(db);
    const ws = workspace.id;
    const change = await write(db, teacherA, ws, 'reschedule_meeting', move(slot, '2026-09-28', '2026-09-28'));
    assert.equal((await meetings(db, teacherA, ws, '2026-09-28', '2026-09-28')).length, 1);
    await write(db, teacherA, ws, 'save_attendance', { schedule_slot_id: slot.id,
      original_date: '2026-09-28', expected_revision: 0,
      entries: [{ student_id: student.id, attendance: 'present', participation: 0, note: '' }] });
    await code(write(db, teacherA, ws, 'restore_meeting', {
      schedule_slot_id: slot.id, original_date: '2026-09-28', expected_revision: change.meeting.revision
    }), 'TD008');
  } finally { await db.close(); }
});

test('restoring checks conflicts with a meeting moved into the source date', async () => {
  const db = await createDatabase();
  try {
    const { workspace, slot, group } = await fixture(db);
    const ws = workspace.id;
    const tuesday = await write(db, teacherA, ws, 'save_schedule_slot', {
      group_id: group.id, weekday: 2, start_time: '09:00', end_time: '10:00',
      effective_from: '2026-01-01', expected_revision: 0
    });
    await write(db, teacherA, ws, 'reschedule_meeting', move(slot, '2026-09-28', '2026-10-06'));
    await write(db, teacherA, ws, 'reschedule_meeting', move(tuesday, '2026-09-29', '2026-09-28', 0, '09:00'));
    await code(write(db, teacherA, ws, 'restore_meeting', {
      schedule_slot_id: slot.id, original_date: '2026-09-28', expected_revision: 1
    }), 'TD006');
    const source = await meetings(db, teacherA, ws, '2026-09-28', '2026-09-28');
    assert.equal(source.filter(item => !item.is_marker).length, 1);
    assert.equal(source.filter(item => item.is_marker).length, 1);
  } finally { await db.close(); }
});

test('a recurring edit cannot overlap a moved-in meeting from its own slot', async () => {
  const db = await createDatabase();
  try {
    const { workspace, slot, group } = await fixture(db);
    const ws = workspace.id;
    await write(db, teacherA, ws, 'reschedule_meeting', move(slot, '2026-09-28', '2026-10-05'));
    await code(write(db, teacherA, ws, 'save_schedule_slot', {
      id: slot.id, group_id: group.id, weekday: 1, start_time: '11:00', end_time: '12:00',
      effective_from: '2026-10-05', expected_revision: 1
    }), 'TD006');
    const recurring = await meetings(db, teacherA, ws, '2026-10-05', '2026-10-05');
    assert.equal(recurring.filter(item => !item.is_marker).length, 2);
    assert.equal(recurring.find(item => item.original_date === '2026-10-05').start_time, '09:00:00');
    await write(db, teacherA, ws, 'save_schedule_slot', {
      id: slot.id, group_id: group.id, weekday: 1, start_time: '12:00', end_time: '13:00',
      effective_from: '2026-10-05', expected_revision: 1
    });
  } finally { await db.close(); }
});

const settle = () => new Promise(resolve => setTimeout(resolve, 0));
test('preview needs confirmation and the source marker navigates without adding to counts', async () => {
  const dom = new JSDOM('<div id="app"></div>');
  globalThis.document = dom.window.document; globalThis.window = dom.window; globalThis.FormData = dom.window.FormData;
  const original = { id: null, schedule_slot_id: 'slot', group_id: 'group', meeting_key: 'slot:2026-09-28',
    original_date: '2026-09-28', actual_date: '2026-09-28', group_name: 'Math', subject: 'Math',
    start_time: '09:00:00', end_time: '10:00:00', room: '101', revision: 0 };
  let current = original; const calls = [];
  const access = {
    async listGroups() { return [{ id: 'group', name: 'Math', subject: 'Math', slots: [{ id: 'slot', versions: [
      { effective_from: '2026-01-01', effective_to: null, start_time: '09:00', end_time: '10:00', room: '101' }] }] }]; },
    async listStudents() { return { students: [], enrollments: [] }; },
    async listMeetings(_ws, from, to) {
      if (current.is_rescheduled) return [
        ...(current.original_date >= from && current.original_date <= to ? [{ ...current, is_marker: true }] : []),
        ...(current.actual_date >= from && current.actual_date <= to ? [current] : [])
      ];
      return current.original_date >= from && current.original_date <= to ? [current] : [];
    },
    async meetingDetails() { return { lesson: null, attendance: null, roster: [], previousNotes: [] }; },
    async save(action, _ws, payload) { calls.push({ action, payload }); current = { ...current, ...payload,
      actual_date: action === 'restore_meeting' ? original.original_date : payload.actual_date,
      is_rescheduled: action !== 'restore_meeting', revision: action === 'restore_meeting' ? 0 : 1,
      id: action === 'restore_meeting' ? null : 'moved' };
      return { meeting: current, previous_date: original.original_date };
    }
  };
  const controller = createDashboardController({ access, render: node => dom.window.document.querySelector('#app').replaceChildren(node),
    now: () => new Date('2026-09-28T12:00:00Z') });
  const $ = selector => dom.window.document.querySelector(selector);
  controller.open({ id: 'workspace', owner_id: 'teacher', timezone: 'UTC' });
  await settle(); await settle(); $('[data-action="meeting"]').click(); await settle(); await settle();
  $('[data-action="open-reschedule"]').click();
  const form = $('[data-form="reschedule"]');
  form.querySelector('[name="actual_date"]').value = '2026-10-06';
  form.querySelector('[name="start_time"]').value = '11:00';
  form.querySelector('[name="end_time"]').value = '12:00';
  form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  await settle(); await settle();
  assert.equal(calls.length, 0);
  assert.match($('.dashboard-schedule-preview').textContent, /Oct 6/);
  $('[data-action="confirm-schedule-change"]').click(); await settle(); await settle(); await settle();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].action, 'reschedule_meeting');
  const previous = $('[data-action="previous"]');
  for (let n = 0; n < 8; n++) { previous.click(); await settle(); await settle(); }
  assert.equal($('[data-action="moved-marker"]')?.dataset.key, original.meeting_key);
  assert.match($('[data-date="2026-09-28"] small').textContent, /0 meetings/);
  $('[data-action="moved-marker"]').click(); await settle(); await settle();
  assert.match($('.dashboard-records h3').textContent, /October 6/);
});

test('confirmed cross-week move keeps other destination meetings before reconciliation finishes', async () => {
  const dom = new JSDOM('<div id="app"></div>');
  globalThis.document = dom.window.document; globalThis.window = dom.window; globalThis.FormData = dom.window.FormData;
  const original = { id: null, schedule_slot_id: 'slot', group_id: 'group', meeting_key: 'slot:2026-09-28',
    original_date: '2026-09-28', actual_date: '2026-09-28', group_name: 'Source', subject: 'Math',
    start_time: '09:00:00', end_time: '10:00:00', room: 'A', revision: 0 };
  const other = { ...original, schedule_slot_id: 'other', meeting_key: 'other:2026-10-06',
    original_date: '2026-10-06', actual_date: '2026-10-06', group_name: 'Other', start_time: '14:00:00', end_time: '15:00:00' };
  let destinationReads = 0;
  const access = {
    async listGroups() { return []; }, async listStudents() { return { students: [], enrollments: [] }; },
    async listMeetings(_ws, from) {
      if (from === '2026-09-28') return [original];
      destinationReads++;
      return destinationReads === 1 ? [other] : new Promise(() => {});
    },
    async meetingDetails() { return { lesson: null, attendance: null, roster: [], previousNotes: [] }; },
    async save(_action, _ws, payload) { return { meeting: { ...original, ...payload, id: 'override', revision: 1,
      is_rescheduled: true, meeting_key: original.meeting_key, group_name: original.group_name, subject: original.subject } }; }
  };
  const controller = createDashboardController({ access, render: node => dom.window.document.querySelector('#app').replaceChildren(node),
    now: () => new Date('2026-09-28T12:00:00Z') });
  const $ = selector => dom.window.document.querySelector(selector);
  controller.open({ id: 'workspace', owner_id: 'teacher', timezone: 'UTC' });
  await settle(); await settle(); $('[data-action="meeting"]').click(); await settle(); await settle();
  $('[data-action="open-reschedule"]').click();
  const form = $('[data-form="reschedule"]');
  form.querySelector('[name="actual_date"]').value = '2026-10-06';
  form.querySelector('[name="start_time"]').value = '11:00';
  form.querySelector('[name="end_time"]').value = '12:00';
  form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  await settle(); await settle();
  $('[data-action="confirm-schedule-change"]').click(); await settle(); await settle();
  assert.equal(destinationReads, 2);
  assert.match($('[data-date="2026-10-06"] small').textContent, /2 meetings/);
  assert.deepEqual([...dom.window.document.querySelectorAll('[data-action="meeting"]')].map(item => item.textContent.includes('Other')),
    [false, true]);
});

test('moved attendance draft keeps its original key and requires roster reconciliation', async () => {
  const dom = new JSDOM('<div id="app"></div>');
  globalThis.document = dom.window.document; globalThis.window = dom.window; globalThis.FormData = dom.window.FormData;
  const meeting = { id: 'override', schedule_slot_id: 'slot', group_id: 'group', meeting_key: 'slot:2026-09-28',
    original_date: '2026-09-28', actual_date: '2026-10-06', group_name: 'Math', subject: 'Math',
    start_time: '11:00:00', end_time: '12:00:00', room: '102', revision: 1, is_rescheduled: true };
  const key = draftKey('teacher', 'workspace', meeting.meeting_key, 'attendance');
  const records = new Map([[key, { key, userId: 'teacher', workspaceId: 'workspace', meetingKey: meeting.meeting_key,
    recordType: 'attendance', schemaVersion: 1, version: 1, baseRevision: 0,
    values: { 'old:attendance': 'absent', 'old:participation': '0', 'old:note': 'Away' } }]]);
  const drafts = { tabId: 'tab', subscribe() { return () => {}; }, async get(id) { return records.get(id) || null; },
    async put(entry) { records.set(entry.key, { ...entry, schemaVersion: 1 }); return records.get(entry.key); },
    async deleteVersion(id) { records.delete(id); return true; } };
  let saves = 0;
  const access = { async listGroups() { return []; }, async listStudents() { return { students: [
    { id: 'old', name: 'Old student' }, { id: 'new', name: 'New student' }], enrollments: [] }; },
    async listMeetings() { return [meeting]; }, async meetingDetails() { return { lesson: null, attendance: null,
      previousNotes: [], roster: [{ student_id: 'new', student_name: 'New student', attendance: 'present', participation: 0, note: '' }] }; },
    async save() { saves++; return {}; } };
  const controller = createDashboardController({ access, drafts, render: node => dom.window.document.querySelector('#app').replaceChildren(node),
    now: () => new Date('2026-10-06T12:00:00Z') });
  const $ = selector => dom.window.document.querySelector(selector);
  controller.open({ id: 'workspace', owner_id: 'teacher', timezone: 'UTC' }, 'teacher');
  await settle(); await settle(); $('[data-action="meeting"]').click(); await settle(); await settle();
  assert.match($('[data-form="attendance"] .dashboard-draft-choice').textContent, /Added: New student/);
  assert.match($('[data-form="attendance"] .dashboard-draft-choice').textContent, /Removed: Old student/);
  assert.equal($('[data-form="attendance"] button[type="submit"]').disabled, true);
  $('[data-form="attendance"]').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  await settle(); assert.equal(saves, 0);
  $('[data-action="reconcile-roster"]').click(); await settle(); await settle();
  assert.deepEqual(Object.keys(records.get(key).values).sort(), ['new:attendance', 'new:note', 'new:participation']);
  assert.equal(records.get(key).version, 2);
  assert.equal($('[data-form="attendance"] button[type="submit"]').disabled, false);
});
