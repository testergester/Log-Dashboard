function saveChecklist_(request) {
  const input = request.checklist || {};
  const schemaVersion = Number(input.schemaVersion == null ? 1 : input.schemaVersion);
  if (schemaVersion !== 1) throw new Error('Unsupported checklist JSON version.');
  const classId = String(input.classId || '');
  const date = date_(input.date);
  if (!Array.isArray(input.records) || !input.records.length || input.records.length > 100) {
    throw new Error('A checklist needs 1 to 100 students.');
  }
  const records = input.records.map(function(item) {
    item = item || {};
    const studentId = String(item.studentId || '');
    const attendance = String(item.attendance || '');
    const participation = Number(item.participation);
    const note = jsonText_(item.note, 'Student note', 300, false);
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
    const checklistRowNumbers = findDateRows_(checklistSheet, classId, date);
    // Use the last matching row as the canonical record. A locked re-check
    // makes simultaneous or repeated submissions update instead of append.
    const checklistRowNumber = checklistRowNumbers.length
      ? checklistRowNumbers[checklistRowNumbers.length - 1] : 0;
    if (!checklistRowNumber && String(classRow[7]).toLowerCase() === 'false') throw new Error('Cannot start a checklist for an archived class.');
    // The dashboard controls which meetings can be opened. Do not reject a
    // correction merely because the weekly timetable was edited afterwards.
    const previousRow = checklistRowNumber
      ? checklistSheet.getRange(checklistRowNumber, 1, 1, DASHBOARD.checklistHeaders.length).getDisplayValues()[0]
      : null;
    const previousRevision = previousRow ? previousRow[2] : '';
    const previousPayload = previousRow && previousRow[4]
      ? parseChecklistJson_(previousRow[4], classId, date, previousRevision) : null;
    const savedIds = previousPayload
      ? previousPayload.records.map(function(record) { return record.studentId; })
      : checklistRowNumber
        ? rowsWithDates_(spreadsheet.getSheetByName(DASHBOARD.studentRecords), [1]).filter(function(row) {
            return row[0] === classId && row[1] === date && row[2] === previousRevision;
          }).map(function(row) { return row[3]; }) : [];
    const enrolledIds = rowsWithDates_(spreadsheet.getSheetByName(DASHBOARD.enrollments), [2, 3]).filter(function(row) {
      return row[0] === classId && enrolledOn_(row, date);
    }).map(function(row) { return row[1]; });
    const expected = Array.from(new Set(savedIds.concat(enrolledIds)));
    if (expected.length !== ids.length || expected.some(function(id) { return ids.indexOf(id) < 0; })) {
      throw new Error('The class roster changed. Reload the dashboard before saving.');
    }
    const studentSheet = spreadsheet.getSheetByName(DASHBOARD.students);
    const studentNames = {};
    rows_(studentSheet).forEach(function(row) { if (row[0]) studentNames[row[0]] = row[1]; });
    if (ids.some(function(id) { return !studentNames[id]; })) {
      throw new Error('A student no longer exists. Reload the dashboard.');
    }
    const revision = Utilities.getUuid();
    const updatedAt = timestamp_();
    const classInfo = previousPayload ? previousPayload.classInfo : {
      id: classId, name: classRow[1], subject: classRow[2], start: classRow[4], end: classRow[5], room: classRow[6]
    };
    const payload = {
      schemaVersion: 1,
      classId: classId,
      lessonDate: date,
      revision: revision,
      updatedAt: updatedAt,
      classInfo: classInfo,
      records: records.map(function(item) {
        return {studentId: item.studentId, studentName: studentNames[item.studentId],
          attendance: item.attendance, participation: item.participation, note: item.note};
      })
    };
    if (previousPayload && sameChecklistRecords_(previousPayload.records, payload.records)) {
      return {classId: classId, date: date, revision: previousPayload.revision,
        updatedAt: previousPayload.updatedAt, storage: 'json-v1',
        recordCount: previousPayload.records.length, unchanged: true, checklist: previousPayload};
    }
    const json = JSON.stringify(payload);
    if (json.length > 45000) throw new Error('This checklist is too large to store in one JSON cell. Shorten student notes and try again.');
    // One meeting occupies one row. Corrections replace this JSON cell instead
    // of appending a row for every student on every submission.
    const marker = [classId, date, revision, updatedAt, json];
    if (checklistRowNumber) checklistSheet.getRange(checklistRowNumber, 1, 1, marker.length).setValues([marker]);
    else checklistSheet.appendRow(marker);
    return {classId: classId, date: date, revision: revision, updatedAt: updatedAt,
      storage: 'json-v1', recordCount: payload.records.length, checklist: payload};
  } finally {
    lock.releaseLock();
  }
}

function parseChecklistJson_(value, classId, date, revision) {
  let payload;
  try {
    payload = JSON.parse(String(value || ''));
  } catch (error) {
    throw new Error('Attendance JSON is invalid for ' + classId + ' on ' + date + '.');
  }
  if (!payload || Number(payload.schemaVersion) !== 1 || !Array.isArray(payload.records) ||
      !payload.records.length || payload.records.length > 100) {
    throw new Error('Attendance JSON has an unsupported format for ' + classId + ' on ' + date + '.');
  }
  if (String(payload.classId || '') !== String(classId) || String(payload.lessonDate || '') !== String(date) ||
      String(payload.revision || '') !== String(revision)) {
    throw new Error('Attendance JSON identifiers do not match its sheet row for ' + classId + ' on ' + date + '.');
  }
  if (!payload.classInfo || String(payload.classInfo.id || '') !== String(classId)) {
    throw new Error('Attendance JSON has invalid class information for ' + classId + ' on ' + date + '.');
  }
  const seen = {};
  payload.records.forEach(function(record) {
    const studentId = String(record && record.studentId || '');
    const attendance = String(record && record.attendance || '');
    const participation = Number(record && record.participation);
    const studentName = String(record && record.studentName || '');
    const note = String(record && record.note || '');
    if (!studentId || !studentName || studentName.length > 120 || note.length > 300 || seen[studentId] ||
        (attendance !== 'present' && attendance !== 'absent') ||
        !Number.isInteger(participation) || participation < -1 || participation > 1 ||
        (attendance === 'absent' && participation !== 0)) {
      throw new Error('Attendance JSON contains an invalid student record for ' + classId + ' on ' + date + '.');
    }
    seen[studentId] = true;
    record.studentId = studentId;
    record.studentName = studentName;
    record.attendance = attendance;
    record.participation = participation;
    record.note = note;
  });
  return payload;
}

function sameChecklistRecords_(left, right) {
  if (!left || left.length !== right.length) return false;
  const byStudent = {};
  left.forEach(function(record) { byStudent[record.studentId] = record; });
  return right.every(function(record) {
    const previous = byStudent[record.studentId];
    return previous && previous.studentName === record.studentName &&
      previous.attendance === record.attendance &&
      Number(previous.participation) === Number(record.participation) &&
      String(previous.note || '') === String(record.note || '');
  });
}

