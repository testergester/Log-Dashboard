import { savedChecklist, savedStudentRows, readChecklistForm, updateChecklistSaveButton } from "./attendance.js";
import { $ } from "./dom.js";
import { logFor, lessonTypeValue } from "./lesson-records.js";
import { state } from "./state.js";

export function draftKey() {
  return state.selectedClassId + "|" + state.selectedDate;
}

export function saveDraft() {
  if (!state.selectedClassId || $("#lesson-form").hidden) return;
  const notes = $("#lesson-notes").value;
  const rating = document.querySelector('input[name="rating"]:checked')?.value || "";
  const lessonType = lessonTypeValue();
  const lessonStatus = document.querySelector('input[name="lesson-record-status"]:checked')?.value || "Done";
  const saved = logFor(state.selectedClassId, state.selectedDate);
  if (state.savingLessonKey === draftKey() || notes !== (saved?.notes || "") || rating !== String(saved?.rating || "") ||
      lessonType !== (saved?.lessonType || "Lesson") || lessonStatus !== (saved?.lessonStatus || "Done")) {
    state.drafts.set(draftKey(), {notes, rating, lessonType, lessonStatus});
  } else {
    state.drafts.delete(draftKey());
  }
}
export function checklistKey() {
  return state.selectedClassId + "|" + state.selectedDate;
}
export function saveChecklistDraft() {
  if (!state.selectedClassId || !state.studentsReady || $("#student-panel").hidden) return;
  const rows = readChecklistForm();
  const saved = savedChecklist() ? savedStudentRows() : rows.map(item =>
    ({studentId: item.studentId, attendance: "present", participation: 0, note: ""}));
  const same = rows.length === saved.length && rows.every(item => {
    const previous = saved.find(value => value.studentId === item.studentId);
    return previous && item.attendance === previous.attendance &&
      item.participation === Number(previous.participation) && item.note === (previous.note || "");
  });
  if (same && state.savingChecklistKey !== checklistKey()) state.checklistDrafts.delete(checklistKey());
  else state.checklistDrafts.set(checklistKey(), rows);
  $("#checklist-status").textContent = same
    ? savedChecklist() ? "Saved " + savedChecklist().updatedAt : "Not saved yet"
    : "Unsaved changes";
  $("#checklist-status").classList.remove("error");
  updateChecklistSaveButton();
}
