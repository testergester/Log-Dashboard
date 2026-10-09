"use strict";

// Diagnostic history stays on this device. Never pass application records here.
(() => {
  const PREFIX = "teaching-dashboard-diagnostics-v1:";
  const TAB_KEY = "teaching-dashboard-diagnostics-tab";
  const MAX_STEPS = 500, MAX_ERRORS = 100, MAX_TABS = 8;
  const RETENTION = 7 * 24 * 60 * 60 * 1000;
  const version = document.querySelector('meta[name="dashboard-version"]')?.content || "unknown";
  const page = location.pathname.endsWith("analysis.html") ? "analysis" : "dashboard";
  const uuid = () => crypto.randomUUID();
  let tab = uuid(), persistent = true, timer, lastPruned = 0;
  try {
    const saved = sessionStorage.getItem(TAB_KEY);
    if (/^[a-f0-9-]{36}$/.test(saved || "")) tab = saved;
    sessionStorage.setItem(TAB_KEY, tab);
  } catch {}
  // A unique page key also prevents duplicated tabs (which copy sessionStorage)
  // from overwriting each other's history.
  const key = PREFIX + uuid();
  let history = {steps: [], errors: []};
  let seen = new WeakMap();
  const edits = new Map();
  const ids = new Set(Array.from(document.querySelectorAll("[id]"), node => node.id));
  const actions = new Set(["login", "logout", "load", "saveClass", "archiveClass", "archiveLog", "editLog", "saveLog", "saveStudent", "archiveStudent", "setEnrollment", "saveChecklist"]);
  const events = new Set(["page-open", "page-leave", "page-resume", "page-hidden", "page-visible", "click", "focus", "input", "change", "submit", "invalid", "dialog-open", "dialog-close", "section-open", "section-close", "confirmation-accepted", "confirmation-cancelled", "error-notice", "online", "offline", "session-change", "connection-change", "request-start", "request-success", "request-failure", "notice", "access-notice", "save-shortcut", "search-shortcut", "escape", "error"]);
  const types = new Set(["Error", "TypeError", "ReferenceError", "SyntaxError", "RangeError", "URIError", "EvalError", "AbortError", "SecurityError", "QuotaExceededError"]);
  const categories = ["schedule-card", "week-day", "class-filter", "week-class-button", "student-name-button", "student-delete-button", "choice-button", "note-toggle", "student-note", "student-analysis-link", "record-edit-button", "record-delete-button", "remove-meeting", "meeting-weekday", "meeting-room", "meeting-start", "meeting-end"];
  const targets = new Set([...(window.DashboardLogTargets || []), ...ids, ...categories, "attendance-choice", "participation-choice", "button", "a", "input", "select", "textarea", "summary", "form", "editable", "control"]);
  const kinds = new Set(["handled", "request", "runtime", "unhandled-promise", "resource"]);

  function context(value = {}) {
    const result = {};
    if (actions.has(value.action)) result.action = value.action;
    if (targets.has(value.target)) result.target = value.target;
    if (/^[a-f0-9-]{36}$/.test(value.requestId || "")) result.requestId = value.requestId;
    if (Number.isFinite(value.durationMs)) result.durationMs = Math.max(0, Math.min(3600000, Math.round(value.durationMs)));
    if (Number.isInteger(value.position)) result.position = Math.max(0, Math.min(1000, value.position));
    if (["info", "error"].includes(value.level)) result.level = value.level;
    return result;
  }

  // Only literal, developer-authored messages and source locations are retained.
  // Unknown messages can include names, tokens or notes and are deliberately omitted.
  function describe(error) {
    const message = typeof error?.message === "string" ? error.message : "";
    const safeMessage = window.DashboardLogMessages?.includes(message) ? message : "Error details omitted to protect private data.";
    const frames = String(error?.stack || "").split("\n").slice(1).flatMap(line => {
      const match = line.match(/\b(script\.js|analysis\.js|analysis-model\.js|crash-log\.js)(?:\?[^:\s)]*)?:(\d+):(\d+)\)?\s*$/);
      return match ? [match[1] + ":" + match[2] + ":" + match[3]] : [];
    }).slice(0, 12);
    return {name: types.has(error?.name) ? error.name : "Error", message: safeMessage, stack: frames};
  }

  function base() {
    return {id: uuid(), time: new Date().toISOString(), tab, version, page, online: navigator.onLine};
  }

  function valid(entry) {
    return entry && /^[a-f0-9-]{36}$/.test(entry.id || "") &&
      /^[a-f0-9-]{36}$/.test(entry.tab || "") && ["dashboard", "analysis"].includes(entry.page) &&
      /^[a-f0-9]{12}$/.test(entry.version || "") && Number.isFinite(Date.parse(entry.time)) &&
      Date.parse(entry.time) >= Date.now() - RETENTION;
  }

  function cleanStep(entry) {
    if (!valid(entry) || !events.has(entry.event)) return null;
    return {id: entry.id, time: entry.time, tab: entry.tab, version: entry.version, page: entry.page,
      online: Boolean(entry.online), event: entry.event, ...context(entry)};
  }

  function cleanError(entry) {
    if (!valid(entry)) return null;
    const safe = describe({name: entry.name, message: entry.message});
    return {id: entry.id, time: entry.time, tab: entry.tab, version: entry.version, page: entry.page,
      online: Boolean(entry.online), event: "error", ...context(entry), ...safe,
      kind: kinds.has(entry.kind) ? entry.kind : "handled",
      stack: Array.isArray(entry.stack) ? entry.stack.filter(frame => typeof frame === "string" && /^(script\.js|analysis\.js|analysis-model\.js|crash-log\.js):\d+:\d+$/.test(frame)).slice(0, 12) : [],
      cause: entry.cause ? describe({name: entry.cause.name, message: entry.cause.message}) : undefined,
      steps: Array.isArray(entry.steps) ? entry.steps.map(cleanStep).filter(Boolean).slice(-30) : []};
  }

  function readStored(storageKey) {
    try {
      const value = JSON.parse(localStorage.getItem(storageKey) || "{}");
      return {steps: Array.isArray(value.steps) ? value.steps.map(cleanStep).filter(Boolean).slice(-MAX_STEPS) : [],
        errors: Array.isArray(value.errors) ? value.errors.map(cleanError).filter(Boolean).slice(-MAX_ERRORS) : []};
    } catch { return {steps: [], errors: []}; }
  }
  let previousSteps = [];

  function storageKeys() {
    const result = [];
    for (let index = 0; index < localStorage.length; index++) {
      const candidate = localStorage.key(index);
      if (candidate?.startsWith(PREFIX) && /^[a-f0-9-]{36}$/.test(candidate.slice(PREFIX.length))) result.push(candidate);
    }
    return result;
  }

  function persist() {
    clearTimeout(timer);
    try {
      history.steps = history.steps.filter(valid);
      history.errors = history.errors.filter(valid);
      if (Date.now() - lastPruned > 60000) {
        const recent = storageKeys().filter(candidate => candidate !== key).map(candidate => {
          const saved = readStored(candidate);
          const newest = Math.max(0, ...[...saved.steps, ...saved.errors].map(entry => Date.parse(entry.time)));
          return {key: candidate, newest};
        }).sort((a, b) => b.newest - a.newest);
        recent.forEach((saved, index) => {
          if (!saved.newest || index >= MAX_TABS - 1) localStorage.removeItem(saved.key);
        });
        lastPruned = Date.now();
      }
      localStorage.setItem(key, JSON.stringify(history));
      persistent = true;
    } catch { persistent = false; }
  }

  function step(event, details) {
    try {
      if (!events.has(event)) return null;
      if (event !== "input") flushEdits();
      const entry = {...base(), event, ...context(details)};
      history.steps.push(entry);
      history.steps = history.steps.slice(-MAX_STEPS);
      clearTimeout(timer);
      timer = setTimeout(persist, 250);
      return entry.id;
    } catch { return null; }
  }

  function flushEdits(target) {
    for (const [node, edit] of edits) {
      if (target && node !== target) continue;
      clearTimeout(edit.timer);
      edits.delete(node);
      step("input", {target: edit.target});
    }
  }

  function record(error, details = {}) {
    try {
      if (error && typeof error === "object" && seen.has(error)) return seen.get(error);
      flushEdits();
      if (details.kind === "request") step("request-failure", details);
      const entry = {...base(), event: "error", ...context(details),
        kind: kinds.has(details.kind) ? details.kind : "handled", ...describe(error),
        cause: error?.cause ? describe(error.cause) : undefined, steps: [...previousSteps, ...history.steps].filter(valid).slice(-30)};
      history.errors.push(entry);
      history.errors = history.errors.slice(-MAX_ERRORS);
      if (error && typeof error === "object") seen.set(error, entry.id);
      persist();
      return entry.id;
    } catch { return null; }
  }

  function read() {
    flushEdits();
    history.steps = history.steps.filter(valid);
    history.errors = history.errors.filter(valid);
    const steps = [], errors = [];
    try {
      storageKeys().filter(candidate => candidate !== key).forEach(candidate => {
        const saved = readStored(candidate);
        steps.push(...saved.steps); errors.push(...saved.errors);
      });
    } catch {}
    steps.push(...history.steps); errors.push(...history.errors);
    const byTime = (a, b) => Date.parse(a.time) - Date.parse(b.time);
    return JSON.parse(JSON.stringify({schema: 1, exportedAt: new Date().toISOString(),
      storage: persistent ? "device" : "memory", steps: steps.sort(byTime), errors: errors.sort(byTime)}));
  }

  function clear() {
    edits.forEach(edit => clearTimeout(edit.timer)); edits.clear(); clearTimeout(timer);
    history = {steps: [], errors: []}; previousSteps = []; seen = new WeakMap();
    try { storageKeys().forEach(candidate => localStorage.removeItem(candidate)); } catch {}
    // Tell other tabs to discard their in-memory copies too.
    try { localStorage.setItem(PREFIX + "clear", uuid()); } catch {}
  }

  function targetName(node) {
    if (!node || node.closest?.("#diagnostics-dialog") || node.type === "password" ||
      ["username-input", "password-input", "endpoint-input"].includes(node.id)) return "";
    if (ids.has(node.id)) return node.id;
    if (node.tagName === "SUMMARY" && ids.has(node.parentElement?.id)) return node.parentElement.id;
    if (node.closest?.(".attendance-group")) return "attendance-choice";
    if (node.closest?.(".participation-group")) return "participation-choice";
    const category = categories.find(name => node.classList?.contains(name));
    if (category) return category;
    if (node.isContentEditable) return "editable";
    const tag = String(node.tagName || "").toLowerCase();
    return targets.has(tag) ? tag : "control";
  }

  function capture(event) {
    try {
      const node = event.type === "click"
        ? event.target.closest?.('button,a,input[type="checkbox"],input[type="radio"],summary') : event.target;
      const target = targetName(node);
      if (!target || (event.type === "focusin" && !node.matches?.("input,select,textarea,[contenteditable],button,a,summary"))) return;
      if (event.type === "input") {
        if (edits.has(node)) clearTimeout(edits.get(node).timer);
        edits.set(node, {target, timer: setTimeout(() => flushEdits(node), 500)});
      } else {
        flushEdits();
        const row = node.closest?.(".student-row,tr");
        const position = row?.parentElement ? Array.from(row.parentElement.children).indexOf(row) : undefined;
        step(event.type === "focusin" ? "focus" : event.type, {target, position});
        if (["click", "submit", "change", "invalid"].includes(event.type)) persist();
      }
    } catch {}
  }

  function download() {
    const url = URL.createObjectURL(new Blob([JSON.stringify(read(), null, 2)], {type: "application/json"}));
    try {
      const link = document.createElement("a");
      link.href = url; link.download = "teaching-dashboard-log-" + new Date().toISOString().slice(0, 10) + ".json";
      link.click();
    } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
  }

  function renderLog() {
    const log = read(), filter = document.querySelector("#diagnostics-filter").value;
    const list = document.querySelector("#diagnostics-list");
    list.replaceChildren();
    document.querySelector("#diagnostics-status").textContent = log.steps.length + " steps · " + log.errors.length +
      " errors · " + (persistent ? "Saved on this device" : "Browser storage unavailable; saved for this page only");
    const entries = (filter === "errors" ? log.errors : [...log.steps, ...log.errors])
      .sort((a, b) => Date.parse(b.time) - Date.parse(a.time)).slice(0, 100);
    if (!entries.length) {
      const empty = document.createElement("p"); empty.textContent = "No recorded entries."; list.append(empty);
    }
    entries.forEach(entry => {
      const item = document.createElement("details"), title = document.createElement("summary"), body = document.createElement("pre");
      item.className = entry.event === "error" ? "diagnostics-entry is-error" : "diagnostics-entry";
      title.textContent = new Date(entry.time).toLocaleTimeString([], {hour: "2-digit", minute: "2-digit", second: "2-digit"}) +
        " · " + entry.page + " · " + (entry.event === "error" ? entry.name + ": " + entry.message : entry.event) +
        (entry.action ? " · " + entry.action : "") + (entry.target ? " · " + entry.target : "");
      body.textContent = JSON.stringify(entry, null, 2); item.append(title, body); list.append(item);
    });
  }

  function open() {
    try { renderLog(); document.querySelector("#diagnostics-dialog").showModal(); } catch {}
  }
  function close() { document.querySelector("#diagnostics-dialog")?.close(); }
  window.CrashLog = {step, record, read, clear, download, open, close};
  if (typeof window.confirm === "function") {
    const confirmAction = window.confirm.bind(window);
    window.confirm = function(...args) {
      const accepted = confirmAction(...args);
      step(accepted ? "confirmation-accepted" : "confirmation-cancelled");
      persist();
      return accepted;
    };
  }

  ["click", "focusin", "input", "change", "submit", "invalid"].forEach(type => document.addEventListener(type, capture, true));
  document.addEventListener("focusout", event => flushEdits(event.target), true);
  document.addEventListener("keydown", event => {
    if (event.target.closest?.("#diagnostics-dialog")) return;
    const shortcut = (event.metaKey || event.ctrlKey) && event.key?.toLowerCase() === "s" ? "save-shortcut"
      : event.key === "Escape" ? "escape" : event.key === "/" && !event.target.matches?.("input,textarea,select,[contenteditable]") ? "search-shortcut" : "";
    if (shortcut) { flushEdits(); step(shortcut); }
  }, true);
  window.addEventListener("error", event => {
    if (event.target !== window) {
      if (event.target.tagName === "SCRIPT" || event.target.tagName === "LINK") record(new Error("A dashboard resource failed to load."), {kind: "resource"});
    } else record(event.error || new Error(event.message), {kind: "runtime"});
  }, true);
  window.addEventListener("unhandledrejection", event => record(event.reason, {kind: "unhandled-promise"}));
  ["online", "offline"].forEach(type => window.addEventListener(type, () => { step(type); persist(); }));
  document.addEventListener("visibilitychange", () => { flushEdits(); step(document.hidden ? "page-hidden" : "page-visible"); persist(); });
  window.addEventListener("pagehide", () => { flushEdits(); step("page-leave"); persist(); });
  window.addEventListener("pageshow", event => { if (event.persisted) step("page-resume"); });
  window.addEventListener("storage", event => {
    if (event.key === PREFIX + "clear" || event.key === null) { history = {steps: [], errors: []}; previousSteps = []; seen = new WeakMap(); edits.forEach(edit => clearTimeout(edit.timer)); edits.clear(); clearTimeout(timer); }
    if (event.key === "teaching-dashboard-session") step("session-change");
    if (event.key === "teaching-dashboard-endpoint") step("connection-change");
  });
  new MutationObserver(records => {
    records.forEach((change, index) => {
      if (["DIALOG", "DETAILS"].includes(change.target.tagName) && change.target.id !== "diagnostics-dialog" &&
        !change.target.closest?.("#diagnostics-dialog")) {
        const next = records.slice(index + 1).find(record => record.target === change.target);
        const open = next ? next.oldValue !== null : change.target.open;
        if ((change.oldValue !== null) === open) return;
        const prefix = change.target.tagName === "DIALOG" ? "dialog" : "section";
        step(prefix + (open ? "-open" : "-close"), {target: targetName(change.target)});
      }
    });
  }).observe(document.body, {subtree: true, attributes: true, attributeOldValue: true, attributeFilter: ["open"]});
  ["class-error", "student-error", "history-error", "record-error", "access-error", "global-notice", "lesson-status", "checklist-status", "analysis-date-error"].forEach(id => {
    const node = document.getElementById(id);
    if (!node) return;
    new MutationObserver(() => {
      const isStatus = ["global-notice", "lesson-status", "checklist-status"].includes(id);
      if (!node.hidden && node.textContent && (!isStatus || node.classList.contains("error"))) step("error-notice", {target: id});
    }).observe(node, {subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["hidden", "class"]});
  });
  document.querySelector("#diagnostics-close").addEventListener("click", close);
  document.querySelector("#diagnostics-refresh").addEventListener("click", renderLog);
  document.querySelector("#diagnostics-filter").addEventListener("change", renderLog);
  document.querySelector("#diagnostics-download").addEventListener("click", download);
  document.querySelector("#diagnostics-clear").addEventListener("click", () => {
    if (confirm("Clear activity and error history on this device? Teaching records will be kept.")) { clear(); renderLog(); }
  });
  try {
    previousSteps = storageKeys().flatMap(candidate => readStored(candidate).steps)
      .filter(entry => entry.tab === tab).sort((a, b) => Date.parse(a.time) - Date.parse(b.time)).slice(-30);
  } catch {}
  step("page-open"); persist();
})();
