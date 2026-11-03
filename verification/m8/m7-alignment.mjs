import './guard.mjs';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {chromium,webkit} from '@playwright/test';
const before=process.argv.includes('--before'), origin='http://localhost:5202', out='test-results/m8-alignment';
const runtime=JSON.parse(readFileSync('.local/runtime.json','utf8'));
execFileSync('/private/tmp/japanese-stack-toolchain-1.4.3/bun',['m6-browser-data.mts','--due','0']);
mkdirSync(out,{recursive:true});
const report={passed:false,method:'Longest word projected from each actual issued review queue; browser geometry, not hardware. No grades. Media.play mocked only for geometry.',checks:[]};
const centre=items=>{assert.ok(items.length,'Missing content');return (Math.min(...items.map(t=>t.bounds.y))+Math.max(...items.map(t=>t.bounds.y+t.bounds.height)))/2;};
for(const engine of ['chrome','webkit']){
 const browser=await(engine==='chrome'?chromium.launch({channel:'chrome',headless:true}):webkit.launch({headless:true}));
 try{
 const context=await browser.newContext({viewport:{width:1280,height:900}}),page=await context.newPage();page.setDefaultTimeout(15000);
 const errors=[];let grades=0;page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.method()==='POST'&&(r.url().endsWith('/api/reviews')||r.url().endsWith('/advance')))grades++;});
 await page.addInitScript(()=>{HTMLMediaElement.prototype.play=async function(){};});
 const login=async(user,url=origin)=>{let r;for(let i=0;i<4;i++){r=await context.request.post(url+'/api/auth/sign-in/email',{headers:{origin:url},data:user});if(r.status()!==429)break;await page.waitForTimeout(1000*Math.max(1,Number(r.headers()['retry-after'])||60));}assert.equal(r.status(),200);};
 await login(runtime.browserUsers[0]);
 // Project the longest actually issued word, so the narrow listening regression is deterministic.
 await page.route('**/api/reviews?mode=*',async route=>{const response=await route.fetch(),queue=await response.json();if(response.ok()){const word=queue.items.filter(item=>item.word).sort((a,b)=>b.word.meaningRu.length-a.word.meaningRu.length)[0];if(word){queue.items=[word];queue.total=1;}}await route.fulfill({response,json:queue});});
 const snap=()=>page.evaluate(()=>window.__ALBUM__.snapshot());
 const click=async id=>{
  if(!(await snap()).controls.some(c=>c.id===id&&c.enabled)&&['reviews'].includes(id))await click('nav-menu');
  await page.waitForFunction(id=>{const s=window.__ALBUM__?.snapshot();return s?.controls.some(c=>c.id===id&&c.enabled)&&!s.guided.busy;},id);
  let c=(await snap()).controls.find(c=>c.id===id);await page.mouse.move(c.rect.x+c.rect.width/2,c.rect.y+c.rect.height/2);await page.waitForTimeout(60);c=(await snap()).controls.find(c=>c.id===id);await page.mouse.click(c.rect.x+c.rect.width/2,c.rect.y+c.rect.height/2);await page.waitForTimeout(100);
 };
 for(const [mode,id]of[['ja-ru','review-ja'],['ru-ja','review-ru'],['listening','review-audio']]){
  await page.setViewportSize({width:1280,height:900});await page.goto(origin+'/');await page.waitForFunction(()=>window.__ALBUM__?.snapshot().authenticated&&!window.__ALBUM__.snapshot().guided.busy);
  await click('reviews');const response=page.waitForResponse(r=>r.url().includes('/api/reviews?mode='+mode));await click(id);const queue=await(await response).json(),word=queue.items[0].word;assert.ok(word);await page.waitForFunction(()=>window.__ALBUM__.snapshot().controls.some(c=>c.id==='show-answer'));
  if(mode==='listening')await click('audio');
  const jp=new Set(word.segments.flatMap(s=>[s.surface,s.reading]).filter(Boolean).concat([word.surface,word.kana]));
  for(const shown of [false,true]){
   if(shown)await click('show-answer');
   for(const [width,height]of[[1280,900],[844,390],[640,320],[568,320],[390,844],[320,640]]){
    await page.setViewportSize({width,height});await page.waitForTimeout(150);const s=await snap();if(s.problems.length){writeFileSync('.local/alignment-overflow.json',JSON.stringify({engine,mode,width,height,shown,word,state:s}),{mode:0o600});await page.screenshot({path:'test-results/m8-alignment/overflow.png'});}assert.deepEqual(s.problems,[],engine+':'+mode+':'+width);
    const split=width>=500;let delta=null;
    if(split){
     const mid=s.fixed.field.x;
     const left=s.texts.filter(t=>t.bounds.x+t.bounds.width/2<mid&&(mode==='ru-ja'?t.text===word.meaningRu:mode==='listening'?t.text==='♪':jp.has(t.text)));
     const right=s.texts.filter(t=>t.bounds.x>=mid&&(!shown?['Сначала попробуйте вспомнить, затем откройте ответ.','Вспомните и раскройте ответ.'].includes(t.text):mode==='ja-ru'?t.text===word.meaningRu:jp.has(t.text)));
     if(!left.length||!right.length){writeFileSync('.local/m8-alignment-diagnostic.json',JSON.stringify({engine,mode,width,shown,word,left,right,state:s}));console.log({engine,mode,width,shown,mid,left:left.length,right:right.length});}delta=Math.abs(centre(left)-centre(right));
     if(!before)assert.ok(delta<=1,`${engine} ${mode} ${width} ${shown}: content centres differ by ${delta}`);
    }
    report.checks.push({engine,mode,shown,width,height,centreDelta:delta});if(mode==='listening'&&width===640)await page.screenshot({path:`test-results/m8-alignment/${engine}-listening-640-${shown?'shown':'hidden'}.png`});
    if(width===1280&&mode==='ru-ja'&&shown)await page.screenshot({path:`${out}/${engine}-ru-${before?'before':'after'}.png`});
   }
  }
 }
 assert.equal(grades,0);assert.deepEqual(errors,[]);await context.close();
 }finally{await browser.close();}
}
report.passed=report.checks.every(c=>c.centreDelta===null||c.centreDelta<=1);
writeFileSync(`checks-m8-alignment${before?'-red':''}-2026-11-02.json`,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({passed:report.passed,checks:report.checks.length,maxDelta:Math.max(...report.checks.map(c=>c.centreDelta??0))}));
