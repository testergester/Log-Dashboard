import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createDashboardController } from '../src/dashboard.js';
import { createDraftStore, draftKey } from '../src/drafts.js';
import { createAuthController } from '../src/auth.js';
import { createTabIdentity } from '../src/tab-identity.js';

const meeting = { id: null, meeting_key: 'slot:2026-09-28', schedule_slot_id: 'slot', original_date: '2026-09-28',
  actual_date: '2026-09-28', group_id: 'group', group_name: 'Group', subject: 'Math', start_time: '09:00', end_time: '10:00' };
const wait = () => new Promise(resolve => setTimeout(resolve, 0));
async function settle() { await wait(); await wait(); await wait(); }

function memoryDrafts() {
  const records = new Map();
  return {
    tabId: 'tab-a', records,
    subscribe() { return () => {}; },
    async get(key) { return structuredClone(records.get(key) || null); },
    async put(entry) { const saved = { ...structuredClone(entry), schemaVersion: 1, tabId: 'tab-a', leaseUntil: Date.now() + 15000 }; records.set(entry.key, saved); return saved; },
    async deleteVersion(key, version) { if (records.get(key)?.version === version) { records.delete(key); return true; } return false; },
    async listForAccount(userId) { return [...records.values()].filter(entry => entry.userId === userId); },
    async clearAccount(userId) { for (const [key, entry] of records) if (entry.userId === userId) records.delete(key); }
  };
}

function harness(drafts, overrides = {}) {
  const dom = new JSDOM('<div id="app"></div>');
  globalThis.document = dom.window.document;
  globalThis.window = dom.window;
  globalThis.FormData = dom.window.FormData;
  const calls = [];
  const access = {
    async listGroups() { return [{ id: 'group', name: 'Group', subject: 'Math', archived: false, slots: [], revision: 1 }]; },
    async listStudents() { return { students: [{ id: 'student', name: 'Sam', revision: 1 }],
      enrollments: [{ id: 'enrollment', group_id: 'group', student_id: 'student', starts_on: '2026-01-01', ends_on: null, revision: 1 }] }; },
    async listMeetings() { return [meeting]; },
    async meetingDetails() { return { lesson: null, attendance: null, previousNotes: [], roster: [
      { student_id: 'student', student_name: 'Sam', attendance: 'present', participation: 0, note: '' }] }; },
    async save(action, workspace, payload) { calls.push({ action, workspace, payload }); return { meeting: { ...meeting, id: 'saved' },
      record: { ...payload, revision: 1 }, checklist: { revision: 1 }, entries: payload.entries || [] }; }
  };
  Object.assign(access, overrides);
  const controller = createDashboardController({ access, drafts, render: node => dom.window.document.querySelector('#app').replaceChildren(node),
    now: () => new Date('2026-09-28T12:00:00Z') });
  const $ = selector => dom.window.document.querySelector(selector);
  const open = async (user = 'teacher-a') => { controller.open({ id: 'workspace', owner_id: user, timezone: 'UTC' }, user); await settle(); $('[data-action="meeting"]').click(); await settle(); };
  const edit = (selector, value, event = 'input') => { const field = $(selector); field.value = value; field.dispatchEvent(new dom.window.Event(event, { bubbles: true })); };
  const submit = selector => $(selector).dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  return { dom, controller, calls, $, open, edit, submit };
}

test('refresh restores lesson fields only for the same teacher and never saves an untouched roster', async () => {
  const drafts = memoryDrafts();
  const first = harness(drafts); await first.open();
  first.edit('[data-form="lesson"] [name="notes"]', 'Unfinished');
  first.edit('[data-form="lesson"] [name="rating"]', '4', 'change');
  first.edit('[data-form="attendance"] [name="attendance"]', 'absent', 'change');
  await first.controller.flush();
  assert.equal(first.calls.length, 0);
  assert.equal(drafts.records.size, 2);
  const restored = harness(drafts); await restored.open();
  assert.equal(restored.$('[data-form="lesson"] [name="notes"]').value, 'Unfinished');
  assert.equal(restored.$('[data-form="lesson"] [name="rating"]').value, '4');
  assert.equal(restored.$('[data-form="attendance"] [name="attendance"]').value, 'absent');
  assert.match(restored.$('[data-form="lesson"] .dashboard-save-status').textContent, /Saved on this device/);
  const other = harness(drafts); await other.open('teacher-b');
  assert.equal(other.$('[data-form="lesson"] [name="notes"]').value, '');
  assert.equal(other.$('[data-form="attendance"] [name="attendance"]').value, 'present');
});

test('reloading meeting details before the debounce fires keeps the visible draft', async () => {
  const drafts = memoryDrafts(); const h = harness(drafts); await h.open();
  h.edit('[data-form="lesson"] [name="notes"]', 'Typed just before reload');
  await h.controller.refresh(); await settle();
  assert.equal(h.$('[data-form="lesson"] [name="notes"]').value, 'Typed just before reload');
  assert.equal([...drafts.records.values()][0].values.notes, 'Typed just before reload');
});

test('account save clears only its local version and leaves edits made in flight', async () => {
  const drafts = memoryDrafts(); let finish;
  const h = harness(drafts, { save: () => new Promise(resolve => { finish = resolve; }) }); await h.open();
  h.edit('[data-form="lesson"] [name="notes"]', 'First');
  h.submit('[data-form="lesson"]'); await settle();
  h.edit('[data-form="lesson"] [name="notes"]', 'Second');
  finish({ meeting: { ...meeting, id: 'saved' }, record: { notes: 'First', revision: 1, lesson_type: 'Lesson', status: 'Done' } });
  await settle(); await h.controller.flush(); await settle();
  const key = draftKey('teacher-a', 'workspace', meeting.meeting_key, 'lesson');
  assert.equal(drafts.records.get(key).values.notes, 'Second');
  assert.equal(drafts.records.get(key).baseRevision, 1);
  assert.equal(h.$('[data-form="lesson"] [name="notes"]').value, 'Second');
});

test('editing attendance during a lesson save does not keep the submitted lesson draft', async () => {
  const drafts = memoryDrafts(); let finish;
  const h = harness(drafts, { save: () => new Promise(resolve => { finish = resolve; }) }); await h.open();
  h.edit('[data-form="lesson"] [name="notes"]', 'Saved lesson');
  h.submit('[data-form="lesson"]'); await settle();
  h.edit('[data-form="attendance"] [name="note"]', 'Still editing');
  finish({ meeting: { ...meeting, id: 'saved' }, record: { notes: 'Saved lesson', revision: 1, lesson_type: 'Lesson', status: 'Done' } });
  await settle(); await h.controller.flush(); await settle();
  assert.equal(drafts.records.has(draftKey('teacher-a', 'workspace', meeting.meeting_key, 'lesson')), false);
  assert.equal(drafts.records.get(draftKey('teacher-a', 'workspace', meeting.meeting_key, 'attendance')).values['student:note'], 'Still editing');
});

test('restored revision conflict requires a choice before account save', async () => {
  const drafts = memoryDrafts();
  const key = draftKey('teacher-a', 'workspace', meeting.meeting_key, 'lesson');
  drafts.records.set(key, { key, userId: 'teacher-a', workspaceId: 'workspace', meetingKey: meeting.meeting_key,
    recordType: 'lesson', schemaVersion: 1, tabId: 'tab-a', version: 2, baseRevision: 0,
    values: { notes: 'Local', rating: '', lesson_type: 'Lesson', custom_lesson_type: '', status: 'Done' } });
  const h = harness(drafts, { async meetingDetails() { return { lesson: { revision: 3, notes: 'Account', lesson_type: 'Lesson', status: 'Done' },
    attendance: null, previousNotes: [], roster: [] }; } });
  await h.open();
  assert.equal(h.$('[data-form="lesson"] button[type="submit"]').disabled, true);
  assert.match(h.$('.dashboard-draft-choice').textContent, /Local/);
  assert.match(h.$('.dashboard-draft-choice').textContent, /Account/);
  assert.match(h.$('.dashboard-draft-choice').textContent, /Rating:/);
  assert.match(h.$('.dashboard-draft-choice').textContent, /Lesson type:/);
  assert.match(h.$('.dashboard-draft-choice').textContent, /Status:/);
  h.$('[data-action="keep-draft"]').click(); await settle();
  assert.equal(h.$('[data-form="lesson"] button[type="submit"]').disabled, false);
  assert.equal(drafts.records.get(key).baseRevision, 3);
});

test('failed account save keeps the draft and offers Retry', async () => {
  const drafts = memoryDrafts();
  const h = harness(drafts, { async save() { throw new Error('offline'); } }); await h.open();
  h.edit('[data-form="lesson"] [name="notes"]', 'Keep me');
  h.submit('[data-form="lesson"]'); await settle();
  const key = draftKey('teacher-a', 'workspace', meeting.meeting_key, 'lesson');
  assert.equal(drafts.records.get(key).values.notes, 'Keep me');
  assert.match(h.$('[data-form="lesson"] .dashboard-save-status').textContent, /Save failed/);
  assert.ok(h.$('[data-action="retry-draft"]'));
  const restored = harness(drafts); await restored.open();
  assert.match(restored.$('[data-form="lesson"] .dashboard-save-status').textContent, /Save failed/);
  assert.ok(restored.$('[data-action="retry-draft"]'));
});

test('discarding refuses to hide a draft that changed before deletion', async () => {
  const drafts = memoryDrafts();
  const key = draftKey('teacher-a', 'workspace', meeting.meeting_key, 'lesson');
  drafts.records.set(key, { key, userId: 'teacher-a', workspaceId: 'workspace', meetingKey: meeting.meeting_key,
    recordType: 'lesson', schemaVersion: 1, tabId: 'tab-a', version: 2, baseRevision: 0,
    values: { notes: 'Local', rating: '', lesson_type: 'Lesson', custom_lesson_type: '', status: 'Done' } });
  drafts.deleteVersion = async () => false;
  const h = harness(drafts, { async meetingDetails() { return { lesson: { revision: 3, notes: 'Account', lesson_type: 'Lesson', status: 'Done' },
    attendance: null, previousNotes: [], roster: [] }; } });
  await h.open(); h.$('[data-action="discard-draft"]').click(); await settle();
  assert.equal(h.$('[data-form="lesson"] [name="notes"]').value, 'Local');
  assert.ok(h.$('[data-action="discard-draft"]'));
});

test('another tab owns the draft until explicit takeover', async () => {
  const drafts = memoryDrafts();
  const key = draftKey('teacher-a', 'workspace', meeting.meeting_key, 'lesson');
  drafts.records.set(key, { key, userId: 'teacher-a', workspaceId: 'workspace', meetingKey: meeting.meeting_key,
    recordType: 'lesson', schemaVersion: 1, tabId: 'tab-b', leaseUntil: Date.now() + 15000,
    version: 1, baseRevision: 0, values: { notes: 'Other tab', rating: '', lesson_type: 'Lesson', custom_lesson_type: '', status: 'Done' } });
  const h = harness(drafts); await h.open();
  assert.equal(h.$('[data-form="lesson"] button[type="submit"]').disabled, true);
  assert.ok(h.$('[data-action="takeover-draft"]'));
  h.$('[data-action="takeover-draft"]').click(); await settle();
  assert.equal(h.$('[data-form="lesson"] button[type="submit"]').disabled, false);
  assert.equal(drafts.records.get(key).tabId, 'tab-a');
});

test('unavailable device storage never displays a saved claim', async () => {
  const drafts = memoryDrafts();
  drafts.put = async () => { throw new Error('QuotaExceededError'); };
  const h = harness(drafts); await h.open();
  h.edit('[data-form="lesson"] [name="notes"]', 'Unsaved');
  await h.controller.flush();
  assert.match(h.$('[data-form="lesson"] .dashboard-save-status').textContent, /not saved/);
  assert.equal(drafts.records.size, 0);
});

test('a synchronous pending journal survives reload when IndexedDB cannot open', async () => {
  const entries = new Map();
  const storage = { getItem: key => entries.get(key) || null, setItem: (key, value) => entries.set(key, value),
    removeItem: key => entries.delete(key), key: index => [...entries.keys()][index] || null,
    get length() { return entries.size; } };
  const key = draftKey('teacher-a', 'workspace', meeting.meeting_key, 'lesson');
  const first = createDraftStore({ indexedDB: null, BroadcastChannel: null, sessionStorage: storage, tabId: 'tab-a' });
  assert.equal(first.stage({ key, userId: 'teacher-a', workspaceId: 'workspace', meetingKey: meeting.meeting_key,
    recordType: 'lesson', version: 1, baseRevision: 0, values: { notes: 'Just typed' } }), true);
  const reopened = createDraftStore({ indexedDB: null, BroadcastChannel: null, sessionStorage: storage, tabId: 'tab-a' });
  assert.equal((await reopened.get(key)).values.notes, 'Just typed');
  await assert.rejects(reopened.clearAccount('teacher-a'));
  assert.equal(entries.size, 0);
});

test('confirmed sign-out clears pending journals in other tabs', async () => {
  const storage = () => {
    const entries = new Map();
    return { getItem: key => entries.get(key) || null, setItem: (key, value) => entries.set(key, value),
      removeItem: key => entries.delete(key), key: index => [...entries.keys()][index] || null,
      get length() { return entries.size; } };
  };
  const firstStorage = storage(); const secondStorage = storage();
  const first = createDraftStore({ indexedDB: null, BroadcastChannel, sessionStorage: firstStorage, tabId: 'signout-a' });
  const second = createDraftStore({ indexedDB: null, BroadcastChannel, sessionStorage: secondStorage, tabId: 'signout-b' });
  const draft = { key: draftKey('teacher-a', 'workspace', meeting.meeting_key, 'lesson'), userId: 'teacher-a',
    workspaceId: 'workspace', meetingKey: meeting.meeting_key, recordType: 'lesson', version: 1, baseRevision: 0, values: { notes: 'Pending' } };
  try {
    assert.equal(first.stage(draft), true); assert.equal(second.stage(draft), true);
    await assert.rejects(first.clearAccount('teacher-a'));
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(firstStorage.length, 0); assert.equal(secondStorage.length, 0);
    assert.equal(second.stage(draft), false);
    await assert.rejects(second.put(draft), /ACCOUNT_SIGNED_OUT/);
  } finally { first.close(); second.close(); }
});

test('explicit sign-out can be cancelled and clears only after successful sign-out', async () => {
  let approved = false; let signedOut = 0; let cleared = 0;
  const user = { id: 'teacher-a', email: 'teacher@example.com', email_confirmed_at: '2026-01-01' };
  const access = {
    subscribe() { return () => {}; }, async session() { return { user }; }, async user() { return user; },
    async workspace() { return { id: 'workspace', owner_id: user.id }; }, async hasSchedules() { return false; },
    async signOut() { signedOut++; }
  };
  const controller = createAuthController({ access, render() {}, location: new URL('https://example.test/'), history: { replaceState() {} },
    beforeSignOut: async () => approved, afterSignOut: async () => { cleared++; } });
  await controller.start();
  await controller.signOut();
  assert.equal(signedOut, 0); assert.equal(cleared, 0);
  approved = true; await controller.signOut();
  assert.equal(signedOut, 1); assert.equal(cleared, 1);
});

test('another tab can finish a confirmed discard without prompting again', async () => {
  let prompts = 0; let signedOut = 0;
  const user = { id: 'teacher-a', email: 'teacher@example.com', email_confirmed_at: '2026-01-01' };
  const access = {
    subscribe() { return () => {}; }, async session() { return { user }; }, async user() { return user; },
    async workspace() { return { id: 'workspace', owner_id: user.id }; }, async hasSchedules() { return false; },
    async signOut() { signedOut++; }
  };
  const controller = createAuthController({ access, render() {}, location: new URL('https://example.test/'), history: { replaceState() {} },
    beforeSignOut: async () => { prompts++; return false; } });
  await controller.start();
  await controller.signOut({ skipDraftPrompt: true });
  assert.equal(prompts, 0);
  assert.equal(signedOut, 1);
  assert.equal(controller.state.phase, 'signed-out');
});

test('a copied tab session gets a distinct active tab identity', async () => {
  const memory = initial => {
    const data = new Map(initial);
    return { getItem: key => data.get(key) || null, setItem: (key, value) => data.set(key, value), entries: () => [...data] };
  };
  const firstStorage = memory();
  const first = await createTabIdentity({ storage: firstStorage, BroadcastChannel, waitMs: 30 });
  try {
    const copiedStorage = memory(firstStorage.entries());
    const second = await createTabIdentity({ storage: copiedStorage, BroadcastChannel, waitMs: 30, navigationType: 'reload' });
    try { assert.notEqual(first.id, second.id); }
    finally { second.close(); }
  } finally { first.close(); }
});
