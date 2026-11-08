import { expect, test } from 'bun:test';
import { ReviewFlow } from '../src/client/canvas/review-flow';
import { pendingReviews } from '../src/client/api';
import type { ReviewItem, ReviewSubmission } from '../src/shared/types';

test('mixed review preserves every type and order, retries the same durable answer, then advances across types', async () => {
  const fetch = globalThis.fetch, storage = globalThis.localStorage, values = new Map<string,string>();
  globalThis.localStorage = {getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>values.set(key,value),removeItem:(key:string)=>values.delete(key)} as unknown as Storage;
  const owner = crypto.randomUUID(), publicationId = crypto.randomUUID();
  const items = ['ja-ru','grammar','counter','listening','ru-ja'].map((mode,index)=>({id:String(index),targetId:'target'+index,mode,version:4,due:new Date().toISOString(),isNew:false,publicationId,...(mode==='grammar'?{exercise:{},skill:{}}:mode==='counter'?{counter:{}}:{word:{}})})) as ReviewItem[];
  const posted:ReviewSubmission[]=[]; let fail=true;
  globalThis.fetch=(async(url:unknown,init:RequestInit)=>{
    const path=String(url),headers=new Headers(init.headers);
    expect(headers.get('X-Learning-Learner-Id')).toBe(owner);
    if(path==='/api/course')return Response.json({publicationId});
    expect(headers.get('X-Content-Publication')).toBe(publicationId);
    if(path==='/api/progress')return Response.json({introducedWordIds:['target0'],introducedSkillIds:['target1']});
    if(path==='/api/reviews?mode=mixed')return Response.json({items,remainingDue:50,remainingNew:0});
    expect(path).toBe('/api/reviews');
    const submission=JSON.parse(String(init.body));posted.push(submission);
    if(fail){fail=false;return Response.json({error:{message:'Сеть недоступна'}},{status:503});}
    return Response.json({attemptId:submission.attemptId,publicationId,version:5,status:'scheduled',nextDue:new Date(Date.now()+86400000).toISOString(),correct:true});
  }) as typeof fetch;
  try {
    const flow=new ReviewFlow<ReviewItem>(()=>{});await flow.open(owner,'mixed');
    expect(flow.queue.map(i=>i.mode)).toEqual(items.map(i=>i.mode));expect(flow.remainingDue).toBe(50);expect(flow.total).toBe(5);expect(flow.progress?.introducedSkillIds).toEqual(['target1']);expect(posted).toHaveLength(0);
    await flow.grade(owner,3);expect(flow.item?.id).toBe('0');expect(flow.pending).toBe(true);expect(pendingReviews(owner)).toHaveLength(1);
    await flow.retry();expect(posted[1]).toEqual(posted[0]);expect(flow.item?.mode).toBe('grammar');expect(pendingReviews(owner)).toHaveLength(0);
    await flow.grade(owner,3);expect(posted).toHaveLength(2);
    await flow.save({attemptId:crypto.randomUUID(),reviewId:'1',version:4,publicationId,mode:'grammar',tokenIds:['a','b'],revealed:false,rating:3});expect(flow.item?.mode).toBe('counter');
    await flow.save({attemptId:crypto.randomUUID(),reviewId:'2',version:4,publicationId,mode:'counter',helped:false,rating:3,choice:'hon'});expect(flow.item?.mode).toBe('listening');
    await flow.grade('another-learner',3);expect(posted).toHaveLength(4);
    flow.clear();expect(flow.progress).toBeNull();expect(flow.remainingDue).toBe(0);expect(flow.total).toBe(0);
  } finally {globalThis.fetch=fetch;globalThis.localStorage=storage;}
});

test('a late mixed response cannot restore a cleared session',async()=>{
  const fetch=globalThis.fetch,storage=globalThis.localStorage;
  globalThis.localStorage={getItem:()=>null} as unknown as Storage;
  let resolve!:(response:Response)=>void;
  const pending=new Promise<Response>(done=>resolve=done);
  globalThis.fetch=(async(url:unknown)=>String(url)==='/api/course'?pending:Response.json({items:[],remainingDue:0})) as typeof fetch;
  try{const flow=new ReviewFlow<ReviewItem>(()=>{});const opening=flow.open('late-'+crypto.randomUUID(),'mixed');flow.clear();resolve(Response.json({publicationId:'p'}));await opening;expect(flow.course).toBeNull();expect(flow.queue).toEqual([]);expect(flow.active).toBe(false);}finally{globalThis.fetch=fetch;globalThis.localStorage=storage;}
});

test('scheduled Again and Good wait for due, return automatically, and reload the new version', async () => {
  const fetch = globalThis.fetch, storage = globalThis.localStorage, values = new Map<string,string>();
  globalThis.localStorage = {getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>values.set(key,value),removeItem:(key:string)=>values.delete(key)} as unknown as Storage;
  const owner = 'scheduled-'+crypto.randomUUID();
  let version = 1, due = Date.now()-1000, reads = 0;
  const item = () => ({id:'scheduled-word',targetId:'word',mode:'ja-ru',version,due:new Date(due).toISOString(),isNew:false,word:{},schedule:{kind:'review',intervals:{1:60,2:360,3:600,4:691200}}});
  globalThis.fetch = (async (url:unknown,init:RequestInit) => {
    if (String(url)==='/api/course') return Response.json({});
    if (String(url)==='/api/reviews?mode=ja-ru') {
      reads++;
      return Response.json({items:Date.now()>=due?[item()]:[],remainingDue:Date.now()>=due?1:0,remainingNew:0,...(Date.now()<due?{nextDue:new Date(due).toISOString()}:{})});
    }
    const submission = JSON.parse(String(init.body));
    version++; due=Date.now()+100;
    return Response.json({attemptId:submission.attemptId,status:'scheduled',version,nextDue:new Date(due).toISOString(),correct:submission.rating!==1,rating:submission.rating});
  }) as typeof fetch;
  const flow = new ReviewFlow(() => {});
  try {
    await flow.open(owner,'ja-ru');
    for (const rating of [1,3] as const) {
      const previousVersion=flow.item!.version;
      await flow.grade(owner,rating);
      expect(flow.queue).toEqual([]);
      await new Promise(resolve=>setTimeout(resolve,30));
      expect(flow.item).toBeUndefined();
      await new Promise(resolve=>setTimeout(resolve,150));
      expect(flow.item?.version).toBe(previousVersion+1);
    }
    await flow.grade(owner,2); flow.hide(); const before=reads;
    await new Promise(resolve=>setTimeout(resolve,180));
    expect(reads).toBe(before);
    await flow.open(owner,'ja-ru'); expect(flow.item?.version).toBe(version);
    flow.clear(); await new Promise(resolve=>setTimeout(resolve,20)); expect(flow.item).toBeUndefined();
  } finally {flow.clear();globalThis.fetch=fetch;globalThis.localStorage=storage;}
});

test('resuming preserves the open question and a stale Again waits for the authoritative schedule', async () => {
  const fetch=globalThis.fetch,storage=globalThis.localStorage,values=new Map<string,string>();
  globalThis.localStorage={getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>values.set(key,value),removeItem:(key:string)=>values.delete(key)} as unknown as Storage;
  const owner=crypto.randomUUID(),due=new Date(Date.now()+86400000).toISOString();let resumed=false;
  const item=(id:string)=>({id,targetId:id,mode:'ja-ru',version:1,due:new Date().toISOString(),isNew:false,word:{}});
  globalThis.fetch=(async(url:unknown,init:RequestInit)=>String(url)==='/api/course'?Response.json({}):String(url).includes('?mode=')?Response.json({items:resumed?[item('first'),item('second')]:[item('first')],remainingDue:resumed?2:1,remainingNew:0,nextDue:due}):Response.json({attemptId:JSON.parse(String(init.body)).attemptId,status:'additional-practice',version:2,nextDue:due,rating:1,correct:false})) as typeof fetch;
  const flow=new ReviewFlow(()=>{});
  try {
    await flow.open(owner,'ja-ru');const first=flow.item;flow.hide();resumed=true;flow.active=true;await flow.refreshDue();
    expect(flow.item).toBe(first);expect(flow.queue.map(item=>item.id)).toEqual(['first','second']);
    await flow.grade(owner,1);expect(flow.queue.map(item=>item.id)).toEqual(['second']);expect(flow.nextDue).toBe(due);
  } finally {flow.clear();globalThis.fetch=fetch;globalThis.localStorage=storage;}
});
