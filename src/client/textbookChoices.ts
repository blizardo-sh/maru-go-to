import type { Course, Skill } from '../shared/types';

export function equivalentCanDoGroups(course: Course, canDoIds: number[]) {
  const groups = new Map<string, { ids: number[]; skills: Skill[]; exerciseCount: number }>();
  for (const id of canDoIds) {
    const skills = course.skills.filter(skill => skill.canDoIds.includes(id));
    const key = JSON.stringify(skills.map(skill => skill.id).sort());
    const existing = groups.get(key);
    if (existing) existing.ids.push(id);
    else groups.set(key, { ids: [id], skills, exerciseCount: course.exercises.filter(exercise => skills.some(skill => skill.id === exercise.skillId)).length });
  }
  return [...groups.values()];
}

export function toggleCanDoGroup(selected: number[], groupIds: number[]) {
  return groupIds.some(id => selected.includes(id)) ? selected.filter(id => !groupIds.includes(id)) : [...selected, ...groupIds];
}
