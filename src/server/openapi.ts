import { OpenAPIHono, z } from '@hono/zod-openapi';
import { adminLinkSchema, analysisSchema, invitationDetailsSchema, invitationSchema, listSchema, recoverySchema, settingsSchema, submissionSchema, targetEvaluationSchema, trainingContextSchema, wordUpdateSchema } from './validation';
const segment=z.object({surface:z.string(),reading:z.string().optional()});
const source=z.object({part:z.enum(['katsudoo','rikai']),url:z.string(),label:z.string().optional(),page:z.number().optional(),row:z.number().optional(),entry:z.string().optional()});
const status=z.enum(['draft','source-checked','reviewed']);
const word=z.object({id:z.string(),lessonIds:z.array(z.string()),surface:z.string(),kana:z.string(),meaningRu:z.string(),segments:z.array(segment),kind:z.enum(['word','phrase']),pos:z.string(),reviewStatus:status,sourceRefs:z.array(source),audioUrl:z.string().optional(),audioText:z.string().optional()});
const form=word.omit({meaningRu:true,kind:true,pos:true,audioUrl:true,audioText:true}).extend({wordId:z.string()});
const skill=z.object({id:z.string(),lessonIds:z.array(z.string()),canDoIds:z.array(z.number()),title:z.string(),explanationRu:z.string(),reviewStatus:status,sourceRefs:z.array(source)});
const exercise=z.object({id:z.string(),lessonId:z.string(),skillId:z.string(),promptRu:z.string(),translationRu:z.string().optional(),contextRu:z.string().optional(),tokens:z.array(z.object({id:z.string(),formId:z.string()})),acceptedOrders:z.array(z.array(z.string())),sentenceEnd:z.string(),reviewStatus:status});
const contentStatus=z.enum(['missing','draft','source-checked','reviewed']);
const course=z.object({id:z.string(),version:z.string(),title:z.string(),lessons:z.array(z.object({id:z.string(),number:z.number(),title:z.string(),topic:z.string(),canDoIds:z.array(z.number()),sourceRefs:z.array(source),readiness:z.object({vocabulary:contentStatus,grammar:z.union([contentStatus,z.literal('not-applicable')]),exercises:z.union([contentStatus,z.literal('not-applicable')]),audio:contentStatus})})),words:z.array(word),forms:z.array(form),skills:z.array(skill),exercises:z.array(exercise)});
const reviewBase=z.object({id:z.string(),targetId:z.string(),version:z.number().int(),due:z.string(),isNew:z.boolean()});
const reviewItem=z.union([reviewBase.extend({mode:z.enum(['ja-ru','ru-ja','listening']),word}),reviewBase.extend({mode:z.literal('grammar'),exercise,skill})]);
const reviewResult=z.object({attemptId:z.string(),status:z.enum(['scheduled','additional-practice']),version:z.number().int(),nextDue:z.string(),correct:z.boolean().optional(),feedback:z.string().optional()});
const list=z.object({id:z.string(),name:z.string(),words:z.array(word)});
const counts=z.object({due:z.number(),learned:z.number(),reviewedToday:z.number()});
const progress=z.object({introducedWordIds:z.array(z.string()),introducedSkillIds:z.array(z.string()),completedLessons:z.number(),totalLessons:z.number(),wordsIntroducedToday:z.number(),skillsIntroducedToday:z.number(),byMode:z.object({'ja-ru':counts,'ru-ja':counts,listening:counts,grammar:counts})});
const analysis=z.union([z.object({status:z.literal('ok'),revision:z.number(),text:z.string(),translationRu:z.string(),grammar:z.enum(['correct','incorrect','uncertain','incomplete']),naturalness:z.enum(['natural','awkward','uncertain']),explanationRu:z.string(),materialViolations:z.array(z.string()),warnings:z.array(z.string())}),z.object({status:z.literal('unavailable'),revision:z.number(),text:z.string(),reason:z.string()})]);
const apiError=z.object({error:z.object({code:z.string(),message:z.string()})});
export function registerContract(app:OpenAPIHono<any>,secure:boolean){
 app.openAPIRegistry.registerComponent('securitySchemes','sessionCookie',{type:'apiKey',in:'cookie',name:secure?'__Secure-better-auth.session_token':'better-auth.session_token'});
 const routes:[string,'get'|'post'|'put'|'patch',z.ZodType,z.ZodType?][]=[
 ['/api/course','get',course],['/api/settings','get',settingsSchema],['/api/settings','put',settingsSchema,settingsSchema],['/api/progress','get',progress],['/api/reviews','get',z.object({items:z.array(reviewItem),remainingDue:z.number(),remainingNew:z.number()})],['/api/training','get',z.object({items:z.array(reviewItem),remainingDue:z.number(),remainingNew:z.number()})],['/api/reviews/evaluate','post',z.object({revision:z.number(),outcome:z.enum(['correct','incorrect','incomplete','exploration']),feedback:z.string()}),targetEvaluationSchema],['/api/reviews','post',reviewResult,submissionSchema],['/api/lists','get',z.object({lists:z.array(list)})],['/api/lists','post',list,listSchema],['/api/lists/{listId}/words/{wordId}','patch',word,wordUpdateSchema],['/api/analyze','post',analysis,analysisSchema],['/api/invitations/details','post',z.object({email:z.email(),expiresAt:z.string()}),invitationDetailsSchema],['/api/invitations/accept','post',z.object({ok:z.boolean(),email:z.email()}),invitationSchema],['/api/recovery/complete','post',z.object({ok:z.boolean()}),recoverySchema],['/api/admin/links','post',z.object({url:z.string(),expiresAt:z.string()}),adminLinkSchema],['/api/me','get',z.object({id:z.string(),name:z.string(),email:z.string(),isAdmin:z.boolean()})],['/api/admin/users','get',z.object({users:z.array(z.object({id:z.string(),name:z.string(),email:z.string()}))})],
 ];
 for(const [path,method,result,input]of routes){
  const responses:Record<number,any>={200:{description:'Success',content:{'application/json':{schema:result}}}};
  for(const code of [400,401,403,404,409,413,415,500])responses[code]={description:'API error',content:{'application/json':{schema:apiError}}};
  const request:any=input?{body:{required:true,content:{'application/json':{schema:input}}}}:{};
  if(path.includes('{listId}'))request.params=z.object({listId:z.string(),wordId:z.string()});
  if(path==='/api/reviews'&&method==='get')request.query=z.object({mode:z.enum(['ja-ru','ru-ja','listening','grammar','mixed']).optional()});
  if(path==='/api/training')request.query=trainingContextSchema;
  app.openAPIRegistry.registerPath({path,method,security:path.startsWith('/api/invitations')||path.startsWith('/api/recovery')?[]:[{sessionCookie:[]}],request,responses});
 }
 app.doc('/api/openapi.json',{openapi:'3.1.0',info:{title:'Japanese learning API',version:'1.0.0'}});
}
