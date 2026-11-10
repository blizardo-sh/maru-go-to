import { expect, test } from 'bun:test';
import { booksFor, canDoKey, lessonBookId, marugotoBooks, starterBookId, unitCountLabel } from '../src/shared/books';
import { readBookNavigation, saveBookNavigation } from '../src/client/book-navigation';
import { course } from '../src/shared/course';

test('old course defaults to A1 and local numbers retain a book identity',()=>{
 expect(booksFor(course).map(b=>b.id)).toEqual([starterBookId]);
 expect(lessonBookId(course.lessons[0]!)).toBe(starterBookId);
 expect(new Set(marugotoBooks.map(book=>canDoKey(book.id,1))).size).toBe(4);
 expect(unitCountLabel(marugotoBooks[3]!)).toBe('9 тем');
});
test('book places are owner scoped; stale lessons and malformed navigation are ignored',()=>{
 const storage=new Map<string,string>(),original=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
 Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:(key:string)=>storage.get(key)??null,setItem:(key:string,value:string)=>storage.set(key,value)}});
 try {
  const library={...course,books:marugotoBooks};
  saveBookNavigation('one',{bookId:marugotoBooks[1]!.id,places:{[starterBookId]:{page:2,lessonId:course.lessons[0]!.id},[marugotoBooks[1]!.id]:{page:1,lessonId:course.lessons[0]!.id}}});
  expect(readBookNavigation('two',library)).toEqual({bookId:starterBookId,places:{}});
  expect(readBookNavigation('one',library).places[starterBookId]).toEqual({page:2,lessonId:course.lessons[0]!.id});
  expect(readBookNavigation('one',library).places[marugotoBooks[1]!.id]).toEqual({page:1});
  storage.set('japanese-books-v1:one','broken');expect(readBookNavigation('one',library).bookId).toBe(starterBookId);
 } finally {if(original)Object.defineProperty(globalThis,'localStorage',original);else Reflect.deleteProperty(globalThis,'localStorage');}
});

import { loadCourse } from '../src/server/course';
import { validateCourse } from '../src/shared/course';
import { validateLearning } from '../src/shared/learning';
import { contentId, packContent, publicationCourse, validateContentBundle } from '../src/server/publications';
import { readFileSync, readdirSync } from 'node:fs';

test('four complete book structures have separate Can-do and unit numbering',()=>{
 const library=loadCourse();
 expect(library.lessons).toHaveLength(63);
 expect(library.books).toHaveLength(4);
 for(const book of library.books!){
  const units=library.lessons.filter(lesson=>lessonBookId(lesson)===book.id);
  expect(units).toHaveLength(book.unitCount);
  expect(units.flatMap(l=>l.canDoIds)).toHaveLength(book.canDoCount);
 }
 const reject=(change:(value:typeof library)=>void)=>{const copy=structuredClone(library);change(copy);expect(()=>validateCourse(copy)).toThrow();};
 reject(value=>value.lessons.pop());
 reject(value=>{value.lessons[18]!.number=2;});
 reject(value=>{value.lessons[18]!.bookId=starterBookId;});
 reject(value=>{value.lessons[18]!.canDoIds=[1,1];});
 const unfinished=structuredClone(library);unfinished.learning=unfinished.learning!.filter(route=>route.lessonId!==unfinished.lessons[18]!.id);
 expect(()=>validateLearning(unfinished,unfinished.learning!,true)).toThrow('route availability');
});
test('old immutable publication hashes are verified on their original bytes of content',()=>{
 for(const name of readdirSync(new URL('../materials/publications',import.meta.url))){
  if(!name.endsWith('.json'))continue;
  const bundle=JSON.parse(readFileSync(new URL('../materials/publications/'+name,import.meta.url),'utf8'));
  const before=JSON.stringify(bundle);validateContentBundle(bundle);
  expect(contentId(bundle)+'.json').toBe(name);expect(JSON.stringify(bundle)).toBe(before);
 }
 const packed=packContent(loadCourse());expect(packed.formatVersion).toBe(3);
 const v2={formatVersion:2 as const,course:publicationCourse(packed),assets:packed.assets};validateContentBundle(v2);
 expect(()=>validateContentBundle({...v2,formatVersion:1})).toThrow('format 2');
});
