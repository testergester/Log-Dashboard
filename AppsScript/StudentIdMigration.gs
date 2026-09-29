/**
 * Run once after setupDashboard() and before using the updated web app.
 * Creates a full spreadsheet backup in Drive before changing any existing data.
 * If a write fails, restore that backup rather than rerunning a partial migration.
 */
function migrateStudentIds() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const props = PropertiesService.getScriptProperties();
    const status = props.getProperty('STUDENT_ID_MIGRATION_STATUS');
    if (status === 'complete') return 'Student IDs were already migrated.';
    if (status === 'in-progress') throw new Error('Migration was interrupted. Restore the backup spreadsheet before retrying.');

    const spreadsheet = spreadsheet_();
    const studentSheet = spreadsheet.getSheetByName(DASHBOARD.students);
    const enrollmentSheet = spreadsheet.getSheetByName(DASHBOARD.enrollments);
    const legacySheet = spreadsheet.getSheetByName(DASHBOARD.studentRecords);
    const checklistSheet = spreadsheet.getSheetByName(DASHBOARD.checklists);
    const students = rows_(studentSheet);
    const enrollments = rowsWithDates_(enrollmentSheet, [2, 3]);
    const legacy = rows_(legacySheet);
    const checklists = rowsWithDates_(checklistSheet, [1]);
    const classIds = new Set(rows_(spreadsheet.getSheetByName(DASHBOARD.timetable)).map(function(row) { return row[0]; }));
    if (studentSheet.getRange(1, 4).getDisplayValue() !== 'Official Group ID') {
      throw new Error('Run setupDashboard() to add the Official Group ID column first.');
    }
    const oldIds = students.map(function(row) { return row[0]; });
    if (oldIds.some(function(id) { return !id; }) || new Set(oldIds).size !== oldIds.length) {
      throw new Error('Students has blank or duplicate IDs. Correct them before migration.');
    }
    const oldIdSet = new Set(oldIds);
    const usedIds = new Set(oldIds);
    const idMap = Object.create(null);
    const officialByStudent = Object.create(null);
    const officialGroups = [];
    students.forEach(function(student) {
      const matches = enrollments.map(function(row, index) { return {row: row, index: index}; })
        .filter(function(item) { return item.row[1] === student[0]; })
        .sort(function(left, right) {
          return String(left.row[2] || '9999-99-99').localeCompare(String(right.row[2] || '9999-99-99')) || left.index - right.index;
        });
      const groupId = student[3] || (matches.length ? matches[0].row[0] : '');
      if (!groupId || !classIds.has(groupId)) throw new Error('Student ' + student[0] + ' has no valid official group.');
      officialGroups.push(groupId);
      officialByStudent[student[0]] = groupId;
      idMap[student[0]] = /^ST-(?:[A-Z0-9]+-)+[a-z0-9]{8}$/.test(student[0])
        ? student[0] : newStudentId_(studentSheet, groupId, usedIds);
    });
    function migratedId_(id) {
      if (!oldIdSet.has(id)) throw new Error('An attendance or enrollment row references unknown student ' + id + '.');
      return idMap[id];
    }
    const newStudentIds = students.map(function(row) { return [migratedId_(row[0])]; });
    const newEnrollmentIds = enrollments.map(function(row) { return [migratedId_(row[1])]; });
    const newLegacyIds = legacy.map(function(row) { return [migratedId_(row[3])]; });
    const newChecklistJson = checklists.map(function(row) {
      if (!row[4]) return [''];
      const payload = parseChecklistJson_(row[4], row[0], row[1], row[2]);
      let changed = false;
      payload.records.forEach(function(record) {
        const next = migratedId_(record.studentId);
        if (next !== record.studentId) { record.studentId = next; changed = true; }
      });
      const json = changed ? JSON.stringify(payload) : row[4];
      if (json.length > 50000) throw new Error('Migrated checklist exceeds the Google Sheets cell limit for ' + row[0] + ' on ' + row[1] + '.');
      return [json];
    });
    const migrationDate = today_();
    const migrationTime = timestamp_();
    const ended = enrollments.map(function(row) {
      const officialGroup = officialByStudent[row[1]];
      const close = row[0] !== officialGroup && String(row[4]).toLowerCase() !== 'false' && !row[3];
      return {leftOn: close ? migrationDate : row[3], active: close ? false : row[4],
        updatedAt: close ? migrationTime : row[5]};
    });

    const backup = DriveApp.getFileById(spreadsheet.getId()).makeCopy(spreadsheet.getName() + ' - before student ID migration - ' + migrationTime.replace(/[: ]/g, '-'));
    props.setProperties({STUDENT_ID_MIGRATION_BACKUP_ID: backup.getId(), STUDENT_ID_MIGRATION_STATUS: 'in-progress'});
    if (students.length) {
      studentSheet.getRange(2, 1, students.length, 1).setValues(newStudentIds);
      studentSheet.getRange(2, 4, students.length, 1).setValues(officialGroups.map(function(group) { return [group]; }));
    }
    if (enrollments.length) {
      enrollmentSheet.getRange(2, 2, enrollments.length, 1).setValues(newEnrollmentIds);
      enrollmentSheet.getRange(2, 4, enrollments.length, 3).setValues(ended.map(function(item) {
        return [item.leftOn, item.active, item.updatedAt];
      }));
    }
    if (legacy.length) legacySheet.getRange(2, 4, legacy.length, 1).setValues(newLegacyIds);
    if (checklists.length) checklistSheet.getRange(2, 5, checklists.length, 1).setValues(newChecklistJson);
    SpreadsheetApp.flush();
    props.setProperty('STUDENT_ID_MIGRATION_STATUS', 'complete');
    Logger.log('Student ID migration complete. Backup spreadsheet: ' + backup.getUrl());
    return 'Student ID migration complete. Backup spreadsheet: ' + backup.getUrl();
  } finally {
    lock.releaseLock();
  }
}
