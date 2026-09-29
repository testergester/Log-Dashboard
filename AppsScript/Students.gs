function saveStudent_(request) {
  const input = request.student || {};
  const name = text_(input.name, 'Student name', 120, true);
  const editingId = input.id ? String(input.id) : '';
  const classId = input.classId ? String(input.classId) : '';
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const spreadsheet = spreadsheet_();
    const sheet = spreadsheet.getSheetByName(DASHBOARD.students);
    const rowNumber = editingId ? findRow_(sheet, function(row) { return row[0] === editingId; }) : 0;
    if (editingId && !rowNumber) throw new Error('Student no longer exists. Reload the dashboard.');
    if (!editingId && !classId) throw new Error('Choose an official group for the new student.');
    if (classId) {
      const classSheet = spreadsheet.getSheetByName(DASHBOARD.timetable);
      const classRow = findRow_(classSheet, function(row) { return row[0] === classId && String(row[7]).toLowerCase() !== 'false'; });
      if (!classRow) throw new Error('Choose an active class.');
    }
    const officialGroupId = rowNumber ? sheet.getRange(rowNumber, 4).getDisplayValue() : classId;
    if (!officialGroupId) throw new Error('Student has no official group. Run the student ID migration.');
    if (rowNumber && classId && classId !== officialGroupId) throw new Error('A student’s official group cannot be changed.');
    const id = rowNumber ? editingId : newStudentId_(sheet, officialGroupId);
    const row = [id, name, timestamp_(), officialGroupId];
    if (rowNumber) sheet.getRange(rowNumber, 1, 1, row.length).setValues([row]);
    else sheet.appendRow(row);
    const enrollment = classId ? setEnrollmentRow_(spreadsheet, classId, id, true) : null;
    return {student: {id: id, name: String(input.name).trim(), updatedAt: row[2], officialGroupId: officialGroupId}, enrollment: enrollment};
  } finally {
    lock.releaseLock();
  }
}

function deleteStudent_(request) {
  const studentId = String(request.studentId || '').trim();
  if (!studentId) throw new Error('Choose a student to delete.');
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const spreadsheet = spreadsheet_();
    const students = spreadsheet.getSheetByName(DASHBOARD.students);
    const studentRow = findRow_(students, function(row) { return row[0] === studentId; });
    if (!studentRow) throw new Error('Student no longer exists. Reload the dashboard.');

    const checklists = spreadsheet.getSheetByName(DASHBOARD.checklists);
    const checklistUpdates = [];
    rowsWithDates_(checklists, [1]).forEach(function(row, index) {
      if (!row[4]) return;
      const payload = parseChecklistJson_(row[4], row[0], row[1], row[2]);
      const records = payload.records.filter(function(record) { return record.studentId !== studentId; });
      if (records.length === payload.records.length) return;
      const revision = Utilities.getUuid();
      const updatedAt = timestamp_();
      payload.records = records;
      payload.revision = revision;
      payload.updatedAt = updatedAt;
      checklistUpdates.push({row: index + 2, revision: revision, updatedAt: updatedAt, json: JSON.stringify(payload)});
    });
    checklistUpdates.forEach(function(item) {
      checklists.getRange(item.row, 3, 1, 3).setValues([[item.revision, item.updatedAt, item.json]]);
    });

    const enrollments = spreadsheet.getSheetByName(DASHBOARD.enrollments);
    const enrollmentRows = [];
    rows_(enrollments).forEach(function(row, index) {
      if (row[1] === studentId) enrollmentRows.push(index + 2);
    });
    const legacyRecords = spreadsheet.getSheetByName(DASHBOARD.studentRecords);
    const legacyRows = [];
    rows_(legacyRecords).forEach(function(row, index) {
      if (row[3] === studentId) legacyRows.push(index + 2);
    });
    legacyRows.reverse().forEach(function(row) { legacyRecords.deleteRow(row); });
    enrollmentRows.reverse().forEach(function(row) { enrollments.deleteRow(row); });
    students.deleteRow(studentRow);
    return loadDashboard_();
  } finally {
    lock.releaseLock();
  }
}

function studentGroupSegment_(groupId) {
  const segment = String(groupId || '').toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (!segment) throw new Error('Official group ID cannot form a student ID.');
  return segment;
}

function newStudentId_(sheet, groupId, usedIds) {
  const used = usedIds || new Set(rows_(sheet).map(function(row) { return row[0]; }));
  const prefix = 'ST-' + studentGroupSegment_(groupId) + '-';
  for (let attempt = 0; attempt < 100; attempt++) {
    const random = parseInt(Utilities.getUuid().replace(/-/g, '').slice(0, 10), 16).toString(36).padStart(8, '0');
    const id = prefix + random;
    if (!used.has(id)) { used.add(id); return id; }
  }
  throw new Error('Could not generate a unique student ID. Try again.');
}

// Fill complete rows entered or pasted directly into the Students sheet.
// The ID is created once, after both name (B) and official group (D) exist.
function fillMissingStudentIds_(spreadsheet, firstRow, lastRow) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = spreadsheet.getSheetByName(DASHBOARD.students);
    const start = Math.max(2, firstRow || 2);
    const end = Math.min(lastRow || sheet.getLastRow(), sheet.getLastRow());
    if (end < start) return 0;
    const rows = sheet.getRange(start, 1, end - start + 1, DASHBOARD.studentHeaders.length).getDisplayValues();
    const idFormulas = sheet.getRange(start, 1, rows.length, 1).getFormulas();
    const usedIds = new Set(rows_(sheet).map(function(row) { return row[0]; }).filter(Boolean));
    const activeGroups = new Set(rows_(spreadsheet.getSheetByName(DASHBOARD.timetable))
      .filter(function(row) { return row[0] && String(row[7]).toLowerCase() !== 'false'; })
      .map(function(row) { return row[0]; }));
    const generated = [];
    const stamp = timestamp_();
    rows.forEach(function(row, index) {
      const name = String(row[1] || '').trim();
      const groupId = String(row[3] || '').trim();
      if (row[0] || idFormulas[index][0] || !name || !groupId || !activeGroups.has(groupId)) return;
      generated.push({row: start + index, id: newStudentId_(sheet, groupId, usedIds),
        groupId: groupId, needsTimestamp: !row[2]});
    });
    if (!generated.length) return 0;
    writeStudentColumnRuns_(sheet, 1, generated.map(function(item) { return {row: item.row, value: item.id}; }));
    writeStudentColumnRuns_(sheet, 3, generated.filter(function(item) { return item.needsTimestamp; })
      .map(function(item) { return {row: item.row, value: stamp}; }));

    const enrollmentSheet = spreadsheet.getSheetByName(DASHBOARD.enrollments);
    const existing = new Set(rows_(enrollmentSheet).filter(function(row) {
      return String(row[4]).toLowerCase() !== 'false';
    }).map(function(row) { return row[0] + '\u0000' + row[1]; }));
    const joinedOn = today_();
    const enrollments = generated.filter(function(item) {
      return !existing.has(item.groupId + '\u0000' + item.id);
    }).map(function(item) { return [item.groupId, item.id, joinedOn, '', true, stamp]; });
    if (enrollments.length) {
      const nextRow = enrollmentSheet.getLastRow() + 1;
      const missingRows = nextRow + enrollments.length - 1 - enrollmentSheet.getMaxRows();
      if (missingRows > 0) enrollmentSheet.insertRowsAfter(enrollmentSheet.getMaxRows(), missingRows);
      enrollmentSheet.getRange(nextRow, 1, enrollments.length, DASHBOARD.enrollmentHeaders.length).setValues(enrollments);
    }
    return generated.length;
  } finally {
    lock.releaseLock();
  }
}

function writeStudentColumnRuns_(sheet, column, cells) {
  for (let index = 0; index < cells.length;) {
    let end = index + 1;
    while (end < cells.length && cells[end].row === cells[end - 1].row + 1) end++;
    sheet.getRange(cells[index].row, column, end - index, 1)
      .setValues(cells.slice(index, end).map(function(item) { return [item.value]; }));
    index = end;
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
    const studentRow = findRow_(spreadsheet.getSheetByName(DASHBOARD.students), function(row) { return row[0] === studentId; });
    if (!studentRow) {
      throw new Error('Student no longer exists. Reload the dashboard.');
    }
    if (request.active && spreadsheet.getSheetByName(DASHBOARD.students).getRange(studentRow, 4).getDisplayValue() !== classId) {
      throw new Error('Other classes use one-meeting guest attendance, not ongoing enrollment.');
    }
    return setEnrollmentRow_(spreadsheet, classId, studentId, request.active);
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
    if (rowNumber) {
      const row = sheet.getRange(rowNumber, 1, 1, DASHBOARD.enrollmentHeaders.length).getDisplayValues()[0];
      return {classId: classId, studentId: studentId, joinedOn: row[2], leftOn: '', active: true};
    }
    const joinedOn = today_();
    sheet.appendRow([classId, studentId, joinedOn, '', true, timestamp_()]);
    return {classId: classId, studentId: studentId, joinedOn: joinedOn, leftOn: '', active: true};
  } else {
    if (!rowNumber) throw new Error('Student is not in this class.');
    const joinedOn = sheet.getRange(rowNumber, 3).getDisplayValue();
    const leftOn = today_();
    sheet.getRange(rowNumber, 4, 1, 3).setValues([[leftOn, false, timestamp_()]]);
    return {classId: classId, studentId: studentId, joinedOn: joinedOn, leftOn: leftOn, active: false};
  }
}

function today_() {
  return Utilities.formatDate(new Date(), DASHBOARD.timezone, 'yyyy-MM-dd');
}

function enrolledOn_(row, date) {
  return row[2] <= date && (!row[3] || date < row[3]);
}
