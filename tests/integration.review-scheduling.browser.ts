import { chromium, expect, type Page } from '@playwright/test';
import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { createEmptyCard } from 'ts-fsrs';
import { createApp } from '../src/server/app';
import { connectDatabase } from '../src/server/db';
import { createLink, consumeLink } from '../src/server/auth';
import { loadCourse } from '../src/server/course';
import { nextCard, trainingQueue } from '../src/server/reviews';
import { disposableDatabase } from './helpers/disposable-database';
import { nextFixtureIp } from './helpers/fixture-ip';
import { ratingOptions } from '../src/client/review-ratings';
import type { ReviewQueue } from '../src/shared/types';

const url = process.env.JAPANESE_INTEGRATION_DATABASE_URL;
if (!url || !disposableDatabase(new URL(url))) throw new Error('Disposable local test DB required');
const db=connectDatabase(url), course=loadCourse(), dist=resolve(import.meta.dir,'../dist');
const output=resolve(import.meta.dir,'../test-results/review-scheduling'); mkdirSync(output,{recursive:true});
let app: ReturnType<typeof createApp>;
const server=Bun.serve({hostname:'127.0.0.1',port:0,fetch:async request=>{
  const path=new URL(request.url).pathname;
  if(path.startsWith('/api/'))return app.fetch(request);
  const file=resolve(dist,'.'+decodeURIComponent(path==='/'?'/index.html':path));
  if(!file.startsWith(dist+'/'))return new Response('Not found',{status:404});
  const asset=Bun.file(file);return await asset.exists()?new Response(asset):new Response('Not found',{status:404});
}});
const base=server.url.origin;
app=createApp({database:db,course,config:{DATABASE_URL:url,BETTER_AUTH_SECRET:crypto.randomUUID()+crypto.randomUUID(),APP_URL:base,HOST:'127.0.0.1',PORT:server.port!}});
const browser=await chromium.launch({channel:'chrome',headless:true}), users:string[]=[],emails:string[]=[],errors:string[]=[];
const snap=(page:Page)=>page.evaluate(()=> (window as any).__ALBUM__.snapshot());
async function click(page:Page,id:string) {
  await page.waitForFunction(id=>(window as any).__ALBUM__?.snapshot().controls?.some((c:any)=>c.id===id&&c.enabled),id);
  const before=await snap(page),control=before.controls.find((c:any)=>c.id===id);
  await page.mouse.click(control.rect.x+control.rect.width/2,control.rect.y+control.rect.height/2);
  await page.waitForFunction(renderCount=>(window as any).__ALBUM__.snapshot().renderCount>renderCount,before.renderCount);
}
try {
  for(const width of [390,320,1280]) {
    const context=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce',extraHTTPHeaders:{'x-forwarded-for':nextFixtureIp()}});
    const email=`fsrs-browser-${crypto.randomUUID()}@example.test`,password='FSRS-local-test-only!';emails.push(email);
    const link=await createLink(db,'invite',email,null);await consumeLink(db,'invite',link.token,password,'FSRS browser');
    const [user]=await db.sql`select id from users where email=${email}`;users.push(user.id);
    const signed=await context.request.post(base+'/api/auth/sign-in/email',{headers:{origin:base},data:{email,password}});expect(signed.status()).toBe(200);
    const targets=[...new Set((await trainingQueue(db,user.id,course,{topicId:'questions',sectionId:'questions'})).items.map(item=>item.targetId))].slice(0,2);
    let mature=nextCard(null,3,new Date('2024-01-01'));
    for(let i=0;i<4;i++)mature=nextCard(mature,3,mature.due);
    for(const mode of ['ja-ru','ru-ja','listening']) {
      const card=mode==='ja-ru'?mature:nextCard(null,4,new Date());
      await db.sql`insert into review_states(user_id,item_id,mode,version,card,due) values(${user.id},${targets[0]!},${mode},7,${card},${card.due})`;
    }
    const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
    let queue:ReviewQueue|undefined;
    await context.route('**/api/reviews?mode=mixed',async route=>{const response=await route.fetch();queue=await response.json();await route.fulfill({response});});
    await page.goto(base);await page.waitForFunction(()=>(window as any).__ALBUM__?.snapshot().authenticated);
    if(width<600)await click(page,'nav-menu');await click(page,'reviews');await click(page,'review-start');await click(page,'show-answer');
    await page.waitForFunction(()=>(window as any).__ALBUM__.snapshot().controls.some((c:any)=>c.id==='grade-hard'));
    const state=await snap(page),grades=state.controls.filter((c:any)=>c.id.startsWith('grade-'));
    expect(grades.map((c:any)=>c.text)).toEqual(ratingOptions(queue!.items[0]!.schedule).map(option=>option.text));
    expect(grades).toHaveLength(4);expect(state.problems).toEqual([]);
    for(const control of grades){expect(control.rect.x).toBeGreaterThanOrEqual(0);expect(control.rect.x+control.rect.width).toBeLessThanOrEqual(width+1);}
    await page.screenshot({path:`${output}/four-grades-${width}.png`,fullPage:true});
    if(width<600){await click(page,'nav-menu');await click(page,'home');await click(page,'nav-menu');}else await click(page,'album-lessons');
    await click(page,'reviews');await page.waitForFunction(()=>(window as any).__ALBUM__.snapshot().controls.some((c:any)=>c.id==='grade-hard'&&c.enabled));
    expect((await snap(page)).revealed).toBe(true);
    await click(page,'grade-hard');await page.waitForFunction(()=>(window as any).__ALBUM__.snapshot().review.remaining===0);
    const [stored]=await db.sql`select card,version from review_states where user_id=${user.id} and item_id=${targets[0]!} and mode='ja-ru'`;
    expect(stored.version).toBe(8);expect(stored.card.reps).toBe(mature.reps+1);expect(stored.card.lapses).toBe(mature.lapses);
    // A second card becomes due shortly in real time; no client or FSRS clock is mocked.
    const due=new Date(Date.now()+2500);
    for(const mode of ['ja-ru','ru-ja','listening']) {
      const card=mode==='ja-ru'?createEmptyCard(due):nextCard(null,4,new Date());
      await db.sql`insert into review_states(user_id,item_id,mode,version,card,due) values(${user.id},${targets[1]!},${mode},0,${card},${card.due})`;
    }
    await click(page,'review-next');await page.waitForFunction(()=>(window as any).__ALBUM__.snapshot().review.total===0);
    await page.waitForFunction(()=>(window as any).__ALBUM__.snapshot().review.remaining===1);
    await click(page,'review-start');await click(page,'show-answer');
    await page.waitForFunction(()=>(window as any).__ALBUM__.snapshot().controls.some((c:any)=>c.id==='grade-again'));
    expect((await snap(page)).controls.filter((c:any)=>c.id.startsWith('grade-')).map((c:any)=>c.text)).toEqual(['Снова\n1 мин','Трудно\n6 мин','Хорошо\n10 мин','Легко\n8 дн.']);
    await click(page,'grade-again');await page.waitForFunction(()=>(window as any).__ALBUM__.snapshot().review.remaining===0);
    await page.waitForTimeout(300);expect((await snap(page)).review.remaining).toBe(0);
    await page.reload();if(width<600)await click(page,'nav-menu');await click(page,'reviews');
    await page.waitForFunction(()=>(window as any).__ALBUM__.snapshot().page==='review'&&!(window as any).__ALBUM__.snapshot().guided.busy);
    expect((await snap(page)).review.remaining).toBe(0);
    // The compatible React client uses the same server intervals and preserves Hard/Easy.
    if(width===390) {
      await db.sql`update review_states set due=now()-interval '1 second' where user_id=${user.id} and item_id=${targets[1]!} and mode='ja-ru'`;
      await page.goto(base+'/legacy.html');await page.getByRole('navigation',{name:'Разделы',exact:true}).getByRole('button',{name:'Повторение',exact:true}).click();
      await page.getByRole('button',{name:'Начать повторение',exact:false}).click();await page.getByTestId('card-face').click();
      await expect(page.locator('.review-ratings button')).toHaveCount(4);await page.locator('.review-ratings button[data-rating="4"]').click();
      await expect(page.getByTestId('portion-complete')).toBeVisible();
      const [attempt]=await db.sql`select result from review_attempts where user_id=${user.id} order by created_at desc limit 1`;
      expect(attempt.result.rating).toBe(4);
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
      const construction=(await trainingQueue(db,user.id,course,{lessonId:course.learning!.find(route=>route.lessonId.endsWith('.03'))!.lessonId})).items.find(item=>item.mode==='grammar')!;
      const grammarCard=createEmptyCard(new Date());
      await db.sql`insert into review_states(user_id,item_id,mode,version,card,due) values(${user.id},${construction.targetId},'grammar',0,${grammarCard},${grammarCard.due})`;
      await page.goto(base);await click(page,'nav-menu');await click(page,'reviews');await click(page,'review-start');
      await page.waitForFunction(()=>(window as any).__ALBUM__.snapshot().review.mode==='grammar');
      const grammar=queue!.items[0]!;if(grammar.mode!=='grammar')throw new Error('Missing construction');
      for(const id of grammar.exercise.acceptedOrders[0]!)await click(page,'token:'+grammar.exercise.tokens.findIndex(token=>token.id===id));
      await click(page,'builder-check');await page.waitForFunction(()=>{const state=(window as any).__ALBUM__.snapshot();return state.workspace?.verdict==='correct'&&state.controls.filter((c:any)=>c.id.startsWith('grade-')).length===4;});
      expect((await snap(page)).controls.filter((c:any)=>c.id.startsWith('grade-'))).toHaveLength(4);
      expect((await snap(page)).problems).toEqual([]);
      await page.screenshot({path:`${output}/construction-grades-390.png`,fullPage:true});
      await click(page,'grade-easy');await page.waitForFunction(()=>(window as any).__ALBUM__.snapshot().review.remaining===0);
      const [grammarAttempt]=await db.sql`select result from review_attempts where user_id=${user.id} and mode='grammar' order by created_at desc limit 1`;
      expect(grammarAttempt.result).toMatchObject({rating:4,status:'scheduled'});
    }
    await context.unrouteAll({behavior:'wait'});await context.close();
  }
  expect(errors).toEqual([]);console.log('PASS: four interval buttons at 320/390/1280; mature Hard preserved; real-time due return; Again waits; navigation and reload; React Easy; construction Easy.');
} finally {
  await browser.close();server.stop(true);
  for(const id of users)await db.sql`delete from users where id=${id}`;
  for(const email of emails)await db.sql`delete from access_links where email=${email}`;
  await db.sql.close();
}
