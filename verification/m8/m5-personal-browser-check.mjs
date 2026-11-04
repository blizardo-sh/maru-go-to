// M8: historical assertions replayed against root sources and main build, isolated synthetic clone.
import './guard.mjs';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {chromium,webkit} from '@playwright/test';
const runtime=JSON.parse(readFileSync('.local/runtime.json','utf8')),origin='http://localhost:5202';
const report={passed:false,checks:[],serverSchemaMigration:false};mkdirSync('test-results/m8-m5-reference',{recursive:true});
for(const engine of ['chrome','webkit']){
 const browser=await(engine==='chrome'?chromium.launch({channel:'chrome',headless:true}):webkit.launch({headless:true}));
 try{
  const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage();page.setDefaultTimeout(15000);
  let response;for(let i=0;i<3;i++){response=await context.request.post(origin+'/api/auth/sign-in/email',{headers:{origin},data:{email:runtime.browserEmail,password:runtime.browserPassword}});if(response.status()!==429)break;await new Promise(r=>setTimeout(r,Math.min(60,Number(response.headers()['retry-after'])||60)*1000));}assert.equal(response.status(),200);
  await page.goto(origin+'/');const snap=()=>page.evaluate(()=>window.__ALBUM__.snapshot());
  const click=async id=>{await page.waitForFunction(id=>{const s=window.__ALBUM__?.snapshot();return s?.controls?.some(c=>c.id===id&&c.enabled)&&!s.guided.busy;},id);const s=await snap(),c=s.controls.find(c=>c.id===id);await page.mouse.click(c.rect.x+c.rect.width/2,c.rect.y+c.rect.height/2);await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await page.waitForFunction(n=>window.__ALBUM__.snapshot().renderCount>n,s.renderCount);};
  await click('nav-menu');await click('reference');await page.waitForFunction(()=>window.__ALBUM__.snapshot().reference.lists!==undefined&&!window.__ALBUM__.snapshot().book.loading);
  for(const script of ['hiragana','katakana']){await click('reference:'+script);for(const group of ['basic','voiced','yoon','small']){await click('kana-table:'+group);assert.deepEqual((await snap()).problems,[],script+'/'+group);}await page.screenshot({path:`test-results/m8-m5-reference/${engine}-${script}.png`});await click('book-back');}
  await click('reference:particles');assert.ok((await snap()).controls.some(c=>c.id.startsWith('reference-particle:')));await click('book-back');
  await click('reference:lists');await click('personal-create');
  const name='Проверка '+engine+' '+Date.now();await page.getByRole('textbox',{name:'Название списка',exact:true}).fill(name);await page.getByRole('textbox',{name:'Слово; чтение; перевод — по одному в строке',exact:true}).fill('雲雀; ; учебная запись');await page.waitForTimeout(100);
  if(engine==='chrome'){
   let lost=true;await page.route('**/api/lists',async route=>{if(lost&&route.request().method()==='POST'){lost=false;await route.fetch();await route.abort('failed');}else await route.continue();});
   await click('personal-save');await page.waitForFunction(()=>!!window.__ALBUM__.snapshot().reference.error);
   await click('personal-retry');await page.waitForFunction(()=>!window.__ALBUM__.snapshot().reference.form&&!window.__ALBUM__.snapshot().reference.busy);await page.unroute('**/api/lists');report.checks.push('lost-ACK-create-retry');
  }else{await click('personal-save');await page.waitForFunction(()=>!window.__ALBUM__.snapshot().reference.form&&!window.__ALBUM__.snapshot().reference.busy);}
  let lists=(await(await context.request.get(origin+'/api/lists')).json()).lists;assert.equal(lists.filter(l=>l.name===name).length,1);const list=lists.find(l=>l.name===name);assert.equal(list.words.length,1);assert.equal(list.words[0].reviewStatus,'draft');
  await page.waitForFunction(count=>{const s=window.__ALBUM__.snapshot();return s.reference.lists===count&&s.controls.some(c=>c.id==='personal-create');},lists.length);await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  while(!(await snap()).controls.some(c=>c.id==='personal-list:'+list.id))await click('book-next');await click('personal-list:'+list.id);
  while(!(await snap()).controls.some(c=>c.id==='personal-word:'+list.words[0].id))await click('book-next');await click('personal-word:'+list.words[0].id);
  await page.getByRole('textbox',{name:'Чтение',exact:true}).fill('ひばり');await page.getByRole('textbox',{name:'Часть речи: noun / verb / adjective / other',exact:true}).fill('noun');await page.waitForTimeout(100);await click('personal-save');await page.waitForFunction(()=>!window.__ALBUM__.snapshot().reference.form&&!window.__ALBUM__.snapshot().reference.busy);
  lists=(await(await context.request.get(origin+'/api/lists')).json()).lists;const word=lists.find(l=>l.id===list.id).words[0];assert.equal(word.reviewStatus,'reviewed');assert.equal(word.kana,'ひばり');
  await page.reload();await page.waitForFunction(()=>window.__ALBUM__?.snapshot().authenticated&&!window.__ALBUM__.snapshot().guided.busy);await click('nav-menu');await click('lists');await page.waitForFunction(()=>window.__ALBUM__.snapshot().reference.lists!==undefined&&!window.__ALBUM__.snapshot().book.loading);
  assert.equal((await(await context.request.get(origin+'/api/lists')).json()).lists.find(l=>l.id===list.id).words[0].kana,'ひばり');report.checks.push(engine+':import-draft-confirm-reading-reload');
  await context.close();
 }catch(error){writeFileSync('.local/personal-diagnostic.json',JSON.stringify({engine,error:String(error),state:await browser.contexts()[0]?.pages()[0]?.evaluate(()=>window.__ALBUM__?.snapshot())}),{mode:0o600});throw error;}finally{await browser.close();}
}
report.passed=true;writeFileSync('checks-m8-m5-personal-browser.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
