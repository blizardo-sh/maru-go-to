import {expect,test} from 'bun:test';
import {existsSync} from 'node:fs';
import {loadCourse} from '../src/server/course';
import {validateCatalog} from '../src/shared/catalog';
import {trainingEntry,wordRepeatTypes,wordPracticeFormats} from '../src/shared/training';
import {decodeReview,reviewId} from '../src/server/reviews';

const course=loadCourse(),material=course.catalog!.thematic!;
test('all calendar groups and clock readings are authored data with prepared examples and local audio',()=>{
 expect(material.sections.map(section=>[section.id,section.wordIds.length])).toEqual([['questions',29],['relative',18],['periods',7],['weekdays',7],['months',12],['dates',31],['clock',1440]]);
 expect(()=>validateCatalog(course)).not.toThrow();
 for(const entry of material.entries){const word=course.words.find(word=>word.id===entry.wordId)!;expect(word.reviewStatus).not.toBe('draft');expect(word.audioUrl).toBeDefined();expect(existsSync('public'+word.audioUrl)).toBe(true);expect(entry.application?.choices).toHaveLength(3);if(entry.example)expect(existsSync('public'+entry.example.audioUrl)).toBe(true);else expect(entry.visual?.kind).toBe('clock');}
 for(const [surface,kana]of [['4月','しがつ'],['7月','しちがつ'],['9月','くがつ'],['14日','じゅうよっか'],['17日','じゅうしちにち'],['19日','じゅうくにち'],['27日','にじゅうしちにち']])expect(course.words.find(word=>word.surface===surface&&material.entries.some(entry=>entry.wordId===word.id))?.kana).toBe(kana);
 const clock=material.sections.find(section=>section.id==='clock')!;expect(clock.variable).toBe(true);
 for(const id of clock.wordIds){const entry=trainingEntry(course,id)!,target=entry.visual!;if(target.kind!=='clock')throw new Error('Expected clock');const changes=material.choices[id]!.map(wrong=>{const other=trainingEntry(course,wrong)!.visual!;if(other.kind!=='clock')throw new Error('Expected comparable clock');return ['hour','minute','period'].filter(key=>target[key as keyof typeof target]!==other[key as keyof typeof other]);});expect(changes).toEqual([['minute'],['hour'],['period']]);}
 for(const period of ['am','pm']as const){const midnight=trainingEntry(course,`training.clock.${period}.12.00`)!;expect(midnight.visual).toEqual({kind:'clock',hour:12,minute:0,period});const word=course.words.find(word=>word.id===midnight.wordId)!;expect(word.kana).toBe((period==='am'?'ごぜん':'ごご')+'れいじ');expect(word.kana).not.toContain('ふん');expect(word.trainingOnly).toBe(true);}
});
test('topics share canonical lesson IDs and malformed choices, labels or clock values cannot be published',()=>{
 const doko=course.words.find(word=>word.kana==='どこ')!;expect(doko.id.startsWith('training.')).toBe(false);expect(wordRepeatTypes(course,doko.id)).toEqual(['questions']);expect(wordPracticeFormats(doko,true)).toEqual(['ja-ru','ru-ja','listening','application']);
 const bad=structuredClone(course);bad.catalog!.thematic!.entries[0]!.application!.labels![doko.id]!.kana='broken';expect(()=>validateCatalog(bad)).toThrow();
 const clock=structuredClone(course);clock.catalog!.thematic!.entries.find(entry=>entry.visual?.kind==='clock')!.visual={kind:'clock',hour:13,minute:60,period:'am'};expect(()=>validateCatalog(clock)).toThrow();
 const equivalent=structuredClone(course),target=equivalent.words.find(word=>word.kana==='なんさい')!,polite=equivalent.words.find(word=>word.kana==='おいくつですか')!;equivalent.catalog!.thematic!.choices[target.id]![0]=polite.id;expect(()=>validateCatalog(equivalent)).toThrow('ambiguous');
 expect(()=>decodeReview(Buffer.from(JSON.stringify(['bogus','target',''])).toString('base64url'))).toThrow();expect(decodeReview(reviewId('ru-ja',doko.id))).toEqual(['ru-ja',doko.id,'']);
});
