# Apps Script backend

The backend is split across these `.gs` files. Put **all of them in the same Google Apps Script project** as separate script files:

| File | Responsibility |
| --- | --- |
| `AppsScript.gs` | Configuration, setup, and web app entry points |
| `Auth.gs` | Login, logout, and session checks |
| `DashboardData.gs` | Read dashboard data |
| `ClassesAndLogs.gs` | Save classes and lesson logs |
| `Students.gs` | Students and enrollments |
| `Attendance.gs` | Attendance checklists and JSON validation |
| `WeeklyView.gs` | Generated weekly sheet and edit trigger |
| `Sheets.gs` | Sheet setup and row helpers |
| `Validation.gs` | Input, date, and time validation |
| `SecurityAndResponses.gs` | Password hashing and web responses |

Apps Script shares top-level functions across script files in one project, so no imports or build step are needed. After updating the project, run `setupDashboard()` and deploy a new web app version.

`AppsScript.full-backup.txt` is an unchanged copy of the original, complete script. Keep it outside the Apps Script project while using the split files; adding it alongside them would define every function twice. To restore the original, remove the split `.gs` files from the Apps Script project, create one `AppsScript.gs` file with the backup's contents, then deploy a new web app version.
