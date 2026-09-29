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
  assert.equal(vm.runInContext('state.view', context), 'week');
  const hues = vm.runInContext(`groupHuesFor([
    {id: 'B', active: true}, {id: 'A', active: true},
    {id: 'A', active: true}, {id: 'C', active: false}
  ])`, context);
  assert.equal(hues.size, 2);
  assert.notEqual(hues.get('A'), hues.get('B'));
  assert.equal(hues.get('A'), vm.runInContext("groupHuesFor([{id: 'A', active: true}, {id: 'B', active: true}]).get('A')", context));
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

function testStudentIds() {
  const students = [];
  const classRows = [['8 E']];
  const studentSheet = {
    rows: students,
    appendRow(row) { students.push(row); },
    getRange(row, column) { return {
      getDisplayValue: () => students[row - 2][column - 1],
      setValues(values) { values[0].forEach((value, index) => { students[row - 2][column - 1 + index] = value; }); }
    }; }
  };
  const classSheet = {rows: classRows};
  const spreadsheet = {getSheetByName: name => name === 'Students' ? studentSheet : classSheet};
  const uuids = ['0000000001', '0000000001', '0000000002'];
  const context = vm.createContext({
    String, Set, parseInt,
    DASHBOARD: {students: 'Students', timetable: 'Timetable'},
    Utilities: {getUuid: () => uuids.shift()},
    LockService: {getScriptLock: () => ({waitLock() {}, releaseLock() {}})},
    spreadsheet_: () => spreadsheet,
    rows_: sheet => sheet.rows,
    findRow_: (sheet, match) => { const index = sheet.rows.findIndex(match); return index < 0 ? 0 : index + 2; },
    text_: value => String(value).trim(), timestamp_: () => 'now'
  });
  vm.runInContext(backend('Students.gs'), context);
  context.setEnrollmentRow_ = (sheet, classId, studentId) => ({classId, studentId, active: true});
  const first = context.saveStudent_({student: {name: 'First', classId: '8 E'}}).student;
  const second = context.saveStudent_({student: {name: 'Second', classId: '8 E'}}).student;
  assert.equal(first.id, 'ST-8-E-00000001');
  assert.equal(second.id, 'ST-8-E-00000002');
  assert.equal(first.officialGroupId, '8 E');
  const renamed = context.saveStudent_({student: {id: first.id, name: 'Renamed'}}).student;
  assert.equal(renamed.id, first.id);
  assert.equal(renamed.officialGroupId, '8 E');
}

function testArchiveStudent() {
  const sheet = rows => ({
    rows,
    deleteRow(row) { rows.splice(row - 1, 1); },
    appendRow(row) { rows.push(row); },
    getRange(row, column, height = 1, width = 1) { return {
      getDisplayValues() { return Array.from({length: height}, (_, offset) =>
        rows[row - 1 + offset].slice(column - 1, column - 1 + width)); },
      setValues(values) { values.forEach((cells, offset) => cells.forEach((value, index) => {
        rows[row - 1 + offset][column - 1 + index] = value;
      })); }
    }; }
  });
  const payload = (classId, records) => ({schemaVersion: 1, classId, lessonDate: '2026-09-24',
    revision: 'old-' + classId, updatedAt: 'earlier', classInfo: {id: classId}, records});
  const record = studentId => ({studentId, studentName: studentId, attendance: 'present', participation: 0, note: ''});
  const sheets = {
    Students: sheet([['ID', 'Name', 'Updated', 'Official Group'], ['student-a', 'A', '', 'home'], ['student-b', 'B', '', 'home']]),
    ArchivedStudents: sheet([['Student ID', 'Full name', 'Previous groups JSON', 'Student IDs JSON', 'Removed on', 'Official Group ID']]),
    ClassStudents: sheet([['Class', 'Student'], ['home', 'student-a'], ['guest', 'student-a'], ['home', 'student-b']]),
    StudentMeetingRecords: sheet([['Class', 'Date', 'Revision', 'Student'], ['old', '2026-09-20', 'r1', 'student-a'],
      ['old', '2026-09-20', 'r1', 'student-b'], ['old', '2026-09-19', 'r0', 'student-a']]),
    AttendanceChecklists: sheet([['Class', 'Date', 'Revision', 'Updated', 'JSON'],
      ['home', '2026-09-24', 'old-home', 'earlier', JSON.stringify(payload('home', [record('student-a'), record('student-b')]))],
      ['guest', '2026-09-24', 'old-guest', 'earlier', JSON.stringify(payload('guest', [record('student-a')]))],
      ['other', '2026-09-24', 'old-other', 'earlier', JSON.stringify(payload('other', [record('student-b')]))]])
  };
  const context = vm.createContext({
    String, JSON,
    DASHBOARD: {students: 'Students', archivedStudents: 'ArchivedStudents', studentHeaders: Array(4),
      archivedStudentHeaders: Array(6), enrollments: 'ClassStudents', studentRecords: 'StudentMeetingRecords',
      checklists: 'AttendanceChecklists'},
    LockService: {getScriptLock: () => ({waitLock() {}, releaseLock() {}})},
    spreadsheet_: () => ({getSheetByName: name => sheets[name]}),
    rows_: source => source.rows.slice(1).map(row => row.slice()),
    rowsWithDates_: source => source.rows.slice(1).map(row => row.slice()),
    findRow_: (source, match) => { const index = source.rows.slice(1).findIndex(match); return index < 0 ? 0 : index + 2; },
    parseChecklistJson_: value => JSON.parse(value),
    ensureTab_: () => {}, today_: () => '2026-09-30',
    loadDashboard_: () => ({students: sheets.Students.rows.slice(1), archivedStudents: sheets.ArchivedStudents.rows.slice(1)})
  });
  vm.runInContext(backend('Students.gs'), context);
  context.today_ = () => '2026-09-30';
  const result = context.archiveStudent_({studentId: 'student-a'});
  assert.equal(result.students.length, 1);
  assert.equal(sheets.Students.rows.length, 2);
  assert.equal(sheets.ClassStudents.rows.length, 2);
  assert.equal(sheets.StudentMeetingRecords.rows.length, 4);
  assert.deepEqual(JSON.parse(sheets.AttendanceChecklists.rows[1][4]).records.map(item => item.studentId), ['student-a', 'student-b']);
  assert.deepEqual(JSON.parse(sheets.AttendanceChecklists.rows[2][4]).records.map(item => item.studentId), ['student-a']);
  assert.equal(sheets.AttendanceChecklists.rows[1][2], 'old-home');
  assert.equal(sheets.AttendanceChecklists.rows[2][2], 'old-guest');
  assert.equal(sheets.AttendanceChecklists.rows[3][2], 'old-other');
  const archived = sheets.ArchivedStudents.rows[1];
  assert.equal(archived[0], 'student-a');
  assert.equal(archived[1], 'A');
  assert.deepEqual(JSON.parse(archived[3]), ['student-a']);
  assert.equal(archived[4], '2026-09-30');
  assert.equal(archived[5], 'home');
  const groups = JSON.parse(archived[2]);
  assert.deepEqual(groups.map(item => item.groupId), ['home', 'guest', 'old']);
  assert.deepEqual(groups[0].roles, ['official', 'enrolled', 'attendance']);
  assert.deepEqual(groups[1].roles, ['enrolled', 'attendance']);
  assert.throws(() => context.archiveStudent_({studentId: 'student-a'}), /no longer exists/);
}

function testMeetingGuests() {
  const {context} = frontend();
  vm.runInContext(`
    state.selectedClassId = '8E';
    state.selectedDate = '2026-09-24';
    state.students = [{id: 'home', name: 'Home', officialGroupId: '8E'},
      {id: 'guest', name: 'Guest', officialGroupId: '9A'}];
    state.enrollments = [{classId: '8E', studentId: 'home', joinedOn: '2026-09-01', leftOn: ''}];
    state.checklistDrafts.set(checklistKey(), [{studentId: 'home', attendance: 'present', participation: 0, note: ''},
      {studentId: 'guest', attendance: 'present', participation: 0, note: ''}]);
  `, context);
  assert.deepEqual(Array.from(vm.runInContext('checklistRows().map(item => item.studentId)', context)), ['guest', 'home']);
  vm.runInContext("state.selectedDate = '2026-09-25'", context);
  assert.deepEqual(Array.from(vm.runInContext('checklistRows().map(item => item.studentId)', context)), ['home']);
}

function testStudentIdMigration() {
  function sheet(rows) {
    return {rows, getRange(firstRow, firstColumn) { return {
      getDisplayValue: () => rows[firstRow - 1][firstColumn - 1],
      setValues(values) { values.forEach((value, offset) => value.forEach((cell, column) => {
        rows[firstRow - 1 + offset][firstColumn - 1 + column] = cell;
      })); }
    }; }};
  }
  const payload = {schemaVersion: 1, classId: '9A', lessonDate: '2026-09-20', revision: 'r1',
    classInfo: {id: '9A'}, records: [{studentId: 'old-a'}, {studentId: 'old-b'}]};
  const sheets = {
    Students: sheet([['Student ID', 'Name', 'Updated at', 'Official Group ID'],
      ['old-a', 'A', '', ''], ['old-b', 'B', '', '']]),
    ClassStudents: sheet([['Class ID', 'Student ID', 'Joined on', 'Left on', 'Active', 'Updated at'],
      ['8E', 'old-a', '2026-01-01', '', true, ''], ['9A', 'old-a', '2026-02-01', '', true, ''],
      ['9A', 'old-b', '2026-01-15', '', true, '']]),
    StudentMeetingRecords: sheet([['header'], ['9A', '2026-09-20', 'r1', 'old-a']]),
    AttendanceChecklists: sheet([['header'], ['9A', '2026-09-20', 'r1', '', JSON.stringify(payload)]]),
    Timetable: sheet([['header'], ['8E'], ['9A']])
  };
  const values = {};
  const props = {
    getProperty: key => values[key] || '',
    setProperty: (key, value) => { values[key] = value; },
    setProperties: items => Object.assign(values, items)
  };
  const spreadsheet = {getSheetByName: name => sheets[name], getId: () => 'sheet-id', getName: () => 'Dashboard'};
  let backups = 0;
  const uuids = ['0000000001', '0000000002'];
  const context = vm.createContext({
    String, Set, Object, JSON, parseInt,
    DASHBOARD: {students: 'Students', enrollments: 'ClassStudents', studentRecords: 'StudentMeetingRecords',
      checklists: 'AttendanceChecklists', timetable: 'Timetable'},
    Utilities: {getUuid: () => uuids.shift()},
    LockService: {getScriptLock: () => ({waitLock() {}, releaseLock() {}})},
    PropertiesService: {getScriptProperties: () => props},
    DriveApp: {getFileById: () => ({makeCopy() { backups++; return {getId: () => 'backup-id', getUrl: () => 'backup-url'}; }})},
    SpreadsheetApp: {flush() {}}, Logger: {log() {}},
    spreadsheet_: () => spreadsheet,
    rows_: source => source.rows.slice(1).map(row => row.slice()),
    rowsWithDates_: source => source.rows.slice(1).map(row => row.slice()),
    parseChecklistJson_: value => JSON.parse(value),
    today_: () => '2026-09-29', timestamp_: () => '2026-09-29 10:00:00'
  });
  vm.runInContext(backend('Students.gs'), context);
  vm.runInContext(backend('StudentIdMigration.gs'), context);
  context.today_ = () => '2026-09-29';
  context.migrateStudentIds();
  assert.equal(sheets.Students.rows[1][0], 'ST-8E-00000001');
  assert.equal(sheets.Students.rows[1][3], '8E');
  assert.equal(sheets.Students.rows[2][0], 'ST-9A-00000002');
  assert.equal(sheets.ClassStudents.rows[2][1], 'ST-8E-00000001');
  assert.equal(sheets.ClassStudents.rows[2][3], '2026-09-29');
  assert.equal(sheets.ClassStudents.rows[2][4], false);
  assert.equal(sheets.StudentMeetingRecords.rows[1][3], 'ST-8E-00000001');
  assert.equal(JSON.parse(sheets.AttendanceChecklists.rows[1][4]).records[1].studentId, 'ST-9A-00000002');
  assert.equal(values.STUDENT_ID_MIGRATION_STATUS, 'complete');
  context.migrateStudentIds();
  assert.equal(backups, 1);
}

function testGuestChecklistSave() {
  let savedRow;
  const classSheet = {getRange: () => ({getDisplayValues: () => [['8E', 'Group 8E', 'Math', '4', '09:00', '10:00', '', 'true']]})};
  const checklistSheet = {
    appendRow: row => { savedRow = row; },
    getRange: () => ({getDisplayValues: () => [savedRow], setValues: values => { savedRow = values[0]; }})
  };
  const spreadsheet = {getSheetByName: name => ({Timetable: classSheet,
    AttendanceChecklists: checklistSheet, ClassStudents: {}, Students: {}})[name]};
  const context = vm.createContext({
    String, Number, Set, Array, JSON,
    DASHBOARD: {timetable: 'Timetable', checklists: 'AttendanceChecklists', enrollments: 'ClassStudents',
      students: 'Students', timetableHeaders: Array(9), checklistHeaders: Array(5)},
    LockService: {getScriptLock: () => ({waitLock() {}, releaseLock() {}})},
    Utilities: {getUuid: () => 'revision-1'},
    spreadsheet_: () => spreadsheet,
    date_: value => value, jsonText_: value => value,
    findRow_: () => 2, findDateRows_: () => savedRow ? [2] : [],
    rowsWithDates_: () => [['8E', 'home', '2026-09-01', '', true]],
    rows_: () => [['home', 'Home'], ['guest', 'Guest']],
    enrolledOn_: (row, date) => row[2] <= date && (!row[3] || date < row[3]),
    timestamp_: () => 'now'
  });
  vm.runInContext(backend('Attendance.gs'), context);
  const saved = context.saveChecklist_({checklist: {classId: '8E', date: '2026-09-24', records: [
    {studentId: 'home', attendance: 'present', participation: 0, note: ''},
    {studentId: 'guest', attendance: 'present', participation: 0, note: ''}
  ]}});
  assert.equal(saved.checklist.records.length, 2);
  assert.equal(JSON.parse(savedRow[4]).records[1].studentId, 'guest');
  context.rowsWithDates_ = () => [];
  const corrected = context.saveChecklist_({checklist: {classId: '8E', date: '2026-09-24',
    revision: saved.revision, records: []}});
  assert.equal(corrected.checklist.records.length, 0);
}

function testArchivedStudentChecklistCorrection() {
  const previous = {schemaVersion: 1, classId: '8E', lessonDate: '2026-09-24', revision: 'old',
    updatedAt: 'earlier', classInfo: {id: '8E'}, records: [
      {studentId: 'archived', studentName: 'Archived Student', attendance: 'present', participation: 0, note: ''}]};
  let row = ['8E', '2026-09-24', 'old', 'earlier', JSON.stringify(previous)];
  const sheets = {
    Timetable: {getRange: () => ({getDisplayValues: () => [['8E', 'Group 8E', 'Math', '4', '09:00', '10:00', '', 'true']]})},
    AttendanceChecklists: {getRange: () => ({getDisplayValues: () => [row], setValues: values => { row = values[0]; }})},
    ClassStudents: {}, Students: {}, ArchivedStudents: {}
  };
  const context = vm.createContext({
    String, Number, Set, Array, JSON,
    DASHBOARD: {timetable: 'Timetable', checklists: 'AttendanceChecklists', enrollments: 'ClassStudents',
      students: 'Students', archivedStudents: 'ArchivedStudents', timetableHeaders: Array(9), checklistHeaders: Array(5)},
    LockService: {getScriptLock: () => ({waitLock() {}, releaseLock() {}})},
    Utilities: {getUuid: () => 'new'},
    spreadsheet_: () => ({getSheetByName: name => sheets[name]}),
    date_: value => value, jsonText_: value => value,
    findRow_: () => 2, findDateRows_: () => [2],
    rowsWithDates_: () => [],
    rows_: source => source === sheets.ArchivedStudents ? [['archived', 'Archived Student']] : [],
    enrolledOn_: () => false, timestamp_: () => 'now'
  });
  vm.runInContext(backend('Attendance.gs'), context);
  const saved = context.saveChecklist_({checklist: {classId: '8E', date: '2026-09-24', revision: 'old', records: [
    {studentId: 'archived', attendance: 'present', participation: 1, note: 'Corrected'}]}});
  assert.equal(saved.checklist.records[0].studentName, 'Archived Student');
  assert.equal(saved.checklist.records[0].note, 'Corrected');
  assert.equal(JSON.parse(row[4]).records[0].studentId, 'archived');
}

function testLegacyClassStudentFormulaRepair() {
  const formulas = [
    '=REGEXEXTRACT(B2,"^ST-(.*)-\\d+$")',
    '=REGEXEXTRACT(B3,"^ST-(.+)-[a-z0-9]{8}$")',
    ''
  ];
  const sheet = {
    getLastRow: () => 4,
    getRange(row) { return {
      getFormulas: () => formulas.map(value => [value]),
      setFormula(value) { formulas[row - 2] = value; }
    }; }
  };
  const context = vm.createContext({String, Number});
  vm.runInContext(backend('Sheets.gs'), context);
  assert.equal(context.repairLegacyClassStudentFormulas_(sheet), 1);
  assert.equal(formulas[0], '=REGEXEXTRACT(B2,"^ST-(.+)-[a-z0-9]{8}$")');
  assert.equal(formulas[1], '=REGEXEXTRACT(B3,"^ST-(.+)-[a-z0-9]{8}$")');
}

function testStudentSheetEdits() {
  function sheet(name, rows) {
    return {
      name, rows,
      getName() { return name; },
      getLastRow() { return rows.length; },
      getMaxRows() { return 1000; },
      getParent() { return spreadsheet; },
      insertRowsAfter() {},
      getRange(firstRow, firstColumn, count = 1, width = 1) { return {
        getDisplayValues: () => Array.from({length: count}, (_, offset) =>
          Array.from({length: width}, (_, column) => String(rows[firstRow - 1 + offset]?.[firstColumn - 1 + column] ?? ''))),
        getFormulas: () => Array.from({length: count}, () => ['']),
        setValues(values) { values.forEach((value, offset) => value.forEach((cell, column) => {
          const index = firstRow - 1 + offset;
          if (!rows[index]) rows[index] = [];
          rows[index][firstColumn - 1 + column] = cell;
        })); }
      }; }
    };
  }
  const students = sheet('Students', [
    ['Student ID', 'Name', 'Updated at', 'Official Group ID'],
    ['', 'Single edit', 'existing timestamp', '10B'],
    ['', 'Group entered later', '', ''],
    ['', 'Pasted student', '', '10B'],
    ['ST-10B-existing', 'Existing', 'earlier', '10B'],
    ['', 'Unknown group', '', '10C']
  ]);
  const timetable = sheet('Timetable', [['Class ID'], ['10B', '', '', '', '', '', '', true]]);
  const enrollments = sheet('ClassStudents', [['Class ID', 'Student ID', 'Joined on', 'Left on', 'Active', 'Updated at']]);
  const spreadsheet = {getSheetByName: name => ({Students: students, Timetable: timetable,
    ClassStudents: enrollments})[name]};
  const uuids = ['0000000001', '0000000002', '0000000003'];
  const context = vm.createContext({
    String, Set, parseInt,
    DASHBOARD: {students: 'Students', timetable: 'Timetable', enrollments: 'ClassStudents',
      studentHeaders: Array(4), enrollmentHeaders: Array(6)},
    LockService: {getScriptLock: () => ({waitLock() {}, releaseLock() {}})},
    Utilities: {getUuid: () => uuids.shift()},
    rows_: source => source.rows.slice(1).map(row => row.slice()),
    timestamp_: () => 'now'
  });
  vm.runInContext(backend('Students.gs'), context);
  vm.runInContext(backend('WeeklyView.gs'), context);
  context.today_ = () => '2026-09-29';
  const edit = (row, lastRow, column) => context.onEdit({source: spreadsheet, range: {
    getSheet: () => students, getRow: () => row, getLastRow: () => lastRow, getColumn: () => column
  }});
  edit(2, 6, 2);
  assert.equal(students.rows[1][0], 'ST-10B-00000001');
  assert.equal(students.rows[1][2], 'existing timestamp');
  assert.equal(students.rows[2][0], '');
  assert.equal(students.rows[3][0], 'ST-10B-00000002');
  assert.equal(students.rows[4][0], 'ST-10B-existing');
  assert.equal(students.rows[5][0], '');
  assert.equal(enrollments.rows.length, 3);
  students.rows[2][3] = '10B';
  edit(3, 3, 4);
  assert.equal(students.rows[2][0], 'ST-10B-00000003');
  edit(3, 3, 4);
  assert.equal(enrollments.rows.length, 4);
}

(async () => {
  testSessionExpiry();
  testChecklistConflict();
  testReadDoesNotWrite();
  testStudentIds();
  testArchiveStudent();
  testMeetingGuests();
  testStudentIdMigration();
  testGuestChecklistSave();
  testArchivedStudentChecklistCorrection();
  testLegacyClassStudentFormulaRepair();
  testStudentSheetEdits();
  await testFrontend();
  await testChecklistFrontend();
  console.log('Regression checks passed: sessions, attendance conflicts, student archiving, student IDs, sheet edits and pastes, guest meetings, migration, read-only load, and saved edits.');
})().catch(error => { console.error(error); process.exitCode = 1; });
