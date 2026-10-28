import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';

const root = new URL('.', import.meta.url).pathname;
const nginx = await readFile(resolve(root, '../../deployment/nginx-http.conf'), 'utf8');
const csp = nginx.match(/add_header Content-Security-Policy "([^"]+)" always;/)?.[1];
if (!csp) throw new Error('Production CSP not found');
const dist = resolve(root, 'dist');
const assets = resolve(root, '../../public');
const studies = resolve(root, 'art-direction');
const types = { '.html':'text/html; charset=utf-8', '.js':'application/javascript; charset=utf-8', '.css':'text/css', '.json':'application/json', '.webp':'image/webp', '.png':'image/png', '.jpg':'image/jpeg', '.ttf':'font/ttf', '.woff2':'font/woff2', '.m4a':'audio/mp4', '.mp4':'video/mp4' };

createServer(async (req, res) => {
  res.setHeader('Content-Security-Policy', csp);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cache-Control', 'no-store');
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (pathname === '/' && !new URL(req.url, 'http://localhost').search) { res.writeHead(302, { Location: '/paper.html' }).end(); return; }
    if (pathname.startsWith('/api')) { res.writeHead(404).end(); return; }
    if (pathname === '/__meta') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ csp, mode: 'production-build', persistence: false })); return;
    }
    const isStudy = pathname.startsWith('/studies/');
    const base = isStudy ? studies : pathname === '/' || pathname === '/paper.html' || pathname.startsWith('/assets/') ? dist : assets;
    const relative = isStudy ? pathname.slice('/studies'.length) : pathname;
    const file = resolve(base, '.' + (relative === '/' ? '/index.html' : relative));
    if (!file.startsWith(base + sep) || !(await stat(file)).isFile()) { res.writeHead(404).end(); return; }
    res.setHeader('Content-Type', types[extname(file)] || 'application/octet-stream');
    res.end(await readFile(file));
  } catch { res.writeHead(404).end(); }
}).listen(5190, '127.0.0.1', () => console.log('Canvas lab with production CSP: http://127.0.0.1:5190/?view=lab'));
