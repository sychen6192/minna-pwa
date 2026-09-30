import type { Lesson, VocabItem } from "@/schemas/lesson";
import { SUPPLEMENT_NOTE } from "./notes";
import {
  ALSO_NATURAL,
  PARTICLES,
  PARTICLE_COUNT,
  MAX_WORD_FIRST,
  PARTICLE_OPTION_COUNT,
  collocationMeaning,
  collocationRuby,
  collocationSpeech,
  collocationText,
  collocationsOf,
  isWordFirst,
  makeParticleQuestion,
  makeParticleRound,
  parseCollocation,
  parseCollocations,
  particleOptions,
  particlePool,
  type Particle,
  type ParticleItem,
} from "./particles";

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

function vocab(
  id: string,
  ruby: VocabItem["ruby"],
  kana: string,
  note: string | undefined,
  pos: VocabItem["pos"] = "動I",
  meaning = "意思",
): VocabItem {
  return { id, ruby, kana, meaning, pos, ...(note ? { note } : {}) };
}

const SUU = vocab(
  "L06-V003",
  [{ b: "吸", r: "す" }, { b: "います" }],
  "すいます",
  "［たばこを〜］",
  "動I",
  "吸〔煙〕",
);
const SHUKUDAI = vocab(
  "L06-V038",
  [{ b: "宿題", r: "しゅくだい" }],
  "しゅくだい",
  "〔〜を します:做作業〕",
  "名",
  "作業",
);

function item(v: VocabItem, lessonId = 6): ParticleItem {
  return { ...v, lessonId, collocations: collocationsOf(v) };
}

describe("parseCollocation:只取 note 原文的搭配", () => {
  it("［…］、〔…〕兩種括號與無括號的寫法", () => {
    expect(parseCollocation("［たばこを〜］")).toEqual({
      noun: "たばこ",
      particle: "を",
      predicate: "〜",
    });
    expect(parseCollocation("〔電車に〜〕")).toEqual({
      noun: "電車",
      particle: "に",
      predicate: "〜",
    });
    expect(parseCollocation("〔右へ〜〕")?.particle).toBe("へ");
    expect(parseCollocation("〔男性と〜〕")?.particle).toBe("と");
    // 無括號、冒號後為中譯(L49-V012)
    expect(parseCollocation("〜を します:問候")).toEqual({
      noun: "〜",
      particle: "を",
      predicate: "します",
      gloss: "問候",
    });
  });

  it("〔〜を します〕型:單字本身在助詞前,述語取 note;冒號(半/全形)後為中譯,空格可省", () => {
    expect(parseCollocation("〔〜を します:做作業〕")).toEqual({
      noun: "〜",
      particle: "を",
      predicate: "します",
      gloss: "做作業",
    });
    expect(parseCollocation("〔〜を します〕")).toEqual({
      noun: "〜",
      particle: "を",
      predicate: "します",
    });
    expect(parseCollocation("〔〜をします:進行減肥〕")?.predicate).toBe(
      "します",
    );
    expect(parseCollocation("〔〜が でます:咳嗽〕")).toMatchObject({
      particle: "が",
      predicate: "でます",
    });
    expect(parseCollocation("〔〜を かきます:出汗〕")?.predicate).toBe(
      "かきます",
    );
  });

  it("〜之後還有 note 的後續;說明中的〔〕不影響", () => {
    expect(
      parseCollocation("〔コンピューターに〜が あります:〔對電腦〕感興趣〕"),
    ).toEqual({
      noun: "コンピューター",
      particle: "に",
      predicate: "〜が あります",
      gloss: "〔對電腦〕感興趣",
    });
  });

  it("括號內沒有〜的〔ワープロを〕;裸的說明文字不算", () => {
    expect(parseCollocation("〔ワープロを〕")).toEqual({
      noun: "ワープロ",
      particle: "を",
      predicate: "〜",
    });
    expect(parseCollocation("禮貌形:あの 方（かた）")).toBeNull();
    expect(parseCollocation("見ます、診ます")).toBeNull();
  });

  it("並列:各為一個搭配(括號並列、名詞以「／」並列)", () => {
    expect(
      parseCollocations("〔うちが〜〕〔パンが〜〕〔肉が〜〕").map(
        (c) => c.noun,
      ),
    ).toEqual(["うち", "パン", "肉"]);
    expect(parseCollocations("〔音／声が〜〕").map((c) => c.noun)).toEqual([
      "音",
      "声",
    ]);
    // 第一個
    expect(parseCollocation("〔病気が〜〕〔故障が〜〕")?.noun).toBe("病気");
  });

  it("［かな〜］［漢字〜］並列同一個名詞:合併為帶讀音的名詞", () => {
    expect(parseCollocations("［でんきが〜］［電気が〜］")).toEqual([
      { noun: "電気", reading: "でんき", particle: "が", predicate: "〜" },
    ]);
    // 助詞不同就不是同一個名詞的兩種寫法
    expect(parseCollocations("［みちが〜］［道を〜］")).toHaveLength(2);
  });

  it("無法解析回傳 null / []:段落標記、沒有助詞、〜不是單字本身、括號前綴、空值", () => {
    for (const note of [
      undefined,
      "",
      "読み物",
      "会話",
      SUPPLEMENT_NOTE,
      "接尾",
      "〔〜します:進行確認〕",
      "〔〜します：做準備〕",
      "〔〜の こと:〜的事〕",
      "［がくせいに］〜が あります:很受〔學生〕歡迎",
      "〔〜〕",
    ]) {
      expect(parseCollocation(note)).toBeNull();
      expect(parseCollocations(note)).toEqual([]);
    }
    // 並列中有一段無法解析:整筆不取
    expect(parseCollocations("〔パンが〜〕〔〜の こと〕")).toEqual([]);
  });

  it("選項以外的助詞(から/まで/より/の)排除;「学校まで〜」不會被切成 学校ま + で", () => {
    expect(parseCollocation("〔駅から〜〕")).toBeNull();
    expect(parseCollocation("〔学校まで〜〕")).toBeNull();
    expect(parseCollocation("〔兄より〜〕")).toBeNull();
    expect(parseCollocation("〔日本の〜〕")).toBeNull();
    // 名詞中含助詞字:取最短、緊接〜的切法
    expect(parseCollocation("〔かにを〜〕")?.noun).toBe("かに");
    expect(parseCollocation("〔学校で〜〕")).toMatchObject({
      noun: "学校",
      particle: "で",
    });
  });
});

describe("collocationsOf / particlePool", () => {
  it("〔〜を します〕只用於名詞單字;並列兩詞的單字(治ります、直ります)排除", () => {
    expect(collocationsOf(SHUKUDAI)).toHaveLength(1);
    expect(collocationsOf({ ...SHUKUDAI, pos: "動III" })).toEqual([]);
    const naorimasu = vocab(
      "L32-V010",
      [
        { b: "治", r: "なお" },
        { b: "ります、" },
        { b: "直", r: "なお" },
        { b: "ります" },
      ],
      "なおります",
      "〔病気が〜〕〔故障が〜〕",
    );
    expect(collocationsOf(naorimasu)).toEqual([]);
  });

  it("扣掉同義也自然的助詞(ALSO_NATURAL)後湊不滿 3 個干擾項:不出題", () => {
    expect(ALSO_NATURAL["L50-V027"]).toEqual(["を", "で"]);
    const toru = (id: string) =>
      vocab(
        id,
        [{ b: "撮", r: "と" }, { b: "ります" }],
        "とります",
        "〔ビデオに〜〕",
      );
    // に の干擾項只剩 が・と(へ 同格):不出題
    expect(collocationsOf(toru("L50-V027"))).toEqual([]);
    // 其他 id 的同一個 note 照常
    expect(collocationsOf(toru("L50-V999"))).toHaveLength(1);
  });

  it("範圍內、有搭配、非補充單字;不同課重列的同一個搭配只留最早的一筆", () => {
    const lessons: Lesson[] = [
      {
        id: 7,
        title: "第7課",
        vocab: [
          vocab(
            "L07-V001",
            [{ b: "吸", r: "す" }, { b: "います" }],
            "すいます",
            "［たばこを〜］",
          ),
          vocab("L07-V002", [{ b: "ワット" }], "ワット", SUPPLEMENT_NOTE, "名"),
        ],
        grammar: [],
        dialogues: [],
      },
      {
        id: 6,
        title: "第6課",
        vocab: [
          SUU,
          SHUKUDAI,
          vocab("L06-V010", [{ b: "本", r: "ほん" }], "ほん", undefined, "名"),
          vocab(
            "L06-V011",
            [{ b: "山田", r: "やまだ" }],
            "やまだ",
            SUPPLEMENT_NOTE,
            "名",
          ),
        ],
        grammar: [],
        dialogues: [],
      },
      {
        id: 9,
        title: "第9課",
        vocab: [
          vocab(
            "L09-V001",
            [{ b: "降", r: "ふ" }, { b: "ります" }],
            "ふります",
            "〔雨が〜〕",
          ),
        ],
        grammar: [],
        dialogues: [],
      },
    ];
    expect(particlePool(lessons, 8).map((v) => v.id)).toEqual([
      "L06-V003",
      "L06-V038",
    ]);
    const all = particlePool(lessons, 50);
    expect(all.map((v) => [v.id, v.lessonId])).toEqual([
      ["L06-V003", 6],
      ["L06-V038", 6],
      ["L09-V001", 9],
    ]);
    expect(particlePool(lessons, 5)).toEqual([]);
  });
});

describe("particleOptions:4 個選項、正解恰一個、不重複、依 PARTICLES 順序", () => {
  it.each([...PARTICLES])("正解 %s", (answer: Particle) => {
    for (let seed = 0; seed < 50; seed++) {
      const options = particleOptions(answer, seeded(seed));
      expect(options).toHaveLength(PARTICLE_OPTION_COUNT);
      expect(options.filter((p) => p === answer)).toHaveLength(1);
      expect(new Set(options).size).toBe(options.length);
      // PARTICLES 順序
      expect(options).toEqual(PARTICLES.filter((p) => options.includes(p)));
    }
  });

  it("方向的 に/へ 互不當干擾項", () => {
    for (let seed = 0; seed < 50; seed++) {
      expect(particleOptions("に", seeded(seed))).not.toContain("へ");
      expect(particleOptions("へ", seeded(seed))).not.toContain("に");
    }
  });

  it("に/へ 至多出現一個(兩個都在時正解必非二者,等於洩題);兩者仍都會當干擾項", () => {
    const shown = new Set<Particle>();
    for (const answer of PARTICLES) {
      for (let seed = 0; seed < 200; seed++) {
        const options = particleOptions(answer, seeded(seed));
        expect(options, `${answer} #${seed}`).not.toEqual(
          expect.arrayContaining(["に", "へ"]),
        );
        if (answer !== "に" && answer !== "へ")
          for (const p of options) if (p === "に" || p === "へ") shown.add(p);
      }
    }
    expect([...shown].sort()).toEqual(["に", "へ"].sort());
  });

  it("同義也自然的助詞(第 3 參數)不當干擾項;仍為 4 個選項", () => {
    for (let seed = 0; seed < 50; seed++) {
      const options = particleOptions("に", seeded(seed), ["と"]);
      expect(options).toHaveLength(PARTICLE_OPTION_COUNT);
      expect(options).not.toContain("と");
      // 候選恰 3 個(が・で・と;へ 與正解同格):全出
      expect(particleOptions("に", seeded(seed), ["を"])).toEqual([
        "に",
        "が",
        "で",
        "と",
      ]);
    }
  });

  it("干擾項由 rng 決定:同一個 rng 結果相同,不同 rng 會抽到不同組合", () => {
    expect(particleOptions("が", seeded(3))).toEqual(
      particleOptions("が", seeded(3)),
    );
    const sets = new Set(
      Array.from({ length: 30 }, (_, seed) =>
        particleOptions("が", seeded(seed)).join(""),
      ),
    );
    expect(sets.size).toBeGreaterThan(1);
    // rng 恆為 0:Fisher–Yates 每次與第 0 個交換
    expect(particleOptions("を", () => 0)).toEqual(["を", "が", "で", "へ"]);
  });
});

describe("makeParticleQuestion", () => {
  it("名詞在前:題幹 名詞（　）單字 的 ruby;完整搭配、朗讀、中譯", () => {
    const q = makeParticleQuestion(item(SUU), () => 0);
    expect(q.before).toEqual([{ b: "たばこ" }]);
    expect(q.after).toEqual([{ b: "吸", r: "す" }, { b: "います" }]);
    expect(q.answer).toBe("を");
    expect(q.options).toContain("を");
    expect(collocationRuby(q)).toEqual([
      { b: "たばこ" },
      { b: "を " },
      { b: "吸", r: "す" },
      { b: "います" },
    ]);
    expect(collocationText(q)).toBe("たばこを 吸います");
    expect(collocationSpeech(q)).toBe("たばこを すいます");
    expect(collocationMeaning(q)).toBe("吸〔煙〕");
  });

  it("〔〜を します〕:題幹 單字（　）します;中譯取 note 的說明", () => {
    const q = makeParticleQuestion(item(SHUKUDAI), () => 0);
    expect(q.before).toEqual([{ b: "宿題", r: "しゅくだい" }]);
    expect(q.after).toEqual([{ b: "します" }]);
    expect(collocationText(q)).toBe("宿題を します");
    expect(collocationSpeech(q)).toBe("しゅくだいを します");
    expect(collocationMeaning(q)).toBe("做作業");
  });

  it("〜之後的後續接在單字後;並列假名的名詞帶讀音", () => {
    const kyoumi = item(
      vocab(
        "L41-V011",
        [{ b: "興味", r: "きょうみ" }],
        "きょうみ",
        "〔コンピューターに〜が あります:〔對電腦〕感興趣〕",
        "名",
      ),
    );
    const q = makeParticleQuestion(kyoumi, () => 0);
    expect(q.after).toEqual([
      { b: "興味", r: "きょうみ" },
      { b: "が あります" },
    ]);
    expect(collocationText(q)).toBe("コンピューターに 興味が あります");
    expect(collocationSpeech(q)).toBe("コンピューターに きょうみが あります");

    const tsuku = item(
      vocab(
        "L29-V003",
        [{ b: "つきます" }],
        "つきます",
        "［でんきが〜］［電気が〜］",
      ),
    );
    const t = makeParticleQuestion(tsuku, () => 0);
    expect(t.before).toEqual([{ b: "電気", r: "でんき" }]);
    expect(collocationSpeech(t)).toBe("でんきが つきます");
  });

  it("教材並列多個名詞:以 rng 擇一", () => {
    const yakeru = item(
      vocab(
        "L39-V003",
        [{ b: "焼", r: "や" }, { b: "けます" }],
        "やけます",
        "〔うちが〜〕〔パンが〜〕〔肉が〜〕",
        "動II",
      ),
    );
    const nouns = new Set(
      Array.from({ length: 30 }, (_, seed) =>
        collocationText(makeParticleQuestion(yakeru, seeded(seed))),
      ),
    );
    expect([...nouns].sort()).toEqual(
      ["うちが 焼けます", "パンが 焼けます", "肉が 焼けます"].sort(),
    );
  });

  it("同義也自然的助詞不出現在選項(友達と 会います)", () => {
    const au = item(
      vocab(
        "L06-V011",
        [{ b: "会", r: "あ" }, { b: "います" }],
        "あいます",
        "［友達に〜］",
      ),
    );
    for (let seed = 0; seed < 50; seed++) {
      const q = makeParticleQuestion(au, seeded(seed));
      expect(q.answer).toBe("に");
      expect(q.options).toHaveLength(PARTICLE_OPTION_COUNT);
      expect(q.options).not.toContain("と");
    }
  });

  it("單字的可省略前綴［お］:讀音含お者顯示為お、不含者省略(題幹與朗讀一致)", () => {
    const hanami = item(
      vocab(
        "L06-V041",
        [{ b: "［お］" }, { b: "花見", r: "はなみ" }],
        "おはなみ",
        "〔〜を します:去賞花〕",
        "名",
      ),
    );
    const h = makeParticleQuestion(hanami, () => 0);
    expect(h.before).toEqual([{ b: "お" }, { b: "花見", r: "はなみ" }]);
    expect(collocationText(h)).toBe("お花見を します");
    expect(collocationSpeech(h)).toBe("おはなみを します");

    const shigoto = item(
      vocab(
        "L08-V042",
        [{ b: "［お］" }, { b: "仕事", r: "しごと" }],
        "しごと",
        "〔〜を します:工作〕",
        "名",
      ),
    );
    const s = makeParticleQuestion(shigoto, () => 0);
    expect(s.before).toEqual([{ b: "仕事", r: "しごと" }]);
    expect(collocationText(s)).toBe("仕事を します");
    expect(collocationSpeech(s)).toBe("しごとを します");
  });

  it("題目的 ruby 不共用單字的物件(改動題目不影響出題池)", () => {
    const it0 = item(SUU);
    const q = makeParticleQuestion(it0, () => 0);
    expect(q.after[0]).not.toBe(it0.ruby[0]);
  });
});

describe("makeParticleRound", () => {
  const pool = Array.from({ length: 15 }, (_, i) =>
    item({ ...SUU, id: `L06-V${String(i + 100).padStart(3, "0")}` }),
  );

  it("不重複抽 10 題;確定性(同一個 rng 同一組題目)", () => {
    const round = makeParticleRound(pool, { rng: seeded(1) });
    expect(round).toHaveLength(PARTICLE_COUNT);
    expect(new Set(round.map((q) => q.item.id)).size).toBe(PARTICLE_COUNT);
    expect(
      makeParticleRound(pool, { rng: seeded(1) }).map((q) => q.item.id),
    ).toEqual(round.map((q) => q.item.id));
  });

  it("〔〜を します〕型至多 2 題;其他搭配不足時才補", () => {
    const suru = (i: number) =>
      item({ ...SHUKUDAI, id: `L06-V${String(i + 200).padStart(3, "0")}` });
    const mixed = [
      ...pool.slice(0, 10),
      ...Array.from({ length: 10 }, (_, i) => suru(i)),
    ];
    for (let seed = 0; seed < 20; seed++) {
      const round = makeParticleRound(mixed, { rng: seeded(seed) });
      expect(round).toHaveLength(PARTICLE_COUNT);
      expect(
        round.filter((q) => isWordFirst(q.item)).length,
      ).toBeLessThanOrEqual(MAX_WORD_FIRST);
    }
    // 其他搭配只有 3 個:補 〔〜を します〕 到 10 題,且不集中在末尾
    const few = [
      ...pool.slice(0, 3),
      ...Array.from({ length: 10 }, (_, i) => suru(i)),
    ];
    const rounds = Array.from({ length: 20 }, (_, seed) =>
      makeParticleRound(few, { rng: seeded(seed) }),
    );
    for (const round of rounds) {
      expect(round).toHaveLength(PARTICLE_COUNT);
      expect(round.filter((q) => !isWordFirst(q.item))).toHaveLength(3);
    }
    expect(
      rounds.some((round) => round.slice(-7).some((q) => !isWordFirst(q.item))),
    ).toBe(true);
  });

  it("出題池不足:全部出;空池:空回合", () => {
    expect(
      makeParticleRound(pool.slice(0, 3), { rng: seeded(2) }),
    ).toHaveLength(3);
    expect(makeParticleRound([], { rng: seeded(2) })).toEqual([]);
    expect(makeParticleRound(pool, { count: 4, rng: seeded(2) })).toHaveLength(
      4,
    );
  });
});
