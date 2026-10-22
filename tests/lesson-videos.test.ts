import { expect, test } from 'bun:test';
import { course, validateCourse } from '../src/shared/course';
import { validateLearning, learningParts } from '../src/shared/learning';
import { loadCourse } from '../src/server/course';
import type { LessonVideo } from '../src/shared/types';
import { learningFixture } from './helpers/learning-fixture';

function video(variant:LessonVideo['variant']='practice',clip='01'):LessonVideo {
 const stem=variant==='practice'?`cando_01_${clip}`:'challenge01';
 return {id:`test.video.${stem}`,canDoId:1,variant,title:'Приветствие — тест метаданных',sourceUrl:'https://a1.marugotoweb.jp/en/can-do1.php',mediaUrl:`https://a1.marugotoweb.jp/en/assets/movies/topics/${stem}.mp4`,captionsSourceUrl:`https://a1.marugotoweb.jp/en/assets/data/topics/${stem}.xml`,captions:[{startSeconds:0,endSeconds:1,text:null},{startSeconds:1,endSeconds:2,text:'こんにちは。'},{startSeconds:2,endSeconds:null,text:null}]};
}
function fixture(){const value=structuredClone(course);value.lessons[0]!.videos=[video(),video('practice','02'),video('challenge')];return value;}

test('multiple official clips validate their identity, role, Can-do and exact media/caption source',()=>{
 validateCourse(fixture());
 for(const change of [
  {id:''},{id:'bad/id'},{canDoId:3},{variant:'untrusted'},{variant:'challenge'},
  {sourceUrl:'https://example.test/can-do1.php'},{sourceUrl:'https://a1.marugotoweb.jp/en/can-do3.php'},
  {mediaUrl:'https://a1.marugotoweb.jp.evil.test/en/assets/movies/topics/cando_01_01.mp4'},
  {mediaUrl:'https://a1.marugotoweb.jp/en/assets/movies/topics/cando_03_01.mp4'},
  {mediaUrl:'https://a1.marugotoweb.jp/en/assets/movies/topics/cando_01_00.mp4'},
  {mediaUrl:'https://a1.marugotoweb.jp/en/assets/movies/topics/cando_01_01.mp4?other=1'},
  {captionsSourceUrl:'https://a1.marugotoweb.jp/en/assets/data/topics/cando_01_02.xml'},
 ]as const){const value=fixture();Object.assign(value.lessons[0]!.videos![0]!,change);expect(()=>validateCourse(value)).toThrow('video');}
 for(const duplicate of ['id','clip','locale']as const){
  const value=fixture();const videos=value.lessons[0]!.videos!;
  if(duplicate==='id')videos[1]!.id=videos[0]!.id;
  else if(duplicate==='clip')videos[1]={...videos[0]!,id:'different-id'};
  else videos[1]={...videos[0]!,id:'different-locale-id',sourceUrl:videos[0]!.sourceUrl.replace('/en/','/ja/'),mediaUrl:videos[0]!.mediaUrl.replace('/en/','/ja/'),captionsSourceUrl:videos[0]!.captionsSourceUrl.replace('/en/','/ja/')};
  expect(()=>validateCourse(value)).toThrow('video');
 }
 const acrossLessons=fixture();acrossLessons.lessons[1]!.videos=[{...video(),id:acrossLessons.lessons[0]!.videos![0]!.id}];
 expect(()=>validateCourse(acrossLessons)).toThrow('video id');
});

test('each clip retains ordered, bounded native cue intervals including gaps and the final blank',()=>{
 for(const captions of [
  [],[{startSeconds:-1,endSeconds:1,text:'あ'}],[{startSeconds:NaN,endSeconds:1,text:'あ'}],
  [{startSeconds:1,endSeconds:1,text:'あ'}],[{startSeconds:0,endSeconds:Infinity,text:'あ'}],
  [{startSeconds:0,endSeconds:null,text:'あ'}],[{startSeconds:0,endSeconds:1,text:' '}],
  [{startSeconds:0,endSeconds:3,text:'あ'},{startSeconds:2,endSeconds:4,text:'い'}],
  [{startSeconds:0,endSeconds:null,text:null},{startSeconds:2,endSeconds:4,text:'い'}],
 ]){const value=fixture();value.lessons[0]!.videos![0]!.captions=captions;expect(()=>validateCourse(value)).toThrow('video caption');}
});

test('goals resolve videos within their own lesson and Can-do, with no repeated placements',()=>{
 const valid=learningFixture();valid.lessons[0]!.videos=[video()];const route=valid.learning[0]!;const lesson=valid.lessons.find(item=>item.id===route.lessonId)!;
 const second={...lesson.videos![0]!,id:'fixture.second-video',mediaUrl:'https://a1.marugotoweb.jp/en/assets/movies/topics/cando_05_02.mp4',captionsSourceUrl:'https://a1.marugotoweb.jp/en/assets/data/topics/cando_05_02.xml'};lesson.videos!.push(second);route.goals[0]!.videoIds!.push(second.id);
 validateLearning(valid,valid.learning);
 expect(learningParts(route)[0]!.filter(step=>step.kind==='video').map(step=>step.videoId)).toEqual([lesson.id,second.id]);
 for(const mutate of [
  (value:typeof valid)=>{value.learning[0]!.goals[0]!.videoIds=[value.lessons[0]!.videos![0]!.id];},
  (value:typeof valid)=>{value.learning[0]!.goals[0]!.canDoIds=[lesson.canDoIds[1]!];},
  (value:typeof valid)=>{value.learning[0]!.goals[1]!.videoIds=[second.id];},
  (value:typeof valid)=>{value.learning[0]!.goals[0]!.videoIds!.push(second.id);},
 ]){const value=structuredClone(valid);mutate(value);expect(()=>validateLearning(value,value.learning)).toThrow('video scope');}
});

test('all 18 lessons publish the 80 source-linked dialogue clips, while the four pilot step IDs remain exact',()=>{
 const published=loadCourse();const all=published.lessons.flatMap(lesson=>lesson.videos??[]);
 expect(all).toHaveLength(80);expect(all.filter(item=>item.variant==='practice')).toHaveLength(44);expect(all.filter(item=>item.variant==='challenge')).toHaveLength(36);
 for(const lesson of published.lessons){
  expect(lesson.videos!.length).toBeGreaterThanOrEqual(2);
  const route=published.learning!.find(item=>item.lessonId===lesson.id)!;
  expect(route.version).toBe('2026-10-21.1');
  expect(new Set(route.goals.flatMap(goal=>goal.videoIds??[]))).toEqual(new Set(lesson.videos!.map(item=>item.id)));
 }
 const pilotParts=['l01-greetings-02','l02-classroom-02','l03-introduce-03','l04-family-photo-03'];
 for(const [index,part]of pilotParts.entries()){
  const lesson=published.lessons.find(item=>item.number===index+1)!;
  const legacy=lesson.videos!.find(item=>item.id===lesson.id)!;expect(legacy.canDoId).toBe(index*2+1);expect(legacy.mediaUrl).toEndWith(`cando_0${index*2+1}_01.mp4`);
  const route=published.learning!.find(item=>item.lessonId===lesson.id)!;
  expect(learningParts(route).flat().find(step=>step.kind==='video'&&step.videoId===lesson.id)?.id).toBe(`${part}:video:${lesson.id}`);
 }
 const fourth=published.learning!.find(item=>item.lessonId.endsWith('.04'))!;const family=fourth.goals.find(goal=>goal.id==='l04-family-photo')!;expect(family.canDoIds).toEqual([8]);
 for(const mutate of [
  (value:typeof published)=>{value.learning!.find(item=>item.lessonId===fourth.lessonId)!.goals.find(goal=>goal.id==='l04-family-photo')!.id='not-the-legacy-goal';},
  (value:typeof published)=>{value.lessons.find(lesson=>lesson.id===fourth.lessonId)!.videos!.find(item=>item.id===fourth.lessonId)!.id='not-the-legacy-video';value.learning!.find(item=>item.lessonId===fourth.lessonId)!.goals.find(goal=>goal.id==='l04-family-photo')!.videoIds=[...family.videoIds!.filter(id=>id!==fourth.lessonId),'not-the-legacy-video'];},
 ]){const invalid=structuredClone(published);mutate(invalid);expect(()=>validateLearning(invalid,invalid.learning!)).toThrow('video scope');}
});
