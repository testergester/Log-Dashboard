import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createAppsScriptAdapter } from '../src/data/apps-script.js';

const endpoint = 'https://script.google.com/macros/s/test/exec';
const response = (requestId, data) => ({ok: true, type: 'cors', json: async () => ({ok: true, requestId, data})});

test('adapter preserves every action, payload, request ID, and confirmed response', async () => {
  let url = endpoint;
  const calls = [];
  const saved = {revision: 'confirmed', checklist: {records: []}};
  const adapter = createAppsScriptAdapter(() => url, async (actual, options) => {
    const body = JSON.parse(options.body);
    calls.push({actual, options, body});
    return response(body.requestId, saved);
  });
  for (const action of ['login', 'logout', 'load', 'saveClass', 'archiveClass', 'saveLog', 'saveStudent', 'setEnrollment', 'saveChecklist']) {
    const payload = {token: 'session', checklist: {revision: 'base', records: [{note: 'submitted'}]}};
    assert.deepEqual(await adapter[action](payload), saved);
    const {actual, options, body} = calls.at(-1);
    assert.equal(actual, url);
    assert.deepEqual(body, {...payload, action, requestId: body.requestId});
    assert.match(body.requestId, /^[a-f0-9-]{36}$/);
    assert.equal(options.method, 'POST');
    assert.equal(options.headers['Content-Type'], 'text/plain;charset=utf-8');
    assert.equal(options.cache, 'no-store');
    assert.equal(options.redirect, 'follow');
    url = endpoint.replace('test', action);
  }
  assert.equal(new Set(calls.map(call => call.body.requestId)).size, calls.length);
});

test('adapter validates connections and refuses requests without an endpoint', async () => {
  const adapter = createAppsScriptAdapter(() => '', () => { throw new Error('unexpected network'); });
  assert.equal(adapter.validEndpoint(endpoint), true);
  for (const invalid of ['http://script.google.com/macros/s/test/exec', endpoint + '?x=1', endpoint + '#x', 'https://example.com/exec', 'invalid']) {
    assert.equal(adapter.validEndpoint(invalid), false);
  }
  await assert.rejects(adapter.load({token: 'test'}), /URL first/);
});

for (const [name, transport, message] of [
  ['network failure', async () => { throw new Error('offline'); }, /Could not reach/],
  ['timeout', async () => { throw Object.assign(new Error(), {name: 'AbortError'}); }, /timed out/],
  ['HTTP failure', async () => ({ok: false}), /unreadable response/],
  ['opaque response', async () => ({ok: true, type: 'opaque'}), /unreadable response/],
  ['invalid JSON', async () => ({ok: true, json: async () => { throw new Error(); }}), /did not return JSON/],
  ['mismatched response', async () => response('wrong', {}), /mismatched response/],
  ['expired session', async (_, options) => ({ok: true, json: async () => ({requestId: JSON.parse(options.body).requestId, ok: false, error: 'Session expired'})}), /Session expired/],
  ['attendance conflict', async (_, options) => ({ok: true, json: async () => ({requestId: JSON.parse(options.body).requestId, ok: false, error: 'Checklist changed on another device'})}), /changed on another device/]
]) {
  test(`adapter rejects ${name}`, async () => {
    const adapter = createAppsScriptAdapter(() => endpoint, transport);
    await assert.rejects(adapter.saveChecklist({token: 'test', checklist: {revision: 'old'}}), message);
  });
}
