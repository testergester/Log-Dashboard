const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function sheet(data) {
  return {
    data, getLastRow: () => data.length, getLastColumn: () => data[0].length,
    getMaxRows: () => 100,
    appendRow(row) { data.push(row); },
    deleteRow(row) { data.splice(row - 1, 1); },
    getRange(r, c, h = 1, w = 1) {
      return {
        getDisplayValues: () => Array.from({length: h}, (_, i) =>
          Array.from({length: w}, (_, j) => String(data[r + i - 1]?.[c + j - 1] ?? ''))),
        setNumberFormat() { return this; },
        setDataValidation(rule) { assert.equal(rule, 'checkbox'); return this; }
      };
    }
  };
}
function fixture() {
  const sheets = {
    Students: sheet([['Student ID', 'Name', 'Updated at', 'Official Group ID']]),
    ClassStudents: sheet([['Class ID', 'Student ID', 'Joined on', 'Left on', 'Active', 'Updated at']]),
    Timetable: sheet([['Class ID', 'Name', 'Subject', 'Day', 'Start', 'End', 'Room', 'Active'], ['home'], ['guest'], ['past'], ['closed', '', '', '', '', '', '', false]]),
    ArchivedStudents: sheet([['Student ID', 'Full name', 'Previous groups JSON', 'Student IDs JSON', 'Removed on', 'Official Group ID', 'Recover']])
  };
  const spreadsheet = {getSheetByName: name => sheets[name]};
  let alert = '', locked = false;
  const context = vm.createContext({
    DASHBOARD: {students: 'Students', enrollments: 'ClassStudents', timetable: 'Timetable',
      archivedStudents: 'ArchivedStudents', archivedStudentHeaders: sheets.ArchivedStudents.data[0], enrollmentHeaders: Array(6)},
    SpreadsheetApp: {flush() {}, getUi: () => ({alert(text) { alert = text; }}),
      newDataValidation: () => ({requireCheckbox() { return this; }, build: () => 'checkbox'})},
    LockService: {getScriptLock: () => ({waitLock() { locked = true; }, releaseLock() { locked = false; }})},
    timestamp_: () => 'now', Utilities: {formatDate: () => '2026-10-06'}, ensureTab_: () => {}
  });
  for (const file of ['Sheets.gs', 'Students.gs'])
    vm.runInContext(fs.readFileSync('AppsScript/' + file, 'utf8'), context);
  context.spreadsheet_ = () => spreadsheet;
  context.ensureTab_ = () => {};
  return {sheets, context, alert: () => alert, locked: () => locked};
}
function archived(id, checked = true, official = 'home', groups) {
  return [id, 'Same name', JSON.stringify(groups || [
    {groupId: 'home', roles: ['official', 'enrolled']},
    {groupId: 'guest', roles: ['enrolled', 'attendance']},
    {groupId: 'past', roles: ['attendance']}
  ]), JSON.stringify([id]), '2026-09-30', official, checked];
}
{
  const f = fixture();
  f.sheets.ArchivedStudents.data.push(archived('one'), archived('two', 'TRUE'), archived('unchecked', false));
  f.context.ensureArchivedStudents_(f.context.spreadsheet_());
  assert.equal(f.sheets.ArchivedStudents.data[1][6], true, 'setup preserves selection');
  f.context.recoverArchivedStudents();
  assert.deepEqual(f.sheets.Students.data.slice(1).map(row => row[0]).sort(), ['one', 'two']);
  assert.ok(f.sheets.Students.data.slice(1).every(row => row[3] === 'home'));
  assert.equal(f.sheets.ClassStudents.data.length, 5);
  assert.ok(f.sheets.ClassStudents.data.slice(1).every(row =>
    ['home', 'guest'].includes(row[0]) && row[2] === '2026-10-06' && row[4] === true));
  assert.equal(f.sheets.ArchivedStudents.data[1][0], 'unchecked');
  f.context.recoverArchivedStudents();
  assert.equal(f.sheets.Students.data.length, 3, 'repeat does not duplicate');
  assert.equal(f.locked(), false);
}
{
  const f = fixture();
  f.sheets.Students.data.push(['duplicate', 'Existing', '', 'home']);
  f.sheets.ClassStudents.data.push(['home', 'orphan']);
  const invalid = archived('invalid'); invalid[2] = '{broken';
  f.sheets.ArchivedStudents.data.push(archived('duplicate'), archived('orphan'), invalid,
    archived('missing', true, 'missing'), archived('closed', true, 'closed'));
  f.context.recoverArchivedStudents();
  assert.equal(f.sheets.ArchivedStudents.data.length, 6);
  assert.ok(f.sheets.ArchivedStudents.data.slice(1).every(row => row[6] === true));
  assert.equal(f.sheets.Students.data.length, 2);
  assert.match(f.alert(), /5 students left checked/);
  assert.match(f.alert(), /invalid Previous groups JSON/);
  assert.match(f.alert(), /missing or archived classes/);
}
{
  const f = fixture();
  f.sheets.ArchivedStudents.data.push(archived('retry'));
  const append = f.sheets.ClassStudents.appendRow;
  f.sheets.ClassStudents.appendRow = row => { if (row[0] === 'guest') throw Error('Write failed'); append(row); };
  assert.throws(() => f.context.recoverArchivedStudents(), /Write failed/);
  assert.equal(f.sheets.Students.data.length, 1);
  assert.equal(f.sheets.ClassStudents.data.length, 1);
  assert.equal(f.sheets.ArchivedStudents.data.length, 2);
  assert.equal(f.locked(), false);
  f.sheets.ClassStudents.appendRow = append;
  f.context.recoverArchivedStudents();
  assert.equal(f.sheets.Students.data.length, 2);
  assert.equal(f.sheets.ArchivedStudents.data.length, 1);
}
console.log('Student recovery, selections, conflicts and rollback checks passed.');
