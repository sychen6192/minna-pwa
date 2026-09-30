import { toHiragana, toKatakana } from "wanakana";
import { isTitleLine } from "@/lib/dialogue";
import { findExampleMatch } from "@/lib/examples";
import { isSupplementary } from "@/lib/notes";
import { promptText, refersToLaterLesson } from "@/lib/reorder";
import { speechText } from "@/lib/tts";
import type { Lesson, RubySeg, Sentence, VocabItem } from "@/schemas/lesson";

/** 出題候選 = 單字 + 所屬課號(用於同課/鄰近課干擾項規則) */
export interface QuizCandidate extends VocabItem {
  lessonId: number;
}

export type McqDirection = "jp-to-zh" | "zh-to-jp";
/** 選擇題:看日文選中文、看中文選日文、聽發音選中文(listen) */
export type McqType = McqDirection | "listen";
/** 題型:選擇題、輸入題(看中文與漢字輸入假名)、例句填空(cloze) */
export type QuestionType = McqType | "input" | "cloze";

/** 全部題型(固定順序:出題輪替與題型選單皆依此) */
export const QUESTION_TYPES: readonly QuestionType[] = [
  "jp-to-zh",
  "zh-to-jp",
  "input",
  "cloze",
  "listen",
];

export interface McqOption {
  id: string;
  candidate: QuizCandidate;
  correct: boolean;
}

export interface McqQuestion {
  type: McqType;
  answer: QuizCandidate;
  options: McqOption[];
}

export interface InputQuestion {
  type: "input";
  answer: QuizCandidate;
}

/** 例句填空的題幹:本課例句在單字處挖空(同句只挖一處),空格前後保留原句的 ruby 分段 */
export interface Cloze {
  sentenceId: string;
  before: RubySeg[];
  after: RubySeg[];
  /** 例句中譯(協助判斷唯一解) */
  translation: string;
}

/** 例句填空:選項為日文(正解 + 同詞性干擾項) */
export interface ClozeQuestion {
  type: "cloze";
  answer: QuizCandidate;
  options: McqOption[];
  cloze: Cloze;
}

export type Question = McqQuestion | InputQuestion | ClozeQuestion;

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
/** 各種橫線視同長音「ー」(資料曾以 U+2015 記 え―と,T12.2 已修正;羅馬字輸入的 - 由 wanakana 轉為ー) */
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
/**
 * 平文式(Hepburn)把促音 + ch 寫成「tch」(出張 shutchou、こっち kotchi;wanakana 的 toRomaji 也這樣
 * 輸出),IME 亦接受;wanakana 的 toHiragana 只認「cch」(tch 會留下 t,不可能對上任何答案)
 */
const HEPBURN_TCH_RE = /tch/g;
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
 * 輸入的比對鍵:照 wanakana 規則(平文式的 tch 先改成 cch);羅馬字含「nn」時另以 IME 習慣
 * (nn = ん)解讀,兩者皆可(onna / konnyaku 走前者,sennsei / minasann / kinnyoubi 走後者)。
 */
function inputKeys(input: string): string[] {
  const cleaned = clean(input).replace(HEPBURN_TCH_RE, "cch");
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
  /** 選項顯示的文字:給定時選項間(含正解)此值也不重複(聽力的中文、填空的日文表面形) */
  distinctBy?: (c: QuizCandidate) => string,
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

  const keyOf = distinctBy ?? ((c: QuizCandidate) => c.id);
  const picked: QuizCandidate[] = [];
  const seen = new Set<string>([keyOf(answer)]);
  for (const c of ordered) {
    if (picked.length >= count) break;
    const key = keyOf(c);
    if (seen.has(key)) continue;
    seen.add(key);
    picked.push(c);
  }
  return picked;
}

// ── 聽力題(LC-08)──────────────────────────────────────────────────

/** 漢字(含々〆ヶ) */
const KANJI_RE = /[㐀-鿿豈-﫿々〆ヶ]/;
/** 數字:引擎讀數字的方式(4分の 1、5年生)不一定是教材讀音 */
const DIGIT_RE = /[0-9０-９]/;
/** 判斷「單一漢字」時忽略的句讀與空白 */
const SPEECH_PUNCT_RE = /[\s、。?？!！]/g;
/**
 * 表面形有另一個常用讀音的字(同形異讀):以表面形朗讀可能讀成別的字,改讀 kana。
 * 教材內同表面不同讀音者(降ります ふります/おります、開きます ひらきます/あきます;
 * quiz.data.test 以全部教材核對),與另有常用讀音者(明日 あす/あした、紅葉 もみじ/こうよう、
 * 辛い からい/つらい、止めます とめます/やめます、何階 なんがい/なんかい)。
 */
const READ_KANA_SURFACES: ReadonlySet<string> = new Set([
  "降ります",
  "開きます",
  "明日",
  "紅葉",
  "辛い",
  "止めます",
  "何階",
]);

function surfaceOf(v: Pick<VocabItem, "ruby">): string {
  return v.ruby.map((s) => s.b).join("");
}

/**
 * 聽力題的朗讀文字。含漢字時讀(清理記號後的)表面形:引擎依辭典決定重音,比只給假名準確
 * (はし、あめ 這類同音詞);下列情況改讀 kana(speechText),避免引擎讀成別的字:
 * - 單一漢字(方 かた/ほう、私 わたくし、土 ど):單字無上下文,引擎常取另一個讀音
 * - 含數字、同形異讀(READ_KANA_SURFACES)、以「、」並列的同音寫法(暑い、熱い)、
 *   「・」縮寫(月・水・金)
 */
export function listenText(v: Pick<VocabItem, "ruby" | "kana">): string {
  const surface = speechText(surfaceOf(v));
  const bare = surface.replace(SPEECH_PUNCT_RE, "");
  const lone = [...bare].length === 1;
  const alternatives = /[、・]/.test(surface) && !/[、・]/.test(v.kana);
  if (
    !KANJI_RE.test(surface) ||
    lone ||
    alternatives ||
    DIGIT_RE.test(surface) ||
    READ_KANA_SURFACES.has(surface)
  ) {
    return speechText(v);
  }
  return surface;
}

/**
 * 能否出聽力題:kana 須為純假名(［な］、おっと／しゅじん、〜によると 這類記號無法確定朗讀內容),
 * 表面不含〜…(接頭/接尾、數量詞框架不是能單獨聽懂的詞),且有可朗讀的文字。
 */
export function canListen(v: Pick<VocabItem, "ruby" | "kana">): boolean {
  return (
    KANA_ONLY_RE.test(v.kana) &&
    !ELLIPSIS_RE.test(surfaceOf(v)) &&
    listenText(v) !== ""
  );
}

// ── 例句填空(LC-10)────────────────────────────────────────────────

/** 選項不該出現的教材記號與句讀:正解取自例句原文、不會帶這些,帶的干擾項一眼可刪 */
const NOTATION_RE = /[［］〔〕（）()〜～…／「」。、？！?!]/;

/** 表面形可當填空選項(不含教材記號與句讀) */
function isPlainSurface(v: Pick<VocabItem, "ruby">): boolean {
  return !NOTATION_RE.test(surfaceOf(v));
}

/**
 * 把 ruby 分段在表面文字的 [start, end) 處切成前後兩段(挖空用)。帶讀音(r)的漢字段不可拆:
 * 區間端點落在其中者(外国 ⊂ 外国人)回傳 null;假名段可在任意處切開。
 */
export function splitRuby(
  segs: readonly RubySeg[],
  start: number,
  end: number,
): { before: RubySeg[]; after: RubySeg[] } | null {
  const before: RubySeg[] = [];
  const after: RubySeg[] = [];
  let pos = 0;
  for (const seg of segs) {
    const segStart = pos;
    const segEnd = pos + seg.b.length;
    pos = segEnd;
    if (segEnd <= start) {
      before.push(seg);
    } else if (segStart >= end) {
      after.push(seg);
    } else if (seg.r !== undefined) {
      // 漢字段與挖空區間重疊:須整段在區間內
      if (segStart < start || segEnd > end) return null;
    } else {
      if (segStart < start)
        before.push({ b: seg.b.slice(0, start - segStart) });
      if (segEnd > end) after.push({ b: seg.b.slice(end - segStart) });
    }
  }
  return { before, after };
}

/**
 * 為單字出例句填空:以 examples.ts 的詞邊界比對(findExampleMatch)找本課最短的例句或会話,
 * 把單字所在處挖空(只挖單字本身的表面形,同句只挖一處;動詞的活用形命中不挖,
 * 選項是ます形,挖空處須是單字本身)。不出(回傳 null)的情況:
 * - 慣用語(寒暄、套語多半整句即答案,挖空後沒有可判斷的語境);表面含教材記號者
 * - 句子:含「→」的對照行、正規化後等於單字本身(findExampleMatch 已排除)、会話標題行、
 *   中譯標示較晚課次者(用到還沒教的內容,同例句重組)、句中另有同一字面(挖一處仍看得到答案)、
 *   挖空處切開帶讀音的漢字段(外国 ⊂ 外国人)
 * 中譯去掉句尾的課次參照(promptText)。
 */
export function makeCloze(vocab: VocabItem, lesson: Lesson): Cloze | null {
  if (vocab.pos === "慣用" || !isPlainSurface(vocab)) return null;
  const word = surfaceOf(vocab);
  const titles = new Set<Sentence>(
    lesson.dialogues.filter((line, i) => isTitleLine(line, i)),
  );
  const match = findExampleMatch(vocab, lesson, (m) => {
    const { sentence, start, end, kind } = m;
    if (
      kind !== "exact" ||
      titles.has(sentence) ||
      refersToLaterLesson(sentence, lesson.id)
    ) {
      return false;
    }
    const text = surfaceOf(sentence);
    return (
      text.slice(start, end) === word &&
      text.indexOf(word) === text.lastIndexOf(word) &&
      splitRuby(sentence.ruby, start, end) !== null
    );
  });
  const parts = match && splitRuby(match.sentence.ruby, match.start, match.end);
  if (!match || !parts) return null;
  return {
    sentenceId: match.sentence.id,
    ...parts,
    translation: promptText(match.sentence.translation),
  };
}

// ── 可互換的選項(聽力、填空)──────────────────────────────────────────

/** 中文意思的說明括號:（じゃ的禮貌說法）、(自己的)、〔鐘錶〕 */
const MEANING_NOTE_RE = /（[^（）]*）|\([^()]*\)|〔[^〔〕]*〕|［[^［］]*］/g;
/** 中文意思的並列分隔 */
const MEANING_SEP_RE = /[、，,／/；;]/;
/** 比對核心詞時忽略的句讀與記號 */
const MEANING_PUNCT_RE = /[\s。？！?!〜～…"“”]/g;

/** 中文意思的核心詞:去掉說明括號(含巢狀)後以並列分隔切開(那麼（じゃ的禮貌說法）→ 那麼) */
function meaningTokens(meaning: string): string[] {
  let core = meaning;
  for (let prev = ""; prev !== core; ) {
    prev = core;
    core = core.replace(MEANING_NOTE_RE, "");
  }
  return core
    .split(MEANING_SEP_RE)
    .map((t) => t.replace(MEANING_PUNCT_RE, ""))
    .filter((t) => t.length > 0);
}

/** a 的中文意思提到 b(どちら「哪邊（どこ 的禮貌形）」、こっち「這邊（不如"こちら"禮貌）」) */
function mentions(
  a: Pick<VocabItem, "meaning">,
  b: Pick<VocabItem, "kana">,
): boolean {
  return (
    KANA_ONLY_RE.test(b.kana) &&
    b.kana.length >= 2 &&
    a.meaning.includes(b.kana)
  );
}

/**
 * こそあど詞的類別(場所與方向同類:ここ／こちら／こっち 可互換)。そ・あ 系列譯成中文同為「那」,
 * 中譯分不出來(あそこ／そちら),ko・so・a・do 以中譯的「這／那／哪」比對。
 */
const KOSOADO_KIND: ReadonlyMap<string, string> = new Map(
  (
    [
      ["place", "ここ そこ あそこ どこ こちら そちら あちら どちら"],
      ["place", "こっち そっち あっち どっち"],
      ["thing", "これ それ あれ どれ"],
      ["determiner", "この その あの どの"],
      ["kind", "こんな そんな あんな どんな"],
      ["degree", "こんなに そんなに あんなに どんなに"],
    ] as const
  ).flatMap(([kind, words]) =>
    words.split(" ").map((w): [string, string] => [w, kind]),
  ),
);
const KOSOADO_DEIXIS: Readonly<Record<string, string>> = {
  こ: "這",
  そ: "那",
  あ: "那",
  ど: "哪",
};

function sameKosoado(
  a: Pick<VocabItem, "kana">,
  b: Pick<VocabItem, "kana">,
): boolean {
  const kind = KOSOADO_KIND.get(a.kana);
  return (
    kind !== undefined &&
    kind === KOSOADO_KIND.get(b.kana) &&
    KOSOADO_DEIXIS[a.kana[0]] === KOSOADO_DEIXIS[b.kana[0]]
  );
}

/**
 * 兩個字同時當選項時可能都算對(聽力的中文選項、填空的日文選項因此不同時出現):
 * - 中文核心詞重疊:では「那麼（じゃ的禮貌說法）」／それでは「那麼」、中「裡面、中間」／奥「裡面」、
 *   それ／あれ(皆「那」)
 * - 一方的意思提到另一方:どちら「哪邊（どこ 的禮貌形）」／どこ、こちら／ここ
 * - 同類こそあど詞且中譯同為這／那／哪:あそこ／そちら／あっち
 * 寧可多排除(干擾項另有同課/鄰近課的字可補)。
 */
export function interchangeable(
  a: Pick<VocabItem, "kana" | "meaning">,
  b: Pick<VocabItem, "kana" | "meaning">,
): boolean {
  const tokens = new Set(meaningTokens(a.meaning));
  return (
    meaningTokens(b.meaning).some((t) => tokens.has(t)) ||
    mentions(a, b) ||
    mentions(b, a) ||
    sameKosoado(a, b)
  );
}

// ── 出題 ───────────────────────────────────────────────────────────

function withOptions(
  answer: QuizCandidate,
  distractors: QuizCandidate[],
  rng: Rng,
): McqOption[] {
  return shuffle(
    [
      { id: answer.id, candidate: answer, correct: true },
      ...distractors.map((c) => ({ id: c.id, candidate: c, correct: false })),
    ],
    rng,
  );
}

function makeMcq(
  answer: QuizCandidate,
  pool: QuizCandidate[],
  type: McqType,
  optionCount: number,
  rng: Rng,
): McqQuestion {
  if (type !== "listen") {
    const distractors = pickDistractors(answer, pool, optionCount - 1, rng);
    return { type, answer, options: withOptions(answer, distractors, rng) };
  }
  // 聽力:選項為中文,彼此不重複;讀音相同的字(平/片假名寫法不同亦同)聽不出差別、
  // 意思可互換的字(interchangeable)也算對,皆不當干擾項
  const reading = normalizeReading(answer.kana);
  const distractors = pickDistractors(
    answer,
    pool.filter(
      (c) =>
        normalizeReading(c.kana) !== reading && !interchangeable(answer, c),
    ),
    optionCount - 1,
    rng,
    (c) => c.meaning,
  );
  return { type, answer, options: withOptions(answer, distractors, rng) };
}

/**
 * 例句填空的選項:同詞性干擾項(pickDistractors 規則),只取不帶教材記號的字,日文表面形不重複;
 * 填入也對的字(interchangeable:どこ／どちら、あそこ／そちら、では／それでは)不當干擾項
 */
function makeClozeQuestion(
  answer: QuizCandidate,
  cloze: Cloze,
  pool: QuizCandidate[],
  optionCount: number,
  rng: Rng,
): ClozeQuestion {
  const distractors = pickDistractors(
    answer,
    pool.filter((c) => isPlainSurface(c) && !interchangeable(answer, c)),
    optionCount - 1,
    rng,
    surfaceOf,
  );
  return {
    type: "cloze",
    answer,
    options: withOptions(answer, distractors, rng),
    cloze,
  };
}

/**
 * 輪到的題型不適合這個字時改出的題型(依序取第一個已啟用且適合者):
 * 輸入、填空 → 中→日(同為回想日文);聽力 → 日→中(同為辨義)。
 */
const FALLBACK: Readonly<Record<QuestionType, readonly QuestionType[]>> = {
  "jp-to-zh": [],
  "zh-to-jp": [],
  input: ["zh-to-jp", "jp-to-zh", "cloze", "listen"],
  cloze: ["zh-to-jp", "jp-to-zh", "input", "listen"],
  listen: ["jp-to-zh", "zh-to-jp", "cloze", "input"],
};

/** 有條件的題型:先在抽中的字裡為它們挑適合者(否則常被一律適合的選擇題先用掉);越少字適合者越先挑 */
const CONSTRAINED: readonly QuestionType[] = ["cloze", "listen", "input"];

export interface GenerateQuizOptions {
  count?: number;
  optionCount?: number;
  types?: QuestionType[];
  /** 目標課的完整資料:例句填空從其文法例句與会話找句;未提供時不出填空 */
  lesson?: Lesson;
  /** 可出聽力題(呼叫端:設定 ttsEnabled 開啟且有日語語音);false 時 types 中的 listen 忽略 */
  listenAvailable?: boolean;
  rng?: Rng;
}

/** 出題的共同判斷:實際啟用的題型、各題型適不適合某字、可出題的字(generateQuiz 與 quizWordCount 共用) */
function quizPlan(
  lessonId: number,
  pool: QuizCandidate[],
  { types: requested, lesson, listenAvailable = false }: GenerateQuizOptions,
) {
  const types = (requested ?? ["jp-to-zh", "zh-to-jp", "input"]).filter(
    (t) => t !== "listen" || listenAvailable,
  );
  const clozes = new Map<string, Cloze | null>();
  const clozeOf = (c: QuizCandidate): Cloze | null => {
    if (lesson === undefined || c.lessonId !== lesson.id) return null;
    if (!clozes.has(c.id)) clozes.set(c.id, makeCloze(c, lesson));
    return clozes.get(c.id) ?? null;
  };
  const fits = (c: QuizCandidate, t: QuestionType): boolean =>
    t === "input"
      ? canInput(c)
      : t === "listen"
        ? canListen(c)
        : t === "cloze"
          ? clozeOf(c) !== null
          : true;
  const targets = pool.filter(
    (c) =>
      c.lessonId === lessonId &&
      !isSupplementary(c) &&
      types.some((t) => fits(c, t)),
  );
  return { types, clozeOf, fits, targets };
}

/**
 * 以這些題型可出題的字數(補充單字除外、至少適合一個啟用題型):題型選單據此顯示題數
 * (generateQuiz 出 min(count, 此數) 題)。
 */
export function quizWordCount(
  lessonId: number,
  pool: QuizCandidate[],
  options: Pick<GenerateQuizOptions, "types" | "lesson" | "listenAvailable">,
): number {
  return quizPlan(lessonId, pool, options).targets.length;
}

/**
 * 為 `lessonId` 出題。`pool` 應含該課單字 + 鄰近課單字(供干擾項)。
 * 題型在 enabled types 間依序輪替;選擇題干擾項依 pickDistractors 規則。
 * - 本回合的字從可出題的字隨機均勻抽 `count` 個(再測一次重新抽);補充單字(自行練習發音)
 *   不出題,仍可當干擾項;題目不足 `count` 時就出較少題。
 * - 有條件的題型只給適合的字:輸入題 canInput、聽力 canListen(且 listenAvailable)、
 *   填空 makeCloze 找得到例句(需 `lesson`)。先在抽中的字裡為這些題型挑適合者;不夠時該題改出
 *   FALLBACK 中已啟用且適合的題型(輸入、填空優先中→日)。沒有任何啟用題型適合的字不出題
 *   (例:只啟用輸入題時只從可輸入的字出題)。填空因此只在抽到有例句的字時出現。
 * - 填空:同一回合每句例句只用一次;抽中的字只剩「例句已用過的填空」可出時改取未抽中的字,
 *   沒有其他字可出時才重複。
 */
export function generateQuiz(
  lessonId: number,
  pool: QuizCandidate[],
  options: GenerateQuizOptions = {},
): Question[] {
  const { count = 10, optionCount = 4, rng = Math.random } = options;
  const { types, clozeOf, fits, targets } = quizPlan(lessonId, pool, options);
  if (types.length === 0) return [];

  // 隨機順序的前 count 個 = 本回合抽中的字(均勻抽樣,不因題型偏向某些字);其後備用
  const order = shuffle(targets, rng);
  const sampled = order.slice(0, count);
  const slots = sampled.map((_, i) => types[i % types.length]);

  const used = new Set<string>();
  const take = (
    from: readonly QuizCandidate[],
    accept: (c: QuizCandidate) => boolean,
  ) => {
    const c = from.find((w) => !used.has(w.id) && accept(w));
    if (c) used.add(c.id);
    return c;
  };
  // 同一回合每句例句只挖空一次(同句的另一個字挖空時,前一題的答案就在句中)
  const usedSentences = new Set<string>();
  const fresh = (c: QuizCandidate, t: QuestionType): boolean => {
    if (t !== "cloze") return fits(c, t);
    const cloze = clozeOf(c);
    return cloze !== null && !usedSentences.has(cloze.sentenceId);
  };
  const use = (c: QuizCandidate, t: QuestionType) => {
    const sentenceId = t === "cloze" ? clozeOf(c)?.sentenceId : undefined;
    if (sentenceId !== undefined) usedSentences.add(sentenceId);
  };

  // 有條件題型的輪次:抽中的字裡適合者,先給可出題型最少的字(只能填空的字先佔例句,
  // 也能出輸入題的字留給輸入題,例句才不會不夠分)
  const flexibility = (c: QuizCandidate) =>
    types.filter((t) => fits(c, t)).length;
  const answers: (QuizCandidate | undefined)[] = slots.map(() => undefined);
  for (const t of CONSTRAINED) {
    slots.forEach((slot, i) => {
      if (slot !== t) return;
      const fitting = sampled.filter((w) => !used.has(w.id) && fresh(w, t));
      const least = Math.min(...fitting.map(flexibility));
      const c = take(fitting, (w) => flexibility(w) === least);
      if (c) use(c, t);
      answers[i] = c;
    });
  }

  const questions: Question[] = [];
  slots.forEach((slot, i) => {
    const preset = answers[i];
    // 其餘輪次依序取抽中的字;抽中的字都只剩例句已用過的填空可出時,改取未抽中、出題不必重複
    // 例句的字,仍沒有才重複例句。題數 ≤ 可出題的字數,這裡必取得到字
    const answer =
      preset ??
      take(order, (w) => types.some((t) => fresh(w, t))) ??
      take(order, () => true);
    if (!answer) return;
    // 輪到的題型不適合時依 FALLBACK 改出;每個可出題的字至少適合一個啟用題型
    const candidates = [slot, ...FALLBACK[slot], ...types].filter((t) =>
      types.includes(t),
    );
    const type = preset
      ? slot
      : (candidates.find((t) => fresh(answer, t)) ??
        candidates.find((t) => fits(answer, t)) ??
        slot);
    if (!preset) use(answer, type);
    if (type === "input") {
      questions.push({ type, answer });
    } else if (type === "cloze") {
      const cloze = clozeOf(answer);
      if (cloze) {
        questions.push(
          makeClozeQuestion(answer, cloze, pool, optionCount, rng),
        );
      }
    } else {
      questions.push(makeMcq(answer, pool, type, optionCount, rng));
    }
  });
  return questions;
}

/**
 * 讀回儲存的題型選擇(設定 quizTypes;手改的備份可能留下任意值):只留已知題型,
 * 依 QUESTION_TYPES 排序、去重;沒有任何有效題型時回傳 null(呼叫端改用預設)。
 */
export function parseQuizTypes(raw: unknown): QuestionType[] | null {
  if (!Array.isArray(raw)) return null;
  const types = QUESTION_TYPES.filter((t) => raw.includes(t));
  return types.length > 0 ? types : null;
}
