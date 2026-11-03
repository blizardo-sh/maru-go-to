import { expect, test } from 'bun:test';
import { api } from '../src/client/api';

test('course reuse requires server validation and stays isolated by learner and publication', async () => {
  const original = globalThis.fetch, owner = crypto.randomUUID();
  let count = 0;
  globalThis.fetch = (async (_url: unknown, init: RequestInit) => {
    const headers = new Headers(init.headers); count++;
    if (count === 1) { expect(headers.has('If-None-Match')).toBe(false); return Response.json({version:1}, {headers:{ETag:'W/"one"'}}); }
    if (count === 2) { expect(headers.get('If-None-Match')).toBe('W/"one"'); return new Response(null,{status:304}); }
    if (count === 3) return Response.json({version:2},{headers:{ETag:'W/"two"'}});
    expect(headers.has('If-None-Match')).toBe(false); return Response.json({error:{message:'Войдите'}},{status:401});
  }) as typeof fetch;
  try {
    const init = {headers:{'X-Learning-Learner-Id':owner}};
    expect(await api('/api/course',init)).toEqual({version:1});
    expect(await api('/api/course',init)).toEqual({version:1});
    expect(await api('/api/course',init)).toEqual({version:2});
    await expect(api('/api/course',{headers:{'X-Learning-Learner-Id':owner+'other'}})).rejects.toThrow('Войдите');
    await expect(api('/api/course',{headers:{...init.headers,'X-Content-Publication':'other'}})).rejects.toThrow('Войдите');
  } finally {globalThis.fetch=original;}
});
