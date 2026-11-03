import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {connectDatabase} from '../../src/server/db';
import {createLink,consumeLink} from '../../src/server/auth';
const path='.local/runtime.json',r=JSON.parse(readFileSync(path,'utf8')),u=new URL(r.database);
assert.equal(u.hostname,'127.0.0.1');assert.equal(u.port,'55440');assert.match(u.pathname,/^\/japanese_pixi_m8_published_\d+$/);
assert.equal(r.browserUsers.length,0,'Never replace prepared profiles');const db=connectDatabase(u.href);
try{for(const label of ['chrome','webkit','safari','protocol','acceptance','entry']){const email='m8-'+label+'-'+crypto.randomUUID()+'@example.test',password=crypto.randomUUID()+crypto.randomUUID();const l=await createLink(db,'invite',email,null);assert.equal(await consumeLink(db,'invite',l.token,password,'Проверка M8'),true);const owner=(await db.sql`select id from users where email=${email}`)[0].id;const user={email,password,owner};if(label==='acceptance')r.acceptanceUser=user;else if(label==='entry')r.entryUser=user;else r.browserUsers.push(user);}
r.browserEmail=r.acceptanceUser.email;r.browserPassword=r.acceptanceUser.password;r.owner=r.acceptanceUser.owner;writeFileSync(path,JSON.stringify(r),{mode:0o600});console.log(JSON.stringify({newSyntheticProfiles:6}));}finally{await db.sql.close();}
