import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { LessonSchema, type Sentence } from "@/schemas/lesson";
import { buildPlayback, speakersOf } from "./dialogue";

function line(id: string, speaker?: string): Sentence {
  return { id, speaker, ruby: [{ b: "はい。" }], translation: "好的。" };
}

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

  it("不含無 speaker 或 speaker 為空白的行", () => {
    expect(
      speakersOf([line("D01"), line("D02", " "), line("D03", "ミラー")]),
    ).toEqual(["ミラー"]);
  });

  it("前後空白視為同一位說話者", () => {
    expect(speakersOf([line("D01", "ワン "), line("D02", "ワン")])).toEqual([
      "ワン",
    ]);
  });

  it("空会話:沒有說話者", () => {
    expect(speakersOf([])).toEqual([]);
  });
});

describe("buildPlayback", () => {
  const lines = [
    line("L24-D01", "カリナ"),
    line("L24-D02", "ワン"),
    line("L24-D03", "カリナ"),
  ];

  it("不扮演:每行依序朗讀(第一行照常;会話標題不在 dialogues 內)", () => {
    expect(buildPlayback(lines)).toEqual([
      { lineId: "L24-D01", action: "speak" },
      { lineId: "L24-D02", action: "speak" },
      { lineId: "L24-D03", action: "speak" },
    ]);
    expect(buildPlayback(lines, { role: null })).toEqual(buildPlayback(lines));
  });

  it("扮演:該說話者的台詞為 wait,其他人照常朗讀", () => {
    expect(buildPlayback(lines, { role: "カリナ" })).toEqual([
      { lineId: "L24-D01", action: "wait" },
      { lineId: "L24-D02", action: "speak" },
      { lineId: "L24-D03", action: "wait" },
    ]);
    expect(buildPlayback(lines, { role: "ワン" }).map((s) => s.action)).toEqual(
      ["speak", "wait", "speak"],
    );
  });

  it("扮演不存在的說話者:全部朗讀", () => {
    expect(
      buildPlayback(lines, { role: "ミラー" }).map((s) => s.action),
    ).toEqual(["speak", "speak", "speak"]);
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
    )
    .sort((a, b) => a.id - b.id);

  it("有会話標題(dialogueTitle)的課恰為 15、23、24、41", () => {
    expect(lessons.filter((l) => l.dialogueTitle).map((l) => l.id)).toEqual([
      15, 23, 24, 41,
    ]);
  });

  it("会話台詞 524 行(T12.4 前 528 行含 4 個標題行):每行都有 speaker,標題不在台詞中", () => {
    const lines = lessons.flatMap((l) => l.dialogues);
    expect(lines).toHaveLength(524);
    expect(lines.filter((d) => !d.speaker?.trim()).map((d) => d.id)).toEqual(
      [],
    );
    const surface = (s: Pick<Sentence, "ruby">) =>
      s.ruby.map((seg) => seg.b).join("");
    for (const l of lessons) {
      if (!l.dialogueTitle) continue;
      const title = surface(l.dialogueTitle);
      expect(
        l.dialogues.filter((d) => surface(d) === title).map((d) => d.id),
        `L${l.id}`,
      ).toEqual([]);
    }
  });

  it("每課都有說話者可扮演(沒有「標題」);播放步驟 = 台詞行數", () => {
    for (const l of lessons) {
      const speakers = speakersOf(l.dialogues);
      expect(speakers.length, `L${l.id}`).toBeGreaterThanOrEqual(2);
      expect(
        speakers.some((s) => /標題/.test(s)),
        `L${l.id}`,
      ).toBe(false);
      expect(buildPlayback(l.dialogues)).toHaveLength(l.dialogues.length);
    }
  });
});
