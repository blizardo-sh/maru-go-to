import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { hashPassword } from 'better-auth/crypto';
import { createApp } from '../src/server/app';
import { tokenHash } from '../src/server/auth';
import { configSchema } from '../src/server/config';
import { loadCourse } from '../src/server/course';
import { connectDatabase } from '../src/server/db';
import { createEmailAccess, takeAuthLimit } from '../src/server/email-access';
import { disposableDatabase } from './helpers/disposable-database';
import { nextFixtureIp } from './helpers/fixture-ip';
import { testMailbox } from './helpers/mailbox';

const url = process.env.JAPANESE_INTEGRATION_DATABASE_URL;
const origin = 'http://127.0.0.1:5173';
const password = 'Isolated-mail-access-password';
const config = { DATABASE_URL:url!, APP_URL:origin, BETTER_AUTH_SECRET:'isolated-email-access-secret-at-least-32-characters', HOST:'127.0.0.1', PORT:3000 };
const cookieFrom = (response:Response) => response.headers.getSetCookie().map(item => item.split(';')[0]).join('; ');

test('SMTP settings are optional as a group and never accept incomplete credentials', () => {
  expect(configSchema.safeParse({...config,DATABASE_URL:'postgres://localhost/test'}).success).toBe(true);
  expect(configSchema.safeParse({...config,DATABASE_URL:'postgres://localhost/test',SMTP_HOST:'smtp.gmail.com'}).success).toBe(false);
  expect(configSchema.safeParse({...config,DATABASE_URL:'postgres://localhost/test',SMTP_HOST:'smtp.gmail.com',SMTP_PORT:25,SMTP_USER:'a@example.test',SMTP_PASSWORD:'fixture',MAIL_FROM:'a@example.test'}).success).toBe(false);
});

(url ? describe : describe.skip)('open registration and email recovery on disposable PostgreSQL', () => {
  let database:ReturnType<typeof connectDatabase>, app:ReturnType<typeof createApp>;
  const mailbox = testMailbox(), emails:string[] = [];
  let ip = nextFixtureIp();
  const address = () => { const email=`mail-${crypto.randomUUID()}@example.test`; emails.push(email); return email; };
  const request = (path:string, body?:unknown, cookie='', target=app) => target.request(origin+path, {method:body===undefined?'GET':'POST',headers:{origin,'x-forwarded-for':ip,'content-type':'application/json',cookie},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const signup = (email:string) => request('/api/register',{name:'New student',email,password});
  const confirm = async (email:string) => { await app.drainMail(); return request('/api/email-verification/complete',{token:mailbox.token(email)}); };
  const login = (email:string, candidate=password) => request('/api/auth/sign-in/email',{email,password:candidate});
  beforeAll(() => {
    if (!disposableDatabase(new URL(url!))) throw new Error('Disposable localhost database required.');
    database=connectDatabase(url!); app=createApp({database,config,course:loadCourse(),sendMail:mailbox.send});
  });
  beforeEach(() => { ip=nextFixtureIp(); });
  afterAll(async () => {
    if (!database) return;
    await app.drainMail();
    for (const email of emails) { await database.sql`delete from access_links where email=${email}`; await database.sql`delete from users where email=${email}`; }
    await database.sql.close();
  });

  test('signup needs no invite, creates an ordinary learner, and blocks login until explicit single-use confirmation', async () => {
    const email=address(); const registered=await signup(' '+email.toUpperCase()+' ');
    expect(registered.status).toBe(200); expect(cookieFrom(registered)).toBe('');
    expect((await login(email)).status).toBe(403);
    const [user]=await database.sql`select * from users where email=${email}`;
    expect(user).toMatchObject({email_verified:false,email_verification_required:true,is_admin:false});
    expect(await database.sql`select id from sessions where user_id=${user.id}`).toHaveLength(0);
    await app.drainMail(); const token=mailbox.token(email); const message=mailbox.messages.find(item=>item.to===email)!;
    expect(message.url).toBe(origin+'/verify-email#token='+token);
    const [link]=await database.sql`select * from access_links where token_hash=${tokenHash(token)}`;
    expect(Object.values(link)).not.toContain(token); expect(link.user_id).toBe(user.id);
    expect((await request('/api/recovery/complete',{token,password:'DifferentPassword'})).status).toBe(400);
    expect((await request('/api/email-verification/complete',{token})).status).toBe(200);
    expect((await request('/api/email-verification/complete',{token})).status).toBe(400);
    const signedIn=await login(email); expect(signedIn.status).toBe(200);
    const cookie=cookieFrom(signedIn);
    expect(await (await request('/api/me',undefined,cookie)).json()).toMatchObject({email,emailVerified:true,isAdmin:false});
    expect((await request('/api/admin/users',undefined,cookie)).status).toBe(403);
    // The API also gates a stale/rogue pending-account session, independently of login.
    await database.sql`update users set email_verified=false where id=${user.id}`;
    expect((await request('/api/me',undefined,cookie)).status).toBe(403);
  });

  test('duplicate registration is generic and cannot overwrite a password, name, role or progress', async () => {
    const email=address(); expect((await signup(email)).status).toBe(200);
    const [before]=await database.sql`select u.*,a.password from users u join accounts a on a.user_id=u.id where email=${email}`;
    expect(await (await request('/api/register',{name:'Intruder',email:email.toUpperCase(),password:'OtherPassword'})).json()).toEqual({ok:true});
    const [after]=await database.sql`select u.*,a.password from users u join accounts a on a.user_id=u.id where email=${email}`;
    expect(after).toEqual(before);
    expect((await confirm(email)).status).toBe(200); expect((await login(email)).status).toBe(200);
    expect((await login(email,'OtherPassword')).status).toBe(401);
  });

  test('legacy users retain access and progress; only password-proven mailbox confirmation enables reset', async () => {
    const email=address(), id=crypto.randomUUID(), hash=await hashPassword(password);
    await database.sql`insert into users(id,name,email,email_verified,email_verification_required) values(${id},'Existing student',${email},false,false)`;
    await database.sql`insert into accounts(id,account_id,provider_id,user_id,password) values(${crypto.randomUUID()},${id},'credential',${id},${hash})`;
    await database.sql`insert into learning_states(user_id,lesson_id,route_version,state) values(${id},'preserved-progress','1',${{step:9}})`;
    const signedIn=await login(email); expect(signedIn.status).toBe(200); const cookie=cookieFrom(signedIn);
    for (const path of ['/api/recovery/request','/api/email-verification/request']) expect(await (await request(path,{email})).json()).toEqual({ok:true});
    await app.drainMail(); expect(mailbox.messages.filter(item=>item.to===email)).toHaveLength(0);
    expect((await request('/api/account/verify-email/request',{password:'incorrect'},cookie)).status).toBe(400);
    expect((await request('/api/account/verify-email/request',{password},cookie)).status).toBe(200);
    expect((await confirm(email)).status).toBe(200);
    expect((await request('/api/me',undefined,cookie)).status).toBe(200);
    expect((await database.sql`select state from learning_states where user_id=${id}`)[0].state).toEqual({step:9});
    expect((await request('/api/recovery/request',{email})).status).toBe(200);
    await app.drainMail(); expect(mailbox.token(email,'recovery')).toBeTruthy();
  });

  test('recovery responses conceal account existence; a reset revokes all sessions and cannot be reused', async () => {
    const email=address(); await signup(email); await confirm(email);
    const cookies=[cookieFrom(await login(email)),cookieFrom(await login(email))];
    const missing=await request('/api/recovery/request',{email:address()});
    const known=await request('/api/recovery/request',{email}); expect(known.status).toBe(missing.status); expect(await known.json()).toEqual(await missing.json());
    await app.drainMail(); const token=mailbox.token(email,'recovery');
    expect((await request('/api/email-verification/complete',{token})).status).toBe(400);
    expect((await request('/api/recovery/complete',{token,password:'short'})).status).toBe(400);
    expect((await request('/api/recovery/complete',{token,password:'ChangedPassword123'})).status).toBe(200);
    for (const cookie of cookies) expect((await request('/api/me',undefined,cookie)).status).toBe(401);
    expect((await request('/api/recovery/complete',{token,password})).status).toBe(400);
    ip=nextFixtureIp(); expect((await login(email)).status).toBe(401); expect((await login(email,'ChangedPassword123')).status).toBe(200);
  });

  test('resends are durable, bounded, invalidate previous links and reject expired links', async () => {
    const email=address(); await signup(email); await app.drainMail(); const first=mailbox.token(email);
    const restarted=createApp({database,config,course:loadCourse(),sendMail:mailbox.send});
    for (let attempt=0;attempt<3;attempt++) await request('/api/email-verification/request',{email},'',restarted);
    await restarted.drainMail(); expect(mailbox.messages.filter(item=>item.to===email)).toHaveLength(1);
    await database.sql`update auth_limits set expires_at=now()-interval '1 second' where key=${'mail:verify:cooldown:'+tokenHash(email)}`;
    await request('/api/email-verification/request',{email},'',restarted); await restarted.drainMail(); const second=mailbox.token(email);
    expect(second).not.toBe(first); expect((await request('/api/email-verification/complete',{token:first})).status).toBe(400);
    await database.sql`update access_links set expires_at=now()-interval '1 second' where token_hash=${tokenHash(second)}`;
    expect((await request('/api/email-verification/complete',{token:second})).status).toBe(400);
    const key='fixture-limit:'+crypto.randomUUID();
    const claims=await Promise.all(Array.from({length:12},()=>takeAuthLimit(database,key,3,3600)));
    expect(claims.filter(Boolean)).toHaveLength(3); await database.sql`delete from auth_limits where key=${key}`;
  });

  test('malicious inputs, foreign origins and built-in bypass routes are rejected', async () => {
    const email=address();
    for (const body of [{name:'Student',email,password,isAdmin:true},{name:'Student',email,password:'short'},{name:'Student',email,password:'x'.repeat(129)},{name:'Student',email:'bad',password}]) expect((await request('/api/register',body)).status).toBe(400);
    const foreign=await app.request(origin+'/api/register',{method:'POST',headers:{origin:'https://attacker.example','content-type':'application/json'},body:JSON.stringify({name:'Student',email,password})}); expect(foreign.status).toBe(403);
    for (const path of ['/api/auth/sign-up/email','/api/auth/request-password-reset','/api/auth/send-verification-email','/api/auth/reset-password']) expect((await request(path,{email,password})).status).toBe(403);
    expect(await database.sql`select id from users where email=${email}`).toHaveLength(0);
    const noMail=createApp({database,config,course:loadCourse()}); expect((await request('/api/register',{name:'Student',email,password},'',noMail)).status).toBe(503);
  });

  test('delivery failures expose no SMTP details and remain retryable', async () => {
    const email=address(); await signup(email); await app.drainMail();
    await database.sql`update auth_limits set expires_at=now()-interval '1 second' where key=${'mail:verify:cooldown:'+tokenHash(email)}`;
    let failures=0;
    const service=createEmailAccess(database,config,async()=>{throw new Error('SECRET SMTP DETAIL');},()=>{failures++;});
    service.request(email,'verify'); await service.drain(); expect(failures).toBe(1);
    await database.sql`update auth_limits set expires_at=now()-interval '1 second' where key=${'mail:verify:cooldown:'+tokenHash(email)}`;
    expect((await request('/api/email-verification/request',{email})).status).toBe(200); expect((await confirm(email)).status).toBe(200);
  });

  test('migration clears historical email assertions without touching users, sessions or progress', async () => {
    const schema='migration_'+crypto.randomUUID().replaceAll('-','');
    await database.sql.begin(async tx => {
      await tx.unsafe(`create schema ${schema}`); await tx.unsafe(`set local search_path to ${schema}`);
      await tx`create table users(id text primary key,email_verified boolean not null)`;
      await tx`create table access_links(token_hash text primary key)`;
      await tx`create table sessions(user_id text,token text)`;
      await tx`create table progress(user_id text,value integer)`;
      await tx`insert into users values('old',true),('older',false)`;
      await tx`insert into sessions values('old','existing-session')`; await tx`insert into progress values('old',42)`;
      const migration=await Bun.file(new URL('../db/migrations/0007_email_access.sql',import.meta.url)).text();
      for (const statement of migration.split('--> statement-breakpoint')) await tx.unsafe(statement);
      expect(await tx`select * from users order by id`).toEqual([{id:'old',email_verified:false,email_verification_required:false},{id:'older',email_verified:false,email_verification_required:false}]);
      expect(await tx`select * from sessions`).toEqual([{user_id:'old',token:'existing-session'}]);
      expect(await tx`select * from progress`).toEqual([{user_id:'old',value:42}]);
      await tx.unsafe(`drop schema ${schema} cascade`);
    });
  });
});
