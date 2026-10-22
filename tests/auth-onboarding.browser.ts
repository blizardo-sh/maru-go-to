import { chromium, expect } from '@playwright/test';
import { connectDatabase } from '../src/server/db';
import { createLink, tokenHash } from '../src/server/auth';
import { nextFixtureIp } from './helpers/fixture-ip';

const databaseUrl = process.env.JAPANESE_INTEGRATION_DATABASE_URL;
if (!databaseUrl || new URL(databaseUrl).hostname !== '127.0.0.1' || new URL(databaseUrl).pathname !== '/japanese_app_test') throw new Error('Use only disposable localhost japanese_app_test.');
const base = process.env.GUIDED_BROWSER_URL;
const api = process.env.GUIDED_BROWSER_API_URL;
if (!base || !api || new URL(base).hostname !== 'localhost' || new URL(api).hostname !== 'localhost') throw new Error('Use the isolated dynamic browser launcher only.');
const fixtureIp = nextFixtureIp();
const database = connectDatabase(databaseUrl);
const email = `onboarding-${crypto.randomUUID()}@example.test`;
const expiredEmail = `expired-${crypto.randomUUID()}@example.test`;
const password = 'Isolated-auth-browser-fixture-only!';
const link = await createLink(database, 'invite', email, null);
const expired = await createLink(database, 'invite', expiredEmail, null);
await database.sql`update access_links set expires_at=now()-interval '1 minute' where token_hash=${tokenHash(expired.token)}`;
const invalidToken = crypto.randomUUID();
const sensitive = [link.token, expired.token, invalidToken, password];
let browser;
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': fixtureIp } });
  const page = await context.newPage();
  const acceptedRequests: { keys: string[]; name: string; emailSubmitted: boolean }[] = [];
  let signInRequests = 0;
  page.on('request', request => {
    const path = new URL(request.url()).pathname;
    if (path === '/api/invitations/accept' && request.method() === 'POST') {
      const body = request.postDataJSON();
      acceptedRequests.push({ keys: Object.keys(body).sort(), name: body.name, emailSubmitted: Object.hasOwn(body, 'email') });
    }
    if (path === '/api/auth/sign-in/email' && request.method() === 'POST') signInRequests++;
  });

  await page.goto(`${base}/invite#token=${link.token}`);
  await expect(page.getByRole('heading', { name: 'Принять приглашение', exact: true })).toBeVisible();
  const boundEmail = page.getByRole('textbox', { name: 'Email для входа', exact: true });
  await expect(boundEmail).toHaveValue(email);
  await expect(boundEmail).toHaveAttribute('readonly', '');
  const displayName = page.getByRole('textbox', { name: 'Имя в приложении', exact: true });
  await expect(displayName).toBeEditable();
  await displayName.fill('ivan');
  await page.getByLabel('Пароль', { exact: true }).fill(password);
  const acceptance = page.waitForResponse(response => new URL(response.url()).pathname === '/api/invitations/accept');
  await page.getByRole('button', { name: 'Создать аккаунт', exact: true }).click();
  const accepted = await acceptance;
  expect(accepted.status()).toBe(200);
  expect(await accepted.json()).toEqual({ ok: true, email, authenticated: false });
  expect(acceptedRequests).toEqual([{ keys: ['name','password','token'], name: 'ivan', emailSubmitted: false }]);
  const success = page.getByRole('status');
  await expect(success).toContainText('Аккаунт создан');
  await expect(success).toContainText(email);
  await expect(success).not.toContainText('Пароль изменён');

  await page.getByRole('button', { name: 'Перейти ко входу', exact: true }).click();
  const loginEmail = page.getByRole('textbox', { name: 'Email', exact: true });
  await expect(loginEmail).toHaveValue(email);
  await expect(loginEmail).toHaveAttribute('type', 'email');
  await loginEmail.fill('ivan');
  await page.getByLabel('Пароль', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  const invalidEmail = await loginEmail.evaluate(input => input instanceof HTMLInputElement && input.validity.typeMismatch);
  expect(invalidEmail).toBe(true);
  expect(signInRequests).toBe(0);
  await expect(page.getByRole('alert')).toContainText('Имя в приложении для входа не подходит');

  await loginEmail.fill(email);
  const signedIn = page.waitForResponse(response => new URL(response.url()).pathname === '/api/auth/sign-in/email');
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  expect((await signedIn).status()).toBe(200);
  await expect(page.getByRole('navigation', { name: 'Разделы' }).getByRole('button', { name: 'Учебник', exact: true })).toBeVisible();
  await page.getByLabel('Настройки и аккаунт', { exact: true }).click();
  await page.getByRole('button', { name: 'Выйти', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Войти', exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'Email', exact: true }).fill(email);
  await page.getByLabel('Пароль', { exact: true }).fill(password);
  const relogin = page.waitForResponse(response => new URL(response.url()).pathname === '/api/auth/sign-in/email');
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  expect((await relogin).status()).toBe(200);
  await expect(page.getByRole('navigation', { name: 'Разделы' }).getByRole('button', { name: 'Учебник', exact: true })).toBeVisible();
  await context.close();

  for (const [kind, token] of [['used',link.token], ['expired',expired.token], ['invalid',invalidToken]]) {
    const rejected = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': fixtureIp } });
    const invalidPage = await rejected.newPage();
    const details = invalidPage.waitForResponse(response => new URL(response.url()).pathname === '/api/invitations/details');
    await invalidPage.goto(`${base}/invite#token=${token}`);
    expect((await details).status()).toBe(400);
    await expect(invalidPage.getByRole('alert')).toContainText(/недействительна|использована|истекла|недоступна/);
    await expect(invalidPage.getByRole('button', { name: 'Создать аккаунт', exact: true })).toBeDisabled();
    console.info(`PASS ${kind} invitation is rejected before signup`);
    await rejected.close();
  }
  console.info(JSON.stringify({ browser: browser.version(), readonlyBoundEmail: true, separateDisplayName: true, signupSuccessCopy: 'account-created', invalidEmailRequests: 0, signInAndReloginStatus: 200, rejectedInvitations: 3 }));
} catch (error) {
  let message = error instanceof Error ? error.message : String(error);
  for (const value of sensitive) message = message.replaceAll(value, '<REDACTED>');
  console.error(message);
  process.exitCode = 1;
} finally {
  await browser?.close();
  for (const fixtureEmail of [email, expiredEmail]) {
    await database.sql`delete from access_links where email=${fixtureEmail}`;
    await database.sql`delete from users where email=${fixtureEmail}`;
  }
  await database.sql.close();
}
