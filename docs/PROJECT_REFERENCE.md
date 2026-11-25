# DashFirebase project reference

Reviewed **25 November 2026** against the DashFirebase workspace. The October review is preserved at the end for its migration decisions and dated verification records.

DashFirebase is a private teaching log for an individual teacher. The teacher sets up a recurring timetable, enrolls students, opens a class on a particular date, and saves attendance and lesson notes. Analysis uses those saved records to show attendance, participation and students who may need follow-up. Each signed-in teacher has a separate Firebase Realtime Database workspace. This project runs independently of the older Google Sheets and Apps Script dashboard. [Project overview](../README.md) · [Firebase client](../src/firebase-client.js)

## What a teacher can do

| Workflow | What the application does |
| --- | --- |
| Plan the week | Browse the day and week, filter by class, select a meeting, and add or edit recurring classes with a subject, times and room. A current scheduled class uses its timetable slot. Previously recorded meetings can still appear on their original dates. |
| Manage a roster | Add or rename a student, paste a list covering multiple groups, inspect student history, and compare profile IDs with enrollment IDs. A student visiting from another official group can be tagged on one meeting's checklist. |
| Take attendance | Start a new sheet with students marked present and zero participation points. Review individual marks, mark the whole group present or absent, add short observations, and reopen saved checklists for correction. |
| Record a lesson | Save the lesson type, completion status, unit, title, formatted notes, next-class notes and optional rating. Review earlier lessons for the same group or edit a historical lesson record. |
| Analyze teaching records | Select groups and dates, view attendance and point totals, inspect daily summaries, search students, review flags, and open a student's dated marks and notes. The analysis page initially selects the first group sorted by display name. |
| Recover records | Open **Settings** to restore archived classes, students or lesson logs. Archived lesson logs shown there depend on the history range loaded. |

The classic dashboard and analysis pages use HTML and JavaScript controllers. The two Astryx pages in the root build use React to supply the navigation and surrounding interface. They reuse the classic forms, controllers, account and data. Switching editions opens another page, so save drafts first. [Dashboard](../src/script.js) · [Analysis](../src/analysis.js) · [Recovery](../src/archives.js) · [Astryx interface](../src/astryx/workspace.jsx)

## Rules that affect teaching records

### Timetable and lessons

- A class needs a name, subject and at least one meeting. A group ID starts with a letter or digit and can contain letters, digits, spaces, periods, underscores and hyphens, up to 80 characters. Archived classes continue to reserve their IDs.
- A class has at most one meeting on each weekday, Monday through Sunday. Times use 24-hour `HH:MM` and the end must follow the start. The application rejects overlapping active classes on the same weekday, including during import and restoration. One meeting may start exactly when another ends.
- A class and date identify one lesson log and one attendance checklist. Two separately recorded sessions for the same group on the same date would require a change to those keys. Each record stores class details so timetable edits preserve saved history.
- The lesson statuses are **Done**, **Skipped**, **Late** and **Cancelled**. The form offers Lesson, Quiz, Exam and a custom type. An optional rating of 1–5 is stored as 0 when unset. Unit, title, serialized lesson notes and next-class notes have limits of 120, 200, 5,000 and 2,000 characters respectively. Formatting markup counts toward the lesson-note limit.
- **Save all** saves the lesson first, then eligible attendance. These are two writes. If the lesson succeeds and attendance fails, the screen reports which part was saved and retains the attendance draft for retry.

[Timetable and lesson validation](../src/data-model.js) · [Forms, historical snapshots and save actions](../src/script.js) · [Lesson fields](../index.html)

### Students, attendance and recovery

- A new student gets a stable ID, one official group and an enrollment beginning on the current **Asia/Tashkent** date. Renaming keeps the ID. The application supports a guest attending another group's meeting. Changing a student's permanent official group or choosing a backdated enrollment start has no general workflow.
- A new checklist for an active class includes dated members and currently enrolled students, even if the lesson predates their import. Reopening a saved checklist starts with its saved entries and adds eligible dated members. A later enrollment alone does not add a student to an earlier saved sheet.
- The app accepts up to **100 distinct students per checklist** and requires at least one on first save. Each row has one attendance mark, a participation value of −1, 0 or +1, and an optional note of up to 300 characters. Absent and excused rows must store participation as 0. The save validator also checks for omitted dated members who still have active student profiles.
- Archiving a class sets it inactive. Archiving a student moves the profile to its archive and ends active memberships. Restoring that student requires an active official class, retains the original ID, and starts a new membership on the restoration date. Saved attendance history survives.
- Archiving a lesson requires a reason of 1–1,000 characters. Recovery refuses to replace another log already stored for the same class and date. Attendance has its own storage branch, so archiving the lesson log preserves the checklist.

[Roster selection](../src/roster-model.js) · [Checklist assembly](../src/script.js) · [Validation and archive operations](../src/data-model.js)

### How analysis counts attendance and points

| Saved mark | Attendance calculation | Contribution to points |
| --- | --- | --- |
| Present | Counts as attended and expected | Recorded participation |
| Late | Counts as attended and expected | Recorded participation |
| Absent | Counts as expected | −1 |
| Excused | Excluded from attended and expected | 0 |

Attendance is **(present + late) ÷ (present + late + absent) × 100** across the selected records. If the denominator is zero, the rate is unavailable. An unsaved meeting contributes no marks. A student with no records receives the label **No records**. For students with records, a rate below 80% or a negative point total triggers a review flag. A rate of exactly 80% does not trigger the attendance flag.

For example, one present mark with +1 participation, one neutral late mark, one absence and one excused mark give **2 of 3 attended (about 67%)** and **0 total points**. The student is flagged for attendance. [Calculation and thresholds](../src/analysis-model.js) · [Display and filters](../src/analysis.js)

### Imports

| Import | Accepted input and save rules |
| --- | --- |
| Paste students | Markdown tables, tab-separated rows, quoted CSV or one name per line. Up to 500 rows and 200,000 input characters. Explicit groups match an active class ID first, then an unambiguous class name. Only blank groups use the selected default. Unresolved rows need correction or exclusion. Normalized name plus group identifies duplicates within the paste and against current or archived students. Use single entry for genuine namesakes. Parsing happens in the browser. Confirmed profiles and memberships are written together. |
| Read a timetable image | A signed-in teacher submits a PNG, JPEG or WebP image, up to 8 MiB, to the same-origin extraction API. The server sends the image to DeepSeek and returns editable classes, meetings and warnings. The teacher reviews and confirms 1–100 new classes. The application validates the whole selection before writing it in one update. |

Both extraction implementations impose a 12 MiB request-body limit, a 90-second provider timeout, one concurrent request per user, five concurrent requests per running instance or isolate, and 12 requests per user per hourly window. The Node server counts an admitted request before validating its body. The Sites Worker increments the count after validating the image. Counters live in memory. [Student import](../src/student-import-model.js) · [Timetable review](../src/timetable-import.js) · [Node API](../server/timetable-api.mjs) · [Sites Worker](../sites/teaching-desk/worker/index.js)

## Storage, access and operation

Teaching data goes directly from the browser to `teachingDashboard/v1/users/{uid}` in Firebase Realtime Database. The image API handles extraction. Weekly schedules, student histories and analysis totals are derived from teaching records. [Client reads and writes](../src/firebase-client.js) · [Record model](../src/data-model.js)

| Database branch | Contents |
| --- | --- |
| `timetable` | Recurring classes, weekday meetings and active status |
| `students` / `archivedStudents` | Active and archived student profiles keyed by encoded student ID |
| `classStudents` | Membership periods, each with its own ID, join date and optional leaving date |
| `lessonLogs` / `archivedLessonLogs` | Current and archived lesson records keyed by encoded class ID plus date |
| `attendanceChecklists` | One checklist per encoded class ID plus date, with a class snapshot and rows keyed by encoded student ID |

**Access.** The checked-in database rules deny root reads and writes. An authenticated Google user can read their own workspace and write permitted record paths. Password sign-in is accepted by the rules only for the demo project audience, and the password form appears only in emulator development mode. The rules also permit a separate `profile/displayName` field outside the seven teaching-data branches loaded by the client. [Database rules](../firebase/database.rules.json) · [Sign-in interface](../src/app-access.js)

**Data integrity.** The database checks required fields, record revisions and server timestamps, restricts record deletion, and validates attendance values. The client handles timetable conflicts across classes, whole-roster checks and import duplicate detection. These checks use the data loaded by that client. Record revisions help detect competing edits to one record. They do not coordinate independent writes to different records. New writes require a connection. Lesson and attendance drafts are held in page memory and cleared on account change. [Database rules](../firebase/database.rules.json) · [Write handling](../src/firebase-client.js) · [Draft handling](../src/script.js)

**History loading.** The dashboard normally loads dated records from 90 days before through 30 days after the selected date. Classes, profiles and memberships load in full. **Load all history** removes the date restriction. Analysis starts with the same window around today and fetches the selected date range when it changes. [Range queries](../src/firebase-client.js) · [Analysis controls](../src/analysis.js)

| Build | Entry points and runtime |
| --- | --- |
| DashFirebase root | Vite builds `index.html`, `analysis.html`, `astryx.html` and `astryx-analysis.html`. The production Node server serves the build, `/healthz` and `POST /api/timetable/extract`. It requires a Firebase project ID, server-side DeepSeek key and exact app origin at startup. |
| Sites publishing copy | `sites/teaching-desk/` has its own Git checkout, two classic entry points, lesson-form styling, build script and Worker. Its README describes a private publication using the existing Firebase project. This copy has its own release process. The four-page root build does not establish which pages are live. |

For local operation, the root project specifies Node 22.12+ and pnpm. Use `pnpm dev` with the configured Firebase project. For disposable data, use `pnpm emulators` and `pnpm dev:local` in separate terminals. The documented emulator prerequisite is Java 21+. Build the root with `pnpm build`, then use `pnpm start` with the runtime configuration in the hosting guide. Keep provider credentials server-side. [Package commands](../package.json) · [Root build](../vite.config.js) · [Node hosting guide](HOSTING.md) · [Sites publishing copy](../sites/teaching-desk/README.md) · [Sites build](../sites/teaching-desk/vite.config.js)

## Improvements, in priority order

| Priority | Evidence and proposed improvement | How to verify it |
| --- | --- | --- |
| 1 · Make roster dates consistent | On the leaving date, the roster display excludes the membership while the save validator includes it. With a retained student profile and an ended membership, the displayed rows can produce “The roster changed” on save. Define what the leaving date means, use one predicate for display and save, and align analysis enrollment filtering. | Test the day before, the day of and the day after leaving. For each date, save exactly the displayed rows, reopen the sheet and check the analysis student list. Also cover a restored student and a backdated first checklist. |
| 2 · Make recovery independent of the database | Archives protect individual records within the same teacher workspace. The checked-in project has no scheduled independent backup and restore procedure. Add versioned backups with restricted access and a documented restore process. | Restore a synthetic workspace into a separate database. Compare identifiers, enrollment periods, archived records and checklist totals. |
| 3 · Reconcile the two release paths | The root has four pages, while the Sites copy builds two and has its own form styling and API implementation. The root checkout had no commits or configured remote at review time. Record a root source baseline and identify which features each release should ship. | Build both targets from recorded revisions and verify their declared routes, form behavior and image limits in automated tests. |
| 4 · Test simultaneous edits and retries | Import duplicate detection and class-overlap checks run against a client snapshot. **Save all** and the post-write readback also have distinct failure points. Add two-client tests and make retry outcomes explicit before expanding shared or multi-device use. | Run simultaneous overlapping class creations and same-group imports. Interrupt a save after the write and verify that a retry preserves completed work and reports the outstanding part. |
| 5 · Put the release checks on a clean machine | The two browser runners use workstation paths, while the source-preservation test depends on a separate dashboard checkout. Add portable browser dependencies and run the model, rules, hosting and browser suites with disposable fixtures in CI. | A fresh checkout produces the declared results for classic and Astryx, including access isolation, backdated attendance, analysis thresholds and archive recovery. |
| 6 · Measure full-history and bulk-import costs | All-history mode loads complete dated branches. After an atomic update, the client reads each changed, nondeleted path. A 500-student import can therefore trigger 1,000 follow-up reads for profiles and memberships. | Measure reads, latency and memory against a synthetic school year. Use the results to prioritize narrower readback and paginated history. If extraction scales to multiple instances, move its quota to a shared store. |

[Roster dates](../src/roster-model.js) · [Save validation](../src/data-model.js) · [Readback](../src/firebase-client.js) · [Browser runner](../tests/browser.integration.mjs) · [Source-preservation test](../tests/source-safety.test.mjs)

## Verification on 25 November 2026

| Check | Result |
| --- | --- |
| Root model, roster, import, API and source-preservation suite | **23 passed**, zero skipped. The extraction tests use a mock provider. |
| Fresh root production build | **Passed** with all four HTML pages. Output matched the existing local build byte for byte. Vite reported a chunk above 500 kB and ignored library-level `use client` directives. |
| Root Node hosting smoke test | **1 passed** against the local build, covering the four pages, health endpoint, asset serving and API rejection cases. |
| Sites Worker verification | **Passed** against the existing local Worker bundle with test signing keys and a mock provider. |
| Focused domain checks | Reproduced the leaving-date mismatch with a synthetic roster and confirmed the attendance and points example above. |

The Firebase rules emulator suite and browser workflows were not rerun for this documentation review. Live publication, deployed rules, real Google sign-in and provider availability were not checked. The October notes below describe earlier observations. [Root tests](../tests/) · [Hosting smoke test](../tests/hosting.integration.mjs) · [Worker checks](../sites/teaching-desk/scripts/verify.mjs)

<details>
<summary>Historical reference and verification notes from 24 October 2026</summary>

Reviewed: **24 October 2026**, Asia/Tashkent.

## Purpose and current stage

DashFirebase is a teacher's daily teaching dashboard: manage recurring classes and student rosters, save lesson notes and attendance, review participation and attendance analysis, and archive or recover records. Each Google account has a private Firebase workspace.

**Assessment: working local pilot / pre-deployment validation.** The main workflows are implemented, the app has connected to live Firebase, and historical evidence confirms real roster data. It is beyond a prototype, but public hosting and full production acceptance are not established. Package version is `0.1.0`; this stage assessment is based on code and evidence, not a formal release milestone.

## Decisions from previous conversations

Reviewed the available history of **“Move database to Firebase”** (15–17 October 2026; chat `01a13e3e-9a22-70f2-8fb2-0021ce096a8b`) and **“Check DashFirebase branch access”** (15 October; chat `01a13e4e-a0c5-7820-b8fa-75bb6ff59dc6`).

- The original proposal included Google Sheets backups and migration. The later instruction explicitly replaced it with a fresh Firebase-only app while retaining familiar teaching-data concepts. **Sheets synchronization and legacy migration are not unfinished requirements for this version.**
- Preserve the original dashboard, Google Sheets and Apps Script. Development belongs in this separate project.
- Use Firebase **Realtime Database**, not Firestore. The existing project is `dashfirebase-9f0aa`. Although a US region was discussed, the later accepted setup used the existing Singapore database (`asia-southeast1`) on Spark. Do not restart project creation based on the superseded discussion.
- Hosting was explicitly deferred: prepare for hosting later, do not deploy now. A Node-capable host is required for timetable image extraction.
- Timetable images are read through DeepSeek, then reviewed and corrected before saving.
- Bulk student entry uses a selected default class for blank group IDs; explicit groups take precedence. Unresolved groups require correction.
- The roster visibility fix makes unsaved earlier lessons include the current roster. Previously saved attendance retains its saved roster.
- On 17 October, all **118 existing enrollments** were corrected to **2026-09-01**. This was a data correction, not a new enrollment-date feature: new students still receive the current Tashkent date in `src/data-model.js`.
- The branch-access chat cloned `Log-Dashboard`'s `DashFirebase` branch into `/Users/swarosofski/Desktop/Projects/DashFirebase`. **That is a different checkout from this directory.** Do not assume its Git state applies here.

## Implemented features

| Area | Current implementation |
| --- | --- |
| Access | Google sign-in, per-teacher data isolation, connection state, account-change cleanup; password login only in local emulator mode |
| Timetable | Classes, recurring weekday meetings, validation, overlap checks, archive and restore |
| Students | Stable IDs, official groups, dated memberships, individual and bulk entry, archive/recovery, roster audit |
| Teaching records | Lesson status, title, unit, notes, next-class notes and rating; historical class snapshots |
| Attendance | Present/absent/late/excused, participation, student notes, saved checklists and student history |
| Analysis | Group/date filtering, attendance and participation summaries, student review flags and older-history loading |
| Image import | Authenticated server endpoint, DeepSeek extraction, editable review, atomic timetable import |
| Bulk paste | Markdown tables, TSV, quoted CSV and names-only lists; group mapping and duplicate handling; up to 500 students |
| Hosting preparation | Vite build, same-origin Node server, health check, runtime configuration checks and shutdown handling |

## Architecture and file map

Plain JavaScript/HTML/CSS with Vite; Firebase browser SDK for authentication and database access. The Node server handles static hosting and image extraction; regular teaching-data writes go directly from the browser to Firebase under database rules.

| Files | Responsibility |
| --- | --- |
| `index.html`, `src/script.js`, `src/styles/styles.css` | Main teaching dashboard and workflows |
| `analysis.html`, `src/analysis.js`, `src/analysis-model.js`, `src/styles/analysis.css` | Analysis interface and aggregation |
| `src/firebase-client.js`, `src/app-access.js` | Authentication, subscriptions, date-range loading, writes and account isolation |
| `src/data-model.js`, `src/roster-model.js` | Domain validation, mutation payloads, derived views and roster selection |
| `src/archives.js` | Archive/recovery interface |
| `src/student-import*.js` | Student parsing, preview and import |
| `src/timetable-import.js`, `src/timetable-format.js` | Image-import interface and conversion |
| `server/timetable-api.mjs`, `server/index.mjs` | Authenticated extraction endpoint and production server |
| `firebase/database.rules.json`, `firebase.json` | Database authorization/validation and emulator setup |
| `tests/` | Model, API, database-rule, browser and hosting checks |
| `README.md`, `docs/HOSTING.md` | Operating instructions and deployment configuration |

Data lives at `teachingDashboard/v1/users/{uid}` under `timetable`, `students`, `classStudents`, `lessonLogs`, `attendanceChecklists`, `archivedStudents`, and `archivedLessonLogs`. Weekly views and student meeting records are derived. Revisions protect against stale writes; multi-record import/archive operations use atomic updates. Initial history loading spans 90 days before and 30 days after the selected date.

## Evidence and verification

### Fresh checks on 24 October

- **23/23 tests passed** using `node --test tests/*.test.mjs`: domain behavior, roster regression, bulk entry, source preservation and extraction API tests. Provider calls and token verification are mocked in the API tests.
- **Production build passed** using Vite; dashboard and analysis entry points were generated.
- **1/1 production-server smoke test passed** using `node --test tests/hosting.integration.mjs`: pages/assets, health endpoint, private-file denial and unauthenticated/cross-origin API rejection.
- Local-server tests initially encountered sandbox `listen EPERM`; rerunning with approved localhost access passed. These were execution restrictions, not observed application failures.
- Compared the saved before/after enrollment snapshots without reproducing student details. The after snapshot contains **118 students, 118 memberships and 9 timetable records**; every membership starts on `2026-09-01`, and other sections match the before snapshot. These are **17 October historical snapshots**, not a fresh live-database inventory.
- This folder's Git repository has **no commits and no configured remote**; project source files are untracked. The separate Desktop clone does not establish version control for this working copy.

### Previously reported checks, not rerun in this review

The implementation conversation records passing emulator rule checks, browser saves/recovery, account isolation, offline draft handling and mobile layout; live Google sign-in and authenticated reads; a successful real DeepSeek test-image extraction; and browser checks for timetable and bulk-student imports. The later roster fix was visually verified with 14 students in 9B. The September enrollment correction was read back and verified against a backup.

The current rule suite contains six integration tests. The browser script covers the core teaching workflow but is workstation-specific and assumes local emulators plus a development server on port 5175. Prior results are useful evidence, but do not certify the current deployment or all combinations of recent changes.

## What still needs testing

| Priority | Check | Acceptance target |
| --- | --- | --- |
| Before release | Rerun database-rule and full browser suites on the final source | All six rule tests and end-to-end workflows pass against disposable emulators |
| Before release | Backdated attendance after the enrollment correction | September lessons show the intended roster; saves, reloads, saved-sheet edits and analysis agree; existing attendance remains intact |
| Before release | Real Firebase end-to-end workflow with a designated test teacher | Create/edit classes and students, save attendance/notes, reload, archive/restore, and verify isolation with a second Google account |
| Before release | Concurrent editing and interrupted requests | Two tabs/devices cannot silently overwrite records; sign-out/account switch during load/save/import does not display another account's data; reconnect behavior is clear |
| Before release | Hosted acceptance, once deployment is requested | HTTPS origin, authorized Google sign-in domain, token verification, extraction preview/save, body/time limits and server restart behavior work on the actual host |
| Next | Analysis accuracy and history boundaries | Known fixtures confirm percentages, excused/absent handling, participation, archived students, date filters, All time and timezone boundaries; current tests cover only a small part of aggregation |
| Next | Import edge cases and capacity | Large/malformed pastes, ambiguous groups, namesakes, 500-row limits, poor timetable images, duplicate/split meetings, provider timeout, concurrency and quota recovery behave predictably |
| Next | Cross-browser and accessibility checks | Chrome/Safari/mobile workflows, keyboard navigation, dialog focus, validation messages and readable layouts work beyond the existing mobile-width smoke check |
| Before broader use | Realistic scale and recovery | Measure long-history loads and multiple active teachers; establish an independent backup/restore procedure and prove restoration |

Use disposable/emulator data for destructive or failure-path tests. This review did not modify live Firebase, call the paid extraction service, deploy a website or rerun the browser/emulator suites.

## Known limits and remaining product work

- One meeting per class per weekday; one checklist and lesson record per class/date. Split same-day lessons require a model change.
- Attendance checklists support at most 100 students, independently of the 500-student bulk-import limit.
- Official groups are immutable in the current model. A general class-transfer workflow is not implemented.
- Enrollment-date selection/backdating is not exposed as a general feature. The September correction applies only to the existing records corrected at that time.
- Archives remain inside the same database. There is no scheduled independent backup or complete edit history. Backup is separate future work, not a reason to revive the rejected Sheets integration automatically.
- Offline drafts survive within the page session; they do not survive closing the browser and clear on account changes.
- Overlap and full-roster checks are partly application-level business rules, not fully enforced across records by database rules.
- Image-extraction rate limits are in memory; multiple server instances need a shared limiter. Current hosting design assumes one instance.
- Spark capacity was a concern in the earlier design discussion. Confirm the service's current quotas and measure actual usage before broader rollout.
- Record this working source in version control before release. No commit, push or reconciliation with the Desktop clone was performed here.

## Documentation caveats and next step

The README's early status describes an empty live workspace and limited live verification. Later conversations and the enrollment snapshots establish populated live roster data. Its generic static-hosting guidance also predates the image API: full functionality now requires the Node hosting arrangement in `docs/HOSTING.md`.

Recommended next milestone: **a verified release candidate for hosting**—finish the acceptance checks above, decide how enrollment dates and independent backups should work, commit the intended source, then deploy only when requested.

Normal commands (Node 22.12+ and pnpm):

```sh
pnpm test
pnpm test:rules
pnpm build
pnpm test:hosting
```

For isolated browser testing, start `pnpm emulators` and `pnpm dev:local --port 5175`, then run `node tests/browser.integration.mjs`. The browser runner currently depends on this workstation's bundled Playwright/Chrome paths. Refer to `docs/HOSTING.md` for production variables; never copy private `.env` values or student snapshots into this reference or a public repository.

## Folder organization update — 24 October 2026

Application modules now live in `src/`, CSS in `src/styles/`, server code in `server/`, database rules in `firebase/`, and guides in `docs/`. HTML entry URLs and package commands remain unchanged. The local database debug log was preserved under `logs/`; existing test evidence and environment files were preserved. See the root README for the directory map.

Post-move verification: all 24 model/API/source/hosting tests passed; the production build passed with the same generated application asset hashes as before the move. A temporary Vite server successfully served both pages and the relocated modules/styles, and rejected an unauthenticated extraction request as expected. Database-rule and browser workflow suites were not rerun; the emulator prerequisite Java runtime was unavailable. No live data was changed.

</details>
