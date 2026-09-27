import { isSessionError, handleError } from "./auth.js";
import { WEEKDAYS } from "./config.js";
import { dataAccess } from "./data/index.js";
import { todayInTashkent, dateAtUTC, addDays, weekday, mondayOf, formatDate, timeNowInTashkent, minutes } from "./dates.js";
import { $ } from "./dom.js";
import { saveDraft, saveChecklistDraft } from "./drafts.js";
import { logFor } from "./lesson-records.js";
import { state } from "./state.js";
import { render, finishWrite } from "./ui.js";

export function activeClassesOn(date) {
  const day = weekday(date);
  return state.classes.filter(item => item.active && Number(item.weekday) === day);
}

export function lessonsOn(date) {
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
    minutes(a.start) - minutes(b.start) || minutes(a.end) - minutes(b.end) || String(a.name).localeCompare(String(b.name)));
}
export function statusFor(item, date) {
  const log = logFor(item.id, date);
  if (log) return [log.lessonStatus || "Done", "logged status-" + String(log.lessonStatus || "Done").toLowerCase()];
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

export function classCard(item, date) {
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
    if (state.selectedClassId !== item.id) $("#student-search").value = "";
    state.selectedDate = date;
    state.selectedClassId = item.id;
    render();
    $("#group-view").scrollIntoView({behavior: "smooth", block: "start"});
  });
  return button;
}

export function renderWeekStrip() {
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

export function renderSchedule() {
  const list = $("#schedule-list");
  list.replaceChildren();
  list.classList.toggle("week-grid-wrap", state.view === "week");
  const dayView = state.view === "day";
  $("#schedule-kicker").textContent = dayView ? "DAILY TIMETABLE" : "WEEKLY TIMETABLE";
  $("#schedule-title").textContent = dayView ? "Your classes" : "Your week";
  const dates = dayView
    ? [state.selectedDate]
    : Array.from({length: 5}, (_, index) => addDays(mondayOf(state.selectedDate), index));
  const total = dates.reduce((sum, date) => sum + (dayView ? lessonsOn(date) : activeClassesOn(date)).length, 0);
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
    renderWeekGrid(list, dates);
  }
}

export function renderWeekGrid(container, dates) {
  const periods = new Map();
  state.classes.filter(item => item.active && Number(item.weekday) >= 1 && Number(item.weekday) <= 5).forEach(item => {
    periods.set(item.start + "|" + item.end, {start: item.start, end: item.end});
  });
  const orderedPeriods = [...periods.values()].sort((left, right) =>
    minutes(left.start) - minutes(right.start) || minutes(left.end) - minutes(right.end));
  const grid = document.createElement("div");
  grid.className = "week-grid";
  grid.setAttribute("role", "grid");
  grid.setAttribute("aria-label", "Monday to Friday timetable");

  const startHeading = weekGridHeading("Beginning", "time-heading start-heading");
  const endHeading = weekGridHeading("End", "time-heading end-heading");
  grid.append(startHeading, endHeading);
  const today = todayInTashkent();
  dates.forEach(date => {
    const heading = weekGridHeading(formatDate(date, {weekday: "long", month: "short", day: "numeric"}), "day-heading");
    heading.classList.toggle("is-today", date === today);
    grid.append(heading);
  });

  orderedPeriods.forEach(period => {
    const start = document.createElement("div");
    start.className = "week-time start-time";
    start.textContent = period.start;
    const end = document.createElement("div");
    end.className = "week-time end-time";
    end.textContent = period.end;
    grid.append(start, end);
    dates.forEach((date, dayIndex) => {
      const items = activeClassesOn(date).filter(item => item.start === period.start && item.end === period.end)
        .sort((left, right) => String(left.name).localeCompare(String(right.name)));
      const cell = document.createElement("div");
      cell.className = "week-grid-cell";
      cell.classList.toggle("is-today", date === today);
      if (items.length) {
        cell.classList.add("is-occupied");
        items.forEach(item => cell.append(weekClassButton(item, date)));
      } else {
        const free = document.createElement("button");
        free.type = "button";
        free.className = "week-free-button";
        free.textContent = "Free";
        free.setAttribute("aria-label", "Free on " + WEEKDAYS[dayIndex] + " from " + period.start + " to " + period.end + ". Add class.");
        free.addEventListener("click", () => openClassDialog(null, {
          weekday: dayIndex + 1, start: period.start, end: period.end
        }));
        cell.append(free);
      }
      grid.append(cell);
    });
  });
  container.append(grid);
}

export function weekGridHeading(text, className) {
  const heading = document.createElement("div");
  heading.className = "week-grid-heading " + className;
  heading.setAttribute("role", "columnheader");
  heading.textContent = text;
  return heading;
}

export function weekClassButton(item, date) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "week-class-button";
  const name = document.createElement("strong");
  name.textContent = item.name;
  const detail = document.createElement("span");
  detail.textContent = [item.subject, item.room && "Room " + item.room].filter(Boolean).join(" · ");
  button.append(name, detail);
  button.addEventListener("click", () => {
    saveDraft();
    saveChecklistDraft();
    state.selectedDate = date;
    state.selectedClassId = item.id;
    $("#student-search").value = "";
    render();
    $("#group-view").scrollIntoView({behavior: "smooth", block: "start"});
  });
  return button;
}
export function selectedLesson() {
  return lessonsOn(state.selectedDate).find(item => item.id === state.selectedClassId);
}
export function changeDate(date) {
  saveDraft();
  saveChecklistDraft();
  state.selectedDate = date;
  if (!lessonsOn(date).some(item => item.id === state.selectedClassId)) state.selectedClassId = "";
  render();
}

export function openClassDialog(item, defaults = {}) {
  $("#class-form").reset();
  $("#class-error").hidden = true;
  $("#class-id").value = item?.id || "";
  $("#group-id-fields").hidden = Boolean(item);
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
    $("#random-group-id").checked = true;
    updateGroupIdFields();
    $("#class-weekday").value = String(defaults.weekday || weekday(state.selectedDate));
    $("#class-start").value = defaults.start || "";
    $("#class-end").value = defaults.end || "";
  }
  $("#class-dialog").showModal();
  $("#class-name").focus();
}

export function updateGroupIdFields() {
  const useRandomId = $("#random-group-id").checked;
  $("#custom-group-id-wrap").hidden = useRandomId;
  $("#custom-group-id").required = !useRandomId;
  if (useRandomId) $("#custom-group-id").value = "";
  else $("#custom-group-id").focus();
}

export function bindScheduling() {
  $("#previous-date").addEventListener("click", () => changeDate(addDays(state.selectedDate, state.selectedClassId || state.view === "week" ? -7 : -1)));
  $("#next-date").addEventListener("click", () => changeDate(addDays(state.selectedDate, state.selectedClassId || state.view === "week" ? 7 : 1)));
  $("#today-button").addEventListener("click", () => changeDate(todayInTashkent()));
  $("#back-to-schedule").addEventListener("click", () => {
    saveDraft();
    saveChecklistDraft();
    state.selectedClassId = "";
    render();
    $("#schedule-view").scrollIntoView({behavior: "smooth", block: "start"});
  });
  $("#day-view-button").addEventListener("click", () => { saveDraft(); saveChecklistDraft(); state.view = "day"; render(); });
  $("#week-view-button").addEventListener("click", () => { saveDraft(); saveChecklistDraft(); state.view = "week"; render(); });
  $("#add-class-button").addEventListener("click", () => openClassDialog(null));
  $("#edit-class-button").addEventListener("click", () => {
    const item = state.classes.find(value => value.id === state.selectedClassId && value.active);
    if (item) openClassDialog(item);
  });
  $("#close-dialog").addEventListener("click", () => $("#class-dialog").close());
  $("#cancel-class-button").addEventListener("click", () => $("#class-dialog").close());
  $("#random-group-id").addEventListener("change", updateGroupIdFields);
  $("#class-dialog").addEventListener("click", event => {
    if (event.target === $("#class-dialog")) $("#class-dialog").close();
  });

  $("#class-form").addEventListener("submit", async event => {
    event.preventDefault();
    if (state.pending) return;
    const item = {
      id: $("#class-id").value || undefined,
      requestedId: !$("#class-id").value && !$("#random-group-id").checked
        ? $("#custom-group-id").value.trim() : undefined,
      name: $("#class-name").value.trim(),
      subject: $("#class-subject").value.trim(),
      weekday: Number($("#class-weekday").value),
      start: $("#class-start").value,
      end: $("#class-end").value,
      room: $("#class-room").value.trim()
    };
    if (!item.id && !$("#random-group-id").checked && !item.requestedId) {
      $("#class-error").textContent = "Enter a custom group ID or choose random ID generation.";
      $("#class-error").hidden = false;
      return;
    }
    if (item.requestedId && !/^[A-Za-z0-9][A-Za-z0-9._ -]{0,79}$/.test(item.requestedId)) {
      $("#class-error").textContent = "Group ID must start with a letter or number and use only letters, numbers, spaces, dots, underscores, or hyphens.";
      $("#class-error").hidden = false;
      return;
    }
    if (item.start >= item.end) {
      $("#class-error").textContent = "End time must be after start time.";
      $("#class-error").hidden = false;
      return;
    }
    const conflict = state.classes.find(existing => existing.active && existing.id !== item.id &&
      Number(existing.weekday) === item.weekday && minutes(item.start) < minutes(existing.end) &&
      minutes(item.end) > minutes(existing.start));
    if (conflict) {
      $("#class-error").textContent = "This time overlaps with " + conflict.name + " (" +
        conflict.start + "–" + conflict.end + ") on " + WEEKDAYS[item.weekday - 1] + ".";
      $("#class-error").hidden = false;
      return;
    }
    state.pending = true;
    $("#save-class-button").disabled = true;
    $("#save-class-button").textContent = "Saving…";
    $("#class-error").hidden = true;
    try {
      const saved = await dataAccess.saveClass({token: state.token, class: item});
      $("#class-dialog").close();
      state.selectedClassId = saved.id;
      if (Number(item.weekday) !== weekday(state.selectedDate)) {
        state.selectedDate = addDays(mondayOf(state.selectedDate), Number(item.weekday) - 1);
      }
      upsert(state.classes, existing => existing.id === saved.id, saved);
      finishWrite("Class saved.");
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
      const saved = await dataAccess.archiveClass({token: state.token, classId: id});
      $("#class-dialog").close();
      state.selectedClassId = "";
      const archived = state.classes.find(item => item.id === saved.id);
      if (archived) Object.assign(archived, {active: false, updatedAt: saved.updatedAt});
      finishWrite("Class archived.");
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
}
