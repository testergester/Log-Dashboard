import { ENDPOINT_STORAGE_KEY, SESSION_STORAGE_KEY } from "./config.js";
import { dataAccess } from "./data/index.js";
import { loadData } from "./dashboard.js";
import { $ } from "./dom.js";
import { state } from "./state.js";
import { setNotice } from "./ui.js";

export function setAccessError(message) {
  const error = $("#access-error");
  error.textContent = message;
  error.hidden = !message;
}

export function updateAccess() {
  const connected = Boolean(state.endpoint);
  const signedIn = Boolean(state.token);
  $("#access-panel").hidden = signedIn;
  $("#workspace").hidden = !signedIn;
  $("#endpoint-form").hidden = connected;
  $("#login-form").hidden = !connected || signedIn;
  $("#sign-out-button").hidden = !signedIn;
  $("#add-class-button").disabled = !signedIn;
  $("#connection-state").textContent = signedIn ? "Connected" : connected ? "Sign in required" : "Not connected";
  $("#access-title").textContent = connected ? "Welcome back" : "Connect your teaching records";
  $("#access-description").textContent = connected
    ? "Sign in to see your timetable and keep your lesson records."
    : "Add the web app URL from your Apps Script deployment. It stays on this device.";
}
export function isSessionError(error) {
  return /session expired/i.test(error.message);
}

export function clearSession() {
  state.token = "";
  localStorage.removeItem(SESSION_STORAGE_KEY);
}

export function handleError(error, target = "global") {
  if (isSessionError(error)) {
    clearSession();
    state.classes = [];
    state.logs = [];
    state.students = [];
    state.enrollments = [];
    state.checklists = [];
    state.studentRecords = [];
    state.studentsReady = false;
    updateAccess();
    setAccessError("Your session expired. Please sign in again.");
    return;
  }
  if (target === "access") setAccessError(error.message);
  else setNotice(error.message, true);
}
export async function restoreSession() {
  updateAccess();
  if (!state.token) return;
  setNotice("Restoring your session…");
  try {
    await loadData();
    setNotice("");
  } catch (error) {
    if (isSessionError(error)) handleError(error);
    else {
      updateAccess();
      setNotice("You are still signed in, but the dashboard could not refresh. Reload the page to try again.", true);
    }
  }
}


export function bindAuth() {
  $("#endpoint-form").addEventListener("submit", event => {
    event.preventDefault();
    const endpoint = $("#endpoint-input").value.trim();
    if (!dataAccess.validEndpoint(endpoint)) {
      setAccessError("Enter the deployed Apps Script URL ending in /exec.");
      return;
    }
    state.endpoint = endpoint;
    localStorage.setItem(ENDPOINT_STORAGE_KEY, endpoint);
    setAccessError("");
    updateAccess();
    $("#username-input").focus();
  });

  $("#settings-button").addEventListener("click", () => {
    if (state.token) {
      setNotice("Sign out before changing the Apps Script connection.");
      return;
    }
    state.endpoint = "";
    localStorage.removeItem(ENDPOINT_STORAGE_KEY);
    $("#endpoint-input").value = "";
    setAccessError("");
    updateAccess();
    $("#endpoint-input").focus();
  });

  $("#login-form").addEventListener("submit", async event => {
    event.preventDefault();
    if (state.pending) return;
    state.pending = true;
    $("#login-button").disabled = true;
    $("#login-button").textContent = "Signing in…";
    setAccessError("");
    let authenticated = false;
    try {
      const response = await dataAccess.login({
        username: $("#username-input").value.trim(),
        password: $("#password-input").value
      });
      if (!response.token) throw new Error("The login response did not include a session.");
      state.token = response.token;
      localStorage.setItem(SESSION_STORAGE_KEY, state.token);
      authenticated = true;
      updateAccess();
      $("#password-input").value = "";
      await loadData();
      setNotice("");
    } catch (error) {
      if (!authenticated || isSessionError(error)) {
        clearSession();
        handleError(error, "access");
      } else {
        setNotice(error.message, true);
      }
    } finally {
      state.pending = false;
      $("#login-button").disabled = false;
      $("#login-button").textContent = "Sign in";
    }
  });

  $("#sign-out-button").addEventListener("click", () => {
    const token = state.token;
    clearSession();
    state.classes = [];
    state.logs = [];
    state.students = [];
    state.enrollments = [];
    state.checklists = [];
    state.studentRecords = [];
    state.studentsReady = false;
    state.selectedClassId = "";
    state.selectedStudentId = "";
    state.drafts.clear();
    state.checklistDrafts.clear();
    updateAccess();
    setNotice("");
    dataAccess.logout({token}).catch(() => {});
  });
}
