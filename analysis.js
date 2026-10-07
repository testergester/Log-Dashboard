"use strict";
(() => {
  const $ = s => document.querySelector(s);
  const endpointKey = "teaching-dashboard-endpoint", sessionKey = "teaching-dashboard-session";
  const configuredEndpoint = "https://script.google.com/macros/s/AKfycbzzpBeitHNCriLtUU68x_CiFw8pAJ_iWopODGpuhBEnyEnoDyfvVcpbhrnWoOWr-CKD/exec";
  let endpoint = localStorage.getItem(endpointKey) || configuredEndpoint;
  let token = localStorage.getItem(sessionKey) || "";
  let data = null, summary = null, selectedStudent = "", busy = false;
  const selectedGroups = new Set();
  let showAllStudents = false, groupsInitialized = false;
  const initialStudentCount = 5;
  const quantity = (number, word) => number + " " + word + (number === 1 ? "" : "s");
  const escape = value => String(value ?? "").replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const percent = value => value === null ? "—" : Math.round(value) + "%";
  const signed = value => value > 0 ? "+" + value : String(value);
  const dateLabel = value => new Intl.DateTimeFormat("en", {timeZone:"UTC", month:"short",day:"numeric",year:"numeric"}).format(new Date(value + "T12:00:00Z"));
  const needsAttention = s => TeachingAnalysis.signal(s).flagged;
  const groupName = id => data.classes.find(g => g.id === id)?.name || data.logs.find(g => g.classId === id)?.className || id;
  function notice(message, error = false) { $("#global-notice").textContent = message; $("#global-notice").hidden = !message; $("#global-notice").classList.toggle("error", error); }
  function accessError(message) { $("#access-error").textContent = message; $("#access-error").hidden = !message; }
  function access() {
    if (!token || !data) $("#student-detail").close();
    $("#access-panel").hidden = Boolean(token);
    $("#analysis-workspace").hidden = !token || !data;
    $("#refresh-analysis").hidden = !token;
    $("#endpoint-form").hidden = Boolean(endpoint);
    $("#login-form").hidden = !endpoint || Boolean(token);
    $("#sign-out-button").hidden = !token;
    $("#connection-state").textContent = token ? "Connected" : endpoint ? "Sign in required" : "Not connected";
    $("#access-title").textContent = endpoint ? "Welcome back" : "Connect your teaching records";
    $("#access-description").textContent = endpoint ? "Sign in to explore your groups and student records." : "Add the web app URL from your Apps Script deployment. It stays on this device.";
  }
  async function request(action, fields = {}) {
    const requestId = crypto.randomUUID(), controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetch(endpoint, {method:"POST", headers:{"Content-Type":"text/plain;charset=utf-8"}, body:JSON.stringify({action, ...fields, requestId}), redirect:"follow",cache:"no-store",signal:controller.signal});
      if (!response.ok) throw Error("Could not load records. Check the Apps Script deployment and try again.");
      const result = await response.json();
      if (result.requestId !== requestId) throw Error("Apps Script returned a mismatched response.");
      if (!result.ok) throw Error(result.error || "The request failed.");
      return result.data;
    } catch(error) {
      if (error.name === "AbortError") throw Error("The request timed out. Try refreshing records.");
      if (error instanceof TypeError) throw Error("Could not reach Apps Script. Check your connection and try again.");
      throw error;
    } finally { clearTimeout(timeout); }
  }
  function handleError(error) {
    if (/session expired/i.test(error.message)) {
      token = ""; data = null; summary = null; selectedStudent = "";
      localStorage.removeItem(sessionKey); access(); notice(""); accessError("Your session expired. Please sign in again.");
    } else notice(error.message, true);
  }
  async function load() {
    if (busy) return;
    busy = true; $("#refresh-analysis").disabled = true; $("#refresh-analysis").textContent = "Refreshing…"; $("#analysis-workspace").setAttribute("aria-busy", "true"); notice("Loading your teaching records…");
    const requestedToken = token, requestedEndpoint = endpoint;
    try {
      const next = await request("load", {token: requestedToken});
      if (token !== requestedToken || endpoint !== requestedEndpoint) return;
      if (!Array.isArray(next.classes) || !Array.isArray(next.logs)) throw Error("The spreadsheet returned unexpected data.");
      const keys = ["students","enrollments","studentRecords","checklists"];
      const studentReady = keys.every(key => Array.isArray(next[key]));
      if (!studentReady && keys.some(key => next[key] !== undefined)) throw Error("Student records are incomplete. Update and redeploy Apps Script.");
      data = {...next, studentReady};
      renderGroups(); access(); render();
      notice(studentReady ? "" : "Student analysis needs the updated Apps Script backend. Group lesson notes are available.", !studentReady);
    } catch(error) { if (token === requestedToken && endpoint === requestedEndpoint) handleError(error); }
    finally {
      busy = false; $("#refresh-analysis").disabled = false; $("#refresh-analysis").textContent = "↻ Refresh records"; $("#analysis-workspace").setAttribute("aria-busy", "false");
      if (token && (token !== requestedToken || endpoint !== requestedEndpoint)) load();
    }
  }
  function renderGroups() {
    const ids = [...new Set([...data.classes.map(g=>g.id), ...data.logs.map(g=>g.classId), ...(data.studentRecords || []).map(g=>g.classId), ...(data.enrollments || []).map(g=>g.classId)])];
    ids.sort((a,b) => groupName(a).localeCompare(groupName(b)));
    selectedGroups.forEach(id => {if (!ids.includes(id)) selectedGroups.delete(id);});
    if (!groupsInitialized && ids.length) selectedGroups.add(ids[0]);
    groupsInitialized = true;
    const options = $("#group-options"); options.replaceChildren();
    ids.forEach(id => {
      const label = document.createElement("label"), input = document.createElement("input"), span = document.createElement("span");
      input.type = "checkbox"; input.value = id; input.checked = selectedGroups.has(id);
      span.textContent = groupName(id) + (groupName(id) !== id ? " · " + id : "") + (data.classes.find(g=>g.id === id)?.active === false ? " · inactive" : "");
      input.addEventListener("change", () => {input.checked ? selectedGroups.add(id) : selectedGroups.delete(id); selectedStudent = ""; showAllStudents = false; render();});
      label.dataset.groupLabel = span.textContent.toLowerCase();
      label.append(input,span); options.append(label);
    });
    if (!ids.length) options.textContent = "No groups yet. Add a class in the teaching week.";
  }
  function metric(label, value, hint) { return `<div class="analysis-metric"><span>${label}</span><strong>${escape(value)}</strong><small>${escape(hint)}</small></div>`; }
  function empty(message) { return `<p class="analysis-empty">${escape(message)}</p>`; }
  function render() {
    if (!data) return;
    const start = $("#analysis-start").value, end = $("#analysis-end").value;
    const invalid = Boolean(start && end && start > end);
    $("#analysis-date-error").hidden = !invalid;
    $("#analysis-date-error").textContent = invalid ? "Choose a To date on or after the From date. Results still use the last valid date range." : "";
    $("#analysis-start").setAttribute("aria-invalid", String(invalid));
    $("#analysis-end").setAttribute("aria-invalid", String(invalid));
    if (invalid) return; // Keep the last valid results visible while correcting dates.
    $("#analysis-content").hidden = !selectedGroups.size;
    if (data.studentReady) notice("");
    summary = TeachingAnalysis.build(data, {groups:[...selectedGroups],start,end});
    const names = [...selectedGroups].map(groupName);
    $("#group-selection-label").innerHTML = names.length ? names.map(name => `<span class="group-chip">${escape(name)}</span>`).join("") : "Choose groups";
    $("#group-picker summary").setAttribute("aria-label", names.length ? "Groups: " + names.join(", ") : "Choose groups");
    $("#analysis-scope").textContent = quantity(summary.meetings, "saved checklist") + " · " + quantity(summary.logs.length, "lesson record");
    const recorded = summary.students.filter(s => s.count).length;
    $("#record-coverage").textContent = `${recorded} of ${summary.students.length} students have records in this selection. ` +
      (summary.meetings < 3 ? "Limited history — these results describe saved meetings, not a trend." : "Missing checklists are excluded from attendance.");
    $("#analysis-metrics").innerHTML = metric("Students", summary.students.length, recorded + " with saved records") + metric("Attendance rate", percent(summary.attendance), summary.present + " present / " + (summary.present + summary.absent) + " recorded") + metric("Participation points", summary.count ? signed(summary.points) : "—", quantity(summary.absent, "absence") + " · " + quantity(summary.positive, "positive mark")) + metric("Student notes", summary.notes, "Teacher observations in saved meetings");
    renderTrend(); renderInsights(); renderStudents(); renderDetail(false); renderNotes();
    if (!selectedGroups.size) notice("Choose at least one group to see its analysis.");
  }
  function renderTrend() {
    $("#attendance-trend").innerHTML = summary.days.length ? `<div class="trend-list">${summary.days.map(d => `<div class="trend-row"><span>${dateLabel(d.date)}</span><div class="trend-bar" role="img" aria-label="${d.present} present, ${d.absent} absent"><span style="width:${d.attendance || 0}%"></span></div><strong>${percent(d.attendance)}</strong><small>${d.present} / ${d.present + d.absent}</small></div>`).join("")}</div><p class="analysis-footnote">Present / recorded attendances per date, combined across selected groups.</p>` : empty("No saved attendance in this selection.");
  }
  function renderInsights() {
    const attention = summary.students.filter(needsAttention), unrecorded = summary.students.filter(s=>!s.count);
    const insights = [];
    if (!summary.count) insights.push(["No attendance records yet", "Save a checklist in the teaching week to see attendance and points here."]);
    else {
      insights.push([attention.length ? quantity(attention.length, "student") + " flagged for review" : "No review flags in saved records", "Attendance below 80% or negative points. These are prompts to review the history."]);
      insights.push([quantity(summary.absent, "recorded absence"), quantity(summary.positive, "positive participation mark") + " and " + quantity(summary.negative, "noise mark") + " in the selected period."]);
    }
    if (unrecorded.length) insights.push([quantity(unrecorded.length, "student") + " without records", "Attendance and points are unknown for these students."]);
    $("#group-insights").innerHTML = insights.map(([title,body])=>`<div class="analysis-insight"><strong>${escape(title)}</strong><p>${escape(body)}</p></div>`).join("") +
      (attention.length ? '<button class="button button-quiet" id="review-flagged">Review flagged students →</button>' : '');
    $("#review-flagged")?.addEventListener("click",()=>{$("#analysis-show").value="attention";showAllStudents=false;renderStudents();$("#student-roster").scrollIntoView({block:"start"});$("#analysis-show").focus({preventScroll:true});});
  }
  function studentGroups(student) {
    return [...new Set([...student.records.map(r=>r.classId), ...(data.enrollments || []).filter(e=>e.studentId===student.id && selectedGroups.has(e.classId)).map(e=>e.classId)])].map(groupName).join(", ");
  }
  function renderStudents() {
    if (!summary) return;
    const search = $("#analysis-search").value.trim().toLocaleLowerCase(), show = $("#analysis-show").value, sort = $("#analysis-sort").value;
    const students = summary.students.filter(s=>s.name.toLocaleLowerCase().includes(search) && (show !== "attention" || needsAttention(s)) && (show !== "notes" || s.notes) && (show !== "unrecorded" || !s.count));
    students.sort((a,b) => (sort !== "name" ? Number(!a.count) - Number(!b.count) : 0) || (sort === "absence" ? b.absent-a.absent : sort === "points" ? b.points-a.points : sort === "attendance" ? (a.attendance ?? 101)-(b.attendance ?? 101) : 0) || a.name.localeCompare(b.name));
    const visible = showAllStudents ? students : students.slice(0, initialStudentCount);
    $("#student-count").textContent = students.length === summary.students.length ? quantity(students.length, "student") : students.length + " of " + summary.students.length;
    $("#roster-page-status").textContent = `Showing ${visible.length} of ${students.length} students`;
    $("#more-students").hidden = showAllStudents || students.length <= initialStudentCount;
    $("#more-students").setAttribute("aria-expanded", String(showAllStudents));
    $("#analysis-students").innerHTML = visible.length ? visible.map(s=>{
      const signal = TeachingAnalysis.signal(s);
      return `<tr class="${s.id === selectedStudent ? "is-selected" : ""}"><td class="student-cell"><button class="student-analysis-link" data-student="${escape(s.id)}" aria-haspopup="dialog" aria-controls="student-detail">${escape(s.name)} <span aria-hidden="true">→</span></button><small>${escape(studentGroups(s))}${s.archived ? ' · Archived history' : ''}</small></td><td data-label="Attendance">${percent(s.attendance)}<small>${s.count ? s.present + " / " + (s.present+s.absent) + " recorded" : "No saved records"}</small></td><td data-label="Absences">${s.count ? s.absent : '—'}</td><td data-label="Points"><span class="points-number ${s.points < 0 ? 'is-negative' : ''}">${s.count ? signed(s.points) : '—'}</span></td><td data-label="Notes">${s.count ? s.notes : '—'}</td><td class="signal-cell" data-label="Review signal"><span class="analysis-signal ${signal.flagged ? 'needs-attention' : ''}">${signal.label}</span>${s.count && s.count < 3 ? '<small>Limited history</small>' : ''}</td></tr>`;
    }).join("") : '<tr class="empty-row"><td colspan="6">' + empty(summary.students.length ? "No students match your filters. Try another name or choose All students." : "No students in this group and period.") + '</td></tr>';
    document.querySelectorAll("[data-student]").forEach(button=>button.addEventListener("click",()=>{selectedStudent=button.dataset.student;renderDetail(true);}));
  }
  function renderDetail(open) {
    const student = summary?.students.find(s=>s.id === selectedStudent), panel = $("#student-detail");
    if (!student) { panel.close(); return; }
    $("#student-detail-title").textContent = student.name;
    $("#student-detail-subtitle").textContent = studentGroups(student) + " · " + quantity(student.count, "saved record") + (student.archived ? " · Archived history" : "");
    const signal = TeachingAnalysis.signal(student);
    const insight = !student.count ? "No saved records in this period. Attendance and points are unknown."
      : signal.label + ". " + quantity(student.absent, "absence") + " in " + quantity(student.present + student.absent, "recorded meeting") + ". " +
        quantity(student.positive, "positive participation mark") + " and " + quantity(student.negative, "noise mark") + ". " +
        (student.count < 3 ? "Limited history: a pattern cannot be established from these records." : "Review the dated notes for context.");
    $("#student-detail-body").innerHTML = `<div class="individual-insight"><strong>From saved records</strong><p>${escape(insight)}</p></div><div class="student-mini-metrics">${metric("Attendance",percent(student.attendance),quantity(student.absent,"absence"))}${metric("Points",student.count ? signed(student.points) : '—',student.positive + " positive · " + student.negative + " noise marks")}${metric("Notes",student.count ? student.notes : '—',"Teacher observations")}</div><h3 class="timeline-title">Meeting history</h3>` + (student.records.length ? `<div class="student-timeline">${student.records.map(r=>`<article><div><strong>${dateLabel(r.date)}</strong><span>${escape(groupName(r.classId))} · ${escape(r.attendance)} · ${signed(TeachingAnalysis.score(r))} points</span></div><p>${escape(r.note || "No student note for this meeting.")}</p></article>`).join("")}</div>` : empty("No saved student records in this period."));
    if (open && !panel.open) {panel.showModal();$("#close-student-detail").focus({preventScroll:true});}
  }
  function noteText(note) {
    if (!String(note || "").startsWith('<div data-lesson-notes-html="1">')) return String(note || "");
    // Parse only recognized legacy rich notes and insert plain text, never stored HTML.
    const parsed = new DOMParser().parseFromString(note,"text/html");
    parsed.querySelectorAll("script,style,iframe,object").forEach(n=>n.remove());
    parsed.querySelectorAll("br").forEach(n=>n.replaceWith("\n"));
    parsed.querySelectorAll("li,p,div").forEach(n=>n.append("\n"));
    return parsed.body.textContent.trim();
  }
  function renderNotes() {
    $("#lesson-notes-count").textContent = quantity(summary.logs.length, "record");
    $("#analysis-lesson-notes").innerHTML = summary.logs.length ? summary.logs.map(log=>`<article class="analysis-lesson-note"><div><strong>${escape(groupName(log.classId))}</strong><span>${dateLabel(log.date)} · ${escape(log.lessonType || 'Lesson')} · ${escape(log.lessonStatus || 'Done')}${log.rating ? ' · Lesson rating ' + escape(log.rating) + '/5' : ''}</span></div><p>${escape(noteText(log.notes) || "No lesson notes added.")}</p></article>`).join("") : empty("No saved lesson notes in this selection.");
  }
  $("#refresh-analysis").addEventListener("click",load);
  ["#analysis-start","#analysis-end"].forEach(s=>$(s).addEventListener("change",()=>{showAllStudents=false;render();}));
  $("#all-dates").addEventListener("click",()=>{$("#analysis-start").value="";$("#analysis-end").value="";showAllStudents=false;render();});
  $("#analysis-search").addEventListener("input",()=>{showAllStudents=false;renderStudents();});
  ["#analysis-show","#analysis-sort"].forEach(s=>$(s).addEventListener("change",()=>{showAllStudents=false;renderStudents();}));
  $("#close-student-detail").addEventListener("click",()=>$("#student-detail").close());
  $("#student-detail").addEventListener("close",()=>{selectedStudent="";});
  $("#more-students").addEventListener("click",()=>{
    showAllStudents=true;
    renderStudents();
    document.querySelectorAll("[data-student]")[initialStudentCount]?.focus({preventScroll:true});
  });
  let backdropPointerDown = false;
  const outsideStudentPanel = event => {
    const panel = $("#student-detail"), bounds = panel.getBoundingClientRect();
    return event.target === panel && (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom);
  };
  $("#student-detail").addEventListener("pointerdown",event=>{backdropPointerDown=outsideStudentPanel(event);});
  $("#student-detail").addEventListener("click",event=>{
    if(backdropPointerDown && outsideStudentPanel(event)) $("#student-detail").close();
    backdropPointerDown=false;
  });
  $("#group-search").addEventListener("input",()=>{
    const search = $("#group-search").value.trim().toLowerCase();
    document.querySelectorAll("#group-options label").forEach(label=>{label.hidden=!label.dataset.groupLabel.includes(search);});
  });
  $("#select-all-groups").addEventListener("click",()=>{document.querySelectorAll("#group-options input").forEach(input=>{selectedGroups.add(input.value);input.checked=true;});showAllStudents=false;render();});
  $("#clear-groups").addEventListener("click",()=>{selectedGroups.clear();document.querySelectorAll("#group-options input").forEach(input=>input.checked=false);showAllStudents=false;render();});
  $("#done-groups").addEventListener("click",()=>{$("#group-picker").open=false;$("#group-picker summary").focus();});
  document.addEventListener("click",event=>{if (!$("#group-picker").contains(event.target)) $("#group-picker").open=false;});
  document.addEventListener("keydown",event=>{if(event.key==="Escape" && $("#group-picker").open){$("#group-picker").open=false;$("#group-picker summary").focus();}});
  $("#endpoint-form").addEventListener("submit",event=>{
    event.preventDefault(); const value=$("#endpoint-input").value.trim();
    try {const url=new URL(value);if(url.protocol!=="https:" || url.hostname!=="script.google.com" || !/^\/macros\/s\/[^/]+\/exec$/.test(url.pathname) || url.search || url.hash) throw Error();}
    catch {accessError("Enter the deployed Apps Script URL ending in /exec.");return;}
    endpoint=value;localStorage.setItem(endpointKey,endpoint);accessError("");access();$("#username-input").focus();
  });
  $("#settings-button").addEventListener("click",()=>{
    if(busy)return;if(token){notice("Sign out before changing the Apps Script connection.");return;}
    endpoint="";localStorage.removeItem(endpointKey);accessError("");access();$("#endpoint-input").focus();
  });
  $("#login-form").addEventListener("submit",async event=>{
    event.preventDefault();if(busy)return;busy=true;$("#login-button").disabled=true;accessError("");
    try {const result=await request("login",{username:$("#username-input").value.trim(),password:$("#password-input").value});
      if(!result.token)throw Error("The login response did not include a session.");
      token=result.token;localStorage.setItem(sessionKey,token);$("#password-input").value="";access();busy=false;await load();
    } catch(error){accessError(error.message);}
    finally {busy=false;$("#login-button").disabled=false;}
  });
  $("#sign-out-button").addEventListener("click",()=>{
    if(busy)return;const oldToken=token;token="";data=null;summary=null;selectedStudent="";selectedGroups.clear();groupsInitialized=false;localStorage.removeItem(sessionKey);access();notice("");request("logout",{token:oldToken}).catch(()=>{});
  });
  window.addEventListener("storage",event=>{
    if(event.key===sessionKey || event.key===endpointKey){token=localStorage.getItem(sessionKey)||"";endpoint=localStorage.getItem(endpointKey)||configuredEndpoint;data=null;summary=null;access();if(token)load();}
  });
  access();if(token)load();
})();
