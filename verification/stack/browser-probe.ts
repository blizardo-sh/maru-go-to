import { chromium, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { once } from 'node:events';

const server = createServer(async (request, response) => {
  const path = new URL(request.url ?? '/', 'http://localhost').pathname;
  if (path !== '/' && !/^\/assets\/[a-zA-Z0-9_.-]+$/.test(path)) {
    response.writeHead(404).end();
    return;
  }
  try {
    const content = await readFile(new URL(`./dist${path === '/' ? '/index.html' : path}`, import.meta.url));
    response.setHeader('Content-Type', path.endsWith('.js') ? 'text/javascript' : 'text/html; charset=utf-8');
    response.end(content);
  } catch { response.writeHead(404).end(); }
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const address = server.address();
if (!address || typeof address === 'string') throw new Error('Missing HTTP address');

let browser;
try {
  const channel = process.env.STACK_PROBE_BROWSER === 'chromium' ? undefined : 'chrome';
  browser = await chromium.launch({ channel, headless: true });
  for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${address.port}/`);
    await expect(page.getByRole('heading')).toHaveText('Stack compatibility probe');
    const token = page.getByRole('button', { name: /家族/ });
    await token.focus();
    await expect(token).toBeFocused();
    await expect(page.locator('ruby rt')).toHaveText('かぞく');
    await page.keyboard.press('Space');
    await page.keyboard.press('Escape');
    expect(errors).toEqual([]);
    await page.close();
  }
  console.log(JSON.stringify({ browser: browser.version(), mounted: ['React', 'Router', 'Query', 'DnD'], viewports: 2, pageErrors: 0 }));
} finally {
  await browser?.close();
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
