import type { Pos, RubySeg, VocabItem } from "@/schemas/lesson";

/**
 * 活用引擎(T11.3,F7.3):由教材單字(動詞ます形、い/な形容詞)依規則推導基本活用形。
 * 純函式;推導結果只供練習顯示,不寫入 public/data。無法確定者回傳 null(寧缺勿錯)。
 *
 * 表記規則:
 * - 只活用最後一個空格分隔的詞,前綴原樣保留(持って 行きます → 持って 行って)。
 * - ruby 的漢字段(帶 r)原樣保留,只改最後的假名段;唯一例外是来る系「来」的讀音(き/こ/く)。
 * - 輸出 kana = 輸出 ruby 逐段讀音(r ?? b)串接並去掉空白,與教材 kana 欄一致(kana 無空白)。
 * - 教材記號先去除:替代說法「いい （よい）」只活用括號外;な形容詞的［な］〔な〕;
 *   い形容詞同讀音並列(暑い、熱い)只活用第一個寫法。
 */

/** ます系(L04-G03):非過去/過去 × 肯定/否定 */
type MasuForm = "masu" | "masen" | "mashita" | "masendeshita";
/** 普通形系:て形、た形、ない形、なかった、辞書形 */
type PlainVerbForm = "te" | "ta" | "nai" | "nakatta" | "dict";

/** 動詞的基本形 */
export type VerbForm = MasuForm | PlainVerbForm;

/**
 * 形容詞的基本形:丁寧體 negPolite/pastPolite/pastNegPolite(〜くないです/〜じゃ ありません…)、
 * て形 te(〜くて/〜で)、連用 adv(〜く/〜に,「〜く/に なります」L19-G04)、
 * 普通形 neg/past/pastNeg(〜くない/〜じゃ ない…)。
 */
export type AdjForm =
  | "negPolite"
  | "pastPolite"
  | "pastNegPolite"
  | "te"
  | "adv"
  | "neg"
  | "past"
  | "pastNeg";

/** 所有形("te" 動詞與形容詞共用名稱,依單字詞性決定語尾) */
export type ConjForm = VerbForm | AdjForm;

/** 活用類別:動詞(動I/II/III)、い形容詞、な形容詞 */
export type ConjClass = "verb" | "iAdj" | "naAdj";

/** 動詞各形(依教材導入順序) */
export const VERB_FORMS: readonly VerbForm[] = [
  "masu",
  "masen",
  "mashita",
  "masendeshita",
  "te",
  "nai",
  "dict",
  "ta",
  "nakatta",
];

/** 形容詞各形(依教材導入順序) */
export const ADJ_FORMS: readonly AdjForm[] = [
  "negPolite",
  "pastPolite",
  "pastNegPolite",
  "te",
  "adv",
  "neg",
  "past",
  "pastNeg",
];

/** 活用結果:ruby 供 RubyText 顯示,kana 供輸入比對與朗讀 */
export interface Conjugated {
  ruby: RubySeg[];
  kana: string;
}

/** 活用所需的單字欄位 */
export type ConjugableItem = Pick<VocabItem, "id" | "ruby" | "kana" | "pos">;

// ── 教材導入課次 ─────────────────────────────────────────────────────

/** 某形在教材中首次導入的文法點(答錯時連到 /lessons/N#grammarId) */
export interface FormIntro {
  lesson: number;
  grammarId: string;
}

function at(grammarId: string): FormIntro {
  return { lesson: Number(grammarId.slice(1, 3)), grammarId };
}

/**
 * 各形的導入文法點。形容詞普通形(〜くない/〜じゃ ない、〜かった/〜だった…)屬第 20 課
 * 普通形(L20-G01);第 8、12 課教的是丁寧體(〜くないです、〜じゃ ありません、〜でした)。
 */
export const FORM_INTRO: {
  readonly verb: Readonly<Record<VerbForm, FormIntro>>;
  readonly iAdj: Readonly<Record<AdjForm, FormIntro>>;
  readonly naAdj: Readonly<Record<AdjForm, FormIntro>>;
} = {
  verb: {
    masu: at("L04-G03"),
    masen: at("L04-G03"),
    mashita: at("L04-G03"),
    masendeshita: at("L04-G03"),
    te: at("L14-G03"),
    nai: at("L17-G01"),
    dict: at("L18-G01"),
    ta: at("L19-G01"),
    nakatta: at("L20-G01"),
  },
  iAdj: {
    negPolite: at("L08-G02"), // いいです → よくないです 亦在此
    pastPolite: at("L12-G02"),
    pastNegPolite: at("L12-G02"),
    te: at("L16-G02"),
    adv: at("L19-G04"),
    neg: at("L20-G01"),
    past: at("L20-G01"),
    pastNeg: at("L20-G01"),
  },
  naAdj: {
    negPolite: at("L08-G02"),
    pastPolite: at("L12-G01"),
    pastNegPolite: at("L12-G01"),
    te: at("L16-G03"),
    adv: at("L19-G04"),
    neg: at("L20-G01"),
    past: at("L20-G01"),
    pastNeg: at("L20-G01"),
  },
};

// ── 類別與形 ─────────────────────────────────────────────────────────

/** 詞性的活用類別;不活用的詞性回傳 null */
export function conjClass(pos: Pos): ConjClass | null {
  switch (pos) {
    case "動I":
    case "動II":
    case "動III":
      return "verb";
    case "い形":
      return "iAdj";
    case "な形":
      return "naAdj";
    default:
      return null;
  }
}

/** 該詞性可練習的形(不活用的詞性為空陣列) */
export function formsOf(pos: Pos): readonly ConjForm[] {
  const cls = conjClass(pos);
  if (cls === null) return [];
  return cls === "verb" ? VERB_FORMS : ADJ_FORMS;
}

function isVerbForm(form: ConjForm): form is VerbForm {
  return (VERB_FORMS as readonly ConjForm[]).includes(form);
}

function isAdjForm(form: ConjForm): form is AdjForm {
  return (ADJ_FORMS as readonly ConjForm[]).includes(form);
}

/** 詞性 × 形的導入文法點;該詞性沒有此形回傳 null */
export function formIntro(pos: Pos, form: ConjForm): FormIntro | null {
  const cls = conjClass(pos);
  if (cls === null) return null;
  if (cls === "verb") return isVerbForm(form) ? FORM_INTRO.verb[form] : null;
  return isAdjForm(form) ? FORM_INTRO[cls][form] : null;
}

// ── 排除清單 ─────────────────────────────────────────────────────────

/**
 * 排除清單(id → 理由):規則推導會出錯或資料形狀不適用的字,conjugate 一律回傳 null。
 * TODO(docs/reports/2026-09-uiux-learning-audit.md「資料修正清單」1):L07-V006、L47-V004..006
 * 的詞性以 fixture 修正後,自本清單移除(借ります 為動II、單獨的 します 為動III)。
 */
export const CONJUGATION_EXCLUDED: ReadonlyMap<string, string> = new Map([
  ["L07-V006", "借ります 誤標為動I(應為動II):會推導出「借らない」"],
  ["L32-V010", "治ります、直ります:兩個不同動詞並列"],
  ["L40-V055", "離れた:唯一不是ます形的動詞(読み物回填)"],
  ["L47-V004", "します〔音／声が〜〕誤標為動I(應為動III)"],
  ["L47-V005", "します〔味が〜〕誤標為動I(應為動III)"],
  ["L47-V006", "します〔においが〜〕誤標為動I(應為動III)"],
  ["L50-V010", "ございます:ござる 的活用不在基本形練習範圍"],
]);

// ── ruby 操作 ────────────────────────────────────────────────────────

/** 以 head + 新的末尾假名段組成 ruby(假名為空則不加段;段落物件複製,不改動輸入) */
function withLastKana(head: readonly RubySeg[], kana: string): RubySeg[] {
  const segs = head.map((s) => ({ ...s }));
  return kana === "" ? segs : [...segs, { b: kana }];
}

/** 末段為假名段且以 from 結尾時,把該尾巴換成 to;否則 null */
function replaceTail(
  ruby: readonly RubySeg[],
  from: string,
  to: string,
): RubySeg[] | null {
  const last = ruby[ruby.length - 1];
  if (last === undefined || last.r !== undefined || !last.b.endsWith(from)) {
    return null;
  }
  return withLastKana(
    ruby.slice(0, -1),
    last.b.slice(0, last.b.length - from.length) + to,
  );
}

/** 在末尾接上假名:末段是假名段則併入,是漢字段(大変)則新增一段 */
function appendKana(ruby: readonly RubySeg[], kana: string): RubySeg[] {
  const last = ruby[ruby.length - 1];
  if (last === undefined || last.r !== undefined) {
    return withLastKana(ruby, kana);
  }
  return withLastKana(ruby.slice(0, -1), last.b + kana);
}

/** 末段為假名段時去掉符合 re 的尾巴(段落變空則移除);不符合則原樣回傳 */
function stripTail(ruby: readonly RubySeg[], re: RegExp): readonly RubySeg[] {
  const last = ruby[ruby.length - 1];
  if (last === undefined || last.r !== undefined || !re.test(last.b)) {
    return ruby;
  }
  return withLastKana(ruby.slice(0, -1), last.b.replace(re, ""));
}

/** 逐段讀音(r ?? b)串接 */
function reading(ruby: readonly RubySeg[]): string {
  return ruby.map((s) => s.r ?? s.b).join("");
}

/** 讀音去空白:kana 欄的慣例 */
function toKana(ruby: readonly RubySeg[]): string {
  return reading(ruby).replace(/\s+/g, "");
}

/** 最後一個空格分隔的詞的讀音(教材的空格只出現在假名段,漢字段 r 不含空格) */
function lastWordReading(ruby: readonly RubySeg[]): string {
  const words = reading(ruby).split(/\s+/);
  return words[words.length - 1] ?? "";
}

/**
 * 同讀音並列(暑(あつ)[い、]熱(あつ)[い])取第一個寫法:「、」須恰在某假名段的結尾;
 * 否則(「、」在段中或在漢字段)回傳 null。無「、」原樣回傳。
 */
function firstSpelling(ruby: readonly RubySeg[]): readonly RubySeg[] | null {
  const i = ruby.findIndex((s) => s.b.includes("、"));
  if (i < 0) return ruby;
  const seg = ruby[i];
  if (seg.r !== undefined || seg.b.indexOf("、") !== seg.b.length - 1) {
    return null;
  }
  return withLastKana(ruby.slice(0, i), seg.b.slice(0, -1));
}

/** 替代說法:「いい （よい）」的「 （よい）」 */
const ALT_TAIL_RE = /\s*（[^（）]*）$/;
/** な形容詞的［な］〔な〕 */
const NA_MARK_RE = /[［〔]な[］〕]$/;
/** 去除教材記號後仍殘留這些字元者,不是規則能處理的形狀 */
const UNSUPPORTED_MARK_RE = /[［］〔〕（）()、,〜～…／「」・]/;

/**
 * 活用前的基底 ruby:去掉替代說法、(い形)並列取第一個寫法、(な形)［な］;
 * 殘留記號、或讀音與 kana 欄對不上(資料不一致)時回傳 null。
 */
function baseRuby(
  v: ConjugableItem,
  cls: ConjClass,
): readonly RubySeg[] | null {
  let ruby: readonly RubySeg[] | null = stripTail(v.ruby, ALT_TAIL_RE);
  if (cls === "iAdj") ruby = firstSpelling(ruby);
  if (ruby === null) return null;
  if (cls === "naAdj") ruby = stripTail(ruby, NA_MARK_RE);
  if (ruby.length === 0) return null;
  if (UNSUPPORTED_MARK_RE.test(ruby.map((s) => s.b).join(""))) return null;
  return toKana(ruby) === v.kana.replace(NA_MARK_RE, "") ? ruby : null;
}

// ── 動詞 ─────────────────────────────────────────────────────────────

const MASU_ENDING: Readonly<Record<MasuForm, string>> = {
  masu: "ます",
  masen: "ません",
  mashita: "ました",
  masendeshita: "ませんでした",
};

function isMasuForm(form: VerbForm): form is MasuForm {
  return form in MASU_ENDING;
}

/** Ⅱ類:ます → 語尾(来る 的語尾亦同) */
const ICHIDAN_ENDING: Readonly<Record<PlainVerbForm, string>> = {
  te: "て",
  ta: "た",
  nai: "ない",
  nakatta: "なかった",
  dict: "る",
};

/** Ⅲ類 する(含「名詞+します」):します → */
const SURU: Readonly<Record<PlainVerbForm, string>> = {
  te: "して",
  ta: "した",
  nai: "しない",
  nakatta: "しなかった",
  dict: "する",
};

/** Ⅲ類 来る:「来」的讀音 き → こ(ない)、く(る) */
const KURU_STEM: Readonly<Record<PlainVerbForm, string>> = {
  te: "き",
  ta: "き",
  nai: "こ",
  nakatta: "こ",
  dict: "く",
};

/** Ⅰ類:ます形最後一音(い段)→ あ段(ない)、う段(辞書形)、て形/た形語尾(L14-G03、L17-G01、L18-G01) */
interface GodanRow {
  a: string;
  u: string;
  te: string;
  ta: string;
}

const GODAN: ReadonlyMap<string, GodanRow> = new Map([
  ["い", { a: "わ", u: "う", te: "って", ta: "った" }], // 買います → 買わない(い → わ)
  ["ち", { a: "た", u: "つ", te: "って", ta: "った" }],
  ["り", { a: "ら", u: "る", te: "って", ta: "った" }],
  ["み", { a: "ま", u: "む", te: "んで", ta: "んだ" }],
  ["び", { a: "ば", u: "ぶ", te: "んで", ta: "んだ" }],
  ["に", { a: "な", u: "ぬ", te: "んで", ta: "んだ" }],
  ["き", { a: "か", u: "く", te: "いて", ta: "いた" }],
  ["ぎ", { a: "が", u: "ぐ", te: "いで", ta: "いだ" }],
  ["し", { a: "さ", u: "す", te: "して", ta: "した" }],
]);

/**
 * -aru 敬語動詞:ます形是「〜います」,活用卻依「り」行(いらっしゃる/いらっしゃって/
 * いらっしゃらない),不是 い → わ/う。以最後一詞的讀音完全比對。
 */
const ARU_HONORIFICS: ReadonlySet<string> = new Set([
  "いらっしゃいます",
  "おっしゃいます",
  "くださいます",
  "なさいます",
]);

/** 規則不處理、一律回傳 null 的動詞(ございます:ござる 系) */
const UNSUPPORTED_VERBS: ReadonlySet<string> = new Set(["ございます"]);

/** 動詞的活用型:先整體判定,使同一個字的各形要嘛全部成立、要嘛全部 null */
type VerbShape =
  | { kind: "godan"; row: GodanRow; tail: string; iku: boolean; aru: boolean }
  | { kind: "ichidan" }
  | { kind: "suru" }
  | { kind: "kuru"; kanji: boolean };

function verbShape(ruby: readonly RubySeg[], pos: Pos): VerbShape | null {
  const word = lastWordReading(ruby);
  const last = ruby[ruby.length - 1];
  if (
    last === undefined ||
    last.r !== undefined ||
    !last.b.endsWith("ます") ||
    UNSUPPORTED_VERBS.has(word)
  ) {
    return null;
  }
  switch (pos) {
    case "動I": {
      // 最後一音須在假名段內(行(い)[きます] 的「き」)
      const kana = last.b.slice(0, -2);
      const mora = kana[kana.length - 1];
      if (mora === undefined) return null;
      const row = ARU_HONORIFICS.has(word) ? GODAN.get("り") : GODAN.get(mora);
      if (row === undefined) return null;
      return {
        kind: "godan",
        row,
        tail: `${mora}ます`,
        // 行く系:行きます、持って 行きます、連れて 行きます、うまく いきます(聞きます 等不算)
        iku: word === "いきます",
        aru: word === "あります",
      };
    }
    case "動II":
      return { kind: "ichidan" };
    case "動III": {
      if (word.endsWith("します")) {
        return last.b.endsWith("します") ? { kind: "suru" } : null;
      }
      if (!word.endsWith("きます")) return null;
      // 来(き)[ます]:讀音在漢字段
      const prev = ruby[ruby.length - 2];
      if (last.b === "ます" && prev?.b === "来" && prev.r === "き") {
        return { kind: "kuru", kanji: true };
      }
      // 假名書寫的 きます:最後一詞須恰為 きます(起きます、できます 誤標為動III 時回傳 null)
      return word === "きます" && last.b.endsWith("きます")
        ? { kind: "kuru", kanji: false }
        : null;
    }
    default:
      return null;
  }
}

function godanTail(row: GodanRow, form: PlainVerbForm, iku: boolean): string {
  switch (form) {
    case "te":
      return iku ? "って" : row.te;
    case "ta":
      return iku ? "った" : row.ta;
    case "nai":
      return `${row.a}ない`;
    case "nakatta":
      return `${row.a}なかった`;
    case "dict":
      return row.u;
  }
}

function conjugateVerb(
  ruby: readonly RubySeg[],
  shape: VerbShape,
  form: VerbForm,
): RubySeg[] | null {
  // ます系:所有動詞只換「ます」(来ます → 来ません,讀音不變)
  if (isMasuForm(form)) return replaceTail(ruby, "ます", MASU_ENDING[form]);
  switch (shape.kind) {
    case "ichidan":
      return replaceTail(ruby, "ます", ICHIDAN_ENDING[form]);
    case "suru":
      return replaceTail(ruby, "します", SURU[form]);
    case "kuru": {
      if (!shape.kanji) {
        return replaceTail(
          ruby,
          "きます",
          KURU_STEM[form] + ICHIDAN_ENDING[form],
        );
      }
      // 来(き)[ます] → 来(こ)[ない]:改寫「来」段讀音與末段語尾
      const head = ruby.slice(0, -2).map((s) => ({ ...s }));
      return [
        ...head,
        { b: "来", r: KURU_STEM[form] },
        { b: ICHIDAN_ENDING[form] },
      ];
    }
    case "godan":
      // ある → ない/なかった(L17-G01 表外例外,整個詞替換)
      if (shape.aru && (form === "nai" || form === "nakatta")) {
        return replaceTail(ruby, "あります", ICHIDAN_ENDING[form]);
      }
      return replaceTail(
        ruby,
        shape.tail,
        godanTail(shape.row, form, shape.iku),
      );
  }
}

// ── 形容詞 ───────────────────────────────────────────────────────────

/** い形容詞:去掉「い」後接 */
const I_ADJ_ENDING: Readonly<Record<AdjForm, string>> = {
  negPolite: "くないです",
  pastPolite: "かったです",
  pastNegPolite: "くなかったです",
  te: "くて",
  adv: "く",
  neg: "くない",
  past: "かった",
  pastNeg: "くなかった",
};

/** な形容詞:語幹(去掉［な］)後接;「じゃ ない」依教材分かち書き留空格 */
const NA_ADJ_ENDING: Readonly<Record<AdjForm, string>> = {
  negPolite: "じゃ ありません",
  pastPolite: "でした",
  pastNegPolite: "じゃ ありませんでした",
  te: "で",
  adv: "に",
  neg: "じゃ ない",
  past: "だった",
  pastNeg: "じゃ なかった",
};

function conjugateAdj(
  ruby: readonly RubySeg[],
  cls: "iAdj" | "naAdj",
  form: AdjForm,
): RubySeg[] | null {
  if (cls === "naAdj") return appendKana(ruby, NA_ADJ_ENDING[form]);
  // いい → よ-(よくない、よかった):只看整個詞是 いい,かわいい 照一般規則
  const stem =
    lastWordReading(ruby) === "いい" ? replaceTail(ruby, "いい", "よい") : ruby;
  return stem === null ? null : replaceTail(stem, "い", I_ADJ_ENDING[form]);
}

// ── 入口 ─────────────────────────────────────────────────────────────

/**
 * 推導單字的活用形:動詞(動I/II/III 的ます形)與い/な形容詞。
 * 下列情況回傳 null:排除清單中的字、不活用的詞性、該詞性沒有此形(動詞問 adv)、
 * 資料形狀不是規則能確定處理的(非ます形、殘留記號、讀音與 kana 不一致)。
 */
export function conjugate(
  v: ConjugableItem,
  form: ConjForm,
): Conjugated | null {
  if (CONJUGATION_EXCLUDED.has(v.id)) return null;
  const cls = conjClass(v.pos);
  if (cls === null) return null;
  const base = baseRuby(v, cls);
  if (base === null) return null;

  let ruby: RubySeg[] | null;
  if (cls === "verb") {
    if (!isVerbForm(form)) return null;
    const shape = verbShape(base, v.pos);
    ruby = shape === null ? null : conjugateVerb(base, shape, form);
  } else {
    if (!isAdjForm(form)) return null;
    ruby = conjugateAdj(base, cls, form);
  }
  return ruby === null ? null : { ruby, kana: toKana(ruby) };
}

/**
 * 能否活用:指定 form 時看該形;未指定時須該詞性的每一形都能推導(練習抽題用)。
 */
export function isConjugable(v: ConjugableItem, form?: ConjForm): boolean {
  if (form !== undefined) return conjugate(v, form) !== null;
  const forms = formsOf(v.pos);
  return forms.length > 0 && forms.every((f) => conjugate(v, f) !== null);
}
