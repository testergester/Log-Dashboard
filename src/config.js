// Public runtime settings are loaded before the module entry point.
const runtime = globalThis.TEACHING_DASHBOARD_CONFIG || {};
export const CONFIGURED_ENDPOINT = runtime.appsScriptEndpoint || "";
export const TZ = runtime.timezone || "Asia/Tashkent";
export const ENDPOINT_STORAGE_KEY = "teaching-dashboard-endpoint";
export const SESSION_STORAGE_KEY = "teaching-dashboard-session";
export const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
export const STANDARD_LESSON_TYPES = ["Lesson", "Quiz", "Exam"];
