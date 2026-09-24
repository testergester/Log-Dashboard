function login_(request) {
  const cache = CacheService.getScriptCache();
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const failures = Number(cache.get('LOGIN_FAILURES') || 0);
    if (failures >= DASHBOARD.loginLimit) throw new Error('Too many attempts. Try again in 15 minutes.');
    const props = PropertiesService.getScriptProperties();
    const expectedUser = props.getProperty('OWNER_USERNAME');
    const expectedHash = props.getProperty('PASSWORD_HASH');
    const salt = props.getProperty('PASSWORD_SALT');
    if (!expectedUser || !expectedHash || !salt) throw new Error('Dashboard setup is incomplete.');
    const username = String(request.username || '').trim();
    const password = String(request.password || '');
    const candidate = password.length && password.length <= 256 ? hashPassword_(password, salt) : '';
    if (username !== expectedUser || !constantTimeEqual_(candidate, expectedHash)) {
      cache.put('LOGIN_FAILURES', String(failures + 1), DASHBOARD.loginBlockSeconds);
      throw new Error('Incorrect username or password.');
    }
    cache.remove('LOGIN_FAILURES');
    const token = Utilities.getUuid() + Utilities.getUuid() + Utilities.getUuid();
    // Expired sessions are removed on login, including sessions created by
    // older deployments that did not have an expiration time.
    pruneSessions_(props);
    const expiresAt = Date.now() + DASHBOARD.sessionLifetimeMs;
    props.setProperty(sessionKey_(token), JSON.stringify({passwordHash: expectedHash, expiresAt: expiresAt}));
    return {token: token, expiresAt: expiresAt};
  } finally {
    lock.releaseLock();
  }
}

function logout_(request) {
  const token = String(request.token || '');
  if (token && token.length <= 200) PropertiesService.getScriptProperties().deleteProperty(sessionKey_(token));
  return {signedOut: true};
}

function requireSession_(request) {
  const token = String(request.token || '');
  const props = PropertiesService.getScriptProperties();
  const passwordHash = props.getProperty('PASSWORD_HASH');
  const key = token && token.length <= 200 ? sessionKey_(token) : '';
  const stored = key ? props.getProperty(key) : '';
  const session = parseSession_(stored);
  if (!session || !passwordHash || session.passwordHash !== passwordHash || session.expiresAt <= Date.now()) {
    if (key && stored) props.deleteProperty(key);
    throw new Error('Session expired. Please sign in again.');
  }
}

function parseSession_(stored) {
  try {
    const session = JSON.parse(stored);
    return session && typeof session.passwordHash === 'string' &&
      Number.isFinite(session.expiresAt) ? session : null;
  } catch (error) {
    return null;
  }
}

function pruneSessions_(props) {
  const now = Date.now();
  const values = props.getProperties();
  Object.keys(values).forEach(function(key) {
    if (key.indexOf('SESSION_') !== 0) return;
    const session = parseSession_(values[key]);
    if (!session || session.expiresAt <= now) props.deleteProperty(key);
  });
}
