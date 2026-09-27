import { callbackUrl } from './config.js';

export function isExpired(error) {
  return error?.status === 401 || ['TD001', 'PGRST301', 'PGRST303', 'refresh_token_not_found', 'refresh_token_already_used', 'session_not_found'].includes(error?.code);
}

export function errorMessage(error) {
  if (isExpired(error)) return 'Your session expired. Request a new email sign-in link.';
  if (error?.code === 'TD004') return 'Your settings changed in another tab. Reload your workspace before saving again.';
  if (error?.code === 'TD002') return 'These settings could not be saved. Check the name and timezone. Timezone changes require a workspace without schedules.';
  return 'We couldn’t reach your account. Check your connection and try again.';
}

/** Owns session transitions. Generation guards discard late responses from an old account. */
export function createAuthController({ access, render, location, history,
  uuid = () => crypto.randomUUID(), now = () => Date.now(), defer = fn => setTimeout(fn, 0) }) {
  let version = 0;
  let initializing = true;
  let signingOut = false;
  let operation = null;
  let nextEmailAt = 0;
  let state = { phase: 'loading', message: 'Restoring your session…', user: null, workspace: null, hasSchedules: false };
  const publish = patch => { state = { ...state, ...patch }; render(state); };
  const clear = (phase, message = '') => {
    version++;
    operation = null;
    state = { phase, message, user: null, workspace: null, hasSchedules: false };
    render(state);
  };
  const fail = error => {
    if (isExpired(error)) clear('signed-out', errorMessage(error));
    else publish({ phase: 'error', message: errorMessage(error) });
  };

  async function restore(session, ticket = ++version) {
    publish({ phase: 'loading', message: 'Opening your private workspace…' });
    try {
      session = session === undefined ? await access.session() : session;
      if (ticket !== version) return;
      if (!session) { clear('signed-out'); return; }
      const user = await access.user(); // Verify against Auth; cached session alone never opens private UI.
      if (ticket !== version) return;
      if (!user || user.id !== session.user.id || !user.email || !user.email_confirmed_at) {
        clear('signed-out', 'Please sign in using a verified email link.');
        return;
      }
      publish({ user });
      const workspace = await access.workspace(user.id);
      if (ticket !== version) return;
      if (workspace && workspace.owner_id !== user.id) throw new Error('INVALID_WORKSPACE');
      const hasSchedules = workspace ? await access.hasSchedules(workspace.id) : false;
      if (ticket !== version) return;
      operation = null;
      publish({ phase: workspace ? 'ready' : 'onboarding', message: '', user, workspace, hasSchedules, reloadRequired: false });
    } catch (error) { if (ticket === version) fail(error); }
  }

  const unsubscribe = access.subscribe((event, session) => {
    if (event === 'SIGNED_OUT') {
      clear('signed-out', signingOut ? '' : 'Your session ended. Request a new email sign-in link.');
      return;
    }
    if (initializing || signingOut || state.phase === 'signout-error' || event === 'INITIAL_SESSION') return;
    if (!session || (state.user && session.user.id === state.user.id && ['ready', 'onboarding', 'saving'].includes(state.phase))) return;
    clear('loading', 'Opening your private workspace…'); // Clear old DOM before yielding out of Auth callback.
    const ticket = version;
    defer(() => { if (ticket === version) void restore(session, ticket); });
  });

  return {
    get state() { return state; },
    async start() {
      const ticket = ++version;
      publish({ phase: 'loading', message: 'Restoring your session…' });
      const url = new URL(location.href);
      const hash = new URLSearchParams(url.hash.slice(1));
      const callbackError = url.searchParams.get('error') || hash.get('error');
      const code = url.searchParams.get('code');
      const flowId = url.searchParams.get('sb_flow_id');
      // Remove authentication parameters immediately: no codes or error details left in history.
      if (code || callbackError || hash.has('access_token')) history.replaceState(null, '', callbackUrl(location));
      try {
        if (callbackError) {
          clear('signed-out', 'This email link expired or could not be verified. Request a new sign-in link.');
        } else if (code) {
          publish({ phase: 'loading', message: 'Verifying your sign-in link…' });
          const session = await access.exchange(code, flowId);
          if (ticket === version) await restore(session, ticket);
        } else if (hash.has('access_token')) {
          clear('signed-out', 'This sign-in link is not supported. Please request a new email link.');
        } else await restore(undefined, ticket);
      } catch {
        if (ticket === version) clear('signed-out', 'This sign-in link expired or was already used. Request a new link and open it in the same browser you used to request it.');
      } finally { initializing = false; }
    },
    async signIn(email) {
      if (!['signed-out', 'check-email'].includes(state.phase) || signingOut) return;
      email = email.trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
        publish({ message: 'Enter a valid email address.' }); return;
      }
      if (now() < nextEmailAt) {
        publish({ message: 'Please wait one minute before requesting another link. Check your inbox and spam folder.' }); return;
      }
      clear('sending-link', 'Requesting your sign-in link…');
      const ticket = version;
      try {
        await access.signIn(email, callbackUrl(location));
        if (ticket === version) {
          nextEmailAt = now() + 60000;
          publish({ phase: 'check-email', email, message: 'Check your email for a sign-in link. Open the newest link in this browser. It can only be used once.' });
        }
      } catch (error) {
        if (ticket !== version) return;
        if (error.status === 429 || ['over_email_send_rate_limit', 'over_request_rate_limit'].includes(error.code)) {
          nextEmailAt = now() + 60000;
          clear('signed-out', 'Too many sign-in requests. Wait a little before trying again.');
        } else if (error.code === 'email_address_not_authorized') {
          clear('signed-out', 'Email delivery is not yet configured for this address. Contact the dashboard owner.');
        } else clear('signed-out', 'The sign-in link could not be requested. Check your connection and try again.');
      }
    },
    cancel() { if (state.phase === 'check-email') clear('signed-out'); },
    retry() { if (!signingOut) { clear('loading'); return restore(); } },
    async saveProfile({ display_name, timezone }) {
      if (!state.user || !['onboarding', 'ready'].includes(state.phase)) return;
      const phase = state.phase;
      const payload = { display_name: display_name.trim(), timezone: timezone.trim() };
      try {
        if (!payload.display_name || [...payload.display_name].length > 120) throw new Error();
        new Intl.DateTimeFormat('en', { timeZone: payload.timezone }).format();
      } catch { publish({ message: 'Enter a display name (1–120 characters) and a valid timezone.' }); return; }
      const signature = JSON.stringify([state.user.id, state.workspace?.id, state.workspace?.revision, payload]);
      // Preserve the same immutable request ID on retry after uncertain network outcomes.
      if (operation?.signature !== signature) operation = { signature, id: uuid() };
      const ticket = version;
      publish({ phase: 'saving', message: 'Saving your workspace…', reloadRequired: false });
      try {
        const saved = await access.saveProfile(state.workspace, payload, operation.id);
        if (ticket !== version) return;
        if (!saved?.id || saved.owner_id !== state.user.id) throw new Error('INVALID_WORKSPACE');
        // Read back current revision: an idempotent replay may return an older receipt.
        await restore(undefined, ticket);
      } catch (error) {
        if (ticket !== version) return;
        if (isExpired(error)) fail(error);
        else publish({ phase, message: errorMessage(error), reloadRequired: error.code === 'TD004' });
      }
    },
    async signOut() {
      if (signingOut) return;
      signingOut = true;
      clear('signing-out', 'Signing out…');
      try {
        await access.signOut();
        clear('signed-out');
      } catch { clear('signout-error', 'Sign-out could not finish. Your workspace is hidden. Retry sign-out to remove the session from this browser.'); }
      finally { signingOut = false; }
    },
    destroy() { version++; unsubscribe(); }
  };
}
