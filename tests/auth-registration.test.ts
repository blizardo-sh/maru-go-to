import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { createApp } from '../src/server/app';
import { createLink, tokenHash } from '../src/server/auth';
import { connectDatabase } from '../src/server/db';
import { loadCourse } from '../src/server/course';
import { nextFixtureIp } from './helpers/fixture-ip';

const url=process.env.JAPANESE_INTEGRATION_DATABASE_URL;
const suite=url?describe:describe.skip;
const origin='http://127.0.0.1:5173';
suite('invitation registration and login identity',()=>{
 let database:ReturnType<typeof connectDatabase>;let app:ReturnType<typeof createApp>;
 const fixtureEmails:string[]=[];const fixtureTokens:string[]=[];
 const password='Only-an-isolated-regression-password-2026!';let fixtureIp=nextFixtureIp();
 beforeEach(()=>{fixtureIp=nextFixtureIp();});
 const request=(path:string,body:unknown,cookie='')=>app.request(origin+path,{method:'POST',headers:{origin,'x-forwarded-for':fixtureIp,'content-type':'application/json',...(cookie?{cookie}:{})},body:JSON.stringify(body)});
 const cookieFrom=(response:Response)=>response.headers.getSetCookie().map(part=>part.split(';')[0]).join('; ');
 beforeAll(()=>{
  const target=new URL(url!);if(!['localhost','127.0.0.1'].includes(target.hostname)||target.pathname!=='/japanese_app_test')throw new Error('Use only disposable localhost japanese_app_test.');
  database=connectDatabase(url!);app=createApp({database,course:loadCourse(),config:{DATABASE_URL:url!,BETTER_AUTH_SECRET:'isolated-regression-secret-at-least-32-characters',APP_URL:origin,HOST:'127.0.0.1',PORT:3000}});
 });
 afterAll(async()=>{if(!database)return;for(const token of fixtureTokens)await database.sql`delete from access_links where token_hash=${tokenHash(token)}`;for(const email of fixtureEmails){await database.sql`delete from access_links where email=${email}`;await database.sql`delete from users where email=${email}`;}await database.sql.close();});
 test('name ivan is not an email: show the invitation identity across registration, logout and login',async()=>{
  const email=`onboarding-${crypto.randomUUID()}@example.test`;fixtureEmails.push(email);const link=await createLink(database,'invite',email,null);fixtureTokens.push(link.token);
  const details=await request('/api/invitations/details',{token:link.token});
  const accepted=await request('/api/invitations/accept',{token:link.token,name:'ivan',password});expect(accepted.status).toBe(200);const created=await accepted.json();
  const mistaken=await request('/api/auth/sign-in/email',{email:'ivan',password});expect(mistaken.status).toBe(400);
  const signedIn=await request('/api/auth/sign-in/email',{email,password});expect(signedIn.status).toBe(200);const cookie=cookieFrom(signedIn);
  const signedOut=await request('/api/auth/sign-out',{},cookie);expect(signedOut.status).toBe(200);
  const signedInAgain=await request('/api/auth/sign-in/email',{email,password});expect(signedInAgain.status).toBe(200);
  expect(details.status).toBe(200);expect((await details.json()).email).toBe(email);expect(created.email).toBe(email);expect((await request('/api/invitations/details',{token:link.token})).status).toBe(400);
 });
 test('invalid submitted email is rejected without consuming the invitation',async()=>{
  const email=`invalid-submission-${crypto.randomUUID()}@example.test`;fixtureEmails.push(email);const link=await createLink(database,'invite',email,null);fixtureTokens.push(link.token);
  const response=await request('/api/invitations/accept',{token:link.token,name:'Valid name',email:'ivan',password});expect(response.status).toBe(400);
  const [row]=await database.sql`select used_at from access_links where token_hash=${tokenHash(link.token)}`;expect(row.used_at).toBeNull();
  expect((await request('/api/invitations/accept',{token:link.token,name:'Valid name',password})).status).toBe(200);
 });
 test('legacy malformed invitation is rejected without creating an unusable account or consuming its token',async()=>{
  const token=crypto.randomUUID();fixtureTokens.push(token);const [{count:before}]=await database.sql`select count(*)::int as count from users where email='ivan'`;
  await database.sql`insert into access_links(token_hash,kind,email,expires_at) values(${tokenHash(token)},'invite','ivan',now()+interval '1 hour')`;
  expect((await request('/api/invitations/details',{token})).status).toBe(400);expect((await request('/api/invitations/accept',{token,name:'ivan',password})).status).toBe(400);
  const [link]=await database.sql`select used_at from access_links where token_hash=${tokenHash(token)}`;expect(link.used_at).toBeNull();const [{count:after}]=await database.sql`select count(*)::int as count from users where email='ivan'`;expect(after).toBe(before);
 });
 test('invite creation and login apply the same trimmed lowercase email identity',async()=>{
  const email=`normalized-${crypto.randomUUID()}@example.test`;fixtureEmails.push(email);const raw='  '+email.toUpperCase()+'  ';const link=await createLink(database,'invite',raw,null);fixtureTokens.push(link.token);
  const details=await request('/api/invitations/details',{token:link.token});expect(details.status).toBe(200);expect((await details.json()).email).toBe(email);
  expect((await request('/api/invitations/accept',{token:link.token,name:'Another learner',password})).status).toBe(200);expect((await request('/api/auth/sign-in/email',{email:raw,password})).status).toBe(200);
 });
 test('shared invitation creation rejects invalid email ivan before storing a link',async()=>{
  const [{count:before}]=await database.sql`select count(*)::int as count from access_links where email='ivan'`;let createdToken:string|undefined;const creating=createLink(database,'invite','ivan',null).then(result=>{createdToken=result.token;fixtureTokens.push(result.token);return result;});
  await expect(creating).rejects.toThrow();expect(createdToken).toBeUndefined();const [{count:after}]=await database.sql`select count(*)::int as count from access_links where email='ivan'`;expect(after).toBe(before);
 });
});
