import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { hashPassword } from 'better-auth/crypto';
import { createHash, randomBytes } from 'node:crypto';
import type { Database } from './db';
import type { Config } from './config';
import * as schema from './schema';
import { emailSchema } from './validation';
import type { InvitationDetails } from '../shared/types';
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
  if(!link)return null;
  const email=emailSchema.safeParse(link.email);
  return email.success?{email:email.data,expiresAt:new Date(link.expires_at).toISOString()}:null;
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
      await tx`insert into users(id,name,email,email_verified,is_admin) values(${id},${name},${email},true,${count===0})`;
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
