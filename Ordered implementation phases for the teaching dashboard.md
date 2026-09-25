# Ordered implementation phases for the teaching dashboard

Implement these phases **one at a time, in order**. Each phase should finish with working code, relevant tests, and a short handoff describing changes and remaining limitations. Do not start the next phase until its completion criteria pass.

This replaces the previous plan with executable phases covering all six selected features.

**Confirmed choices:** Supabase Free, Google sign-in, local autosaved drafts, explicit Save for official records, and rescheduling only meetings without saved notes or attendance.

## Phase 1 — Prepare the application structure

**Goal:** Make the existing code easier to extend without changing its current behavior.

**Tasks**

- Introduce Vite and a package lockfile while keeping vanilla JavaScript and the existing design.
- Split frontend responsibilities into authentication, data access, scheduling, lesson records, attendance, students, drafts, and reports.
- Move runtime configuration out of hardcoded application logic.
- Define a data-access interface so UI components do not call Apps Script or Supabase directly.
- Keep the existing Apps Script implementation behind the interface during this phase.
- Preserve the recent fixes for in-flight edits, attendance conflicts, session expiry, and confirmed-response updates.
- Add development, build, and test commands.
- Update setup documentation to reflect the new structure.

**Completion criteria**

- Existing regression tests pass.
- Login, timetable, notes, attendance, and student history retain their current behavior.
- The production build works locally.
- No production records or backend deployments change.

---

## Phase 2 — Create the Supabase database and access rules

**Goal:** Establish the shared foundation for private workspaces and independent meetings.

**Tasks**

Create versioned migrations for:

| Entity | Required responsibility |
|---|---|
| Workspace | Owner, display name, timezone |
| Group | Name, subject, optional code, archive state |
| Schedule slot | Group, weekday, times, room, effective dates |
| Meeting | Stable occurrence identity, actual date/time, snapshots |
| Student | Workspace-wide identity, name, optional external ID |
| Enrollment | Student, group, inclusive start and exclusive end dates |
| Lesson record | Meeting notes, rating, type/status, revision |
| Attendance checklist | Meeting, saved roster, revision |
| Attendance entry | Student attendance, participation, note |

- Scope every business record to its workspace.
- Prevent cross-workspace relationships through database constraints.
- Enforce one workspace per teacher.
- Enable row-level security for reads.
- Route writes through authenticated transactional functions that verify ownership and related records; prevent direct browser writes from bypassing validation.
- Add revision checks and operation IDs for safe retries.
- Define stable error codes for validation, conflicts, missing records, and authentication.
- Use `scheduleSlotId + originalDate` as the stable recurring meeting key. Actual rescheduled dates must not change identity.
- Generate schedule occurrences during reads; persist meeting rows only when a record or exception is written.
- Index ownership, meeting dates, enrollments, and student-history queries.

**Completion criteria**

- Two test teachers cannot read or change each other’s records.
- Invalid cross-workspace references are rejected.
- Repeated operation IDs cannot duplicate writes.
- Stale revisions cannot silently overwrite newer records.
- Database migrations can recreate the development environment.

---

## Phase 3 — Add Google signup and private workspaces

**Goal:** A teacher can join without configuring Apps Script.

**Tasks**

- Add **Continue with Google** using Supabase Auth and PKCE.
- Implement the OAuth callback and exact redirect configuration.
- Request basic Google identity scopes only.
- On first sign-in, create the workspace idempotently and collect display name and timezone.
- Default timezone to `Asia/Tashkent`; allow changes before schedules exist.
- Show first-use actions: **Create your first group** and **Import students**. Keep unavailable actions disabled until their phases ship.
- Restore returning teachers’ sessions through Supabase.
- Add account identity and Sign out in Settings.
- Remove Apps Script connection settings from the new product experience.
- Keep legacy authentication available only in the preserved legacy build.
- Add explicit loading, cancellation, expired-session, and retry states.

**Completion criteria**

- New and returning Google accounts work.
- Repeated OAuth callbacks do not create duplicate workspaces.
- Authentication failure never exposes private content or a misleading connected state.
- Account switching clears the previous account’s rendered data.
- No privileged Supabase or Google secrets appear in the browser bundle.

---

## Phase 4 — Implement groups, recurring meetings, and existing record workflows

**Goal:** Deliver a usable Supabase-backed dashboard with multiple meetings per group.

**Tasks**

- Replace “one class equals one weekly slot” with a group containing multiple schedule slots.
- Support several weekdays and multiple non-overlapping meetings on the same day.
- Require a start date; make the schedule end date optional.
- Reuse the current day/week views, displaying distinct meeting identities.
- Load the visible week initially, individual meeting details on demand, and older history through pagination.
- Port group editing/archiving, individual student management, enrollment, lesson saving, attendance saving, and student history to Supabase.
- Preserve current notes, rating, lesson types/statuses, attendance categories, and point rules.
- Keep separate lesson and attendance Save actions.
- Apply confirmed responses locally without reloading all history.
- Reject overlapping commitments across all groups; allow back-to-back meetings.
- Make recurring schedule edits effective from a selected date, defaulting to today.
- Preserve saved meeting snapshots and historical slot versions.
- Resolve unsaved rosters from enrollment dates; freeze roster snapshots after attendance is saved.
- Add the migration mapping logic needed to represent legacy class/date records as independent meetings. Do not run the production migration yet.

**Completion criteria**

- A Monday/Wednesday/Friday group shares one roster and history.
- Two meetings on the same date have independent notes and attendance.
- Recurring schedule edits do not rewrite historical records.
- Archived groups retain their history.
- Attendance and lesson saves retain newer edits made during requests.
- The new app can complete the existing daily teaching workflow.

---

## Phase 5 — Add recoverable local drafts

**Goal:** Refreshes and failed requests do not erase unfinished work.

**Tasks**

- Store drafts in IndexedDB using account, workspace, meeting key, and record type.
- Include content, local version, base server revision, schema version, and edit timestamp.
- Save text drafts after 300 ms of inactivity; save attendance selections immediately.
- Flush pending text changes on blur and navigation.
- Restore drafts after the same teacher signs in.
- Display accurate states: **Saving on this device**, **Saved on this device**, **Saving to account**, **Synced**, and **Save failed**.
- Keep totals and reports based exclusively on explicitly saved server records.
- Submit immutable snapshots; clear only the local version confirmed by the response.
- Compare restored drafts against server revisions. Show conflicting versions and require an explicit choice before saving.
- Detect competing edits in another tab and require takeover.
- Keep failed saves locally and offer Retry; do not automatically submit official records after reconnecting.
- On explicit sign-out, offer Cancel or Discard and sign out when drafts exist.
- Clear local teaching data on confirmed sign-out; retain account-scoped drafts after session expiry.
- Handle unavailable/full browser storage without claiming the draft was saved.

**Completion criteria**

- Refresh restores every editable lesson and attendance field.
- Failed saves and session expiry preserve drafts.
- In-flight edits survive successful saves.
- Another account cannot restore the previous teacher’s drafts.
- Opening an untouched roster does not create official attendance.

**Boundary:** Full offline startup and cross-device draft synchronization remain outside this version.

---

## Phase 6 — Add single-meeting rescheduling

**Goal:** Move one occurrence without changing its recurring schedule.

**Tasks**

- Add **Reschedule this meeting** with replacement date, times, and room.
- Show a preview before confirmation.
- Store the move as an override under the original meeting key.
- Add a destination badge and a link from the original date.
- Include moved-in occurrences and suppress moved-out occurrences in calendar queries.
- Reject moves if either saved lesson records or saved attendance exist, including records with empty notes.
- Check eligibility and scheduling conflicts transactionally.
- Serialize scheduling changes within a workspace to prevent simultaneous conflicting moves.
- Carry local drafts with the stable meeting key.
- Reconcile unsaved attendance drafts against enrollment on the destination date and identify roster changes.
- Add **Restore original schedule**, subject to the same eligibility and conflict checks.
- Update affected calendar views directly from the confirmed response.

**Completion criteria**

- Moving one Wednesday meeting leaves future Wednesdays unchanged.
- Cross-week and cross-month moves display correctly.
- Saved notes or attendance block rescheduling.
- A concurrent save cannot bypass the restriction.
- Drafts remain attached after moving or restoring.
- The meeting appears and counts only once.

---

## Phase 7 — Add bulk student import

**Goal:** Populate a group quickly without creating accidental duplicate students.

**Tasks**

- Add **Import students** inside a group.
- Accept pasted names and UTF-8 CSV using Papa Parse.
- Provide a template with required `name` and optional `external_id`.
- Support column mapping and an enrollment start date, defaulting to today.
- Limit files to 1 MB and imports to 100 rows; enforce the existing 100-student meeting limit.
- Validate names at 1–120 characters.
- Preview row numbers, errors, duplicates, and proposed actions.
- Match external IDs; flag conflicting names.
- Treat matching names as possible duplicates rather than automatically merging them.
- Require ambiguous rows to be marked **Use existing**, **Create separate**, or **Skip**.
- Preserve existing student names.
- Commit the confirmed selection in one transaction with an operation ID.
- Recheck references and roster limits during commit.
- Return counts of created, reused, enrolled, and skipped students.
- Discard uploaded files after processing.

**Completion criteria**

- Unicode names, quoted commas, blank lines, and CSV byte-order marks work.
- Same-name students can remain distinct.
- Existing students can join additional groups.
- Invalid rows are corrected or explicitly skipped before submission.
- Failures leave no partial import.
- Retrying a completed operation creates no duplicates.

---

## Phase 8 — Add student PDF progress reports

**Goal:** Turn saved records into a useful, downloadable student report.

**Tasks**

- Add **Export progress report** to student history.
- Select one group and an inclusive date range, defaulting to this month through today.
- Fetch a consistent report snapshot through an authenticated database operation.
- Show a preview using the same dataset as the PDF.
- Include teacher/student/group details, recorded meetings, attendance counts and percentage, participation, absence deductions, and combined score.
- Calculate attendance as `present / (present + absent) × 100`, rounded to one decimal.
- Display **No recorded attendance** when the denominator is zero.
- Exclude future, Cancelled, Skipped, and draft records.
- Count saved attendance even when no separate lesson log exists.
- Use actual meeting dates and saved student entries; never infer attendance from schedules.
- Include no notes by default. Allow selection of individual student notes; exclude general class notes.
- Generate PDFs locally with jsPDF and AutoTable.
- Bundle a licensed Latin/Cyrillic font; use A4 portrait, wrapped text, repeated headings, and page numbers.
- Do not upload generated reports or create public links.

**Completion criteria**

- Three present and one absent entry produce 75.0%.
- Preview and PDF totals match.
- Rescheduled meetings use their actual dates.
- Only the selected student’s data appears.
- Long notes, Unicode names, and multipage tables render correctly.

---

## Phase 9 — Migrate existing records and release the pilot

**Goal:** Move the current owner safely to the new product and make signup usable for other teachers.

**Tasks**

- Create an owner-run export of source records without credentials or sessions.
- Implement migration dry-run, validation, explicit owner/workspace selection, and repeat-safe legacy ID mapping.
- Map each existing class to a group and slot without merging matching names.
- Preserve students, dated enrollments, archived classes, snapshots, notes, and canonical attendance revisions.
- Import historical meetings even when they no longer match the current timetable.
- Compare source/destination counts and per-student totals.
- Preserve the source export and legacy app.
- Stop old-app writes during final cutover; make Supabase the sole writable source.
- Document rollback reconciliation for any records created after cutover.
- Deploy the static frontend to Cloudflare Pages and configure production OAuth.
- Run an owner pilot before opening signup to additional teachers.
- Document setup, migration, backup export/restore, and free-tier usage monitoring.
- Log operation IDs and error codes without student names or notes.

**Completion criteria**

- Migration rehearsal preserves counts, relationships, and totals.
- Rerunning migration does not duplicate records.
- Two teachers complete the full workflow independently.
- Browser tests cover authentication, draft recovery, conflicts, scheduling, import, and reports.
- Keyboard navigation, dialog focus, and mobile layouts work.
- Database size and free-tier limits have an operational check procedure.

**Scope retained throughout:** one teacher per workspace, English interface, Monday-first weeks, current scoring rules, and Google-only sign-in. Billing, shared teaching, parent/student accounts, gradebooks, and automatic report delivery are excluded.
