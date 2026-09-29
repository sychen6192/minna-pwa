import { toHiragana, toKatakana } from "wanakana";
import { isSupplementary } from "@/lib/notes";
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

// ── 輸入題判分(F3.3、T10.4)────────────────────────────────────────

/** 比對時忽略:空白(含全形)、「、・。」等標點、「〜…」、語境括號「」(NFKC 後的半形標點一併列入) */
const IGNORED_RE = /[\s、・。,.?!「」〜~…]/g;
/** 各種橫線視同長音「ー」(教材的 え―と 用 U+2015;羅馬字輸入的 - 由 wanakana 轉為ー) */
const DASH_RE = /[-‐‑‒–—―−]/g;
/** 可作為輸入題答案的字元:平假名、片假名、長音 */
const KANA_ONLY_RE = /^[ぁ-ゖァ-ヺー]+$/;
/** 〜/…:表面含之者是接續用法或數量詞框架,不是可輸入的讀音 */
const ELLIPSIS_RE = /[〜…]/;
/** （…）:替代說法(トイレ（お手洗い）、いい （よい）),括號內外各為一個答案 */
const ALT_PAREN_RE = /（([^（）]*)）/;
/** ［…］〔…〕:可省略 */
const OPTIONAL_RE = /［([^［］]*)］|〔([^〔〕]*)〕/;
/** 「…」:語境提示(「〜を」ください),內容含〜者整段去除 */
const QUOTE_RE = /「([^「」]*)」/;
/** IME 習慣以「nn」(或 nn')打「ん」;wanakana 則把 nn 轉成「んん」(sennsei → せんんせい) */
const IME_NN_RE = /nn'?/g;
/** 片假名 オ段 + ー:toHiragana 展開為「う」(コーヒー → こうひい);另收「お」(koohii) */
const O_ROW_LONG_RE = /([オコゴソゾトドノホボポモヨョロヲォ])ー/g;

/** 全形英數/半形假名正規化(NFKC)、小寫,去除忽略字元,橫線統一為「ー」。 */
function clean(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(IGNORED_RE, "")
    .replace(DASH_RE, "ー");
}

/**
 * 讀音比對鍵:羅馬字、平假名、片假名一律轉為平假名。先 toKatakana 再 toHiragana,
 * 使長音在兩側走同一條路徑:ko-hi- / こーひー / コーヒー / kouhii 皆為「こうひい」
 * (wanakana 的 toHiragana 只展開片假名的「ー」)。
 */
export function normalizeReading(s: string): string {
  return toHiragana(toKatakana(clean(s)));
}

/** 單一答案可接受的比對鍵(含 オ段長音寫成「お」的變體)。 */
function answerKeys(answer: string): string[] {
  const kata = toKatakana(clean(answer));
  const keys = [toHiragana(kata)];
  const oVariant = kata.replace(O_ROW_LONG_RE, "$1オ");
  if (oVariant !== kata) keys.push(toHiragana(oVariant));
  return keys;
}

/**
 * 把一種教材表記展開成候選寫法(尚未清理):「／」分候選;（）內外各為一答;
 * 「〜を」等語境去除;［］〔〕含/不含皆可(內容含〜…者是文法提示,只取省略版);
 * 「あつい、あつい」這類同讀音並列只取一次。
 */
function expandForms(text: string): string[] {
  const alternatives = text.split("／");
  if (alternatives.length > 1) return alternatives.flatMap(expandForms);

  const paren = ALT_PAREN_RE.exec(text);
  if (paren) {
    const outside =
      text.slice(0, paren.index) + text.slice(paren.index + paren[0].length);
    return [...expandForms(outside), ...expandForms(paren[1])];
  }

  const quote = QUOTE_RE.exec(text);
  if (quote) {
    const inner = ELLIPSIS_RE.test(quote[1]) ? "" : quote[1];
    return expandForms(
      text.slice(0, quote.index) +
        inner +
        text.slice(quote.index + quote[0].length),
    );
  }

  const optional = OPTIONAL_RE.exec(text);
  if (optional) {
    const inner = optional[1] ?? optional[2] ?? "";
    const before = text.slice(0, optional.index);
    const after = text.slice(optional.index + optional[0].length);
    const without = expandForms(before + after);
    return ELLIPSIS_RE.test(inner)
      ? without
      : [...without, ...expandForms(before + inner + after)];
  }

  const parts = text.split("、");
  if (parts.length > 1 && parts.every((p) => clean(p) === clean(parts[0]))) {
    return [parts[0]];
  }
  return [text];
}

/** ruby 逐段取讀音(漢字段取 r,假名段取 b)串成的讀音表記。 */
function rubyReading(v: Pick<VocabItem, "ruby">): string {
  return v.ruby.map((s) => s.r ?? s.b).join("");
}

/**
 * 輸入題可接受的答案(已清理、依正規化結果去重;kana 推導者在前,首項即主要讀音)。
 * 由 `kana` 與 ruby 讀音兩處推導,規則見 expandForms。含數字/英文字母(2、3日、CD)的
 * 寫法無法以假名輸入,略過。（）替代說法被串接成的 kana(トイレおてあらい)不算答案。
 */
export function acceptedAnswers(v: Pick<VocabItem, "ruby" | "kana">): string[] {
  const reading = rubyReading(v);
  const joined = ALT_PAREN_RE.test(reading)
    ? normalizeReading(reading.replace(/[（）]/g, ""))
    : null;
  const seen = new Set<string>();
  const answers: string[] = [];
  for (const form of [...expandForms(v.kana), ...expandForms(reading)]) {
    const answer = clean(form);
    if (!KANA_ONLY_RE.test(answer)) continue;
    const key = normalizeReading(answer);
    if (key === joined || seen.has(key)) continue;
    seen.add(key);
    answers.push(answer);
  }
  return answers;
}

/**
 * 回饋顯示用的正解:只列由 `kana` 推導的答案(すき／すきな、おっと／しゅじん),
 * 不列 ruby 推導出的省略版(［お］仕事 只顯示 しごと);kana 推導不出時退回全部答案。
 */
export function answerLabel(v: Pick<VocabItem, "ruby" | "kana">): string {
  const fromKana = new Set(
    expandForms(v.kana).map((f) => normalizeReading(clean(f))),
  );
  const all = acceptedAnswers(v);
  const primary = all.filter((a) => fromKana.has(normalizeReading(a)));
  return (primary.length > 0 ? primary : all).join("／") || v.kana;
}

/**
 * 輸入的比對鍵:照 wanakana 規則;羅馬字含「nn」時另以 IME 習慣(nn = ん)解讀,兩者皆可
 * (onna / konnyaku 走前者,sennsei / minasann / kinnyoubi 走後者)。
 */
function inputKeys(input: string): string[] {
  const cleaned = clean(input);
  const keys = [normalizeReading(cleaned)];
  if (cleaned.includes("nn")) {
    keys.push(normalizeReading(cleaned.replace(IME_NN_RE, "ん")));
  }
  return keys.filter((k) => k.length > 0);
}

function matchesAny(input: string, answers: string[]): boolean {
  const keys = inputKeys(input);
  return (
    keys.length > 0 &&
    answers.some((a) => answerKeys(a).some((k) => keys.includes(k)))
  );
}

/**
 * 輸入題判分:輸入與任一可接受答案(acceptedAnswers)正規化後相等即對。
 * 羅馬字自動轉假名(「ん」打 n 或 nn 皆可);平/片假名視為等同;長音「ー」以羅馬字(-)、
 * 平假名或母音寫法皆可;空白與標點忽略。
 */
export function checkAnswer(
  input: string,
  v: Pick<VocabItem, "ruby" | "kana">,
): boolean {
  return matchesAny(input, acceptedAnswers(v));
}

/**
 * 能否出輸入題(看中文與漢字、輸入假名):須含漢字讀音、表面不含〜…(接續用法無標準答案),
 * 且題幹(隱藏假名)沒有直接寫出某個答案(純假名字、トイレ（お手洗い）、キトク（危篤）)。
 */
export function canInput(c: Pick<VocabItem, "ruby" | "kana">): boolean {
  const surface = c.ruby.map((s) => s.b).join("");
  if (!c.ruby.some((s) => s.r !== undefined) || ELLIPSIS_RE.test(surface)) {
    return false;
  }
  const keys = new Set(acceptedAnswers(c).map(normalizeReading));
  if (keys.size === 0) return false;
  return !expandForms(surface).some((form) => {
    const shown = clean(form);
    return KANA_ONLY_RE.test(shown) && keys.has(normalizeReading(shown));
  });
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
 * - 補充單字(自行練習發音)不出題,仍可當干擾項;題目不足 `count` 時就出較少題。
 * - 輪到輸入題但該字不適合輸入(!canInput)時,改出選擇題:優先中→日(同為回想日文),
 *   否則取第一個啟用的選擇題型;未啟用任何選擇題型時只從可輸入的字出題。
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

  const mcqTypes = types.filter((t): t is McqDirection => t !== "input");
  const fallback: McqDirection | undefined = mcqTypes.includes("zh-to-jp")
    ? "zh-to-jp"
    : mcqTypes[0];

  const targets = shuffle(
    pool.filter(
      (c) =>
        c.lessonId === lessonId &&
        !isSupplementary(c) &&
        (fallback !== undefined || canInput(c)),
    ),
    rng,
  ).slice(0, count);

  return targets.map((answer, i) => {
    const rotated = types[i % types.length];
    const type =
      rotated === "input" && fallback !== undefined && !canInput(answer)
        ? fallback
        : rotated;
    return type === "input"
      ? { type: "input", answer }
      : makeMcq(answer, pool, type, optionCount, rng);
  });
}
