import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const r=JSON.parse(readFileSync(new URL('./.local/runtime.json',import.meta.url),'utf8')),u=new URL(r.database);
assert.equal(u.hostname,'127.0.0.1');assert.equal(u.port,'55440');assert.match(u.pathname,/^\/japanese_pixi_m8_published_\d+$/);assert.equal(r.origin,'http://localhost:5202');
// Explicit local test stub; root start has no provider unless configured.
const stub=Bun.serve({hostname:'127.0.0.1',port:0,fetch:()=>Response.json({choices:[{message:{content:JSON.stringify({translationRu:'Локальная проба свободного ввода',grammar:'uncertain',naturalness:'uncertain',explanationRu:'В стенде внешний анализ отключён. Подготовленные ответы проверяет настоящий сервер.',warnings:['Локальный образец анализа.']})}}]})});
const env={...process.env,DATABASE_URL:r.database,APP_URL:r.origin,BETTER_AUTH_SECRET:r.secret,HOST:'127.0.0.1',PORT:'5202',AUTH_COOKIE_PREFIX:'pixi-m8',ANALYSIS_PROVIDER:'generic',ANALYSIS_URL:stub.url.origin+'/chat/completions',ANALYSIS_MODEL:'local-stand-fixture',ANALYSIS_FREE_ONLY:'true',OPENROUTER_API_KEY:'',ANALYSIS_API_KEY:'',PATH:process.execPath.slice(0,process.execPath.lastIndexOf('/'))+':'+process.env.PATH};
const child=Bun.spawn([process.execPath,'run','start'],{cwd:new URL('../../',import.meta.url).pathname,env,stdout:'inherit',stderr:'inherit'});
for(const signal of ['SIGTERM','SIGINT'] as const)process.on(signal,()=>{child.kill(signal);void stub.stop();});
await child.exited;await stub.stop();process.exit(child.exitCode??1);
