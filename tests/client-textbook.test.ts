import { expect, test } from 'bun:test';
import { course } from '../src/shared/course';
import { equivalentCanDoGroups, toggleCanDoGroup } from '../src/client/textbookChoices';

const eligible = (ids: number[]) => course.exercises.filter(exercise => !ids.length || course.skills.find(skill => skill.id === exercise.skillId)?.canDoIds.some(id => ids.includes(id))).map(exercise => exercise.id).sort();

test('grouping equivalent Can-do choices preserves eligible prepared exercise IDs', () => {
  for (const lesson of course.lessons) for (const group of equivalentCanDoGroups(course, lesson.canDoIds)) {
    for (const id of group.ids) expect(eligible([id])).toEqual(eligible(group.ids));
    expect(new Set(group.ids).size).toBe(group.ids.length);
  }
});

test('rendering groups never rewrites legacy partial choices and toggling affects only that group', () => {
  const lesson = course.lessons.find(lesson => lesson.number === 3)!;
  const originalIds = [...lesson.canDoIds]; const legacy = [5, 7];
  const groups = equivalentCanDoGroups(course, lesson.canDoIds); const group = groups[0]!;
  expect(group.ids).toEqual([5, 6]); expect(legacy).toEqual([5, 7]); expect(lesson.canDoIds).toEqual(originalIds);
  expect(toggleCanDoGroup(legacy, group.ids)).toEqual([7]); expect(legacy).toEqual([5, 7]);
  const selected = toggleCanDoGroup([7], group.ids);
  expect(selected).toEqual([7, 5, 6]); expect(eligible(selected)).toEqual(eligible(legacy));
});
