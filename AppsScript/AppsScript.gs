/**
 * TEACHING DASHBOARD BACKEND
 *
 * Paste this file into Extensions > Apps Script for the spreadsheet you want to use.
 * In Project Settings > Script properties, add:
 *   OWNER_USERNAME = your chosen username
 *   SETUP_PASSWORD = a new password of at least 12 characters
 * Run setupDashboard after installing or updating this script. It creates missing
 * tabs, hashes a new SETUP_PASSWORD if provided, and deletes that property.
 * Then deploy as a Web app: Execute as Me; access Anyone.
 * Never put the password, hash, or script properties in GitHub Pages files.
 *
 * The GitHub Pages dashboard sends text/plain JSON POSTs and reads the JSON
 * response after the Apps Script redirect. ALLOWED_ORIGIN is only used by the
 * older hidden-frame response path; if used, set the exact origin without a
 * trailing slash, such as https://your-name.github.io.
 */

const DASHBOARD = Object.freeze({
  timezone: 'Asia/Tashkent',
  loginBlockSeconds: 900,
  loginLimit: 5,
  hashRounds: 12000,
  timetable: 'Timetable',
  weeklyView: 'WeeklyView',
  logs: 'LessonLogs',
  students: 'Students',
  enrollments: 'ClassStudents',
  checklists: 'AttendanceChecklists',
  studentRecords: 'StudentMeetingRecords',
  timetableHeaders: ['Class ID', 'Class name', 'Subject', 'Weekday', 'Start time', 'End time', 'Room', 'Active', 'Updated at'],
  logHeaders: ['Class ID', 'Lesson date', 'Class name', 'Subject', 'Start time', 'End time', 'Room', 'Notes', 'Rating', 'Updated at', 'Lesson type', 'Lesson status'],
  studentHeaders: ['Student ID', 'Name', 'Updated at'],
  enrollmentHeaders: ['Class ID', 'Student ID', 'Joined on', 'Left on', 'Active', 'Updated at'],
  checklistHeaders: ['Class ID', 'Lesson date', 'Revision', 'Updated at', 'Checklist JSON'],
  studentRecordHeaders: ['Class ID', 'Lesson date', 'Revision', 'Student ID', 'Attendance', 'Participation', 'Note', 'Updated at']
});

function setupDashboard() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet) throw new Error('Open this script from the target Google Sheet.');
  const props = PropertiesService.getScriptProperties();
  props.setProperty('SPREADSHEET_ID', spreadsheet.getId());
  ensureDashboardTabs_(spreadsheet);
  normalizeTimetableTimes_(spreadsheet.getSheetByName(DASHBOARD.timetable));
  sortTimetable_(spreadsheet.getSheetByName(DASHBOARD.timetable));
  SpreadsheetApp.flush();
  refreshWeeklyView_(spreadsheet);

  const username = (props.getProperty('OWNER_USERNAME') || '').trim();
  const temporaryPassword = props.getProperty('SETUP_PASSWORD');
  if (!username) throw new Error('Set OWNER_USERNAME in Script properties.');
  if (temporaryPassword) {
    if (temporaryPassword.length < 12) throw new Error('SETUP_PASSWORD must have at least 12 characters.');
    const salt = Utilities.getUuid() + Utilities.getUuid();
    props.setProperties({PASSWORD_SALT: salt, PASSWORD_HASH: hashPassword_(temporaryPassword, salt)});
    props.deleteProperty('SETUP_PASSWORD');
  }
  if (!props.getProperty('PASSWORD_HASH')) {
    throw new Error('Set SETUP_PASSWORD in Script properties, then run setupDashboard again.');
  }
  Logger.log('Dashboard setup complete. Spreadsheet ID: ' + spreadsheet.getId());
}

function doPost(e) {
  let request = {};
  try {
    const contents = e && e.postData && e.postData.contents;
    if (!contents) throw new Error('Missing request body.');
    if (contents.length > 50000) throw new Error('Request is too large.');
    request = JSON.parse((e.parameter && e.parameter.payload) || contents);
    if (request.replyOrigin && !isAllowedOrigin_(request.replyOrigin)) {
      throw new Error('Set ALLOWED_ORIGIN to the dashboard website origin in Script properties.');
    }
    const action = request && request.action;
    let data;
    switch (action) {
      case 'login': data = login_(request); break;
      case 'logout': data = logout_(request); break;
      case 'load': requireSession_(request); data = loadDashboard_(); break;
      case 'saveClass': requireSession_(request); data = saveClass_(request); break;
      case 'archiveClass': requireSession_(request); data = archiveClass_(request); break;
      case 'saveLog': requireSession_(request); data = saveLog_(request); break;
      case 'saveStudent': requireSession_(request); data = saveStudent_(request); break;
      case 'setEnrollment': requireSession_(request); data = setEnrollment_(request); break;
      case 'saveChecklist': requireSession_(request); data = saveChecklist_(request); break;
      default: throw new Error('Unknown action.');
    }
    return response_({ok: true, data: data, requestId: request.requestId}, request);
  } catch (error) {
    return response_({ok: false, error: String(error.message || error), requestId: request.requestId}, request);
  }
}

function doGet() {
  return json_({ok: true, data: {service: 'Teaching Dashboard', status: 'ready'}});
}

