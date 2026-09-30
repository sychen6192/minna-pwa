import {
  ADJ_FORMS,
  GODAN,
  VERB_FORMS,
  conjClass,
  conjugate,
  conjugateByRule,
  conjugationBase,
  formIntro,
  formsOf,
  isAdvancedForm,
  isConjugable,
  type AdjForm,
  type ConjClass,
  type ConjForm,
  type Conjugated,
  type FormIntro,
  type VerbForm,
} from "@/lib/conjugate";
import { isSupplementary } from "@/lib/notes";
import { checkAnswer, normalizeReading } from "@/lib/quiz";
import { UPTO_PARAM } from "@/lib/urlParams";
import type { Lesson, Pos, RubySeg, VocabItem } from "@/schemas/lesson";

/**
 * 活用練習(T11.4、T11.5,F7.3):出題、錯誤選項與判分的純函式。題目由 conjugate.ts 推導,
 * 單次練習、不寫入 SRS/DB。錯誤選項以「常見的規則錯誤」產生(書きて/書って/書んで、買あない、
 * きれいくない、ら抜き 食べれる、さ入れ 書かさせる…),並排除該字任何一個依規則成立的形;
 * 進階形另穿插易混淆的同字其他形(書ける ↔ 書かれる ↔ 書かせる、できる/される/させる),
 * 不足時以同一個字的其他正確形(非本題所問)補足。
 */

/** 練習用單字:教材單字 + 所屬課號 */
export interface DrillItem extends VocabItem {
  lessonId: number;
}

/** 題型:四選一、輸入假名 */
export type DrillType = "mcq" | "input";

/** 形的分組(選形 chips):動詞、形容詞(い/な形容詞各形的導入課次相同,合為一組) */
export type DrillGroup = "verb" | "adj";

/** 各組勾選的形 */
export type DrillSelection = Readonly<Record<DrillGroup, readonly ConjForm[]>>;

type Rng = () => number;

/** 一回合的題數 */
export const DRILL_COUNT = 10;
/** 選擇題的選項數(正解 + 3 個錯誤選項) */
export const OPTION_COUNT = 4;
/** 沒有任何卡片(尚未開始學習)時的預設範圍:第 14 課(て形)起動詞活用才有變化 */
export const DEFAULT_MAX_LESSON = 14;
export const LAST_LESSON = 50;

// ── 形與分組 ─────────────────────────────────────────────────────────

/** 動詞可練的形:題目本身就是ます形,不練 masu */
const VERB_DRILL_FORMS: readonly VerbForm[] = VERB_FORMS.filter(
  (f) => f !== "masu",
);

/** 形的層級(選形 chips 分兩列):基本形、進階形(動詞第 27 課起、形容詞條件形第 35 課) */
export type DrillLevel = "basic" | "advanced";

export const DRILL_LEVELS: readonly { level: DrillLevel; label: string }[] = [
  { level: "basic", label: "基本" },
  { level: "advanced", label: "進階" },
];

/** 形所屬的層級 */
export function formLevel(form: ConjForm): DrillLevel {
  return isAdvancedForm(form) ? "advanced" : "basic";
}

const GROUP_CLASSES: Readonly<Record<DrillGroup, readonly ConjClass[]>> = {
  verb: ["verb"],
  adj: ["iAdj", "naAdj"],
};

/** 選形 chips 的分組與各組的形(教材導入順序) */
export const DRILL_GROUPS: readonly {
  group: DrillGroup;
  label: string;
  forms: readonly ConjForm[];
}[] = [
  { group: "verb", label: "動詞", forms: VERB_DRILL_FORMS },
  { group: "adj", label: "形容詞", forms: ADJ_FORMS },
];

const VERB_LABEL: Readonly<Record<VerbForm, string>> = {
  masu: "ます形",
  masen: "否定(丁寧)",
  mashita: "過去(丁寧)",
  masendeshita: "過去否定(丁寧)",
  te: "て形",
  nai: "ない形",
  dict: "辞書形",
  ta: "た形",
  nakatta: "なかった形",
  potential: "可能形",
  volitional: "意向形",
  imperative: "命令形",
  prohibitive: "禁止形",
  conditional: "條件形(ば)",
  passive: "被動形",
  causative: "使役形",
};

const ADJ_LABEL: Readonly<Record<AdjForm, string>> = {
  negPolite: "否定(丁寧)",
  pastPolite: "過去(丁寧)",
  pastNegPolite: "過去否定(丁寧)",
  te: "て形",
  adv: "連用(〜く/〜に)",
  neg: "否定(普通)",
  past: "過去(普通)",
  pastNeg: "過去否定(普通)",
  conditional: "條件形(〜ければ/〜なら)",
};

/** 單字所屬的組;不活用的詞性回傳 null */
export function groupOf(pos: Pos): DrillGroup | null {
  const cls = conjClass(pos);
  if (cls === null) return null;
  return cls === "verb" ? "verb" : "adj";
}

/** 形的中文名稱(題目與 chips 用);「te」依組別(動詞/形容詞)皆為て形 */
export function formLabel(group: DrillGroup, form: ConjForm): string {
  return group === "verb"
    ? (VERB_LABEL[form as VerbForm] ?? form)
    : (ADJ_LABEL[form as AdjForm] ?? form);
}

/**
 * 可能/被動/使役動詞皆依Ⅱ類活用,教材以ます形與辞書形並列(L27-G01 かけます/かける、L37-G01、
 * L48-G01):本練習一律答辞書形,題目標明「(辞書形)」
 */
const DICT_SHAPE_FORMS: ReadonlySet<ConjForm> = new Set<ConjForm>([
  "potential",
  "passive",
  "causative",
]);

/** 題目要改成的形(形名 + 作答的形狀):可能形(辞書形)、被動形(辞書形)… */
export function formPrompt(group: DrillGroup, form: ConjForm): string {
  const label = formLabel(group, form);
  return group === "verb" && DICT_SHAPE_FORMS.has(form)
    ? `${label}(辞書形)`
    : label;
}

/** 形名含假名(て形、ない形、連用(〜く/〜に))者為日文術語,標 lang="ja";「否定(丁寧)」等為中文說明 */
export function formLabelLang(label: string): "ja" | undefined {
  return /[ぁ-ゖァ-ヺ]/.test(label) ? "ja" : undefined;
}

/** 詞性 → 活用類別的代表詞性(formIntro 以詞性查表) */
const CLASS_POS: Readonly<Record<ConjClass, Pos>> = {
  verb: "動I",
  iAdj: "い形",
  naAdj: "な形",
};

/** 該類別可練的形(依教材導入順序) */
function drillFormsOf(cls: ConjClass): readonly ConjForm[] {
  return cls === "verb" ? VERB_DRILL_FORMS : ADJ_FORMS;
}

/** 某類別的某形在第幾課導入(該類別沒有此形回傳 null) */
function introLesson(cls: ConjClass, form: ConjForm): number | null {
  return formIntro(CLASS_POS[cls], form)?.lesson ?? null;
}

/** 某組的某形在第幾課導入(組內各類別取最早者;い/な形容詞實際相同) */
export function groupFormLesson(group: DrillGroup, form: ConjForm): number {
  const lessons = GROUP_CLASSES[group]
    .map((cls) => introLesson(cls, form))
    .filter((n): n is number => n !== null);
  return lessons.length > 0 ? Math.min(...lessons) : Infinity;
}

/** 範圍(第 1–maxLesson 課)內已導入、可練的形(依教材導入順序) */
export function availableForms(cls: ConjClass, maxLesson: number): ConjForm[] {
  return drillFormsOf(cls).filter(
    (f) => (introLesson(cls, f) ?? Infinity) <= maxLesson,
  );
}

/** 某組在範圍內可練的形 */
export function availableGroupForms(
  group: DrillGroup,
  maxLesson: number,
): ConjForm[] {
  return groupForms(group).filter(
    (f) => groupFormLesson(group, f) <= maxLesson,
  );
}

/** 某組的形(教材導入順序) */
function groupForms(group: DrillGroup): readonly ConjForm[] {
  return DRILL_GROUPS.find((g) => g.group === group)?.forms ?? [];
}

/** 某組某層級的形(選形 chips 的一列) */
export function levelForms(
  group: DrillGroup,
  level: DrillLevel,
): readonly ConjForm[] {
  return groupForms(group).filter((f) => formLevel(f) === level);
}

// ── 範圍與出題池 ─────────────────────────────────────────────────────

/** 網址參數 ?upto=N(課程頁的「活用練習」連結,urlParams.ts);不合法時回傳 null */
export function parseUpto(search: string): number | null {
  const raw = new URLSearchParams(search).get(UPTO_PARAM);
  if (raw === null || !/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return n >= 1 && n <= LAST_LESSON ? n : null;
}

/** ruby 的表面文字 */
function surface(ruby: readonly RubySeg[]): string {
  return ruby.map((s) => s.b).join("");
}

/**
 * 出題池:第 1–maxLesson 課的動詞與形容詞中,每一個基本形都能推導(isConjugable)且不是補充單字者。
 * 進階形各有排除(わかります 無可能形、降ります〔雨が〜〕只練條件形…),抽題時逐(字, 形)判斷
 * (makeDrillRound),不影響同一個字的其他形。
 * 不同課重列的同一個字(気が つきます、安全［な］/安全、目が覚めます/目が 覚めます…)只留最早的一筆
 * (比對時忽略空格)。
 */
export function drillPool(
  lessons: readonly Lesson[],
  maxLesson: number,
): DrillItem[] {
  const seen = new Set<string>();
  const pool: DrillItem[] = [];
  for (const lesson of [...lessons].sort((a, b) => a.id - b.id)) {
    if (lesson.id > maxLesson) continue;
    for (const v of lesson.vocab) {
      if (conjClass(v.pos) === null || isSupplementary(v) || !isConjugable(v))
        continue;
      const base = conjugationBase(v);
      if (base === null) continue;
      const key = `${v.pos}|${surface(base).replace(/\s+/g, "")}|${v.kana.replace(/\s+/g, "")}`;
      if (seen.has(key)) continue;
      seen.add(key);
      pool.push({ ...v, lessonId: lesson.id });
    }
  }
  return pool;
}

/** 課程頁是否給「活用練習」連結:本課有可練的動詞/形容詞,且該類別到本課已導入至少一形 */
export function lessonHasDrill(lesson: Lesson): boolean {
  return drillPool([lesson], lesson.id).some((item) => {
    const cls = conjClass(item.pos);
    return cls !== null && availableForms(cls, lesson.id).length > 0;
  });
}

// ── ruby 操作(錯誤選項用)──────────────────────────────────────────

function reading(ruby: readonly RubySeg[]): string {
  return ruby.map((s) => s.r ?? s.b).join("");
}

/** 讀音去空白(與 conjugate 的 kana 慣例一致) */
function kanaOf(ruby: readonly RubySeg[]): string {
  return reading(ruby).replace(/\s+/g, "");
}

function lastWordReading(ruby: readonly RubySeg[]): string {
  const words = reading(ruby).split(/\s+/);
  return words[words.length - 1] ?? "";
}

/** 末段為假名段且以 from 結尾時,把尾巴換成 to(段落變空則移除);否則 null */
function swapTail(
  ruby: readonly RubySeg[],
  from: string,
  to: string,
): RubySeg[] | null {
  const last = ruby[ruby.length - 1];
  if (last === undefined || last.r !== undefined || !last.b.endsWith(from))
    return null;
  const head = ruby.slice(0, -1).map((s) => ({ ...s }));
  const b = last.b.slice(0, last.b.length - from.length) + to;
  return b === "" ? head : [...head, { b }];
}

/** 在末尾接上假名:末段是假名段則併入,是漢字段則新增一段 */
function appendTail(ruby: readonly RubySeg[], kana: string): RubySeg[] {
  const last = ruby[ruby.length - 1];
  if (last === undefined || last.r !== undefined) {
    return [...ruby.map((s) => ({ ...s })), { b: kana }];
  }
  return [...ruby.slice(0, -1).map((s) => ({ ...s })), { b: last.b + kana }];
}

function toConjugated(ruby: RubySeg[] | null): Conjugated | null {
  return ruby === null ? null : { ruby, kana: kanaOf(ruby) };
}

/** て形語尾的各種寫法(Ⅰ類各行);た形由此改尾(て→た、で→だ) */
const TE_ENDINGS: readonly string[] = ["って", "んで", "いて", "いで", "して"];

function teToTa(tail: string): string {
  return tail.replace(/て$/, "た").replace(/で$/, "だ");
}

// ── 錯誤選項:常見的規則錯誤 ────────────────────────────────────────

/** 動詞錯誤規則所需的形狀(conjugate 已確認可活用,這裡只取錯誤規則要用的部分) */
type VerbKind =
  | { kind: "godan"; mora: string }
  | { kind: "ichidan"; mora: string | null }
  | { kind: "suru" }
  | { kind: "kuru"; kanji: boolean };

function verbKind(base: readonly RubySeg[], pos: Pos): VerbKind | null {
  const last = base[base.length - 1];
  if (last === undefined || last.r !== undefined || !last.b.endsWith("ます"))
    return null;
  const mora = last.b.slice(0, -2).slice(-1);
  switch (pos) {
    case "動I":
      return mora === "" ? null : { kind: "godan", mora };
    case "動II":
      return { kind: "ichidan", mora: mora === "" ? null : mora };
    case "動III":
      if (lastWordReading(base).endsWith("します")) return { kind: "suru" };
      return {
        kind: "kuru",
        kanji: last.b === "ます" && base[base.length - 2]?.b === "来",
      };
    default:
      return null;
  }
}

/** ます系的錯誤:套用名詞句(〜じゃ ありません、〜でした)或普通形的語尾 */
const MASU_WRONG: Readonly<Partial<Record<VerbForm, readonly string[]>>> = {
  masen: ["ますじゃ ありません"],
  mashita: ["ますでした"],
  masendeshita: ["ませんだった", "ますじゃ ありませんでした"],
};

/**
 * する 的錯誤語尾(取代「します」)。進階形另有 できる/される/させる 的互相混淆
 * (CONFUSABLE,同字的正確形);避開方言或文語中成立的寫法(すな、せよ、せば)。
 */
const SURU_WRONG: Readonly<Partial<Record<VerbForm, readonly string[]>>> = {
  te: ["しって", "すって", "すて"],
  ta: ["しった", "すった", "すた"],
  nai: ["すない", "さない", "しらない"],
  nakatta: ["すなかった", "さなかった", "しらなかった"],
  dict: ["しる", "す"],
  potential: ["しれる", "すれる", "しられる"],
  volitional: ["するよう", "すろう", "しろう"],
  imperative: ["すれ", "しれ", "すろ"],
  prohibitive: ["しるな", "しろな"],
  conditional: ["しれば", "するば"],
  passive: ["しられる", "さられる"],
  causative: ["しさせる", "すさせる"],
};

/** 来る 的錯誤:[「来」的讀音, 語尾](こて、きない、きる…) */
const KURU_WRONG: Readonly<
  Partial<Record<VerbForm, readonly [string, string][]>>
> = {
  te: [
    ["こ", "て"],
    ["く", "て"],
    ["き", "って"],
  ],
  ta: [
    ["こ", "た"],
    ["く", "た"],
    ["き", "った"],
  ],
  nai: [
    ["き", "ない"],
    ["く", "ない"],
    ["か", "ない"],
  ],
  nakatta: [
    ["き", "なかった"],
    ["く", "なかった"],
    ["か", "なかった"],
  ],
  dict: [
    ["き", "る"],
    ["こ", "る"],
  ],
  // ら抜き(来れる)
  potential: [
    ["こ", "れる"],
    ["き", "られる"],
    ["く", "られる"],
  ],
  volitional: [
    ["き", "よう"],
    ["く", "よう"],
    ["こ", "ろう"],
  ],
  imperative: [
    ["こ", "ろ"],
    ["き", "ろ"],
    ["く", "れ"],
  ],
  // 禁止形是辞書形 + な:讀音是「く」
  prohibitive: [
    ["こ", "るな"],
    ["き", "るな"],
    ["こ", "な"],
  ],
  conditional: [
    ["こ", "れば"],
    ["き", "れば"],
    ["く", "るば"],
  ],
  passive: [
    ["き", "られる"],
    ["く", "られる"],
    ["こ", "れる"],
  ],
  causative: [
    ["き", "させる"],
    ["く", "させる"],
    ["こ", "せる"],
  ],
};

/**
 * 去掉ます形最後一音 + ます、換成 tail(書き|ます → 書 + いて)。該詞只有這一音 + ます(います)時
 * 沒有語幹可留(只剩「って」「う」),不出這類錯誤:回傳 null。
 */
function cutMora(
  base: readonly RubySeg[],
  mora: string,
  tail: string,
): RubySeg[] | null {
  if (lastWordReading(base) === `${mora}ます`) return null;
  return swapTail(base, `${mora}ます`, tail);
}

/**
 * 本身即使役義的他動詞(見る → 見せる、着る → 着せる、浴びる → 浴びせる、似る → 似せる、
 * 寝る → 寝せる):Ⅱ類使役「少了さ」的錯誤(食べせる)撞到這些字時不當錯誤選項,以免學習者
 * 以為「見せる」是錯字(使役形仍只接受 見させる,L48-G01)
 */
const LEXICAL_CAUSATIVES: ReadonlySet<string> = new Set([
  "みせる",
  "きせる",
  "あびせる",
  "にせる",
  "ねせる",
]);

/** 動詞錯誤候選(依可能性排序,尚未過濾正確形) */
function verbWrongCandidates(
  v: DrillItem,
  base: readonly RubySeg[],
  form: VerbForm,
): (RubySeg[] | null)[] {
  /** ます形語幹 + 語尾(書き + て) */
  const stem = (tail: string) => swapTail(base, "ます", tail);
  const masuWrong = MASU_WRONG[form];
  if (masuWrong) return masuWrong.map(stem);

  const kind = verbKind(base, v.pos);
  if (kind === null) return [];
  switch (kind.kind) {
    case "godan": {
      const { mora } = kind;
      const row = GODAN.get(mora);
      if (row === undefined) return [];
      /** 去掉最後一音 + 語尾(書 + いて) */
      const cut = (tail: string) => cutMora(base, mora, tail);
      const dict = conjugate(v, "dict")?.ruby;
      const dictPlus = (tail: string) => (dict ? appendTail(dict, tail) : null);
      // い段 → あ段 的「い → あ/や」(買あない、買やない):買います 系最常見的錯誤
      const iRow = (tail: string) =>
        mora === "い" ? [cut(`あ${tail}`), cut(`や${tail}`)] : [];
      switch (form) {
        case "te":
          // 當成Ⅱ類(書きて)、其他行的語尾(書って/書んで);行く系與 -aru 敬語 的一般規則也在其中
          return [stem("て"), ...TE_ENDINGS.map(cut)];
        case "ta":
          return [stem("た"), ...TE_ENDINGS.map((t) => cut(teToTa(t)))];
        case "nai":
        case "nakatta": {
          const tail = form === "nai" ? "ない" : "なかった";
          // 一般規則在前:只對例外(ある → ない、いらっしゃる → いらっしゃらない)才是錯誤
          const [ia, ya] = iRow(tail);
          return [
            cut(row.a + tail),
            ia ?? null,
            stem(tail),
            ya ?? null,
            dictPlus(tail),
          ];
        }
        case "dict":
          return [cut(row.u), stem("る"), cut("る")];
        case "potential":
          // 多加「れ」(書けれる)、當成Ⅱ類(書きられる)、あ段 + られる(書かられる)
          return [cut(`${row.e}れる`), stem("られる"), cut(`${row.a}られる`)];
        case "volitional":
          // 辞書形 + よう(書くよう)、當成Ⅱ類(書きよう)、お段 + よう(書こよう)
          return [dictPlus("よう"), stem("よう"), cut(`${row.o}よう`)];
        case "imperative":
          // 當成Ⅱ類(書きろ)、え段 + ろ(書けろ)、辞書形 + ろ(書くろ)
          return [stem("ろ"), cut(`${row.e}ろ`), dictPlus("ろ")];
        case "prohibitive":
          // 命令形 + な(書けな)、あ段 + な(書かな)、當成Ⅱ類(書きるな);
          // ない形 + な、ます形語幹 + な(書きな = 書きなさい)在口語中成立,不列
          return [cut(`${row.e}な`), cut(`${row.a}な`), stem("るな")];
        case "conditional":
          // 當成Ⅱ類(書きれば)、辞書形 + れば/ば(書くれば、書くば)
          return [stem("れば"), dictPlus("れば"), dictPlus("ば")];
        case "passive": {
          // あ段 + られる(書かられる)、い → あ/や(買あれる、買やれる)、當成Ⅱ類(書きられる)
          const [ia, ya] = iRow("れる");
          return [
            cut(`${row.a}られる`),
            ia ?? null,
            stem("られる"),
            ya ?? null,
          ];
        }
        case "causative": {
          // さ入れ(書かさせる)、い → あ/や(買あせる、買やせる)、當成Ⅱ類(書きさせる)
          const [ia, ya] = iRow("せる");
          return [
            cut(`${row.a}させる`),
            ia ?? null,
            stem("させる"),
            ya ?? null,
          ];
        }
        default:
          return [];
      }
    }
    case "ichidan": {
      // 當成Ⅰ類:ます形最後一音在假名段且屬い段時套該行(起いて、起かない、起く),
      // 否則(及 います 這種去掉一音就沒有語幹者)當成「る」結尾的Ⅰ類(食べって、食べらない、いらない)
      const row = kind.mora === null ? undefined : GODAN.get(kind.mora);
      const cut = (tail: string) =>
        kind.mora === null ? null : cutMora(base, kind.mora, tail);
      switch (form) {
        case "te":
          return [row ? cut(row.te) : null, stem("って"), stem("んで")];
        case "ta":
          return [row ? cut(row.ta) : null, stem("った"), stem("んだ")];
        case "nai":
          return [
            row ? cut(`${row.a}ない`) : null,
            stem("らない"),
            stem("るない"),
          ];
        case "nakatta":
          return [
            row ? cut(`${row.a}なかった`) : null,
            stem("らなかった"),
            stem("るなかった"),
          ];
        case "dict":
          return [row ? cut(row.u) : null];
        case "potential":
          // ら抜き(食べれる;教材為 られる,L27-G01)、當成Ⅰ類(起ける)
          return [stem("れる"), row ? cut(`${row.e}る`) : null];
        case "volitional":
          // 當成「る」結尾的Ⅰ類(食べろう)、辞書形 + よう(食べるよう)、當成Ⅰ類(起こう)
          return [stem("ろう"), stem("るよう"), row ? cut(`${row.o}う`) : null];
        case "imperative":
          // 當成「る」結尾的Ⅰ類(食べれ)、當成Ⅰ類(起け);文語的「食べよ」成立,不列
          return [stem("れ"), row ? cut(row.e) : null];
        case "prohibitive":
          // 命令形 + な(食べろな、食べれな)、當成Ⅰ類(起くな)
          return [stem("ろな"), stem("れな"), row ? cut(`${row.u}な`) : null];
        case "conditional":
          // 辞書形 + ば(食べるば)、語幹 + ば(食べば)、當成Ⅰ類(起けば)
          return [stem("るば"), stem("ば"), row ? cut(`${row.e}ば`) : null];
        case "passive":
          // ら抜き(食べれる)、當成Ⅰ類(起かれる)
          return [stem("れる"), row ? cut(`${row.a}れる`) : null];
        case "causative": {
          // 少了「さ」(食べせる)、當成「る」結尾的Ⅰ類(食べらせる)、當成Ⅰ類(起かせる);
          // 「少了さ」恰為使役義他動詞者(見せる、着せる)不列
          const short = stem("せる");
          return [
            short && LEXICAL_CAUSATIVES.has(lastWordReading(short))
              ? null
              : short,
            stem("らせる"),
            row ? cut(`${row.a}せる`) : null,
          ];
        }
        default:
          return [];
      }
    }
    case "suru":
      return (SURU_WRONG[form] ?? []).map((tail) =>
        swapTail(base, "します", tail),
      );
    case "kuru":
      return (KURU_WRONG[form] ?? []).map(([r, tail]) =>
        kind.kanji
          ? [
              ...base.slice(0, -2).map((s) => ({ ...s })),
              { b: "来", r },
              { b: tail },
            ]
          : swapTail(base, "きます", r + tail),
      );
  }
}

/**
 * い形容詞的錯誤:[去掉「い」接的語尾(第一項是一般規則,只對 いい 是錯誤:いくない), ...]
 * 與 [保留「い」接的語尾(高いでした、高いくない、な形容詞的規則 高いじゃ ない)]。
 */
const I_ADJ_WRONG: Readonly<
  Record<AdjForm, { cut: readonly string[]; keep: readonly string[] }>
> = {
  negPolite: {
    cut: ["くないです"],
    keep: ["じゃ ありません", "くないです", "ないです"],
  },
  pastPolite: {
    cut: ["かったです", "かったでした"],
    keep: ["でした", "かったです"],
  },
  pastNegPolite: {
    cut: ["くなかったです", "くないでした"],
    keep: ["じゃ ありませんでした", "くなかったです"],
  },
  te: { cut: ["くて", "くで"], keep: ["で", "くて"] },
  adv: { cut: ["く"], keep: ["に", "く"] },
  neg: { cut: ["くない"], keep: ["くない", "じゃ ない"] },
  past: { cut: ["かった"], keep: ["だった", "かった"] },
  pastNeg: {
    cut: ["くなかった", "くないだった"],
    keep: ["くなかった", "じゃ なかった"],
  },
  // 高いければ、高いれば、高くれば、高かれば(いい:いければ);「高いなら」成立,不列
  conditional: {
    cut: ["ければ", "くれば", "かれば"],
    keep: ["ければ", "れば"],
  },
};

/** な形容詞的錯誤:套い形容詞的規則(きれいくない)、留著「な」(きれいなでした)、混用(きれいじゃくない) */
const NA_ADJ_WRONG: Readonly<Record<AdjForm, readonly string[]>> = {
  negPolite: ["くないです", "なじゃ ありません", "ないです"],
  pastPolite: ["かったです", "なでした"],
  pastNegPolite: [
    "くなかったです",
    "じゃ ないでした",
    "なじゃ ありませんでした",
  ],
  te: ["くて", "なで", "て"],
  adv: ["く", "なに"],
  neg: ["くない", "じゃくない", "なじゃ ない"],
  past: ["かった", "なだった"],
  pastNeg: ["くなかった", "じゃくなかった", "なじゃ なかった"],
  // 留著「な」(静かななら)、套い形容詞的規則(静かければ)、静かれば;「静かならば」成立,不列
  conditional: ["ななら", "ければ", "れば"],
};

function adjWrongCandidates(
  cls: "iAdj" | "naAdj",
  base: readonly RubySeg[],
  form: AdjForm,
): (RubySeg[] | null)[] {
  if (cls === "naAdj")
    return NA_ADJ_WRONG[form].map((tail) => appendTail(base, tail));
  const { cut, keep } = I_ADJ_WRONG[form];
  const [first, ...rest] = cut;
  return [
    ...(first === undefined ? [] : [swapTail(base, "い", first)]),
    // 保留「い」的錯誤在前(高いでした 等最常見),其餘去「い」的變形在後
    ...keep.map((tail) => appendTail(base, tail)),
    ...rest.map((tail) => swapTail(base, "い", tail)),
  ];
}

/** な形容詞否定語尾的「じゃ」可寫成「では」(L08-G02、L12-G01) */
const JA_NEG_RE = /じゃ(?=\s?(?:ない|なかった|ありません|ありませんでした)$)/;

/** 本題可接受的正解:推導結果;な形容詞的否定另接受「では」 */
function acceptedConjugations(v: DrillItem, answer: Conjugated): Conjugated[] {
  if (conjClass(v.pos) !== "naAdj") return [answer];
  const last = answer.ruby[answer.ruby.length - 1];
  if (last === undefined || last.r !== undefined || !JA_NEG_RE.test(last.b))
    return [answer];
  const ruby = [
    ...answer.ruby.slice(0, -1).map((s) => ({ ...s })),
    { b: last.b.replace(JA_NEG_RE, "では") },
  ];
  return [answer, { ruby, kana: kanaOf(ruby) }];
}

/**
 * 同一個字的各形(含題目的基底)。byRule = true 時含進階形中依規則成立、但不練的形
 * (わかれる、降れ…:conjugateByRule),錯誤選項以此排除;false 時只含練習的形,補足選項用。
 */
function validForms(
  v: DrillItem,
  byRule = false,
): Map<ConjForm | "base", Conjugated> {
  const out = new Map<ConjForm | "base", Conjugated>();
  const base = conjugationBase(v);
  if (base) out.set("base", { ruby: base, kana: kanaOf(base) });
  for (const f of formsOf(v.pos)) {
    const c = byRule ? conjugateByRule(v, f) : conjugate(v, f);
    if (c) out.set(f, c);
  }
  return out;
}

/** 同一個字所有正確寫法的正規化讀音(含な形容詞否定的「では」) */
function validKeys(
  v: DrillItem,
  forms: Map<ConjForm | "base", Conjugated>,
): Set<string> {
  const keys = new Set<string>();
  for (const c of forms.values()) {
    for (const a of acceptedConjugations(v, c))
      keys.add(normalizeReading(a.kana));
  }
  return keys;
}

/**
 * 錯誤選項:以常見的規則錯誤推導(依可能性排序),排除等於該字任何一個依規則成立的形(含進階形中
 * 不練的形、「では」寫法、題目基底)者,以正規化讀音去重。
 * - 動詞:當成別類(書きて、食べらない、きない)、別行的語尾(書って/書んで)、い段的誤變(買あない/
 *   買やない)、辞書形 + ない(書くない)、例外照一般規則(行いて、あらない)、する(すない、しる)
 * - 進階形:ら抜き(食べれる、来れる)、多加「れ」(書けれる)、さ入れ(書かさせる)、辞書形 + よう
 *   (書くよう)、當成別類(書きられる、食べろう)、来る 的讀音(来(き)よう、来(こ)るな)
 * - 形容詞:保留「い」(高いでした、高いくない)、套用另一類的規則(高いじゃ ない、きれいくない)、
 *   混用(きれいじゃくない)、いい 照一般規則(いくない)
 * 不活用或無法推導時回傳空陣列。
 */
export function wrongConjugations(
  item: DrillItem,
  form: ConjForm,
): Conjugated[] {
  const cls = conjClass(item.pos);
  const base = conjugationBase(item);
  if (cls === null || base === null || conjugate(item, form) === null)
    return [];
  const candidates =
    cls === "verb"
      ? verbWrongCandidates(item, base, form as VerbForm)
      : adjWrongCandidates(cls, base, form as AdjForm);
  const taken = validKeys(item, validForms(item, true));
  const out: Conjugated[] = [];
  for (const ruby of candidates) {
    const c = toConjugated(ruby);
    if (c === null) continue;
    const key = normalizeReading(c.kana);
    if (key === "" || taken.has(key)) continue;
    taken.add(key);
    out.push(c);
  }
  return out;
}

/** 錯誤選項不足時,補同一個字的其他正確形:優先與本題相近的形(て ↔ た、否定 ↔ 過去否定…) */
const PAD_ORDER: Readonly<Record<ConjForm, readonly (ConjForm | "base")[]>> = {
  masu: ["masen", "mashita", "masendeshita"],
  masen: ["masendeshita", "mashita", "masu", "nai"],
  mashita: ["masendeshita", "masen", "masu", "ta"],
  masendeshita: ["masen", "mashita", "masu", "nakatta"],
  te: ["ta", "dict", "nai", "masu", "adv", "neg", "past"],
  ta: ["te", "nakatta", "dict", "mashita"],
  nai: ["nakatta", "masen", "dict", "te"],
  nakatta: ["nai", "ta", "masendeshita", "dict"],
  dict: ["ta", "te", "nai", "masu"],
  potential: [
    "passive",
    "causative",
    "dict",
    "conditional",
    "volitional",
    "nai",
  ],
  volitional: ["imperative", "dict", "potential", "conditional", "te"],
  imperative: ["prohibitive", "volitional", "dict", "potential", "te"],
  prohibitive: ["imperative", "dict", "nai", "volitional"],
  // 動詞與形容詞共用(形容詞:高くない、高かった、高く)
  conditional: [
    "potential",
    "imperative",
    "dict",
    "ta",
    "neg",
    "past",
    "adv",
    "base",
  ],
  passive: ["causative", "potential", "dict", "nai"],
  causative: ["passive", "potential", "dict", "nai"],
  negPolite: ["pastNegPolite", "pastPolite", "neg", "base"],
  pastPolite: ["pastNegPolite", "negPolite", "past", "base"],
  pastNegPolite: ["negPolite", "pastPolite", "pastNeg", "base"],
  adv: ["te", "neg", "base", "past"],
  neg: ["pastNeg", "past", "negPolite", "base"],
  past: ["pastNeg", "neg", "pastPolite", "base"],
  pastNeg: ["neg", "past", "pastNegPolite", "base"],
};

/**
 * 進階形易混淆的同字其他形(範圍內已教過者):與錯誤規則交錯排入選項。可能 ↔ 被動 ↔ 使役
 * (書ける/書かれる/書かせる;する:できる/される/させる)、命令 ↔ 禁止(書け/書くな)。
 * Ⅱ類與来る 的可能形 = 被動形(食べられる、来られる),與正解相同者自然略過。
 */
const CONFUSABLE: Readonly<Partial<Record<ConjForm, readonly ConjForm[]>>> = {
  potential: ["passive", "causative"],
  passive: ["causative", "potential"],
  causative: ["passive", "potential"],
  imperative: ["prohibitive"],
  prohibitive: ["imperative"],
};

/** 交錯合併:a0, b0, a1, b1…(一方用完後接另一方剩下的) */
function interleave<T>(a: readonly T[], b: readonly T[]): T[] {
  const out: T[] = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (i < a.length) out.push(a[i]);
    if (i < b.length) out.push(b[i]);
  }
  return out;
}

// ── 題目 ────────────────────────────────────────────────────────────

export interface DrillOption {
  /** 選項鍵(正規化讀音,題內唯一) */
  id: string;
  ruby: RubySeg[];
  kana: string;
  correct: boolean;
}

export interface DrillQuestion {
  item: DrillItem;
  group: DrillGroup;
  form: ConjForm;
  type: DrillType;
  /** 正解(推導結果) */
  answer: Conjugated;
  /** 可接受的寫法(正解 + な形容詞否定的「では」) */
  accepted: Conjugated[];
  /** 選擇題選項(輸入題為空陣列) */
  options: DrillOption[];
  /**
   * 選項(輸入題:正解與錯誤規則)有表面文字相同、只差讀音者(来る:来ない きない/こない):
   * 選項、正解與作答一律顯示讀音,不照 furigana 設定隱藏
   */
  forceReading: boolean;
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

/** 去空格的表面文字有重複(只差在讀音) */
function hasSameSurface(list: readonly Conjugated[]): boolean {
  const surfaces = new Set(
    list.map((c) => surface(c.ruby).replace(/\s+/g, "")),
  );
  return surfaces.size < list.length;
}

/**
 * 能否出輸入題:答案至少 2 個假名,且不是「題目基底 + 一個假名」這種一看就能猜的
 * (きれい → きれいで/きれいに)。
 */
export function canInputDrill(item: DrillItem, answer: Conjugated): boolean {
  const key = normalizeReading(answer.kana);
  const base = conjugationBase(item);
  const baseKey = base === null ? "" : normalizeReading(kanaOf(base));
  if (key.length < 2) return false;
  return !(
    baseKey !== "" &&
    key.startsWith(baseKey) &&
    key.length - baseKey.length <= 1
  );
}

/**
 * 出一題:選擇題的錯誤選項取 wrongConjugations(進階形與 CONFUSABLE 的同字其他形交錯)的前 3 個,
 * 不足時以 PAD_ORDER 補同一個字的其他正確形(與正解及本題可接受的寫法皆不同;先取範圍第
 * 1–maxLesson 課已教過的形,仍不足才用之後才教的形);選項順序以 rng 打亂。無法推導時回傳 null。
 */
export function makeDrillQuestion(
  item: DrillItem,
  form: ConjForm,
  type: DrillType,
  rng: Rng = Math.random,
  maxLesson: number = LAST_LESSON,
): DrillQuestion | null {
  const cls = conjClass(item.pos);
  const group = groupOf(item.pos);
  const answer = conjugate(item, form);
  if (cls === null || group === null || answer === null) return null;
  const accepted = acceptedConjugations(item, answer);
  const wrong = wrongConjugations(item, form);
  const question = { item, group, form, type, answer, accepted };
  if (type === "input") {
    return {
      ...question,
      options: [],
      forceReading: hasSameSurface([answer, ...wrong]),
    };
  }

  const want = OPTION_COUNT - 1;
  const distractors: Conjugated[] = [];
  const used = new Set<string>(accepted.map((a) => normalizeReading(a.kana)));
  const add = (c: Conjugated | undefined) => {
    if (c === undefined || distractors.length >= want) return;
    const key = normalizeReading(c.kana);
    if (used.has(key)) return;
    used.add(key);
    distractors.push(c);
  };
  const valid = validForms(item);
  const taught = (f: ConjForm | "base") =>
    f === "base" || (introLesson(cls, f) ?? Infinity) <= maxLesson;
  const confusions = (CONFUSABLE[form] ?? [])
    .filter(taught)
    .map((f) => valid.get(f))
    .filter((c): c is Conjugated => c !== undefined);
  for (const c of interleave(wrong, confusions)) add(c);

  const order = [
    ...PAD_ORDER[form],
    ...[...valid.keys()].filter((f) => !PAD_ORDER[form].includes(f)),
  ];
  const padOrder = [
    ...order.filter(taught),
    ...order.filter((f) => !taught(f)),
  ];
  for (const f of padOrder) add(valid.get(f));

  const options: DrillOption[] = shuffle(
    [
      { id: normalizeReading(answer.kana), ...answer, correct: true },
      ...distractors.map((d) => ({
        id: normalizeReading(d.kana),
        ...d,
        correct: false,
      })),
    ],
    rng,
  );
  return { ...question, options, forceReading: hasSameSurface(options) };
}

/** 羅馬字的「dewa」「de wa」(では 的發音寫法;IME 打 deha) */
const DEWA_RE = /de\s*wa/gi;

/**
 * 輸入題判分:沿用 quiz.ts 的正規化(羅馬字、平/片假名、空白);な形容詞否定「じゃ/では」皆可,
 * 「では」以羅馬字照發音打成 dewa / de wa 亦可(wanakana 會轉成 でわ)。
 */
export function checkDrillAnswer(
  input: string,
  q: Pick<DrillQuestion, "accepted">,
): boolean {
  const inputs = [input];
  const deha = input.replace(DEWA_RE, "deha");
  if (q.accepted.length > 1 && deha !== input) inputs.push(deha);
  return inputs.some((text) => q.accepted.some((a) => checkAnswer(text, a)));
}

/**
 * 單字在勾選中可練的形(依其組別):逐形判斷能否推導,進階形各自排除的字
 * (わかります 的可能形、降ります〔雨が〜〕的命令形…)只少那一形,其他形照常出題
 */
function selectedFormsFor(
  item: DrillItem,
  selection: DrillSelection,
): ConjForm[] {
  const cls = conjClass(item.pos);
  const group = groupOf(item.pos);
  if (cls === null || group === null) return [];
  const own = drillFormsOf(cls);
  return selection[group].filter(
    (f) => own.includes(f) && conjugate(item, f) !== null,
  );
}

/**
 * 各組在勾選中實際能出題的字數(設定畫面顯示):至少有一個勾選的形能推導者
 * (只勾可能形時不算 わかります;該組沒勾任何形為 0)
 */
export function drillableCounts(
  pool: readonly DrillItem[],
  selection: DrillSelection,
): Record<DrillGroup, number> {
  const out: Record<DrillGroup, number> = { verb: 0, adj: 0 };
  for (const item of pool) {
    const cls = conjClass(item.pos);
    const group = groupOf(item.pos);
    if (cls === null || group === null) continue;
    const own = drillFormsOf(cls);
    // 找到一個能推導的形即可(同 selectedFormsFor 的判斷)
    const drillable = selection[group].some(
      (f) => own.includes(f) && conjugate(item, f) !== null,
    );
    if (drillable) out[group]++;
  }
  return out;
}

/**
 * 一回合實際的題數(設定畫面的開始鈕):每個 (字, 形) 至多出一題,勾選中能推導的組數不足
 * `count` 時為全部(同 makeDrillRound)
 */
export function drillRoundSize(
  pool: readonly DrillItem[],
  selection: DrillSelection,
  count: number = DRILL_COUNT,
): number {
  let pairs = 0;
  for (const item of pool) {
    pairs += selectedFormsFor(item, selection).length;
    if (pairs >= count) return count;
  }
  return pairs;
}

export interface MakeDrillRoundOptions {
  count?: number;
  rng?: Rng;
  /** 範圍的最後一課:選擇題補足的形只用範圍內已教過者(makeDrillQuestion) */
  maxLesson?: number;
}

/**
 * 出一回合:從出題池抽字(先不重複;字不夠時同一個字換別的形),每題的形取勾選中該字能推導、
 * 目前出現最少者(平手以 rng 選;進階形不練的字只少那一形);題型選擇題與輸入題交替,
 * 不適合輸入者(canInputDrill)改出選擇題。
 */
export function makeDrillRound(
  pool: readonly DrillItem[],
  selection: DrillSelection,
  {
    count = DRILL_COUNT,
    rng = Math.random,
    maxLesson = LAST_LESSON,
  }: MakeDrillRoundOptions = {},
): DrillQuestion[] {
  const candidates = shuffle(
    pool
      .map((item) => ({ item, forms: selectedFormsFor(item, selection) }))
      .filter((c) => c.forms.length > 0),
    rng,
  );
  if (candidates.length === 0) return [];

  const usage = new Map<string, number>();
  const usedPairs = new Set<string>();
  const questions: DrillQuestion[] = [];
  const maxRounds = Math.max(...candidates.map((c) => c.forms.length));
  for (
    let i = 0;
    questions.length < count && i < candidates.length * maxRounds;
    i++
  ) {
    const { item, forms } = candidates[i % candidates.length];
    const group = groupOf(item.pos);
    const open = forms.filter((f) => !usedPairs.has(`${item.id}:${f}`));
    if (group === null || open.length === 0) continue;
    const uses = (f: ConjForm) => usage.get(`${group}:${f}`) ?? 0;
    const least = Math.min(...open.map(uses));
    const choices = open.filter((f) => uses(f) === least);
    const form = choices[Math.floor(rng() * choices.length)];
    usedPairs.add(`${item.id}:${form}`);

    const answer = conjugate(item, form);
    if (answer === null) continue;
    const wantInput = questions.length % 2 === 1;
    const type: DrillType =
      wantInput && canInputDrill(item, answer) ? "input" : "mcq";
    const q = makeDrillQuestion(item, form, type, rng, maxLesson);
    if (q === null) continue;
    usage.set(`${group}:${form}`, least + 1);
    questions.push(q);
  }
  return questions;
}

// ── 文法連結 ─────────────────────────────────────────────────────────

/**
 * 普通形(L20-G01)的解說沒有寫活用規則:另附規則所在的文法點
 * (なかった ← ない形 L17-G01;形容詞普通形 ← 丁寧體 L08-G02、L12)。
 */
const RULE_SOURCE: Readonly<Partial<Record<ConjForm, ConjForm>>> = {
  nakatta: "nai",
  neg: "negPolite",
  past: "pastPolite",
  pastNeg: "pastNegPolite",
};

/** 答題後「看文法」的連結:該形的導入文法點,普通形另附規則所在的文法點(去重) */
export function grammarLinks(pos: Pos, form: ConjForm): FormIntro[] {
  const primary = formIntro(pos, form);
  if (primary === null) return [];
  const source = RULE_SOURCE[form];
  const extra = source === undefined ? null : formIntro(pos, source);
  return extra === null || extra.grammarId === primary.grammarId
    ? [primary]
    : [primary, extra];
}

/** 文法點在課程頁的網址(文型分頁並捲動,lessonHash.ts) */
export function grammarHref(intro: FormIntro): string {
  return `/lessons/${intro.lesson}#${intro.grammarId}`;
}
