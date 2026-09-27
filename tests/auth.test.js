import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { createAuthController } from '../src/auth.js';
import { createView } from '../src/view.js';
import { readConfig, callbackUrl } from '../src/config.js';
import { createAuthAccess, createSupabaseAccess } from '../src/data/supabase.js';

const teacher = id => ({ id, email: `${id}@example.com`, email_confirmed_at: '2026-09-26T00:00:00Z', app_metadata: { provider: 'email' }, user_metadata: { full_name: `Teacher ${id}` } });
const ws = id => ({ id: `workspace-${id}`, owner_id: id, display_name: `Teacher ${id}`, timezone: 'Asia/Tashkent', revision: 1 });
const settle = () => new Promise(resolve => setImmediate(resolve));
function harness({ href = 'http://127.0.0.1:4173/', user = teacher('a'), workspace = ws('a'), overrides = {} } = {}) {
  const dom = new JSDOM(readFileSync(new URL('../index.html', import.meta.url), 'utf8'), { url: href });
  const view = createView(dom.window.document);
  let listener;
  let counter = 0;
  let savedWorkspace = workspace;
  const calls = [];
  const access = {
    subscribe(fn) { listener = fn; return () => {}; },
    async session() { return user ? { user } : null; },
    async user() { return user; },
    async workspace() { return savedWorkspace; },
    async hasSchedules() { return false; },
    async exchange(code, flowId) { calls.push(['exchange', code, flowId]); return { user }; },
    async signIn(email, url) { calls.push(['signIn', email, url]); },
    async signOut() { listener('SIGNED_OUT', null); },
    async saveProfile(workspace, payload, id) { calls.push(['save', workspace, payload, id]); savedWorkspace = { ...ws(user.id), ...payload }; return savedWorkspace; },
    ...overrides
  };
  const controller = createAuthController({ access, render: view.render, location: dom.window.location, history: dom.window.history,
    uuid: () => `operation-${++counter}`, defer: fn => setImmediate(fn) });
  view.bind(controller);
  return { controller, access, calls, dom, $: s => dom.window.document.querySelector(s), event: (...args) => listener(...args) };
}

test('new email teacher completes onboarding once and first-use actions remain unavailable', async () => {
  const h = harness({ workspace: null });
  await h.controller.start();
  assert.equal(h.controller.state.phase, 'onboarding');
  assert.equal(h.$('#timezone').value, 'Asia/Tashkent');
  assert.equal(h.$('#workspace').hidden, true);
  await h.controller.saveProfile({ display_name: ' Teacher A ', timezone: 'Asia/Tashkent' });
  assert.equal(h.controller.state.phase, 'ready');
  assert.equal(h.calls.filter(c => c[0] === 'save').length, 1);
  assert.equal(h.$('#workspace').hidden, false);
  assert.equal(h.$('#workspace-title').textContent, 'Welcome, Teacher A');
  assert.ok([...h.$('#workspace').querySelectorAll('button')].every(button => button.disabled));
});

test('callback exchanges once, strips sensitive URL parameters, and returning teacher never bootstraps', async () => {
  const h = harness({ href: 'http://127.0.0.1:4173/?code=one-time&sb_flow_id=flow-one&next=https://evil.test' });
  await h.controller.start();
  assert.equal(h.dom.window.location.href, 'http://127.0.0.1:4173/');
  assert.equal(h.controller.state.phase, 'ready');
  assert.deepEqual(h.calls, [['exchange', 'one-time', 'flow-one']]);
  await h.controller.start();
  assert.deepEqual(h.calls, [['exchange', 'one-time', 'flow-one']]);
});

test('Email-link error and replay failure cannot fall back to an old stored account', async () => {
  for (const href of ['?error=access_denied&error_description=untrusted', '?code=used']) {
    const h = harness({ href: `http://127.0.0.1:4173/${href}`, overrides: { async exchange() { throw Error('used'); } } });
    await h.controller.start();
    assert.equal(h.controller.state.phase, 'signed-out');
    assert.equal(h.$('#workspace').hidden, true);
    assert.equal(h.$('#connection-state').textContent, 'Not connected');
    assert.doesNotMatch(h.$('#auth-status').textContent, /untrusted/);
  }
});

test('account switching clears DOM synchronously and rejects old in-flight workspace responses', async () => {
  const h = harness();
  await h.controller.start();
  h.$('#settings-button').click();
  assert.equal(h.$('#settings-name').value, 'Teacher a');
  let resolveB;
  h.access.user = async () => teacher('b');
  h.access.workspace = () => new Promise(resolve => { resolveB = resolve; });
  h.event('SIGNED_IN', { user: teacher('b') });
  assert.equal(h.$('#settings-name').value, '');
  assert.equal(h.$('#workspace-title').textContent, '');
  assert.equal(h.$('#account-email').textContent, '');
  await settle();
  h.event('SIGNED_OUT', null);
  resolveB(ws('b'));
  await settle();
  assert.equal(h.controller.state.phase, 'signed-out');
  assert.equal(h.controller.state.workspace, null);
  assert.equal(h.$('#workspace-title').textContent, '');
  h.access.workspace = async () => ws('b');
  h.event('SIGNED_IN', { user: teacher('b') });
  await settle(); await settle();
  assert.equal(h.$('#workspace-title').textContent, 'Welcome, Teacher b');
});

test('expired sessions and failed user verification never show connected content', async () => {
  for (const error of [{ status: 401 }, Error('offline')]) {
    const h = harness({ overrides: { async user() { throw error; } } });
    await h.controller.start();
    assert.equal(h.$('#workspace').hidden, true);
    assert.equal(h.$('#connection-state').textContent, 'Not connected');
    assert.equal(h.controller.state.user, null);
    h.access.user = async () => teacher('a');
    await h.controller.retry();
    assert.equal(h.controller.state.phase, 'ready');
  }
});

test('uncertain profile saves retry the same operation and retain user input', async () => {
  let fail = true;
  const requests = [];
  const h = harness({ workspace: null, overrides: { async saveProfile(workspace, payload, id) {
    requests.push({ workspace, payload, id });
    if (fail) throw Error('lost response');
    h.access.workspace = async () => ws('a');
    return ws('a');
  } } });
  await h.controller.start();
  h.$('#display-name').value = 'Custom name';
  const payload = { display_name: 'Custom name', timezone: 'Asia/Tashkent' };
  await h.controller.saveProfile(payload);
  assert.equal(h.$('#display-name').value, 'Custom name');
  assert.equal(h.controller.state.phase, 'onboarding');
  fail = false;
  await h.controller.saveProfile(payload);
  assert.equal(requests[0].id, requests[1].id);
  assert.deepEqual(requests[0].payload, requests[1].payload);
  assert.equal(h.controller.state.phase, 'ready');
});

test('a successful settings retry clears an earlier revision-conflict reload state', async () => {
  let conflict = true;
  const h = harness({ overrides: { async saveProfile(workspace, payload) {
    if (conflict) throw { code: 'TD004' };
    return { ...workspace, ...payload, revision: workspace.revision + 1 };
  } } });
  await h.controller.start();
  const payload = { display_name: 'Teacher A', timezone: 'Asia/Tashkent' };
  await h.controller.saveProfile(payload);
  assert.equal(h.controller.state.reloadRequired, true);
  assert.equal(h.$('#retry-button').textContent, 'Reload workspace');
  conflict = false;
  await h.controller.saveProfile(payload);
  assert.equal(h.controller.state.phase, 'ready');
  assert.equal(h.controller.state.reloadRequired, false);
  assert.equal(h.$('#retry-button').hidden, true);
});

test('settings lock timezone after schedules and display identity safely as text', async () => {
  const h = harness({ workspace: { ...ws('a'), display_name: '<img src=x onerror=alert(1)>' }, overrides: { async hasSchedules() { return true; } } });
  await h.controller.start();
  h.$('#settings-button').click();
  assert.equal(h.$('#settings-timezone').disabled, true);
  assert.equal(h.$('#account-email').textContent, 'Email: a@example.com');
  assert.equal(h.$('#workspace-title img'), null);
});

test('sign-out failure hides all account data and offers an explicit retry', async () => {
  const h = harness({ overrides: { async signOut() { throw Error('offline'); } } });
  await h.controller.start();
  await h.controller.signOut();
  assert.equal(h.controller.state.phase, 'signout-error');
  assert.equal(h.$('#workspace-title').textContent, '');
  assert.equal(h.$('#retry-button').textContent, 'Retry sign-out');
  h.access.signOut = async () => {};
  await h.controller.signOut();
  assert.equal(h.controller.state.phase, 'signed-out');
});

test('email requests stay signed out, can be retried, and same-account refresh keeps settings edits', async () => {
  const h = harness({ user: null });
  await h.controller.start();
  await h.controller.signIn('teacher@example.com');
  assert.equal(h.controller.state.phase, 'check-email');
  assert.equal(h.$('#workspace').hidden, true);
  assert.deepEqual(h.calls, [['signIn', 'teacher@example.com', 'http://127.0.0.1:4173/']]);
  await h.controller.signIn('teacher@example.com');
  assert.equal(h.calls.length, 1);
  h.controller.cancel();
  assert.equal(h.controller.state.phase, 'signed-out');
  const r = harness(); await r.controller.start();
  r.$('#settings-button').click(); r.$('#settings-name').value = 'Unsaved name';
  r.event('TOKEN_REFRESHED', { user: teacher('a') });
  assert.equal(r.$('#settings-name').value, 'Unsaved name');
});

test('failed email delivery never claims a link was sent or an account connected', async () => {
  for (const error of [{ status: 429 }, { code: 'email_address_not_authorized' }, Error('offline')]) {
    const h = harness({ user: null, overrides: { async signIn() { throw error; } } });
    await h.controller.start();
    await h.controller.signIn('teacher@example.com');
    assert.equal(h.controller.state.phase, 'signed-out');
    assert.equal(h.$('#connection-state').textContent, 'Not connected');
    assert.equal(h.$('#email-button').disabled, false);
  }
});

test('Supabase boundary sets PKCE, exact email-link parameters, revisions and operation IDs', async () => {
  let options;
  createSupabaseAccess({ url: 'https://example.supabase.co', key: 'public' }, (url, key, value) => { options = value; return {}; });
  assert.deepEqual(options.auth, { flowType: 'pkce', detectSessionInUrl: false, persistSession: true, autoRefreshToken: true });
  const calls = [];
  const access = createAuthAccess({ auth: {
    async signInWithOtp(input) { calls.push(input); return { data: {} }; }
  }, async rpc(name, input) { calls.push([name, input]); return { data: ws('a') }; } });
  await access.signIn('teacher@example.com', 'http://127.0.0.1:4173/');
  assert.deepEqual(calls[0], { email: 'teacher@example.com', options: { shouldCreateUser: true, emailRedirectTo: 'http://127.0.0.1:4173/' } });
  await access.saveProfile(ws('a'), { display_name: 'A', timezone: 'UTC' }, 'op');
  assert.equal(calls[1][1].p_payload.expected_revision, 1);
  assert.equal(calls[1][1].p_operation_id, 'op');
  await access.saveProfile(null, { display_name: 'A', timezone: 'UTC' }, 'op2');
  assert.equal(calls[2][1].p_action, 'ensure_workspace');
  assert.equal(calls[2][1].p_workspace_id, null);
});

test('configuration rejects privileged keys and callback ignores untrusted destinations', () => {
  const url = 'https://example.supabase.co';
  assert.throws(() => readConfig({ supabaseUrl: url, supabasePublishableKey: 'sb_secret_test' }, {}));
  const jwt = role => `x.${btoa(JSON.stringify({ role }))}.x`;
  assert.throws(() => readConfig({ supabaseUrl: url, supabasePublishableKey: jwt('service_role') }, {}));
  assert.equal(readConfig({ supabaseUrl: url, supabasePublishableKey: jwt('anon') }, {}).url, url);
  assert.equal(callbackUrl(new URL('https://example.com/app/?next=https://evil.test#x')), 'https://example.com/app/');
});
