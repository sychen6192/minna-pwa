import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  LessonIndexSchema,
  LessonSchema,
  type Lesson,
} from "../src/schemas/lesson";
import { big5Charset, lintContent, RULES, textFields } from "./content-lint";

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
  // 沒有例外清單(T12.1 的待修清單 11 id 由 T12.2–T12.4 修完,T12.4 移除該機制)
  it.each(RULES.filter((r) => r.severity === "error").map((r) => r.id))(
    "%s:0 筆",
    (id) => {
      expect(ruleResult(id).issues.map((i) => `${i.id} ${i.message}`)).toEqual(
        [],
      );
    },
  );

  // ruby-r-scope 於 T12.5 由 warning 升為 error(fix-content 的 ruby 分段修正 9 段後為 0 筆)
  it("error 16 條全過", () => {
    expect(RULES.filter((r) => r.severity === "error")).toHaveLength(16);
    expect(result.errorCount).toBe(0);
  });

  it("会話標題(dialogueTitle,L15/L23/L24/L41)的表面與中譯也在檢查範圍", () => {
    expect(
      lessons
        .flatMap(textFields)
        .filter((f) => f.id.endsWith(":dialogueTitle"))
        .map((f) => `${f.id} ${f.field} ${f.text}`),
    ).toEqual([
      "L15:dialogueTitle surface ご家族は?",
      "L15:dialogueTitle translation 您的家人呢？",
      "L23:dialogueTitle surface どうやって 行きますか",
      "L23:dialogueTitle translation 怎麼去呢",
      "L24:dialogueTitle surface 手伝って くれますか",
      "L24:dialogueTitle translation 可以幫我嗎",
      "L41:dialogueTitle surface 荷物を 預かって いただけませんか",
      "L41:dialogueTitle translation 能不能請您幫我保管行李呢",
    ]);
  });
});

/**
 * warning 釘住 id 清單(cross-lesson-duplicate 釘組數與筆數)。這是 ratchet:warning 不影響
 * validate:content 的結束碼,只靠這裡發現新增或消失的項目;日後任何資料修正(含 PDF 校讀)
 * 須在同一個 commit 更新這裡。
 */
const WARNING_IDS: Record<string, string[]> = {
  // kana 含記號(PDF 清單 3;L04-V050 え―と 已於 T12.2 修正)
  "kana-symbols": [
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
  // 每組以首個 id 代表;L06-V010 します 組(L47-V004..006 誤標動I)已於 T12.3 修正
  "pos-inconsistent": [
    "L03-V005",
    "L03-V006",
    "L05-V037",
    "L10-V027",
    "L14-V030",
    "L36-V038",
    "L39-V042",
  ],
  "sentence-id-order": ["L01", "L37"],
  "speaker-alias": ["L02"],
  // L49-D02 已於 T12.2 修正;L22-G02 與 L41-G04 的～於 T12.6 修正
  "zh-lookalike": ["L22-G02", "L41-G04", "L49-G01"],
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
