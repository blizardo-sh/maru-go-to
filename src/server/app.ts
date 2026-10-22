import { advanceLearning, learningOverview, learningState } from './learning';
import { learningAdvanceSchema } from './validation';
import { OpenAPIHono } from '@hono/zod-openapi';
import { registerContract } from './openapi';
import { bodyLimit } from 'hono/body-limit';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import pino from 'pino';
import type { Config } from './config';
import type { Database } from './db';
import type { Course, ReviewMode } from '../shared/types';
import { createAuth, consumeLink, createLink, invitationDetails, consumeRegistrationLink, createRegistrationLink, registrationLinksFor, revokeRegistrationLink } from './auth';
import { allWords, introducedMaterial, settingsFor } from './material';
import { introducedExerciseAvailable, evaluateReview, progressFor, ReviewError, reviewQueue, submitReview, trainingQueue } from './reviews';
import { addList, listsFor, updateWord } from './words';
import { adminLinkSchema, analysisSchema, emailSchema, invitationDetailsSchema, invitationSchema, listSchema, recoverySchema, registrationLinkIdSchema, registrationLinkSchema, settingsSchema, submissionSchema, targetEvaluationSchema, trainingContextSchema, wordUpdateSchema } from './validation';
import { createAnalyzer } from './analysis';
import { withPersonalPractice } from './personal-practice';
type Actor={id:string;name:string;email:string;isAdmin:boolean};
type AppEnv={Variables:{actor:Actor;requestId:string}};
export function createApp({database,config,course}:{database:Database;config:Config;course:Course}){
 const auth=createAuth(database,config);const analyze=createAnalyzer(config);const log=pino({level:process.env.LOG_LEVEL??'info',redact:['password','token','secret','authorization','cookie']});
 const app=new OpenAPIHono<AppEnv>();const fail=(c:any,code:string,message:string,status=400)=>c.json({error:{code,message}},status);
 app.use('*',async(c,next)=>{const started=performance.now();c.set('requestId',crypto.randomUUID());c.header('x-request-id',c.get('requestId'));c.header('cache-control','no-store');c.header('x-content-type-options','nosniff');c.header('referrer-policy','no-referrer');await next();log.info({requestId:c.get('requestId'),method:c.req.method,path:c.req.path,status:c.res.status,durationMs:Math.round(performance.now()-started)},'request');});
 app.use('/api/*',bodyLimit({maxSize:65536,onError:c=>fail(c,'TOO_LARGE','Запрос слишком большой.',413)}));
 app.use('/api/*',async(c,next)=>{if(!['GET','HEAD','OPTIONS'].includes(c.req.method)){
  if(c.req.header('origin')!==new URL(config.APP_URL).origin)return fail(c,'ORIGIN_REJECTED','Недопустимый источник запроса.',403);
  if(!c.req.header('content-type')?.startsWith('application/json'))return fail(c,'JSON_REQUIRED','Ожидается JSON.',415);
 }await next();});
 app.onError((error,c)=>{if(error instanceof ReviewError)return fail(c,error.code,error.message,error.status);if(error instanceof z.ZodError)return fail(c,'VALIDATION','Проверьте данные запроса.',400);if(error instanceof SyntaxError)return fail(c,'INVALID_JSON','Некорректный JSON.',400);if(error instanceof HTTPException)return fail(c,'HTTP_ERROR','Запрос отклонён.',error.status);log.error({requestId:c.get('requestId'),errorName:error.name},'request failed');return fail(c,'INTERNAL','Не удалось выполнить действие. Попробуйте снова.',500);});
 app.get('/health',c=>c.json({ok:true}));
 app.get('/ready',async c=>{await database.sql`select 1 from review_states limit 1`;return c.json({ok:true,courseVersion:course.version});});
 app.on(['GET','POST'],'/api/auth/*',async c=>{const path=c.req.path.slice('/api/auth'.length);if(!['/get-session','/sign-in/email','/sign-out'].includes(path))return fail(c,'INVITATION_REQUIRED','Регистрация доступна по приглашению.',403);if(path==='/sign-in/email'&&c.req.method==='POST'){const body=await c.req.json();const email=emailSchema.parse(body?.email);const headers=new Headers(c.req.raw.headers);headers.delete('content-length');return auth.handler(new Request(c.req.raw.url,{method:'POST',headers,body:JSON.stringify({...body,email}),signal:c.req.raw.signal}));}return auth.handler(c.req.raw);});
 app.post('/api/invitations/details',async c=>{const body=invitationDetailsSchema.parse(await c.req.json());const details=await invitationDetails(database,body.token);return details?c.json(details):fail(c,'INVALID_LINK','Ссылка недействительна, использована или истекла.',400);});
 app.post('/api/invitations/accept',async c=>{
  const body=invitationSchema.parse(await c.req.json());const details=await invitationDetails(database,body.token);
  if(!details)return fail(c,'INVALID_LINK','Ссылка недействительна, использована, отозвана или истекла.',400);
  if(details.kind==='invite'){
   if(body.email!==undefined&&body.email!==details.email)return fail(c,'VALIDATION','Email должен совпадать с персональным приглашением.',400);
   const ok=await consumeLink(database,'invite',body.token,body.password,body.name);
   return ok?c.json({ok:true,email:details.email,authenticated:false}):fail(c,'INVALID_LINK','Ссылка недействительна, использована или истекла.',400);
  }
  const email=emailSchema.parse(body.email);
  const result=await consumeRegistrationLink(database,{...body,email});
  if(!result.ok)return result.reason==='EMAIL_EXISTS'?fail(c,'EMAIL_EXISTS','Учётная запись с этим email уже существует. Войдите с вашим паролем или попросите администратора восстановить доступ.',409):fail(c,'INVALID_LINK','Ссылка недействительна, отозвана, исчерпана или истекла.',400);
  // The account is committed. A session failure must not invite another registration attempt.
  try{
   const signedIn=await auth.api.signInEmail({body:{email:result.email,password:body.password},headers:c.req.raw.headers,asResponse:true});
   if(signedIn.ok){for(const cookie of signedIn.headers.getSetCookie())c.header('set-cookie',cookie,{append:true});return c.json({ok:true,email:result.email,authenticated:true});}
  }catch{log.warn({requestId:c.get('requestId')},'Account created; automatic sign-in unavailable');}
  return c.json({ok:true,email:result.email,authenticated:false});
 });
 app.post('/api/recovery/complete',async c=>{const body=recoverySchema.parse(await c.req.json());const ok=await consumeLink(database,'recovery',body.token,body.password);return ok?c.json({ok:true}):fail(c,'INVALID_LINK','Ссылка недействительна, использована или истекла.',400);});
 app.use('/api/*',async(c,next)=>{const session=await auth.api.getSession({headers:c.req.raw.headers});if(!session)return fail(c,'UNAUTHENTICATED','Войдите в приложение.',401);const [actor]=await database.sql`select id,name,email,is_admin from users where id=${session.user.id}`;if(!actor)return fail(c,'UNAUTHENTICATED','Войдите в приложение.',401);const expectedLearner=c.req.header('X-Learning-Learner-Id');if(expectedLearner!==undefined&&expectedLearner!==actor.id)return fail(c,'OWNER_CHANGED','Учётная запись изменилась в другой вкладке. Обновите страницу и войдите в нужную учётную запись.',409);c.set('actor',{id:actor.id,name:actor.name,email:actor.email,isAdmin:actor.is_admin});await next();});
 const routes=app
 .get('/api/me',c=>c.json(c.get('actor')))
 .get('/api/course',async c=>{const words=await allWords(database,c.get('actor').id,course);return c.json(withPersonalPractice(course,words));})
 .get('/api/settings',async c=>c.json(await settingsFor(database,c.get('actor').id)))
 .put('/api/settings',async c=>{const body=settingsSchema.parse(await c.req.json());const listRows=await database.sql`select id from word_lists where user_id=${c.get('actor').id}`;if(body.enabledListIds.some(id=>!listRows.some((r:any)=>r.id===id)))return fail(c,'UNKNOWN_LIST','Личный список недоступен.',403);await database.sql`insert into preferences(user_id,settings) values(${c.get('actor').id},${body}) on conflict(user_id) do update set settings=excluded.settings,updated_at=now()`;return c.json(body);})
 .get('/api/progress',async c=>c.json(await progressFor(database,c.get('actor').id,course)))
 .get('/api/reviews',async c=>{const mode=z.enum(['ja-ru','ru-ja','listening','grammar','counter','mixed']).parse(c.req.query('mode')??'ja-ru') as ReviewMode|'mixed';return c.json(await reviewQueue(database,c.get('actor').id,course,mode));})
 .get('/api/learning',async c=>c.json(await learningOverview(database,c.get('actor').id,course)))
 .get('/api/learning/:lessonId',async c=>c.json(await learningState(database,c.get('actor').id,course,c.req.param('lessonId'))))
 .post('/api/learning/:lessonId/advance',async c=>c.json(await advanceLearning(database,c.get('actor').id,course,c.req.param('lessonId'),learningAdvanceSchema.parse(await c.req.json()))))
 .get('/api/training',async c=>c.json(await trainingQueue(database,c.get('actor').id,course,trainingContextSchema.parse(c.req.query()))))
 .post('/api/reviews/evaluate',async c=>c.json(await evaluateReview(database,c.get('actor').id,course,targetEvaluationSchema.parse(await c.req.json()))))
 .post('/api/reviews',async c=>c.json(await submitReview(database,c.get('actor').id,course,submissionSchema.parse(await c.req.json()))))
 .get('/api/lists',async c=>c.json({lists:await listsFor(database,c.get('actor').id)}))
 .post('/api/lists',async c=>{const body=listSchema.parse(await c.req.json());try{return c.json(await addList(database,c.get('actor').id,body.name,body.text,course));}catch(error){if(error instanceof Error&&error.message.startsWith('Используйте')||error instanceof Error&&error.message.startsWith('Не больше'))return fail(c,'INVALID_LIST',(error as Error).message);throw error;}})
 .patch('/api/lists/:listId/words/:wordId',async c=>{const body=wordUpdateSchema.parse(await c.req.json());try{const word=await updateWord(database,c.get('actor').id,c.req.param('listId'),c.req.param('wordId'),body);return word?c.json(word):fail(c,'NOT_FOUND','Слово не найдено.',404);}catch(error){if(error instanceof Error&&error.message.startsWith('Подтвердите'))return fail(c,'INVALID_READING',error.message);throw error;}})
 .post('/api/analyze',async c=>{const input=analysisSchema.parse(await c.req.json());const userId=c.get('actor').id;const words=await allWords(database,userId,course);const extended=withPersonalPractice(course,words);const access=await introducedMaterial(database,userId);
  if(input.lessonId){if(!course.lessons.some(lesson=>lesson.id===input.lessonId))return fail(c,'NOT_FOUND','Урок не найден.',404);for(const word of words)if(word.lessonIds.includes(input.lessonId))access.wordIds.add(word.id);for(const skill of course.skills)if(skill.lessonIds.includes(input.lessonId))access.skillIds.add(skill.id);}
  if(input.listId){const [list]=await database.sql`select id from word_lists where id=${input.listId} and user_id=${userId}`;if(!list)return fail(c,'NOT_FOUND','Личный список не найден.',404);const rows=await database.sql`select id from personal_words where list_id=${input.listId} and user_id=${userId}`;for(const row of rows)access.wordIds.add(row.id);for(const exercise of extended.exercises)if(exercise.tokens.some(token=>extended.forms.some(form=>form.id===token.formId&&rows.some((row:any)=>row.id===form.wordId))))access.skillIds.add(exercise.skillId);}
  if(input.exerciseId){const exercise=extended.exercises.find(item=>item.id===input.exerciseId);if(!exercise)return fail(c,'NOT_FOUND','Упражнение не найдено.',404);let allowed=false;
   if(input.lessonId)allowed=exercise.lessonId===input.lessonId&&exercise.tokens.every(token=>{const form=extended.forms.find(item=>item.id===token.formId);return !!form&&(course.words.some(word=>word.id===form.wordId)||access.wordIds.has(form.wordId));});
   else if(input.listId)allowed=exercise.tokens.some(token=>{const form=extended.forms.find(item=>item.id===token.formId);return !!form&&!course.words.some(word=>word.id===form.wordId)&&access.wordIds.has(form.wordId);});
   else allowed=await introducedExerciseAvailable(database,userId,course,exercise.id);
   if(allowed)access.exerciseIds=new Set([exercise.id]);
  }
  return c.json(await analyze(userId,extended,words,access,input,c.req.raw.signal));})
 .use('/api/admin/*',async(c,next)=>{if(!c.get('actor').isAdmin)return fail(c,'FORBIDDEN','Требуются права администратора.',403);await next();})
 .get('/api/admin/users',async c=>{const users=await database.sql`select id,name,email from users order by created_at`;return c.json({users:Array.from(users)});})
 .post('/api/admin/links',async c=>{const body=adminLinkSchema.parse(await c.req.json());if(body.kind==='recovery'){const [user]=await database.sql`select id from users where email=${body.email}`;if(!user)return fail(c,'NOT_FOUND','Учётная запись не найдена.',404);}const result=await createLink(database,body.kind,body.email,c.get('actor').id);return c.json({url:`${config.APP_URL}/${body.kind==='invite'?'invite':'recover'}#token=${result.token}`,expiresAt:result.expiresAt});})
 .get('/api/admin/registration-links',async c=>c.json({links:await registrationLinksFor(database)}))
 .post('/api/admin/registration-links',async c=>{const body=registrationLinkSchema.parse(await c.req.json());const result=await createRegistrationLink(database,body,c.get('actor').id);return c.json({url:`${config.APP_URL}/invite#token=${result.token}`,link:result.link});})
 .post('/api/admin/registration-links/:linkId/revoke',async c=>{z.object({}).strict().parse(await c.req.json());const id=registrationLinkIdSchema.parse(c.req.param('linkId'));const link=await revokeRegistrationLink(database,id);return link?c.json({link}):fail(c,'NOT_FOUND','Регистрационная ссылка не найдена.',404);});
 registerContract(app,new URL(config.APP_URL).protocol==='https:');
 app.notFound(c=>fail(c,'NOT_FOUND','Маршрут не найден.',404));
 return routes;
}
export type AppType=ReturnType<typeof createApp>;
