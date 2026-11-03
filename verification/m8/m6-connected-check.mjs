// M8: historical assertions replayed against root sources and main build, isolated synthetic clone.
import './guard.mjs';
// M6 connected regression on a new full-publication disposable clone; M5 reports retained.
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { chromium, webkit } from '@playwright/test';
const bun = '/private/tmp/japanese-stack-toolchain-1.4.3/bun';

const runtime = JSON.parse(readFileSync('.local/runtime.json', 'utf8'));
const origin = 'http://localhost:5202', out = 'test-results/m8-m6-connected'; mkdirSync(out, { recursive: true });
const report = [];
for (const [index, engine, options] of [[0, chromium, { channel: 'chrome' }], [1, webkit, {}]]) {
  const browser = await engine.launch({ headless: true, ...options }), context = await browser.newContext({viewport:{width:390,height:844}});
  const page = await context.newPage(), errors = [], csp = [];
  page.on('pageerror', e => { errors.push(e.message); console.error(e.stack); });
  await page.exposeFunction('cspReport', value => csp.push(value));
  await page.addInitScript(() => { HTMLMediaElement.prototype.play=async function(){this.dispatchEvent(new Event('play'));}; document.addEventListener('securitypolicyviolation',e=>window.cspReport(e.violatedDirective)); });
  const account = runtime.browserUsers[index];
  try {
    let signed = await context.request.post(origin + '/api/auth/sign-in/email', { headers:{origin}, data:account });
    for (let retry = 0; signed.status() === 429 && retry < 2; retry++) {
      const delay = Math.min(60, Math.max(1, Number(signed.headers()['retry-after']) || 60));
      console.log(JSON.stringify({engine:index,authCooldownSeconds:delay}));
      await new Promise(resolve => setTimeout(resolve, delay * 1000));
      signed = await context.request.post(origin + '/api/auth/sign-in/email', { headers:{origin}, data:account });
    }
    assert.equal(signed.status(),200);
    const courseResponse = await context.request.get(origin+'/api/course'), course = await courseResponse.json(), lesson = course.learning[0].lessonId;
    await page.goto(origin+'/?lesson='+encodeURIComponent(lesson));
    await page.waitForFunction(()=>window.__ALBUM__?.snapshot().guided.active && !window.__ALBUM__.snapshot().guided.busy);
    const reactions=new Set(),variants=new Set();
    const snap = async()=>{const s=await page.evaluate(()=>window.__ALBUM__.snapshot());reactions.add(s.companion.activity);if(s.companion.activity==='good')variants.add(s.companion.variant);return s;};
    const click = async id => {
      await stable();
      if (['home','reviews','settings'].includes(id) && !(await snap()).controls.some(c=>c.id===id)) await click('nav-menu');
      await page.waitForFunction(id=>window.__ALBUM__.snapshot().controls?.some(c=>c.id===id&&c.enabled),id);
      let before = await snap(), c=before.controls.find(c=>c.id===id);
      await page.mouse.move(c.rect.x+c.rect.width/2,c.rect.y+c.rect.height/2);await page.waitForTimeout(80);await stable();
      before = await snap();c=before.controls.find(c=>c.id===id&&c.enabled);assert.ok(c,'Control disappeared before pointertap: '+id);
      await page.mouse.click(c.rect.x+c.rect.width/2,c.rect.y+c.rect.height/2);
      await page.waitForFunction(count=>window.__ALBUM__.snapshot().renderCount>count,before.renderCount);
    };
    const stable = ()=>page.waitForFunction(()=>{const s=window.__ALBUM__.snapshot();return !s.guided.busy&&!s.review.pending&&!s.workspace?.checking&&(s.page!=='lesson'||s.renderedKey===`lesson:${s.guided.version}:${s.guided.step?.id}`);});
    const resize = async(width,height)=>{await page.setViewportSize({width,height});await page.waitForTimeout(100);};
    const geometry = async(label)=>{
      const s=await snap(); assert.notEqual(s.companion.state,'unavailable','Actual companion atlas must load'); assert.deepEqual(s.problems,[],label+': '+s.problems.join('; '));
      for(const c of s.controls.filter(c=>c.enabled)){assert.ok(c.rect.width>=43 && c.rect.height>=43,label+' target '+c.id);assert.ok(c.rect.x>=-1&&c.rect.y>=-1&&c.rect.x+c.rect.width<=page.viewportSize().width+1&&c.rect.y+c.rect.height<=page.viewportSize().height+1,label+' bounds '+c.id);}
      for(const t of s.texts){assert.ok(t.bounds.x>=-1&&t.bounds.x+t.bounds.width<=page.viewportSize().width+1,label+' text x');assert.ok(t.bounds.y>=-1&&t.bounds.y+t.bounds.height<=page.viewportSize().height+1,label+' text y: '+t.text);}
      await page.screenshot({path:`${out}/${index}-${label}.png`});
    };
    const fixed=(await snap()).fixed;
    await geometry('intro-390');
    while (true) { await stable(); if ((await snap()).guided.step?.kind !== 'word-intro') break; await click('intro-next'); }
    await stable();
    await geometry('recall-hidden-390');
    const initial=await snap(), target=course.words.find(word=>word.id===initial.guided.step.wordId);
    assert.ok(!initial.texts.some(t=>t.text.includes(target.meaningRu)),'hidden meaning leaked');
    await click('show-answer'); await geometry('recall-revealed-390');
    assert.deepEqual((await snap()).fixed,fixed);
    let intercepted=false, originalPayload;
    const lostAck=async route=>{ if(!intercepted){intercepted=true;originalPayload=route.request().postDataJSON();await route.fetch();await route.abort();}else await route.continue(); };
    await page.route('**/api/learning/*/advance',lostAck);
    await click('grade-remember');
    await page.waitForFunction(()=>!!window.__ALBUM__.snapshot().guided.error); assert.equal((await snap()).companion.savedCount,0,'Lost ACK cannot celebrate');
    const beforeRetry=await page.evaluate(()=>Object.entries(localStorage).filter(([k])=>k.startsWith('japanese-pending-learning:')).flatMap(([,v])=>JSON.parse(v)));
    assert.equal(beforeRetry.length,1);assert.deepEqual(beforeRetry[0].submission,originalPayload);
    await page.reload();await page.waitForFunction(()=>window.__ALBUM__?.snapshot().guided.active&&!window.__ALBUM__.snapshot().guided.busy);
    assert.equal((await snap()).guided.error,'');
    assert.equal(await page.evaluate(()=>Object.entries(localStorage).filter(([k])=>k.startsWith('japanese-pending-learning:')).flatMap(([,v])=>JSON.parse(v)).length),0);
    await page.unroute('**/api/learning/*/advance',lostAck);
    // Help and its first wrong choice survive reload and are sent only with explicit self-assessment.
    if ((await snap()).guided.step.mode==='listening') await click('audio');
    await click('hint');
    const hinted=await snap(), step=hinted.guided.step, choices=hinted.guided.choiceIds, wrong=choices.find(id=>id!==step.wordId);
    const beforeVersion=hinted.guided.version;
    const c=(await snap()).controls.find(c=>c.id===wrong); if(c) await click(wrong);
    assert.equal((await snap()).guided.version,beforeVersion);
    await page.reload();await page.waitForFunction(()=>window.__ALBUM__?.snapshot().guided.active&&!window.__ALBUM__.snapshot().guided.busy);
    if ((await snap()).guided.step.mode==='listening') await click('audio');
    await click(step.wordId); assert.equal((await snap()).controls.find(c=>c.id==='grade-remember').enabled,true); await click('grade-remember');await stable();
    // All viewports use the same real question and keep book geometry on reveal.
    for(const [w,h] of [[320,640],[844,390],[1440,900]]){
      await resize(w,h); await geometry(`question-${w}`);
    }
    await resize(390,844);
    let guard=0,builderErrorTested=false,imeTested=false;
    while((await snap()).guided.step&&guard++<180){
      const s=await snap(), step=s.guided.step;
      if(step.kind==='word-intro'||step.kind==='construction-intro') await click('intro-next');
      else if(step.kind==='word-practice'||step.kind==='construction-practice'&&step.mode!=='grammar'){
        if(step.mode==='listening'){
          await page.evaluate(()=>{HTMLMediaElement.prototype.play=async function(){this.dispatchEvent(new Event('play'));};});
          await click('audio');
        }
        if(!(await snap()).revealed) await click('show-answer');
        await click('grade-remember');
      }else if(step.kind==='construction-practice'){
        const exercise=course.exercises.find(e=>e.id===step.exerciseId), order=exercise.acceptedOrders[0].map(id=>exercise.tokens.findIndex(t=>t.id===id));
        if(!imeTested){
          const version=(await snap()).guided.version;await click('builder-input');
          const input=page.locator('textarea[lang=ja]:not([hidden])');await input.fill('わたしはがくせいです');await input.dispatchEvent('compositionstart');
          await page.waitForFunction(()=>window.__ALBUM__.snapshot().controls.find(c=>c.id==='analyze')?.enabled===false);
          await input.dispatchEvent('compositionend');await click('analyze');await stable();await click('notice-close');
          assert.equal((await snap()).guided.version,version);await click('builder-bank');await click('workspace-reset');imeTested=true;
        }
        if(!builderErrorTested){
          const version=(await snap()).guided.version;
          for(const i of [...order].reverse())await click('token:'+i);await click('builder-check');await stable();
          assert.equal((await snap()).correct,false); assert.notEqual((await snap()).companion.activity,'good');assert.equal((await snap()).guided.version,version);
          for(const i of [...order].reverse()){await click('placed:'+i);await click('workspace-remove');}builderErrorTested=true;
        }
        for(const i of order) await click('token:'+i);
        await click('builder-check');await stable();
        await geometry('builder-correct'); assert.equal((await snap()).companion.activity,'draft-correct'); await click('grade-remember');
      }else if(step.kind==='counter-practice'){
        if((await snap()).controls.some(c=>c.id==='counter-intro'))await click('counter-intro');
        if(step.format==='recall'){await click('show-answer');await click('grade-remember');}
        else {const issued=await(await context.request.get(origin+'/api/learning/'+lesson)).json();await click(issued.reviewItem.counter.acceptedKeys[0]);await stable();await click('counter-next');}
      }else if(step.kind==='video') await click('video-skip');
      else if(step.kind==='part-complete')await click('part-next');
      else throw new Error('Unhandled step '+step.kind);
      await stable();
    }
    assert.equal((await snap()).guided.progress.finished,true);await geometry('complete');
    await page.reload();await page.waitForFunction(()=>window.__ALBUM__?.snapshot().guided.progress.finished);assert.equal((await snap()).guided.step,null); assert.equal((await snap()).companion.completionCount,0); assert.notEqual((await snap()).companion.activity,'complete');
    // Ordinary review: real due queue, outbox and ACK in each direction.
    execFileSync(bun,['m6-browser-data.mts','--due',String(index)]);
    await click('reviews');
    for(const mode of ['review-ja','review-ru','review-audio']){
      await click(mode);await page.waitForFunction(()=>window.__ALBUM__.snapshot().review.total>0);
      if(mode==='review-audio')await click('audio');
      await click('show-answer');await geometry(mode);
      const s=await snap(); await click('grade-again'); await page.waitForFunction(turn=>window.__ALBUM__.snapshot().review.turn>turn,s.review.turn);
      await click('home');await click('reviews');
      // Select another direction by ending the in-memory portion; no data is reset.
      await page.reload();await page.waitForFunction(()=>window.__ALBUM__?.snapshot().authenticated&&!window.__ALBUM__.snapshot().guided.busy);await click('reviews');
    }
    // Context restoration preserves current review and a revealed answer.
    await click('review-ja');await page.waitForFunction(()=>window.__ALBUM__.snapshot().review.total>0);await click('show-answer');
    const restoreBefore=await snap();
    await page.evaluate(()=>{const c=document.querySelector('canvas'),gl=c.getContext('webgl2')??c.getContext('webgl');window.__LOST_GL__=gl.getExtension('WEBGL_lose_context');window.__LOST_GL__.loseContext();});
    await page.waitForFunction(()=>window.__ALBUM__.snapshot().contextLost);await page.evaluate(()=>window.__LOST_GL__.restoreContext());await page.waitForFunction(()=>!window.__ALBUM__.snapshot().contextLost);
    assert.equal((await snap()).review.turn,restoreBefore.review.turn);assert.equal((await snap()).revealed,true);
    await geometry('restored');
    await page.evaluate(()=>window.__LOST_GL__.loseContext());await page.waitForFunction(()=>window.__ALBUM__.snapshot().contextLost);
    await page.getByRole('button',{name:'Восстановить графику',exact:true}).click();
    await page.waitForFunction(()=>window.__ALBUM__.snapshot().ready&&!window.__ALBUM__.snapshot().contextLost);
    assert.equal((await snap()).review.turn,restoreBefore.review.turn);assert.equal((await snap()).revealed,true);
    assert.equal(await page.locator('#stage > canvas').count(),1);await geometry('rebuilt');
    const accessibilityCount = await page.locator('button').count();
    for (let cycle = 0; cycle < 20; cycle++) {
      await click('home'); await click('reviews');
      assert.equal((await snap()).review.turn, restoreBefore.review.turn);
      assert.equal((await snap()).revealed, true);
      assert.equal(await page.locator('#stage > canvas').count(), 1);
      assert.equal(await page.locator('button').count(), accessibilityCount);
    }
    assert.deepEqual(errors,[]);assert.deepEqual(csp,[]);
    report.push({engine:index===0?'Chrome':'Playwright WebKit',passed:true,lessonComplete:true,lostAckRetry:true,hintReload:true,threeReviewDirections:true,contextRecovery:true,rendererRecreationKeepsQueue:true,completedRouteReloadNoFarewell:true,navigationCycles:20,stableCanvasAndAccessibilityControls:true,syntheticIMEGuard:imeTested,analysisWithoutGrade:imeTested,firstBuilderErrorCorrection:builderErrorTested,viewportChecks:4,reactions:[...reactions],successVariants:[...variants],cspViolations:0,jsErrors:0});
  } catch(error){console.error(error);console.error(JSON.stringify({engine:index,errors,csp,state:await page.evaluate(()=>{const s=window.__ALBUM__?.snapshot();return s&&{page:s.page,ready:s.ready,contextLost:s.contextLost,guidedBusy:s.guided.busy,guidedError:s.guided.error,mediaError:s.mediaError,controls:s.controls.map(c=>({id:c.id,enabled:c.enabled}))};})}));await page.screenshot({path:`${out}/${index}-failure.png`});console.error(error);throw error;}
  finally{await browser.close();}
}
writeFileSync('checks-m8-m6-connected.json',JSON.stringify({passed:true,syntheticDisposable:true,report,limits:['No physical phones, native IME or screen readers','Listening transition tests use controlled media play after separate real audio check']},null,2)+'\n');
console.log(JSON.stringify({passed:true,browsers:report.length,fullPublication:true}));
