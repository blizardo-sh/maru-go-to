import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { RegistrationLink, RegistrationLinkCreateResult, RegistrationLinkInput } from '../shared/types';
import { api, json } from './api';

const statusNames: Record<RegistrationLink['status'], string> = { active: 'Действует', exhausted: 'Регистрации исчерпаны', expired: 'Срок истёк', revoked: 'Отозвана' };
const dateLabel = (value: string) => new Date(value).toLocaleString('ru-RU');
const errorText = (error: unknown) => error instanceof Error ? error.message : 'Не удалось выполнить запрос. Повторите попытку.';

export function RegistrationLinks() {
  const [links, setLinks] = useState<RegistrationLink[]>([]); const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const [limited, setLimited] = useState(true); const [timed, setTimed] = useState(true); const [limit, setLimit] = useState('5'); const [days, setDays] = useState('7'); const [durationUnit, setDurationUnit] = useState<'minutes' | 'hours' | 'days'>('days');
  const [created, setCreated] = useState<RegistrationLinkCreateResult | null>(null); const [copied, setCopied] = useState(false);
  const load = useCallback(async () => { setLoading(true); try { const result = await api<{ links: RegistrationLink[] }>('/api/admin/registration-links'); setLinks(result.links); } catch (failure) { setError(errorText(failure)); } finally { setLoading(false); } }, []);
  useEffect(() => { void load(); }, [load]);
  async function create(event: FormEvent) {
    event.preventDefault(); setError('');
    if (!limited && !timed) { setError('Оставьте хотя бы одно ограничение: число регистраций или срок.'); return; }
    const count = Number(limit); const duration = Number(days); const expires = new Date(Date.now() + duration * ({ minutes: 60000, hours: 3600000, days: 86400000 }[durationUnit]));
    if (limited && (!Number.isSafeInteger(count) || count < 1) || timed && (!Number.isSafeInteger(duration) || duration < 1 || !Number.isFinite(expires.getTime()))) { setError('Укажите положительные целые значения ограничений.'); return; }
    const input: RegistrationLinkInput = { registrationLimit: limited ? count : null, expiresAt: timed ? expires.toISOString() : null };
    setBusy(true); setCreated(null); setCopied(false);
    try { setCreated(await api<RegistrationLinkCreateResult>('/api/admin/registration-links', json('POST', input))); await load(); }
    catch (failure) { setError(errorText(failure)); } finally { setBusy(false); }
  }
  async function copyCreated() {
    if (!created) return;
    try { await navigator.clipboard.writeText(new URL(created.url, location.origin).href); setCopied(true); }
    catch { setError('Не удалось скопировать. Выделите адрес в поле и скопируйте вручную.'); }
  }
  async function revoke(id: string) {
    setBusy(true); setError('');
    try { const result = await api<{ link: RegistrationLink }>(`/api/admin/registration-links/${encodeURIComponent(id)}/revoke`, json('POST', {})); setLinks(current => current.map(link => link.id === id ? result.link : link)); if (created?.link.id === id) setCreated(null); }
    catch (failure) { setError(errorText(failure)); } finally { setBusy(false); }
  }
  return <section className="registration-links stack" aria-labelledby="registration-links-title"><h2 id="registration-links-title">Регистрационные ссылки</h2><p className="muted">По общей ссылке ученик сам задаёт имя, email и пароль. Создаются обычные ученики с личным пустым прогрессом.</p>
    <form className="sheet stack" onSubmit={create}><div className="form-grid"><div className="stack"><label className="check"><input type="checkbox" checked={limited} disabled={busy} onChange={event => setLimited(event.target.checked)} />Ограничить число регистраций</label><label><span>Успешных регистраций</span><input type="number" min="1" max="2147483647" step="1" required={limited} disabled={!limited || busy} value={limit} onChange={event => setLimit(event.target.value)} /></label></div><div className="stack"><label className="check"><input type="checkbox" checked={timed} disabled={busy} onChange={event => setTimed(event.target.checked)} />Ограничить срок</label><label><span>Срок действия</span><input type="number" min="1" step="1" required={timed} disabled={!timed || busy} value={days} onChange={event => setDays(event.target.value)} /></label><label><span>Единица срока</span><select disabled={!timed || busy} value={durationUnit} onChange={event => setDurationUnit(event.target.value as 'minutes' | 'hours' | 'days')}><option value="minutes">Минуты</option><option value="hours">Часы</option><option value="days">Дни</option></select></label></div></div><small>Нужно хотя бы одно ограничение. Если заданы оба, ссылка закрывается по первому достигнутому пределу. Условия после создания не меняются.</small><div><button className="primary" disabled={busy || !limited && !timed}>{busy ? 'Сохраняем…' : 'Создать регистрационную ссылку'}</button></div></form>
    {error && <div className="notice error" role="alert">{error}</div>}
    {created && <div className="notice stack" data-testid="registration-link-created"><p><strong>Скопируйте ссылку сейчас.</strong> После ухода с этой страницы полный адрес восстановить нельзя. В списке останутся только условия и статус.</p><label><span>Новая регистрационная ссылка</span><input readOnly value={new URL(created.url, location.origin).href} onFocus={event => event.target.select()} /></label><div><button onClick={() => { void copyCreated(); }}>{copied ? '✓ Скопировано' : 'Скопировать регистрационную ссылку'}</button></div></div>}
    <div className="spread"><h3>Выданные ссылки</h3><button disabled={loading || busy} onClick={() => { setError(''); void load(); }}>Обновить список ссылок</button></div>
    {loading ? <p role="status">Загружаем ссылки…</p> : links.length ? <ul className="registration-link-list">{links.map(link => <li className="registration-link-row" key={link.id} data-registration-link-id={link.id}><div className="stack"><strong className="registration-link-status" data-status={link.status}>{statusNames[link.status]}</strong><span>Использовано: {link.registrationsCount}{link.registrationLimit !== null ? ` из ${link.registrationLimit}` : ' · без ограничения числа'}</span><span>Осталось регистраций: {link.remainingRegistrations ?? 'без ограничения'}</span><small>{link.expiresAt ? `Действует до ${dateLabel(link.expiresAt)}` : 'Без ограничения срока'} · Создана {dateLabel(link.createdAt)}</small></div><button disabled={busy || link.status === 'revoked'} onClick={() => { void revoke(link.id); }}>Отозвать ссылку</button></li>)}</ul> : <p className="muted">Регистрационных ссылок пока нет.</p>}
    <small>Отзыв закрывает будущие регистрации. Уже созданные аккаунты и их прогресс сохраняются.</small>
  </section>;
}
