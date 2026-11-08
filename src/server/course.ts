import { wordTarget } from '../shared/meanings';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { defaultCatalog } from '../shared/catalog';
import type { Course } from '../shared/types';
import { validateLearning, type GuidedLesson } from '../shared/learning';
import { validateCourse } from '../shared/course';
import type { ThematicMaterial } from '../shared/training';
import { marugotoBooks } from '../shared/books';
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
export function loadCourse(options: { includeBooks?: boolean; checkMedia?: boolean } = {}):Course {
 let course=JSON.parse(readFileSync(new URL('../../materials/course.json',import.meta.url),'utf8')) as Course;
 validateCourse(course);
 if (options.includeBooks !== false) {
  const structurePath = new URL('../../materials/books/structure.json', import.meta.url);
  if (existsSync(structurePath)) {
   const structure = JSON.parse(readFileSync(structurePath,'utf8')) as Pick<Course,'books'|'lessons'>;
   course.books = [structuredClone(marugotoBooks[0]!), ...structure.books!];
   course.lessons.push(...structure.lessons);
  }
 }
 const learningDirectory=new URL('../../materials/learning/',import.meta.url);
 if(existsSync(learningDirectory)){
  const lessons=readdirSync(learningDirectory).filter(name=>/^lesson-\d{2}\.json$/.test(name)).sort().map(name=>JSON.parse(readFileSync(new URL(name,learningDirectory),'utf8')) as GuidedLesson);
  course=withLearningMaterial(course,lessons);
  if(options.includeBooks!==false) for(const file of ['vocabulary','curriculum']){
   const path=new URL(`../../materials/books/${file}.json`,import.meta.url);
   if(!existsSync(path))continue;
   const material=JSON.parse(readFileSync(path,'utf8')) as Partial<Course>;
   for(const kind of ['words','forms','skills','exercises','meanings'] as const){
    if(!material[kind])continue;
    const values=new Map((course[kind]??[]).map(value=>[value.id,value]));
    for(const value of material[kind]!) {const previous=values.get(value.id);if(previous&&'lessonIds' in previous&&previous.lessonIds.some(id=>!('lessonIds' in value)||!value.lessonIds.includes(id)))throw new Error(`Book material removes membership: ${value.id}`);values.set(value.id,value as any);}
    (course as any)[kind]=[...values.values()];
   }
  }
  if (options.includeBooks !== false) for (const book of course.books?.slice(1) ?? []) {
   const directory = new URL(`../../materials/books/${book.id}/learning/`,import.meta.url);
   if (existsSync(directory)) lessons.push(...readdirSync(directory).filter(name=>/^(lesson|topic)-\d{2}\.json$/.test(name)).sort().map(name=>JSON.parse(readFileSync(new URL(name,directory),'utf8')) as GuidedLesson));
  }
  course.learning=lessons;
  validateCourse(course);
 }
 course.catalog=structuredClone(defaultCatalog);
 if(options.includeBooks!==false){const path=new URL('../../materials/books/quiz.json',import.meta.url);if(existsSync(path))Object.assign(course.catalog.quiz.choices,JSON.parse(readFileSync(path,'utf8')));}
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
   const paths=[...(part.tasks??[]).flatMap(task=>task.kind==='production'?[task.model.audioUrl]:task.passage.map(line=>line.audioUrl)),...part.words.flatMap(word=>[wordTarget(course,word.wordId)!.audioUrl!,word.example.audioUrl]),...(part.construction?[part.construction.example.audioUrl]:[])];
   for(const path of options.checkMedia===false?[]:paths)if(!existsSync(new URL(`../../public${path}`,import.meta.url)))throw new Error(`Missing learning audio: ${path}`);
  }
 }
 return course;
}
