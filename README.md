# Teaching desk · Firebase edition

A fresh, independent version of the teaching dashboard. Accounts start empty. There is no Google Sheets connection, Apps Script code, data migration, or sample teaching data in this project.

## Project layout

- `src/` — application JavaScript; `src/styles/` — stylesheets.
- `server/` — production server and timetable image API.
- `firebase/` — database rules; root `firebase.json` configures emulators.
- `tests/` — automated checks and fixtures.
- `docs/` — [project reference](./docs/PROJECT_REFERENCE.md) and [hosting guide](./docs/HOSTING.md).
- `test-evidence/`, `logs/`, `dist/` — ignored local evidence, logs and generated build output.

The HTML entry points, package/build configuration and local environment files remain at the root. Run all commands from this directory.

## Astryx version

Use **✦ Astryx version** in the top navbar to open the alternate dashboard at `astryx.html`. Its Analysis tab opens `astryx-analysis.html`; **Classic version** returns to the corresponding original page.

The alternate interface uses [Meta's Astryx](https://github.com/meta/astryx) (`@astryxdesign/core` and the neutral theme, version 0.7.12) with React 19. Navigation buttons, headers, cards, badges, and the empty state are Astryx components. The workspace uses the same forms, dialogs, controllers, sign-in, and Firebase data as the classic version. Changes in either interface affect the same teacher account. Shared markup comes from the original HTML entry points; the alternate styles and React integration live in `src/astryx/`.

Both alternate pages are included in `pnpm build`. With `pnpm dev --port 5175` running, `pnpm test:astryx` checks navigation, sign-in/out, class and student entry, attendance and lesson saves, analysis, dialogs, and responsive layouts. This workstation-specific Playwright check replaces only the Firebase transport with a local fixture backed by the real domain model; it makes no live Firebase requests.

## Current status

The dashboard and analysis interface run locally. Classes, students, enrollment periods, lesson records, attendance, archives, and recovery use Firebase Realtime Database. Google sign-in creates separate private teacher workspaces.

The existing Firebase project is `dashfirebase-9f0aa` on Spark, with the registered `DashFirebase Web` app. Google sign-in and the private teacher-access rules are enabled. The database is in **Singapore (`asia-southeast1`)**, accepted explicitly during setup. Its URL is `https://dashfirebase-9f0aa-default-rtdb.asia-southeast1.firebasedatabase.app`.

The local `.env.local` contains the public web configuration and is ignored by Git. Live mode runs with `pnpm dev`; the isolated demo remains available through `pnpm dev:local`. No website hosting deployment has been performed. Live Google sign-in and authenticated loading of an empty teacher workspace have been verified. No sample teaching records were created in the live database.

## Run locally

Requires Node 22.12+ and pnpm.

```sh
pnpm install --ignore-scripts
pnpm dev
```

Without Firebase settings, the page shows a setup message and disables sign-in. It will not guess a project from another browser tab.

### Local demo emulators

Install Java 21+ or set `JAVA_HOME` to an existing Java 21+ runtime. Start the emulators in one terminal and the website in another:

```sh
pnpm emulators
pnpm dev:local
```

Use the **Local emulator only** sign-in form with a disposable email and a password of at least six characters. This is test authentication against localhost only. It appears only in development with `VITE_USE_FIREBASE_EMULATORS=true`. Google sign-in is the production sign-in method. Rules accept password sign-in only when the token audience is the demo emulator project. Emulator data is disposable and is not exported by these commands.

## Firebase configuration reference

1. Choose the Firebase project and exact Realtime Database URL. Use Spark. A separate project is recommended if another application already uses the current project.
2. Enable **Google** in Firebase Authentication and add the intended website domain to authorized domains. Do not enable email/password for the live app; the local test form does not need it.
3. Register a Firebase web app. Copy `.env.example` to `.env.local` and enter its five public web configuration values. Keep emulator mode false for the live app. Never put an administrator key or account password in this file.
4. Review `firebase/database.rules.json` against the destination's existing rules. The file is a full ruleset for a dedicated database. **Do not deploy it over another application's rules.** In a shared database, integrate only the `teachingDashboard` namespace after checking for permissive ancestor rules; ancestor grants cannot be revoked by child rules.
5. Test rules locally, then deliberately publish the reviewed rules to the chosen database. This project does not include an automatic deployment command or a default project alias.
6. Run `pnpm build`. Publish `dist/` using your chosen static host. Include all four entry points: `index.html`, `analysis.html`, `astryx.html`, and `astryx-analysis.html`. Configure the published origin in Firebase Authentication before testing Google sign-in.

Public Firebase web configuration identifies the application; database authorization is enforced by Authentication and Realtime Database Rules.

## Data layout

All app data lives below `teachingDashboard/v1/users/{Firebase UID}`. No user can read the parent user directory or another teacher's workspace.

| Branch | Purpose |
| --- | --- |
| `timetable` | Recurring classes and up to one meeting per weekday |
| `students` | Student profiles, stable IDs, immutable official groups |
| `classStudents` | Enrollment periods with join/leave dates |
| `lessonLogs` | One lesson record per class/date, including historical class details |
| `attendanceChecklists` | One current checklist per class/date, with student entries keyed by student ID |
| `archivedStudents` | Recoverable student profiles |
| `archivedLessonLogs` | Recoverable lesson records and archive reasons |

Record keys encode IDs safely, so displayed group IDs may contain dots or spaces. Weekly views and student meeting records are derived. Dates use `YYYY-MM-DD`, times use `HH:mm`, and teaching dates use Asia/Tashkent. Update times are Firebase server timestamps. Revisions reject stale saves. Archive/recovery changes use atomic multi-location updates.

The teaching view initially loads the selected date's previous 90 days and following 30 days of history. **Load all history** fetches older records deliberately. Analysis starts with the same window; its date filters and **All time** control the loaded range. Student profiles and enrollment periods load for the whole current teacher account.

## Checks

```sh
pnpm test
pnpm build
pnpm test:rules
```

`test:rules` starts disposable auth/database emulators and runs real allow/deny tests, including two-user isolation, stale revisions, malformed attendance, and archive/recovery. It requires Java 21+. If emulators are already running, use `node --test tests/rules.integration.mjs`.

`tests/browser.integration.mjs` is the local browser workflow check. It uses the desktop's bundled Playwright and installed Chrome, so its runner path is specific to this workstation. Start emulators plus `pnpm dev:local --port 5175` before running it. All browser requests are restricted to localhost. Screenshots are written to ignored `test-evidence/`.

The source safety test compares the original dashboard's files against the captured checksums on this workstation. It does not modify the original.

## Deliberate limits

- Archives share the same database; they are not an independent disaster-recovery backup. There is no scheduled backup or full edit history in this version.
- Timetable overlap and checklist roster-completeness checks run in the application. Rules enforce isolation, record shape, revisions, and attendance values; they do not establish every cross-record teaching rule against a modified client.
- Spark's Realtime Database has a 100-simultaneous-connection limit. Tabs/devices count separately. Measure usage before expanding open registration.
- Offline saves are not announced as successful. Drafts survive failures within the current page session; they are cleared on sign-out/account changes and are not persisted across closing the browser.
- Live Google sign-in and authenticated reads have been verified. Teaching-record writes and recovery were tested against the isolated demo emulators; no sample teaching records were added to the live account.
# Timetable image import

Use **Import timetable image** beside Add class. Select one teacher’s PNG, JPEG or WebP timetable (up to 8 MB), optionally provide a subject where it is omitted, then click **Read image**. The image is sent to DeepSeek `deepseek-flash`. Review the extracted classes, correct uncertain fields and exclude existing groups before clicking **Add reviewed timetable**.

The API returns editable suggestions, never trusted Firebase paths. The existing domain validator checks group IDs, required subjects, times, duplicate weekdays and overlaps with your classes. All selected classes are saved in one atomic update under the signed-in teacher’s Firebase workspace. Existing classes are never replaced by import. The current timetable model allows only one meeting per class per weekday; same-day split lessons require correction in the review. Missing bell times or unclear image content need user correction.

The DeepSeek key belongs only in the ignored `.env.server` file (`DEEPSEEK_API_KEY=...`); `.env.server.example` shows the format. Never use a `VITE_` prefix for secrets. Firebase ID tokens are verified on the server before requests reach DeepSeek. The server imposes an 8 MB upload limit, a 90-second provider timeout, one active request per teacher and 12 requests per teacher per hour. Limits are in memory; multiple public server instances would require a shared limiter. Images are not written to disk by this application.

`pnpm dev --port 5175` runs Vite and the image API together. For a built deployment, run `pnpm build` followed by `pnpm start`; the Node server serves `dist` and the authenticated image endpoint. Set `APP_ORIGIN` to the exact HTTPS dashboard origin behind a reverse proxy, and configure `PORT`/`HOST` as needed. Plain static hosting cannot run this endpoint. This setup does not deploy Cloud Functions, change the Firebase plan, or alter Google Sheets or Apps Script. DeepSeek API usage uses the provider account’s balance.

See [HOSTING.md](./docs/HOSTING.md) for the build/runtime variables, start command, HTTPS proxy requirements and checks to use when hosting later. `pnpm test:hosting` verifies the actual production server after building. No hosting is deployed now.

## Bulk student entry

Unsaved attendance sheets include the current class roster even for lessons dated before the student import. Teachers review attendance before saving. Existing saved sheets retain their dated roster; later student imports do not automatically add those students to past saved attendance. Enrollment start dates are preserved.

Use **Add students in bulk** in the main toolbar for a list spanning several classes, or **Paste student list** within a selected class. The single-student dialog also offers **Paste several students**. Paste Markdown tables, spreadsheet tab-separated rows, CSV with quoted fields, or one name per line (up to 500 students). Tables may have `Full name` and `Group ID` headers.

The selected default class applies only to blank Group IDs. Explicit groups take priority. Groups resolve to existing active class IDs or unambiguous class names, and group mappings can be corrected once for every matching row. Unknown/ambiguous groups and invalid names block saving until corrected or excluded. Missing classes must be created through Add class first; this import does not create timetable meetings or guess a student's group.

Review names and click **Add reviewed students**. New profiles and official class memberships are saved together in one atomic Firebase update under the signed-in teacher. Matching names within the same class, repeated paste rows and archived matches are skipped to avoid duplicate profiles; restore archived students from Settings. Identically named students in different groups remain separate. Names with spelling differences need human review; this is not fuzzy identity matching. Existing single-student entry remains available for genuine namesakes. Student text is parsed locally and sent only to the existing Firebase workspace, without an AI request.

