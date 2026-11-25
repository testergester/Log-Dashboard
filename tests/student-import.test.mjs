import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseStudentPaste,planStudentImport} from '../src/student-import-model.js';
import {mutation,key} from '../src/data-model.js';
const classes=[{id:'actual-id-8e',name:'8E',subject:'English',active:true},{id:'9A',name:'9A',active:true}];
const table=`| Full name | Group ID |
| --------- | -------- |
| Abduxakimova Charoxon | |
| Abduraxmonov Sardor | 8E |
| Abdug‘aniyev Ahmadjon | 9A |`;
test('Markdown table preserves names and blank groups, matches class names to real IDs',()=>{
 const rows=parseStudentPaste(table);assert.equal(rows.length,3);assert.equal(rows[0].group,'');assert.equal(rows[2].name,'Abdug‘aniyev Ahmadjon');
 const planned=planStudentImport(rows,{classes});assert.equal(planned[0].status,'error');assert.equal(planned[1].classId,'actual-id-8e');
 const defaults=planStudentImport(rows,{classes,defaultClassId:'actual-id-8e'});assert.ok(defaults.every(r=>r.status==='ready'));assert.equal(defaults[2].classId,'9A');
});
test('spreadsheet TSV, quoted CSV, reordered headers and names-only lists are supported',()=>{
 assert.deepEqual(parseStudentPaste('Full name\tGroup ID\nFirst Person\t8E\nSecond Person\t9A').map(r=>r.group),['8E','9A']);
 assert.equal(parseStudentPaste('Full name,Group ID\n"Doe, Jane",8E\n"O""Brien, Jo",9A')[1].name,'O"Brien, Jo');
 assert.equal(parseStudentPaste('Group ID,Full name\n8E,First Person')[0].name,'First Person');
 assert.deepEqual(parseStudentPaste('First Person\nSecond Person').map(r=>r.group),['','']);
 assert.equal(parseStudentPaste('Full name\nFirst Person').length,1);
 assert.deepEqual(parseStudentPaste(''),[]);
 assert.throws(()=>parseStudentPaste('Full name,Group ID\n"Bad,8E'),/incomplete/);
 assert.throws(()=>parseStudentPaste('Full name,Group ID,Unexpected\nFirst,8E,x'),/columns/);
});
test('unknown or ambiguous groups require explicit mapping, excluded rows do not block',()=>{
 const rows=parseStudentPaste('Full name\tGroup ID\nFirst Person\tUNKNOWN\nSecond Person\t8E');
 assert.equal(planStudentImport(rows,{classes})[0].status,'error');
 assert.equal(planStudentImport(rows,{classes,mapping:{unknown:'9A'}})[0].classId,'9A');
 rows[0].included=false;assert.equal(planStudentImport(rows,{classes})[0].status,'excluded');
 assert.equal(planStudentImport([rows[1]],{classes:[...classes,{id:'another',name:'8E',active:true}]})[0].status,'error');
 assert.equal(planStudentImport([{name:'First',group:'9A',included:true}],{classes:[...classes,{id:'named-other',name:'9A',active:true}]})[0].classId,'9A');
});
test('repeat pastes and equivalent names skip duplicates only within their group',()=>{
 const rows=parseStudentPaste('Full name\tGroup ID\nO‘Brien Jane\t8E\nO\'Brien Jane\t8E\nO\'Brien Jane\t9A');
 assert.deepEqual(planStudentImport(rows,{classes}).map(r=>r.status),['ready','duplicate','ready']);
 assert.equal(planStudentImport(rows,{classes,students:[{name:"O'Brien Jane",officialGroupId:'actual-id-8e'}]})[0].status,'duplicate');
 assert.match(planStudentImport(rows,{classes,archivedStudents:[{name:"O'Brien Jane",officialGroupId:'actual-id-8e'}]})[0].message,/Archived/);
});
function dbWithClasses(){return {timetable:Object.fromEntries(classes.map(c=>[key(c.id),c]))};}
const ctx={uuid:()=>crypto.randomUUID(),today:'2026-10-16',timestamp:1234};
function apply(db,out){for(const [path,value]of Object.entries(out.changes)){const [section,id]=path.split('/');db[section]??={};db[section][id]=value;}}
test('batch adds students and enrollments atomically, skips duplicates on retry',()=>{
 const db=dbWithClasses(),before=structuredClone(db),students=[{name:'First Person',classId:'actual-id-8e'},{name:'Second Person',classId:'9A'},{name:'First Person',classId:'actual-id-8e'}];
 const out=mutation(db,'importStudents',{students},ctx);assert.deepEqual(db,before);assert.equal(Object.keys(out.changes).length,4);assert.equal(out.result,'reload');apply(db,out);
 assert.equal(Object.values(db.students).length,2);assert.equal(Object.values(db.classStudents).length,2);
 const first=Object.values(db.students).find(s=>s.name==='First Person');assert.equal(first.officialGroupId,'actual-id-8e');assert.equal(first.revision,1);
 const enrollment=Object.values(db.classStudents).find(e=>e.studentId===first.id);assert.equal(enrollment.joinedOn,'2026-10-16');assert.equal(enrollment.classId,first.officialGroupId);
 assert.deepEqual(mutation(db,'importStudents',{students},ctx).changes,{});
});
test('invalid groups, archived classes and malformed names reject the complete batch',()=>{
 const db=dbWithClasses(),before=structuredClone(db),good={name:'First Person',classId:'9A'};
 assert.throws(()=>mutation(db,'importStudents',{students:[good,{name:'Second',classId:'missing'}]},ctx),/Class no longer/);assert.deepEqual(db,before);
 assert.throws(()=>mutation(db,'importStudents',{students:[{...good,name:''}]},ctx),/student name/);
 assert.throws(()=>mutation(db,'importStudents',{students:[{...good,name:'First\nPerson'}]},ctx),/one line/);
 db.timetable[key('9A')].active=false;assert.throws(()=>mutation(db,'importStudents',{students:[good]},ctx),/active class/);
 assert.throws(()=>parseStudentPaste(Array.from({length:501},(_,i)=>'Person '+i).join('\n')),/500/);
 assert.equal(parseStudentPaste(Array.from({length:120},(_,i)=>'Person '+i+'\t8E').join('\n')).length,120);
});
