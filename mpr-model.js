"use strict";

const MprModel = (() => {
  const skills = ["Speaking", "Listening", "Reading", "Writing"];
  const categories = ["Regular", "ECA", "Master Class", "Facultative"];
  const roles = [
    "School director",
    "Head teacher",
    "Another local English teacher",
    "Regional education office",
  ];
  const activities = [
    "Make-up lesson",
    "ECA",
    "Master Class",
    "Online CPD",
    "Observation",
    "Testing",
    "Achievement",
    "Challenge",
    "Next step",
  ];
  const profileLabels = {
    email: "Email",
    teacher: "Foreign teacher name",
    teacherId: "Teacher ID",
    nationality: "Nationality",
    joined: "Joining date",
    subject: "Subject taught",
    region: "Region",
    school: "School and district",
    otherTeacher: "Another foreign teacher at school?",
    rotation: "Rotation and session schedule, if shared",
  };
  const unique = (values) => [...new Set(values.filter((value) => value !== "" && value != null))];
  const join = (values) => unique(values).join("\n");
  const total = (values) =>
    Math.round(values.reduce((sum, value) => sum + Number(value || 0), 0) * 100) / 100;
  const missed = (status) => ["Cancelled", "Skipped"].includes(status);
  const recordKey = (id, date) => "lesson|" + id + "|" + date;
  const get = (records, key) => records.find((row) => row.key === key)?.value;
  const gradeFrom = (name) => /^(?:grade\s*)?(1[01]|[1-9])(?=\D|$)/i.exec(String(name).trim())?.[1] || "";
  function groupsFor(data, records, month) {
    const byId = new Map();
    const relevantLogs = data.logs.filter((log) => log.date.startsWith(month));
    const activeInMonth = new Set(relevantLogs.map((log) => log.classId));
    for (const item of data.classes) {
      if (!item.active && !activeInMonth.has(item.id)) continue;
      const group = byId.get(item.id) || { id: item.id, name: item.name, meetings: new Set() };
      for (const session of item.meetings || [item])
        group.meetings.add(session.weekday + "|" + session.start);
      byId.set(item.id, group);
    }
    for (const log of relevantLogs) {
      if (!byId.has(log.classId))
        byId.set(log.classId, { id: log.classId, name: log.className, meetings: new Set() });
    }
    const end = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 0))
      .toISOString()
      .slice(0, 10);
    return [...byId.values()].map((group) => {
      const config = get(records, "group|" + group.id) || {};
      const students = unique(
        data.enrollments
          .filter(
            (e) =>
              e.classId === group.id &&
              (!e.joinedOn || e.joinedOn <= end) &&
              (!e.leftOn || e.leftOn >= month + "-01"),
          )
          .map((e) => e.studentId),
      );
      const hours = config.hours ?? 1;
      return {
        id: group.id,
        name: group.name,
        grade: gradeFrom(group.name),
        category: "Regular",
        hours,
        weekly: total([group.meetings.size * hours]),
        students: students.length,
        teachers: "",
        sharing: "",
        ...config,
      };
    });
  }

  function report(data, records, month, today) {
    const snapshot = get(records, "month|" + month);
    const groups = snapshot?.groups || groupsFor(data, records, month);
    const profile = snapshot?.profile || get(records, "profile") || {};
    const weeklyOverrides = snapshot ? snapshot.weeklyOverrides || {} : get(records, "weeklyLoad") || {};
    const weeklyHours = Object.fromEntries(
      categories.map((category) => [
        category,
        weeklyOverrides[category] ??
          total(groups.filter((g) => g.category === category).map((g) => g.weekly)),
      ]),
    );
    const fields = [],
      gaps = [],
      events = [];
    const source = (key, value) => ({
      key,
      date: value.date,
      label: [value.date, value.group || value.classId || value.kind].filter(Boolean).join(" · "),
    });
    const logs = new Map(data.logs.map((log) => [recordKey(log.classId, log.date), log]));
    const inMonth = records.filter(
      (row) => row.value.date?.startsWith(month) && row.value.date <= today && !row.value.removed,
    );
    for (const { key, value } of inMonth) {
      if (key.startsWith("activity|")) {
        if (value.kind === "Make-up lesson" && !value.originalDate)
          gaps.push({ text: "Make-up on " + value.date + " needs its original date.", key });
        if (!value.confirmed && ["Make-up lesson", "ECA", "Master Class"].includes(value.kind)) {
          gaps.push({ text: "Confirm hours for " + value.kind + " on " + value.date + ".", key });
          continue;
        }
        events.push({ ...value, key });
      } else if (key.startsWith("lesson|") && logs.has(key)) {
        const log = logs.get(key);
        if (missed(log.lessonStatus)) continue;
        const confirmed =
          value.confirmed &&
          value.hours > 0 &&
          !missed(value.status) &&
          (log.lessonStatus !== "Late" || value.status === "Late");
        if (!confirmed) {
          gaps.push({ text: "Confirm actual hours for " + log.className + " on " + log.date + ".", key });
        }
        const attendees =
          value.category === "ECA"
            ? unique(
                data.studentRecords
                  .filter(
                    (r) =>
                      r.classId === log.classId &&
                      r.date === log.date &&
                      ["present", "late"].includes(r.attendance),
                  )
                  .map((r) => r.studentId),
              ).map((id) => {
                const student = data.students.find((s) => s.id === id);
                const home = groups.find((g) => g.id === student?.officialGroupId);
                return {
                  id,
                  name: student?.name || id,
                  grade: home?.grade || gradeFrom(student?.officialGroupId) || value.grade,
                };
              })
            : [];
        events.push({
          ...value,
          confirmed,
          kind: value.category,
          key,
          topic: [log.unit, log.lessonTitle].filter(Boolean).join(" · ") || value.topic,
          group: log.className,
          attendees: value.useRoster ? attendees : value.attendees || [],
        });
      }
    }
    for (const log of data.logs.filter(
      (l) => l.date.startsWith(month) && l.date <= today && !missed(l.lessonStatus),
    )) {
      const key = recordKey(log.classId, log.date);
      if (!get(records, key)) gaps.push({ text: "Review " + log.className + " on " + log.date + ".", key });
    }
    events.sort((a, b) => a.date.localeCompare(b.date));
    const select = (kind) => events.filter((e) => e.kind === kind);
    const normal = events.filter((e) => categories.includes(e.kind) && e.confirmed);
    const makeup = select("Make-up lesson");
    const totals = { normal: total(normal.map((e) => e.hours)), makeup: total(makeup.map((e) => e.hours)) };
    totals.combined = total([totals.normal, totals.makeup]);
    const add = (section, id, label, value, items = []) =>
      fields.push({
        section,
        id,
        label,
        text: String(value ?? ""),
        sources: items.map((e) => source(e.key, e)),
      });
    add("Teacher and school", "month", "Reporting month", month);
    for (const [key, label] of Object.entries(profileLabels).filter(
      ([k]) => !["rotation", "otherTeacher"].includes(k),
    ))
      add("Teacher and school", key, label, profile[key]);
    for (const c of categories) {
      add(
        "Teaching load",
        "teach" + categories.indexOf(c),
        "Teaching " + c.toLowerCase() + " classes?",
        weeklyHours[c] > 0 ? "Yes" : "No",
      );
      add("Teaching load", "weekly" + categories.indexOf(c), c + " hours per normal week", weeklyHours[c]);
    }
    const weeklyTotal = total(Object.values(weeklyHours));
    add("Teaching load", "weekTotal", "Total hours per normal week", weeklyTotal);
    add(
      "Teaching load",
      "weekChoice",
      "Weekly total · form choice",
      weeklyTotal === 28
        ? "Exactly 28 hours"
        : weeklyTotal < 28
          ? "Less than 28 hours"
          : "More than 28 hours",
    );
    add("Teaching load", "actual", "Normal timetable hours actually taught", totals.normal, normal);
    add("Teaching load", "timetable", "Timetable notes", snapshot?.note);
    add("Teaching load", "madeUp", "Did you teach make-up hours?", makeup.length ? "Yes" : "No");
    add("Teaching load", "makeup", "Make-up hours", totals.makeup, makeup);
    add("Teaching load", "reasons", "Reasons for make-up hours", join(makeup.map((e) => e.reason)), makeup);
    add(
      "Teaching load",
      "dates",
      "Make-up dates and lessons",
      join(
        makeup.map(
          (e) =>
            e.date +
            " · " +
            e.group +
            " · " +
            e.hours +
            " h" +
            (e.originalDate ? " for " + e.originalDate : "") +
            " · " +
            (e.reason || ""),
        ),
      ),
      makeup,
    );
    const regular = events.filter(
      (e) => e.kind === "Regular" || (e.kind === "Make-up lesson" && e.category === "Regular"),
    );
    const grades = unique([
      ...groups.filter((g) => g.category === "Regular").map((g) => g.grade),
      ...regular.map((e) => e.grade),
    ]).sort((a, b) => a - b);
    add("Regular classes", "grades", "Grades taught", grades.join(", "));
    for (const grade of grades) {
      const section = "Grade " + grade,
        prefix = "g" + grade + ".";
      const list = groups.filter((g) => g.grade === grade && g.category === "Regular");
      const lessons = regular.filter((e) => e.grade === grade);
      add(section, prefix + "groups", "Classes taught", list.map((g) => g.name).join(", "));
      add(section, prefix + "count", "Number of groups", list.length);
      add(section, prefix + "students", "Students in these groups", total(list.map((g) => g.students)));
      add(section, prefix + "weekly", "Weekly hours you teach", total(list.map((g) => g.weekly)));
      const teachers = unique(
        list.flatMap((g) => (g.teachers || "").split(",").map((s) => s.trim().toLowerCase())),
      );
      add(
        section,
        prefix + "teachers",
        "Number of local co-teachers",
        list.every((g) => g.teachers) ? teachers.length : "",
      );
      add(section, prefix + "sharing", "Group sharing arrangements", join(list.map((g) => g.sharing)));
      for (const skill of skills) {
        const noted = lessons.filter((e) => e.outcomes?.[skill]);
        const id = prefix + skill;
        add(
          section,
          id,
          skill,
          join(noted.map((e) => [e.topic, e.outcomes[skill]].filter(Boolean).join(" — "))),
          noted,
        );
        if (!noted.length && !get(records, "answer|" + month + "|" + id)?.text)
          gaps.push({ text: section + " " + skill.toLowerCase() + " has no outcome.", field: id });
      }
    }
    const evidence = regular.filter(
      (e) =>
        e.evidence ||
        ((e.highlight ?? true) && Object.values(e.outcomes || {}).some((value) => value.trim())),
    );
    add(
      "Regular classes · progress",
      "evidence",
      "Main evidence of student progress",
      join(evidence.map((e) => e.evidence || join(Object.values(e.outcomes || {})))),
      evidence,
    );
    for (const [kind, prefix] of [
      ["ECA", "eca"],
      ["Master Class", "mc"],
    ]) {
      const sessions = events.filter(
        (e) => e.kind === kind || (e.kind === "Make-up lesson" && e.category === kind),
      );
      const people = sessions.flatMap((e) => e.attendees || []);
      if (kind === "ECA") {
        add(kind, "ecaTypes", "Types of ECA", join(sessions.map((e) => e.activityType)), sessions);
        add(
          kind,
          "ecaGrades",
          "Grades attending",
          unique(people.map((p) => p.grade))
            .sort((a, b) => a - b)
            .join(", "),
          sessions,
        );
      }
      add(
        kind,
        prefix + "people",
        "Different " + (kind === "ECA" ? "students" : "local teachers") + " attending",
        unique(people.map((p) => p.id)).length,
        sessions,
      );
      add(kind, prefix + "topics", "Topics covered", join(sessions.map((e) => e.topic)), sessions);
      add(kind, prefix + "impact", "Main outcome or impact", join(sessions.map((e) => e.impact)), sessions);
    }
    add("School arrangements", "otherTeacher", profileLabels.otherTeacher, profile.otherTeacher);
    add("School arrangements", "rotation", profileLabels.rotation, profile.rotation);
    for (const [kind, id, label, prop] of [
      ["Online CPD", "cpdAttended", "Sessions attended", "session"],
      ["Online CPD", "cpdTopics", "Topics covered", "topic"],
      ["Online CPD", "cpdApplied", "How you applied the learning", "application"],
    ]) {
      const selected = select(kind);
      add(kind, id, label, join(selected.map((e) => e[prop])), selected);
    }
    const tests = select("Testing"),
      testMonth = ["02", "05", "11"].includes(month.slice(5));
    add(
      "Testing",
      "testStatus",
      "Term test status",
      tests.at(-1)?.testStatus || (testMonth ? "" : "This is not a test month"),
      tests,
    );
    add("Testing", "testNotes", "Testing progress or issues", join(tests.map((e) => e.detail)), tests);
    for (const [i, role] of roles.entries()) {
      const visits = select("Observation").filter((e) => e.role === role);
      add("Observations", "visits" + i, role + " · number of visits", visits.length, visits);
      add("Observations", "visitDates" + i, role + " · dates", visits.map((e) => e.date).join(", "), visits);
    }
    add(
      "Observations",
      "feedback",
      "Feedback or follow-up",
      join(select("Observation").map((e) => e.detail)),
      select("Observation"),
    );
    for (const [i, type] of ["Professional", "Student"].entries()) {
      const items = select("Achievement").filter((e) => e.achievementType === type && e.proof);
      add(
        "Achievements",
        "achieved" + i,
        type + " verified achievement?",
        items.length ? "Yes" : "No",
        items,
      );
      add(
        "Achievements",
        "achievement" + i,
        type + " achievement and proof",
        join(items.map((e) => [e.date, e.detail, e.proof].join(" · "))),
        items,
      );
    }
    const highlights = select("Achievement");
    add(
      "Achievements",
      "positive",
      "Most significant achievement or positive development",
      join(highlights.map((e) => e.detail)),
      highlights,
    );
    for (const [kind, id, label, prop] of [
      ["Challenge", "challenge", "Main challenge", "detail"],
      ["Challenge", "support", "Support needed", "support"],
      ["Next step", "priority", "Priorities for next month", "detail"],
    ]) {
      const items = select(kind);
      add("Challenges and next steps", id, label, join(items.map((e) => e[prop])), items);
    }
    return { fields, gaps, totals, groups, profile, weeklyOverrides, confirmed: !!snapshot };
  }
  return {
    skills,
    categories,
    roles,
    activities,
    profileLabels,
    unique,
    missed,
    get,
    recordKey,
    gradeFrom,
    groupsFor,
    report,
  };
})();
if (typeof module !== "undefined") module.exports = MprModel;
