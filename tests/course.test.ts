import { describe, expect, test } from "bun:test";
import { course, validateCourse } from "../src/shared/course";

describe("published full-course material", () => {
  test("retains every source vocabulary row, both parts, and all 52 grammar notes", () => {
    const rows = new Set(course.words.flatMap((word) => word.sourceRefs.filter((ref) => ref.url.includes("VocabularyIndex")).map((ref) => `${ref.url}:${ref.page}:${ref.row}`)));
    expect(rows.size).toBe(1113);
    for (const part of ["katsudoo", "rikai"]) {
      const refs = new Set(course.words.flatMap((word) => word.sourceRefs.filter((ref) => ref.part === part && ref.url.includes("VocabularyIndex")).map((ref) => `${ref.url}:${ref.page}:${ref.row}`)));
      expect(refs.size).toBe(part === "katsudoo" ? 546 : 567);
      for (let n = 1; n <= 18; n++) {
        expect(course.words.some((word) => word.sourceRefs.some((ref) => ref.part === part && ref.url.includes("VocabularyIndex") && ref.label === `Словарь · урок ${n}`))).toBe(true);
      }
    }
    expect(new Set(course.skills.flatMap((skill) => skill.sourceRefs.filter((ref) => ref.url.includes("/note_")).map((ref) => ref.url))).size).toBe(52);
    for (const skill of course.skills) expect(course.exercises.filter((exercise) => exercise.skillId === skill.id).length).toBeGreaterThanOrEqual(2);
    expect(course.lessons.slice(0, 2).every((lesson) => lesson.readiness.grammar === "not-applicable")).toBe(true);
  });

  test("preserves prepared kana and okurigana instead of inventing per-character readings", () => {
    const eat = course.words.find((word) => word.surface === "食べます");
    expect(eat?.kana).toBe("たべます");
    expect(eat?.segments).toEqual([{ surface: "食", reading: "た" }, { surface: "べます" }]);
    const coffee = course.words.find((word) => word.surface === "コーヒー");
    expect(coffee?.kana).toBe("コーヒー");
    const japan = course.words.find((word) => word.surface === "日本");
    expect(course.forms.filter((form) => form.wordId === japan?.id).map((form) => form.kana)).toContain("にっぽん");
  });

  test("past and polite forms keep one word sense; repeated functions keep one skill", () => {
    const go = course.words.find((word) => word.kana === "いきます" && word.meaningRu === "идти");
    expect(go).toBeDefined();
    const kana = course.forms.filter((form) => form.wordId === go?.id).map((form) => form.kana);
    expect(kana).toContain("いきました");
    expect(kana).toContain("いきませんでした");
    expect(course.skills.filter((skill) => skill.id.endsWith(".ga_ability"))).toHaveLength(1);
    expect(course.skills.find((skill) => skill.id.endsWith(".ga_ability"))?.lessonIds).toEqual(["marugoto.starter-a1.lesson.03", "marugoto.starter-a1.lesson.11"]);
  });

  test("accepts meaningful enumeration alternatives without reversing family relationships", () => {
    const parents = course.exercises.find((exercise) => exercise.id.includes("to_noun_list") && exercise.promptRu.includes("отец"));
    expect(parents?.acceptedOrders).toEqual([["t1", "t2", "t3", "t4"], ["t3", "t2", "t1", "t4"]]);
    const wife = course.exercises.find((exercise) => exercise.id.includes("no_relation") && exercise.promptRu.includes("жена"));
    expect(wife?.acceptedOrders).toEqual([["t1", "t2", "t3", "t4"]]);
  });

  test("corrects documented dates and classifier translation mistakes", () => {
    expect(course.words.find((word) => word.surface === "五日")?.meaningRu).toBe("пятое число");
    expect(course.words.find((word) => word.surface === "二十日")?.meaningRu).toBe("двадцатое число");
    expect(course.words.filter((word) => word.kana === "まい").every((word) => word.meaningRu === "счётный суффикс для плоских предметов")).toBe(true);
  });

  test("keeps wrapped source translations in their table cells and merges recovered senses", () => {
    const bySource = (part: string, page: number, row: number) => course.words.find((word) => word.sourceRefs.some((ref) => ref.part === part && ref.url.includes("VocabularyIndex") && ref.page === page && ref.row === row));
    expect(bySource("katsudoo", 1, 2)?.meaningRu).toBe("один");
    expect(bySource("katsudoo", 1, 3)?.meaningRu).toBe("катакана (японская слоговая азбука для написания заимствованных слов, а также выделения какого-то слова)");
    expect(bySource("rikai", 1, 36)?.meaningRu).toBe("Австралия");
    expect(bySource("rikai", 2, 34)?.meaningRu).toBe("государственный служащий");
    expect(bySource("katsudoo", 8, 45)?.meaningRu).toBe("японское метательное оружие - сюрикэн");
    expect(bySource("katsudoo", 8, 46)?.meaningRu).toBe('Токио Скай Три - "Токийское небесное дерево" - телевизионная башня в районе Сумида, Токио');
    expect(bySource("katsudoo", 1, 3)?.id).toBe(bySource("rikai", 1, 37)?.id);
    expect(bySource("katsudoo", 1, 2)?.id).toBe(bySource("rikai", 4, 31)?.id);
    const vocabulary = course.words.filter((word) => word.sourceRefs.some((ref) => ref.url.includes("VocabularyIndex")));
    expect(new Set(vocabulary.map((word) => `${word.kana}|${word.meaningRu}`)).size).toBe(vocabulary.length);
  });

  test("resolves exercise helpers by grammatical meaning and keeps lexical homophones separate", () => {
    const particles = new Set(["は", "が", "を", "に", "の", "と", "も", "で", "から", "まで", "か"]);
    for (const exercise of course.exercises) {
      for (const token of exercise.tokens) {
        const form = course.forms.find((candidate) => candidate.id === token.formId)!;
        if (particles.has(form.surface)) expect(course.words.find((word) => word.id === form.wordId)?.pos).toBe("particle");
        if (form.surface === "たかかったです") expect(course.words.find((word) => word.id === form.wordId)?.meaningRu).toBe("дорогой");
      }
      expect(exercise.contextRu ?? "").not.toContain("Авторский учебный пример");
    }
    const number = course.words.find((word) => word.surface === "二")!;
    expect(number.meaningRu).toBe("два");
    expect(number.lessonIds).toEqual(["marugoto.starter-a1.lesson.01", "marugoto.starter-a1.lesson.07"]);
    const particle = course.words.find((word) => word.surface === "に" && word.pos === "particle")!;
    expect(particle.id).not.toBe(number.id);
    expect(course.forms.filter((form) => form.wordId === particle.id).every((form) => form.surface === "に")).toBe(true);
  });

  test("accepts equivalent adverb, place and recipient phrase orders", () => {
    const answers = (key: string) => {
      const exercise = course.exercises.find((item) => item.id.endsWith(key))!;
      const forms = new Map(exercise.tokens.map((token) => [token.id, course.forms.find((form) => form.id === token.formId)!.surface]));
      return exercise.acceptedOrders.map((order) => order.map((id) => forms.get(id)).join("|"));
    };
    expect(answers("frequency.l05.1")).toContain("よく|コーヒー|を|のみます");
    expect(answers("de_activity_place.l06.1")).toContain("すし|を|レストラン|で|たべます");
    expect(answers("ageru.l15.1")).toContain("わたし|は|ほん|を|ともだち|に|あげます");
    expect(answers("verb_past.l15.1")).toContain("にほん|で|きょねん|とけい|を|買いました");
  });

  test("prepares isolated particle pronunciation without changing Japanese spelling", () => {
    for (const { surface, audioText } of [{ surface: "は", audioText: "わ" }, { surface: "を", audioText: "お" }]) {
      const particle = course.words.find((word) => word.pos === "particle" && word.surface === surface)!;
      expect(particle.kana).toBe(surface);
      expect(particle.audioText).toBe(audioText);
      expect(course.forms.filter((form) => form.wordId === particle.id).every((form) => form.kana === surface)).toBe(true);
    }
    const invalidAudio = structuredClone(course);
    invalidAudio.words[0]!.audioText = "";
    expect(() => validateCourse(invalidAudio)).toThrow("audio pronunciation");
  });

  test("prepares context-specific speech without replacing lexical は or Japanese spelling", () => {
    for (const [kana, speech] of [['こんにちは', 'こんにちわ'], ['こんばんは', 'こんばんわ'], ['おくには？', 'おくにわ'], ['おしごとは？', 'おしごとわ'], ['きをつけて', 'きおつけて'], ['〜はちょっと…', 'わちょっと']]) {
      const phrase = course.words.find(word => word.kana === kana)!;
      expect(phrase.audioText).toBe(speech);
      expect(course.forms.find(form => form.wordId === phrase.id && form.kana === kana)).toBeDefined();
    }
    for (const kana of ['はなします', 'はは', 'あさごはん']) expect(course.words.filter(word => word.kana === kana).every(word => word.audioText === undefined)).toBe(true);
  });

  test("keeps prepared sentence meanings separate from exercise instructions", () => {
    expect(course.exercises).toHaveLength(108);
    for (const exercise of course.exercises) {
      expect(exercise.translationRu?.trim()).toBeTruthy();
      expect(exercise.translationRu ?? "").not.toMatch(/назови|пригласи:|прими приглашение:|объясни причину:|собеседник|противопоставление/iu);
    }
    const translation = (key: string) => course.exercises.find((exercise) => exercise.id.endsWith(key))?.translationRu;
    expect(translation("to_noun_list.l04.1")).toBe("Это мой отец и моя мать.");
    expect(translation("wa_identity.l03.1")).toBe("Я студент.");
    expect(translation("adjective_noun_modifier.l14.1")).toBe("Старое святилище");
    expect(translation("noun_o_kudasai.l16.1")).toBe("Дайте эту футболку, пожалуйста.");
    const invalidTranslation = structuredClone(course);
    invalidTranslation.exercises[0]!.translationRu = " ";
    expect(() => validateCourse(invalidTranslation)).toThrow("exercise translation");
    invalidTranslation.exercises[0]!.translationRu = "я".repeat(3001);
    expect(() => validateCourse(invalidTranslation)).toThrow("exercise translation");
  });

  test("equivalent omissions require explicit nonempty answers, context and a full inventory answer", () => {
    const example = course.exercises.find(exercise => exercise.id.endsWith("ga_ability.l03.1"))!;
    expect(example.acceptedOrders).toEqual([["t1", "t2", "t3", "t4", "t5"], ["t3", "t4", "t5"]]);
    const withoutContext = structuredClone(course);
    delete withoutContext.exercises.find(exercise => exercise.id === example.id)!.contextRu;
    expect(() => validateCourse(withoutContext)).toThrow("equivalent answer context");
    const withoutFull = structuredClone(course);
    withoutFull.exercises.find(exercise => exercise.id === example.id)!.acceptedOrders = [["t3", "t4", "t5"]];
    expect(() => validateCourse(withoutFull)).toThrow("missing full answer");
    for (const order of [[], ["t3", "missing"], ["t3", "t3"]]) {
      const invalid = structuredClone(course);
      invalid.exercises.find(exercise => exercise.id === example.id)!.acceptedOrders.push(order);
      expect(() => validateCourse(invalid)).toThrow("invalid answer permutation");
    }
  });

  test("rejects broken references, readings and duplicate token permutations", () => {
    validateCourse(course);
    const badReading = structuredClone(course);
    badReading.words[0]!.kana = "うそ";
    expect(() => validateCourse(badReading)).toThrow("reading segments");
    const badAnswer = structuredClone(course);
    badAnswer.exercises[0]!.acceptedOrders = [["t1", "t1"]];
    expect(() => validateCourse(badAnswer)).toThrow("invalid answer permutation");
    const badReference = structuredClone(course);
    badReference.forms[0]!.wordId = "missing";
    expect(() => validateCourse(badReference)).toThrow("form word");
  });
});
