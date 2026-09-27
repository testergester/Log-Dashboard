export function validEndpoint(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "script.google.com" &&
      /^\/macros\/s\/[^/]+\/exec$/.test(url.pathname) && !url.search && !url.hash;
  } catch {
    return false;
  }
}

export function createAppsScriptAdapter(getEndpoint, transport = globalThis.fetch) {
  async function request(action, fields = {}) {
    if (!getEndpoint()) throw new Error("Add your Apps Script URL first.");
    const requestId = crypto.randomUUID();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    let response;
    try {
      response = await transport(getEndpoint(), {
        method: "POST",
        headers: {"Content-Type": "text/plain;charset=utf-8"},
        body: JSON.stringify({action, ...fields, requestId}),
        redirect: "follow",
        cache: "no-store",
        signal: controller.signal
      });
    } catch (error) {
      throw new Error(error.name === "AbortError"
        ? "The request timed out. Try again."
        : "Could not reach Apps Script. Check the web app URL and deployment access.");
    } finally {
      clearTimeout(timeout);
    }
    if (!response.ok || response.type === "opaque") {
      throw new Error("Apps Script returned an unreadable response. Check the web app deployment.");
    }
    let result;
    try {
      result = await response.json();
    } catch {
      throw new Error("Apps Script did not return JSON. Check the web app URL and deployment.");
    }
    if (result.requestId !== requestId) throw new Error("Apps Script returned a mismatched response.");
    if (!result.ok) throw new Error(result.error || "The request failed.");
    return result.data;
  }

  return {
    validEndpoint,
    login: fields => request("login", fields),
    logout: fields => request("logout", fields),
    load: fields => request("load", fields),
    saveClass: fields => request("saveClass", fields),
    archiveClass: fields => request("archiveClass", fields),
    saveLog: fields => request("saveLog", fields),
    saveStudent: fields => request("saveStudent", fields),
    setEnrollment: fields => request("setEnrollment", fields),
    saveChecklist: fields => request("saveChecklist", fields)
  };
}
