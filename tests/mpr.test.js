const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const M = require("../mpr-model.js");

const today = "2026-11-25",
  month = "2026-11";
const classes = [
  { id: "A", name: "9A1", active: true, weekday: 1, start: "09:00" },
  { id: "A", name: "9A1", active: true, weekday: 2, start: "08:00" },
];
const data = {
  classes,
  logs: [],
  enrollments: [
    { classId: "A", studentId: "first", joinedOn: "2026-10-01" },
    { classId: "A", studentId: "future", joinedOn: "2027-01-01" },
  ],
  students: [{ id: "s", name: "One", officialGroupId: "10A" }],
  studentRecords: [],
};
const rows = [];
function lesson(date, fields = {}, status = "Done") {
  const key = M.recordKey("A", date);
  data.logs.push({
    classId: "A",
    className: "9A1",
    date,
    lessonStatus: status,
    unit: "Learning",
    lessonTitle: "School",
  });
  rows.push({
    key,
    value: {
      date,
      classId: "A",
      grade: "9",
      category: "Regular",
      hours: 1,
      status,
      confirmed: true,
      outcomes: { Reading: "Matched a title." },
      highlight: true,
      ...fields,
    },
  });
}
function activity(kind, date, fields) {
  rows.push({ key: "activity|" + randomUUID(), value: { kind, date, ...fields } });
}
const languageOutcomes = { Vocabulary: "Named landmarks.", Grammar: "Used past forms.", Functions: "Asked for directions." };
lesson("2026-11-02", { languageOutcomes });
lesson("2026-11-03", { hours: 0.5 }, "Late");
lesson("2026-11-04", {}, "Cancelled");
lesson("2026-11-05", { confirmed: false });
lesson("2026-11-26");
lesson("2026-10-12");
lesson("2026-11-09", {
  category: "ECA",
  useRoster: true,
  activityType: "Reading Club",
  impact: "Retold a story.",
});
data.studentRecords.push(
  { date: "2026-11-09", classId: "A", studentId: "s", attendance: "late" },
  { date: "2026-11-09", classId: "A", studentId: "x", attendance: "absent" },
);
activity("Make-up lesson", "2026-11-02", {
  hours: 1,
  confirmed: true,
  category: "Regular",
  group: "9A1",
  grade: "9",
  reason: "Tests",
  outcomes: { Speaking: "Gave directions." },
});
activity("Make-up lesson", "2026-11-26", { hours: 4, confirmed: false });
activity("ECA", "2026-11-18", {
  hours: 1,
  confirmed: true,
  activityType: "Speaking Club",
  attendees: [
    { id: "s", grade: "10" },
    { id: "s2", grade: "9" },
  ],
});
for (const date of ["2026-11-03", "2026-11-10"])
  activity("Master Class", date, {
    hours: 1,
    confirmed: true,
    attendees: [{ id: "t", name: "Teacher" }],
    topic: "Group work",
  });
activity("Observation", "2026-11-12", { role: "Head teacher", detail: "Follow up next week." });
activity("Online CPD", "2026-11-13", {
  session: "Orientation",
  topic: "Diagnostics",
  application: "Used the mark sheet.",
});
activity("Testing", "2026-11-17", { testStatus: "In progress" });
activity("Testing", "2026-11-19", { testStatus: "Administered · results submitted" });
activity("Achievement", "2026-11-18", {
  achievementType: "Student",
  detail: "Won the contest",
  proof: "Result sheet",
});
activity("Next step", "2026-11-20", { detail: "Practise pair work." });
rows.push({ key: "weeklyLoad", value: { ECA: 6, "Master Class": 2 } });
const report = () => M.report(data, rows, month, today);
let r = report();
const field = (id) => r.fields.find((f) => f.id === id).text;
assert.deepEqual(r.totals, { normal: 5.5, makeup: 1, combined: 6.5 });
assert.equal(field("weekly1"), "6");
assert.equal(field("weekly2"), "2");
assert.equal(field("weekTotal"), "10");
assert.equal(field("g9.students"), "1");
assert.equal(field("g9.weekly"), "2");
assert.equal(field("ecapeople"), "2");
assert.equal(field("ecaGrades"), "9, 10");
assert.equal(field("mcpeople"), "1");
assert.equal(field("visitDates1"), "2026-11-12");
assert.equal(field("visits1"), "1");
assert.equal(field("cpdApplied"), "Used the mark sheet.");
assert.match(field("testStatus"), /submitted/);
assert.match(field("achievement1"), /Result sheet/);
assert.match(field("priority"), /pair work/);
for (const [name, text] of Object.entries(languageOutcomes)) {
  assert.ok(field("g9." + name).includes(text));
  assert.ok(field("evidence").includes(text));
}
assert.match(field("g9.Speaking"), /directions/);
assert.match(field("g9.Reading"), /Learning · School/);
assert.ok(r.gaps.some((g) => g.text.includes("original date")));
assert.ok(r.gaps.some((g) => g.text.includes("Confirm actual hours")));
assert.ok(r.gaps.some((g) => g.field === "g9.Writing"));
rows.push({ key: "answer|2026-11|g9.Writing", value: { text: "Used time markers.", source: "" } });
assert.ok(!report().gaps.some((g) => g.field === "g9.Writing"));
rows.push({
  key: "month|" + month,
  value: { profile: { school: "Test school" }, groups: r.groups.map((g) => ({ ...g, students: 12 })) },
});
data.enrollments.length = 0;
r = report();
assert.equal(field("g9.students"), "12");
assert.equal(field("school"), "Test school");
assert.equal(M.report(data, rows, "2026-12", today).confirmed, false);
data.logs = data.logs.filter((l) => l.date !== "2026-11-02");
assert.equal(report().totals.normal, 4.5);
assert.equal(report().totals.makeup, 1, "archiving a regular lesson keeps its separate make-up");

// Execute the actual Apps Script setup and storage functions against an isolated sheet fixture.
let sheet,
  locked = false;
const spreadsheet = {
  getSheetByName: (name) => (name === "MprRecords" ? sheet : null),
  insertSheet(name) {
    assert.equal(name, "MprRecords");
    sheet = {
      rows: [],
      getLastRow() {
        return this.rows.length;
      },
      getLastColumn() {
        return 3;
      },
      getMaxRows() {
        return 100;
      },
      appendRow(row) {
        this.rows.push(row);
      },
      setFrozenRows() {},
      getRange(row, col, n = 1, width = 1) {
        return {
          getDisplayValues() {
            return Array.from({ length: n }, (_, i) =>
              Array.from({ length: width }, (_, j) => sheet.rows[row + i - 1]?.[col + j - 1] || ""),
            );
          },
          setValues(values) {
            for (let i = 0; i < values.length; i++) {
              sheet.rows[row + i - 1] ||= [];
              sheet.rows[row + i - 1].splice(col - 1, width, ...values[i]);
            }
            return this;
          },
          setFontWeight() {
            return this;
          },
          setBackground() {
            return this;
          },
          setNumberFormat() {
            return this;
          },
        };
      },
    };
    return sheet;
  },
};
const ctx = vm.createContext({
  SpreadsheetApp: { openById: () => spreadsheet, flush() {} },
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => "fixture" }) },
  DASHBOARD: { timezone: "Asia/Tashkent" },
  Utilities: { getUuid: randomUUID, formatDate: () => today },
  LockService: {
    getScriptLock: () => ({
      waitLock() {
        assert.equal(locked, false);
        locked = true;
      },
      releaseLock() {
        locked = false;
      },
    }),
  },
});
for (const f of ["Validation", "Sheets", "Mpr"])
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../AppsScript", f + ".gs"), "utf8"), ctx);
ctx.setupMpr();
ctx.setupMpr();
assert.equal(sheet.rows.length, 1);
const record = {
  key: M.recordKey("A", today),
  value: { classId: "A", date: today, category: "Regular", hours: 1, confirmed: true, languageOutcomes },
};
let saved = ctx.saveMpr_({ record });
assert.ok(saved.revision);
assert.equal(ctx.saveMpr_({ record }).revision, saved.revision);
assert.throws(
  () => ctx.saveMpr_({ record: { ...record, value: { ...record.value, hours: 2 } } }),
  /another device/,
);
assert.equal(sheet.rows.length, 2);
assert.equal(locked, false);
saved = ctx.saveMpr_({ record: { ...saved, value: { ...saved.value, hours: 0.5 } } });
assert.equal(ctx.loadMpr_(sheet)[0].value.hours, 0.5);
assert.deepEqual({ ...ctx.loadMpr_(sheet)[0].value.languageOutcomes }, languageOutcomes);
assert.throws(() => ctx.saveMpr_({ record: { ...saved, value: { ...saved.value, hours: -1 } } }), /hours/);
assert.throws(
  () =>
    ctx.saveMpr_({ record: { key: "lesson|A|2026-11-26", value: { ...saved.value, date: "2026-11-26" } } }),
  /after/,
);
console.log("MPR report, monthly snapshots, attendance deduplication and Apps Script sheet fixture passed.");

for (const file of ["AppsScript", "DashboardData"]) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../AppsScript", file + ".gs"), "utf8"), ctx);
}
const emptySheet = { getLastRow: () => 1, getLastColumn: () => 3 };
spreadsheet.getSheetByName = (name) => (name === "MprRecords" ? sheet : emptySheet);
ctx.requireSession_ = (req) => {
  if (req.token !== "valid") throw Error("Session expired.");
};
ctx.response_ = (value) => value;
const post = (request) => ctx.doPost({ postData: { contents: JSON.stringify(request) } });
assert.equal(post({ action: "saveMpr", record }).ok, false);
assert.equal(post({ action: "load", token: "valid" }).data.mprRecords, null);
assert.equal(post({ action: "load", token: "valid", includeMpr: true }).data.mprRecords[0].value.hours, 0.5);
assert.equal(
  post({ action: "saveMpr", token: "valid", record: { key: "weeklyLoad", value: { ECA: 6 } } }).ok,
  true,
);
sheet.appendRow(["bad", "revision", "broken JSON"]);
const damaged = post({ action: "load", token: "valid", includeMpr: true });
assert.equal(damaged.ok, true);
assert.equal(damaged.data.mprRecords, null);
assert.match(damaged.data.mprError, /MprRecords/);
