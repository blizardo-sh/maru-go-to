import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { hashPassword } from 'better-auth/crypto';
import { createApp } from '../src/server/app';
import { createRegistrationLink, tokenHash } from '../src/server/auth';
import { loadCourse } from '../src/server/course';
import { connectDatabase } from '../src/server/db';
import { session } from '../src/server/schema';
import { invitationSchema, registrationLinkSchema } from '../src/server/validation';
import type { RegistrationLinkCreateResult, RegistrationLinkInput } from '../src/shared/types';
import { nextFixtureIp } from './helpers/fixture-ip';

test('registration limits have bounded defaults and passwords retain the established literal 8–128 policy',()=>{
 expect(registrationLinkSchema.parse({})).toEqual({registrationLimit:5});
 const future=new Date(Date.now()+3600000).toISOString();
 for(const input of [{registrationLimit:1,expiresAt:null},{registrationLimit:null,expiresAt:future}])expect(registrationLinkSchema.safeParse(input).success).toBe(true);
 for(const input of [{registrationLimit:null,expiresAt:null},{registrationLimit:0},{registrationLimit:1.5},{registrationLimit:2147483648},{expiresAt:'2020-01-01T00:00:00Z'},{expiresAt:'not-a-date'},{registrationLimit:1,unapprovedField:true}])expect(registrationLinkSchema.safeParse(input).success).toBe(false);
 for(const [length,accepted]of [[7,false],[8,true],[128,true],[129,false]]as const)expect(invitationSchema.safeParse({token:'registration-fixture-token',name:'Learner',email:'learner@example.test',password:'x'.repeat(length)}).success).toBe(accepted);
 expect(invitationSchema.parse({token:'registration-fixture-token',name:' Learner ',email:' LEARNER@EXAMPLE.TEST ',password:' abcd12 '})).toMatchObject({name:'Learner',email:'learner@example.test',password:' abcd12 '});
});

const databaseUrl=process.env.JAPANESE_INTEGRATION_DATABASE_URL;
const suite=databaseUrl?describe:describe.skip;
const origin='http://127.0.0.1:5173';
suite('quota and deadline registration links on disposable PostgreSQL',()=>{
 let database:ReturnType<typeof connectDatabase>;let app:ReturnType<typeof createApp>;let adminCookie:string;let learnerCookie:string;let adminId:string;
 const emails:string[]=[];const linkIds:string[]=[];const personalTokens:string[]=[];const password='Isolated-registration-password-2026!';let fixtureIp=nextFixtureIp();
 const config={DATABASE_URL:databaseUrl!,BETTER_AUTH_SECRET:'isolated-registration-secret-at-least-32-characters',APP_URL:origin,HOST:'127.0.0.1',PORT:3000};
 const email=()=>{const value=`registration-${crypto.randomUUID()}@example.test`;emails.push(value);return value;};
 const cookieFrom=(response:Response)=>response.headers.getSetCookie().map(part=>part.split(';')[0]).join('; ');
 const request=(path:string,body?:unknown,cookie='',method=body===undefined?'GET':'POST',target=app)=>target.request(origin+path,{method,headers:{origin,'x-forwarded-for':fixtureIp,...(body===undefined?{}:{'content-type':'application/json'}),...(cookie?{cookie}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const accept=(token:string,value=email(),target=app)=>request('/api/invitations/accept',{token,name:' New learner ',email:value,password},'','POST',target);
 const create=async(input:RegistrationLinkInput={})=>{
  const response=await request('/api/admin/registration-links',input,adminCookie);expect(response.status).toBe(200);
  const result:RegistrationLinkCreateResult=await response.json();linkIds.push(result.link.id);const token=new URLSearchParams(new URL(result.url).hash.slice(1)).get('token')!;
  return {...result,token};
 };
 const stored=async(id:string)=>(await database.sql`select * from registration_links where id=${id}`)[0]!;
 beforeEach(()=>{fixtureIp=nextFixtureIp();});
 beforeAll(async()=>{
  const target=new URL(databaseUrl!);if(!['localhost','127.0.0.1'].includes(target.hostname)||target.pathname!=='/japanese_app_test')throw new Error('Use disposable localhost japanese_app_test only.');
  database=connectDatabase(databaseUrl!);app=createApp({database,config,course:loadCourse()});
  const hash=await hashPassword(password);
  for(const isAdmin of [true,false]){
   const id=crypto.randomUUID();const address=email();
   await database.sql`insert into users(id,name,email,email_verified,is_admin) values(${id},'Fixture',${address},true,${isAdmin})`;
   await database.sql`insert into accounts(id,account_id,provider_id,user_id,password) values(${crypto.randomUUID()},${id},'credential',${id},${hash})`;
   const signedIn=await request('/api/auth/sign-in/email',{email:address,password});expect(signedIn.status).toBe(200);
   if(isAdmin){adminId=id;adminCookie=cookieFrom(signedIn);}else learnerCookie=cookieFrom(signedIn);
  }
  // Existing private material must not be inherited by new invitees.
  const listId=crypto.randomUUID();await database.sql`insert into word_lists(id,user_id,name) values(${listId},${adminId},'Only the issuer sees this')`;
  await database.sql`insert into personal_words(id,list_id,user_id,data) values(${crypto.randomUUID()},${listId},${adminId},${{surface:'private',meaningRu:'private'}})`;
  await database.sql`insert into learning_states(user_id,lesson_id,route_version,state) values(${adminId},'private-fixture','1',${{step:3}})`;
 });
 afterAll(async()=>{
  if(!database)return;
  for(const id of linkIds)await database.sql`delete from registration_links where id=${id}`;
  for(const token of personalTokens)await database.sql`delete from access_links where token_hash=${tokenHash(token)}`;
  for(const address of emails){await database.sql`delete from access_links where email=${address}`;await database.sql`delete from users where email=${address}`;}
  await database.sql.close();
 });
 test('only admins issue, inspect or revoke links; defaults, immutable conditions and copy-once metadata are explicit',async()=>{
  for(const cookie of ['',learnerCookie]){
   const expected=cookie?403:401;
   for(const [path,body]of [['/api/admin/registration-links',undefined],['/api/admin/registration-links',{}],[`/api/admin/registration-links/${crypto.randomUUID()}/revoke`,{}]]as const)expect((await request(path,body,cookie)).status).toBe(expected);
  }
  for(const input of [{registrationLimit:null,expiresAt:null},{registrationLimit:0},{expiresAt:'2020-01-01T00:00:00Z'}])expect((await request('/api/admin/registration-links',input,adminCookie)).status).toBe(400);
  const created=await create();expect(created.link).toMatchObject({registrationLimit:5,registrationsCount:0,remainingRegistrations:5,revokedAt:null,status:'active'});
  expect(Math.abs(new Date(created.link.expiresAt!).getTime()-Date.now()-7*86400000)).toBeLessThan(5000);
  const row=await stored(created.link.id);expect(row.token_hash).toBe(tokenHash(created.token));expect(Object.keys(row)).not.toContain('token');expect(Object.values(row)).not.toContain(created.token);
  const list=await request('/api/admin/registration-links',undefined,adminCookie);expect(list.status).toBe(200);const found=(await list.json()).links.find((item:any)=>item.id===created.link.id);expect(found).toEqual(created.link);expect(Object.keys(found).sort()).toEqual(['id','registrationLimit','registrationsCount','remainingRegistrations','expiresAt','revokedAt','createdAt','status'].sort());
  expect((await request(`/api/admin/registration-links/${created.link.id}`,{registrationLimit:100},adminCookie,'PATCH')).status).toBe(404);
  expect((await stored(created.link.id)).registration_limit).toBe(5);
  expect((await request(`/api/admin/registration-links/${crypto.randomUUID()}/revoke`,{},adminCookie)).status).toBe(404);
 });
 test('a shared link creates distinct unverified ordinary learners, signs them in and starts with empty private progress',async()=>{
  const link=await create();const addresses=[email(),email()];const ids:string[]=[];
  for(const address of addresses){
   const details=await request('/api/invitations/details',{token:link.token});expect(details.status).toBe(200);expect(await details.json()).toMatchObject({kind:'registration',email:null});
   const registered=await accept(link.token,' '+address.toUpperCase()+' ');expect(registered.status).toBe(200);expect(await registered.json()).toEqual({ok:true,email:address,authenticated:true});
   const cookie=cookieFrom(registered);expect(cookie).toContain('better-auth.session_token=');
   const me=await request('/api/me',undefined,cookie);expect(me.status).toBe(200);const user=await me.json();expect(user).toMatchObject({name:'New learner',email:address,isAdmin:false});ids.push(user.id);
   expect((await database.sql`select email_verified,is_admin from users where id=${user.id}`)[0]).toMatchObject({email_verified:false,is_admin:false});
   const progress=await request('/api/progress',undefined,cookie);expect(await progress.json()).toMatchObject({introducedWordIds:[],introducedSkillIds:[]});
   const learning=await (await request('/api/learning',undefined,cookie)).json();expect(learning.lessons).toHaveLength(18);
   for(const state of learning.lessons)expect(state).toMatchObject({version:0,completedSteps:0,completed:false});
   expect(await (await request('/api/lists',undefined,cookie)).json()).toEqual({lists:[]});
   for(const rows of [await database.sql`select user_id from review_states where user_id=${user.id}`,await database.sql`select user_id from learning_states where user_id=${user.id}`,await database.sql`select user_id from personal_words where user_id=${user.id}`])expect(rows).toHaveLength(0);
   expect((await request('/api/admin/registration-links',undefined,cookie)).status).toBe(403);
  }
  expect(ids[0]).not.toBe(ids[1]);expect((await stored(link.link.id)).registrations_count).toBe(2);
  expect(await database.sql`select user_id from learning_states where user_id=${adminId}`).toHaveLength(1);
  expect(await database.sql`select user_id from personal_words where user_id=${adminId}`).toHaveLength(1);
 });
 test('views, invalid data and an existing normalized email never consume quota or change an existing account',async()=>{
  const link=await create();const address=email();
  const existing=(await database.sql`select * from users where id=${adminId}`)[0];
  const accountsBefore=await database.sql`select * from accounts where user_id=${adminId}`;const sessionsBefore=await database.sql`select * from sessions where user_id=${adminId}`;
  for(let index=0;index<2;index++)expect((await request('/api/invitations/details',{token:link.token})).status).toBe(200);
  const base={token:link.token,name:'Learner',email:address,password};
  for(const change of [{email:'ivan'},{email:undefined},{name:' '},{password:'short77'},{password:'x'.repeat(129)},{isAdmin:true}])expect((await request('/api/invitations/accept',{...base,...change})).status).toBe(400);
  expect((await stored(link.link.id)).registrations_count).toBe(0);expect(await database.sql`select id from users where email=${address}`).toHaveLength(0);
  const duplicate=await accept(link.token,' '+existing.email.toUpperCase()+' ');expect(duplicate.status).toBe(409);expect((await duplicate.json()).error.code).toBe('EMAIL_EXISTS');
  expect((await stored(link.link.id)).registrations_count).toBe(0);expect((await database.sql`select * from users where id=${adminId}`)[0]).toEqual(existing);
  expect(await database.sql`select * from accounts where user_id=${adminId}`).toEqual(accountsBefore);expect(await database.sql`select * from sessions where user_id=${adminId}`).toEqual(sessionsBefore);
  const registered=await accept(link.token,address);expect(registered.status).toBe(200);
  expect((await accept(link.token,address)).status).toBe(409);expect((await stored(link.link.id)).registrations_count).toBe(1);
 });
 test('quota-only last slot is atomic under two simultaneous different applicants',async()=>{
  const link=await create({registrationLimit:1,expiresAt:null});expect(link.link.expiresAt).toBeNull();
  const addresses=[email(),email()];const responses=await Promise.all(addresses.map(address=>accept(link.token,address)));expect(responses.map(response=>response.status).sort()).toEqual([200,400]);
  const users=await database.sql`select id from users where email in ${database.sql(addresses)}`;expect(users).toHaveLength(1);expect((await stored(link.link.id)).registrations_count).toBe(1);
  expect((await request('/api/invitations/details',{token:link.token})).status).toBe(400);expect((await accept(link.token)).status).toBe(400);
  const listed=await (await request('/api/admin/registration-links',undefined,adminCookie)).json();expect(listed.links.find((item:any)=>item.id===link.link.id)).toMatchObject({status:'exhausted',remainingRegistrations:0,registrationsCount:1});
 });
 test('time-only links have no count ceiling but expire; the deadline also closes a combined link with places left',async()=>{
  const link=await create({registrationLimit:null,expiresAt:new Date(Date.now()+3600000).toISOString()});expect(link.link.remainingRegistrations).toBeNull();
  for(let index=0;index<2;index++)expect((await accept(link.token)).status).toBe(200);
  const details=await (await request('/api/invitations/details',{token:link.token})).json();expect(details.remainingRegistrations).toBeNull();expect((await stored(link.link.id)).registrations_count).toBe(2);
  const combined=await create();
  for(const current of [link,combined]){
   await database.sql`update registration_links set expires_at=now()-interval '1 second' where id=${current.link.id}`;
   expect((await request('/api/invitations/details',{token:current.token})).status).toBe(400);expect((await accept(current.token)).status).toBe(400);
   const list=await (await request('/api/admin/registration-links',undefined,adminCookie)).json();expect(list.links.find((item:any)=>item.id===current.link.id).status).toBe('expired');
  }
  expect((await stored(combined.link.id)).registrations_count).toBe(0);
 });
 test('simultaneous registration of one normalized email on two links creates one account and spends one place',async()=>{
  const links=await Promise.all([create({registrationLimit:1,expiresAt:null}),create({registrationLimit:1,expiresAt:null})]);const address=email();
  const responses=await Promise.all([accept(links[0]!.token,address),accept(links[1]!.token,' '+address.toUpperCase()+' ')]);expect(responses.map(response=>response.status).sort()).toEqual([200,409]);
  expect(await database.sql`select id from users where email=${address}`).toHaveLength(1);
  const rows=await Promise.all(links.map(link=>stored(link.link.id)));expect(rows.map(row=>row.registrations_count).sort()).toEqual([0,1]);
  const unused=links[rows.findIndex(row=>row.registrations_count===0)]!;expect((await accept(unused.token)).status).toBe(200);
 });
 test('revocation is idempotent and affects future registrations only, keeping an existing session and progress',async()=>{
  const link=await create();const registered=await accept(link.token);expect(registered.status).toBe(200);const cookie=cookieFrom(registered);const user=await (await request('/api/me',undefined,cookie)).json();
  await database.sql`insert into learning_states(user_id,lesson_id,route_version,state) values(${user.id},'private-after-registration','1',${{step:4}})`;
  const revoked=await request(`/api/admin/registration-links/${link.link.id}/revoke`,{},adminCookie);expect(revoked.status).toBe(200);const first=(await revoked.json()).link;expect(first).toMatchObject({status:'revoked',registrationsCount:1});
  const repeated=await request(`/api/admin/registration-links/${link.link.id}/revoke`,{},adminCookie);expect((await repeated.json()).link.revokedAt).toBe(first.revokedAt);
  expect((await request('/api/invitations/details',{token:link.token})).status).toBe(400);expect((await accept(link.token)).status).toBe(400);expect((await stored(link.link.id)).registrations_count).toBe(1);
  expect((await request('/api/me',undefined,cookie)).status).toBe(200);expect((await database.sql`select state from learning_states where user_id=${user.id}`)[0].state).toEqual({step:4});
 });
 test('post-commit session failure acknowledges the created account and supports ordinary manual sign-in',async()=>{
  const link=await create();const address=email();
  const failingDatabase={...database,db:new Proxy(database.db,{get(target,property,receiver){const value=Reflect.get(target,property,receiver);if(property!=='insert')return typeof value==='function'?value.bind(target):value;return(...args:unknown[])=>{if(args[0]===session)throw new Error('Isolated fixture session failure');return Reflect.apply(value,target,args);};}})};
  const failingApp=createApp({database:failingDatabase,config,course:loadCourse()});
  const result=await accept(link.token,address,failingApp);expect(result.status).toBe(200);expect(await result.json()).toEqual({ok:true,email:address,authenticated:false});expect(cookieFrom(result)).toBe('');
  expect((await stored(link.link.id)).registrations_count).toBe(1);expect((await request('/api/auth/sign-in/email',{email:address,password})).status).toBe(200);
 });
 test('old personal invitation issuance and recovery remain compatible and general registration cannot call public signup',async()=>{
  const address=email();const issued=await request('/api/admin/links',{kind:'invite',email:address},adminCookie);expect(issued.status).toBe(200);const result=await issued.json();const token=new URLSearchParams(new URL(result.url).hash.slice(1)).get('token')!;personalTokens.push(token);
  const details=await request('/api/invitations/details',{token});expect(await details.json()).toEqual({kind:'invite',email:address,expiresAt:result.expiresAt});
  const mismatch=await request('/api/invitations/accept',{token,name:'Legacy',email:email(),password});expect(mismatch.status).toBe(400);
  const accepted=await request('/api/invitations/accept',{token,name:'Legacy',password});expect(accepted.status).toBe(200);expect(await accepted.json()).toEqual({ok:true,email:address,authenticated:false});expect(cookieFrom(accepted)).toBe('');
  expect((await database.sql`select email_verified,is_admin from users where email=${address}`)[0]).toMatchObject({email_verified:true,is_admin:false});
  const login=await request('/api/auth/sign-in/email',{email:address,password});expect(login.status).toBe(200);const cookie=cookieFrom(login);
  const recovery=await request('/api/admin/links',{kind:'recovery',email:address},adminCookie);expect(recovery.status).toBe(200);const recoveryToken=new URLSearchParams(new URL((await recovery.json()).url).hash.slice(1)).get('token')!;personalTokens.push(recoveryToken);
  expect((await request('/api/recovery/complete',{token:recoveryToken,password:'Eight123'})).status).toBe(200);expect((await request('/api/me',undefined,cookie)).status).toBe(401);expect((await request('/api/recovery/complete',{token:recoveryToken,password:'Another8'})).status).toBe(400);
  expect((await request('/api/auth/sign-up/email',{name:'Not invited',email:email(),password})).status).toBe(403);
  const common=await create();
  const noOrigin=await app.request(origin+'/api/invitations/accept',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token:common.token,name:'No origin',email:email(),password})});expect(noOrigin.status).toBe(403);
  const noJson=await app.request(origin+'/api/invitations/accept',{method:'POST',headers:{origin,'content-type':'text/plain'},body:'{}'});expect(noJson.status).toBe(415);
  const oversized=await request('/api/invitations/accept',{token:common.token,name:'Large',email:email(),password,extra:'x'.repeat(66000)});expect(oversized.status).toBe(413);expect((await stored(common.link.id)).registrations_count).toBe(0);
  const created=await createRegistrationLink(database,{registrationLimit:1,expiresAt:null},null);linkIds.push(created.link.id);const ordinary=await accept(created.token);expect(ordinary.status).toBe(200);expect((await (await request('/api/me',undefined,cookieFrom(ordinary))).json()).isAdmin).toBe(false);
 });
});
