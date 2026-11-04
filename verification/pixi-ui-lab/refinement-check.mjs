import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium, webkit } from '@playwright/test';

const out = new URL('./test-results/refinement/', import.meta.url); await mkdir(out, { recursive: true });
const fixture = JSON.parse(await readFile(new URL('./paper-fixtures.json', import.meta.url)));
const state = p => p.evaluate(() => window.__PAPER__.snapshot());
async function settle(p) { await p.waitForFunction(() => !window.__PAPER__.snapshot().pendingRender); await p.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))); }
async function load(p, query = 'task=word-ja') { await p.goto(`http://127.0.0.1:5190/paper.html?composition=surround&${query}`); await p.waitForFunction(() => window.__PAPER__?.snapshot().ready); await settle(p); }
async function click(p, id) {
  await settle(p); let s = await state(p), c = s.controls.find(c => c.id === id); assert.ok(c?.enabled, `${s.task}: ${id} unavailable`);
  if (!c.docked) await p.evaluate(({y, top}) => scrollTo(0, Math.max(0, y - top / 2)), {y:c.rect.y, top:s.dock?.top ?? await p.evaluate(() => innerHeight)});
  await settle(p); c = (await state(p)).controls.find(c => c.id === id);
  await p.mouse.click(c.rect.x + c.rect.width / 2, c.rect.y + c.rect.height / 2 - await p.evaluate(() => scrollY)); await settle(p);
}
const result = { date: new Date().toISOString(), browsers: {} };
for (const [name, engine, options] of [['chrome', chromium, {channel:'chrome'}], ['webkit', webkit, {}]]) {
  const b = await engine.launch({...options, headless:true});
  try {
    const p = await b.newPage({viewport:{width:1440,height:1000}, reducedMotion:'reduce'}), errors=[], sizes=[];
    p.on('pageerror', e => errors.push(e.message));
    for (const [width,height] of [[1440,1000],[1538,1468],[1280,900],[1024,754],[390,844],[844,390]]) {
      await p.setViewportSize({width,height}); await load(p); const s = await state(p);
      assert.equal(s.composition,'surround'); assert.equal(s.layout.font,'Lora'); assert.ok(s.fontLoaded); assert.ok(s.layout.plainPaper);
      const nextType=s.controlText.find(c=>c.id==='next'); assert.equal(nextType.fontFamily,'Lora'); assert.equal(nextType.fontStyle,'normal');
      assert.ok(!(await p.locator('#canvas-description').textContent()).includes('Пробное занятие'));
      assert.equal(s.motion.x,0); assert.equal(s.motion.y,-8); assert.deepEqual(s.rotatedUi,[]); assert.deepEqual(s.cspViolations,[]);
      assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      if (width >= 1000) {
        assert.equal(s.studyBounds.x+s.studyBounds.width/2,width/2);
        assert.ok(s.catBounds.x-s.studyBounds.x-s.studyBounds.width >= 20 && s.catBounds.x-s.studyBounds.x-s.studyBounds.width < 80);
        assert.ok(s.catBounds.y+s.catBounds.height >= s.layout.deskBackEdge+24, 'Paws must rest below the visible tabletop edge');
        const bottom = Math.max(...s.controls.filter(c=>c.id.startsWith('word-option')).map(c=>c.rect.y+c.rect.height));
        const next = s.controls.find(c=>c.id==='next'); assert.ok(next.rect.y-bottom>=12 && next.rect.y-bottom<=90, 'Footer must belong to the study group');
      }
      await click(p,'word-option-1'); assert.equal((await state(p)).correct,false); assert.ok((await state(p)).controls.filter(c=>c.id.startsWith('word-option')).every(c=>c.enabled));
      await click(p,'word-option-0'); assert.equal((await state(p)).correct,true); assert.equal((await state(p)).hadMistake,true); await click(p,'auto-pause');
      await p.evaluate(()=>scrollTo(0,0)); await settle(p);
      await p.screenshot({path:new URL(`${name}-${width}.jpg`,out).pathname,type:'jpeg',quality:87});
      sizes.push({width,height,centered:width>=1000,correctedAnswer:true,raisedSheet:-8});
    }
    await p.setViewportSize({width:1440,height:1000}); await load(p,'lesson=marugoto.starter-a1.lesson.01'); await click(p,'lesson-start');
    while ((await state(p)).task === 'word-intro') await click(p,'intro-next');
    let s = await state(p); const right=s.lesson.choiceIds.indexOf(s.lesson.wordId); assert.ok(right>=0);
    await click(p,`word-option-${(right+1)%4}`); await click(p,`word-option-${right}`); await click(p,'auto-pause'); await click(p,'next');
    assert.equal((await state(p)).lesson.again,1); assert.equal((await state(p)).lesson.attempts,1);
    await load(p,'task=count-category'); const card=fixture.counterCards.find(c=>c.kind==='image-counter'), index=card.options.findIndex(o=>card.acceptedKeys.includes(o.key));
    await click(p,`count-option-${(index+1)%card.options.length}`); assert.equal((await state(p)).correct,false);
    await click(p,`count-option-${index}`); assert.equal((await state(p)).correct,true); await click(p,'auto-pause');
    await load(p); await p.emulateMedia({reducedMotion:'no-preference'});
    const samples=await p.evaluate(()=>new Promise(resolve=>{const values=[];window.__PAPER__.replay(); const start=performance.now();function frame(){values.push(window.__PAPER__.snapshot().motion);if(performance.now()-start>1600)resolve(values);else requestAnimationFrame(frame)}frame()}));
    assert.ok(samples.some(v=>v.y<-.5)); assert.equal(samples.at(-1).y,-8);
    samples.forEach((v,i)=>{assert.equal(v.x,0);if(i)assert.ok(v.y<=samples[i-1].y+.001,'Lift must never oscillate');});
    assert.deepEqual(errors,[]); result.browsers[name]={version:b.version(),sizes,errorCorrectionKeepsRepeat:true,counterCorrection:true,motion:'monotonic lift to -8, no sway; reduced motion immediate',errors};
    console.log(`${name}: centered study, grounded cat, plain paper, Lora, footer, correction and steady lift passed`);
  } finally { await b.close(); }
}
await writeFile(new URL('checks.json',out),JSON.stringify(result,null,2)+'\n');
