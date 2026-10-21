import type { Course, Exercise, Word, WordForm } from '../shared/types';
import { validSegments } from './material';

export function withPersonalPractice(course:Course,words:Word[]):Course {
 const preparedIds=new Set(course.words.map(word=>word.id));
 const nouns=words.filter(word=>!preparedIds.has(word.id)&&word.reviewStatus==='reviewed'&&word.kind==='word'&&word.pos==='noun'&&validSegments(word)).sort((a,b)=>a.id.localeCompare(b.id));
 const skill=course.skills.find(item=>item.id==='marugoto.starter-a1.skill.wa_identity');
 const thisForm=course.forms.find(form=>form.surface==='これ');
 const topic=course.forms.find(form=>form.surface==='は'&&course.words.some(word=>word.id===form.wordId&&word.pos==='particle'));
 const copula=course.forms.find(form=>form.surface==='です'&&course.words.some(word=>word.id===form.wordId&&word.pos==='copula'));
 if(!nouns.length||!skill||!thisForm||!topic||!copula)return course;
 const forms:WordForm[]=nouns.map(word=>({id:`${word.id}.form.base`,wordId:word.id,lessonIds:[],surface:word.surface,kana:word.kana,segments:word.segments,reviewStatus:word.reviewStatus,sourceRefs:[]}));
 const exercises:Exercise[]=nouns.map((word,index)=>({
  id:`${word.id}.example.nominal-label`,lessonId:skill.lessonIds[0]!,skillId:skill.id,
  promptRu:`Вежливо назовите изображённое на учебной карточке: «Это — ${word.meaningRu}».`,
  translationRu:`Это ${word.meaningRu}.`,
  contextRu:`Условная учебная иллюстрация подписана «${word.meaningRu}». «Это» указывает на эту карточку; фраза не описывает вас или реального собеседника. Личное существительное подтверждено пользователем.`,
  tokens:[{id:'this',formId:thisForm.id},{id:'topic',formId:topic.id},{id:'noun',formId:forms[index]!.id},{id:'copula',formId:copula.id}],
  acceptedOrders:[['this','topic','noun','copula']],sentenceEnd:'。',reviewStatus:'draft',
 }));
 return {...course,words:[...course.words,...nouns],forms:[...course.forms,...forms],exercises:[...exercises,...course.exercises]};
}
