const KEY = 'teaching-dashboard-tab-id';
const CHANNEL = 'teaching-dashboard-tab-identity';

export async function createTabIdentity({ storage = null, BroadcastChannel = null,
  uuid = () => crypto.randomUUID(), waitMs = 80, navigationType = 'navigate' } = {}) {
  let id;
  try { id = storage?.getItem(KEY); } catch { /* A fresh identity is safe. */ }
  if (!id || navigationType !== 'reload') id = uuid();
  const channel = BroadcastChannel ? new BroadcastChannel(CHANNEL) : null;
  if (channel) {
    const requestId = uuid();
    let collision = false;
    channel.addEventListener('message', event => {
      const data = event.data;
      if (data?.kind === 'probe' && data.id === id && data.requestId !== requestId)
        channel.postMessage({ kind: 'active', id, requestId: data.requestId });
      if (data?.kind === 'active' && data.id === id && data.requestId === requestId) collision = true;
    });
    channel.postMessage({ kind: 'probe', id, requestId });
    await new Promise(resolve => setTimeout(resolve, waitMs));
    if (collision) id = uuid();
  }
  try { storage?.setItem(KEY, id); } catch { /* The identity remains unique for this page. */ }
  return { id, close: () => channel?.close() };
}
