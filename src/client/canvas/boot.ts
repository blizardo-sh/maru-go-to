export {};
const startup = document.querySelector<HTMLElement>('#startup')!;
const message = document.querySelector<HTMLElement>('#startup-message')!;
const retry = document.querySelector<HTMLElement>('#startup-retry')!;
const delayed = setTimeout(() => { retry.hidden = false; }, 15000);
try {
  await import('./connected-album');
  startup.hidden = true;
} catch {
  message.textContent = 'Не удалось загрузить альбом. Проверьте соединение и попробуйте ещё раз.';
  retry.hidden = false;
} finally { clearTimeout(delayed); }
