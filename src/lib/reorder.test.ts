import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  LessonSchema,
  type Lesson,
  type RubySeg,
  type Sentence,
} from "@/schemas/lesson";
import {
  FIX_ENDS_MIN_CHUNKS,
  REORDER_COUNT,
  REORDER_EXCLUDED_IDS,
  answerOrder,
  checkOrder,
  chunkRuby,
  chunkText,
  isReorderable,
  lessonHasReorder,
  makeReorderItem,
  makeReorderRound,
  misplacedPositions,
  pickedTexts,
  promptText,
  reorderPool,
  surfaceText,
} from "./reorder";

// 以教材實際資料(public/data)的句子驗證:切塊依據的是資料的分かち書き空格
const lessons = new Map<number, Lesson>();
function lesson(id: number): Lesson {
  let l = lessons.get(id);
  if (!l) {
    const file = join(
      process.cwd(),
      "public",
      "data",
      "lessons",
      `L${String(id).padStart(2, "0")}.json`,
    );
    l = LessonSchema.parse(JSON.parse(readFileSync(file, "utf-8")));
    lessons.set(id, l);
  }
  return l;
}

/** 依 id 取句子;会話另回傳在会話中的 index(isTitleLine 判斷用) */
function find(id: string): { sentence: Sentence; index?: number } {
  const l = lesson(Number(id.slice(1, 3)));
  for (const g of l.grammar) {
    const s = g.examples.find((e) => e.id === id);
    if (s) return { sentence: s };
  }
  const index = l.dialogues.findIndex((d) => d.id === id);
  if (index < 0) throw new Error(`找不到 ${id}`);
  return { sentence: l.dialogues[index], index };
}
const sentence = (id: string) => find(id).sentence;
const texts = (id: string) => chunkRuby(sentence(id).ruby).map(chunkText);
const reorderable = (id: string) => {
  const { sentence: s, index } = find(id);
  return isReorderable(s, index);
};

/** 切塊不變式:各段 b 串接、無讀音段去掉半形空格(帶 r 的段原樣) */
const withoutBoundarySpaces = (segs: readonly RubySeg[]) =>
  segs.map((s) => (s.r ? s.b : s.b.replaceAll(" ", ""))).join("");

/** 合成句:教材中沒有切塊後含重複塊的可出題句,以此驗證重複塊 */
const HAI: Sentence = {
  id: "X-S01",
  ruby: [{ b: "はい、はい、わかりました。" }],
  translation: "好的好的,我知道了。",
};

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

describe("chunkRuby", () => {
  it("L36-S06:依空格與「、」切塊,「、」附在前一塊", () => {
    expect(texts("L36-S06")).toEqual([
      "太りましたから、",
      "好きな",
      "服が",
      "着られなく",
      "なりました。",
    ]);
  });

  it("接回一致:各塊文字串接 = 原句表面去掉無讀音段的半形空格(L14、L36 全部句子)", () => {
    for (const id of [14, 36]) {
      const l = lesson(id);
      for (const s of [
        ...l.grammar.flatMap((g) => g.examples),
        ...l.dialogues,
      ]) {
        const chunks = chunkRuby(s.ruby);
        expect(chunks.map(chunkText).join("")).toBe(
          withoutBoundarySpaces(s.ruby),
        );
        // 沒有空塊、塊內沒有空格
        for (const c of chunks) {
          expect(chunkText(c)).not.toBe("");
          expect(chunkText(c)).not.toContain(" ");
        }
      }
    }
    // 空格只是塊的邊界:L36-S06 原句有 4 個空格、切成 5 塊
    const s06 = sentence("L36-S06");
    expect(surfaceText(s06.ruby)).toBe(
      "太りましたから、好きな 服が 着られなく なりました。",
    );
    expect(texts("L36-S06").join("")).toBe(
      "太りましたから、好きな服が着られなくなりました。",
    );
  });

  it("帶 r 的段不拆:以同一物件、依原順序各出現在恰好一塊中", () => {
    for (const id of ["L36-S06", "L14-S15", "L14-S18"]) {
      const segs = sentence(id).ruby;
      const chunks = chunkRuby(segs);
      const rubySegs = segs.filter((s) => s.r);
      expect(rubySegs.length).toBeGreaterThan(0);
      // 同一物件(未複製/切開),順序不變
      const inChunks = chunks.flat().filter((s) => s.r);
      expect(inChunks).toHaveLength(rubySegs.length);
      inChunks.forEach((s, i) => expect(s).toBe(rubySegs[i]));
    }
    // 読み方:兩個漢字段(読/方)之間沒有空格,留在同一塊
    const yomikata = chunkRuby(sentence("L14-S15").ruby)[3];
    expect(chunkText(yomikata)).toBe("読み方を");
    expect(yomikata.filter((s) => s.r).map((s) => s.r)).toEqual(["よ", "かた"]);
  });

  it("L14-S15:「すみませんが、」後接空格也只切一次", () => {
    expect(texts("L14-S15")).toEqual([
      "すみませんが、",
      "この",
      "漢字の",
      "読み方を",
      "教えて",
      "ください。",
    ]);
  });

  it("只由記號組成的片段不單獨成塊:開頭「…」與開括號併入下一塊,句尾「……。」併入前一塊", () => {
    expect(texts("L14-S20")).toEqual(["…はい、", "降って", "います。"]);
    expect(texts("L28-S08").at(-1)).toBe("あるし、……。");
    // 資料為「これは 「 ９ 」 ですか、「 ７ 」 ですか。」:數字與前後的括號一起併入下一塊
    expect(texts("L02-S11")).toEqual([
      "これは",
      "「９」ですか、",
      "「７」ですか。",
    ]);
  });

  it("待併入下一塊的片段後面接記號:記號也跟著併入下一塊,不插到前一塊(字序不變)", () => {
    const cases: [RubySeg[], string[]][] = [
      [[{ b: "これは 「 」 です。" }], ["これは", "「」です。"]],
      [
        [{ b: "銀行から お " }, { b: "…" }, { b: " 金を 借りました。" }],
        ["銀行から", "お…金を", "借りました。"],
      ],
    ];
    for (const [segs, expected] of cases) {
      const chunks = chunkRuby(segs).map(chunkText);
      expect(chunks).toEqual(expected);
      expect(chunks.join("")).toBe(withoutBoundarySpaces(segs));
    }
  });

  it("抽取痕跡的空格不成塊:單獨的 お/ご、英數字併入下一塊", () => {
    // 資料為「銀行から お 金を 借りました。」
    expect(texts("L07-S15")).toEqual(["銀行から", "お金を", "借りました。"]);
    // 「、お 先に」:「、」後的 お 也併入下一塊
    expect(texts("L39-S10")).toEqual([
      "用事が",
      "あるので、",
      "お先に",
      "失礼します。",
    ]);
    expect(texts("L50-S04")).toEqual(["江戸東京博物館へ", "ご案内します。"]);
    // 資料為「[課長]、[今]お [忙]しいですか。」:漢字段後緊接的 お 是下一個詞的前綴
    expect(texts("L48-D01")).toEqual(["課長、", "今", "お忙しいですか。"]);
    // 資料為「…新幹線で 2 時間半 かかります。」「銀行は 9 時から 3 時までです。」
    expect(texts("L11-S13")).toEqual(["…新幹線で", "2時間半", "かかります。"]);
    expect(texts("L04-S21")).toEqual(["銀行は", "9時から", "3時までです。"]);
    // 千分位逗號
    expect(texts("L42-S20")).toEqual([
      "うちを",
      "建てるのに",
      "3,000万円も",
      "必要なんですか。",
    ]);
    // 電話號碼、英文字母後的「の」「です」也不是語塊的開頭
    expect(texts("L04-S26")).toEqual([
      "山田さんの",
      "電話番号は",
      "871の",
      "6813です。",
    ]);
    expect(texts("L04-D04")).toEqual([
      "お問い合わせの",
      "番号は",
      "0797の",
      "38の",
      "5432です。",
    ]);
    expect(texts("L03-S13")).toEqual(["…IMCの", "コンピューターです。"]);
  });

  it("抽取痕跡的空格不成塊:片假名或促音收尾、後接漢字的片段併入下一塊(複合詞、人名 + 稱謂)", () => {
    expect(texts("L08-S10")).toEqual(["ワント先生は", "親切な", "先生です。"]);
    expect(texts("L11-S17")[0]).toBe("パワー電気に");
    expect(texts("L50-S13")[0]).toBe("…パワー電気の");
    expect(texts("L25-S09")).toEqual([
      "安くても、",
      "わたしは",
      "グループ旅行が",
      "嫌いです。",
    ]);
    expect(texts("L27-S14")[2]).toBe("アメリカ人の");
    expect(texts("L42-S02")).toEqual([
      "引っ越しの",
      "ために、",
      "車を",
      "借ります。",
    ]);
    // 併回後只剩 2 塊:不出題
    expect(texts("L27-S22")).toEqual(["ローマ字しか", "書けません。"]);
    expect(reorderable("L27-S22")).toBe(false);
    // 只有片假名、後接假名(不是漢字)時不併
    expect(chunkRuby([{ b: "パン ください。" }]).map(chunkText)).toEqual([
      "パン",
      "ください。",
    ]);
  });
});

describe("isReorderable", () => {
  it("3–8 塊、句末一個標點的例句與台詞可出題(L14、L36)", () => {
    for (const id of [
      "L36-S06",
      "L14-S15",
      "L14-S18",
      "L14-S19",
      "L14-S20",
      "L14-S30",
      "L14-D08",
    ]) {
      expect(reorderable(id)).toBe(true);
    }
  });

  it("排除 1–2 塊的句子", () => {
    expect(texts("L14-D04")).toEqual(["右ですね。"]);
    expect(reorderable("L14-D04")).toBe(false);
    expect(texts("L14-D01")).toEqual(["梅田まで", "お願いします。"]);
    expect(reorderable("L14-D01")).toBe(false);
  });

  it("排除 9 塊以上的句子;8 塊可出題", () => {
    expect(texts("L30-S14")).toHaveLength(9);
    expect(reorderable("L30-S14")).toBe(false);
    expect(texts("L39-S12")).toHaveLength(8);
    expect(reorderable("L39-S12")).toBe(true);
  });

  it("排除含「→」的活用對照行(12 行);L19-S08 切成 3 塊又沒有句末標點,只有「→」規則擋得住", () => {
    const arrows = [
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
    ];
    for (const id of arrows) {
      expect(surfaceText(sentence(id).ruby)).toContain("→");
      expect(reorderable(id)).toBe(false);
    }
    expect(texts("L19-S08")).toEqual(["寒い→", "寒く", "なります"]);
  });

  it("排除会話標題行(L41-D01 若不是標題行則可出題)", () => {
    const { sentence: title } = find("L41-D01");
    expect(isReorderable(title, 0)).toBe(false);
    expect(isReorderable(title)).toBe(true); // 3 塊、無句末標點:只有標題規則擋得住
    for (const id of ["L15-D01", "L23-D01", "L24-D01"]) {
      expect(reorderable(id)).toBe(false);
    }
  });

  it("排除多句的会話行(句末標點不只一個或不在句尾)", () => {
    // すみません。あの 信号を 右へ 曲がって ください。
    expect(reorderable("L14-D03")).toBe(false);
    // 3,200円の お釣りです。ありがとう ございました。
    expect(reorderable("L14-D11")).toBe(false);
  });

  it("排除對話者標記(Ａ:)、教材記號(［ ］〔 〕（ ）／)與外文片語", () => {
    expect(texts("L14-S23")[0]).toBe("Ｂ:ええ、");
    expect(reorderable("L14-S23")).toBe(false);
    // 冬休みは どこか［へ］ 行きましたか。
    expect(reorderable("L13-S17")).toBe(false);
    // わたしは 息子に お菓子を やりました（あげました）。
    expect(reorderable("L41-S01")).toBe(false);
    // 「Thank you」は 日本語で 何ですか。
    expect(reorderable("L07-S05")).toBe(false);
  });

  it("詞被切開、規則併不回來的句子排除(REORDER_EXCLUDED_IDS)", () => {
    expect(texts("L08-S15").slice(0, 2)).toEqual(["さくら", "大学は"]);
    expect(texts("L28-S10")).toContain("さくら");
    expect(texts("L50-S14").slice(0, 2)).toEqual(["お飲み", "物は"]);
    expect([...REORDER_EXCLUDED_IDS]).toEqual([
      "L08-S15",
      "L28-S10",
      "L50-S14",
    ]);
    for (const id of REORDER_EXCLUDED_IDS) expect(reorderable(id)).toBe(false);
  });

  it("以「…」開頭的答句與沒有句末標點的名詞修飾片語保留", () => {
    expect(reorderable("L36-S08")).toBe(true); // …いいえ、まだ 弾けません。
    expect(texts("L22-S01")).toEqual(["京都へ", "行く", "人"]);
    expect(reorderable("L22-S01")).toBe(true);
  });

  it("可移動的塊只有一種文字時排除(打亂不出不同順序)", () => {
    // 6 塊固定首尾,中間 4 塊文字相同
    const same: Sentence = {
      id: "X-S01",
      ruby: [{ b: "ええ、はい、はい、はい、はい、どうぞ。" }],
      translation: "好好好。",
    };
    expect(chunkRuby(same.ruby).map(chunkText)).toEqual([
      "ええ、",
      "はい、",
      "はい、",
      "はい、",
      "はい、",
      "どうぞ。",
    ]);
    expect(isReorderable(same)).toBe(false);
    // 中間有兩種文字即可
    const two: Sentence = {
      ...same,
      ruby: [{ b: "ええ、はい、はい、いいえ、はい、どうぞ。" }],
    };
    expect(isReorderable(two)).toBe(true);
  });
});

describe("makeReorderItem", () => {
  it("5 塊以下:全部打亂;打亂後的順序一定與原句不同", () => {
    const s = sentence("L36-S06");
    const original = texts("L36-S06");
    for (let seed = 1; seed <= 200; seed++) {
      const item = makeReorderItem(s, seeded(seed));
      expect(item.fixedEnds).toBe(false);
      expect([...item.shuffled].sort()).toEqual([0, 1, 2, 3, 4]);
      const shuffledTexts = item.shuffled.map((i) => item.chunks[i].text);
      expect(shuffledTexts).not.toEqual(original);
    }
  });

  it(`${FIX_ENDS_MIN_CHUNKS} 塊以上:首塊與句尾塊固定,只打亂中間`, () => {
    const s = sentence("L14-S15");
    for (let seed = 1; seed <= 100; seed++) {
      const item = makeReorderItem(s, seeded(seed));
      expect(item.fixedEnds).toBe(true);
      expect([...item.shuffled].sort()).toEqual([1, 2, 3, 4]);
      expect(item.shuffled).not.toEqual([1, 2, 3, 4]);
    }
  });

  it("洗出原順序時確定性地改為左移一位", () => {
    // 每次都回傳接近 1 的值:Fisher–Yates 的 j 恆等於 i,洗牌結果 = 原順序
    const identity = () => 0.999999;
    const a = makeReorderItem(sentence("L36-S06"), identity);
    expect(a.shuffled).toEqual([1, 2, 3, 4, 0]);
    const b = makeReorderItem(sentence("L36-S06"), identity);
    expect(b.shuffled).toEqual(a.shuffled);
    const fixed = makeReorderItem(sentence("L14-S15"), identity);
    expect(fixed.shuffled).toEqual([2, 3, 4, 1]);
  });

  it("重複的塊:文字相同的互換後仍等於原句時也改為左移", () => {
    // 洗牌 = 兩個「はい、」互換(index 順序不同、文字順序與原句相同)
    const rng = (() => {
      const values = [0.999999, 0];
      let i = 0;
      return () => values[i++ % values.length];
    })();
    const item = makeReorderItem(HAI, rng);
    // Fisher–Yates 得 [1, 0, 2](文字順序同原句)→ 左移一位
    expect(item.shuffled).toEqual([0, 2, 1]);
    const original = item.chunks.map((c) => c.text);
    expect(
      answerOrder(item, item.shuffled).map((i) => item.chunks[i].text),
    ).not.toEqual(original);
  });
});

describe("checkOrder / misplacedPositions", () => {
  it("依原句順序排入為正解;任兩塊對調即為錯,並指出位置", () => {
    const item = makeReorderItem(sentence("L36-S06"), seeded(1));
    const correct = pickedTexts(item, [0, 1, 2, 3, 4]);
    expect(correct).toEqual(texts("L36-S06"));
    expect(checkOrder(correct, item)).toBe(true);
    expect(misplacedPositions(correct, item)).toEqual([]);

    const swapped = pickedTexts(item, [0, 2, 1, 3, 4]);
    expect(checkOrder(swapped, item)).toBe(false);
    expect(misplacedPositions(swapped, item)).toEqual([1, 2]);
  });

  it("重複的塊以文字比對:文字相同的兩塊互換位置仍判為正解", () => {
    expect(isReorderable(HAI)).toBe(true);
    const item = makeReorderItem(HAI, seeded(3));
    expect(item.chunks.map((c) => c.text)).toEqual([
      "はい、",
      "はい、",
      "わかりました。",
    ]);
    // 兩個「はい、」以相反的 index 排入
    expect(checkOrder(pickedTexts(item, [1, 0, 2]), item)).toBe(true);
    expect(misplacedPositions(pickedTexts(item, [1, 0, 2]), item)).toEqual([]);
    // 排錯則判錯,只標出錯的格(兩個「はい、」任一個在第 1 格都算對)
    const wrong = [1, 2, 0];
    expect(checkOrder(pickedTexts(item, wrong), item)).toBe(false);
    expect(misplacedPositions(pickedTexts(item, wrong), item)).toEqual([1, 2]);
  });

  it("長度不同(未排完)不算正解", () => {
    const item = makeReorderItem(sentence("L36-S06"), seeded(1));
    expect(checkOrder(pickedTexts(item, [0, 1, 2, 3]), item)).toBe(false);
  });
});

describe("reorderPool / makeReorderRound", () => {
  it("L14:文型例句與会話中可出題者,依教材順序", () => {
    expect(reorderPool(lesson(14)).map((s) => s.id)).toEqual([
      "L14-S15",
      "L14-S16",
      "L14-S18",
      "L14-S19",
      "L14-S20",
      "L14-S21",
      "L14-S29",
      "L14-S30",
      "L14-D07",
      "L14-D08",
    ]);
    expect(lessonHasReorder(lesson(14))).toBe(true);
  });

  it("同一課中表面文字相同的重列句只留第一句", () => {
    const l = lesson(36);
    const ids = reorderPool(l).map((s) => s.id);
    // L36-D04 與 L36-S11 同一句(毎日 運動して、何でも 食べるように して います。)
    expect(ids).toContain("L36-S11");
    expect(ids).not.toContain("L36-D04");
    expect(isReorderable(l.dialogues[3], 3)).toBe(true);
  });

  it(`一回合至多 ${REORDER_COUNT} 題、不重複;本課較少時照實際句數`, () => {
    const round = makeReorderRound(lesson(14), { rng: seeded(5) });
    expect(round).toHaveLength(REORDER_COUNT);
    expect(new Set(round.map((r) => r.sentence.id)).size).toBe(REORDER_COUNT);
    // 同一 rng 結果確定
    expect(
      makeReorderRound(lesson(14), { rng: seeded(5) }).map(
        (r) => r.sentence.id,
      ),
    ).toEqual(round.map((r) => r.sentence.id));

    const few = reorderPool(lesson(3));
    expect(few.length).toBeLessThan(REORDER_COUNT);
    expect(makeReorderRound(lesson(3), { rng: seeded(1) })).toHaveLength(
      few.length,
    );
  });

  it("中譯標示較晚課次的例句不在本課出題;標示本課或較早課次的保留", () => {
    // L14-S17 ぜひ 遊びに 来て ください。(第25課)
    expect(reorderable("L14-S17")).toBe(true);
    expect(reorderPool(lesson(14)).map((s) => s.id)).not.toContain("L14-S17");
    // L04-S15(第 5 課)、L04-S19(第 11 課)
    const l04 = reorderPool(lesson(4)).map((s) => s.id);
    expect(l04).not.toContain("L04-S15");
    expect(l04).not.toContain("L04-S19");
    expect(l04).toContain("L04-S18");
    // L25-S15(第18課)、L25-S17(第25課)
    const l25 = reorderPool(lesson(25)).map((s) => s.id);
    expect(l25).toContain("L25-S15");
    expect(l25).toContain("L25-S17");
  });

  it("沒有可出題句子的課:回合為空、不給入口", () => {
    const empty: Lesson = { ...lesson(14), grammar: [], dialogues: [] };
    expect(lessonHasReorder(empty)).toBe(false);
    expect(makeReorderRound(empty)).toEqual([]);
  });
});

describe("promptText", () => {
  it("去掉句尾的課次參照,其餘保留", () => {
    expect(promptText("請一定來玩。（第25課）")).toBe("請一定來玩。");
    expect(promptText("7 月 2 日來了日本。(第 5 課)")).toBe(
      "7 月 2 日來了日本。",
    );
    expect(promptText("過度的減肥對身體並不好哦！（第 19 課）")).toBe(
      "過度的減肥對身體並不好哦！",
    );
    expect(promptText("…沒空。（男女都說）")).toBe("…沒空。（男女都說）");
  });
});
