const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'script.js'), 'utf8');
const backend = name => fs.readFileSync(path.join(root, 'AppsScript', name), 'utf8');

for (const name of fs.readdirSync(path.join(root, 'AppsScript')).filter(name => name.endsWith('.gs'))) {
  new vm.Script(backend(name), {filename: name});
}
new vm.Script(source, {filename: 'script.js'});

function frontend(storedEndpoint = '') {
  const elements = new Map();
  const element = selector => {
    if (!elements.has(selector)) elements.set(selector, {
      value: '', hidden: false, textContent: '', disabled: false, handlers: {},
      classList: {add() {}, remove() {}, toggle() {}},
      addEventListener(type, handler) { this.handlers[type] = handler; }
    });
    return elements.get(selector);
  };
  const checked = {
    'input[name="rating"]:checked': {value: '4'},
    'input[name="lesson-type"]:checked': {value: 'Lesson'},
    'input[name="lesson-record-status"]:checked': {value: 'Done'}
  };
  const context = vm.createContext({
    Intl, Date, Map, Set, URL,
    localStorage: {getItem(key) { return key === 'teaching-dashboard-endpoint' ? storedEndpoint : ''; }, setItem() {}, removeItem() {}},
    document: {querySelector: selector => checked[selector] || element(selector), querySelectorAll: () => []}
  });
  vm.runInContext(source.replace(/restoreSession\(\);\s*$/, ''), context);
  return {context, element};
}

async function testFrontend() {
  const custom = 'https://script.google.com/macros/s/custom/exec';
  const {context, element} = frontend(custom);
  assert.equal(vm.runInContext('state.endpoint', context), custom);
  vm.runInContext(`
    state.token = 'test';
    state.selectedDate = '2026-09-24';
    state.selectedClassId = 'class1';
    state.classes = [{id: 'class1', name: 'Test class', subject: 'Math', weekday: 4,
      start: '09:00', end: '10:00', room: '', active: true}];
  `, context);
  element('#lesson-notes').value = 'Submitted note';
  let finish;
  let submitted;
  let loads = 0;
  context.request = (action, fields) => {
    if (action === 'load') { loads++; throw new Error('An unnecessary reload occurred'); }
    submitted = fields.log;
    return new Promise(resolve => { finish = resolve; });
  };
  context.render = () => context.renderLesson();
  const task = element('#lesson-form').handlers.submit({preventDefault() {}});
  element('#lesson-notes').value = 'New edit while saving';
  element('#lesson-notes').handlers.input();
  finish({...submitted, className: 'Test class', subject: 'Math', start: '09:00',
    end: '10:00', room: '', updatedAt: 'now'});
  await task;
  assert.equal(element('#lesson-notes').value, 'New edit while saving');
  assert.equal(vm.runInContext('state.drafts.get(draftKey()).notes', context), 'New edit while saving');
  assert.equal(vm.runInContext('state.logs[0].notes', context), 'Submitted note');
  assert.equal(loads, 0);
}

async function testChecklistFrontend() {
  const {context, element} = frontend();
  vm.runInContext(`
    state.token = 'test';
    state.studentsReady = true;
    state.selectedDate = '2026-09-24';
    state.selectedClassId = 'class1';
    state.students = [{id: 's1', name: 'Student'}];
    state.checklists = [{classId: 'class1', date: '2026-09-24', revision: 'revision-1', updatedAt: 'earlier'}];
    state.studentRecords = [{classId: 'class1', date: '2026-09-24', studentId: 's1', attendance: 'present', participation: 0, note: ''}];
  `, context);
  const row = {dataset: {studentId: 's1', attendance: 'present', participation: '1'},
    querySelector: () => ({value: ''})};
  element('#student-list').querySelectorAll = () => [row];
  element('#student-list').querySelector = () => row;
  let finish;
  let sent;
  context.request = (action, fields) => {
    assert.equal(action, 'saveChecklist');
    sent = fields.checklist;
    return new Promise(resolve => { finish = resolve; });
  };
  context.render = () => {};
  const task = element('#checklist-form').handlers.submit({preventDefault() {}});
  assert.equal(sent.revision, 'revision-1');
  row.dataset.participation = '-1';
  vm.runInContext('saveChecklistDraft()', context);
  finish({classId: 'class1', date: '2026-09-24', revision: 'revision-2', updatedAt: 'now',
    checklist: {classInfo: {id: 'class1'}, records: [{studentId: 's1', studentName: 'Student',
      attendance: 'present', participation: 1, note: ''}]}});
  await task;
  assert.equal(vm.runInContext('state.checklists[0].revision', context), 'revision-2');
  assert.equal(vm.runInContext('state.studentRecords[0].participation', context), 1);
  assert.equal(vm.runInContext('state.checklistDrafts.get(checklistKey())[0].participation', context), -1);
}

function testSessionExpiry() {
  const values = {OWNER_USERNAME: 'teacher', PASSWORD_HASH: 'hash', PASSWORD_SALT: 'salt'};
  const props = {
    getProperty: key => values[key] || null,
    setProperty: (key, value) => { values[key] = value; },
    deleteProperty: key => { delete values[key]; },
    getProperties: () => ({...values})
  };
  const context = vm.createContext({
    Date, Number, JSON, Object, String,
    DASHBOARD: {sessionLifetimeMs: 86400000, loginLimit: 5, loginBlockSeconds: 900},
    PropertiesService: {getScriptProperties: () => props},
    CacheService: {getScriptCache: () => ({get: () => null, put() {}, remove() {}})},
    LockService: {getScriptLock: () => ({waitLock() {}, releaseLock() {}})},
    Utilities: {getUuid: () => 'uuid'},
    hashPassword_: () => 'hash', constantTimeEqual_: (left, right) => left === right,
    sessionKey_: token => 'SESSION_' + token
  });
  vm.runInContext(backend('Auth.gs'), context);
  const login = context.login_({username: 'teacher', password: 'correct'});
  assert.ok(login.expiresAt > Date.now());
  context.requireSession_({token: login.token});
  assert.equal(JSON.parse(values['SESSION_' + login.token]).passwordHash, 'hash');
  values.SESSION_valid = JSON.stringify({passwordHash: 'hash', expiresAt: Date.now() + 10000});
  context.requireSession_({token: 'valid'});
  values.SESSION_expired = JSON.stringify({passwordHash: 'hash', expiresAt: Date.now() - 1});
  assert.throws(() => context.requireSession_({token: 'expired'}), /Session expired/);
  assert.equal(values.SESSION_expired, undefined);
  values.SESSION_old = 'hash';
  assert.throws(() => context.requireSession_({token: 'old'}), /Session expired/);
  context.logout_({token: login.token});
  assert.throws(() => context.requireSession_({token: login.token}), /Session expired/);
}

function testChecklistConflict() {
  const sheet = {getRange() { return {getDisplayValues: () => [['class1', '2026-09-24', 'new-revision', '', '']], getValue: () => true}; }};
  const context = vm.createContext({
    Date, Number, String, Set,
    DASHBOARD: {timetable: 'Timetable', checklists: 'AttendanceChecklists', timetableHeaders: Array(9), checklistHeaders: Array(5)},
    LockService: {getScriptLock: () => ({waitLock() {}, releaseLock() {}})},
    spreadsheet_: () => ({getSheetByName: () => sheet}),
    date_: value => value,
    jsonText_: value => value,
    findRow_: () => 2,
    findDateRows_: () => [2]
  });
  vm.runInContext(backend('Attendance.gs'), context);
  assert.throws(() => context.saveChecklist_({checklist: {
    classId: 'class1', date: '2026-09-24', revision: 'old-revision',
    records: [{studentId: 's1', attendance: 'present', participation: 0, note: ''}]
  }}), /changed on another device/);
}

function testReadDoesNotWrite() {
  const sheet = {getLastRow: () => 1};
  const context = vm.createContext({
    Number, Object, String,
    DASHBOARD: {timetable: 'Timetable', logs: 'LessonLogs', students: 'Students',
      enrollments: 'ClassStudents', checklists: 'AttendanceChecklists', studentRecords: 'StudentMeetingRecords', timezone: 'Asia/Tashkent'},
    spreadsheet_: () => ({getSheetByName: () => sheet}),
    rows_: () => [], rowsWithDates_: () => [],
    ensureDashboardTabs_: () => { throw new Error('Maintenance on read'); },
    normalizeTimetableTimes_: () => { throw new Error('Maintenance on read'); },
    sortTimetable_: () => { throw new Error('Maintenance on read'); },
    refreshWeeklyView_: () => { throw new Error('Maintenance on read'); }
  });
  vm.runInContext(backend('DashboardData.gs'), context);
  assert.equal(context.loadDashboard_().classes.length, 0);
}

(async () => {
  testSessionExpiry();
  testChecklistConflict();
  testReadDoesNotWrite();
  await testFrontend();
  await testChecklistFrontend();
  console.log('Regression checks passed: sessions, conflicting attendance, read-only load, saved edits, endpoint, and no post-save reload.');
})().catch(error => { console.error(error); process.exitCode = 1; });
