import { fileURLToPath } from 'node:url';
import { chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, preview } from 'vite';
import { createApp } from '../../src/server/app';
import { createLink, consumeLink } from '../../src/server/auth';
import { loadCourse } from '../../src/server/course';
import { connectDatabase } from '../../src/server/db';

const databaseUrl = process.env.JAPANESE_INTEGRATION_DATABASE_URL;
if (!databaseUrl || new URL(databaseUrl).hostname !== '127.0.0.1' || new URL(databaseUrl).pathname !== '/japanese_app_test') throw new Error('Use disposable localhost japanese_app_test only.');
const base = 'http://localhost:5298';
const fixturePath = process.env.ALBUM_FIXTURE_PATH ?? join(tmpdir(),'maru-album-fixture.json');
const root = fileURLToPath(new URL('../../', import.meta.url));
const database = connectDatabase(databaseUrl);
const actors: { id: string; email: string; password: string; name: string }[] = [];
const provider = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response('Isolated fixture: external analysis disabled', { status: 429 }) });
const app = createApp({ database, course: loadCourse(), config: { DATABASE_URL: databaseUrl, BETTER_AUTH_SECRET: crypto.randomUUID() + crypto.randomUUID(), APP_URL: base, PORT: 3098, HOST: '127.0.0.1', ANALYSIS_PROVIDER: 'generic', ANALYSIS_URL: `http://127.0.0.1:${provider.port}/chat/completions`, ANALYSIS_MODEL: 'isolated-album-browser', ANALYSIS_FREE_ONLY: 'true' } });
const api = Bun.serve({ hostname: '127.0.0.1', port: 3098, fetch: request => app.fetch(request) });
let web:{close():Promise<void>}|undefined;
const built=process.env.ALBUM_PREVIEW_BUILT==='true';
const webOptions={host:'127.0.0.1',port:5298,strictPort:true,proxy:{'/api':'http://127.0.0.1:3098'}};
try {
  for (const name of ['Album preview', 'Album browser A', 'Album browser B', 'Album legacy']) {
    const email = `album-${crypto.randomUUID()}@example.test`;
    const password = `Album-fixture-${crypto.randomUUID()}!`;
    const link = await createLink(database, 'invite', email, null);
    if (!await consumeLink(database, 'invite', link.token, password, name)) throw new Error('Fixture invitation failed');
    const [user] = await database.sql`select id from users where email=${email}`;
    await database.sql`update users set is_admin=false where id=${user.id}`;
    actors.push({ id: String(user.id), email, password, name });
  }
  if(built)web=await preview({root,preview:webOptions});else{const source=await createServer({root,server:webOptions});web=source;await source.listen();}
  await Bun.write(fixturePath, JSON.stringify({ base, api: 'http://localhost:3098', database: 'japanese_app_test', pid: process.pid, actors }, null, 2));
  await chmod(fixturePath, 0o600);
  console.info(JSON.stringify({ ready: true, built, base, api: 'http://127.0.0.1:3098', fixturePath, pid: process.pid, actors: actors.length }));
  // Use stdin instead of Vite's process signal hook so asynchronous fixture cleanup can finish.
  await new Promise<void>(resolve => { process.stdin.setEncoding('utf8'); const stop=(chunk:string)=>{if(chunk.trim()==='stop'){process.stdin.removeListener('data',stop);process.stdin.pause();resolve();}};process.stdin.on('data',stop);process.stdin.resume(); });
} finally {
  await web?.close(); api.stop(true); provider.stop(true);
  for (const actor of actors) { await database.sql`delete from access_links where email=${actor.email}`; await database.sql`delete from users where id=${actor.id}`; }
  await database.sql.close();
}
