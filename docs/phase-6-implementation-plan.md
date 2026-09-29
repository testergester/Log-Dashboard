# Phase 6 implementation plan — single-meeting rescheduling

## Outcome and existing foundation

Move one occurrence without changing its recurring slot or creating an official lesson or attendance record. Its identity remains `schedule_slot_id:original_date` across moves and restoration.

The existing `meetings` table already has `original_date`, `actual_date`, time, room, `is_rescheduled`, and `revision`. `list_meetings` suppresses a generated occurrence when a materialized row has the same original key and returns materialized rows on their actual date. All writes through `dashboard_write` lock the owned workspace row before dispatch, which can serialize a new reschedule action with lesson, attendance, enrollment, and schedule writes. A move will create a `meetings` row with no lesson or attendance row; that row is an override, not an official record.

## 1. Database contract and transaction

Add a migration for `dashboard_private.reschedule_meeting` and `dashboard_private.restore_meeting`, dispatched by `public.dashboard_write`. Both accept `schedule_slot_id`, `original_date`, and `expected_revision`; reschedule also accepts a finite `actual_date`, minute-precision `start_time` and `end_time`, and a room of at most 120 characters. Use the existing operation ID receipt so a retry returns the same confirmed result.

Within the workspace-locked transaction:

1. Resolve the original slot version and the active group for the original date. Require an existing scheduled occurrence. Identify the override by `(workspace_id, schedule_slot_id, original_date)` and check revision (`0` if it has not been materialized).
2. Reject a move or restoration when **either** `lesson_records` or `attendance_checklists` has a row for the meeting. Do not inspect notes or attendance entry contents; an empty saved lesson still blocks the change.
3. Validate the destination interval and check every active recurring occurrence and every materialized meeting in that workspace on the destination date. Ignore only the moving occurrence itself. Use the project's existing rule that overlapping times conflict across the workspace, regardless of room. Include moved-in meetings and the source slot's other occurrences.
4. Insert or update the override with its original key unchanged, destination snapshot, `is_rescheduled = true`, and incremented revision. Return the confirmed occurrence and both original and destination dates.
5. For restoration, validate the original date/time/room from the referenced slot version, rerun the same eligibility and conflict checks, then remove the record-free override so the normal recurrence reappears. Return a generated-style occurrence with the same `meeting_key` and `revision: 0`. Never delete a row with a lesson or attendance checklist.

The workspace lock must be acquired before eligibility, conflict checks, and mutation. A concurrent record save then either commits first and blocks the move, or sees the completed move and saves against its actual date. Restrict helper execution like the existing private functions; expose only the authenticated `dashboard_write` action. Use stable error codes for stale revision, saved-record ineligibility, and schedule conflict, and keep private teaching data out of error details.

## 2. Calendar read model

Extend `list_meetings` to return a **non-counting moved-from marker** on the original date when an override's actual date differs. The marker carries the stable meeting key and destination date/time, but is not an occurrence for meeting counts or record editing. Keep the existing suppression of the original generated occurrence and the inclusion of the moved-in occurrence on its actual date. Return each real occurrence once, including when the source and destination fall in different query ranges. A same-date time change needs a destination badge but no separate moved-from marker.

## 3. Client workflow

In `src/data/supabase.js`, add typed calls through the current `save(action, workspaceId, payload, operationId)` boundary. In `src/dashboard.js`, add **Reschedule this meeting** to eligible meeting details, with date, time, and room inputs. Show an explicit source-to-destination preview and require a separate confirmation before sending the write. Show **Restore original schedule** for a moved, still-eligible occurrence, with the same preview and confirmation.

Use `meeting.revision` for optimistic concurrency. On a confirmed response, update the affected in-memory calendar dates immediately, remove an old moved-from marker or add a new one as appropriate, and reselect the occurrence by its stable key. Re-fetch affected date ranges in the background only as reconciliation; do not wait for a general page reload before showing the result. Show a clear error and reload current meeting data after stale revision or conflict.

Display a destination badge on moved occurrences. Render the original-date marker as a link that navigates to the destination date and opens that same meeting. Its marker must not add to day/week counts, roster views, history, or totals.

## 4. Drafts and destination roster

Keep lesson and attendance drafts keyed by the original meeting key in `src/drafts.js`. On move or restore, load the destination roster using `actual_date` and compare its student IDs with any attendance draft's captured student IDs. If they differ, show the added and removed students and block account saving until the teacher explicitly chooses to reconcile or discard the attendance draft. Reconciliation retains choices and notes for students present on both dates, removes departed students from the proposed checklist, and initializes newly enrolled students visibly for review. Persist the reconciled draft as a new local version. Lesson drafts carry over without changing their key.

The server's first attendance save remains authoritative: it must validate the submitted roster against enrollment on the confirmed actual date. A roster change after reconciliation produces the existing roster-conflict response and leaves the local draft available.

## 5. Verification and rollout

Add PGlite migration tests for one-occurrence isolation, same-date changes, cross-week/month moves, moved-in and moved-out query ranges, restored recurrence, conflict boundaries, revision checks, idempotent retries, ownership, archived groups, and empty-but-saved lesson or attendance records. Verify that saving a record before a move blocks it and that saving after a move blocks restoration. Check that no failed move leaves a meeting or operation receipt behind.

Add frontend tests for preview and explicit confirmation, marker navigation and non-counting behavior, direct calendar update, stable lesson and attendance draft keys, roster additions/removals and required reconciliation, failed writes preserving drafts, and stale responses. Run the full regression suite and production build. Because PGlite uses one connection, also exercise a two-connection PostgreSQL concurrency test in a disposable development environment before claiming the save-versus-move race is proven. Apply the migration to the hosted development project only after local tests pass, then smoke-test cross-week navigation and restore with disposable data.

## Completion gate

- One Wednesday move leaves every other Wednesday on its recurring schedule.
- Cross-week and cross-month source links and destination occurrences appear on the correct dates and count once.
- Any saved lesson or attendance checklist blocks move and restore, including an empty lesson.
- If a record save commits first, the move fails; if the move commits first, the record saves against the moved occurrence and then blocks restoration.
- Lesson and attendance drafts retain the original key; attendance cannot be saved after a roster change without explicit reconciliation.
- Restore reactivates the original recurrence only after the same conflict and eligibility checks pass.
