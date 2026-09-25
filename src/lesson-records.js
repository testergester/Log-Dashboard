import { isSessionError, handleError } from "./auth.js";
import { STANDARD_LESSON_TYPES } from "./config.js";
import { dataAccess } from "./data/index.js";
import { formatDate } from "./dates.js";
import { $ } from "./dom.js";
import { draftKey, saveDraft } from "./drafts.js";
import { lessonsOn } from "./scheduling.js";
import { state } from "./state.js";
import { finishWrite } from "./ui.js";

export function logFor(id, date) {
  return state.logs.find(log => log.classId === id && log.date === date);
}
export function lessonTypeValue() {
  const selected = document.querySelector('input[name="lesson-type"]:checked')?.value || "Lesson";
  return selected === "__custom" ? $("#custom-lesson-type").value : selected;
}

export function showCustomLessonType(show) {
  $("#custom-lesson-type-wrap").hidden = !show;
}

export function renderLesson() {
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
  const lessonType = draft ? draft.lessonType : saved?.lessonType || "Lesson";
  const standardType = STANDARD_LESSON_TYPES.includes(lessonType);
  document.querySelectorAll('input[name="lesson-type"]').forEach(input => {
    input.checked = input.value === (standardType ? lessonType : "__custom");
  });
  $("#custom-lesson-type").value = standardType ? "" : lessonType;
  showCustomLessonType(!standardType);
  const lessonStatus = draft ? draft.lessonStatus : saved?.lessonStatus || "Done";
  document.querySelectorAll('input[name="lesson-record-status"]').forEach(input => {
    input.checked = input.value === lessonStatus;
  });
  document.querySelectorAll('input[name="rating"]').forEach(input => {
    input.checked = input.value === String(draft ? draft.rating : saved?.rating || "");
  });
  $("#lesson-status").classList.remove("error");
  $("#lesson-status").textContent = draft ? "Unsaved changes" : saved ? "Saved " + (saved.updatedAt || "") : "Not saved yet";
  $("#save-lesson-button").disabled = Boolean(item.archived && !saved);
}
export function renderPreviousNotes() {
  const list = $("#previous-notes-list");
  list.replaceChildren();
  if (!state.selectedClassId) return;
  const previous = state.logs.filter(item => item.classId === state.selectedClassId && item.date < state.selectedDate)
    .sort((a, b) => b.date.localeCompare(a.date));
  if (!previous.length) {
    const empty = document.createElement("p");
    empty.className = "previous-notes-empty";
    empty.textContent = "No earlier records for this group yet.";
    list.append(empty);
    return;
  }
  previous.forEach(item => {
    const entry = document.createElement("article");
    entry.className = "previous-note";
    const date = document.createElement("span");
    date.className = "previous-note-date";
    date.textContent = formatDate(item.date, {weekday: "short", month: "short", day: "numeric", year: "numeric"});
    const notes = document.createElement("p");
    notes.textContent = item.notes || "No notes added.";
    entry.append(date, notes);
    const details = document.createElement("small");
    details.textContent = (item.lessonType || "Lesson") + " · " + (item.lessonStatus || "Done");
    entry.append(details);
    if (item.rating) {
      const rating = document.createElement("small");
      rating.textContent = "Class rating: " + item.rating + "/5";
      entry.append(rating);
    }
    list.append(entry);
  });
}

export function bindLessonRecords() {
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
  document.querySelectorAll('input[name="lesson-type"]').forEach(input => input.addEventListener("change", () => {
    showCustomLessonType(input.value === "__custom");
    if (input.value === "__custom") $("#custom-lesson-type").focus();
    saveDraft();
    $("#lesson-status").textContent = "Unsaved changes";
    $("#lesson-status").classList.remove("error");
  }));
  $("#custom-lesson-type").addEventListener("input", () => {
    saveDraft();
    $("#lesson-status").textContent = "Unsaved changes";
    $("#lesson-status").classList.remove("error");
  });
  document.querySelectorAll('input[name="lesson-record-status"]').forEach(input => input.addEventListener("change", () => {
    saveDraft();
    $("#lesson-status").textContent = "Unsaved changes";
    $("#lesson-status").classList.remove("error");
  }));

  $("#lesson-form").addEventListener("submit", async event => {
    event.preventDefault();
    if (state.pending || !state.selectedClassId) return;
    const rating = document.querySelector('input[name="rating"]:checked')?.value;
    const lessonType = lessonTypeValue().trim();
    const lessonStatus = document.querySelector('input[name="lesson-record-status"]:checked')?.value || "Done";
    if (!lessonType) {
      $("#lesson-status").textContent = "Enter a custom lesson type before saving.";
      $("#lesson-status").classList.add("error");
      $("#custom-lesson-type").focus();
      return;
    }
    saveDraft();
    const key = draftKey();
    const record = {
      classId: state.selectedClassId,
      date: state.selectedDate,
      notes: $("#lesson-notes").value,
      rating: rating ? Number(rating) : null,
      lessonType,
      lessonStatus
    };
    const submittedDraft = {notes: record.notes, rating: rating || "", lessonType, lessonStatus};
    state.pending = true;
    state.savingLessonKey = key;
    $("#save-lesson-button").disabled = true;
    $("#save-lesson-button").textContent = "Saving…";
    $("#lesson-status").textContent = "Saving lesson…";
    $("#lesson-status").classList.remove("error");
    try {
      const saved = await dataAccess.saveLog({token: state.token, log: record});
      upsert(state.logs, item => item.classId === saved.classId && item.date === saved.date, saved);
      if (JSON.stringify(state.drafts.get(key)) === JSON.stringify(submittedDraft)) {
        state.drafts.delete(key);
      }
      state.savingLessonKey = "";
      finishWrite(state.drafts.has(key) ? "Lesson saved; newer changes are still unsaved." : "Lesson saved.");
    } catch (error) {
      if (!state.drafts.has(key)) state.drafts.set(key, submittedDraft);
      if (isSessionError(error)) {
        handleError(error);
      } else {
        $("#lesson-status").textContent = error.message;
        $("#lesson-status").classList.add("error");
      }
    } finally {
      state.savingLessonKey = "";
      state.pending = false;
      $("#save-lesson-button").disabled = false;
      $("#save-lesson-button").textContent = "Save lesson";
    }
  });
}
