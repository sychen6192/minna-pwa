import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { LessonSchema, type Lesson, type RubySeg } from "@/schemas/lesson";
import { findExampleMatch, findExampleSentence } from "./examples";

// 以實際教材資料(public/data)驗證語境例句配對:釘住稽核找到的誤配(LCV-M2 / DQ-M1)不再出現。
const lessonsDir = join(process.cwd(), "public", "data", "lessons");
const lessons: Lesson[] = readdirSync(lessonsDir)
  .filter((f) => f.endsWith(".json"))
  .map((f) =>
    LessonSchema.parse(JSON.parse(readFileSync(join(lessonsDir, f), "utf-8"))),
  );

const text = (segs: RubySeg[]) => segs.map((s) => s.b).join("");

const pairs = lessons.flatMap((l) =>
  l.vocab.map((v) => ({ v, example: findExampleSentence(v, l) })),
);
const exampleOf = (vocabId: string) => {
  const pair = pairs.find((p) => p.v.id === vocabId);
  if (!pair) throw new Error(`找不到單字 ${vocabId}`);
  return pair.example;
};

describe("語境例句 × 全部教材(T10.5)", () => {
  it("資料載入完整", () => {
    expect(lessons).toHaveLength(50);
    expect(pairs.length).toBeGreaterThan(2000);
  });

  it("仍有相當數量的單字配到例句(寧可漏,但不是全漏)", () => {
    expect(pairs.filter((p) => p.example !== null).length).toBeGreaterThan(400);
  });

  it("不選含「→」的活用對照行", () => {
    const hits = pairs
      .filter((p) => p.example !== null && text(p.example.ruby).includes("→"))
      .map((p) => p.v.id);
    expect(hits).toEqual([]);
  });

  it("不選正規化後等於單字本身的句子", () => {
    const norm = (s: string) => s.replace(/[\s。、?？!！…「」]/g, "");
    const hits = pairs
      .filter(
        (p) =>
          p.example !== null &&
          norm(text(p.example.ruby)) === norm(text(p.v.ruby)),
      )
      .map((p) => p.v.id);
    expect(hits).toEqual([]);
  });

  it("單一字元的單字一律不配(日 ⊂ 日曜日、心 ⊂ 心配)", () => {
    const hits = pairs
      .filter((p) => p.example !== null && text(p.v.ruby).length < 2)
      .map((p) => p.v.id);
    expect(hits).toEqual([]);
  });

  it.each([
    ["L20-V009", "うん", "ううん"],
    ["L14-V029", "すぐ", "まっすぐ"],
    ["L03-V002", "そこ", "あそこ"],
    ["L47-V004", "します〔音〕", "失礼します"],
    ["L47-V005", "します〔味〕", "失礼します"],
    ["L47-V006", "します〔におい〕", "失礼します"],
    ["L49-V019", "帰りに", "お帰りに"],
    ["L17-V034", "ですから", "元気ですから"],
    ["L01-V014", "社員", "会社員"],
  ])("已知誤配不再出現:%s %s ✗「%s」", (id, _, wrong) => {
    const example = exampleOf(id);
    expect(example === null ? "" : text(example.ruby)).not.toContain(wrong);
  });

  it("修正後的配對", () => {
    expect(exampleOf("L20-V009")?.id).toBe("L20-S08"); // …うん、飲む。
    expect(exampleOf("L47-V004")?.id).toBe("L47-S11"); // 変な 音が しますね。
    expect(exampleOf("L47-V005")).toBeNull(); // 課內無「味が します」
    expect(exampleOf("L47-V006")).toBeNull(); // 課內無「においが します」
    expect(exampleOf("L01-V014")?.id).toBe("L01-S10"); // ミラーさんは IMCの 社員です。
  });
});

describe("findExampleMatch × 全部教材(T11.8)", () => {
  it("與 findExampleSentence 選同一句,位置處恰為單字表面形", () => {
    for (const l of lessons) {
      for (const v of l.vocab) {
        const m = findExampleMatch(v, l);
        expect(m?.sentence ?? null, v.id).toBe(findExampleSentence(v, l));
        if (m)
          expect(text(m.sentence.ruby).slice(m.start, m.end), v.id).toBe(
            text(v.ruby),
          );
      }
    }
  });
});
