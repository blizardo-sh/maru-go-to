import { Application, Assets, Container, Graphics, Rectangle, Sprite, Texture } from 'pixi.js';
import scenes from '../../public/scenes/manifest.json';
import rig from '../../public/mascot/rig/v1/manifest.json';

export const backgrounds = scenes.scenes;
export type Reaction = 'idle' | 'pet' | 'good' | 'again';

// Throwaway renderer: can these existing backgrounds and this cat feel alive in PixiJS?
export async function createScene(host: HTMLElement, onPet: () => void) {
  const app = new Application();
  await app.init({
    resizeTo: host, background: '#b1b99b', preference: 'webgl',
    resolution: Math.min(devicePixelRatio, 2), autoDensity: true,
    antialias: true, autoStart: false, powerPreference: 'low-power',
  });
  host.append(app.canvas);
  app.canvas.setAttribute('aria-hidden', 'true');
  const world = new Container();
  const backdrop = new Sprite();
  const previous = new Sprite();
  world.addChild(previous, backdrop);
  const atmosphere = new Container();
  const foliage = new Sprite();
  foliage.anchor.set(0, 0);
  const shadow = new Graphics().ellipse(0, 0, 95, 15).fill({ color: '#382b1c', alpha: .18 });
  const cat = new Container();
  const puppet = new Container();
  const poses = new Sprite();
  poses.anchor.set(.5, .9722);
  cat.addChild(puppet, poses);
  cat.eventMode = 'static';
  cat.cursor = 'pointer';
  cat.hitArea = new Rectangle(-260, -660, 540, 670);
  cat.on('pointertap', onPet);
  app.stage.addChild(world, atmosphere, foliage, shadow, cat);

  const textures = await Assets.load<Texture>([
    ...Object.values(rig.layers).map(layer => layer.src),
    '/mascot/blink.png', '/mascot/wave.png', '/mascot/success.png', '/mascot/encourage.png',
    '/scenes/layers/foliage-v1.webp', '/scenes/layers/sakura-v1.webp',
  ]);
  const layers = Object.entries(rig.layers).map(([name, layer]) => {
    const sprite = new Sprite(textures[layer.src]);
    sprite.anchor.set(layer.pivot.x, layer.pivot.y);
    sprite.position.set(layer.pivot.x * rig.canvas.width - 360, layer.pivot.y * rig.canvas.height - 700);
    puppet.addChild(sprite);
    return { name, sprite };
  });

  let backdropTextures: { desktop: Texture; mobile: Texture } | undefined;
  let request = 0;
  let destroyed = false;
  let mobile = innerWidth <= 600 || innerHeight > innerWidth;
  let elapsed = 0;
  let fade = 1;
  let reaction: Reaction = 'idle';
  let reactionTime = 0;
  let moving = !matchMedia('(prefers-reduced-motion: reduce)').matches;
  let targetX = 0, targetY = 0, driftX = 0, driftY = 0;
  let catX = 0, catY = 0, catScale = 1;
  const particles = Array.from({ length: 16 }, (_, i) => {
    const sprite = new Graphics().ellipse(0, 0, i % 3 === 0 ? 4 : 2, 2).fill('#fff3d3');
    atmosphere.addChild(sprite);
    return sprite;
  });

  function placeBackground(sprite: Sprite) {
    if (!sprite.texture.width) return;
    const scale = Math.max((app.screen.width + 24) / sprite.texture.width, (app.screen.height + 24) / sprite.texture.height);
    sprite.scale.set(scale);
    sprite.position.set((app.screen.width - sprite.width) / 2, app.screen.height - sprite.height + 12);
  }

  function layout() {
    const { width, height } = app.screen;
    placeBackground(backdrop); placeBackground(previous);
    const phone = width <= 600;
    const size = phone ? Math.min(190, width * .45) : Math.min(360, width * .29, height * .42);
    catScale = size / 720;
    catX = width * (phone ? .77 : width < 1000 ? .76 : .71);
    catY = phone ? Math.max(640, height * .78) : height * (height <= 850 ? .72 : .75);
    cat.position.set(catX, catY); cat.scale.set(catScale);
    shadow.position.set(catX, catY - 1); shadow.scale.set(size / 270);
    foliage.width = phone ? width * .75 : width * .34;
    foliage.height = foliage.width * 427 / 640;
    foliage.position.set(-20, -15);
    app.render();
  }

  async function setScene(index: number) {
    const material = backgrounds[index];
    if (!material) return false;
    const ticket = ++request;
    const [desktop, portrait] = await Promise.all([
      Assets.load<Texture>(material.desktop.src), Assets.load<Texture>(material.mobile.src),
    ]);
    if (ticket !== request || destroyed) return false;
    backdropTextures = { desktop, mobile: portrait };
    previous.texture = backdrop.texture;
    previous.visible = backdrop.texture !== Texture.EMPTY;
    previous.alpha = 1;
    backdrop.texture = mobile ? portrait : desktop;
    fade = moving && previous.visible ? 0 : 1;
    backdrop.alpha = fade;
    foliage.texture = textures[`/scenes/layers/${material.id === 'garden' ? 'sakura' : 'foliage'}-v1.webp`]!;
    foliage.visible = material.id !== 'tokyo';
    particles.forEach(particle => { particle.tint = material.id === 'garden' ? '#f7c6cd' : '#fff3d3'; });
    host.dataset.scene = material.id;
    layout();
    return true;
  }

  function react(value: Reaction) {
    reaction = value; reactionTime = 0;
    const file = value === 'good' ? 'success' : value === 'again' ? 'encourage' : 'wave';
    poses.texture = textures[`/mascot/${file}.png`]!;
    poses.scale.set(720 / poses.texture.width);
    poses.visible = value !== 'idle';
    puppet.visible = value === 'idle';
    host.dataset.reaction = value;
    app.render();
    updateTicker();
  }

  app.ticker.maxFPS = 60;
  app.ticker.add(ticker => {
    const dt = Math.min(ticker.deltaMS, 50);
    if (moving) elapsed += dt;
    if (reaction !== 'idle') {
      reactionTime += ticker.elapsedMS;
      if (reactionTime > 1600) react('idle');
    }
    if (moving && fade < 1) {
      fade = Math.min(1, fade + ticker.elapsedMS / 600);
      backdrop.alpha = fade;
      previous.visible = fade < 1;
    }
    const blend = 1 - Math.exp(-dt / 240);
    driftX += ((moving ? targetX : 0) - driftX) * blend;
    driftY += ((moving ? targetY : 0) - driftY) * blend;
    world.position.set(driftX * 5, driftY * 3);
    foliage.position.set(-20 + driftX * 13, -15 + driftY * 7);
    foliage.rotation = moving ? Math.sin(elapsed / 3800) * .009 : 0;
    for (const { name, sprite } of layers) {
      sprite.rotation = !moving ? 0 : name === 'tail' ? Math.sin(elapsed / 1000) * .075 : name === 'head' ? Math.sin(elapsed / 2100) * .025 + driftX * .025 : 0;
      if (name === 'body') sprite.scale.y = moving ? 1 + Math.sin(elapsed / 1800) * .009 : 1;
    }
    const blinking = moving && elapsed % 5300 > 5110;
    if (reaction === 'idle') {
      puppet.visible = !blinking;
      poses.visible = blinking;
      if (blinking) { poses.texture = textures['/mascot/blink.png']!; poses.scale.set(720 / poses.texture.width); }
    }
    const hop = moving && reaction === 'good' ? Math.sin(Math.min(1, reactionTime / 650) * Math.PI) * 20 : 0;
    cat.y = catY - hop;
    cat.rotation = moving && reaction !== 'idle' ? Math.sin(reactionTime / 150) * .035 * Math.max(0, 1 - reactionTime / 1600) : 0;
    shadow.scale.set((catScale * 720 / 270) * (1 - hop / 120));
    particles.forEach((particle, i) => {
      const progress = (elapsed / (18000 + i * 500) + i / particles.length) % 1;
      particle.x = (i * .173 % 1) * app.screen.width + Math.sin(elapsed / 3000 + i) * 18;
      particle.y = progress * app.screen.height * .7;
      particle.alpha = moving ? Math.sin(progress * Math.PI) * .35 : 0;
      particle.rotation = elapsed / 2500 + i;
    });
  });

  function updateTicker() {
    if (document.hidden || !moving && reaction === 'idle') app.stop(); else app.start();
  }
  function pointer(event: PointerEvent) {
    targetX = event.clientX / app.screen.width * 2 - 1;
    targetY = event.pageY / app.screen.height * 2 - 1;
  }
  function resize() {
    const nextMobile = innerWidth <= 600 || innerHeight > innerWidth;
    if (mobile !== nextMobile) {
      mobile = nextMobile;
      if (backdropTextures) {
        backdrop.texture = mobile ? backdropTextures.mobile : backdropTextures.desktop;
        fade = 1; backdrop.alpha = 1; previous.visible = false;
      }
    }
    app.resize(); layout();
  }
  window.addEventListener('pointermove', pointer);
  window.addEventListener('resize', resize);
  document.addEventListener('visibilitychange', updateTicker);
  const observer = new ResizeObserver(() => { app.resize(); layout(); });
  observer.observe(host);
  updateTicker();

  return {
    setScene, react,
    setMotion(enabled: boolean) {
      moving = enabled;
      host.dataset.motion = String(enabled);
      if (!enabled) { fade = 1; backdrop.alpha = 1; previous.visible = false; targetX = 0; targetY = 0; }
      app.ticker.update(performance.now()); app.render(); updateTicker();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true; request++;
      window.removeEventListener('pointermove', pointer);
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', updateTicker);
      observer.disconnect();
      app.destroy({ removeView: true }, { children: true });
    },
  };
}
