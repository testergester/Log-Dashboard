/** Safe request diagnostics. Never log request bodies or raw dynamic messages. */
const DASHBOARD_LOG_MESSAGES_ = Object.freeze([
  "A checklist can have at most 100 students.",
  "A class can meet once on each weekday.",
  "A dashboard resource failed to load.",
  "A required spreadsheet tab is missing. Run setupDashboard again.",
  "A student appears more than once.",
  "A student no longer exists. Reload the dashboard.",
  "A student’s official group cannot be changed.",
  "Absent students cannot receive a participation mark.",
  "Add a student before saving a new checklist.",
  "Add your Apps Script URL first.",
  "Apps Script did not return JSON. Check the web app URL and deployment.",
  "Apps Script returned a mismatched response.",
  "Apps Script returned an unreadable response. Check the web app deployment.",
  "Archived classes cannot be edited.",
  "Cannot create a new log for an archived class.",
  "Cannot start a checklist for an archived class.",
  "Checklist changed on another device. Reload the dashboard before saving.",
  "Choose a rating from 1 to 5.",
  "Choose a student to archive.",
  "Choose a valid lesson status.",
  "Choose an active class.",
  "Choose an official group for the new student.",
  "Choose each weekday only once for a class.",
  "Choose either an existing class ID or a new group ID.",
  "Class ID is required.",
  "Class no longer exists. Reload the dashboard.",
  "Could not generate a unique student ID. Try again.",
  "Could not load records. Check the Apps Script deployment and try again.",
  "Could not reach Apps Script. Check the web app URL and deployment access.",
  "Could not reach Apps Script. Check your connection and try again.",
  "Dashboard setup is incomplete.",
  "End time must be after start time for every meeting.",
  "End time must be after start time.",
  "Enrollment status is required.",
  "Expected one lesson record. Reload and check the sheet for duplicates.",
  "Group ID must start with a letter or number and use only letters, numbers, spaces, dots, underscores, or hyphens.",
  "Incorrect username or password.",
  "Invalid attendance entry.",
  "Invalid groups",
  "Invalid lesson date.",
  "Invalid participation mark.",
  "Lesson date must use YYYY-MM-DD.",
  "Lesson no longer exists or has duplicates. Reload the dashboard.",
  "Migration was interrupted. Restore the backup spreadsheet before retrying.",
  "Missing request body.",
  "Official group ID cannot form a student ID.",
  "Open the dashboard spreadsheet to check student IDs.",
  "Open this script from the target Google Sheet.",
  "Other classes use one-meeting guest attendance, not ongoing enrollment.",
  "Request is too large.",
  "Run setupDashboard before using the web app.",
  "Run setupDashboard() to add the Official Group ID column first.",
  "SETUP_PASSWORD must have at least 12 characters.",
  "Session expired. Please sign in again.",
  "Set ALLOWED_ORIGIN to the dashboard website origin in Script properties.",
  "Set OWNER_USERNAME in Script properties.",
  "Set SETUP_PASSWORD in Script properties, then run setupDashboard again.",
  "Student has no official group. Run the student ID migration.",
  "Student is not in this class.",
  "Student no longer exists. Reload the dashboard.",
  "Student records are incomplete. Run setupDashboard and redeploy Apps Script.",
  "Student records are incomplete. Update and redeploy Apps Script.",
  "Students has blank or duplicate IDs. Correct them before migration.",
  "Students or ClassStudents is missing. Run setupDashboard first.",
  "That group ID is already in use. Choose another one.",
  "The Timetable tab is missing. Run setupDashboard again.",
  "The checklist save response was incomplete. Reload the dashboard.",
  "The class roster changed. Reload the dashboard before saving.",
  "The dashboard spreadsheet is unavailable. Run setupDashboard again.",
  "The login response did not include a session.",
  "The request timed out. Try again.",
  "The request timed out. Try refreshing records.",
  "The spreadsheet returned unexpected data.",
  "This checklist is too large to store in one JSON cell. Shorten student notes and try again.",
  "This lesson changed elsewhere. Reload before editing.",
  "Too many attempts. Try again in 15 minutes.",
  "Unknown action.",
  "Unsupported checklist JSON version.",
  "Weekday must be 1 (Monday) through 7 (Sunday)."
]);
const DASHBOARD_LOG_ACTIONS_ = Object.freeze(['login', 'logout', 'load', 'saveClass', 'archiveClass', 'archiveLog', 'editLog', 'saveLog', 'saveStudent', 'archiveStudent', 'setEnrollment', 'saveChecklist']);

function logDashboardRequest_(event, request, started, error) {
  try {
    const details = {
      service: 'Teaching Dashboard', event: event,
      time: new Date().toISOString(),
      action: DASHBOARD_LOG_ACTIONS_.indexOf(request.action) >= 0 ? request.action : 'unknown',
      requestId: /^[a-f0-9-]{36}$/.test(String(request.requestId || '')) ? request.requestId : '',
      durationMs: Math.max(0, Date.now() - started)
    };
    if (error) {
      const message = String(error.message || '');
      const safe = new Error(DASHBOARD_LOG_MESSAGES_.indexOf(message) >= 0
        ? message : 'Backend error details omitted to protect private data.');
      // Retain function names and script line numbers, excluding error text and URLs.
      safe.stack = 'Error: ' + safe.message + '\n' + String(error.stack || '').split('\n').slice(1)
        .filter(function(line) { return /^\s*at [A-Za-z_$][\w$]*(?: \([A-Za-z_][\w.-]*:\d+(?::\d+)?\))?\s*$/.test(line); })
        .slice(0, 12).join('\n');
      console.error(JSON.stringify(details));
      console.error(safe);
    } else {
      console.log(JSON.stringify(details));
    }
  } catch (loggingError) {
    // Diagnostics cannot change a request's success or error response.
  }
}
