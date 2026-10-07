"use strict";
(() => {
  const $ = s => document.querySelector(s);
  const endpointKey = "teaching-dashboard-endpoint", sessionKey = "teaching-dashboard-session";
  const configuredEndpoint = "https://script.google.com/macros/s/AKfycbzzpBeitHNCriLtUU68x_CiFw8pAJ_iWopODGpuhBEnyEnoDyfvVcpbhrnWoOWr-CKD/exec";
  let endpoint = localStorage.getItem(endpointKey) || configuredEndpoint;
  let token = localStorage.getItem(sessionKey) || "";
  let data = null, summary = null, selectedStudent = "", busy = false;
  const selectedGroups = new Set();
  const escape = value => String(value ?? "").replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const percent = value => value === null ? "—" : Math.round(value) + "%";
  const signed = value => value > 0 ? "+" + value : String(value);
  const dateLabel = value => new Intl.DateTimeFormat("en", {timeZone:"UTC", month:"short",day:"numeric",year:"numeric"}).format(new Date(value + "T12:00:00Z"));
  const needsAttention = s => (s.attendance !== null && s.attendance < 80) || s.points < 0;
  const groupName = id => data.classes.find(g => g.id === id)?.name || data.logs.find(g => g.classId === id)?.className || id;
  function notice(message, error = false) { $("#global-notice").textContent = message; $("#global-notice").hidden = !message; $("#global-notice").classList.toggle("error", error); }
  function accessError(message) { $("#access-error").textContent = message; $("#access-error").hidden = !message; }
  function access() {
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
    busy = true; $("#refresh-analysis").disabled = true; notice("Loading your teaching records…");
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
      busy = false; $("#refresh-analysis").disabled = false;
      if (token && (token !== requestedToken || endpoint !== requestedEndpoint)) load();
    }
  }
  function renderGroups() {
    const ids = [...new Set([...data.classes.map(g=>g.id), ...data.logs.map(g=>g.classId), ...(data.studentRecords || []).map(g=>g.classId), ...(data.enrollments || []).map(g=>g.classId)])];
    ids.sort((a,b) => groupName(a).localeCompare(groupName(b)));
    selectedGroups.forEach(id => {if (!ids.includes(id)) selectedGroups.delete(id);});
    if (!selectedGroups.size && ids.length) selectedGroups.add(ids[0]);
    const options = $("#group-options"); options.replaceChildren();
    ids.forEach(id => {
      const label = document.createElement("label"), input = document.createElement("input"), span = document.createElement("span");
      input.type = "checkbox"; input.value = id; input.checked = selectedGroups.has(id);
      span.textContent = groupName(id) + " · " + id + (data.classes.find(g=>g.id === id)?.active === false ? " · inactive" : "");
      input.addEventListener("change", () => {input.checked ? selectedGroups.add(id) : selectedGroups.delete(id); selectedStudent = ""; render();});
      label.append(input,span); options.append(label);
    });
    if (!ids.length) options.textContent = "No groups yet. Add a class in the teaching week.";
  }
  function metric(label, value, hint) { return `<div class="analysis-metric"><span>${label}</span><strong>${escape(value)}</strong><small>${escape(hint)}</small></div>`; }
  function empty(message) { return `<p class="analysis-empty">${escape(message)}</p>`; }
  function render() {
    if (!data) return;
    const start = $("#analysis-start").value, end = $("#analysis-end").value;
    if (start && end && start > end) { $("#analysis-content").hidden = true; notice("The From date must be on or before the To date.", true); return; }
    $("#analysis-content").hidden = false;
    if (data.studentReady) notice("");
    summary = TeachingAnalysis.build(data, {groups:[...selectedGroups],start,end});
    $("#group-selection-label").textContent = selectedGroups.size === 1 ? groupName([...selectedGroups][0]) : selectedGroups.size + " selected";
    $("#analysis-scope").textContent = summary.meetings + " saved checklists · " + summary.logs.length + " lesson records";
    $("#analysis-metrics").innerHTML = metric("Students in scope", summary.students.length, selectedGroups.size + " selected groups") + metric("Attendance rate", percent(summary.attendance), summary.present + " present / " + (summary.present + summary.absent) + " recorded") + metric("Total points", signed(summary.points), summary.absent + " absences · " + summary.positive + " positive marks") + metric("Student notes", summary.notes, "Notes across saved meetings");
    renderTrend(); renderInsights(); renderStudents(); renderDetail(false); renderNotes();
    if (!selectedGroups.size) notice("Choose at least one group to see its analysis.");
  }
  function renderTrend() {
    $("#attendance-trend").innerHTML = summary.days.length ? `<div class="trend-list">${summary.days.map(d => `<div class="trend-row"><span>${dateLabel(d.date)}</span><div class="trend-bar" role="img" aria-label="${d.present} present, ${d.absent} absent"><span style="width:${d.attendance || 0}%"></span></div><strong>${percent(d.attendance)}</strong><small>${d.present} / ${d.present + d.absent}</small></div>`).join("")}</div><p class="analysis-footnote">Present / recorded students per date. Missing checklists are excluded.</p>` : empty("No saved attendance in this selection.");
  }
  function renderInsights() {
    const attention = summary.students.filter(needsAttention), unrecorded = summary.students.filter(s=>!s.count);
    const insights = [];
    if (!summary.count) insights.push(["No attendance records yet", "Save a checklist in the teaching week to see attendance and points here."]);
    else {
      insights.push([attention.length ? attention.length + " students need attention" : "No attention flags in this period", "Attendance below 80% or negative points. Use the student filter to review the records."]);
      const highest = [...summary.students].sort((a,b)=>b.absent-a.absent)[0];
      if (highest?.absent) insights.push([highest.name + " · " + highest.absent + " absences", "Most recorded absences in this selection. Review their history before planning a follow-up."]);
      insights.push([summary.positive + " positive participation marks", summary.negative + " noise marks and " + summary.absent + " absence deductions recorded."]);
    }
    if (unrecorded.length) insights.push([unrecorded.length + " students have no saved records", "They are included through enrollment. Attendance and marks are unknown for this period."]);
    $("#group-insights").innerHTML = insights.map(([title,body])=>`<div class="analysis-insight"><strong>${escape(title)}</strong><p>${escape(body)}</p></div>`).join("");
  }
  function renderStudents() {
    if (!summary) return;
    const search = $("#analysis-search").value.trim().toLocaleLowerCase(), show = $("#analysis-show").value, sort = $("#analysis-sort").value;
    const students = summary.students.filter(s=>s.name.toLocaleLowerCase().includes(search) && (show !== "attention" || needsAttention(s)) && (show !== "notes" || s.notes));
    students.sort((a,b) => (sort === "absence" ? b.absent-a.absent : sort === "points" ? b.points-a.points : sort === "attendance" ? (a.attendance ?? 101)-(b.attendance ?? 101) : 0) || a.name.localeCompare(b.name));
    $("#student-count").textContent = students.length + " / " + summary.students.length;
    $("#analysis-students").innerHTML = students.length ? students.map(s=>`<tr class="${s.id === selectedStudent ? "is-selected" : ""}"><td><button class="student-analysis-link" data-student="${escape(s.id)}" aria-expanded="${s.id === selectedStudent}" aria-controls="student-detail">${escape(s.name)} <span aria-hidden="true">↗</span></button>${s.archived ? '<small class="archived-label">Archived history</small>' : ''}</td><td>${percent(s.attendance)}<small>${s.present} / ${s.present+s.absent} recorded</small></td><td>${s.absent}</td><td><span class="points-number ${s.points < 0 ? 'is-negative' : ''}">${s.count ? signed(s.points) : '—'}</span></td><td>${s.notes}</td><td><span class="analysis-signal ${needsAttention(s) ? 'needs-attention' : ''}">${!s.count ? "No records" : needsAttention(s) ? "Needs attention" : "On track"}</span></td></tr>`).join("") : '<tr><td colspan="6">' + empty("No students match this selection.") + '</td></tr>';
    document.querySelectorAll("[data-student]").forEach(button=>button.addEventListener("click",()=>{selectedStudent=button.dataset.student;renderStudents();renderDetail(true);}));
  }
  function renderDetail(focus) {
    const student = summary?.students.find(s=>s.id === selectedStudent);
    $("#student-detail").hidden = !student;
    if (!student) return;
    $("#student-detail-title").textContent = student.name;
    $("#student-detail-subtitle").textContent = student.archived ? "Archived student · saved history in the selected groups and period" : "Selected groups and period · " + student.count + " saved student records";
    const difference = student.attendance === null || summary.attendance === null ? null : Math.round(student.attendance - summary.attendance);
    const insight = !student.count ? "No saved records in this period. Attendance and points cannot be assessed yet."
      : (needsAttention(student) ? "Needs attention. " : "On track under the current thresholds. ") +
        student.absent + " absences in " + (student.present + student.absent) + " recorded attendances. " +
        (difference === null ? "" : difference === 0 ? "Attendance matches the selected group average. " : "Attendance is " + Math.abs(difference) + " percentage points " + (difference < 0 ? "below" : "above") + " the selected group average. ") +
        student.positive + " positive participation marks and " + student.negative + " noise marks.";
    $("#student-detail-body").innerHTML = `<div class="individual-insight"><strong>Student insight</strong><p>${escape(insight)}</p></div><div class="student-mini-metrics">${metric("Attendance",percent(student.attendance),student.absent + " absences")}${metric("Points",student.count ? signed(student.points) : '—',student.positive + " positive · " + student.negative + " noise marks")}${metric("Notes",student.notes,"Saved teacher observations")}</div>` + (student.records.length ? `<div class="student-timeline">${student.records.map(r=>`<article><div><strong>${dateLabel(r.date)}</strong><span>${escape(groupName(r.classId))} · ${escape(r.attendance)} · ${signed(TeachingAnalysis.score(r))} points</span></div><p>${escape(r.note || "No student note for this meeting.")}</p></article>`).join("")}</div>` : empty("No saved student records in this period."));
    if (focus) {$("#student-detail").scrollIntoView({block:"start",behavior:"smooth"});$("#student-detail-title").focus({preventScroll:true});}
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
    $("#lesson-notes-count").textContent = summary.logs.length + " records";
    $("#analysis-lesson-notes").innerHTML = summary.logs.length ? summary.logs.map(log=>`<article class="analysis-lesson-note"><div><strong>${escape(groupName(log.classId))}</strong><span>${dateLabel(log.date)} · ${escape(log.lessonType || 'Lesson')} · ${escape(log.lessonStatus || 'Done')}${log.rating ? ' · Lesson rating ' + escape(log.rating) + '/5' : ''}</span></div><p>${escape(noteText(log.notes) || "No lesson notes added.")}</p></article>`).join("") : empty("No saved lesson notes in this selection.");
  }
  $("#refresh-analysis").addEventListener("click",load);
  ["#analysis-start","#analysis-end"].forEach(s=>$(s).addEventListener("change",render));
  $("#all-dates").addEventListener("click",()=>{$("#analysis-start").value="";$("#analysis-end").value="";render();});
  $("#analysis-search").addEventListener("input",renderStudents);
  ["#analysis-show","#analysis-sort"].forEach(s=>$(s).addEventListener("change",renderStudents));
  $("#close-student-detail").addEventListener("click",()=>{const id=selectedStudent;selectedStudent="";renderStudents();renderDetail(false);[...document.querySelectorAll("[data-student]")].find(b=>b.dataset.student===id)?.focus();});
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
    if(busy)return;const oldToken=token;token="";data=null;summary=null;selectedStudent="";selectedGroups.clear();localStorage.removeItem(sessionKey);access();notice("");request("logout",{token:oldToken}).catch(()=>{});
  });
  window.addEventListener("storage",event=>{
    if(event.key===sessionKey || event.key===endpointKey){token=localStorage.getItem(sessionKey)||"";endpoint=localStorage.getItem(endpointKey)||configuredEndpoint;data=null;summary=null;access();if(token)load();}
  });
  access();if(token)load();
})();
