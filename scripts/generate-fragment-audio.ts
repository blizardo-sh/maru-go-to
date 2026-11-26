import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadCourse } from '../src/server/course';

// Exact form readings only. Default forms retain the word's reviewed pronunciation (は→わ, を→お).
const course=loadCourse({checkMedia:false}), words=new Map(course.words.map(word=>[word.id,word]));
const recordings=new Map(course.words.filter(word=>word.audioUrl&&existsSync('public'+word.audioUrl)).map(word=>[(word.audioText??word.kana).trim(),word.audioUrl!]));
const readings=[...new Set(course.forms.filter(form=>{const word=words.get(form.wordId);return !(word?.audioUrl&&form.kana===word.kana);}).map(form=>form.kana.trim()))].sort();
const manifest:Record<string,string>={},missing:{id:string;kana:string}[]=[];
for(const reading of readings){
 if(!/^[\u3041-\u30ffー\s・、。？！!?…]+$/u.test(reading))continue;
 const name=createHash('sha256').update(`Kyoko:150:${reading}`).digest('hex').slice(0,20)+'.m4a';
 const url=recordings.get(reading)??(existsSync('public/audio/'+name)?'/audio/'+name:'/audio/fragments/'+name);
 manifest[reading]=url;
 if(!existsSync('public'+url))missing.push({id:reading,kana:reading});
}
if(Bun.argv.includes('--plan'))console.log(JSON.stringify({readings:readings.length,recordings:Object.keys(manifest).length,missing:missing.length}));
else{
 const temporary=mkdtempSync(join(tmpdir(),'marugoto-fragments-'));
 try{
  const input=join(temporary,'input.json');writeFileSync(input,JSON.stringify({words:missing}));mkdirSync('public/audio/fragments',{recursive:true});
  if(missing.length){const process=Bun.spawn(['python3','scripts/generate-audio.py','--course',input,'--output','public/audio/fragments','--jobs','2'],{stdout:'inherit',stderr:'inherit'});if(await process.exited)throw new Error('Fragment recording failed');}
  for(const url of Object.values(manifest))if(!existsSync('public'+url))throw new Error('Missing fragment '+url);
  writeFileSync('materials/fragment-audio.json',JSON.stringify(manifest,null,2)+'\n');
  // The generic generator assumes /audio/. This map owns the actual fragment URLs.
  rmSync('public/audio/fragments/manifest.json',{force:true});
  console.log(JSON.stringify({recordings:Object.keys(manifest).length,newRecordings:missing.length,pronunciationReview:'not-human-reviewed'}));
 }finally{rmSync(temporary,{recursive:true,force:true});}
}
