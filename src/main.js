import { readConfig } from './config.js';
import { createSupabaseAccess } from './data/supabase.js';
import { createAuthController } from './auth.js';
import { createView } from './view.js';

const view = createView(document);
try {
  const access = createSupabaseAccess(readConfig());
  const controller = createAuthController({
    access, render: view.render, location: window.location, history: window.history
  });
  view.bind(controller);
  void controller.start();
  // A restored back/forward-cache page must recheck Auth before showing account data.
  window.addEventListener('pagehide', () => view.render({ phase: 'loading', message: 'Restoring your session…' }));
  window.addEventListener('pageshow', event => { if (event.persisted) void controller.retry(); });
} catch {
  view.render({ phase: 'setup', message: 'Sign-in isn’t configured yet. Please contact the dashboard owner to finish setup.' });
}
