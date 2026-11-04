import { realpathSync, statSync } from 'node:fs';
import { resolve, sep } from 'node:path';

// Same policy as deployment/nginx-http.conf; Pixi uses its CSP-safe renderer.
export const contentSecurityPolicy = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob: https://a1.marugotoweb.jp; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'";
export const securityHeaders = { 'Content-Security-Policy': contentSecurityPolicy, 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY', 'Permissions-Policy': 'camera=(), microphone=(), geolocation=()' };

export function staticHandler(dist = new URL('../../dist', import.meta.url).pathname, mediaRoot?: string, entry = 'index.html') {
  if (!['index.html', 'legacy.html'].includes(entry)) throw new Error('CLIENT_ENTRY must be index.html or legacy.html');
  return async (request: Request): Promise<Response> => {
    const headers = { ...securityHeaders, 'Cache-Control': 'no-cache' };
    if (!['GET', 'HEAD'].includes(request.method)) return new Response(null, { status: 405, headers: { ...headers, Allow: 'GET, HEAD' } });
    let path: string;
    try { path = decodeURIComponent(new URL(request.url).pathname); } catch { return new Response(null, { status: 400, headers }); }
    if (path.includes('\0') || path.includes('\\') || path.split('/').some(part => part === '..' || part.startsWith('.'))) return new Response(null, { status: 400, headers });
    const entryRoute = ['/', '/index.html', '/album.html', '/invite', '/recover', '/login', '/admin'].includes(path);
    if (entryRoute) path = '/' + entry;
    const roots = mediaRoot && /^\/(audio|word-illustrations|counters)\//.test(path) ? [mediaRoot, dist] : [dist];
    for (const root of roots) {
      const file = resolve(root, '.' + path);
      if (!file.startsWith(resolve(root) + sep)) continue;
      const blob = Bun.file(file);
      if (!await blob.exists()) continue;
      if (!statSync(file).isFile()) continue;
      if (!realpathSync(file).startsWith(realpathSync(root) + sep)) return new Response(null, { status: 403, headers });
      const immutable = /^\/audio\/[a-f0-9]{20,64}\.(m4a|mp3|ogg|wav)$/.test(path) || /^\/assets\/[^/]+-[\w-]{8}\.[\w]+$/.test(path);
      const cache = path.endsWith('.html') ? 'no-store' : immutable ? 'public, max-age=31536000, immutable' : 'no-cache';
      const stat = statSync(file), etag = `W/"${stat.size.toString(16)}-${stat.mtimeMs.toString(16)}"`;
      const responseHeaders = { ...headers, 'Cache-Control': cache, ETag: etag };
      if (cache !== 'no-store' && request.headers.get('If-None-Match') === etag) return new Response(null, {status:304,headers:responseHeaders});
      return new Response(request.method === 'HEAD' ? null : blob, { headers: { ...responseHeaders, 'Content-Type': blob.type, 'Content-Length': String(blob.size) } });
    }
    return new Response(null, { status: 404, headers });
  };
}
