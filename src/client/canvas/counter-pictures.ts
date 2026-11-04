import { Assets, Rectangle, Texture } from 'pixi.js';
import type { CourseCatalog } from '@app/shared/catalog';

export class CounterPictures {
  readonly textures = new Map<number, Texture>();
  loading = false;
  error = '';
  private key = '';
  private epoch = 0;
  constructor(private changed: () => void) {}
  private signature(catalog: CourseCatalog) { return JSON.stringify([catalog.counterAtlas, catalog.counters.objects.map(object => [object.id, object.tile])]); }
  ready(catalog: CourseCatalog) { return this.key === this.signature(catalog) && !this.loading && !this.error; }
  use(catalog: CourseCatalog) {
    const key = this.signature(catalog); if (key === this.key) return;
    const epoch = ++this.epoch; this.key = key; this.loading = true; this.error = '';
    void (async () => {
      try {
        const atlas = catalog.counterAtlas; if (!atlas) throw new Error('В этой версии материала нет иллюстраций счёта.');
        const source = await Assets.load<Texture>(atlas.src); if (epoch !== this.epoch) return;
        const next = new Map<number, Texture>();
        try {
          for (const object of catalog.counters.objects) {
            const bounds = atlas.cells[object.id];
            if (!bounds || bounds.length !== 4 || bounds.some(value => !Number.isFinite(value)) || bounds[0]! < 0 || bounds[1]! < 0 || bounds[2]! <= 0 || bounds[3]! <= 0 || bounds[0]! + bounds[2]! > source.width || bounds[1]! + bounds[3]! > source.height) throw new Error('Иллюстрация не совпадает с версией материала.');
            next.set(object.tile, new Texture({ source: source.source, frame: new Rectangle(bounds[0], bounds[1], bounds[2], bounds[3]) }));
          }
        } catch (error) { for (const texture of next.values()) texture.destroy(false); throw error; }
        for (const texture of this.textures.values()) texture.destroy(false);
        this.textures.clear(); for (const [tile, texture] of next) this.textures.set(tile, texture);
      } catch { if (epoch === this.epoch) this.error = 'Иллюстрации счёта не загрузились. Повторите загрузку.'; }
      finally { if (epoch === this.epoch) { this.loading = false; this.changed(); } }
    })();
  }
  async retry(catalog: CourseCatalog) { if (catalog.counterAtlas) await Assets.unload(catalog.counterAtlas.src).catch(() => {}); this.key = ''; this.use(catalog); this.changed(); }
  clear() { ++this.epoch; for (const texture of this.textures.values()) texture.destroy(false); this.textures.clear(); this.key = ''; this.loading = false; this.error = ''; }
}
