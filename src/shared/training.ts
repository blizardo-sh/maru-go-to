import { confusableLearningWords } from './learningChoices';
import type { LearningExample } from './learning';
import type { Course, ReviewItem, RepeatType, Word } from './types';

export interface TrainingEntry {
  wordId: string;
  explanationRu: string;
  example?: LearningExample;
  application?: { promptRu: string; choices: string[]; labels?: Record<string,{surface:string;kana:string;segments:Word['segments']}> };
  visual?: { kind: 'clock'; hour: number; minute: number; period: 'am' | 'pm' } | { kind: 'calendar'; value: number; label: string };
}
export interface TrainingSection {
  id: string; topic: 'questions' | 'time'; title: string; referenceRu: string; wordIds: string[]; variable?: boolean;
}
export interface ThematicMaterial {
  version: string; words: Word[]; forms: Course['forms']; entries: TrainingEntry[]; sections: TrainingSection[];
  choices: Record<string,string[]>;
}
export interface StudyPreparation {
  key: string; kind: 'word' | 'grammar' | 'counter'; targetId: string; scope: string;
  required: string[]; passed: string[]; introduced: boolean; referenceSeen: boolean;
  title: string; explanationRu: string; word?: Word; example?: LearningExample; examples?: LearningExample[];
}
export const stagedLearning = (course: Course) => course.catalog?.learningPolicy === 'master-before-repeat';
export const trainingEntry = (course: Course, id: string) => course.catalog?.thematic?.entries.find(entry=>entry.wordId===id);
export function trainingSections(course: Course, topic?: string) { return (course.catalog?.thematic?.sections??[]).filter(section=>!topic||section.topic===topic); }
export function wordRepeatTypes(course: Course, wordId: string): RepeatType[] {
  const topics=[...new Set(trainingSections(course).filter(section=>section.wordIds.includes(wordId)).map(section=>section.topic))];
  return topics.length?topics:['words'];
}
export function itemRepeatTypes(course: Course, item: ReviewItem): RepeatType[] {
  return item.mode==='grammar'?['constructions']:item.mode==='counter'?['counters']:wordRepeatTypes(course,item.targetId);
}
export function wordPracticeFormats(word: Word, application=false) { return ['ja-ru','ru-ja',...(word.audioUrl?['listening']:[]),...(application?['application']:[])]; }
export function preparedChoices(course: Course, targetId: string, application=false): string[] {
  const entry=trainingEntry(course,targetId);
  const wrong=application?entry?.application?.choices:course.catalog?.thematic?.choices[targetId]??course.catalog?.quiz.choices[targetId];
  return wrong?.length===3?[targetId,...wrong]:[];
}

/** Publication boundary: a malformed lesson must never become a live quiz. */
export function validateThematicMaterial(course: Course): void {
  const material=course.catalog?.thematic;
  const ensure=(value:unknown,label:string):void=>{if(!value)throw new Error('Invalid thematic material: '+label);};
  const text=(value:unknown):value is string=>typeof value==='string'&&value.trim().length>0&&value.length<=20000;
  const spelling=(value:{surface:string;kana:string;segments:Word['segments']})=>value&&text(value.surface)&&text(value.kana)&&Array.isArray(value.segments)&&value.segments.every(piece=>piece&&text(piece.surface)&&(piece.reading===undefined||text(piece.reading)))&&value.segments.map(piece=>piece.surface).join('')===value.surface&&value.segments.map(piece=>piece.reading??piece.surface).join('')===value.kana;
  ensure(course.catalog?.learningPolicy===undefined||course.catalog.learningPolicy==='master-before-repeat','learning policy');
  if(!material)return;
  ensure(material&&text(material.version)&&Array.isArray(material.entries)&&Array.isArray(material.sections)&&material.choices&&typeof material.choices==='object','shape');
  const words=new Map(course.words.map(word=>[word.id,word])),entries=new Set<string>(),sections=new Set<string>(),members=new Set<string>();
  const options=(id:string,choices:string[])=>{ensure(Array.isArray(choices)&&choices.length===3&&new Set([id,...choices]).size===4,'choices '+id);for(const key of [id,...choices])ensure(words.get(key)?.reviewStatus!=='draft'&&words.has(key),'choice reference '+key);const selected=[id,...choices].map(key=>words.get(key)!);for(let i=0;i<selected.length;i++)for(let j=i+1;j<selected.length;j++)ensure(!confusableLearningWords(selected[i]!,selected[j]!,course.catalog),'ambiguous choices '+id);};
  for(const section of material.sections){ensure(section&&text(section.id)&&!sections.has(section.id)&&['questions','time'].includes(section.topic)&&text(section.title)&&text(section.referenceRu)&&Array.isArray(section.wordIds)&&section.wordIds.length>0&&new Set(section.wordIds).size===section.wordIds.length&&(section.variable===undefined||typeof section.variable==='boolean'),'section');sections.add(section.id);for(const id of section.wordIds){ensure(words.has(id),'section word '+id);members.add(id);}}
  for(const entry of material.entries){ensure(entry&&words.has(entry.wordId)&&!entries.has(entry.wordId)&&members.has(entry.wordId)&&text(entry.explanationRu),'entry');entries.add(entry.wordId);options(entry.wordId,material.choices[entry.wordId]!);
    if(entry.example){ensure(spelling(entry.example)&&text(entry.example.meaningRu)&&/^\/audio\/[a-z0-9/_.-]+\.m4a$/i.test(entry.example.audioUrl),'example '+entry.wordId);ensure(entry.example.audioText===undefined||/^[\u3041-\u30ffー\s・、。？！!?…]+$/u.test(entry.example.audioText),'example pronunciation');}
    if(entry.application){ensure(text(entry.application.promptRu),'application prompt');options(entry.wordId,entry.application.choices);if(entry.application.labels){const keys=[entry.wordId,...entry.application.choices];ensure(Object.keys(entry.application.labels).length===4&&keys.every(id=>spelling(entry.application!.labels![id]!)),'application labels');ensure(new Set(keys.map(id=>entry.application!.labels![id]!.kana.replace(/[\s。、？！]/g,''))).size===4,'duplicate application labels');}}
    if(entry.visual){const visual=entry.visual;ensure(visual.kind==='clock'?Number.isInteger(visual.hour)&&visual.hour>=1&&visual.hour<=12&&Number.isInteger(visual.minute)&&visual.minute>=0&&visual.minute<=59&&['am','pm'].includes(visual.period):visual.kind==='calendar'&&Number.isInteger(visual.value)&&visual.value>=1&&visual.value<=31&&text(visual.label),'visual');}
  }
  ensure([...members].every(id=>entries.has(id))&&Object.keys(material.choices).every(id=>entries.has(id)),'entry coverage');
}
