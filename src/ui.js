import { renderStudents } from "./attendance.js";
import { todayInTashkent, formatDate } from "./dates.js";
import { $ } from "./dom.js";
import { renderLesson, renderPreviousNotes } from "./lesson-records.js";
import { renderWeekStrip, renderSchedule, selectedLesson } from "./scheduling.js";
import { state, upsert } from "./state.js";

export function setNotice(message, error = false) {
  const notice = $("#global-notice");
  notice.textContent = message;
  notice.classList.toggle("error", error);
  notice.hidden = !message;
}
export function render() {
  const group = selectedLesson();
  $("#schedule-view").hidden = Boolean(group);
  $("#group-view").hidden = !group;
  $("#week-strip").hidden = Boolean(group);
  $(".view-switch").hidden = Boolean(group);
  $("#add-class-button").hidden = Boolean(group);
  if (group) {
    $("#group-name").textContent = group.name;
    $("#group-detail").textContent = [formatDate(state.selectedDate, {weekday: "long", month: "long", day: "numeric", year: "numeric"}),
      group.subject, group.start + "–" + group.end, group.room && "Room " + group.room].filter(Boolean).join(" · ");
  }
  $("#chosen-date").textContent = formatDate(state.selectedDate, {weekday: "long", month: "long", day: "numeric", year: "numeric"});
  $("#page-title").textContent = group ? "Group record" : state.view === "day"
    ? state.selectedDate === todayInTashkent() ? "Today’s classes" : "Daily timetable"
    : "Your teaching week";
  $("#page-subtitle").textContent = group ? "Previous notes, this meeting's note, and student attendance in one place."
    : "Your schedule and lesson notes in one place.";
  $("#day-view-button").setAttribute("aria-pressed", String(state.view === "day"));
  $("#week-view-button").setAttribute("aria-pressed", String(state.view === "week"));
  renderWeekStrip();
  renderSchedule();
  renderLesson();
  renderPreviousNotes();
  renderStudents();
}
export function finishWrite(message) {
  render();
  setNotice(message);
}
