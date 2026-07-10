import { describe, expect, it } from "vitest";
import { insertAccents, matchAccent, parseAccents } from "./enrich-accents";

/** 測試用迷你 kanjium 辭典(表記\t讀音\t重音;純假名詞讀音欄為空) */
const DICT_TEXT = [
  "銀行\tぎんこう\t0",
  "先生\tせんせい\t3",
  "一\tいち\t2",
  "一\tひと\t0,2", // 多值取第一個
  "橋\tはし\t2", // はし 三兄弟:讀音歧義 → 不可用讀音層
  "箸\tはし\t1",
  "端\tはし\t0",
  "傘\tかさ\t1", // かさ 讀音無歧義 → 可用讀音層
  "テレビ\t\t1", // 純假名詞:讀音欄空
  "蚊\tか\t9", // 壞資料:重音超出拍數
].join("\n");

const dict = parseAccents(DICT_TEXT);

function vocab(ruby: { b: string; r?: string }[], kana: string, pos: string) {
  return { ruby, kana, pos };
}

describe("parseAccents + matchAccent 分層配對", () => {
  it("T1 精確配對:表記+讀音", () => {
    expect(matchAccent(vocab([{ b: "銀行", r: "ぎんこう" }], "ぎんこう", "名"), dict)).toEqual({
      accent: 0,
      tier: "exact",
    });
  });

  it("T1 純假名詞:片假名表記直接命中(讀音正規化比對)", () => {
    expect(matchAccent(vocab([{ b: "テレビ" }], "テレビ", "名"), dict)).toEqual({
      accent: 1,
      tier: "exact",
    });
  });

  it("多重音值取第一個(最常用)", () => {
    expect(matchAccent(vocab([{ b: "一", r: "ひと" }], "ひと", "名"), dict)).toEqual({
      accent: 0,
      tier: "exact",
    });
  });

  it("T2 ます規則:動詞ます形核在「ま」= 拍數-1(kanjium 不收ます形)", () => {
    expect(
      matchAccent(vocab([{ b: "行", r: "い" }, { b: "きます" }], "いきます", "動I"), dict),
    ).toEqual({ accent: 3, tier: "masu" });
  });

  it("T2 ます規則:單詞慣用句(表面無空格)適用", () => {
    expect(
      matchAccent(vocab([{ b: "違", r: "ちが" }, { b: "います。" }], "ちがいます", "慣用"), dict),
    ).toEqual({ accent: 4, tier: "masu" });
  });

  it("T2 排除:多詞慣用句(表面含空格)無單一重音核", () => {
    expect(
      matchAccent(
        vocab([{ b: "また 今度 お願いします。" }], "またこんどおねがいします", "慣用"),
        dict,
      ),
    ).toEqual({ tier: "miss" });
  });

  it("T2 排除:含を的動詞片語不標整句", () => {
    expect(
      matchAccent(vocab([{ b: "勉強をします" }], "べんきょうをします", "動III"), dict),
    ).toEqual({ tier: "miss" });
  });

  it("T4 讀音層:所有同音詞重音一致才採用", () => {
    expect(matchAccent(vocab([{ b: "かさ" }], "かさ", "名"), dict)).toEqual({
      accent: 1,
      tier: "reading",
    });
  });

  it("T4 排除:同音詞重音不一致(はし)寧缺勿錯", () => {
    expect(matchAccent(vocab([{ b: "はし" }], "はし", "名"), dict)).toEqual({ tier: "miss" });
  });

  it("防禦:重音超出拍數的壞資料一律拒絕", () => {
    expect(matchAccent(vocab([{ b: "蚊", r: "か" }], "か", "名"), dict)).toEqual({
      tier: "miss",
    });
  });
});

/** 模擬 pipeline 產出的課程 JSON 序列化樣式 */
const RAW = `{
  "id": 1,
  "title": "テスト",
  "vocab": [
    {
      "id": "L01-V001",
      "ruby": [{ "b": "わたし" }],
      "kana": "わたし",
      "meaning": "我",
      "pos": "名"
    },
    {
      "id": "L01-V002",
      "ruby": [{ "b": "本", "r": "ほん" }],
      "kana": "ほん",
      "meaning": "書",
      "pos": "名"
    }
  ],
  "grammar": [],
  "dialogues": []
}
`;

describe("insertAccents 手術式插入", () => {
  it("在對應 kana 行後插入 accent 行;未命中者不動", () => {
    const out = insertAccents(RAW, [0, undefined]);
    expect(out).toContain('      "kana": "わたし",\n      "accent": 0,');
    const parsed = JSON.parse(out) as {
      vocab: { accent?: number }[];
    };
    expect(parsed.vocab[0].accent).toBe(0);
    expect(parsed.vocab[1].accent).toBeUndefined();
  });

  it("除 accent 外不改動任何既有行(格式保持)", () => {
    const out = insertAccents(RAW, [0, 1]);
    const originalLines = RAW.split("\n");
    const outLines = out.split("\n").filter((l) => !/^\s*"accent": \d+,$/.test(l));
    expect(outLines).toEqual(originalLines);
  });

  it("重跑冪等:既有 accent 行會先清除再依新結果插入", () => {
    const first = insertAccents(RAW, [0, 1]);
    const second = insertAccents(first, [undefined, 2]);
    const parsed = JSON.parse(second) as { vocab: { accent?: number }[] };
    expect(parsed.vocab[0].accent).toBeUndefined();
    expect(parsed.vocab[1].accent).toBe(2);
  });

  it("kana 行數與 vocab 數不符 → 丟錯(防資料形變)", () => {
    expect(() => insertAccents(RAW, [0])).toThrow();
  });
});
