import { formatDate } from "./dates.js";
import { $ } from "./dom.js";
import { saveChecklistDraft } from "./drafts.js";
import { selectedLesson } from "./scheduling.js";
import { state, upsert } from "./state.js";

export function markScore(item) {
  return item.attendance === "absent" ? -1 : Number(item.participation);
}

export function markReason(item) {
  if (item.attendance === "absent") return "Absent −1";
  if (Number(item.participation) === 1) return "Participation +1";
  if (Number(item.participation) === -1) return "Noise −1";
  return "Present 0";
}

export function pointLabel(value) {
  return value + (Math.abs(value) === 1 ? " point" : " points");
}
export function openStudentHistory(studentId) {
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
  const isEnrolled = state.enrollments.some(item => item.classId === state.selectedClassId && item.studentId === studentId && item.active);
  $("#remove-student-button").hidden = !isEnrolled || Boolean(selectedLesson()?.archived);
  $("#history-dialog").showModal();
}
