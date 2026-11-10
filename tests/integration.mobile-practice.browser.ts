import {chromium,expect,type Page} from '@playwright/test';
import {resolve} from 'node:path';
import {createApp} from '../src/server/app';
import {connectDatabase} from '../src/server/db';
import {createLink,consumeLink} from '../src/server/auth';
import {loadCourse} from '../src/server/course';
import {learningReviewItem} from '../src/server/reviews';
import {defaultSettings} from '../src/server/material';
import {seedAcceptedHistory} from './helpers/introduced-browser-fixture';
import {disposableDatabase} from './helpers/disposable-database';
import {output} from './helpers/artifact-output';
import {nextFixtureIp} from './helpers/fixture-ip';
import type {ReviewItem,ReviewQueue} from '../src/shared/types';

const url=process.env.JAPANESE_INTEGRATION_DATABASE_URL;
if(!url||!disposableDatabase(new URL(url)))throw new Error('Disposable database only');
const db=connectDatabase(url),course=loadCourse(),dist=resolve(import.meta.dir,'../dist');
let app:ReturnType<typeof createApp>;
const server=Bun.serve({hostname:'127.0.0.1',port:0,fetch:async request=>{
 const path=new URL(request.url).pathname;if(path.startsWith('/api/'))return app.fetch(request);
 const file=resolve(dist,'.'+decodeURIComponent(path==='/'?'/index.html':path));if(!file.startsWith(dist+'/'))return new Response('',{status:404});
 const asset=Bun.file(file);return await asset.exists()?new Response(asset):new Response('',{status:404});
}});
const base=server.url.origin;app=createApp({database:db,course,config:{DATABASE_URL:url,BETTER_AUTH_SECRET:crypto.randomUUID()+crypto.randomUUID(),APP_URL:base,HOST:'127.0.0.1',PORT:server.port!}});
const browser=await chromium.launch({headless:true,args:['--use-angle=swiftshader']}),email=`mobile-practice-${crypto.randomUUID()}@example.test`,password='Mobile-practice-isolated-fixture!';
let owner='';const errors:string[]=[],checks:unknown[]=[];
const snap=(page:Page)=>page.evaluate(()=>(window as any).__ALBUM__.snapshot());
async function click(page:Page,id:string){
 await page.waitForFunction(id=>{const s=(window as any).__ALBUM__?.snapshot();return s?.ready&&s.controls.some((c:any)=>c.id===id&&c.enabled);},id);
 const s=await snap(page),c=s.controls.find((c:any)=>c.id===id);await page.mouse.click(c.rect.x+c.rect.width/2,c.rect.y+c.rect.height/2,{delay:60});
 await page.waitForFunction(n=>(window as any).__ALBUM__.snapshot().renderCount>n,s.renderCount);
}
const overlaps=(a:any,b:any)=>Math.min(a.x+a.width,b.x+b.width)>Math.max(a.x,b.x)+1&&Math.min(a.y+a.height,b.y+b.height)>Math.max(a.y,b.y)+1;
async function geometry(page:Page,label:string){
 for(const [width,height] of [[390,844],[320,740],[844,390],[1280,900]] as const){
  await page.setViewportSize({width,height});await page.waitForFunction(v=>{const c=document.querySelector<HTMLCanvasElement>('#stage > canvas');return c?.style.width===`${v.width}px`&&c.style.height===`${v.height}px`;},{width,height});
  const s=await snap(page);if(label.startsWith('counter-'))expect(s.pictures).toHaveLength(1);expect(s.problems,`${label} ${width}`).toEqual([]);
  for(const c of s.controls){expect(c.rect.x,c.id).toBeGreaterThanOrEqual(-1);expect(c.rect.y,c.id).toBeGreaterThanOrEqual(-1);expect(c.rect.x+c.rect.width,c.id).toBeLessThanOrEqual(width+1);expect(c.rect.y+c.rect.height,c.id).toBeLessThanOrEqual(height+1);}
  for(const picture of s.pictures){for(const text of s.texts)expect(overlaps(picture,text.bounds),text.text).toBe(false);for(const c of s.controls)expect(overlaps(picture,c.rect),c.id).toBe(false);}
  await page.screenshot({path:`${output}/mobile-practice-${label}-${width}.png`});checks.push({label,width,height,noImageOverlap:true});
 }
 await page.setViewportSize({width:390,height:844});await page.waitForFunction(()=>document.querySelector<HTMLCanvasElement>('#stage > canvas')?.style.width==='390px');
}
try {
 const link=await createLink(db,'invite',email,null);await consumeLink(db,'invite',link.token,password,'Mobile practice');const [user]=await db.sql`select id from users where email=${email}`;owner=user.id;
 const table=course.words.find(word=>word.kana==='テーブル')!;await seedAcceptedHistory(db,course,email,[table.id,course.words.find(word=>word.kana==='ほん')!.id],[]);
 const context=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce',extraHTTPHeaders:{'x-forwarded-for':nextFixtureIp()}});
 expect((await context.request.post(base+'/api/auth/sign-in/email',{headers:{origin:base},data:{email,password}})).status()).toBe(200);
 expect((await context.request.put(base+'/api/settings',{headers:{origin:base,'X-Learning-Learner-Id':owner},data:{...defaultSettings,orthography:'furigana',animations:false,sceneSoundEnabled:false}})).status()).toBe(200);
 const page=await context.newPage();page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(e.message));
 let card:Extract<ReviewItem,{mode:'counter'}>|undefined;
 await context.route('**/api/training?counters=true',async route=>{const response=await route.fetch(),queue:ReviewQueue=await response.json();card=queue.items.find(item=>item.mode==='counter'&&item.counter.kind==='image-counter'&&item.counter.word.id===table.id) as typeof card;expect(card).toBeDefined();await route.fulfill({response,json:{...queue,items:[card],remainingDue:1}});});
 await page.goto(base);await page.waitForFunction(()=>{const s=(window as any).__ALBUM__?.snapshot();return s?.ready&&s.authenticated&&s.settings&&!s.guided.busy;});
 await click(page,'nav-menu');await click(page,'practice-menu');await click(page,'counters');await click(page,'counter-study');await click(page,'counter-intro');
 await page.waitForFunction(()=>(window as any).__ALBUM__.snapshot().pictures.length===1);
 await geometry(page,'counter-question');
 const wrong=card!.counter.options.find(option=>!card!.counter.acceptedKeys.includes(option.key))!.key,submitted:any[]=[];let lose=true;
 await context.route(url=>url.pathname==='/api/reviews',async route=>{if(route.request().method()!=='POST'){await route.continue();return;}submitted.push(route.request().postDataJSON());const response=await route.fetch();if(lose){lose=false;await route.abort('failed');}else await route.fulfill({response});});
 await click(page,wrong);await click(page,'retry-save');await page.waitForFunction(()=>(window as any).__ALBUM__.snapshot().controls.some((c:any)=>c.id==='counter-next'&&c.enabled));
 expect(submitted).toHaveLength(2);expect(submitted[0]).toEqual(submitted[1]);expect((await snap(page)).texts.some((t:any)=>t.text.startsWith('Неверно. Правильный ответ:'))).toBe(true);
 await geometry(page,'counter-wrong');const before=(await snap(page)).renderedKey;await page.waitForTimeout(1100);expect((await snap(page)).renderedKey).toBe(before);
 const [{count}]=await db.sql`select count(*)::int as count from review_attempts where user_id=${owner}`;expect(count).toBe(1);
 await click(page,'counter-next');await click(page,card!.counter.acceptedKeys[0]!);await page.waitForFunction(()=>(window as any).__ALBUM__.snapshot().controls.some((c:any)=>c.id==='counter-next'&&c.enabled));
 expect((await snap(page)).texts.some((t:any)=>t.text==='Верно!')).toBe(true);await geometry(page,'counter-correct');await click(page,'counter-next');expect(submitted).toHaveLength(3);

 const exercise=course.exercises.find(e=>e.promptRu==='Моя старшая сестра живёт в Киото.')!;
 const wordIds=[...new Set(exercise.tokens.map(t=>course.forms.find(f=>f.id===t.formId)!.wordId))];await seedAcceptedHistory(db,course,email,wordIds,[exercise.skillId]);
 const grammar=await learningReviewItem(db.sql,owner,course,'grammar',exercise.skillId,exercise.id);if(grammar.preparation)grammar.preparation.introduced=true;
 await context.route('**/api/reviews?mode=mixed',route=>route.fulfill({json:{items:[grammar],remainingDue:1,remainingNew:0}}));
 await page.reload();await page.waitForFunction(()=>{const s=(window as any).__ALBUM__?.snapshot();return s?.ready&&s.authenticated&&s.settings&&!s.guided.busy;});await click(page,'nav-menu');await click(page,'reviews');await click(page,'review-start');
 await page.waitForFunction(()=>(window as any).__ALBUM__.snapshot().controls.some((c:any)=>c.id.startsWith('token:')));
 const question=await snap(page);const tokens=question.controls.filter((c:any)=>c.id.startsWith('token:'));expect(tokens.length).toBe(exercise.tokens.length);
 for(const token of tokens){expect(token.text).not.toMatch(/\p{Script=Han}/u);expect(question.texts.find((t:any)=>t.text===token.text).size).toBeGreaterThanOrEqual(24);}
 await click(page,'workspace-add');await page.getByLabel('Найти слово',{exact:true}).fill('てーぶる');
 await page.waitForFunction(()=>(window as any).__ALBUM__.snapshot().controls.some((c:any)=>c.id.startsWith('replace:')&&c.text.startsWith('てーぶる ·')));await click(page,'workspace-close');
 await geometry(page,'builder-question');
 for(const id of exercise.acceptedOrders[0]!)await click(page,'token:'+exercise.tokens.findIndex(t=>t.id===id));
 await click(page,'builder-check');await page.waitForFunction(()=>(window as any).__ALBUM__.snapshot().workspace?.verdict==='correct');await geometry(page,'builder-correct');
 expect((await snap(page)).texts.some((t:any)=>t.text.startsWith('✓ Верно.'))).toBe(true);expect(errors).toEqual([]);
 await Bun.write(`${output}/mobile-practice-green.json`,JSON.stringify({checks,errors,lostAckOneWrite:true,bothCounterOutcomes:true,kanaFragments:true,largeType:true},null,2));console.log(JSON.stringify({passed:true,checks:checks.length,errors}));await context.close();
}finally{await browser.close();server.stop(true);if(owner)await db.sql`delete from users where id=${owner}`;await db.sql`delete from access_links where email=${email}`;await db.sql.close();}
