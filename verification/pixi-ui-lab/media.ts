export const videoUrl = 'https://a1.marugotoweb.jp/en/assets/movies/topics/cando_01_01.mp4';

export async function probeVideo(video: HTMLVideoElement) {
  const cors = document.createElement('video');
  cors.crossOrigin = 'anonymous'; cors.preload = 'metadata'; cors.muted = true;
  const corsResult = new Promise<string>(resolve => {
    const timer = setTimeout(() => resolve('timeout'), 12000);
    const done = (result: string) => { clearTimeout(timer); resolve(result); };
    cors.onloadedmetadata = () => done('allowed'); cors.onerror = () => done('blocked');
  });
  cors.src = videoUrl;
  let native = 'pending', upload = 'not-tested';
  try {
    video.src = videoUrl;
    await video.play();
    native = 'playing';
    const surface = document.createElement('canvas');
    const gl = surface.getContext('webgl');
    if (gl) {
      const texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, texture);
      try {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
        upload = gl.getError() === gl.NO_ERROR ? 'allowed' : 'gl-error';
      } catch (error) { upload = error instanceof DOMException ? error.name : 'error'; }
      gl.deleteTexture(texture); gl.getExtension('WEBGL_lose_context')?.loseContext();
    } else upload = 'webgl-unavailable';
  } catch (error) { native = error instanceof DOMException ? error.name : 'error'; }
  const crossOrigin = await corsResult;
  cors.pause(); cors.removeAttribute('src'); cors.load();
  return { crossOrigin, native, upload, source: videoUrl };
}
