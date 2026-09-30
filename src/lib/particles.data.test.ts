import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { LessonSchema } from "@/schemas/lesson";
import { isSupplementary } from "./notes";
import {
  ALSO_NATURAL,
  MAX_WORD_FIRST,
  PARTICLES,
  PARTICLE_COUNT,
  PARTICLE_FIRST_LESSON,
  WORD_MARK,
  collocationText,
  isWordFirst,
  makeParticleQuestion,
  makeParticleRound,
  parseCollocations,
  particlePool,
  type Particle,
} from "./particles";

// 以實際教材資料(public/data)驗證助詞搭配的解析與出題池:全部 50 課的單字 note。
const lessonsDir = join(process.cwd(), "public", "data", "lessons");
const lessons = readdirSync(lessonsDir)
  .filter((f) => f.endsWith(".json"))
  .map((f) =>
    LessonSchema.parse(JSON.parse(readFileSync(join(lessonsDir, f), "utf-8"))),
  );
const vocab = lessons.flatMap((l) => l.vocab);

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

function countBy<T>(list: readonly T[], key: (t: T) => string) {
  const out: Record<string, number> = {};
  for (const t of list) out[key(t)] = (out[key(t)] ?? 0) + 1;
  return out;
}

/** 各助詞的筆數不少於實測值(資料修正可能增加,不應減少) */
function expectAtLeast(
  counts: Record<string, number>,
  expected: Record<string, number>,
) {
  for (const [particle, n] of Object.entries(expected))
    expect(counts[particle] ?? 0, particle).toBeGreaterThanOrEqual(n);
}

describe("助詞搭配(全資料)", () => {
  it("50 課齊全", () => {
    expect(lessons.map((l) => l.id)).toEqual(
      Array.from({ length: 50 }, (_, i) => i + 1),
    );
  });

  it("可解析的 note:171 筆(名詞在前 141:を 45、が 62、に 32、へ 1、と 1;〔〜を します〕型 30:を 29、が 1)", () => {
    const parsed = vocab
      .map((v) => ({ v, cs: parseCollocations(v.note) }))
      .filter(({ cs }) => cs.length > 0);
    // 資料修正(pipeline 重跑)可能增加可解析的筆數,不應減少
    expect(parsed.length).toBeGreaterThanOrEqual(171);
    const nounFirst = parsed.filter(({ cs }) => cs[0].noun !== WORD_MARK);
    const wordFirst = parsed.filter(({ cs }) => cs[0].noun === WORD_MARK);
    expect(nounFirst.length).toBeGreaterThanOrEqual(141);
    expect(wordFirst.length).toBeGreaterThanOrEqual(30);
    expectAtLeast(
      countBy(nounFirst, ({ cs }) => cs[0].particle),
      {
        を: 45,
        が: 62,
        に: 32,
        へ: 1,
        と: 1,
      },
    );
    expectAtLeast(
      countBy(wordFirst, ({ cs }) => cs[0].particle),
      {
        を: 29,
        が: 1,
      },
    );
    // 同一 note 並列的搭配助詞一致(教材並列的是名詞)
    for (const { cs } of parsed)
      expect(new Set(cs.map((c) => c.particle)).size).toBe(1);
  });

  it("含〜卻不出題的 note 恰為:沒有助詞(〜します)4 筆、〜不是單字本身 1 筆、括號前綴 1 筆", () => {
    const unparsed = vocab
      .filter((v) => v.note?.includes(WORD_MARK))
      .filter((v) => parseCollocations(v.note).length === 0);
    expect(unparsed.map((v) => [v.id, v.note])).toEqual([
      ["L16-V045", "〔〜します:進行確認〕"],
      ["L23-V018", "〔〜します:發生故障〕"],
      ["L24-V011", "〔〜します：做準備〕"],
      ["L25-V012", "〔〜します:調職〕"],
      ["L25-V013", "〔〜の こと:〜的事〕"],
      ["L28-V016", "［がくせいに］〜が あります:很受〔學生〕歡迎"],
    ]);
  });

  it("出題池(第 1–50 課):169 個(去掉並列兩詞的 L32-V010、干擾項不足的 L50-V027;を 74、が 62、に 31、へ 1、と 1,教材 note 沒有 で 的搭配);補充單字不在其中", () => {
    const pool = particlePool(lessons, 50);
    expect(pool.length).toBeGreaterThanOrEqual(169);
    expect(pool.some((v) => v.id === "L32-V010")).toBe(false);
    expect(pool.some((v) => v.id === "L50-V027")).toBe(false);
    expect(pool.some((v) => isSupplementary(v))).toBe(false);
    expectAtLeast(
      countBy(pool, (v) => v.collocations[0].particle),
      {
        を: 74,
        が: 62,
        に: 31,
        へ: 1,
        と: 1,
      },
    );
    // 並列的搭配:焼けます(うち/パン/肉)、します(音/声)
    expect(
      pool
        .filter((v) => v.collocations.length > 1)
        .map((v) => [v.id, v.collocations.map((c) => c.noun)]),
    ).toEqual([
      ["L39-V003", ["うち", "パン", "肉"]],
      ["L47-V004", ["音", "声"]],
    ]);
    // ［でんきが〜］［電気が〜］型:漢字名詞帶讀音
    expect(
      pool
        .filter((v) => v.collocations[0].reading !== undefined)
        .map((v) => {
          const c = v.collocations[0];
          return `${c.noun}(${c.reading})`;
        }),
    ).toEqual([
      "電気(でんき)",
      "電気(でんき)",
      "道(みち)",
      "道(みち)",
      "木(き)",
      "紙(かみ)",
      "服(ふく)",
    ]);
  });

  it(`範圍:第 ${PARTICLE_FIRST_LESSON} 課起才有;池隨範圍遞增`, () => {
    expect(particlePool(lessons, PARTICLE_FIRST_LESSON - 1)).toEqual([]);
    expect(particlePool(lessons, PARTICLE_FIRST_LESSON).length).toBeGreaterThan(
      0,
    );
    const sizes = [6, 14, 20, 30, 40, 50].map(
      (n) => particlePool(lessons, n).length,
    );
    expect(sizes).toEqual([...sizes].sort((a, b) => a - b));
    // 預設範圍(第 1–14 課)可組成一整回合
    expect(particlePool(lessons, 14).length).toBeGreaterThanOrEqual(
      PARTICLE_COUNT,
    );
  });

  it("ALSO_NATURAL:id 對得上有搭配的單字,列的助詞都不是教材搭配的助詞;這些助詞不出現在選項", () => {
    const byId = new Map(vocab.map((v) => [v.id, v]));
    const pool = particlePool(lessons, 50);
    for (const [id, particles] of Object.entries(ALSO_NATURAL)) {
      const v = byId.get(id);
      expect(v, id).toBeDefined();
      const cs = parseCollocations(v?.note);
      expect(cs.length, id).toBeGreaterThan(0);
      for (const c of cs) expect(particles, id).not.toContain(c.particle);
      const item = pool.find((p) => p.id === id);
      // 干擾項不足者不出題(L50-V027),其餘都在出題池
      if (id === "L50-V027") {
        expect(item, id).toBeUndefined();
        continue;
      }
      expect(item, id).toBeDefined();
      if (!item) continue;
      for (let seed = 0; seed < 50; seed++) {
        const q = makeParticleQuestion(item, seeded(seed));
        expect(q.options).toHaveLength(4);
        for (const p of particles) expect(q.options, id).not.toContain(p);
      }
    }
  });

  it("每一題:選項 4 個、正解恰一個、不重複、に/へ 至多一個;題幹的名詞與述語非空、不含記號〜與［］", () => {
    const pool = particlePool(lessons, 50);
    for (const [i, item] of pool.entries()) {
      const q = makeParticleQuestion(item, seeded(i));
      expect(q.options).toHaveLength(4);
      expect(q.options.filter((p) => p === q.answer)).toHaveLength(1);
      expect(new Set(q.options).size).toBe(4);
      expect(
        q.options.every((p) => (PARTICLES as readonly Particle[]).includes(p)),
      ).toBe(true);
      expect(q.before.length).toBeGreaterThan(0);
      expect(q.after.length).toBeGreaterThan(0);
      expect(
        q.options.filter((p) => p === "に" || p === "へ").length,
      ).toBeLessThanOrEqual(1);
      expect(collocationText(q)).not.toContain(WORD_MARK);
      expect(collocationText(q)).not.toMatch(/[［］]/);
      // 完整搭配:名詞 + 助詞 + 空格 + 述語
      expect(collocationText(q)).toMatch(new RegExp(`^\\S+${q.answer} \\S`));
    }
  });

  it("回合:10 題、不重複;預設範圍(第 1–14 課,〔〜を します〕型占 15/32)每回合至多 2 題該型", () => {
    const round = makeParticleRound(particlePool(lessons, 50), {
      rng: seeded(7),
    });
    expect(round).toHaveLength(PARTICLE_COUNT);
    expect(new Set(round.map((q) => q.item.id)).size).toBe(PARTICLE_COUNT);

    const early = particlePool(lessons, 14);
    expect(early.filter(isWordFirst)).toHaveLength(15);
    for (let seed = 0; seed < 20; seed++) {
      const r = makeParticleRound(early, { rng: seeded(seed) });
      expect(r).toHaveLength(PARTICLE_COUNT);
      expect(r.filter((q) => isWordFirst(q.item)).length).toBeLessThanOrEqual(
        MAX_WORD_FIRST,
      );
    }
  });
});
