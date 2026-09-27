export function readConfig(runtime = globalThis.TEACHING_DASHBOARD_CONFIG || {}, env = import.meta.env || {}) {
  const url = (runtime.supabaseUrl || env.VITE_SUPABASE_URL || '').trim();
  const key = (runtime.supabasePublishableKey || env.VITE_SUPABASE_PUBLISHABLE_KEY || '').trim();
  if (!url || !key) throw new Error('SETUP_REQUIRED');
  const parsed = new URL(url);
  const local = ['localhost', '127.0.0.1'].includes(parsed.hostname);
  if ((parsed.protocol !== 'https:' && !(local && parsed.protocol === 'http:')) ||
      parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== '/') {
    throw new Error('INVALID_CONFIGURATION');
  }
  // Legacy anon JWTs are public too; reject service-role and arbitrary JWT keys.
  let anon = false;
  try { anon = JSON.parse(atob(key.split('.')[1])).role === 'anon'; } catch { /* publishable format */ }
  if (!key.startsWith('sb_publishable_') && !anon) throw new Error('INVALID_CONFIGURATION');
  return { url: parsed.origin, key };
}

// The same static entry point handles callbacks, including subdirectory hosting.
// Never take a redirect destination from query parameters.
export function callbackUrl(location) {
  return new URL(location.pathname, location.origin).href;
}
