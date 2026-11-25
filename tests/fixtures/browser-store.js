// Browser-only transport fixture, served by Playwright in place of the Firebase
// module. Uses the real domain model; never connects to a Firebase project.
import {mutation, viewData} from '/src/data-model.js';
export const configured = true, emulatorMode = false;
let user = localStorage.getItem('astryx-test-user') ? {uid: 'browser-teacher'} : null;
let db = JSON.parse(localStorage.getItem('astryx-test-data') || '{}');
const observers = new Set();
export const currentUser = () => user;
export const connected = () => true;
export const historyRange = date => ({start: date.slice(0, 4) + '-01-01', end: date.slice(0, 4) + '-12-31'});
export function observeAuth(fn) { observers.add(fn); queueMicrotask(() => fn(user)); return () => observers.delete(fn); }
export function observeConnection(fn) { fn(true); return () => {}; }
export async function login() { user = {uid: 'browser-teacher'}; localStorage.setItem('astryx-test-user', 'true'); observers.forEach(fn => fn(user)); }
export async function logout() { user = null; localStorage.removeItem('astryx-test-user'); observers.forEach(fn => fn(null)); }
export function watch(_range, fn) { queueMicrotask(() => fn(viewData(db))); return () => {}; }
export async function request(action, fields) {
  if (!user || fields.token !== user.uid) throw new Error('Session expired.');
  if (action === 'load') return viewData(db);
  const today = new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Tashkent', year: 'numeric', month: '2-digit', day: '2-digit'}).format(new Date());
  const {changes, result} = mutation(db, action, fields, {uuid: () => crypto.randomUUID(), today, timestamp: Date.now()});
  for (const [path, value] of Object.entries(changes)) {
    const [section, id] = path.split('/');
    db[section] ??= {};
    if (value === null) delete db[section][id];
    else db[section][id] = value;
  }
  localStorage.setItem('astryx-test-data', JSON.stringify(db));
  if (action === 'saveClass') return {...result, meetings: Object.values(result.meetings)};
  return result === 'reload' ? viewData(db) : result;
}
