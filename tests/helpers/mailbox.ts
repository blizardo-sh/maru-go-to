import type { AccessMail } from '../../src/server/mail';

export function testMailbox() {
  const messages: AccessMail[] = [];
  return {
    messages,
    async send(message: AccessMail) {
      if (!message.to.endsWith('@example.test')) throw new Error('Fixture mail must use example.test.');
      messages.push(message);
    },
    token(email: string, kind: AccessMail['kind'] = 'verify') {
      const message = messages.slice().reverse().find(item => item.to === email && item.kind === kind);
      if (!message) throw new Error(`Missing fixture ${kind} message.`);
      return new URLSearchParams(new URL(message.url).hash.slice(1)).get('token')!;
    },
  };
}
