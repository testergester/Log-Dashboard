const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'crash-log.js'), 'utf8');
const messages = fs.readFileSync(path.join(root, 'crash-log-messages.js'), 'utf8');

function environment({blocked = false, storage = new Map(), sessions = new Map()} = {}) {
  const documentEvents = {}, windowEvents = {}, timers = new Map();
  let timer = 0;
  const store = values => ({
    get length() { if (blocked) throw Error('Blocked'); return values.size; },
    key(index) { return [...values.keys()][index]; },
    getItem(key) { if (blocked) throw Error('Blocked'); return values.get(key) ?? null; },
    setItem(key, value) { if (blocked) throw Error('Blocked'); values.set(key, value); },
    removeItem(key) { if (blocked) throw Error('Blocked'); values.delete(key); }
  });
  const element = {addEventListener() {}, content: '012345abcdef'};
  const window = {addEventListener(type, handler) { windowEvents[type] = handler; }};
  const context = vm.createContext({
    window, crypto, navigator: {onLine: true}, location: {pathname: '/index.html?secret=never'},
    document: {body: {}, getElementById: () => null, querySelector: () => element, querySelectorAll: () => [{id: 'lesson-notes'}, {id: 'save-all-button'}],
      addEventListener(type, handler) { documentEvents[type] = handler; }},
    localStorage: store(storage), sessionStorage: store(sessions),
    MutationObserver: class { observe() {} },
    setTimeout(callback) { timers.set(++timer, callback); return timer; },
    clearTimeout(id) { timers.delete(id); },
    Date, URL, Blob, confirm: () => true
  });
  vm.runInContext(messages, context);
  vm.runInContext(source, context);
  const log = {...window.CrashLog, read: () => JSON.parse(JSON.stringify(window.CrashLog.read()))};
  return {log, window, documentEvents, windowEvents, storage, sessions};
}

function node({id = '', type = '', tagName = 'INPUT', category = ''} = {}) {
  return {id, type, tagName, value: 'Private lesson text', textContent: 'Private student name',
    classList: {contains: value => value === category}, closest(selector) {
      if (selector === '#diagnostics-dialog' || selector === '.student-row,tr' || selector === '.attendance-group' || selector === '.participation-group') return null;
      return this;
    }, matches: () => true};
}

const first = environment();
const log = first.log;
first.documentEvents.input({type: 'input', target: node({id: 'lesson-notes'})});
log.step('request-start', {action: 'saveLog', requestId: crypto.randomUUID(), password: 'password-secret', notes: 'private-notes'});
const requestId = crypto.randomUUID();
const error = new Error('The request timed out. Try again.');
error.stack = 'Error: Private student name\n    at secretFunction (https://private.example/script.js?v=123&token=password-secret:45:3)';
error.cause = new Error('password-secret student-name private-notes');
const id = log.record(error, {kind: 'request', action: 'saveLog', requestId, durationMs: 215, student: 'private-student'});
log.record(error);
let result = log.read();
assert.equal(result.errors.length, 1, 'handling the same exception twice keeps one error');
assert.equal(result.errors[0].id, id);
assert.equal(result.errors[0].requestId, requestId);
assert.equal(result.errors[0].message, 'The request timed out. Try again.');
assert.deepEqual(result.errors[0].stack, ['script.js:45:3']);
assert.deepEqual(result.errors[0].steps.slice(-3).map(entry => entry.event), ['input', 'request-start', 'request-failure']);
assert.ok(!JSON.stringify(result).includes('password-secret'));
assert.ok(!JSON.stringify(result).includes('private-notes'));
assert.ok(!JSON.stringify(result).includes('private-student'));
assert.ok(!JSON.stringify(result).includes('private.example'));
assert.ok(!JSON.stringify(result).includes('Private student name'));

first.documentEvents.input({type: 'input', target: node({id: 'password-input', type: 'password'})});
first.documentEvents.input({type: 'input', target: node({id: 'username-input'})});
first.documentEvents.input({type: 'input', target: node({id: 'endpoint-input'})});
first.documentEvents.click({type: 'click', target: node({tagName: 'BUTTON', category: 'student-name-button'})});
result = log.read();
assert.equal(result.steps.at(-1).target, 'student-name-button');
assert.ok(!JSON.stringify(result).includes('Private lesson text'));
assert.ok(!result.steps.some(entry => ['password-input', 'username-input', 'endpoint-input'].includes(entry.target)));

first.windowEvents.error({target: first.window, error: new TypeError('Sensitive unknown error')});
first.windowEvents.unhandledrejection({reason: new Error('Private rejection')});
assert.equal(log.read().errors.length, 3);
assert.ok(log.read().errors.some(entry => entry.kind === 'runtime'));
assert.ok(log.read().errors.some(entry => entry.kind === 'unhandled-promise'));
assert.ok(!JSON.stringify(log.read()).includes('Sensitive unknown'));

for (let index = 0; index < 550; index++) log.step('click', {target: 'save-all-button'});
for (let index = 0; index < 110; index++) log.record(new Error('Unknown private error ' + index));
assert.equal(log.read().steps.length, 500);
assert.equal(log.read().errors.length, 100);
assert.equal(log.read().errors.at(-1).steps.length, 30);

const reloaded = environment({storage: first.storage, sessions: first.sessions});
reloaded.log.step('click', {target: 'analysis-search'});
reloaded.log.record(new Error('The request failed.'));
assert.equal(reloaded.log.read().errors.length, 101, 'previous visit errors survive reload');
assert.equal(first.log.read().errors.length, 101, 'active pages share readable logs without overwriting');
assert.ok(reloaded.log.read().errors.at(-1).steps.some(entry => entry.target === 'save-all-button'), 'breadcrumbs span page visits in the same tab');
reloaded.log.clear();
first.windowEvents.storage({key: 'teaching-dashboard-diagnostics-v1:clear'});
assert.equal(reloaded.log.read().errors.length, 0);
assert.equal(first.log.read().steps.length, 0);
assert.equal(first.log.read().errors.length, 0);
first.log.record(error);
assert.equal(first.log.read().errors.length, 1, 'clearing also resets exception deduplication');

const stale = first.log.read().errors[0];
stale.time = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
const oldStorage = new Map([['teaching-dashboard-diagnostics-v1:' + crypto.randomUUID(), JSON.stringify({steps: [], errors: [stale]})]]);
assert.equal(environment({storage: oldStorage}).log.read().errors.length, 0, 'expired logs are excluded');

const unavailable = environment({blocked: true});
unavailable.log.step('click', {target: 'save-all-button'});
unavailable.log.record(new Error('The request failed.'));
assert.equal(unavailable.log.read().storage, 'memory');
assert.equal(unavailable.log.read().errors.length, 1);

const invalid = new Map([['teaching-dashboard-diagnostics-v1:' + crypto.randomUUID(), '{invalid-json']]);
const corrupted = environment({storage: invalid});
assert.equal(corrupted.log.read().steps.length, 1);
assert.equal(corrupted.log.read().errors.length, 0);

const captured = [];
const backend = vm.createContext({Date, console: {log: value => captured.push(value), error: value => captured.push(value)}});
vm.runInContext(fs.readFileSync(path.join(root, 'AppsScript/CrashLogging.gs'), 'utf8'), backend);
const serverError = new Error('Student Private Person has a private-note');
serverError.stack = 'Error: Student Private Person\n    at saveLog_ (ClassesAndLogs:104:9)';
backend.logDashboardRequest_('request-failure', {action: 'saveLog', requestId, token: 'private-token', password: 'private-password', log: {notes: 'private-note'}}, Date.now(), serverError);
assert.equal(JSON.parse(captured[0]).requestId, requestId);
assert.ok(captured[1].stack.includes('saveLog_'));
assert.ok(!captured.map(value => String(value.stack || value)).join('').includes('Private Person'));
assert.ok(!captured.map(value => String(value.stack || value)).join('').includes('private-token'));
assert.ok(!captured.map(value => String(value.stack || value)).join('').includes('private-note'));
backend.console.error = () => { throw Error('Logging unavailable'); };
assert.doesNotThrow(() => backend.logDashboardRequest_('request-failure', {action: 'load'}, Date.now(), serverError));

const backendEntries = [];
const entrypoints = vm.createContext({Date, console: {log: value => backendEntries.push(JSON.parse(value)), error() {}},
  requireSession_: () => {}, loadDashboard_: () => ({classes: [], logs: []}), response_: value => value});
vm.runInContext(fs.readFileSync(path.join(root, 'AppsScript/AppsScript.gs'), 'utf8'), entrypoints);
vm.runInContext(fs.readFileSync(path.join(root, 'AppsScript/CrashLogging.gs'), 'utf8'), entrypoints);
const apiRequest = {parameter: {}, postData: {contents: JSON.stringify({action: 'load', requestId, token: 'private-token'})}};
let response = entrypoints.doPost(apiRequest);
assert.equal(response.ok, true);
assert.equal(response.requestId, requestId);
assert.deepEqual(backendEntries.map(entry => entry.event), ['request-start', 'request-success']);
entrypoints.loadDashboard_ = () => { throw serverError; };
response = entrypoints.doPost(apiRequest);
assert.equal(response.ok, false);
assert.equal(response.requestId, requestId);
entrypoints.console.log = () => { throw Error('Logging unavailable'); };
entrypoints.console.error = () => { throw Error('Logging unavailable'); };
entrypoints.loadDashboard_ = () => ({classes: [], logs: []});
assert.equal(entrypoints.doPost(apiRequest).ok, true, 'logging failure cannot break an API request');

for (const name of ['index.html', 'analysis.html']) {
  const html = fs.readFileSync(path.join(root, name), 'utf8');
  assert.ok(html.indexOf('./crash-log-messages.js') < html.indexOf('./crash-log.js'));
  assert.ok(html.indexOf('./crash-log.js') < html.indexOf(name === 'index.html' ? './script.js' : './analysis-model.js'));
  for (const asset of ['crash-log.js', 'crash-log-messages.js', name === 'index.html' ? 'script.js' : 'analysis.js', 'styles.css']) {
    const contents = fs.readFileSync(path.join(root, asset));
    const hash = crypto.createHash('sha1').update('blob ' + contents.length + '\0').update(contents).digest('hex').slice(0, 12);
    assert.ok(html.includes('./' + asset + '?v=' + hash), 'Refresh cache version for ' + asset + ' in ' + name);
  }
}
console.log('Crash log checks passed: ordered breadcrumbs, privacy, duplicate handling, retention bounds, reload and tab history, clearing, unavailable storage, backend tracing and asset versions.');
