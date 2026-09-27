import { isSessionError, handleError } from "./auth.js";
import { dataAccess } from "./data/index.js";
import { $ } from "./dom.js";
import { checklistKey, saveChecklistDraft } from "./drafts.js";
import { markScore, markReason, pointLabel, openStudentHistory } from "./reports.js";
import { selectedLesson } from "./scheduling.js";
import { state, upsert } from "./state.js";
import { studentName } from "./students.js";
import { finishWrite } from "./ui.js";

export function savedChecklist() {
  return state.checklists.find(item => item.classId === state.selectedClassId && item.date === state.selectedDate);
}

export function savedStudentRows() {
  return state.studentRecords.filter(item => item.classId === state.selectedClassId && item.date === state.selectedDate);
}

export function checklistRows() {
  const saved = savedChecklist();
  const base = saved ? savedStudentRows() : [];
  const seen = new Set(base.map(item => item.studentId));
  state.enrollments.filter(item => item.classId === state.selectedClassId &&
    (!item.joinedOn || item.joinedOn <= state.selectedDate) &&
    (!item.leftOn || state.selectedDate < item.leftOn)).forEach(item => {
      if (seen.has(item.studentId)) return;
      seen.add(item.studentId);
      base.push({studentId: item.studentId, attendance: "present", participation: 0, note: ""});
    });
  const draft = state.checklistDrafts.get(checklistKey());
  return base.map(item => ({...item, ...(draft?.find(value => value.studentId === item.studentId) || {})}))
    .sort((a, b) => studentName(a.studentId).localeCompare(studentName(b.studentId)));
}
export function readChecklistForm() {
  return [...$("#student-list").querySelectorAll(".student-row")].map(row => ({
    studentId: row.dataset.studentId,
    attendance: row.dataset.attendance,
    participation: Number(row.dataset.participation),
    note: row.querySelector(".student-note").value
  }));
}
export function updateChecklistSaveButton() {
  const button = $("#save-checklist-button");
  if (!button) return;
  const hasRows = Boolean($("#student-list")?.querySelector(".student-row"));
  const unchanged = Boolean(savedChecklist()) && !state.checklistDrafts.has(checklistKey());
  button.disabled = state.pending || !hasRows || unchanged;
  button.textContent = unchanged ? "Checklist saved" : state.pending ? "Saving…" : "Save checklist";
}

export function updateChecklistStats() {
  const records = readChecklistForm();
  const present = records.filter(item => item.attendance === "present").length;
  const absent = records.length - present;
  const total = records.reduce((sum, item) => sum + markScore(item), 0);
  const container = $("#checklist-stats");
  container.replaceChildren();
  [[records.length + " students", ""], [present + " present", "present"],
    [absent + " absent", "absent"], ["Session score " + (total > 0 ? "+" : "") + total, ""]]
    .forEach(([label, style]) => {
      const chip = document.createElement("span");
      chip.className = "checklist-stat " + style;
      chip.textContent = label;
      container.append(chip);
    });
  const bulkButton = $("#bulk-attendance-button");
  const markAbsent = records.length > 0 && present === records.length;
  bulkButton.dataset.attendance = markAbsent ? "absent" : "present";
  bulkButton.textContent = markAbsent ? "Mark whole group absent" : "Mark whole group present";
}

export function filterStudentRows() {
  const query = $("#student-search").value.trim().toLocaleLowerCase();
  [...$("#student-list").querySelectorAll(".student-row")].forEach(row => {
    row.hidden = !studentName(row.dataset.studentId).toLocaleLowerCase().includes(query);
  });
}

export function updateStudentRow(row) {
  const absent = row.dataset.attendance === "absent";
  row.querySelectorAll(".attendance-group .choice-button").forEach(button => {
    button.setAttribute("aria-pressed", String(button.dataset.value === row.dataset.attendance));
  });
  row.querySelectorAll(".participation-group .choice-button").forEach(button => {
    button.setAttribute("aria-pressed", String(Number(button.dataset.value) === Number(row.dataset.participation)));
    button.disabled = absent;
  });
  const classTotal = state.studentRecords.filter(item => item.studentId === row.dataset.studentId &&
    item.classId === state.selectedClassId).reduce((sum, item) => sum + markScore(item), 0);
  row.querySelector(".student-score").textContent = markReason({attendance: row.dataset.attendance,
    participation: row.dataset.participation}) + " · " + pointLabel(classTotal) + " in this class";
}

export function renderStudents() {
  const lesson = selectedLesson();
  $("#student-panel").hidden = !lesson;
  if (!lesson) return;
  $("#checklist-form").hidden = !state.studentsReady;
  $(".attendance-toolbar").hidden = !state.studentsReady;
  $("#add-student-button").hidden = !state.studentsReady || lesson.archived;
  if (!state.studentsReady) {
    $("#checklist-summary").textContent = "Student records need the updated Apps Script. Run setupDashboard and deploy its new version.";
    $("#checklist-stats").replaceChildren();
    return;
  }
  const saved = savedChecklist();
  const rows = checklistRows();
  const list = $("#student-list");
  list.replaceChildren();
  $("#checklist-summary").textContent = saved
    ? "Review or correct this meeting's saved attendance."
    : "Everyone starts present with 0 points. Save to record this meeting.";
  if (!rows.length) {
    const empty = document.createElement("p");
    empty.className = "student-empty";
    empty.textContent = lesson.archived ? "No saved attendance for this meeting." : "Add a student to this group to start taking attendance.";
    list.append(empty);
  }
  rows.forEach((item, index) => {
    const row = document.createElement("div");
    row.className = "student-row";
    row.dataset.studentId = item.studentId;
    row.dataset.attendance = item.attendance;
    row.dataset.participation = String(item.participation);
    const identity = document.createElement("div");
    identity.className = "student-identity";
    const history = document.createElement("button");
    history.type = "button";
    history.className = "student-name-button";
    history.textContent = studentName(item.studentId);
    history.setAttribute("aria-label", "View history for " + studentName(item.studentId));
    history.addEventListener("click", () => openStudentHistory(item.studentId));
    const score = document.createElement("span");
    score.className = "student-score";
    identity.append(history, score);
    const attendance = document.createElement("div");
    attendance.className = "choice-group attendance-group";
    attendance.setAttribute("role", "group");
    attendance.setAttribute("aria-label", "Attendance for " + studentName(item.studentId));
    [["present", "Present", "is-present"], ["absent", "Absent", "is-absent"]].forEach(([value, label, style]) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "choice-button " + style;
      button.dataset.value = value;
      button.textContent = label;
      button.addEventListener("click", () => {
        row.dataset.attendance = value;
        if (value === "absent") row.dataset.participation = "0";
        updateStudentRow(row);
        saveChecklistDraft();
        updateChecklistStats();
      });
      attendance.append(button);
    });
    const participation = document.createElement("div");
    participation.className = "choice-group participation-group";
    participation.setAttribute("role", "group");
    participation.setAttribute("aria-label", "Participation for " + studentName(item.studentId));
    [["1", "+1", "Participation"], ["0", "0", "No change"], ["-1", "−1", "Noise"]].forEach(([value, label, meaning]) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "choice-button" + (value === "-1" ? " is-noise" : "");
      button.dataset.value = value;
      button.textContent = label;
      button.setAttribute("aria-label", meaning + " " + label + " for " + studentName(item.studentId));
      button.addEventListener("click", () => {
        row.dataset.participation = value;
        updateStudentRow(row);
        saveChecklistDraft();
        updateChecklistStats();
      });
      participation.append(button);
    });
    const noteButton = document.createElement("button");
    noteButton.type = "button";
    noteButton.className = "note-toggle";
    noteButton.textContent = item.note ? "Edit note" : "+ Note";
    noteButton.classList.toggle("has-note", Boolean(item.note));
    noteButton.setAttribute("aria-expanded", "false");
    const noteId = "student-note-" + index;
    noteButton.setAttribute("aria-controls", noteId);
    const noteLabel = document.createElement("label");
    noteLabel.id = noteId;
    noteLabel.className = "student-note-wrap";
    noteLabel.classList.add("is-collapsed");
    noteLabel.textContent = "Note for " + studentName(item.studentId);
    const note = document.createElement("textarea");
    note.className = "student-note";
    note.rows = 2;
    note.maxLength = 300;
    note.placeholder = "Something to remember about this student from this meeting…";
    note.value = item.note || "";
    noteLabel.append(note);
    noteButton.addEventListener("click", () => {
      const isOpen = noteLabel.classList.toggle("is-collapsed") === false;
      noteButton.setAttribute("aria-expanded", String(isOpen));
      if (isOpen) note.focus();
    });
    note.addEventListener("input", () => {
      noteButton.textContent = note.value ? "Edit note" : "+ Note";
      noteButton.classList.toggle("has-note", Boolean(note.value));
      saveChecklistDraft();
    });
    row.append(identity, attendance, participation, noteButton, noteLabel);
    updateStudentRow(row);
    list.append(row);
  });
  filterStudentRows();
  updateChecklistStats();
  $("#save-checklist-button").hidden = lesson.archived && !saved;
  $("#save-checklist-button").disabled = !rows.length;
  $("#bulk-attendance-button").disabled = !rows.length;
  saveChecklistDraft();
}
export function applyChecklist(saved) {
  const payload = saved.checklist;
  if (!payload) throw new Error("The checklist save response was incomplete. Reload the dashboard.");
  upsert(state.checklists, item => item.classId === saved.classId && item.date === saved.date, {
    classId: saved.classId, date: saved.date, revision: saved.revision,
    updatedAt: saved.updatedAt, storage: "json-v1", recordCount: payload.records.length,
    classInfo: payload.classInfo, records: payload.records
  });
  state.studentRecords = state.studentRecords.filter(item => item.classId !== saved.classId || item.date !== saved.date);
  payload.records.forEach(item => state.studentRecords.push({
    classId: saved.classId, date: saved.date, studentId: item.studentId,
    studentName: item.studentName, attendance: item.attendance,
    participation: Number(item.participation), note: item.note, updatedAt: saved.updatedAt
  }));
}

export function bindAttendance() {
  $("#student-search").addEventListener("input", filterStudentRows);
  $("#bulk-attendance-button").addEventListener("click", event => {
    const attendance = event.currentTarget.dataset.attendance === "absent" ? "absent" : "present";
    [...$("#student-list").querySelectorAll(".student-row")].forEach(row => {
      row.dataset.attendance = attendance;
      if (attendance === "absent") row.dataset.participation = "0";
      updateStudentRow(row);
    });
    saveChecklistDraft();
    updateChecklistStats();
  });
  $("#checklist-form").addEventListener("submit", async event => {
    event.preventDefault();
    if (state.pending || !state.selectedClassId) return;
    saveChecklistDraft();
    const key = checklistKey();
    const records = readChecklistForm();
    if (!records.length) return;
    const checklist = {schemaVersion: 1, classId: state.selectedClassId, date: state.selectedDate,
      revision: savedChecklist()?.revision || "", records};
    state.pending = true;
    state.savingChecklistKey = key;
    $("#save-checklist-button").disabled = true;
    $("#save-checklist-button").textContent = "Saving…";
    $("#checklist-status").textContent = "Saving checklist…";
    $("#checklist-status").classList.remove("error");
    try {
      const saved = await dataAccess.saveChecklist({token: state.token, checklist});
      applyChecklist(saved);
      if (JSON.stringify(state.checklistDrafts.get(key)) === JSON.stringify(records)) {
        state.checklistDrafts.delete(key);
      }
      state.savingChecklistKey = "";
      finishWrite(state.checklistDrafts.has(key) ? "Checklist saved; newer changes are still unsaved." : "Checklist saved.");
    } catch (error) {
      if (!state.checklistDrafts.has(key)) state.checklistDrafts.set(key, records);
      if (isSessionError(error)) handleError(error);
      else {
        $("#checklist-status").textContent = error.message;
        $("#checklist-status").classList.add("error");
      }
    } finally {
      state.savingChecklistKey = "";
      state.pending = false;
      updateChecklistSaveButton();
    }
  });
}
