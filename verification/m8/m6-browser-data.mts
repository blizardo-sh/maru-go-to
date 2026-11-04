// M8: historical assertions replayed against root sources and main build, isolated synthetic clone.
import './guard.mjs';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {connectDatabase} from '../../src/server/db';
const runtime=JSON.parse(readFileSync('.local/runtime.json','utf8')),url=new URL(runtime.database);assert.equal(url.hostname,'127.0.0.1');assert.match(url.pathname,/^\/japanese_pixi_m8_published_[0-9]+$/);assert.ok(process.argv.includes('--due'));
const index=Number(process.argv.at(-1));assert.ok(index>=0&&index<runtime.browserUsers.length);const db=connectDatabase(url.href);
try{const [owner]=await db.sql`select id from users where email=${runtime.browserUsers[index].email}`;assert.equal(owner.id,runtime.browserUsers[index].owner);await db.sql`update review_states set due=now()-interval '1 day' where user_id=${owner.id}`;console.log('Synthetic M6 due queue prepared.');}finally{await db.sql.close();}
