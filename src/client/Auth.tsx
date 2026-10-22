import { useEffect, useState, type FormEvent } from 'react';
import type { InvitationAcceptResult, InvitationDetails } from '../shared/types';
import { api, ApiRequestError, json } from './api';

const errorText = (error: unknown) => error instanceof ApiRequestError && error.code === 'INVALID_LINK'
  ? 'Эта ссылка недоступна: срок мог истечь, число регистраций исчерпано или администратор отозвал её. Попросите новую ссылку.'
  : error instanceof Error ? error.message : 'Не удалось выполнить запрос. Повторите попытку.';

export function Auth({ onLogin }: { onLogin: (expectedEmail: string) => Promise<boolean> }) {
  const [token] = useState(() => new URLSearchParams(location.hash.slice(1)).get('token'));
  const [flow, setFlow] = useState<'invite' | 'recover' | 'login'>(() => location.pathname === '/invite' ? 'invite' : location.pathname === '/recover' ? 'recover' : 'login');
  const [email, setEmail] = useState(''); const [name, setName] = useState(''); const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState(''); const [complete, setComplete] = useState(false);
  const [invitation, setInvitation] = useState<InvitationDetails | null>(null);
  const [inviteLoading, setInviteLoading] = useState(flow === 'invite' && !!token); const [inviteError, setInviteError] = useState(''); const [inviteRetry, setInviteRetry] = useState(0);
  const registration = invitation?.kind === 'registration';
  useEffect(() => {
    if (flow !== 'invite' || !token || complete) return;
    const controller = new AbortController(); setInviteLoading(true); setInviteError(''); setInvitation(null);
    void api<InvitationDetails>('/api/invitations/details', { ...json('POST', { token }), signal: controller.signal }).then(details => {
      setInvitation(details); if (details.kind === 'invite') setEmail(details.email);
    }).catch(error => { if (!controller.signal.aborted) setInviteError(errorText(error)); }).finally(() => { if (!controller.signal.aborted) setInviteLoading(false); });
    return () => controller.abort();
  }, [flow, token, inviteRetry, complete]);
  function manualLogin() { setFlow('login'); setComplete(false); setMessage(''); }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (flow === 'invite' && !invitation) { setMessage('Сначала дождитесь проверки ссылки или повторите её.'); return; }
    setBusy(true); setMessage('');
    try {
      if (flow === 'login') {
        await api('/api/auth/sign-in/email', json('POST', { email: email.trim().toLowerCase(), password }));
        if (!await onLogin(email.trim().toLowerCase())) setMessage('Вход пока не подтверждён. Проверьте соединение и попробуйте войти ещё раз.');
        return;
      }
      if (flow === 'recover') await api('/api/recovery/complete', json('POST', { token, password }));
      else {
        const result = await api<InvitationAcceptResult>('/api/invitations/accept', json('POST', { token, name, password, ...(registration ? { email: email.trim().toLowerCase() } : {}) }));
        setEmail(result.email); setComplete(true); setPassword('');
        if (result.authenticated && await onLogin(result.email)) return;
      }
      // Remove the consumed token while keeping this public screen until a confirmed sign-in.
      history.replaceState(null, '', flow === 'recover' ? '/recover' : '/invite');
      setComplete(true); setPassword('');
    } catch (error) { setMessage(errorText(error)); }
    finally { setBusy(false); }
  }
  const emailField = <label><span>{flow === 'invite' ? 'Email для входа' : 'Email'}</span><input type="email" required maxLength={254} readOnly={flow === 'invite' && !registration} autoComplete="username" autoCapitalize="none" spellCheck={false} value={email} aria-describedby={flow === 'invite' ? 'invite-email-help' : undefined} onInvalid={event => { const text = 'Укажите email, например name@example.com. Имя в приложении для входа не подходит.'; event.currentTarget.setCustomValidity(text); setMessage(text); }} onChange={event => { event.currentTarget.setCustomValidity(''); setEmail(event.target.value); setMessage(''); }} /></label>;
  return <main className="auth"><header className="auth-intro"><p className="eyebrow">MARUGOTO · STARTER A1</p><h1>Японский к занятию</h1><p className="muted">Слова, конструкции и практика на слух. Понемногу, каждый день.</p><div className="cat-frame"><img src="/mascot/wave.png" width="360" height="360" alt="Кот-помощник приветствует вас" decoding="async" /></div></header>
    {complete ? <section className="stack"><div className="notice" role="status">{flow === 'invite' ? <p>Аккаунт создан. Ваш email для входа: <strong>{email}</strong>. Если автоматический вход не завершился, войдите с этим адресом и вашим паролем. Повторно регистрироваться не нужно.</p> : <p>Пароль изменён. Войдите с новым паролем.</p>}</div><button className="primary" onClick={manualLogin}>Перейти ко входу</button></section> : <form onSubmit={submit} className="sheet stack" aria-busy={busy}>
      <h2>{flow === 'invite' ? registration ? 'Регистрация по ссылке' : 'Принять приглашение' : flow === 'recover' ? 'Новый пароль' : 'Войти'}</h2>
      {flow === 'login' && emailField}
      {flow === 'invite' && <>{emailField}<div id="invite-email-help" className="status muted" role="status">{inviteLoading ? 'Проверяем ссылку…' : invitation ? registration ? 'Укажите свой email: он станет логином. Письмо для подтверждения не отправляется.' : 'Этот адрес указан в приглашении. Для входа используйте его, а не имя.' : 'Форма станет доступна после проверки ссылки.'}</div>{inviteError && <div className="notice error" role="alert"><p>{inviteError}</p><button type="button" disabled={inviteLoading} onClick={() => setInviteRetry(current => current + 1)}>Повторить проверку</button></div>}<label><span>Имя в приложении</span><input required autoComplete="nickname" value={name} maxLength={100} onChange={event => setName(event.target.value)} /></label></>}
      <label><span>Пароль</span><input type="password" required minLength={flow === 'login' ? 1 : 8} maxLength={flow === 'login' ? undefined : 128} autoComplete={flow === 'login' ? 'current-password' : 'new-password'} value={password} onChange={event => setPassword(event.target.value)} aria-describedby="auth-help" /></label>
      <div id="auth-help" className="status muted">{flow === 'login' ? 'Для регистрации или восстановления доступа попросите администратора выдать ссылку.' : `От 8 до 128 символов.${flow === 'invite' && registration ? ' Для восстановления доступа администратор выдаёт личную ссылку.' : ' Ссылка действует один раз.'}`}</div>
      {message && <div className="notice error" role="alert">{message}</div>}
      {flow !== 'login' && !token ? <div className="notice error" role="alert">В ссылке нет токена. Попросите администратора выдать новую ссылку.</div> : <button className="primary" disabled={busy || flow === 'invite' && (inviteLoading || !invitation)}>{busy ? 'Сохраняем…' : flow === 'login' ? 'Войти' : flow === 'invite' ? 'Создать аккаунт' : 'Сохранить пароль'}</button>}
      {flow === 'invite' && registration && message && <button type="button" onClick={manualLogin}>Войти с этим email</button>}
    </form>}
  </main>;
}
