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

