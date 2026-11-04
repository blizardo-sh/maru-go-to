// M8: historical assertions replayed against root sources and main build, isolated synthetic clone.
import './guard.mjs';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { chromium, webkit } from '@playwright/test';
execFileSync('/private/tmp/japanese-stack-toolchain-1.4.3/bun',['m6-workspace-prepare.mts']);
const runtime = JSON.parse(readFileSync('.local/runtime.json','utf8')), origin = 'http://localhost:5202';
const report = { passed:false, publishedExerciseTokens: runtime.workspaceExercise.tokens.length, checks:[] };
mkdirSync('test-results/m8-m6-workspace',{recursive:true});
for (const engine of ['chrome','webkit']) {
  const browser = await (engine === 'chrome' ? chromium.launch({channel:'chrome',headless:true}) : webkit.launch({headless:true}));
  try {
    const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage();page.setDefaultTimeout(15000); let grades=0;page.on('request',r=>{if(r.method()==='POST'&&(r.url().endsWith('/api/reviews')||r.url().endsWith('/advance')))grades++;});
    let response;
    for(let i=0;i<3;i++){response=await context.request.post(origin+'/api/auth/sign-in/email',{headers:{origin},data:runtime.workspaceUsers[engine==='chrome'?0:1]});if(response.status()!==429)break;await new Promise(r=>setTimeout(r,Math.min(60,Number(response.headers()['retry-after'])||60)*1000));}assert.equal(response.status(),200);
    await page.goto(origin+'/?lesson='+encodeURIComponent(runtime.workspaceLesson));
    const snap=()=>page.evaluate(()=>window.__ALBUM__.snapshot());
    const click=async id=>{try {await page.waitForFunction(id=>{const s=window.__ALBUM__?.snapshot();return s?.controls.some(c=>c.id===id&&c.enabled)&&!s.guided.busy;},id);let s=await snap(),c=s.controls.find(c=>c.id===id);await page.mouse.move(c.rect.x+c.rect.width/2,c.rect.y+c.rect.height/2);await page.waitForTimeout(80);s=await snap();c=s.controls.find(c=>c.id===id&&c.enabled);await page.mouse.click(c.rect.x+c.rect.width/2,c.rect.y+c.rect.height/2);await page.waitForFunction(n=>window.__ALBUM__.snapshot().renderCount>n,s.renderCount); } catch(error){console.error(JSON.stringify({id,state:await page.evaluate(()=>{const s=window.__ALBUM__.snapshot();return{workspace:s.workspace,controls:s.controls.map(c=>({id:c.id,enabled:c.enabled})),companion:s.companion.activity};})}));await page.screenshot({path:`test-results/m8-m6-workspace/${engine}-failure.png`});throw error;}};
    await page.waitForFunction(()=>window.__ALBUM__?.snapshot().workspace);
    const exercise=runtime.workspaceExercise, index=id=>exercise.tokens.findIndex(token=>token.id===id);
    const order=exercise.acceptedOrders[0];
    await click('token:'+index(order[0]));await click('token:'+index(order[1]));
    await click('placed:'+index(order[1]));await click('workspace-left');await click('workspace-close');
    assert.equal((await snap()).workspace.tokens[0].id,order[1]);
    await page.reload();await page.waitForFunction(()=>window.__ALBUM__?.snapshot().workspace?.tokens.length===2);report.checks.push(engine+':move-and-draft-reload');
    await click('placed:'+index(order[1]));await click('workspace-remove');assert.equal((await snap()).workspace.tokens.length,1);
    await click('workspace-reset');
    for(const id of order)await click('token:'+index(id));
    for(const size of [{width:390,height:844},{width:320,height:640},{width:844,height:390},{width:1440,height:900}]){await page.setViewportSize(size);await page.waitForTimeout(100);assert.deepEqual((await snap()).problems,[],engine+':'+size.width);await page.screenshot({path:`test-results/m8-m6-workspace/${engine}-${size.width}.png`});}
    await page.setViewportSize({width:390,height:844});await page.waitForTimeout(100);
    await click('builder-check');await page.waitForFunction(()=>window.__ALBUM__.snapshot().controls.some(c=>c.id==='grade-remember'));
    report.checks.push(engine+':long-published-answer-evaluated');
    await click('placed:'+index(order[0]));
    const firstForm=exercise.tokens.find(t=>t.id===order[0]).formId; await click('form:'+firstForm);
    await click('placed:'+index(order[0]));
    await click('workspace-insert');
    assert.equal((await snap()).workspace.editing,'add');await click('workspace-close');
    await click('builder-input');
    const editor=page.locator('textarea:not([hidden])');await editor.fill('わたしはがくせいです。');
    const revised=(await snap()).workspace.revision;
    await page.waitForTimeout(150);
    await click('analyze');await page.waitForFunction(()=>window.__ALBUM__.snapshot().controls.some(c=>c.id==='notice-close'));
    assert.ok((await snap()).texts.some(t=>t.text.includes('исходный навык')));await click('notice-close');
    assert.ok((await snap()).workspace.revision>=revised);report.checks.push(engine+':insert-and-manual-analysis-no-target-credit');
    assert.equal(grades,0); report.checks.push(engine+':forms-and-no-target-grade-for-analysis');
    await click('builder-bank'); await click('workspace-reset');
    for (const id of [...order].reverse()) await click('token:'+index(id));
    await click('builder-check'); await page.waitForFunction(()=>{const s=window.__ALBUM__.snapshot();return s.workspace.verdict==='incorrect'&&s.controls.some(c=>c.id==='grade-remember'&&c.enabled);});
    assert.equal((await snap()).companion.savedCount,0); assert.notEqual((await snap()).companion.activity,'good');
    await click('workspace-reset'); await page.waitForFunction(()=>window.__ALBUM__.snapshot().workspace.tokens.length===0); for (const id of order) await click('token:'+index(id));
    await click('builder-check'); await page.waitForFunction(()=>{const s=window.__ALBUM__.snapshot();return s.workspace.verdict==='correct'&&s.controls.some(c=>c.id==='grade-remember'&&c.enabled);});
    assert.equal((await snap()).companion.activity,'draft-correct'); assert.equal((await snap()).companion.savedCount,0);
    await click('grade-remember'); await page.waitForFunction(()=>window.__ALBUM__.snapshot().companion.savedCount===1);
    assert.equal(grades,1); report.checks.push(engine+':wrong-draft-no-credit; correct-draft-nod; explicit-ACK-one-saved-result');
    await context.close();
  } finally { await browser.close(); }
}
report.passed=true;writeFileSync('checks-m8-m6-workspace.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
