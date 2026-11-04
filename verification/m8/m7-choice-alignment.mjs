import './guard.mjs';
import assert from 'node:assert/strict';
import{readFileSync,writeFileSync,mkdirSync}from'node:fs';
import{execFileSync}from'node:child_process';
import{chromium,webkit}from'@playwright/test';
const r=JSON.parse(readFileSync('.local/runtime.json','utf8')),origin='http://localhost:5202';assert.equal(new URL(r.database).hostname,'127.0.0.1');assert.match(new URL(r.database).pathname,/^\/japanese_pixi_m8_published_\d+$/);
const results=[];mkdirSync('test-results/m8-choice-alignment',{recursive:true});
for(const [index,engine]of['chrome','webkit'].entries()){
 const browser=await(engine==='chrome'?chromium.launch({channel:'chrome',headless:true}):webkit.launch({headless:true}));
 try{
 const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true,deviceScaleFactor:3}),page=await context.newPage();page.setDefaultTimeout(15000);
 let login;for(let i=0;i<4;i++){login=await context.request.post(origin+'/api/auth/sign-in/email',{headers:{origin},data:r.choiceUsers[index]});if(login.status()!==429)break;await new Promise(r=>setTimeout(r,1000*Math.max(1,Number(login.headers()['retry-after'])||60)));}assert.equal(login.status(),200);
 const course=await(await context.request.get(origin+'/api/course')).json(),lesson=course.learning[0].lessonId;
 await page.goto(origin+'/?lesson='+encodeURIComponent(lesson));
 const snap=()=>page.evaluate(()=>window.__ALBUM__.snapshot());
 const tap=async id=>{await page.waitForFunction(id=>{const s=window.__ALBUM__?.snapshot();return s?.ready&&!s.guided.busy&&s.controls.some(c=>c.id===id&&c.enabled);},id);const s=await snap(),c=s.controls.find(c=>c.id===id);await page.touchscreen.tap(c.rect.x+c.rect.width/2,c.rect.y+c.rect.height/2);await page.waitForTimeout(180);};
 await page.waitForFunction(()=>window.__ALBUM__?.snapshot().ready&&!window.__ALBUM__.snapshot().guided.busy);
 await page.waitForFunction(()=>window.__ALBUM__.snapshot().page==='lesson'&&!!window.__ALBUM__.snapshot().guided.step&&!window.__ALBUM__.snapshot().guided.busy);
 while((await snap()).guided.step.kind==='word-intro')await tap('intro-next');

 await tap('hint');
 const initial=await snap(),word=course.words.find(w=>w.id===initial.guided.step.wordId),jp=new Set(word.segments.flatMap(s=>[s.surface,s.reading]).filter(Boolean).concat([word.surface,word.kana]));
 const sizes=[];
 for(const [width,height]of[[1280,900],[844,390],[640,320],[568,320],[390,844],[320,640]]){
  await page.setViewportSize({width,height});await page.waitForTimeout(200);const s=await snap();assert.deepEqual(s.problems,[],engine+':'+width);assert.equal(s.guided.version,initial.guided.version);
  let delta=null;if(width>=500){
   const mid=s.fixed.field.x,choices=s.controls.filter(c=>s.guided.choiceIds.includes(c.id));assert.ok(choices.length>1);
   const left=s.texts.filter(t=>t.bounds.x+t.bounds.width/2<mid&&jp.has(t.text));assert.ok(left.length);
   const centre=(Math.min(...left.map(t=>t.bounds.y))+Math.max(...left.map(t=>t.bounds.y+t.bounds.height)))/2;
   const answer=(Math.min(...choices.map(c=>c.rect.y))+Math.max(...choices.map(c=>c.rect.y+c.rect.height)))/2;
   delta=Math.abs(centre-answer);assert.ok(delta<=1,`${engine}/${width}: ${delta}`);
  }
  assert.ok(s.texts.filter(t=>/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u.test(t.text)).every(t=>t.size>=18));
  sizes.push({width,height,centreDelta:delta});await page.screenshot({path:`test-results/m8-choice-alignment/${engine}-${width}.png`});
 }
 results.push({engine,version:browser.version(),method:'Actual issued guided card, hint choices; content centre compared to the complete answer grid; no grade',sizes});await context.close();
 }finally{await browser.close();}
}
writeFileSync('checks-m8-choice-alignment-2026-11-02.json',JSON.stringify({passed:true,results},null,2)+'\n');console.log(JSON.stringify({passed:true,browsers:results.length}));
