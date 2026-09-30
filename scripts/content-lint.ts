/**
 * content-lint(DQ-07):Zod 之外的內容資料規則。
 *
 * 純函式:不讀檔、無副作用。`scripts/validate-content.ts`(pnpm validate:content)
 * 與 `scripts/content-lint.data.test.ts`(pnpm verify,對真實資料)共用。
 *
 * - error:違反即失敗(validate:content exit 1、資料測試失敗),沒有例外清單:命中時修正
 *   資料(不需 PDF 者加進 scripts/fix-content.ts)或規則,不得豁免。T12.1 的待修清單
 *   (PENDING_FIXES)已於 T12.4 修完最後的会話標題行後移除。
 * - warning:需人工判斷(多半要對照 PDF),只列出、永不影響結束碼。
 */
import type { Lesson, LessonIndex, RubySeg } from "../src/schemas/lesson";

export type Severity = "error" | "warning";

export interface LintIssue {
  /** 內容 id(L01-V001、L01-S01、L01-D01)或課(L01)/檔名 */
  id: string;
  message: string;
}

export interface LintContext {
  lessons: readonly Lesson[];
  /** 與 lessons 逐一對應的檔名(L01.json…) */
  files: readonly string[];
  index: LessonIndex;
  /** Big5 標準字集(不含 HKSCS);由 big5Charset() 建立,經 ctx 注入以便測試 */
  big5: ReadonlySet<string>;
}

export interface LintRule {
  id: string;
  severity: Severity;
  description: string;
  check: (ctx: LintContext) => LintIssue[];
}

// ---------- 共用 ----------

const pad = (n: number, width: number) => String(n).padStart(width, "0");
const lessonTag = (id: number) => `L${pad(id, 2)}`;
const surfaceOf = (ruby: readonly RubySeg[]) => ruby.map((s) => s.b).join("");
const readingOf = (ruby: readonly RubySeg[]) =>
  ruby.map((s) => s.r ?? s.b).join("");
const codePoint = (ch: string) =>
  `U+${(ch.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, "0")}`;

const HAN_RE = /\p{Script=Han}/u;
const DIGIT_RE = /[0-9０-９]/;

interface RubyItem {
  id: string;
  ruby: RubySeg[];
}
interface Line extends RubyItem {
  translation: string;
  speaker?: string;
}

const examplesOf = (l: Lesson): Line[] => l.grammar.flatMap((g) => g.examples);
/** 会話標題沒有 id:以「L15:dialogueTitle」回報 */
const dialogueTitleId = (l: Lesson) => `${lessonTag(l.id)}:dialogueTitle`;
/** 帶中譯的句子:文法例句、会話標題(有標題的課才有)、会話 */
const sentencesOf = (l: Lesson): Line[] => [
  ...examplesOf(l),
  ...(l.dialogueTitle ? [{ id: dialogueTitleId(l), ...l.dialogueTitle }] : []),
  ...l.dialogues,
];
/** 所有帶 ruby 的項目:單字、文法例句、会話標題、会話 */
const rubyItemsOf = (l: Lesson): RubyItem[] => [...l.vocab, ...sentencesOf(l)];

/** ja = 日文;zh = 中文(釋義、解說、中譯);mixed = 中日混寫(note、文型) */
export type FieldLang = "ja" | "zh" | "mixed";
export interface TextField {
  id: string;
  field: string;
  lang: FieldLang;
  text: string;
}

/** 課程檔的全部字串欄位;ruby 以串接後的表面(surface)代表 */
export function textFields(l: Lesson): TextField[] {
  const out: TextField[] = [
    { id: lessonTag(l.id), field: "title", lang: "ja", text: l.title },
  ];
  const push = (id: string, field: string, lang: FieldLang, text?: string) => {
    if (text !== undefined) out.push({ id, field, lang, text });
  };
  for (const v of l.vocab) {
    push(v.id, "surface", "ja", surfaceOf(v.ruby));
    push(v.id, "kana", "ja", v.kana);
    push(v.id, "meaning", "zh", v.meaning);
    push(v.id, "note", "mixed", v.note);
  }
  for (const g of l.grammar) {
    push(g.id, "pattern", "mixed", g.pattern);
    push(g.id, "explanation", "zh", g.explanation);
  }
  for (const s of sentencesOf(l)) {
    push(s.id, "surface", "ja", surfaceOf(s.ruby));
    push(s.id, "translation", "zh", s.translation);
    push(s.id, "speaker", "ja", s.speaker);
  }
  return out;
}

const eachLesson =
  (fn: (l: Lesson, ctx: LintContext) => LintIssue[]) =>
  (ctx: LintContext): LintIssue[] =>
    ctx.lessons.flatMap((l) => fn(l, ctx));

/** 逐一檢查 ruby 段(單字、例句、会話標題、会話) */
const eachSegment =
  (fn: (s: RubySeg) => string | null) =>
  (ctx: LintContext): LintIssue[] =>
    ctx.lessons.flatMap((l) =>
      rubyItemsOf(l).flatMap((it) =>
        it.ruby.flatMap((s) => {
          const message = fn(s);
          return message === null ? [] : [{ id: it.id, message }];
        }),
      ),
    );

const segText = (s: RubySeg) =>
  s.r === undefined ? `「${s.b}」` : `「${s.b}」r=${s.r}`;

// ---------- error:課與 id ----------

const LESSON_COUNT = 50;

const ID_RE = {
  V: /^L(\d{2})-V\d{3}$/,
  G: /^L(\d{2})-G\d{2}$/,
  S: /^L(\d{2})-S\d{2}$/,
  D: /^L(\d{2})-D\d{2}$/,
} as const;
type IdKind = keyof typeof ID_RE;

function idsOf(l: Lesson): [IdKind, string][] {
  return [
    ...l.vocab.map((v): [IdKind, string] => ["V", v.id]),
    ...l.grammar.map((g): [IdKind, string] => ["G", g.id]),
    ...examplesOf(l).map((s): [IdKind, string] => ["S", s.id]),
    ...l.dialogues.map((d): [IdKind, string] => ["D", d.id]),
  ];
}

const idRules: LintRule[] = [
  {
    id: "lesson-set",
    severity: "error",
    description: `課號恰為 1–${LESSON_COUNT} 且依序;檔名 = L{課號}.json`,
    check: ({ lessons, files }) => {
      const out: LintIssue[] = [];
      if (lessons.length !== LESSON_COUNT) {
        out.push({
          id: "lessons",
          message: `共 ${lessons.length} 課(應為 ${LESSON_COUNT})`,
        });
      }
      if (files.length !== lessons.length) {
        out.push({
          id: "files",
          message: `檔名 ${files.length} 個 ≠ 課程 ${lessons.length} 課`,
        });
      }
      lessons.forEach((l, i) => {
        if (l.id !== i + 1) {
          out.push({
            id: lessonTag(l.id),
            message: `第 ${i + 1} 個課程檔的課號為 ${l.id}`,
          });
        }
        const file = files[i];
        if (file !== undefined && file !== `${lessonTag(l.id)}.json`) {
          out.push({ id: file, message: `檔名與課號 ${l.id} 不符` });
        }
      });
      return out;
    },
  },
  {
    id: "index-match",
    severity: "error",
    description:
      "index.json 依課號排列,title / vocabCount / grammarCount = 課程檔",
    check: ({ lessons, index }) =>
      index.lessons.flatMap((e, i): LintIssue[] => {
        const id = `index:${lessonTag(e.id)}`;
        const out: LintIssue[] = [];
        if (e.id !== i + 1)
          out.push({ id, message: `第 ${i + 1} 筆的課號為 ${e.id}` });
        const l = lessons.find((x) => x.id === e.id);
        if (!l) return [...out, { id, message: "找不到對應的課程檔" }];
        if (e.title !== l.title) {
          out.push({
            id,
            message: `title「${e.title}」≠ 課程檔「${l.title}」`,
          });
        }
        if (e.vocabCount !== l.vocab.length) {
          out.push({
            id,
            message: `vocabCount ${e.vocabCount} ≠ 課程檔 ${l.vocab.length}`,
          });
        }
        if (e.grammarCount !== l.grammar.length) {
          out.push({
            id,
            message: `grammarCount ${e.grammarCount} ≠ 課程檔 ${l.grammar.length}`,
          });
        }
        return out;
      }),
  },
  {
    id: "id-format",
    severity: "error",
    description: "V/G/S/D id 格式(S、D 在 Zod 只是 string)且課號前綴 = 所在課",
    check: eachLesson((l) =>
      idsOf(l).flatMap(([kind, id]): LintIssue[] => {
        const m = ID_RE[kind].exec(id);
        if (!m) return [{ id, message: `不符 ${kind} id 格式` }];
        return Number(m[1]) === l.id
          ? []
          : [{ id, message: `課號前綴 ≠ 所在的第 ${l.id} 課` }];
      }),
    ),
  },
  {
    id: "id-unique",
    severity: "error",
    description: "全部 V/G/S/D id 全域唯一",
    check: ({ lessons }) => {
      const seen = new Set<string>();
      return lessons.flatMap((l) =>
        idsOf(l).flatMap(([, id]) => {
          if (!seen.has(id)) {
            seen.add(id);
            return [];
          }
          return [{ id, message: "id 重複" }];
        }),
      );
    },
  },
  {
    id: "id-sequence",
    severity: "error",
    description:
      "V、G、D 依陣列順序自 V001/G01/D01 連號(S 不要求,見 warning sentence-id-order)",
    check: eachLesson((l) => {
      const seq = (ids: string[], kind: string, width: number) =>
        ids.flatMap((id, i) => {
          const want = `${lessonTag(l.id)}-${kind}${pad(i + 1, width)}`;
          return id === want ? [] : [{ id, message: `應為 ${want}` }];
        });
      return [
        ...seq(
          l.vocab.map((v) => v.id),
          "V",
          3,
        ),
        ...seq(
          l.grammar.map((g) => g.id),
          "G",
          2,
        ),
        ...seq(
          l.dialogues.map((d) => d.id),
          "D",
          2,
        ),
      ];
    }),
  },
];

// ---------- error:ruby ----------

const rubyRules: LintRule[] = [
  {
    id: "ruby-han-has-r",
    severity: "error",
    description: "含漢字的 ruby 段必有讀音 r(單字、例句、会話標題、会話)",
    check: eachSegment((s) =>
      HAN_RE.test(s.b) && s.r === undefined ? `${segText(s)} 缺 r` : null,
    ),
  },
  {
    id: "ruby-r-hiragana",
    severity: "error",
    description: "ruby 讀音 r 只含平假名(ぁ–ゖ)",
    check: eachSegment((s) =>
      s.r !== undefined && !/^[ぁ-ゖ]+$/.test(s.r) ? segText(s) : null,
    ),
  },
  {
    id: "ruby-r-target",
    severity: "error",
    description: "帶 r 的 ruby 段須含漢字或數字(r 不掛在純假名、記號段)",
    check: eachSegment((s) =>
      s.r !== undefined && !HAN_RE.test(s.b) && !DIGIT_RE.test(s.b)
        ? segText(s)
        : null,
    ),
  },
  {
    // T12.1 為 warning;T12.5 以 fix-content 的 ruby 分段修正 9 段後升為 error
    id: "ruby-r-scope",
    severity: "error",
    description:
      "帶 r 的 ruby 段只含漢字或數字(furigana 不跨越記號與送り仮名:〜、…、「、います。不併入帶 r 的段)",
    check: eachSegment((s) =>
      s.r !== undefined && /[^\p{Script=Han}々〆ヶ0-9０-９,]/u.test(s.b)
        ? segText(s)
        : null,
    ),
  },
];

// ---------- error:字元 ----------

/** ASCII 空白以外的空白(全形空白、NBSP、tab、換行…)與控制、零寬等格式字元 */
const ODD_SPACE_RE = /[^\S ]|[\p{Cc}\p{Cf}]/u;
const HALFWIDTH_KATAKANA_RE = /[｡-ﾟ]/;
/** 長音符ー、波浪號〜的近似字:‐‑‒–—―、−、－、─、～、~、半形ｰ */
const JA_DASH_RE = /[‐-―−－─～~ｰ]/u;

const charRules: LintRule[] = [
  {
    id: "text-hygiene",
    severity: "error",
    description:
      "字串欄位(ruby 以串接後的表面檢查)無首尾/連續空白、全形空白、NBSP、tab、換行、零寬字元、半形片假名",
    check: eachLesson((l) =>
      textFields(l).flatMap((f) => {
        const why: string[] = [];
        if (f.text !== f.text.trim()) why.push("首尾空白");
        if (/ {2,}/.test(f.text)) why.push("連續空白");
        const odd = ODD_SPACE_RE.exec(f.text);
        if (odd) why.push(`空白/控制字元 ${codePoint(odd[0])}`);
        if (HALFWIDTH_KATAKANA_RE.test(f.text)) why.push("半形片假名");
        return why.length === 0
          ? []
          : [{ id: f.id, message: `${f.field}:${why.join("、")}` }];
      }),
    ),
  },
  {
    id: "ja-lookalike-dash",
    severity: "error",
    description:
      "日文欄位(ruby、kana、課名、文型、note、speaker)不含ー/〜的近似字(‐―−－─～~ｰ 等)",
    check: eachLesson((l) => {
      const hit = (id: string, field: string, text = ""): LintIssue[] => {
        const m = JA_DASH_RE.exec(text);
        return m
          ? [{ id, message: `${field}「${text}」${codePoint(m[0])}` }]
          : [];
      };
      return [
        // ruby 逐段檢查(表面由各段串成,不再重複)
        ...rubyItemsOf(l).flatMap((it) =>
          it.ruby.flatMap((s) => [
            ...hit(it.id, "ruby", s.b),
            ...hit(it.id, "ruby r", s.r),
          ]),
        ),
        ...textFields(l)
          .filter((f) => f.lang !== "zh" && f.field !== "surface")
          .flatMap((f) => hit(f.id, f.field, f.text)),
      ];
    }),
  },
  {
    id: "kana-no-han-latin",
    severity: "error",
    description:
      "單字 kana 不含漢字、英數字、空白(其他記號見 warning kana-symbols)",
    check: eachLesson((l) =>
      l.vocab
        .filter((v) =>
          /[\p{Script=Han}A-Za-z0-9Ａ-Ｚａ-ｚ０-９\s]/u.test(v.kana),
        )
        .map((v) => ({ id: v.id, message: v.kana })),
    ),
  },
];

// ---------- error:詞性形狀 ----------

const I_ROW = "いきぎしじちぢにひびぴみり";
const E_ROW = "えけげせぜてでねへべぺめれ";
const KANA_CHAR_RE = /[ぁ-ゖァ-ヺー]/;
/** 表面最後一個詞(去掉句末標點,以空白分詞) */
const lastWordOf = (surface: string) =>
  surface
    .replace(/[。、?？!！]+$/u, "")
    .split(" ")
    .at(-1) ?? "";

const posRules: LintRule[] = [
  {
    id: "verb-class-shape",
    severity: "error",
    description:
      "動詞ます前一字的段與類別相符(動I い段、動II い/え段、動III 以します結尾或末詞為来ます);末詞為します/来ます者須為動III",
    // 形狀規則的極限:動I 的〜します(話します)與動III(勉強します)、い段的動I/動II(借ります)
    // 無法以形狀區分,只能靠 pos-inconsistent 與資料測試
    check: eachLesson((l) =>
      l.vocab.flatMap((v): LintIssue[] => {
        if (!v.pos.startsWith("動")) return [];
        const surface = surfaceOf(v.ruby);
        const bad = (why: string) => ({
          id: v.id,
          message: `${v.pos}「${surface}」${why}`,
        });
        const last = lastWordOf(surface);
        if ((last === "します" || last === "来ます") && v.pos !== "動III") {
          return [bad(`末詞為${last},應為動III`)];
        }
        const kana = [...v.kana].filter((c) => KANA_CHAR_RE.test(c)).join("");
        if (!kana.endsWith("ます")) return []; // 見 warning verb-not-masu
        const pre = kana.at(-3) ?? "";
        if (pre === "") return [bad("ます前沒有字")];
        if (v.pos === "動I" && !I_ROW.includes(pre))
          return [bad("ます前非い段")];
        if (v.pos === "動II" && !I_ROW.includes(pre) && !E_ROW.includes(pre)) {
          return [bad("ます前非い/え段")];
        }
        if (
          v.pos === "動III" &&
          !kana.endsWith("します") &&
          !(kana.endsWith("きます") && /^(来|き)ます$/.test(last))
        ) {
          // 〜きます的動III只有来ます與其複合(持って 来ます);働きます這類是動I
          return [bad("不是します,末詞也不是来ます")];
        }
        return [];
      }),
    ),
  },
  {
    id: "adjective-shape",
    severity: "error",
    description: "い形 kana 以い結尾;表面含［な］/〔な〕者須為な形",
    check: eachLesson((l) =>
      l.vocab.flatMap((v): LintIssue[] => {
        const surface = surfaceOf(v.ruby);
        if (v.pos === "い形" && !v.kana.endsWith("い")) {
          return [{ id: v.id, message: `い形「${surface}」kana=${v.kana}` }];
        }
        if (v.pos !== "な形" && /[［〔]な[］〕]/.test(surface)) {
          return [{ id: v.id, message: `${v.pos}「${surface}」含［な］` }];
        }
        return [];
      }),
    ),
  },
  {
    id: "dialogue-speaker",
    severity: "error",
    description:
      "会話每行 speaker 非空,且不是標題標記(含「標題」;会話標題存 dialogueTitle)",
    check: eachLesson((l) =>
      l.dialogues
        .filter((d) => !d.speaker?.trim() || d.speaker.includes("標題"))
        .map((d) => ({
          id: d.id,
          message: `speaker=${d.speaker === undefined ? "(無)" : `「${d.speaker}」`} ${surfaceOf(d.ruby)}`,
        })),
    ),
  },
];

// ---------- error:中文字形 ----------

/**
 * Big5 內、但台灣正體不用的日文字形(人工挑選)。不在 Big5 的日文字形(辺、会、来…)
 * 由 Big5 檢查涵蓋;照搬「Big5 內的日文新字體」會誤報約 330 處正體字(為、真、並…)。
 */
export const JA_GLYPH_BLACKLIST: ReadonlySet<string> = new Set(
  "証伝弁体虫芸豊糸缶与触党痴",
);

const JA_WORD =
  "\\p{Script=Han}々〆ヶ\\p{Script=Hiragana}\\p{Script=Katakana}ー〜";
/** 含假名的漢字假名串(会います、来ます…):中文說明引用的日文 */
const JA_RUN_RE = new RegExp(
  `[${JA_WORD}]*[\\p{Script=Hiragana}\\p{Script=Katakana}][${JA_WORD}]*`,
  "gu",
);

/** 剝除 explanation 引用的日文:「」『』〔〕與含假名的漢字假名串 */
export const stripQuotedJapanese = (s: string) =>
  s.replace(/「[^」]*」|『[^』]*』|〔[^〕]*〕/g, "").replace(JA_RUN_RE, "");

/** meaning、translation 只剝「」:渡辺さん 這類外洩仍要抓到 */
const stripCornerQuotes = (s: string) => s.replace(/「[^」]*」/g, "");

const ZH_GLYPH_FIELDS = new Set(["meaning", "translation", "explanation"]);

/**
 * Big5 標準字集:符號 A140–A3BF、常用字 A440–C67E、次常用字 C940–F9FE(含 ETEN F9D6–F9FE)。
 * 不含 HKSCS(WHATWG big5 decoder 會解出香港字,故只列舉標準範圍)。
 * 無完整 ICU 的 Node 不支援 big5,明確丟錯而非靜默略過。
 */
export function big5Charset(
  createDecoder: () => { decode(bytes: Uint8Array): string } = () =>
    new TextDecoder("big5"),
): Set<string> {
  let decoder: { decode(bytes: Uint8Array): string };
  try {
    decoder = createDecoder();
  } catch (e) {
    throw new Error(
      `無法建立 big5 TextDecoder(Node 需含完整 ICU):${e instanceof Error ? e.message : String(e)}`,
    );
  }
  const set = new Set<string>();
  const ranges: [number, number][] = [
    [0xa140, 0xa3bf],
    [0xa440, 0xc67e],
    [0xc940, 0xf9fe],
  ];
  for (const [lo, hi] of ranges) {
    for (let code = lo; code <= hi; code++) {
      const trail = code & 0xff;
      if (
        !((trail >= 0x40 && trail <= 0x7e) || (trail >= 0xa1 && trail <= 0xfe))
      ) {
        continue;
      }
      const ch = decoder.decode(new Uint8Array([code >> 8, trail]));
      if (ch !== "�" && [...ch].length === 1) set.add(ch);
    }
  }
  if (set.size < 13000) {
    throw new Error(`big5 字集只有 ${set.size} 字,decoder 異常`);
  }
  return set;
}

const zhRules: LintRule[] = [
  {
    id: "zh-glyph",
    severity: "error",
    description:
      "中文欄位(meaning、translation、explanation;剝除引用的日文後)不含 Big5 以外的漢字與日文字形黑名單",
    check: eachLesson((l, { big5 }) =>
      textFields(l)
        .filter((f) => ZH_GLYPH_FIELDS.has(f.field))
        .flatMap((f) => {
          const text =
            f.field === "explanation"
              ? stripQuotedJapanese(f.text)
              : stripCornerQuotes(f.text);
          const bad = [...new Set(text)].filter(
            (c) =>
              JA_GLYPH_BLACKLIST.has(c) || (HAN_RE.test(c) && !big5.has(c)),
          );
          return bad.length === 0
            ? []
            : [{ id: f.id, message: `${f.field}:${bad.join("")}` }];
        }),
    ),
  },
];

// ---------- warning ----------

const kataToHira = (s: string) =>
  s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
const KANA_STRIP_RE = /[。、，,．.？?！!・…‥「」『』［］[\]〔〕〜～:：\s]/gu;
/** 讀音比對用:去［な］、「〜を」類語境、空白與標點,片假名轉平假名 */
const normKana = (s: string) =>
  kataToHira(
    s
      .replace(/[［〔]な[］〕]/g, "")
      .replace(/[「［〔]〜[^」］〕]*[」］〕]/g, "")
      .replace(KANA_STRIP_RE, ""),
  );
/** ruby 讀音的候選:／ 並列、（X）省略或只取 X、「A、A」同音並列取 A */
function readingVariants(reading: string): string[] {
  const out = new Set<string>([reading, ...reading.split("／")]);
  const paren = /^(.*?)[（(](.*)[）)](.*)$/.exec(reading);
  if (paren) out.add(paren[1] + paren[3]).add(paren[2]);
  const pair = reading.split(/[、，]\s*/);
  if (pair.length === 2 && normKana(pair[0]) === normKana(pair[1]))
    out.add(pair[0]);
  return [...out].map(normKana);
}

const NA_MARK_RE = /[［〔]な[］〕]/;

/** 依 key 分組(保留首見順序) */
function groupBy<T>(items: T[], key: (t: T) => string): T[][] {
  const groups = new Map<string, T[]>();
  for (const it of items) {
    const k = key(it);
    groups.set(k, [...(groups.get(k) ?? []), it]);
  }
  return [...groups.values()];
}

const allVocab = (lessons: readonly Lesson[]) =>
  lessons.flatMap((l) => l.vocab);

const warningRules: LintRule[] = [
  {
    id: "kana-symbols",
    severity: "warning",
    description: "kana 含假名以外的記號(［］／〜・、…;kana 契約待定)",
    check: eachLesson((l) =>
      l.vocab
        .filter((v) => !/^[ぁ-ゖァ-ヺー]+$/.test(v.kana))
        .map((v) => ({ id: v.id, message: v.kana })),
    ),
  },
  {
    id: "kana-vs-ruby",
    severity: "warning",
    description: "kana 與 ruby 讀音(r ?? b)正規化後不一致(含英數字的讀音略過)",
    check: eachLesson((l) =>
      l.vocab.flatMap((v) => {
        const reading = readingOf(v.ruby);
        if (/[0-9０-９A-Za-zＡ-Ｚａ-ｚ]/.test(reading)) return [];
        const kanaForms = [v.kana, ...v.kana.split("／")].map(normKana);
        return readingVariants(reading).some((r) => kanaForms.includes(r))
          ? []
          : [{ id: v.id, message: `kana=${v.kana} ruby=${reading}` }];
      }),
    ),
  },
  {
    id: "verb-not-masu",
    severity: "warning",
    description: "動詞 kana 不是ます形",
    check: eachLesson((l) =>
      l.vocab
        .filter((v) => v.pos.startsWith("動") && !v.kana.endsWith("ます"))
        .map((v) => ({ id: v.id, message: `${surfaceOf(v.ruby)} ${v.kana}` })),
    ),
  },
  {
    id: "na-adjective-marker",
    severity: "warning",
    description: "な形表面缺［な］/〔な〕",
    check: eachLesson((l) =>
      l.vocab
        .filter((v) => v.pos === "な形" && !NA_MARK_RE.test(surfaceOf(v.ruby)))
        .map((v) => ({ id: v.id, message: surfaceOf(v.ruby) })),
    ),
  },
  {
    id: "cross-lesson-duplicate",
    severity: "warning",
    description: "跨課「表面+讀音+釋義」完全相同(每組一筆;是否為教材重列)",
    check: ({ lessons }) =>
      groupBy(
        allVocab(lessons),
        (v) => `${surfaceOf(v.ruby)}|${v.kana}|${v.meaning}`,
      )
        .filter((vs) => new Set(vs.map((v) => v.id.slice(0, 3))).size > 1)
        .map((vs) => ({
          id: vs[0].id,
          message: `${surfaceOf(vs[0].ruby)}:${vs.map((v) => v.id).join(" ")}`,
        })),
  },
  {
    id: "pos-inconsistent",
    severity: "warning",
    description: "同「表面+讀音」詞性不一致(含同形異義,需人工判斷)",
    check: ({ lessons }) =>
      groupBy(allVocab(lessons), (v) => `${surfaceOf(v.ruby)}|${v.kana}`)
        .filter((vs) => new Set(vs.map((v) => v.pos)).size > 1)
        .map((vs) => ({
          id: vs[0].id,
          message: `${surfaceOf(vs[0].ruby)}:${vs.map((v) => `${v.id}(${v.pos})`).join(" ")}`,
        })),
  },
  {
    id: "sentence-id-order",
    severity: "warning",
    description:
      "例句 S id 依文件順序自 S01 連號(S id 被程式與測試引用,不重編)",
    check: eachLesson((l) => {
      const ids = examplesOf(l).map((s) => s.id);
      const off = ids.filter(
        (id, i) => id !== `${lessonTag(l.id)}-S${pad(i + 1, 2)}`,
      );
      return off.length === 0
        ? []
        : [
            {
              id: lessonTag(l.id),
              message: `${off.length} 句不在原位:${off.slice(0, 4).join(",")}${off.length > 4 ? "…" : ""}`,
            },
          ];
    }),
  },
  {
    id: "speaker-alias",
    severity: "warning",
    description: "同課会話中一個 speaker 是另一個的前綴(如 山田 / 山田一郎)",
    check: eachLesson((l) => {
      const speakers = [
        ...new Set(
          l.dialogues.flatMap((d) => (d.speaker?.trim() ? [d.speaker] : [])),
        ),
      ];
      return speakers.flatMap((a) =>
        speakers
          .filter((b) => b !== a && b.startsWith(a))
          .map((b) => ({ id: lessonTag(l.id), message: `${a} / ${b}` })),
      );
    }),
  },
  {
    id: "zh-lookalike",
    severity: "warning",
    description:
      "中文欄位的近似字:～(U+FF5E,其餘用〜)、U+2010–2015 連字號;中譯人名用 · 而非日文中點・",
    check: eachLesson((l) =>
      textFields(l)
        .filter((f) => f.lang === "zh")
        .flatMap((f) => {
          const m =
            /[～‐-―]/u.exec(f.text) ??
            (f.field === "translation" ? /・/.exec(f.text) : null);
          if (!m) return [];
          const around = f.text.slice(Math.max(0, m.index - 6), m.index + 6);
          return [
            { id: f.id, message: `${f.field}:${codePoint(m[0])} …${around}…` },
          ];
        }),
    ),
  },
];

/** error 16 條在前(T12.5 把 ruby-r-scope 升為 error;T12.6 加 zh-punct),warning 9 條在後 */
export const RULES: readonly LintRule[] = [
  ...idRules,
  ...rubyRules,
  ...charRules,
  ...posRules,
  ...zhRules,
  ...warningRules,
];

// ---------- 執行與報告 ----------

export interface RuleResult {
  rule: LintRule;
  /** 失敗(error)或提醒(warning) */
  issues: LintIssue[];
}

export interface LintResult {
  rules: RuleResult[];
  /** error 筆數;> 0 即失敗 */
  errorCount: number;
  warningCount: number;
}

export function lintContent(
  ctx: LintContext,
  { rules = RULES }: { rules?: readonly LintRule[] } = {},
): LintResult {
  const results = rules.map(
    (rule): RuleResult => ({ rule, issues: rule.check(ctx) }),
  );
  const count = (severity: Severity) =>
    results
      .filter((r) => r.rule.severity === severity)
      .reduce((n, r) => n + r.issues.length, 0);
  return {
    rules: results,
    errorCount: count("error"),
    warningCount: count("warning"),
  };
}

export interface ReportArgs {
  all: boolean;
  rule?: string;
}

/**
 * validate:content 的參數:`--all`、`--rule <id>`(或 `--rule=<id>`);pnpm 轉傳的 `--` 略過。
 * 不認得的參數與規則 id 回傳錯誤訊息(打錯字不能看起來像篩選成功)。
 */
export function parseReportArgs(
  argv: readonly string[],
  rules: readonly LintRule[] = RULES,
): ReportArgs | { error: string } {
  const args: ReportArgs = { all: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--") continue;
    if (arg === "--all") {
      args.all = true;
    } else if (arg === "--rule" || arg.startsWith("--rule=")) {
      const id = arg === "--rule" ? argv[++i] : arg.slice("--rule=".length);
      if (!id || !rules.some((r) => r.id === id)) {
        return {
          error: `--rule 需要規則 id,可用:${rules.map((r) => r.id).join(", ")}`,
        };
      }
      args.rule = id;
    } else {
      return {
        error: `不認得的參數「${arg}」;用法:pnpm validate:content [--all] [--rule <id>]`,
      };
    }
  }
  return args;
}

/**
 * 分組報告:✗ error、⚠ warning,每條規則「N 筆 — 說明」與前 samples 筆;
 * all 或指定 rule 時列出完整清單(PDF 校讀用)。最後一行為總結。
 */
export function formatReport(
  result: LintResult,
  {
    samples = 5,
    all = false,
    rule,
  }: { samples?: number; all?: boolean; rule?: string } = {},
): string[] {
  const limit = all || rule !== undefined ? Infinity : samples;
  const shown = result.rules.filter(
    (r) => rule === undefined || r.rule.id === rule,
  );
  const lines: string[] = [];
  const block = (head: string, issues: LintIssue[]) => {
    lines.push(head);
    for (const i of issues.slice(0, limit))
      lines.push(`    ${i.id} ${i.message}`);
    if (issues.length > limit)
      lines.push(`    …另 ${issues.length - limit} 筆`);
  };

  for (const r of shown) {
    if (r.rule.severity === "error" && r.issues.length > 0) {
      block(
        `✗ [${r.rule.id}] ${r.issues.length} 筆 — ${r.rule.description}`,
        r.issues,
      );
    }
  }
  for (const r of shown) {
    if (r.rule.severity === "warning" && r.issues.length > 0) {
      block(
        `⚠ [${r.rule.id}] ${r.issues.length} 筆 — ${r.rule.description}`,
        r.issues,
      );
    }
  }

  // 指定 rule 時其他規則的 error 不列出,但仍影響結束碼:提示一行,免得失敗卻看不到原因
  const hidden =
    result.errorCount -
    shown
      .filter((r) => r.rule.severity === "error")
      .reduce((n, r) => n + r.issues.length, 0);
  if (hidden > 0) {
    lines.push(`(其他規則另有 ${hidden} 筆 error 未列出;不加 --rule 執行查看)`);
  }

  const nRules = (severity: Severity) =>
    result.rules.filter((r) => r.rule.severity === severity).length;
  lines.push(
    `${result.errorCount === 0 ? "✓" : "✗"} content-lint:error ${nRules("error")} 條` +
      (result.errorCount === 0 ? "全過" : ` ${result.errorCount} 筆未通過`) +
      `;warning ${nRules("warning")} 條 ${result.warningCount} 筆(不影響結束碼)`,
  );
  return lines;
}

/**
 * 中文欄位(meaning、explanation、translation)的標點「半形:全形」個數,每個欄位一行
 * (彙總,不逐筆列;只列有半形的標點;逗號不計千分位)。
 */
export function punctuationSummary(lessons: readonly Lesson[]): string[] {
  const pairs: [string, RegExp, RegExp][] = [
    ["逗號", /,(?!\d{3})/g, /，/g],
    ["括號", /[()]/g, /[（）]/g],
    ["問號", /\?/g, /？/g],
    ["驚嘆號", /!/g, /！/g],
    ["冒號", /:/g, /：/g],
    ["分號", /;/g, /；/g],
  ];
  const byField = new Map<string, string[]>();
  for (const l of lessons) {
    for (const f of textFields(l)) {
      if (f.lang === "zh")
        byField.set(f.field, [...(byField.get(f.field) ?? []), f.text]);
    }
  }
  const countAll = (texts: string[], re: RegExp) =>
    texts.reduce((n, t) => n + (t.match(re)?.length ?? 0), 0);
  return [...byField].flatMap(([field, texts]) => {
    const parts = pairs.flatMap(([name, half, full]) => {
      const h = countAll(texts, half);
      const w = countAll(texts, full);
      return h > 0 ? [`${name} ${h}:${w}`] : [];
    });
    return parts.length === 0 ? [] : [`${field}:${parts.join("、")}`];
  });
}
