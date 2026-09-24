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
    const conflict = rows_(sheet).map(function(row) {
      return {id: row[0], name: row[1], weekday: Number(row[3]), start: storedTime_(row[4]),
        end: storedTime_(row[5]), active: String(row[7]).toLowerCase() !== 'false'};
    }).find(function(existing) {
      return existing.active && existing.id !== id && existing.weekday === weekday &&
        timeMinutes_(start) < timeMinutes_(existing.end) && timeMinutes_(end) > timeMinutes_(existing.start);
    });
    if (conflict) throw new Error('This time overlaps with ' + conflict.name + ' (' + conflict.start + '–' + conflict.end + ').');
    const row = [id, name, subject, weekday, start, end, room, true, timestamp_()];
    if (rowNumber) sheet.getRange(rowNumber, 1, 1, row.length).setValues([row]);
    else sheet.appendRow(row);
    sortTimetable_(sheet);
    SpreadsheetApp.flush();
    refreshWeeklyView_(spreadsheet);
    return {id: id};
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
    sheet.getRange(rowNumber, 8, 1, 2).setValues([[false, timestamp_()]]);
    refreshWeeklyView_(spreadsheet);
    return {id: id, archived: true};
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
    const row = [classId, date, previous ? previous[2] : classRow[1], previous ? previous[3] : classRow[2], previous ? previous[4] : classRow[4], previous ? previous[5] : classRow[5], previous ? previous[6] : classRow[6], notes, rating, timestamp_(), lessonType, lessonStatus];
    if (rowNumber) logSheet.getRange(rowNumber, 1, 1, row.length).setValues([row]);
    else logSheet.appendRow(row);
    return {classId: classId, date: date, updatedAt: row[9]};
  } finally {
    lock.releaseLock();
  }
}

