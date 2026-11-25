// MPR records are stored separately so older dashboard clients can still save lessons.
const MPR_SHEET = 'MprRecords';
const MPR_HEADERS = ['Record key', 'Revision', 'Data JSON'];
const MPR_ACTIVITIES = [
  'Make-up lesson',
  'ECA',
  'Master Class',
  'Online CPD',
  'Observation',
  'Testing',
  'Achievement',
  'Challenge',
  'Next step',
];

function setupMpr() {
  ensureTab_(spreadsheet_(), MPR_SHEET, MPR_HEADERS);
}

function loadMpr_(sheet) {
  return rows_(sheet)
    .filter(function (row) {
      return row.some(Boolean);
    })
    .map(function (row) {
      if (!row[0] || !row[1]) throw new Error('Incomplete MPR row.');
      return { key: row[0], revision: row[1], value: JSON.parse(row[2]) };
    });
}

function validateMpr_(key, value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid MPR data.');
  if (JSON.stringify(value).length > 40000) throw new Error('Shorten this MPR entry before saving.');
  if (key === 'weeklyLoad') {
    validateMprWeeklyLoad_(value);
    return;
  }
  if (key === 'profile') {
    if (
      Object.values(value).some(function (field) {
        return typeof field !== 'string';
      })
    )
      throw new Error('Invalid teacher profile.');
    return;
  }
  if (/^group\|[^|]{1,100}$/.test(key)) {
    validateMprGroup_(value);
    return;
  }
  if (/^month\|\d{4}-(0[1-9]|1[0-2])$/.test(key)) {
    if (!Array.isArray(value.groups) || !value.profile || typeof value.profile !== 'object')
      throw new Error('Invalid monthly setup.');
    value.groups.forEach(validateMprGroup_);
    validateMprWeeklyLoad_(value.weeklyOverrides || {});
    return;
  }
  if (/^answer\|\d{4}-(0[1-9]|1[0-2])\|[a-zA-Z0-9_.-]{1,100}$/.test(key)) {
    if (typeof value.text !== 'string' || typeof value.source !== 'string')
      throw new Error('Invalid reviewed answer.');
    return;
  }
  const lesson = key.indexOf('lesson|') === 0;
  const activity = /^activity\|[a-f0-9-]{36}$/i.test(key);
  if (!lesson && !activity) throw new Error('Unknown MPR record.');
  date_(value.date);
  if (lesson && (!value.classId || key !== 'lesson|' + value.classId + '|' + value.date))
    throw new Error('Lesson reference does not match.');
  if (activity && MPR_ACTIVITIES.indexOf(value.kind) < 0) throw new Error('Choose an activity type.');
  if (
    value.hours !== '' &&
    value.hours != null &&
    (typeof value.hours !== 'number' || !Number.isFinite(value.hours) || value.hours < 0 || value.hours > 24)
  ) {
    throw new Error('Enter teaching hours between 0 and 24.');
  }
  if (value.confirmed && value.status !== 'Cancelled' && value.status !== 'Skipped') {
    if (!(value.hours > 0)) throw new Error('Confirm a positive number of actual teaching hours.');
    if (value.date > Utilities.formatDate(new Date(), DASHBOARD.timezone, 'yyyy-MM-dd'))
      throw new Error('Confirm teaching hours after the session has taken place.');
  }
  if (value.originalDate && date_(value.originalDate) > value.date)
    throw new Error('Original missed date is after the make-up.');
  if (
    value.outcomes &&
    (typeof value.outcomes !== 'object' ||
      Object.keys(value.outcomes).some(function (skill) {
        return (
          ['Speaking', 'Listening', 'Reading', 'Writing'].indexOf(skill) < 0 ||
          typeof value.outcomes[skill] !== 'string'
        );
      }))
  )
    throw new Error('Invalid skill outcome.');
  if (
    value.attendees &&
    (!Array.isArray(value.attendees) ||
      value.attendees.some(function (person) {
        return !person || typeof person.id !== 'string' || !person.id || typeof person.name !== 'string';
      }))
  )
    throw new Error('Invalid attendee list.');
}

function validateMprWeeklyLoad_(load) {
  Object.keys(load).forEach(function (category) {
    if (
      ['Regular', 'ECA', 'Master Class', 'Facultative'].indexOf(category) < 0 ||
      !Number.isFinite(load[category]) ||
      load[category] < 0 ||
      load[category] > 28
    )
      throw new Error('Enter weekly hours between 0 and 28.');
  });
}

function validateMprGroup_(group) {
  if (!group || typeof group !== 'object') throw new Error('Invalid teaching group.');
  if (group.category && ['Regular', 'ECA', 'Master Class', 'Facultative'].indexOf(group.category) < 0)
    throw new Error('Invalid teaching category.');
  ['hours', 'weekly', 'students'].forEach(function (key) {
    if (
      group[key] != null &&
      (typeof group[key] !== 'number' || !Number.isFinite(group[key]) || group[key] < 0)
    )
      throw new Error('Enter a valid number for ' + key + '.');
  });
}

function saveMpr_(request) {
  const input = request.record || {};
  const key = jsonText_(input.key, 'MPR key', 220, true);
  validateMpr_(key, input.value);
  const payload = JSON.stringify(input.value);
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sheet = spreadsheet_().getSheetByName(MPR_SHEET);
    if (!sheet) throw new Error('Run setupMpr in Apps Script and reload the dashboard.');
    const row = findRow_(sheet, function (cells) {
      return cells[0] === key;
    });
    const current = row ? sheet.getRange(row, 2, 1, 2).getDisplayValues()[0] : ['', ''];
    if (current[1] === payload) return { key: key, revision: current[0], value: input.value };
    if (current[0] !== (input.revision || ''))
      throw new Error(
        'This MPR entry changed on another device. Copy your draft, reload and review the latest version.',
      );
    const revision = Utilities.getUuid();
    const cells = [key, revision, payload];
    if (row) sheet.getRange(row, 1, 1, 3).setValues([cells]);
    else sheet.appendRow(cells);
    SpreadsheetApp.flush();
    return { key: key, revision: revision, value: input.value };
  } finally {
    lock.releaseLock();
  }
}
