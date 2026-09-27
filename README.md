# Teaching dashboard

A private teaching workspace built with vanilla JavaScript, Vite, and Supabase. Phase 3 implements **passwordless email-link signup and sign-in**, workspace onboarding, session restoration, and account settings. The owner chose email links on September 26, 2026, replacing the original Google-only plan.

Group creation and student import are visible but disabled until their planned phases. The existing Apps Script dashboard is preserved separately in [`legacy/`](legacy/README.md).

## Run locally

Use Node.js 22.12+ and pnpm 11.19.0.

```sh
pnpm install --frozen-lockfile
cp .env.example .env.local
# Fill in the public Supabase Project URL and publishable key.
pnpm dev
```

Open **http://127.0.0.1:5173/**. The configured project must have the [database migrations](supabase/README.md) applied and the [email authentication setup](docs/email-auth-setup.md) completed.

```sh
pnpm test           # Legacy regressions, both adapters/auth, PostgreSQL rules
pnpm test:auth      # Auth transitions, UI, and Supabase request contracts
pnpm test:db        # Migrations, ownership, revisions, transaction rollback
pnpm build         # New product → dist/
pnpm preview       # http://127.0.0.1:4173/
pnpm dev:legacy     # Preserved Apps Script app → http://127.0.0.1:5174/
pnpm build:legacy   # Preserved app → dist-legacy/
pnpm preview:legacy # http://127.0.0.1:4174/
```

Ports are fixed so callback allow-list entries stay exact. Use the same hostname, port, and browser to request and open a sign-in link. `localhost` and `127.0.0.1` are different browser origins.

## Configuration and deployment

Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` in ignored `.env.local`, or set `supabaseUrl` and `supabasePublishableKey` in `public/config.js`. Non-empty runtime settings take precedence. Vite copies that public file unchanged to `dist/config.js`.

Only public browser keys belong here. A legacy `anon` JWT also works. Never include a service-role/secret key, database password, or SMTP credential. Environment values prefixed `VITE_` are included in the browser bundle. The frontend validates public key types, but this is not a substitute for keeping secrets out of configuration.

Deploy only the contents of `dist/`. The root static page handles `?code=` callbacks without a server-side route. For subdirectory deployment, add that exact path, including the trailing slash, to the Supabase redirect allow list. No query-string `next` or external redirect target is honored. See [email setup](docs/email-auth-setup.md) before deployment.

The new build includes no Apps Script login, endpoint setting, or legacy backend transport. The legacy app has its own root, runtime config, and build output; do not mix the two deployment directories.

## Frontend structure

| File | Responsibility |
| --- | --- |
| `src/main.js` | Build provider/controller/view and restore session |
| `src/config.js` | Validate public settings and derive the exact same-origin callback |
| `src/data/supabase.js` | Supabase SDK boundary: PKCE, email links, verified identity, workspace reads/RPCs |
| `src/auth.js` | Auth state machine, callback exchange, account isolation, retry-safe workspace writes |
| `src/view.js` | DOM rendering and event binding; no SDK or network calls |
| `src/product.css`, `styles.css` | New workspace layout and existing design tokens |
| `legacy/` | Preserved frontend and Apps Script adapter |
| `supabase/migrations/` | Versioned database schema, RLS, transactional writes, occurrence reads |

Auth callbacks remove codes/error details from browser history before performing network calls. Private screens open only after Auth verifies the user and workspace reads succeed. A generation guard discards responses from a signed-out or previous account. Auth-event callbacks remain synchronous and defer SDK work to avoid callback lock deadlocks. Sign-out and account switches remove rendered account data immediately.

First use collects a display name and timezone before `ensure_workspace`, which enforces one workspace per owner. Settings use `save_workspace` with the current revision. An uncertain request retries the same operation ID and immutable payload; confirmed writes read back the latest revision. Timezone becomes read-only after schedules exist, with database enforcement as well. Availability of future features does not imply migrated records.

## Validation and remaining work

Automated tests cover new/returning users, replayed or failed callbacks, account switches during requests, expiration, email-delivery failures, retries, settings conflicts, and no private connected state on authentication failure. PostgreSQL tests cover ownership, idempotent workspace creation, revisions, and timezone locking.

Hosted email delivery and a real user's link click must also be verified; unit tests cannot prove mail delivery. Supabase's default sender is limited to project-team recipients. Configure custom SMTP before opening signup to other teachers. The existing Apps Script records have not been migrated.
