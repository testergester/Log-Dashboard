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
  const extras = item.meetings == null ? [] : item.meetings;
  if (!Array.isArray(extras) || extras.length > 6) throw new Error('A class can meet once on each weekday.');
  const meetings = [{weekday: weekday, start: start, end: end, room: room}];
  extras.forEach(function(entry) {
    entry = entry || {};
    const day = Number(entry.weekday);
    if (!Number.isInteger(day) || day < 1 || day > 7 || meetings.some(function(meeting) { return meeting.weekday === day; })) {
      throw new Error('Choose each weekday only once for a class.');
    }
    const extraStart = time_(entry.start, 'Start time');
    const extraEnd = time_(entry.end, 'End time');
    if (extraStart >= extraEnd) throw new Error('End time must be after start time for every meeting.');
    meetings.push({weekday: day, start: extraStart, end: extraEnd,
      room: text_(entry.room, 'Room', 120, false)});
  });
  const editingId = item.id ? String(item.id).trim() : '';
  const requestedId = item.requestedId ? groupId_(item.requestedId) : '';
  if (editingId && requestedId) throw new Error('Choose either an existing class ID or a new group ID.');
  const id = editingId || requestedId || Utilities.getUuid();
  const spreadsheet = spreadsheet_();
  const sheet = spreadsheet.getSheetByName(DASHBOARD.timetable);
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const rowNumber = findRow_(sheet, function(row) { return row[0] === id; });
    if (editingId && !rowNumber) throw new Error('Class no longer exists. Reload the dashboard.');
    if (!editingId && rowNumber) throw new Error('That group ID is already in use. Choose another one.');
    if (rowNumber && String(sheet.getRange(rowNumber, 8).getValue()).toLowerCase() === 'false') throw new Error('Archived classes cannot be edited.');
    const conflict = rows_(sheet).filter(function(row) {
      return row[0] !== id && String(row[7]).toLowerCase() !== 'false';
    }).map(function(row) {
      return {name: row[1], meetings: classMeetingsFromRow_(row)};
    }).find(function(existing) {
      return meetings.some(function(meeting) { return existing.meetings.some(function(other) {
        return other.weekday === meeting.weekday && timeMinutes_(meeting.start) < timeMinutes_(other.end) &&
          timeMinutes_(meeting.end) > timeMinutes_(other.start);
      }); });
    });
    if (conflict) throw new Error('A meeting overlaps with ' + conflict.name + '.');
    const row = [id, name, subject, weekday, start, end, room, true, timestamp_(), JSON.stringify(meetings.slice(1))];
    if (rowNumber) sheet.getRange(rowNumber, 1, 1, row.length).setValues([row]);
    else sheet.appendRow(row);
    sortTimetable_(sheet);
    SpreadsheetApp.flush();
    refreshWeeklyView_(spreadsheet);
    return {id: id, name: name, subject: subject, weekday: weekday, start: start,
      end: end, room: room, meetings: meetings, active: true, updatedAt: row[8]};
  } finally {
    lock.releaseLock();
  }
}

function archiveClass_(request) {
  const id = String(request.classId || '');
  if (!id) throw new Error('Class ID is required.');
  const spreadsheet = spreadsheet_();
  const sheet = spreadsheet.getSheetByName(DASHBOARD.timetable);
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const rowNumber = findRow_(sheet, function(row) { return row[0] === id; });
    if (!rowNumber) throw new Error('Class no longer exists. Reload the dashboard.');
    const updatedAt = timestamp_();
    sheet.getRange(rowNumber, 8, 1, 2).setValues([[false, updatedAt]]);
    refreshWeeklyView_(spreadsheet);
    return {id: id, archived: true, updatedAt: updatedAt};
  } finally {
    lock.releaseLock();
  }
}

function saveLog_(request) {
  const input = request.log || {};
  const classId = String(input.classId || '').trim();
  const date = date_(input.date);
  const notes = text_(input.notes, 'Notes', 5000, false);
  const rating = input.rating === null || input.rating === undefined || input.rating === '' ? '' : Number(input.rating);
  if (rating !== '' && (!Number.isInteger(rating) || rating < 1 || rating > 5)) throw new Error('Choose a rating from 1 to 5.');
  const lessonType = text_(input.lessonType || 'Lesson', 'Lesson type', 60, true);
  const lessonStatus = text_(input.lessonStatus || 'Done', 'Lesson status', 20, true);
  if (['Done', 'Skipped', 'Late', 'Cancelled'].indexOf(lessonStatus) === -1) throw new Error('Choose a valid lesson status.');
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const spreadsheet = spreadsheet_();
    const classSheet = spreadsheet.getSheetByName(DASHBOARD.timetable);
    const classRowNumber = findRow_(classSheet, function(row) { return row[0] === classId; });
    if (!classRowNumber) throw new Error('Class no longer exists. Reload the dashboard.');
    const classRow = classSheet.getRange(classRowNumber, 1, 1, DASHBOARD.timetableHeaders.length).getDisplayValues()[0];
    const logSheet = spreadsheet.getSheetByName(DASHBOARD.logs);
    const rowNumber = findDateRow_(logSheet, classId, date);
    if (!rowNumber && String(classRow[7]).toLowerCase() === 'false') throw new Error('Cannot create a new log for an archived class.');
    // The dashboard opens a concrete class meeting. Do not reject that meeting
    // because the weekly timetable was edited after the selected date.
    const previous = rowNumber ? logSheet.getRange(rowNumber, 1, 1, DASHBOARD.logHeaders.length).getDisplayValues()[0] : null;
    const lessonDay = (new Date(date + 'T00:00:00Z').getUTCDay() + 6) % 7 + 1;
    const meeting = classMeetingsFromRow_(classRow).find(function(item) { return item.weekday === lessonDay; });
    const row = [classId, date, previous ? previous[2] : classRow[1], previous ? previous[3] : classRow[2], previous ? previous[4] : meeting ? meeting.start : classRow[4], previous ? previous[5] : meeting ? meeting.end : classRow[5], previous ? previous[6] : meeting ? meeting.room : classRow[6], notes, rating, timestamp_(), lessonType, lessonStatus];
    if (rowNumber) logSheet.getRange(rowNumber, 1, 1, row.length).setValues([row]);
    else logSheet.appendRow(row);
    return {classId: classId, date: date, className: row[2], subject: row[3],
      start: storedTime_(row[4]), end: storedTime_(row[5]), room: row[6],
      notes: String(input.notes == null ? '' : input.notes).trim(), rating: rating || null,
      updatedAt: row[9], lessonType: lessonType, lessonStatus: lessonStatus};
  } finally {
    lock.releaseLock();
  }
}

function classMeetingsFromRow_(row) {
  const primary = {weekday: Number(row[3]), start: storedTime_(row[4]), end: storedTime_(row[5]), room: row[6] || ''};
  const extras = row[9] ? JSON.parse(row[9]) : [];
  if (!Array.isArray(extras)) throw new Error('Additional meetings JSON must be an array for ' + row[0] + '.');
  return [primary].concat(extras.map(function(item) {
    return {weekday: Number(item.weekday), start: storedTime_(item.start), end: storedTime_(item.end), room: item.room || ''};
  }));
}


function ensureArchivedLessonLogs_(spreadsheet) {
  const source = spreadsheet.getSheetByName(DASHBOARD.logs);
  const headers = source.getRange(1, 1, 1, source.getLastColumn()).getDisplayValues()[0];
  ensureTab_(spreadsheet, DASHBOARD.archivedLogs, headers.concat(['Archive reason', 'Archived at', 'Recover']));
  return spreadsheet.getSheetByName(DASHBOARD.archivedLogs);
}

function archiveLog_(request) {
  const reason = text_(request.reason, 'Why', 1000, true);
  const date = date_(request.date);
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const spreadsheet = spreadsheet_();
    const source = spreadsheet.getSheetByName(DASHBOARD.logs);
    const matches = findDateRows_(source, request.classId, date);
    if (matches.length !== 1) throw new Error('Expected one lesson record. Reload and check the sheet for duplicates.');
    const archive = ensureArchivedLessonLogs_(spreadsheet);
    const width = source.getLastColumn();
    const targetRow = archive.getLastRow() + 1;
    source.getRange(matches[0], 1, 1, width).copyTo(archive.getRange(targetRow, 1, 1, width));
    archive.getRange(targetRow, width + 1, 1, 2).setValues([[reason, timestamp_()]]);
    archive.getRange(targetRow, width + 3).insertCheckboxes();
    SpreadsheetApp.flush();
    source.deleteRow(matches[0]);
    return {classId: request.classId, date: date};
  } finally { lock.releaseLock(); }
}

function recoverArchivedLessonLogs() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  let recovered = 0;
  let conflicts = 0;
  try {
    const spreadsheet = spreadsheet_();
    const source = spreadsheet.getSheetByName(DASHBOARD.logs);
    const archive = ensureArchivedLessonLogs_(spreadsheet);
    const width = source.getLastColumn();
    const rows = rowsWithDates_(archive, [1]);
    for (let index = rows.length - 1; index >= 0; index--) {
      if (String(rows[index][width + 2]).toLowerCase() !== 'true') continue;
      if (findDateRow_(source, rows[index][0], rows[index][1])) { conflicts++; continue; }
      archive.getRange(index + 2, 1, 1, width).copyTo(source.getRange(source.getLastRow() + 1, 1, 1, width));
      SpreadsheetApp.flush();
      archive.deleteRow(index + 2);
      recovered++;
    }
  } finally { lock.releaseLock(); }
  SpreadsheetApp.getUi().alert('Recovered ' + recovered + ' lesson records. ' + conflicts + ' conflicts left in the archive because that class and date already exist. Reload the dashboard to see recovered records.');
}

function editLog_(request) {
  const input = request.log || {};
  const date = date_(input.date);
  const notes = text_(input.notes, 'Notes', 5000, false);
  const type = text_(input.lessonType, 'Lesson type', 60, true);
  const status = text_(input.lessonStatus, 'Lesson status', 20, true);
  if (['Done', 'Skipped', 'Late', 'Cancelled'].indexOf(status) === -1) throw new Error('Choose a valid lesson status.');
  const rating = input.rating == null || input.rating === '' ? '' : Number(input.rating);
  if (rating !== '' && (!Number.isInteger(rating) || rating < 1 || rating > 5)) throw new Error('Choose a rating from 1 to 5.');
  const name = text_(input.className, 'Class name', 120, true);
  const subject = text_(input.subject, 'Subject', 120, true);
  const start = time_(input.start, 'Start time');
  const end = time_(input.end, 'End time');
  if (start >= end) throw new Error('End time must be after start time.');
  const room = text_(input.room, 'Room', 120, false);
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sheet = spreadsheet_().getSheetByName(DASHBOARD.logs);
    const matches = findDateRows_(sheet, input.classId, date);
    if (matches.length !== 1) throw new Error('Lesson no longer exists or has duplicates. Reload the dashboard.');
    const current = sheet.getRange(matches[0], 10).getDisplayValues()[0][0];
    if (String(current) !== String(input.updatedAt || '')) throw new Error('This lesson changed elsewhere. Reload before editing.');
    const updated = timestamp_();
    sheet.getRange(matches[0], 3, 1, 10).setValues([[name, subject, start, end, room, notes, rating, updated, type, status]]);
    return {classId: input.classId, date: date, className: name, subject: subject, start: start, end: end, room: room, notes: input.notes || '', rating: rating || null, updatedAt: updated, lessonType: type, lessonStatus: status};
  } finally { lock.releaseLock(); }
}
