import { toHiragana } from "wanakana";
import type { VocabItem } from "@/schemas/lesson";

/** 出題候選 = 單字 + 所屬課號(用於同課/鄰近課干擾項規則) */
export interface QuizCandidate extends VocabItem {
  lessonId: number;
}

export type McqDirection = "jp-to-zh" | "zh-to-jp";
export type QuestionType = McqDirection | "input";

export interface McqOption {
  id: string;
  candidate: QuizCandidate;
  correct: boolean;
}

export interface McqQuestion {
  type: McqDirection;
  answer: QuizCandidate;
  options: McqOption[];
}

export interface InputQuestion {
  type: "input";
  answer: QuizCandidate;
}

export type Question = McqQuestion | InputQuestion;

type Rng = () => number;

/** Fisher–Yates,以注入的 rng 取得確定性(測試)/隨機(執行期) */
function shuffle<T>(arr: T[], rng: Rng): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * 輸入題比對:以 WanaKana toHiragana 正規化後全等。
 * 羅馬字自動轉假名;平/片假名視為等同;前後空白忽略。
 */
export function checkInput(input: string, answerKana: string): boolean {
  const norm = (s: string) => toHiragana(s.trim());
  const a = norm(input);
  return a.length > 0 && a === norm(answerKana);
}

/**
 * 選擇干擾項。規則(F3.2):
 *   1. 同課同詞性
 *   2. 不足 → 鄰近課同詞性(依課號距離)
 *   3. 仍不足 → 其他詞性(依課號距離)
 * 不含正解、不重複、不與正解同義/同音(避免重複選項)。
 */
export function pickDistractors(
  answer: QuizCandidate,
  pool: QuizCandidate[],
  count: number,
  rng: Rng = Math.random,
): QuizCandidate[] {
  const usable = pool.filter(
    (c) =>
      c.id !== answer.id &&
      c.meaning !== answer.meaning &&
      c.kana !== answer.kana,
  );

  const byDistance = (a: QuizCandidate, b: QuizCandidate) =>
    Math.abs(a.lessonId - answer.lessonId) -
    Math.abs(b.lessonId - answer.lessonId);

  const samePos = usable.filter((c) => c.pos === answer.pos);
  const tier1 = shuffle(
    samePos.filter((c) => c.lessonId === answer.lessonId),
    rng,
  );
  const tier2 = samePos
    .filter((c) => c.lessonId !== answer.lessonId)
    .sort(byDistance);
  const tier3 = usable.filter((c) => c.pos !== answer.pos).sort(byDistance);

  const ordered = [...tier1, ...tier2, ...tier3];

  const picked: QuizCandidate[] = [];
  const seen = new Set<string>();
  for (const c of ordered) {
    if (picked.length >= count) break;
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    picked.push(c);
  }
  return picked;
}

function makeMcq(
  answer: QuizCandidate,
  pool: QuizCandidate[],
  direction: McqDirection,
  optionCount: number,
  rng: Rng,
): McqQuestion {
  const distractors = pickDistractors(answer, pool, optionCount - 1, rng);
  const options: McqOption[] = shuffle(
    [
      { id: answer.id, candidate: answer, correct: true },
      ...distractors.map((c) => ({ id: c.id, candidate: c, correct: false })),
    ],
    rng,
  );
  return { type: direction, answer, options };
}

export interface GenerateQuizOptions {
  count?: number;
  optionCount?: number;
  types?: QuestionType[];
  rng?: Rng;
}

/**
 * 為 `lessonId` 出題。`pool` 應含該課單字 + 鄰近課單字(供干擾項)。
 * 題型在 enabled types 間輪替;選擇題干擾項依 pickDistractors 規則。
 */
export function generateQuiz(
  lessonId: number,
  pool: QuizCandidate[],
  options: GenerateQuizOptions = {},
): Question[] {
  const {
    count = 10,
    optionCount = 4,
    types = ["jp-to-zh", "zh-to-jp", "input"],
    rng = Math.random,
  } = options;

  if (types.length === 0) return [];

  const targets = shuffle(
    pool.filter((c) => c.lessonId === lessonId),
    rng,
  ).slice(0, count);

  return targets.map((answer, i) => {
    const type = types[i % types.length];
    return type === "input"
      ? { type: "input", answer }
      : makeMcq(answer, pool, type, optionCount, rng);
  });
}
