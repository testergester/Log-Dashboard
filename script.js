"use strict";

// Paste your deployed /exec URL here to preconfigure the site. The Settings
// button also lets you enter it in the browser without editing this file.
const CONFIGURED_ENDPOINT = "https://script.google.com/macros/s/AKfycbzzpBeitHNCriLtUU68x_CiFw8pAJ_iWopODGpuhBEnyEnoDyfvVcpbhrnWoOWr-CKD/exec";
const ENDPOINT_STORAGE_KEY = "teaching-dashboard-endpoint";
const TZ = "Asia/Tashkent";
const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const $ = (selector) => document.querySelector(selector);
const state = {
  endpoint: CONFIGURED_ENDPOINT || localStorage.getItem(ENDPOINT_STORAGE_KEY) || "",
  token: "",
  classes: [],
  logs: [],
  students: [],
  enrollments: [],
  checklists: [],
  studentRecords: [],
  studentsReady: false,
  selectedDate: todayInTashkent(),
  selectedClassId: "",
  selectedStudentId: "",
  view: "day",
  drafts: new Map(),
  checklistDrafts: new Map(),
  pending: false
};

function todayInTashkent() {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(new Date());
  const value = name => parts.find(part => part.type === name).value;
  return value("year") + "-" + value("month") + "-" + value("day");
}

function dateAtUTC(date) {
  return new Date(date + "T12:00:00Z");
}

function addDays(date, count) {
  const value = dateAtUTC(date);
  value.setUTCDate(value.getUTCDate() + count);
  return value.toISOString().slice(0, 10);
}

function weekday(date) {
  return (dateAtUTC(date).getUTCDay() + 6) % 7 + 1;
}

function mondayOf(date) {
  return addDays(date, 1 - weekday(date));
}

function formatDate(date, options) {
  return new Intl.DateTimeFormat("en", {timeZone: "UTC", ...options}).format(dateAtUTC(date));
}

function timeNowInTashkent() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  }).formatToParts(new Date());
  return Number(parts.find(part => part.type === "hour").value) * 60 +
    Number(parts.find(part => part.type === "minute").value);
}

function minutes(time) {
  const [hour, minute] = String(time).split(":").map(Number);
  return hour * 60 + minute;
}

function validEndpoint(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "script.google.com" &&
      /^\/macros\/s\/[^/]+\/exec$/.test(url.pathname) && !url.search && !url.hash;
  } catch {
    return false;
  }
}

function setNotice(message, error = false) {
  const notice = $("#global-notice");
  notice.textContent = message;
  notice.classList.toggle("error", error);
  notice.hidden = !message;
}

function setAccessError(message) {
  const error = $("#access-error");
  error.textContent = message;
  error.hidden = !message;
}

function updateAccess() {
  const connected = Boolean(state.endpoint);
  const signedIn = Boolean(state.token);
  $("#access-panel").hidden = signedIn;
  $("#workspace").hidden = !signedIn;
  $("#endpoint-form").hidden = connected;
  $("#login-form").hidden = !connected || signedIn;
  $("#sign-out-button").hidden = !signedIn;
  $("#add-class-button").disabled = !signedIn;
  $("#connection-state").textContent = signedIn ? "Connected" : connected ? "Sign in required" : "Not connected";
  $("#access-title").textContent = connected ? "Welcome back" : "Connect your teaching records";
  $("#access-description").textContent = connected
    ? "Sign in to see your timetable and keep your lesson records."
    : "Add the web app URL from your Apps Script deployment. It stays on this device.";
}

async function request(action, fields = {}) {
  if (!state.endpoint) throw new Error("Add your Apps Script URL first.");
  const requestId = crypto.randomUUID();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  let response;
  try {
    response = await fetch(state.endpoint, {
      method: "POST",
      headers: {"Content-Type": "text/plain;charset=utf-8"},
      body: JSON.stringify({action, ...fields, requestId}),
      redirect: "follow",
      cache: "no-store",
      signal: controller.signal
    });
  } catch (error) {
    throw new Error(error.name === "AbortError"
      ? "The request timed out. Try again."
      : "Could not reach Apps Script. Check the web app URL and deployment access.");
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok || response.type === "opaque") {
    throw new Error("Apps Script returned an unreadable response. Check the web app deployment.");
  }
  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error("Apps Script did not return JSON. Check the web app URL and deployment.");
  }
  if (result.requestId !== requestId) throw new Error("Apps Script returned a mismatched response.");
  if (!result.ok) throw new Error(result.error || "The request failed.");
  return result.data;
}

function isSessionError(error) {
  return /session expired/i.test(error.message);
}

function handleError(error, target = "global") {
  if (isSessionError(error)) {
    state.token = "";
    state.classes = [];
    state.logs = [];
    state.students = [];
    state.enrollments = [];
    state.checklists = [];
    state.studentRecords = [];
    state.studentsReady = false;
    updateAccess();
    setAccessError("Your session expired. Please sign in again.");
    return;
  }
  if (target === "access") setAccessError(error.message);
  else setNotice(error.message, true);
}

async function loadData() {
  const data = await request("load", {token: state.token});
  if (!Array.isArray(data.classes) || !Array.isArray(data.logs)) throw new Error("The spreadsheet returned unexpected data.");
  const studentKeys = ["students", "enrollments", "checklists", "studentRecords"];
  const hasStudentData = studentKeys.every(key => Array.isArray(data[key]));
  if (!hasStudentData && studentKeys.some(key => data[key] !== undefined)) {
    throw new Error("Student records are incomplete. Run setupDashboard and redeploy Apps Script.");
  }
  state.classes = data.classes;
  state.logs = data.logs;
  state.students = hasStudentData ? data.students : [];
  state.enrollments = hasStudentData ? data.enrollments : [];
  state.checklists = hasStudentData ? data.checklists : [];
  state.studentRecords = hasStudentData ? data.studentRecords : [];
  state.studentsReady = hasStudentData;
  render();
}

function activeClassesOn(date) {
  const day = weekday(date);
  return state.classes.filter(item => item.active && Number(item.weekday) === day);
}

function lessonsOn(date) {
  const active = activeClassesOn(date).map(item => {
    const log = logFor(item.id, date);
    return log
      ? {...item, name: log.className || item.name, subject: log.subject || item.subject,
          start: log.start || item.start, end: log.end || item.end,
          room: log.room || "", date, archived: false}
      : {...item, date, archived: false};
  });
  const activeIds = new Set(active.map(item => item.id));
  const historicalIds = new Set([
    ...state.logs.filter(log => log.date === date).map(log => log.classId),
    ...state.checklists.filter(item => item.date === date).map(item => item.classId)
  ]);
  const historical = [...historicalIds].filter(id => !activeIds.has(id)).map(id => {
    const log = logFor(id, date);
    const original = state.classes.find(item => item.id === id);
    return {
      id, name: log?.className || original?.name || "Class",
      subject: log?.subject || original?.subject || "",
      start: log?.start || original?.start || "00:00",
      end: log?.end || original?.end || "00:00",
      room: log?.room || original?.room || "", date, archived: true
    };
  });
  return [...active, ...historical].sort((a, b) =>
    String(a.start).localeCompare(String(b.start)) || String(a.name).localeCompare(String(b.name)));
}

function logFor(id, date) {
  return state.logs.find(log => log.classId === id && log.date === date);
}

function statusFor(item, date) {
  if (logFor(item.id, date)) return ["Logged", "logged"];
  if (state.checklists.some(value => value.classId === item.id && value.date === date)) return ["Checklist saved", "logged"];
  if (date !== todayInTashkent()) return [item.archived ? "Archived" : "Scheduled", ""];
  const now = timeNowInTashkent();
  if (now >= minutes(item.start) && now < minutes(item.end)) return ["In progress", "current"];
  if (now < minutes(item.start)) {
    const upcoming = lessonsOn(date).filter(value => !value.archived && minutes(value.start) > now);
    if (upcoming[0] && upcoming[0].id === item.id) return ["Up next", "next"];
  }
  return [item.archived ? "Archived" : now >= minutes(item.end) ? "Finished" : "Scheduled", ""];
}

function classCard(item, date) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "schedule-card";
  const selected = state.selectedClassId === item.id && state.selectedDate === date;
  button.classList.toggle("is-selected", selected);
  button.setAttribute("aria-pressed", String(selected));
  const time = document.createElement("span");
  time.className = "schedule-time";
  time.textContent = item.start;
  const end = document.createElement("small");
  end.textContent = item.end;
  time.append(end);
  const main = document.createElement("span");
  main.className = "schedule-main";
  const name = document.createElement("strong");
  name.textContent = item.name;
  const detail = document.createElement("span");
  detail.textContent = [item.subject, item.room && "Room " + item.room].filter(Boolean).join(" · ");
  main.append(name, detail);
  const [label, className] = statusFor(item, date);
  const status = document.createElement("span");
  status.className = "status-pill " + className;
  status.textContent = label;
  button.append(time, main, status);
  button.addEventListener("click", () => {
    saveDraft();
    saveChecklistDraft();
    state.selectedDate = date;
    state.selectedClassId = item.id;
    render();
    if (window.innerWidth < 900) $("#lesson-title").scrollIntoView({behavior: "smooth", block: "start"});
  });
  return button;
}

function renderWeekStrip() {
  const strip = $("#week-strip");
  strip.replaceChildren();
  const monday = mondayOf(state.selectedDate);
  for (let offset = 0; offset < 7; offset++) {
    const date = addDays(monday, offset);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "week-day";
    if (date === state.selectedDate) button.setAttribute("aria-current", "date");
    const name = document.createElement("span");
    name.className = "day-name";
    name.textContent = WEEKDAYS[offset].slice(0, 3);
    const number = document.createElement("span");
    number.className = "day-number";
    number.textContent = dateAtUTC(date).getUTCDate();
    const count = document.createElement("span");
    count.className = "day-count";
    const total = lessonsOn(date).length;
    count.textContent = total + (total === 1 ? " class" : " classes");
    button.append(name, number, count);
    button.addEventListener("click", () => changeDate(date));
    strip.append(button);
  }
}

function renderSchedule() {
  const list = $("#schedule-list");
  list.replaceChildren();
  list.classList.toggle("week-list", state.view === "week");
  const dayView = state.view === "day";
  $("#schedule-kicker").textContent = dayView ? "DAILY TIMETABLE" : "WEEKLY TIMETABLE";
  $("#schedule-title").textContent = dayView ? "Your classes" : "Your week";
  const dates = dayView
    ? [state.selectedDate]
    : Array.from({length: 7}, (_, index) => addDays(mondayOf(state.selectedDate), index));
  const total = dates.reduce((sum, date) => sum + lessonsOn(date).length, 0);
  $("#class-count").textContent = total + (total === 1 ? " class" : " classes");
  if (!total) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    const title = document.createElement("strong");
    title.textContent = "No classes scheduled";
    const detail = document.createElement("p");
    detail.textContent = "Add a weekly class to see it here.";
    empty.append(title, detail);
    list.append(empty);
    return;
  }
  if (dayView) {
    lessonsOn(state.selectedDate).forEach(item => list.append(classCard(item, state.selectedDate)));
  } else {
    dates.forEach(date => {
      const items = lessonsOn(date);
      const section = document.createElement("div");
      section.className = "week-section";
      const heading = document.createElement("div");
      heading.className = "week-section-heading";
      const label = document.createElement("strong");
      label.textContent = formatDate(date, {weekday: "long", month: "short", day: "numeric"});
      const count = document.createElement("span");
      count.textContent = items.length ? items.length + (items.length === 1 ? " class" : " classes") : "Free day";
      heading.append(label, count);
      section.append(heading);
      items.forEach(item => section.append(classCard(item, date)));
      list.append(section);
    });
  }
}

function draftKey() {
  return state.selectedClassId + "|" + state.selectedDate;
}

function saveDraft() {
  if (!state.selectedClassId || $("#lesson-form").hidden) return;
  const notes = $("#lesson-notes").value;
  const rating = document.querySelector('input[name="rating"]:checked')?.value || "";
  const saved = logFor(state.selectedClassId, state.selectedDate);
  if (notes !== (saved?.notes || "") || rating !== String(saved?.rating || "")) {
    state.drafts.set(draftKey(), {notes, rating});
  } else {
    state.drafts.delete(draftKey());
  }
}

function renderLesson() {
  const item = lessonsOn(state.selectedDate).find(value => value.id === state.selectedClassId);
  $("#lesson-empty").hidden = Boolean(item);
  $("#lesson-form").hidden = !item;
  $("#edit-class-button").hidden = !item || item.archived;
  if (!item) {
    $("#lesson-title").textContent = "Select a class";
    return;
  }
  const saved = logFor(item.id, state.selectedDate);
  const draft = state.drafts.get(draftKey());
  $("#lesson-title").textContent = formatDate(state.selectedDate, {weekday: "long", month: "short", day: "numeric"});
  $("#lesson-class-name").textContent = item.name;
  $("#lesson-class-detail").textContent = [item.subject, item.start + "–" + item.end, item.room && "Room " + item.room].filter(Boolean).join(" · ");
  $("#lesson-notes").value = draft ? draft.notes : saved?.notes || "";
  document.querySelectorAll('input[name="rating"]').forEach(input => {
    input.checked = input.value === String(draft ? draft.rating : saved?.rating || "");
  });
  $("#lesson-status").classList.remove("error");
  $("#lesson-status").textContent = draft ? "Unsaved changes" : saved ? "Saved " + (saved.updatedAt || "") : "Not saved yet";
  $("#save-lesson-button").disabled = Boolean(item.archived && !saved);
}

function selectedLesson() {
  return lessonsOn(state.selectedDate).find(item => item.id === state.selectedClassId);
}

function checklistKey() {
  return state.selectedClassId + "|" + state.selectedDate;
}

function savedChecklist() {
  return state.checklists.find(item => item.classId === state.selectedClassId && item.date === state.selectedDate);
}

function savedStudentRows() {
  return state.studentRecords.filter(item => item.classId === state.selectedClassId && item.date === state.selectedDate);
}

function checklistRows() {
  const saved = savedChecklist();
  const base = saved ? savedStudentRows() : state.enrollments
    .filter(item => item.classId === state.selectedClassId &&
      (!item.joinedOn || item.joinedOn <= state.selectedDate) &&
      (!item.leftOn || state.selectedDate < item.leftOn))
    .map(item => ({studentId: item.studentId, attendance: "present", participation: 0, note: ""}));
  const draft = state.checklistDrafts.get(checklistKey());
  return base.map(item => ({...item, ...(draft?.find(value => value.studentId === item.studentId) || {})}))
    .sort((a, b) => studentName(a.studentId).localeCompare(studentName(b.studentId)));
}

function studentName(id) {
  return state.students.find(item => item.id === id)?.name || "Unknown student";
}

function markScore(item) {
  return item.attendance === "absent" ? -1 : Number(item.participation);
}

function markReason(item) {
  if (item.attendance === "absent") return "Absent −1";
  if (Number(item.participation) === 1) return "Participation +1";
  if (Number(item.participation) === -1) return "Noise −1";
  return "Present 0";
}

function pointLabel(value) {
  return value + (Math.abs(value) === 1 ? " point" : " points");
}

function readChecklistForm() {
  return [...$("#student-list").querySelectorAll(".student-row")].map(row => ({
    studentId: row.dataset.studentId,
    attendance: row.querySelector(".attendance-select").value,
    participation: Number(row.querySelector(".participation-select").value),
    note: row.querySelector(".student-note").value
  }));
}

function saveChecklistDraft() {
  if (!state.selectedClassId || $("#student-panel").hidden) return;
  const rows = readChecklistForm();
  const saved = savedChecklist() ? savedStudentRows() : rows.map(item =>
    ({studentId: item.studentId, attendance: "present", participation: 0, note: ""}));
  const same = rows.length === saved.length && rows.every(item => {
    const previous = saved.find(value => value.studentId === item.studentId);
    return previous && item.attendance === previous.attendance &&
      item.participation === Number(previous.participation) && item.note === (previous.note || "");
  });
  if (same) state.checklistDrafts.delete(checklistKey());
  else state.checklistDrafts.set(checklistKey(), rows);
  $("#checklist-status").textContent = same
    ? savedChecklist() ? "Saved " + savedChecklist().updatedAt : "Not saved yet"
    : "Unsaved changes";
  $("#checklist-status").classList.remove("error");
}

function renderStudents() {
  const lesson = selectedLesson();
  $("#student-panel").hidden = !lesson;
  if (!lesson) return;
  $("#checklist-form").hidden = !state.studentsReady;
  $("#add-student-button").hidden = !state.studentsReady || lesson.archived;
  if (!state.studentsReady) {
    $("#checklist-summary").textContent = "Student records need the updated Apps Script. Run setupDashboard and deploy its new version.";
    return;
  }
  const saved = savedChecklist();
  const rows = checklistRows();
  const list = $("#student-list");
  list.replaceChildren();
  $("#checklist-summary").textContent = saved
    ? "Saved roster for this class meeting."
    : "Everyone starts present. Save to count attendance and points.";
  if (!rows.length) {
    const empty = document.createElement("p");
    empty.className = "student-empty";
    empty.textContent = lesson.archived ? "No saved student checklist for this class." : "Add a student to start the checklist.";
    list.append(empty);
  }
  rows.forEach(item => {
    const row = document.createElement("div");
    row.className = "student-row";
    row.dataset.studentId = item.studentId;
    const heading = document.createElement("div");
    heading.className = "student-row-heading";
    const history = document.createElement("button");
    history.type = "button";
    history.className = "student-name-button";
    history.textContent = studentName(item.studentId);
    history.setAttribute("aria-label", "View history for " + studentName(item.studentId));
    history.addEventListener("click", () => openStudentHistory(item.studentId));
    const score = document.createElement("span");
    score.className = "student-score";
    score.textContent = markReason(item);
    heading.append(history, score);
    const controls = document.createElement("div");
    controls.className = "student-controls";
    const attendanceLabel = document.createElement("label");
    attendanceLabel.textContent = "Attendance";
    const attendance = document.createElement("select");
    attendance.className = "attendance-select";
    [["present", "Present"], ["absent", "Absent"]].forEach(([value, label]) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      attendance.append(option);
    });
    attendance.value = item.attendance;
    attendanceLabel.append(attendance);
    const participationLabel = document.createElement("label");
    participationLabel.textContent = "Participation";
    const participation = document.createElement("select");
    participation.className = "participation-select";
    [["0", "No change · 0"], ["1", "Participated · +1"], ["-1", "Noise · −1"]].forEach(([value, label]) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      participation.append(option);
    });
    participation.value = String(item.participation);
    participation.disabled = item.attendance === "absent";
    participationLabel.append(participation);
    controls.append(attendanceLabel, participationLabel);
    const noteLabel = document.createElement("label");
    noteLabel.textContent = "Student note";
    const note = document.createElement("textarea");
    note.className = "student-note";
    note.rows = 2;
    note.maxLength = 300;
    note.placeholder = "Something to remember from this class…";
    note.value = item.note || "";
    noteLabel.append(note);
    attendance.addEventListener("change", () => {
      if (attendance.value === "absent") participation.value = "0";
      participation.disabled = attendance.value === "absent";
      score.textContent = markReason({attendance: attendance.value, participation: participation.value});
      saveChecklistDraft();
    });
    participation.addEventListener("change", () => {
      score.textContent = markReason({attendance: attendance.value, participation: participation.value});
      saveChecklistDraft();
    });
    note.addEventListener("input", saveChecklistDraft);
    row.append(heading, controls, noteLabel);
    list.append(row);
  });
  $("#save-checklist-button").hidden = lesson.archived && !saved;
  $("#save-checklist-button").disabled = !rows.length;
  $("#checklist-status").classList.remove("error");
  $("#checklist-status").textContent = state.checklistDrafts.has(checklistKey())
    ? "Unsaved changes" : saved ? "Saved " + saved.updatedAt : "Not saved yet";
}

function openStudentHistory(studentId) {
  saveChecklistDraft();
  state.selectedStudentId = studentId;
  const student = state.students.find(item => item.id === studentId);
  if (!student) return;
  $("#history-title").textContent = student.name + " · history";
  $("#rename-student-name").value = student.name;
  $("#history-error").hidden = true;
  const records = state.studentRecords.filter(item => item.studentId === studentId)
    .sort((a, b) => b.date.localeCompare(a.date));
  const currentTotal = records.filter(item => item.classId === state.selectedClassId)
    .reduce((sum, item) => sum + markScore(item), 0);
  const overallTotal = records.reduce((sum, item) => sum + markScore(item), 0);
  $("#student-totals").textContent = "This class: " + pointLabel(currentTotal) +
    " · Overall: " + pointLabel(overallTotal);
  const list = $("#student-history");
  list.replaceChildren();
  if (!records.length) {
    const empty = document.createElement("p");
    empty.textContent = "No saved class meetings yet.";
    list.append(empty);
  }
  records.forEach(item => {
    const entry = document.createElement("div");
    entry.className = "history-entry";
    const title = document.createElement("strong");
    const className = state.classes.find(value => value.id === item.classId)?.name || "Class";
    title.textContent = formatDate(item.date, {month: "short", day: "numeric", year: "numeric"}) + " · " + className;
    const reason = document.createElement("span");
    reason.textContent = markReason(item);
    entry.append(title, reason);
    if (item.note) {
      const note = document.createElement("p");
      note.textContent = item.note;
      entry.append(note);
    }
    list.append(entry);
  });
  const enrollment = state.enrollments.find(item => item.classId === state.selectedClassId && item.studentId === studentId);
  $("#remove-student-button").hidden = !enrollment?.active || Boolean(selectedLesson()?.archived);
  $("#history-dialog").showModal();
}

function render() {
  $("#chosen-date").textContent = formatDate(state.selectedDate, {weekday: "long", month: "long", day: "numeric", year: "numeric"});
  $("#page-title").textContent = state.view === "day"
    ? state.selectedDate === todayInTashkent() ? "Today’s classes" : "Daily timetable"
    : "Your teaching week";
  $("#day-view-button").setAttribute("aria-pressed", String(state.view === "day"));
  $("#week-view-button").setAttribute("aria-pressed", String(state.view === "week"));
  renderWeekStrip();
  renderSchedule();
  renderLesson();
  renderStudents();
}

function changeDate(date) {
  saveDraft();
  saveChecklistDraft();
  state.selectedDate = date;
  if (!lessonsOn(date).some(item => item.id === state.selectedClassId)) state.selectedClassId = "";
  render();
}

function openClassDialog(item) {
  $("#class-form").reset();
  $("#class-error").hidden = true;
  $("#class-id").value = item?.id || "";
  $("#class-dialog-title").textContent = item ? "Edit class" : "Add class";
  $("#archive-class-button").hidden = !item;
  if (item) {
    $("#class-name").value = item.name;
    $("#class-subject").value = item.subject;
    $("#class-weekday").value = String(item.weekday);
    $("#class-start").value = item.start;
    $("#class-end").value = item.end;
    $("#class-room").value = item.room || "";
  } else {
    $("#class-weekday").value = String(weekday(state.selectedDate));
  }
  $("#class-dialog").showModal();
  $("#class-name").focus();
}

async function refreshAfterWrite(message) {
  try {
    await loadData();
    setNotice(message);
  } catch (error) {
    if (isSessionError(error)) handleError(error);
    else setNotice(message + " Refresh failed; try signing in again if the timetable looks out of date.", true);
  }
}

$("#endpoint-form").addEventListener("submit", event => {
  event.preventDefault();
  const endpoint = $("#endpoint-input").value.trim();
  if (!validEndpoint(endpoint)) {
    setAccessError("Enter the deployed Apps Script URL ending in /exec.");
    return;
  }
  state.endpoint = endpoint;
  localStorage.setItem(ENDPOINT_STORAGE_KEY, endpoint);
  setAccessError("");
  updateAccess();
  $("#username-input").focus();
});

$("#settings-button").addEventListener("click", () => {
  if (state.token) {
    setNotice("Sign out before changing the Apps Script connection.");
    return;
  }
  state.endpoint = "";
  localStorage.removeItem(ENDPOINT_STORAGE_KEY);
  $("#endpoint-input").value = "";
  setAccessError("");
  updateAccess();
  $("#endpoint-input").focus();
});

$("#login-form").addEventListener("submit", async event => {
  event.preventDefault();
  if (state.pending) return;
  state.pending = true;
  $("#login-button").disabled = true;
  $("#login-button").textContent = "Signing in…";
  setAccessError("");
  try {
    const response = await request("login", {
      username: $("#username-input").value.trim(),
      password: $("#password-input").value
    });
    if (!response.token) throw new Error("The login response did not include a session.");
    state.token = response.token;
    $("#password-input").value = "";
    await loadData();
    updateAccess();
    setNotice("");
  } catch (error) {
    state.token = "";
    handleError(error, "access");
  } finally {
    state.pending = false;
    $("#login-button").disabled = false;
    $("#login-button").textContent = "Sign in";
  }
});

$("#sign-out-button").addEventListener("click", () => {
  const token = state.token;
  state.token = "";
  state.classes = [];
  state.logs = [];
  state.students = [];
  state.enrollments = [];
  state.checklists = [];
  state.studentRecords = [];
  state.studentsReady = false;
  state.selectedClassId = "";
  state.selectedStudentId = "";
  state.drafts.clear();
  state.checklistDrafts.clear();
  updateAccess();
  setNotice("");
  request("logout", {token}).catch(() => {});
});

$("#previous-date").addEventListener("click", () => changeDate(addDays(state.selectedDate, state.view === "week" ? -7 : -1)));
$("#next-date").addEventListener("click", () => changeDate(addDays(state.selectedDate, state.view === "week" ? 7 : 1)));
$("#today-button").addEventListener("click", () => changeDate(todayInTashkent()));
$("#day-view-button").addEventListener("click", () => { saveDraft(); saveChecklistDraft(); state.view = "day"; render(); });
$("#week-view-button").addEventListener("click", () => { saveDraft(); saveChecklistDraft(); state.view = "week"; render(); });
$("#add-class-button").addEventListener("click", () => openClassDialog(null));
$("#edit-class-button").addEventListener("click", () => {
  const item = state.classes.find(value => value.id === state.selectedClassId && value.active);
  if (item) openClassDialog(item);
});
$("#close-dialog").addEventListener("click", () => $("#class-dialog").close());
$("#cancel-class-button").addEventListener("click", () => $("#class-dialog").close());
$("#class-dialog").addEventListener("click", event => {
  if (event.target === $("#class-dialog")) $("#class-dialog").close();
});

$("#class-form").addEventListener("submit", async event => {
  event.preventDefault();
  if (state.pending) return;
  const item = {
    id: $("#class-id").value || undefined,
    name: $("#class-name").value.trim(),
    subject: $("#class-subject").value.trim(),
    weekday: Number($("#class-weekday").value),
    start: $("#class-start").value,
    end: $("#class-end").value,
    room: $("#class-room").value.trim()
  };
  if (item.start >= item.end) {
    $("#class-error").textContent = "End time must be after start time.";
    $("#class-error").hidden = false;
    return;
  }
  state.pending = true;
  $("#save-class-button").disabled = true;
  $("#save-class-button").textContent = "Saving…";
  $("#class-error").hidden = true;
  try {
    const saved = await request("saveClass", {token: state.token, class: item});
    $("#class-dialog").close();
    state.selectedClassId = saved.id;
    if (Number(item.weekday) !== weekday(state.selectedDate)) {
      state.selectedDate = addDays(mondayOf(state.selectedDate), Number(item.weekday) - 1);
    }
    await refreshAfterWrite("Class saved.");
  } catch (error) {
    if (isSessionError(error)) {
      $("#class-dialog").close();
      handleError(error);
    } else {
      $("#class-error").textContent = error.message;
      $("#class-error").hidden = false;
    }
  } finally {
    state.pending = false;
    $("#save-class-button").disabled = false;
    $("#save-class-button").textContent = "Save class";
  }
});

$("#archive-class-button").addEventListener("click", async () => {
  const id = $("#class-id").value;
  if (!id || state.pending) return;
  if (!confirm("Archive this class? Its saved lesson logs will remain available on their dates.")) return;
  state.pending = true;
  $("#archive-class-button").disabled = true;
  try {
    await request("archiveClass", {token: state.token, classId: id});
    $("#class-dialog").close();
    state.selectedClassId = "";
    await refreshAfterWrite("Class archived.");
  } catch (error) {
    if (isSessionError(error)) {
      $("#class-dialog").close();
      handleError(error);
    } else {
      $("#class-error").textContent = error.message;
      $("#class-error").hidden = false;
    }
  } finally {
    state.pending = false;
    $("#archive-class-button").disabled = false;
  }
});

$("#add-student-button").addEventListener("click", () => {
  saveChecklistDraft();
  const choice = $("#student-choice");
  choice.replaceChildren();
  const create = document.createElement("option");
  create.value = "new";
  create.textContent = "Create a new student";
  choice.append(create);
  const enrolled = new Set(state.enrollments
    .filter(item => item.classId === state.selectedClassId && item.active)
    .map(item => item.studentId));
  state.students.filter(item => !enrolled.has(item.id))
    .sort((a, b) => a.name.localeCompare(b.name)).forEach(item => {
      const option = document.createElement("option");
      option.value = item.id;
      option.textContent = item.name;
      choice.append(option);
    });
  $("#student-form").reset();
  $("#new-student-fields").hidden = false;
  $("#view-student-profile").hidden = true;
  $("#student-error").hidden = true;
  $("#student-dialog").showModal();
  $("#student-name").focus();
});
$("#student-choice").addEventListener("change", () => {
  const existing = $("#student-choice").value !== "new";
  $("#new-student-fields").hidden = existing;
  $("#view-student-profile").hidden = !existing;
});
$("#view-student-profile").addEventListener("click", () => {
  const id = $("#student-choice").value;
  if (id === "new") return;
  $("#student-dialog").close();
  openStudentHistory(id);
});
$("#close-student-dialog").addEventListener("click", () => $("#student-dialog").close());
$("#cancel-student-dialog").addEventListener("click", () => $("#student-dialog").close());
$("#student-form").addEventListener("submit", async event => {
  event.preventDefault();
  if (state.pending) return;
  const newStudent = $("#student-choice").value === "new";
  const name = $("#student-name").value.trim();
  if (newStudent && !name) {
    $("#student-error").textContent = "Enter the student's name.";
    $("#student-error").hidden = false;
    return;
  }
  state.pending = true;
  $("#save-student-button").disabled = true;
  $("#student-error").hidden = true;
  try {
    if (newStudent) await request("saveStudent", {token: state.token, student: {name, classId: state.selectedClassId}});
    else await request("setEnrollment", {token: state.token, classId: state.selectedClassId,
      studentId: $("#student-choice").value, active: true});
    $("#student-dialog").close();
    await refreshAfterWrite("Student added to class.");
  } catch (error) {
    if (isSessionError(error)) {
      $("#student-dialog").close();
      handleError(error);
    } else {
      $("#student-error").textContent = error.message;
      $("#student-error").hidden = false;
    }
  } finally {
    state.pending = false;
    $("#save-student-button").disabled = false;
  }
});

$("#close-history-dialog").addEventListener("click", () => $("#history-dialog").close());
$("#rename-student-form").addEventListener("submit", async event => {
  event.preventDefault();
  if (state.pending || !state.selectedStudentId) return;
  state.pending = true;
  $("#history-error").hidden = true;
  try {
    await request("saveStudent", {token: state.token,
      student: {id: state.selectedStudentId, name: $("#rename-student-name").value.trim()}});
    await refreshAfterWrite("Student renamed.");
    $("#history-title").textContent = studentName(state.selectedStudentId) + " · history";
  } catch (error) {
    if (isSessionError(error)) {
      $("#history-dialog").close();
      handleError(error);
    } else {
      $("#history-error").textContent = error.message;
      $("#history-error").hidden = false;
    }
  } finally {
    state.pending = false;
  }
});
$("#remove-student-button").addEventListener("click", async () => {
  if (state.pending || !state.selectedStudentId) return;
  if (!confirm("Remove this student from future class checklists? Past records will remain.")) return;
  saveChecklistDraft();
  state.pending = true;
  $("#history-error").hidden = true;
  try {
    await request("setEnrollment", {token: state.token, classId: state.selectedClassId,
      studentId: state.selectedStudentId, active: false});
    $("#history-dialog").close();
    await refreshAfterWrite("Student removed from class.");
  } catch (error) {
    if (isSessionError(error)) {
      $("#history-dialog").close();
      handleError(error);
    } else {
      $("#history-error").textContent = error.message;
      $("#history-error").hidden = false;
    }
  } finally {
    state.pending = false;
  }
});

$("#checklist-form").addEventListener("submit", async event => {
  event.preventDefault();
  if (state.pending || !state.selectedClassId) return;
  saveChecklistDraft();
  const key = checklistKey();
  const records = readChecklistForm();
  if (!records.length) return;
  const checklist = {classId: state.selectedClassId, date: state.selectedDate, records};
  state.pending = true;
  $("#save-checklist-button").disabled = true;
  $("#save-checklist-button").textContent = "Saving…";
  $("#checklist-status").textContent = "Saving checklist…";
  $("#checklist-status").classList.remove("error");
  try {
    await request("saveChecklist", {token: state.token, checklist});
    state.checklistDrafts.delete(key);
    await refreshAfterWrite("Checklist saved.");
  } catch (error) {
    state.checklistDrafts.set(key, records);
    if (isSessionError(error)) handleError(error);
    else {
      $("#checklist-status").textContent = error.message;
      $("#checklist-status").classList.add("error");
    }
  } finally {
    state.pending = false;
    $("#save-checklist-button").disabled = false;
    $("#save-checklist-button").textContent = "Save checklist";
  }
});

$("#lesson-notes").addEventListener("input", () => {
  saveDraft();
  $("#lesson-status").textContent = "Unsaved changes";
  $("#lesson-status").classList.remove("error");
});
document.querySelectorAll('input[name="rating"]').forEach(input => input.addEventListener("change", () => {
  saveDraft();
  $("#lesson-status").textContent = "Unsaved changes";
  $("#lesson-status").classList.remove("error");
}));

$("#lesson-form").addEventListener("submit", async event => {
  event.preventDefault();
  if (state.pending || !state.selectedClassId) return;
  const rating = document.querySelector('input[name="rating"]:checked')?.value;
  if (!rating) {
    $("#lesson-status").textContent = "Choose a rating before saving.";
    $("#lesson-status").classList.add("error");
    return;
  }
  saveDraft();
  const key = draftKey();
  const record = {
    classId: state.selectedClassId,
    date: state.selectedDate,
    notes: $("#lesson-notes").value,
    rating: Number(rating)
  };
  state.pending = true;
  $("#save-lesson-button").disabled = true;
  $("#save-lesson-button").textContent = "Saving…";
  $("#lesson-status").textContent = "Saving lesson…";
  $("#lesson-status").classList.remove("error");
  try {
    await request("saveLog", {token: state.token, log: record});
    state.drafts.delete(key);
    await refreshAfterWrite("Lesson saved.");
  } catch (error) {
    state.drafts.set(key, {notes: record.notes, rating: String(record.rating)});
    if (isSessionError(error)) {
      handleError(error);
    } else {
      $("#lesson-status").textContent = error.message;
      $("#lesson-status").classList.add("error");
    }
  } finally {
    state.pending = false;
    $("#save-lesson-button").disabled = false;
    $("#save-lesson-button").textContent = "Save lesson";
  }
});

updateAccess();
