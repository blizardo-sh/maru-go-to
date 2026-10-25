// Throwaway, read-only preview of the current course. No API or learner persistence.
import { createServer } from 'vite';
import { loadCourse } from '../../src/server/course';
import { learningParts } from '../../src/shared/learning';
const course = loadCourse();
const lessons = course.lessons.map(lesson => { const route = course.learning?.find(route => route.lessonId === lesson.id); return { id: lesson.id, number: lesson.number, title: lesson.title, topic: lesson.topic, parts: route ? learningParts(route).length : 0, goals: route?.goals.map(goal => goal.titleRu) ?? [] }; });
const server = await createServer({ root: new URL('../..',import.meta.url).pathname, plugins: [{ name:'lesson-card-prototype-data', configureServer(server) { server.middlewares.use((request,response,next) => { if(request.url?.startsWith('/api/')) { response.statusCode=405; response.end('Read-only prototype'); return; } if(request.url?.split('?')[0] !== '/__lesson-card-prototype-data') return next(); response.setHeader('Content-Type','application/json'); response.end(JSON.stringify(lessons)); }); } }], server:{host:'127.0.0.1',port:0,strictPort:true}, logLevel:'warn' });
await server.listen(); const address = server.httpServer!.address(); if(!address || typeof address === 'string') throw new Error('No prototype port');
console.info(`PROTOTYPE_URL=http://127.0.0.1:${address.port}/?prototype=lesson-cards&variant=A`);
for(const signal of ['SIGINT','SIGTERM'] as const)process.on(signal,()=>{void server.close().then(()=>process.exit(0));});
