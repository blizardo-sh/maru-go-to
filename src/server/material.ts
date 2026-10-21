import type { Course, LearnerSettings, Word } from '../shared/types';
import type { Database } from './db';
import { defaultSoundSettings } from '../shared/sound';
import { settingsSchema } from './validation';
export const defaultSettings: LearnerSettings={lessonStatuses:{},focusLessonIds:[],focusCanDoIds:[],focusSkillIds:[],enabledListIds:[],freeLessonIds:[],freeScopes:{words:'studied',particles:'studied',constructions:'studied',forms:'studied'},orthography:'furigana',newWordsPerDay:5,newSkillsPerDay:2,animations:true,...defaultSoundSettings};
export async function settingsFor(database:Database,userId:string):Promise<LearnerSettings>{
 const [row]=await database.sql`select settings from preferences where user_id=${userId}`;
 return row?settingsSchema.parse(row.settings):structuredClone(defaultSettings);
}
export async function allWords(database:Pick<Database,'sql'>,userId:string,course:Course):Promise<Word[]>{
 const rows=await database.sql`select p.data from personal_words p join word_lists l on l.id=p.list_id where p.user_id=${userId} and l.user_id=${userId} order by p.created_at,p.id`;
 return [...course.words,...rows.map((r:any)=>r.data as Word)];
}
export interface MaterialAccess { wordIds:Set<string>; skillIds:Set<string>; exerciseIds?:Set<string> }
export async function introducedMaterial(database:Database,userId:string):Promise<MaterialAccess>{
 const rows=await database.sql`select item_id,mode from review_states where user_id=${userId}`;
 return {wordIds:new Set(rows.filter((row:any)=>row.mode!=='grammar').map((row:any)=>row.item_id as string)),skillIds:new Set(rows.filter((row:any)=>row.mode==='grammar').map((row:any)=>row.item_id as string))};
}
export function validSegments(word:Pick<Word,'surface'|'kana'|'segments'>){
 return !!word.kana&&word.segments.map(s=>s.surface).join('')===word.surface&&word.segments.map(s=>s.reading??s.surface).join('')===word.kana;
}
export const normalizeSentence=(s:string)=>s.replace(/[\s。！？!?．.]+/gu,'');
export function sentenceFor(course:Course,exercise:Course['exercises'][number],order:string[]){
 const forms=new Map(course.forms.map(f=>[f.id,f]));const tokens=new Map(exercise.tokens.map(t=>[t.id,t]));
 return order.map(id=>forms.get(tokens.get(id)?.formId??'')?.surface??'').join('')+exercise.sentenceEnd;
}
