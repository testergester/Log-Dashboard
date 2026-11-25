// Pure domain operations. Firebase transport and UI stay outside this module.
import {studentIdentity} from './student-import-model.js';
export const SECTIONS = ['timetable','students','classStudents','lessonLogs','attendanceChecklists','archivedStudents','archivedLessonLogs'];
export const key = id => 'k' + Array.from(new TextEncoder().encode(String(id)), b => b.toString(16).padStart(2,'0')).join('');
export const meetingKey = (classId,date) => key(classId) + '_' + date;
const values = value => Object.values(value || {});
const fail = message => { throw new Error(message); };
const text = (v,label,max=120,required=true) => {
  const s=String(v ?? '').trim();
  if ((required && !s) || s.length>max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(s)) fail('Invalid '+label+'.');
  return s;
};
export const dateValue = v => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v || '') || new Date(v+'T12:00:00Z').toISOString().slice(0,10)!==v) fail('Invalid lesson date.');
  return v;
};
const time = v => /^([01]\d|2[0-3]):[0-5]\d$/.test(v || '') ? v : fail('Time must use HH:MM.');
const must = (v,message) => v || fail(message);
export const enrolledOn = (e,date) => e.joinedOn<=date && (!e.leftOn || date<e.leftOn);
export function dashboardData(db={}) {
  const checklists=values(db.attendanceChecklists).map(c=>({...c,date:c.lessonDate,records:values(c.records),recordCount:values(c.records).length,storage:'firebase-v1'}));
  return {classes:values(db.timetable),students:values(db.students),enrollments:values(db.classStudents),logs:values(db.lessonLogs),archivedStudents:values(db.archivedStudents),archivedLogs:values(db.archivedLessonLogs),
    checklists,studentRecords:checklists.flatMap(c=>c.records.map(r=>({...r,classId:c.classId,date:c.date,updatedAt:c.updatedAt}))),
    timezone:'Asia/Tashkent',meetingScheduleVersion:1,studentArchiveVersion:1,extendedAttendanceVersion:1,lessonDetailsVersion:1};
}
export function mutation(db,action,f,ctx) {
  const {uuid,today,timestamp}=ctx, changes={};
  const put=(section,id,value)=>{changes[section+'/'+id]=value;return value;};
  const stamp=old=>({revision:(old?.revision || 0)+1,updatedAt:timestamp});
  const getClass=id=>must(db.timetable?.[key(id)],'Class no longer exists. Refresh your records.');
  const enrollment=(classId,studentId,active)=>{
    const c=getClass(classId),s=must(db.students?.[key(studentId)],'Student no longer exists.');
    if(!c.active || (active && s.officialGroupId!==classId)) fail('Choose the student’s active official group.');
    const old=values(db.classStudents).find(e=>e.classId===classId && e.studentId===studentId && e.active);
    if(active && old) return old;
    if(!active && !old) fail('Student is not enrolled.');
    const id=old?.id || uuid();
    return put('classStudents',id,{id,classId,classKey:key(classId),studentId,studentKey:key(studentId),joinedOn:old?.joinedOn || today,leftOn:active?'':today,active,...stamp(old)});
  };
  let result;
  if(action==='importTimetable') {
    if(!Array.isArray(f.classes)||!f.classes.length||f.classes.length>100) fail('Choose 1–100 classes to import.');
    const staged={...db,timetable:{...db.timetable}};
    for(const item of f.classes){
      if(item.id) fail('Timetable import can only add new classes.');
      const out=mutation(staged,'saveClass',{class:item},ctx);
      Object.assign(changes,out.changes);
      staged.timetable[key(out.result.id)]=out.result;
    }
    result='reload';
  } else if(action==='saveClass') {
    const i=f.class || {},id=i.id || i.requestedId || uuid();
    if(!/^[A-Za-z0-9][A-Za-z0-9._ -]{0,79}$/.test(id)) fail('Invalid group ID.');
    const old=db.timetable?.[key(id)];
    if(i.id ? !old || !old.active : Boolean(old)) fail('Class ID is unavailable.');
    const rows=[{weekday:i.weekday,start:i.start,end:i.end,room:i.room},...(i.meetings || [])];
    if(rows.length>7) fail('Choose each weekday only once.');
    const meetings=Object.fromEntries(rows.map(m=>{
      const day=Number(m.weekday); if(!Number.isInteger(day)||day<1||day>7) fail('Invalid weekday.');
      const start=time(m.start),end=time(m.end); if(start>=end) fail('End time must be after start time.');
      return [day,{weekday:day,start,end,room:text(m.room,'room',120,false)}];
    }));
    if(values(meetings).length!==rows.length) fail('Choose each weekday only once.');
    for(const c of values(db.timetable).filter(c=>c.id!==id&&c.active))
      for(const m of values(meetings)) for(const other of values(c.meetings))
        if(m.weekday===other.weekday&&m.start<other.end&&m.end>other.start) fail('A meeting overlaps with '+c.name+'.');
    const first=meetings[Number(i.weekday)];
    result=put('timetable',key(id),{id,name:text(i.name,'class name'),subject:text(i.subject,'subject'),...first,meetings,active:true,...stamp(old)});
  } else if(action==='archiveClass'||action==='restoreClass') {
    const old=getClass(f.classId);
    if(action==='restoreClass')for(const c of values(db.timetable).filter(c=>c.id!==old.id&&c.active))for(const m of values(old.meetings))for(const other of values(c.meetings))if(m.weekday===other.weekday&&m.start<other.end&&m.end>other.start)fail('A meeting overlaps with '+c.name+'. Edit the active class before restoring.');
    result=put('timetable',key(old.id),{...old,active:action==='restoreClass',...stamp(old)});
    result={...result,archived:!result.active};
  } else if(action==='importStudents') {
    if(!Array.isArray(f.students)||!f.students.length||f.students.length>500)fail('Choose 1–500 students to import.');
    const staged={...db,students:{...db.students},classStudents:{...db.classStudents}};
    const seen=new Set([...values(db.students),...values(db.archivedStudents)].map(s=>studentIdentity(s.name,s.officialGroupId)));
    for(const item of f.students){
      const name=text(item.name,'student name'),c=getClass(item.classId);
      if(/[\r\n\t]/.test(name))fail('Student names must use one line.');
      if(!c.active)fail('Choose an active class for every student.');
      const identity=studentIdentity(name,c.id);if(seen.has(identity))continue;
      const out=mutation(staged,'saveStudent',{student:{name,classId:c.id}},ctx);
      Object.assign(changes,out.changes);
      for(const [path,value]of Object.entries(out.changes)){const [section,id]=path.split('/');staged[section][id]=value;}
      seen.add(identity);
    }
    result='reload';
  } else if(action==='saveStudent') {
    const i=f.student || {},old=i.id?must(db.students?.[key(i.id)],'Student no longer exists.'):null;
    const group=old?.officialGroupId || i.classId,c=getClass(group);
    if(!c.active || (old&&i.classId&&i.classId!==group)) fail('Official group cannot be changed.');
    const id=old?.id || 'ST-'+group.replace(/[^a-zA-Z0-9_-]/g,'-')+'-'+uuid().replaceAll('-','').slice(0,8);
    if(!old&&(db.students?.[key(id)]||db.archivedStudents?.[key(id)])) fail('Student ID already exists. Try again.');
    const student=put('students',key(id),{id,name:text(i.name,'student name'),officialGroupId:group,classKey:key(group),...stamp(old)});
    let e=null;
    if(!old){ const eid=uuid();e=put('classStudents',eid,{id:eid,classId:group,classKey:key(group),studentId:id,studentKey:key(id),joinedOn:today,leftOn:'',active:true,...stamp(null)}); }
    result={student,enrollment:e};
  } else if(action==='setEnrollment') result=enrollment(f.classId,f.studentId,f.active===true);
  else if(action==='saveLog'||action==='editLog') {
    const i=f.log || {},date=dateValue(i.date),c=getClass(i.classId),id=meetingKey(c.id,date),old=db.lessonLogs?.[id];
    if(!old&&!c.active) fail('Cannot create a record for an archived class.');
    if(action==='editLog'&&!old) fail('Lesson no longer exists.');
    const day=(new Date(date+'T12:00:00Z').getUTCDay()+6)%7+1;
    const m=c.meetings?.[day] || c;
    const info=action==='editLog'?{className:text(i.className,'class name'),subject:text(i.subject,'subject'),start:time(i.start),end:time(i.end),room:text(i.room,'room',120,false)}:
      old?{className:old.className,subject:old.subject,start:old.start,end:old.end,room:old.room}:{className:c.name,subject:c.subject,start:m.start,end:m.end,room:m.room};
    if(info.start>=info.end) fail('End time must be after start time.');
    if(!['Done','Skipped','Late','Cancelled'].includes(i.lessonStatus||'Done')) fail('Invalid lesson status.');
    const rating=i.rating==null||i.rating===''?0:Number(i.rating);
    if(!Number.isInteger(rating)||rating<0||rating>5) fail('Invalid class rating.');
    result=put('lessonLogs',id,{classId:c.id,classKey:key(c.id),date,...info,notes:text(i.notes,'notes',5000,false),rating,
      lessonType:text(i.lessonType||'Lesson','lesson type',60),lessonStatus:i.lessonStatus||'Done',unit:text(i.unit??old?.unit,'unit',120,false),lessonTitle:text(i.lessonTitle??old?.lessonTitle,'lesson title',200,false),nextClassNotes:text(i.nextClassNotes??old?.nextClassNotes,'next class notes',2000,false),...stamp(old)});
  } else if(action==='saveChecklist') {
    const i=f.checklist || {},date=dateValue(i.date),c=getClass(i.classId),id=meetingKey(c.id,date),old=db.attendanceChecklists?.[id];
    if(String(i.revision||'')!==String(old?.revision||'')) fail('Checklist changed on another device. Refresh before saving.');
    if(!Array.isArray(i.records)||i.records.length>100||(!i.records.length&&!old)) fail('A checklist needs 1–100 students.');
    if(!c.active&&!old) fail('Cannot create attendance for an archived class.');
    const records={};
    for(const r of i.records){
      const sk=key(r.studentId),s=db.students?.[sk] || (old?.records?.[sk]&&db.archivedStudents?.[sk]);
      if(!s||records[sk]) fail('Invalid or duplicate student.');
      if(!['present','absent','late','excused'].includes(r.attendance)||![-1,0,1].includes(r.participation)||(['absent','excused'].includes(r.attendance)&&r.participation!==0)) fail('Invalid attendance or participation.');
      records[sk]={studentId:s.id,studentName:s.name,attendance:r.attendance,participation:r.participation,note:text(r.note,'student note',300,false)};
    }
    if(values(db.classStudents).some(e=>e.classId===c.id&&enrolledOn(e,date)&&db.students?.[key(e.studentId)]&&!records[key(e.studentId)])) fail('The roster changed. Refresh before saving.');
    const day=(new Date(date+'T12:00:00Z').getUTCDay()+6)%7+1,m=c.meetings?.[day]||c;
    const payload=put('attendanceChecklists',id,{schemaVersion:1,classId:c.id,classKey:key(c.id),lessonDate:date,date,records,...stamp(old),classInfo:old?.classInfo||{id:c.id,name:c.name,subject:c.subject,start:m.start,end:m.end,room:m.room}});
    result={classId:c.id,date,revision:payload.revision,updatedAt:payload.updatedAt,recordCount:i.records.length,storage:'firebase-v1',checklist:{...payload,records:values(records)}};
  } else if(action==='archiveStudent') {
    const sk=key(f.studentId),s=must(db.students?.[sk],'Student no longer exists.');
    if(db.archivedStudents?.[sk]) fail('Student is already archived.');
    const memberships=values(db.classStudents).filter(e=>e.studentId===s.id);
    put('archivedStudents',sk,{...s,groups:[{groupId:s.officialGroupId,roles:['official']}],ids:[s.id],removedOn:today,...stamp(s)});
    put('students',sk,null);
    memberships.filter(e=>e.active).forEach(e=>put('classStudents',e.id,{...e,active:false,leftOn:today,...stamp(e)}));
    result='reload';
  } else if(action==='restoreStudent') {
    const sk=key(f.studentId),s=must(db.archivedStudents?.[sk],'Archive no longer exists.');
    if(db.students?.[sk]) fail('A student with this ID already exists.');
    const c=getClass(s.officialGroupId);if(!c.active) fail('Restore the official class first.');
    const {groups,ids,removedOn,...profile}=s;
    put('students',sk,{...profile,...stamp(s)});put('archivedStudents',sk,null);
    const eid=uuid();put('classStudents',eid,{id:eid,classId:c.id,classKey:key(c.id),studentId:s.id,studentKey:sk,joinedOn:today,leftOn:'',active:true,...stamp(null)});
    result='reload';
  } else if(action==='archiveLog') {
    const id=meetingKey(f.classId,dateValue(f.date)),old=must(db.lessonLogs?.[id],'Lesson no longer exists.');
    if(db.archivedLessonLogs?.[id]) fail('A record for this date is already archived.');
    put('archivedLessonLogs',id,{...old,archiveReason:text(f.reason,'archive reason',1000),archivedAt:timestamp,...stamp(old)});put('lessonLogs',id,null);result='reload';
  } else if(action==='restoreLog') {
    const id=meetingKey(f.classId,dateValue(f.date)),old=must(db.archivedLessonLogs?.[id],'Archive no longer exists.');
    if(db.lessonLogs?.[id]) fail('A lesson already exists on this date.');
    const {archiveReason,archivedAt,...log}=old;
    put('lessonLogs',id,{...log,...stamp(old)});put('archivedLessonLogs',id,null);result='reload';
  } else fail('Unknown operation.');
  return {changes,result};
}
export function viewData(db={}) {
  const data=dashboardData(db);
  data.classes=data.classes.map(c=>({...c,meetings:values(c.meetings).sort((a,b)=>a.weekday===c.weekday?-1:b.weekday===c.weekday?1:a.weekday-b.weekday)}));
  return data;
}
