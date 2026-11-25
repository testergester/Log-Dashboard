import {test} from 'node:test';
import assert from 'node:assert/strict';
import {lessonEnrollments} from '../src/roster-model.js';
import {enrolledOn} from '../src/data-model.js';
import {TeachingAnalysis} from '../src/analysis-model.js';
const enrollments=[
 {classId:'9B',studentId:'imported-today',joinedOn:'2026-10-16',leftOn:'',active:true},
 {classId:'9B',studentId:'earlier',joinedOn:'2026-09-01',leftOn:'',active:true},
 {classId:'9B',studentId:'left-before',joinedOn:'2026-09-01',leftOn:'2026-10-01',active:false},
 {classId:'8E',studentId:'other-group',joinedOn:'2026-09-01',leftOn:'',active:true}
];
test('an unsaved earlier lesson includes students imported into its current class',()=>{
 const rows=lessonEnrollments(enrollments,{classId:'9B',date:'2026-10-12',includeCurrent:true});
 assert.deepEqual(rows.map(e=>e.studentId),['imported-today','earlier']);
 assert.equal(enrollments[0].joinedOn,'2026-10-16');
});
test('saved attendance does not gain students whose enrollment started later',()=>{
 const rows=lessonEnrollments(enrollments,{classId:'9B',date:'2026-10-12'});
 assert.deepEqual(rows.map(e=>e.studentId),['earlier']);
});
test('dated memberships retain former students when they were enrolled for that lesson',()=>{
 const rows=lessonEnrollments(enrollments,{classId:'9B',date:'2026-09-15'});
 assert.deepEqual(rows.map(e=>e.studentId),['earlier','left-before']);
 assert.equal(lessonEnrollments(enrollments,{classId:'9B',date:'2026-10-16'}).filter(e=>e.studentId==='imported-today').length,1);
});
test('leaving date is excluded consistently across roster display, save validation, and analysis',()=>{
 const left=enrollments.find(e=>e.studentId==='left-before');
 assert.equal(enrolledOn(left,'2026-09-30'),true);
 assert.equal(enrolledOn(left,'2026-10-01'),false);
 assert.equal(enrolledOn(left,'2026-10-02'),false);
 assert.deepEqual(lessonEnrollments(enrollments,{classId:'9B',date:'2026-09-30'}).map(e=>e.studentId),['earlier','left-before']);
 assert.deepEqual(lessonEnrollments(enrollments,{classId:'9B',date:'2026-10-01'}).map(e=>e.studentId),['earlier']);
 const analysisOnLeave=TeachingAnalysis.build({students:[{id:'earlier',name:'Earlier'},{id:'left-before',name:'Left'}],enrollments,studentRecords:[],checklists:[],logs:[]},{groups:['9B'],start:'2026-10-01',end:'2026-10-01'});
 assert.deepEqual(analysisOnLeave.students.map(s=>s.id),['earlier']);
});
