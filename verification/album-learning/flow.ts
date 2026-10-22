import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { output as artifacts } from '../../tests/helpers/artifact-output';
import { checkAlbumOverview, checkTextbookDocument } from './checks';
import type { Course } from '../../src/shared/types';
import { chromium, expect, type BrowserContext, type Page } from '@playwright/test';
import { connectDatabase } from '../../src/server/db';
import { createLink, consumeLink } from '../../src/server/auth';
import { defaultSettings } from '../../src/server/material';
import type { LearningAdvance, LearningState } from '../../src/shared/learning';

type AudioMetricsWindow=Window&{__albumNativeSfx:{at:number;duration:number|undefined}[]};
const databaseUrl = process.env.JAPANESE_INTEGRATION_DATABASE_URL;
if (!databaseUrl || new URL(databaseUrl).hostname !== '127.0.0.1' || new URL(databaseUrl).pathname !== '/japanese_app_test') throw new Error('Disposable test DB required');
const base=process.env.GUIDED_BROWSER_URL??'http://localhost:5298';if(new URL(base).hostname!=='localhost')throw new Error('Use isolated localhost preview, never a human browser host');const output=process.env.ALBUM_ARTIFACT_DIR??join(artifacts,'album-learning');await mkdir(output,{recursive:true});
const database=connectDatabase(databaseUrl); const actors:{id:string;email:string;password:string}[]=[];
const browser=await chromium.launch({channel:'chrome',headless:true});
const context=await browser.newContext({viewport:{width:1280,height:900},reducedMotion:'reduce',extraHTTPHeaders:{'x-forwarded-for':'198.18.98.2'}});
await context.addInitScript(()=>{Math.random=()=>0;const native=AudioBufferSourceNode.prototype.start; (window as AudioMetricsWindow).__albumNativeSfx=[];AudioBufferSourceNode.prototype.start=function(...args:Parameters<typeof native>){(window as AudioMetricsWindow).__albumNativeSfx.push({at:performance.now(),duration:this.buffer?.duration});return native.apply(this,args);};});
// Freeze only the dedicated source preview's dev transport; built-app CI has no HMR.
if(new URL(base).port==='5298')await context.routeWebSocket(url=>['localhost','127.0.0.1'].includes(url.hostname)&&url.port==='5298',socket=>socket.close());
const page=await context.newPage();page.setDefaultTimeout(15000); const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
const lesson='marugoto.starter-a1.lesson.01'; const report:Record<string,unknown>={isolated:true,noDatabaseReset:true}; let owner=''; let release:(()=>void)|undefined;
const session=()=>page.getByTestId('guided-learning');
async function actor(){const email=`album-flow-${crypto.randomUUID()}@example.test`,password=`Album-${crypto.randomUUID()}!`;const link=await createLink(database,'invite',email,null);expect(await consumeLink(database,'invite',link.token,password,'Album flow')).toBe(true);const[row]=await database.sql`select id from users where email=${email}`;const result={id:String(row.id),email,password};actors.push(result);return result;}
async function login(value:typeof actors[number],c:BrowserContext=context){const response=await c.request.post(base+'/api/auth/sign-in/email',{headers:{origin:base},data:{email:value.email,password:value.password}});expect(response.status()).toBe(200);owner=value.id;}
async function state(lessonId=lesson):Promise<LearningState>{const response=await context.request.get(`${base}/api/learning/${lessonId}`,{headers:{'X-Learning-Learner-Id':owner}});expect(response.status()).toBe(200);return response.json();}
async function open(lessonId=lesson,p:Page=page){await p.goto(base);await expect(p.getByTestId('learn-lesson')).toHaveCount(18);await p.locator(`[data-testid=learn-lesson][data-lesson-id="${lessonId}"]`).click();const skip=p.getByRole('button',{name:/Перейти к занятию/});if(await skip.isVisible())await skip.click();await expect(p.getByTestId('guided-learning')).toHaveAttribute('data-step-kind',/./);}
async function readyChoice(){const quiz=page.getByTestId('learning-word-quiz');await expect(quiz).toBeVisible();await expect(page.locator('[data-choice-word-id]')).toHaveCount(4);if(await quiz.getAttribute('data-mode')==='listening'&&!await page.locator('[data-choice-word-id]').first().isEnabled()){const listen=page.getByRole('button',{name:'Прослушать слово',exact:true});await expect(listen).toBeEnabled({timeout:15000});await listen.click();}await expect(page.locator('[data-choice-word-id]').first()).toBeEnabled({timeout:15000});}
async function changed(id:string){await expect(session()).not.toHaveAttribute('data-step-id',id);}
const nativeSfx=()=>page.evaluate(()=>(window as AudioMetricsWindow).__albumNativeSfx.length as number);
const hidden=(value:boolean)=>page.evaluate(value=>{if(value)Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});else Reflect.deleteProperty(document,'hidden');document.dispatchEvent(new Event('visibilitychange'));},value);
async function holdNext(){let arrived:()=>void=()=>{},finished:()=>void=()=>{};const reached=new Promise<void>(resolve=>arrived=resolve),done=new Promise<void>(resolve=>finished=resolve),gate=new Promise<void>(resolve=>release=resolve);let submission:LearningAdvance|undefined;await context.route('**/api/learning/**/advance',async route=>{submission=route.request().postDataJSON();const response=await route.fetch();arrived();await gate;try{await route.fulfill({response});}finally{finished();}});return{reached,get submission(){return submission!;},release:async()=>{release?.();release=undefined;await done;await context.unroute('**/api/learning/**/advance');}};}
try {
  const a=await actor(),b=await actor(); await login(a);
  expect((await context.request.put(base+'/api/settings',{headers:{origin:base,'X-Learning-Learner-Id':owner},data:{...defaultSettings,animations:false,musicVolume:0,ambienceVolume:0}})).status()).toBe(200);
  report.textbook=await checkTextbookDocument(page,base,output);
  if(process.env.ALBUM_BOOK_ONLY!=='true'){
  const course:Course=await(await context.request.get(base+'/api/course')).json();await page.setViewportSize({width:390,height:844});await open('marugoto.starter-a1.lesson.04');await expect(page.getByTestId('learning-word-group')).toBeVisible();report.overview=await checkAlbumOverview(page,course,output);await page.setViewportSize({width:1280,height:900});
  await open();await page.getByTestId('start-learning-practice').click();await readyChoice();
  const quizGeometry:unknown[]=[];
  for(const viewport of [{width:1280,height:900},{width:1280,height:720},{width:390,height:844},{width:320,height:740}]){
    await page.setViewportSize(viewport);await page.waitForTimeout(80);await expect(page.locator('.quiz-feedback .word-illustration')).toHaveCount(0);
    const choices=page.locator('[data-choice-word-id]');for(const choice of await choices.all()){await choice.scrollIntoViewIfNeeded();const geometry=await choice.evaluate(element=>{const r=element.getBoundingClientRect();return{width:r.width,height:r.height,visible:r.top>=0&&r.bottom<=innerHeight,uncovered:element.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))};});expect(geometry.height).toBeGreaterThanOrEqual(44);expect(geometry.width).toBeGreaterThanOrEqual(44);expect(geometry.visible).toBe(true);expect(geometry.uncovered).toBe(true);quizGeometry.push({viewport,...geometry});}
    await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:`${output}/quiz-${viewport.width}x${viewport.height}.png`,fullPage:true});
  }
  report.quizGeometry={cases:quizGeometry,noPreAnswerImage:true};await page.setViewportSize({width:1280,height:900});
  let current=await state();expect(current.wordChoices).toHaveLength(4); const initialChoices=current.wordChoices;
  await page.reload();await open();await readyChoice();expect((await state()).wordChoices).toEqual(initialChoices);report.reloadStableChoices=true;
  // The real server commits first, while its response is withheld from the actual UI.
  const delayed=await holdNext();const step=current.step!;if(step.kind!=='word-practice')throw new Error('Word practice required');
  const sfxBefore=await nativeSfx();await page.locator(`[data-choice-word-id="${step.wordId}"]`).focus();await page.locator(`[data-choice-word-id="${step.wordId}"]`).press('Enter');await delayed.reached;
  await expect(page.getByTestId('learning-word-quiz')).toHaveAttribute('data-feedback','good');await expect(session()).toHaveAttribute('data-step-id',step.id);
  await expect(page.locator('.quiz-feedback')).toContainText('Верно!');await expect(page.locator('[data-choice-word-id]').first()).toBeDisabled();
  await expect.poll(async()=>(await nativeSfx())-sfxBefore).toBe(1);await page.waitForTimeout(1850);await expect(session()).toHaveAttribute('data-step-id',step.id);
  const ackAt=Date.now();await delayed.release();await changed(step.id);expect(Date.now()-ackAt).toBeLessThan(750);expect((await nativeSfx())-sfxBefore).toBe(1);
  report.delayedAck={heldMs:1850,localFeedbackBeforeAck:true,canonicalAdvanceAfterAck:true,noExtraFullDelay:true,oneNativeSfx:true,keyboardChoice:true};
  // Drop a response after commit, then verify the UI retries exactly the same attempt.
  await readyChoice();current=await state();const lostStep=current.step!;if(lostStep.kind!=='word-practice')throw new Error('Missing word');const wrong=current.wordChoices!.find(id=>id!==lostStep.wordId)!;
  const posts:LearningAdvance[]=[];let dropped=false;await context.route('**/api/learning/**/advance',async route=>{posts.push(route.request().postDataJSON());const response=await route.fetch();if(!dropped){dropped=true;await route.abort('failed');}else await route.fulfill({response});});
  const beforeWrong=await nativeSfx();await page.locator(`[data-choice-word-id="${wrong}"]`).click();await expect(page.getByRole('button',{name:'Повторить сохранение',exact:true})).toBeVisible();
  await expect(page.getByTestId('learning-word-quiz')).toHaveAttribute('data-feedback','again');await expect(session()).toHaveAttribute('data-step-id',lostStep.id);
  await expect.poll(async()=>(await nativeSfx())-beforeWrong).toBe(1);await page.waitForTimeout(1700);await expect(session()).toHaveAttribute('data-step-id',lostStep.id);
  await page.getByRole('button',{name:'Повторить сохранение',exact:true}).click();await changed(lostStep.id);await context.unroute('**/api/learning/**/advance');
  expect(posts).toHaveLength(2);expect(posts[0]).toEqual(posts[1]);expect((await nativeSfx())-beforeWrong).toBe(1);
  const[rows]=await database.sql`select (select count(*)::int from learning_attempts where attempt_id=${posts[0]!.attemptId}) as learning,(select count(*)::int from review_attempts where attempt_id=${posts[0]!.attemptId}) as reviews`;expect(rows).toEqual({learning:1,reviews:1});
  report.ambiguousFailure={samePayloadAndAttempt:true,heldQuestionAndResult:true,oneNativeSfx:true,oneLearningAndSrsWrite:true};
  // A hidden page keeps its unconfirmed answer until the server confirms it.
  await readyChoice();current=await state();const beforeHide=current.step!;if(beforeHide.kind!=='word-practice')throw new Error('Missing word');const held=await holdNext();await page.locator(`[data-choice-word-id="${beforeHide.wordId}"]`).click();await held.reached;await hidden(true);await page.waitForTimeout(1000);await expect(session()).toHaveAttribute('data-step-id',beforeHide.id);
  await held.release();await changed(beforeHide.id);const unseen=await session().getAttribute('data-step-id');await page.waitForTimeout(1750);await expect(session()).toHaveAttribute('data-step-id',unseen!);await hidden(false);await expect(session()).toHaveAttribute('data-step-id',unseen!);
  report.hiddenBeforeAck={simulatedVisibility:true,selectionHeldUntilAck:true,canonicalUnseenStepReady:true,noHiddenAutoAdvance:true};
  // Hiding after a quick ACK cancels the presentation timer and exposes only the next canonical task.
  await readyChoice();current=await state();const afterHide=current.step!;if(afterHide.kind!=='word-practice')throw new Error('Missing word');await page.locator(`[data-choice-word-id="${afterHide.wordId}"]`).click();await expect(session()).toHaveAttribute('data-quiz-pending','false');await hidden(true);await changed(afterHide.id);const afterAckId=await session().getAttribute('data-step-id');await page.waitForTimeout(1000);await hidden(false);await expect(session()).toHaveAttribute('data-step-id',afterAckId!);report.hiddenAfterAck=true;
  // A cookie swap never writes an old learner's choice under the new learner.
  await readyChoice();current=await state();const ownerStep=current.step!;if(ownerStep.kind!=='word-practice')throw new Error('Missing word');const beforeB=await database.sql`select count(*)::int as count from learning_attempts where user_id=${b.id}`;
  await context.request.post(base+'/api/auth/sign-out',{headers:{origin:base},data:{}});await login(b);await page.locator(`[data-choice-word-id="${ownerStep.wordId}"]`).click();await expect(page.getByText('Учётная запись изменилась в другой вкладке.',{exact:false})).toBeVisible();
  expect(await database.sql`select count(*)::int as count from learning_attempts where user_id=${b.id}`).toEqual(beforeB);expect(await page.evaluate(id=>JSON.parse(localStorage.getItem(`japanese-pending-learning:${id}`)??'[]').length,a.id)).toBe(1);
  await page.reload();await expect(page.getByTestId('learn-lesson')).toHaveCount(18);expect((await state()).version).toBe(0);report.ownerSwap={noForeignWrite:true,oldOutboxRetained:true,newLearnerFresh:true};
  // A failed sign-out keeps the actual authenticated screen; a retry may leave safely.
  await page.getByLabel('Настройки и аккаунт',{exact:true}).click();
  await context.route('**/api/auth/sign-out',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{code:'FIXTURE_UNAVAILABLE',message:'Fixture sign-out unavailable'}})}),{times:1});
  await page.locator('.hud-menu').getByRole('button',{name:'Выйти',exact:true}).click();await expect(page.getByTestId('learn-lesson')).toHaveCount(18);expect((await context.request.get(base+'/api/me')).status()).toBe(200);
  await page.locator('.hud-menu').getByRole('button',{name:'Выйти',exact:true}).click();await expect(page.getByRole('button',{name:'Войти',exact:true})).toBeVisible();expect((await context.request.get(base+'/api/me')).status()).toBe(401);
  report.failedLogout={screenAndOwnerPreserved:true,retrySignsOut:true};
  await login(b);await open();await page.getByTestId('start-learning-practice').click();await readyChoice();current=await state();const logoutStep=current.step!;if(logoutStep.kind!=='word-practice')throw new Error('Missing word');const pendingLogout=await holdNext();await page.locator(`[data-choice-word-id="${logoutStep.wordId}"]`).click();await pendingLogout.reached;
  await page.getByLabel('Настройки и аккаунт',{exact:true}).click();await page.locator('.hud-menu').getByRole('button',{name:'Выйти',exact:true}).click();await expect(page.getByRole('button',{name:'Войти',exact:true})).toBeVisible();const cuesAtLogout=await nativeSfx();await pendingLogout.release();await page.waitForTimeout(900);await expect(page.getByRole('button',{name:'Войти',exact:true})).toBeVisible();expect(await nativeSfx()).toBe(cuesAtLogout);await expect(page.getByTestId('guided-learning')).toHaveCount(0);
  await login(b);await open();await expect(session()).not.toHaveAttribute('data-step-id',logoutStep.id);const[logoutRows]=await database.sql`select count(*)::int as count from review_attempts where attempt_id=${pendingLogout.submission.attemptId}`;expect(logoutRows.count).toBe(1);report.logoutPendingAck={noLateScreenOrCue:true,savedCanonicalResumes:true,oneSrsWrite:true};
  }
  expect(errors).toEqual([]);report.errors=errors;report.green=true;await Bun.write(`${output}/${process.env.ALBUM_BOOK_ONLY==='true'?'book':'flow'}-green.json`,JSON.stringify(report,null,2));console.info(JSON.stringify(report,null,2));
} catch(error){report.green=false;report.error=error instanceof Error?error.message:String(error);report.errors=errors;await page.screenshot({path:`${output}/flow-red.png`,fullPage:true}).catch(()=>{});await Bun.write(`${output}/flow-red.json`,JSON.stringify(report,null,2));throw error;}
finally{release?.();await context.close();await browser.close();for(const actor of actors){await database.sql`delete from access_links where email=${actor.email}`;await database.sql`delete from users where id=${actor.id}`;}await database.sql.close();}
