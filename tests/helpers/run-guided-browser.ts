import { fileURLToPath } from 'node:url';
import { preview, type PreviewServer } from 'vite';
import { createApp } from '../../src/server/app';
import { connectDatabase } from '../../src/server/db';
import { loadCourse } from '../../src/server/course';

const databaseUrl = process.env.JAPANESE_INTEGRATION_DATABASE_URL;
if (!databaseUrl || new URL(databaseUrl).hostname !== '127.0.0.1' || new URL(databaseUrl).pathname !== '/japanese_app_test') throw new Error('Use disposable localhost japanese_app_test only.');
const root = fileURLToPath(new URL('../../', import.meta.url));
const database = connectDatabase(databaseUrl);
const provider = Bun.serve({ hostname:'127.0.0.1', port:0, fetch:() => new Response('Local fixture unavailable', { status:429 }) });
let app: ReturnType<typeof createApp> | undefined;
const api = Bun.serve({ hostname:'127.0.0.1', port:0, fetch:request => app ? app.fetch(request) : new Response('Starting fixture', { status:503 }) });
let web: PreviewServer | undefined;
let child: ReturnType<typeof Bun.spawn> | undefined;
const stop = () => child?.kill();
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
try {
  web = await preview({ root, preview:{ host:'127.0.0.1', port:0, strictPort:true, proxy:{ '/api':`http://127.0.0.1:${api.port}` } } });
  const address = web.httpServer.address();
  if (!address || typeof address === 'string') throw new Error('Missing isolated browser preview port.');
  const base = `http://localhost:${address.port}`;
  app = createApp({ database, course:loadCourse(), config:{ DATABASE_URL:databaseUrl, BETTER_AUTH_SECRET:crypto.randomUUID()+crypto.randomUUID(), APP_URL:base, PORT:3000, HOST:'127.0.0.1', ANALYSIS_PROVIDER:'generic', ANALYSIS_URL:`http://127.0.0.1:${provider.port}/chat/completions`, ANALYSIS_MODEL:'isolated-guided-browser', ANALYSIS_FREE_ONLY:'true' } });
  child = Bun.spawn([process.execPath, Bun.argv[2] ?? 'tests/integration.guided.browser.ts'], { cwd:root, env:{ ...process.env, GUIDED_BROWSER_URL:base, GUIDED_BROWSER_API_URL:`http://localhost:${api.port}` }, stdout:'inherit', stderr:'inherit' });
  process.exitCode = await child.exited;
} finally {
  process.removeListener('SIGINT', stop);
  process.removeListener('SIGTERM', stop);
  await web?.close();
  api.stop(true);
  provider.stop(true);
  await database.sql.close();
}
