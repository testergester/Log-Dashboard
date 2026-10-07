"use strict";
// Pure aggregation shared by the analysis page and its regression checks.
const TeachingAnalysis = (() => {
  const score = record => record.attendance === "absent" ? -1 : Number(record.participation) || 0;
  function summarize(records) {
    const present = records.filter(r => r.attendance === "present").length;
    const absent = records.filter(r => r.attendance === "absent").length;
    return {count: records.length, present, absent, attendance: present + absent ? present / (present + absent) * 100 : null,
      points: records.reduce((sum, r) => sum + score(r), 0), positive: records.filter(r => r.attendance === "present" && Number(r.participation) > 0).length,
      negative: records.filter(r => r.attendance === "present" && Number(r.participation) < 0).length,
      notes: records.filter(r => String(r.note || "").trim()).length};
  }
  function build(data, filters) {
    const groups = new Set(filters.groups);
    const within = r => groups.has(r.classId) && (!filters.start || r.date >= filters.start) && (!filters.end || r.date <= filters.end);
    const identities = new Map();
    (data.archivedStudents || []).forEach(s => (s.ids || [s.id]).concat(s.id).forEach(id => identities.set(id, {...s, archived: true})));
    (data.students || []).forEach(s => identities.set(s.id, s));
    const canonical = id => identities.get(id)?.id || id;
    // Backend exposes the latest saved checklist; deduplicate defensively by meeting/student.
    const unique = new Map();
    (data.studentRecords || []).filter(within).forEach(r => unique.set([r.classId, r.date, r.studentId].join('|'), r));
    const records = [...unique.values()];
    const ids = new Set(records.map(r => canonical(r.studentId)));
    (data.enrollments || []).filter(e => groups.has(e.classId) &&
      (!filters.end || !e.joinedOn || e.joinedOn <= filters.end) &&
      (!filters.start || !e.leftOn || e.leftOn >= filters.start)).forEach(e => ids.add(canonical(e.studentId)));
    const students = [...ids].map(id => {
      const history = records.filter(r => canonical(r.studentId) === id).sort((a,b) => b.date.localeCompare(a.date));
      const identity = identities.get(id);
      return {id, name: identity?.name || history.find(r => r.studentName)?.studentName || "Unknown student · " + id,
        archived: Boolean(identity?.archived), records: history, ...summarize(history)};
    }).sort((a,b) => a.name.localeCompare(b.name));
    const logs = (data.logs || []).filter(within).sort((a,b) => b.date.localeCompare(a.date));
    const days = [...new Set(records.map(r => r.date))].sort().map(date => ({date, ...summarize(records.filter(r => r.date === date))}));
    return {students, records, logs, days, ...summarize(records), meetings: (data.checklists || []).filter(within).length};
  }
  function signal(student) {
    if (!student.count) return {label: "No records", flagged: false};
    const attendance = student.attendance !== null && student.attendance < 80;
    const points = student.points < 0;
    return {label: attendance && points ? "Review attendance & points" : attendance ? "Review attendance" : points ? "Review points" : "No flags", flagged: attendance || points};
  }
  return {score, summarize, build, signal};
})();
if (typeof module !== "undefined") module.exports = TeachingAnalysis;
