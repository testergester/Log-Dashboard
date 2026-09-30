const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const sheets = {};
function sheet(name, data) {
  return sheets[name] = {
    data, getLastRow: () => data.length, getLastColumn: () => data[0].length,
    getRange(r, c, h = 1, w = 1) {
      return {
        getDisplayValues: () => Array.from({length: h}, (_, i) => Array.from({length: w}, (_, j) => String(data[r+i-1]?.[c+j-1] ?? ''))),
        getValues: () => Array.from({length: h}, (_, i) => Array.from({length: w}, (_, j) => data[r+i-1]?.[c+j-1] ?? '')),
        setValues(values) { values.forEach((row, i) => { data[r+i-1] ||= []; row.forEach((v,j) => data[r+i-1][c+j-1] = v); }); },
        copyTo(target) { target.setValues(this.getValues()); },
        insertCheckboxes() { this.setValues([[false]]); }
      };
    }, deleteRow(r) { data.splice(r-1, 1); }
  };
}
const headers = ['Class ID','Lesson date','Class name','Subject','Start time','End time','Room','Notes','Rating','Updated at','Lesson type','Lesson status','Extra'];
const row = ['A','2026-09-16','Group A','Math','09:00','10:00','1','Good',3,'old','Lesson','Done','preserved'];
const logs = sheet('LessonLogs', [headers, [...row]]);
const archive = sheet('ArchivedLessonLogs', [headers.concat(['Archive reason','Archived at','Recover'])]);
let locked = false;
const spreadsheet = {getSheetByName: name => sheets[name]};
const ctx = vm.createContext({
  DASHBOARD: {logs:'LessonLogs', archivedLogs:'ArchivedLessonLogs', timezone:'Asia/Tashkent'},
  spreadsheet_: () => spreadsheet, ensureTab_: () => {}, timestamp_: () => 'new',
  text_: (value, label, max, required) => { const s = String(value ?? '').trim(); if ((required && !s) || s.length > max) throw Error(label); return s; },
  date_: value => value, time_: value => value,
  SpreadsheetApp: {flush() {}, getUi: () => ({alert() {}})},
  LockService: {getScriptLock: () => ({waitLock() {locked=true;}, releaseLock() {locked=false;}})}
});
for (const name of ['Sheets.gs','ClassesAndLogs.gs']) vm.runInContext(fs.readFileSync('AppsScript/'+name,'utf8'),ctx);
ctx.spreadsheet_ = () => spreadsheet;
ctx.ensureTab_ = () => {};
assert.throws(() => ctx.archiveLog_({classId:'A',date:row[1],reason:' '}));
assert.equal(logs.data.length,2);
ctx.archiveLog_({classId:'A',date:row[1],reason:'Wrong lesson'});
assert.equal(logs.data.length,1);
assert.deepEqual(archive.data[1].slice(0,13),row);
assert.equal(archive.data[1][13],'Wrong lesson');
archive.data[1][15]=true;
logs.data.push([...row]);
ctx.recoverArchivedLessonLogs();
assert.equal(archive.data.length,2, 'duplicates stay archived');
logs.data.pop();
ctx.recoverArchivedLessonLogs();
assert.equal(archive.data.length,1);
assert.deepEqual(logs.data[1],row);
const edit = {classId:'A',date:row[1],className:'Group A',subject:'Math',start:'09:00',end:'10:00',room:'2',notes:'Changed',rating:5,updatedAt:'old',lessonType:'Quiz',lessonStatus:'Late'};
ctx.editLog_({log:edit});
assert.equal(logs.data[1][7],'Changed');
assert.equal(logs.data[1][12],'preserved');
assert.throws(() => ctx.editLog_({log:edit}), /changed elsewhere/);
assert.equal(locked,false);
console.log('Lesson archive, recovery, conflict and edit checks passed.');
