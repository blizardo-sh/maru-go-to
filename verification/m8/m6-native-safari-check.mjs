import './guard.mjs';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';import{readFileSync,writeFileSync,mkdirSync}from'node:fs';
const runtime=JSON.parse(readFileSync('.local/runtime.json','utf8')),origin='http://localhost:5202',endpoint='http://127.0.0.1:5206';
async function command(path,body,method=body===undefined?'GET':'POST'){const response=await fetch(endpoint+path,{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(25000)});const r=await response.json();if(!response.ok)throw new Error(r.value?.message??'Safari driver error');return r.value;}
const session=await command('/session',{capabilities:{alwaysMatch:{browserName:'safari'}}}),path=`/session/${session.sessionId}`;
const js=(fn,...args)=>command(path+'/execute/sync',{script:`return (${fn.toString()})(...arguments)`,args});const snap=()=>js(()=>window.__ALBUM__?.snapshot());
const until=async fn=>{const end=Date.now()+20000;while(Date.now()<end){const v=await fn();if(v)return v;await new Promise(r=>setTimeout(r,80));}throw new Error('Native Safari wait timed out');};
async function enter(id){
 if(await js(()=>document.hidden))await until(()=>js(()=>!document.hidden));
 const s=await until(async()=>{const s=await snap();return s?.controls?.some(c=>c.id===id&&c.enabled)&&!s.guided.busy&&s.leaf?.phase==='idle'?s:null;}),c=s.controls.find(c=>c.id===id);
 const label=({'intro-audio':'Прослушать слово',audio:'Прослушать задание',settings:'Настройки'}[id]??c.text);
 assert.ok(await js(label=>{const b=[...document.querySelectorAll('button[aria-label]')].find(b=>b.getAttribute('aria-label')===label);b?.focus();return !!b;},label));
 await command(path+'/execute/async',{script:'const done=arguments[arguments.length-1];requestAnimationFrame(()=>requestAnimationFrame(()=>done(true)));',args:[]});
 assert.equal(await js(()=>document.activeElement?.getAttribute('aria-label')),label);
 await command(path+'/actions',{actions:[{type:'key',id:'keyboard',actions:[{type:'keyDown',value:'\uE007'},{type:'keyUp',value:'\uE007'}]}]});await new Promise(r=>setTimeout(r,180));
 if(id==='grade-remember'||id==='grade-again')await until(async()=>(await snap()).guided.version>s.guided.version);
}

const stable=()=>until(async()=>{const s=await snap();return s?.ready&&s.leaf?.phase==='idle'&&!s.guided.busy&&!s.guided.error&&(s.page!=='lesson'||s.renderedKey===`lesson:${s.guided.version}:${s.guided.step?.id}`)?s:null;});
try{
 execFileSync('osascript',['-e','tell application "Safari" to activate']);
 await command(path+'/window/rect',{x:0,y:25,width:1280,height:900});await command(path+'/url',{url:origin+'/?scene=river'});
 let auth;for(let attempt=0;attempt<4;attempt++){const result=await command(path+'/execute/async',{script:"const done=arguments[arguments.length-1];fetch('/api/auth/sign-in/email',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(arguments[0])}).then(r=>done({status:r.status,retry:r.headers.get('retry-after')})).catch(()=>done({status:0}));",args:[runtime.browserUsers[2]]});auth=result.status;if(auth!==429)break;await new Promise(resolve=>setTimeout(resolve,1000*Math.max(1,Number(result.retry)||60)));}assert.equal(auth,200);
 const course=await command(path+'/execute/async',{script:"const done=arguments[arguments.length-1];fetch('/api/course').then(r=>r.json()).then(done);",args:[]});const lesson=course.learning[0].lessonId;await command(path+'/url',{url:origin+'/?scene=river&lesson='+encodeURIComponent(lesson)});await until(async()=>{const s=await snap();return s?.page==='lesson'&&s.controls.some(c=>c.id==='intro-next');});
 await js(()=>{window.__M6ERR=[];window.__M6CSP=[];window.addEventListener('error',e=>window.__M6ERR.push(e.message));document.addEventListener('securitypolicyviolation',e=>window.__M6CSP.push(e.violatedDirective));});
 await enter('intro-audio');await until(async()=>{const s=await snap();return s.media.speechTime>.08&&s.m6.sound.speechPlaying;});assert.ok((await snap()).m6.sound.gains.duck<.18);await until(async()=>!(await snap()).m6.sound.speechPlaying);await until(async()=>(await snap()).m6.sound.gains.duck>.97);
 let steps=0;const reactions=new Set(),variants=new Set();
 while((await stable()).guided.step&&steps++<180){const s=await snap(),step=s.guided.step;reactions.add(s.companion.activity);if(s.companion.activity==='good')variants.add(s.companion.variant);
  if(step.kind==='word-intro'||step.kind==='construction-intro')await enter('intro-next');
  else if(step.kind==='word-practice'||step.kind==='construction-practice'&&step.mode!=='grammar'){if(step.mode==='listening'){await enter('audio');await until(async()=>(await snap()).heard);}if(!(await snap()).revealed)await enter('show-answer');await enter('grade-remember');}
  else if(step.kind==='construction-practice'){const e=course.exercises.find(e=>e.id===step.exerciseId);for(const id of e.acceptedOrders[0])await enter('token:'+e.tokens.findIndex(t=>t.id===id));await enter('builder-check');await until(async()=>(await snap()).correct);await enter('grade-remember');}
  else if(step.kind==='video')await enter('video-skip');else if(step.kind==='part-complete')await enter('part-next');else throw new Error('Unexpected published step kind');
 }
 assert.equal((await stable()).guided.progress.finished,true);await enter('home');const names=new Set();for(let i=0;i<5;i++){await enter('home');await enter('scene-next');await until(async()=>(await snap()).m6.scene.state==='ready');names.add((await snap()).m6.scene.id);}assert.equal(names.size,5);
 assert.ok(await js(()=>{const b=[...document.querySelectorAll('button[aria-label]')].find(b=>b.getAttribute('aria-label')==='Погладить кота');b?.focus();return!!b&&document.activeElement===b;}));await command(path+'/actions',{actions:[{type:'key',id:'keyboard',actions:[{type:'keyDown',value:'\uE007'},{type:'keyUp',value:'\uE007'}]}]});await until(async()=>(await snap()).companion.activity==='pet');
 await enter('settings');await enter('motion');await until(async()=>(await snap()).settings.animations===false);const before=(await snap()).m6.decorTicks;await new Promise(r=>setTimeout(r,250));assert.equal((await snap()).m6.decorTicks,before);await enter('motion');
 const errors=await js(()=>({js:window.__M6ERR,csp:window.__M6CSP}));assert.deepEqual(errors,{js:[],csp:[]});mkdirSync('test-results/m8-native',{recursive:true});writeFileSync('test-results/m8-native/native-safari.png',Buffer.from(await command(path+'/screenshot'),'base64'));
 const report={date:'2026-11-02',passed:true,browser:session.capabilities.browserName,version:session.capabilities.browserVersion,nativeMac:true,inputMethod:'Focused native accessibility buttons, two-frame focus restoration, real WebDriver Enter; no programmatic action callbacks',fullFirstPublishedLesson:true,steps,allFiveScenes:true,realJapaneseSpeechTimeAdvances:true,realDuckAndRelease:true,keyboardPet:true,manualMotionOffStopsRaf:true,jsErrors:0,cspViolations:0,limits:['Native Mac Safari; not physical phones','Other M5 groups and real native IME/autofill/readers remain hardware acceptance','No human headphones/speaker audition claim']};writeFileSync('checks-m8-m6-native-safari.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}catch(error){console.error(error);console.error(JSON.stringify(await js(()=>{const s=window.__ALBUM__?.snapshot();return s&&{page:s.page,ready:s.ready,guided:s.guided,leaf:s.leaf,media:s.media,mediaError:s.mediaError,heard:s.heard,m6:s.m6,companion:s.companion?.activity,controls:s.controls?.map(c=>({id:c.id,enabled:c.enabled})),errors:window.__M6ERR};})));throw error;}finally{await command(path,undefined,'DELETE');}
