import { describe, expect, test, afterAll } from 'bun:test';
import { OpenAPIHono } from '@hono/zod-openapi';
import { registerContract } from '../src/server/openapi';
import { createEmptyCard } from 'ts-fsrs';
import { nextCard, gradeGrammar, evaluateTarget, reviewPriority, reviewDrawKey } from '../src/server/reviews';
import { matchesPreparedAnswer } from '../src/shared/answers';
import { validSegments } from '../src/server/material';
import { knownAnalysis, materialViolations, createAnalyzer } from '../src/server/analysis';
import { parseWordList } from '../src/server/words';
import { connectDatabase } from '../src/server/db';
import { consumeLink, createLink, tokenHash } from '../src/server/auth';
import type { Course } from '../src/shared/types';
import { course as shippedCourse } from '../src/shared/course';
import { withPersonalPractice } from '../src/server/personal-practice';
const emptyAccess={wordIds:new Set<string>(),skillIds:new Set<string>()};
const words=[{id:'word.cat',lessonIds:['l1'],surface:'猫',kana:'ねこ',segments:[{surface:'猫',reading:'ねこ'}],meaningRu:'кот',kind:'word' as const,pos:'noun',reviewStatus:'reviewed' as const,sourceRefs:[]},{id:'word.wa',lessonIds:['l2'],surface:'は',kana:'は',segments:[{surface:'は'}],meaningRu:'тема',kind:'word' as const,pos:'particle',reviewStatus:'reviewed' as const,sourceRefs:[]}];
const course:Course={id:'test',version:'1',title:'test',lessons:[],words,forms:words.map(w=>({...w,id:w.id+'.form',wordId:w.id})),skills:[{id:'skill',lessonIds:['l1'],canDoIds:[1],title:'猫',explanationRu:'Тестовый пример.',reviewStatus:'reviewed',sourceRefs:[]}],exercises:[{id:'ex',lessonId:'l1',skillId:'skill',promptRu:'Кот — тема.',tokens:[{id:'cat',formId:'word.cat.form'},{id:'wa',formId:'word.wa.form'},{id:'wa2',formId:'word.wa.form'}],acceptedOrders:[['cat','wa','wa2'],['wa','cat','wa2']],sentenceEnd:'。',reviewStatus:'reviewed'}]};
test('FSRS states schedule Again sooner and do not mutate prior card',()=>{const now=new Date('2026-10-20T12:00:00Z');const original=createEmptyCard(now);const good=nextCard(original,3,now);const again=nextCard(original,1,now);expect(good.due.getTime()).toBeGreaterThan(again.due.getTime());expect(original.reps).toBe(0);expect(good.reps).toBe(1);});
test('prepared grammar alternatives preserve duplicate token instances and hint consequence',()=>{const input={attemptId:crypto.randomUUID(),reviewId:'test',version:0,mode:'grammar' as const,tokenIds:['wa','cat','wa2'],revealed:false};expect(gradeGrammar(course,input,'ex')).toMatchObject({correct:true,rating:3});expect(gradeGrammar(course,{...input,revealed:true},'ex').rating).toBe(1);expect(gradeGrammar(course,{...input,tokenIds:['cat','wa','wa']},'ex').correct).toBe(false);expect(gradeGrammar(course,{...input,tokenForms:{cat:'wrong'}},'ex').correct).toBe(false);});
test('identical particles may trade places while every token instance remains required',()=>{
 const input={attemptId:crypto.randomUUID(),reviewId:'test',version:0,mode:'grammar' as const,tokenIds:['cat','wa2','wa'],revealed:false};
 expect(gradeGrammar(course,input,'ex').correct).toBe(true);
 expect(gradeGrammar(course,{...input,tokenIds:['cat','wa','wa']},'ex').correct).toBe(false);
 const alias={...course.forms[1]!,id:'wa.alias'};const otherSense={...course.forms[1]!,id:'wa.other-sense',wordId:'word.other-sense'};
 expect(gradeGrammar({...course,forms:[...course.forms,alias]}, {...input,tokenForms:{wa:alias.id}},'ex').correct).toBe(true);
 expect(gradeGrammar({...course,forms:[...course.forms,otherSense]}, {...input,tokenForms:{wa:otherSense.id}},'ex').correct).toBe(false);
});
test('shipped に and を exercise copies can swap without confusing に with numeral 二',()=>{
 for(const [suffix,left,right]of [['ni_event_time.l12.1','t2','t4'],['sorekara_sequence.l18.1','t2','t7']]){
  const exercise=shippedCourse.exercises.find(item=>item.id.endsWith(suffix!))!;const order=[...exercise.acceptedOrders[0]!];const l=order.indexOf(left!);const r=order.indexOf(right!);[order[l],order[r]]=[order[r]!,order[l]!];
  const token=exercise.tokens.find(item=>item.id===left)!;const form=shippedCourse.forms.find(item=>item.id===token.formId)!;const word=shippedCourse.words.find(item=>item.id===form.wordId)!;expect(word.pos).toBe('particle');
  if(form.surface==='に')expect(word.id).not.toBe(shippedCourse.words.find(item=>item.surface==='二')!.id);
  expect(gradeGrammar(shippedCourse,{attemptId:crypto.randomUUID(),reviewId:'test',version:0,mode:'grammar',tokenIds:order,revealed:false},exercise.id).correct).toBe(true);
 }
});
test('authored self-topic variants retain required meaning, core grammar and complete token instances',()=>{
 const variants=shippedCourse.exercises.filter(exercise=>exercise.acceptedOrders.some(order=>order.length<exercise.tokens.length));
 expect(variants).toHaveLength(15);
 for(const exercise of variants){
  expect(exercise.contextRu).toContain('о себе');
  for(const order of exercise.acceptedOrders){
   expect(matchesPreparedAnswer(exercise,shippedCourse.forms,order)).toBe(true);
   expect(evaluateTarget(shippedCourse,exercise.id,{tokenIds:order,revision:1}).outcome).toBe('correct');
   const result=knownAnalysis(shippedCourse,shippedCourse.words,emptyAccess,{text:order.map(id=>shippedCourse.forms.find(form=>form.id===exercise.tokens.find(token=>token.id===id)!.formId)!.surface).join(''),wordIds:[],revision:1});
   expect(result).toMatchObject({status:'ok',grammar:'correct',translationRu:exercise.translationRu});
   if(result?.status==='ok')expect(result.explanationRu).toContain('о себе');
  }
 }
 const exercise=variants.find(item=>item.id.endsWith('ga_ability.l03.1'))!;
 const check=(tokenIds:string[],tokenForms?:Record<string,string>,exploring=false)=>evaluateTarget(shippedCourse,exercise.id,{tokenIds,tokenForms,exploring,revision:1});
 expect(check(['t3','t4','t5'],undefined,true).outcome).toBe('correct');
 expect(gradeGrammar(shippedCourse,{attemptId:crypto.randomUUID(),reviewId:'test',version:0,mode:'grammar',tokenIds:['t3','t4','t5'],revealed:false,exploring:true},exercise.id)).toMatchObject({correct:true,rating:3});
 expect(check(['t5','t4','t3']).outcome).toBe('incorrect');
 for(const order of [['t2','t3','t4','t5'],['t1','t3','t4','t5'],['t3','t5'],['t4','t5'],['t3','t4'],['t3','t4','t4','t5'],['t3','t4','t5','t1']])expect(check(order).outcome).not.toBe('correct');
 expect(check(['other','t4','t5'],{other:exercise.tokens[2]!.formId}).outcome).toBe('exploration');
 const differentParticle=shippedCourse.forms.find(form=>form.surface==='を')!;
 const differentPerson=shippedCourse.forms.find(form=>form.surface==='あに')!;
 const replacements:Record<string,string>[]=[{t4:differentParticle.id},{t1:differentPerson.id}];
 for(const tokenForms of replacements)expect(check(['t1','t2','t3','t4','t5'],tokenForms).outcome).toBe('exploration');
 expect(check(['t1','t2','t3','t4','t5'],undefined,true).outcome).toBe('exploration');
 const identity=shippedCourse.exercises.find(item=>item.id.endsWith('wa_identity.l03.1'))!;
 expect(evaluateTarget(shippedCourse,identity.id,{tokenIds:identity.acceptedOrders[0]!.slice(2),revision:1}).outcome).not.toBe('correct');
});
test('confirmed personal nouns use an explicit picture-label identity template and existing skill',()=>{
 const noun={...words[0]!,id:'personal.test-noun',lessonIds:[],pos:'noun',reviewStatus:'reviewed' as const};const extended=withPersonalPractice(shippedCourse,[...shippedCourse.words,noun]);
 const exercise=extended.exercises.find(item=>item.id===noun.id+'.example.nominal-label')!;expect(exercise.skillId).toBe('marugoto.starter-a1.skill.wa_identity');expect(exercise.promptRu).toContain(noun.meaningRu);expect(exercise.contextRu).toContain('не описывает вас');expect(extended.skills).toBe(shippedCourse.skills);
 expect(extended.forms.find(form=>form.wordId===noun.id)?.surface).toBe(noun.surface);expect(materialViolations(extended,extended.words,{wordIds:new Set([noun.id]),skillIds:new Set()},{text:noun.surface,revision:1,wordIds:[noun.id+'.form.base']})).toEqual([]);expect(gradeGrammar(extended,{attemptId:crypto.randomUUID(),reviewId:'test',version:0,mode:'grammar',tokenIds:exercise.acceptedOrders[0]!,revealed:false},exercise.id).correct).toBe(true);
 expect(withPersonalPractice(shippedCourse,[{...noun,reviewStatus:'draft'}])).toBe(shippedCourse);expect(withPersonalPractice(shippedCourse,[{...noun,pos:'verb'}])).toBe(shippedCourse);expect(withPersonalPractice(shippedCourse,[{...noun,kana:''}])).toBe(shippedCourse);
});
test('new personal entries are drafts; segments are checked without per-character guessing',()=>{const [entry]=parseWordList('新しい語; あたらしいご; новое слово',course);expect(entry?.reviewStatus).toBe('draft');expect(entry?.kana).toBe('あたらしいご');expect(validSegments(entry!)).toBe(true);expect(validSegments({...words[0]!,kana:'まちがい'})).toBe(false);expect(()=>parseWordList('no translation',course)).toThrow();});
test('analysis scope uses explicit material access and never manual lesson switches',()=>{const access={wordIds:new Set(['word.cat']),skillIds:new Set<string>()};const input={text:'猫はは。',revision:5,wordIds:['word.cat','word.wa']};expect(materialViolations(course,words,access,input)).toHaveLength(1);const result=knownAnalysis(course,words,access,input);expect(result?.status).toBe('ok');if(result?.status==='ok'){expect(result.grammar).toBe('correct');expect(result.materialViolations.some(value=>value.includes('は'))).toBe(true);expect(result.revision).toBe(5);}const introducedSkill=knownAnalysis(course,words,{...access,skillIds:new Set(['skill']),exerciseIds:new Set(['ex'])},input);if(introducedSkill?.status==='ok')expect(introducedSkill.materialViolations).toEqual([]);});
test('due priority slightly favors recent difficult material but protects overdue old material',()=>{const now=new Date('2026-10-21T12:00:00Z');const common={due:now,introduced_at:'2025-01-01',card:{difficulty:1}};const recent={...common,introduced_at:now,card:{difficulty:9}};expect(reviewPriority(recent,now)).toBeGreaterThan(reviewPriority(common,now));expect(reviewPriority({...common,due:'2026-10-18'},now)).toBeGreaterThan(reviewPriority(recent,now));});
test('seeded weighted draws slightly favor recent difficult reviews and retain growing overdue weight',()=>{
 const now=new Date('2026-10-21T12:00:00Z');const old={due:now,introduced_at:'2025-01-01',card:{difficulty:1}};const recent={...old,introduced_at:now,card:{difficulty:9}};const overdue={...old,due:'2026-10-18T12:00:00Z'};
 let seed=42;const draw=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};let recentWins=0;let overdueWins=0;
 for(let index=0;index<4096;index++){if(reviewDrawKey(reviewPriority(recent,now),draw())<reviewDrawKey(reviewPriority(old,now),draw()))recentWins++;if(reviewDrawKey(reviewPriority(overdue,now),draw())<reviewDrawKey(reviewPriority(recent,now),draw()))overdueWins++;}
 expect(recentWins).toBeGreaterThan(2200);expect(recentWins).toBeLessThan(2700);expect(overdueWins).toBeGreaterThan(recentWins);
});
test('inline prepared analysis uses literal translation rather than the task instruction',()=>{
 const prepared={...course,exercises:[{...course.exercises[0]!,promptRu:'Постройте предложение по образцу.',translationRu:'Кот — тема.'}]};
 const result=knownAnalysis(prepared,words,emptyAccess,{text:'猫はは。',revision:1,wordIds:[]});expect(result?.status).toBe('ok');if(result?.status==='ok')expect(result.translationRu).toBe('Кот — тема.');
 const noun={...words[0]!,id:'personal.literal-translation',lessonIds:[],reviewStatus:'reviewed' as const};const extended=withPersonalPractice(shippedCourse,[...shippedCourse.words,noun]);const exercise=extended.exercises.find(item=>item.id===noun.id+'.example.nominal-label')!;expect(exercise.translationRu).toBe('Это кот.');
});
test('unconfigured analysis returns honest unavailable; arbitrary text does not become a known example',async()=>{const analyze=createAnalyzer({DATABASE_URL:'postgres://unused',BETTER_AUTH_SECRET:'x'.repeat(40),APP_URL:'http://localhost:5173',HOST:'127.0.0.1',PORT:3000});expect(await analyze('u',course,words,emptyAccess,{text:'未知の文です',revision:9,wordIds:[]})).toMatchObject({status:'unavailable',revision:9});});
test('configured provider validates JSON and never retries a paid or quota response',async()=>{
 let calls=0;let code=429;let value:unknown={};
 const server=Bun.serve({hostname:'127.0.0.1',port:0,fetch(){calls++;return Response.json(value,{status:code});}});
 const analyze=createAnalyzer({DATABASE_URL:'postgres://unused',BETTER_AUTH_SECRET:'x'.repeat(40),APP_URL:'http://localhost:5173',HOST:'127.0.0.1',PORT:3000,ANALYSIS_URL:server.url.href,ANALYSIS_MODEL:'local-test',ANALYSIS_FREE_ONLY:'true'});
 const input={text:'未知の文です',revision:2,wordIds:[]};
 try{
  expect((await analyze('u',course,words,emptyAccess,input)).status).toBe('unavailable');expect(calls).toBe(1);
  code=200;value={choices:[{message:{content:JSON.stringify({translationRu:'bad partial output'})}}]};expect((await analyze('u',course,words,emptyAccess,input)).status).toBe('unavailable');expect(calls).toBe(2);
  value={choices:[{message:{content:JSON.stringify({translationRu:'Фраза',grammar:'uncertain',naturalness:'uncertain',explanationRu:'Нужен контекст.',warnings:[]})}}]};const accepted=await analyze('u',course,words,emptyAccess,input);expect(accepted.status).toBe('ok');if(accepted.status==='ok')expect(accepted.grammar).toBe('uncertain');expect(calls).toBe(3);
 }finally{await server.stop(true);}
});
test('OpenAPI exports own routes with request validation, cookie auth and middleware errors',()=>{
 const app=new OpenAPIHono();registerContract(app,false);const document=app.getOpenAPI31Document({openapi:'3.1.0',info:{title:'test',version:'1'}});
 expect(document.paths?.['/api/reviews']?.post?.requestBody).toBeDefined();expect(document.paths?.['/api/reviews']?.post?.responses?.['409']).toBeDefined();expect(document.paths?.['/api/lists/{listId}/words/{wordId}']?.patch).toBeDefined();expect(document.components?.securitySchemes?.sessionCookie).toMatchObject({in:'cookie',name:'better-auth.session_token'});
});
const url=process.env.TEST_DATABASE_URL;const suite=url?describe:describe.skip;
suite('one-use links on disposable PostgreSQL',()=>{
 if(url){const parsed=new URL(url);if(!['localhost','127.0.0.1'].includes(parsed.hostname)||parsed.pathname!=='/japanese_app_test')throw new Error('Use only disposable localhost japanese_app_test');}
 const database=url?connectDatabase(url):null;const emails:string[]=[];
 afterAll(async()=>{if(database){for(const email of emails){await database.sql`delete from access_links where email=${email}`;await database.sql`delete from users where email=${email}`;}await database.sql.close();}});
 test('invitation is consumed once under concurrent attempts and expiry is enforced',async()=>{
  const email=`link-${crypto.randomUUID()}@example.test`;emails.push(email);const link=await createLink(database!,'invite',email,null);const results=await Promise.all([consumeLink(database!,'invite',link.token,'A-private-test-password-123','User'),consumeLink(database!,'invite',link.token,'A-private-test-password-123','User')]);expect(results.sort()).toEqual([false,true]);const [{count}]=await database!.sql`select count(*)::int as count from users where email=${email}`;expect(count).toBe(1);expect(await consumeLink(database!,'invite',link.token,'A-private-test-password-123')).toBe(false);
  const expiredEmail=`expired-${crypto.randomUUID()}@example.test`;emails.push(expiredEmail);const expired=await createLink(database!,'invite',expiredEmail,null);await database!.sql`update access_links set expires_at=now()-interval '1 second' where token_hash=${tokenHash(expired.token)}`;expect(await consumeLink(database!,'invite',expired.token,'A-private-test-password-123')).toBe(false);
 });
 test('recovery invalidates all existing sessions and cannot be reused',async()=>{
  const email=`recovery-${crypto.randomUUID()}@example.test`;emails.push(email);const invite=await createLink(database!,'invite',email,null);await consumeLink(database!,'invite',invite.token,'A-private-test-password-123','User');const [user]=await database!.sql`select id from users where email=${email}`;await database!.sql`insert into sessions(id,token,user_id,expires_at) values(${crypto.randomUUID()},${crypto.randomUUID()},${user.id},now()+interval '1 day')`;const recovery=await createLink(database!,'recovery',email,null);expect(await consumeLink(database!,'recovery',recovery.token,'A-new-private-password-123')).toBe(true);const [{count}]=await database!.sql`select count(*)::int as count from sessions where user_id=${user.id}`;expect(count).toBe(0);expect(await consumeLink(database!,'recovery',recovery.token,'Another-new-password-123')).toBe(false);
 });
});
