// This sample is frame animation: the old three-layer rig cannot supply walking paws.
export function sampleCat(seconds: number, reduced = false) {
  if (reduced) return { frame: 12, step: 0, phase: 'Спокойный жест', done: true };
  if (seconds < 2.4) {
    const index = Math.min(23, Math.floor(Math.max(0, seconds) * 10));
    return { frame: index % 8, step: Math.floor(index / 4), phase: 'Шаги · перенос опоры', done: false };
  }
  if (seconds < 3.2) return { frame: 8 + Math.min(3, Math.floor((seconds - 2.4) * 5)), step: 6, phase: 'Поворот к ученику', done: false };
  return { frame: 12 + Math.min(3, Math.floor((seconds - 3.2) * 5)), step: 6, phase: 'Жест и взгляд', done: seconds >= 4.2 };
}

export const riverMasks = {
  desktop: { width: 1600, height: 900, water: [260, 450, 420, 424, 650, 419, 794, 442, 885, 465, 1045, 482, 1075, 535, 962, 555, 796, 552, 712, 609, 585, 609, 470, 566, 310, 558, 195, 584, 195, 536, 264, 507] },
  mobile: { width: 540, height: 960, water: [63, 447, 176, 438, 289, 449, 379, 469, 428, 495, 526, 518, 539, 545, 539, 594, 448, 592, 377, 572, 280, 603, 269, 649, 0, 649, 0, 549, 72, 535] },
} as const;
