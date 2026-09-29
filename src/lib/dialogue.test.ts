import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { LessonSchema, type Sentence } from "@/schemas/lesson";
import { buildPlayback, isTitleLine, speakersOf } from "./dialogue";

function line(id: string, speaker?: string): Sentence {
  return { id, speaker, ruby: [{ b: "はい。" }], translation: "好的。" };
}

describe("isTitleLine", () => {
  // 教材中的 4 種標題寫法(L15/L24 speaker 為標題標記,L23/L41 沒有 speaker)
  it.each([
    ["（標題）", "L15-D01"],
    ["標題", "L24-D01"],
    [undefined, "L23-D01"],
    [undefined, "L41-D01"],
  ])("第一行 speaker=%s(%s)為標題", (speaker, id) => {
    expect(isTitleLine(line(id, speaker), 0)).toBe(true);
  });

  it("speaker 為空白字串也視為標題", () => {
    expect(isTitleLine(line("L01-D01", " "), 0)).toBe(true);
  });

  it("一般第一行台詞不是標題", () => {
    expect(isTitleLine(line("L14-D01", "カリナ"), 0)).toBe(false);
  });

  it("只看第一行:之後的行即使缺 speaker 或含「標題」也不是標題", () => {
    expect(isTitleLine(line("L23-D02"), 1)).toBe(false);
    expect(isTitleLine(line("L15-D02", "標題"), 1)).toBe(false);
  });
});

describe("speakersOf", () => {
  it("依首次出現順序、不重複", () => {
    const lines = [
      line("D01", "カリナ"),
      line("D02", "運転手"),
      line("D03", "カリナ"),
      line("D04", "運転手"),
    ];
    expect(speakersOf(lines)).toEqual(["カリナ", "運転手"]);
  });

  it("不含標題行(四種寫法)與無 speaker 的行", () => {
    for (const title of [
      line("D01", "（標題）"),
      line("D01", "標題"),
      line("D01"),
    ]) {
      expect(
        speakersOf([title, line("D02", "ワン"), line("D03", "カリナ")]),
      ).toEqual(["ワン", "カリナ"]);
    }
    expect(speakersOf([line("D01", "ミラー"), line("D02")])).toEqual([
      "ミラー",
    ]);
  });

  it("空会話:沒有說話者", () => {
    expect(speakersOf([])).toEqual([]);
  });
});

describe("buildPlayback", () => {
  const lines = [
    line("L24-D01", "標題"),
    line("L24-D02", "カリナ"),
    line("L24-D03", "ワン"),
    line("L24-D04", "カリナ"),
  ];

  it("不扮演:跳過標題行,其餘依序朗讀", () => {
    expect(buildPlayback(lines)).toEqual([
      { lineId: "L24-D02", action: "speak" },
      { lineId: "L24-D03", action: "speak" },
      { lineId: "L24-D04", action: "speak" },
    ]);
    expect(buildPlayback(lines, { role: null })).toEqual(buildPlayback(lines));
  });

  it("扮演:該說話者的台詞為 wait,其他人照常朗讀", () => {
    expect(buildPlayback(lines, { role: "カリナ" })).toEqual([
      { lineId: "L24-D02", action: "wait" },
      { lineId: "L24-D03", action: "speak" },
      { lineId: "L24-D04", action: "wait" },
    ]);
    expect(buildPlayback(lines, { role: "ワン" }).map((s) => s.action)).toEqual(
      ["speak", "wait", "speak"],
    );
  });

  it("扮演「標題」不會把標題行當台詞", () => {
    expect(buildPlayback(lines, { role: "標題" }).map((s) => s.lineId)).toEqual(
      ["L24-D02", "L24-D03", "L24-D04"],
    );
  });

  it("無標題的会話:第一行照常朗讀", () => {
    const plain = [line("L14-D01", "カリナ"), line("L14-D02", "運転手")];
    expect(buildPlayback(plain, { role: "運転手" })).toEqual([
      { lineId: "L14-D01", action: "speak" },
      { lineId: "L14-D02", action: "wait" },
    ]);
  });
});

describe("dialogue × 教材資料", () => {
  const lessonsDir = join(process.cwd(), "public", "data", "lessons");
  const lessons = readdirSync(lessonsDir)
    .filter((f) => f.endsWith(".json"))
    .map((f) =>
      LessonSchema.parse(
        JSON.parse(readFileSync(join(lessonsDir, f), "utf-8")),
      ),
    );

  it("標題行恰為 L15/L23/L24/L41 的 D01", () => {
    const titles = lessons.flatMap((l) =>
      l.dialogues.filter((d, i) => isTitleLine(d, i)).map((d) => d.id),
    );
    expect(titles.sort()).toEqual(["L15-D01", "L23-D01", "L24-D01", "L41-D01"]);
  });

  it("每課都有說話者可扮演;播放步驟 = 台詞行數(不含標題)", () => {
    for (const l of lessons) {
      const speakers = speakersOf(l.dialogues);
      expect(speakers.length, `L${l.id}`).toBeGreaterThanOrEqual(2);
      expect(
        speakers.some((s) => /標題/.test(s)),
        `L${l.id}`,
      ).toBe(false);
      const titleCount = l.dialogues.filter((d, i) => isTitleLine(d, i)).length;
      expect(buildPlayback(l.dialogues)).toHaveLength(
        l.dialogues.length - titleCount,
      );
    }
  });
});
