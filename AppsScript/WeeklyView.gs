/**
 * Handles direct edits to the Students and Timetable sheets. Dashboard writes
 * call their own helpers because Apps Script edits do not fire onEdit triggers.
 */
function onEdit(e) {
  if (!e || !e.range) return;
  const sheet = e.range.getSheet();
  if (sheet.getName() === DASHBOARD.students) {
    if (e.range.getLastRow() >= 2 && e.range.getColumn() <= DASHBOARD.studentHeaders.length) {
      fillMissingStudentIds_(e.source || sheet.getParent(), e.range.getRow(), e.range.getLastRow());
    }
    return;
  }
  if (sheet.getName() !== DASHBOARD.timetable) return;
  if (e.range.getLastRow() < 2 || e.range.getColumn() > DASHBOARD.timetableHeaders.length) return;
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return;
  try {
    normalizeTimetableTimes_(e.source.getSheetByName(DASHBOARD.timetable));
    sortTimetable_(e.source.getSheetByName(DASHBOARD.timetable));
    SpreadsheetApp.flush();
    refreshWeeklyView_(e.source);
  } finally {
    lock.releaseLock();
  }
}

function refreshWeeklyView_(spreadsheet) {
  if (!spreadsheet) throw new Error('The dashboard spreadsheet is unavailable. Run setupDashboard again.');
  const source = spreadsheet.getSheetByName(DASHBOARD.timetable);
  if (!source) throw new Error('The Timetable tab is missing. Run setupDashboard again.');
  let view = spreadsheet.getSheetByName(DASHBOARD.weeklyView);
  if (!view) view = spreadsheet.insertSheet(DASHBOARD.weeklyView);

  const classes = rows_(source).reduce(function(all, row) {
    if (String(row[7]).toLowerCase() === 'false') return all;
    classMeetingsFromRow_(row).forEach(function(meeting) {
      all.push({name: row[1], subject: row[2], weekday: meeting.weekday, start: meeting.start,
        end: meeting.end, room: meeting.room});
    });
    return all;
  }, []).filter(function(item) {
    return item.name && item.weekday >= 1 && item.weekday <= 5 &&
      /^([01]\d|2[0-3]):[0-5]\d$/.test(item.start) && /^([01]\d|2[0-3]):[0-5]\d$/.test(item.end);
  });
  const periodsByKey = {};
  classes.forEach(function(item) {
    periodsByKey[item.start + '|' + item.end] = {start: item.start, end: item.end};
  });
  const periods = Object.keys(periodsByKey).map(function(key) { return periodsByKey[key]; }).sort(function(left, right) {
    return timeMinutes_(left.start) - timeMinutes_(right.start) || timeMinutes_(left.end) - timeMinutes_(right.end);
  });
  const headers = ['Beginning', 'End', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
  const values = [headers].concat(periods.map(function(period) {
    const row = [period.start, period.end];
    for (let weekday = 1; weekday <= 5; weekday++) {
      const matching = classes.filter(function(item) {
        return item.weekday === weekday && item.start === period.start && item.end === period.end;
      });
      row.push(matching.length ? matching.map(weeklyViewClassText_).join('\n\n') : 'Free');
    }
    return row;
  }));

  view.clear();
  view.getRange(1, 1, values.length, headers.length).setValues(values);
  view.setFrozenRows(1);
  view.setFrozenColumns(2);
  view.setColumnWidths(1, 2, 90);
  view.setColumnWidths(3, 5, 190);
  view.setRowHeight(1, 42);
  if (periods.length) view.setRowHeights(2, periods.length, 78);
  const all = view.getRange(1, 1, values.length, headers.length);
  all.setVerticalAlignment('middle').setHorizontalAlignment('center').setWrap(true)
    .setBorder(true, true, true, true, true, true, '#d7dfeb', SpreadsheetApp.BorderStyle.SOLID);
  view.getRange(1, 1, 1, headers.length).setFontWeight('bold').setFontColor('#ffffff').setBackground('#1b4ca1');
  if (periods.length) {
    view.getRange(2, 1, periods.length, 2).setFontWeight('bold').setBackground('#eef2f7');
    for (let rowIndex = 0; rowIndex < periods.length; rowIndex++) {
      for (let column = 3; column <= 7; column++) {
        const cell = view.getRange(rowIndex + 2, column);
        const free = values[rowIndex + 1][column - 1] === 'Free';
        cell.setBackground(free ? '#e1f5e9' : '#f5e95a')
          .setFontColor(free ? '#277052' : '#27320c')
          .setFontWeight(free ? 'bold' : 'normal');
      }
    }
  }
  view.getRange('A1').setNote('Generated from Timetable. Edit the Timetable tab rather than this view.');
  view.setTabColor('#1b4ca1');
}

function weeklyViewClassText_(item) {
  return [item.name, item.subject, item.room ? 'Room ' + item.room : ''].filter(Boolean).join('\n');
}

function sortTimetable_(sheet) {
  if (!sheet) throw new Error('The Timetable tab is missing. Run setupDashboard again.');
  const rowCount = sheet.getLastRow() - 1;
  if (rowCount < 2) return;
  sheet.getRange(2, 1, rowCount, DASHBOARD.timetableHeaders.length).sort([
    {column: 5, ascending: true},
    {column: 4, ascending: true},
    {column: 2, ascending: true}
  ]);
}

function normalizeTimetableTimes_(sheet) {
  if (!sheet) throw new Error('The Timetable tab is missing. Run setupDashboard again.');
  const rowCount = sheet.getLastRow() - 1;
  if (rowCount < 1) return;
  const range = sheet.getRange(2, 5, rowCount, 2);
  const values = range.getDisplayValues().map(function(row) {
    return [storedTime_(row[0]), storedTime_(row[1])];
  });
  range.setNumberFormat('@').setValues(values);
}
