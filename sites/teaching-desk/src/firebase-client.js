import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged, connectAuthEmulator, signInWithEmailAndPassword, createUserWithEmailAndPassword } from 'firebase/auth';
import { getDatabase, ref, get, update, query, orderByChild, startAt, endAt, onValue, connectDatabaseEmulator, serverTimestamp } from 'firebase/database';
import { SECTIONS, mutation, viewData } from './data-model.js';

const env=import.meta.env;
const localMode=env.DEV && env.VITE_USE_FIREBASE_EMULATORS==='true';
const config={apiKey:env.VITE_FIREBASE_API_KEY,authDomain:env.VITE_FIREBASE_AUTH_DOMAIN,projectId:env.VITE_FIREBASE_PROJECT_ID,databaseURL:env.VITE_FIREBASE_DATABASE_URL,appId:env.VITE_FIREBASE_APP_ID};
export const configured=localMode || Object.values(config).every(Boolean);
export const emulatorMode=localMode;
let auth,db,user=null,generation=0,cache={},stopWatch=()=>{},online=false;
const authObservers=new Set(),connectionObservers=new Set();
export const currentUser=()=>user;
export const connected=()=>online;
const root=uid=>'teachingDashboard/v1/users/'+uid;
const sessionError=()=>new Error('Session expired. Please sign in again.');
function check(uid,epoch){if(user?.uid!==uid||generation!==epoch){const error=new Error('Account changed; previous request discarded.');error.code='account-changed';throw error;}}
function normalize(error){
  if(/permission.denied/i.test(error.code||error.message))return new Error('Save rejected. This record may have changed elsewhere. Refresh before trying again.');
  if(/network|disconnected|unavailable/i.test(error.code||error.message))return new Error('Connection lost. Your changes are unsaved. Reconnect before saving.');
  return error;
}
if(configured){
  if(localMode)Object.assign(config,{apiKey:'demo-api-key',authDomain:'demo-dashfirebase.firebaseapp.com',projectId:'demo-dashfirebase',databaseURL:'https://demo-dashfirebase-default-rtdb.firebaseio.com',appId:'demo-app'});
  const app=initializeApp(config);auth=getAuth(app);db=getDatabase(app);
  if(localMode){connectAuthEmulator(auth,'http://127.0.0.1:9099',{disableWarnings:true});connectDatabaseEmulator(db,'127.0.0.1',9000);}
  onValue(ref(db,'.info/connected'),s=>{online=s.val()===true;connectionObservers.forEach(fn=>fn(online));});
  onAuthStateChanged(auth,next=>{
    generation++;stopWatch();cache={};user=next;
    authObservers.forEach(fn=>fn(next));
  });
}
export function observeAuth(fn){authObservers.add(fn);if(!configured)queueMicrotask(()=>fn(null));return()=>authObservers.delete(fn);}
export function observeConnection(fn){connectionObservers.add(fn);fn(online);return()=>connectionObservers.delete(fn);}
export async function login(){
  if(!configured)throw new Error('Firebase has not been configured yet. See the setup guide.');
  await signInWithPopup(auth,new GoogleAuthProvider());
}
// Password auth is available only against the local emulator, never on the live UI.
export async function emulatorLogin(email,password){
  if(!localMode)throw new Error('Local test sign-in is disabled.');
  try{await signInWithEmailAndPassword(auth,email,password);}catch(e){if(['auth/user-not-found','auth/invalid-credential'].includes(e.code))await createUserWithEmailAndPassword(auth,email,password);else throw e;}
}
export async function logout(){stopWatch();if(auth)await signOut(auth);}
export function historyRange(date){
  const d=new Date(date+'T12:00:00Z'),start=new Date(d),end=new Date(d);
  start.setUTCDate(d.getUTCDate()-90);end.setUTCDate(d.getUTCDate()+30);
  return {start:start.toISOString().slice(0,10),end:end.toISOString().slice(0,10)};
}
function sectionQuery(uid,section,range){
  const target=ref(db,root(uid)+'/'+section);
  return ['lessonLogs','attendanceChecklists','archivedLessonLogs'].includes(section)&&range
    ?query(target,orderByChild('date'),startAt(range.start),endAt(range.end)):target;
}
export async function load(range){
  if(!user)throw sessionError();const uid=user.uid,epoch=generation;
  const entries=await Promise.all(SECTIONS.map(async section=>[section,(await get(sectionQuery(uid,section,range))).val() || {}]));
  check(uid,epoch);cache=Object.fromEntries(entries);return viewData(cache);
}
export function watch(range,onData,onError){
  stopWatch();if(!user)return()=>{};const uid=user.uid,epoch=generation;
  let stopped=false,timer,received=new Set();
  const stops=SECTIONS.map(section=>onValue(sectionQuery(uid,section,range),s=>{
    if(stopped||user?.uid!==uid||epoch!==generation)return;
    cache[section]=s.val()||{};received.add(section);clearTimeout(timer);
    timer=setTimeout(()=>{if(!stopped&&received.size===SECTIONS.length)onData(viewData(cache));},75);
  },e=>{if(!stopped&&user?.uid===uid&&epoch===generation)onError(normalize(e));}));
  const stop=()=>{stopped=true;clearTimeout(timer);stops.forEach(fn=>fn());};stopWatch=stop;return stop;
}
export async function request(action,fields={}){
  if(!user||fields.token!==user.uid)throw sessionError();
  const uid=user.uid,epoch=generation;
  if(action==='load')return load(fields.range);
  if(!online || (typeof navigator!=='undefined' && navigator.onLine===false))throw new Error('You are offline. Your changes are unsaved. Reconnect before saving.');
  const ctx={uuid:()=>crypto.randomUUID(),timestamp:serverTimestamp(),today:new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tashkent',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())};
  const before=structuredClone(cache);
  const {changes,result}=mutation(before,action,fields,ctx);
  if(fields.expectedRevision!==undefined){
    const source={saveClass:'timetable',archiveClass:'timetable',restoreClass:'timetable',saveStudent:'students',archiveStudent:'students',restoreStudent:'archivedStudents',saveLog:'lessonLogs',editLog:'lessonLogs',archiveLog:'lessonLogs',restoreLog:'archivedLessonLogs'}[action];
    if(source){const path=Object.keys(changes).find(p=>p.startsWith(source+'/'));const old=path&&before[source]?.[path.slice(source.length+1)];if((old?.revision||0)!==fields.expectedRevision)throw new Error('This record changed elsewhere. Refresh before saving.');}
  }
  try{
    await update(ref(db,root(uid)),changes);check(uid,epoch);
    // Read server-resolved timestamps before returning a saved result.
    const saved=await Promise.all(Object.entries(changes).map(async([path,value])=>[path,value===null?null:(await get(ref(db,root(uid)+'/'+path))).val()]));
    check(uid,epoch);
    saved.forEach(([path,value])=>{const [section,id]=path.split('/');cache[section]??={};if(value===null)delete cache[section][id];else cache[section][id]=value;});
    if(result==='reload')return viewData(cache);
    const primary=saved.find(([path,value])=>value&&['timetable','lessonLogs','attendanceChecklists','students','classStudents'].includes(path.split('/')[0]))?.[1];
    const resolved=JSON.parse(JSON.stringify(result),(_k,v)=>v&&typeof v==='object'&&v['.sv']==='timestamp'?(primary?.updatedAt||Date.now()):v);
    if(action==='saveClass')resolved.meetings=Object.values(resolved.meetings).sort((a,b)=>a.weekday===resolved.weekday?-1:b.weekday===resolved.weekday?1:a.weekday-b.weekday);
    return resolved;
  }catch(error){throw normalize(error);}
}
