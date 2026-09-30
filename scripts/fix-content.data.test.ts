import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CORRECTIONS,
  fixLesson,
  labelOf,
  parseLesson,
  statusOf,
  validateCorrections,
} from "./fix-content";

// 以真實教材資料釘住 fix-content 的每筆修正。CI 只跑 pnpm verify,日後從 PDF 重新抽取而
// 蓋回任一筆時在這裡失敗(執行 pnpm fix:content 即復原)。
const lessonsDir = join(process.cwd(), "public", "data", "lessons");
const tagOf = (lesson: number) => `L${String(lesson).padStart(2, "0")}`;
const rawOf = (lesson: number) =>
  readFileSync(join(lessonsDir, `${tagOf(lesson)}.json`), "utf-8");
const lessonOf = (lesson: number) => parseLesson(rawOf(lesson));

describe("fix-content × 真實資料", () => {
  it("CORRECTIONS 宣告合法", () => {
    expect(validateCorrections(CORRECTIONS)).toEqual([]);
  });

  it.each(CORRECTIONS.map((c) => [labelOf(c), c] as const))(
    "%s:已套用",
    (_, c) => {
      expect(statusOf(lessonOf(c.lesson), c)).toBe("applied");
    },
  );

  it.each(
    [...new Set(CORRECTIONS.map((c) => c.lesson))].map(
      (n) => [tagOf(n), n] as const,
    ),
  )("%s:重跑 0 變動、逐位元相同", (_, lesson) => {
    const raw = rawOf(lesson);
    const fix = fixLesson(
      raw,
      CORRECTIONS.filter((c) => c.lesson === lesson),
    );
    expect(fix.text).toBe(raw);
  });

  it("会話標題(T12.4):移入 dialogueTitle,新的 D01 是第一句台詞,台詞 11/11/11/12 行", () => {
    const titled = CORRECTIONS.flatMap((c) =>
      c.kind === "dialogueTitle" ? [c] : [],
    );
    expect(titled.map((c) => c.lesson)).toEqual([15, 23, 24, 41]);
    for (const c of titled) {
      const l = lessonOf(c.lesson);
      expect(l.dialogueTitle, tagOf(c.lesson)).toEqual({
        ruby: c.from.ruby,
        translation: c.from.translation,
      });
      // 課程檔中 dialogueTitle 緊接在 dialogues 前
      const keys = Object.keys(l);
      expect(keys.indexOf("dialogueTitle"), tagOf(c.lesson)).toBe(
        keys.indexOf("dialogues") - 1,
      );
    }
    expect(
      titled.map((c) => {
        const d = lessonOf(c.lesson).dialogues;
        return `${d[0].id} ${d[0].speaker} ${d.length}`;
      }),
    ).toEqual([
      "L15-D01 ミラー 11",
      "L23-D01 図書館の人 11",
      "L24-D01 カリナ 11",
      "L41-D01 ミラー 12",
    ]);
  });

  it("L43-D08 只改中譯:speaker 與日文 ruby 的渡辺不動", () => {
    const d = lessonOf(43).dialogues.find((x) => x.id === "L43-D08");
    expect(d?.speaker).toBe("渡辺");
    expect(d?.ruby.map((s) => s.b)).toContain("渡辺");
    expect(d?.translation).toContain("他也姓渡邊呢。");
  });

  it("L49-D02 的人名中點與 L01「邁克·米勒」相同(U+00B7)", () => {
    const dotOf = (text: string, re: RegExp) =>
      re.exec(text)?.[1].codePointAt(0);
    const l01 = lessonOf(1);
    const miller = [
      ...l01.grammar.flatMap((g) => g.examples),
      ...l01.dialogues,
    ].flatMap((s) => dotOf(s.translation, /邁克(.)米勒/) ?? []);
    expect(miller).toEqual([0xb7, 0xb7, 0xb7]);
    const hans = lessonOf(49).dialogues.find((x) => x.id === "L49-D02");
    expect(dotOf(hans?.translation ?? "", /漢斯(.)施密特/)).toBe(0xb7);
  });
});
