import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mutation,viewData,key,meetingKey} from '../src/data-model.js';
import {TeachingAnalysis} from '../src/analysis-model.js';
let n=0;const ctx={uuid:()=>`id-${++n}`,today:'2026-10-15',timestamp:1234};
function apply(db,action,fields){const out=mutation(db,action,fields,ctx);for(const[path,v]of Object.entries(out.changes)){const[s,id]=path.split('/');db[s]??={};if(v===null)delete db[s][id];else db[s][id]=v;}return out.result;}
const group={requestedId:'10.B',name:'Class B',subject:'English',weekday:4,start:'09:00',end:'09:45',room:'1'};
test('empty workspace is complete and has no sample or imported data',()=>{const d=viewData();for(const name of ['classes','students','logs','checklists','studentRecords'])assert.deepEqual(d[name],[]);});
test('class IDs with dots remain valid without illegal database keys',()=>{const db={};const c=apply(db,'saveClass',{class:group});assert.equal(c.id,'10.B');assert.match(key(c.id),/^[a-z0-9]+$/);assert.equal(viewData(db).classes[0].meetings[0].weekday,4);});
test('duplicate classes, overlapping meetings, duplicate weekdays and invalid dates are rejected',()=>{const db={};apply(db,'saveClass',{class:group});assert.throws(()=>apply(db,'saveClass',{class:group}),/unavailable/);assert.throws(()=>apply(db,'saveClass',{class:{...group,requestedId:'C'}}),/overlaps/);assert.throws(()=>apply({},'saveClass',{class:{...group,meetings:[{weekday:4,start:'10:00',end:'11:00'}]}}),/once/);assert.throws(()=>apply(db,'saveLog',{log:{classId:'10.B',date:'2026-02-30'}}),/date/);});
test('attendance, lesson snapshots, archives and recovery preserve identity and history',()=>{
 const db={};apply(db,'saveClass',{class:group});const {student}=apply(db,'saveStudent',{student:{name:'Alice',classId:'10.B'}});
 const checklist={classId:'10.B',date:'2026-10-15',records:[{studentId:student.id,attendance:'late',participation:1,note:'Good'}]};
 const saved=apply(db,'saveChecklist',{checklist});assert.equal(saved.revision,1);
 assert.throws(()=>apply(db,'saveChecklist',{checklist}),/another device/);
 assert.throws(()=>apply(db,'saveChecklist',{checklist:{...checklist,revision:1,records:[{...checklist.records[0],attendance:'absent'}]}}),/Invalid attendance/);
 apply(db,'saveLog',{log:{classId:'10.B',date:'2026-10-15',notes:'Lesson',lessonTitle:'Past simple'}});
 const old=db.timetable[key('10.B')];apply(db,'saveClass',{class:{...old,name:'Renamed',meetings:[]}});
 apply(db,'saveLog',{log:{classId:'10.B',date:'2026-10-15',notes:'Corrected'}});
 assert.equal(db.lessonLogs[meetingKey('10.B','2026-10-15')].className,'Class B');
 apply(db,'archiveStudent',{studentId:student.id});assert.equal(viewData(db).students.length,0);assert.equal(viewData(db).studentRecords[0].studentName,'Alice');
 apply(db,'restoreStudent',{studentId:student.id});assert.equal(viewData(db).students[0].id,student.id);assert.equal(viewData(db).enrollments.length,2);
 apply(db,'archiveLog',{classId:'10.B',date:'2026-10-15',reason:'Correction'});assert.equal(viewData(db).logs.length,0);
 apply(db,'restoreLog',{classId:'10.B',date:'2026-10-15'});assert.equal(viewData(db).logs[0].notes,'Corrected');
 const summary=TeachingAnalysis.build(viewData(db),{groups:['10.B']});assert.equal(summary.late,1);assert.equal(summary.points,1);
});
test('roster omission and duplicate attendance entries are rejected',()=>{const db={};apply(db,'saveClass',{class:group});const{student}=apply(db,'saveStudent',{student:{name:'Alice',classId:'10.B'}});const r={studentId:student.id,attendance:'present',participation:0,note:''};assert.throws(()=>apply(db,'saveChecklist',{checklist:{classId:'10.B',date:'2026-10-15',records:[r,r]}}),/duplicate/);});
test('student official group is immutable and lesson recovery never overwrites',()=>{const db={};apply(db,'saveClass',{class:group});const{student}=apply(db,'saveStudent',{student:{name:'Alice',classId:'10.B'}});assert.throws(()=>apply(db,'saveStudent',{student:{...student,classId:'Other'}}),/cannot be changed/);apply(db,'saveLog',{log:{classId:'10.B',date:'2026-10-15'}});apply(db,'archiveLog',{classId:'10.B',date:'2026-10-15',reason:'Old'});apply(db,'saveLog',{log:{classId:'10.B',date:'2026-10-15'}});assert.throws(()=>apply(db,'restoreLog',{classId:'10.B',date:'2026-10-15'}),/already exists/);});
