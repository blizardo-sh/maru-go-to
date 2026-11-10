import { describe, expect, test } from 'bun:test';
import { readFileSync, existsSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadCourse } from '../src/server/course';
import { validateCatalog } from '../src/shared/catalog';
import { learningParts, reconcileLearningRoute, type LearningRouteState } from '../src/shared/learning';
import { wordCardFor } from '../src/shared/word-cards';
import { VisualWordFace } from '../src/client/VisualWordFace';
import { trainingContextSchema } from '../src/server/validation';

const course=loadCourse({includeBooks:false}), cards=course.catalog!.wordCards!;
describe('A1 illustrated word cards',()=>{
 test('covers exactly the A1 edition, with real bounded media and round-trip readings',()=>{
  expect(Object.keys(cards.entries)).toHaveLength(874);
  expect(()=>validateCatalog(course)).not.toThrow();
  const files=new Set<string>();
  for(const card of Object.values(cards.entries)){
   expect(card.segments.map(s=>s.surface).join('')).toBe(card.surface);
   expect(card.segments.map(s=>s.reading??s.surface).join('')).toBe(card.kana);
   expect(card.captionRu.length).toBeGreaterThan(10);
   expect(existsSync(new URL('../public'+card.image.src,import.meta.url))).toBe(true);
   if(!files.has(card.image.src)&&card.image.src.startsWith('/assets/a1-words/')){const bytes=readFileSync(new URL('../public'+card.image.src,import.meta.url));expect(bytes.readUInt32BE(16)).toBe(card.image.width);expect(bytes.readUInt32BE(20)).toBe(card.image.height);}
   files.add(card.image.src);
  }
  expect([...files].filter(file=>file.startsWith('/assets/a1-words/'))).toHaveLength(29);
  for(const [kana,meaning,surface] of [['かんじ','иероглифы','漢字'],['ぼうし','шапка','帽子'],['いぬ','собака','犬'],['さんさい','три года (возраст)','三歳'],['が','подлежащее; объект предпочтения или умения','が']])expect(Object.values(cards.entries).find(c=>c.kana===kana&&c.meaningRu===meaning)?.surface).toBe(surface);
  expect(wordCardFor('marugoto.elementary-a2.word.unknown',course.catalog)).toBeUndefined();
  expect(trainingContextSchema.safeParse({lessonId:'marugoto.elementary-a2.lesson.01',visualWords:'true'}).success).toBe(false);
 });
 test('rejects bad crop, reading and external media metadata',()=>{
  for(const mutate of [(c:any)=>c.image.viewBox='0 0 99999 256',(c:any)=>c.segments=[{surface:c.surface,reading:'wrong'}],(c:any)=>c.image.src='https://example.test/image.png']){
   const broken=structuredClone(course);mutate(Object.values(broken.catalog!.wordCards!.entries)[0]);expect(()=>validateCatalog(broken)).toThrow();
  }
 });
 test('question hides gloss and caption; written direction retains ruby even in kana preferences',()=>{
  const card=Object.values(cards.entries).find(card=>card.surface==='日本語')!;
  const picture=renderToStaticMarkup(<VisualWordFace card={card} mode="picture-word" revealed={false}/>);
  expect(picture).not.toContain(card.surface);expect(picture).not.toContain(card.captionRu);expect(picture).not.toContain('<rt>');
  const written=renderToStaticMarkup(<VisualWordFace card={card} mode="word-meaning" revealed={false}/>);
  expect(written).toContain('<rt>');expect(written).not.toContain(card.image.src);expect(written).not.toContain(card.meaningRu);
  const answer=renderToStaticMarkup(<VisualWordFace card={card} mode="word-meaning" revealed/>);
  expect(answer).toContain(card.image.src);expect(answer).toContain(card.captionRu);expect(answer).toContain('<rt>');
 });
 test('completed historical groups stay complete without pretending new directions were answered',()=>{
  const current=course.learning![0]!, previous=structuredClone(current);for(const goal of previous.goals)for(const part of goal.parts)for(const word of part.words)delete word.visualCards;
  const oldParts=learningParts(previous), state:LearningRouteState={partIndex:oldParts.length,pendingStepIds:[],completedStepIds:oldParts.flat().map(step=>step.id),recallPolicy:'recall-v1'};
  const next=reconcileLearningRoute(previous,current,state);
  expect(next.partIndex).toBe(learningParts(current).length);expect(next.pendingStepIds).toEqual([]);expect(next.skippedStepIds!.length).toBeGreaterThan(0);
  expect(next.completedKeys!.some(key=>key.includes('picture-word'))).toBe(false);
  expect(reconcileLearningRoute(current,current,next)).toEqual(next);
  const moved=structuredClone(current);for(const goal of moved.goals)for(const part of goal.parts)part.id+='-moved';expect(reconcileLearningRoute(previous,moved,state).pendingStepIds).toEqual([]);
  const partial={...state,partIndex:0,completedStepIds:[oldParts[0]![0]!.id],pendingStepIds:oldParts[0]!.slice(1).map(s=>s.id)};
  const migrated=reconcileLearningRoute(previous,current,partial);expect(migrated.pendingStepIds.some(id=>id.includes('picture-word'))).toBe(true);expect(migrated.pendingStepIds[0]).toBe(partial.pendingStepIds[0]);
 });
});
