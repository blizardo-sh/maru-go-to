import { expect, spyOn, test } from 'bun:test';
import { createAnalyzer, OPENROUTER_DEFAULT_MODEL } from '../src/server/analysis';
const emptyAccess={wordIds:new Set<string>(),skillIds:new Set<string>()};
import type { Config } from '../src/server/config';
import type { Course } from '../src/shared/types';
const course:Course={id:'test',version:'1',title:'Test',lessons:[],words:[],forms:[],skills:[],exercises:[]};
const base:Config={DATABASE_URL:'postgres://unused',BETTER_AUTH_SECRET:'fixture-only-secret-with-more-than-32-characters',APP_URL:'http://127.0.0.1:5173',HOST:'127.0.0.1',PORT:3000,ANALYSIS_PROVIDER:'openrouter',OPENROUTER_API_KEY:'fixture-only-not-a-real-key',ANALYSIS_FREE_ONLY:'true'};
const output={translationRu:'Нужно уточнить контекст.',grammar:'uncertain',naturalness:'uncertain',explanationRu:'Данных недостаточно для уверенной оценки.',warnings:[]};
const reply=()=>Response.json({choices:[{message:{content:JSON.stringify(output)}}]});
const input=(text='まだ準備していない例文',revision=1)=>({text,revision,wordIds:[]});
function stubFetch(implementation:(url:RequestInfo|URL,options?:RequestInit)=>Promise<Response>){const preconnect=fetch.preconnect;return spyOn(globalThis,'fetch').mockImplementation(Object.assign(implementation,{preconnect}));}
test('external analysis requires an explicit free route; missing keys and paid model IDs never fetch',async()=>{
 const network=stubFetch(async()=>{throw new Error('Network must not be called');});
 try{
  expect((await createAnalyzer({...base,OPENROUTER_API_KEY:undefined})('u',course,[],emptyAccess,input())).status).toBe('unavailable');
  expect((await createAnalyzer({...base,OPENROUTER_MODEL:'google/gemma-4-26b-a4b-it'})('u',course,[],emptyAccess,input())).status).toBe('unavailable');
  expect((await createAnalyzer({...base,ANALYSIS_FREE_ONLY:undefined})('u',course,[],emptyAccess,input())).status).toBe('unavailable');
  expect((await createAnalyzer({...base,ANALYSIS_PROVIDER:'generic',ANALYSIS_URL:'https://unapproved.example/chat',ANALYSIS_MODEL:'paid'})('u',course,[],emptyAccess,input())).status).toBe('unavailable');
  expect(network).not.toHaveBeenCalled();
 }finally{network.mockRestore();}
});
test('OpenRouter request pins a free model, strict JSON and privacy; no model fallback array or plugins',async()=>{
 let sentURL='';let sent:any;const network=stubFetch(async(url,options)=>{sentURL=String(url);sent=JSON.parse(String(options?.body));return reply();});
 try{
  expect((await createAnalyzer(base)('u',course,[],emptyAccess,input())).status).toBe('ok');expect(sentURL).toBe('https://openrouter.ai/api/v1/chat/completions');expect(sent.model).toBe(OPENROUTER_DEFAULT_MODEL);expect(sent.model.endsWith(':free')).toBe(true);expect(sent.provider).toEqual({require_parameters:true,data_collection:'deny'});expect(sent.response_format).toEqual({type:'json_object'});expect(sent.models).toBeUndefined();expect(sent.plugins).toBeUndefined();expect(network).toHaveBeenCalledTimes(1);
 }finally{network.mockRestore();}
});
test('validated cache respects user, phrase, token meaning, model and current revision',async()=>{
 const network=stubFetch(async()=>reply());const config={...base};const analyze=createAnalyzer(config);
 try{
  expect((await analyze('a',course,[],emptyAccess,input())).status).toBe('ok');const cached=await analyze('a',course,[],emptyAccess,input(undefined,7));expect(cached.revision).toBe(7);expect(network).toHaveBeenCalledTimes(1);
  await analyze('b',course,[],emptyAccess,input());expect(network).toHaveBeenCalledTimes(2);
  await analyze('a',course,[],emptyAccess,{...input(),wordIds:['another-word-sense']});expect(network).toHaveBeenCalledTimes(3);
  config.OPENROUTER_MODEL='google/another-explicit-model:free';await analyze('a',course,[],emptyAccess,input());expect(network).toHaveBeenCalledTimes(4);
  await analyze('a',course,[],emptyAccess,input('別の例文'));expect(network).toHaveBeenCalledTimes(5);
 }finally{network.mockRestore();}
});
test('the whole application makes at most 20 uncached free calls per minute across users',async()=>{
 const network=stubFetch(async()=>reply());const analyze=createAnalyzer(base);
 try{
  for(let index=0;index<20;index++)expect((await analyze(`u${index%2}`,course,[],emptyAccess,input('未知の文'+index))).status).toBe('ok');
  const blocked=await analyze('third-user',course,[],emptyAccess,input('新規の文21'));expect(blocked.status).toBe('unavailable');if(blocked.status==='unavailable')expect(blocked.reason).toContain('20');expect(network).toHaveBeenCalledTimes(20);
 }finally{network.mockRestore();}
});
test('invalid provider output is never cached and quota errors do not trigger another route',async()=>{
 let status=200;const network=stubFetch(async()=>status===200?Response.json({choices:[{message:{content:'{"grammar":"correct"}'}}]}):new Response('',{status}));const analyze=createAnalyzer(base);
 try{
  expect((await analyze('a',course,[],emptyAccess,input())).status).toBe('unavailable');expect((await analyze('a',course,[],emptyAccess,input())).status).toBe('unavailable');expect(network).toHaveBeenCalledTimes(2);
  status=429;const quota=await analyze('a',course,[],emptyAccess,input('別の未知文'));expect(quota.status).toBe('unavailable');if(quota.status==='unavailable')expect(quota.reason).toBe('Бесплатный сервис временно ограничил запросы. Попробуйте позже.');expect(network).toHaveBeenCalledTimes(3);
  status=503;const privacy=await analyze('a',course,[],emptyAccess,input('Ещё один запрос'));expect(privacy.status).toBe('unavailable');if(privacy.status==='unavailable')expect(privacy.reason).toContain('ограничениями');expect(network).toHaveBeenCalledTimes(4);
 }finally{network.mockRestore();}
});
