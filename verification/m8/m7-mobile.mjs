import './guard.mjs';
import assert from 'node:assert/strict';
import{readFileSync,writeFileSync,mkdirSync}from'node:fs';
import{execFileSync}from'node:child_process';
import{chromium,webkit}from'@playwright/test';
const r=JSON.parse(readFileSync('.local/runtime.json','utf8')),origin='http://localhost:5202';assert.equal(new URL(r.database).hostname,'127.0.0.1');assert.match(new URL(r.database).pathname,/^\/japanese_pixi_m8_published_\d+$/);
const results=[];mkdirSync('test-results/m8-mobile',{recursive:true});
for(const [index,engine]of['chrome','webkit'].entries()){
 const browser=await(engine==='chrome'?chromium.launch({channel:'chrome',headless:true}):webkit.launch({headless:true}));
 try{
 const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true,deviceScaleFactor:3}),page=await context.newPage();page.setDefaultTimeout(15000);
 let login;for(let i=0;i<4;i++){login=await context.request.post(origin+'/api/auth/sign-in/email',{headers:{origin},data:r.mobileUsers[index]});if(login.status()!==429)break;await new Promise(r=>setTimeout(r,1000*Math.max(1,Number(login.headers()['retry-after'])||60)));}assert.equal(login.status(),200);
 const course=await(await context.request.get(origin+'/api/course')).json(),lesson=course.learning[0].lessonId;
 await page.goto(origin+'/?lesson='+encodeURIComponent(lesson));
 const snap=()=>page.evaluate(()=>window.__ALBUM__.snapshot());
 const tap=async id=>{await page.waitForFunction(id=>{const s=window.__ALBUM__?.snapshot();return s?.ready&&!s.guided.busy&&s.controls.some(c=>c.id===id&&c.enabled);},id);const s=await snap(),c=s.controls.find(c=>c.id===id);await page.touchscreen.tap(c.rect.x+c.rect.width/2,c.rect.y+c.rect.height/2);await page.waitForTimeout(180);};
 await page.waitForFunction(()=>window.__ALBUM__?.snapshot().ready&&!window.__ALBUM__.snapshot().guided.busy);
 await page.waitForFunction(()=>window.__ALBUM__.snapshot().page==='lesson'&&!!window.__ALBUM__.snapshot().guided.step&&!window.__ALBUM__.snapshot().guided.busy);
 while((await snap()).guided.step.kind==='word-intro')await tap('intro-next');
 assert.equal((await snap()).revealed,false);assert.ok(!(await snap()).controls.some(c=>c.id==='grade-remember'&&c.enabled));
 const sizes=[];for(const [width,height]of[[390,844],[844,390],[320,640],[640,320],[568,320]]){
  await page.setViewportSize({width,height});await page.waitForTimeout(200);const s=await snap();if(s.problems.length){await page.screenshot({path:'test-results/m8-mobile/failure.png'});writeFileSync('.local/m8-mobile-failure.json',JSON.stringify({engine,width,height,state:s},null,2),{mode:0o600});console.log(JSON.stringify({engine,width,height,problems:s.problems}));}assert.deepEqual(s.problems,[]);assert.ok(s.texts.filter(t=>/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u.test(t.text)).every(t=>t.size>=18),'Japanese text remains readable');const controls=s.controls.filter(c=>c.enabled);assert.ok(controls.every(c=>c.rect.width>=43&&c.rect.height>=43));
  assert.ok(controls.every(c=>c.rect.x>=-1&&c.rect.y>=-1&&c.rect.x+c.rect.width<=width+1&&c.rect.y+c.rect.height<=height+1));
  await page.screenshot({path:`test-results/m8-mobile/${engine}-${width}.png`});sizes.push({width,height,controls:controls.length,minTarget:Math.min(...controls.map(c=>Math.min(c.rect.width,c.rect.height)))});
 }
 await page.setViewportSize({width:390,height:844});await page.waitForTimeout(200);await tap('show-answer');assert.equal((await snap()).revealed,true);
 const version=(await snap()).guided.version;let touchGestures='NOT_RUN: CDP touch sequences unavailable for WebKit';
 if(engine==='chrome'){
  const cdp=await context.newCDPSession(page),b=(await snap()).leaf.bounds,start={x:b.x+b.width*.5,y:b.y+b.height*.42};
  for(const [dx,dy,cancel]of[[20,0,false],[5,85,false],[90,0,true]]){
   await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[start]});await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:start.x+dx,y:start.y+dy}]});await cdp.send('Input.dispatchTouchEvent',{type:cancel?'touchCancel':'touchEnd',touchPoints:[]});await page.waitForTimeout(220);assert.equal((await snap()).guided.version,version);
  }
  touchGestures='PASS: short horizontal, vertical, and cancelled touch do not grade';
 }
 const grade=page.getByRole('button',{name:'Помню →',exact:true});await grade.focus();assert.equal(await grade.evaluate(e=>document.activeElement===e),true);await page.keyboard.press('Enter');await page.waitForFunction(v=>window.__ALBUM__.snapshot().guided.version>v,version);
 assert.equal((await snap()).guided.version,version+1);
 results.push({engine,version:browser.version(),method:'Touch-enabled mobile viewport emulation; actual touchscreen tap and keyboard Enter',sizes,touchGestures,hiddenGradeUnavailable:true,oneKeyboardGrade:true,physicalPhone:false,nativeIME:false,screenReader:false,nativeZoom:false});
 await context.close();
 }finally{await browser.close();}
}
writeFileSync('checks-m8-mobile-2026-11-02.json',JSON.stringify({passed:true,date:'2026-11-02',results},null,2)+'\n');console.log(JSON.stringify({passed:true,browsers:results.length}));
