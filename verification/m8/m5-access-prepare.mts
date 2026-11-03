// M8: historical assertions replayed against root sources and main build, isolated synthetic clone.
import './guard.mjs';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {connectDatabase} from '../../src/server/db';
import {createLink,consumeLink,createRegistrationLink} from '../../src/server/auth';
const path=new URL('./.local/runtime.json',import.meta.url),runtime=JSON.parse(readFileSync(path,'utf8')),url=new URL(runtime.database);assert.equal(url.hostname,'127.0.0.1');assert.match(url.pathname,/^\/japanese_pixi_m8_published_[0-9]+$/);const db=connectDatabase(url.href);
try{
 const email=`m5-admin-${crypto.randomUUID()}@example.test`,password=crypto.randomUUID() + crypto.randomUUID();const invite=await createLink(db,'invite',email,null);assert.equal(await consumeLink(db,'invite',invite.token,password,'Проверка администратора M5'),true);const owner=(await db.sql`select id from users where email=${email}`)[0]!.id;
 await db.sql`update users set is_admin=true where id=${owner} and email=${email}`;runtime.adminUser={email,password,owner};
 runtime.accessLinks={};
 for(const name of ['private','expired']){const email=`m5-invite-${crypto.randomUUID()}@example.test`,link=await createLink(db,'invite',email,owner);if(name==='expired')await db.sql`update access_links set expires_at=now()-interval '1 minute' where token_hash=${(await import('../../src/server/auth')).tokenHash(link.token)}`;runtime.accessLinks[name]={token:link.token,email};}
 const registration=await createRegistrationLink(db,{registrationLimit:1,expiresAt:new Date(Date.now()+3600000).toISOString()},owner);runtime.accessLinks.registration={token:registration.token,id:registration.link.id};
 const recovery=await createLink(db,'recovery',email,owner);runtime.accessLinks.recovery={token:recovery.token,email};
 writeFileSync(path,JSON.stringify(runtime),{mode:0o600});console.log('New synthetic administrator and access links prepared only in disposable M5 clone.');
}finally{await db.sql.close();}
