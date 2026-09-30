import { conjClass, conjugate, type VerbForm } from "@/lib/conjugate";
import type { Lesson, RubySeg, Sentence, VocabItem } from "@/schemas/lesson";

// ruby 分段的表面文字(串接 base,忽略讀音)
function surface(segs: readonly RubySeg[]): string {
  return segs.map((s) => s.b).join("");
}

/** 詞的左邊界:教材例句以空格分かち書き,這些字元之後(或句首)才是一個詞的開頭 */
const BOUNDARY_RE = /[\s、。,，「」『』（(…？！?!]/;
/** 漢字(含々〆ヶ)與數字:漢字開頭的字若緊接在這些字之後,是較長複合詞的一部分(社員 ⊂ 会社員) */
const COMPOUND_RE = /[㐀-鿿豈-﫿々〆ヶ0-9０-９]/;
/** 敬語前綴:前一字為「お」「ご」者是另一個詞(帰りに ≠ お帰りに) */
const HONORIFIC_PREFIX_RE = /[おご]/;
/** 判斷「句子就是單字本身」時忽略的字元 */
const IGNORED_RE = /[\s。、?？!！…「」]/g;
/** 活用對照行(寒い → 寒く なります)的記號:這類行不是語境例句 */
const TABLE_ROW_MARK = "→";
/** note 的搭配名詞:〔音／声が〜〕→ 音、声;［バスが〜］→ バス;［でんきが〜］［電気が〜］→ でんき、電気 */
const NOTE_NOUN_RE = /([^〔〕［］（）\s〜]+)([がをにへとで])〜/g;

function normalize(text: string): string {
  return text.replace(IGNORED_RE, "");
}

/**
 * text 的第 at 字是否為一個詞的開頭。假名開頭的詞(kanaLead)須在句首或邊界字元之後
 * (うん ⊄ ううん、すぐ ⊄ まっすぐ、ですから ⊄ 元気ですから);漢字開頭的詞只排除接在
 * 漢字/數字之後的複合詞尾(イタリア料理 的 料理 仍算);前一字為「お」「ご」一律不算。
 */
function startsWord(text: string, at: number, kanaLead: boolean): boolean {
  if (at === 0) return true;
  const prev = text[at - 1];
  if (HONORIFIC_PREFIX_RE.test(prev)) return false;
  return kanaLead ? BOUNDARY_RE.test(prev) : !COMPOUND_RE.test(prev);
}

/** word 在 text 中第一個位於詞開頭的出現位置(逐一檢查每個出現位置);沒有為 -1。 */
function wordStart(text: string, word: string, kanaLead: boolean): number {
  for (let i = text.indexOf(word); i >= 0; i = text.indexOf(word, i + 1)) {
    if (startsWord(text, i, kanaLead)) return i;
  }
  return -1;
}

/** text 是否在某個詞的開頭處出現 word。 */
function containsWord(text: string, word: string, kanaLead: boolean): boolean {
  return wordStart(text, word, kanaLead) >= 0;
}

/**
 * 由 note 解析搭配名詞與助詞,轉成句中須出現的片段:〔音／声が〜〕→ 音が、声が。助詞為 が
 * 時也收 は/も(音も します);其他助詞不換(〔日本に〜〕います 的「日本は …」是別的意思)。
 * 多個括號(［でんきが〜］［電気が〜］)皆收。要求名詞後接助詞,避免單字元名詞命中較長的詞(音 ⊂ 音楽)。
 * 解析不出(無 note、無「名詞+助詞〜」)回傳空陣列。
 */
function collocations(note: string | undefined): string[] {
  if (note === undefined) return [];
  return [...note.matchAll(NOTE_NOUN_RE)].flatMap((m) => {
    const particles = m[2] === "が" ? ["が", "は", "も"] : [m[2]];
    return m[1]
      .split("／")
      .filter((noun) => noun.length > 0)
      .flatMap((noun) => particles.map((p) => noun + p));
  });
}

/** text 中是否有任一搭配片段(依詞邊界比對:味が ⊄ 興味が) */
function hasCollocation(text: string, required: readonly string[]): boolean {
  return required.some((c) => containsWord(text, c, !COMPOUND_RE.test(c[0])));
}

// ── 動詞活用形(T11.9)────────────────────────────────────────────────

/** 詞尾之後可直接接的字串(其餘須是邊界字元或句尾);null = 詞尾已完整,後面接什麼都可以 */
type Follow = readonly string[] | null;

/** 普通形之後直接接的助詞、助動詞(教材分かち書き:〜と 思います 的「と」、〜のが、〜んです…) */
const FOLLOW_PLAIN: readonly string[] = [
  "と",
  "の",
  "ん",
  "か",
  "よ",
  "ね",
  "な",
  "が",
  "けど",
  "から",
  "まで",
  "なら",
  "って",
  "そう",
  "よう",
  "でしょう",
  "だろう",
];
/** て形:〜ても、〜ては、〜てから */
const FOLLOW_TE: readonly string[] = ["も", "は", "から"];
/** た形:另有 〜たら、〜たり */
const FOLLOW_TA: readonly string[] = [...FOLLOW_PLAIN, "ら", "り"];
/** ない形:另有 〜ないで */
const FOLLOW_NAI: readonly string[] = [...FOLLOW_PLAIN, "で"];
/** 意向形:〜うと 思って います */
const FOLLOW_VOLITIONAL: readonly string[] = ["と", "か", "よ", "ね"];

/**
 * ます系詞尾(接ます形語幹)。沒有漢字的短語幹動詞只有這一系不要求搭配名詞(ありません);
 * 但仍可能是別的用法(学生じゃ ありません 的否定,見 ARU_NOT_AFTER_RE)。
 * 依教材順序排列;同一位置較長的形(ません ⊂ ませんでした)由比對迴圈決定,與順序無關。
 */
const POLITE_TAILS: readonly string[] = [
  "ません",
  "ました",
  "ませんでした",
  "ましょう",
  "まして",
];
/** 其他接ます形語幹的詞尾:〜たい、〜ながら、〜にくい/やすい、〜すぎます、〜そうです、〜なさい */
const STEM_TAILS: readonly string[] = [
  "たかった",
  "たい",
  "たく",
  "ながら",
  "にくい",
  "やすい",
  "すぎ",
  "そう",
  "なさい",
];

/** conjugate.ts 推導的普通形系(ます系另由語幹接詞尾) */
const PLAIN_FORMS: readonly [VerbForm, Follow][] = [
  ["te", FOLLOW_TE],
  ["ta", FOLLOW_TA],
  ["nai", FOLLOW_NAI],
  ["nakatta", FOLLOW_TA],
  ["dict", FOLLOW_PLAIN],
  ["volitional", FOLLOW_VOLITIONAL],
  ["conditional", null],
];

/** Ⅱ類動詞(含被動/可能/使役形)由語幹接的普通形詞尾 */
const ICHIDAN_TAILS: readonly [string, Follow][] = [
  ["て", FOLLOW_TE],
  ["た", FOLLOW_TA],
  ["ない", FOLLOW_NAI],
  ["なかった", FOLLOW_TA],
  ["なければ", null],
  ["なくて", null],
  ["る", FOLLOW_PLAIN],
  ["れば", null],
];

/**
 * 不找活用形的單字(id → 理由):同課例句裡的活用形是同一個字的另一個義項(依 id,寧可漏)。
 * 全資料逐句核對 T11.9 新增的配對後列出。
 */
const CONJUGATED_EXCLUDED: ReadonlyMap<string, string> = new Map([
  [
    "L24-V004",
    "送ります［人を〜］(送人):課內只有「セーターを 送って くれました」,是寄送(L07-V002 的義項)",
  ],
]);

/** 補助動詞的位置:前一詞是て形(〜て しまう、〜て もらう、〜て いる):假名書寫的動詞在此多為補助用法 */
const AUXILIARY_BEFORE_RE = /[てで]\s+$/;
/** あります 另排除名詞、形容詞否定的位置(学生じゃ ありません、寒く ありません:不是「有/在」) */
const ARU_NOT_AFTER_RE = /(?:[てでく]|じゃ|では)\s+$/;

/** 活用形比對的一個候選 */
interface VerbPattern {
  /** 句中的表面形(多詞動詞含空格:持って 行って) */
  surface: string;
  /** 讀音(無空白),與句中該段的讀音比對 */
  kana: string;
  follow: Follow;
  /** ます系(〜ません/〜ました…) */
  polite: boolean;
}

/** 動詞的活用形候選與守門所需的資訊 */
interface VerbPatterns {
  patterns: VerbPattern[];
  /** ます形語幹的字數(表面形去掉ます:会い=2、出=1、勉強し=3) */
  stemLength: number;
  /** 表面形沒有漢字段(讀音比對分不出同音字:あった=会った/遭った/有った) */
  kanaOnly: boolean;
  /** 活用形之前的文字符合者不配(補助動詞、否定的位置) */
  notAfter: RegExp | null;
}

/**
 * ます形語幹(或Ⅱ類語幹)接 ます系與〜たい 等詞尾。polite:單字本身的ます系(派生的
 * 被動/可能/使役形不算,あげられました 不比 あげます 安全)。
 */
function stemPatterns(
  stem: string,
  stemKana: string,
  polite: boolean,
): VerbPattern[] {
  return [
    ...POLITE_TAILS.map((t) => ({
      surface: stem + t,
      kana: stemKana + t,
      follow: null,
      polite,
    })),
    ...STEM_TAILS.map((t) => ({
      surface: stem + t,
      kana: stemKana + t,
      follow: null,
      polite: false,
    })),
  ];
}

/** Ⅱ類語幹(褒められ)的各形:ます系、〜たい 等、普通形 */
function ichidanPatterns(stem: string, stemKana: string): VerbPattern[] {
  return [
    ...stemPatterns(stem, stemKana, false),
    ...ICHIDAN_TAILS.map(([t, follow]) => ({
      surface: stem + t,
      kana: stemKana + t,
      follow,
      polite: false,
    })),
  ];
}

/**
 * 動詞的活用形候選(conjugate.ts 推導):ます系與〜たい 等(ます形語幹 + 詞尾)、て/た/ない/
 * なかった(〜なければ、〜なくて)/辞書/意向/條件形;被動形(各類)與可能、使役形(Ⅱ・Ⅲ類)
 * 再依Ⅱ類活用。Ⅰ類的可能/使役形不收:常與另一個動詞同形(切れる、売れる、開ける、知らせる)。
 * 非動詞、排除清單中的字、conjugate 不能推導者回傳 null。
 */
function verbPatterns(vocab: VocabItem): VerbPatterns | null {
  if (conjClass(vocab.pos) !== "verb" || CONJUGATED_EXCLUDED.has(vocab.id)) {
    return null;
  }
  const masu = conjugate(vocab, "masu");
  const base = masu && surface(masu.ruby);
  if (!masu || !base?.endsWith("ます")) return null;
  const stem = base.slice(0, -2);
  const patterns = stemPatterns(stem, masu.kana.slice(0, -2), true);

  for (const [form, follow] of PLAIN_FORMS) {
    const c = conjugate(vocab, form);
    if (!c) continue;
    const s = surface(c.ruby);
    patterns.push({ surface: s, kana: c.kana, follow, polite: false });
    if (form === "nai") {
      // 〜なければ、〜なくて(ない 依い形容詞活用)
      for (const t of ["なければ", "なくて"]) {
        patterns.push({
          surface: s.slice(0, -2) + t,
          kana: c.kana.slice(0, -2) + t,
          follow: null,
          polite: false,
        });
      }
    }
  }

  const derived: VerbForm[] =
    vocab.pos === "動I" ? ["passive"] : ["passive", "potential", "causative"];
  for (const form of derived) {
    const c = conjugate(vocab, form);
    if (!c) continue;
    // 辞書形(〜れる/〜られる/〜せる)去掉「る」即Ⅱ類語幹
    patterns.push(
      ...ichidanPatterns(surface(c.ruby).slice(0, -1), c.kana.slice(0, -1)),
    );
  }

  const kanaOnly = masu.ruby.every((s) => s.r === undefined);
  return {
    patterns,
    stemLength: stem.length,
    kanaOnly,
    notAfter:
      masu.kana === "あります"
        ? ARU_NOT_AFTER_RE
        : kanaOnly
          ? AUXILIARY_BEFORE_RE
          : null,
  };
}

/**
 * 句子表面文字 [start, end) 的讀音(無空白):漢字段取 r、假名段取原字;
 * 帶讀音的漢字段只有一部分在區間內時回傳 null(讀音無法切分)。
 */
function spanReading(
  segs: readonly RubySeg[],
  start: number,
  end: number,
): string | null {
  let pos = 0;
  let out = "";
  for (const seg of segs) {
    const segStart = pos;
    const segEnd = pos + seg.b.length;
    pos = segEnd;
    if (segEnd <= start || segStart >= end) continue;
    if (seg.r !== undefined) {
      if (segStart < start || segEnd > end) return null;
      out += seg.r;
    } else {
      out += seg.b.slice(
        Math.max(0, start - segStart),
        Math.min(seg.b.length, end - segStart),
      );
    }
  }
  return out.replace(/\s+/g, "");
}

/** 活用形在句中第一個成立的位置:詞邊界開頭、右邊界合規、前文不符 notAfter、讀音相同 */
function patternStart(
  text: string,
  segs: readonly RubySeg[],
  p: VerbPattern,
  notAfter: RegExp | null,
): number {
  for (let i = text.indexOf(p.surface); i >= 0; ) {
    const end = i + p.surface.length;
    const rest = text.slice(end);
    if (
      startsWord(text, i, true) &&
      (p.follow === null ||
        rest === "" ||
        BOUNDARY_RE.test(rest[0]) ||
        p.follow.some((f) => rest.startsWith(f))) &&
      !notAfter?.test(text.slice(0, i)) &&
      spanReading(segs, i, end) === p.kana
    ) {
      return i;
    }
    i = text.indexOf(p.surface, i + 1);
  }
  return -1;
}

// ── 比對 ─────────────────────────────────────────────────────────────

/**
 * 比對種類:exact = 單字表面形本身;conjugated = 動詞的活用形(T11.9,如 会います →「会いましょう」)。
 * 例句填空只挖 exact(挖空處須是單字本身)。
 */
export type ExampleMatchKind = "exact" | "conjugated";

/** 單字在例句中的比對位置:句子表面文字(ruby 的 b 串接)的 [start, end) */
export interface ExampleMatch {
  sentence: Sentence;
  start: number;
  end: number;
  kind: ExampleMatchKind;
}

/**
 * 為單字找一句「同課語境例句」:掃該課的文法例句與会話,取在詞邊界上含該單字表面形、
 * 且最短的一句(i+1 傾向——越短通常越單純)。找不到回傳 null。
 *
 * 以完整表面形(如「遊びます」,記號［］〔〕〜 等照字面)比對,並依教材分かち書き判斷詞邊界
 * (見 startsWord):寧可漏,不可誤配。另外略過:
 * - 單一字元的單字(多為單漢字或助詞),易是較長詞的開頭(「日」⊂「日曜日」)
 * - 含「→」的活用對照行,與正規化後等於單字本身的句子(「お茶」「ただいま。」)
 * - 同課有同表面形的另一字時(L47 します×3),須句中含該字 note 的搭配名詞(音が);
 *   note 解析不出名詞則不配
 *
 * 動詞在全課都沒有ます形本身時,改找活用形(見 findExampleMatch):ます形命中一律優先。
 */
export function findExampleSentence(
  vocab: VocabItem,
  lesson: Lesson,
): Sentence | null {
  return findExampleMatch(vocab, lesson)?.sentence ?? null;
}

/**
 * 同 findExampleSentence,另回傳單字在句中的位置與比對種類(第一個位於詞開頭的出現處)。
 * `accept` 可再篩選(例句填空:只收 exact、挖空處須對齊 ruby 分段);不通過者改看其他句,仍取最短。
 *
 * 動詞的活用形比對(T11.9):全課沒有ます形本身時,找 conjugate.ts 推導的活用形
 * (ます系、〜たい 等、て/た/ない/辞書/意向/條件形、被動…,見 verbPatterns),同樣取最短句。
 * 比 ます形更嚴:
 * - 須在分かち書き的詞首(句首或空格、「、」「「」等之後,漢字開頭也一樣;受け取って ⊄ 取ります)
 *   且右邊界合規(詞尾後是邊界字元或 〜と/〜のが/〜たら 等,見 FOLLOW_*)
 * - 句中該段的讀音須與推導的讀音相同(開(あ)いて ≠ 開(ひら)いて、降(お)りました ≠ 降(ふ)りました)
 * - ます形語幹不足 2 字者(します、出ます、見ます、来ます、寝ます…)與同課同表面形者,
 *   須在活用形之前出現 note 的搭配名詞(ネクタイを して),note 解析不出名詞則不配
 * - 表面形沒有漢字的動詞(あります、つけます):語幹不足 3 字者只收ます系(ありません),
 *   其餘形同樣須有搭配名詞(電気が ついて);前一詞是て形者不收(〜て しまいました 的補助動詞)。
 *   あります 另不收 〜じゃ/では/く 之後(学生じゃ ありません、寒く ありません 是否定,不是「有/在」)
 * - 正規化後等於活用形本身的句子不選
 */
export function findExampleMatch(
  vocab: VocabItem,
  lesson: Lesson,
  accept?: (match: ExampleMatch) => boolean,
): ExampleMatch | null {
  const word = surface(vocab.ruby);
  if (word.length < 2) return null;
  const kanaLead = vocab.ruby[0].r === undefined;

  const homonym = lesson.vocab.some(
    (v) => v.id !== vocab.id && surface(v.ruby) === word,
  );
  const required = collocations(vocab.note);
  if (homonym && required.length === 0) return null;

  const candidates: Sentence[] = [
    ...lesson.grammar.flatMap((g) => g.examples),
    ...lesson.dialogues,
  ].filter((s) => !surface(s.ruby).includes(TABLE_ROW_MARK));

  let best: ExampleMatch | null = null;
  let bestLen = Infinity;
  for (const s of candidates) {
    const text = surface(s.ruby);
    if (text.length >= bestLen) continue;
    if (normalize(text) === normalize(word)) continue;
    const start = wordStart(text, word, kanaLead);
    if (start < 0) continue;
    if (homonym && !hasCollocation(text, required)) continue;
    const match: ExampleMatch = {
      sentence: s,
      start,
      end: start + word.length,
      kind: "exact",
    };
    if (accept && !accept(match)) continue;
    best = match;
    bestLen = text.length;
  }
  return (
    best ?? findConjugatedMatch(vocab, candidates, homonym, required, accept)
  );
}

/** 動詞活用形的比對(findExampleMatch 的後備;規則見其說明) */
function findConjugatedMatch(
  vocab: VocabItem,
  candidates: readonly Sentence[],
  homonym: boolean,
  required: readonly string[],
  accept: ((match: ExampleMatch) => boolean) | undefined,
): ExampleMatch | null {
  const verb = verbPatterns(vocab);
  if (!verb) return null;
  const { patterns, stemLength, kanaOnly, notAfter } = verb;
  // 須有搭配名詞的形:全部(同課同表面形、一字語幹)/ ます系以外(語幹不足 3 字的假名動詞)
  const guardAll = homonym || stemLength < 2;
  if (guardAll && required.length === 0) return null;
  const needsNoun = (p: VerbPattern) =>
    guardAll || (kanaOnly && stemLength < 3 && !p.polite);

  let best: ExampleMatch | null = null;
  let bestLen = Infinity;
  for (const s of candidates) {
    const text = surface(s.ruby);
    if (text.length >= bestLen) continue;
    // 句中最早的活用形;同一位置取最長(会いませんでした 而非 会いません)
    let start = -1;
    let end = -1;
    for (const p of patterns) {
      const i = patternStart(text, s.ruby, p, notAfter);
      if (i < 0) continue;
      if (needsNoun(p) && !hasCollocation(text.slice(0, i), required)) {
        continue;
      }
      const e = i + p.surface.length;
      if (start < 0 || i < start || (i === start && e > end)) {
        start = i;
        end = e;
      }
    }
    if (start < 0) continue;
    if (normalize(text) === normalize(text.slice(start, end))) continue;
    const match: ExampleMatch = { sentence: s, start, end, kind: "conjugated" };
    if (accept && !accept(match)) continue;
    best = match;
    bestLen = text.length;
  }
  return best;
}
