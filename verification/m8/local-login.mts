// Local convenience for the isolated M8 stand; never imported by the application or release.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import './guard.mjs';

const runtime=JSON.parse(readFileSync(new URL('./.local/runtime.json',import.meta.url),'utf8'));
const account=runtime.manualUsers?.[0];
assert.equal(runtime.origin,'http://localhost:5202');
assert.match(account?.email??'',/^m8-manualusers-[0-9a-f-]+@example\.test$/);
assert.equal(typeof account.password,'string');
assert.equal(typeof account.owner,'string');
const origin='http://localhost:5207',prefix='pixi-m8.';
const common={
  'Cache-Control':'no-store',
  'Referrer-Policy':'same-origin',
  'X-Content-Type-Options':'nosniff',
  'X-Frame-Options':'DENY',
  'Content-Security-Policy':"default-src 'none'; script-src 'self'; form-action 'self' http://localhost:5202; base-uri 'none'; frame-ancestors 'none'",
};
const respond=(body:string,status=200,headers:Record<string,string>={})=>new Response(body,{status,headers:{...common,...headers}});
const existingCookies=(raw:string)=>raw.split(';').map(s=>s.trim()).filter(s=>s.split('=',1)[0]?.startsWith(prefix)).join('; ');
async function who(cookie:string){
  if(!cookie)return null;
  const response=await fetch(runtime.origin+'/api/me',{headers:{Cookie:cookie},signal:AbortSignal.timeout(10000)});
  return response.ok?await response.json():null;
}
const server=Bun.serve({hostname:'127.0.0.1',port:5207,async fetch(request){
  const url=new URL(request.url);
  if(request.headers.get('host')!=='localhost:5207'||url.origin!==origin)return respond('Localhost only.',403);
  if(url.search)return respond('Unknown URL.',404);
  if(url.pathname==='/'&&request.method==='GET')return respond('<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Локальный вход M8</title><p>Входим в локальный M8…</p><form method="post" action="/login"><button type="submit">Войти в локальный M8</button></form><script src="/login.js" defer></script></html>',200,{'Content-Type':'text/html; charset=utf-8'});
  if(url.pathname==='/login.js'&&request.method==='GET')return respond('document.querySelector("form").requestSubmit();',200,{'Content-Type':'text/javascript; charset=utf-8'});
  if(url.pathname!=='/login')return respond('Not found.',404);
  if(request.method!=='POST')return respond('POST required.',405,{Allow:'POST'});
  if(request.headers.get('origin')!==origin||!['same-origin',null].includes(request.headers.get('sec-fetch-site')))return respond('Same-origin form required.',403);
  try{
    // Keep an existing M8 learner instead of silently switching an authenticated browser.
    const current=await who(existingCookies(request.headers.get('cookie')??''));
    if(current)return respond('',303,{Location:runtime.origin+'/'});
    const signed=await fetch(runtime.origin+'/api/auth/sign-in/email',{
      method:'POST',headers:{Origin:runtime.origin,'Content-Type':'application/json'},
      body:JSON.stringify({email:account.email,password:account.password}),signal:AbortSignal.timeout(15000),
    });
    if(!signed.ok){
      const retry=signed.headers.get('retry-after');
      return respond(signed.status===429?'Слишком много попыток входа. Повторите через '+(retry??'60')+' секунд.':'Локальный вход временно недоступен.',signed.status===429?429:502,retry?{'Retry-After':retry}:{});
    }
    const cookies=signed.headers.getSetCookie();
    assert.ok(cookies.length>0&&cookies.every(c=>c.startsWith(prefix)));
    const verified=await who(cookies.map(c=>c.split(';',1)[0]).join('; '));
    assert.equal(verified?.id,account.owner);
    assert.equal(verified?.isAdmin,false);
    const headers=new Headers({...common,Location:runtime.origin+'/'});
    for(const cookie of cookies)headers.append('Set-Cookie',cookie);
    return new Response(null,{status:303,headers});
  }catch{
    // Neither auth responses nor credentials/cookies are written to logs or error pages.
    return respond('Локальный M8 недоступен. Проверьте запуск приложения на порту 5202.',503);
  }
}});
console.info('Local M8 login: '+origin+'/');
for(const signal of ['SIGINT','SIGTERM'] as const)process.on(signal,()=>{void server.stop(true);process.exit(0);});
