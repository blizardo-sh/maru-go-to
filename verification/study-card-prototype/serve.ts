// Throwaway preview: published course data only; all learner API requests are rejected.
import { createServer } from 'vite';
import { loadCourse } from '../../src/server/course';
import { defaultSettings } from '../../src/server/material';
const course = loadCourse(), empty = { due: 0, learned: 0, reviewedToday: 0 };
const data = { course, settings: defaultSettings, lists: [], learning: [], progress: { counters: [], introducedWordIds: [], introducedSkillIds: [], completedLessons: 0, totalLessons: course.lessons.length, wordsIntroducedToday: 0, skillsIntroducedToday: 0, byMode: { 'ja-ru': empty, 'ru-ja': empty, listening: empty, grammar: empty, counter: empty } } };
const server = await createServer({ root: new URL('../..', import.meta.url).pathname, plugins: [{ name: 'study-card-prototype', configureServer(server) { server.middlewares.use((request, response, next) => {
  if (request.url?.startsWith('/api/')) { response.statusCode = 405; response.end('Read-only prototype'); return; }
  if (request.url?.split('?')[0] !== '/__study-card-data') return next();
  if (request.method !== 'GET') { response.statusCode = 405; response.end('Read-only prototype'); return; }
  response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(data));
}); } }], server: { host: '127.0.0.1', port: 0, strictPort: true }, logLevel: 'warn' });
await server.listen(); const address = server.httpServer!.address(); if (!address || typeof address === 'string') throw new Error('No preview port');
console.info(`PROTOTYPE_URL=http://127.0.0.1:${address.port}/?prototype=study-cards&variant=A`);
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => { void server.close().then(() => process.exit(0)); });
