import { expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { loadCourse } from '../src/server/course';
import { evaluateTarget } from '../src/server/reviews';
import { learningConstructions, learningParts, reconcileLearningRoute } from '../src/shared/learning';
import { fragmentAudio } from '../src/client/fragment-audio';
import { sourceTitle } from '../src/shared/books';
const course=loadCourse();

test('all eighteen variations have distinct prompts, matching audio and authoritative accepted answers',()=>{
 let count=0;
 for(const route of course.learning!)for(const goal of route.goals)for(const part of goal.parts){
  if(!part.constructionVariants?.length)continue;
  const constructions=learningConstructions(part);
  expect(new Set(constructions.map(c=>c.example.surface)).size).toBe(constructions.length);
  expect(new Set(constructions.map(c=>c.example.meaningRu)).size).toBe(constructions.length);
  for(const variant of part.constructionVariants){
   count++;const exercise=course.exercises.find(e=>e.id===variant.exerciseId)!;
   expect(exercise.skillId).toBe(course.exercises.find(e=>e.id===part.construction!.exerciseId)!.skillId);
   expect(existsSync('public'+variant.example.audioUrl)).toBe(true);
   for(const order of exercise.acceptedOrders)expect(evaluateTarget(course,exercise.id,{tokenIds:order,revision:0}).outcome).toBe('correct');
  }
 }
 expect(count).toBe(18);
});
test('adding variants preserves completed groups and the current in-flight answer',()=>{
 for(const current of course.learning!.filter(route=>route.goals.some(goal=>goal.parts.some(part=>part.constructionVariants?.length)))){
  const previous=structuredClone(current);for(const goal of previous.goals)for(const part of goal.parts)delete part.constructionVariants;
  const old=learningParts(previous), before=old.flat().map(step=>step.id);
  expect(before.every(id=>learningParts(current).flat().some(step=>step.id===id))).toBe(true);
  const complete=reconcileLearningRoute(previous,current,{partIndex:old.length,completedStepIds:before,pendingStepIds:[],recallPolicy:'recall-v1'});
  expect(complete.partIndex).toBe(old.length);expect(complete.pendingStepIds).toEqual([]);expect(complete.skippedStepIds).toHaveLength(24);
  const again=reconcileLearningRoute(current,current,complete);expect(again.pendingStepIds).toEqual([]);expect(again.skippedStepIds).toEqual(complete.skippedStepIds);
  const partIndex=old.findIndex(part=>part.some(step=>step.kind==='construction-practice'));
  const part=old[partIndex]!, position=part.findIndex(step=>step.kind==='construction-practice');
  const active=reconcileLearningRoute(previous,current,{partIndex,completedStepIds:old.slice(0,partIndex).flat().concat(part.slice(0,position)).map(step=>step.id),pendingStepIds:part.slice(position).map(step=>step.id)});
  expect(active.pendingStepIds[0]).toBe(part[position]!.id);
 }
});
test('fragment pronunciation follows exact forms and reviewed particle readings',()=>{
 for(const kana of ['は','を']){
  const word=course.words.find(w=>w.surface===kana)!;const form=course.forms.find(f=>f.wordId===word.id&&f.kana===kana)!;
  expect(fragmentAudio(course,{id:'a',wordId:word.id,formId:form.id})).toBe(word.audioUrl);
 }
 let changed=0;
 for(const form of course.forms){
  const word=course.words.find(w=>w.id===form.wordId)!;
  const url=fragmentAudio(course,{id:'a',wordId:word.id,formId:form.id});
  expect(url,form.kana).toBeDefined();expect(existsSync('public'+url),form.kana).toBe(true);
  if(form.kana!==word.kana){changed++;if(word.audioUrl)expect(url,form.kana).not.toBe(word.audioUrl);}
 }
 expect(changed).toBeGreaterThan(0);
});
test('the two contents links identify their different textbook parts',()=>{
 const sources=course.lessons.find(l=>l.id==='marugoto.starter-a1.lesson.06')!.sourceRefs;
 expect(new Set(sources.map(sourceTitle)).size).toBe(sources.length);
 expect(sources.map(sourceTitle).join(' ')).toContain('Katsudoo');expect(sources.map(sourceTitle).join(' ')).toContain('Rikai');
});
