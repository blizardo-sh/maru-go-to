import metadata from '../../../assets/canvas/m6-v4/manifest.json';
export function wholeCatMotion(seconds: number, reduced = false) {
  const t=Math.max(0,seconds),last=metadata.frames.length-1;
  const frame=reduced||t>=3.05?last:t<1.2?Math.min(23,Math.floor(t*20)):t<1.45?0:t<2.25?Math.min(48,24+Math.floor((t-1.45)*30)):t<2.45?48:Math.min(last,49+Math.floor((t-2.45)*30));
  const phase=t<1.2&&!reduced?'Шаги · перенос опоры':t<2.45&&!reduced?'Поворот к ученику':'Жест и взгляд';
  const p=Math.min(1,t/1.2);
  return {frame,phase,x:reduced?60:60*p*p*(3-2*p)};
}
