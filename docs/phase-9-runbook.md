# Phase 9 migration and pilot runbook

Status: migration tooling is rehearsed locally. **No owner export, production database import, Cloudflare deployment, SMTP setup, or two-teacher pilot has been performed from this checkout.** Record the results below as each gate passes.

## 1. Prepare and preserve the source

1. Back up the Google Sheet and keep the original Apps Script deployment and `legacy/` build. Give the export and generated SQL the same access restrictions as the student records. The export intentionally contains names, notes, and attendance, but no credentials or sessions.
2. Add the updated `AppsScript/*.gs` files to the owner-controlled script project and deploy a new web app version. Run `exportLegacyForMigration()` from the Apps Script editor. It writes a JSON file to the owner's Drive and logs only its file ID and SHA-256. Download that file to a private local directory. Do not upload it to a ticket, Git repository, or chat.
3. Record its SHA-256, file location, export timestamp, source sheet revision/backup, and the chosen Supabase **Auth user UUID** and **workspace UUID** in a private cutover log. Verify the workspace belongs to that exact Auth user. An empty workspace is safest; the import rejects extra target rows and changed mapped rows.
4. Choose the current recurring schedule start date. This applies to the surviving timetable only. Saved historical meetings are imported independently, including dates that do not match today's weekday or time.

## 2. Rehearse and validate

Run locally with Node 22.12+ after `pnpm install --frozen-lockfile`:

```sh
node scripts/migrate-legacy.js --export /private/path/teaching-dashboard-legacy-YYYYMMDD-HHMMSS.json --owner-id OWNER_UUID --workspace-id WORKSPACE_UUID --schedule-start YYYY-MM-DD
node scripts/rehearse-legacy.js --export /private/path/teaching-dashboard-legacy-YYYYMMDD-HHMMSS.json --schedule-start YYYY-MM-DD
node scripts/migrate-legacy.js --export /private/path/teaching-dashboard-legacy-YYYYMMDD-HHMMSS.json --owner-id OWNER_UUID --workspace-id WORKSPACE_UUID --schedule-start YYYY-MM-DD --output /private/path/legacy-migration-rehearsal.sql
```

The first command is a dry run: it validates the export and prints only entity counts and the number of students with saved attendance. The second imports the actual export twice into a disposable local PGlite database, then verifies the same checks. The third writes SQL with mode `0600`; the file contains student data. Keep it outside the repository. The generated SQL checks the owner/workspace pair, inserts deterministic legacy IDs in one transaction, compares every mapped row and table count, and checks each student's attendance counts and point total. A rerun inserts no duplicates. Any mismatch aborts the transaction. Check for `MIGRATION_ERROR`, `REHEARSAL_ERROR`, `TD003`, or `TD004` and correct the source/target mismatch before proceeding. Do not work around a mismatch by deleting records.

Rehearse first in an isolated Supabase project or database with the same migrations and a test Auth owner/workspace. Use a session with database write privileges, not a browser publishable key. `psql -X -v ON_ERROR_STOP=1 --file /private/path/legacy-migration-rehearsal.sql` uses normal libpq connection settings (`PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD`); keep the password in a secret manager or protected local environment. Run the SQL a second time. Confirm both runs succeed and counts remain unchanged. The automated PGlite rehearsal covers a historical meeting, duplicate names, archived class, canonical attendance, snapshots, and rerun safety; hosted Postgres and browser behavior still require the rehearsal above.

The SQL's checks establish these comparisons against the source export:

| Source | Target |
| --- | --- |
| Distinct class IDs and timetable rows | One group per class ID and one slot per timetable row; matching names stay separate when IDs differ |
| Students | Students, without name based merging |
| Enrollment intervals | Enrollments with inclusive start and exclusive end |
| Unique class/date keys in lessons or checklists | Persisted meetings |
| Lesson rows | Lesson records and saved meeting snapshots |
| Canonical checklist rows | Checklists and frozen attendance entries |
| Per-student present, absent, recorded, and score | Same aggregates over imported entries |

The Drive export preserves the original checklist revision UUID and class snapshot metadata. The target uses its own integer record revision; the exported revision UUID is recorded in the deterministic identity map during mapping, not used as a target revision. If a lesson and checklist have conflicting class snapshots for the same meeting, the lesson snapshot is used in the target meeting and both original snapshots remain in the source export. Review any such discrepancy before cutover.

## 3. Production cutover

1. Finish a successful rehearsal and verify the target owner, workspace, email sign-in, and current migrations. Keep signup limited to the owner during the pilot.
2. Deploy the updated Apps Script version with the write guard. Run `freezeLegacyWritesForCutover()` in the owner script editor. It waits for the shared script lock before setting `LEGACY_READ_ONLY`. Confirm a legacy save now returns `LEGACY_READ_ONLY` while reads still work. Existing older deployments must be retired or updated: the property cannot guard code that does not check it. Restrict direct edit access to the Google Sheet during the cutover; a script property cannot prevent the owner from manually changing cells.
3. Take a **fresh final export** after writes are frozen. Hash and retain it. Repeat dry run and SQL generation with the final file. Take a Supabase database backup before import.
4. Run the generated SQL against the chosen production workspace. Run it again to prove idempotence. Compare counts, relationships, student history totals, archived history, notes, meeting dates/times, and report preview in the owner account. Keep the legacy app read only; Supabase is now the sole writable source.
5. Open signup to other teachers only after owner pilot, email delivery, and a second teacher's isolated workflow pass.

**Rollback after any Supabase writes:** do not simply unfreeze the old app. Export all post-cutover Supabase changes first, identify records absent from the legacy export using stable IDs and operation IDs, and choose a dated reconciliation plan for each changed lesson, attendance checklist, student, enrollment, group, and meeting. Reconcile changes into the retained source copy or a replacement Supabase project, verify per-student totals again, then switch the writable frontend. Preserve both immutable exports and the operation log. Restoring a pre-cutover database snapshot without reconciling later writes loses those writes.

## 4. Cloudflare Pages and email

Publish this Vite app as a Cloudflare Pages Git project. Use `pnpm install --frozen-lockfile && pnpm build` and output directory `dist`. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` for production builds. They are public values; never set a service-role key, database password, or SMTP password in Vite variables. Use the root Pages URL or a verified custom domain with HTTPS. Check the build artifact and sign-in callback on that exact URL before announcing it.

In Supabase Auth URL Configuration, set **Site URL** to the exact production URL ending in `/` and add that exact URL to Redirect URLs. Keep only specific trusted preview origins if needed. Configure custom SMTP in Supabase Auth server settings with a verified sender domain; test a link delivered to a teacher outside the Supabase project team. Test both initial signup and returning sign-in in the same browser where the link was requested. The default sender is unsuitable for external teachers. See [Cloudflare Pages build configuration](https://developers.cloudflare.com/pages/configuration/build-configuration/), [Supabase redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls), and [Supabase SMTP](https://supabase.com/docs/guides/auth/auth-smtp).

## 5. Pilot gates

- Owner: sign in, confirm imported groups/slots/history, edit a lesson and attendance separately, refresh and recover drafts, exercise conflict handling in two tabs, reschedule an eligible meeting, import students, and preview/download a PDF report.
- Second teacher: sign up through external SMTP, create workspace, group and schedule, enroll/import students, save a lesson and attendance, refresh drafts, resolve conflict, reschedule, and export a report. Confirm neither account can see or change the other's records.
- In desktop and mobile browsers, navigate by keyboard through all controls, confirm modal focus starts inside and returns to the opener, and check narrow widths for clipped actions or data. Record browser/version, viewport, tester, result, and fixes. Automate the critical paths when a browser test runner and test accounts are available.
- Confirm the database size and other free-plan usage against the project's Supabase Usage page weekly during the pilot. Run the SQL below in the SQL editor; record date and value. Investigate growth before the Free database size approaches the documented 500 MB read-only threshold. Check current plan limits rather than assuming the threshold cannot change.

```sql
select pg_size_pretty(pg_database_size(current_database())) as database_size;
select schemaname, relname, pg_size_pretty(pg_total_relation_size(format('%I.%I', schemaname, relname))) as total_size
from pg_stat_user_tables where schemaname in ('public', 'dashboard_private')
order by pg_total_relation_size(format('%I.%I', schemaname, relname)) desc;
```

## 6. Backup and restore drill

Supabase recommends that Free projects make regular off-site exports with `supabase db dump`; Free projects do not have downloadable managed daily backups. Use the installed CLI's `supabase db dump --help` to confirm flags, then create protected schema and data dumps with a privileged connection. Record checksums and verify a restore into a separate test project with the same Auth and migration prerequisites. Run count and student-total checks before considering that backup usable. Keep the pre-cutover Google Sheet/export and legacy app separately. See [Supabase backups](https://supabase.com/docs/guides/platform/backups) and [CLI backup/restore](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore).

## Completion record

| Gate | Evidence/date |
| --- | --- |
| Final owner export retained and hash verified | Pending |
| Hosted migration rehearsal and repeat run | Pending |
| Production import, count and total comparison | Pending |
| Legacy writes frozen, Supabase sole writable source | Pending |
| Cloudflare URL and email redirect/SMTP test | Pending |
| Owner and second-teacher pilot | Pending |
| Browser, keyboard, dialog, mobile checks | Pending |
| Backup restore drill and usage check | Pending |
