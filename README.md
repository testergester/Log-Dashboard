# Teaching dashboard

A vanilla JavaScript teaching timetable, lesson log, and student attendance dashboard. Phase One introduced Vite and frontend modules. Phase Two adds a tested Supabase database foundation in [`supabase/`](supabase/README.md); the active frontend still uses the existing Apps Script backend and interface.

## Local setup

Use Node.js 22.12+ (Node 24 LTS recommended) and pnpm 11.19.0. Install pnpm with `npm install --global pnpm@11.19.0` if needed.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Open the local URL printed by Vite. Use the existing Apps Script credentials to sign in. For read-only inspection, stay on the sign-in page; saving while signed in still writes to the configured backend.

```sh
pnpm test      # All frontend, legacy backend, adapter, and PostgreSQL database tests
pnpm test:db   # Recreate migrations and test database rules in embedded PostgreSQL
pnpm build     # Build static assets into dist/
pnpm preview   # Serve the production build locally
```

The committed `pnpm-lock.yaml` pins dependencies. `pnpm-workspace.yaml` permits only esbuild's required installation script. Tests use Node's experimental VM module support to load the real ES module graph in an isolated DOM; the corresponding Node warning is expected. Frontend tests mock backend responses and never contact Apps Script. Database tests use embedded PostgreSQL with test-only identities; see [database setup and contracts](supabase/README.md).

Deploy the **contents of `dist/`** to a static host after building. Relative asset paths support hosting under a subdirectory. Opening `index.html` as a local file or publishing the unbuilt source is no longer the supported workflow. No backend deployment is required for Phase One.

## Runtime configuration

Edit `public/config.js` before building. Vite copies it unchanged to `dist/config.js`, which can also be edited after building without recompiling JavaScript.

- `appsScriptEndpoint`: the deployed HTTPS Apps Script `/exec` URL. The existing endpoint is retained to preserve behavior. Use an empty string to require connection setup on first use.
- `timezone`: defaults to `Asia/Tashkent`. Keep this aligned with the existing backend's timezone; this phase does not introduce per-account timezone settings.

Configuration is public. Never place passwords, session tokens, or privileged keys in this file. An endpoint previously entered in Settings takes precedence over the configured default. The existing local storage keys for the endpoint and session remain unchanged. To change connections through the UI, sign out, open Settings, and enter the new URL.

## Frontend structure

| File | Responsibility |
| --- | --- |
| `src/main.js` | Register feature event handlers and restore the session |
| `src/config.js`, `public/config.js` | Read public runtime settings; retain app constants |
| `src/state.js` | Shared application state and confirmed-record upsert helper |
| `src/auth.js` | Connection settings, login/logout, session restoration and expiry |
| `src/data/contract.js` | Document the data-access interface |
| `src/data/index.js` | Select and expose the backend adapter |
| `src/data/apps-script.js` | Apps Script endpoint validation, transport, request IDs, timeout, and errors |
| `src/dashboard.js` | Validate loaded data and apply it to application state |
| `src/scheduling.js` | Date navigation, day/week timetable, class editing and archiving |
| `src/lesson-records.js` | Lesson editing/saving and previous notes |
| `src/attendance.js` | Roster rendering, checklist editing/saving, and confirmed attendance updates |
| `src/students.js` | Student identity, enrollment, creation, renaming, and removal |
| `src/drafts.js` | Existing in-memory lesson and attendance drafts |
| `src/reports.js` | Existing student history and scoring summaries |
| `src/ui.js`, `src/dom.js`, `src/dates.js` | Shared rendering, DOM selection, and date/time helpers |

Feature modules register listeners explicitly through `bind…()` functions. They share the existing state object and invoke rendering after changes. Cross-feature function imports are evaluated at startup but called only after initialization. Keep module top-level work free of rendering or network requests; `main.js` owns startup.

## Data-access contract

UI modules use `dataAccess` from `src/data/index.js`; they must not call `fetch`, Apps Script transport, or a future Supabase client directly. The adapter reads the current endpoint on each request, preserving Settings behavior.

| Method | Input | Confirmed result |
| --- | --- | --- |
| `validEndpoint` | URL string | Boolean (synchronous) |
| `login` | `{username, password}` | Session `{token, expiresAt}` |
| `logout` | `{token}` | Backend logout acknowledgement |
| `load` | `{token}` | Classes/logs and, when supported, all four student-data arrays |
| `saveClass` | `{token, class}` | Saved class with canonical ID and timestamps |
| `archiveClass` | `{token, classId}` | Archived class ID and timestamp |
| `saveLog` | `{token, log}` | Saved lesson log including meeting snapshots |
| `saveStudent` | `{token, student}` | Saved student and optional enrollment |
| `setEnrollment` | `{token, classId, studentId, active}` | Saved enrollment |
| `saveChecklist` | `{token, checklist}` | Class/date, new revision, timestamp, and canonical checklist records |

Every asynchronous method returns a Promise and rejects with an Error on failure. Payload fields and records retain the existing backend schema (see `AppsScript/`). The adapter does not mutate UI state. Attendance sends the base revision and must preserve server conflict errors. Saves apply the confirmed response without reloading history, and clear a draft only if it still matches the submitted snapshot. Session-expiry error wording remains compatible with the legacy backend.

## Phase One validation and boundaries

`pnpm test` covers the original session expiry, attendance conflict, read-only load, in-flight edits, endpoint override, and no-post-save-reload regressions. Additional checks exercise login, day/week views, prior notes, student history/scoring, failed-save draft preservation, frontend session expiry, and the adapter's wire protocol and error handling.

The Apps Script `.gs` files and backup are unchanged. No production records, deployments, or migrations are changed by this refactor. Local tests use mock responses; authenticated production workflows were not exercised against live records.

Drafts remain in memory and disappear on refresh. Reports remain the existing student history view. The Phase Two Supabase schema and RPCs are available locally, but Supabase frontend integration, Google sign-in, persistent drafts, rescheduling, bulk import, and PDF export belong to later phases.

See [the implementation phases](Ordered%20implementation%20phases%20for%20the%20teaching%20dashboard.md) and [backend setup notes](AppsScript/AppsScript-README.md).
