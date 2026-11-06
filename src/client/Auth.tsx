import { useEffect, useState, type FormEvent } from 'react';
import type { InvitationAcceptResult, InvitationDetails } from '../shared/types';
import type { User } from './types';
import { api, ApiRequestError, json } from './api';

type Flow = 'login' | 'register' | 'forgot' | 'resend' | 'verify' | 'account' | 'invite' | 'recover';
const initialFlow = (): Flow => ({ '/register':'register', '/forgot-password':'forgot', '/verify-email':'verify', '/confirm-email':'account', '/invite':'invite', '/recover':'recover' } as Record<string, Flow>)[location.pathname] ?? 'login';
const paths: Record<Flow,string> = { login:'/login',register:'/register',forgot:'/forgot-password',resend:'/register',verify:'/verify-email',account:'/confirm-email',invite:'/invite',recover:'/recover' };
const titles: Record<Flow,string> = { login:'Войти',register:'Регистрация',forgot:'Восстановить пароль',resend:'Повторить письмо',verify:'Подтвердить почту',account:'Подтвердить вашу почту',invite:'Принять приглашение',recover:'Новый пароль' };
const verificationNotice = 'Проверьте почту. Если адрес ожидает подтверждения, мы отправим письмо со ссылкой. Проверьте также папку «Спам». Повторный запрос доступен через минуту.';
const recoveryNotice = 'Если для этого адреса есть аккаунт с подтверждённой почтой, мы отправим ссылку восстановления. Проверьте также папку «Спам». Если почта ещё не подтверждена, обратитесь к администратору.';

export function Auth({ onLogin, user }: { onLogin: (expectedEmail: string) => Promise<boolean>; user?: User }) {
  const [token, setToken] = useState(() => new URLSearchParams(location.hash.slice(1)).get('token') ?? '');
  const [flow, setFlow] = useState<Flow>(initialFlow);
  const [email, setEmail] = useState(user?.email ?? ''); const [name, setName] = useState(''); const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState(''); const [complete, setComplete] = useState('');
  const [invitation, setInvitation] = useState<InvitationDetails | null>(null);
  const [inviteLoading, setInviteLoading] = useState(flow === 'invite' && !!token); const [inviteRetry, setInviteRetry] = useState(0);
  const registration = invitation?.kind === 'registration';
  const needsToken = ['invite','recover','verify'].includes(flow);
  const needsPassword = ['login','register','invite','recover','account'].includes(flow);
  const needsEmail = ['login','register','forgot','resend','invite','account'].includes(flow);
  const newPassword = ['register','invite','recover'].includes(flow);
  useEffect(() => {
    if (flow !== 'invite' || !token || complete) return;
    const controller = new AbortController(); setInviteLoading(true); setMessage('');
    void api<InvitationDetails>('/api/invitations/details', { ...json('POST', { token }), signal: controller.signal }).then(details => {
      setInvitation(details); if (details.kind === 'invite') setEmail(details.email);
    }).catch(error => { if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : 'Не удалось проверить ссылку.'); }).finally(() => { if (!controller.signal.aborted) setInviteLoading(false); });
    return () => controller.abort();
  }, [flow, token, inviteRetry, complete]);
  function navigate(next: Flow) { setFlow(next); setComplete(''); setMessage(''); setPassword(''); setToken(''); history.replaceState(null, '', paths[next]); }
  async function submit(event: FormEvent) {
    event.preventDefault(); if (busy) return;
    if (flow === 'invite' && !invitation) { setMessage('Сначала дождитесь проверки ссылки или повторите её.'); return; }
    setBusy(true); setMessage('');
    try {
      const address = email.trim().toLowerCase();
      if (flow === 'login') {
        await api('/api/auth/sign-in/email', json('POST', { email:address, password }));
        if (!await onLogin(address)) setMessage('Вход пока не подтверждён. Проверьте соединение и попробуйте ещё раз.');
        return;
      }
      if (flow === 'register') { await api('/api/register', json('POST', { name, email:address, password })); setComplete(verificationNotice); }
      if (flow === 'resend') { await api('/api/email-verification/request', json('POST', { email:address })); setComplete(verificationNotice); }
      if (flow === 'forgot') { await api('/api/recovery/request', json('POST', { email:address })); setComplete(recoveryNotice); }
      if (flow === 'account') { await api('/api/account/verify-email/request', { ...json('POST', { password }), headers:user ? {'X-Learning-Learner-Id':user.id} : {} }); setComplete(verificationNotice); }
      if (flow === 'verify') { await api('/api/email-verification/complete', json('POST', { token })); setComplete('Почта подтверждена. Теперь доступно самостоятельное восстановление пароля.'); }
      if (flow === 'recover') { await api('/api/recovery/complete', json('POST', { token, password })); setComplete('Пароль изменён. Войдите с новым паролем.'); }
      if (flow === 'invite') {
        const result = await api<InvitationAcceptResult>('/api/invitations/accept', json('POST', { token, name, password, ...(registration ? { email:address } : {}) }));
        setEmail(result.email); setComplete(verificationNotice);
      }
      setPassword(''); setToken(''); history.replaceState(null, '', paths[flow]);
    } catch (error) {
      if (error instanceof ApiRequestError && error.code === 'EMAIL_NOT_VERIFIED') { setFlow('resend'); setPassword(''); }
      setMessage(error instanceof Error ? error.message : 'Не удалось выполнить запрос. Повторите попытку.');
    } finally { setBusy(false); }
  }
  const invalidEmail = (input: HTMLInputElement) => { const text='Укажите email, например name@example.com. Имя в приложении для входа не подходит.'; input.setCustomValidity(text); setMessage(text); };
  return <main className="auth"><header className="auth-intro"><p className="eyebrow">MARUGOTO · STARTER A1</p><h1>Японский к занятию</h1><p className="muted">Слова, конструкции и практика на слух. Понемногу, каждый день.</p><div className="cat-frame"><img src="/mascot/wave.png" width="360" height="360" alt="Кот-помощник приветствует вас" decoding="async" /></div></header>
    {complete ? <section className="stack"><div className="notice" role="status">{complete}</div>
      <button className="primary" onClick={() => flow === 'verify' || flow === 'account' ? location.assign('/') : navigate('login')}>{flow === 'verify' || flow === 'account' ? 'Продолжить' : 'Перейти ко входу'}</button>
      {['register','invite','resend'].includes(flow) && <button onClick={() => navigate('resend')}>Запросить письмо ещё раз</button>}
      {flow === 'account' && <button onClick={() => { setComplete(''); }}>Запросить письмо ещё раз</button>}
    </section> : <form onSubmit={submit} className="sheet stack" aria-busy={busy}>
      <h2>{flow === 'invite' && registration ? 'Регистрация по ссылке' : titles[flow]}</h2>
      {needsEmail && <label><span>{flow === 'invite' ? 'Email для входа' : 'Email'}</span><input type="email" required maxLength={254} readOnly={flow === 'account' || flow === 'invite' && !registration} autoComplete="username" autoCapitalize="none" spellCheck={false} value={email} onInvalid={event => invalidEmail(event.currentTarget)} onChange={event => { event.currentTarget.setCustomValidity(''); setEmail(event.target.value); setMessage(''); }} /></label>}
      {(flow === 'register' || flow === 'invite') && <label><span>Имя в приложении</span><input required autoComplete="nickname" value={name} maxLength={100} onChange={event => setName(event.target.value)} /></label>}
      {needsPassword && <label><span>{flow === 'account' ? 'Текущий пароль' : 'Пароль'}</span><input type="password" required minLength={newPassword ? 8 : 1} maxLength={newPassword ? 128 : undefined} autoComplete={newPassword ? 'new-password' : 'current-password'} value={password} onChange={event => setPassword(event.target.value)} aria-describedby="auth-help" /></label>}
      <div id="auth-help" className="status muted">{newPassword ? 'От 8 до 128 символов.' : flow === 'account' ? 'Подтвердите текущий пароль, затем откройте письмо. Ваш доступ к занятиям и прогресс сохраняются.' : flow === 'verify' ? 'Нажмите кнопку, чтобы подтвердить адрес из письма.' : flow === 'forgot' ? 'Восстановление доступно для подтверждённой почты.' : flow === 'resend' ? 'Повторное письмо можно запросить через минуту. Для старого аккаунта подтвердите адрес после входа или обратитесь к администратору.' : 'Войдите с вашим email и паролем.'}</div>
      {(flow === 'register' || flow === 'invite') && <p className="muted">Для доступа к тренажёру подтвердите email по ссылке в письме.</p>}
      {message && <div className="notice error" role="alert">{message}</div>}
      {needsToken && !token ? <div className="notice error" role="alert">В ссылке нет токена. Запросите новое письмо.</div> : <button className="primary" disabled={busy || flow === 'invite' && (inviteLoading || !invitation)}>{busy ? 'Подождите…' : flow === 'recover' ? 'Сохранить пароль' : flow === 'register' || flow === 'invite' ? 'Создать аккаунт' : flow === 'login' ? 'Войти' : flow === 'verify' ? 'Подтвердить почту' : 'Отправить письмо'}</button>}
      {flow === 'invite' && !invitation && <button type="button" disabled={busy || inviteLoading} onClick={() => setInviteRetry(value => value + 1)}>Повторить проверку ссылки</button>}
      {flow === 'login' ? <><button type="button" onClick={() => navigate('register')}>Создать аккаунт</button><button type="button" onClick={() => navigate('forgot')}>Забыли пароль?</button></> : <button type="button" disabled={busy} onClick={() => navigate('login')}>Перейти ко входу</button>}
      {(flow === 'verify' || flow === 'register') && <button type="button" disabled={busy} onClick={() => navigate('resend')}>Запросить письмо ещё раз</button>}
      {flow === 'recover' && <button type="button" disabled={busy} onClick={() => navigate('forgot')}>Запросить новую ссылку</button>}
    </form>}
  </main>;
}
