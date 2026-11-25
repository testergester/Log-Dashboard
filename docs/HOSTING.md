# Hosting later

No service has been deployed. The supported deployment is one Node server serving both the built dashboard and `/api/timetable/extract` on the same public origin. No frontend URL changes or Google Sheets/App Script changes are required.

## Build and start

Use Node 22.12+ with pnpm. Install development dependencies during the build because Vite builds the frontend:

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm build
pnpm start
```

Keep `dist/`, `server/`, `src/timetable-format.js`, `package.json` and installed production dependencies in the runtime artifact. Do not run the Vite development server as the public service. The production server binds to `0.0.0.0`, honors the host's `PORT`, exposes `/healthz` for process health checks and shuts down on termination signals. The health endpoint does not check Firebase or DeepSeek availability or API credits.

## Environment variables

Set these public Firebase variables **during the build** using the existing web-app configuration:

- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_DATABASE_URL`
- `VITE_FIREBASE_APP_ID`
- `VITE_USE_FIREBASE_EMULATORS=false`

Set these **on the running server** using the hosting platform's environment/secret settings:

- `DEEPSEEK_API_KEY`: private DeepSeek key. Never prefix it with `VITE_`, bundle it, or upload local `.env` files publicly.
- `FIREBASE_PROJECT_ID=dashfirebase-9f0aa`: must match the frontend Firebase project.
- `APP_ORIGIN=https://your-domain.example`: exact public HTTPS origin with no path or trailing slash. This lets the API validate browser origins behind the host's HTTPS reverse proxy.
- `PORT`: normally supplied by the host; defaults to 5175. `HOST` optionally overrides the default binding.

The server validates required configuration at startup. Firebase ID-token verification uses Google's public certificates and does not require a service-account private key. Leave `FIREBASE_AUTH_EMULATOR_HOST` unset and emulator mode disabled in production.

Local development continues to use ignored `.env.local` and `.env.server`. Hosted environment variables take precedence over those files.

## When deploying

1. Choose a Node-capable host and configure the variables above. A static-only host cannot run image extraction.
2. Use HTTPS, keep frontend and API at the same origin, and allow outbound HTTPS to Firebase/Google certificate endpoints and `api.deepseek.com`.
3. Configure the reverse proxy to accept at least 12 MiB request bodies and allow responses to take at least 100 seconds. The API accepts images up to 8 MiB; base64 increases the request size. Disable caching for `/api/` responses.
4. Add the deployed frontend domain in the existing Firebase Authentication authorized domains and verify Google sign-in. Keep the existing private per-teacher database rules.
5. Start with one server instance. The extraction quota and concurrency limits are in memory and reset on restart. Before enabling autoscaling or multiple instances, replace these with a shared persistent limiter.
6. Run `pnpm test`, `pnpm test:rules`, `pnpm build`, then `pnpm test:hosting`. After deployment, check `/healthz`, Google sign-in, an image preview and a reviewed timetable save with a test teacher.

No deployment, domain change, billing upgrade or Firebase permission change is performed by these instructions.
