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
  sessionSeconds: 21600,
  loginBlockSeconds: 900,
  loginLimit: 5,
  hashRounds: 12000,
  timetable: 'Timetable',
  logs: 'LessonLogs',
  students: 'Students',
  enrollments: 'ClassStudents',
  checklists: 'AttendanceChecklists',
  studentRecords: 'StudentMeetingRecords',
  timetableHeaders: ['Class ID', 'Class name', 'Subject', 'Weekday', 'Start time', 'End time', 'Room', 'Active', 'Updated at'],
  logHeaders: ['Class ID', 'Lesson date', 'Class name', 'Subject', 'Start time', 'End time', 'Room', 'Notes', 'Rating', 'Updated at'],
  studentHeaders: ['Student ID', 'Name', 'Updated at'],
  enrollmentHeaders: ['Class ID', 'Student ID', 'Joined on', 'Left on', 'Active', 'Updated at'],
  checklistHeaders: ['Class ID', 'Lesson date', 'Revision', 'Updated at'],
  studentRecordHeaders: ['Class ID', 'Lesson date', 'Revision', 'Student ID', 'Attendance', 'Participation', 'Note', 'Updated at']
});

function setupDashboard() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet) throw new Error('Open this script from the target Google Sheet.');
  const props = PropertiesService.getScriptProperties();
  props.setProperty('SPREADSHEET_ID', spreadsheet.getId());
  ensureTab_(spreadsheet, DASHBOARD.timetable, DASHBOARD.timetableHeaders);
  ensureTab_(spreadsheet, DASHBOARD.logs, DASHBOARD.logHeaders);
  ensureTab_(spreadsheet, DASHBOARD.students, DASHBOARD.studentHeaders);
  ensureTab_(spreadsheet, DASHBOARD.enrollments, DASHBOARD.enrollmentHeaders);
  ensureTab_(spreadsheet, DASHBOARD.checklists, DASHBOARD.checklistHeaders);
  ensureTab_(spreadsheet, DASHBOARD.studentRecords, DASHBOARD.studentRecordHeaders);

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

function login_(request) {
  const cache = CacheService.getScriptCache();
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const failures = Number(cache.get('LOGIN_FAILURES') || 0);
    if (failures >= DASHBOARD.loginLimit) throw new Error('Too many attempts. Try again in 15 minutes.');
    const props = PropertiesService.getScriptProperties();
    const expectedUser = props.getProperty('OWNER_USERNAME');
    const expectedHash = props.getProperty('PASSWORD_HASH');
    const salt = props.getProperty('PASSWORD_SALT');
    if (!expectedUser || !expectedHash || !salt) throw new Error('Dashboard setup is incomplete.');
    const username = String(request.username || '').trim();
    const password = String(request.password || '');
    const candidate = password.length && password.length <= 256 ? hashPassword_(password, salt) : '';
    if (username !== expectedUser || !constantTimeEqual_(candidate, expectedHash)) {
      cache.put('LOGIN_FAILURES', String(failures + 1), DASHBOARD.loginBlockSeconds);
      throw new Error('Incorrect username or password.');
    }
    cache.remove('LOGIN_FAILURES');
    const token = Utilities.getUuid() + Utilities.getUuid() + Utilities.getUuid();
    cache.put(sessionKey_(token), expectedUser, DASHBOARD.sessionSeconds);
    return {token: token, expiresIn: DASHBOARD.sessionSeconds};
  } finally {
    lock.releaseLock();
  }
}

function logout_(request) {
  const token = String(request.token || '');
  if (token) CacheService.getScriptCache().remove(sessionKey_(token));
  return {signedOut: true};
}

function requireSession_(request) {
  const token = String(request.token || '');
  if (!token || token.length > 200 || !CacheService.getScriptCache().get(sessionKey_(token))) {
    throw new Error('Session expired. Please sign in again.');
  }
}

function loadDashboard_() {
  const spreadsheet = spreadsheet_();
  const classes = rows_(spreadsheet.getSheetByName(DASHBOARD.timetable)).map(function(row) {
    return {id: row[0], name: row[1], subject: row[2], weekday: Number(row[3]), start: row[4], end: row[5], room: row[6], active: String(row[7]).toLowerCase() !== 'false', updatedAt: row[8]};
  }).filter(function(item) { return item.id; });
  const logs = rows_(spreadsheet.getSheetByName(DASHBOARD.logs)).map(function(row) {
    return {classId: row[0], date: row[1], className: row[2], subject: row[3], start: row[4], end: row[5], room: row[6], notes: row[7], rating: Number(row[8]) || null, updatedAt: row[9]};
  }).filter(function(item) { return item.classId && item.date; });
  const students = rows_(spreadsheet.getSheetByName(DASHBOARD.students)).map(function(row) {
    return {id: row[0], name: row[1], updatedAt: row[2]};
  }).filter(function(item) { return item.id; });
  const enrollments = rows_(spreadsheet.getSheetByName(DASHBOARD.enrollments)).map(function(row) {
    return {classId: row[0], studentId: row[1], joinedOn: row[2], leftOn: row[3],
      active: String(row[4]).toLowerCase() !== 'false'};
  }).filter(function(item) { return item.classId && item.studentId; });
  const checklists = rows_(spreadsheet.getSheetByName(DASHBOARD.checklists)).map(function(row) {
    return {classId: row[0], date: row[1], revision: row[2], updatedAt: row[3]};
  }).filter(function(item) { return item.classId && item.date && item.revision; });
  const current = {};
  checklists.forEach(function(item) { current[item.classId + '|' + item.date] = item.revision; });
  const studentRecords = rows_(spreadsheet.getSheetByName(DASHBOARD.studentRecords)).filter(function(row) {
    return row[2] === current[row[0] + '|' + row[1]];
  }).map(function(row) {
    return {classId: row[0], date: row[1], studentId: row[3], attendance: row[4], participation: Number(row[5]), note: row[6], updatedAt: row[7]};
  });
  return {classes: classes, logs: logs, students: students, enrollments: enrollments,
    checklists: checklists, studentRecords: studentRecords, timezone: DASHBOARD.timezone};
}

function saveClass_(request) {
  const item = request.class || {};
  const name = text_(item.name, 'Class name', 120, true);
  const subject = text_(item.subject, 'Subject', 120, true);
  const weekday = Number(item.weekday);
  if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7) throw new Error('Weekday must be 1 (Monday) through 7 (Sunday).');
  const start = time_(item.start, 'Start time');
  const end = time_(item.end, 'End time');
  if (start >= end) throw new Error('End time must be after start time.');
  const room = text_(item.room, 'Room', 120, false);
  const id = item.id ? String(item.id) : Utilities.getUuid();
  const sheet = spreadsheet_().getSheetByName(DASHBOARD.timetable);
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const rowNumber = findRow_(sheet, function(row) { return row[0] === id; });
    if (item.id && !rowNumber) throw new Error('Class no longer exists. Reload the dashboard.');
    if (rowNumber && String(sheet.getRange(rowNumber, 8).getValue()).toLowerCase() === 'false') throw new Error('Archived classes cannot be edited.');
    const row = [id, name, subject, weekday, start, end, room, true, timestamp_()];
    if (rowNumber) sheet.getRange(rowNumber, 1, 1, row.length).setValues([row]);
    else sheet.appendRow(row);
    return {id: id};
  } finally {
    lock.releaseLock();
  }
}

function archiveClass_(request) {
  const id = String(request.classId || '');
  if (!id) throw new Error('Class ID is required.');
  const sheet = spreadsheet_().getSheetByName(DASHBOARD.timetable);
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const rowNumber = findRow_(sheet, function(row) { return row[0] === id; });
    if (!rowNumber) throw new Error('Class no longer exists. Reload the dashboard.');
    sheet.getRange(rowNumber, 8, 1, 2).setValues([[false, timestamp_()]]);
    return {id: id, archived: true};
  } finally {
    lock.releaseLock();
  }
}

function saveLog_(request) {
  const input = request.log || {};
  const classId = String(input.classId || '');
  const date = date_(input.date);
  const notes = text_(input.notes, 'Notes', 5000, false);
  const rating = Number(input.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new Error('Choose a rating from 1 to 5.');
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const spreadsheet = spreadsheet_();
    const classSheet = spreadsheet.getSheetByName(DASHBOARD.timetable);
    const classRowNumber = findRow_(classSheet, function(row) { return row[0] === classId; });
    if (!classRowNumber) throw new Error('Class no longer exists. Reload the dashboard.');
    const classRow = classSheet.getRange(classRowNumber, 1, 1, DASHBOARD.timetableHeaders.length).getDisplayValues()[0];
    const logSheet = spreadsheet.getSheetByName(DASHBOARD.logs);
    const rowNumber = findRow_(logSheet, function(row) { return row[0] === classId && row[1] === date; });
    if (!rowNumber && String(classRow[7]).toLowerCase() === 'false') throw new Error('Cannot create a new log for an archived class.');
    if (!rowNumber && Number(classRow[3]) !== weekdayOf_(date)) throw new Error('This class is not scheduled for that weekday.');
    const previous = rowNumber ? logSheet.getRange(rowNumber, 1, 1, DASHBOARD.logHeaders.length).getDisplayValues()[0] : null;
    const row = [classId, date, previous ? previous[2] : classRow[1], previous ? previous[3] : classRow[2], previous ? previous[4] : classRow[4], previous ? previous[5] : classRow[5], previous ? previous[6] : classRow[6], notes, rating, timestamp_()];
    if (rowNumber) logSheet.getRange(rowNumber, 1, 1, row.length).setValues([row]);
    else logSheet.appendRow(row);
    return {classId: classId, date: date, updatedAt: row[9]};
  } finally {
    lock.releaseLock();
  }
}

function saveStudent_(request) {
  const input = request.student || {};
  const name = text_(input.name, 'Student name', 120, true);
  const id = input.id ? String(input.id) : Utilities.getUuid();
  const classId = input.classId ? String(input.classId) : '';
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const spreadsheet = spreadsheet_();
    const sheet = spreadsheet.getSheetByName(DASHBOARD.students);
    const rowNumber = findRow_(sheet, function(row) { return row[0] === id; });
    if (input.id && !rowNumber) throw new Error('Student no longer exists. Reload the dashboard.');
    if (classId) {
      const classSheet = spreadsheet.getSheetByName(DASHBOARD.timetable);
      const classRow = findRow_(classSheet, function(row) { return row[0] === classId && String(row[7]).toLowerCase() !== 'false'; });
      if (!classRow) throw new Error('Choose an active class.');
    }
    const row = [id, name, timestamp_()];
    if (rowNumber) sheet.getRange(rowNumber, 1, 1, row.length).setValues([row]);
    else sheet.appendRow(row);
    if (classId) setEnrollmentRow_(spreadsheet, classId, id, true);
    return {id: id};
  } finally {
    lock.releaseLock();
  }
}

function setEnrollment_(request) {
  const classId = String(request.classId || '');
  const studentId = String(request.studentId || '');
  if (typeof request.active !== 'boolean') throw new Error('Enrollment status is required.');
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const spreadsheet = spreadsheet_();
    const classRow = findRow_(spreadsheet.getSheetByName(DASHBOARD.timetable), function(row) {
      return row[0] === classId && String(row[7]).toLowerCase() !== 'false';
    });
    if (!classRow) throw new Error('Choose an active class.');
    if (!findRow_(spreadsheet.getSheetByName(DASHBOARD.students), function(row) { return row[0] === studentId; })) {
      throw new Error('Student no longer exists. Reload the dashboard.');
    }
    setEnrollmentRow_(spreadsheet, classId, studentId, request.active);
    return {classId: classId, studentId: studentId, active: request.active};
  } finally {
    lock.releaseLock();
  }
}

function setEnrollmentRow_(spreadsheet, classId, studentId, active) {
  const sheet = spreadsheet.getSheetByName(DASHBOARD.enrollments);
  const rowNumber = findRow_(sheet, function(row) {
    return row[0] === classId && row[1] === studentId && String(row[4]).toLowerCase() !== 'false';
  });
  if (active) {
    if (rowNumber) return;
    sheet.appendRow([classId, studentId, today_(), '', true, timestamp_()]);
  } else {
    if (!rowNumber) throw new Error('Student is not in this class.');
    sheet.getRange(rowNumber, 4, 1, 3).setValues([[today_(), false, timestamp_()]]);
  }
}

function today_() {
  return Utilities.formatDate(new Date(), DASHBOARD.timezone, 'yyyy-MM-dd');
}

function enrolledOn_(row, date) {
  return row[2] <= date && (!row[3] || date < row[3]);
}

function saveChecklist_(request) {
  const input = request.checklist || {};
  const classId = String(input.classId || '');
  const date = date_(input.date);
  if (!Array.isArray(input.records) || !input.records.length || input.records.length > 100) {
    throw new Error('A checklist needs 1 to 100 students.');
  }
  const records = input.records.map(function(item) {
    const studentId = String(item.studentId || '');
    const attendance = String(item.attendance || '');
    const participation = Number(item.participation);
    const note = text_(item.note, 'Student note', 300, false);
    if (!studentId || (attendance !== 'present' && attendance !== 'absent')) throw new Error('Invalid attendance entry.');
    if (!Number.isInteger(participation) || participation < -1 || participation > 1) throw new Error('Invalid participation mark.');
    if (attendance === 'absent' && participation !== 0) throw new Error('Absent students cannot receive a participation mark.');
    return {studentId: studentId, attendance: attendance, participation: participation, note: note};
  });
  const ids = records.map(function(item) { return item.studentId; });
  if (new Set(ids).size !== ids.length) throw new Error('A student appears more than once.');
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const spreadsheet = spreadsheet_();
    const classSheet = spreadsheet.getSheetByName(DASHBOARD.timetable);
    const classRowNumber = findRow_(classSheet, function(row) { return row[0] === classId; });
    if (!classRowNumber) throw new Error('Class no longer exists. Reload the dashboard.');
    const classRow = classSheet.getRange(classRowNumber, 1, 1, DASHBOARD.timetableHeaders.length).getDisplayValues()[0];
    const checklistSheet = spreadsheet.getSheetByName(DASHBOARD.checklists);
    const checklistRowNumber = findRow_(checklistSheet, function(row) { return row[0] === classId && row[1] === date; });
    if (!checklistRowNumber && String(classRow[7]).toLowerCase() === 'false') throw new Error('Cannot start a checklist for an archived class.');
    if (!checklistRowNumber && Number(classRow[3]) !== weekdayOf_(date)) throw new Error('This class is not scheduled for that weekday.');
    const previousRevision = checklistRowNumber ? checklistSheet.getRange(checklistRowNumber, 3).getDisplayValue() : '';
    const expected = checklistRowNumber
      ? rows_(spreadsheet.getSheetByName(DASHBOARD.studentRecords)).filter(function(row) {
          return row[0] === classId && row[1] === date && row[2] === previousRevision;
        }).map(function(row) { return row[3]; })
      : rows_(spreadsheet.getSheetByName(DASHBOARD.enrollments)).filter(function(row) {
          return row[0] === classId && enrolledOn_(row, date);
        }).map(function(row) { return row[1]; });
    if (expected.length !== ids.length || expected.some(function(id) { return ids.indexOf(id) < 0; })) {
      throw new Error('The class roster changed. Reload the dashboard before saving.');
    }
    const studentSheet = spreadsheet.getSheetByName(DASHBOARD.students);
    if (ids.some(function(id) { return !findRow_(studentSheet, function(row) { return row[0] === id; }); })) {
      throw new Error('A student no longer exists. Reload the dashboard.');
    }
    // Write a new version first. The checklist's revision is the commit marker,
    // so interrupted saves never affect visible totals or historical records.
    const revision = Utilities.getUuid();
    const updatedAt = timestamp_();
    const recordSheet = spreadsheet.getSheetByName(DASHBOARD.studentRecords);
    appendRows_(recordSheet, records.map(function(item) {
      return [classId, date, revision, item.studentId, item.attendance,
        item.participation, item.note, updatedAt];
    }));
    const marker = [classId, date, revision, updatedAt];
    if (checklistRowNumber) checklistSheet.getRange(checklistRowNumber, 1, 1, marker.length).setValues([marker]);
    else checklistSheet.appendRow(marker);
    return {classId: classId, date: date, updatedAt: updatedAt};
  } finally {
    lock.releaseLock();
  }
}

function appendRows_(sheet, values) {
  if (!values.length) return;
  const first = sheet.getLastRow() + 1;
  const needed = first + values.length - 1 - sheet.getMaxRows();
  if (needed > 0) sheet.insertRowsAfter(sheet.getMaxRows(), needed);
  sheet.getRange(first, 1, values.length, values[0].length).setValues(values);
}

function ensureTab_(spreadsheet, name, headers) {
  let sheet = spreadsheet.getSheetByName(name);
  if (!sheet) sheet = spreadsheet.insertSheet(name);
  const existing = sheet.getRange(1, 1, 1, headers.length).getDisplayValues()[0];
  if (existing.every(function(value) { return !value; })) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#dfeaf9');
    sheet.getRange(1, 1, sheet.getMaxRows(), headers.length).setNumberFormat('@');
  } else if (headers.some(function(header, index) { return existing[index] !== header; })) {
    throw new Error(name + ' has different column headers. No data was changed on that tab.');
  }
}

function spreadsheet_() {
  const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!id) throw new Error('Run setupDashboard before using the web app.');
  return SpreadsheetApp.openById(id);
}

function rows_(sheet) {
  const last = sheet.getLastRow();
  if (last < 2) return [];
  return sheet.getRange(2, 1, last - 1, sheet.getLastColumn()).getDisplayValues();
}

function findRow_(sheet, match) {
  const data = rows_(sheet);
  for (let index = 0; index < data.length; index++) if (match(data[index])) return index + 2;
  return 0;
}

function text_(value, label, max, required) {
  const result = String(value == null ? '' : value).trim();
  if (required && !result) throw new Error(label + ' is required.');
  if (result.length > max) throw new Error(label + ' is too long.');
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(result)) throw new Error(label + ' contains unsupported characters.');
  return /^[=+\-@]/.test(result) ? "'" + result : result;
}

function time_(value, label) {
  const result = String(value || '');
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(result)) throw new Error(label + ' must use HH:MM.');
  return result;
}

function date_(value) {
  const result = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result)) throw new Error('Lesson date must use YYYY-MM-DD.');
  const date = new Date(result + 'T00:00:00Z');
  if (isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== result) throw new Error('Invalid lesson date.');
  return result;
}

function weekdayOf_(date) {
  return (new Date(date + 'T00:00:00Z').getUTCDay() + 6) % 7 + 1;
}

function timestamp_() {
  return Utilities.formatDate(new Date(), DASHBOARD.timezone, 'yyyy-MM-dd HH:mm:ss');
}

function hashPassword_(password, salt) {
  const saltBytes = Utilities.newBlob(salt).getBytes();
  let digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + ':' + password);
  for (let index = 1; index < DASHBOARD.hashRounds; index++) {
    digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, digest.concat(saltBytes));
  }
  return digest.map(function(byte) { return ('0' + (byte & 255).toString(16)).slice(-2); }).join('');
}

function sessionKey_(token) {
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, token);
  return 'SESSION_' + digest.map(function(byte) { return ('0' + (byte & 255).toString(16)).slice(-2); }).join('');
}

function constantTimeEqual_(a, b) {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index++) difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return difference === 0;
}

function json_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}

function response_(value, request) {
  if (!request.replyOrigin) return json_(value);
  const origin = String(request.replyOrigin);
  if (!isOriginSyntax_(origin)) {
    return json_({ok: false, error: 'Dashboard origin is not configured.'});
  }
  if (!isAllowedOrigin_(origin)) {
    value = {ok: false, error: 'Set ALLOWED_ORIGIN to the dashboard website origin in Script properties.', requestId: request.requestId};
  }
  const payload = JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
  const html = '<!doctype html><html><head><meta charset="utf-8"></head><body><script>window.top.postMessage(' +
    JSON.stringify({type: 'teaching-dashboard-response', payload: payload}) + ', ' +
    JSON.stringify(origin) + ');</script></body></html>';
  return HtmlService.createHtmlOutput(html).setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function isAllowedOrigin_(origin) {
  return isOriginSyntax_(origin) &&
    String(origin) === String(PropertiesService.getScriptProperties().getProperty('ALLOWED_ORIGIN') || '');
}

function isOriginSyntax_(origin) {
  try {
    const url = new URL(String(origin));
    return url.protocol === 'https:' && url.origin === String(origin);
  } catch (error) {
    return false;
  }
}
