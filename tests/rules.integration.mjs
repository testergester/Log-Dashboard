import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {initializeTestEnvironment,assertSucceeds,assertFails} from '@firebase/rules-unit-testing';
import {ref,get,set,update,serverTimestamp} from 'firebase/database';
import {mutation,key,meetingKey} from '../src/data-model.js';
let env,alice,bob,guest;
const base=uid=>'teachingDashboard/v1/users/'+uid;
before(async()=>{
 env=await initializeTestEnvironment({projectId:'demo-dashfirebase',database:{host:'127.0.0.1',port:9000,rules:await readFile(new URL('../firebase/database.rules.json',import.meta.url),'utf8')}});
 await env.clearDatabase();
 const claims={firebase:{sign_in_provider:'google.com'}};
 alice=env.authenticatedContext('alice',claims).database();bob=env.authenticatedContext('bob',claims).database();guest=env.unauthenticatedContext().database();
});
after(async()=>{await env?.cleanup();});
async function perform(db,uid,action,fields){const before=(await get(ref(db,base(uid)))).val()||{};const m=mutation(before,action,fields,{uuid:()=>crypto.randomUUID(),today:'2026-10-15',timestamp:serverTimestamp()});await update(ref(db,base(uid)),m.changes);return m;}
const group={requestedId:'B',name:'Class B',subject:'English',weekday:4,start:'09:00',end:'09:45',room:''};
test('two teachers can create private data; cross-user and anonymous requests are rejected',async()=>{
 await assertSucceeds(perform(alice,'alice','saveClass',{class:group}));await assertSucceeds(perform(bob,'bob','saveClass',{class:group}));
 await assertFails(get(ref(bob,base('alice'))));await assertFails(get(ref(guest,base('alice'))));
 await assertFails(set(ref(bob,base('alice')+'/timetable/injected'),{id:'x'}));
 await assertFails(get(ref(alice,'teachingDashboard/v1/users')));
 await assertFails(set(ref(alice,'unrelatedApp/x'),1));
});
test('class validation, revision conflicts and raw deletions cannot bypass rules',async()=>{
 const path=base('alice')+'/timetable/'+key('B'),c=(await get(ref(alice,path))).val();
 await assertFails(update(ref(alice,path),{name:'Invalid',revision:999,updatedAt:serverTimestamp()}));
 await assertSucceeds(update(ref(alice,path),{name:'Renamed',revision:c.revision+1,updatedAt:serverTimestamp()}));
 await assertFails(update(ref(alice,path),{name:'Stale',revision:c.revision+1,updatedAt:serverTimestamp()}));
 await assertFails(set(ref(alice,path),null));
 await assertFails(update(ref(alice,path),{revision:c.revision+2,updatedAt:serverTimestamp(),start:'25:00'}));
});
test('student/enrollment creation and validated attendance work atomically',async()=>{
 const out=await perform(alice,'alice','saveStudent',{student:{classId:'B',name:'Alice student'}});const student=out.result.student;
 await assertSucceeds(perform(alice,'alice','saveChecklist',{checklist:{classId:'B',date:'2026-10-15',records:[{studentId:student.id,attendance:'present',participation:1,note:''}]}}));
 const path=base('alice')+'/attendanceChecklists/'+meetingKey('B','2026-10-15'),c=(await get(ref(alice,path))).val();
 const sk=key(student.id);
 await assertFails(update(ref(alice,path),{revision:c.revision+1,updatedAt:serverTimestamp(),['records/'+sk+'/attendance']:'absent'}));
 await assertFails(update(ref(alice,path),{revision:c.revision+1,updatedAt:serverTimestamp(),['records/'+sk+'/attendance']:'invented'}));
 await assertFails(update(ref(alice,path),{revision:c.revision+1,updatedAt:serverTimestamp(),['records/'+sk+'/participation']:2}));
});
test('archive and recovery preserve the original records and refuse destructive deletes',async()=>{
 const d=(await get(ref(alice,base('alice')))).val(),s=Object.values(d.students)[0];
 await assertFails(set(ref(alice,base('alice')+'/students/'+key(s.id)),null));
 await assertSucceeds(perform(alice,'alice','archiveStudent',{studentId:s.id}));
 assert.equal((await get(ref(alice,base('alice')+'/students/'+key(s.id)))).exists(),false);
 await assertSucceeds(perform(alice,'alice','restoreStudent',{studentId:s.id}));
 await assertSucceeds(perform(alice,'alice','saveLog',{log:{classId:'B',date:'2026-10-15',notes:'A lesson'}}));
 await assertSucceeds(perform(alice,'alice','archiveLog',{classId:'B',date:'2026-10-15',reason:'Test'}));
 await assertSucceeds(perform(alice,'alice','restoreLog',{classId:'B',date:'2026-10-15'}));
});
test('reviewed timetable imports atomically within the teacher workspace',async()=>{
 const classes=[{requestedId:'IMPORT-A',name:'Import A',subject:'English',weekday:1,start:'15:00',end:'15:45',room:'12',meetings:[{weekday:3,start:'15:00',end:'15:45',room:'12'}]},
 {requestedId:'IMPORT-B',name:'Import B',subject:'English',weekday:5,start:'15:50',end:'16:35',room:'14',meetings:[]}];
 await assertSucceeds(perform(alice,'alice','importTimetable',{classes}));
 const a=(await get(ref(alice,base('alice')+'/timetable/'+key('IMPORT-A')))).val();
 assert.equal(a.meetings[3].start,'15:00');assert.equal(a.revision,1);
 const before=(await get(ref(alice,base('alice')+'/timetable'))).val();
 await assert.rejects(()=>perform(alice,'alice','importTimetable',{classes:[{...classes[1],requestedId:'NEW'},classes[0]]}));
 assert.deepEqual((await get(ref(alice,base('alice')+'/timetable'))).val(),before);
 const changes=mutation({},'importTimetable',{classes:[{...classes[0],requestedId:'ATOMIC-A'},{...classes[1],requestedId:'ATOMIC-B'}]},{uuid:()=>crypto.randomUUID(),today:'2026-10-16',timestamp:serverTimestamp()}).changes;
 changes['timetable/'+key('ATOMIC-B')].subject='';
 await assertFails(update(ref(alice,base('alice')),changes));
 assert.equal((await get(ref(alice,base('alice')+'/timetable/'+key('ATOMIC-A')))).exists(),false);
 await assertFails(get(ref(bob,base('alice')+'/timetable/'+key('IMPORT-A'))));
});
test('bulk student profiles and memberships save atomically with private access',async()=>{
 const students=[{name:'Bulk One',classId:'B'},{name:'Bulk Two',classId:'B'}];
 await assertSucceeds(perform(bob,'bob','importStudents',{students}));
 const data=(await get(ref(bob,base('bob')))).val();assert.equal(Object.values(data.students).length,2);
 for(const s of Object.values(data.students))assert.ok(Object.values(data.classStudents).some(e=>e.studentId===s.id&&e.classId==='B'));
 await assertSucceeds(perform(bob,'bob','importStudents',{students}));
 assert.equal(Object.values((await get(ref(bob,base('bob')+'/students'))).val()).length,2);
 await assertFails(get(ref(alice,base('bob')+'/students')));
 const before=(await get(ref(bob,base('bob')))).val();
 const out=mutation(before,'importStudents',{students:[{name:'Atomic Good',classId:'B'},{name:'Atomic Bad',classId:'B'}]},{uuid:()=>crypto.randomUUID(),today:'2026-10-16',timestamp:serverTimestamp()});
 const bad=Object.values(out.changes).find(v=>v.name==='Atomic Bad');bad.name='';
 await assertFails(update(ref(bob,base('bob')),out.changes));
 assert.deepEqual((await get(ref(bob,base('bob')))).val(),before);
});
