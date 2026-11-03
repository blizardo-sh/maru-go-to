// M8: historical assertions replayed against root sources and main build, isolated synthetic clone.
import './guard.mjs';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {chromium,webkit} from '@playwright/test';
const runtime=JSON.parse(readFileSync('.local/runtime.json','utf8')),origin='http://localhost:5202';
const report={passed:false,checks:[],catalogLessons:0,catalogVideos:0,externalPlaybackVerified:false};
mkdirSync('test-results/m8-m5-book',{recursive:true});
for(const engine of ['chrome','webkit']){
 const browser=await(engine==='chrome'?chromium.launch({channel:'chrome',headless:true}):webkit.launch({headless:true}));
 try{
  const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage();page.setDefaultTimeout(15000);
  let response;for(let i=0;i<3;i++){response=await context.request.post(origin+'/api/auth/sign-in/email',{headers:{origin},data:{email:runtime.browserEmail,password:runtime.browserPassword}});if(response.status()!==429)break;await new Promise(r=>setTimeout(r,Math.min(60,Number(response.headers()['retry-after'])||60)*1000));}assert.equal(response.status(),200);
  const course=await(await context.request.get(origin+'/api/course')).json();assert.equal(course.lessons.length,18);assert.equal(course.lessons.flatMap(l=>l.videos??[]).length,80);
  const before=await(await context.request.get(origin+'/api/learning')).json();
  await page.goto(origin+'/');
  const snap=()=>page.evaluate(()=>window.__ALBUM__.snapshot());
  const click=async id=>{await page.waitForFunction(id=>{const s=window.__ALBUM__?.snapshot();return s?.controls?.some(c=>c.id===id&&c.enabled)&&!s.guided.busy;},id);const s=await snap(),c=s.controls.find(c=>c.id===id);await page.mouse.click(c.rect.x+c.rect.width/2,c.rect.y+c.rect.height/2);await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await page.waitForFunction(n=>window.__ALBUM__.snapshot().renderCount>n,s.renderCount);};
  await click('book');await page.waitForFunction(()=>window.__ALBUM__.snapshot().book.lessons===18&&!window.__ALBUM__.snapshot().book.loading);
  for(const size of [{width:390,height:844},{width:320,height:640},{width:844,height:390},{width:1440,height:900}]){await page.setViewportSize(size);await page.waitForTimeout(100);assert.deepEqual((await snap()).problems,[],engine+':'+size.width);await page.screenshot({path:`test-results/m8-m5-book/${engine}-${size.width}.png`});}
  await page.setViewportSize({width:390,height:844});await page.waitForTimeout(100);
  let seen=new Set(),videoIds=new Set();
  for(const lesson of course.lessons){
   const field=page.locator('textarea:not([hidden])');await field.fill(lesson.title);await page.waitForTimeout(100);
   await click('book-lesson:'+lesson.id);seen.add(lesson.id);
   await click('book-parts');assert.deepEqual((await snap()).problems,[]);await click('book-back');
   await click('book-main');await click('book-back');
   await click('book-extra');await click('book-back');
   await click('book-videos');
   for(const material of lesson.videos??[]){while(!(await snap()).controls.some(c=>c.id==='book-video:'+material.id))await click('book-next');await click('book-video:'+material.id);videoIds.add(material.id);assert.ok(await page.locator('video').isVisible());await click('library-video-back');}
   await click('book-back');await click('book-back');
  }
  assert.equal(seen.size,18);assert.equal(videoIds.size,80);report.catalogLessons=seen.size;report.catalogVideos=videoIds.size;
  assert.deepEqual(await(await context.request.get(origin+'/api/learning')).json(),before);report.checks.push(engine+':18-lessons-80-video-frames-parts-main-extra-search-no-progress-write');
  await context.close();
 }finally{await browser.close();}
}
report.passed=true;writeFileSync('checks-m8-m5-book.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
