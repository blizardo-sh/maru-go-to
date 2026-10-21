import { existsSync, readFileSync } from 'node:fs';
import type { Course } from '../shared/types';
import { validateCourse } from '../shared/course';
export function loadCourse():Course {
 const course=JSON.parse(readFileSync(new URL('../../materials/course.json',import.meta.url),'utf8')) as Course;
 validateCourse(course);
 const audioPath=new URL('../../public/audio/manifest.json',import.meta.url);
 if(existsSync(audioPath)){
  const manifest=JSON.parse(readFileSync(audioPath,'utf8')) as Record<string,string>;
  for(const word of course.words){const path=manifest[word.id];if(path&&/^\/audio\/[a-z0-9.-]+$/i.test(path)&&existsSync(new URL(`../../public${path}`,import.meta.url)))word.audioUrl=path;}
 }
 return course;
}
