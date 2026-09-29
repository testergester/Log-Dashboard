import { readConfig } from './config.js';
import { createSupabaseAccess } from './data/supabase.js';
import { createAuthController } from './auth.js';
import { createView } from './view.js';
import { createDashboardController } from './dashboard.js';
import { createDraftStore } from './drafts.js';
import { createTabIdentity } from './tab-identity.js';

function draftSessionStorage() {
  try { return window.sessionStorage; } catch { return null; }
}

function confirmDiscard(count) {
  return new Promise(resolve => {
    const dialog = document.createElement('dialog');
    dialog.className = 'dashboard-signout-dialog';
    dialog.innerHTML = `<h2>Discard drafts and sign out?</h2><p>${count} unfinished ${count === 1 ? 'record is' : 'records are'} saved on this device. Signing out will discard them.</p>`;
    const cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'button button-secondary'; cancel.textContent = 'Cancel';
    const discard = document.createElement('button'); discard.type = 'button'; discard.className = 'button button-primary'; discard.textContent = 'Discard and sign out';
    const finish = result => { dialog.close(); dialog.remove(); resolve(result); };
    cancel.addEventListener('click', () => finish(false)); discard.addEventListener('click', () => finish(true));
    dialog.addEventListener('cancel', event => { event.preventDefault(); finish(false); });
    dialog.append(cancel, discard); document.body.append(dialog); dialog.showModal(); cancel.focus();
  });
}

const view = createView(document);
async function start() {
 try {
  const access = createSupabaseAccess(readConfig());
  const identity = await createTabIdentity({ storage: draftSessionStorage(), BroadcastChannel: window.BroadcastChannel,
    navigationType: performance.getEntriesByType('navigation')[0]?.type });
  const drafts = createDraftStore({ tabId: identity.id, sessionStorage: draftSessionStorage() });
  let controller;
  const dashboard = createDashboardController({ access, drafts, render: view.renderDashboard,
    onAuthError: () => controller?.retry(), onAccountDiscarded: () => { void controller?.signOut({ skipDraftPrompt: true }); } });
  const render = state => {
    view.render(state);
    if ((state.phase === 'ready' || state.phase === 'saving') && state.workspace) dashboard.open(state.workspace, state.user.id);
    else dashboard.close();
  };
  controller = createAuthController({ access, render, location: window.location, history: window.history,
    beforeSignOut: async accountId => {
      await dashboard.flush();
      try { const entries = await drafts.listForAccount(accountId); return !entries.length || confirmDiscard(entries.length); }
      catch { return window.confirm('Device storage could not be checked. Discard any unfinished work and sign out?'); }
    },
    afterSignOut: accountId => drafts.clearAccount(accountId) });
  view.bind(controller);
  void controller.start();
  // A restored back/forward-cache page must recheck Auth before showing account data.
  window.addEventListener('pagehide', () => { void dashboard.flush(); identity.close(); view.render({ phase: 'loading', message: 'Restoring your session…' }); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') void dashboard.flush(); });
  window.addEventListener('pageshow', event => { if (event.persisted) window.location.reload(); });
} catch {
  view.render({ phase: 'setup', message: 'Sign-in isn’t configured yet. Please contact the dashboard owner to finish setup.' });
}
}
void start();
