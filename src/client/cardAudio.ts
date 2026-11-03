// Reassigning src discards buffered audio; keep the same source ready between taps.
export function prepareCardAudio(audio: HTMLAudioElement, url: string) {
  if (audio.getAttribute('src') === url) return;
  audio.preload = 'auto'; audio.src = url; audio.load();
}
const warming = new Set<string>();
export function warmCardAudio(urls: (string | null | undefined)[]) {
  for (const url of urls.filter((url): url is string => !!url).slice(0, 3)) {
    if (warming.has(url)) continue;
    warming.add(url);
    if (warming.size > 24) warming.delete(warming.values().next().value!);
    void fetch(url, { cache: 'force-cache' }).then(response => {
      if (!response.ok) warming.delete(url);
      return response.arrayBuffer();
    }).catch(() => warming.delete(url));
  }
}
