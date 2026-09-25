# Phase Two database foundation

The migrations in this directory define the Supabase PostgreSQL database. The frontend continues to use Apps Script. No Supabase credentials, remote database connection, live data import, or deployment are part of this phase.

## Recreate and test locally

The repository's database test environment needs only Node.js and the locked dependencies:

```sh
pnpm install --frozen-lockfile
pnpm test:db
pnpm test
pnpm build
```

`test:db` starts a fresh, in-memory **PGlite PostgreSQL** database for each test, creates test-only Supabase Auth roles and identities, and applies every migration in filename order. It executes the real PL/pgSQL, row-level security policies, grants, foreign keys, and exclusion constraints. It uses no network, credentials, production records, or persistent database files. Closing the database removes its fixtures. All migrations are applied inside transactions.

To recreate a full local Supabase development stack, install the [Supabase CLI and Docker](https://supabase.com/docs/guides/local-development/cli/getting-started), then run from the repository root:

```sh
supabase start
supabase db reset --local
```

The reset command **recreates this local database and deletes its existing local data**. It applies the committed migrations to the local PostgreSQL 17 instance configured in `config.toml`. No seed file is enabled. Supabase provides the real `auth.users`, `auth.uid()`, `anon`, and `authenticated` roles; the test-only auth bootstrap must never be deployed. Do not use `--linked` or `db push` as part of these local instructions.

The embedded tests have been run in this workspace. The full Docker/Supabase stack has not been started here because Docker and the Supabase CLI are unavailable. PGlite uses one connection, so it verifies transactional rollback, replay, and stale-revision outcomes but does not simulate simultaneous PostgreSQL connections or Supabase's HTTP/JWT layer. Those integration checks remain necessary when connecting the hosted development project. Google authentication and frontend integration are Phase Three/Four work.

## Migration order

| Migration | Responsibility |
| --- | --- |
| `20260925000100_workspace_schema.sql` | Tables, constraints, indexes, read policies, and table privileges |
| `20260925000200_transactional_writes.sql` | Private validation/write helpers and authenticated `dashboard_write` RPC |
| `20260925000300_occurrence_reads.sql` | Read-only `list_meetings` RPC |

Once applied to a shared environment, add a new migration for subsequent changes rather than rewriting its history. See [Supabase migration guidance](https://supabase.com/docs/guides/deployment/database-migrations).

## Data model and identity

- **Workspace:** one per `auth.users.id`, enforced by a unique owner constraint. Default timezone is `Asia/Tashkent`; an IANA timezone is validated by PostgreSQL. The timezone cannot change once any schedule slot exists.
- **Group:** name, subject, optional workspace-unique code, archive flag, and revision. Archiving retains historical records. Restoring an archived group is intentionally not exposed yet because its schedule must be checked for conflicts.
- **Schedule slot:** stable identity and group membership. **Slot versions** contain weekday (Monday = 1), minute-precision times, room, and effective dates. Versions for a slot cannot overlap.
- **Meeting:** materialized only during a record save. Its unique identity is `(workspace_id, schedule_slot_id, original_date)`. Its display key is `schedule_slot_id:YYYY-MM-DD`. Actual date/time and group/subject/room snapshots are stored separately; changing the actual date in a future rescheduling RPC must not change identity.
- **Student:** workspace-wide identity; matching names are permitted. Nonempty external IDs are unique only within the workspace.
- **Enrollment:** group/student relationship with inclusive `starts_on` and exclusive `ends_on`. Multiple non-overlapping membership periods are supported. Each group is limited to 100 enrolled students at any date.
- **Lesson record:** meeting-specific notes (up to 5,000 characters), optional rating 1–5, lesson type (1–60 characters), status (`Done`, `Late`, `Cancelled`, or `Skipped`), and revision.
- **Attendance checklist:** independently revised official attendance for a meeting. **Attendance entries** store the frozen roster and student-name snapshots, `present`/`absent`, participation −1/0/+1, and a note up to 300 characters. An absent student must have participation 0; the existing score rule remains −1 for absence and the participation value for presence.

Every child relationship includes the workspace ID in its foreign key. A meeting also references its slot/group and slot/version together, preventing mismatched relationships even within one workspace. Saved roster entries have both a checklist FK and a student FK. Workspace-scoped primary/unique keys and explicit indexes cover ownership, group schedules, meeting dates, dated enrollments, and student history.

Schedule and enrollment end dates are exclusive internally. A future UI offering an inclusive last date should submit the following date as the exclusive end. Calendar query `p_from`/`p_to` bounds, by contrast, are inclusive.

## Access boundary

`authenticated` receives SELECT privileges and owner-filtered RLS policies on business tables. It has no INSERT, UPDATE, DELETE, TRUNCATE, or table write policies. `anon` has no business-table or RPC access. Missing authentication inside an authenticated RPC call is rejected as well.

There are only two public application RPCs:

1. `dashboard_write`: SECURITY DEFINER, fixed empty search path, explicit `auth.uid()` ownership check, workspace transaction lock, validated writes, and atomic retry receipt.
2. `list_meetings`: SECURITY INVOKER, fixed empty search path, explicit authentication/ownership checks, and RLS-protected reads.

All write helpers and the operation ledger are in `dashboard_private`, which is absent from the exposed API schemas. Browser roles have neither schema access nor helper EXECUTE privileges. The ledger has RLS enabled and no browser policies. The migration owner can perform maintenance; privileged service credentials must never be shipped to the browser.

The design follows Supabase's guidance on [function security and execution grants](https://supabase.com/docs/guides/database/functions) and [row-level security](https://supabase.com/docs/guides/database/postgres/row-level-security).

## Write RPC contract

Call:

```js
const { data, error } = await supabase.rpc('dashboard_write', {
  p_workspace_id: workspaceId,
  p_operation_id: operationId, // Generate one UUID per logical save; retain it for retries.
  p_action: 'save_lesson_record',
  p_payload: {
    schedule_slot_id: slotId,
    original_date: '2026-09-21',
    expected_revision: 0, // 0 means no saved lesson record exists yet.
    notes: 'Introduction to fractions',
    rating: 4,
    lesson_type: 'Lesson',
    status: 'Done'
  }
});
```

This is an API example for later integration; no Supabase client is added to the active frontend in Phase Two.

Except `ensure_workspace`, every action requires a workspace owned by the signed-in teacher. Never send an owner ID; ownership comes exclusively from `auth.uid()`. Every mutable entity uses an integer revision: create with `expected_revision: 0`, and update with the last confirmed revision. Entity IDs for creation are generated on the server. Missing IDs for edits do not silently create replacement rows.

| Action | Payload | Confirmed result |
| --- | --- | --- |
| `ensure_workspace` | `display_name`, optional `timezone`; `p_workspace_id` must be null | The teacher's single workspace. Repeated first-use calls return the existing workspace without changing its profile. |
| `save_workspace` | `display_name`, optional `timezone`, `expected_revision` | Updated workspace |
| `save_group` | Optional `id` for update; `name`, `subject`, optional `code`, optional `archived`, `expected_revision` | Saved group |
| `save_student` | Optional `id`; `name`, optional `external_id`, `expected_revision` | Saved student |
| `save_enrollment` | Optional `id`; `group_id`, `student_id`, `starts_on`, optional `ends_on`, `expected_revision` | Saved enrollment. Updates cannot reassign its group/student. |
| `save_schedule_slot` | Optional `id`; `group_id`, `weekday`, `start_time`, `end_time`, optional `room`, `effective_from`, optional `effective_to`, `expected_revision` | Slot including its revision and nested `version` |
| `save_lesson_record` | `schedule_slot_id`, `original_date`, `expected_revision`; optional `notes`, `rating`, `lesson_type`, `status` | `{meeting, record}` |
| `save_attendance` | `schedule_slot_id`, `original_date`, `expected_revision`, `entries` array of `{student_id, attendance, participation, note?}` | `{meeting, checklist, entries}` |

Payloads are full replacements for editable content, not arbitrary patches: omitted student external IDs/group codes clear them; omitted lesson values use their documented defaults. `save_group.archived` and workspace timezone are retained on update if omitted. Unknown extra payload fields never become table columns and cannot change ownership, revisions, snapshots, or arbitrary relationships.

`save_schedule_slot` creation adds the first version. Updates append a version with the same slot ID and increment the slot revision; they must start today or later and after the last version's start date. The previous version is closed if needed. Changes that would cut through saved meetings are rejected. All slot times must be non-overlapping across the workspace; touching end/start times are allowed. More elaborate schedule editing UI belongs to Phase Four.

The first attendance save must contain exactly the roster resolved from enrollment dates on the meeting's actual date. Corrections must contain exactly the saved roster; later enrollment/name edits cannot silently rewrite saved snapshots. An empty lesson save is still an official record. A lesson and attendance checklist have separate revisions and Save operations.

### Transaction, revision, and retry behavior

Every ordinary write locks the owned workspace row before reading entity revisions or operation receipts. This serializes schedule changes, enrollments, lesson writes, and attendance writes in that workspace. First-use workspace creation uses a transaction advisory lock keyed by the authenticated owner, backed by the unique owner constraint.

A private operation receipt stores `(workspace_id, operation_id)`, a SHA-256 hash of the action and canonical JSON payload, and the confirmed response. It is inserted in the same transaction as the business write:

- The same ID with the same action/payload returns the exact original response, including timestamps and revisions, without reapplying the write.
- The same ID with different content is rejected. Editing a failed/in-flight save into a different logical save requires a new operation ID if the first one may have succeeded.
- A stale revision with a new operation ID is rejected.
- Failed writes roll back everything, including lazily created meetings, partial roster rows, and receipts.
- Receipts are checked after ownership. Knowing another teacher's operation ID grants no access.
- Receipts are retained indefinitely in this phase. They contain historical confirmed responses and must be included in backup/size planning; pruning them would require a defined retry-retention contract.

A replayed response can be older than a later successful edit. Future client integration must reconcile revisions and retain newer local edits rather than treating every response as the latest state. Database serialization failures (`40001`) or interrupted connections should be retried using the same operation ID and unchanged payload.

### Stable errors

Supabase exposes PostgreSQL SQLSTATE as `error.code`. Use the code, not human-readable detail, for client behavior.

| Code | Message | Meaning |
| --- | --- | --- |
| `TD001` | `AUTH_REQUIRED` | No authenticated identity |
| `TD002` | `VALIDATION_ERROR` | Missing/invalid fields, constraints, invalid timezone, duplicate external ID/code, or unsupported action |
| `TD003` | `NOT_FOUND` | Missing or not-owned workspace/entity/relationship; these are deliberately indistinguishable |
| `TD004` | `REVISION_CONFLICT` | Expected revision differs from the saved revision |
| `TD005` | `OPERATION_CONFLICT` | Operation ID reused with a different action/payload |
| `TD006` | `SCHEDULE_CONFLICT` | Overlapping commitment or saved meeting prevents a schedule change |
| `TD007` | `ROSTER_CONFLICT` | Roster changed, differs from saved roster, or exceeds 100 students |

Malformed UUID/date arguments rejected before entering an RPC retain PostgreSQL's `22…` validation codes. Disallowed direct table/helper calls return `42501` (insufficient privilege). Constraint details from the write gateway are sanitized rather than returning teaching data.

## Read RPC contract

```js
const { data, error } = await supabase.rpc('list_meetings', {
  p_workspace_id: workspaceId,
  p_from: '2026-09-21',
  p_to: '2026-09-27'
});
```

The range is inclusive and limited to 93 days. Unsaved occurrences have `id: null`, `revision: 0`, and a stable `meeting_key`. Saved meetings override generated occurrences and retain their snapshots. Archived groups contribute saved meetings only. Persisted meetings are queried on `actual_date`, so the read model already supports future moved-in/moved-out exceptions without duplicate occurrences. No reschedule write operation is exposed in this phase.

## Validation coverage

The database suite recreates the migrations from scratch and checks:

- Two teachers' read isolation on every business table and write isolation across RPC actions.
- Denial of direct browser inserts/updates/deletes/truncation, private helpers, and operation receipts.
- Composite foreign keys rejecting cross-workspace and mismatched slot/group relationships even for privileged SQL fixtures.
- One workspace per teacher, repeat-safe first use, replayed creates/updates, changed-payload conflicts, and retry after rollback.
- Revision conflicts for all mutable entities, with separate lesson/attendance revisions.
- Read-only occurrence generation, multiple independent meetings on one day, preserved schedule versions/snapshots, and stable identity after a simulated move.
- Inclusive/exclusive enrollment boundaries, frozen roster/name snapshots, roster limits, and attendance correction behavior.
- Atomic rollback of malformed attendance, including meetings, entries, and receipts.
- Scheduling/enrollment overlaps, back-to-back meetings, invalid timezone/time/rating/status/length validation, and archived history.

The main frontend regression tests and production build remain part of the handoff. Production records and backend deployments are unchanged.
