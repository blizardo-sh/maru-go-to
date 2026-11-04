import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const runtime=JSON.parse(readFileSync(new URL('./.local/runtime.json',import.meta.url),'utf8')),url=new URL(runtime.database);
assert.equal(url.hostname,'127.0.0.1');assert.equal(url.port,'55440');assert.match(url.pathname,/^\/japanese_pixi_m8_published_\d+$/);assert.equal(runtime.origin,'http://localhost:5202');
assert.ok(runtime.browserUsers.every(user=>user.email.endsWith('@example.test')));
