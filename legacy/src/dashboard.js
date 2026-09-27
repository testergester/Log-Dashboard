import { dataAccess } from './data/index.js';
import { canonicalTime } from './dates.js';
import { state } from './state.js';
import { render } from './ui.js';

export async function loadData() {
  const data = await dataAccess.load({token: state.token});
  if (!Array.isArray(data.classes) || !Array.isArray(data.logs)) throw new Error("The spreadsheet returned unexpected data.");
  const studentKeys = ["students", "enrollments", "checklists", "studentRecords"];
  const hasStudentData = studentKeys.every(key => Array.isArray(data[key]));
  if (!hasStudentData && studentKeys.some(key => data[key] !== undefined)) {
    throw new Error("Student records are incomplete. Run setupDashboard and redeploy Apps Script.");
  }
  state.classes = data.classes.map(item => ({...item, start: canonicalTime(item.start), end: canonicalTime(item.end)}));
  state.logs = data.logs.map(item => ({...item, start: canonicalTime(item.start), end: canonicalTime(item.end)}));
  state.students = hasStudentData ? data.students : [];
  state.enrollments = hasStudentData ? data.enrollments : [];
  state.checklists = hasStudentData ? data.checklists : [];
  state.studentRecords = hasStudentData ? data.studentRecords : [];
  state.studentsReady = hasStudentData;
  render();
}
