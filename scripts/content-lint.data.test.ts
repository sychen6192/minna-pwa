import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  LessonIndexSchema,
  LessonSchema,
  type Lesson,
} from "../src/schemas/lesson";
import { big5Charset, lintContent, RULES } from "./content-lint";

// 以真實教材資料(public/data)執行 content-lint。CI 只跑 pnpm verify、不跑 validate:content,
// 故 Zod、檔名與 error 規則都在這裡把關(不 import validate-content.ts:它是 CLI 入口)。
const dataDir = join(process.cwd(), "public", "data");
const readJson = (...path: string[]): unknown =>
  JSON.parse(readFileSync(join(dataDir, ...path), "utf-8"));

const files = readdirSync(join(dataDir, "lessons"))
  .filter((f) => f.endsWith(".json"))
  .sort();
const parsed = files.map((file) => ({
  file,
  zod: LessonSchema.safeParse(readJson("lessons", file)),
}));
const indexResult = LessonIndexSchema.safeParse(readJson("index.json"));

const valid = parsed.flatMap(({ file, zod }) =>
  zod.success ? [{ file, lesson: zod.data }] : [],
);
const lessons: Lesson[] = valid.map((v) => v.lesson);
const result = lintContent({
  lessons,
  files: valid.map((v) => v.file),
  index: indexResult.success ? indexResult.data : { lessons: [] },
  big5: big5Charset(),
});
const byRule = new Map(result.rules.map((r) => [r.rule.id, r]));
const ruleResult = (id: string) => {
  const r = byRule.get(id);
  if (!r) throw new Error(`沒有規則 ${id}`);
  return r;
};

describe("content-lint × 真實資料:Zod 與檔名", () => {
  it("50 課與 index.json 皆通過 Zod", () => {
    expect(
      parsed
        .filter(({ zod }) => !zod.success)
        .map(({ file, zod }) => `${file} ${zod.error?.message}`),
    ).toEqual([]);
    expect(indexResult.error?.message).toBeUndefined();
  });

  it("檔名 = 課號(L01.json–L50.json)", () => {
    const expected = Array.from(
      { length: 50 },
      (_, i) => `L${String(i + 1).padStart(2, "0")}.json`,
    );
    expect(files).toEqual(expected);
    expect(
      lessons.map((l) => `L${String(l.id).padStart(2, "0")}.json`),
    ).toEqual(expected);
  });
});

describe("content-lint × 真實資料:error 規則", () => {
  it.each(RULES.filter((r) => r.severity === "error").map((r) => r.id))(
    "%s:待修清單以外 0 筆",
    (id) => {
      expect(ruleResult(id).issues.map((i) => `${i.id} ${i.message}`)).toEqual(
        [],
      );
    },
  );

  // T12.2 修 L04-V050、L41-G04、L43-D08、L48-V011;T12.3 修 L47-V004..006;
  // T12.4 修会話標題行並移除待修機制。每修一筆,這裡與 PENDING_FIXES 同步刪除。
  // 連訊息一起釘:待修清單以 id 比對,同一欄位新增的問題(如 L48-V011 再多一個日文字形)
  // 只會改變訊息,不釘訊息就會被待修項目蓋掉。
  it("待修命中恰為 11 id / 12 筆,待修清單沒有多餘項", () => {
    expect(result.stalePending).toEqual([]);
    expect(
      Object.fromEntries(
        result.rules
          .filter((r) => r.pending.length > 0)
          .map((r) => [
            r.rule.id,
            r.pending.map((i) => `${i.id} ${i.message}`),
          ]),
      ),
    ).toEqual({
      "ja-lookalike-dash": [
        "L04-V050 ruby「え―と」U+2015",
        "L04-V050 kana「え―と」U+2015",
      ],
      "verb-class-shape": [
        "L47-V004 動I「します」末詞為します,應為動III",
        "L47-V005 動I「します」末詞為します,應為動III",
        "L47-V006 動I「します」末詞為します,應為動III",
      ],
      "dialogue-speaker": [
        "L15-D01 speaker=「（標題）」 ご家族は?",
        "L23-D01 speaker=(無) どうやって 行きますか",
        "L24-D01 speaker=「標題」 手伝って くれますか",
        "L41-D01 speaker=(無) 荷物を 預かって いただけませんか",
      ],
      "zh-glyph": [
        "L41-G04 explanation:証",
        "L43-D08 translation:辺",
        "L48-V011 meaning:証",
      ],
    });
    expect(result.pendingCount).toBe(12);
    expect(result.errorCount).toBe(0);
  });
});

/**
 * warning 釘住 id 清單(cross-lesson-duplicate 釘組數與筆數)。這是 ratchet:warning 不影響
 * validate:content 的結束碼,只靠這裡發現新增或消失的項目;日後任何資料修正(含 PDF 校讀)
 * 須在同一個 commit 更新這裡。
 */
const WARNING_IDS: Record<string, string[]> = {
  // kana 含記號(PDF 清單 3;L04-V050 え―と 於 T12.2 修正)
  "kana-symbols": [
    "L04-V050",
    "L09-V003",
    "L09-V004",
    "L09-V005",
    "L09-V006",
    "L09-V031",
    "L09-V033",
    "L09-V043",
    "L10-V041",
    "L10-V047",
    "L17-V031",
    "L17-V032",
    "L21-V038",
    "L38-V029",
    "L44-V019",
    "L46-V013",
    "L47-V025",
    "L49-V023",
    "L49-V034",
  ],
  "kana-vs-ruby": [
    "L03-V016",
    "L08-V042",
    "L21-V020",
    "L25-V015",
    "L38-V022",
    "L42-V053",
  ],
  // furigana 跨越記號(PDF 清單 4;T12.5 重新分段並升為 error)
  "ruby-r-scope": [
    "L02-V036",
    "L02-V039",
    "L11-S05",
    "L11-S07",
    "L11-S09",
    "L11-S11",
    "L21-S12",
    "L23-V013",
    "L37-V030",
  ],
  "verb-not-masu": ["L40-V055"],
  "na-adjective-marker": [
    "L13-V012",
    "L19-V028",
    "L21-V010",
    "L32-V044",
    "L42-V019",
    "L44-V008",
    "L44-V009",
  ],
  // 每組以首個 id 代表;L06-V010 します 組於 T12.3 消失
  "pos-inconsistent": [
    "L03-V005",
    "L03-V006",
    "L05-V037",
    "L06-V010",
    "L10-V027",
    "L14-V030",
    "L36-V038",
    "L39-V042",
  ],
  "sentence-id-order": ["L01", "L37"],
  "speaker-alias": ["L02"],
  // L49-D02 於 T12.2、L22-G02 與 L41-G04 的～於 T12.6 修正
  "zh-lookalike": ["L22-G02", "L41-G04", "L49-G01", "L49-D02"],
};

describe("content-lint × 真實資料:warning(ratchet)", () => {
  it("每條 warning 規則都有釘住", () => {
    expect(
      RULES.filter((r) => r.severity === "warning")
        .map((r) => r.id)
        .sort(),
    ).toEqual([...Object.keys(WARNING_IDS), "cross-lesson-duplicate"].sort());
  });

  it.each(Object.entries(WARNING_IDS))("%s", (id, expected) => {
    expect(ruleResult(id).issues.map((i) => i.id)).toEqual(expected);
  });

  it("cross-lesson-duplicate:33 組 / 74 筆", () => {
    const groups = ruleResult("cross-lesson-duplicate").issues;
    expect(groups).toHaveLength(33);
    expect(
      groups.flatMap((i) => i.message.match(/L\d{2}-V\d{3}/g) ?? []),
    ).toHaveLength(74);
  });
});
