import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { hashPassword } from 'better-auth/crypto';
import { createHash, randomBytes } from 'node:crypto';
import type { Database } from './db';
import type { Config } from './config';
import * as schema from './schema';
import { emailSchema, invitationSchema, registrationLinkSchema } from './validation';
import type { InvitationDetails, RegistrationLink, RegistrationLinkInput } from '../shared/types';
export const tokenHash = (token:string) => createHash('sha256').update(token).digest('hex');
export function createAuth(database:Database,config:Config) {
  return betterAuth({ baseURL:config.APP_URL,secret:config.BETTER_AUTH_SECRET,database:drizzleAdapter(database.db,{provider:'pg',schema}),trustedOrigins:[config.APP_URL],
    emailAndPassword:{enabled:true,disableSignUp:true,minPasswordLength:8,maxPasswordLength:128},
    rateLimit:{enabled:true,window:60,max:100,customRules:{'/sign-in/email':{window:60,max:5}}},
    advanced:{useSecureCookies:new URL(config.APP_URL).protocol==='https:'},
    session:{expiresIn:60*60*24*30,updateAge:60*60*24},
  });
}
export async function createLink(database:Database,kind:'invite'|'recovery',email:string,createdBy:string|null) {
  email=emailSchema.parse(email);
  const token=randomBytes(32).toString('base64url');
  const expiresAt=new Date(Date.now()+(kind==='invite'?7*86400000:3600000));
  await database.sql.begin(async tx=>{
    await tx`select pg_advisory_xact_lock(hashtext(${kind+':'+email}))`;
    await tx`update access_links set used_at=now(),updated_at=now() where email=${email} and kind=${kind} and used_at is null`;
    await tx`insert into access_links(token_hash,kind,email,expires_at,created_by) values(${tokenHash(token)},${kind},${email},${expiresAt},${createdBy})`;
  });
  return {token,expiresAt:expiresAt.toISOString()};
}
export async function invitationDetails(database:Database,token:string):Promise<InvitationDetails|null> {
  const [link]=await database.sql`select email,expires_at from access_links where token_hash=${tokenHash(token)} and kind='invite' and used_at is null and expires_at>now()`;
  if(link){
    const email=emailSchema.safeParse(link.email);
    return email.success?{kind:'invite',email:email.data,expiresAt:new Date(link.expires_at).toISOString()}:null;
  }
  const [registration]=await database.sql`select id,registration_limit,registrations_count,expires_at,revoked_at,created_at from registration_links where token_hash=${tokenHash(token)}`;
  if(!registration)return null;
  const details=registrationLinkDetails(registration);
  return details.status==='active'?{kind:'registration',email:null,expiresAt:details.expiresAt,remainingRegistrations:details.remainingRegistrations}:null;
}
export async function consumeLink(database:Database,kind:'invite'|'recovery',token:string,password:string,name='Ученик') {
  const [available]=await database.sql`select email from access_links where token_hash=${tokenHash(token)} and kind=${kind} and used_at is null and expires_at>now()`;
  if(!available||!emailSchema.safeParse(available.email).success)return false;
  const hash=await hashPassword(password);
  return database.sql.begin(async tx=>{
    const [link]=await tx`select * from access_links where token_hash=${tokenHash(token)} and kind=${kind} for update`;
    if(!link||link.used_at||new Date(link.expires_at).getTime()<=Date.now()) return false;
    const parsedEmail=emailSchema.safeParse(link.email);
    if(!parsedEmail.success)return false;
    const email=parsedEmail.data;
    const [existing]=await tx`select id from users where email=${email}`;
    if(kind==='invite') {
      if(existing) return false;
      await tx`select pg_advisory_xact_lock(hashtext('bootstrap-first-admin'))`;
      const [{count}]=await tx`select count(*)::int as count from users`;
      const id=crypto.randomUUID();
      const [created]=await tx`insert into users(id,name,email,email_verified,is_admin) values(${id},${name},${email},true,${count===0}) on conflict(email) do nothing returning id`;
      if(!created)return false;
      await tx`insert into accounts(id,account_id,provider_id,user_id,password) values(${crypto.randomUUID()},${id},'credential',${id},${hash})`;
    } else {
      if(!existing) return false;
      await tx`update accounts set password=${hash},updated_at=now() where user_id=${existing.id} and provider_id='credential'`;
      await tx`delete from sessions where user_id=${existing.id}`;
    }
    await tx`update access_links set used_at=now(),updated_at=now() where token_hash=${tokenHash(token)}`;
    return true;
  });
}

type RegistrationRow={id:string;registration_limit:number|null;registrations_count:number;expires_at:Date|null;revoked_at:Date|null;created_at:Date};
function registrationLinkDetails(row:RegistrationRow):RegistrationLink {
  const remaining=row.registration_limit===null?null:Math.max(0,row.registration_limit-row.registrations_count);
  const status=row.revoked_at?'revoked':remaining===0?'exhausted':row.expires_at&&new Date(row.expires_at).getTime()<=Date.now()?'expired':'active';
  return {id:row.id,registrationLimit:row.registration_limit,registrationsCount:row.registrations_count,remainingRegistrations:remaining,expiresAt:row.expires_at?new Date(row.expires_at).toISOString():null,revokedAt:row.revoked_at?new Date(row.revoked_at).toISOString():null,createdAt:new Date(row.created_at).toISOString(),status};
}

export async function createRegistrationLink(database:Database,input:RegistrationLinkInput,createdBy:string|null) {
  const parsed=registrationLinkSchema.parse(input);
  const expiresAt=parsed.expiresAt===undefined?new Date(Date.now()+7*86400000):parsed.expiresAt===null?null:new Date(parsed.expiresAt);
  const token=randomBytes(32).toString('base64url');
  const [row]=await database.sql<RegistrationRow[]>`insert into registration_links(id,token_hash,registration_limit,expires_at,created_by) values(${crypto.randomUUID()},${tokenHash(token)},${parsed.registrationLimit},${expiresAt},${createdBy}) returning id,registration_limit,registrations_count,expires_at,revoked_at,created_at`;
  return {token,link:registrationLinkDetails(row!)};
}

export async function registrationLinksFor(database:Database):Promise<RegistrationLink[]> {
  const rows=await database.sql<RegistrationRow[]>`select id,registration_limit,registrations_count,expires_at,revoked_at,created_at from registration_links order by created_at desc,id desc`;
  return rows.map(registrationLinkDetails);
}

export async function revokeRegistrationLink(database:Database,id:string):Promise<RegistrationLink|null> {
  const [row]=await database.sql<RegistrationRow[]>`update registration_links set revoked_at=coalesce(revoked_at,now()),updated_at=now() where id=${id} returning id,registration_limit,registrations_count,expires_at,revoked_at,created_at`;
  return row?registrationLinkDetails(row):null;
}

export async function consumeRegistrationLink(database:Database,input:{token:string;name:string;email:string;password:string}):Promise<{ok:true;email:string}|{ok:false;reason:'INVALID_LINK'|'EMAIL_EXISTS'}> {
  const body=invitationSchema.extend({email:emailSchema}).parse(input);
  const details=await invitationDetails(database,body.token);
  if(!details||details.kind!=='registration')return {ok:false,reason:'INVALID_LINK'};
  const hash=await hashPassword(body.password);
  return database.sql.begin(async tx=>{
    // A link's last slot, revocation and account creation share this row lock.
    const [row]=await tx<RegistrationRow[]>`select id,registration_limit,registrations_count,expires_at,revoked_at,created_at from registration_links where token_hash=${tokenHash(body.token)} for update`;
    if(!row||registrationLinkDetails(row).status!=='active')return {ok:false,reason:'INVALID_LINK'} as const;
    const id=crypto.randomUUID();
    // The unique email also arbitrates simultaneous registrations on different links.
    const [created]=await tx`insert into users(id,name,email,email_verified,is_admin) values(${id},${body.name},${body.email},false,false) on conflict(email) do nothing returning id`;
    if(!created)return {ok:false,reason:'EMAIL_EXISTS'} as const;
    await tx`insert into accounts(id,account_id,provider_id,user_id,password) values(${crypto.randomUUID()},${id},'credential',${id},${hash})`;
    await tx`update registration_links set registrations_count=registrations_count+1,updated_at=now() where id=${row.id}`;
    return {ok:true,email:body.email} as const;
  });
}
