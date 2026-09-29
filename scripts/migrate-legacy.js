#!/usr/bin/env node
import { readFile, writeFile, chmod } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { mapLegacyDashboard } from '../supabase/legacy-mapping.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TABLES = [
  ['groups', 'id,workspace_id,name,subject,code,archived'],
  ['schedule_slots', 'id,workspace_id,group_id'],
  ['schedule_slot_versions', 'id,workspace_id,schedule_slot_id,weekday,start_time,end_time,room,effective_from,effective_to'],
  ['students', 'id,workspace_id,name,external_id'],
  ['enrollments', 'id,workspace_id,group_id,student_id,starts_on,ends_on'],
  ['meetings', 'id,workspace_id,schedule_slot_id,slot_version_id,group_id,original_date,actual_date,start_time,end_time,group_name,subject,room'],
  ['lesson_records', 'workspace_id,meeting_id,notes,rating,lesson_type,status'],
  ['attendance_checklists', 'workspace_id,meeting_id'],
  ['attendance_entries', 'workspace_id,meeting_id,student_id,student_name,attendance,participation,note']
];
const sqlString = value => `'${String(value).replaceAll("'", "''")}'`;

export function prepareLegacyExport(source, options) {
  if (source?.formatVersion !== 1 || !source.snapshot || !source.exportedAt) throw new Error('Expected an owner export with formatVersion 1');
  if (!UUID.test(String(options.ownerId)) || !UUID.test(String(options.workspaceId))) throw new Error('Explicit owner and workspace UUIDs are required');
  const forbidden = /password|session|token|secret|salt|credential/i;
  function check(value) {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (forbidden.test(key)) throw new Error(`Sensitive field in export: ${key}`);
      check(child);
    }
  }
  check(source.snapshot);
  const mapped = mapLegacyDashboard(source.snapshot, { workspaceId: options.workspaceId, scheduleStartDate: options.scheduleStartDate });
  const expected = Object.fromEntries(TABLES.map(([table]) => [table, mapped[table].length]));
  const perStudent = {};
  for (const student of mapped.students) perStudent[student.id] = { recorded: 0, present: 0, absent: 0, points: 0 };
  for (const entry of mapped.attendance_entries) {
    const total = perStudent[entry.student_id];
    total.recorded++;
    total[entry.attendance]++;
    total.points += entry.attendance === 'absent' ? -1 : entry.participation;
  }
  return { mapped, expected, perStudent };
}

export function migrationSql({ mapped, expected, perStudent }, { ownerId, workspaceId }) {
  const lines = [
    '-- Contains private student records. Store securely; never commit or share this SQL.',
    'begin;',
    `do $$ begin if not exists (select 1 from public.workspaces where id = ${sqlString(workspaceId)}::uuid and owner_id = ${sqlString(ownerId)}::uuid) then raise exception using errcode = 'TD003', message = 'OWNER_WORKSPACE_MISMATCH'; end if; end $$;`
  ];
  for (const [table, columnList] of TABLES) {
    const rows = mapped[table];
    if (!rows.length) continue;
    const columns = columnList.split(',');
    const projected = rows.map(row => Object.fromEntries(columns.map(column => [column, row[column] ?? null])));
    const json = sqlString(JSON.stringify(projected));
    lines.push(`insert into public.${table} (${columnList}) select ${columns.map(column => `e.${column}`).join(', ')} from jsonb_populate_recordset(null::public.${table}, ${json}::jsonb) e on conflict do nothing;`);
    const key = table === 'lesson_records' || table === 'attendance_checklists' ? 'meeting_id' : 'id';
    const join = table === 'attendance_entries'
      ? 't.meeting_id = e.meeting_id and t.student_id = e.student_id'
      : `t.${key} = e.${key}`;
    const equality = columns.map(column => `t.${column} is not distinct from e.${column}`).join(' and ');
    lines.push(`do $$ begin if exists (select 1 from jsonb_populate_recordset(null::public.${table}, ${json}::jsonb) e left join public.${table} t on t.workspace_id = e.workspace_id and ${join} where not (${equality})) then raise exception using errcode = 'TD004', message = 'MIGRATION_ROW_MISMATCH', detail = '${table}'; end if; end $$;`);
  }
  for (const [table] of TABLES) {
    lines.push(`do $$ begin if (select count(*) from public.${table} where workspace_id = ${sqlString(workspaceId)}::uuid) <> ${expected[table]} then raise exception using errcode = 'TD004', message = 'MIGRATION_COUNT_MISMATCH', detail = '${table}'; end if; end $$;`);
  }
  for (const [studentId, total] of Object.entries(perStudent)) {
    lines.push(`do $$ declare actual record; begin select count(*)::integer as recorded, count(*) filter (where attendance = 'present')::integer as present, count(*) filter (where attendance = 'absent')::integer as absent, coalesce(sum(case when attendance = 'absent' then -1 else participation end), 0)::integer as points into actual from public.attendance_entries where workspace_id = ${sqlString(workspaceId)}::uuid and student_id = ${sqlString(studentId)}::uuid; if actual.recorded <> ${total.recorded} or actual.present <> ${total.present} or actual.absent <> ${total.absent} or actual.points <> ${total.points} then raise exception using errcode = 'TD004', message = 'MIGRATION_TOTAL_MISMATCH'; end if; end $$;`);
  }
  lines.push('commit;');
  return `${lines.join('\n')}\n`;
}

function argsFromCli(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!argv[i].startsWith('--') || !argv[i + 1]) throw new Error('Use --export, --owner-id, --workspace-id, --schedule-start, and optionally --output');
    options[argv[i].slice(2)] = argv[i + 1];
  }
  if (!options.export || !options['owner-id'] || !options['workspace-id'] || !options['schedule-start']) throw new Error('Missing required migration option');
  return options;
}

async function main() {
  const args = argsFromCli(process.argv.slice(2));
  const ownerId = args['owner-id'];
  const workspaceId = args['workspace-id'];
  const sourceText = await readFile(args.export, 'utf8');
  const source = JSON.parse(sourceText);
  const prepared = prepareLegacyExport(source, { ownerId, workspaceId, scheduleStartDate: args['schedule-start'] });
  if (args.output) {
    await writeFile(args.output, migrationSql(prepared, { ownerId, workspaceId }), { flag: 'wx', mode: 0o600 });
    await chmod(args.output, 0o600);
  }
  console.log(JSON.stringify({ mode: args.output ? 'sql-generated' : 'dry-run', exportedAt: source.exportedAt,
    exportSha256: createHash('sha256').update(sourceText).digest('hex'), ownerId, workspaceId, counts: prepared.expected,
    studentsWithAttendance: Object.values(prepared.perStudent).filter(item => item.recorded).length }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => {
  console.error(`MIGRATION_ERROR: ${error.message}`);
  process.exitCode = 1;
});
