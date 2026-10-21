import { z } from 'zod';
import { defaultSoundSettings } from '../shared/sound';
export const emailSchema=z.string().trim().toLowerCase().pipe(z.email().max(254));
export const invitationDetailsSchema=z.object({token:z.string().min(20).max(200)}).strict();
export const settingsSchema = z.object({
 lessonStatuses:z.record(z.string(),z.enum(['closed','studying','completed'])).default({}),focusLessonIds:z.array(z.string()).max(200).default([]),focusCanDoIds:z.array(z.number().int().positive()).max(200).default([]),focusSkillIds:z.array(z.string()).max(200).default([]),enabledListIds:z.array(z.string()).max(100).default([]),freeLessonIds:z.array(z.string()).max(200).default([]),freeScopes:z.object({words:z.enum(['studied','selected','all']),particles:z.enum(['studied','selected','all']),constructions:z.enum(['studied','selected','all']),forms:z.enum(['studied','selected','all'])}).default({words:'studied',particles:'studied',constructions:'studied',forms:'studied'}),orthography:z.enum(['kana','furigana','kanji']),newWordsPerDay:z.number().int().min(0).max(100).default(5),newSkillsPerDay:z.number().int().min(0).max(50).default(2),animations:z.boolean(),sceneSoundEnabled:z.boolean().default(defaultSoundSettings.sceneSoundEnabled),musicVolume:z.number().min(0).max(1).default(defaultSoundSettings.musicVolume),ambienceVolume:z.number().min(0).max(1).default(defaultSoundSettings.ambienceVolume),sfxVolume:z.number().min(0).max(1).default(defaultSoundSettings.sfxVolume),speechVolume:z.number().min(0).max(1).default(defaultSoundSettings.speechVolume),
}).strict();
const base={attemptId:z.uuid(),reviewId:z.string().min(1).max(2000),version:z.number().int().nonnegative()};
export const submissionSchema=z.discriminatedUnion('mode',[
 z.object({...base,mode:z.enum(['ja-ru','ru-ja','listening']),rating:z.union([z.literal(1),z.literal(2),z.literal(3),z.literal(4)])}).strict(),
 z.object({...base,mode:z.literal('grammar'),tokenIds:z.array(z.string().max(300)).max(100),tokenForms:z.record(z.string(),z.string()).optional(),revealed:z.boolean(),rating:z.union([z.literal(1),z.literal(3)]).optional(),exploring:z.boolean().optional()}).strict(),
]);
export const targetEvaluationSchema=z.object({reviewId:base.reviewId,version:base.version,tokenIds:z.array(z.string().min(1).max(300)).max(100),tokenForms:z.record(z.string(),z.string().min(1).max(300)).optional(),revision:z.number().int().nonnegative(),exploring:z.boolean().optional()}).strict();
export const trainingContextSchema=z.object({lessonId:z.string().min(1).max(300).optional(),listId:z.string().min(1).max(300).optional()}).strict().refine(value=>!!value.lessonId!==!!value.listId,'Choose one training context.');
export const analysisSchema=z.object({exerciseId:z.string().min(1).max(300).optional(),lessonId:z.string().min(1).max(300).optional(),listId:z.string().min(1).max(300).optional(),text:z.string().trim().min(1).max(1000),revision:z.number().int().nonnegative(),wordIds:z.array(z.string().max(300)).max(100)}).strict().refine(value=>!value.lessonId||!value.listId,'Choose one training context.');
export const segmentSchema=z.object({surface:z.string().min(1).max(100),reading:z.string().min(1).max(100).optional()});
export const wordUpdateSchema=z.object({surface:z.string().trim().min(1).max(100).optional(),kana:z.string().trim().max(200).optional(),meaningRu:z.string().trim().min(1).max(500).optional(),segments:z.array(segmentSchema).max(100).optional(),pos:z.string().trim().max(100).optional()}).strict().refine(v=>Object.keys(v).length>0);
export const listSchema=z.object({name:z.string().trim().min(1).max(100),text:z.string().trim().min(1).max(50000)}).strict();
export const invitationSchema=z.object({token:z.string().min(20).max(200),name:z.string().trim().min(1).max(100),password:z.string().min(12).max(128)}).strict();
export const recoverySchema=z.object({token:z.string().min(20).max(200),password:z.string().min(12).max(128)}).strict();
export const adminLinkSchema=z.object({kind:z.enum(['invite','recovery']),email:emailSchema}).strict();
