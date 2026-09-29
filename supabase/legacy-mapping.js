import { createHash } from 'node:crypto';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d(?::00)?$/;

function requiredDate(value, label) {
  if (!DATE.test(String(value)) || new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) !== value) {
    throw new Error(`${label} must be a YYYY-MM-DD date`);
  }
  return value;
}
function time(value, label) {
  if (!TIME.test(String(value))) throw new Error(`${label} must be a minute-precision time`);
  return String(value).slice(0, 5);
}
function nextDate(value) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}
function uuid(namespace, kind, key) {
  const hex = createHash('sha1').update(`${namespace}:${kind}:${key}`).digest('hex').slice(0, 32).split('');
  hex[12] = '5';
  hex[16] = ((parseInt(hex[16], 16) & 3) | 8).toString(16);
  return `${hex.slice(0, 8).join('')}-${hex.slice(8, 12).join('')}-${hex.slice(12, 16).join('')}-${hex.slice(16, 20).join('')}-${hex.slice(20).join('')}`;
}
function unique(items, key, label) {
  const seen = new Set();
  for (const item of items) {
    const value = key(item);
    if (!value || seen.has(value)) throw new Error(`Missing or duplicate ${label}: ${value || '(empty)'}`);
    seen.add(value);
  }
}

/** Prepare rows for a later, privileged migration. This function performs no writes. */
export function mapLegacyDashboard(snapshot, { workspaceId, scheduleStartDate } = {}) {
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(String(workspaceId))) throw new Error('A target workspace UUID is required');
  requiredDate(scheduleStartDate, 'scheduleStartDate');
  const classes = snapshot.classes || [];
  const logs = snapshot.logs || [];
  const checklists = snapshot.checklists || [];
  const students = snapshot.students || [];
  const enrollments = snapshot.enrollments || [];
  const studentRecords = snapshot.studentRecords || [];
  unique(classes, item => `${item.id || ''}|${item.weekday || ''}|${item.start || ''}|${item.end || ''}|${item.room || ''}`, 'class schedule row');
  unique(students, item => String(item.id || ''), 'student ID');
  unique(logs, item => `${item.classId || ''}|${item.date || ''}`, 'lesson class/date');
  unique(checklists, item => `${item.classId || ''}|${item.date || ''}`, 'checklist class/date');
  unique(enrollments, item => `${item.classId || ''}|${item.studentId || ''}|${item.joinedOn || ''}`, 'enrollment identity');
  if (snapshot.timezone && snapshot.timezone !== 'Asia/Tashkent') throw new Error('Unexpected source timezone');

  const classRowsById = new Map();
  for (const item of classes) {
    if (!String(item.id || '').trim()) throw new Error('A class ID is missing');
    const key = String(item.id);
    classRowsById.set(key, [...(classRowsById.get(key) || []), item]);
  }
  const studentById = new Map(students.map(item => [String(item.id), item]));
  // Every legacy class is independent, even when names and subjects match.
  const groupKey = classId => String(classId);
  const groupIds = new Map();
  const sourceGroupKeys = new Map();
  const groups = [];
  for (const item of classes) {
    const key = groupKey(item.id);
    if (groupIds.has(key)) continue;
    const id = uuid(workspaceId, 'group', key);
    groupIds.set(key, id);
    sourceGroupKeys.set(id, key);
    groups.push({ workspace_id: workspaceId, id, name: item.name, subject: item.subject,
      code: null, archived: false });
  }
  for (const group of groups) {
    const key = sourceGroupKeys.get(group.id);
    const members = classes.filter(item => groupKey(item.id) === key);
    group.archived = members.every(item => item.active === false);
    if (members.some(item => item.name !== group.name || item.subject !== group.subject)) {
      throw new Error(`Classes merged into ${key} have different names or subjects`);
    }
  }
  const slotKey = item => `${item.id}|${Number(item.weekday)}|${time(item.start, 'slot start')}|${time(item.end, 'slot end')}|${item.room || ''}`;
  const descriptors = [];
  for (const item of classes) {
    const start = time(item.start, `class ${item.id} start`);
    const end = time(item.end, `class ${item.id} end`);
    if (start >= end || !Number.isInteger(Number(item.weekday)) || Number(item.weekday) < 1 || Number(item.weekday) > 7) {
      throw new Error(`Invalid schedule for class ${item.id}`);
    }
    descriptors.push({ item, key: slotKey(item), start, end,
      id: uuid(workspaceId, 'slot', slotKey(item)), versionId: uuid(workspaceId, 'version', slotKey(item)) });
  }
  descriptors.sort((a, b) => a.key.localeCompare(b.key));
  const descriptorsByClass = new Map([...classRowsById.keys()].map(id => [id, descriptors.filter(entry => String(entry.item.id) === id)]));
  const mappedStudents = students.map(item => ({ workspace_id: workspaceId,
    id: uuid(workspaceId, 'student', item.id), name: item.name, external_id: null }));
  const mappedEnrollments = [];
  for (const item of enrollments) {
    if (!classRowsById.has(String(item.classId)) || !studentById.has(String(item.studentId))) throw new Error('Enrollment refers to an unknown class or student');
    const starts = requiredDate(item.joinedOn, 'enrollment joinedOn');
    const ends = item.leftOn ? requiredDate(item.leftOn, 'enrollment leftOn') : null;
    if (ends && ends <= starts) throw new Error('Enrollment end must follow its start');
    mappedEnrollments.push({ workspace_id: workspaceId, group_id: groupIds.get(groupKey(item.classId)),
      student_id: uuid(workspaceId, 'student', item.studentId), starts_on: starts, ends_on: ends });
  }
  mappedEnrollments.sort((a, b) => a.group_id.localeCompare(b.group_id) || a.student_id.localeCompare(b.student_id) || a.starts_on.localeCompare(b.starts_on));
  const preservedEnrollments = [];
  for (const item of mappedEnrollments) {
    const previous = preservedEnrollments.at(-1);
    if (previous && previous.group_id === item.group_id && previous.student_id === item.student_id &&
      (!previous.ends_on || item.starts_on < previous.ends_on)) throw new Error('Overlapping source enrollments require owner review');
    preservedEnrollments.push({ ...item });
  }
  for (const item of preservedEnrollments) item.id = uuid(workspaceId, 'enrollment', `${item.group_id}:${item.student_id}:${item.starts_on}`);

  const recordKeys = new Set([...logs, ...checklists].map(item => `${item.classId}|${item.date}`));
  const assignedSlots = new Map();
  let historicalSlotFallbacks = 0;
  for (const key of [...recordKeys].sort()) {
    const [classId, date] = key.split('|');
    requiredDate(date, `meeting ${key}`);
    const candidates = descriptorsByClass.get(classId);
    if (!candidates?.length) throw new Error(`Record refers to unknown class ${classId}`);
    const log = logs.find(record => String(record.classId) === classId && record.date === date);
    const checklist = checklists.find(record => String(record.classId) === classId && record.date === date);
    const snapshot = log || checklist?.classInfo || {};
    const weekday = new Date(`${date}T12:00:00Z`).getUTCDay() || 7;
    const byDay = candidates.filter(entry => Number(entry.item.weekday) === weekday);
    const byTime = entries => entries.filter(entry => entry.start === String(snapshot.start || '').slice(0, 5) && entry.end === String(snapshot.end || '').slice(0, 5));
    const exact = byTime(byDay);
    const allTimes = byTime(candidates);
    const selected = exact.length === 1 ? exact[0] : byDay.length === 1 ? byDay[0] : allTimes.length === 1 ? allTimes[0] : candidates[0];
    if (exact.length !== 1 && byDay.length !== 1 && allTimes.length !== 1) historicalSlotFallbacks++;
    assignedSlots.set(key, selected);
  }
  const slots = [];
  const versions = [];
  for (const entry of descriptors) {
    const recordDates = [...assignedSlots.entries()].filter(([, assigned]) => assigned.id === entry.id)
      .map(([key]) => key.split('|')[1]).sort();
    // The source retains only the latest timetable; saved history has its own snapshot.
    const effectiveFrom = entry.item.active === false ? (recordDates[0] || scheduleStartDate) : scheduleStartDate;
    slots.push({ workspace_id: workspaceId, id: entry.id, group_id: groupIds.get(groupKey(entry.item.id)) });
    versions.push({ workspace_id: workspaceId, id: entry.versionId, schedule_slot_id: entry.id,
      weekday: Number(entry.item.weekday), start_time: entry.start, end_time: entry.end, room: entry.item.room || '',
      effective_from: effectiveFrom, effective_to: entry.item.active === false ? nextDate(recordDates.at(-1) || effectiveFrom) : null });
  }
  const meetings = [];
  const lessons = [];
  const attendanceChecklists = [];
  const attendanceEntries = [];
  for (const key of [...recordKeys].sort()) {
    const [classId, date] = key.split('|');
    const assignment = assignedSlots.get(key);
    const item = assignment?.item;
    if (!item) throw new Error(`Record refers to unknown class ${classId}`);
    requiredDate(date, `meeting ${key}`);
    const log = logs.find(record => String(record.classId) === classId && record.date === date);
    const checklist = checklists.find(record => String(record.classId) === classId && record.date === date);
    const snapshotInfo = log || checklist?.classInfo || item;
    const id = uuid(workspaceId, 'meeting', key);
    const start = time(snapshotInfo.start || item.start, `meeting ${key} start`);
    const end = time(snapshotInfo.end || item.end, `meeting ${key} end`);
    if (start >= end) throw new Error(`Invalid meeting time for ${key}`);
    meetings.push({ workspace_id: workspaceId, id, group_id: groupIds.get(groupKey(classId)),
      schedule_slot_id: assignment.id, slot_version_id: assignment.versionId,
      original_date: date, actual_date: date, start_time: start, end_time: end,
      group_name: snapshotInfo.className || snapshotInfo.name || item.name,
      subject: snapshotInfo.subject || item.subject, room: snapshotInfo.room || '' });
    if (log) lessons.push({ workspace_id: workspaceId, meeting_id: id, notes: log.notes || '',
      rating: log.rating || null, lesson_type: log.lessonType || 'Lesson', status: log.lessonStatus || 'Done' });
    if (checklist) {
      attendanceChecklists.push({ workspace_id: workspaceId, meeting_id: id });
      const records = checklist.records || studentRecords.filter(record => String(record.classId) === classId && record.date === date);
      unique(records, record => String(record.studentId || ''), `attendance student for ${key}`);
      for (const record of records) {
        const student = studentById.get(String(record.studentId));
        if (!student) throw new Error(`Attendance for ${key} refers to unknown student ${record.studentId}`);
        attendanceEntries.push({ workspace_id: workspaceId, meeting_id: id,
          student_id: uuid(workspaceId, 'student', record.studentId), student_name: record.studentName || student.name,
          attendance: record.attendance, participation: record.attendance === 'absent' ? 0 : Number(record.participation),
          note: record.note || '' });
      }
    }
  }
  return { groups, schedule_slots: slots, schedule_slot_versions: versions, students: mappedStudents,
    enrollments: preservedEnrollments, meetings, lesson_records: lessons,
    attendance_checklists: attendanceChecklists, attendance_entries: attendanceEntries,
    identity_map: {
      group_by_key: Object.fromEntries(groupIds),
      slots_by_class: Object.fromEntries([...descriptorsByClass].map(([id, entries]) => [id, entries.map(entry => entry.id)])),
      student_by_id: Object.fromEntries(students.map(item => [item.id, uuid(workspaceId, 'student', item.id)])),
      meeting_by_class_date: Object.fromEntries([...recordKeys].map(key => [key, uuid(workspaceId, 'meeting', key)])),
      canonical_checklist_revision_by_class_date: Object.fromEntries(checklists.map(item => [`${item.classId}|${item.date}`, item.revision]))
    }, migration_warnings: { historical_slot_fallbacks: historicalSlotFallbacks }
  };
}
