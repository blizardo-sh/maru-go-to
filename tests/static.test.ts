import { afterAll, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync, mkdirSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { staticHandler, contentSecurityPolicy } from '../src/server/static';
const root=mkdtempSync(join(tmpdir(),'japanese-static-')),dist=join(root,'dist');mkdirSync(dist);
writeFileSync(join(dist,'index.html'),'canvas');writeFileSync(join(dist,'legacy.html'),'compatible react');
mkdirSync(join(dist,'assets'));writeFileSync(join(dist,'assets/app.js'),'export {};');writeFileSync(join(root,'private.txt'),'private');symlinkSync(join(root,'private.txt'),join(dist,'leak.txt'));
afterAll(()=>rmSync(root,{recursive:true,force:true}));
const request=(path:string,method='GET')=>new Request('http://localhost:5202'+path,{method});
test('hashed build assets survive reloads; mutable assets use validators',async()=>{
 writeFileSync(join(dist,'assets','book-Ab12_cd-.webp'),'book');
 const handle=staticHandler(dist),asset=await handle(request('/assets/book-Ab12_cd-.webp'));
 expect(asset.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
 const first=await handle(request('/assets/app.js')),etag=first.headers.get('etag');
 expect(etag).toBeTruthy();
 const unchanged=await handle(new Request('http://localhost:5202/assets/app.js',{headers:{'If-None-Match':etag!}}));
 expect(unchanged.status).toBe(304);expect(await unchanged.text()).toBe('');
 writeFileSync(join(dist,'assets/app.js'),'export const changed=true;');
 expect((await handle(new Request('http://localhost:5202/assets/app.js',{headers:{'If-None-Match':etag!}}))).status).toBe(200);
});
test('only content-addressed speech is cached permanently; mutable manifests revalidate', async()=>{
 mkdirSync(join(dist,'audio'));writeFileSync(join(dist,'audio','abcdef0123456789abcd.m4a'),'audio');writeFileSync(join(dist,'audio','manifest.json'),'{}');
 const handle=staticHandler(dist);
 expect((await handle(request('/audio/abcdef0123456789abcd.m4a'))).headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
 expect((await handle(request('/audio/manifest.json'))).headers.get('cache-control')).toBe('no-cache');
});
test('entry switch preserves same-origin access and explicit compatibility routes',async()=>{
 for(const entry of ['index.html','legacy.html']){const handle=staticHandler(dist,undefined,entry);for(const route of ['/','/index.html','/invite?token=x','/recover','/login','/admin']){const res=await handle(request(route));expect(await res.text()).toBe(entry==='index.html'?'canvas':'compatible react');expect(res.headers.get('cache-control')).toBe('no-store');expect(res.headers.get('content-security-policy')).toBe(contentSecurityPolicy);}
 expect(await(await handle(request('/legacy.html'))).text()).toBe('compatible react');}
 expect(()=>staticHandler(dist,undefined,'../../private.txt')).toThrow();
});
test('missing assets, malformed paths, symlinks and methods never return the shell',async()=>{
 const handle=staticHandler(dist);for(const path of ['/missing','/assets/no.js','/assets/'])expect((await handle(request(path))).status).toBe(404);
 for(const path of ['/%00','/%5cprivate','/.env','/%ZZ'])expect((await handle(request(path))).status).toBe(400);
 expect((await handle(request('/leak.txt'))).status).toBe(403);expect((await handle(request('/','POST'))).status).toBe(405);
 const get=await handle(request('/assets/app.js')),head=await handle(request('/assets/app.js','HEAD'));expect(get.headers.get('content-type')).toContain('javascript');expect(head.headers.get('content-length')).toBe(get.headers.get('content-length'));expect(await head.text()).toBe('');
});
