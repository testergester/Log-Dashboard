#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createDatabase, teacherA } from '../tests/helpers/database.js';
import { prepareLegacyExport, migrationSql } from './migrate-legacy.js';

const workspaceId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

async function main() {
  const [exportFlag, exportPath, startFlag, scheduleStartDate] = process.argv.slice(2);
  if (exportFlag !== '--export' || !exportPath || startFlag !== '--schedule-start' || !scheduleStartDate) {
    throw new Error('Use --export PATH --schedule-start YYYY-MM-DD');
  }
  const sourceText = await readFile(exportPath, 'utf8');
  const source = JSON.parse(sourceText);
  const prepared = prepareLegacyExport(source, { ownerId: teacherA, workspaceId, scheduleStartDate });
  const db = await createDatabase();
  try {
    await db.query('insert into public.workspaces(id, owner_id, display_name, timezone) values ($1, $2, $3, $4)',
      [workspaceId, teacherA, 'Migration rehearsal', 'Asia/Tashkent']);
    const sql = migrationSql(prepared, { ownerId: teacherA, workspaceId });
    await db.exec(sql);
    await db.exec(sql);
    console.log(JSON.stringify({ mode: 'local-rehearsal-passed', exportSha256: createHash('sha256').update(sourceText).digest('hex'),
      counts: prepared.expected, historicalSlotFallbacks: prepared.mapped.migration_warnings.historical_slot_fallbacks }));
  } finally {
    await db.close();
  }
}

main().catch(error => {
  console.error(`REHEARSAL_ERROR: ${error.code || 'UNKNOWN'} ${error.message}`);
  process.exitCode = 1;
});
