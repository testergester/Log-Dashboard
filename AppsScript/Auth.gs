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
    // Store only a hash-derived key, never the bearer token itself. Script
    // properties are durable, so this session remains valid until logout.
    // Tying it to the password hash also invalidates every session after a
    // password change.
    props.setProperty(sessionKey_(token), expectedHash);
    return {token: token};
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
  if (!token || token.length > 200 || !passwordHash || props.getProperty(sessionKey_(token)) !== passwordHash) {
    throw new Error('Session expired. Please sign in again.');
  }
}

