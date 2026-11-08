import {afterEach,beforeEach,expect,spyOn,test} from 'bun:test';
import {PriorLearningClient} from '../src/client/prior-learning';
const original=Object.getOwnPropertyDescriptor(globalThis,'localStorage');let fetchSpy:ReturnType<typeof spyOn<typeof globalThis,'fetch'>>;
beforeEach(()=>{const values=new Map<string,string>();Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>values.set(key,value),removeItem:(key:string)=>values.delete(key),key:(index:number)=>[...values.keys()][index]??null,get length(){return values.size;}}});fetchSpy=spyOn(globalThis,'fetch');});
afterEach(()=>{fetchSpy.mockRestore();if(original)Object.defineProperty(globalThis,'localStorage',original);else Reflect.deleteProperty(globalThis,'localStorage');});
const selection={targets:[{kind:'word' as const,id:'meaning-one'}]};
test('prior learning preserves the pinned request on a lost or mismatched ACK and replays it once',async()=>{
 const client=new PriorLearningClient();client.bind('one');fetchSpy.mockRejectedValue(new Error('Offline'));await client.send('a'.repeat(64),selection);const input=structuredClone(client.pending)!;
 const reloaded=new PriorLearningClient();reloaded.bind('one');expect(reloaded.pending).toEqual(input);
 fetchSpy.mockResolvedValue(Response.json({requestId:'wrong'}));await reloaded.send(undefined);expect(reloaded.pending).toEqual(input);
 fetchSpy.mockImplementation(Object.assign(async(_url:any,options:any)=>{expect(JSON.parse(options.body)).toEqual(input);expect(new Headers(options.headers).get('X-Content-Publication')).toBe(input.publicationId!);return Response.json({requestId:input.requestId,added:3,removed:0,retained:0,targets:1});},{preconnect(){}}));
 await reloaded.send(undefined);expect(reloaded.pending).toBeNull();expect(reloaded.last).toBe(input.requestId);expect(reloaded.result?.added).toBe(3);
});
test('another tab cannot overwrite an in-flight command; a late A response cannot replace a new A binding after B',async()=>{
 const client=new PriorLearningClient();client.bind('A');let resolve!:(response:Response)=>void;fetchSpy.mockImplementation(Object.assign(()=>new Promise<Response>(done=>{resolve=done;}),{preconnect(){}}));
 const flight=client.send('a'.repeat(64),selection),originalInput=client.pending!;
 const second={requestId:crypto.randomUUID(),publicationId:'b'.repeat(64),selection:{targets:[{kind:'word',id:'meaning-two'}]}};
 localStorage.setItem('japanese-prior-request-v1:A:'+second.requestId,JSON.stringify(second));
 client.bind('B');expect(client.pending).toBeNull();client.bind('A');const pendingBefore=client.pending;
 resolve(Response.json({requestId:originalInput.requestId,added:3,removed:0,retained:0,targets:1}));await flight;expect(client.pending).toEqual(pendingBefore);expect(client.result).toBeNull();
 expect(localStorage.getItem('japanese-prior-request-v1:A:'+originalInput.requestId)).not.toBeNull();expect(localStorage.getItem('japanese-prior-request-v1:A:'+second.requestId)).not.toBeNull();
});
