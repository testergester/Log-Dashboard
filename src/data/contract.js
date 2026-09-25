/**
 * Phase One data-access boundary. Payloads and returned records retain the
 * existing Apps Script schema. Adapters must return confirmed server records,
 * preserve checklist revisions, and reject failed writes without mutating UI
 * state. See README.md for payload and response details.
 *
 * @typedef {Object} DashboardDataAccess
 * @property {(url: string) => boolean} validEndpoint
 * @property {(input: {username: string, password: string}) => Promise<{token: string, expiresAt: number}>} login
 * @property {(input: {token: string}) => Promise<object>} logout
 * @property {(input: {token: string}) => Promise<{classes: object[], logs: object[], students?: object[], enrollments?: object[], checklists?: object[], studentRecords?: object[]}>} load
 * @property {(input: {token: string, class: object}) => Promise<object>} saveClass
 * @property {(input: {token: string, classId: string}) => Promise<{id: string, updatedAt: string}>} archiveClass
 * @property {(input: {token: string, log: object}) => Promise<object>} saveLog
 * @property {(input: {token: string, student: object}) => Promise<{student: object, enrollment?: object}>} saveStudent
 * @property {(input: {token: string, classId: string, studentId: string, active: boolean}) => Promise<object>} setEnrollment
 * @property {(input: {token: string, checklist: object}) => Promise<{classId: string, date: string, revision: string, updatedAt: string, checklist: {classInfo: object, records: object[]}}>} saveChecklist
 */
export {};
