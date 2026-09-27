import { state } from '../state.js';
import { createAppsScriptAdapter } from './apps-script.js';

/**
 * The only backend selected by the application. UI modules depend on this
 * interface; provider-specific transport and validation belong in the adapter.
 * Every async method returns confirmed data or rejects with an Error.
 * @type {import('./contract.js').DashboardDataAccess}
 */
export const dataAccess = createAppsScriptAdapter(() => state.endpoint);
