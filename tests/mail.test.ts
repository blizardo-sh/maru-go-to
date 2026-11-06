import { expect, spyOn, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, type TLSSocket } from 'node:tls';
import nodemailer from 'nodemailer';
import { createMailer } from '../src/server/mail';

test('SMTP waits for a delayed DATA acknowledgement and can send the next message', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'marugoto-smtp-'));
  const sockets = new Set<TLSSocket>(), timers = new Set<ReturnType<typeof setTimeout>>();
  const messages: string[] = [];
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(directory, 'key.pem'), '-out', join(directory, 'cert.pem'), '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost'], { stdio: 'ignore' });
  const certificate = readFileSync(join(directory, 'cert.pem'));
  const server = createServer({ key: readFileSync(join(directory, 'key.pem')), cert: certificate }, socket => {
    sockets.add(socket); socket.on('close', () => sockets.delete(socket));
    socket.write('220 localhost test SMTP\r\n');
    let buffer = '', data = false;
    socket.on('data', chunk => {
      buffer += chunk.toString();
      while (buffer.includes('\r\n')) {
        if (data) {
          const end = buffer.indexOf('\r\n.\r\n');
          if (end < 0) return;
          messages.push(buffer.slice(0, end)); buffer = buffer.slice(end + 5); data = false;
          const timer = setTimeout(() => { timers.delete(timer); socket.write('250 2.0.0 accepted\r\n'); }, messages.length === 1 ? 16000 : 0);
          timers.add(timer); continue;
        }
        const end = buffer.indexOf('\r\n'), line = buffer.slice(0, end); buffer = buffer.slice(end + 2);
        if (line.startsWith('EHLO')) socket.write('250-localhost\r\n250 AUTH PLAIN\r\n');
        else if (line.startsWith('AUTH PLAIN')) socket.write('235 2.7.0 authenticated\r\n');
        else if (line === 'DATA') { data = true; socket.write('354 continue\r\n'); }
        else if (line === 'QUIT') socket.end('221 goodbye\r\n');
        else socket.write('250 OK\r\n');
      }
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('TCP listener required');
  const original = nodemailer.createTransport;
  // Redirect only the test connection; the production mailer still requires verified TLS.
  const transport = spyOn(nodemailer, 'createTransport').mockImplementation(((options: object) => original({ ...options, port: address.port, tls: { ca: certificate, servername: 'localhost' } })) as typeof original);
  try {
    const send = createMailer({ DATABASE_URL: 'postgres://localhost/unused_test', APP_URL: 'https://example.test', BETTER_AUTH_SECRET: 'unused-fixture-secret-at-least-32-characters', HOST: '127.0.0.1', PORT: 3000, SMTP_HOST: '127.0.0.1', SMTP_PORT: 465, SMTP_USER: 'sender@example.test', SMTP_PASSWORD: 'fixture-only', MAIL_FROM: 'sender@example.test' })!;
    await send({ to: 'learner@example.test', kind: 'verify', url: 'https://example.test/verify-email#token=fixture' });
    await send({ to: 'learner@example.test', kind: 'recovery', url: 'https://example.test/recover#token=fixture' });
    expect(messages).toHaveLength(2);
    const bodies = messages.map(message => {
      expect(message).toContain('Content-Transfer-Encoding: base64');
      return Buffer.from(message.split('\r\n\r\n')[1]!, 'base64').toString('utf8');
    });
    expect(bodies[0]).toContain('/verify-email#token=fixture');
    expect(bodies[1]).toContain('/recover#token=fixture');
  } finally {
    transport.mockRestore(); for (const timer of timers) clearTimeout(timer); for (const socket of sockets) socket.destroy();
    await new Promise<void>(resolve => server.close(() => resolve())); rmSync(directory, { recursive: true, force: true });
  }
}, 25000);
