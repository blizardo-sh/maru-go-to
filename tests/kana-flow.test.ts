import { expect,test } from 'bun:test';
import { KanaFlow } from '../src/client/canvas/kana-flow';
import { defaultCatalog } from '../src/shared/catalog';
import { kanaEntries } from '../src/shared/kana-study';
import { pendingKanaReviews } from '../src/client/kana-api';
test('new cards show captions during introduction only; grades require reveal and survive a lost acknowledgement',async()=>{
 const saved={fetch:globalThis.fetch,storage:globalThis.localStorage,document:globalThis.document},values=new Map<string,string>();
 globalThis.localStorage={clear:()=>values.clear(),get length(){return values.size;},key:(i:number)=>[...values.keys()][i]??null,getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>values.set(key,value),removeItem:(key:string)=>values.delete(key)} as Storage;
 globalThis.document={hidden:false} as Document;
 const items=kanaEntries(defaultCatalog,'hiragana').map(entry=>({...entry,script:'hiragana',direction:'sign-reading',version:0,due:null,schedule:{kind:'review',intervals:{1:60,2:360,3:600,4:86400}},attempts:0,errors:0}));
 const posts:any[]=[];let lose=true;
 globalThis.fetch=(async(path:unknown,init:RequestInit)=>{
  expect(new Headers(init.headers).get('X-Learning-Learner-Id')).toBe('learner');
  if(String(path).startsWith('/api/kana?'))return Response.json({items,dueCount:0,nextDue:null});
  const input=JSON.parse(String(init.body));posts.push(input);
  if(lose){lose=false;return Response.json({error:{message:'Lost acknowledgement'}},{status:503});}
  return Response.json({attemptId:input.attemptId,scheduled:true,item:{...items.find(item=>item.glyph===input.glyph),version:1,due:new Date(Date.now()+600000).toISOString()}});
 }) as typeof fetch;
 const flow=new KanaFlow(()=>{});
 try{
  await flow.boot('learner',defaultCatalog);flow.configure({rows:[0,1]},defaultCatalog);await flow.start(defaultCatalog);
  expect(flow.total).toBe(10);expect(flow.introducing).toBe(true);expect(flow.revealed).toBe(true);await flow.grade(4);expect(posts).toHaveLength(0);
  for(let i=0;i<10;i++)flow.nextIntroduction();expect(flow.introducing).toBe(false);expect(flow.revealed).toBe(false);
  await flow.grade(4);expect(posts).toHaveLength(0);flow.reveal();await flow.grade(2);expect(flow.completed).toBe(0);expect(pendingKanaReviews('learner')).toHaveLength(1);
  await flow.retry();expect(posts[1]).toEqual(posts[0]);expect(flow.completed).toBe(1);expect(flow.revealed).toBe(false);expect(pendingKanaReviews('learner')).toHaveLength(0);
 }finally{flow.clear();globalThis.fetch=saved.fetch;globalThis.localStorage=saved.storage;globalThis.document=saved.document;}
});
