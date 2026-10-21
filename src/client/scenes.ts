export const sceneIds = ['room', 'garden', 'mountains', 'river', 'tokyo'] as const;
export type SceneId = typeof sceneIds[number];

export function chooseScene(random: () => number = Math.random): SceneId {
  return sceneIds[Math.floor(random() * sceneIds.length)]!;
}
