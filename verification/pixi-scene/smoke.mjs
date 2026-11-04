import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const url = process.env.PIXI_PREVIEW_URL || 'http://127.0.0.1:5188/';
const output = new URL('./test-results/', import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = [];
const apiRequests = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api')) apiRequests.push(request.url()); });
  await page.goto(url);
  await page.locator('#scene[data-ready="true"]').waitFor();
  assert.equal(await page.locator('canvas').count(), 1);

  for (const [label, id] of [['Тёплая комната', 'room'], ['Сад и веранда', 'garden'], ['Горная хижина', 'mountains'], ['У реки', 'river'], ['Вечер в Токио', 'tokyo']]) {
    await page.getByRole('button', { name: label, exact: true }).click();
    await page.locator(`#scene[data-scene="${id}"]`).waitFor();
    await page.waitForTimeout(700);
    assert.equal(await page.getByRole('button', { name: label, exact: true }).getAttribute('aria-pressed'), 'true');
    await page.screenshot({ path: new URL(`desktop-${id}.png`, output).pathname });
  }

  await page.locator('#backgrounds button').evaluateAll(buttons => { buttons[3].click(); buttons[1].click(); buttons[0].click(); });
  await page.locator('#scene[data-scene="room"]').waitFor();
  await page.waitForTimeout(700);
  assert.equal(await page.locator('#backgrounds [aria-pressed="true"]').getAttribute('aria-label'), 'Тёплая комната');
  await page.locator('#flashcard').click();
  assert.equal(await page.locator('#answer').isVisible(), true);
  await page.getByRole('button', { name: 'Помню', exact: true }).click();
  assert.equal(await page.locator('#scene').getAttribute('data-reaction'), 'good');
  await page.getByRole('button', { name: 'Ещё раз', exact: true }).click();
  assert.equal(await page.locator('#scene').getAttribute('data-reaction'), 'again');
  await page.getByRole('button', { name: 'Погладить кота', exact: true }).click();
  assert.equal(await page.locator('#scene').getAttribute('data-reaction'), 'pet');
  await page.waitForTimeout(1700);
  await page.mouse.click(1440 * .71, 900 * .75 - 120);
  assert.equal(await page.locator('#scene').getAttribute('data-reaction'), 'pet', 'The actual canvas cat must be clickable.');
  await page.getByRole('button', { name: 'Скрыть карточку' }).click();
  assert.equal(await page.locator('#study').isVisible(), false);
  await page.getByRole('button', { name: 'Показать карточку' }).click();
  assert.equal(await page.locator('#study').isVisible(), true);
  await page.getByRole('button', { name: 'Остановить движение' }).click();
  assert.equal(await page.locator('#scene').getAttribute('data-motion'), 'false');

  for (const [width, height] of [[768, 1024], [390, 844], [320, 740], [844, 390]]) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(1000);
    const geometry = await page.evaluate(() => ({
      documentWidth: document.documentElement.scrollWidth,
      viewport: innerWidth,
      card: document.querySelector('#study').getBoundingClientRect().toJSON(),
      picker: document.querySelector('.scene-picker').getBoundingClientRect().toJSON(),
      pet: document.querySelector('#pet').getBoundingClientRect().toJSON(),
      buttons: [...document.querySelectorAll('button')].filter(button => button.getClientRects().length).map(button => ({ name: button.textContent, width: button.getBoundingClientRect().width, height: button.getBoundingClientRect().height })),
    }));
    assert.ok(geometry.documentWidth <= geometry.viewport, `No horizontal page overflow at ${width}px.`);
    assert.ok(geometry.card.bottom < geometry.picker.top, `The card must not overlap the background picker at ${width}px.`);
    assert.ok(geometry.pet.bottom < geometry.picker.top, `The cat button must not overlap the background picker at ${width}px.`);
    for (const button of geometry.buttons) assert.ok(button.height >= 44, `${button.name}: touch target ${button.height}px`);
    await page.screenshot({ path: new URL(`viewport-${width}.png`, output).pathname, fullPage: true });
  }

  const reduced = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  reduced.on('pageerror', error => errors.push(error.message));
  await reduced.goto(url);
  await reduced.locator('#scene[data-ready="true"]').waitFor();
  assert.equal(await reduced.locator('#scene').getAttribute('data-motion'), 'false');
  const still = await reduced.locator('canvas').screenshot();
  await reduced.waitForTimeout(400);
  assert.deepEqual(await reduced.locator('canvas').screenshot(), still, 'Reduced motion must leave the canvas still.');
  await reduced.getByRole('button', { name: 'Вечер в Токио', exact: true }).click();
  await reduced.locator('#scene[data-scene="tokyo"]').waitFor();
  await reduced.screenshot({ path: new URL('reduced-motion.png', output).pathname });

  const resizing = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  resizing.on('pageerror', error => errors.push(error.message));
  await resizing.route('**/scenes/garden-mobile-v1.webp', async route => {
    await new Promise(resolve => setTimeout(resolve, 500));
    await route.continue();
  });
  await resizing.goto(url);
  await resizing.locator('#scene[data-ready="true"]').waitFor();
  await resizing.getByRole('button', { name: 'Сад и веранда', exact: true }).click();
  await resizing.setViewportSize({ width: 390, height: 844 });
  await resizing.locator('#scene[data-scene="garden"]').waitFor();
  assert.equal(await resizing.locator('#status').textContent(), 'Предпросмотр · без сохранения');
  assert.deepEqual(apiRequests, [], 'The prototype must not contact the app API.');
  assert.deepEqual(errors, [], 'No browser errors.');
  console.log('PASS: 5 backgrounds, rapid switching, resize during loading, card, cat hit test, reactions, motion controls, 4 responsive sizes, static reduced motion, no API requests or browser errors.');
} finally {
  await browser.close();
}
