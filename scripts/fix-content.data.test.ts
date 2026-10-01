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
import { normalizeZhPunct } from "./lib/zhPunct";

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

  // 重新抽取後先跑 normalize:zh-punct 再跑 fix:content,中文修正必比對得到:欄位修正比對
  // 子字串,会話標題修正比對整句中譯(L15「您的家人呢？」)
  it("中文修正(meaning、explanation、translation、会話標題中譯)以標點正規化後的寫法宣告(T12.6)", () => {
    const zh = CORRECTIONS.flatMap((c) => {
      if (c.kind === "dialogueTitle") return [c.from.translation];
      if (c.kind !== "field") return [];
      return ["meaning", "explanation", "translation"].includes(c.field)
        ? [c.from, c.to]
        : [];
    });
    expect(zh).toHaveLength(12);
    expect(zh.filter((t) => normalizeZhPunct(t) !== t)).toEqual([]);
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

  it("ruby 分段(T12.5):恰為 content-lint ruby-r-scope 原列的 9 段,串接的表面不變", () => {
    const splits = CORRECTIONS.flatMap((c) =>
      c.kind === "rubySplit" ? [c] : [],
    );
    expect(splits.map((c) => `${c.id} ${c.field}`)).toEqual([
      "L02-V036 ruby.0",
      "L02-V039 ruby.0",
      "L11-S05 ruby.0",
      "L11-S07 ruby.0",
      "L11-S09 ruby.0",
      "L11-S11 ruby.0",
      "L21-S12 ruby.1",
      "L23-V013 ruby.0",
      "L37-V030 ruby.0",
    ]);
    const surfaces = splits.map((c) => {
      const l = lessonOf(c.lesson);
      const item = [...l.vocab, ...l.grammar.flatMap((g) => g.examples)].find(
        (x) => x.id === c.id,
      );
      return `${c.id} ${item?.ruby.map((s) => s.b).join("")}`;
    });
    expect(surfaces).toEqual([
      "L02-V036 〜語",
      "L02-V039 違います。",
      "L11-S05 …8つ 買いました。",
      "L11-S07 …5人 います。",
      "L11-S09 …2時間 勉強します。",
      "L11-S11 …3年 勉強しました。",
      "L21-S12 ミラーさんは 「来週 東京へ 出張します」と 言いました。",
      "L23-V013 〜屋",
      "L37-V030 〜中",
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
