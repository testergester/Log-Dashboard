import { createClient } from '@supabase/supabase-js';

export function createSupabaseAccess(config, factory = createClient) {
  const client = factory(config.url, config.key, {
    auth: { flowType: 'pkce', detectSessionInUrl: false, persistSession: true, autoRefreshToken: true },
    global: { fetch: (url, options = {}) => fetch(url, {
      ...options,
      signal: options.signal
        ? AbortSignal.any([options.signal, AbortSignal.timeout(20000)])
        : AbortSignal.timeout(20000)
    }) }
  });
  return createAuthAccess(client);
}

function checked(result) {
  if (result.error) throw result.error;
  return result.data;
}

/** Provider boundary: no Supabase SDK calls belong in UI/controller code. */
export function createAuthAccess(client) {
  return {
    subscribe(listener) {
      const { data } = client.auth.onAuthStateChange(listener);
      return () => data.subscription.unsubscribe();
    },
    async signIn(email, emailRedirectTo) {
      checked(await client.auth.signInWithOtp({ email, options: { emailRedirectTo, shouldCreateUser: true } }));
    },
    async exchange(code, flowId) {
      return checked(await client.auth.exchangeCodeForSession(code, flowId ? { flowId } : undefined)).session;
    },
    async session() { return checked(await client.auth.getSession()).session; },
    async user() { return checked(await client.auth.getUser()).user; },
    async signOut() { checked(await client.auth.signOut({ scope: 'local' })); },
    async workspace(ownerId) {
      return checked(await client.from('workspaces').select('id,owner_id,display_name,timezone,revision')
        .eq('owner_id', ownerId).maybeSingle());
    },
    async hasSchedules(workspaceId) {
      return checked(await client.from('schedule_slots').select('id').eq('workspace_id', workspaceId).limit(1)).length > 0;
    },
    async saveProfile(workspace, payload, operationId) {
      return checked(await client.rpc('dashboard_write', {
        p_workspace_id: workspace?.id || null,
        p_operation_id: operationId,
        p_action: workspace ? 'save_workspace' : 'ensure_workspace',
        p_payload: workspace ? { ...payload, expected_revision: workspace.revision } : payload
      }));
    }
  };
}
