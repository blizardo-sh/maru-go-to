import { learningState, advanceLearning } from '../src/server/learning';
import { learningReviewItem, introduceTraining, submitReview } from '../src/server/reviews';
import { chromium, expect, type Page } from '@playwright/test';
import { resolve } from 'node:path';
import { mkdirSync,writeFileSync } from 'node:fs';
import { createApp } from '../src/server/app';
import { connectDatabase } from '../src/server/db';
import { createLink,consumeLink } from '../src/server/auth';
import { loadCourse } from '../src/server/course';
import { disposableDatabase } from './helpers/disposable-database';
import { nextFixtureIp } from './helpers/fixture-ip';
const url=process.env.JAPANESE_INTEGRATION_DATABASE_URL;
if(!url||!disposableDatabase(new URL(url)))throw new Error('Disposable database only');
const db=connectDatabase(url),course=loadCourse(),dist=resolve(import.meta.dir,'../dist'),output=resolve(import.meta.dir,'../test-results/visual-word-cards');mkdirSync(output,{recursive:true});
let app:ReturnType<typeof createApp>;
const server=Bun.serve({hostname:'127.0.0.1',port:0,fetch:async request=>{const path=new URL(request.url).pathname;if(path.startsWith('/api/'))return app.fetch(request);const file=resolve(dist,'.'+decodeURIComponent(path==='/'?'/index.html':path));if(!file.startsWith(dist+'/'))return new Response('',{status:404});const asset=Bun.file(file);return await asset.exists()?new Response(asset):new Response('',{status:404});}});
const base=server.url.origin;app=createApp({database:db,course,config:{DATABASE_URL:url,BETTER_AUTH_SECRET:crypto.randomUUID()+crypto.randomUUID(),APP_URL:base,HOST:'127.0.0.1',PORT:server.port!}});
const browser=await chromium.launch({headless:true,args:['--use-angle=swiftshader']}),users:string[]=[],emails:string[]=[],errors:string[]=[],checks:unknown[]=[];
const snap=(page:Page)=>page.evaluate(()=>(window as any).__ALBUM__.snapshot());
async function click(page:Page,id:string){try{await page.waitForFunction(id=>(window as any).__ALBUM__?.snapshot().controls?.some((c:any)=>c.id===id&&c.enabled),id);}catch(error){console.error('Unavailable control',id,JSON.stringify(await snap(page)));throw error;}const before=await snap(page),c=before.controls.find((c:any)=>c.id===id);await page.mouse.click(c.rect.x+c.rect.width/2,c.rect.y+c.rect.height/2);await page.waitForFunction(count=>(window as any).__ALBUM__.snapshot().renderCount>count,before.renderCount);}
async function trainers(page:Page){await page.waitForFunction(()=>{const s=(window as any).__ALBUM__?.snapshot();return s?.ready&&s.controls.some((c:any)=>['nav-menu','practice-menu','home'].includes(c.id)&&c.enabled);});const s=await snap(page);if(s.controls.some((c:any)=>c.id==='nav-menu'))await click(page,'nav-menu');else if(!s.controls.some((c:any)=>c.id==='practice-menu'))await click(page,'home');await click(page,'practice-menu');}
const viewports=[[1280,720],[390,844],[320,568],[844,390]] as const;
async function geometry(page:Page,label:string){
 const kind=label.slice(label.indexOf('-')+1);
 for(const [width,height] of viewports){
  await page.setViewportSize({width,height});await page.waitForTimeout(100);
  const state=await snap(page);console.log('Checking',width,kind);
  if(kind!=='question')await page.screenshot({path:resolve(output,`${width}-${kind}.png`),animations:'disabled',timeout:60000});
  expect(state.problems,`${width}-${kind}`).toEqual([]);
  for(const c of state.controls){expect(c.rect.x,c.id).toBeGreaterThanOrEqual(-1);expect(c.rect.y,c.id).toBeGreaterThanOrEqual(-1);expect(c.rect.x+c.rect.width,c.id).toBeLessThanOrEqual(width+1);expect(c.rect.y+c.rect.height,c.id).toBeLessThanOrEqual(height+1);}
 }
 await page.setViewportSize({width:1280,height:720});await page.waitForTimeout(100);
}


try {
 const context=await browser.newContext({viewport:{width:1280,height:720},reducedMotion:'reduce',extraHTTPHeaders:{'x-forwarded-for':nextFixtureIp()}});
 const email=`visual-browser-${crypto.randomUUID()}@example.test`,password='Visual-browser-local-only!';emails.push(email);
 const link=await createLink(db,'invite',email,null);await consumeLink(db,'invite',link.token,password,'Visual browser');const [user]=await db.sql`select id from users where email=${email}`;users.push(user.id);
 expect((await context.request.post(base+'/api/auth/sign-in/email',{headers:{origin:base},data:{email,password}})).status()).toBe(200);
 const page=await context.newPage();page.setDefaultTimeout(20000);page.on('pageerror',error=>errors.push(error.message));
 const lessonId='marugoto.starter-a1.lesson.01';
 async function openLesson(){await page.goto(base);await page.waitForFunction(()=>(window as any).__ALBUM__?.snapshot().authenticated);await click(page,'lesson:'+lessonId);await click(page,'book-learn');}
 await openLesson();await page.waitForFunction(()=>(window as any).__ALBUM__.snapshot().controls.some((c:any)=>c.id==='intro-next'&&c.enabled));await geometry(page,'1280-introduction');
 expect((await snap(page)).texts.some((t:any)=>t.text===course.catalog!.wordCards!.entries[(course.learning![0]!.goals[0]!.parts[0]!.words[0]!.wordId)]!.captionRu)).toBe(true);
 async function advanceTo(mode:string){for(let i=0;i<100;i++){const state=await learningState(db,user.id,course,lessonId);if(state.step?.kind==='word-practice'&&state.step.mode===mode)return state;
 if(!state.step)throw new Error('Expected visual step');await advanceLearning(db,user.id,course,lessonId,{attemptId:crypto.randomUUID(),routeVersion:state.routeVersion,stateVersion:state.version,stepId:state.step.id,action:state.step.kind==='word-intro'?'continue':state.step.kind.endsWith('practice')?'remember':'continue',...(state.step.kind==='word-practice'?{rating:3,recall:{helped:false}}:{})});}throw new Error('Visual step not reached');}
 for(const mode of ['picture-word','word-meaning']){
  const state=await advanceTo(mode),step=state.step!;await openLesson();await page.waitForFunction(()=>(window as any).__ALBUM__.snapshot().controls.some((c:any)=>c.id==='show-answer'&&c.enabled));
  const card=course.catalog!.wordCards!.entries[(step as any).wordId]!;expect((await snap(page)).texts.some((t:any)=>t.text===card.captionRu)).toBe(false);
  await geometry(page,'1280-'+mode+'-question');await click(page,'show-answer');await geometry(page,'1280-'+mode+'-answer');expect((await snap(page)).texts.some((t:any)=>t.text===card.captionRu)).toBe(true);expect((await snap(page)).texts.some((t:any)=>t.text.includes(card.meaningRu))).toBe(true);
  if(mode==='picture-word'){let lose=true;await context.route('**/api/learning/**/advance',async route=>{if(lose){lose=false;await route.fetch();await route.abort('failed');}else await route.continue();});}
  const previous=await snap(page);await click(page,'grade-hard');
  if(mode==='picture-word'){await page.waitForFunction(()=>(window as any).__ALBUM__.snapshot().guided.error);await click(page,'retry-save');}
  await page.waitForFunction(version=>(window as any).__ALBUM__.snapshot().guided.version>version,previous.guided.version);checks.push({mode,guided:true,captionOnReveal:true});
 }
 // Actual learned pair enters the normal mixed repeat flow; text scores are untouched.
 const word=course.words.find(w=>course.catalog!.wordCards!.entries[w.id]?.surface==='日本語')!;
 const pair=await Promise.all((['picture-word','word-meaning'] as const).map(mode=>learningReviewItem(db.sql,user.id,course,mode,word.id)));
 await introduceTraining(db,user.id,course,pair.map(i=>i.id),'learning');for(const item of pair)await submitReview(db,user.id,course,{attemptId:crypto.randomUUID(),reviewId:item.id,version:item.version,mode:item.mode as 'picture-word'|'word-meaning',rating:3});
 await db.sql`update review_states set due=now()+interval '1 day' where user_id=${user.id}`;
 await db.sql`update review_states set due=now()-interval '1 hour' where user_id=${user.id} and item_id=${word.id} and mode in ('picture-word','word-meaning')`;
 await page.goto(base);await page.waitForFunction(()=>(window as any).__ALBUM__?.snapshot().authenticated);await click(page,'reviews');await click(page,'review-start');
 for(let i=0;i<2;i++){await page.waitForFunction(()=>(window as any).__ALBUM__.snapshot().controls.some((c:any)=>c.id==='show-answer'&&c.enabled));const mode=(await snap(page)).review.mode;expect(['picture-word','word-meaning']).toContain(mode);await geometry(page,'1280-review-'+mode+'-question');await click(page,'show-answer');await geometry(page,'1280-review-'+mode+'-answer');const before=(await snap(page)).review.completed;await click(page,'grade-easy');await page.waitForFunction(n=>(window as any).__ALBUM__.snapshot().review.completed>n,before);}

 // A failing image cannot be graded through keyboard shortcuts; retry restores the same card.
 await db.sql`update review_states set due=now()-interval '1 hour' where user_id=${user.id} and item_id=${word.id} and mode in ('picture-word','word-meaning')`;
 const storageState=await context.storageState();
 const broken=await browser.newContext({storageState,viewport:{width:1280,height:720},reducedMotion:'reduce'});let failArt=true;
 await broken.route('**/assets/a1-words/**',async route=>failArt?route.abort('failed'):route.continue());
 const bp=await broken.newPage();bp.setDefaultTimeout(20000);await bp.goto(base);await bp.waitForFunction(()=>(window as any).__ALBUM__?.snapshot().authenticated);await click(bp,'reviews');await click(bp,'review-start');
 if((await snap(bp)).review.mode==='word-meaning')await click(bp,'show-answer');
 await bp.waitForFunction(()=>(window as any).__ALBUM__.snapshot().controls.some((c:any)=>c.id==='word-art-retry'));
 const beforeAttempts=await db.sql`select attempt_id from review_attempts where user_id=${user.id}`;
 await bp.keyboard.press('Space');await bp.keyboard.press('4');await bp.waitForTimeout(100);expect(await db.sql`select attempt_id from review_attempts where user_id=${user.id}`).toEqual(beforeAttempts);
 failArt=false;await click(bp,'word-art-retry');await bp.waitForFunction(()=>(window as any).__ALBUM__.snapshot().controls.some((c:any)=>['show-answer','grade-remember'].includes(c.id)&&c.enabled));await broken.close();
 // The compatible React renderer exposes the same two directions and native ruby.
 const legacy=await browser.newContext({storageState,viewport:{width:390,height:844},reducedMotion:'reduce'}),lp=await legacy.newPage();
 await lp.goto(base+'/legacy.html');await lp.getByRole('navigation',{name:'Разделы',exact:true}).getByRole('button',{name:'Повторение',exact:true}).click();await lp.getByRole('button',{name:'Начать повторение',exact:true}).click();
 for(let i=0;i<2;i++){
  const face=lp.locator('.flip-front [data-visual-word-mode]');await expect(face).toBeVisible();expect(await face.locator('.visual-word-caption').count()).toBe(0);
  const mode=await face.getAttribute('data-visual-word-mode');expect(['picture-word','word-meaning']).toContain(mode);
  if(mode==='word-meaning')await expect(face.locator('ruby')).toBeVisible();else expect(await face.locator('ruby').count()).toBe(0);
  await lp.getByTestId('card-face').click();await expect(lp.locator('.flip-back .visual-word-caption')).toBeVisible();await expect(lp.locator('.flip-back ruby')).toBeVisible();await lp.screenshot({path:resolve(output,'react-'+mode+'.png')});
  await lp.getByRole('group',{name:'Оценка вспоминания',exact:true}).locator('[data-rating="3"]').click();
  await expect.poll(async()=>Number((await db.sql`select sum(version)::int as n from review_states where user_id=${user.id} and item_id=${word.id} and mode in ('picture-word','word-meaning')`)[0].n)).toBe(5+i);
 }
 await legacy.close();
 // The A1 vocabulary entry selects five illustrated words and completes both formats.
 await page.goto(base);await page.waitForFunction(()=>(window as any).__ALBUM__?.snapshot().authenticated);await click(page,'lesson:'+lessonId);
 await page.waitForFunction(()=>{const state=(window as any).__ALBUM__.snapshot();return state.page==='book'&&!state.book.loading&&state.controls.some((c:any)=>c.id==='book-learn');});
 for(let n=0;n<8&&!((await snap(page)).controls.some((c:any)=>c.id==='book-train'));n++)await click(page,'book-next');
 await click(page,'book-train');await click(page,'review-visual');await page.waitForFunction(()=>(window as any).__ALBUM__.snapshot().review.total===10);
 const trained=new Set<string>();
 for(let n=0;n<10;n++){
  let state=await snap(page);if(state.controls.some((c:any)=>c.id==='training-intro'))await click(page,'training-intro');
  await page.waitForFunction(()=>(window as any).__ALBUM__.snapshot().controls.some((c:any)=>c.id==='show-answer'&&c.enabled));trained.add((await snap(page)).review.mode);await click(page,'show-answer');const before=(await snap(page)).review.completed;await click(page,'grade-remember');await page.waitForFunction(n=>(window as any).__ALBUM__.snapshot().review.completed>n,before);
 }
 expect([...trained].sort()).toEqual(['picture-word','word-meaning']);
 checks.push({a1VisualVocabularyEntry:true,fiveWordBatch:true});checks.push({imageFailureBlocksKeyboardGrade:true,retryKeepsCard:true,reactBothDirections:true});
 // The longest A1 translation and caption must also fit the narrow and landscape layouts.
 const denseId=Object.entries(course.catalog!.wordCards!.entries).sort(([,a],[,b])=>(b.meaningRu.length+b.captionRu.length)-(a.meaningRu.length+a.captionRu.length))[0]![0];
 const densePair=await Promise.all((['picture-word','word-meaning'] as const).map(mode=>learningReviewItem(db.sql,user.id,course,mode,denseId)));
 await introduceTraining(db,user.id,course,densePair.map(item=>item.id),'learning');for(const item of densePair)await submitReview(db,user.id,course,{attemptId:crypto.randomUUID(),reviewId:item.id,version:item.version,mode:item.mode as 'picture-word'|'word-meaning',rating:3});
 await db.sql`update review_states set due=now()+interval '1 day' where user_id=${user.id}`;
 await db.sql`update review_states set due=now()-interval '1 hour' where user_id=${user.id} and item_id=${denseId} and mode='word-meaning'`;
 await page.goto(base);await page.waitForFunction(()=>(window as any).__ALBUM__?.snapshot().authenticated);await click(page,'reviews');await click(page,'review-start');await click(page,'show-answer');
 await page.waitForFunction(()=>(window as any).__ALBUM__.snapshot().controls.some((c:any)=>c.id==='grade-remember'&&c.enabled));await geometry(page,'1280-dense-answer');checks.push({longestCaptionFits:true});
 await context.close();expect(errors).toEqual([]);writeFileSync(resolve(output,'checks.json'),JSON.stringify({checks,viewports,errors,reviewBothDirections:true},null,2));console.log(JSON.stringify({passed:true,checks,errors}));
}catch(error){console.error(error);process.exitCode=1;}finally{await browser.close();server.stop(true);for(const id of users)await db.sql`delete from users where id=${id}`;for(const email of emails)await db.sql`delete from access_links where email=${email}`;await db.sql.close();}
