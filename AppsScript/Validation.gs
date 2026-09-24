function text_(value, label, max, required) {
  const result = String(value == null ? '' : value).trim();
  if (required && !result) throw new Error(label + ' is required.');
  if (result.length > max) throw new Error(label + ' is too long.');
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(result)) throw new Error(label + ' contains unsupported characters.');
  return /^[=+\-@]/.test(result) ? "'" + result : result;
}

function groupId_(value) {
  const result = String(value == null ? '' : value).trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._ -]{0,79}$/.test(result)) {
    throw new Error('Group ID must start with a letter or number and use only letters, numbers, spaces, dots, underscores, or hyphens.');
  }
  return result;
}

function jsonText_(value, label, max, required) {
  const result = String(value == null ? '' : value).trim();
  if (required && !result) throw new Error(label + ' is required.');
  if (result.length > max) throw new Error(label + ' is too long.');
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(result)) throw new Error(label + ' contains unsupported characters.');
  return result;
}

function time_(value, label) {
  const result = storedTime_(value);
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(result)) throw new Error(label + ' must use HH:MM.');
  return result;
}

function storedTime_(value) {
  const text = String(value == null ? '' : value).trim();
  const match = text.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?$/i);
  if (!match) return text;
  let hour = Number(match[1]);
  const minute = Number(match[2]);
  const meridiem = String(match[3] || '').toUpperCase();
  if (minute > 59 || (!meridiem && hour > 23) || (meridiem && (hour < 1 || hour > 12))) return text;
  if (meridiem) hour = hour % 12 + (meridiem === 'PM' ? 12 : 0);
  return ('0' + hour).slice(-2) + ':' + ('0' + minute).slice(-2);
}

function timeMinutes_(value) {
  const parts = storedTime_(value).split(':').map(Number);
  return parts.length === 2 && parts.every(function(part) { return Number.isFinite(part); })
    ? parts[0] * 60 + parts[1] : Number.MAX_SAFE_INTEGER;
}

function date_(value) {
  const result = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result)) throw new Error('Lesson date must use YYYY-MM-DD.');
  const date = new Date(result + 'T00:00:00Z');
  if (isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== result) throw new Error('Invalid lesson date.');
  return result;
}

function timestamp_() {
  return Utilities.formatDate(new Date(), DASHBOARD.timezone, 'yyyy-MM-dd HH:mm:ss');
}

