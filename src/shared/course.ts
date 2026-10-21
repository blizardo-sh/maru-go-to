import data from "../../materials/course.json";
import type { Course } from "./types";

export function validateCourse(value: Course): void {
  const ensure = (ok: unknown, message: string): void => {
    if (!ok) throw new Error(`Invalid course: ${message}`);
  };
  const unique = (items: { id: string }[], label: string) => {
    const ids = new Set(items.map((item) => item.id));
    ensure(ids.size === items.length, `duplicate ${label} id`);
    return ids;
  };
  const lessons = unique(value.lessons, "lesson");
  const words = unique(value.words, "word");
  const forms = unique(value.forms, "form");
  const skills = unique(value.skills, "skill");
  unique(value.exercises, "exercise");
  ensure(value.lessons.length === 18, "expected all 18 Starter A1 lessons");
  ensure(new Set(value.lessons.map((lesson) => lesson.number)).size === 18, "lesson numbers");
  const canDos = new Set(value.lessons.flatMap((lesson) => lesson.canDoIds));
  ensure(canDos.size === 50 && Array.from({ length: 50 }, (_, i) => i + 1).every((id) => canDos.has(id)), "Can-do 1–50");
  for (const entry of [...value.words, ...value.forms]) {
    ensure(entry.lessonIds.length && entry.lessonIds.every((id) => lessons.has(id)), `lesson reference ${entry.id}`);
    ensure(entry.surface.length && entry.kana.length, `missing spelling ${entry.id}`);
    ensure(entry.segments.map((segment) => segment.surface).join("") === entry.surface, `surface segments ${entry.id}`);
    ensure(entry.segments.map((segment) => segment.reading ?? segment.surface).join("") === entry.kana, `reading segments ${entry.id}`);
    ensure(entry.sourceRefs.length, `source provenance ${entry.id}`);
  }
  for (const form of value.forms) ensure(words.has(form.wordId), `form word ${form.id}`);
  for (const word of value.words) {
    ensure(word.meaningRu.trim(), `missing meaning ${word.id}`);
    ensure(word.audioText === undefined || (typeof word.audioText === "string" && word.audioText.trim().length > 0 && word.audioText.length <= 1000 && /^[ぁ-ゖァ-ヺー・\s]+$/u.test(word.audioText)), `audio pronunciation ${word.id}`);
    ensure(value.forms.some((form) => form.wordId === word.id && form.surface === word.surface && form.kana === word.kana), `default form ${word.id}`);
  }
  for (const skill of value.skills) {
    ensure(skill.lessonIds.length && skill.lessonIds.every((id) => lessons.has(id)), `skill lessons ${skill.id}`);
    ensure(skill.canDoIds.every((id) => canDos.has(id)), `skill Can-do ${skill.id}`);
  }
  for (const exercise of value.exercises) {
    ensure(lessons.has(exercise.lessonId) && skills.has(exercise.skillId), `exercise references ${exercise.id}`);
    ensure(exercise.translationRu === undefined || (typeof exercise.translationRu === "string" && exercise.translationRu.trim().length > 0 && exercise.translationRu.length <= 3000), `exercise translation ${exercise.id}`);
    const tokenIds = unique(exercise.tokens, `token in ${exercise.id}`);
    ensure(exercise.tokens.length && exercise.tokens.every((token) => forms.has(token.formId)), `exercise forms ${exercise.id}`);
    ensure(exercise.acceptedOrders.length, `missing answer ${exercise.id}`);
    for (const order of exercise.acceptedOrders) {
      ensure(order.length > 0 && new Set(order).size === order.length && order.every((id) => tokenIds.has(id)), `invalid answer permutation ${exercise.id}`);
      if (order.length < tokenIds.size) ensure(exercise.contextRu?.trim() && exercise.translationRu?.trim(), `equivalent answer context ${exercise.id}`);
    }
    ensure(exercise.acceptedOrders.some((order) => order.length === tokenIds.size), `missing full answer ${exercise.id}`);
  }
  for (const lesson of value.lessons) {
    for (const part of ["katsudoo", "rikai"]) {
      ensure(value.words.some((word) => word.lessonIds.includes(lesson.id) && word.sourceRefs.some((ref) => ref.part === part && ref.url.includes("VocabularyIndex"))), `missing ${part} vocabulary lesson ${lesson.number}`);
    }
    if (lesson.number >= 3) ensure(value.exercises.some((exercise) => exercise.lessonId === lesson.id), `empty construction lesson ${lesson.number}`);
  }
}

export const course: Course = data as Course;
validateCourse(course);
