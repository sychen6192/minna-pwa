import { isTitleLine } from "@/lib/dialogue";
import type { Lesson, RubySeg, Sentence } from "@/schemas/lesson";

/**
 * 例句重組(T11.6,F7.4;JLPT 文法問題2「文の組み立て」形式)的純函式:依教材的分かち書き空格
 * 把文型例句與会話切塊、判斷可否出題、打亂與判分。單次練習、不寫入 SRS/DB;語序以教材為準。
 */

type Rng = () => number;

/** 可出題的塊數下限、上限 */
export const MIN_CHUNKS = 3;
export const MAX_CHUNKS = 8;
/** 達此塊數時固定首塊與句尾塊、只打亂中間(★ 題形式,減少語序歧義) */
export const FIX_ENDS_MIN_CHUNKS = 6;
/** 一回合的題數上限(本課可出題的句子較少時照實際句數) */
export const REORDER_COUNT = 8;
export const LAST_LESSON = 50;

// ── 切塊 ─────────────────────────────────────────────────────────────

/** 只由標點/記號組成的塊(…、「、」、……。):不單獨成塊 */
const SYMBOL_ONLY_RE = /^[\p{P}\p{S}]+$/u;
/** 以開括號收尾的記號塊(「、…「):併入下一塊 */
const OPENING_END_RE = /[\p{Ps}\p{Pi}]$/u;
/** 單獨的敬語前綴(お 金、ご 案内:抽取時在 furigana 前多出的空格):併入下一塊 */
const HONORIFIC_PREFIX_RE = /^[おご]$/;
/**
 * 只有英數字(半形/全形,可含千分位逗號)的塊:抽取時英數字後一律多出空格(9 時から、3,000 万円、
 * 871 の 6813 です、IMC の、「 ９ 」 ですか),全部資料中沒有一處是真的語塊邊界:併入下一塊
 */
const ALNUM_ONLY_RE =
  /^[0-9A-Za-z０-９Ａ-Ｚａ-ｚ][0-9A-Za-z０-９Ａ-Ｚａ-ｚ,，.]*$/;
/**
 * 只有片假名的塊(前面可帶「…」等記號):後接漢字(帶 r)時是被切開的複合詞或人名 + 稱謂
 * (ワット 先生、…パワー 電気、ローマ 字、アメリカ 人)
 */
const KATAKANA_ONLY_RE = /^[\p{P}\p{S}]*[\u30A0-\u30FF]+$/u;
/** 以促音收尾的塊:後接漢字時是被切開的一個詞(引っ 越し) */
const SOKUON_END_RE = /っ$/;

export function chunkText(chunk: readonly RubySeg[]): string {
  return chunk.map((s) => s.b).join("");
}

/** 句子的表面文字(ruby 各段 b 串接,含空格) */
export function surfaceText(segs: readonly RubySeg[]): string {
  return segs.map((s) => s.b).join("");
}

/** 依空格與「、」切開(未併塊):只切沒有讀音(r)的段,空格丟棄、「、」留在前一塊 */
function splitAtSpaces(segs: readonly RubySeg[]): RubySeg[][] {
  const chunks: RubySeg[][] = [];
  let current: RubySeg[] = [];
  const endChunk = () => {
    if (current.length > 0) chunks.push(current);
    current = [];
  };
  for (const seg of segs) {
    if (seg.r) {
      current.push(seg);
      continue;
    }
    let text = "";
    for (const ch of seg.b) {
      if (ch === " ") {
        if (text) current.push({ b: text });
        text = "";
        endChunk();
      } else if (ch === "、") {
        current.push({ b: text + ch });
        text = "";
        endChunk();
      } else {
        text += ch;
      }
    }
    if (text) current.push({ b: text });
  }
  endChunk();
  return chunks;
}

/**
 * 漢字段後面緊接的 お/ご(今お 忙しい):是下一個詞的前綴,拆成單獨的片段(之後併入下一塊)
 */
function detachTrailingPrefix(raw: RubySeg[][]): RubySeg[][] {
  return raw.flatMap((chunk, i) => {
    const last = chunk[chunk.length - 1];
    const before = chunk[chunk.length - 2];
    const next = raw[i + 1];
    return next?.[0].r !== undefined &&
      before?.r !== undefined &&
      last.r === undefined &&
      HONORIFIC_PREFIX_RE.test(last.b)
      ? [chunk.slice(0, -1), [last]]
      : [chunk];
  });
}

/** 抽取時多出的空格:這一塊與下一塊其實是同一個語塊 */
function joinsNext(text: string, next: readonly RubySeg[]): boolean {
  if (HONORIFIC_PREFIX_RE.test(text) || ALNUM_ONLY_RE.test(text)) return true;
  const nextIsKanji = next[0].r !== undefined;
  return (
    nextIsKanji && (KATAKANA_ONLY_RE.test(text) || SOKUON_END_RE.test(text))
  );
}

/**
 * 依教材的分かち書き切塊:只在沒有讀音(r)的段內、半形空格與「、」之後切開,漢字段(帶 r)不拆;
 * 空格本身丟棄,「、」留在前一塊。以下片段不單獨成塊(資料的抽取痕跡,不是教材的語塊;
 * 規則皆以全部 50 課資料逐一核對過):
 * - 只由記號組成(答句開頭的「…」、「「」、句尾「……。」):開頭、以開括號收尾、或前面還有待併的
 *   片段時併入下一塊,其餘併入前一塊
 * - 單獨的敬語前綴 お/ご(含緊接在漢字段後的):併入下一塊(お 金を → お金を、今お 忙しい → 今|お忙しい)
 * - 只有英數字:併入下一塊(2 時間半 → 2時間半、871 の 6813 です → 871の|6813です)
 * - 只有片假名或以「っ」收尾、下一塊以漢字開頭:併入下一塊(ワット 先生は → ワット先生は、
 *   引っ 越しの → 引っ越しの)
 *
 * 不變式:各塊文字依序串接 = 各段的 b 串接,其中無讀音段的半形空格全部去掉(帶 r 的段原樣);
 * 帶 r 的段以同一物件、依原順序出現,且只在一塊中(不拆)。
 */
export function chunkRuby(segs: readonly RubySeg[]): RubySeg[][] {
  const raw = detachTrailingPrefix(splitAtSpaces(segs));
  const chunks: RubySeg[][] = [];
  // 待併入下一塊的片段(依原順序)
  let carry: RubySeg[] = [];
  raw.forEach((chunk, i) => {
    const text = chunkText(chunk);
    const next = raw[i + 1];
    if (SYMBOL_ONLY_RE.test(text)) {
      if (carry.length > 0 || chunks.length === 0 || OPENING_END_RE.test(text))
        carry.push(...chunk);
      else chunks[chunks.length - 1].push(...chunk);
      return;
    }
    if (next && joinsNext(text, next)) {
      carry.push(...chunk);
      return;
    }
    chunks.push([...carry, ...chunk]);
    carry = [];
  });
  if (carry.length > 0) {
    if (chunks.length > 0) chunks[chunks.length - 1].push(...carry);
    else chunks.push(carry);
  }
  return chunks;
}

// ── 可否出題 ─────────────────────────────────────────────────────────

/** 句末標點(「、」不算) */
const SENTENCE_END_RE = /[。？！?!]/g;
const ENDS_WITH_PUNCT_RE = /[。？！?!]$/;
/** 活用對照行(かきます → かいて):不是句子 */
const ARROW = "→";
/** 行首的對話者標記(Ａ:、Ｂ:):標記會黏在第一塊上 */
const SPEAKER_PREFIX_RE = /^[A-ZＡ-Ｚ]\s*[:：]/;
/** 可省略〔〕［］、替代說法（）與並列 ／ 的教材記號:不是單一線性句子,記號還會被空格切開 */
const MARKUP_RE = /[［］〔〕（）()／]/;
/** 外文片語(「Thank you」):字間的空格不是語塊邊界 */
const LATIN_PHRASE_RE = /[A-Za-z] +[A-Za-z]/;
/**
 * 抽取時在詞中多出空格、切塊規則併不回來的句子(寧缺勿錯,不出題):
 * L08-S15、L28-S10「さくら 大学」(校名)、L50-S14「お飲み 物は」(飲み物)
 */
export const REORDER_EXCLUDED_IDS: ReadonlySet<string> = new Set([
  "L08-S15",
  "L28-S10",
  "L50-S14",
]);

/** 固定首尾時可移動的塊(chunks 的 index) */
function movableIndices(count: number): number[] {
  const all = Array.from({ length: count }, (_, i) => i);
  return count >= FIX_ENDS_MIN_CHUNKS ? all.slice(1, -1) : all;
}

/**
 * 可否作為重組題:
 * - 切成 3–8 塊
 * - 句末標點至多一個且只在句尾(多句的会話行排除;L22 名詞修飾的片語沒有句末標點,保留)
 * - 不含「→」(活用對照行,例:L19-S08 寒い → 寒く なります 切成 3 塊又沒有句末標點,上兩條擋不住)
 * - 不是会話標題行(傳入会話中的 `index` 時以 dialogue.ts 的 isTitleLine 判斷;文型例句不傳)
 * - 不以對話者標記(Ａ:)開頭;不含可省略/替代/並列記號(［ ］〔 〕（ ）／);不含外文片語
 * - 不在 REORDER_EXCLUDED_IDS(詞被切開的抽取痕跡)
 * - 可移動的塊至少有兩種不同文字(才打亂得出與原句不同的順序)
 * 以「…」開頭的答句保留:全部資料中皆為可獨立成立的句子(…いいえ、先生じゃ ありません。),
 * 中譯同樣以「…」開頭。
 */
export function isReorderable(
  sentence: Pick<Sentence, "id" | "ruby" | "speaker">,
  index?: number,
): boolean {
  if (REORDER_EXCLUDED_IDS.has(sentence.id)) return false;
  const surface = surfaceText(sentence.ruby).trim();
  if (surface.includes(ARROW)) return false;
  if (index !== undefined && isTitleLine(sentence, index)) return false;
  if (
    SPEAKER_PREFIX_RE.test(surface) ||
    MARKUP_RE.test(surface) ||
    LATIN_PHRASE_RE.test(surface)
  ) {
    return false;
  }
  const ends = surface.match(SENTENCE_END_RE) ?? [];
  if (ends.length > 1) return false;
  if (ends.length === 1 && !ENDS_WITH_PUNCT_RE.test(surface)) return false;
  const chunks = chunkRuby(sentence.ruby);
  if (chunks.length < MIN_CHUNKS || chunks.length > MAX_CHUNKS) return false;
  const movable = movableIndices(chunks.length).map((i) =>
    chunkText(chunks[i]),
  );
  return new Set(movable).size >= 2;
}

// ── 出題 ─────────────────────────────────────────────────────────────

export interface ReorderChunk {
  /** 在原句中的位置(0 起) */
  index: number;
  ruby: RubySeg[];
  /** 表面文字:判分以此比對(文字相同的塊可互換) */
  text: string;
}

export interface ReorderItem {
  sentence: Sentence;
  /** 依原句順序的塊 */
  chunks: ReorderChunk[];
  /** 首塊與句尾塊固定在答案列兩端(6 塊以上) */
  fixedEnds: boolean;
  /** 可移動的塊打亂後的順序(chunks 的 index;固定首尾時不含首尾塊) */
  shuffled: number[];
}

/** Fisher–Yates,以注入的 rng 取得確定性(測試)/隨機(執行期) */
function shuffle<T>(arr: readonly T[], rng: Rng): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const sameTexts = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((t, i) => t === b[i]);

/**
 * 建立一題(呼叫端先以 isReorderable 篩選):6 塊以上固定首尾、只打亂中間;打亂後的文字順序
 * 一定與原句不同——洗出原順序(含重複塊互換後文字相同)時改為左移一位(可移動的塊至少有兩種
 * 文字,左移後必然不同),同一個 rng 結果確定。
 */
export function makeReorderItem(
  sentence: Sentence,
  rng: Rng = Math.random,
): ReorderItem {
  const chunks: ReorderChunk[] = chunkRuby(sentence.ruby).map(
    (ruby, index) => ({ index, ruby, text: chunkText(ruby) }),
  );
  const fixedEnds = chunks.length >= FIX_ENDS_MIN_CHUNKS;
  const movable = movableIndices(chunks.length);
  const textsOf = (order: readonly number[]) =>
    order.map((i) => chunks[i].text);
  let shuffled = shuffle(movable, rng);
  if (sameTexts(textsOf(shuffled), textsOf(movable))) {
    shuffled = [...shuffled.slice(1), ...shuffled.slice(0, 1)];
  }
  return { sentence, chunks, fixedEnds, shuffled };
}

/** 答案列的完整順序(固定首尾時補上首尾塊;`placed` 為使用者排入的 chunks index) */
export function answerOrder(
  item: ReorderItem,
  placed: readonly number[],
): number[] {
  if (!item.fixedEnds) return [...placed];
  return [0, ...placed, item.chunks.length - 1];
}

/** 答案列各位置的塊文字(checkOrder / misplacedPositions 的輸入) */
export function pickedTexts(
  item: ReorderItem,
  placed: readonly number[],
): string[] {
  return answerOrder(item, placed).map((i) => item.chunks[i].text);
}

/** 判分:`picked` 為整句(含固定首尾)各位置的塊文字;以文字比對,文字相同的塊可互換 */
export function checkOrder(
  picked: readonly string[],
  item: ReorderItem,
): boolean {
  return sameTexts(
    picked,
    item.chunks.map((c) => c.text),
  );
}

/** 位置不對的格(整句中的位置,0 起;以文字比對) */
export function misplacedPositions(
  picked: readonly string[],
  item: ReorderItem,
): number[] {
  return item.chunks.flatMap((c, i) => (picked[i] === c.text ? [] : [i]));
}

// ── 以課為單位 ───────────────────────────────────────────────────────

/** 中譯句尾的課次參照「（第25課）」「(第 5 課)」:教材標示此例句用到該課的文法/單字 */
const LESSON_REF_RE = /\s*[（(]第\s*(\d+)\s*課[）)]\s*$/;

/** 例句標示的課次比本課晚(用到還沒教的內容):不在本課出題(例句重組、測驗的例句填空) */
export function refersToLaterLesson(
  sentence: Sentence,
  lessonId: number,
): boolean {
  const m = LESSON_REF_RE.exec(sentence.translation);
  return m !== null && Number(m[1]) > lessonId;
}

/**
 * 本課可出題的句子:文型例句與会話(依教材順序),同表面文字的重列句只留第一句;
 * 中譯標示較晚課次的例句(L04-S19 …かかります。(第 11 課))不出題
 */
export function reorderPool(lesson: Lesson): Sentence[] {
  const candidates = [
    ...lesson.grammar.flatMap((g) =>
      g.examples.filter(
        (s) => isReorderable(s) && !refersToLaterLesson(s, lesson.id),
      ),
    ),
    ...lesson.dialogues.filter((s, i) => isReorderable(s, i)),
  ];
  const seen = new Set<string>();
  return candidates.filter((s) => {
    const key = surfaceText(s.ruby);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** 課程頁是否給「例句重組」入口 */
export function lessonHasReorder(lesson: Lesson): boolean {
  return reorderPool(lesson).length > 0;
}

/** 一回合:從本課可出題的句子隨機抽至多 `count` 句 */
export function makeReorderRound(
  lesson: Lesson,
  {
    count = REORDER_COUNT,
    rng = Math.random,
  }: { count?: number; rng?: Rng } = {},
): ReorderItem[] {
  return shuffle(reorderPool(lesson), rng)
    .slice(0, count)
    .map((s) => makeReorderItem(s, rng));
}

/** 題幹:中譯(去掉句尾的課次參照「（第25課）」「(第 5 課)」;較晚課次的例句不出題,留下的是複習) */
export function promptText(translation: string): string {
  return translation.replace(LESSON_REF_RE, "");
}
