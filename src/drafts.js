const DATABASE = 'teaching-dashboard-drafts';
const SCHEMA = 1;
const STORE = 'records';
const LEASE_MS = 15000;
const JOURNAL_PREFIX = 'teaching-dashboard-pending:';

export const draftKey = (userId, workspaceId, meetingKey, recordType) =>
  JSON.stringify([userId, workspaceId, meetingKey, recordType]);

export function createDraftStore({ indexedDB = globalThis.indexedDB, BroadcastChannel = globalThis.window?.BroadcastChannel,
  sessionStorage = null,
  now = () => Date.now(), tabId = crypto.randomUUID() } = {}) {
  let database;
  const channel = BroadcastChannel ? new BroadcastChannel('teaching-dashboard-drafts') : null;
  const revokedAccounts = new Set();
  const journalKey = key => `${JOURNAL_PREFIX}${key}`;
  function staged(key) {
    try { return JSON.parse(sessionStorage?.getItem(journalKey(key)) || 'null'); }
    catch { return null; }
  }
  function stagedForAccount(userId) {
    const found = [];
    try {
      for (let index = 0; index < sessionStorage.length; index++) {
        const key = sessionStorage.key(index);
        if (!key?.startsWith(JOURNAL_PREFIX)) continue;
        const value = staged(key.slice(JOURNAL_PREFIX.length));
        if (value?.userId === userId) found.push(value);
      }
    } catch { /* IndexedDB remains the durable source. */ }
    return found;
  }
  function unstage(key, version) {
    try { if ((staged(key)?.version || 0) <= version) sessionStorage?.removeItem(journalKey(key)); }
    catch { /* A confirmed IndexedDB write still succeeded. */ }
  }
  function clearStagedAccount(userId) {
    let failure;
    for (const entry of stagedForAccount(userId)) {
      try { sessionStorage?.removeItem(journalKey(entry.key)); }
      catch (error) { failure ||= error; }
    }
    return failure;
  }
  function open() {
    if (!indexedDB) return Promise.reject(new Error('DEVICE_STORAGE_UNAVAILABLE'));
    if (!database) database = new Promise((resolve, reject) => {
      const request = indexedDB.open(DATABASE, SCHEMA);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'key' });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('DEVICE_STORAGE_UNAVAILABLE'));
      request.onblocked = () => reject(new Error('DEVICE_STORAGE_UNAVAILABLE'));
    }).catch(error => { database = null; throw error; });
    return database;
  }
  async function transaction(mode, action) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const store = tx.objectStore(STORE);
      let value;
      let failure;
      tx.oncomplete = () => resolve(value);
      tx.onerror = () => reject(failure || tx.error || new Error('DEVICE_STORAGE_UNAVAILABLE'));
      tx.onabort = () => reject(failure || tx.error || new Error('DEVICE_STORAGE_UNAVAILABLE'));
      action(store, result => { value = result; }, error => { failure = error; tx.abort(); });
    });
  }
  function clearRows(userId) {
    return transaction('readwrite', (store, done) => {
      const request = store.openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) { done(); return; }
        if (cursor.value.userId === userId) cursor.delete();
        cursor.continue();
      };
    });
  }
  channel?.addEventListener('message', event => {
    const data = event.data;
    if (data?.kind !== 'discard-account' || data.tabId === tabId) return;
    revokedAccounts.add(data.userId);
    clearStagedAccount(data.userId);
    void clearRows(data.userId).catch(() => {});
  });
  return {
    tabId,
    close() { channel?.close(); },
    stage(entry) {
      if (revokedAccounts.has(entry.userId)) return false;
      try {
        sessionStorage.setItem(journalKey(entry.key), JSON.stringify({ ...entry, schemaVersion: SCHEMA, tabId }));
        return true;
      } catch { return false; }
    },
    subscribe(listener) {
      if (!channel) return () => {};
      const receive = event => { if (event.data?.tabId !== tabId) listener(event.data); };
      channel.addEventListener('message', receive);
      return () => channel.removeEventListener('message', receive);
    },
    async get(key) {
      try { if (revokedAccounts.has(JSON.parse(key)[0])) return null; } catch { /* Invalid keys cannot match an account. */ }
      const pending = staged(key);
      if (pending && revokedAccounts.has(pending.userId)) return null;
      let saved;
      try {
        saved = await transaction('readonly', (store, done) => {
          const request = store.get(key);
          request.onsuccess = () => done(request.result || null);
        });
      } catch (error) {
        if (pending) return { ...pending, status: 'storageFailed' };
        throw error;
      }
      if (!pending || pending.version <= (saved?.version || 0)) {
        if (pending) unstage(key, pending.version);
        return saved;
      }
      try { return await this.put(pending); }
      catch (error) { return { ...pending, status: error.message?.startsWith('DRAFT_') ? 'blocked' : 'storageFailed' }; }
    },
    async put(draft, { takeover = false } = {}) {
      if (revokedAccounts.has(draft.userId)) throw new Error('ACCOUNT_SIGNED_OUT');
      const saved = await transaction('readwrite', (store, done, fail) => {
        const request = store.get(draft.key);
        request.onsuccess = () => {
          if (revokedAccounts.has(draft.userId)) { fail(new Error('ACCOUNT_SIGNED_OUT')); return; }
          const previous = request.result;
          if (previous?.tabId && previous.tabId !== tabId && previous.leaseUntil > now() && !takeover) {
            fail(new Error('DRAFT_OWNED_BY_ANOTHER_TAB')); return;
          }
          if (previous && previous.version > draft.version && !takeover) {
            fail(new Error('DRAFT_CHANGED_IN_ANOTHER_TAB')); return;
          }
          const next = { ...draft, schemaVersion: SCHEMA, tabId, leaseUntil: now() + LEASE_MS, editedAt: now() };
          store.put(next); done(next);
        };
      });
      unstage(saved.key, saved.version);
      channel?.postMessage({ key: saved.key, tabId, version: saved.version });
      return saved;
    },
    async renew(key) {
      return transaction('readwrite', (store, done) => {
        const request = store.get(key);
        request.onsuccess = () => {
          const current = request.result;
          if (current?.tabId !== tabId) { done(false); return; }
          store.put({ ...current, leaseUntil: now() + LEASE_MS }); done(true);
        };
      });
    },
    async deleteVersion(key, version) {
      const deleted = await transaction('readwrite', (store, done) => {
        const request = store.get(key);
        request.onsuccess = () => {
          if (request.result?.version === version && request.result.tabId === tabId) { store.delete(key); done(true); }
          else done(false);
        };
      });
      if (deleted) unstage(key, version);
      return deleted;
    },
    async listForAccount(userId) {
      const stagedEntries = stagedForAccount(userId);
      const saved = await transaction('readonly', (store, done) => {
        const found = [];
        const request = store.openCursor();
        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor) { done(found); return; }
          if (cursor.value.userId === userId) found.push(cursor.value);
          cursor.continue();
        };
      });
      const combined = new Map(saved.map(entry => [entry.key, entry]));
      for (const entry of stagedEntries) if (entry.version > (combined.get(entry.key)?.version || 0)) combined.set(entry.key, entry);
      return [...combined.values()];
    },
    async clearAccount(userId) {
      revokedAccounts.add(userId);
      let failure;
      try { await clearRows(userId); } catch (error) { failure = error; }
      const journalFailure = clearStagedAccount(userId);
      failure ||= journalFailure;
      channel?.postMessage({ kind: 'discard-account', userId, tabId });
      if (failure) throw failure;
    }
  };
}
