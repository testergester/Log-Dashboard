const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function fixture() {
  const events = [];
  function sheet(name, data, maxRows = 100) {
    return {
      data, maxRows,
      getLastRow: () => data.length,
      getLastColumn: () => data[0].length,
      getMaxRows() { return this.maxRows; },
      insertRowsAfter(row, count) { assert.equal(row, this.maxRows); this.maxRows += count; },
      deleteRow(row) { events.push('delete:' + name); data.splice(row - 1, 1); },
      getRange(r, c, h = 1, w = 1) {
        return {
          getValues: () => Array.from({length: h}, (_, i) =>
            Array.from({length: w}, (_, j) => data[r + i - 1]?.[c + j - 1] ?? '')),
          getDisplayValues() { return this.getValues().map(row => row.map(String)); },
          setValues(values) {
            events.push('write:' + name);
            values.forEach((row, i) => {
              data[r + i - 1] ||= [];
              row.forEach((value, j) => { data[r + i - 1][c + j - 1] = value; });
            });
          },
          setNumberFormat() { return this; },
          setDataValidation() { return this; }
        };
      }
    };
  }
  const id = 'ST-11B-12345678';
  const sheets = {
    Students: sheet('Students', [['Student ID', 'Name', 'Updated at', 'Official Group ID'], [id, 'First student', '', '11B']]),
    ClassStudents: sheet('ClassStudents', [['Class ID', 'Student ID', 'Joined on', 'Left on', 'Active', 'Updated at'],
      ['11B', id, '2026-09-01', '', true, '']]),
    ArchivedStudents: sheet('ArchivedStudents', [['Student ID', 'Full name', 'Previous groups JSON', 'Student IDs JSON', 'Removed on', 'Official Group ID', 'Recover']]),
    AttendanceChecklists: sheet('AttendanceChecklists', [['Class ID', 'Lesson date', 'Revision', 'Updated at', 'Checklist JSON']]),
    StudentMeetingRecords: sheet('StudentMeetingRecords', [['Class ID', 'Lesson date', 'Revision', 'Student ID']])
  };
  let locked = false;
  const context = vm.createContext({
    DASHBOARD: {students: 'Students', archivedStudents: 'ArchivedStudents', enrollments: 'ClassStudents',
      checklists: 'AttendanceChecklists', studentRecords: 'StudentMeetingRecords', studentHeaders: Array(4),
      archivedStudentHeaders: sheets.ArchivedStudents.data[0]},
    LockService: {getScriptLock: () => ({waitLock() { locked = true; }, releaseLock() { locked = false; }})},
    SpreadsheetApp: {flush() { events.push('flush'); },
      newDataValidation: () => ({requireCheckbox() { return this; }, build() { return {}; }})},
    Utilities: {formatDate: () => '2026-10-14'},
    parseChecklistJson_: value => JSON.parse(value),
    loadDashboard_: () => ({students: sheets.Students.data.slice(1), archivedStudents: sheets.ArchivedStudents.data.slice(1)})
  });
  for (const name of ['Sheets.gs', 'Students.gs']) vm.runInContext(fs.readFileSync('AppsScript/' + name, 'utf8'), context);
  context.spreadsheet_ = () => ({getSheetByName: name => sheets[name]});
  context.ensureTab_ = () => {};
  return {id, sheets, context, events, locked: () => locked};
}

function expectBlocked(f, pattern) {
  const before = JSON.stringify(Object.fromEntries(Object.entries(f.sheets).map(([name, sheet]) => [name, sheet.data])));
  assert.throws(() => f.context.archiveStudent_({studentId: f.id}), pattern);
  assert.equal(JSON.stringify(Object.fromEntries(Object.entries(f.sheets).map(([name, sheet]) => [name, sheet.data]))), before);
  assert.equal(f.locked(), false);
  assert.ok(!f.events.some(event => event.startsWith('delete:')));
}

for (const whitespace of ['', ' ']) {
  const f = fixture();
  f.sheets.Students.data.push([whitespace + f.id, 'Second student', '', '11B']);
  expectBlocked(f, /duplicate IDs/);
}
for (const alias of [false, true]) {
  const f = fixture();
  f.sheets.ArchivedStudents.data.push([alias ? 'older-id' : f.id, 'Previously archived', '[]',
    JSON.stringify(alias ? [f.id] : []), '2026-09-20', '11B', true]);
  expectBlocked(f, /already exists in ArchivedStudents/);
}
{
  const f = fixture();
  f.sheets.Students.data[1][0] = ' ' + f.id;
  expectBlocked(f, /extra spaces/);
}
{
  const f = fixture();
  f.sheets.ArchivedStudents.data.push(['other-id', 'Other', '[]', '{}', '', '11B', false]);
  expectBlocked(f, /invalid Student IDs JSON/);
}
{
  const f = fixture();
  // Reproduce a sheet whose empty Recover checkboxes contain FALSE.
  for (let row = 2; row <= 100; row++) f.sheets.ArchivedStudents.data.push(['', '', '', '', '', '', false]);
  f.context.archiveStudent_({studentId: f.id});
  assert.equal(f.sheets.ArchivedStudents.data[1][0], f.id, 'archive starts at row 2, not 101');
  assert.equal(f.sheets.ArchivedStudents.data.filter(row => row[0]).length, 2);
  assert.equal(f.sheets.Students.data.length, 1);
  assert.equal(f.sheets.ClassStudents.data.length, 1);
  assert.ok(f.events.indexOf('flush') < f.events.indexOf('delete:ClassStudents'));
  assert.equal(f.locked(), false);
}
{
  const f = fixture();
  f.sheets.ArchivedStudents.maxRows = 1;
  f.context.archiveStudent_({studentId: f.id});
  assert.equal(f.sheets.ArchivedStudents.maxRows, 2);
  assert.equal(f.sheets.ArchivedStudents.data[1][0], f.id);
}
{
  const f = fixture();
  f.sheets.ArchivedStudents.data.push(['older', 'Older', '[]', '["older"]', '2026-09-20', '11B', true]);
  f.sheets.ArchivedStudents.maxRows = 2;
  f.context.archiveStudent_({studentId: f.id});
  assert.equal(f.sheets.ArchivedStudents.maxRows, 3);
  assert.equal(f.sheets.ArchivedStudents.data[1][6], true, 'existing Recover selection survives');
  assert.equal(f.sheets.ArchivedStudents.data[2][0], f.id);
}
for (const failure of ['write', 'flush', 'readback']) {
  const f = fixture();
  const getRange = f.sheets.ArchivedStudents.getRange;
  f.sheets.ArchivedStudents.getRange = function(...args) {
    const range = getRange.apply(this, args);
    if (args[0] === 2 && args[1] === 1 && args[3] === 7 && failure === 'write') {
      range.setValues = () => { throw Error('Archive write failed'); };
    }
    if (args[0] === 2 && args[1] === 1 && args[3] === 6 && failure === 'readback') {
      range.getDisplayValues = () => [['wrong', '', '', '', '', '']];
    }
    return range;
  };
  if (failure === 'flush') f.context.SpreadsheetApp.flush = () => { throw Error('Flush failed'); };
  assert.throws(() => f.context.archiveStudent_({studentId: f.id}), /failed|could not be verified/);
  assert.equal(f.sheets.Students.data.length, 2, 'source student retained');
  assert.equal(f.sheets.ClassStudents.data.length, 2, 'membership retained');
  assert.ok(!f.events.some(event => event.startsWith('delete:')));
  assert.equal(f.locked(), false);
}
{
  const f = fixture();
  const history = {records: [{studentId: f.id, studentName: 'First student'}]};
  f.sheets.AttendanceChecklists.data.push(['11B', '2026-09-01', 'rev', '', JSON.stringify(history)]);
  const before = JSON.stringify(f.sheets.AttendanceChecklists.data);
  f.context.archiveStudent_({studentId: f.id});
  const nextId = 'ST-11B-87654321';
  f.sheets.Students.data.push([nextId, 'First student', '', '11B']);
  f.sheets.ClassStudents.data.push(['11B', nextId, '', '', true, '']);
  f.context.archiveStudent_({studentId: nextId});
  assert.deepEqual(f.sheets.ArchivedStudents.data.slice(1).map(row => row[0]), [f.id, nextId]);
  assert.equal(JSON.stringify(f.sheets.AttendanceChecklists.data), before, 'saved attendance remains intact');
}
// Check the local deployment export when it is available; it is not tracked in Git.
const exportedStudents = 'AppsScript-update-2026-10-13/Students.gs';
if (fs.existsSync(exportedStudents)) {
  assert.equal(fs.readFileSync('AppsScript/Students.gs', 'utf8'), fs.readFileSync(exportedStudents, 'utf8'));
}
console.log('Student archive safety passed: conflicts, 11B IDs, checkbox placement, sheet growth, write failures and attendance preservation.');
