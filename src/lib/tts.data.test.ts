import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { LessonSchema, type VocabItem } from "@/schemas/lesson";
import { speechText } from "./tts";

// 以實際教材資料(public/data)驗證單字的朗讀文字:記號不送進 TTS。
const lessonsDir = join(process.cwd(), "public", "data", "lessons");
const vocab: VocabItem[] = readdirSync(lessonsDir)
  .filter((f) => f.endsWith(".json"))
  .flatMap(
    (f) =>
      LessonSchema.parse(JSON.parse(readFileSync(join(lessonsDir, f), "utf-8")))
        .vocab,
  );
const byId = new Map(vocab.map((v) => [v.id, v]));

function word(id: string): VocabItem {
  const v = byId.get(id);
  if (!v) throw new Error(`找不到 ${id}`);
  return v;
}

describe("speechText × 教材單字(T10.6)", () => {
  it("資料載入完整", () => {
    expect(vocab.length).toBeGreaterThan(2000);
  });

  it.each([
    ["L09-V003", "すき［な］", "すきな"], // ［な］保留內容
    ["L09-V043", "ざんねんです［ね］", "ざんねんですね"],
    ["L09-V031", "おっと／しゅじん", "おっと"], // ／ 只讀第一個候選
    ["L09-V033", "つま／かない", "つま"],
    ["L10-V041", "や〜など", "やなど"], // 〜 刪除
    ["L38-V029", "〜というほん", "というほん"],
    ["L44-V019", "…ばい", "ばい"], // … 刪除
    ["L49-V023", "…ねん…くみ", "ねんくみ"],
    ["L04-V050", "え―と", "えーと"], // ―(U+2015)→ 長音
    ["L17-V031", "に、さんにち", "にさんにち"], // 單字內的 、 不停頓
    ["L17-V032", "に、さん", "にさん"],
    ["L10-V047", "スパイス・コーナー", "スパイスコーナー"],
    // kana 串接了（）替代說法:改由 ruby 讀音只讀括號外
    ["L03-V016", "トイレおてあらい", "トイレ"],
    // 一般字:kana 原樣
    ["L13-V001", "あそびます", "あそびます"],
    ["L08-V015", "いい", "いい"],
    ["L33-V046", "きとく", "きとく"],
  ])("%s %s → %s", (id, kana, expected) => {
    const v = word(id);
    expect(v.kana).toBe(kana);
    expect(speechText(v)).toBe(expected);
  });

  it("每個字的朗讀文字都非空且只含假名(記號全數去除)", () => {
    const bad = vocab
      .map((v) => ({ id: v.id, text: speechText(v) }))
      .filter(({ text }) => !/^[ぁ-ゖァ-ヺーゝゞヽヾ]+$/.test(text))
      .map(({ id, text }) => `${id} ${text}`);
    expect(bad).toEqual([]);
  });
});
