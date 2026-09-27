import { isSessionError, handleError } from "./auth.js";
import { dataAccess } from "./data/index.js";
import { $ } from "./dom.js";
import { saveChecklistDraft } from "./drafts.js";
import { openStudentHistory } from "./reports.js";
import { state } from "./state.js";
import { finishWrite } from "./ui.js";

export function studentName(id) {
  return state.students.find(item => item.id === id)?.name || "Unknown student";
}
export function applyEnrollment(enrollment) {
  if (!enrollment) return;
  const active = state.enrollments.find(item => item.classId === enrollment.classId &&
    item.studentId === enrollment.studentId && item.active);
  if (active) Object.assign(active, enrollment);
  else if (enrollment.active) state.enrollments.push(enrollment);
}

export function bindStudents() {
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
      if (newStudent) {
        const saved = await dataAccess.saveStudent({token: state.token, student: {name, classId: state.selectedClassId}});
        upsert(state.students, item => item.id === saved.student.id, saved.student);
        applyEnrollment(saved.enrollment);
      } else {
        const saved = await dataAccess.setEnrollment({token: state.token, classId: state.selectedClassId,
          studentId: $("#student-choice").value, active: true});
        applyEnrollment(saved);
      }
      $("#student-dialog").close();
      finishWrite("Student added to class.");
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
      const saved = await dataAccess.saveStudent({token: state.token,
        student: {id: state.selectedStudentId, name: $("#rename-student-name").value.trim()}});
      upsert(state.students, item => item.id === saved.student.id, saved.student);
      finishWrite("Student renamed.");
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
      const saved = await dataAccess.setEnrollment({token: state.token, classId: state.selectedClassId,
        studentId: state.selectedStudentId, active: false});
      applyEnrollment(saved);
      $("#history-dialog").close();
      finishWrite("Student removed from class.");
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
}
