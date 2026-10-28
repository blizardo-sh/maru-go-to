import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';
import { SQL } from 'bun';
import { hashPassword } from 'better-auth/crypto';
const root = new URL('./.local/rehearsal-20261028/', import.meta.url);
assert.ok(!existsSync(new URL('login.json', root)), 'Local credentials already exist; do not rotate them on normal startup.');
const runtime = JSON.parse(readFileSync(new URL('runtime.json', root), 'utf8'));
assert.equal(new URL(runtime.database).pathname, '/japanese_pixi_work');
assert.equal(new URL(runtime.database).hostname, '127.0.0.1');
assert.ok(readFileSync(new URL('initial-audit.json', root), 'utf8').includes('"identical": true'));
const sql = new SQL(runtime.database);
try {
  const users = await sql`select u.id,u.email,u.name from users u order by (select count(*) from review_states r where r.user_id=u.id) desc,u.id limit 2`;
  const profiles = [];
  for (const user of users) {
    const password = randomBytes(18).toString('base64url'), hash = await hashPassword(password);
    const updated = await sql`update accounts set password=${hash},updated_at=now() where user_id=${user.id} and provider_id='credential' returning id`;
    assert.equal(updated.length, 1);
    await sql`delete from sessions where user_id=${user.id}`;
    profiles.push({ ...user, password });
  }
  writeFileSync(new URL('login.json', root), JSON.stringify(profiles, null, 2) + '\n', { mode: 0o600 });
  writeFileSync(new URL('Вход в локальную копию.txt', root), profiles.map((p, index) => `Профиль ${index + 1}: ${p.name}\nПочта: ${p.email}\nЛокальный пароль: ${p.password}\n`).join('\n') + '\nТолько http://localhost:5191/learn.html. Эти пароли действуют только в рабочем локальном клоне.\n', { mode: 0o600 });
  console.log('Prepared two copied profiles for real local authentication; credentials saved privately. Study state unchanged.');
} finally { await sql.close(); }
