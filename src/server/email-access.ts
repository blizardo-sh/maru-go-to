import { randomBytes } from 'node:crypto';
import { hashPassword, verifyPassword } from 'better-auth/crypto';
import type { Database } from './db';
import type { Config } from './config';
import type { SendMail } from './mail';
import { createLink, tokenHash } from './auth';
import { ReviewError } from './reviews';
import { registrationSchema } from './validation';

type Sql = Pick<Database, 'sql'>;
export async function takeAuthLimit(database: Sql, key: string, maximum: number, seconds: number) {
  const rows = await database.sql`insert into auth_limits(key,count,expires_at) values(${key},1,now()+${seconds}*interval '1 second')
    on conflict(key) do update set
      count=case when auth_limits.expires_at<=now() then 1 else auth_limits.count+1 end,
      expires_at=case when auth_limits.expires_at<=now() then excluded.expires_at else auth_limits.expires_at end
    where auth_limits.expires_at<=now() or auth_limits.count<${maximum} returning key`;
  return rows.length === 1;
}

export async function registerLearner(database: Database, input: unknown) {
  const body = registrationSchema.parse(input);
  // Hash duplicate attempts too, so account existence does not skip password work.
  const password = await hashPassword(body.password);
  return database.sql.begin(async tx => {
    const id = crypto.randomUUID();
    const [created] = await tx`insert into users(id,name,email,email_verified,email_verification_required,is_admin)
      values(${id},${body.name},${body.email},false,true,false) on conflict(email) do nothing returning id`;
    if (created) await tx`insert into accounts(id,account_id,provider_id,user_id,password) values(${crypto.randomUUID()},${id},'credential',${id},${password})`;
  });
}

export async function checkAccountPassword(database: Database, userId: string, password: string) {
  const [account] = await database.sql`select password from accounts where user_id=${userId} and provider_id='credential'`;
  if (!account?.password || !await verifyPassword({ hash: account.password, password })) throw new ReviewError('INVALID_PASSWORD', 'Неверный текущий пароль.', 400);
}

class MailLimitReached extends Error {}
async function reserveMail(database: Database, email: string, kind: 'verify' | 'recovery') {
  try {
    await database.sql.begin(async tx => {
      await tx`select pg_advisory_xact_lock(hashtext('auth-mail-budget'))`;
      const scoped = { sql: tx } as unknown as Sql;
      const key = tokenHash(email);
      for (const [name, maximum, seconds] of [
        [`mail:${kind}:cooldown:${key}`, 1, 60], [`mail:${kind}:hour:${key}`, 3, 3600],
        [`mail:${kind}:day`, kind === 'verify' ? 150 : 50, 86400],
      ] as const) if (!await takeAuthLimit(scoped, name, maximum, seconds)) throw new MailLimitReached();
      await tx`delete from auth_limits where expires_at<now()`;
    });
    return true;
  } catch (error) { if (error instanceof MailLimitReached) return false; throw error; }
}

export function createEmailAccess(database: Database, config: Config, send: SendMail | undefined, onError: () => void) {
  const pending = new Set<Promise<void>>();
  function available() {
    if (!send) throw new ReviewError('MAIL_UNAVAILABLE', 'Отправка писем пока недоступна. Попробуйте позже.', 503);
  }
  function request(email: string, kind: 'verify' | 'recovery', authenticatedUser?: string) {
    available();
    // Keep SMTP latency and mailbox existence out of the public response.
    const job = (async () => {
      const [user] = await database.sql`select id,email_verified,email_verification_required from users where email=${email}`;
      if (!user || kind === 'recovery' && !user.email_verified || kind === 'verify' && (user.email_verified || !user.email_verification_required && authenticatedUser !== user.id)) return;
      if (!await reserveMail(database, email, kind)) return;
      let token: string;
      if (kind === 'recovery') ({ token } = await createLink(database, 'recovery', email, null));
      else {
        token = randomBytes(32).toString('base64url');
        await database.sql.begin(async tx => {
          await tx`select pg_advisory_xact_lock(hashtext(${'verify:'+email}))`;
          await tx`update access_links set used_at=now(),updated_at=now() where email=${email} and kind='verify' and used_at is null`;
          await tx`insert into access_links(token_hash,kind,email,user_id,expires_at) values(${tokenHash(token)},'verify',${email},${user.id},now()+interval '1 hour')`;
        });
      }
      await send!({ to: email, kind, url: `${config.APP_URL}/${kind === 'verify' ? 'verify-email' : 'recover'}#token=${token}` });
    })().catch(onError);
    pending.add(job); void job.finally(() => pending.delete(job));
  }
  return { available, request, async drain() { await Promise.allSettled([...pending]); } };
}

export async function confirmEmail(database: Database, token: string) {
  return database.sql.begin(async tx => {
    const [link] = await tx`select * from access_links where token_hash=${tokenHash(token)} and kind='verify' for update`;
    if (!link || link.used_at || new Date(link.expires_at).getTime() <= Date.now() || !link.user_id) return false;
    const [user] = await tx`update users set email_verified=true,updated_at=now() where id=${link.user_id} and email=${link.email} returning id`;
    if (!user) return false;
    await tx`update access_links set used_at=now(),updated_at=now() where token_hash=${tokenHash(token)}`;
    return true;
  });
}
