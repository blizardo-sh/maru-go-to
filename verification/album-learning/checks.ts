import { expect, type Page } from '@playwright/test';
import propsManifest from '../../public/scenes/props/manifest.json';
import type { Course } from '../../src/shared/types';

/** Actual lesson-four DOM, native input and painted sprite bounds; no test-only app state bridge. */
export async function checkAlbumOverview(page:Page,course:Course,output:string,propsOnly=false){
  const tiles = page.locator('.word-introduction[data-word-id]'); expect(await tiles.count()).toBeGreaterThan(0);
  const measurements: unknown[] = []; let exampleAudioChecked=false; if(!propsOnly)await expect(page.locator('.word-introduction .word-kanji')).toHaveText(['家族','父','母','兄','姉']);
  if (!propsOnly) for (const viewport of [{ width: 1280, height: 900 }, { width: 1280, height: 720 }, { width: 390, height: 844 }, { width: 320, height: 740 }]) {
    await page.setViewportSize(viewport); await page.waitForTimeout(100);
    for (const tile of await tiles.all()) {
      const wordId = await tile.getAttribute('data-word-id'); const word = course.words.find(word => word.id === wordId)!;
      await expect(tile.locator('h3.jp')).toHaveText(word.kana);
      await expect(tile.locator('.word-meaning')).toHaveText(word.meaningRu);
      const image=tile.locator(':scope > .word-illustration');if(await image.count()){const illustration=await image.boundingBox(),kana=await tile.locator('h3.jp').boundingBox();expect(illustration!.x+illustration!.width).toBeLessThanOrEqual(kana!.x);}

      const kanji=/\p{Script=Han}/u.test(word.surface)?word.surface:course.forms.find(form=>form.wordId===word.id&&form.kana===word.kana&&form.reviewStatus!=='draft'&&/\p{Script=Han}/u.test(form.surface))?.surface;await expect(tile.locator('.word-kanji')).toHaveCount(kanji?1:0);if(kanji)await expect(tile.locator('.word-kanji')).toHaveText(kanji);
      const example = tile.locator('.example-phrase'); await example.scrollIntoViewIfNeeded();
      await expect(example).toHaveAttribute('aria-pressed', 'false');
      const geometry = () => tile.evaluate(element => { const r = element.getBoundingClientRect(); const scroller = element.closest('.session-scroll')!; const grid = element.closest('.word-group-grid')!; return { width:r.width, height:r.height, gridHeight:grid.getBoundingClientRect().height, scrollHeight:scroller.scrollHeight, documentWidth:document.documentElement.scrollWidth }; });
      const before = await geometry(); await example.click(); await expect(example).toHaveAttribute('aria-pressed', 'true'); const translated = await geometry();
      await example.press('Enter'); await expect(example).toHaveAttribute('aria-pressed', 'false'); const restored = await geometry();
      expect(translated).toEqual(before); expect(restored).toEqual(before);
      await expect(tile.locator('.example-play')).toHaveText('▶');
      const play=tile.locator('.example-play');const phraseBox=await example.boundingBox(),playBox=await play.boundingBox();expect(playBox!.x).toBeGreaterThanOrEqual(phraseBox!.x+phraseBox!.width-1);expect(playBox!.height).toBeGreaterThanOrEqual(44);
      for(const selector of ['.word-meaning','.word-note'])expect(await tile.locator(selector).evaluate(element=>parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(16);
      if(!exampleAudioChecked){const introduction=course.learning!.find(route=>route.lessonId.endsWith('.04'))!.goals[0]!.parts[0]!.words.find(value=>value.wordId===word.id)!;await play.click();const audio=page.getByTestId('learning-word-group').locator('audio');await expect.poll(()=>audio.evaluate((audio:HTMLAudioElement)=>audio.currentTime),{timeout:10000}).toBeGreaterThan(.03);expect(await audio.evaluate((audio:HTMLAudioElement)=>audio.currentSrc)).toBe(new URL(introduction.example.audioUrl!,page.url()).href);await audio.evaluate((audio:HTMLAudioElement)=>audio.pause());exampleAudioChecked=true;}

      expect(await tile.locator('summary').count()).toBe(0);
      measurements.push({ viewport, wordId:word.id, geometry:before, clickAndEnterNoGrowth:true });
    }
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `${output}/group-${viewport.width}x${viewport.height}.png`, fullPage: true });
  }
  const propMeasurements: unknown[] = []; const propCollisions:unknown[]=[];
  for (const viewport of [{width:1280,height:900},{width:1280,height:720},{width:1539,height:1466},{width:1920,height:1080},{width:390,height:844},{width:320,height:740}]) {
    await page.setViewportSize(viewport); await page.waitForTimeout(100);
    const props = await page.locator('.desk-prop').evaluateAll((elements, tiles) => elements.map(element => { const tile = tiles.find(tile => tile.id === (element as HTMLElement).dataset.prop)!; const r = element.getBoundingClientRect(); const bounds = tile.contentBounds; return { id:tile.id, visible:getComputedStyle(element).display!=='none', left:r.x+r.width*bounds.x, right:r.x+r.width*(bounds.x+bounds.width), top:r.y+r.height*bounds.y, bottom:r.y+r.height*(bounds.y+bounds.height), width:r.width*bounds.width, intrinsicVisibleWidth:parseFloat(getComputedStyle(element).width)*bounds.width }; }), propsManifest.tiles);
    const tea = props.find(prop => prop.id === 'tea')!; const teapot = props.find(prop => prop.id === 'teapot')!;
    expect(tea).toBeTruthy(); expect(teapot).toBeTruthy(); expect(teapot.intrinsicVisibleWidth / tea.intrinsicVisibleWidth).toBeCloseTo(1.5, 2); if(tea.visible&&teapot.visible)expect(teapot.width/tea.width).toBeCloseTo(1.5,2);
    for (const prop of props.filter(prop => prop.visible)) { expect(prop.left).toBeGreaterThanOrEqual(0); expect(prop.right).toBeLessThanOrEqual(viewport.width + 1); expect(prop.top).toBeGreaterThanOrEqual(0); expect(prop.bottom).toBeLessThanOrEqual(viewport.height + 1); }
    const visible=props.filter(prop=>prop.visible);expect(Math.max(...visible.map(prop=>prop.bottom))-Math.min(...visible.map(prop=>prop.bottom))).toBeLessThan(1);
    for(let i=0;i<visible.length;i++)for(let j=i+1;j<visible.length;j++){const a=visible[i]!,b=visible[j]!;const width=Math.max(0,Math.min(a.right,b.right)-Math.max(a.left,b.left)),height=Math.max(0,Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top));const fraction=width*height/Math.min((a.right-a.left)*(a.bottom-a.top),(b.right-b.left)*(b.bottom-b.top));propCollisions.push({viewport,a:a.id,b:b.id,overlapOfSmaller:fraction});expect(fraction,`${a.id}/${b.id} visibly overlap at ${viewport.width}x${viewport.height}`).toBeLessThan(.1);}
    propMeasurements.push({ viewport, props, teapotCupVisibleWidthRatio:tea.visible&&teapot.visible?teapot.width/tea.width:null,commonSetScaleRatio:teapot.intrinsicVisibleWidth/tea.intrinsicVisibleWidth });
  }
  return {tiles:measurements,props:propMeasurements,propCollisions,exampleAudioChecked};
}

/** Native IO keeps an offscreen illustration's reserved SVG box without requesting its atlas. */
export async function checkLazyIllustrations(page:Page){
 const pictures=page.locator('.word-introduction > .word-illustration');await expect(pictures).toHaveCount(5);await expect(pictures.first().locator('image')).toHaveCount(1);await expect(pictures.last().locator('image')).toHaveCount(0);
 const before=await pictures.last().boundingBox();await pictures.last().scrollIntoViewIfNeeded();await expect(pictures.last().locator('image')).toHaveCount(1);const after=await pictures.last().boundingBox();expect(after!.width).toBe(before!.width);expect(after!.height).toBe(before!.height);await pictures.first().scrollIntoViewIfNeeded();await expect(pictures.last().locator('image')).toHaveCount(1);
 return{nativeIntersectionObserver:true,offscreenImageAbsent:true,reservedSizeStable:true,loadedOnceWhenVisible:true};
}
