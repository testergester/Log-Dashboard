const assert = require('node:assert/strict');
const {build, summarize} = require('../analysis-model.js');
const data = {
  students:[{id:'a',name:'Alice'},{id:'b',name:'Bob'},{id:'c',name:'No records'}],
  archivedStudents:[{id:'d',ids:['old-d'],name:'Archived'}],
  enrollments:[{classId:'G1',studentId:'a'},{classId:'G1',studentId:'b'},{classId:'G1',studentId:'c',joinedOn:'2026-09-01'}, {classId:'G2',studentId:'a'}],
  studentRecords:[
    {classId:'G1',studentId:'a',date:'2026-09-01',attendance:'absent',participation:1,note:''},
    {classId:'G1',studentId:'a',date:'2026-09-01',attendance:'present',participation:1,note:'Corrected'},
    {classId:'G1',studentId:'a',date:'2026-09-02',attendance:'absent',participation:1,note:'Absent'},
    {classId:'G1',studentId:'b',date:'2026-09-02',attendance:'present',participation:-1,note:''},
    {classId:'G1',studentId:'old-d',studentName:'Old name',date:'2026-09-02',attendance:'present',participation:0,note:'Historical'},
    {classId:'G2',studentId:'a',date:'2026-09-02',attendance:'present',participation:1,note:''}
  ],
  logs:[{classId:'G1',date:'2026-09-02',notes:'Lesson'},{classId:'G2',date:'2026-09-02',notes:'Other'}],
  checklists:[{classId:'G1',date:'2026-09-01'},{classId:'G1',date:'2026-09-02'}]
};
const group = build(data,{groups:['G1']});
assert.equal(group.count,4); assert.equal(group.attendance,75); assert.equal(group.points,-1);
assert.equal(group.notes,3); assert.equal(group.logs.length,1); assert.equal(group.meetings,2);
assert.equal(group.students.find(s=>s.id==='a').points,0,'absence overrides participation');
assert.equal(group.students.find(s=>s.id==='c').attendance,null,'unrecorded students are unknown');
assert.equal(group.students.find(s=>s.id==='d').archived,true,'historical IDs retain archived identity');
assert.equal(build(data,{groups:['G1'],start:'2026-09-02',end:'2026-09-02'}).count,3);
assert.equal(build(data,{groups:['G1','G2']}).students.filter(s=>s.id==='a').length,1);
assert.equal(build(data,{groups:[]}).count,0);
assert.equal(build(data,{groups:['G1'],end:'2026-08-31'}).students.some(s=>s.id==='c'),false);
assert.equal(summarize([]).attendance,null);
console.log('Analysis aggregation checks passed: filters, deduplication, point rules, empty records and archived identities.');
