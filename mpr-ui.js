"use strict";

function createMprDesk() {
  const M = MprModel;
  let records = [],
    ready = false,
    tab = "Today",
    day,
    month,
    selected = "",
    busy = false;
  let editorDirty = false,
    listPosition = 0,
    returnToDay = false;
  let loadError = "";
  const expanded = new Set();
  const groupOptions = () => [...new Map(state.classes.map((g) => [g.id, [g.id, g.name]])).values()];
  function feedback(message, bad = false) {
    const target = $("#mpr-editor").open
      ? $("#mpr-editor-message")
      : $("#mpr-dialog").open
        ? $("#mpr-message")
        : $("#lesson-status");
    target.textContent = message;
    target.classList.toggle("error", bad);
    if (bad && !$("#mpr-dialog").open && !$("#mpr-editor").open) setNotice(message, true);
  }
  const revisionFor = (key) => records.find((r) => r.key === key)?.revision || "";
  async function write(key, value, revision = revisionFor(key)) {
    const saved = await request("saveMpr", {
      token: state.token,
      record: { key, revision, value },
    });
    if (!saved?.revision || saved.key !== key)
      throw new Error("The MPR save could not be confirmed. Retry this entry.");
    upsert(records, (r) => r.key === key, saved);
    return saved.revision;
  }
  function load(rows, error) {
    loadError = error || "";
    ready = Array.isArray(rows);
    records = rows || [];
    $("#mpr-open").disabled = !state.token;
  }
  function reset() {
    inline.clear();
    history.clear();
    expanded.clear();
    records = [];
    ready = false;
    editorDirty = false;
    returnToDay = false;
    for (const id of ["#mpr-editor", "#mpr-dialog"]) if ($(id).open) $(id).close();
    $("#mpr-content").replaceChildren();
    $("#mpr-editor-body").replaceChildren();
    $("#mpr-inline").replaceChildren();
    $("#mpr-open").disabled = true;
  }
  const lessonOptions = {
    model: M,
    rows: () => records,
    data: () => state,
    today: todayInTashkent,
    feedback,
    write,
    unavailable: () =>
      ready ? "" : loadError || "To save MPR notes, run setupMpr and update your Apps Script deployment.",
  };
  const inline = createLessonMpr({
    ...lessonOptions,
    element: () => $("#mpr-inline"),
    sectioned: true,
    lesson: selectedLesson,
    status: lessonStatusValue,
    changed: updateTeachingSaveState,
    afterRender: (host) => {
      window.syncLessonStudioSummary?.(true);
      if (returnToDay) host.append(button("Back to MPR", open));
    },
  });
  const history = createLessonMpr({
    ...lessonOptions,
    element: () => $("#record-mpr"),
    lesson: () =>
      editingRecord && { id: editingRecord.classId, name: editingRecord.className, date: editingRecord.date },
    status: () => $("#record-lessonStatus").value.trim(),
    changed: () => {},
  });
  const { el, button, field, tick, outcomeInputs, sessionInputs, validateEntry, renderInline } = inline;
  async function saveInline(key, sent) {
    try {
      await inline.saveInline(key, sent);
      return true;
    } catch (error) {
      feedback("Lesson saved. MPR note still needs saving. " + error.message, true);
      if (isSessionError(error)) handleError(error);
      return false;
    }
  }
  function open() {
    if (!state.token || busy || state.pending || state.savingAll) return;
    if (!returnToDay) {
      day = todayInTashkent();
      month = day.slice(0, 7);
      selected = "";
      tab = "Today";
    }
    returnToDay = false;
    $("#mpr-dialog").showModal();
    draw();
  }
  function draw() {
    const body = $("#mpr-content");
    body.replaceChildren();
    $("#mpr-message").textContent = "";
    for (const name of ["Today", "Monthly report"]) {
      const b = $(name === "Today" ? "#mpr-today" : "#mpr-month");
      b.setAttribute("aria-pressed", String(tab === name));
    }
    if (!ready) {
      body.append(
        el(
          "p",
          loadError ||
            "To enable MPR, install the updated Apps Script files, run setupMpr and update your web app deployment.",
          "mpr-empty",
        ),
      );
      return;
    }
    if (tab === "Today") drawToday(body);
    else drawReport(body);
  }
  function openLesson(id, date) {
    if (state.pending || state.savingAll) return;
    returnToDay = true;
    selected = M.recordKey(id, date);
    saveDraft();
    saveChecklistDraft();
    state.selectedDate = date;
    state.selectedClassId = id;
    state.view = "day";
    $("#mpr-dialog").close();
    render();
    const target = $("#mpr-inline");
    target.scrollIntoView({ block: "center" });
    const studioSection = target.closest(".is-studio") && target.querySelector('[data-lesson-section="mpr"]');
    if (studioSection) {
      studioSection.open = true;
      studioSection.querySelector("summary").focus();
    } else {
      target.querySelector(".mpr-note-heading")?.focus();
    }
  }
  function dayRows(date) {
    const rows = lessonsOn(date).map((item) => {
      const key = M.recordKey(item.id, date),
        note = M.get(records, key),
        log = logFor(item.id, date);
      let status = "Needs confirmation";
      if (M.missed(log?.lessonStatus)) status = log.lessonStatus;
      else if (note?.confirmed && log && (log.lessonStatus !== "Late" || note.status === "Late")) {
        const outcomes = Object.values(M.allOutcomes(note));
        status =
          note.category === "Regular" && (!outcomes.length || outcomes.some((v) => !v.trim()))
            ? "Needs outcome"
            : "Complete";
      }
      return { key, title: item.name, time: item.start, status, item, note, log };
    });
    for (const r of records.filter(
      (r) => r.key.startsWith("activity|") && r.value.date === date && !r.value.removed,
    )) {
      const v = r.value;
      rows.push({
        key: r.key,
        title: v.kind,
        time: "",
        status: v.group || v.session || v.role || "",
        value: v,
      });
    }
    return rows;
  }
  function drawToday(body) {
    const tools = el("div", null, "mpr-toolbar");
    field(
      tools,
      "School date",
      day,
      (v) => {
        if (v) {
          day = v;
          month = v.slice(0, 7);
          selected = "";
          draw();
        }
      },
      { type: "date" },
    );
    tools.append(button("Add activity", () => editActivity(), true));
    body.append(tools);
    const columns = el("div", null, "mpr-columns"),
      list = el("div", null, "mpr-list"),
      detail = el("article", null, "mpr-detail");
    body.append(columns);
    columns.append(list, detail);
    const rows = dayRows(day);
    if (!rows.length) {
      list.append(el("p", "No sessions recorded for this date.", "mpr-empty"));
      detail.hidden = true;
      return;
    }
    const active = rows.find((r) => r.key === selected) || rows[0];
    selected = active.key;
    for (const row of rows) {
      const b = button("", () => {
        listPosition = list.scrollTop;
        selected = row.key;
        if (window.matchMedia("(max-width: 650px)").matches) {
          if (row.item) openLesson(row.item.id, day);
          else editActivity(row.key);
        } else {
          draw();
          $("#mpr-day-action")?.focus();
        }
      });
      b.classList.add("mpr-session");
      b.setAttribute("aria-pressed", String(row.key === active.key));
      b.append(el("strong", [row.time, row.title].filter(Boolean).join(" · ")), el("span", row.status));
      list.append(b);
    }
    list.scrollTop = listPosition;
    detail.append(
      el("h3", active.title),
      el("p", [day, active.time, active.status].filter(Boolean).join(" · "), "field-hint"),
    );
    if (active.item) {
      const v = active.note || {},
        log = active.log || {};
      for (const line of [
        log.unit,
        log.lessonTitle,
        ...Object.entries(M.allOutcomes(v)).map(([s, t]) => s + " · " + t),
        v.evidence,
        v.reason,
      ])
        if (line) detail.append(el("p", line));
      const b = button("Open lesson note", () => openLesson(active.item.id, day), true);
      b.id = "mpr-day-action";
      detail.append(b);
    } else {
      for (const line of [active.value.topic, active.value.detail, active.value.impact, active.value.reason])
        if (line) detail.append(el("p", line));
      const b = button("Edit activity", () => editActivity(active.key), true);
      b.id = "mpr-day-action";
      detail.append(b);
    }
  }

  let saveEditor;
  function editor(title, save) {
    editorDirty = false;
    saveEditor = save;
    $("#mpr-editor-title").textContent = title;
    $("#mpr-editor-message").textContent = "";
    const body = $("#mpr-editor-body");
    body.replaceChildren();
    $("#mpr-editor-save").hidden = !save;
    $("#mpr-editor-remove").hidden = true;
    $("#mpr-editor").showModal();
    return body;
  }
  function closeEditor() {
    if (busy || (editorDirty && !window.confirm("Discard unsaved MPR changes?"))) return;
    $("#mpr-editor").close();
  }
  async function runEditor(action) {
    if (busy || !action) return;
    const form = $("#mpr-editor-form");
    if (!form.reportValidity()) return;
    busy = true;
    $("#mpr-editor-fields").disabled = true;
    $("#mpr-editor-save").disabled = true;
    $("#mpr-editor-remove").disabled = true;
    try {
      await action();
      editorDirty = false;
      $("#mpr-editor").close();
      draw();
      renderInline();
      feedback("Saved to your teaching records.");
    } catch (e) {
      feedback(e.message, true);
      if (isSessionError(e)) handleError(e);
    } finally {
      busy = false;
      $("#mpr-editor-fields").disabled = false;
      $("#mpr-editor-save").disabled = false;
      $("#mpr-editor-remove").disabled = false;
    }
  }
  function editActivity(key) {
    const editing = Boolean(key);
    key ||= "activity|" + crypto.randomUUID();
    const v = structuredClone(
      M.get(records, key) || {
        kind: "Make-up lesson",
        date: day || todayInTashkent(),
        category: "Regular",
        hours: 1,
        confirmed: false,
      },
    );
    const body = editor(editing ? "Edit activity" : "Add activity", async () => {
      if (!v.date) throw new Error("Choose an activity date.");
      if (v.date > todayInTashkent() && !["ECA", "Master Class", "Make-up lesson"].includes(v.kind))
        throw new Error("Record this activity after it takes place.");
      if (v.kind === "Make-up lesson" && !v.group?.trim()) throw new Error("Choose or enter the group.");
      if (
        ["ECA", "Master Class", "Make-up lesson"].includes(v.kind) &&
        !v.confirmed &&
        v.date <= todayInTashkent()
      )
        throw new Error("Confirm the actual hours taught before saving this activity.");
      if (v.confirmed && v.date > todayInTashkent())
        throw new Error("Confirm hours after the session has taken place.");
      validateEntry(v);
      await write(key, v);
      day = v.date;
      selected = key;
    });
    if (editing) {
      const remove = $("#mpr-editor-remove");
      remove.hidden = false;
      remove.onclick = () => {
        if (window.confirm("Remove this activity from your MPR?"))
          runEditor(() => write(key, { ...v, removed: true }));
      };
    }
    const changed = () => {
      editorDirty = true;
    };
    function build() {
      body.replaceChildren();
      const bind = (label, prop, spec = {}) =>
        field(
          body,
          label,
          v[prop],
          (x) => {
            v[prop] = x;
            changed();
          },
          spec,
        );
      const select = field(
        body,
        "Activity",
        v.kind,
        (kind) => {
          const date = v.date;
          for (const p of Object.keys(v)) delete v[p];
          Object.assign(v, {
            kind,
            date,
            category: kind === "Make-up lesson" ? "Regular" : kind,
            hours: 1,
            confirmed: false,
          });
          changed();
          build();
        },
        { options: M.activities },
      );
      select.disabled = editing;
      bind("Date", "date", { type: "date" }).required = true;
      if (["ECA", "Master Class", "Make-up lesson"].includes(v.kind)) {
        if (v.kind === "Make-up lesson") {
          field(
            body,
            "Lesson category",
            v.category,
            (c) => {
              v.category = c;
              v.attendees = [];
              changed();
              build();
            },
            { options: M.categories },
          );
          field(
            body,
            "Timetable group",
            v.classId || "",
            (id) => {
              const group = state.classes.find((g) => g.id === id);
              v.classId = id;
              v.group = group?.name || "";
              v.grade = M.get(records, "group|" + id)?.grade || M.gradeFrom(v.group);
              changed();
              build();
            },
            { options: [["", "Enter a group below"], ...groupOptions()] },
          );
          bind("Group", "group").required = true;
          if (v.category === "Regular")
            bind("Grade", "grade", {
              options: ["", ...Array.from({ length: 11 }, (_, i) => String(i + 1))],
            }).required = true;
          bind("Original missed date", "originalDate", { type: "date" });
          bind("Reason", "reason", { placeholder: "e.g. Fall holiday, tests or sick leave" }).required = true;
        } else v.category = v.kind;
        field(
          body,
          "Actual teaching hours",
          v.hours,
          (x) => {
            v.hours = x === "" ? "" : Number(x);
            changed();
          },
          { type: "number", max: 24 },
        );
        tick(body, "I taught these hours", v.confirmed, (x) => {
          v.confirmed = x;
          changed();
        });
        if (["ECA", "Master Class"].includes(v.category)) sessionInputs(body, v, changed, false);
        else {
          bind("Topic", "topic");
          if (v.category === "Regular") outcomeInputs(body, v, changed);
        }
      } else if (v.kind === "Online CPD") {
        bind("Session attended", "session").required = true;
        bind("Main topics", "topic", { area: true });
        bind("How did you apply it?", "application", { area: true });
      } else if (v.kind === "Observation") {
        v.role ||= M.roles[0];
        bind("Observer’s role", "role", { options: M.roles });
        bind("Feedback or follow-up", "detail", { area: true });
      } else if (v.kind === "Testing") {
        const statuses = [
          "Not started yet",
          "In progress",
          "Administered · results pending",
          "Administered · results submitted",
          "No-Test Report submitted",
          "Could not administer",
          "Exempt",
          "This is not a test month",
        ];
        v.testStatus ||= statuses[0];
        bind("Test status", "testStatus", { options: statuses });
        bind("Groups, components completed or issues", "detail", { area: true });
      } else if (v.kind === "Achievement") {
        v.achievementType ||= "Positive development";
        bind("Achievement type", "achievementType", {
          options: ["Positive development", "Student", "Professional"],
        });
        bind("What happened?", "detail", { area: true }).required = true;
        bind("Proof reference", "proof", { placeholder: "e.g. Certificate or result sheet" });
      } else {
        bind(v.kind === "Challenge" ? "What was the challenge?" : "What is your next priority?", "detail", {
          area: true,
        }).required = true;
        if (v.kind === "Challenge") bind("What support would help?", "support", { area: true });
      }
    }
    build();
  }
  function configure(report) {
    const snapshot = M.get(records, "month|" + month);
    const profile = structuredClone(report.profile),
      groups = structuredClone(report.groups);
    let note = snapshot?.note || "",
      focus = 0;
    const reusable = new Map();
    const weeklyOverrides = { ...report.weeklyOverrides };
    const body = editor("Confirm this month’s setup", async () => {
      // Freeze this month's confirmed figures. Reusable defaults are stored separately.
      for (const [id, config] of reusable) await write("group|" + id, config);
      if (JSON.stringify(profile) !== JSON.stringify(report.profile) || !M.get(records, "profile"))
        await write("profile", profile);
      if (JSON.stringify(weeklyOverrides) !== JSON.stringify(report.weeklyOverrides))
        await write("weeklyLoad", weeklyOverrides);
      await write("month|" + month, { profile, groups, note, weeklyOverrides });
    });
    const changed = () => {
      editorDirty = true;
    };
    body.append(
      el(
        "p",
        "Confirm your usual weekly load and the groups you taught in " +
          month +
          ". These figures stay with this report.",
        "field-hint",
      ),
    );
    const p = el("details");
    p.open = !profile.teacher;
    p.append(el("summary", "Teacher and school"));
    body.append(p);
    for (const [key, label] of Object.entries(M.profileLabels))
      field(
        p,
        label,
        profile[key],
        (v) => {
          profile[key] = v;
          changed();
        },
        key === "joined" ? { type: "date" } : {},
      );
    const gbox = el("section");
    body.append(gbox);
    function drawGroup() {
      gbox.replaceChildren();
      if (!groups.length) {
        gbox.append(el("p", "Add a group if you taught one this month."));
      } else {
        field(
          gbox,
          "Monthly teaching groups",
          String(focus),
          (v) => {
            focus = Number(v);
            drawGroup();
          },
          { options: groups.map((g, i) => [String(i), g.name]) },
        );
        const group = groups[focus];
        const edit = (label, prop, spec = {}) =>
          field(
            gbox,
            label,
            group[prop],
            (v) => {
              group[prop] = spec.type === "number" && v !== "" ? Number(v) : v;
              if (["grade", "hours", "weekly", "category", "teachers", "sharing"].includes(prop)) {
                const config = {
                  ...(M.get(records, "group|" + group.id) || {}),
                  ...(reusable.get(group.id) || {}),
                  [prop]: group[prop],
                };
                reusable.set(group.id, config);
              }
              changed();
            },
            spec,
          );
        edit("Group name on the report", "name");
        edit("Grade", "grade", { options: ["", ...Array.from({ length: 11 }, (_, i) => String(i + 1))] });
        edit("Reporting category", "category", { options: M.categories });
        edit("Usual teaching hours per session", "hours", { type: "number", max: 24 });
        edit("Hours you personally teach per week", "weekly", { type: "number", max: 28 });
        edit("Enrolled students", "students", { type: "number", step: 1 });
        edit("Local co-teachers (names separated by commas)", "teachers");
        edit("Sharing with another foreign teacher", "sharing", {
          placeholder: "e.g. I teach my groups alone",
        });
        gbox.append(
          button("Exclude group from this month", () => {
            groups.splice(focus, 1);
            focus = 0;
            changed();
            drawGroup();
          }),
        );
      }
      const missing = M.groupsFor(state, records, month).filter((g) => !groups.some((i) => i.id === g.id));
      if (missing.length)
        field(
          gbox,
          "Include a group",
          "",
          (id) => {
            if (!id) return;
            groups.push(missing.find((g) => g.id === id));
            focus = groups.length - 1;
            changed();
            drawGroup();
          },
          { options: [["", "Choose a group"], ...missing.map((g) => [g.id, g.name])] },
        );
    }
    drawGroup();
    const loadBox = el("details");
    loadBox.append(el("summary", "Weekly hours by category"));
    loadBox.append(
      el(
        "p",
        "Leave a category empty to use the timetable. Enter your usual weekly hours here for clubs or Master Classes held outside it.",
        "field-hint",
      ),
    );
    for (const category of M.categories)
      field(
        loadBox,
        category + " weekly hours",
        weeklyOverrides[category],
        (v) => {
          if (v === "") delete weeklyOverrides[category];
          else weeklyOverrides[category] = Number(v);
          changed();
        },
        { type: "number", max: 28, placeholder: "Use timetable" },
      );
    body.append(loadBox);
    field(
      body,
      "Timetable notes",
      note,
      (v) => {
        note = v;
        changed();
      },
      { area: true },
    );
  }
  function openSource(key) {
    if (key.startsWith("activity|")) {
      editActivity(key);
      return;
    }
    const parts = key.split("|");
    openLesson(parts.slice(1, -1).join("|"), parts.at(-1));
  }
  function answerEditor(f, row) {
    const key = "answer|" + month + "|" + f.id;
    let value = row?.text ?? f.text;
    const body = editor(f.label, () => write(key, { text: value, source: f.text }));
    if (row && row.source !== f.text) {
      body.append(
        el("p", "Source notes changed. Compare your wording with the current draft.", "mpr-warning"),
        el("p", f.text || "No source text available.", "mpr-source"),
      );
    }
    const input = field(
      body,
      "Answer to copy into the MPR",
      value,
      (v) => {
        value = v;
        editorDirty = true;
      },
      { area: true },
    );
    if (row)
      body.append(
        button("Use current draft", () => {
          value = f.text;
          input.value = value;
          editorDirty = true;
          input.focus();
        }),
      );
    body.append(el("h4", "Source records"));
    if (!f.sources.length)
      body.append(el("p", "This answer comes from your setup or manual review.", "field-hint"));
    for (const s of f.sources)
      body.append(
        button(s.label, () => {
          if (editorDirty && !window.confirm("Discard unsaved edits and open the source?")) return;
          editorDirty = false;
          $("#mpr-editor").close();
          openSource(s.key);
        }),
      );
  }
  async function copy(text) {
    try {
      await navigator.clipboard.writeText(text);
      feedback("Answer copied.");
    } catch {
      const body = editor("Copy answer");
      const t = el("textarea");
      t.value = text;
      t.readOnly = true;
      body.append(t);
      t.focus();
      t.select();
    }
  }
  function drawReport(body) {
    const r = M.report(state, records, month, todayInTashkent());
    const tools = el("div", null, "mpr-toolbar");
    field(
      tools,
      "Reporting month",
      month,
      (v) => {
        if (v) {
          month = v;
          draw();
        }
      },
      { type: "month" },
    );
    tools.append(button(r.confirmed ? "Review monthly setup" : "Confirm monthly setup", () => configure(r)));
    body.append(tools);
    const totals = el("div", null, "mpr-totals");
    for (const [key, label] of [
      ["normal", "Normal timetable"],
      ["makeup", "Make-up"],
      ["combined", "Total taught"],
    ]) {
      const card = el("div");
      card.append(el("span", label), el("strong", r.totals[key] + " h"));
      totals.append(card);
    }
    body.append(totals);
    if (!r.confirmed)
      body.append(
        el(
          "p",
          "Weekly load and roster figures are provisional until you confirm this month’s setup.",
          "mpr-warning",
        ),
      );
    const sections = new Map(),
      answers = new Map();
    if (r.gaps.length) {
      const gaps = el("details", null, "mpr-gaps");
      gaps.append(el("summary", r.gaps.length + " items to review"));
      for (const g of r.gaps)
        gaps.append(
          button(g.text, () => {
            if (g.key) openSource(g.key);
            else answers.get(g.field)?.click();
          }),
        );
      body.append(gaps);
    }
    for (const f of r.fields) {
      if (!sections.has(f.section)) {
        const section = el("details", null, "mpr-section");
        section.append(el("summary", f.section));
        const sectionKey = month + "|" + f.section;
        section.open = expanded.has(sectionKey);
        section.addEventListener("toggle", () => {
          if (section.isConnected) {
            if (section.open) expanded.add(sectionKey);
            else expanded.delete(sectionKey);
          }
        });
        body.append(section);
        sections.set(f.section, section);
      }
      const manual = M.get(records, "answer|" + month + "|" + f.id),
        text = manual?.text ?? f.text;
      const item = el("div", null, "mpr-answer"),
        desc = el("div");
      desc.append(el("h4", f.label), el("p", text || "No answer recorded.", text ? "" : "field-hint"));
      if (manual && manual.source !== f.text)
        desc.append(el("span", "Source changed · review your wording", "mpr-warning"));
      const actions = el("div", null, "mpr-answer-actions");
      const edit = button("Edit", () => answerEditor(f, manual)),
        clip = button("Copy answer", () => copy(text));
      clip.disabled = !text;
      actions.append(edit, clip);
      if (f.sources.length)
        actions.append(
          button("View notes", () => {
            const b = editor(f.label + " · source records");
            for (const s of f.sources)
              b.append(
                button(s.label, () => {
                  $("#mpr-editor").close();
                  openSource(s.key);
                }),
              );
          }),
        );
      answers.set(f.id, edit);
      item.append(desc, actions);
      sections.get(f.section).append(item);
    }
  }
  $("#mpr-open").addEventListener("click", open);
  $("#mpr-close").addEventListener("click", () => $("#mpr-dialog").close());
  $("#mpr-today").addEventListener("click", () => {
    tab = "Today";
    draw();
  });
  $("#mpr-month").addEventListener("click", () => {
    tab = "Monthly report";
    draw();
  });
  $("#mpr-editor-cancel").addEventListener("click", closeEditor);
  $("#mpr-editor").addEventListener("cancel", (e) => {
    e.preventDefault();
    closeEditor();
  });
  $("#mpr-editor-form").addEventListener("submit", (e) => {
    e.preventDefault();
    runEditor(saveEditor);
  });
  return {
    load,
    reset,
    renderInline,
    history,
    statusChanged: inline.statusChanged,
    prepareInline: inline.prepareInline,
    saveInline,
    dirty: inline.dirty,
  };
}
