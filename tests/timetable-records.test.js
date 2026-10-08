const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const sheets = {};
function sheet(name, data) {
  return sheets[name] = {
    data, getLastRow:()=>data.length, getLastColumn:()=>data[0].length,
    appendRow(row) { data.push(row); },
    getRange(r,c,h=1,w=1) { return {
      getDisplayValues:()=>Array.from({length:h},(_,i)=>Array.from({length:w},(_,j)=>String(data[r+i-1]?.[c+j-1]??''))),
      getValues:()=>Array.from({length:h},(_,i)=>Array.from({length:w},(_,j)=>data[r+i-1]?.[c+j-1]??'')),
      setValues(values) { values.forEach((row,i)=>{data[r+i-1]||=[];row.forEach((v,j)=>data[r+i-1][c+j-1]=v);}); }
    }; }
  };
}
const timetable = sheet('Timetable', [Array(10).fill('Header'),
  ['11A','11A','English',3,'08:50','09:35','Wednesday room',true,'',''],
  ['11A','11A','English',4,'09:40','10:25','Thursday room',true,'',''],
  ['9D','9D','English',1,'11:20','12:05','Archived room',false,'',''],
  ['9D','9D','English',2,'08:50','09:35','Tuesday room',true,'',JSON.stringify([{weekday:3,start:'08:00',end:'08:45',room:'Extra room'}])]
]);
sheet('LessonLogs',[Array(12).fill('Header')]);
sheet('AttendanceChecklists',[Array(5).fill('Header')]);
sheet('Students',[Array(4).fill('Header'),['student','Test student','','11A']]);
sheet('ClassStudents',[Array(6).fill('Header'),['11A','student','2026-01-01','',true,'']]);
sheet('StudentMeetingRecords',[Array(8).fill('Header')]);
const context=vm.createContext({
  DASHBOARD:{timetable:'Timetable',logs:'LessonLogs',checklists:'AttendanceChecklists',students:'Students',
    enrollments:'ClassStudents',studentRecords:'StudentMeetingRecords',archivedStudents:'ArchivedStudents',
    timetableHeaders:Array(10),logHeaders:Array(12),checklistHeaders:Array(5)},
  LockService:{getScriptLock:()=>({waitLock(){},releaseLock(){}})},
  Utilities:{getUuid:()=> 'revision'},
  SpreadsheetApp:{flush(){}},
  enrolledOn_:row=>String(row[4]).toLowerCase()!=='false'
});
for(const name of ['Sheets.gs','Validation.gs','ClassesAndLogs.gs','Attendance.gs']) {
  vm.runInContext(fs.readFileSync('AppsScript/'+name,'utf8'),context);
}
context.spreadsheet_=()=>({getSheetByName:name=>sheets[name]});
context.timestamp_=()=> 'now';
let saved=context.saveLog_({log:{classId:'11A',date:'2026-10-08',notes:'Thursday lesson'}});
assert.equal(saved.start,'09:40'); assert.equal(saved.end,'10:25'); assert.equal(saved.room,'Thursday room');
saved=context.saveLog_({log:{classId:'11A',date:'2026-10-07',notes:'Wednesday lesson'}});
assert.equal(saved.start,'08:50'); assert.equal(saved.room,'Wednesday room');
saved=context.saveLog_({log:{classId:'9D',date:'2026-10-07',notes:'Extra meeting'}});
assert.equal(saved.start,'08:00'); assert.equal(saved.room,'Extra room');
const checklist=context.saveChecklist_({checklist:{classId:'11A',date:'2026-10-08',records:[{
  studentId:'student',attendance:'present',participation:0,note:''
}]}});
assert.equal(checklist.checklist.classInfo.start,'09:40');
assert.equal(checklist.checklist.classInfo.room,'Thursday room');
// Timetable changes do not rewrite a recorded historical snapshot.
timetable.data[2][4]='10:30';timetable.data[2][5]='11:15';
saved=context.saveLog_({log:{classId:'11A',date:'2026-10-08',notes:'Updated note'}});
assert.equal(saved.start,'09:40');assert.equal(saved.notes,'Updated note');
console.log('Timetable record checks passed: repeated class IDs resolve the actual weekday for lesson and attendance saves, grouped extra meetings work, and historical snapshots remain intact.');
