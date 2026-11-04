import './style.css';
import { backgrounds, createScene, type Reaction } from './scene';

const host = document.querySelector<HTMLElement>('#scene')!;
const status = document.querySelector<HTMLElement>('#status')!;
const message = document.querySelector<HTMLElement>('#cat-message')!;
const error = document.querySelector<HTMLElement>('#error')!;
const motionButton = document.querySelector<HTMLButtonElement>('#motion-toggle')!;
const media = matchMedia('(prefers-reduced-motion: reduce)');
let motion = !media.matches;
let request = 0;
let selected = 0;

function failure(cause: unknown) {
  error.hidden = false;
  error.textContent = 'Не удалось загрузить пробную сцену. Обновите страницу и попробуйте ещё раз.';
  status.textContent = 'Сцена недоступна';
  console.error(cause);
}

async function start() {
  const stage = await createScene(host, () => react('pet'));
  const labels = ['Комната', 'Сад', 'Горы', 'Река', 'Токио'];
  const picker = document.querySelector<HTMLElement>('#backgrounds')!;
  const buttons = backgrounds.map((background, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('aria-label', background.nameRu);
    button.setAttribute('aria-pressed', String(index === selected));
    const image = document.createElement('img');
    image.src = background.desktop.src; image.alt = ''; image.width = 160; image.height = 90;
    const label = document.createElement('span'); label.textContent = labels[index]!;
    button.append(image, label);
    button.addEventListener('click', () => { void select(index); });
    picker.append(button);
    return button;
  });

  async function select(index: number) {
    const ticket = ++request;
    status.textContent = 'Загружаем сцену…';
    error.hidden = true;
    try {
      if (!await stage.setScene(index) || ticket !== request) return;
      selected = index;
      document.querySelector('#scene-name')!.textContent = backgrounds[index]!.nameRu;
      buttons.forEach((button, i) => button.setAttribute('aria-pressed', String(i === index)));
      status.textContent = 'Предпросмотр · без сохранения';
      host.dataset.ready = 'true';
    } catch (cause) { if (ticket === request) failure(cause); }
  }

  function react(value: Reaction) {
    stage.react(value);
    message.textContent = value === 'good' ? 'すごい！ Отлично получилось.' : value === 'again' ? 'Всё получится. Давай ещё раз.' : 'Мурр. Я рядом.';
  }

  function updateMotion() {
    stage.setMotion(motion);
    motionButton.setAttribute('aria-pressed', String(motion));
    motionButton.textContent = motion ? 'Остановить движение' : 'Включить движение';
  }
  const preference = () => { motion = !media.matches; updateMotion(); };
  media.addEventListener('change', preference);
  motionButton.addEventListener('click', () => { motion = !motion; updateMotion(); });
  document.querySelector('#pet')!.addEventListener('click', () => react('pet'));
  document.querySelector('#good')!.addEventListener('click', () => react('good'));
  document.querySelector('#again')!.addEventListener('click', () => react('again'));
  document.querySelector('#card-toggle')!.addEventListener('click', event => {
    const visible = document.body.dataset.card !== 'hidden';
    document.body.dataset.card = visible ? 'hidden' : 'visible';
    const button = event.currentTarget as HTMLButtonElement;
    button.setAttribute('aria-pressed', String(!visible));
    button.textContent = visible ? 'Показать карточку' : 'Скрыть карточку';
  });
  document.querySelector('#flashcard')!.addEventListener('click', event => {
    const answer = document.querySelector<HTMLElement>('#answer')!;
    answer.hidden = !answer.hidden;
    document.querySelector<HTMLElement>('#reveal-hint')!.hidden = !answer.hidden;
    (event.currentTarget as HTMLButtonElement).setAttribute('aria-expanded', String(!answer.hidden));
  });
  const dispose = () => { media.removeEventListener('change', preference); stage.destroy(); };
  window.addEventListener('pagehide', event => { if (!event.persisted) dispose(); }, { once: true });
  if (import.meta.hot) import.meta.hot.dispose(dispose);
  updateMotion();
  await select(0);
}

void start().catch(failure);
