// M8: historical assertions replayed against root sources and main build, isolated synthetic clone.
import './guard.mjs';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {chromium,webkit} from '@playwright/test';
const runtime=JSON.parse(readFileSync('.local/runtime.json','utf8')),origin='http://localhost:5202';
const report={passed:false,checks:[],storage:'IndexedDB per origin/browser profile/learner; no cross-browser transfer',sqlMigration:false};mkdirSync('test-results/m8-m5-kana',{recursive:true});
for(const engine of ['chrome','webkit']){
 const browser=await(engine==='chrome'?chromium.launch({channel:'chrome',headless:true}):webkit.launch({headless:true}));
 try{
  const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage();page.setDefaultTimeout(15000);
  const signIn=async user=>{let response;for(let i=0;i<3;i++){response=await context.request.post(origin+'/api/auth/sign-in/email',{headers:{origin},data:user});if(response.status()!==429)break;await new Promise(r=>setTimeout(r,Math.min(60,Number(response.headers()['retry-after'])||60)*1000));}assert.equal(response.status(),200);};
  await signIn({email:runtime.browserEmail,password:runtime.browserPassword});
  const course=await(await context.request.get(origin+'/api/course')).json(),before=await(await context.request.get(origin+'/api/progress')).json();
  const kanaEntries=Object.values(course.catalog.kana).flatMap(rows=>rows.flatMap(row=>row.cells.filter(Boolean)));const katakana=value=>[...value].map(char=>{const code=char.codePointAt(0);return code>=0x3041&&code<=0x3096?String.fromCodePoint(code+0x60):char;}).join('');
  const snap=()=>page.evaluate(()=>window.__ALBUM__.snapshot());
  const click=async id=>{await page.waitForFunction(id=>{const s=window.__ALBUM__?.snapshot();return s?.controls?.some(c=>c.id===id&&c.enabled)&&!s.guided.busy&&!s.kana.busy;},id);const s=await snap(),c=s.controls.find(c=>c.id===id);await page.mouse.click(c.rect.x+c.rect.width/2,c.rect.y+c.rect.height/2);await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await page.waitForFunction(n=>window.__ALBUM__.snapshot().renderCount>n,s.renderCount);await page.waitForFunction(()=>{const s=window.__ALBUM__.snapshot();return s.page!=='kana'||!s.kana.busy&&s.renderedKey===`kana:${s.kana.sessionId}:${s.kana.turn}`;});};
  const seek=async id=>{for(let i=0;i<20&&(await snap()).controls.some(c=>c.id==='book-prev'&&c.enabled);i++)await click('book-prev');for(let i=0;i<20;i++){if((await snap()).controls.some(c=>c.id===id))return;assert.ok((await snap()).controls.some(c=>c.id==='book-next'&&c.enabled),id);await click('book-next');}};
  const open=async()=>{await page.goto(origin+'/');await click('nav-menu');await click('kana');await page.waitForFunction(()=>!window.__ALBUM__.snapshot().kana.busy);};
  await open();assert.equal((await snap()).kana.stats.length,0);
  await seek('kana-all');await click('kana-all');await seek('kana-row:0');await click('kana-row:0');
  let initialErrors=0;
  for(const script of ['hiragana','katakana'])for(const direction of ['sign-reading','reading-sign']){
   await seek('kana-script');if((await snap()).kana.script!==script)await click('kana-script');await seek('kana-direction');if((await snap()).kana.direction!==direction)await click('kana-direction');await click('kana-start');
   await page.waitForFunction(()=>window.__ALBUM__.snapshot().kana.active&&window.__ALBUM__.snapshot().kana.total>0);
   for(const size of [{width:390,height:844},{width:320,height:640},{width:844,height:390},{width:1440,height:900}]){await page.setViewportSize(size);await page.waitForTimeout(100);assert.deepEqual((await snap()).problems,[],engine+'/'+script+'/'+direction+'/'+size.width);await page.screenshot({path:`test-results/m8-m5-kana/${engine}-${script}-${direction}-${size.width}.png`});}
   await page.setViewportSize({width:390,height:844});await page.waitForTimeout(100);
   let count=0;
   while((await snap()).kana.remaining&&count++<15){
    const s=await snap(),glyph=s.kana.prompt,entry=kanaEntries.find(entry=>(script==='katakana'?katakana(entry.kana):entry.kana)===glyph),correct=s.controls.filter(c=>c.id.startsWith('kana-choice:')).find(c=>direction==='sign-reading'?c.text===entry.reading:kanaEntries.some(entry=>entry.reading===glyph&&(script==='katakana'?katakana(entry.kana):entry.kana)===c.text));assert.ok(correct);
    if(initialErrors===0){const wrong=s.controls.find(c=>c.id.startsWith('kana-choice:')&&c.id!==correct.id);await click(wrong.id);initialErrors++;assert.equal((await snap()).kana.remaining,s.kana.remaining);continue;}
    if(engine==='chrome'&&script==='hiragana'&&direction==='sign-reading'&&count===2){
     await page.evaluate(()=>{const original=Storage.prototype.removeItem;window.restoreKanaRemove=()=>Storage.prototype.removeItem=original;Storage.prototype.removeItem=function(key){if(key.startsWith('japanese-kana-pending:'))throw new Error('test lost receipt');return original.call(this,key);};});
     await click(correct.id);await page.waitForFunction(()=>!!window.__ALBUM__.snapshot().kana.error);const sum=(await snap()).kana.stats.reduce((n,s)=>n+s.attempts,0);
     await page.evaluate(()=>window.restoreKanaRemove());await click('kana-retry');await page.waitForFunction(()=>!window.__ALBUM__.snapshot().kana.busy);assert.equal((await snap()).kana.turn,s.kana.turn+1);assert.equal((await snap()).kana.stats.reduce((n,s)=>n+s.attempts,0),sum+1);report.checks.push('lost-IDB-receipt-retry-one-stat-update');
    }else await click(correct.id);
   }
   await page.waitForFunction(()=>window.__ALBUM__.snapshot().kana.remaining===0&&!window.__ALBUM__.snapshot().kana.busy);assert.equal((await snap()).kana.completed,5);await click('kana-new');
  }
  const stats=(await snap()).kana.stats,total=stats.reduce((n,s)=>n+s.attempts,0);assert.equal(total,21);assert.equal(stats.reduce((n,s)=>n+s.errors,0),1);
  await open();assert.equal((await snap()).kana.stats.reduce((n,s)=>n+s.attempts,0),total);report.checks.push(engine+':both-scripts-directions-error-repeat-and-reload');
  assert.deepEqual(await(await context.request.get(origin+'/api/progress')).json(),before);report.checks.push(engine+':no-vocabulary-FSRS-or-lesson-progress');
  await context.request.post(origin+'/api/auth/sign-out',{headers:{origin},data:{}});await signIn(runtime.workspaceUsers[1]);await open();assert.equal((await snap()).kana.stats.length,0);report.checks.push(engine+':account-isolation');
  await context.close();
 }finally{await browser.close();}
}
report.passed=true;writeFileSync('checks-m8-m5-kana.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
