import Papa from 'papaparse';

export const IMPORT_FILE_LIMIT = 1024 * 1024;
export const IMPORT_ROW_LIMIT = 100;
export const IMPORT_TEMPLATE = 'name,external_id\r\nAda Rahim,STU-001\r\n';

const clean = value => String(value ?? '').trim();
const normalizedName = value => clean(value).normalize('NFC').toLocaleLowerCase();

export function parseStudentInput(text) {
  if (new TextEncoder().encode(text).length > IMPORT_FILE_LIMIT)
    return { error: 'The import exceeds 1 MB.' };
  const parsed = Papa.parse(text, { header: false, skipEmptyLines: 'greedy' });
  const problem = parsed.errors.find(item => item.code !== 'UndetectableDelimiter');
  if (problem) return { error: `CSV row ${(problem.row ?? 0) + 1}: ${problem.message}` };
  const data = parsed.data.map((cells, index) => ({ rowNumber: index + 1, cells: cells.map(clean) }));
  if (!data.length) return { error: 'Add at least one student.' };
  const first = data[0].cells.map(value => value.toLowerCase().replace(/[^a-z0-9]/g, ''));
  const nameIndex = first.indexOf('name');
  const externalIndex = first.indexOf('externalid');
  const hasHeader = nameIndex !== -1;
  const width = Math.max(...data.map(row => row.cells.length));
  return { data, hasHeader, nameColumn: hasHeader ? nameIndex : 0,
    externalColumn: hasHeader && externalIndex !== -1 ? externalIndex : -1,
    columns: Array.from({ length: width }, (_, index) => `Column ${index + 1}${hasHeader ? ` · ${data[0].cells[index] || 'unnamed'}` : ''}`) };
}

export function previewStudentImport({ data, hasHeader, nameColumn, externalColumn, students, enrollments,
  groupId, startsOn, decisions = {} }) {
  const rows = hasHeader ? data.slice(1) : data;
  if (rows.length > IMPORT_ROW_LIMIT) return { error: 'Import up to 100 rows at a time.', rows: [] };
  if (!rows.length) return { error: 'Add at least one student row.', rows: [] };
  if (nameColumn < 0 || nameColumn === externalColumn) return { error: 'Map different columns for name and external ID.', rows: [] };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startsOn) || Number.isNaN(Date.parse(`${startsOn}T00:00:00Z`)))
    return { error: 'Choose a valid enrollment start date.', rows: [] };
  const extCounts = new Map(); const nameCounts = new Map();
  for (const row of rows) {
    if (decisions[row.rowNumber]?.action === 'skip') continue;
    const name = clean(row.cells[nameColumn]); const externalId = externalColumn < 0 ? '' : clean(row.cells[externalColumn]);
    if (externalId) extCounts.set(externalId, (extCounts.get(externalId) || 0) + 1);
    if (name) nameCounts.set(normalizedName(name), (nameCounts.get(normalizedName(name)) || 0) + 1);
  }
  return { rows: rows.map(row => {
    const name = clean(row.cells[nameColumn]); const externalId = externalColumn < 0 ? '' : clean(row.cells[externalColumn]);
    const existingById = externalId ? students.find(student => student.external_id === externalId) : null;
    const possible = students.filter(student => normalizedName(student.name) === normalizedName(name));
    const choice = decisions[row.rowNumber] || {};
    const issues = [];
    if ([...name].length < 1 || [...name].length > 120) issues.push('Name must be 1–120 characters.');
    if ([...externalId].length > 120) issues.push('External ID must be at most 120 characters.');
    if (externalId && extCounts.get(externalId) > 1) issues.push('External ID repeats in this import.');
    if (name && nameCounts.get(normalizedName(name)) > 1) issues.push('Name repeats in this import.');
    if (existingById && normalizedName(existingById.name) !== normalizedName(name)) issues.push(`External ID belongs to ${existingById.name}; their name will stay unchanged.`);
    else if (possible.length) issues.push(`${possible.length} student${possible.length === 1 ? '' : 's'} with this name already exist${possible.length === 1 ? 's' : ''}.`);
    const ambiguous = !!(existingById && normalizedName(existingById.name) !== normalizedName(name)) || possible.length > 0 ||
      (name && nameCounts.get(normalizedName(name)) > 1) || (externalId && extCounts.get(externalId) > 1);
    const action = choice.action || (!issues.length ? 'create' : existingById && !ambiguous ? 'use_existing' : '');
    const studentId = choice.studentId || (existingById?.id || '');
    const selected = students.find(student => student.id === studentId);
    if (action === 'create' && existingById) issues.push('Choose Use existing or change the external ID before creating.');
    if (action === 'use_existing' && (!selected || (externalId && selected.external_id !== externalId))) issues.push('Choose a matching existing student.');
    const enrolled = !!(selected && enrollments.some(item => item.group_id === groupId && item.student_id === selected.id &&
      item.starts_on <= startsOn && (!item.ends_on || startsOn < item.ends_on)));
    const blocking = action !== 'skip' && (issues.some(issue => issue.startsWith('Name must') || issue.startsWith('External ID must') ||
      issue.startsWith('External ID repeats') ||
      issue.startsWith('Choose ')) || !action);
    return { rowNumber: row.rowNumber, name, externalId, existingById, possible, action, studentId,
      selected, enrolled, issues, blocking };
  }) };
}
