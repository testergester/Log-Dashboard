import { TZ } from "./config.js";

export function todayInTashkent() {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(new Date());
  const value = name => parts.find(part => part.type === name).value;
  return value("year") + "-" + value("month") + "-" + value("day");
}

export function dateAtUTC(date) {
  return new Date(date + "T12:00:00Z");
}

export function addDays(date, count) {
  const value = dateAtUTC(date);
  value.setUTCDate(value.getUTCDate() + count);
  return value.toISOString().slice(0, 10);
}

export function weekday(date) {
  return (dateAtUTC(date).getUTCDay() + 6) % 7 + 1;
}

export function mondayOf(date) {
  return addDays(date, 1 - weekday(date));
}

export function formatDate(date, options) {
  return new Intl.DateTimeFormat("en", {timeZone: "UTC", ...options}).format(dateAtUTC(date));
}

export function timeNowInTashkent() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  }).formatToParts(new Date());
  return Number(parts.find(part => part.type === "hour").value) * 60 +
    Number(parts.find(part => part.type === "minute").value);
}

export function minutes(time) {
  const [hour, minute] = String(time).split(":").map(Number);
  return hour * 60 + minute;
}

export function canonicalTime(value) {
  const match = String(value || "").trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?$/i);
  if (!match) return String(value || "").trim();
  let hour = Number(match[1]);
  const minute = Number(match[2]);
  const meridiem = String(match[3] || "").toUpperCase();
  if (minute > 59 || (!meridiem && hour > 23) || (meridiem && (hour < 1 || hour > 12))) return String(value || "").trim();
  if (meridiem) hour = hour % 12 + (meridiem === "PM" ? 12 : 0);
  return String(hour).padStart(2, "0") + ":" + String(minute).padStart(2, "0");
}
