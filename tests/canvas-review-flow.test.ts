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
