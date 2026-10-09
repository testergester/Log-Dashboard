export const SESSION_KEY = 'teaching-dashboard-session';
export const ENDPOINT_KEY = 'teaching-dashboard-endpoint';
export const DEFAULT_ENDPOINT = 'https://script.google.com/macros/s/AKfycbzzpBeitHNCriLtUU68x_CiFw8pAJ_iWopODGpuhBEnyEnoDyfvVcpbhrnWoOWr-CKD/exec';
export const TZ = 'Asia/Tashkent';
export const keyFor = (id, date) => `${id}|${date}`;
export function today() {
  const parts = new Intl.DateTimeFormat('en', {timeZone: TZ,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
  return ['year','month','day'].map(k=>parts.find(p=>p.type===k).value).join('-');
}
export const dateObject = date => new Date(`${date}T12:00:00Z`);
export const dayNumber = date => (dateObject(date).getUTCDay()+6)%7+1;
export function addDays(date,n) { const d=dateObject(date);d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10); }
export const monday = date => addDays(date,1-dayNumber(date));
export const formatDate = (date,options={weekday:'short',day:'numeric',month:'short'}) => new Intl.DateTimeFormat('en',{timeZone:'UTC',...options}).format(dateObject(date));
export function canonicalTime(value) {
  const m=String(value||'').trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?$/i);
  if(!m)return String(value||'');let h=Number(m[1]);if(m[3])h=h%12+(m[3].toUpperCase()==='PM'?12:0);return `${String(h).padStart(2,'0')}:${m[2]}`;
}
export function normalizeData(data) {
  if(!Array.isArray(data.classes)||!Array.isArray(data.logs))throw new Error('Your teaching records returned an unexpected format.');
  const keys=['students','enrollments','checklists','studentRecords'];
  const studentsReady=keys.every(k=>Array.isArray(data[k]));
  if(!studentsReady&&keys.some(k=>data[k]!==undefined))throw new Error('Student records are incomplete. Open the current dashboard to check the connection.');
  return {...data,studentsReady,classes:data.classes.map(c=>({...c,start:canonicalTime(c.start),end:canonicalTime(c.end),meetings:(c.meetings||[c]).map(m=>({...m,start:canonicalTime(m.start),end:canonicalTime(m.end)}))})),logs:data.logs.map(l=>({...l,start:canonicalTime(l.start),end:canonicalTime(l.end)})),students:data.students||[],archivedStudents:data.archivedStudents||[],enrollments:data.enrollments||[],checklists:data.checklists||[],studentRecords:data.studentRecords||[]};
}
export function lessonsOn(data,date) {
  const active=data.classes.filter(c=>c.active).flatMap(c=>c.meetings.filter(m=>Number(m.weekday)===dayNumber(date)).map(m=>({...c,...m,date,archived:false})));
  const ids=new Set(active.map(c=>c.id));
  const oldIds=new Set([...data.logs,...data.checklists].filter(l=>l.date===date).map(l=>l.classId));
  for(const id of oldIds){if(ids.has(id))continue;const log=data.logs.find(l=>l.classId===id&&l.date===date);const original=data.classes.find(c=>c.id===id);const info=data.checklists.find(c=>c.classId===id&&c.date===date)?.classInfo;active.push({id,name:log?.className||info?.name||original?.name||id,subject:log?.subject||info?.subject||original?.subject||'',start:log?.start||info?.start||original?.start||'',end:log?.end||info?.end||original?.end||'',room:log?.room||info?.room||original?.room||'',date,archived:true});}
  return active.sort((a,b)=>a.start.localeCompare(b.start)||a.name.localeCompare(b.name));
}
export const logFor = (data,id,date) => data.logs.find(l=>l.classId===id&&l.date===date);
export const checklistFor = (data,id,date) => data.checklists.find(c=>c.classId===id&&c.date===date);
export function rosterFor(data,id,date) {
  const saved=checklistFor(data,id,date);
  const rows=saved?data.studentRecords.filter(r=>r.classId===id&&r.date===date).map(r=>({...r})):[];
  // JSON payloads are also supported when a backend omits the flattened records.
  if(saved&&!rows.length&&Array.isArray(saved.records))rows.push(...saved.records.map(r=>({...r})));
  const seen=new Set(rows.map(r=>r.studentId));
  data.enrollments.filter(e=>e.classId===id&&(!e.joinedOn||e.joinedOn<=date)&&(!e.leftOn||date<e.leftOn)).forEach(e=>{if(!seen.has(e.studentId)){seen.add(e.studentId);rows.push({studentId:e.studentId,attendance:'present',participation:0,note:''});}});
  return rows.map(r=>({...r,name:data.students.find(s=>s.id===r.studentId)?.name||r.studentName||data.archivedStudents.find(s=>s.id===r.studentId||s.ids?.includes(r.studentId))?.name||`Unknown student · ${r.studentId}`,participation:Number(r.participation)||0,note:r.note||''})).sort((a,b)=>a.name.localeCompare(b.name));
}
export function makeDraft(data,id,date) {
  const log=logFor(data,id,date);
  return {notes:log?.notes||'',rating:log?.rating??null,lessonType:log?.lessonType||'Lesson',lessonStatus:log?.lessonStatus||'Done',records:rosterFor(data,id,date),notesDirty:false,rosterDirty:false};
}
export function logPayload(id,date,draft) {
  if(String(draft.notes).length>5000)throw new Error('Lesson notes must be 5,000 characters or fewer.');
  if(!String(draft.lessonType).trim())throw new Error('Enter a lesson type.');
  return {classId:id,date,notes:draft.notes,rating:draft.rating,lessonType:draft.lessonType,lessonStatus:draft.lessonStatus};
}
export function checklistPayload(data,id,date,draft) {
  const records=draft.records.map(r=>({studentId:r.studentId,attendance:r.attendance,participation:r.participation,note:r.note||''}));
  for(const r of records){if(!['present','absent'].includes(r.attendance)||![-1,0,1].includes(r.participation)||(r.attendance==='absent'&&r.participation!==0))throw new Error('Attendance or participation has an invalid value.');if(r.note.length>300)throw new Error('Student notes must be 300 characters or fewer.');}
  return {schemaVersion:1,classId:id,date,revision:checklistFor(data,id,date)?.revision||'',records};
}
export function applyLog(data,saved){const i=data.logs.findIndex(l=>l.classId===saved.classId&&l.date===saved.date);if(i<0)data.logs.push(saved);else data.logs[i]=saved;}
export function applyChecklist(data,saved){if(!saved.checklist?.records)throw new Error('The attendance save response was incomplete. Reload before trying again.');const value={classId:saved.classId,date:saved.date,revision:saved.revision,updatedAt:saved.updatedAt,classInfo:saved.checklist.classInfo,records:saved.checklist.records};const i=data.checklists.findIndex(c=>c.classId===saved.classId&&c.date===saved.date);if(i<0)data.checklists.push(value);else data.checklists[i]=value;data.studentRecords=data.studentRecords.filter(r=>r.classId!==saved.classId||r.date!==saved.date);data.studentRecords.push(...saved.checklist.records.map(r=>({...r,classId:saved.classId,date:saved.date,updatedAt:saved.updatedAt})));}
export function createClient({storage,fetchImpl=fetch,uuid=()=>crypto.randomUUID()}) {
  return async function request(action,fields={}) {
    const endpoint=storage.getItem(ENDPOINT_KEY)||DEFAULT_ENDPOINT;
    const token=storage.getItem(SESSION_KEY);
    if(!token)throw new Error('Sign in through the current dashboard, then return here.');
    const url=new URL(endpoint);
    if(url.protocol!=='https:'||url.hostname!=='script.google.com'||!/^\/macros\/s\/[^/]+\/exec$/.test(url.pathname)||url.search||url.hash)throw new Error('Check your Apps Script connection in the current dashboard.');
    const requestId=uuid(),controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),30000);
    try {
      const response=await fetchImpl(endpoint,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({action,...fields,token,requestId}),redirect:'follow',cache:'no-store',signal:controller.signal});
      if(!response.ok||response.type==='opaque')throw new Error('Apps Script returned an unreadable response.');
      const result=await response.json();
      if(result.requestId!==requestId)throw new Error('Apps Script returned a mismatched response.');
      if(!result.ok)throw new Error(result.error||'The request failed.');
      return result.data;
    }catch(error){if(error.name==='AbortError')throw new Error('The request timed out. Retry when the connection is available.');throw error;}finally{clearTimeout(timeout);}
  };
}
