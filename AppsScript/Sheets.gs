function ensureDashboardTabs_(spreadsheet) {
  if (!spreadsheet) throw new Error('The dashboard spreadsheet is unavailable. Run setupDashboard again.');
  ensureTab_(spreadsheet, DASHBOARD.timetable, DASHBOARD.timetableHeaders);
  ensureTab_(spreadsheet, DASHBOARD.logs, DASHBOARD.logHeaders);
  ensureTab_(spreadsheet, DASHBOARD.students, DASHBOARD.studentHeaders);
  ensureTab_(spreadsheet, DASHBOARD.enrollments, DASHBOARD.enrollmentHeaders);
  ensureTab_(spreadsheet, DASHBOARD.checklists, DASHBOARD.checklistHeaders);
  ensureTab_(spreadsheet, DASHBOARD.studentRecords, DASHBOARD.studentRecordHeaders);
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
  } else {
    let populated = existing.length;
    while (populated && !existing[populated - 1]) populated--;
    if (headers.slice(0, populated).some(function(header, index) { return existing[index] !== header; })) {
      throw new Error(name + ' has different column headers. No data was changed on that tab.');
    }
    if (populated < headers.length) {
      const missing = headers.slice(populated);
      sheet.getRange(1, populated + 1, 1, missing.length).setValues([missing]);
      sheet.getRange(1, populated + 1, 1, missing.length).setFontWeight('bold').setBackground('#dfeaf9');
      sheet.getRange(1, populated + 1, sheet.getMaxRows(), missing.length).setNumberFormat('@');
    }
  }
}

function spreadsheet_() {
  const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!id) throw new Error('Run setupDashboard before using the web app.');
  return SpreadsheetApp.openById(id);
}

function rows_(sheet) {
  if (!sheet) throw new Error('A required spreadsheet tab is missing. Run setupDashboard again.');
  const last = sheet.getLastRow();
  if (last < 2) return [];
  return sheet.getRange(2, 1, last - 1, sheet.getLastColumn()).getDisplayValues();
}

function rowsWithDates_(sheet, dateColumns) {
  const displayRows = rows_(sheet);
  if (!displayRows.length) return displayRows;
  const rawRows = sheet.getRange(2, 1, displayRows.length, sheet.getLastColumn()).getValues();
  displayRows.forEach(function(row, rowIndex) {
    dateColumns.forEach(function(columnIndex) {
      row[columnIndex] = sheetDate_(rawRows[rowIndex][columnIndex]) || row[columnIndex];
    });
  });
  return displayRows;
}

function sheetDate_(value) {
  if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, DASHBOARD.timezone, 'yyyy-MM-dd');
  }
  const text = String(value == null ? '' : value).trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '';
}

function findDateRow_(sheet, classId, date) {
  const matches = findDateRows_(sheet, classId, date);
  return matches.length ? matches[0] : 0;
}

function findDateRows_(sheet, classId, date) {
  const data = rowsWithDates_(sheet, [1]);
  const matches = [];
  for (let index = 0; index < data.length; index++) {
    if (String(data[index][0]).trim() === String(classId).trim() && data[index][1] === date) matches.push(index + 2);
  }
  return matches;
}

function findRow_(sheet, match) {
  const data = rows_(sheet);
  for (let index = 0; index < data.length; index++) if (match(data[index])) return index + 2;
  return 0;
}

