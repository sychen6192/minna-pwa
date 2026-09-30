import { describe, expect, it } from "vitest";
import {
  findObjectById,
  objectSpanAt,
  replaceStringValue,
  stringToken,
} from "./rawJson";

/** 課程檔的兩種排版:單行 ruby(單字)與逐段換行 ruby(文法例句),另有帶 key 的物件 */
const RAW = `{
  "id": 1,
  "vocab": [
    {
      "id": "L01-V001",
      "ruby": [{ "b": "え―と" }],
      "kana": "え―と",
      "meaning": "嗯",
      "pos": "慣用"
    },
    {
      "id": "L01-V002",
      "ruby": [{ "b": "え―と" }, { "b": "え―と" }],
      "kana": "ええ",
      "meaning": "嗯",
      "pos": "慣用"
    }
  ],
  "grammar": [
    {
      "id": "L01-G01",
      "pattern": "N は N です",
      "explanation": "說明「\\"引號\\"」",
      "examples": [
        {
          "id": "L01-S01",
          "ruby": [
            { "b": "私", "r": "わたし" },
            { "b": "は マイク・ミラーです。" }
          ],
          "translation": "嗯"
        }
      ]
    }
  ],
  "dialogueTitle": {
    "ruby": [{ "b": "タイトル" }],
    "translation": "標題"
  },
  "dialogues": []
}
`;

const linesOf = () => RAW.split("\n");

describe("objectSpanAt / findObjectById", () => {
  it("以唯一的 id 行定位物件:首行為「{」、尾行為同縮排的「}」或「},」", () => {
    const lines = linesOf();
    const v1 = findObjectById(lines, "L01-V001");
    expect([lines[v1.open], lines[v1.close]]).toEqual(["    {", "    },"]);
    expect(lines[v1.open + 1]).toBe('      "id": "L01-V001",');
    const v2 = findObjectById(lines, "L01-V002");
    expect(lines[v2.close]).toBe("    }"); // 陣列最後一個元素沒有逗號
    expect(v2.open).toBe(v1.close + 1);
  });

  it("文法物件的範圍包含巢狀例句;例句物件只含自己", () => {
    const lines = linesOf();
    const g = findObjectById(lines, "L01-G01");
    const s = findObjectById(lines, "L01-S01");
    expect(g.open).toBeLessThan(s.open);
    expect(g.close).toBeGreaterThan(s.close);
    expect(lines.slice(s.open, s.close + 1).join("\n")).toContain(
      '"translation": "嗯"',
    );
  });

  it('帶 key 的物件開頭(`"dialogueTitle": {`)', () => {
    const lines = linesOf();
    const open = lines.indexOf('  "dialogueTitle": {');
    const span = objectSpanAt(lines, open);
    expect(lines[span.close]).toBe("  },");
    expect(span.close - span.open).toBe(3);
  });

  it("找不到、重複、前一行不是「{」或沒有結尾即丟錯", () => {
    const lines = linesOf();
    expect(() => findObjectById(lines, "L01-V999")).toThrow("0 處");
    const dup = [...lines, '      "id": "L01-V001",'];
    expect(() => findObjectById(dup, "L01-V001")).toThrow("2 處");
    const noOpen = linesOf();
    noOpen.splice(
      noOpen.indexOf('      "id": "L01-V001",'),
      0,
      '      "x": 1,',
    );
    expect(() => findObjectById(noOpen, "L01-V001")).toThrow("物件開頭");
    expect(() => findObjectById(['"id": "L01-V001",'], "L01-V001")).toThrow(
      "物件開頭",
    );
    expect(() => objectSpanAt(["    {", '      "id": "x",'], 0)).toThrow(
      "找不到結尾",
    );
  });

  it("CRLF 檔(以「\\n」切行後每行尾端留有 \\r)明確報換行格式,不誤報「不是物件開頭」", () => {
    const crlf = RAW.replace(/\n/g, "\r\n").split("\n");
    expect(() => findObjectById(crlf, "L01-V001")).toThrow(
      "第 4 行以 CR 結尾:課程檔為 CRLF 換行,請轉為 LF",
    );
    const title = crlf.indexOf('  "dialogueTitle": {\r');
    expect(() => objectSpanAt(crlf, title)).toThrow("CRLF 換行");
  });
});

describe("replaceStringValue", () => {
  it("只替換範圍內恰好一處,回傳行號;其他行逐位元不動", () => {
    const lines = linesOf();
    const at = replaceStringValue(
      lines,
      findObjectById(lines, "L01-V001"),
      "kana",
      "え―と",
      "えーと",
    );
    expect(lines[at]).toBe('      "kana": "えーと",');
    const before = linesOf();
    expect(lines.flatMap((l, i) => (l === before[i] ? [] : [i]))).toEqual([at]);
  });

  it("單行 ruby 的段:同一行的其他文字不動", () => {
    const lines = linesOf();
    const at = replaceStringValue(
      lines,
      findObjectById(lines, "L01-V001"),
      "b",
      "え―と",
      "えーと",
    );
    expect(lines[at]).toBe('      "ruby": [{ "b": "えーと" }],');
  });

  it("範圍內 0 處或多處即丟錯(不猜);範圍外的相同文字不計", () => {
    const lines = linesOf();
    const v1 = findObjectById(lines, "L01-V001");
    // 「"b": "え―と"」在 L01-V002 另有 2 處,不影響 L01-V001
    expect(() =>
      replaceStringValue(lines, v1, "meaning", "不存在", "x"),
    ).toThrow("0 處");
    const v2 = findObjectById(lines, "L01-V002");
    expect(() => replaceStringValue(lines, v2, "b", "え―と", "x")).toThrow(
      "2 處",
    );
    expect(lines).toEqual(linesOf());
  });

  it("整個 JSON 字串比對:值的前綴、別的 key 的同值都不算", () => {
    const lines = linesOf();
    const v1 = findObjectById(lines, "L01-V001");
    expect(() => replaceStringValue(lines, v1, "meaning", "嗯嗯", "x")).toThrow(
      "0 處",
    );
    expect(() => replaceStringValue(lines, v1, "pos", "え―と", "x")).toThrow(
      "0 處",
    );
  });

  it('字串以 JSON 編碼比對(跳脫的「"」);to 含 $& 等替換樣式時原樣寫入', () => {
    const lines = linesOf();
    const g = findObjectById(lines, "L01-G01");
    const at = replaceStringValue(
      lines,
      g,
      "explanation",
      '說明「"引號"」',
      "$&「$1」",
    );
    expect(lines[at]).toBe('      "explanation": "$&「$1」",');
    expect(JSON.parse(lines.join("\n")).grammar[0].explanation).toBe(
      "$&「$1」",
    );
  });

  it("stringToken 與課程檔的編碼一致", () => {
    expect(stringToken("b", "え―と")).toBe('"b": "え―と"');
    expect(stringToken("translation", 'a"b\\c')).toBe(
      '"translation": "a\\"b\\\\c"',
    );
  });
});
