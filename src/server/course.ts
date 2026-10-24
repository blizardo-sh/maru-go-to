import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { defaultCatalog } from '../shared/catalog';
import type { Course } from '../shared/types';
import { validateLearning, type GuidedLesson } from '../shared/learning';
import { validateCourse } from '../shared/course';
import type { ThematicMaterial } from '../shared/training';
export function withLearningMaterial(course:Course,lessons:GuidedLesson[]):Course {
 const result=structuredClone(course);
 const authored = new Map<string,unknown>();
 for(const lesson of lessons)for(const kind of ['words','forms','skills','exercises'] as const){
  for(const entry of lesson.authored?.[kind]??[]){
   const key=kind+':'+entry.id;
   if(authored.has(key)&&!isDeepStrictEqual(authored.get(key),entry))throw new Error(`Conflicting authored records: ${entry.id}`);
   authored.set(key,entry);
   if(kind==='exercises'?(entry as Course['exercises'][number]).lessonId!==lesson.lessonId:!(entry as Course['words'][number]).lessonIds.includes(lesson.lessonId))throw new Error(`Invalid learning authored scope: ${entry.id}`);
   const entries=result[kind] as {id:string;lessonIds?:string[]}[];const index=entries.findIndex(item=>item.id===entry.id);
   if(index>=0&&entries[index]!.lessonIds?.some(id=>!(entry as Course['words'][number]).lessonIds.includes(id)))throw new Error(`Learning material removes existing lesson membership: ${entry.id}`);
   if(index<0)entries.push(entry);else entries[index]=entry;
  }
 }
 result.learning=lessons;
 validateCourse(result);
 return result;
}
export function loadCourse():Course {
 let course=JSON.parse(readFileSync(new URL('../../materials/course.json',import.meta.url),'utf8')) as Course;
 validateCourse(course);
 const learningDirectory=new URL('../../materials/learning/',import.meta.url);
 if(existsSync(learningDirectory)){
  const lessons=readdirSync(learningDirectory).filter(name=>/^lesson-\d{2}\.json$/.test(name)).sort().map(name=>JSON.parse(readFileSync(new URL(name,learningDirectory),'utf8')) as GuidedLesson);
  course=withLearningMaterial(course,lessons);
 }
 course.catalog=structuredClone(defaultCatalog);
 const thematicPath=new URL('../../materials/thematic-training.json',import.meta.url);
 if(existsSync(thematicPath)){
  const thematic=JSON.parse(readFileSync(thematicPath,'utf8')) as ThematicMaterial;
  for(const word of thematic.words){if(course.words.some(item=>item.id===word.id))throw new Error(`Duplicate thematic word: ${word.id}`);course.words.push(word);}
  course.forms.push(...thematic.forms);
  const {words:thematicWords,forms:thematicForms,...metadata}=thematic;
  course.catalog.thematic=metadata;course.catalog.learningPolicy='master-before-repeat';
  for(const route of course.learning??[]) { route.version += '-staged'; for(const goal of route.goals)for(const part of goal.parts)if(part.counterPractice)part.counterPractice.formats=['reading-choice','listening-image','recall']; }
  validateCourse(course);
 }
 const audioPath=new URL('../../public/audio/manifest.json',import.meta.url);
 if(existsSync(audioPath)){
  const manifest=JSON.parse(readFileSync(audioPath,'utf8')) as Record<string,string>;
  for(const word of course.words){const path=manifest[word.id];if(path&&/^\/audio\/[a-z0-9.-]+$/i.test(path)&&existsSync(new URL(`../../public${path}`,import.meta.url)))word.audioUrl=path;}
 }
 if(course.learning){
  validateLearning(course,course.learning,true);
  for(const lesson of course.learning)for(const goal of lesson.goals)for(const part of goal.parts){
   const paths=[...part.words.flatMap(word=>[course.words.find(entry=>entry.id===word.wordId)!.audioUrl!,word.example.audioUrl]),...(part.construction?[part.construction.example.audioUrl]:[])];
   for(const path of paths)if(!existsSync(new URL(`../../public${path}`,import.meta.url)))throw new Error(`Missing learning audio: ${path}`);
  }
 }
 return course;
}
