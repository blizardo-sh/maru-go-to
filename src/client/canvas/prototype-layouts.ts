import { Container, Graphics, NineSliceSprite, Sprite, type Texture } from 'pixi.js';
import { surfaceLayout, type SurfaceLayout } from './study-surface';
import type { Rect } from './canvas';

export type Composition = 'stand' | 'scene' | 'album';
export function prototypeLayout(width: number, height: number, composition: Composition) {
  const wide = width >= 1000 && height >= 500, low = height < 450;
  let field: Rect;
  if (composition === 'scene' && width >= 700) field = { x: width * .43, y: low ? 10 : 58, width: width * .55 - 12, height: height - (low ? 22 : 92) };
  else if (composition === 'scene') { const y = height < 650 ? 78 : Math.round(height * .26); field = { x: 14, y, width: width - 28, height: height - y - 18 }; }
  else if (composition === 'album' && wide) field = { x: width / 2 + 26, y: 152, width: Math.min(width / 2 - 90, 510), height: height - 196 };
  else field = { x: wide ? (width - Math.min(width - 420, 800)) / 2 : 14, y: low ? 10 : 78, width: wide ? Math.min(width - 420, 800) : width - 28, height: height - (low ? 24 : 100) };
  if (composition === 'stand' && width >= 650 && !low) field.height = Math.min(field.height, height * .76);
  if (composition === 'album' && !wide && !low && height >= 650) { const top = width < 600 ? 132 : 152; field.height -= top - field.y; field.y = top; }
  const outer = { ...field };
  let prompt: Rect | undefined;
  if (composition === 'album' && wide) prompt = { x: -field.width - 36, y: 16, width: field.width - 8, height: field.height - 32 };
  if (low && (width >= 700 || composition === 'album' && width >= 500)) {
    if (composition !== 'scene') field = { ...field, x: outer.x + outer.width * .46 + 12, width: outer.width * .54 - 12 };
    const inset = composition === 'album' && width < 700 ? 4 : 8;
    prompt = { x: 22 - field.x, y: inset, width: field.x - 44, height: field.height - inset * 2 };
  }
  const padding = width < 600 ? 10 : 16, actionHeight = low || width < 600 ? 44 : 50;
  const content = { x: padding, y: 8, width: field.width - padding * 2, height: field.height - actionHeight - 26 };
  const frame = { x: outer.x - 24 - 240 * .16, y: outer.y - 20 - 180 * .16, width: outer.width + 48 + 480 * .16, height: outer.height + 40 + 630 * .16 };
  const layout: SurfaceLayout = { ...surfaceLayout(width, height), paper: field, content, actions: { x: padding, y: field.height - actionHeight - 8, width: content.width, height: actionHeight }, frame, font: low || width < 600 ? 18 : 22, narrow: width < 600, landscape: low, headerTop: 0 };
  return { layout, prompt, composition, width, height, low, wide };
}
export type PrototypeLayout = ReturnType<typeof prototypeLayout>;
export function albumPages(view: PrototypeLayout) {
  const field = view.layout.paper;
  const spread = view.wide ? { x: field.x - field.width - 54, y: field.y - 12, width: field.width * 2 + 76, height: field.height + 24 } : { x: field.x - field.width - 24, y: field.y - 10, width: field.width * 2 + 36, height: field.height + 20 };
  const pageWidth = (spread.width - 20) / 2;
  return { spread, pageWidth, right: { x: spread.x + pageWidth + 16, y: spread.y, width: pageWidth, height: spread.height - 8 } };
}
export type SceneTextures = { room: Texture; stand: Texture; paper: Texture; cat: Texture; rail: Texture; wood: Texture; logo: Texture };
function paper(root: Container, texture: Texture, rect: Rect) {
  const sprite = new NineSliceSprite({ texture, leftWidth: 24, rightWidth: 24, topHeight: 20, bottomHeight: 20 });
  sprite.width = rect.width / .35; sprite.height = rect.height / .35; sprite.scale.set(.35); sprite.position.set(rect.x, rect.y); root.addChild(sprite);
}
function rail(root: Container, texture: Texture, rect: Rect) {
  const view = new NineSliceSprite({ texture, leftWidth: 18, rightWidth: 18, topHeight: 8, bottomHeight: 8 });
  view.width = rect.width; view.height = rect.height; view.position.set(rect.x, rect.y); root.addChild(view);
}
export function paintScene(root: Container, view: PrototypeLayout, textures: SceneTextures) {
  root.removeChildren().forEach(child => child.destroy({ children: true, context: true, style: true }));
  const { width, height, composition, layout, wide, low } = view, field = layout.paper;
  const room = new Sprite(textures.room), cover = Math.max(width / room.texture.width, height / room.texture.height) * (composition === 'scene' && width < 700 ? 1.2 : 1);
  room.scale.set(cover); room.position.set((width - room.width) / 2, (height - room.height) * (composition === 'scene' && width < 700 ? .75 : .5)); root.addChild(room);
  const prop = new Container(); root.addChild(prop);
  let catWidth = low ? 0 : wide ? 112 : 56, catX = field.x + 10, feet = field.y - 22;
  if (composition === 'stand') {
    const stand = new NineSliceSprite({ texture: textures.stand, leftWidth: 240, rightWidth: 240, topHeight: 180, bottomHeight: 450 });
    stand.width = layout.frame.width / .16; stand.height = layout.frame.height / .16; stand.scale.set(.16); stand.position.set(layout.frame.x, layout.frame.y); prop.addChild(stand);
    if (wide) { catX = layout.frame.x + layout.frame.width - catWidth / 2 - 17; feet = layout.frame.y + 28.8 + (field.height + 40) * (320 / 650); }
  } else if (composition === 'scene') {
    prop.addChild(new Graphics().roundRect(field.x - 10, field.y - 10, field.width + 20, field.height + 20, 8).fill('#593e2b'));
    const wood = new Sprite(textures.wood); wood.position.set(field.x - 6, field.y - 6); wood.width = field.width + 12; wood.height = field.height + 12; prop.addChild(wood);
    rail(prop, textures.rail, { x: field.x - 12, y: field.y - 8, width: field.width + 24, height: 18 });
    rail(prop, textures.rail, { x: field.x - 12, y: field.y + field.height - 8, width: field.width + 24, height: 22 });
    if (width >= 700 && !low) { catWidth = Math.min(210, width * .17); catX = field.x - catWidth - 44; feet = height * .78; rail(prop, textures.rail, { x: catX - 12, y: feet, width: catWidth + 56, height: 25 }); }
    else { catWidth = low ? 0 : Math.min(100, Math.max(56, field.y - 12)); feet = field.y - 5; }
  } else {
    const { spread, pageWidth } = albumPages(view);
    prop.addChild(new Graphics().roundRect(spread.x - 8, spread.y + 4, spread.width + 16, spread.height + 12, 10).fill('#39271f'));
    prop.addChild(new Graphics().roundRect(spread.x - 3, spread.y - 3, spread.width + 6, spread.height + 6, 7).fill('#73503a'));
    for (const offset of [5, 2, 0]) {
      paper(prop, textures.paper, { x: spread.x + 4, y: spread.y + offset, width: pageWidth, height: spread.height - 8 });
      paper(prop, textures.paper, { x: spread.x + pageWidth + 16, y: spread.y + offset, width: pageWidth, height: spread.height - 8 });
    }
    prop.addChild(new Graphics().moveTo(spread.x + pageWidth + 9, spread.y + 8).lineTo(spread.x + pageWidth + 9, spread.y + spread.height - 12).stroke({ color: '#8b7253', width: 3 }));
    catWidth = low ? 0 : wide || width >= 600 ? 128 : 88;
    catX = wide ? spread.x + 18 : field.x;
    feet = Math.max(spread.y - 2, catWidth + 2);
    if (!low && height < 650) rail(prop, textures.rail, { x: catX - 3, y: feet, width: catWidth + 6, height: 8 });
  }
  const cat = new Sprite(textures.cat);
  cat.width = catWidth; cat.height = catWidth * cat.texture.height / cat.texture.width; cat.position.set(catX, feet - cat.height + 2); cat.visible = catWidth > 0; root.addChild(cat);
  const logo = new Container(), mark = new Sprite(textures.logo); mark.height = 30; mark.scale.x = mark.scale.y;
  paper(logo, textures.paper, { x: 0, y: 0, width: mark.width + 24, height: 42 }); mark.position.set(12, 6); logo.addChild(mark);
  logo.position.set((width - logo.width) / 2, 4); logo.visible = !low; root.addChild(logo);
  return { prop, cat, feet, logo };
}
