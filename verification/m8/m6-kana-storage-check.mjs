// M8: historical assertions replayed against root sources and main build, isolated synthetic clone.
import './guard.mjs';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync} from 'node:fs';
import {chromium} from '@playwright/test';
const runtime=JSON.parse(readFileSync('.local/runtime.json','utf8')),origin='http://localhost:5202',profile=mkdtempSync('.local/m8-m6-kana-profile-'),checks=[];
let context;
const launch=()=>chromium.launchPersistentContext(profile,{channel:'chrome',headless:true,viewport:{width:390,height:844}});
const snapshot=page=>page.evaluate(()=>window.__ALBUM__.snapshot());
const click=async(page,id)=>{await page.waitForFunction(id=>{const s=window.__ALBUM__?.snapshot();return s?.controls?.some(c=>c.id===id&&c.enabled)&&!s.kana.busy&&!s.guided.busy;},id);const s=await snapshot(page),c=s.controls.find(c=>c.id===id);await page.mouse.click(c.rect.x+c.rect.width/2,c.rect.y+c.rect.height/2);await page.waitForFunction(n=>window.__ALBUM__.snapshot().renderCount>n,s.renderCount);};
const open=async page=>{await page.goto(origin+'/');await click(page,'nav-menu');await click(page,'kana');await page.waitForFunction(()=>!window.__ALBUM__.snapshot().kana.busy);};
const sum=async page=>(await snapshot(page)).kana.stats.reduce((n,s)=>n+s.attempts,0);
try{
 context=await launch();let r;for(let i=0;i<3;i++){r=await context.request.post(origin+'/api/auth/sign-in/email',{headers:{origin},data:{email:runtime.browserUsers[3].email,password:runtime.browserUsers[3].password}});if(r.status()!==429)break;await new Promise(resolve=>setTimeout(resolve,Math.min(60,Number(r.headers()['retry-after'])||60)*1000));}assert.equal(r.status(),200);
 let page=await context.newPage();await open(page);await click(page,'kana-start');await page.waitForFunction(()=>{const s=window.__ALBUM__.snapshot();return s.kana.active&&s.controls.some(c=>c.id.startsWith('kana-choice:'));});
 await page.evaluate(()=>{const original=Storage.prototype.removeItem;window.restoreKana=()=>Storage.prototype.removeItem=original;Storage.prototype.removeItem=function(key){if(key.startsWith('japanese-kana-pending:'))throw new Error('lost receipt');return original.call(this,key);};});
 await click(page,(await snapshot(page)).controls.find(c=>c.id.startsWith('kana-choice:')).id);await page.waitForFunction(()=>!!window.__ALBUM__.snapshot().kana.error);
 const pending=await page.evaluate(()=>Object.entries(localStorage).find(([k])=>k.startsWith('japanese-kana-pending:')));assert.ok(pending);
 const second=await context.newPage();await open(second);assert.equal(await sum(second),1);assert.equal(await second.evaluate(key=>localStorage.getItem(key),pending[0]),null);
 await page.bringToFront();await page.evaluate(()=>window.restoreKana());await click(page,'kana-retry');await page.waitForFunction(()=>window.__ALBUM__.snapshot().kana.turn===1&&!window.__ALBUM__.snapshot().kana.busy);assert.equal(await sum(page),1);await page.waitForFunction(()=>window.__ALBUM__.snapshot().companion.savedCount===1);assert.equal((await snapshot(page)).companion.savedCount,1);checks.push('two-tabs-replay-same-attempt-one-IDB-update-and-one-presentation-receipt');
 await page.evaluate(()=>{const original=Storage.prototype.setItem;window.restoreWrite=()=>Storage.prototype.setItem=original;Storage.prototype.setItem=function(key,value){if(key.startsWith('japanese-kana-pending:'))throw new Error('refused storage');return original.call(this,key,value);};});
 await click(page,(await snapshot(page)).controls.find(c=>c.id.startsWith('kana-choice:')).id);await page.waitForFunction(()=>!!window.__ALBUM__.snapshot().kana.error);assert.equal(await sum(page),1);assert.equal((await snapshot(page)).kana.turn,1);
 await page.evaluate(()=>window.restoreWrite());await click(page,'kana-retry');await page.waitForFunction(()=>window.__ALBUM__.snapshot().kana.turn===2&&!window.__ALBUM__.snapshot().kana.busy);assert.equal(await sum(page),2);await page.waitForFunction(()=>window.__ALBUM__.snapshot().companion.savedCount===2);assert.equal((await snapshot(page)).companion.savedCount,2);checks.push('refused-storage-keeps-step-and-retry-once');
 // A genuinely issued older payload, retried after a later committed turn, is definitively stale.
 await page.evaluate(([key,value])=>localStorage.setItem(key,value),pending);await open(page);await page.waitForFunction(()=>!!window.__ALBUM__.snapshot().kana.error);assert.equal(await page.evaluate(key=>localStorage.getItem(key),pending[0]),null);await click(page,'kana-retry');await page.waitForFunction(()=>!window.__ALBUM__.snapshot().kana.error&&!window.__ALBUM__.snapshot().kana.busy);assert.equal(await sum(page),2);await click(page,'kana-start');await page.waitForFunction(()=>{const s=window.__ALBUM__.snapshot();return s.kana.active&&s.controls.some(c=>c.id.startsWith('kana-choice:'));});checks.push('stale-older-turn-rejected-no-stat-change-and-new-session-available');
 await context.close();context=await launch();page=await context.newPage();await open(page);assert.equal(await sum(page),2);checks.push('Chrome-process-restart-same-profile-statistics-restored');
 writeFileSync('checks-m8-m6-kana-storage.json',JSON.stringify({passed:true,checks,physicalDevice:false,crossBrowserTransfer:false},null,2)+'\n');console.log(JSON.stringify({passed:true,checks}));
}finally{await context?.close();}
