import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { SQL } from 'bun';
import { drizzle } from 'drizzle-orm/bun-sql';
import { and, eq, sql } from 'drizzle-orm';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { Hono } from 'hono';
import * as schema from './schema';

const url = process.env.STACK_PROBE_DATABASE_URL;
const suite = url ? describe : describe.skip;

suite('real PostgreSQL / native Bun.SQL / Drizzle / Better Auth', () => {
  let client: SQL;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  beforeAll(async () => {
    const target = new URL(url!);
    if (!['127.0.0.1', 'localhost'].includes(target.hostname) || target.pathname !== '/stack_compat') {
      throw new Error('Use only the disposable localhost stack_compat database.');
    }
    client = new SQL(url!, { max: 4 });
    db = drizzle({ client, schema });
    const present = await client`select to_regclass('public.probe_user') as table_name`;
    if (!present[0].table_name) {
      const files = Array.from(new Bun.Glob('generated/*.sql').scanSync('.')).sort();
      if (!files.length) throw new Error('Generate fixture migrations first.');
      await client.begin(async (tx) => {
        for (const file of files) {
          const content = await Bun.file(file).text();
          for (const statement of content.split('--> statement-breakpoint')) {
            if (statement.trim()) await tx.unsafe(statement);
          }
        }
      });
    }
  });
  afterAll(async () => { if (client) await client.close(); });

  test('Drizzle transaction rolls back and concurrent revision updates have one winner', async () => {
    const id = crypto.randomUUID();
    await db.insert(schema.state).values({ id });
    await expect(db.transaction(async (tx) => {
      await tx.update(schema.state).set({ revision: 2 }).where(eq(schema.state.id, id));
      throw new Error('deliberate-rollback');
    })).rejects.toThrow('deliberate-rollback');
    const rows = await db.select().from(schema.state).where(eq(schema.state.id, id));
    expect(rows[0]?.revision).toBe(1);
    const update = () => db.transaction((tx) => tx.update(schema.state)
      .set({ revision: sql`${schema.state.revision} + 1` })
      .where(and(eq(schema.state.id, id), eq(schema.state.revision, 1))).returning());
    const results = await Promise.all([update(), update()]);
    expect(results.map((r) => r.length).sort()).toEqual([0, 1]);
  });

  test('Better Auth signup, password sign-in and cookie session through Hono', async () => {
    const auth = betterAuth({
      secret: 'compatibility-only-secret-at-least-32-characters',
      baseURL: 'http://localhost:3000',
      database: drizzleAdapter(db, { provider: 'pg', schema }),
      emailAndPassword: { enabled: true },
    });
    const app = new Hono();
    app.on(['GET', 'POST'], '/api/auth/*', (c) => auth.handler(c.req.raw));
    const email = `${crypto.randomUUID()}@example.test`;
    const password = 'Only-a-disposable-probe-password-8!';
    const post = (path: string, body: unknown) => app.request(`http://localhost:3000/api/auth/${path}`, {
      method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
      body: JSON.stringify(body),
    });
    const signup = await post('sign-up/email', { name: 'Probe', email, password });
    expect(signup.status).toBe(200);
    const signedIn = await post('sign-in/email', { email, password });
    expect(signedIn.status).toBe(200);
    const cookie = signedIn.headers.getSetCookie().map((part) => part.split(';')[0]).join('; ');
    expect(cookie).toContain('session_token');
    const current = await app.request('http://localhost:3000/api/auth/get-session', { headers: { cookie } });
    const data = await current.json();
    expect(current.status).toBe(200);
    expect(data.user.email).toBe(email);
    const rejected = await post('sign-in/email', { email, password: 'incorrect-password' });
    expect(rejected.status).toBe(401);
  });
});
