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
const db=connectDatabase(url),course=loadCourse(),dist=resolve(import.meta.dir,'../dist'),output=resolve(import.meta.dir,'../test-results/kana-fsrs');mkdirSync(output,{recursive:true});
let app:ReturnType<typeof createApp>;
const server=Bun.serve({hostname:'127.0.0.1',port:0,fetch:async request=>{const path=new URL(request.url).pathname;if(path.startsWith('/api/'))return app.fetch(request);const file=resolve(dist,'.'+decodeURIComponent(path==='/'?'/index.html':path));if(!file.startsWith(dist+'/'))return new Response('',{status:404});const asset=Bun.file(file);return await asset.exists()?new Response(asset):new Response('',{status:404});}});
const base=server.url.origin;app=createApp({database:db,course,config:{DATABASE_URL:url,BETTER_AUTH_SECRET:crypto.randomUUID()+crypto.randomUUID(),APP_URL:base,HOST:'127.0.0.1',PORT:server.port!}});
const browser=await chromium.launch({headless:true,args:['--use-angle=swiftshader']}),users:string[]=[],emails:string[]=[],errors:string[]=[],checks:unknown[]=[];
const snap=(page:Page)=>page.evaluate(()=>(window as any).__ALBUM__.snapshot());
async function click(page:Page,id:string){await page.waitForFunction(id=>(window as any).__ALBUM__?.snapshot().controls?.some((c:any)=>c.id===id&&c.enabled),id);const before=await snap(page),c=before.controls.find((c:any)=>c.id===id);await page.mouse.click(c.rect.x+c.rect.width/2,c.rect.y+c.rect.height/2);await page.waitForFunction(count=>(window as any).__ALBUM__.snapshot().renderCount>count,before.renderCount);}
async function trainers(page:Page){await page.waitForFunction(()=>{const s=(window as any).__ALBUM__?.snapshot();return s?.ready&&s.controls.some((c:any)=>['nav-menu','practice-menu','home'].includes(c.id)&&c.enabled);});const s=await snap(page);if(s.controls.some((c:any)=>c.id==='nav-menu'))await click(page,'nav-menu');else if(!s.controls.some((c:any)=>c.id==='practice-menu'))await click(page,'home');await click(page,'practice-menu');}
const viewports=[[1280,720],[390,844],[320,740],[844,390]] as const;
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

try{
 for(const [width,height] of [viewports[0]]){
  const context=await browser.newContext({viewport:{width,height},reducedMotion:'reduce',extraHTTPHeaders:{'x-forwarded-for':nextFixtureIp()}}),email=`kana-browser-${crypto.randomUUID()}@example.test`,password='Kana-browser-local-only!';emails.push(email);
  const link=await createLink(db,'invite',email,null);await consumeLink(db,'invite',link.token,password,'Kana browser');const [user]=await db.sql`select id from users where email=${email}`;users.push(user.id);
  expect((await context.request.post(base+'/api/auth/sign-in/email',{headers:{origin:base},data:{email,password}})).status()).toBe(200);
  const page=await context.newPage();page.setDefaultTimeout(20000);page.on('pageerror',error=>errors.push(error.message));await page.goto(base);await page.waitForFunction(()=>(window as any).__ALBUM__?.snapshot().authenticated);
  await trainers(page);await click(page,'kana');await click(page,'kana-row:1');console.log('Checking rows',width);await geometry(page,`${width}-rows`);expect((await snap(page)).kana.rows).toEqual([0,1]);
  await click(page,'kana-start');await page.waitForFunction(()=>(window as any).__ALBUM__.snapshot().kana.introducing);expect((await snap(page)).kana.total).toBe(10);await page.waitForFunction(()=>performance.getEntriesByType('resource').some((e:any)=>e.name.includes('/assets/kana/')));await geometry(page,`${width}-introduction`);
  for(let i=0;i<10;i++){await expect.poll(async()=>{if((await snap(page)).kana.turn===i)await click(page,'kana-intro-next');return (await snap(page)).kana.turn;}).toBe(i+1);}expect((await snap(page)).kana.revealed,'recall hides mnemonic after all introductions').toBe(false);await geometry(page,`${width}-question`);
  await click(page,'kana-reveal');await geometry(page,`${width}-answer`);
  if(width===1280){let lose=true;await context.route('**/api/kana/reviews',async route=>{if(lose){lose=false;await route.fetch();await route.abort('failed');}else await route.continue();});await click(page,'grade-hard');await page.waitForFunction(()=>(window as any).__ALBUM__.snapshot().kana.error);await click(page,'kana-retry');}else await click(page,'grade-hard');
  await page.waitForFunction(()=>(window as any).__ALBUM__.snapshot().kana.completed===1&&!((window as any).__ALBUM__.snapshot().kana.busy));expect(await db.sql`select 1 from kana_attempts where user_id=${user.id}`).toHaveLength(1);expect((await db.sql`select card from kana_states where user_id=${user.id}`)[0].card.reps).toBe(1);
  await click(page,'kana-pause');await click(page,'kana-end');await click(page,'kana-script:katakana');await click(page,'kana-practice');await click(page,'kana-reveal');await click(page,'grade-easy');await page.waitForFunction(()=>(window as any).__ALBUM__.snapshot().kana.completed===1);expect(await db.sql`select 1 from kana_states where user_id=${user.id}`).toHaveLength(1);
  await page.reload();await page.waitForFunction(()=>(window as any).__ALBUM__?.snapshot().authenticated);await trainers(page);await click(page,'kana');await page.waitForFunction(()=>!(window as any).__ALBUM__.snapshot().kana.busy);expect((await snap(page)).kana.script).toBe('katakana');expect((await snap(page)).kana.rows).toEqual([0,1]);
  await trainers(page);await click(page,'counters');await page.waitForFunction(()=>(window as any).__ALBUM__.snapshot().controls.some((c:any)=>c.id==='counter-study'&&c.enabled));await geometry(page,`${width}-counters`);
  checks.push({width,height,introductionCaptions:true,reveal:true,serverAnswer:true,practicePreservesSchedule:true,selectionSurvivesReload:true});await context.close();
 }
 // Compatible React renderer uses the same server schedule and introduction/answer captions.
 const context=await browser.newContext({viewport:{width:390,height:844},extraHTTPHeaders:{'x-forwarded-for':nextFixtureIp()}});
 expect((await context.request.post(base+'/api/auth/sign-in/email',{headers:{origin:base},data:{email:emails[0],password:'Kana-browser-local-only!'}})).status()).toBe(200);
 const page=await context.newPage();await page.goto(base+'/legacy.html');await page.getByRole('button',{name:'Тренировки',exact:true}).click();await page.getByRole('button',{name:'Тренировать хирагану',exact:true}).click();await page.getByRole('button',{name:/Учить выбранные/}).click();await expect(page.locator('figcaption')).toBeVisible();await page.screenshot({path:resolve(output,'react-introduction.png')});await context.close();
 expect(errors).toEqual([]);writeFileSync(resolve(output,'checks.json'),JSON.stringify({checks,viewports,errors,react:true},null,2));console.log(JSON.stringify({passed:true,checks,viewports,react:true,errors}));
}catch(error){console.error(error);process.exitCode=1;}finally{await browser.close();server.stop(true);for(const id of users)await db.sql`delete from users where id=${id}`;for(const email of emails)await db.sql`delete from access_links where email=${email}`;await db.sql.close();}
