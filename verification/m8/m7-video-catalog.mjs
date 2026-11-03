// M8: historical assertions replayed against root sources and main build, isolated synthetic clone.
import './guard.mjs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const hash=s=>createHash('sha256').update(s).digest('hex');
import {readFileSync,writeFileSync} from 'node:fs';
import {chromium,webkit} from '@playwright/test';
const runtime=JSON.parse(readFileSync('.local/runtime.json','utf8')),origin='http://localhost:5202';
assert.equal(new URL(runtime.database).hostname,'127.0.0.1');assert.match(new URL(runtime.database).pathname,/^\/japanese_pixi_m8_published_\d+$/);
const retry=process.argv.includes('--retry'),workers=Number(process.argv.find(a=>a.startsWith('--workers='))?.split('=')[1]??(retry?1:4)),old=retry?JSON.parse(readFileSync('checks-m8-m7-video-catalog.json','utf8')):null;
const report=old??{date:'2026-11-02',method:'Actual Canvas catalog controls; native video at 1x from start to ended, no seek, independent browser contexts, one page each; worker count recorded. Muted technical playback, no human hearing claim.',results:[],humanAudition:false,physicalDevice:false,downloadedOrProxied:false,cspChanged:false};
if(retry){report.previousFailures=[...(report.previousFailures??[]),...report.results.filter(r=>r.status!=='PASS')];report.results=report.results.filter(r=>r.status==='PASS');report.retryWorkers=workers;delete report.passed;}
assert.ok(Number.isInteger(workers)&&workers>=1&&workers<=4);
report.currentWorkers=workers;report.workerIsolation='One page per independent authenticated context';
const save=()=>writeFileSync('checks-m8-m7-video-catalog.json',JSON.stringify(report,null,2)+'\n');
for(const engine of ['chrome','webkit']){
 const browser=await(engine==='chrome'?chromium.launch({channel:'chrome',headless:true}):webkit.launch({headless:true}));
 try{
  const context=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'});
  let login;for(let n=0;n<4;n++){login=await context.request.post(origin+'/api/auth/sign-in/email',{headers:{origin},data:runtime.videoUser});if(login.status()!==429)break;await new Promise(r=>setTimeout(r,1000*Math.max(1,Number(login.headers()['retry-after'])||60)));}assert.equal(login.status(),200);
  const course=await(await context.request.get(origin+'/api/course')).json(),jobs=course.lessons.flatMap(lesson=>(lesson.videos??[]).map(video=>({lesson,video}))).map((x,index)=>({...x,index}));assert.equal(jobs.length,80);assert.equal(new Set(jobs.map(j=>j.video.id)).size,80);if(retry)for(let i=jobs.length-1;i>=0;i--)if(report.results.some(r=>r.engine===engine&&r.videoIdSha256===hash(jobs[i].video.id)))jobs.splice(i,1);
  const authenticatedState=await context.storageState();
  await Promise.all(Array.from({length:workers},async(_,worker)=>{
   const workerContext=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce',storageState:authenticatedState});
   const page=await workerContext.newPage();page.setDefaultTimeout(60000);const errors=[],mediaHttp=[],mediaFailures=[];let lastControl='';page.on('response',r=>{if(r.url().includes('.mp4'))mediaHttp.push({sourceSha256:hash(r.url()),status:r.status(),type:r.headers()['content-type']});});page.on('requestfailed',r=>{if(r.url().includes('.mp4'))mediaFailures.push({sourceSha256:hash(r.url()),error:r.failure()?.errorText});});page.on('pageerror',e=>errors.push(e.message));
   await page.addInitScript(()=>{window.__M7CSP=[];document.addEventListener('securitypolicyviolation',e=>window.__M7CSP.push(e.violatedDirective));});
   const snap=()=>page.evaluate(()=>window.__ALBUM__?.snapshot());
   const click=async id=>{lastControl=id.split(':')[0];await page.waitForFunction(id=>window.__ALBUM__?.snapshot().controls?.some(c=>c.id===id&&c.enabled)&&window.__ALBUM__.snapshot().ready&&!window.__ALBUM__.snapshot().guided.busy,id);let c=(await snap()).controls.find(c=>c.id===id);await page.mouse.move(c.rect.x+c.rect.width/2,c.rect.y+c.rect.height/2);await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));c=(await snap()).controls.find(c=>c.id===id&&c.enabled);assert.ok(c);await page.mouse.click(c.rect.x+c.rect.width/2,c.rect.y+c.rect.height/2);await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));};
   while(jobs.length){const {lesson,video,index}=jobs.shift(),started=Date.now();let result={engine,index,videoIdSha256:hash(video.id),sourceSha256:hash(video.mediaUrl),status:'FAIL'},stage='catalog-open';
    try{
     errors.length=0;mediaHttp.length=0;mediaFailures.length=0;await page.goto(origin+'/');await click('book');await page.waitForFunction(()=>window.__ALBUM__.snapshot().book.lessons===18&&!window.__ALBUM__.snapshot().book.loading);await page.locator('textarea:not([hidden])').fill(lesson.title);await page.waitForTimeout(120);await click('book-lesson:'+lesson.id);await click('book-videos');stage='select-video';
     for(let n=0;n<20&&!(await snap()).controls.some(c=>c.id==='book-video:'+video.id);n++)await click('book-next');await click('book-video:'+video.id);stage='video-visible';
     await page.waitForFunction(()=>{const v=document.querySelector('video');return v&&!v.hidden;});
     await page.evaluate(()=>{const v=document.querySelector('video');v.muted=true;window.__M7VIDEO={ended:false,playing:0,waits:0,maxGap:0,previous:0,error:0,seeks:0};const p=window.__M7VIDEO;v.addEventListener('ended',()=>p.ended=true,{once:true});v.addEventListener('playing',()=>p.playing++);v.addEventListener('waiting',()=>p.waits++);v.addEventListener('seeking',()=>p.seeks++);v.addEventListener('error',()=>p.error=v.error?.code??-1);v.addEventListener('timeupdate',()=>{p.maxGap=Math.max(p.maxGap,v.currentTime-p.previous);p.previous=v.currentTime;});});
     stage='play';await click('library-video-play');
     await page.waitForFunction(()=>{const v=document.querySelector('video');return v.error||Number.isFinite(v.duration)&&v.currentTime>.05;},{},{timeout:30000});
     const initial=await page.evaluate(()=>{const v=document.querySelector('video');return {duration:v.duration,rate:v.playbackRate,source:v.currentSrc,error:v.error?.code??0};});assert.equal(initial.source,new URL(video.mediaUrl,origin).href);assert.equal(initial.error,0);assert.equal(initial.rate,1);assert.ok(initial.duration>0);
     stage='full-playback';await page.waitForFunction(()=>window.__M7VIDEO.ended||window.__M7VIDEO.error,{},{timeout:Math.ceil(initial.duration*1500+30000)});
     const end=await page.evaluate(()=>{const v=document.querySelector('video');return {...window.__M7VIDEO,duration:v.duration,time:v.currentTime,paused:v.paused,rate:v.playbackRate,csp:window.__M7CSP};});
     assert.equal(end.error,0);assert.equal(end.ended,true);assert.equal(end.seeks,0);assert.equal(end.rate,1);assert.ok(end.time>=end.duration-.15);assert.deepEqual(end.csp,[]);assert.deepEqual(errors,[]);
     stage='priority-release';await page.waitForFunction(()=>!window.__ALBUM__.snapshot().m6.sound.speechPlaying);
     result={...result,status:'PASS',durationSeconds:end.duration,playedSeconds:end.time,playingEvents:end.playing,waitingEvents:end.waits,maxTimeupdateGap:end.maxGap,ended:true,seeks:0,priorityReleased:true};
    }catch(e){try{writeFileSync('.local/m8-m7-video-failure-'+engine+'-'+index+'.json',JSON.stringify(await snap()),{mode:0o600});}catch{}result.lastControl=lastControl;result.stage=stage;result.reason=String(e.message).slice(0,350);}
    report.results.push({...result,mediaHttp:[...mediaHttp],mediaFailures:[...mediaFailures],wallSeconds:Math.round((Date.now()-started)/1000)});save();console.log(JSON.stringify({engine,index,status:result.status,finished:report.results.length}));
   }
   await workerContext.close();
  }));
  await context.close();
 }finally{await browser.close();}
}
report.passed=['chrome','webkit'].every(e=>new Set(report.results.filter(r=>r.engine===e).map(r=>r.videoIdSha256)).size===80)&&report.results.length===160&&report.results.every(x=>x.status==='PASS');save();if(!report.passed)process.exitCode=1;console.log(JSON.stringify({complete:true,total:report.results.length,passed:report.results.filter(x=>x.status==='PASS').length}));
