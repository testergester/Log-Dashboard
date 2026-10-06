# Apps Script backend

The backend is split across these `.gs` files. Put **all of them in the same Google Apps Script project** as separate script files:

| File | Responsibility |
| --- | --- |
| `AppsScript.gs` | Configuration, setup, and web app entry points |
| `Auth.gs` | Login, logout, and session checks |
| `DashboardData.gs` | Read dashboard data |
| `ClassesAndLogs.gs` | Save classes and lesson logs |
| `Students.gs` | Students and enrollments |
| `StudentIdMigration.gs` | One-time migration of existing student IDs and official groups |
| `Attendance.gs` | Attendance checklists and JSON validation |
| `WeeklyView.gs` | Generated weekly sheet and edit trigger |
| `Sheets.gs` | Sheet setup and row helpers |
| `Validation.gs` | Input, date, and time validation |
| `SecurityAndResponses.gs` | Password hashing and web responses |

Apps Script shares top-level functions across script files in one project, so no imports or build step are needed. After updating the project, run `setupDashboard()` and deploy a new web app version.

Classes can meet on several different weekdays, with a separate time and room for each day. The first meeting remains in the existing Timetable columns; additional days are stored in its `Additional meetings JSON` column, which `setupDashboard()` adds. The web dashboard and generated `WeeklyView` expand those meetings while keeping one class ID and one lesson record per class per date.

Lesson notes offer None, Bullet list, and Numbered list controls above the editor. New notes are saved as limited HTML in the existing notes column, and Previous records renders that formatting. Older plain-text notes remain readable without migration.

Sessions now expire 24 hours after sign-in. Existing sessions from older deployments have no expiration metadata and will require one new sign-in after deployment. Sign-out revokes the current session immediately. Run `setupDashboard()` before deploying so all required tabs exist; ordinary dashboard loads no longer create tabs or rebuild the weekly view. Timetable changes still update the weekly view.

After updating the website and backend together, saves update the dashboard from the confirmed response instead of loading every record again. If a checklist was changed in another browser or device, its save is rejected and the user's unsaved edits remain visible until they reload and reconcile them.

Run the local regression checks with the bundled Node.js runtime: `node tests/regression.test.js`.

## Archived students

The trash icon archives a student after confirmation. `setupDashboard()` creates the `ArchivedStudents` sheet; the archive action also creates it if it is missing. Each row keeps the student's full name, their known student IDs as a JSON array, previous group IDs and their roles as JSON, the removal date, and their former official group ID. Students with the same full name remain separate rows. The action removes the student from `Students` and all `ClassStudents` memberships, while saved JSON and legacy attendance records remain unchanged. Archived names remain available when viewing or correcting those saved checklists.

To restore students, update `AppsScript.gs`, `Students.gs` and `Sheets.gs` in the spreadsheet's Apps Script project, run `setupDashboard()`, then reload Google Sheets. In `ArchivedStudents`, check the **Recover** boxes in column G and choose **Teaching Dashboard → Recover checked students**. The action restores the original student ID, name and official group, adds memberships in the official and previously enrolled classes, and removes successfully recovered archive rows. Memberships start on the recovery date; saved attendance remains unchanged. Attendance-only groups are not rejoined. Duplicate IDs, invalid archive data, and missing or archived destination classes leave the student checked in the archive, with an explanation in the result dialog. Existing Recover selections survive repeated setup runs. Reload the dashboard afterward. Deploy a new web app version so future dashboard archives include the checkbox.

Run `node tests/student-recovery.test.js` for student recovery, conflict and partial-write rollback checks.

## Official groups and student IDs

In a group record, **Check sheet IDs** reloads the dashboard data and compares that group's `ClassStudents` IDs with the `Students` sheet. In the ID check report, green rows have IDs in both sheets; orange rows are students whose official group is this group but who have no matching `ClassStudents` row; red rows are `ClassStudents` IDs with no matching `Students` row. The attendance list uses green for present and red for absent, independently of the ID check. The check reports IDs and whether memberships are active. It only diagnoses the sheets and does not delete or reconstruct rows. Missing names in the attendance list display their IDs, so orphaned references can be located without guessing. A saved checklist can also retain a former student's ID; that historical row is separate from this two-sheet comparison.

The spreadsheet itself also has **Teaching Dashboard → Check student IDs**. Update `AppsScript.gs` and `Students.gs` in the spreadsheet's bound Apps Script project, save, then reload the Google Sheet to see the menu. The menu compares exact IDs across the entire `Students` and `ClassStudents` sheets, colors populated data rows green when an ID is in both, orange in `Students` when absent from `ClassStudents`, and red in `ClassStudents` when absent from `Students`. A popup reports unique ID counts. Run it again after manual edits to refresh the colors. It changes formatting only; it does not remove rows, add missing students, or modify attendance. This sheet menu uses the saved bound script and does not require a web app deployment.

New students receive an ID such as `ST-8E-th324frf` automatically. The middle part comes from their fixed official group ID, cleaned to uppercase letters, numbers, and hyphens. Adding an existing student from another group tags them for the currently selected meeting only; save that meeting's checklist to record their attendance.

You can also add students directly in the `Students` sheet: enter the name in column B and an existing active official group ID in column D. Leave column A empty. After either field is edited, the sheet's `onEdit` handler fills A with a unique ID, fills C if its timestamp is blank, and adds the student to `ClassStudents`. Pasting several complete rows works the same way. Rows missing a name or valid active group wait until corrected. Running `setupDashboard()` also fills complete rows that were added before this handler was installed.

For an existing spreadsheet, update all `.gs` files, then run `setupDashboard()` and `migrateStudentIds()` in the Apps Script editor **before** deploying the new web app version. The migration chooses each student's oldest enrollment as their official group. It updates all student references in enrollments and attendance, and ends other ongoing class memberships from the migration date. Historical attendance remains in place. A student with no valid group stops the migration before any data is changed; assign that student to their official group and rerun it.

`setupDashboard()` also repairs the old `ClassStudents` column A formula `=REGEXEXTRACT(B2,"^ST-(.*)-\d+$")` where present, replacing its digits-only suffix pattern with one that accepts the new eight-character letter-and-number suffix. It leaves other cells and formulas alone.

`migrateStudentIds()` makes a full Drive copy of the spreadsheet before writing. Its return value and execution log contain the backup URL. If a write fails, restore the original spreadsheet's data from that copy before trying again; the migration blocks a second run while marked `in-progress`. After restoring, delete the `STUDENT_ID_MIGRATION_STATUS` script property, then rerun. Keep the backup until you have checked student histories and guest attendance. Running the migration after a successful completion returns without changing data.

`AppsScript.full-backup.txt` is an unchanged copy of the original, complete script. Keep it outside the Apps Script project while using the split files; adding it alongside them would define every function twice. To restore the original, remove the split `.gs` files from the Apps Script project, create one `AppsScript.gs` file with the backup's contents, then deploy a new web app version.

## Lesson record editing and recovery

Previous records has Edit and Delete buttons. Edit opens recorded class details, times, room, notes, type, status and rating; class ID and lesson date identify the record and stay fixed. Concurrent edits are rejected if the saved timestamp changed. Delete requires a nonempty explanation. It copies the entire LessonLogs row (including extra columns and cell formatting) to ArchivedLessonLogs with Archive reason, Archived at and a Recover checkbox, then removes the original row. Attendance records are retained.

Update all .gs files, run setupDashboard(), deploy a new web app version, and update the website assets. Reload Google Sheets to see Teaching Dashboard → Recover checked lesson logs. Check Recover on the archived rows and use this menu to move them back. Existing class/date records are never overwritten; conflicting rows remain checked in the archive. Reload the dashboard afterward. If you add custom LessonLogs columns after creating the archive, align the archive headers before using it; a header mismatch stops the operation.

Run `node tests/lesson-records.test.js` for archive, recovery, duplicate and edit conflict checks.
