import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { LessonSchema } from "@/schemas/lesson";
import {
  FIX_ENDS_MIN_CHUNKS,
  MAX_CHUNKS,
  MIN_CHUNKS,
  REORDER_COUNT,
  answerOrder,
  checkOrder,
  chunkRuby,
  chunkText,
  isReorderable,
  lessonHasReorder,
  makeReorderRound,
  pickedTexts,
  reorderPool,
  surfaceText,
} from "./reorder";

// 以實際教材資料(public/data)驗證例句重組:全部 50 課的文型例句與会話。
const lessonsDir = join(process.cwd(), "public", "data", "lessons");
const lessons = readdirSync(lessonsDir)
  .filter((f) => f.endsWith(".json"))
  .map((f) =>
    LessonSchema.parse(JSON.parse(readFileSync(join(lessonsDir, f), "utf-8"))),
  );

/** 確定性亂數(mulberry32) */
function seeded(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const grammarExamples = lessons.flatMap((l) =>
  l.grammar.flatMap((g) => g.examples),
);
const dialogueLines = lessons.flatMap((l) => l.dialogues);

describe("例句重組(全資料)", () => {
  it("50 課齊全", () => {
    expect(lessons.map((l) => l.id)).toEqual(
      Array.from({ length: 50 }, (_, i) => i + 1),
    );
  });

  // T12.4 会話標題移入 dialogueTitle 前後不變(標題行原本就不出題)
  it("可出題句數:文型例句 593 + 会話 167 = 760(各課出題池 751:去掉同課重列句 4、較晚課次的例句 5)", () => {
    const grammar = grammarExamples.filter((s) => isReorderable(s)).length;
    const dialogue = dialogueLines.filter((s) => isReorderable(s)).length;
    expect({ grammar, dialogue }).toEqual({ grammar: 593, dialogue: 167 });
    const pools = lessons.map((l) => reorderPool(l).length);
    expect(pools.reduce((a, b) => a + b, 0)).toBe(751);
    expect(Math.min(...pools)).toBe(3); // 第 3 課
    expect(Math.max(...pools)).toBe(23);
  });

  it("可出題句的切塊沒有抽取痕跡:沒有單獨的英數字、助詞「の」、お/ご 或片假名 + 漢字被切開", () => {
    for (const l of lessons) {
      for (const s of reorderPool(l)) {
        const chunks = chunkRuby(s.ruby);
        chunks.forEach((c, i) => {
          const text = chunkText(c);
          const where = `${s.id} ${text}`;
          expect(text, where).not.toMatch(/^[0-9A-Za-z０-９,]+$/);
          expect(text, where).not.toMatch(/^[のおご]$/);
          expect(text, where).not.toMatch(/っ$/);
          const next = chunks[i + 1];
          if (next?.[0].r)
            expect(text, where).not.toMatch(/^…?[\u30A0-\u30FF]+$/);
        });
      }
    }
  });

  it("全部句子的切塊:接回一致、帶 r 的段不拆、沒有空塊", () => {
    const all = [...grammarExamples, ...dialogueLines];
    expect(all.length).toBeGreaterThan(1400);
    for (const s of all) {
      const chunks = chunkRuby(s.ruby);
      expect(chunks.map(chunkText).join("")).toBe(
        s.ruby
          .map((seg) => (seg.r ? seg.b : seg.b.replaceAll(" ", "")))
          .join(""),
      );
      const rubySegs = s.ruby.filter((seg) => seg.r);
      const inChunks = chunks.flat().filter((seg) => seg.r);
      expect(inChunks).toHaveLength(rubySegs.length);
      inChunks.forEach((seg, i) => expect(seg).toBe(rubySegs[i]));
      for (const c of chunks) expect(chunkText(c)).not.toBe("");
    }
  });

  it("「→」活用對照行(12 行)不出題;会話標題(4 課)不在 dialogues、不在出題池", () => {
    const arrows = grammarExamples.filter((s) =>
      surfaceText(s.ruby).includes("→"),
    );
    expect(arrows.map((s) => s.id)).toEqual([
      "L14-S11",
      "L14-S12",
      "L14-S13",
      "L14-S14",
      "L17-S01",
      "L17-S02",
      "L19-S08",
      "L19-S09",
      "L19-S10",
      "L48-S01",
      "L48-S02",
      "L48-S03",
    ]);
    for (const s of arrows) expect(isReorderable(s)).toBe(false);
    const titled = lessons.filter((l) => l.dialogueTitle);
    expect(titled.map((l) => l.id)).toEqual([15, 23, 24, 41]);
    for (const l of titled) {
      const title = surfaceText(l.dialogueTitle?.ruby ?? []);
      expect(
        reorderPool(l).filter((s) => surfaceText(s.ruby) === title),
        `第 ${l.id} 課`,
      ).toEqual([]);
    }
  });

  it("每一課都有可出題的句子,且都能組成一回合:塊數 3–8、打亂 ≠ 原句、依原句排入即為正解", () => {
    for (const l of lessons) {
      const pool = reorderPool(l);
      expect(pool.length, `第 ${l.id} 課`).toBeGreaterThan(0);
      expect(lessonHasReorder(l)).toBe(true);
      for (const seed of [1, 2, 3]) {
        const round = makeReorderRound(l, { rng: seeded(l.id * 10 + seed) });
        expect(round).toHaveLength(Math.min(REORDER_COUNT, pool.length));
        for (const item of round) {
          const n = item.chunks.length;
          expect(n).toBeGreaterThanOrEqual(MIN_CHUNKS);
          expect(n).toBeLessThanOrEqual(MAX_CHUNKS);
          expect(item.fixedEnds).toBe(n >= FIX_ENDS_MIN_CHUNKS);
          const movable = item.fixedEnds
            ? Array.from({ length: n - 2 }, (_, i) => i + 1)
            : Array.from({ length: n }, (_, i) => i);
          expect([...item.shuffled].sort((a, b) => a - b)).toEqual(movable);
          const original = item.chunks.map((c) => c.text);
          // 打亂的初始順序(含固定首尾)不等於原句
          expect(pickedTexts(item, item.shuffled)).not.toEqual(original);
          expect(checkOrder(pickedTexts(item, movable), item)).toBe(true);
          expect(answerOrder(item, movable)).toEqual(
            Array.from({ length: n }, (_, i) => i),
          );
        }
      }
    }
  });
});
