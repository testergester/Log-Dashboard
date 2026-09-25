import { CONFIGURED_ENDPOINT, ENDPOINT_STORAGE_KEY, SESSION_STORAGE_KEY } from "./config.js";
import { todayInTashkent } from "./dates.js";

export const state = {
  endpoint: localStorage.getItem(ENDPOINT_STORAGE_KEY) || CONFIGURED_ENDPOINT || "",
  token: localStorage.getItem(SESSION_STORAGE_KEY) || "",
  classes: [],
  logs: [],
  students: [],
  enrollments: [],
  checklists: [],
  studentRecords: [],
  studentsReady: false,
  selectedDate: todayInTashkent(),
  selectedClassId: "",
  selectedStudentId: "",
  view: "day",
  drafts: new Map(),
  checklistDrafts: new Map(),
  savingLessonKey: "",
  savingChecklistKey: "",
  pending: false
};

export function upsert(items, match, value) {
  const index = items.findIndex(match);
  if (index < 0) items.push(value);
  else items[index] = value;
}
