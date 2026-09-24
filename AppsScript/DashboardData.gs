function loadDashboard_() {
  const spreadsheet = spreadsheet_();
  // Setup and timetable writes maintain the sheets. Reads must not rewrite
  // them; opening the dashboard should only load records.
  const classes = rows_(spreadsheet.getSheetByName(DASHBOARD.timetable)).map(function(row) {
    return {id: row[0], name: row[1], subject: row[2], weekday: Number(row[3]), start: storedTime_(row[4]), end: storedTime_(row[5]), room: row[6], active: String(row[7]).toLowerCase() !== 'false', updatedAt: row[8]};
  }).filter(function(item) { return item.id; });
  const logs = rowsWithDates_(spreadsheet.getSheetByName(DASHBOARD.logs), [1]).map(function(row) {
    return {classId: row[0], date: row[1], className: row[2], subject: row[3], start: storedTime_(row[4]), end: storedTime_(row[5]), room: row[6], notes: row[7], rating: Number(row[8]) || null, updatedAt: row[9], lessonType: row[10] || 'Lesson', lessonStatus: row[11] || 'Done'};
  }).filter(function(item) { return item.classId && item.date; });
  const students = rows_(spreadsheet.getSheetByName(DASHBOARD.students)).map(function(row) {
    return {id: row[0], name: row[1], updatedAt: row[2]};
  }).filter(function(item) { return item.id; });
  const enrollments = rowsWithDates_(spreadsheet.getSheetByName(DASHBOARD.enrollments), [2, 3]).map(function(row) {
    return {classId: row[0], studentId: row[1], joinedOn: row[2], leftOn: row[3],
      active: String(row[4]).toLowerCase() !== 'false'};
  }).filter(function(item) { return item.classId && item.studentId; });
  const checklistByMeeting = {};
  rowsWithDates_(spreadsheet.getSheetByName(DASHBOARD.checklists), [1]).map(function(row) {
    const payload = row[4] ? parseChecklistJson_(row[4], row[0], row[1], row[2]) : null;
    return {classId: row[0], date: row[1], revision: row[2], updatedAt: row[3],
      storage: payload ? 'json-v1' : 'legacy-rows', recordCount: payload ? payload.records.length : null,
      classInfo: payload ? payload.classInfo : null, records: payload ? payload.records : null};
  }).filter(function(item) { return item.classId && item.date && item.revision; }).forEach(function(item) {
    // A class can have only one attendance record per date. If historical
    // duplicates exist, expose only the last row until it is next corrected.
    checklistByMeeting[item.classId + '|' + item.date] = item;
  });
  const checklists = Object.keys(checklistByMeeting).map(function(key) { return checklistByMeeting[key]; });
  const legacyRevisions = {};
  checklists.filter(function(item) { return !item.records; }).forEach(function(item) {
    legacyRevisions[item.classId + '|' + item.date] = item.revision;
  });
  const legacyStudentRecords = Object.keys(legacyRevisions).length
    ? rowsWithDates_(spreadsheet.getSheetByName(DASHBOARD.studentRecords), [1]).filter(function(row) {
        return row[2] === legacyRevisions[row[0] + '|' + row[1]];
      }).map(function(row) {
        return {classId: row[0], date: row[1], studentId: row[3], attendance: row[4], participation: Number(row[5]), note: row[6], updatedAt: row[7]};
      }) : [];
  const studentRecords = [];
  checklists.forEach(function(item) {
    if (item.records) {
      item.records.forEach(function(record) {
        studentRecords.push({classId: item.classId, date: item.date, studentId: record.studentId,
          studentName: record.studentName, attendance: record.attendance,
          participation: Number(record.participation), note: record.note, updatedAt: item.updatedAt});
      });
    } else {
      legacyStudentRecords.filter(function(record) {
        return record.classId === item.classId && record.date === item.date;
      }).forEach(function(record) { studentRecords.push(record); });
    }
  });
  return {classes: classes, logs: logs, students: students, enrollments: enrollments,
    checklists: checklists, studentRecords: studentRecords, attendanceStorage: 'json-v1', timezone: DASHBOARD.timezone};
}
