import { chromium, expect } from '@playwright/test';
import { createLink, consumeLink } from '../src/server/auth';
import { loadCourse } from '../src/server/course';
import { connectDatabase } from '../src/server/db';
import { defaultSettings } from '../src/server/material';
import { learningParts } from '../src/shared/learning';
import { nextFixtureIp } from './helpers/fixture-ip';
import { output } from './helpers/artifact-output';

const base=process.env.GUIDED_BROWSER_URL,databaseUrl=process.env.JAPANESE_INTEGRATION_DATABASE_URL;
if(!base||new URL(base).hostname!=='localhost'||!databaseUrl||new URL(databaseUrl).hostname!=='127.0.0.1'||new URL(databaseUrl).pathname!=='/japanese_app_test')throw new Error('Use isolated built preview and disposable test database.');
const database=connectDatabase(databaseUrl),course=loadCourse(),lesson=course.learning!.find(lesson=>lesson.lessonId==='marugoto.starter-a1.lesson.04')!,parts=learningParts(lesson);
const browser=await chromium.launch({channel:'chrome',headless:true}),context=await browser.newContext({viewport:{width:1265,height:712},extraHTTPHeaders:{'x-forwarded-for':nextFixtureIp()}}),page=await context.newPage();page.setDefaultTimeout(15000);
const email=`illustrated-layout-${crypto.randomUUID()}@example.test`,password=`Layout-${crypto.randomUUID()}!`,errors:string[]=[],targets:object[]=[],catFrames:object[]=[];let userId='',version=0;
page.on('pageerror',error=>errors.push(error.message));
async function open(kind:'word-intro'|'word-practice'|'construction-practice'|'video'){
 const partIndex=parts.findIndex(part=>part.some(step=>step.kind===kind&&(step.kind!=='construction-practice'||step.mode==='grammar')&&(step.kind!=='word-practice'||step.mode==='ja-ru'))),steps=parts[partIndex]!,index=steps.findIndex(step=>step.kind===kind&&(step.kind!=='construction-practice'||step.mode==='grammar')&&(step.kind!=='word-practice'||step.mode==='ja-ru'));
 const state={partIndex,pendingStepIds:steps.slice(index).map(step=>step.id),completedStepIds:[...parts.slice(0,partIndex).flat(),...steps.slice(0,index)].map(step=>step.id),wordQuiz:true};
 await database.sql`insert into learning_states(user_id,lesson_id,route_version,version,state) values(${userId},${lesson.lessonId},${lesson.version},${++version},${state}) on conflict(user_id,lesson_id) do update set version=excluded.version,state=excluded.state`;
 await page.goto(base!);await expect(page.getByTestId('learn-lesson')).toHaveCount(18);await page.locator(`[data-testid=learn-lesson][data-lesson-id="${lesson.lessonId}"]`).click();
 const skip=page.getByRole('button',{name:/Перейти к занятию/});if(await skip.isVisible())await skip.click();await expect(page.getByTestId('guided-learning')).toHaveAttribute('data-step-kind',kind);await page.evaluate(()=>document.fonts.ready);
}
async function hit(selector:string,label:string){
 const elements=page.locator(selector);await expect(elements.first(),label).toBeVisible();expect(await elements.count(),label).toBeGreaterThan(0);
 for(let i=0;i<await elements.count();i++){
  const element=elements.nth(i);if(!await element.isVisible())continue;await element.scrollIntoViewIfNeeded();
  const result=await element.evaluate(element=>{const rect=element.getBoundingClientRect(),pet=document.querySelector('.scene-companion .cat-pet')?.getBoundingClientRect(),hit=document.elementFromPoint(rect.left+rect.width/2,rect.top+rect.height/2);return {inside:rect.top>=0&&rect.bottom<=innerHeight+1&&rect.left>=0&&rect.right<=innerWidth+1,hit:!!hit&&(element===hit||element.contains(hit)),catOverlap:pet?Math.max(0,Math.min(rect.right,pet.right)-Math.max(rect.left,pet.left))*Math.max(0,Math.min(rect.bottom,pet.bottom)-Math.max(rect.top,pet.top)):0,width:rect.width,height:rect.height};});
  targets.push({label,index:i,viewport:page.viewportSize(),...result});const tag=`${label}[${i}] @${page.viewportSize()!.width}x${page.viewportSize()!.height}`;
  expect(result.inside,`${tag} viewport`).toBe(true);expect(result.hit,`${tag} native hit`).toBe(true);expect(result.catOverlap,`${tag} cat hitbox overlap`).toBeLessThan(1);
 }
}
try{
 const link=await createLink(database,'invite',email,null);expect(await consumeLink(database,'invite',link.token,password,'Illustrated layout fixture')).toBe(true);
 const login=await context.request.post(base+'/api/auth/sign-in/email',{headers:{origin:base},data:{email,password}});expect(login.status()).toBe(200);userId=(await login.json()).user.id;
 expect((await context.request.put(base+'/api/settings',{headers:{origin:base},data:{...defaultSettings,animations:false,sceneSoundEnabled:false}})).status()).toBe(200);
 for(const viewport of (Bun.argv.includes('--cat-only')?[]:[{width:1440,height:1000},{width:768,height:1024},{width:390,height:844},{width:320,height:568}])){
  await page.setViewportSize(viewport);await page.goto(base);await expect(page.getByTestId('learn-lesson')).toHaveCount(course.lessons.length);await page.evaluate(()=>document.fonts.ready);
  const cards=await page.locator('.lesson-card').evaluateAll(cards=>cards.map(card=>{const image=card.querySelector('.lesson-topic-image')!.getBoundingClientRect(),title=card.querySelector('.lesson-title')!.getBoundingClientRect(),button=card.querySelector('.lesson-train')!.getBoundingClientRect(),bounds=card.getBoundingClientRect();return {lessonId:card.getAttribute('data-lesson-id'),parts:card.querySelectorAll('.lesson-part').length,imageLeft:image.right<=title.left+1,textInside:title.right<=bounds.right+1,buttonHeight:button.height};}));
  for(const card of cards){expect(card.parts).toBe(course.learning!.find(route=>route.lessonId===card.lessonId)!.goals.reduce((sum,goal)=>sum+goal.parts.length,0));expect(card.imageLeft,`${card.lessonId} image @${viewport.width}`).toBe(true);expect(card.textInside,`${card.lessonId} title @${viewport.width}`).toBe(true);expect(card.buttonHeight).toBeGreaterThanOrEqual(44);}
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);targets.push({label:'textbook cards',viewport,cards});
  await page.screenshot({path:`${output}/textbook-cards-${viewport.width}.png`,fullPage:true});
  const material=page.locator('.lesson-material').first();await material.locator('> summary').focus();await page.keyboard.press('Enter');await expect(material).toHaveAttribute('open','');await expect(material.getByRole('heading',{name:'Чему научимся'})).toBeVisible();await material.locator('> summary').press('Enter');await expect(material).not.toHaveAttribute('open','');
 }
 for(const viewport of (Bun.argv.includes('--cat-only')?[]:[{width:1265,height:712},{width:390,height:844},{width:320,height:568}])){
  await page.setViewportSize(viewport);await open('word-intro');
  for(const label of ['Учебник','Тренировки','Повторение','Справочник']){const lines=await page.getByRole('navigation',{name:'Разделы',exact:true}).getByRole('button',{name:label,exact:true}).evaluate((element,label)=>{const walker=document.createTreeWalker(element,NodeFilter.SHOW_TEXT);let node:Node|null;while(node=walker.nextNode())if(node.textContent?.trim()===label){const range=document.createRange();range.selectNodeContents(node);return new Set([...range.getClientRects()].map(rect=>Math.round(rect.top))).size;}return 0;},label);expect(lines,`whole nav label ${label} @${viewport.width}`).toBe(1);}
  await expect(page.getByTestId('learning-word-group')).toBeVisible();await hit('.word-group .example-play','group example play');await hit('[data-testid=start-learning-practice]','start practice');
  await page.screenshot({path:`${output}/illustrated-group-${viewport.width}.png`,fullPage:true});
  await open('word-practice');await hit('[data-choice-word-id]','quiz choice');
  await open('construction-practice');await hit('.bank [data-token-id]','workspace token');await hit('.add-token','workspace editor');
  await open('video');await hit('.lesson-video-source a','video source');await hit('.guided-video > button.primary','video continuation');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 }
 for(const reduced of [false,true]){
  expect((await context.request.put(base+'/api/settings',{headers:{origin:base},data:{...defaultSettings,animations:!reduced,sceneSoundEnabled:false}})).status()).toBe(200);
  await page.emulateMedia({reducedMotion:reduced?'reduce':'no-preference'});await page.setViewportSize({width:1265,height:712});await open('word-practice');await expect(page.getByTestId('learning-word-quiz')).toBeVisible();
  await page.evaluate(async()=>{await Promise.all(['neutral','blink','wave','standing','thinking','explain','encourage','success','rest'].map(async pose=>{const image=new Image();image.src=`/mascot/${pose}.png`;await image.decode();}));});
  await page.evaluate(()=>{(window as any).__catFrames=[];const start=performance.now();const frame=()=>{const cat=document.querySelector('.scene-companion .companion');if(cat){const visible=[...cat.querySelectorAll('img')].filter(image=>{if(!image.complete||!image.naturalWidth)return false;let opacity=1;for(let node:Element|null=image;node&&node!==cat.parentElement;node=node.parentElement){const style=getComputedStyle(node);if(style.display==='none'||style.visibility==='hidden')return false;opacity*=Number(style.opacity);}return opacity>.05;}).length;(window as any).__catFrames.push({at:performance.now()-start,pose:cat.getAttribute('data-pose'),visible});}if(performance.now()-start<1800)requestAnimationFrame(frame);};requestAnimationFrame(frame);});
  const state=await (await context.request.get(base+`/api/learning/${lesson.lessonId}`)).json();await page.locator(`[data-choice-word-id="${state.step.wordId}"]`).click();
  await expect.poll(async()=>page.evaluate(()=>(window as any).__catFrames.at(-1)?.at??0)).toBeGreaterThan(1750);
  const frames:{at:number;pose:string;visible:number}[]=await page.evaluate(()=>(window as any).__catFrames);expect(frames.length).toBeGreaterThan(30);expect(frames.every(frame=>frame.visible>0)).toBe(true);expect(new Set(frames.map(frame=>frame.pose)).size).toBeGreaterThan(1);catFrames.push({reduced,frames:frames.length,poses:[...new Set(frames.map(frame=>frame.pose))],emptyFrames:frames.filter(frame=>!frame.visible).length});
 }
 expect(errors).toEqual([]);const report={green:true,built:true,syntheticCurrentStepFixtures:true,targets,catFrames,errors};await Bun.write(`${output}/${Bun.argv.includes('--cat-only')?'illustrated-cat-frames':'illustrated-layout'}-green.json`,JSON.stringify(report,null,2));console.info(JSON.stringify({green:true,targetChecks:targets.length,catFrames,errors}));
}catch(error){await page.screenshot({path:`${output}/illustrated-layout-red.png`,fullPage:true}).catch(()=>{});await Bun.write(`${output}/illustrated-layout-red.json`,JSON.stringify({targets,catFrames,errors,error:String(error)},null,2));throw error;}
finally{await context.close();await browser.close();if(userId)await database.sql`delete from users where id=${userId}`;await database.sql`delete from access_links where email=${email}`;await database.sql.close();}
