import nodemailer from 'nodemailer';
import type { Config } from './config';

export type AccessMail = { to: string; kind: 'verify' | 'recovery'; url: string };
export type SendMail = (message: AccessMail) => Promise<void>;

export function createMailer(config: Config): SendMail | undefined {
  if (!config.SMTP_HOST || !config.SMTP_USER || !config.SMTP_PASSWORD || !config.MAIL_FROM) return;
  const transport = nodemailer.createTransport({
    host: config.SMTP_HOST, port: config.SMTP_PORT ?? 465, secure: (config.SMTP_PORT ?? 465) === 465,
    requireTLS: true, auth: { user: config.SMTP_USER, pass: config.SMTP_PASSWORD },
    connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000,
    disableFileAccess: true, disableUrlAccess: true,
  });
  return async ({ to, kind, url }) => {
    const verification = kind === 'verify';
    const result = await transport.sendMail({
      from: { name: 'Marugoto Learning', address: config.MAIL_FROM! }, to,
      subject: verification ? 'Marugoto — подтвердите почту' : 'Marugoto — восстановление пароля',
      text: `${verification ? 'Подтвердите адрес электронной почты для вашего аккаунта в тренажёре Marugoto.' : 'Вы запросили восстановление пароля в тренажёре Marugoto.'}\n\n${url}\n\nСсылка действует один час и используется один раз. Если вы не запрашивали это письмо, просто проигнорируйте его.\n`,
    });
    if (!result.accepted.length || result.rejected.length) throw new Error('Mail recipient rejected');
  };
}
