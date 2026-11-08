import { expect, spyOn, test } from 'bun:test';
import { api } from '../src/client/api';
import { courseRepresentationHeader as header } from '../src/shared/course-representation';

test('course negotiation caches separately by owner, publication and representation, and tolerates an old server', async () => {
  const owner = crypto.randomUUID(), seen: Headers[] = [];
  const fetchSpy = spyOn(globalThis, 'fetch');
  fetchSpy.mockImplementation(Object.assign(async (_path: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers); seen.push(headers);
    if (headers.has('If-None-Match')) return new Response(null, { status: 304 });
    // An older server ignores the negotiation header and still returns a valid full Course.
    return Response.json({ title: 'Full legacy response', owner: headers.get('X-Learning-Learner-Id') }, { headers: { ETag: 'W/"old-full"' } });
  }, { preconnect() {} }));
  const request = (extra: Record<string,string> = {}) => api('/api/course', { headers: { 'X-Learning-Learner-Id': owner, 'X-Content-Publication': 'a'.repeat(64), ...extra } });
  try {
    const first = await request(); expect(seen.at(-1)!.get(header)).toBe('learner-v1');
    expect(await request()).toEqual(first); expect(seen.at(-1)!.get('If-None-Match')).toBe('W/"old-full"');
    await request({ [header]: 'full' }); expect(seen.at(-1)!.has('If-None-Match')).toBe(false);
    await request({ 'X-Content-Publication': 'b'.repeat(64) }); expect(seen.at(-1)!.has('If-None-Match')).toBe(false);
    await request({ 'X-Learning-Learner-Id': crypto.randomUUID() }); expect(seen.at(-1)!.has('If-None-Match')).toBe(false);
    await api('/api/bootstrap'); expect(seen.at(-1)!.get(header)).toBe('learner-v1');
    await api('/api/reviews'); expect(seen.at(-1)!.has(header)).toBe(false);
  } finally { fetchSpy.mockRestore(); }
});
