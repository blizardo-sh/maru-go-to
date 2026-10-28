import { SQL } from 'bun';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const privateRoot = new URL('./.local/rehearsal-20261028/', import.meta.url);
const runtime = JSON.parse(readFileSync(new URL('runtime.json', privateRoot), 'utf8'));
assert.equal(new URL(runtime.database).hostname, '127.0.0.1');
assert.equal(new URL(runtime.database).pathname, '/japanese_pixi_work');
const sha = (text: string) => createHash('sha256').update(text).digest('hex');
export async function fingerprint(sql: SQL) {
  const tables = await sql`select tablename from pg_tables where schemaname='public' order by tablename`;
  const result: Record<string, { rows: number; sha256: string; pupils: Record<string, string> }> = {};
  for (const { tablename } of tables) {
    assert.match(tablename, /^[a-z_]+$/);
    const rows = await sql.unsafe(`select to_jsonb(t)::text as row from "${tablename}" t order by to_jsonb(t)::text`);
    const groups = new Map<string, string[]>();
    for (const { row } of rows) {
      const value = JSON.parse(row), owner = value.user_id ?? (tablename === 'users' ? value.id : null);
      if (owner) { const key = sha(owner); groups.set(key, [...(groups.get(key) ?? []), row]); }
    }
    result[tablename] = { rows: rows.length, sha256: sha(rows.map((r: any) => r.row).join('\n')), pupils: Object.fromEntries([...groups].map(([key, values]) => [key, sha(values.join('\n'))])) };
  }
  return result;
}
if (import.meta.main) {
  const baseline = new SQL(runtime.baseline), work = new SQL(runtime.database);
  try {
    const before = await fingerprint(baseline), after = await fingerprint(work);
    if (process.argv.includes('--initial')) assert.deepEqual(after, before, 'Restored clone differs before first use');
    const report = { snapshot: runtime.snapshot, source: runtime.source, at: new Date().toISOString(), baseline: before, work: after,
      identical: JSON.stringify(before) === JSON.stringify(after) };
    writeFileSync(new URL(process.argv.includes('--initial') ? 'initial-audit.json' : 'current-audit.json', privateRoot), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
    console.log(JSON.stringify({ identical: report.identical, tables: Object.fromEntries(Object.entries(before).map(([name, value]) => [name, value.rows])) }));
  } finally { await baseline.close(); await work.close(); }
}
