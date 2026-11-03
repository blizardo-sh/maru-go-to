// M8: historical assertions replayed against root sources and main build, isolated synthetic clone.
import './guard.mjs';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {chromium,webkit} from '@playwright/test';
const runtime=JSON.parse(readFileSync('.local/runtime.json','utf8')),origin='http://localhost:5202';
const report={passed:false,checks:[],nativePasswordManagers:false};mkdirSync('test-results/m8-m5-access',{recursive:true});
for(const engine of ['chrome','webkit']){
 const browser=await(engine==='chrome'?chromium.launch({channel:'chrome',headless:true}):webkit.launch({headless:true}));
 try{
  const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage();page.setDefaultTimeout(15000);
  const signIn=async user=>{let r;for(let i=0;i<3;i++){r=await context.request.post(origin+'/api/auth/sign-in/email',{headers:{origin},data:user});if(r.status()!==429)break;await new Promise(resolve=>setTimeout(resolve,Math.min(60,Number(r.headers()['retry-after'])||60)*1000));}assert.equal(r.status(),200);};
  const snap=()=>page.evaluate(()=>window.__ALBUM__.snapshot());
  const click=async id=>{await page.waitForFunction(id=>{const s=window.__ALBUM__?.snapshot();return s?.controls?.some(c=>c.id===id&&c.enabled)&&!s.guided.busy;},id);const s=await snap(),c=s.controls.find(c=>c.id===id);await page.mouse.click(c.rect.x+c.rect.width/2,c.rect.y+c.rect.height/2);await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await page.waitForFunction(n=>window.__ALBUM__.snapshot().renderCount>n,s.renderCount);};
  const seek=async id=>{while((await snap()).controls.some(c=>c.id==='book-prev'&&c.enabled))await click('book-prev');for(let i=0;i<20;i++){if((await snap()).controls.some(c=>c.id===id))return;await click('book-next');}};
  await signIn({email:runtime.browserEmail,password:runtime.browserPassword});assert.equal((await context.request.get(origin+'/api/admin/users')).status(),403);
  await page.goto(origin+'/');await click('nav-menu');await click('settings');await seek('volume:musicVolume');
  const before=await(await context.request.get(origin+'/api/settings')).json();await click('volume:musicVolume');await click(before.musicVolume<1?'volume-up':'volume-down');
  const expected=before.musicVolume+(before.musicVolume<1?.01:-.01);
  let lost=engine==='chrome';if(lost)await page.route('**/api/settings',async route=>{if(lost&&route.request().method()==='PUT'){lost=false;await route.fetch();await route.abort('failed');}else await route.continue();});
  await click('volume-save');if(engine==='chrome'){await page.waitForFunction(()=>window.__ALBUM__.snapshot().controls.some(c=>c.id==='notice-close'));await click('notice-close');await click('volume-save');await page.unroute('**/api/settings');report.checks.push('settings-lost-ACK-exact-retry');}
  await page.waitForFunction(value=>window.__ALBUM__.snapshot().settings?.musicVolume===value,Math.round(expected*100)/100);
  const after=await(await context.request.get(origin+'/api/settings')).json();assert.equal(after.speechVolume,before.speechVolume);assert.equal(after.ambienceVolume,before.ambienceVolume);assert.equal(after.sfxVolume,before.sfxVolume);
  await page.reload();await page.waitForFunction(()=>window.__ALBUM__?.snapshot().settings);assert.equal((await snap()).settings.musicVolume,Math.round(expected*100)/100);report.checks.push(engine+':independent-volumes-reload-and-admin-role');
  await context.request.post(origin+'/api/auth/sign-out',{headers:{origin},data:{}});await signIn({email:runtime.adminUser.email,password:runtime.adminUser.password});await page.goto(origin+'/');await click('nav-menu');await click('admin-access');await page.waitForFunction(()=>!window.__ALBUM__.snapshot().admin.busy);
  await click('admin-registration');
  for(const size of [{width:390,height:844},{width:320,height:640},{width:844,height:390},{width:1440,height:900}]){await page.setViewportSize(size);await page.waitForTimeout(100);assert.deepEqual((await snap()).problems,[],engine+'/admin/'+size.width);await page.screenshot({path:`test-results/m8-m5-access/${engine}-admin-${size.width}.png`});}
  await page.setViewportSize({width:390,height:844});await page.waitForTimeout(100);
  await page.getByRole('textbox',{name:'Лимит регистраций',exact:true}).fill('1');await page.waitForTimeout(100);
  let lostLink=engine==='chrome';if(lostLink)await page.route('**/api/admin/registration-links',async route=>{if(lostLink&&route.request().method()==='POST'){lostLink=false;await route.fetch();await route.abort('failed');}else await route.continue();});
  const linksBefore=(await(await context.request.get(origin+'/api/admin/registration-links')).json()).links.length;
  await click('admin-create');if(engine==='chrome'){await page.waitForFunction(()=>!!window.__ALBUM__.snapshot().admin.error);await click('admin-refresh');await page.unroute('**/api/admin/registration-links');}
  await page.waitForFunction(()=>window.__ALBUM__.snapshot().admin.screen==='created'&&!window.__ALBUM__.snapshot().admin.busy);
  assert.equal((await(await context.request.get(origin+'/api/admin/registration-links')).json()).links.length,linksBefore+1);const url=await page.getByRole('textbox',{name:'Созданная ссылка',exact:true}).inputValue();
  await page.goto(url);await page.waitForFunction(()=>window.__ALBUM__?.snapshot().access.invitation==='registration');
  assert.equal(await page.locator('input[type=password]').getAttribute('autocomplete'),'new-password');assert.equal(await page.locator('input[inputmode=email]').getAttribute('autocomplete'),'username');
  await page.locator('input[inputmode=email]').fill(`m5-public-${crypto.randomUUID()}@example.test`);await page.getByRole('textbox',{name:'Имя в приложении',exact:true}).fill('Проверка регистрации');await page.locator('input[type=password]').fill(crypto.randomUUID() + crypto.randomUUID());await page.waitForTimeout(100);await click('access-submit');
  await page.waitForFunction(()=>window.__ALBUM__.snapshot().authenticated||window.__ALBUM__.snapshot().access.complete);
  assert.ok(!new URL(page.url()).hash.includes('token='));report.checks.push(engine+':registration-Canvas-limit-and-token-removed');
  const exhausted=await context.request.post(origin+'/api/invitations/details',{headers:{origin},data:{token:new URL(url).hash.slice(7)}});assert.equal(exhausted.status(),400);
  await page.goto(origin+'/invite#token='+runtime.accessLinks.expired.token);await page.waitForFunction(()=>!!window.__ALBUM__?.snapshot().access.error);assert.ok((await snap()).texts.some(t=>t.text.includes('истекла')));report.checks.push(engine+':expired-and-exhausted-links');
  await context.close();
 }finally{await browser.close();}
}
report.passed=true;writeFileSync('checks-m8-m5-access-browser.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
