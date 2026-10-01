import { FORM_EXCLUSIONS } from "@/lib/conjugateExclusions";
import type { Pos, RubySeg, VocabItem } from "@/schemas/lesson";

/**
 * 活用引擎(T11.3、T11.5,F7.3):由教材單字(動詞ます形、い/な形容詞)依規則推導活用形。
 * 純函式;推導結果只供練習顯示,不寫入 public/data。無法確定者回傳 null(寧缺勿錯)。
 *
 * 表記規則:
 * - 只活用最後一個空格分隔的詞,前綴原樣保留(持って 行きます → 持って 行って)。
 * - ruby 的漢字段(帶 r)原樣保留,只改最後的假名段;唯一例外是来る系「来」的讀音(き/こ/く)。
 * - 輸出 kana = 輸出 ruby 逐段讀音(r ?? b)串接並去掉空白,與教材 kana 欄一致(kana 無空白)。
 * - 教材記號先去除:替代說法「いい （よい）」只活用括號外;な形容詞的［な］〔な〕;
 *   い形容詞同讀音並列(暑い、熱い)只活用第一個寫法。
 *
 * 進階形(第 27 課起)另有各形的排除:教材明說或由解說推知沒有此形者(TEXTBOOK_NO_FORM)、
 * 「〜を」前綴的可能形、敬語動詞,與語意不成立者(conjugateExclusions.ts)。同一個字的基本形不受影響。
 */

/** ます系(L04-G03):非過去/過去 × 肯定/否定 */
type MasuForm = "masu" | "masen" | "mashita" | "masendeshita";
/** 普通形系:て形、た形、ない形、なかった、辞書形 */
type PlainVerbForm = "te" | "ta" | "nai" | "nakatta" | "dict";

/**
 * 動詞的進階形:可能 potential(L27-G01)、意向 volitional(L31-G01)、命令 imperative 與
 * 禁止 prohibitive(L33-G01)、條件 conditional(〜ば,L35-G01)、被動 passive(L37-G01)、
 * 使役 causative(L48-G01)。可能/被動/使役動詞皆依Ⅱ類活用(L27-G01、L37-G01、L48-G01),
 * 教材以ます形與辞書形並列(かけます/かける);這裡一律輸出辞書形(書ける、書かれる、書かせる)。
 */
export type AdvancedVerbForm =
  | "potential"
  | "volitional"
  | "imperative"
  | "prohibitive"
  | "conditional"
  | "passive"
  | "causative";

/** 動詞的基本形 */
export type BasicVerbForm = MasuForm | PlainVerbForm;

/** 動詞各形 */
export type VerbForm = BasicVerbForm | AdvancedVerbForm;

/**
 * 形容詞的基本形:丁寧體 negPolite/pastPolite/pastNegPolite(〜くないです/〜じゃ ありません…)、
 * て形 te(〜くて/〜で)、連用 adv(〜く/〜に,「〜く/に なります」L19-G04)、
 * 普通形 neg/past/pastNeg(〜くない/〜じゃ ない…)。
 */
export type BasicAdjForm =
  | "negPolite"
  | "pastPolite"
  | "pastNegPolite"
  | "te"
  | "adv"
  | "neg"
  | "past"
  | "pastNeg";

/** 形容詞的進階形:條件形(い形容詞 〜ければ、な形容詞 〜なら,L35-G01) */
export type AdvancedAdjForm = "conditional";

/** 形容詞各形 */
export type AdjForm = BasicAdjForm | AdvancedAdjForm;

/** 所有形("te"、"conditional" 動詞與形容詞共用名稱,依單字詞性決定語尾) */
export type ConjForm = VerbForm | AdjForm;

/** 活用類別:動詞(動I/II/III)、い形容詞、な形容詞 */
export type ConjClass = "verb" | "iAdj" | "naAdj";

/** 動詞的基本形(依教材導入順序) */
export const BASIC_VERB_FORMS: readonly BasicVerbForm[] = [
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

/** 動詞的進階形(依教材導入順序) */
export const ADVANCED_VERB_FORMS: readonly AdvancedVerbForm[] = [
  "potential",
  "volitional",
  "imperative",
  "prohibitive",
  "conditional",
  "passive",
  "causative",
];

/** 動詞各形(依教材導入順序) */
export const VERB_FORMS: readonly VerbForm[] = [
  ...BASIC_VERB_FORMS,
  ...ADVANCED_VERB_FORMS,
];

/** 形容詞的基本形(依教材導入順序) */
export const BASIC_ADJ_FORMS: readonly BasicAdjForm[] = [
  "negPolite",
  "pastPolite",
  "pastNegPolite",
  "te",
  "adv",
  "neg",
  "past",
  "pastNeg",
];

/** 形容詞的進階形 */
export const ADVANCED_ADJ_FORMS: readonly AdvancedAdjForm[] = ["conditional"];

/** 形容詞各形(依教材導入順序) */
export const ADJ_FORMS: readonly AdjForm[] = [
  ...BASIC_ADJ_FORMS,
  ...ADVANCED_ADJ_FORMS,
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
 * 進階形的導入文法點即寫了變換規則的那一點(命令與禁止同為 L33-G01;條件形的動詞與形容詞同為 L35-G01)。
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
    potential: at("L27-G01"),
    volitional: at("L31-G01"),
    imperative: at("L33-G01"),
    prohibitive: at("L33-G01"),
    conditional: at("L35-G01"),
    passive: at("L37-G01"),
    causative: at("L48-G01"),
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
    conditional: at("L35-G01"),
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
    conditional: at("L35-G01"),
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

/** 該詞性的所有形(基本形 + 進階形;不活用的詞性為空陣列) */
export function formsOf(pos: Pos): readonly ConjForm[] {
  const cls = conjClass(pos);
  if (cls === null) return [];
  return cls === "verb" ? VERB_FORMS : ADJ_FORMS;
}

/** 該詞性的基本形(可活用的字每一形皆成立;不活用的詞性為空陣列) */
export function basicFormsOf(pos: Pos): readonly ConjForm[] {
  const cls = conjClass(pos);
  if (cls === null) return [];
  return cls === "verb" ? BASIC_VERB_FORMS : BASIC_ADJ_FORMS;
}

function isVerbForm(form: ConjForm): form is VerbForm {
  return (VERB_FORMS as readonly ConjForm[]).includes(form);
}

function isAdjForm(form: ConjForm): form is AdjForm {
  return (ADJ_FORMS as readonly ConjForm[]).includes(form);
}

function isAdvancedVerbForm(form: ConjForm): form is AdvancedVerbForm {
  return (ADVANCED_VERB_FORMS as readonly ConjForm[]).includes(form);
}

/** 進階形(動詞的可能…使役、形容詞的條件形):第 27 課起,各形另有排除清單 */
export function isAdvancedForm(form: ConjForm): boolean {
  return (
    isAdvancedVerbForm(form) ||
    (ADVANCED_ADJ_FORMS as readonly ConjForm[]).includes(form)
  );
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
 */
export const CONJUGATION_EXCLUDED: ReadonlyMap<string, string> = new Map([
  ["L32-V010", "治ります、直ります:兩個不同動詞並列"],
  ["L40-V055", "離れた:唯一不是ます形的動詞(読み物回填)"],
  ["L50-V010", "ございます:ござる 的活用不在基本形練習範圍"],
]);

/**
 * 教材明說(L27-G01、L33-G01)或由解說推知(L27-G02/G03/G04)沒有此形的動詞
 * (依最後一詞的讀音,不限於教材的 id):
 * - わかります:L27-G01 明說「わかる」本身就表示可能,不說「わかれる」;L33-G01〔註〕明說無命令形
 * - できます:L33-G01〔註〕明說無命令形;可能形由 L27-G04 推知(できます 本身即「能做」,L18 會、能夠)
 * - あります:L33-G01〔註〕明說無命令形;可能形由 L27-G02 推知(可能 = 行為的能力/可能性,存在動詞不是動作)
 * - 見えます、聞こえます:可能形由 L27-G03 推知(與意志無關的知覺;「看/聽得到」的可能形是 見られます/聞けます)
 * 其餘形(意向、禁止…)的語意排除見 conjugateExclusions.ts。
 */
export const TEXTBOOK_NO_FORM: ReadonlyMap<
  string,
  readonly AdvancedVerbForm[]
> = new Map<string, readonly AdvancedVerbForm[]>([
  ["わかります", ["potential", "imperative"]],
  ["できます", ["potential", "imperative"]],
  ["あります", ["potential", "imperative"]],
  ["みえます", ["potential"]],
  ["きこえます", ["potential"]],
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

/** ます以外的形(普通形系 + 進階形):語尾接在語幹之後 */
type StemForm = PlainVerbForm | AdvancedVerbForm;

/**
 * Ⅱ類:ます → 語尾(L27-G01 られる、L31-G01 よう、L33-G01 ろ/る+な、L35-G01 れば、
 * L37-G01 られる、L48-G01 させる)。来る 除命令形外亦同(kuruEnding)。
 */
const ICHIDAN_ENDING: Readonly<Record<StemForm, string>> = {
  te: "て",
  ta: "た",
  nai: "ない",
  nakatta: "なかった",
  dict: "る",
  potential: "られる",
  volitional: "よう",
  imperative: "ろ",
  prohibitive: "るな",
  conditional: "れば",
  passive: "られる",
  causative: "させる",
};

/**
 * Ⅲ類 する(含「名詞+します」):します → 。可能形為 できる(L27-G01 します → できます),
 * 意向 しよう(L31-G01)、命令 しろ(L33-G01)、條件 すれば(L35-G01)、被動 される(L37-G01)、
 * 使役 させる(L48-G01)。
 */
const SURU: Readonly<Record<StemForm, string>> = {
  te: "して",
  ta: "した",
  nai: "しない",
  nakatta: "しなかった",
  dict: "する",
  potential: "できる",
  volitional: "しよう",
  imperative: "しろ",
  prohibitive: "するな",
  conditional: "すれば",
  passive: "される",
  causative: "させる",
};

/**
 * Ⅲ類 来る:「来」的讀音 き → こ(ない、こられる、こよう、こい、こさせる)、く(る、くるな、くれば)。
 * 教材:L27-G01 こられます、L31-G01 こよう、L33-G01 こい、L35-G01 くれば、L37-G01 こられます、
 * L48-G01 来させます(L48-S03 ruby 為 来(こ))。
 */
const KURU_STEM: Readonly<Record<StemForm, string>> = {
  te: "き",
  ta: "き",
  nai: "こ",
  nakatta: "こ",
  dict: "く",
  potential: "こ",
  volitional: "こ",
  imperative: "こ",
  prohibitive: "く",
  conditional: "く",
  passive: "こ",
  causative: "こ",
};

/** 来る 的語尾:同Ⅱ類,只有命令形是「こい」(L33-G01) */
function kuruEnding(form: StemForm): string {
  return form === "imperative" ? "い" : ICHIDAN_ENDING[form];
}

/**
 * Ⅰ類:ます形最後一音(い段)→ あ段(ない、被動 れる、使役 せる)、う段(辞書形、禁止 な)、
 * え段(可能 る、命令、條件 ば)、お段(意向 う)、て形/た形語尾
 * (L14-G03、L17-G01、L18-G01、L27-G01、L31-G01、L33-G01、L35-G01、L37-G01、L48-G01)。
 * 活用練習(drill.ts)亦以此表套用「別行的規則」產生錯誤選項。
 */
export interface GodanRow {
  a: string;
  u: string;
  e: string;
  o: string;
  te: string;
  ta: string;
}

export const GODAN: ReadonlyMap<string, GodanRow> = new Map([
  // 買います → 買わない、買われる、買わせる(い → わ);買える、買おう
  ["い", { a: "わ", u: "う", e: "え", o: "お", te: "って", ta: "った" }],
  ["ち", { a: "た", u: "つ", e: "て", o: "と", te: "って", ta: "った" }],
  ["り", { a: "ら", u: "る", e: "れ", o: "ろ", te: "って", ta: "った" }],
  ["み", { a: "ま", u: "む", e: "め", o: "も", te: "んで", ta: "んだ" }],
  ["び", { a: "ば", u: "ぶ", e: "べ", o: "ぼ", te: "んで", ta: "んだ" }],
  ["に", { a: "な", u: "ぬ", e: "ね", o: "の", te: "んで", ta: "んだ" }],
  ["き", { a: "か", u: "く", e: "け", o: "こ", te: "いて", ta: "いた" }],
  ["ぎ", { a: "が", u: "ぐ", e: "げ", o: "ご", te: "いで", ta: "いだ" }],
  ["し", { a: "さ", u: "す", e: "せ", o: "そ", te: "して", ta: "した" }],
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

/**
 * 動詞的活用型:先整體判定,使同一個字的基本形要嘛全部成立、要嘛全部 null
 * (進階形另依 advancedAllowed 逐形排除)
 */
type VerbShape =
  | {
      kind: "godan";
      row: GodanRow;
      tail: string;
      iku: boolean;
      aru: boolean;
      /** -aru 敬語:命令形不規則(いらっしゃい、ください…),進階形一律不推導 */
      honorific: boolean;
    }
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
      const honorific = ARU_HONORIFICS.has(word);
      const row = honorific ? GODAN.get("り") : GODAN.get(mora);
      if (row === undefined) return null;
      return {
        kind: "godan",
        row,
        tail: `${mora}ます`,
        // 行く系:行きます、持って 行きます、連れて 行きます、うまく いきます(聞きます 等不算)
        // 只有て/た形不規則;可能 行ける、意向 行こう 等照規則
        iku: word === "いきます",
        aru: word === "あります",
        honorific,
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

function godanTail(row: GodanRow, form: StemForm, iku: boolean): string {
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
    case "potential":
      return `${row.e}る`; // 書ける、買える(L27-G01)
    case "volitional":
      return `${row.o}う`; // 書こう、買おう(L31-G01)
    case "imperative":
      return row.e; // 書け、急げ(L33-G01)
    case "prohibitive":
      return `${row.u}な`; // 書くな(L33-G01:辞書形 + な)
    case "conditional":
      return `${row.e}ば`; // 書けば(L35-G01)
    case "passive":
      return `${row.a}れる`; // 書かれる、買われる(L37-G01)
    case "causative":
      return `${row.a}せる`; // 書かせる、買わせる(L48-G01)
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
        return replaceTail(ruby, "きます", KURU_STEM[form] + kuruEnding(form));
      }
      // 来(き)[ます] → 来(こ)[ない]:改寫「来」段讀音與末段語尾
      const head = ruby.slice(0, -2).map((s) => ({ ...s }));
      return [
        ...head,
        { b: "来", r: KURU_STEM[form] },
        { b: kuruEnding(form) },
      ];
    }
    case "godan":
      // -aru 敬語的進階形不規則(命令形 いらっしゃい、ください…):不推導
      if (shape.honorific && isAdvancedVerbForm(form)) return null;
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
  conditional: "ければ", // L35-G01:「い」換成「ければ」(いい → よければ)
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
  conditional: "なら", // L35-G01:去掉「な」加上「なら」
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

/** 依規則推導(不套用進階形的各形排除);回傳基底與輸出,供 conjugate 判斷排除 */
function derive(
  v: ConjugableItem,
  form: ConjForm,
): { base: readonly RubySeg[]; ruby: RubySeg[] } | null {
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
  return ruby === null ? null : { base, ruby };
}

/** 最後一詞之前的詞以「を」結尾(お茶を たてます、世話を します、迷惑を かけます、気を つけます…) */
function hasWoPrefix(base: readonly RubySeg[]): boolean {
  const words = reading(base).split(/\s+/);
  return words.length > 1 && (words[words.length - 2] ?? "").endsWith("を");
}

/**
 * 動詞的進階形是否練習:教材明說或推知沒有此形(TEXTBOOK_NO_FORM)、可能形的「〜を」前綴
 * (L27-G02:可能動詞句的對象一般用「が」,「お茶を たてられる」不照教材)、
 * 語意排除(conjugateExclusions.ts,依 id)皆不練。
 */
function advancedAllowed(
  v: ConjugableItem,
  base: readonly RubySeg[],
  form: AdvancedVerbForm,
): boolean {
  if (TEXTBOOK_NO_FORM.get(lastWordReading(base))?.includes(form)) return false;
  if (form === "potential" && hasWoPrefix(base)) return false;
  return !(FORM_EXCLUSIONS.get(v.id)?.forms.includes(form) ?? false);
}

/**
 * 推導單字的活用形:動詞(動I/II/III 的ます形)與い/な形容詞。
 * 下列情況回傳 null:排除清單中的字、不活用的詞性、該詞性沒有此形(動詞問 adv)、
 * 資料形狀不是規則能確定處理的(非ます形、殘留記號、讀音與 kana 不一致)、
 * 動詞的進階形不練此字(-aru 敬語、教材明說或推知沒有此形、「〜を」前綴的可能形、語意排除)。
 */
export function conjugate(
  v: ConjugableItem,
  form: ConjForm,
): Conjugated | null {
  const d = derive(v, form);
  if (d === null) return null;
  if (
    conjClass(v.pos) === "verb" &&
    isAdvancedVerbForm(form) &&
    !advancedAllowed(v, d.base, form)
  ) {
    return null;
  }
  return { ruby: d.ruby, kana: toKana(d.ruby) };
}

/**
 * 依規則推導的形:同 conjugate,但不套用進階形的各形排除(TEXTBOOK_NO_FORM、「〜を」前綴的可能形、
 * 語意排除);-aru 敬語的進階形與 CONJUGATION_EXCLUDED 仍為 null。活用練習以此過濾錯誤選項:
 * 干擾項不可是該字依規則成立的任何形(即使那一形不練,如 わかれる、降れ)。
 */
export function conjugateByRule(
  v: ConjugableItem,
  form: ConjForm,
): Conjugated | null {
  const d = derive(v, form);
  return d === null ? null : { ruby: d.ruby, kana: toKana(d.ruby) };
}

/**
 * 活用的基底 ruby(教材記號已去除):動詞為ます形、形容詞為辞書形(［な］與替代說法「（よい）」、
 * 並列的第二個寫法皆去除)。不活用的詞性、排除清單中的字與資料形狀不符者回傳 null。
 * 活用練習以此產生錯誤選項與判斷同一個字(drill.ts)。
 */
export function conjugationBase(v: ConjugableItem): RubySeg[] | null {
  if (CONJUGATION_EXCLUDED.has(v.id)) return null;
  const cls = conjClass(v.pos);
  const base = cls === null ? null : baseRuby(v, cls);
  return base === null ? null : base.map((s) => ({ ...s }));
}

/**
 * 能否活用:指定 form 時看該形;未指定時須該詞性的每一個基本形都能推導(練習抽題用;
 * 進階形各有排除,抽題時逐形以 conjugate 判斷)。
 */
export function isConjugable(v: ConjugableItem, form?: ConjForm): boolean {
  if (form !== undefined) return conjugate(v, form) !== null;
  const forms = basicFormsOf(v.pos);
  return forms.length > 0 && forms.every((f) => conjugate(v, f) !== null);
}
