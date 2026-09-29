const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const LESSON_TYPES = ['Lesson', 'Quiz', 'Exam'];
const LESSON_STATUSES = ['Done', 'Late', 'Cancelled', 'Skipped'];
const dateString = date => `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
const parseDate = value => new Date(`${value}T00:00:00Z`);
const addDays = (value, amount) => { const date = parseDate(value); date.setUTCDate(date.getUTCDate() + amount); return dateString(date); };
const monday = value => addDays(value, 1 - (parseDate(value).getUTCDay() || 7));
const escapeTime = value => String(value || '').slice(0, 5);
const labelDate = (value, options = { weekday: 'short', month: 'short', day: 'numeric' }) => new Intl.DateTimeFormat('en', { ...options, timeZone: 'UTC' }).format(parseDate(value));
const currentDate = (timeZone = 'Asia/Tashkent', date = new Date()) => {
  const parts = new Intl.DateTimeFormat('en', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const value = type => parts.find(part => part.type === type).value;
  return `${value('year')}-${value('month')}-${value('day')}`;
};
const operationId = () => crypto.randomUUID();
import { draftKey } from './drafts.js';
import { IMPORT_FILE_LIMIT, IMPORT_TEMPLATE, parseStudentInput, previewStudentImport } from './import-students.js';
import { progressReport } from './progress-report.js';

function node(tag, className, text) {
  const item = document.createElement(tag);
  if (className) item.className = className;
  if (text !== undefined) item.textContent = text;
  return item;
}
function button(text, action, className = 'button button-quiet') {
  const item = node('button', className, text); item.type = 'button'; item.dataset.action = action; return item;
}
function field(labelText, input, className = '') {
  const wrap = node('label', `dashboard-field ${className}`.trim());
  wrap.append(node('span', '', labelText), input); return wrap;
}
function controlField(labelText, control) {
  const wrap = node('div', 'dashboard-field');
  wrap.append(node('span', '', labelText), control); return wrap;
}
function input(type, name, value = '') {
  const item = document.createElement('input'); item.type = type; item.name = name; item.value = value; return item;
}
function select(name, options, selected) {
  const item = document.createElement('select'); item.name = name;
  for (const [value, label] of options) { const option = node('option', '', label); option.value = value; item.append(option); }
  item.value = selected; return item;
}
function formButton(text, className = 'button button-primary') {
  const item = node('button', className, text); item.type = 'submit'; return item;
}
function statusText(code) {
  return ({ TD002: 'Some of those details are invalid. Check the fields and try again.', TD003: 'That item is no longer available. Refresh the dashboard and try again.', TD004: 'This meeting changed elsewhere. Reload it before trying again.', TD006: 'That time overlaps another meeting. The schedule was kept.', TD007: 'The student roster changed. Refresh the meeting before saving attendance.', TD008: 'A saved lesson or attendance checklist prevents rescheduling.', TD001: 'Your session expired. Sign in again to continue.', '42501': 'Your account does not have access to that operation.' })[code] || 'The change could not be saved. Your current form is still available.';
}

export function createDashboardController({ access, render, drafts = null, onAuthError = () => {}, onAccountDiscarded = () => {}, now = () => new Date() }) {
  const state = { workspace: null, groups: [], students: [], enrollments: [], meetings: [], selectedDate: currentDate('Asia/Tashkent', now()), view: 'day', section: 'schedule', studentGroupId: '', studentDialog: null, selectedKey: '', details: null, scheduleChange: null, import: null, loading: false, busy: false, message: '', history: null, editorVersion: 0, newGroupOpen: false, expandedGroupId: '', draftStorageError: false };
  let openedWorkspace = '';
  let requestVersion = 0;
  let root = null;
  const savedFormValues = new Map();
  const recordDrafts = new Map();
  const pendingWrites = new Map();
  const timers = new Map();
  let userId = '';
  let leaseTimer = null;
  drafts?.subscribe?.(({ key, kind, userId: affectedUser }) => {
    if (kind === 'discard-account' && affectedUser === userId) { close(); onAccountDiscarded(); return; }
    const entry = recordDrafts.get(key);
    if (entry && state.workspace?.id === entry.workspaceId) { entry.status = 'blocked'; publish(); }
  });
  const today = () => currentDate(state.workspace?.timezone || 'Asia/Tashkent', now());
  const formKey = form => `${form.dataset.form}:${form.dataset.group || ''}:${form.dataset.slot || ''}:${form.dataset.student || ''}:${form.dataset.meeting || ''}`;
  const elementKey = element => {
    const studentId = element.closest('.dashboard-attendance-row')?.dataset.student;
    const field = `${studentId ? `${studentId}:` : ''}${element.name}`;
    return element.type === 'checkbox' || element.type === 'radio' ? `${field}:${element.value}` : field;
  };
  const reportError = error => {
    state.message = statusText(error?.code);
    if (error?.status === 401 || ['TD001', 'PGRST301', 'PGRST303', 'refresh_token_not_found', 'refresh_token_already_used', 'session_not_found'].includes(error?.code)) onAuthError();
  };
  const recordId = (meetingKey, kind) => draftKey(userId, state.workspace.id, meetingKey, kind);
  const recordForm = kind => root?.querySelector(`form[data-form="${kind}"]`);
  const recordValues = form => {
    const values = {};
    for (const element of form.elements) if (element.name) values[elementKey(element)] = element.value;
    return values;
  };
  const recordRevision = kind => kind === 'lesson' ? state.details?.lesson?.revision || 0 : state.details?.attendance?.revision || 0;
  const statusLabel = (entry, kind) => ({ deviceSaving: 'Saving on this device', unprotected: 'Device storage is unavailable for immediate recovery — keep this page open', deviceSaved: 'Saved on this device', accountSaving: 'Saving to account', synced: 'Synced', failed: 'Save failed', storageFailed: 'Device storage full or unavailable — this draft is not saved', blocked: 'Another tab is editing this draft', conflict: 'Draft conflicts with the account version', rosterConflict: 'Review roster changes before saving' })[entry?.status] || (state.draftStorageError ? 'Device storage unavailable — drafts cannot be read' : recordRevision(kind) ? 'Synced' : 'Not saved to account');
  function showRecordStatus(kind) {
    const form = recordForm(kind); if (!form || !state.workspace) return;
    const entry = recordDrafts.get(recordId(form.dataset.meeting, kind));
    const label = form.querySelector('.dashboard-save-status');
    if (label) label.textContent = statusLabel(entry, kind);
    const disabled = ['blocked', 'conflict', 'rosterConflict'].includes(entry?.status);
    form.querySelector('button[type="submit"]').disabled = state.busy || disabled;
  }
  function setRecordStatus(key, status) {
    const entry = recordDrafts.get(key); if (!entry) return;
    entry.status = status;
    for (const kind of ['lesson', 'attendance']) showRecordStatus(kind);
  }
  async function persistRecord(form, immediate = false) {
    if (!drafts || !userId || !state.workspace || !form?.dataset.meeting) return;
    const kind = form.dataset.form; const meetingKey = form.dataset.meeting;
    const key = recordId(meetingKey, kind);
    const previous = recordDrafts.get(key);
    if (kind === 'attendance' && previous?.status === 'rosterConflict') return previous;
    const entry = { key, userId, workspaceId: state.workspace.id, meetingKey, recordType: kind,
      version: (previous?.version || 0) + 1, baseRevision: previous?.baseRevision ?? recordRevision(kind),
      values: recordValues(form), status: 'deviceSaving' };
    if (drafts.stage?.(entry) === false) entry.status = 'unprotected';
    recordDrafts.set(key, entry); savedFormValues.set(formKey(form), entry.values); showRecordStatus(kind);
    clearTimeout(timers.get(key));
    const save = async () => {
      const preceding = pendingWrites.get(key) || Promise.resolve();
      const task = preceding.catch(() => {}).then(() => drafts.put(entry)).then(saved => {
        Object.assign(entry, saved);
        if (recordDrafts.get(key)?.version === entry.version) setRecordStatus(key, 'deviceSaved');
      }).catch(error => {
        if (recordDrafts.get(key)?.version === entry.version) setRecordStatus(key,
          ['DRAFT_OWNED_BY_ANOTHER_TAB', 'DRAFT_CHANGED_IN_ANOTHER_TAB'].includes(error.message) ? 'blocked' : 'storageFailed');
        if (recordDrafts.get(key)?.status === 'blocked') publish();
      });
      pendingWrites.set(key, task);
      await task;
    };
    if (immediate) await save(); else timers.set(key, setTimeout(() => { void save(); }, 300));
    return entry;
  }
  async function flushRecord(form) {
    if (!drafts || !form?.dataset.meeting) return;
    const key = recordId(form.dataset.meeting, form.dataset.form);
    if (timers.has(key)) {
      clearTimeout(timers.get(key)); timers.delete(key);
      const entry = recordDrafts.get(key);
      if (entry) {
        const preceding = pendingWrites.get(key) || Promise.resolve();
        const task = preceding.catch(() => {}).then(() => drafts.put(entry)).then(saved => {
          Object.assign(entry, saved);
          if (recordDrafts.get(key)?.version === entry.version) setRecordStatus(key, 'deviceSaved');
        }).catch(error => { if (recordDrafts.get(key)?.version === entry.version) setRecordStatus(key,
          error.message?.startsWith('DRAFT_') ? 'blocked' : 'storageFailed');
          if (recordDrafts.get(key)?.status === 'blocked') publish(); });
        pendingWrites.set(key, task);
      }
    }
    await pendingWrites.get(key);
  }
  async function flushVisible() { await Promise.all([...root?.querySelectorAll('form[data-form="lesson"], form[data-form="attendance"]') || []].map(flushRecord)); }
  async function finishAccountSave(snapshot, serverRevision, hasNewerEdits) {
    if (!drafts) return;
    const current = recordDrafts.get(snapshot.key);
    if (hasNewerEdits || (current && current.version !== snapshot.version)) {
      if (current) {
        clearTimeout(timers.get(snapshot.key)); timers.delete(snapshot.key);
        await pendingWrites.get(snapshot.key);
        current.baseRevision = serverRevision;
        try { await drafts.put(current); setRecordStatus(snapshot.key, 'deviceSaved'); }
        catch { setRecordStatus(snapshot.key, 'storageFailed'); }
      }
    } else {
      await pendingWrites.get(snapshot.key);
      await drafts.deleteVersion(snapshot.key, snapshot.version);
      recordDrafts.delete(snapshot.key);
    }
  }

  const write = async (action, payload) => {
    const key = `${action}:${JSON.stringify(payload)}`;
    let id = savedFormValues.get(`op:${key}`);
    if (!id) { id = operationId(); savedFormValues.set(`op:${key}`, id); }
    const result = await access.save(action, state.workspace.id, payload, id);
    savedFormValues.delete(`op:${key}`);
    return result;
  };
  const currentMeeting = () => state.meetings.find(item => !item.is_marker && item.meeting_key === state.selectedKey);
  const clearReportDownload = report => {
    if (report?.downloadUrl) URL.revokeObjectURL(report.downloadUrl);
    if (report) report.downloadUrl = '';
  };
  const destinationWeek = async date => {
    const start = monday(date);
    return start === monday(state.selectedDate)
      ? state.meetings
      : access.listMeetings(state.workspace.id, start, addDays(start, 6));
  };
  const scoreFor = entry => !entry ? 0 : entry.attendance === 'absent' ? -1 : Number(entry.participation);
  function applyHistorySave(meeting, kind, record, entries = [], previousEntries = []) {
    const history = state.history;
    if (!history || history.loading) return;
    const studentEntry = entries.find(item => item.student_id === history.studentId);
    const enrolled = state.enrollments.some(item => item.student_id === history.studentId && item.group_id === meeting.group_id &&
      item.starts_on <= meeting.actual_date && (!item.ends_on || item.ends_on > meeting.actual_date));
    const existing = history.items.find(item => item.id === meeting.id);
    if (!existing && !studentEntry && !enrolled) return;
    const item = existing || { ...meeting, lesson: null, attendance: null };
    if (kind === 'lesson') item.lesson = record;
    else {
      const previousEntry = previousEntries.find(entry => entry.student_id === history.studentId);
      const before = scoreFor(item.attendance || previousEntry);
      item.attendance = studentEntry || item.attendance;
      const delta = scoreFor(item.attendance) - before;
      if (history.totals) {
        history.totals.overall += delta;
        if (history.groupId === meeting.group_id) history.totals.group += delta;
      }
    }
    if (!existing) history.items.push(item);
    history.items.sort((a, b) => b.actual_date.localeCompare(a.actual_date) || b.id.localeCompare(a.id));
  }
  const publish = () => {
    if (!state.workspace) return;
    if (root) for (const form of root.querySelectorAll('form[data-form]')) {
      const key = formKey(form);
      const values = {};
      for (const element of form.elements) if (element.name) {
        values[elementKey(element)] = element.type === 'checkbox' || element.type === 'radio' ? element.checked : element.value;
      }
      savedFormValues.set(key, values);
    }
    render(build());
    const studentDialog = root.querySelector('.dashboard-student-dialog');
    if (studentDialog && !studentDialog.open) {
      if (typeof studentDialog.showModal === 'function') studentDialog.showModal();
      else studentDialog.open = true;
      studentDialog.querySelector('[name="name"]')?.focus();
    }
    for (const form of root.querySelectorAll('form[data-form]')) {
      const key = formKey(form);
      const values = savedFormValues.get(key); if (!values) continue;
      for (const element of form.elements) if (element.name) {
        const field = elementKey(element);
        if (values[field] === undefined) continue;
        if (element.type === 'checkbox' || element.type === 'radio') element.checked = values[field];
        else element.value = values[field];
      }
    }
    for (const row of root.querySelectorAll('.dashboard-attendance-row')) {
      const points = row.querySelector('[name="participation"]');
      points.disabled = row.querySelector('[name="attendance"]').value === 'absent';
      if (points.disabled) points.value = '0';
      syncAttendanceControls(row);
    }
    const custom = root.querySelector('[data-form="lesson"] [name="custom_lesson_type"]')?.closest('label');
    if (custom) custom.hidden = root.querySelector('[data-form="lesson"] [name="lesson_type"]')?.value !== '__custom';
    updateAttendanceSummary();
  };
  function build() {
    root = node('div', 'dashboard');
    const navigation = node('nav', 'dashboard-navigation');
    navigation.setAttribute('aria-label', 'Dashboard sections');
    for (const [section, label] of [['schedule', 'Schedule'], ['groups', 'Groups'], ['students', 'Students']]) {
      const choice = button(label, 'section', 'dashboard-nav-button');
      choice.dataset.section = section;
      if (state.section === section) { choice.setAttribute('aria-current', 'page'); choice.classList.add('is-active'); }
      navigation.append(choice);
    }
    root.append(navigation);
    const toolbar = node('div', 'dashboard-toolbar');
    const title = node('div', 'dashboard-toolbar-title');
    title.append(node('h2', '', state.section === 'schedule' ? 'Teaching week' : state.section === 'groups' ? 'Groups' : 'Students'));
    if (state.section === 'schedule') title.append(node('p', 'field-hint', `${labelDate(monday(state.selectedDate), { month: 'long', day: 'numeric' })} – ${labelDate(addDays(monday(state.selectedDate), 6), { month: 'long', day: 'numeric', year: 'numeric' })}`));
    toolbar.append(title);
    if (state.section === 'schedule') toolbar.append(button(state.view === 'day' ? '‹ Previous day' : '‹ Previous week', 'previous'), button('Today', 'today'), button(state.view === 'day' ? 'Next day ›' : 'Next week ›', 'next'), button(state.view === 'day' ? 'Week view' : 'Day view', 'toggle-view'));
    toolbar.append(button('Reload', 'reload'));
    if (state.section === 'groups') toolbar.append(button('New group', 'new-group', 'button button-primary'));
    root.append(toolbar);
    if (state.section === 'groups') showNewGroupForm();
    if (state.message) root.append(node('div', 'dashboard-message', state.message));
    if (state.loading) root.append(node('p', 'field-hint', 'Loading your workspace…'));
    if (state.section === 'schedule') root.append(buildWeekStrip(), state.view === 'day' ? buildDay() : buildWeek());
    if (state.section === 'groups' && !state.loading && !state.groups.length) {
      const start = node('section', 'dashboard-section dashboard-start');
      start.append(node('h3', '', 'Start with a group'),
        node('p', 'field-hint', 'Give your students one shared roster and add as many meeting times as you need.'),
        button('Create your first group', 'new-group', 'button button-primary'));
      const importButton = node('button', 'button button-secondary', 'Import students'); importButton.type = 'button'; importButton.disabled = true;
      start.append(importButton, node('small', 'field-hint', 'Create a group first, then import its students.'));
      root.append(start);
    }
    if (state.section === 'groups' && state.groups.length) root.append(buildGroupManager());
    if (state.section === 'students') root.append(buildStudentDirectory());
    if (state.section === 'schedule' && state.selectedKey && currentMeeting()) root.append(buildMeetingPanel(currentMeeting()));
    if (state.history) root.append(buildHistory());
    if (state.studentDialog) root.append(buildStudentDialog());
    root.addEventListener('click', onClick);
    root.addEventListener('submit', onSubmit);
    root.addEventListener('input', event => {
      if (event.target.dataset.importPaste) {
        const draft = state.import; if (!draft) return;
        draft.rawText = event.target.value; draft.parsed = null; draft.decisions = {}; draft.result = null;
        const confirm = root.querySelector('[data-action="confirm-import"]'); if (confirm) confirm.disabled = true;
        return;
      }
      if (event.target.dataset.importRow && ['name', 'external_id'].includes(event.target.dataset.importField)) {
        const draft = state.import; const row = draft?.parsed?.data.find(item => item.rowNumber === Number(event.target.dataset.importRow));
        const index = event.target.dataset.importField === 'name' ? draft?.parsed?.nameColumn : draft?.parsed?.externalColumn;
        if (row && index >= 0) row.cells[index] = event.target.value;
        return;
      }
      state.editorVersion++;
      const form = event.target.closest('form[data-form="lesson"], form[data-form="attendance"]');
      if (form) void persistRecord(form, event.target.tagName === 'SELECT');
      if (event.target.closest('[data-form="attendance"]')) updateAttendanceSummary();
    });
    root.addEventListener('focusout', event => {
      if (event.target.dataset.importRow && ['name', 'external_id'].includes(event.target.dataset.importField)) {
        publish(); return;
      }
      const form = event.target.closest('form[data-form="lesson"], form[data-form="attendance"]');
      if (form) void flushRecord(form);
    });
    root.addEventListener('change', event => {
      if (event.target.dataset.reportField && state.history?.report) {
        const report = state.history.report;
        clearReportDownload(report);
        if (event.target.dataset.reportField === 'note') {
          if (event.target.checked) report.selectedNotes.add(event.target.value);
          else report.selectedNotes.delete(event.target.value);
        } else {
          report[event.target.dataset.reportField] = event.target.value;
          report.snapshot = null; report.selectedNotes.clear(); report.error = '';
        }
        publish(); return;
      }
      if (event.target.dataset.importPaste) return;
      if (event.target.dataset.importFile) { void readImportFile(event.target); return; }
      if (event.target.dataset.importSetting) {
        const draft = state.import; if (!draft) return;
        const setting = event.target.dataset.importSetting;
        if (setting === 'startsOn') draft.startsOn = event.target.value;
        else if (draft.parsed) draft.parsed[setting] = setting === 'hasHeader' ? event.target.checked : Number(event.target.value);
        draft.error = ''; publish(); return;
      }
      if (event.target.dataset.importRow) {
        const draft = state.import; if (!draft?.parsed?.data) return;
        const rowNumber = Number(event.target.dataset.importRow);
        const field = event.target.dataset.importField;
        if (field === 'name' || field === 'external_id') {
          const row = draft.parsed.data.find(item => item.rowNumber === rowNumber);
          const index = field === 'name' ? draft.parsed.nameColumn : draft.parsed.externalColumn;
          if (row && index >= 0) row.cells[index] = event.target.value;
        } else {
          draft.decisions[rowNumber] ||= {};
          draft.decisions[rowNumber][field] = event.target.value;
        }
        draft.error = ''; publish(); return;
      }
      state.editorVersion++;
      const form = event.target.closest('form[data-form="lesson"], form[data-form="attendance"]');
      if (form) void persistRecord(form, event.target.tagName === 'SELECT');
      if (event.target.name === 'attendance') {
        const row = event.target.closest('.dashboard-attendance-row');
        const points = row?.querySelector('[name="participation"]');
        if (points) { points.disabled = event.target.value === 'absent'; if (points.disabled) points.value = '0'; }
      }
      if (event.target.closest('[data-form="attendance"]')) updateAttendanceSummary();
      if (event.target.name === 'lesson_type') {
        const custom = event.target.form?.elements.namedItem('custom_lesson_type')?.closest('label');
        if (custom) custom.hidden = event.target.value !== '__custom';
      }
    });
    for (const submit of root.querySelectorAll('button[type="submit"]')) submit.disabled = state.busy;
    for (const kind of ['lesson', 'attendance']) showRecordStatus(kind);
    return root;
  }
  function updateAttendanceSummary() {
    const form = root?.querySelector('[data-form="attendance"]');
    const summary = form?.querySelector('.dashboard-attendance-summary');
    if (!form || !summary) return;
    const rows = [...form.querySelectorAll('.dashboard-attendance-row')];
    const present = rows.filter(row => row.querySelector('[name="attendance"]').value === 'present').length;
    const score = rows.reduce((total, row) => total + (row.querySelector('[name="attendance"]').value === 'absent' ? -1 : Number(row.querySelector('[name="participation"]').value)), 0);
    summary.textContent = `${rows.length} students · ${present} present · ${rows.length - present} absent · Session score ${score > 0 ? '+' : ''}${score}`;
  }
  function syncAttendanceControls(row) {
    const attendance = row.querySelector('[name="attendance"]')?.value;
    const points = Number(row.querySelector('[name="participation"]')?.value || 0);
    for (const control of row.querySelectorAll('[data-attendance-value]'))
      control.setAttribute('aria-pressed', String(control.dataset.attendanceValue === attendance));
    const number = row.querySelector('.dashboard-points-value');
    if (number) number.textContent = attendance === 'absent' ? '—' : String(points);
    for (const control of row.querySelectorAll('[data-points-step]'))
      control.disabled = attendance === 'absent' || (Number(control.dataset.pointsStep) < 0 ? points <= -1 : points >= 1);
  }
  function buildWeekStrip() {
    const strip = node('nav', 'dashboard-week-strip');
    strip.setAttribute('aria-label', 'Choose a teaching day');
    const first = monday(state.selectedDate);
    for (let day = 0; day < 7; day++) {
      const date = addDays(first, day);
      const count = state.meetings.filter(item => !item.is_marker && item.actual_date === date).length;
      const choice = button('', 'select-day', 'dashboard-day-chip');
      choice.dataset.date = date;
      if (date === state.selectedDate) choice.setAttribute('aria-current', 'date');
      choice.append(node('span', '', labelDate(date, { weekday: 'short' })),
        node('strong', '', parseDate(date).getUTCDate()),
        node('small', '', `${count} ${count === 1 ? 'meeting' : 'meetings'}`));
      strip.append(choice);
    }
    return strip;
  }
  function meetingButton(meeting, compact = false) {
    const card = button('', meeting.is_marker ? 'moved-marker' : 'meeting', `dashboard-meeting${compact ? ' compact' : ''}`);
    card.dataset.key = meeting.meeting_key;
    if (meeting.is_marker) {
      card.dataset.date = meeting.actual_date;
      card.append(node('strong', '', `${meeting.group_name} moved`),
        node('small', '', `Go to ${labelDate(meeting.actual_date)} · ${escapeTime(meeting.start_time)}–${escapeTime(meeting.end_time)}`));
      return card;
    }
    card.append(node('span', 'dashboard-meeting-time', `${escapeTime(meeting.start_time)}–${escapeTime(meeting.end_time)}`),
      node('strong', '', meeting.group_name),
      node('span', 'dashboard-meeting-subject', `${meeting.subject}${meeting.room ? ` · ${meeting.room}` : ''}`),
      node('small', 'dashboard-meeting-status', meeting.is_rescheduled ? 'Rescheduled' : meeting.id ? 'Record saved' : 'Scheduled'));
    if (meeting.is_rescheduled) card.append(node('small', 'dashboard-moved-badge', meeting.actual_date !== meeting.original_date ? `Moved from ${labelDate(meeting.original_date)}` : 'Time or room changed'));
    if (meeting.meeting_key === state.selectedKey) card.setAttribute('aria-pressed', 'true');
    return card;
  }
  function buildDay() {
    const panel = node('section', 'dashboard-section');
    const heading = node('div', 'dashboard-section-heading');
    heading.append(node('h3', '', labelDate(state.selectedDate, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })));
    panel.append(heading);
    const meetings = state.meetings.filter(item => (item.is_marker ? item.original_date : item.actual_date) === state.selectedDate).sort((a, b) => a.start_time.localeCompare(b.start_time));
    if (!meetings.length) panel.append(node('p', 'field-hint', 'No meetings scheduled for this day. Create a group or choose another date.'));
    for (const meeting of meetings) panel.append(meetingButton(meeting));
    return panel;
  }
  function buildWeek() {
    const panel = node('section', 'dashboard-section dashboard-week-wrap');
    panel.append(node('h3', '', 'Weekly timetable'));
    const first = monday(state.selectedDate);
    const dates = Array.from({ length: 7 }, (_, day) => addDays(first, day));
    const periods = [...new Map(state.meetings.map(meeting =>
      [`${meeting.start_time}|${meeting.end_time}`, [meeting.start_time, meeting.end_time]])).values()]
      .sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));
    if (!periods.length) {
      panel.append(node('p', 'field-hint', 'No meetings scheduled this week. Add a meeting time to a group below.'));
      return panel;
    }
    const grid = node('div', 'dashboard-week-grid');
    grid.setAttribute('role', 'grid'); grid.setAttribute('aria-label', 'Weekly teaching timetable');
    grid.append(node('div', 'dashboard-week-heading', 'Time'));
    for (let day = 0; day < 7; day++) {
      const date = dates[day];
      const heading = button(labelDate(date, { weekday: 'short', month: 'short', day: 'numeric' }), 'select-day', 'dashboard-week-heading dashboard-week-day');
      heading.dataset.date = date;
      if (date === today()) heading.classList.add('is-today');
      grid.append(heading);
    }
    for (const [start, end] of periods) {
      grid.append(node('div', 'dashboard-week-time', `${escapeTime(start)}–${escapeTime(end)}`));
      for (const date of dates) {
        const cell = node('div', 'dashboard-week-cell');
        if (date === today()) cell.classList.add('is-today');
        const items = state.meetings.filter(item => (item.is_marker ? item.original_date : item.actual_date) === date && item.start_time === start && item.end_time === end);
        if (items.length) for (const meeting of items) cell.append(meetingButton(meeting, true));
        else cell.append(node('span', 'dashboard-week-free', 'Free'));
        grid.append(cell);
      }
    }
    panel.append(grid);
    return panel;
  }
  function buildGroupManager() {
    const panel = node('section', 'dashboard-section');
    const heading = node('div', 'dashboard-section-heading'); heading.append(node('h3', '', 'Groups and schedules'));
    panel.append(heading);
    const list = node('div', 'dashboard-groups');
    for (const group of state.groups) {
      const card = node('article', 'dashboard-group');
      const summary = node('div', 'dashboard-group-summary');
      summary.append(node('strong', '', group.name), node('span', 'field-hint', `${group.subject}${group.archived ? ' · Archived' : ''}`));
      const toggle = button(state.expandedGroupId === group.id ? 'Close details' : 'Manage group', 'toggle-group', 'button button-text');
      toggle.dataset.group = group.id; summary.append(toggle);
      card.append(summary);
      if (state.expandedGroupId !== group.id) { list.append(card); continue; }
      if (!group.archived) {
        const edit = document.createElement('form'); edit.dataset.form = 'edit-group'; edit.dataset.group = group.id; edit.className = 'dashboard-inline-form';
        edit.append(field('Group name', input('text', 'name', group.name)), field('Subject', input('text', 'subject', group.subject)),
          field('Code (optional)', input('text', 'code', group.code || '')), formButton('Save group details', 'button button-secondary'));
        card.append(edit);
        const schedule = document.createElement('form'); schedule.dataset.form = 'schedule'; schedule.dataset.group = group.id;
        schedule.className = 'dashboard-inline-form';
        schedule.append(field('Day', select('weekday', DAY_NAMES.map((day, index) => [String(index + 1), day]), '1')),
          field('Start', input('time', 'start_time', '09:00')), field('End', input('time', 'end_time', '10:00')),
          field('Room', input('text', 'room', '')), field('Starts on', input('date', 'effective_from', today())),
          field('Ends before (optional)', input('date', 'effective_to', '')), formButton('Add meeting time'));
        card.append(schedule);
      }
      const roster = node('div', 'dashboard-roster-list');
      const memberships = state.enrollments.filter(item => item.group_id === group.id);
      const groupStudents = [...new Set(memberships.map(item => item.student_id))]
        .map(id => state.students.find(item => item.id === id)).filter(Boolean)
        .sort((a, b) => a.name.localeCompare(b.name));
      for (const student of groupStudents) {
          const enrollment = memberships.find(item => item.student_id === student.id && item.starts_on <= today() && (!item.ends_on || item.ends_on > today()));
          const row = node('div', 'dashboard-student');
          row.append(node('span', '', `${student.name} · ${enrollment ? `enrolled since ${enrollment.starts_on}` : 'former student'}`));
          const history = button('History', 'history', 'button button-text'); history.dataset.student = student.id; history.dataset.group = group.id; row.append(history);
          if (enrollment && !group.archived) {
            const remove = button('End enrollment', 'end-enrollment', 'button button-text'); remove.dataset.enrollment = enrollment.id; row.append(remove);
          }
          roster.append(row);
      }
      if (!groupStudents.length) roster.append(node('p', 'field-hint', 'No students enrolled yet.'));
      card.append(roster);
      if (!group.archived) {
        const enroll = document.createElement('form'); enroll.dataset.form = 'enroll'; enroll.dataset.group = group.id; enroll.className = 'dashboard-inline-form';
        const choices = [['', 'Choose a student'], ...state.students.map(student => [student.id, student.name])];
        enroll.append(field('Student', select('student_id', choices, '')), field('Starts on', input('date', 'starts_on', today())), formButton('Enroll existing student', 'button button-secondary'));
        card.append(enroll);
        const addStudent = button('Add student', 'open-student-dialog', 'button button-secondary');
        addStudent.dataset.group = group.id; card.append(addStudent);
        const importButton = button(state.import?.groupId === group.id ? 'Close import' : 'Import students', 'toggle-import', 'button button-secondary');
        importButton.dataset.group = group.id; card.append(importButton);
        if (state.import?.groupId === group.id) card.append(buildImportPanel(group));
      }
      const archive = button(group.archived ? 'Archived' : 'Archive group', 'archive-group', 'button button-text'); archive.disabled = group.archived; archive.dataset.group = group.id; card.append(archive);
      const slots = node('div', 'dashboard-slot-summary');
      for (const slot of group.slots || []) {
        const version = slot.versions?.at(-1); if (!version) continue;
        const scheduleRow = node('div', 'dashboard-slot-row');
        scheduleRow.append(node('p', 'field-hint', `${DAY_NAMES[version.weekday - 1]} · ${escapeTime(version.start_time)}–${escapeTime(version.end_time)} · from ${version.effective_from}${version.effective_to ? ` to ${version.effective_to}` : ''}`));
        for (const historical of slot.versions.slice(0, -1)) scheduleRow.append(node('small', 'field-hint', `Earlier: ${DAY_NAMES[historical.weekday - 1]} · ${escapeTime(historical.start_time)}–${escapeTime(historical.end_time)} · ${historical.effective_from}${historical.effective_to ? ` to ${historical.effective_to}` : ''}`));
        if (!group.archived) {
          const editSchedule = document.createElement('form'); editSchedule.dataset.form = 'edit-schedule'; editSchedule.dataset.group = group.id; editSchedule.dataset.slot = slot.id; editSchedule.className = 'dashboard-inline-form';
          const nextStart = version.effective_from > today() ? version.effective_from : today();
          editSchedule.append(field('Weekday', select('weekday', DAY_NAMES.map((day, index) => [String(index + 1), day]), String(version.weekday))),
            field('Start', input('time', 'start_time', escapeTime(version.start_time))), field('End', input('time', 'end_time', escapeTime(version.end_time))),
            field('Room', input('text', 'room', version.room || '')), field('Effective from', input('date', 'effective_from', nextStart)),
            field('Ends before (optional)', input('date', 'effective_to', version.effective_to || '')), formButton('Save future schedule version', 'button button-text'));
          if (nextStart !== today()) editSchedule.append(node('small', 'field-hint', 'This slot has a future version. Edit it from its start date or choose a later date.'));
          scheduleRow.append(editSchedule);
        }
        slots.append(scheduleRow);
      }
      card.append(slots); list.append(card);
    }
    panel.append(list); return panel;
  }
  function importPreview(group) {
    const draft = state.import;
    if (!draft?.parsed?.data) return null;
    return previewStudentImport({ ...draft.parsed, students: state.students, enrollments: state.enrollments,
      groupId: group.id, startsOn: draft.startsOn, decisions: draft.decisions });
  }
  async function readImportFile(fileInput) {
    const draft = state.import; const file = fileInput.files?.[0];
    fileInput.value = '';
    if (!draft || !file) return;
    if (file.size > IMPORT_FILE_LIMIT) {
      draft.error = 'The CSV file exceeds 1 MB.'; draft.parsed = null; draft.decisions = {}; draft.result = null;
      publish(); return;
    }
    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
      if (state.import !== draft) return;
      const parsed = parseStudentInput(text);
      draft.error = parsed.error || ''; draft.parsed = parsed.error ? null : parsed;
      draft.decisions = {}; draft.result = null; draft.rawText = '';
    } catch { draft.error = 'Read a UTF-8 CSV file and try again.'; draft.parsed = null; }
    publish();
  }
  function buildImportPanel(group) {
    const draft = state.import;
    const panel = node('section', 'dashboard-import');
    panel.append(node('h4', '', `Import into ${group.name}`));
    const start = input('date', 'starts_on', draft.startsOn); start.dataset.importSetting = 'startsOn';
    panel.append(field('Enrollment starts on', start));
    const pasted = document.createElement('textarea'); pasted.placeholder = 'Paste one name per line, or paste CSV rows';
    pasted.rows = 5; pasted.id = 'student-import-paste'; pasted.dataset.importPaste = 'true'; pasted.value = draft.rawText || '';
    panel.append(field('Paste names or CSV', pasted, 'wide'));
    panel.append(button('Preview pasted rows', 'preview-import', 'button button-secondary'));
    const file = input('file', 'import_file'); file.accept = '.csv,text/csv'; file.dataset.importFile = 'true';
    panel.append(field('UTF-8 CSV file (up to 1 MB)', file));
    const template = node('a', 'button button-text', 'Download CSV template');
    template.href = `data:text/csv;charset=utf-8,${encodeURIComponent(`\ufeff${IMPORT_TEMPLATE}`)}`;
    template.download = 'student-import-template.csv'; panel.append(template);
    if (draft.error) panel.append(node('p', 'dashboard-message', draft.error));
    if (draft.result) panel.append(node('p', 'dashboard-message',
      `Imported: ${draft.result.created} created, ${draft.result.reused} reused, ${draft.result.enrolled} enrolled, ${draft.result.skipped} skipped.`));
    if (!draft.parsed?.data) return panel;
    const header = input('checkbox', 'has_header'); header.checked = draft.parsed.hasHeader; header.dataset.importSetting = 'hasHeader';
    panel.append(field('First row contains column names', header));
    const choices = draft.parsed.columns.map((_, index) => [String(index),
      `Column ${index + 1}${draft.parsed.hasHeader ? ` · ${draft.parsed.data[0]?.cells[index] || 'unnamed'}` : ''}`]);
    const nameMap = select('name_column', choices, String(draft.parsed.nameColumn)); nameMap.dataset.importSetting = 'nameColumn';
    const externalMap = select('external_column', [['-1', 'No external ID column'], ...choices], String(draft.parsed.externalColumn));
    externalMap.dataset.importSetting = 'externalColumn';
    panel.append(field('Name column', nameMap), field('External ID column', externalMap));
    const preview = importPreview(group);
    if (preview.error) panel.append(node('p', 'dashboard-message', preview.error));
    const counts = preview.rows.reduce((total, row) => {
      if (row.action === 'create') { total.created++; total.enrolled++; }
      if (row.action === 'use_existing') { total.reused++; if (!row.enrolled) total.enrolled++; }
      if (row.action === 'skip') total.skipped++;
      return total;
    }, { created: 0, reused: 0, enrolled: 0, skipped: 0 });
    panel.append(node('p', 'field-hint', `Proposed: ${counts.created} create, ${counts.reused} reuse, ${counts.enrolled} enroll, ${counts.skipped} skip.`));
    const list = node('div', 'dashboard-import-rows');
    for (const row of preview.rows) {
      const item = node('div', 'dashboard-import-row');
      item.append(node('strong', '', `Row ${row.rowNumber}`));
      const name = input('text', 'name', row.name); name.maxLength = 120; name.dataset.importRow = String(row.rowNumber); name.dataset.importField = 'name';
      const external = input('text', 'external_id', row.externalId); external.maxLength = 120; external.dataset.importRow = String(row.rowNumber); external.dataset.importField = 'external_id';
      item.append(field('Name', name), field('External ID', external));
      const action = select('action', [['', 'Choose action'], ['create', 'Create separate'], ['use_existing', 'Use existing'], ['skip', 'Skip']], row.action);
      action.dataset.importRow = String(row.rowNumber); action.dataset.importField = 'action';
      item.append(field('Action', action));
      if (row.action === 'use_existing') {
        const student = select('student_id', [['', 'Choose student'], ...state.students.map(value => [value.id, `${value.name}${value.external_id ? ` · ${value.external_id}` : ''}`])], row.studentId);
        student.dataset.importRow = String(row.rowNumber); student.dataset.importField = 'studentId';
        item.append(field('Existing student', student));
      }
      for (const issue of row.issues) item.append(node('small', 'field-hint', issue));
      item.append(node('small', 'field-hint', row.action === 'skip' ? 'Will skip' : row.action === 'create' ? 'Will create and enroll' :
        row.action === 'use_existing' ? row.enrolled ? 'Already enrolled' : 'Will enroll existing student' : 'Choose an action before importing'));
      list.append(item);
    }
    panel.append(list);
    const confirm = button('Confirm import', 'confirm-import', 'button button-primary');
    confirm.disabled = state.busy || !!preview.error || preview.rows.some(row => row.blocking);
    panel.append(confirm);
    return panel;
  }
  function buildStudentDirectory() {
    const panel = node('section', 'dashboard-section');
    panel.append(node('p', 'field-hint', 'Choose a group to see its students.'));
    const groups = node('div', 'dashboard-student-groups');
    for (const group of state.groups) {
      const choice = button(group.name, 'select-student-group', 'dashboard-group-choice');
      choice.dataset.group = group.id;
      choice.setAttribute('aria-pressed', String(state.studentGroupId === group.id));
      groups.append(choice);
    }
    panel.append(groups);
    const group = state.groups.find(item => item.id === state.studentGroupId);
    if (!group) { if (!state.groups.length) panel.append(node('p', 'field-hint', 'Create a group to organize students.')); return panel; }
    const heading = node('div', 'dashboard-section-heading');
    heading.append(node('h3', '', `${group.name} students`));
    if (!group.archived) {
      const add = button('Add student', 'open-student-dialog', 'button button-primary'); add.dataset.group = group.id; heading.append(add);
    }
    panel.append(heading);
    const ids = new Set(state.enrollments.filter(item => item.group_id === group.id).map(item => item.student_id));
    const students = state.students.filter(item => ids.has(item.id)).sort((a, b) => a.name.localeCompare(b.name));
    if (!students.length) panel.append(node('p', 'field-hint', 'No students in this group yet.'));
    for (const student of students) {
      const row = node('div', 'dashboard-student');
      const active = state.enrollments.some(item => item.group_id === group.id && item.student_id === student.id && item.starts_on <= today() && (!item.ends_on || item.ends_on > today()));
      row.append(node('span', '', `${student.name}${student.external_id ? ` · ${student.external_id}` : ''}${active ? '' : ' · Former student'}`));
      const edit = button('Edit details', 'open-student-dialog', 'button button-text'); edit.dataset.student = student.id; edit.dataset.group = group.id; row.append(edit);
      const history = button('History', 'history', 'button button-text'); history.dataset.student = student.id; history.dataset.group = group.id;
      row.append(history); panel.append(row);
    }
    return panel;
  }
  function buildStudentDialog() {
    const editing = state.studentDialog.studentId && state.students.find(item => item.id === state.studentDialog.studentId);
    const dialog = node('dialog', 'dashboard-student-dialog');
    dialog.setAttribute('aria-label', editing ? 'Edit student details' : 'Add student');
    const form = document.createElement('form'); form.dataset.form = editing ? 'edit-student' : 'student';
    form.className = 'dashboard-student-dialog-form';
    if (editing) form.dataset.student = editing.id;
    else if (state.studentDialog.groupId) form.dataset.group = state.studentDialog.groupId;
    form.append(node('h3', '', editing ? 'Edit student details' : 'Add student'));
    const name = input('text', 'name', editing?.name || ''); name.required = true; name.maxLength = 120;
    const external = input('text', 'external_id', editing?.external_id || ''); external.maxLength = 120;
    form.append(field('Student name', name), field('External ID (optional)', external));
    if (!editing && state.studentDialog.groupId) form.append(field('Joined on', input('date', 'starts_on', today())));
    const actions = node('div', 'dashboard-dialog-actions');
    actions.append(button('Cancel', 'close-student-dialog'), formButton(editing ? 'Save student' : 'Add and enroll student'));
    form.append(actions); dialog.append(form);
    dialog.addEventListener('cancel', event => {
      event.preventDefault();
      closeStudentDialog();
    });
    return dialog;
  }
  function closeStudentDialog() {
    const { groupId, studentId } = state.studentDialog || {};
    state.studentDialog = null; publish();
    const controls = [...root.querySelectorAll('[data-action="open-student-dialog"]')];
    controls.find(item => studentId ? item.dataset.student === studentId : item.dataset.group === groupId)?.focus();
  }
  function buildMeetingPanel(meeting) {
    const panel = node('section', 'dashboard-section dashboard-records');
    const heading = node('div', 'dashboard-section-heading');
    heading.append(node('h3', '', `${meeting.group_name} · ${labelDate(meeting.actual_date, { weekday: 'long', month: 'long', day: 'numeric' })}`), button('Close', 'close-meeting'));
    panel.append(heading);
    const detail = state.details;
    if (!detail || detail.key !== meeting.meeting_key) { panel.append(node('p', 'field-hint', 'Loading meeting details…')); return panel; }
    if (!detail.lesson && !detail.attendance) {
      const controls = node('div', 'dashboard-schedule-controls');
      const open = button('Reschedule this meeting', 'open-reschedule', 'button button-secondary');
      controls.append(open);
      if (meeting.is_rescheduled) controls.append(button('Restore original schedule', 'preview-restore', 'button button-quiet'));
      panel.append(controls);
      if (state.scheduleChange?.key === meeting.meeting_key) {
        const change = state.scheduleChange;
        if (change.mode === 'edit') {
          const form = document.createElement('form'); form.dataset.form = 'reschedule'; form.dataset.meeting = meeting.meeting_key;
          form.className = 'dashboard-inline-form dashboard-reschedule-form';
          const date = input('date', 'actual_date', meeting.actual_date);
          const begins = input('time', 'start_time', escapeTime(meeting.start_time));
          const ends = input('time', 'end_time', escapeTime(meeting.end_time));
          const room = input('text', 'room', meeting.room || ''); room.maxLength = 120;
          form.append(field('New date', date), field('Start', begins), field('End', ends), field('Room', room),
            formButton('Preview move'), button('Cancel', 'cancel-schedule-change'));
          panel.append(form);
        } else {
          const preview = node('div', 'dashboard-schedule-preview');
          preview.append(node('strong', '', change.mode === 'restore' ? 'Restore original schedule?' : 'Confirm this move?'),
            node('p', '', `From ${labelDate(meeting.actual_date)} · ${escapeTime(meeting.start_time)}–${escapeTime(meeting.end_time)} · ${meeting.room || 'No room'}`),
            node('p', '', `To ${labelDate(change.actual_date)} · ${change.start_time}–${change.end_time} · ${change.room || 'No room'}`),
            button('Confirm schedule change', 'confirm-schedule-change', 'button button-primary'),
            button('Cancel', 'cancel-schedule-change'));
          panel.append(preview);
        }
      }
    }
    const lesson = document.createElement('form'); lesson.dataset.form = 'lesson'; lesson.dataset.meeting = meeting.meeting_key; lesson.className = 'dashboard-record-form';
    const lessonType = select('lesson_type', [...LESSON_TYPES.map(type => [type, type]), ['__custom', 'Custom']],
      detail.lesson?.lesson_type && !LESSON_TYPES.includes(detail.lesson.lesson_type) ? '__custom' : detail.lesson?.lesson_type || 'Lesson');
    const customType = field('Custom lesson type', input('text', 'custom_lesson_type', detail.lesson?.lesson_type && !LESSON_TYPES.includes(detail.lesson.lesson_type) ? detail.lesson.lesson_type : ''));
    customType.hidden = lessonType.value !== '__custom';
    lesson.append(node('h4', '', 'Lesson record'), field('Notes', Object.assign(document.createElement('textarea'), { name: 'notes', maxLength: 5000, value: detail.lesson?.notes || '' }), 'wide'),
      field('Rating', select('rating', [['', 'No rating'], ['1', '1 · Poor'], ['2', '2 · Fair'], ['3', '3 · Okay'], ['4', '4 · Good'], ['5', '5 · Excellent']], detail.lesson?.rating ? String(detail.lesson.rating) : '')),
      field('Lesson type', lessonType), customType,
      field('Status', select('status', LESSON_STATUSES.map(value => [value, value]), detail.lesson?.status || 'Done')),
      node('small', 'dashboard-save-status', ''), formButton('Save lesson'));
    lesson.append(buildDraftChoice(meeting, 'lesson'));
    const previous = node('section', 'dashboard-previous-notes');
    previous.append(node('h4', '', 'Previous notes for this group'));
    if (!detail.previousNotes?.length) previous.append(node('p', 'field-hint', 'No earlier lesson notes yet.'));
    for (const item of detail.previousNotes || []) {
      const entry = node('article', 'dashboard-history-item');
      entry.append(node('strong', '', labelDate(item.actual_date, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })),
        node('p', '', item.lesson.notes || 'No notes added.'),
        node('small', 'field-hint', `${item.lesson.lesson_type} · ${item.lesson.status}${item.lesson.rating ? ` · ${item.lesson.rating}/5` : ''}`));
      previous.append(entry);
    }
    if (detail.previousLoading) previous.append(node('p', 'field-hint', 'Loading older notes…'));
    else if (detail.previousNextOffset !== null && detail.previousNextOffset !== undefined) previous.append(button('Load older notes', 'more-notes', 'button button-text'));
    const lessonLayout = node('div', 'dashboard-lesson-layout');
    lessonLayout.append(lesson, previous);
    panel.append(lessonLayout);
    const attendance = document.createElement('form'); attendance.dataset.form = 'attendance'; attendance.dataset.meeting = meeting.meeting_key; attendance.className = 'dashboard-record-form';
    attendance.append(node('h4', '', 'Attendance and participation'));
    if (!detail.roster.length) attendance.append(node('p', 'field-hint', 'No students were enrolled on this meeting date. You can save an empty attendance record.'));
    for (const entry of detail.roster) {
      const row = node('div', 'dashboard-attendance-row'); row.dataset.student = entry.student_id;
      const title = node('strong', '', entry.student_name);
      const attendanceSelect = select('attendance', [['present', 'Present'], ['absent', 'Absent']], entry.attendance || 'present');
      attendanceSelect.hidden = true;
      const points = select('participation', [['-1', '−1 · Noise'], ['0', '0 · Present'], ['1', '+1 · Participation']], String(entry.participation ?? 0));
      points.hidden = true;
      if (attendanceSelect.value === 'absent') points.value = '0';
      points.disabled = attendanceSelect.value === 'absent';
      const history = button('History', 'history', 'button button-text'); history.dataset.student = entry.student_id; history.dataset.group = meeting.group_id;
      const attendanceButtons = node('div', 'dashboard-attendance-buttons');
      attendanceButtons.append(attendanceSelect);
      for (const [value, label] of [['present', 'Present'], ['absent', 'Absent']]) {
        const control = button(label, 'set-attendance', 'dashboard-toggle-button');
        control.dataset.attendanceValue = value;
        control.setAttribute('aria-label', `Mark ${entry.student_name} ${value}`);
        attendanceButtons.append(control);
      }
      const pointsButtons = node('div', 'dashboard-points-buttons');
      pointsButtons.append(points);
      const decrease = button('−', 'step-points', 'dashboard-step-button'); decrease.dataset.pointsStep = '-1'; decrease.setAttribute('aria-label', `Decrease points for ${entry.student_name}`);
      const increase = button('+', 'step-points', 'dashboard-step-button'); increase.dataset.pointsStep = '1'; increase.setAttribute('aria-label', `Increase points for ${entry.student_name}`);
      const number = node('output', 'dashboard-points-value', String(entry.participation ?? 0)); number.setAttribute('aria-label', `Points for ${entry.student_name}`);
      pointsButtons.append(decrease, number, increase);
      row.append(title, controlField('Attendance', attendanceButtons), controlField('Points', pointsButtons), field('Note', Object.assign(input('text', 'note', entry.note || ''), { maxLength: 300 })), history);
      syncAttendanceControls(row);
      attendance.append(row);
    }
    const presentCount = detail.roster.filter(entry => entry.attendance !== 'absent').length;
    const score = detail.roster.reduce((total, entry) => total + (entry.attendance === 'absent' ? -1 : Number(entry.participation || 0)), 0);
    attendance.append(node('p', 'dashboard-attendance-summary', `${detail.roster.length} students · ${presentCount} present · ${detail.roster.length - presentCount} absent · Session score ${score > 0 ? '+' : ''}${score}`));
    const bulk = node('div', 'dashboard-attendance-bulk');
    bulk.append(button('Mark everyone present', 'attendance-all', 'button button-text'), button('Mark everyone absent', 'attendance-none', 'button button-text'));
    attendance.append(bulk, node('small', 'dashboard-save-status', ''), formButton('Save attendance', 'button button-secondary'));
    attendance.append(buildDraftChoice(meeting, 'attendance'));
    panel.append(attendance); return panel;
  }
  function buildDraftChoice(meeting, kind) {
    const entry = recordDrafts.get(recordId(meeting.meeting_key, kind));
    const box = node('div', 'dashboard-draft-choice');
    if (!entry || !['conflict', 'blocked', 'failed', 'rosterConflict'].includes(entry.status)) { box.hidden = true; return box; }
    if (entry.status === 'rosterConflict') {
      const oldIds = Object.keys(entry.values).filter(key => key.endsWith(':attendance')).map(key => key.slice(0, -':attendance'.length));
      const newIds = state.details?.roster.map(item => item.student_id) || [];
      const name = id => state.students.find(item => item.id === id)?.name || id;
      box.append(node('strong', '', 'Attendance roster changed'),
        node('p', '', `Added: ${newIds.filter(id => !oldIds.includes(id)).map(name).join(', ') || 'none'}`),
        node('p', '', `Removed: ${oldIds.filter(id => !newIds.includes(id)).map(name).join(', ') || 'none'}`),
        node('p', '', 'Review the new roster before saving attendance.'));
      const reconcile = button('Reconcile draft', 'reconcile-roster', 'button button-secondary'); reconcile.dataset.kind = kind;
      const discard = button('Discard attendance draft', 'discard-draft', 'button button-quiet'); discard.dataset.kind = kind;
      box.append(reconcile, discard);
    } else if (entry.status === 'conflict') {
      const describeLesson = values => `Notes: ${values.notes || '(empty)'}\nRating: ${values.rating || 'No rating'}\nLesson type: ${values.lesson_type === '__custom' ? values.custom_lesson_type || '(empty custom type)' : values.lesson_type || '(none)'}\nStatus: ${values.status || '(none)'}`;
      const local = kind === 'lesson' ? describeLesson(entry.values) :
        Object.entries(entry.values).filter(([key]) => key.endsWith(':attendance')).map(([key, attendance]) => {
          const studentId = key.slice(0, -':attendance'.length);
          const name = state.details?.roster.find(student => student.student_id === studentId)?.student_name || studentId;
          return `${name}: ${attendance}, points ${entry.values[`${studentId}:participation`] || '0'}, note ${entry.values[`${studentId}:note`] || '(empty)'}`;
        }).join('\n') || '(empty roster)';
      const account = kind === 'lesson' ? describeLesson(state.details?.lesson || {}) :
        state.details?.attendance?.entries.map(student => `${student.student_name}: ${student.attendance}, points ${student.participation}, note ${student.note || '(empty)'}`).join('\n') || '(no saved attendance)';
      box.append(node('strong', '', 'Choose a version before saving'),
        node('p', '', `Account revision ${recordRevision(kind)} differs from the draft’s revision ${entry.baseRevision}.`),
        node('p', '', `On this device:\n${local}`),
        node('p', '', `In account:\n${account}`));
      for (const [label, action] of [['Use my draft', 'keep-draft'], ['Use account version', 'discard-draft']]) {
        const choice = button(label, action, 'button button-secondary'); choice.dataset.kind = kind; box.append(choice);
      }
    } else if (entry.status === 'blocked') {
      box.append(node('p', '', 'This draft is being edited in another tab. Take over to save changes here.'));
      const takeover = button('Take over draft', 'takeover-draft', 'button button-secondary'); takeover.dataset.kind = kind; box.append(takeover);
    } else {
      box.append(node('p', '', 'The account save failed. Your draft remains on this device.'));
      const retry = button('Retry', 'retry-draft', 'button button-secondary'); retry.dataset.kind = kind; box.append(retry);
    }
    return box;
  }
  function buildHistory() {
    const panel = node('section', 'dashboard-section');
    const student = state.students.find(item => item.id === state.history.studentId);
    panel.append(node('h3', '', `${student?.name || 'Student'} · history`), button('Close history', 'close-history'),
      button('Export progress report', 'open-report', 'button button-secondary'));
    if (state.history.report) panel.append(buildReport());
    if (state.history.loading) panel.append(node('p', 'field-hint', 'Loading history…'));
    if (state.history.totals) panel.append(node('p', 'field-hint', `This group: ${state.history.totals.group} points · Overall: ${state.history.totals.overall} points`));
    for (const item of state.history.items || []) {
      const row = node('article', 'dashboard-history-item');
      row.append(node('strong', '', `${labelDate(item.actual_date, { month: 'short', day: 'numeric', year: 'numeric' })} · ${item.group_name}`));
      if (item.lesson) row.append(node('p', '', `${item.lesson.lesson_type} · ${item.lesson.status}${item.lesson.rating ? ` · ${item.lesson.rating}/5` : ''}${item.lesson.notes ? ` — ${item.lesson.notes}` : ''}`));
      if (item.attendance) row.append(node('p', '', `${item.attendance.attendance}${item.attendance.attendance === 'absent' ? ' · −1' : ` · ${item.attendance.participation > 0 ? '+' : ''}${item.attendance.participation}`}${item.attendance.note ? ` · ${item.attendance.note}` : ''}`));
      panel.append(row);
    }
    if (!state.history.loading && !state.history.items.length) panel.append(node('p', 'field-hint', 'No saved meetings for this student yet.'));
    if (state.history.nextOffset !== null && state.history.nextOffset !== undefined) panel.append(button('Load older records', 'more-history'));
    return panel;
  }

  function buildReport() {
    const draft = state.history.report;
    const panel = node('section', 'dashboard-report');
    panel.append(node('h4', '', 'Progress report'), node('p', 'field-hint', 'Choose one group and an inclusive date range. The preview and PDF use the same saved snapshot.'));
    const groupIds = [...new Set(state.enrollments.filter(item => item.student_id === state.history.studentId).map(item => item.group_id))];
    const groups = state.groups.filter(item => groupIds.includes(item.id));
    const group = select('group', groups.map(item => [item.id, item.name]), draft.groupId);
    group.dataset.reportField = 'groupId'; group.disabled = draft.loading || draft.downloading;
    const from = input('date', 'from', draft.from); from.dataset.reportField = 'from'; from.disabled = draft.loading || draft.downloading;
    const to = input('date', 'to', draft.to); to.dataset.reportField = 'to'; to.disabled = draft.loading || draft.downloading;
    panel.append(field('Group', group), field('From', from), field('Through', to));
    const preview = button(draft.loading ? 'Loading preview…' : 'Preview report', 'preview-report', 'button button-primary');
    preview.disabled = draft.loading || draft.downloading; panel.append(preview);
    if (draft.error) panel.append(node('p', 'dashboard-message', draft.error));
    if (!draft.snapshot) return panel;
    const report = progressReport(draft.snapshot, draft.selectedNotes);
    panel.append(node('p', '', `Teacher: ${report.teacher.name} · Student: ${report.student.name} · Group: ${report.group.name} (${report.group.subject})`),
      node('p', '', `Period: ${report.from} through ${report.to}`),
      node('p', 'dashboard-report-totals', `${report.totals.present} present · ${report.totals.absent} absent · ${report.totals.attendance} · Participation ${report.totals.participation} · Absence deductions ${report.totals.absenceDeductions} · Combined score ${report.totals.combined}`));
    if (!report.meetings.length) panel.append(node('p', 'field-hint', 'No recorded meetings in this period.'));
    for (const item of report.meetings) {
      const row = node('article', 'dashboard-history-item');
      row.append(node('strong', '', `${labelDate(item.actual_date, { month: 'short', day: 'numeric', year: 'numeric' })} · ${item.lesson_type || 'Attendance record'}`),
        node('p', '', `${item.status || 'Saved attendance'} · ${item.attendance || 'No recorded attendance'} · ${item.score === null ? 'No score' : `${item.score} points`}`));
      if (draft.snapshot.meetings.find(original => original.id === item.id)?.note) {
        const choice = input('checkbox', 'include-note', item.id); choice.dataset.reportField = 'note';
        choice.checked = draft.selectedNotes.has(item.id); choice.disabled = draft.downloading;
        row.append(field('Include this student note', choice));
        if (item.note) row.append(node('p', 'dashboard-report-note', item.note));
      }
      panel.append(row);
    }
    const download = button(draft.downloading ? 'Creating PDF…' : 'Prepare PDF download', 'download-report', 'button button-secondary');
    download.disabled = draft.downloading; panel.append(download);
    if (draft.downloadUrl) {
      const link = node('a', 'button button-primary', 'Save PDF');
      link.href = draft.downloadUrl;
      link.download = draft.downloadName;
      panel.append(link);
    }
    return panel;
  }

  async function refresh({ keepSelection = true, reloadDetails = true } = {}) {
    if (!state.workspace) return;
    const workspaceId = state.workspace.id;
    await flushVisible();
    if (state.workspace?.id !== workspaceId) return;
    const ticket = ++requestVersion; state.loading = true; publish();
    try {
      const [groups, rosterData] = await Promise.all([access.listGroups(state.workspace.id), access.listStudents(state.workspace.id)]);
      if (ticket !== requestVersion) return;
      state.groups = groups; state.students = rosterData.students; state.enrollments = rosterData.enrollments;
      if (!state.groups.some(item => item.id === state.expandedGroupId)) state.expandedGroupId = state.groups.find(item => !item.archived)?.id || state.groups[0]?.id || '';
      const start = monday(state.selectedDate);
      state.meetings = await access.listMeetings(state.workspace.id, start, addDays(start, 6));
      if (ticket !== requestVersion) return;
      if (!keepSelection || !state.meetings.some(item => !item.is_marker && item.meeting_key === state.selectedKey)) state.selectedKey = '';
      state.loading = false; publish();
      if (state.selectedKey && reloadDetails) void loadDetails(state.selectedKey);
    } catch (error) {
      if (ticket !== requestVersion) return;
      state.loading = false; reportError(error); publish();
    }
  }
  async function loadDetails(key) {
    const meeting = state.meetings.find(item => !item.is_marker && item.meeting_key === key); if (!meeting) return;
    state.selectedKey = key; state.details = null; publish();
    const ticket = requestVersion;
    try {
      const details = await access.meetingDetails(state.workspace.id, meeting);
      if (ticket !== requestVersion || state.selectedKey !== key) return;
      state.details = { ...details, key };
      if (drafts) for (const kind of ['lesson', 'attendance']) {
        const id = recordId(key, kind);
        const inMemory = recordDrafts.get(id);
        const draft = await drafts.get(recordId(key, kind)).catch(() => {
          state.draftStorageError = true;
          state.message = 'Device drafts could not be read. Check browser storage before editing.';
          return null;
        });
        if (ticket !== requestVersion || state.selectedKey !== key) return;
        const keyForForm = `${kind}::::${key}`;
        const candidate = !draft || (inMemory?.version || 0) > draft.version ? inMemory : draft;
        savedFormValues.delete(keyForForm);
        recordDrafts.delete(id);
        if (candidate && candidate.userId === userId && candidate.workspaceId === state.workspace.id && (candidate.schemaVersion === 1 || candidate === inMemory)) {
          const revision = kind === 'lesson' ? details.lesson?.revision || 0 : details.attendance?.revision || 0;
          candidate.status = candidate.status === 'blocked' ||
            (candidate.tabId && candidate.tabId !== drafts.tabId && candidate.leaseUntil > Date.now()) ? 'blocked' :
            candidate.baseRevision !== revision ? 'conflict' : candidate.status === 'failed' ? 'failed' :
              candidate.status === 'storageFailed' ? 'storageFailed' : 'deviceSaved';
          if (kind === 'attendance' && !details.attendance && candidate.status !== 'blocked' && candidate.status !== 'conflict') {
            const oldIds = Object.keys(candidate.values).filter(field => field.endsWith(':attendance'))
              .map(field => field.slice(0, -':attendance'.length)).sort();
            const newIds = details.roster.map(item => item.student_id).sort();
            if (JSON.stringify(oldIds) !== JSON.stringify(newIds)) candidate.status = 'rosterConflict';
          }
          recordDrafts.set(id, candidate);
          savedFormValues.set(keyForForm, candidate.values);
        }
      }
      publish();
    } catch (error) { if (ticket === requestVersion) { reportError(error); publish(); } }
  }
  function open(workspace, accountId = workspace.owner_id) {
    if (openedWorkspace === workspace.id && userId === accountId) return;
    clearReportDownload(state.history?.report);
    if (leaseTimer) clearInterval(leaseTimer); leaseTimer = null;
    root = null; savedFormValues.clear();
    recordDrafts.clear(); for (const timer of timers.values()) clearTimeout(timer); timers.clear();
    userId = accountId;
    if (drafts?.renew) leaseTimer = setInterval(() => {
      for (const entry of recordDrafts.values()) if (entry.tabId === drafts.tabId && entry.status !== 'blocked')
        void drafts.renew(entry.key).then(owned => { if (!owned) { entry.status = 'blocked'; publish(); } }).catch(() => {});
    }, 5000);
    openedWorkspace = workspace.id; state.workspace = workspace; state.groups = []; state.students = []; state.enrollments = [];
    state.meetings = []; state.selectedDate = today(); state.view = 'day'; state.section = 'schedule'; state.studentGroupId = ''; state.studentDialog = null; state.selectedKey = ''; state.details = null; state.scheduleChange = null; state.import = null;
    state.history = null; state.message = ''; state.busy = false; state.newGroupOpen = false; state.expandedGroupId = '';
    state.draftStorageError = false;
    void refresh({ keepSelection: false });
  }
  function close() {
    if (!openedWorkspace) return;
    clearReportDownload(state.history?.report);
    flushVisible();
    if (leaseTimer) clearInterval(leaseTimer); leaseTimer = null;
    requestVersion++; openedWorkspace = ''; state.workspace = null; state.groups = []; state.students = []; state.enrollments = [];
    state.meetings = []; state.details = null; state.selectedKey = ''; state.scheduleChange = null; state.import = null; state.history = null; state.studentDialog = null; state.busy = false;
    state.message = ''; state.newGroupOpen = false; state.expandedGroupId = ''; savedFormValues.clear(); recordDrafts.clear(); userId = ''; root = null; render(document.createDocumentFragment());
  }
  function value(form, name) { return new FormData(form).get(name)?.toString() || ''; }
  async function onSubmit(event) {
    const form = event.target.closest('form[data-form]'); if (!form) return;
    event.preventDefault(); if (state.busy) return;
    const kind = form.dataset.form;
    if (['lesson', 'attendance'].includes(kind)) {
      const entry = recordDrafts.get(recordId(form.dataset.meeting, kind));
      if (['conflict', 'blocked', 'rosterConflict'].includes(entry?.status)) return;
    }
    if (kind === 'reschedule') {
      const meeting = currentMeeting(); if (!meeting || state.details?.lesson || state.details?.attendance) return;
      const actual_date = value(form, 'actual_date'); const start_time = value(form, 'start_time');
      const end_time = value(form, 'end_time'); const room = value(form, 'room').trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(actual_date) || !/^\d{2}:\d{2}$/.test(start_time)
        || !/^\d{2}:\d{2}$/.test(end_time) || start_time >= end_time || room.length > 120) {
        state.message = 'Enter a valid date and time interval before previewing.'; publish(); return;
      }
      const workspaceId = state.workspace.id;
      state.busy = true; state.message = ''; publish();
      try {
        const meetings = await destinationWeek(actual_date);
        if (state.workspace?.id !== workspaceId || currentMeeting()?.meeting_key !== meeting.meeting_key) return;
        state.scheduleChange = { key: meeting.meeting_key, mode: 'move', actual_date, start_time, end_time, room,
          destinationMeetings: meetings };
      } catch (error) {
        if (state.workspace?.id === workspaceId) {
          reportError(error);
          state.message = 'Could not load the destination week. Try previewing again.';
        }
      } finally { state.busy = false; publish(); }
      return;
    }
    const submittedValues = ['lesson', 'attendance'].includes(kind) ? recordValues(form) : null;
    const submittedStudents = kind === 'attendance' ? [...form.querySelectorAll('.dashboard-attendance-row')].map(row => row.dataset.student) : [];
    const submittingWorkspace = state.workspace.id;
    state.busy = true; state.message = ''; publish();
    let retainForm = false;
    let draftSnapshot = null;
    try {
      if (submittedValues && drafts) {
        draftSnapshot = await persistRecord(form, true);
        if (draftSnapshot?.status === 'blocked') return;
        if (draftSnapshot && recordDrafts.get(draftSnapshot.key)?.version === draftSnapshot.version) setRecordStatus(draftSnapshot.key, 'accountSaving');
      }
      if (kind === 'group') {
        const data = { name: value(form, 'name').trim(), subject: value(form, 'subject').trim(), code: value(form, 'code').trim() || null, expected_revision: 0 };
        const saved = await write('save_group', data);
        state.expandedGroupId = saved.id; state.newGroupOpen = false;
      } else if (kind === 'edit-group') {
        const group = state.groups.find(item => item.id === form.dataset.group);
        await write('save_group', { id: group.id, name: value(form, 'name').trim(), subject: value(form, 'subject').trim(),
          code: value(form, 'code').trim() || null, expected_revision: group.revision });
      } else if (kind === 'schedule') {
        await write('save_schedule_slot', { group_id: form.dataset.group, weekday: Number(value(form, 'weekday')),
          start_time: value(form, 'start_time'), end_time: value(form, 'end_time'), room: value(form, 'room'),
          effective_from: value(form, 'effective_from'), effective_to: value(form, 'effective_to') || null, expected_revision: 0 });
      } else if (kind === 'edit-schedule') {
        const group = state.groups.find(item => item.id === form.dataset.group);
        const slot = group.slots.find(item => item.id === form.dataset.slot);
        await write('save_schedule_slot', { id: slot.id, group_id: group.id, weekday: Number(value(form, 'weekday')),
          start_time: value(form, 'start_time'), end_time: value(form, 'end_time'), room: value(form, 'room'),
          effective_from: value(form, 'effective_from'), effective_to: value(form, 'effective_to') || null, expected_revision: slot.revision });
      } else if (kind === 'student') {
        const student = await write('save_student', { name: value(form, 'name').trim(), external_id: value(form, 'external_id').trim() || null, expected_revision: 0 });
        if (form.dataset.group) {
          try {
            await write('save_enrollment', { group_id: form.dataset.group, student_id: student.id,
              starts_on: value(form, 'starts_on'), expected_revision: 0 });
            state.message = `${student.name} was added and enrolled.`;
          } catch (error) {
            state.message = `${student.name} was created, but enrollment failed. Choose them under Enroll existing student.`;
            await refresh();
            const activeForm = [...root.querySelectorAll('form[data-form="student"]')].find(item => formKey(item) === formKey(form));
            activeForm?.reset(); savedFormValues.delete(formKey(form));
            return;
          }
        } else state.message = `${student.name} was created. Enroll them in a group when ready.`;
        state.studentDialog = null;
      } else if (kind === 'edit-student') {
        const student = state.students.find(item => item.id === form.dataset.student);
        await write('save_student', { id: student.id, name: value(form, 'name').trim(), external_id: value(form, 'external_id').trim() || null,
          expected_revision: student.revision });
        state.studentDialog = null;
      } else if (kind === 'enroll') {
        await write('save_enrollment', { group_id: form.dataset.group, student_id: value(form, 'student_id'), starts_on: value(form, 'starts_on'), expected_revision: 0 });
      } else if (kind === 'lesson') {
        const meeting = currentMeeting(); const meetingKey = meeting.meeting_key; const detail = state.details;
        const version = state.editorVersion;
        retainForm = true;
        const saved = await write('save_lesson_record', { schedule_slot_id: meeting.schedule_slot_id, original_date: meeting.original_date,
          expected_revision: detail.lesson?.revision || 0, notes: submittedValues.notes, rating: submittedValues.rating ? Number(submittedValues.rating) : null,
          lesson_type: submittedValues.lesson_type === '__custom' ? submittedValues.custom_lesson_type.trim() : submittedValues.lesson_type, status: submittedValues.status });
        meeting.id = saved.meeting.id; meeting.revision = saved.meeting.revision;
        if (state.details?.key === meetingKey) state.details.lesson = saved.record;
        applyHistorySave(meeting, 'lesson', saved.record);
        retainForm = draftSnapshot ? recordDrafts.get(draftSnapshot.key)?.version !== draftSnapshot.version : version !== state.editorVersion;
        if (draftSnapshot) await finishAccountSave(draftSnapshot, saved.record.revision, retainForm);
      } else if (kind === 'attendance') {
        const meeting = currentMeeting(); const meetingKey = meeting.meeting_key; const detail = state.details; const version = state.editorVersion;
        retainForm = true;
        const entries = submittedStudents.map(studentId => {
          const attendance = submittedValues[`${studentId}:attendance`];
          return { student_id: studentId, attendance,
            participation: attendance === 'absent' ? 0 : Number(submittedValues[`${studentId}:participation`]),
            note: submittedValues[`${studentId}:note`] };
        });
        const saved = await write('save_attendance', { schedule_slot_id: meeting.schedule_slot_id, original_date: meeting.original_date,
          expected_revision: detail.attendance?.revision || 0, entries });
        meeting.id = saved.meeting.id; meeting.revision = saved.meeting.revision;
        if (state.details?.key === meetingKey) state.details = { ...state.details, attendance: { ...saved.checklist, entries: saved.entries }, roster: saved.entries };
        applyHistorySave(meeting, 'attendance', null, saved.entries, detail.attendance?.entries || []);
        retainForm = draftSnapshot ? recordDrafts.get(draftSnapshot.key)?.version !== draftSnapshot.version : version !== state.editorVersion;
        if (draftSnapshot) await finishAccountSave(draftSnapshot, saved.checklist.revision, retainForm);
      }
      if (state.workspace?.id !== submittingWorkspace) return;
      if (submittedValues && !retainForm) await flushVisible();
      if (!retainForm) savedFormValues.delete(formKey(form));
      if (submittedValues && !retainForm) root = null;
      if (kind === 'group' || kind === 'student' || kind === 'enroll' || kind === 'schedule') {
        const activeForm = [...root.querySelectorAll('form[data-form]')].find(item => formKey(item) === formKey(form));
        activeForm?.reset();
      }
      if (kind !== 'student') state.message = retainForm ? 'Saved. Newer edits remain unsaved.' : 'Saved.';
      await refresh({ reloadDetails: !retainForm });
    } catch (error) { if (state.workspace?.id === submittingWorkspace) {
      if (draftSnapshot) {
        await flushRecord(recordForm(kind));
        const current = recordDrafts.get(draftSnapshot.key);
        if (current) {
          current.status = 'failed';
          try { await drafts.put(current); setRecordStatus(draftSnapshot.key, 'failed'); }
          catch (storageError) { setRecordStatus(draftSnapshot.key, storageError.message?.startsWith('DRAFT_') ? 'blocked' : 'storageFailed'); }
        }
      }
      reportError(error);
      if (error?.code === 'TD004' && state.selectedKey) void loadDetails(state.selectedKey);
    } }
    finally { state.busy = false; publish(); }
  }
  async function onClick(event) {
    const action = event.target.closest('[data-action]')?.dataset.action; if (!action) return;
    const target = event.target.closest('[data-action]');
    if (action === 'set-attendance' || action === 'step-points') {
      const row = target.closest('.dashboard-attendance-row');
      const form = target.closest('form[data-form="attendance"]');
      if (!row || !form || state.busy) return;
      const attendance = row.querySelector('[name="attendance"]');
      const points = row.querySelector('[name="participation"]');
      if (action === 'set-attendance') {
        attendance.value = target.dataset.attendanceValue;
        if (attendance.value === 'absent') points.value = '0';
        points.disabled = attendance.value === 'absent';
      } else if (attendance.value === 'present') points.value = String(Math.max(-1, Math.min(1, Number(points.value) + Number(target.dataset.pointsStep))));
      syncAttendanceControls(row); updateAttendanceSummary(); state.editorVersion++;
      void persistRecord(form, true);
      return;
    }
    if (action === 'section') {
      await flushVisible();
      state.section = target.dataset.section;
      state.studentDialog = null;
      clearReportDownload(state.history?.report); state.history = null;
      publish();
      root.querySelector(`[data-section="${state.section}"]`)?.focus();
      return;
    }
    if (action === 'select-student-group') { state.studentGroupId = target.dataset.group; publish(); root.querySelector(`[data-action="select-student-group"][data-group="${state.studentGroupId}"]`)?.focus(); return; }
    if (action === 'open-student-dialog') {
      state.studentDialog = { groupId: target.dataset.group || '', studentId: target.dataset.student || '' };
      publish(); return;
    }
    if (action === 'close-student-dialog') {
      closeStudentDialog();
      return;
    }
    if (['keep-draft', 'discard-draft', 'takeover-draft', 'retry-draft', 'reconcile-roster'].includes(action)) {
      const kind = target.dataset.kind; const meeting = currentMeeting();
      if (!meeting || !drafts) return;
      const key = recordId(meeting.meeting_key, kind); const entry = recordDrafts.get(key);
      if (!entry) return;
      try {
        if (action === 'reconcile-roster') {
          const values = {};
          for (const student of state.details.roster) {
            const id = student.student_id;
            values[`${id}:attendance`] = entry.values[`${id}:attendance`] || 'present';
            values[`${id}:participation`] = entry.values[`${id}:participation`] || '0';
            values[`${id}:note`] = entry.values[`${id}:note`] || '';
          }
          const next = { ...entry, version: entry.version + 1, values, status: 'deviceSaved' };
          const saved = await drafts.put(next);
          recordDrafts.set(key, saved); savedFormValues.set(`attendance::::${meeting.meeting_key}`, values);
          state.message = 'Roster reconciled. Review each student before saving.'; root = null; publish();
        } else if (action === 'discard-draft') {
          await flushRecord(recordForm(kind));
          const latest = recordDrafts.get(key) || entry;
          if (!await drafts.deleteVersion(key, latest.version)) {
            state.message = 'The draft changed before it could be discarded. Review it again.';
            await loadDetails(meeting.meeting_key);
            return;
          }
          clearTimeout(timers.get(key)); timers.delete(key); recordDrafts.delete(key);
          savedFormValues.delete(`${kind}::::${meeting.meeting_key}`); root = null; publish();
        } else {
          if (action === 'keep-draft') entry.baseRevision = recordRevision(kind);
          if (action === 'retry-draft') { recordForm(kind)?.requestSubmit(); return; }
          const saved = await drafts.put(entry, { takeover: action === 'takeover-draft' });
          recordDrafts.set(key, { ...saved, status: saved.baseRevision === recordRevision(kind) ? 'deviceSaved' : 'conflict' }); publish();
        }
      } catch { setRecordStatus(key, 'storageFailed'); publish(); }
      return;
    }
    if (['previous', 'next', 'today', 'select-day', 'meeting', 'moved-marker', 'close-meeting', 'reload', 'confirm-schedule-change'].includes(action)) await flushVisible();
    if (action === 'previous' || action === 'next' || action === 'today') {
      const delta = state.view === 'day' ? 1 : 7;
      state.selectedDate = action === 'today' ? today() : addDays(state.selectedDate, action === 'previous' ? -delta : delta);
      state.selectedKey = ''; state.details = null; await refresh({ keepSelection: false });
    } else if (action === 'toggle-view') { state.view = state.view === 'day' ? 'week' : 'day'; publish(); }
    else if (action === 'select-day') { state.selectedDate = target.dataset.date; state.view = 'day'; state.selectedKey = ''; state.details = null; await refresh({ keepSelection: false }); }
    else if (action === 'attendance-all' || action === 'attendance-none') {
      const form = target.closest('form[data-form="attendance"]');
      for (const row of form?.querySelectorAll('.dashboard-attendance-row') || []) {
        const absent = action === 'attendance-none';
        row.querySelector('[name="attendance"]').value = absent ? 'absent' : 'present';
        const points = row.querySelector('[name="participation"]'); points.value = '0'; points.disabled = absent;
        syncAttendanceControls(row);
      }
      state.editorVersion++;
      updateAttendanceSummary();
      if (form) void persistRecord(form, true);
    }
    else if (action === 'reload') { state.message = ''; await refresh(); }
    else if (action === 'toggle-group') { state.expandedGroupId = state.expandedGroupId === target.dataset.group ? '' : target.dataset.group; publish(); }
    else if (action === 'toggle-import') {
      state.import = state.import?.groupId === target.dataset.group ? null :
        { groupId: target.dataset.group, startsOn: today(), parsed: null, decisions: {}, rawText: '', error: '', result: null };
      publish();
    }
    else if (action === 'preview-import') {
      const draft = state.import; if (!draft) return;
      draft.rawText = root.querySelector('#student-import-paste')?.value || '';
      const parsed = parseStudentInput(draft.rawText);
      draft.error = parsed.error || ''; draft.parsed = parsed.error ? null : parsed;
      draft.decisions = {}; draft.result = null; publish();
    }
    else if (action === 'confirm-import') {
      const draft = state.import; const group = state.groups.find(item => item.id === draft?.groupId);
      if (!draft || !group || state.busy || !/^\d{4}-\d{2}-\d{2}$/.test(draft.startsOn)) return;
      const preview = importPreview(group);
      if (!preview || preview.error || preview.rows.some(row => row.blocking)) return;
      const payload = { group_id: group.id, expected_group_revision: group.revision, starts_on: draft.startsOn,
        rows: preview.rows.map(row => ({ row_number: row.rowNumber, name: row.name, external_id: row.externalId,
          action: row.action, student_id: row.action === 'use_existing' ? row.studentId : null,
          expected_student_revision: row.action === 'use_existing' ? row.selected?.revision : null })) };
      state.busy = true; draft.error = ''; publish();
      try {
        const result = await write('import_students', payload);
        if (state.import !== draft) return;
        draft.parsed = null; draft.rawText = ''; draft.decisions = {}; draft.result = result;
        await refresh();
      } catch (error) {
        if (state.import === draft) {
          draft.error = statusText(error?.code);
          if (['TD004', 'TD007'].includes(error?.code)) await refresh();
        }
      } finally { state.busy = false; publish(); }
    }
    else if (action === 'meeting') { state.scheduleChange = null; await loadDetails(target.dataset.key); }
    else if (action === 'moved-marker') {
      state.selectedDate = target.dataset.date; state.selectedKey = ''; state.details = null;
      await refresh({ keepSelection: false }); await loadDetails(target.dataset.key);
    }
    else if (action === 'open-reschedule') {
      const meeting = currentMeeting(); if (!meeting) return;
      state.scheduleChange = { key: meeting.meeting_key, mode: 'edit' }; publish();
    }
    else if (action === 'preview-restore') {
      const meeting = currentMeeting(); if (!meeting) return;
      const slot = state.groups.find(group => group.id === meeting.group_id)?.slots.find(item => item.id === meeting.schedule_slot_id);
      const original = slot?.versions.find(item => item.effective_from <= meeting.original_date && (!item.effective_to || meeting.original_date < item.effective_to));
      if (!original) { state.message = 'The original schedule is unavailable. Reload and try again.'; publish(); return; }
      const workspaceId = state.workspace.id;
      state.busy = true; state.message = ''; publish();
      try {
        const meetings = await destinationWeek(meeting.original_date);
        if (state.workspace?.id !== workspaceId || currentMeeting()?.meeting_key !== meeting.meeting_key) return;
        state.scheduleChange = { key: meeting.meeting_key, mode: 'restore', actual_date: meeting.original_date,
          start_time: escapeTime(original.start_time), end_time: escapeTime(original.end_time), room: original.room || '',
          destinationMeetings: meetings };
      } catch (error) {
        if (state.workspace?.id === workspaceId) state.message = 'Could not load the original week. Try again.';
      } finally { state.busy = false; publish(); }
    }
    else if (action === 'cancel-schedule-change') {
      if (state.scheduleChange) savedFormValues.delete(`reschedule::::${state.scheduleChange.key}`);
      state.scheduleChange = null; publish();
    }
    else if (action === 'confirm-schedule-change') {
      const meeting = currentMeeting(); const change = state.scheduleChange;
      if (!meeting || !change || change.key !== meeting.meeting_key || state.busy) return;
      state.busy = true; publish();
      try {
        const payload = { schedule_slot_id: meeting.schedule_slot_id, original_date: meeting.original_date,
          expected_revision: meeting.revision || 0 };
        if (change.mode === 'move') Object.assign(payload, { actual_date: change.actual_date,
          start_time: change.start_time, end_time: change.end_time, room: change.room });
        const result = await write(change.mode === 'restore' ? 'restore_meeting' : 'reschedule_meeting', payload);
        const confirmed = result.meeting;
        const weekStart = monday(confirmed.actual_date); const weekEnd = addDays(weekStart, 6);
        state.meetings = change.destinationMeetings.filter(item => item.meeting_key !== confirmed.meeting_key
          && (item.is_marker ? item.original_date : item.actual_date) >= weekStart
          && (item.is_marker ? item.original_date : item.actual_date) <= weekEnd);
        state.meetings.push(confirmed);
        if (confirmed.original_date !== confirmed.actual_date && confirmed.original_date >= weekStart && confirmed.original_date <= weekEnd)
          state.meetings.push({ ...confirmed, is_marker: true });
        state.selectedDate = confirmed.actual_date; state.selectedKey = confirmed.meeting_key;
        savedFormValues.delete(`reschedule::::${change.key}`);
        state.scheduleChange = null; state.details = null; state.message = change.mode === 'restore' ? 'Original schedule restored.' : 'Meeting rescheduled.';
        publish();
        // The confirmed response updates the calendar first; this read loads the destination roster.
        void refresh({ keepSelection: true });
      } catch (error) {
        reportError(error); state.scheduleChange = null; publish();
        if (['TD004', 'TD006', 'TD008'].includes(error?.code)) void refresh();
      } finally { state.busy = false; publish(); }
    }
    else if (action === 'more-notes') {
      const meeting = currentMeeting(); const detail = state.details;
      if (!meeting || !detail || detail.previousLoading) return;
      const ticket = requestVersion; detail.previousLoading = true; publish();
      try {
        const page = await access.groupHistory(state.workspace.id, meeting.group_id, meeting.actual_date, detail.previousNextOffset);
        if (ticket !== requestVersion || state.details?.key !== detail.key) return;
        state.details.previousNotes.push(...page.items); state.details.previousNextOffset = page.nextOffset;
      } catch (error) { if (ticket === requestVersion) reportError(error); }
      finally { if (ticket === requestVersion && state.details?.key === detail.key) { state.details.previousLoading = false; publish(); } }
    }
    else if (action === 'close-meeting') { state.selectedKey = ''; state.details = null; publish(); }
    else if (action === 'new-group') { state.newGroupOpen = !state.newGroupOpen; publish(); }
    else if (action === 'archive-group') {
      const group = state.groups.find(item => item.id === target.dataset.group); if (!group || state.busy) return;
      if (!window.confirm(`Archive ${group.name}? Its saved history will remain available.`)) return;
      state.busy = true; publish();
      try { await write('save_group', { id: group.id, name: group.name, subject: group.subject, code: group.code, archived: true, expected_revision: group.revision }); state.message = 'Group archived. Saved history remains available.'; await refresh(); }
      catch (error) { reportError(error); }
      finally { state.busy = false; publish(); }
    } else if (action === 'end-enrollment') {
      const enrollment = state.enrollments.find(item => item.id === target.dataset.enrollment); if (!enrollment || state.busy) return;
      state.busy = true; publish();
      try { await write('save_enrollment', { id: enrollment.id, group_id: enrollment.group_id, student_id: enrollment.student_id,
        starts_on: enrollment.starts_on, ends_on: addDays(today(), 1), expected_revision: enrollment.revision }); await refresh(); }
      catch (error) { reportError(error); }
      finally { state.busy = false; publish(); }
    } else if (action === 'history') {
      clearReportDownload(state.history?.report);
      state.history = { studentId: target.dataset.student, groupId: target.dataset.group, items: [], nextOffset: 0, totals: null, loading: false }; publish(); await loadHistory(false);
    } else if (action === 'open-report') {
      const history = state.history; if (!history) return;
      if (history.report) { clearReportDownload(history.report); history.report = null; publish(); return; }
      const groupIds = state.enrollments.filter(item => item.student_id === history.studentId).map(item => item.group_id);
      const end = today();
      history.report = { groupId: groupIds.includes(history.groupId) ? history.groupId : groupIds[0] || '',
        from: `${end.slice(0, 7)}-01`, to: end, snapshot: null, selectedNotes: new Set(), loading: false, downloading: false, error: '' };
      publish();
    } else if (action === 'preview-report') {
      const draft = state.history?.report; if (!draft || draft.loading) return;
      if (!draft.groupId || !draft.from || !draft.to || draft.from > draft.to) { draft.error = 'Choose a group and a valid inclusive date range.'; publish(); return; }
      const { groupId, from, to } = draft;
      clearReportDownload(draft);
      draft.loading = true; draft.error = ''; draft.snapshot = null; draft.selectedNotes.clear(); publish();
      try {
        const snapshot = await access.studentProgressReport(state.workspace.id, state.history.studentId, groupId, from, to);
        if (state.history?.report !== draft) return;
        if (draft.groupId === groupId && draft.from === from && draft.to === to) draft.snapshot = snapshot;
      } catch (error) { if (state.history?.report === draft) { reportError(error); draft.error = state.message; } }
      finally { if (state.history?.report === draft) { draft.loading = false; publish(); } }
    } else if (action === 'download-report') {
      const draft = state.history?.report; if (!draft?.snapshot || draft.downloading) return;
      draft.downloading = true; draft.error = ''; publish();
      try {
        const { createProgressReportPdf } = await import('./progress-report-pdf.js');
        const report = progressReport(draft.snapshot, draft.selectedNotes);
        const pdf = await createProgressReportPdf(report);
        if (state.history?.report !== draft) return;
        const downloadUrl = URL.createObjectURL(pdf.output('blob'));
        clearReportDownload(draft);
        draft.downloadUrl = downloadUrl;
        draft.downloadName = `progress-report-${report.from}-${report.to}.pdf`;
      } catch { if (state.history?.report === draft) draft.error = 'The PDF could not be created. Try again.'; }
      finally { if (state.history?.report === draft) { draft.downloading = false; publish(); } }
    } else if (action === 'more-history') await loadHistory(true);
    else if (action === 'close-history') { clearReportDownload(state.history?.report); state.history = null; publish(); }
  }
  async function loadHistory(append) {
    const history = state.history; if (!history || history.loading) return;
    history.loading = true; publish();
    try {
      const [page, totals] = await Promise.all([
        access.studentHistory(state.workspace.id, history.studentId, history.nextOffset, 20),
        append ? Promise.resolve(history.totals) : access.studentScoreTotals(state.workspace.id, history.studentId, history.groupId)
      ]);
      if (state.history !== history) return;
      if (append) {
        const loadedIds = new Set(history.items.map(item => item.id));
        history.items = [...history.items, ...page.items.filter(item => !loadedIds.has(item.id))];
        history.items.sort((a, b) => b.actual_date.localeCompare(a.actual_date) || b.id.localeCompare(a.id));
      } else history.items = page.items;
      history.nextOffset = page.nextOffset;
      history.totals = totals; history.loading = false; publish();
    } catch (error) { if (state.history === history) { history.loading = false; reportError(error); publish(); } }
  }
  function showNewGroupForm() {
    const form = document.createElement('form'); form.id = 'new-group-form'; form.dataset.form = 'group'; form.className = 'dashboard-inline-form dashboard-new-group'; form.hidden = !state.newGroupOpen;
    form.append(field('Group name', input('text', 'name', '')), field('Subject', input('text', 'subject', '')), field('Code (optional)', input('text', 'code', '')), formButton('Create group'));
    root.querySelector('.dashboard-toolbar').after(form);
  }
  return {
    open, close,
    flush: flushVisible,
    refresh,
  };
}
