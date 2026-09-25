const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const {JSDOM} = require('jsdom');
const backend = name => fs.readFileSync(path.join(root, 'AppsScript', name), 'utf8');

for (const name of fs.readdirSync(path.join(root, 'AppsScript')).filter(name => name.endsWith('.gs'))) {
  new vm.Script(backend(name), {filename: name});
}

async function frontend(storedEndpoint = '') {
  const dom = new JSDOM(fs.readFileSync(path.join(root, 'index.html'), 'utf8'), {
    url: 'http://localhost/', runScripts: 'outside-only'
  });
  const context = dom.getInternalVMContext();
  const window = dom.window;
  if (storedEndpoint) window.localStorage.setItem('teaching-dashboard-endpoint', storedEndpoint);
  vm.runInContext(fs.readFileSync(path.join(root, 'public/config.js'), 'utf8'), context);
  window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  window.HTMLDialogElement.prototype.close = function () { this.open = false; };
  window.HTMLElement.prototype.scrollIntoView = function () {};
  const addEventListener = window.EventTarget.prototype.addEventListener;
  window.EventTarget.prototype.addEventListener = function (type, handler, options) {
    this.handlers ||= {};
    this.handlers[type] = handler;
    return addEventListener.call(this, type, handler, options);
  };
  const modules = new Map();
  function getModule(filename) {
    if (!modules.has(filename)) modules.set(filename, new vm.SourceTextModule(
      fs.readFileSync(filename, 'utf8'), {context, identifier: filename}
    ));
    return modules.get(filename);
  }
  const main = getModule(path.join(root, 'src/main.js'));
  await main.link((specifier, parent) => getModule(path.resolve(path.dirname(parent.identifier), specifier)));
  await main.evaluate();
  // Expose module exports only to the test VM; production uses explicit imports.
  for (const module of modules.values()) Object.assign(window, module.namespace);
  const element = selector => window.document.querySelector(selector);
  element('input[name="rating"][value="4"]').checked = true;
  element('input[name="lesson-type"][value="Lesson"]').checked = true;
  element('input[name="lesson-record-status"][value="Done"]').checked = true;
  return {context, element, window};
}

async function testFrontend() {
  const custom = 'https://script.google.com/macros/s/custom/exec';
  const {context, element} = await frontend(custom);
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
  context.dataAccess.saveLog = fields => {

    submitted = fields.log;
    return new Promise(resolve => { finish = resolve; });
  };
  context.dataAccess.load = () => { loads++; throw new Error('An unnecessary reload occurred'); };
  element('#lesson-form').hidden = false;
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
  const {context, element} = await frontend();
  vm.runInContext(`
    state.token = 'test';
    state.studentsReady = true;
    state.selectedDate = '2026-09-24';
    state.selectedClassId = 'class1';
    state.students = [{id: 's1', name: 'Student'}];
    state.checklists = [{classId: 'class1', date: '2026-09-24', revision: 'revision-1', updatedAt: 'earlier'}];
    state.studentRecords = [{classId: 'class1', date: '2026-09-24', studentId: 's1', attendance: 'present', participation: 0, note: ''}];
  `, context);
  element('#student-panel').hidden = false;
  element('#student-list').innerHTML = '<div class="student-row" data-student-id="s1" data-attendance="present" data-participation="1"><textarea class="student-note"></textarea></div>';
  const row = element('#student-list .student-row');
  let finish;
  let sent;
  context.dataAccess.saveChecklist = fields => {
    sent = fields.checklist;
    return new Promise(resolve => { finish = resolve; });
  };

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

async function testLoginTimetableAndHistory() {
  const {context, element} = await frontend();
  assert.equal(context.state.endpoint, context.TEACHING_DASHBOARD_CONFIG.appsScriptEndpoint);
  context.state.selectedDate = '2026-09-24';
  let loads = 0;
  context.dataAccess.login = async fields => {
    assert.equal(fields.username, 'teacher');
    assert.equal(fields.password, 'password');
    return {token: 'signed-in', expiresAt: Date.now() + 10000};
  };
  context.dataAccess.load = async fields => {
    loads++;
    assert.equal(fields.token, 'signed-in');
    return {
      classes: [{id: 'class1', name: 'Math group', subject: 'Math', weekday: 4, start: '9:00', end: '10:00', active: true}],
      logs: [{classId: 'class1', date: '2026-09-17', notes: 'Previous topic', lessonType: 'Quiz', rating: 4}],
      students: [{id: 's1', name: 'Student'}],
      enrollments: [{classId: 'class1', studentId: 's1', active: true, joinedOn: '2026-09-01'}],
      checklists: [],
      studentRecords: [
        {classId: 'class1', date: '2026-09-17', studentId: 's1', attendance: 'present', participation: 1, note: 'Good work'},
        {classId: 'class1', date: '2026-09-10', studentId: 's1', attendance: 'absent', participation: 0, note: ''}
      ]
    };
  };
  element('#username-input').value = ' teacher ';
  element('#password-input').value = 'password';
  await element('#login-form').handlers.submit({preventDefault() {}});
  assert.equal(context.state.token, 'signed-in');
  assert.equal(element('#workspace').hidden, false);
  assert.equal(element('#password-input').value, '');
  assert.equal(context.state.classes[0].start, '09:00');
  assert.match(element('#schedule-list').textContent, /Math group/);
  element('#week-view-button').handlers.click();
  assert.equal(element('#schedule-list .week-grid').getAttribute('role'), 'grid');
  element('#schedule-list .week-class-button').handlers.click();
  assert.equal(element('#group-view').hidden, false);
  assert.match(element('#previous-notes-list').textContent, /Previous topic/);
  assert.equal(element('#student-list .student-row').dataset.attendance, 'present');
  assert.equal(context.state.checklists.length, 0);
  context.openStudentHistory('s1');
  assert.equal(element('#history-dialog').open, true);
  assert.match(element('#student-totals').textContent, /This class: 0 points · Overall: 0 points/);
  assert.match(element('#student-history').textContent, /Good work/);
  assert.match(element('#student-history').textContent, /Absent −1/);
  assert.equal(loads, 1);
}

async function testFailedSavesAndExpiredSession() {
  const {context, element} = await frontend();
  Object.assign(context.state, {token: 'expired', selectedClassId: 'class1', selectedDate: '2026-09-24', studentsReady: true});
  element('#lesson-form').hidden = false;
  element('#lesson-notes').value = 'Keep my note';
  context.dataAccess.saveLog = async () => { throw new Error('Session expired'); };
  await element('#lesson-form').handlers.submit({preventDefault() {}});
  assert.equal(context.state.token, '');
  assert.equal(element('#workspace').hidden, true);
  assert.match(element('#access-error').textContent, /session expired/);
  assert.equal(context.state.drafts.get(context.draftKey()).notes, 'Keep my note');
  assert.equal(context.state.logs.length, 0);

  Object.assign(context.state, {token: 'valid', studentsReady: true});
  element('#student-panel').hidden = false;
  element('#student-list').innerHTML = '<div class="student-row" data-student-id="s1" data-attendance="absent" data-participation="0"><textarea class="student-note">Keep attendance</textarea></div>';
  context.state.checklists = [{classId: 'class1', date: '2026-09-24', revision: 'original'}];
  context.dataAccess.saveChecklist = async () => { throw new Error('Checklist changed on another device'); };
  await element('#checklist-form').handlers.submit({preventDefault() {}});
  assert.equal(context.state.checklists[0].revision, 'original');
  assert.equal(context.state.checklistDrafts.get(context.checklistKey())[0].note, 'Keep attendance');
  assert.match(element('#checklist-status').textContent, /changed on another device/);
  assert.equal(context.state.pending, false);
}

(async () => {
  testSessionExpiry();
  testChecklistConflict();
  testReadDoesNotWrite();
  await testLoginTimetableAndHistory();
  await testFailedSavesAndExpiredSession();
  await testFrontend();
  await testChecklistFrontend();
  console.log('Regression checks passed: sessions, conflicting attendance, read-only load, saved edits, endpoint, and no post-save reload.');
})().catch(error => { console.error(error); process.exitCode = 1; });
