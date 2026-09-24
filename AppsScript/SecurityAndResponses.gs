function hashPassword_(password, salt) {
  const saltBytes = Utilities.newBlob(salt).getBytes();
  let digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + ':' + password);
  for (let index = 1; index < DASHBOARD.hashRounds; index++) {
    digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, digest.concat(saltBytes));
  }
  return digest.map(function(byte) { return ('0' + (byte & 255).toString(16)).slice(-2); }).join('');
}

function sessionKey_(token) {
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, token);
  return 'SESSION_' + digest.map(function(byte) { return ('0' + (byte & 255).toString(16)).slice(-2); }).join('');
}

function constantTimeEqual_(a, b) {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index++) difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return difference === 0;
}

function json_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}

function response_(value, request) {
  if (!request.replyOrigin) return json_(value);
  const origin = String(request.replyOrigin);
  if (!isOriginSyntax_(origin)) {
    return json_({ok: false, error: 'Dashboard origin is not configured.'});
  }
  if (!isAllowedOrigin_(origin)) {
    value = {ok: false, error: 'Set ALLOWED_ORIGIN to the dashboard website origin in Script properties.', requestId: request.requestId};
  }
  const payload = JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
  const html = '<!doctype html><html><head><meta charset="utf-8"></head><body><script>window.top.postMessage(' +
    JSON.stringify({type: 'teaching-dashboard-response', payload: payload}) + ', ' +
    JSON.stringify(origin) + ');</script></body></html>';
  return HtmlService.createHtmlOutput(html).setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function isAllowedOrigin_(origin) {
  return isOriginSyntax_(origin) &&
    String(origin) === String(PropertiesService.getScriptProperties().getProperty('ALLOWED_ORIGIN') || '');
}

function isOriginSyntax_(origin) {
  try {
    const url = new URL(String(origin));
    return url.protocol === 'https:' && url.origin === String(origin);
  } catch (error) {
    return false;
  }
}
