import { Assets, type Texture } from 'pixi.js';
// One owner per disjoint asset family. Retiring loads finish before the same URL reloads.
export class M6Textures {
  private loaded = new Map<string, Promise<Texture>>();
  private retiring = new Map<string, Promise<void>>();
  private keep = new Set<string>();
  private disposed = false;
  load(url: string) {
    let promise = this.loaded.get(url);
    if (!promise) {
      promise = (this.retiring.get(url) ?? Promise.resolve()).then(() => Assets.load<Texture>(url)).catch(error => { this.loaded.delete(url); throw error; });
      this.loaded.set(url, promise);
    }
    return promise;
  }
  retain(urls: string[]) { this.keep = new Set(urls); this.prune(); }
  private prune() {
    for (const [url, promise] of this.loaded) if (this.disposed || !this.keep.has(url)) {
      void promise.then(() => {
        if (this.loaded.get(url) !== promise || !this.disposed && this.keep.has(url)) return;
        this.loaded.delete(url);
        const retiring = Assets.unload(url).catch(() => {}).finally(() => { if (this.retiring.get(url) === retiring) this.retiring.delete(url); });
        this.retiring.set(url, retiring);
      }).catch(() => {});
    }
  }
  snapshot() { return { assets: this.loaded.size, retiring: this.retiring.size }; }
  dispose() { this.disposed = true; this.keep.clear(); this.prune(); }
}
