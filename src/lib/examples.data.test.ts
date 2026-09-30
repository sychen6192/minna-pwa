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
  it("與 findExampleSentence 選同一句;exact 的位置處恰為單字表面形", () => {
    for (const l of lessons) {
      for (const v of l.vocab) {
        const m = findExampleMatch(v, l);
        expect(m?.sentence ?? null, v.id).toBe(findExampleSentence(v, l));
        if (m?.kind === "exact")
          expect(text(m.sentence.ruby).slice(m.start, m.end), v.id).toBe(
            text(v.ruby),
          );
      }
    }
  });
});

describe("動詞活用形 × 全部教材(T11.9)", () => {
  const matches = lessons.flatMap((l) =>
    l.vocab.flatMap((v) => {
      const m = findExampleMatch(v, l);
      return m ? [{ l, v, m }] : [];
    }),
  );
  const conjugated = matches.filter((x) => x.m.kind === "conjugated");
  const isVerb = (pos: string) => pos.startsWith("動");
  const marked = (vocabId: string) => {
    const x = matches.find((y) => y.v.id === vocabId);
    if (!x) return null;
    const t = text(x.m.sentence.ruby);
    return `${t.slice(0, x.m.start)}【${t.slice(x.m.start, x.m.end)}】${t.slice(x.m.end)}`;
  };

  it("有語境例句的動詞 42 → 141(ます形 42 + 活用形 99,記錄於 commit)", () => {
    const verbs = matches.filter((x) => isVerb(x.v.pos));
    expect(verbs.filter((x) => x.m.kind === "exact")).toHaveLength(42);
    expect(conjugated).toHaveLength(99);
    expect(verbs).toHaveLength(141);
  });

  it("活用形只配動詞,且只在全課沒有ます形命中時", () => {
    for (const { l, v } of conjugated) {
      expect(isVerb(v.pos), v.id).toBe(true);
      expect(
        findExampleMatch(v, l, ({ kind }) => kind === "exact"),
        v.id,
      ).toBeNull();
    }
  });

  it("活用形位於分かち書き的詞首,與單字同首字,且不是單字表面形本身", () => {
    for (const { v, m } of conjugated) {
      const t = text(m.sentence.ruby);
      const span = t.slice(m.start, m.end);
      expect(
        m.start === 0 || /[\s、。「…？！?!]/.test(t[m.start - 1]),
        v.id,
      ).toBe(true);
      expect(span[0], v.id).toBe(text(v.ruby)[0]);
      expect(span, v.id).not.toBe(text(v.ruby));
      expect(t, v.id).not.toContain("→");
    }
  });

  it("驗收:会います 命中「会いましょう」;L34 します、L46 出ます〔本〕不命中", () => {
    expect(marked("L06-V011")).toBe(
      "10時です。大阪城公園駅で 【会いましょう】。",
    );
    expect(exampleOf("L34-V007")).toBeNull(); // ✗「わたしが する とおりに、して くださいね。」
    expect(exampleOf("L46-V032")).toBeNull(); // ✗「たった 今 バスが 出た ところです。」
    expect(marked("L46-V004")).toBe("たった 今 バスが 【出た】 ところです。"); // ［バスが〜］
  });

  it.each([
    ["L14-V017", "雨が 【降って】 います。"],
    ["L17-V014", "薬を 【飲まなければ】 なりません。"],
    ["L17-V015", "それから 今晩は おふろに 【入らない】で ください。"],
    ["L19-V006", "寒く 【なりました】ね。"],
    ["L23-V001", "使い方が わからない とき、わたしに 【聞いて】 ください。"],
    ["L26-V031", "【燃えない】 ごみは 土曜日です。"],
    ["L29-V003", "電気が 【ついて】 います。"],
    ["L37-V001", "わたしは 先生に 【褒められました】。"],
    ["L37-V013", "日本の 車は 世界中へ 【輸出されて】 います。"],
    ["L41-V003", "わたしは 犬に えさを 【やりました】。"],
    ["L44-V003", "雨の 日は 洗濯物が 【乾きにくい】です。"],
    [
      "L45-V025",
      "いいえ、一生懸命練習したのに、【優勝できなくて】、残念です。",
    ],
    ["L50-V033", "子どもの ころの 夢が 【かなう】んですね。"],
  ])("新增的配對:%s %s", (id, expected) => {
    expect(marked(id)).toBe(expected);
  });

  it.each([
    ["L05-V002", "来ます(一字語幹、無 note)", "日本へ 来ました。"],
    [
      "L24-V004",
      "送ります［人を〜］(義項不同,依 id 排除)",
      "母は［わたしに］セーターを 送って くれました。",
    ],
    [
      "L26-V001",
      "見ます、診ます(一字語幹、note 無搭配名詞)",
      "…ちょっと 見て いただけませんか。",
    ],
  ])("不配活用形:%s %s ✗「%s」", (id) => {
    expect(exampleOf(id)).toBeNull();
  });
});
