import { chromium, expect, type Page } from '@playwright/test';
import { tokenHash } from '../src/server/auth';
import { connectDatabase } from '../src/server/db';
import { fixtureMail } from './helpers/browser-mailbox';
import { nextFixtureIp } from './helpers/fixture-ip';
import { output } from './helpers/artifact-output';

const databaseUrl=process.env.JAPANESE_INTEGRATION_DATABASE_URL, base=process.env.GUIDED_BROWSER_URL;
if(!databaseUrl||new URL(databaseUrl).hostname!=='127.0.0.1'||new URL(databaseUrl).pathname!=='/japanese_app_test'||!base||new URL(base).hostname!=='localhost')throw new Error('Isolated browser fixture required.');
const canvas=process.env.CANVAS_BROWSER==='true', database=connectDatabase(databaseUrl);
const browser=await chromium.launch({channel:'chrome',headless:true});
const emails:string[]=[], errors:string[]=[], sensitive:string[]=[];
async function click(page:Page,name:string) {
  if(!canvas){await page.getByRole('button',{name,exact:true}).click();return;}
  // Snapshot controls can exist behind the startup overlay while settings load.
  // A pointer click is valid only once the Canvas actually receives that point.
  const handle=await page.waitForFunction(name=>{
    const control=(window as any).__ALBUM__?.snapshot().controls?.find((item:any)=>item.text===name&&item.enabled);
    if(!control)return false;
    const {x,y,width,height}=control.rect;
    return document.elementFromPoint(x+width/2,y+height/2)?.tagName==='CANVAS'&&control.rect;
  },name);
  const rect=await handle.jsonValue();await handle.dispose();
  await page.mouse.click(rect.x+rect.width/2,rect.y+rect.height/2);
}
try {
  for(const width of [1280,390]) {
    const context=await browser.newContext({viewport:{width,height:900},extraHTTPHeaders:{'x-forwarded-for':nextFixtureIp()}});
    try {
      const page=await context.newPage(); page.on('pageerror',error=>errors.push(error.message));
      const email=`browser-mail-${crypto.randomUUID()}@example.test`, password='BrowserPassword123', replacement='ReplacementPassword123';emails.push(email);sensitive.push(email,password,replacement);
      const emailField=()=>page.getByRole('textbox',{name:canvas?'Электронная почта':'Email',exact:true});
      const action=(name:string)=>page.getByRole('button',{name,exact:true});
      async function postClick(name:string,path:string) {const [response]=await Promise.all([page.waitForResponse(response=>new URL(response.url()).pathname===path&&response.request().method()==='POST'),click(page,name)]);return response;}
      async function login(candidate:string) {await emailField().fill(email);await page.getByLabel('Пароль',{exact:true}).fill(candidate);return postClick('Войти','/api/auth/sign-in/email');}
      await page.goto(base+'/');
      await click(page,canvas?'Регистрация':'Создать аккаунт');
      await emailField().fill(email);await page.getByLabel('Имя в приложении',{exact:true}).fill('Mail browser student');await page.getByLabel('Пароль',{exact:true}).fill(password);
      await page.screenshot({path:`${output}/email-${canvas?'canvas':'react'}-${width}-registration.png`});
      expect((await postClick('Создать аккаунт','/api/register')).status()).toBe(200);
      await click(page,'Перейти ко входу');expect((await login(password)).status()).toBe(403);if(!canvas)await expect(action('Отправить письмо')).toBeVisible();
      const verification=await fixtureMail(email);sensitive.push(verification.url);
      const token=new URLSearchParams(new URL(verification.url).hash.slice(1)).get('token')!;sensitive.push(token);
      // Merely opening a link cannot consume it (mail scanners also fetch links).
      await page.goto(verification.url);
      expect((await postClick('Подтвердить почту','/api/email-verification/complete')).status()).toBe(200);
      await expect.poll(()=>new URL(page.url()).hash).toBe('');await click(page,'Продолжить');
      expect((await login(password)).status()).toBe(200);
      const me=await context.request.get(base+'/api/me');expect(me.status()).toBe(200);expect(await me.json()).toMatchObject({email,emailVerified:true,isAdmin:false});
      // Retain this session: resetting in a separate browser must revoke it.
      const resetContext=await browser.newContext({viewport:{width,height:900},extraHTTPHeaders:{'x-forwarded-for':nextFixtureIp()}});
      try {
        const resetPage=await resetContext.newPage();resetPage.on('pageerror',error=>errors.push(error.message));
        await resetPage.goto(base+'/');await click(resetPage,'Забыли пароль?');
        await resetPage.getByRole('textbox',{name:canvas?'Электронная почта':'Email',exact:true}).fill(email);
        const requested=resetPage.waitForResponse(response=>new URL(response.url()).pathname==='/api/recovery/request'&&response.request().method()==='POST');
        await click(resetPage,'Отправить письмо');expect((await requested).status()).toBe(200);
        await expect.poll(()=>canvas?resetPage.evaluate(()=>(window as any).__ALBUM__?.snapshot().access.complete):resetPage.getByRole('status').isVisible()).toBe(true);
        const recovery=await fixtureMail(email,'recovery');sensitive.push(recovery.url);
        await resetPage.goto(recovery.url);await resetPage.getByLabel('Пароль',{exact:true}).fill(replacement);
        const response=resetPage.waitForResponse(response=>new URL(response.url()).pathname==='/api/recovery/complete');
        await click(resetPage,'Сохранить пароль');expect((await response).status()).toBe(200);
        expect((await context.request.get(base+'/api/me')).status()).toBe(401);
        await click(resetPage,'Перейти ко входу');
        await resetPage.getByRole('textbox',{name:canvas?'Электронная почта':'Email',exact:true}).fill(email);await resetPage.getByLabel('Пароль',{exact:true}).fill(replacement);
        const signedIn=resetPage.waitForResponse(response=>new URL(response.url()).pathname==='/api/auth/sign-in/email');await click(resetPage,'Войти');expect((await signedIn).status()).toBe(200);
        expect((await resetContext.request.get(base+'/api/me')).status()).toBe(200);
        // Simulate the grandfathered migration state while keeping the live session.
        await database.sql`update users set email_verified=false,email_verification_required=false where email=${email}`;
        await database.sql`update auth_limits set expires_at=now()-interval '1 second' where key=${'mail:verify:cooldown:'+tokenHash(email)}`;
        if(canvas){
          let release!:()=>void;
          const settingsGate=new Promise<void>(resolve=>{release=resolve;});
          await resetPage.route('**/api/settings',async route=>{await settingsGate;await route.continue();});
          try{
            await resetPage.goto(base+'/',{waitUntil:'domcontentloaded'});
            await resetPage.waitForFunction(()=>(window as any).__ALBUM__?.snapshot().controls?.some((control:any)=>control.id==='confirm-email'));
            await expect(resetPage.locator('#startup')).toBeVisible();
          }finally{release();}
        }else await resetPage.goto(base+'/');
        if(canvas)await click(resetPage,'Подтвердить почту для восстановления');else await resetPage.getByRole('link',{name:'Подтвердить почту',exact:true}).click();
        if(canvas){await resetPage.waitForFunction(()=>(window as any).__ALBUM__?.snapshot().controls?.some((control:any)=>control.id==='access-submit'));await resetPage.unroute('**/api/settings');}
        try{await expect(resetPage.getByRole('textbox',{name:canvas?'Электронная почта':'Email',exact:true})).toHaveValue(email);}catch(error){if(canvas)console.info(await resetPage.evaluate(()=>({path:location.pathname,access:(window as any).__ALBUM__?.snapshot().access})));throw error;}
        await resetPage.getByLabel(canvas?'Пароль':'Текущий пароль',{exact:true}).fill(replacement);
        const proof=resetPage.waitForResponse(response=>new URL(response.url()).pathname==='/api/account/verify-email/request');
        await click(resetPage,'Отправить письмо');expect((await proof).status()).toBe(200);
        const legacyVerification=await fixtureMail(email);expect(legacyVerification.url).not.toBe(verification.url);sensitive.push(legacyVerification.url);
        await resetPage.goto(legacyVerification.url);
        const confirmed=resetPage.waitForResponse(response=>new URL(response.url()).pathname==='/api/email-verification/complete');
        await click(resetPage,'Подтвердить почту');expect((await confirmed).status()).toBe(200);
        expect(await (await resetContext.request.get(base+'/api/me')).json()).toMatchObject({email,emailVerified:true});

      } finally {await resetContext.close();}
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
      console.info(`PASS ${canvas?'Canvas':'React'} ${width}px: register, confirm, login, reset, session revocation, login`);
    } finally {await context.close();}
  }
  expect(errors).toEqual([]);
} catch(error) {
  let message=error instanceof Error?error.message:String(error);
  for(const value of sensitive)message=message.replaceAll(value,'<fixture>');
  console.error(message);process.exitCode=1;
} finally {
  await browser.close();
  for(const email of emails){await database.sql`delete from access_links where email=${email}`;await database.sql`delete from users where email=${email}`;}
  await database.sql.close();
}
