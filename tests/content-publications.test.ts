import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadCourse } from '../src/server/course';
import { contentId, packContent, validateContentBundle } from '../src/server/publications';
import { advanceLearningState, currentLearningStep, initialLearningState, learningParts, reconcileLearningRoute } from '../src/shared/learning';
import { learningFixture } from './helpers/learning-fixture';

const bundle = packContent(loadCourse());
test('content identity survives JSONB key ordering; bundle rejects broken references, paths and changed media', () => {
  const reorder = (value: any): any => Array.isArray(value) ? value.map(reorder) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).reverse().map(([key,entry]) => [key,reorder(entry)])) : value;
  expect(contentId(reorder(bundle))).toBe(contentId(bundle));
  const changed = structuredClone(bundle); changed.course.title += ' updated';
  expect(contentId(changed)).not.toBe(contentId(bundle));
  const reject = (mutate: (value: typeof bundle) => void) => { const value = structuredClone(bundle); mutate(value); expect(() => validateContentBundle(value)).toThrow(); };
  reject(value => { value.assets.push(value.assets[0]!); });
  reject(value => { value.assets[0]!.path = '/audio/../private.m4a'; });
  reject(value => { value.assets = value.assets.filter(asset => asset.path !== value.course.words.find(word => word.audioUrl)!.audioUrl); });
  reject(value => { value.course.words[0]!.lessonIds = []; });
  reject(value => { value.course.publicationId = 'a'.repeat(64); });
  reject(value => { value.course.catalog!.quiz.choices[value.course.words[0]!.id] = ['missing','a','b']; });
  const directory = mkdtempSync(join(tmpdir(),'maru-asset-check-'));
  try {
    mkdirSync(join(directory,'audio'));
    const small = { ...bundle, assets: [{ path:'/audio/fixture.m4a',bytes:3,sha256:'0'.repeat(64) }] };
    writeFileSync(join(directory,'audio/fixture.m4a'),'bad');
    expect(() => validateContentBundle(small,directory)).toThrow('Changed content asset');
    rmSync(join(directory,'audio/fixture.m4a')); symlinkSync('/etc/hosts',join(directory,'audio/fixture.m4a'));
    expect(() => validateContentBundle(small,directory)).toThrow('unsafe content asset');
  } finally { rmSync(directory,{recursive:true,force:true}); }
});

test('route publication preserves completed formats across part moves and adds only new work', () => {
  const previous=learningFixture().learning[0]!, current=structuredClone(previous);
  let state=initialLearningState(previous);
  state=advanceLearningState(previous,state,'start-practice');
  state=advanceLearningState(previous,state,'remember');
  const completed=learningParts(previous).flat().find(step=>step.id===state.completedStepIds.at(-1))!;
  const moved=current.goals[0]!.parts[0]!.words.shift()!;
  current.goals[1]!.parts[0]!.words.push(moved);
  const migrated=reconcileLearningRoute(previous,current,state);
  expect(state.completedStepIds).toContain(completed.id);
  const newStep=learningParts(current).flat().find(step=>step.kind==='word-practice'&&completed.kind==='word-practice'&&step.wordId===completed.wordId&&step.mode===completed.mode)!;
  expect(migrated.completedStepIds).toContain(newStep.id);
  expect(migrated.pendingStepIds).not.toContain(newStep.id);
  let complete=initialLearningState(previous);
  while(currentLearningStep(previous,complete)){const step=currentLearningStep(previous,complete)!;complete=advanceLearningState(previous,complete,step.kind.endsWith('practice')?'remember':step.kind==='video'?'skip':'continue');}
  current.goals.push({id:'added-goal',titleRu:'Новое',canDoIds:previous.goals[0]!.canDoIds,parts:[{id:'added-part',words:[{...moved,wordId:'new-word'}]}]});
  const reopened=reconcileLearningRoute(previous,current,complete);
  expect(currentLearningStep(current,reopened)).toMatchObject({kind:'word-intro',wordId:'new-word'});
  expect(reopened.completedStepIds.filter(id=>!id.endsWith(':complete'))).toHaveLength(complete.completedStepIds.filter(id=>!id.endsWith(':complete')).length);
});


test('rollback and republish retain removed completions, and future parts skip already completed formats',()=>{
  const old=learningFixture().learning[0]!, added=structuredClone(old);
  const word=structuredClone(added.goals[0]!.parts[0]!.words[0]!); word.wordId='newly-learned';
  added.goals[0]!.parts[0]!.words.push(word);
  let state=initialLearningState(added);
  while(currentLearningStep(added,state)){const step=currentLearningStep(added,state)!;state=advanceLearningState(added,state,step.kind.endsWith('practice')?'remember':step.kind==='video'?'skip':'continue');}
  const rolled=reconcileLearningRoute(added,old,state), restored=reconcileLearningRoute(old,added,rolled);
  expect(currentLearningStep(added,restored)).toBeNull();
  expect(restored.completedStepIds).toContain(`fixture-part-1:ja-ru:${word.wordId}`);
  const moved=structuredClone(added);moved.goals[1]!.parts[0]!.words.push(moved.goals[0]!.parts[0]!.words.shift()!);
  const extra={...word,wordId:'another-new'};moved.goals[0]!.parts[0]!.words.push(extra);
  let next=reconcileLearningRoute(added,moved,state);let rounds=0;
  while(currentLearningStep(moved,next)){const step=currentLearningStep(moved,next)!;expect(step.kind==='part-complete'||('wordId'in step&&step.wordId===extra.wordId)).toBe(true);next=advanceLearningState(moved,next,step.kind.endsWith('practice')?'remember':'continue');if(++rounds>8)throw new Error('Replayed old work');}
  expect(rounds).toBe(5);
});
