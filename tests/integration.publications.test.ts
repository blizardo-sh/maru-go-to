import { test, expect } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import legacy from '../materials/legacy-course.json';
import type { Course } from '../src/shared/types';
import { learningParts, type LearningAdvance, type LearningState } from '../src/shared/learning';
import { connectDatabase } from '../src/server/db';
import { createApp } from '../src/server/app';
import { createLink, consumeLink } from '../src/server/auth';
import { legacyCourseFixture as loadCourse } from './helpers/legacy-course-fixture';
import { activatePublication, currentPublication, ensureInitialPublications, getPublication, legacyPublication, packContent, publishContent, validatePublicationMedia } from '../src/server/publications';
import { nextFixtureIp } from './helpers/fixture-ip';

const url=process.env.JAPANESE_INTEGRATION_DATABASE_URL;
(url?test:test.skip)('a live publication pins old answers, adds PDF material without losing progress and safely rolls back',async()=>{
  const target=new URL(url!); if(!['localhost','127.0.0.1'].includes(target.hostname)||target.pathname!=='/japanese_app_test')throw new Error('Disposable localhost database required.');
  const db=connectDatabase(url!), origin='http://127.0.0.1:5173', ip=nextFixtureIp(), email=`publication-${crypto.randomUUID()}@example.test`, password='Publication-test-only-2026!';
  const initial=packContent(loadCourse()), archived=packContent(legacy as Course), root=new URL('../public',import.meta.url).pathname;
  let userId='', oldActive=''; const created:string[]=[];
  const empty=mkdtempSync(join(tmpdir(),'maru-empty-media-'));
  try {
    await ensureInitialPublications(db,initial,archived); oldActive=(await currentPublication(db)).publicationId!;
    const a=structuredClone(archived), b=structuredClone(initial);
    a.course.title+=' '+crypto.randomUUID(); b.course.title+=' '+crypto.randomUUID();
    const pubA=(await publishContent(db,a,{mediaRoot:root})).id; created.push(pubA);
    // An empty content mount still has to preserve URLs already served from the app image.
    const replaced=structuredClone(b);replaced.assets[0]!.sha256='0'.repeat(64);
    await expect(validatePublicationMedia(db.sql,replaced)).rejects.toThrow('Content asset URL is immutable');
    await expect(validatePublicationMedia(db.sql,b)).resolves.toBeUndefined();
    expect((await currentPublication(db)).publicationId).toBe(pubA);
    const courseA=await getPublication(db,pubA);
    const app=createApp({database:db,course:courseA,config:{DATABASE_URL:url!,BETTER_AUTH_SECRET:'publication-test-secret-more-than-32-characters',APP_URL:origin,PORT:3000,HOST:'127.0.0.1'},publications:(id,old)=>id?getPublication(db,id):old?legacyPublication(db):currentPublication(db)});
    const invite=await createLink(db,'invite',email,null); expect(await consumeLink(db,'invite',invite.token,password,'Publication test')).toBe(true);
    const signed=await app.request(origin+'/api/auth/sign-in/email',{method:'POST',headers:{origin,'content-type':'application/json','x-forwarded-for':ip},body:JSON.stringify({email,password})});
    expect(signed.status).toBe(200);userId=(await signed.json()).user.id;
    const cookie=signed.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ');
    const request=(path:string,body?:unknown,pin?:string)=>app.request(origin+path,{method:body?'POST':'GET',headers:{origin,cookie,'x-forwarded-for':ip,...(pin?{'X-Content-Publication':pin}:{}),...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
    const lesson=courseA.lessons.find(item=>item.number===3)!.id;
    const state=async(id=lesson):Promise<LearningState>=>{const response=await request('/api/learning/'+id);expect(response.status).toBe(200);return response.json();};
    const answer=(current:LearningState,extra:Partial<LearningAdvance>):LearningAdvance=>({attemptId:crypto.randomUUID(),publicationId:current.publicationId,routeVersion:current.routeVersion,stateVersion:current.version,stepId:current.step!.id,action:'continue',...extra});
    const advance=async(id:string,input:LearningAdvance)=>{const response=await request('/api/learning/'+id+'/advance',input,input.publicationId);expect(response.status).toBe(200);return response.json();};
    const start=await state();expect(start.publicationId).toBe(pubA);
    const open=(await advance(lesson,answer(start,{action:'start-practice'}))).state as LearningState;
    expect(open.step?.kind).toBe('word-practice');
    await expect(publishContent(db,b,{mediaRoot:empty})).rejects.toThrow();expect((await currentPublication(db)).publicationId).toBe(pubA);
    const pubB=(await publishContent(db,b,{mediaRoot:root})).id;created.push(pubB);
    const frozen=await legacyPublication(db), firstRoute=frozen.learning!.find(item=>item.lessonId.endsWith('.01'))!;
    const preUpgrade={partIndex:0,pendingStepIds:learningParts(firstRoute)[0]!.map(step=>step.id),completedStepIds:[]};
    await db.sql`insert into learning_states(user_id,lesson_id,route_version,version,state) values(${userId},${firstRoute.lessonId},${firstRoute.version},2,${preUpgrade})`;
    const legacyOpen=await state(firstRoute.lessonId);expect(legacyOpen.publicationId).toBe(frozen.publicationId);
    const legacyPayload=answer(legacyOpen,{});delete legacyPayload.publicationId;
    const upgraded=await advance(firstRoute.lessonId,legacyPayload);expect(upgraded.state.publicationId).toBe(pubB);expect(await advance(firstRoute.lessonId,legacyPayload)).toEqual(upgraded);
    expect((await state()).publicationId).toBe(pubA);
    const bootstrap=await (await request('/api/bootstrap')).json();expect(bootstrap.course.publicationId).toBe(pubB);expect(bootstrap.learning.find((item:LearningState)=>item.lessonId===lesson).publicationId).toBe(pubA);
    const pinnedProgress:LearningState=bootstrap.learning.find((item:LearningState)=>item.lessonId===lesson);
    expect(pinnedProgress.partProgress?.map(part=>({partId:part.partId,totalSteps:part.totalSteps}))).toEqual(learningParts(courseA.learning!.find(route=>route.lessonId===lesson)!).map(steps=>({partId:steps[0]!.partId,totalSteps:steps.length})));
    expect(pinnedProgress.partProgress?.reduce((count,part)=>count+part.completedSteps,0)).toBe(pinnedProgress.completedSteps);
    expect((await (await request('/api/bootstrap',undefined,pubA)).json()).course.publicationId).toBe(pubA);
    if(open.step?.kind!=='word-practice')throw new Error('Expected word practice');
    const input=answer(open,{action:'choose',choiceWordId:open.step.wordId}), ack=await advance(lesson,input);
    expect(ack.reviewResult).toMatchObject({correct:true,publicationId:pubA});expect(ack.state.publicationId).toBe(pubB);
    expect(await advance(lesson,input)).toEqual(ack);
    const [schedule]=await db.sql`select version,due from review_states where user_id=${userId} and item_id=${open.step.wordId} and mode=${open.step.mode}`;
    expect(schedule.version).toBe(1);
    expect((await request('/api/learning/'+lesson+'/advance',{...input,publicationId:pubB},pubA)).status).toBe(409);
    expect((await request('/api/bootstrap',undefined,'f'.repeat(64))).status).toBe(409);

    // A completed old lesson reopens only newly added goals; the existing SRS row is unchanged.
    const family=courseA.learning!.find(route=>route.lessonId.endsWith('.04'))!, oldSteps=learningParts(family).flat();
    const completed={partIndex:learningParts(family).length,pendingStepIds:[],completedStepIds:oldSteps.map(step=>step.id)};
    await db.sql`insert into learning_states(user_id,lesson_id,publication_id,route_version,version,state) values(${userId},${family.lessonId},${pubA},${family.version},7,${completed})`;
    const expanded=await state(family.lessonId);expect(expanded.publicationId).toBe(pubB);expect(expanded.completed).toBe(false);expect(expanded.completedSteps).toBeGreaterThanOrEqual(oldSteps.length);expect(expanded.step?.kind).toBe('word-intro');
    expect(expanded.partProgress).toHaveLength(expanded.totalParts);
    expect(expanded.partProgress?.some(part=>part.completedSteps===part.totalSteps)).toBe(true);
    expect(expanded.partProgress?.some(part=>part.completedSteps<part.totalSteps)).toBe(true);
    await advance(family.lessonId,answer(expanded,{}));
    expect((await db.sql`select version,due from review_states where user_id=${userId} and item_id=${open.step.wordId} and mode=${open.step.mode}`)[0]).toEqual(schedule);

    // The new PDF quantities are graded counter steps with stable choices, not static labels.
    const courseB=await getPublication(db,pubB), route=courseB.learning!.find(item=>item.lessonId===family.lessonId)!, parts=learningParts(route), index=parts.findIndex(part=>part.some(step=>step.kind==='counter-practice'));
    const countStep=parts[index]!.find(step=>step.kind==='counter-practice')!;
    if(countStep.kind!=='counter-practice')throw new Error('Missing counter step');
    await db.sql`insert into review_states(user_id,item_id,mode,version,card,due) values(${userId},${countStep.wordId},'ja-ru',1,${{}},now()) on conflict do nothing`;
    const counterState={partIndex:index,pendingStepIds:parts[index]!.map(step=>step.id),completedStepIds:parts.slice(0,index).flat().map(step=>step.id)};
    await db.sql`update learning_states set publication_id=${pubB},route_version=${route.version},version=20,state=${counterState} where user_id=${userId} and lesson_id=${route.lessonId}`;
    const counter=await state(route.lessonId), reload=await state(route.lessonId);
    expect(counter.reviewItem?.mode).toBe('counter');
    if(counter.reviewItem?.mode!=='counter')throw new Error('Missing counter card');
    expect(reload.reviewItem?.id).toBe(counter.reviewItem.id);
    expect(reload.reviewItem?.mode==='counter'&&reload.reviewItem.counter.options).toEqual(counter.reviewItem.counter.options);
    const card=counter.reviewItem.counter; const wrong=card.options.find(option=>!card.acceptedKeys.includes(option.key))!;
    const failed=await advance(route.lessonId,answer(counter,{action:'choose',counterChoice:wrong.key}));expect(failed.reviewResult.correct).toBe(false);expect(failed.state.step.quantity).toBe(6);
    const next=failed.state as LearningState;if(next.reviewItem?.mode!=='counter')throw new Error('Missing next quantity');
    const good=await advance(route.lessonId,answer(next,{action:'choose',counterChoice:next.reviewItem.counter.acceptedKeys[0]}));expect(good.reviewResult.correct).toBe(true);expect(good.state.step.quantity).toBe(5);
    expect((await request('/api/learning/'+route.lessonId+'/advance',answer(good.state,{action:'choose',counterChoice:'foreign'}),pubB)).status).toBe(400);

    await expect(activatePublication(db,pubA,empty)).rejects.toThrow('Missing or unsafe');expect((await currentPublication(db)).publicationId).toBe(pubB);
    await activatePublication(db,pubA,root);expect((await (await request('/api/bootstrap')).json()).course.publicationId).toBe(pubA);
    await activatePublication(db,pubB,root);expect((await currentPublication(db)).publicationId).toBe(pubB);
  } finally {
    if(userId)await db.sql`delete from users where id=${userId}`;
    await db.sql`delete from access_links where email=${email}`;
    if(oldActive)await activatePublication(db,oldActive,root);
    for(const id of created)await db.sql`delete from content_publications where id=${id}`;
    await db.sql.close();rmSync(empty,{recursive:true,force:true});
  }
},20000);
