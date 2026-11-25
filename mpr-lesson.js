"use strict";

const skillIcons = { Speaking: "🗣️", Listening: "🎧", Reading: "📖", Writing: "✍️" };

function createLessonMpr(options) {
  const M = options.model;
  const feedback = options.feedback;
  const drafts = new Map();
  const draftRevisions = new Map();
  const el = (tag, text, cls) => {
    const item = document.createElement(tag);
    if (text != null) item.textContent = text;
    if (cls) item.className = cls;
    return item;
  };
  function button(label, action, primary = false) {
    const b = el("button", label, "button " + (primary ? "button-primary" : "button-quiet"));
    b.type = "button";
    b.addEventListener("click", action);
    return b;
  }
  function field(parent, label, value, onChange, spec = {}) {
    const wrap = el("label", label, "mpr-field");
    const input = el(spec.options ? "select" : spec.area ? "textarea" : "input");
    input.setAttribute("aria-label", label);
    if (spec.options)
      for (const option of spec.options) {
        const [key, text] = Array.isArray(option) ? option : [option, option];
        const node = el("option", text);
        node.value = key;
        input.append(node);
      }
    if (!spec.options && !spec.area) input.type = spec.type || "text";
    if (input.type === "number") {
      input.min = "0";
      input.max = String(spec.max ?? 1000);
      input.step = String(spec.step ?? 0.01);
    }
    if (spec.placeholder) input.placeholder = spec.placeholder;
    if (spec.maxDate) input.max = spec.maxDate;
    input.value = value ?? "";
    input.addEventListener(spec.options ? "change" : "input", () => onChange(input.value));
    wrap.append(input);
    parent.append(wrap);
    return input;
  }
  function tick(parent, label, checked, onChange) {
    const wrap = el("label", null, "mpr-check"),
      input = el("input");
    input.type = "checkbox";
    input.checked = Boolean(checked);
    input.addEventListener("change", () => onChange(input.checked));
    wrap.append(input, document.createTextNode(label));
    parent.append(wrap);
    return input;
  }
  function keepDraft(key, value) {
    if (!drafts.has(key)) draftRevisions.set(key, options.rows().find((r) => r.key === key)?.revision || "");
    drafts.set(key, value);
  }
  function updateStatus(value, status) {
    if (value.status === status) return;
    if (M.missed(status)) {
      value.hours = 0;
      value.confirmed = true;
    } else if (M.missed(value.status)) {
      value.hours = 1;
      value.confirmed = value.date <= options.today();
    }
    value.status = status;
  }
  function baseLesson(item, date, status) {
    const config =
      M.get(options.rows(), "month|" + date.slice(0, 7))?.groups.find((g) => g.id === item.id) ||
      M.get(options.rows(), "group|" + item.id) ||
      {};
    const saved = M.get(options.rows(), M.recordKey(item.id, date));
    const value = structuredClone(
      saved || {
        date,
        classId: item.id,
        grade: config.grade ?? M.gradeFrom(item.name),
        category: config.category || "Regular",
        hours: 1,
        confirmed: date <= options.today(),
        highlight: true,
        outcomes: {},
        useRoster: true,
      },
    );
    updateStatus(value, status);
    return value;
  }
  function outcomeInputs(parent, value, changed) {
    const skills = el("fieldset", null, "mpr-choice-group");
    const chips = el("div", null, "mpr-chips");
    const inputs = el("div");
    skills.append(el("legend", "Which skills did students practise?", "mpr-caption"), chips);
    parent.append(skills, inputs);
    value.outcomes ||= {};
    for (const skill of M.skills) {
      const area = field(
        inputs,
        skill + " · What could students do?",
        value.outcomes[skill],
        (v) => {
          value.outcomes[skill] = v;
          changed();
        },
        { area: true },
      );
      const row = area.parentElement;
      row.hidden = !(skill in value.outcomes);
      const pill = button("", () => {
        const on = row.hidden;
        row.hidden = !on;
        pill.setAttribute("aria-pressed", String(on));
        if (on) value.outcomes[skill] = area.value;
        else delete value.outcomes[skill];
        changed();
      });
      pill.className = "mpr-pill mpr-skill";
      pill.setAttribute("aria-label", skill);
      pill.setAttribute("aria-pressed", String(!row.hidden));
      const icon = el("span", skillIcons[skill], "mpr-skill-icon");
      const tooltip = el("span", skill, "mpr-skill-tooltip");
      icon.setAttribute("aria-hidden", "true");
      tooltip.setAttribute("aria-hidden", "true");
      pill.append(icon, tooltip);
      chips.append(pill);
    }
    field(parent, "Evidence or work sample (optional)", value.evidence, (v) => {
      value.evidence = v;
      changed();
    });
    tick(parent, "Use this outcome in the monthly progress summary", value.highlight ?? true, (v) => {
      value.highlight = v;
      changed();
    }).parentElement.classList.add("mpr-summary-check");
  }
  function attendees(parent, value, role, changed) {
    const heading = el("div", null, "mpr-people");
    parent.append(heading);
    const directory = new Map();
    const teacher = role === "Master Class";
    for (const r of options.rows()) {
      if ((r.value.category || r.value.kind) !== role && r.value.kind !== role) continue;
      for (const p of r.value.attendees || []) directory.set(p.id, p);
    }
    if (!teacher)
      for (const student of options.data().students) {
        const group = options.data().classes.find((g) => g.id === student.officialGroupId);
        if (!directory.has(student.id))
          directory.set(student.id, {
            id: student.id,
            name: student.name,
            grade: M.gradeFrom(group?.name || student.officialGroupId),
          });
      }
    value.attendees ||= [];
    for (const p of value.attendees) directory.set(p.id, p);
    function draw() {
      heading.replaceChildren();
      heading.append(el("strong", teacher ? "Local teachers who attended" : "Students who attended"));
      for (const person of value.attendees) {
        const b = button(person.name + (person.grade ? " · Grade " + person.grade : "") + " ×", () => {
          value.attendees = value.attendees.filter((p) => p.id !== person.id);
          changed();
          draw();
        });
        b.setAttribute("aria-label", "Remove " + person.name);
        heading.append(b);
      }
      const choices = [
        ["", "Choose a person"],
        ...[...directory.values()]
          .filter((p) => !value.attendees.some((a) => a.id === p.id))
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((p) => [p.id, p.name + (p.grade ? " · Grade " + p.grade : "")]),
      ];
      field(
        heading,
        "Add existing attendee",
        "",
        (id) => {
          if (id) {
            value.attendees.push({ ...directory.get(id) });
            changed();
            draw();
          }
        },
        { options: choices },
      );
      let name = "",
        grade = "";
      const add = el("details");
      add.append(el("summary", "New attendee"));
      heading.append(add);
      field(add, "Full name", "", (v) => (name = v));
      if (!teacher)
        field(add, "Grade", "", (v) => (grade = v), {
          options: ["", ...Array.from({ length: 11 }, (_, i) => String(i + 1))],
        });
      add.append(
        button("Add person", () => {
          if (!name.trim() || (!teacher && !grade)) {
            feedback("Enter a name" + (teacher ? "." : " and grade."), true);
            return;
          }
          const person = { id: crypto.randomUUID(), name: name.trim(), grade };
          directory.set(person.id, person);
          value.attendees.push(person);
          changed();
          draw();
        }),
      );
    }
    draw();
  }
  function sessionInputs(parent, value, changed, scheduled) {
    if (value.category === "ECA")
      field(
        parent,
        "ECA type",
        value.activityType,
        (v) => {
          value.activityType = v;
          changed();
        },
        { placeholder: "e.g. Speaking Club" },
      );
    if (!scheduled)
      field(parent, "Topic", value.topic, (v) => {
        value.topic = v;
        changed();
      });
    field(
      parent,
      "What was the outcome or impact?",
      value.impact,
      (v) => {
        value.impact = v;
        changed();
      },
      { area: true },
    );
    const people = el("div");
    if (scheduled && value.category === "ECA")
      tick(parent, "Use students marked present or late in this lesson", value.useRoster, (v) => {
        value.useRoster = v;
        people.hidden = v;
        changed();
      });
    people.hidden = scheduled && value.category === "ECA" && value.useRoster;
    parent.append(people);
    attendees(people, value, value.category, changed);
  }
  function lessonControls(host, value, changed, redraw) {
    const body = el("div", null, "mpr-form");
    host.append(body);
    if (M.missed(value.status)) {
      body.append(el("p", "0 teaching hours · " + value.status, "field-hint"));
      field(body, "Why was the lesson missed?", value.reason, (v) => {
        value.reason = v;
        changed();
      });
      return;
    }
    const category = el("fieldset", null, "mpr-choice-group");
    const choices = el("div", null, "mpr-chips");
    category.append(el("legend", "Reporting category"), choices);
    body.append(category);
    for (const label of M.categories) {
      const choice = el("label", null, "mpr-category");
      const input = el("input");
      input.type = "radio";
      input.name = options.element().id + "-category";
      input.value = label;
      input.checked = value.category === label;
      input.addEventListener("change", () => {
        value.category = label;
        value.useRoster = label === "ECA";
        value.attendees = [];
        changed();
        redraw();
        options.element().querySelector(".mpr-category input:checked")?.focus({ preventScroll: true });
      });
      choice.append(input, el("span", label, "mpr-pill"));
      choices.append(choice);
    }
    field(
      body,
      "Number periods",
      value.hours,
      (v) => {
        value.hours = v === "" ? "" : Number(v);
        changed();
      },
      { type: "number", max: 24 },
    );
    tick(body, "I taught these hours", value.confirmed, (v) => {
      value.confirmed = v;
      changed();
    });
    if (["ECA", "Master Class"].includes(value.category)) sessionInputs(body, value, changed, true);
    else if (value.category === "Regular") {
      const group = el("details");
      group.open = !value.grade;
      group.append(el("summary", value.grade ? "Grade " + value.grade : "Choose grade"));
      body.append(group);
      field(
        group,
        "Report under grade",
        value.grade,
        (v) => {
          value.grade = v;
          changed();
          group.querySelector("summary").textContent = "Grade " + v;
        },
        { options: ["", ...Array.from({ length: 11 }, (_, i) => String(i + 1))] },
      );
      outcomeInputs(body, value, changed);
    }
  }
  function renderInline() {
    const host = options.element();
    if (!host) return;
    const item = options.lesson();
    host.hidden = !item;
    host.replaceChildren();
    if (host.hidden) return;
    const key = M.recordKey(item.id, item.date);
    const status = options.status();
    const value = drafts.get(key) || baseLesson(item, item.date, status);
    updateStatus(value, status);
    const changed = () => {
      keepDraft(key, value);
      options.changed();
    };
    const heading = el("h3", "MPR note", "mpr-note-heading");
    heading.tabIndex = -1;
    host.append(heading);
    const problem = options.unavailable();
    if (problem) host.append(el("p", problem, "field-hint"));
    const fields = el("fieldset", null, "mpr-note-fields");
    fields.disabled = Boolean(problem);
    fields.setAttribute("aria-label", "Class MPR note");
    host.append(fields);
    lessonControls(fields, value, changed, renderInline);
    if (M.get(options.rows(), key) && !drafts.has(key)) host.append(el("p", "MPR note saved", "field-hint"));
    options.afterRender?.(host);
  }
  function statusChanged() {
    const item = options.lesson();
    if (options.unavailable() || !item) return;
    const key = M.recordKey(item.id, item.date);
    if (!drafts.has(key)) keepDraft(key, baseLesson(item, item.date, options.status()));
    renderInline();
  }
  function validateEntry(v) {
    if (v.confirmed && !M.missed(v.status) && v.date > options.today())
      throw new Error("Confirm teaching hours after the session has taken place.");
    if (v.confirmed && !M.missed(v.status) && (!Number.isFinite(v.hours) || v.hours <= 0 || v.hours > 24))
      throw new Error("Enter the number of periods taught, or clear the confirmation.");
    if (v.originalDate && v.originalDate > v.date)
      throw new Error("The original missed date must be on or before the make-up.");
  }
  function prepareInline(key) {
    if (options.unavailable()) return null;
    const item = options.lesson();
    if (!item || M.recordKey(item.id, item.date) !== key) return null;
    let draft = drafts.get(key);
    if (!draft && !M.get(options.rows(), key) && item.date <= options.today()) {
      draft = baseLesson(item, item.date, options.status());
      keepDraft(key, draft);
    }
    if (!draft) return null;
    updateStatus(draft, options.status());
    validateEntry(draft);
    return structuredClone(draft);
  }
  async function saveInline(key, sent) {
    if (!sent) return true;
    const revision = await options.write(key, sent, draftRevisions.get(key));
    draftRevisions.set(key, revision);
    if (JSON.stringify(drafts.get(key)) === JSON.stringify(sent)) {
      drafts.delete(key);
      draftRevisions.delete(key);
    }
    renderInline();
  }
  function clear() {
    drafts.clear();
    draftRevisions.clear();
    options.element()?.replaceChildren();
  }
  return {
    el,
    button,
    field,
    tick,
    outcomeInputs,
    sessionInputs,
    validateEntry,
    clear,
    renderInline,
    statusChanged,
    prepareInline,
    saveInline,
    dirty: (key) => drafts.has("lesson|" + key),
    hasChanges: () => drafts.size > 0,
  };
}
if (typeof module !== "undefined") module.exports = createLessonMpr;
