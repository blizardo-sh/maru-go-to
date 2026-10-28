import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, webkit } from '@playwright/test';

const out = new URL('./test-results/stand/', import.meta.url); await mkdir(out, { recursive: true });
const state = p => p.evaluate(() => window.__PAPER__.snapshot());
async function settle(p) { await p.waitForFunction(() => !window.__PAPER__.snapshot().pendingRender); await p.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))); }
async function load(p, query='task=word-ja') { await p.goto(`http://127.0.0.1:5190/paper.html?composition=stand&${query}`); await p.waitForFunction(() => window.__PAPER__?.snapshot().ready); await settle(p); }
async function click(p,id) {
  await settle(p);let s=await state(p),c=s.controls.find(c=>c.id===id);assert.ok(c?.enabled,`${s.task}: ${id}`);
  if(!c.docked)await p.evaluate(({y,top})=>scrollTo(0,Math.max(0,y-top/2)),{y:c.rect.y,top:s.dock?.top??await p.evaluate(()=>innerHeight)});
  await settle(p);c=(await state(p)).controls.find(c=>c.id===id);
  const point=await p.evaluate(c=>{const r=window.__PAPER__.app.canvas.getBoundingClientRect(),screen=window.__PAPER__.app.screen;return{x:r.x+(c.rect.x+c.rect.width/2)*r.width/screen.width,y:r.y+(c.rect.y+c.rect.height/2)*r.height/screen.height}},c);
  await p.mouse.click(point.x,point.y);await settle(p);
}
const result={date:new Date().toISOString(),browsers:{}};
for(const[name,engine,options]of[['chrome',chromium,{channel:'chrome'}],['webkit',webkit,{}]]){
  const b=await engine.launch({...options,headless:true});
  try{
    const p=await b.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'}),errors=[],api=[],matrix=[];
    p.on('pageerror',e=>errors.push(e.message));p.on('request',r=>{if(new URL(r.url()).pathname.startsWith('/api'))api.push(r.url())});
    for(const[width,height]of[[1440,1000],[1538,1468],[1280,900],[1024,754],[390,844],[320,640],[844,390]]){
      await p.setViewportSize({width,height});await load(p);let s=await state(p);const board=s.stand.board;
      assert.equal(s.composition,'stand');assert.equal(s.view,'flat-front');assert.equal(s.layout.font,'Lora');assert.ok(s.fontLoaded);assert.deepEqual(s.rotatedUi,[]);assert.deepEqual(s.cspViolations,[]);
      assert.equal(s.stand.camera,width<1000?'close':'room');assert.ok(s.stand.frame.width>board.width);assert.ok(s.stand.frame.width<width*1.5);
      if(!s.layout.centered)assert.ok(width>height);else assert.equal(s.studyBounds.x+s.studyBounds.width/2,width/2);
      for(const c of s.controls.filter(c=>['menu','next','section','lesson-exit'].includes(c.id)||c.id.startsWith('nav-'))){assert.ok(c.rect.x>=board.x&&c.rect.x+c.rect.width<=board.x+board.width+1);assert.ok(c.rect.y>=board.y&&c.rect.y+c.rect.height<=board.y+board.height+1)}
      assert.ok(!(await p.locator('#canvas-description').textContent()).includes('Пробное занятие'));assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      const next={...s.controls.find(c=>c.id==='next').rect};next.y-=await p.evaluate(()=>scrollY);
      await click(p,'word-option-1');s=await state(p);assert.equal(s.correct,false);assert.ok(s.controls.filter(c=>c.id.startsWith('word-option')).every(c=>c.enabled));
      if(width===1440||width===390)await p.screenshot({path:new URL(`${name}-${width}-wrong.jpg`,out).pathname,type:'jpeg',quality:86});
      await click(p,'word-option-0');await click(p,'auto-pause');s=await state(p);assert.equal(s.correct,true);assert.equal(s.hadMistake,true);const after={...s.controls.find(c=>c.id==='next').rect};after.y-=await p.evaluate(()=>scrollY);assert.deepEqual(after,next);
      await p.evaluate(()=>scrollTo(0,0));await settle(p);await p.screenshot({path:new URL(`${name}-${width}.jpg`,out).pathname,type:'jpeg',quality:87});
      await click(p,'cat-call');assert.equal((await state(p)).stand.catPerch,1);assert.equal((await state(p)).stand.moving,false);
      matrix.push({width,height,camera:s.stand.camera,correction:true,steadyActions:true,catPerches:true});
    }
    await p.setViewportSize({width:1440,height:1000});await load(p,'lesson=marugoto.starter-a1.lesson.01');await click(p,'lesson-start');
    while((await state(p)).task==='word-intro')await click(p,'intro-next');
    let s=await state(p);const right=s.lesson.choiceIds.indexOf(s.lesson.wordId);assert.ok(right>=0);
    await click(p,`word-option-${(right+1)%4}`);await click(p,`word-option-${right}`);await click(p,'auto-pause');await click(p,'next');assert.equal((await state(p)).lesson.again,1);assert.equal((await state(p)).lesson.attempts,1);
    await load(p,'task=word-listen');await click(p,'listen');await p.waitForFunction(()=>window.__PAPER__.snapshot().played);await click(p,'word-option-0');await click(p,'auto-pause');await p.screenshot({path:new URL(`${name}-listening.jpg`,out).pathname,type:'jpeg',quality:87});
    await p.emulateMedia({reducedMotion:'no-preference'});await click(p,'cat-call');await p.waitForFunction(()=>!window.__PAPER__.snapshot().stand.moving);await settle(p);assert.equal((await state(p)).stand.catPerch,1);
    await p.screenshot({path:new URL(`${name}-lower-perch.jpg`,out).pathname,type:'jpeg',quality:87});
    await p.getByRole('button',{name:'Позвать кота на другую полку',exact:true}).focus();await p.keyboard.press('Enter');await p.waitForFunction(()=>!window.__PAPER__.snapshot().stand.moving);await settle(p);assert.equal((await state(p)).stand.catPerch,0);
    await p.setViewportSize({width:390,height:844});
    await p.addInitScript(()=>document.addEventListener('animationstart',e=>{if(e.animationName==='stand-approach')e.target.getAnimations()[0]?.pause()}));
    await load(p);await p.waitForFunction(()=>document.querySelector('#stage').getAnimations().some(a=>a.playState==='paused'));assert.ok((await state(p)).cameraProgress<1);
    await click(p,'skip-camera');assert.equal((await state(p)).cameraProgress,1);assert.equal(await p.locator('#stage').evaluate(el=>el.classList.contains('stand-enter')),false);
    await p.emulateMedia({reducedMotion:'reduce'});await load(p);assert.equal((await state(p)).cameraProgress,1);assert.equal(await p.locator('#stage').evaluate(el=>el.getAnimations().length),0);
    assert.deepEqual(errors,[]);assert.deepEqual(api,[]);result.browsers[name]={version:b.version(),matrix,correctedAnswerStillRepeats:true,realAudio:true,catJump:true,mobileApproach:'whole scene, skip and reduced motion passed',errors,api};
    console.log(`${name}: stand geometry, mounted controls, correction, repeat, audio, cat perches and mobile approach passed`);
  }finally{await b.close()}
}
await writeFile(new URL('checks.json',out),JSON.stringify(result,null,2)+'\n');
