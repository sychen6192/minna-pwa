import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { LessonSchema } from "@/schemas/lesson";
import { SLOW_TEST_TIMEOUT } from "@/test/timeouts";
import {
  conjClass,
  conjugate,
  conjugateByRule,
  formIntro,
  formsOf,
  isAdvancedForm,
  type ConjForm,
} from "./conjugate";
import {
  OPTION_COUNT,
  availableForms,
  checkDrillAnswer,
  drillPool,
  lessonHasDrill,
  makeDrillQuestion,
  makeDrillRound,
  wrongConjugations,
  type DrillItem,
} from "./drill";
import { normalizeReading } from "./quiz";

// 以實際教材資料(public/data)驗證活用練習的出題:全部可練的字 × 全部形。
const lessonsDir = join(process.cwd(), "public", "data", "lessons");
const lessons = readdirSync(lessonsDir)
  .filter((f) => f.endsWith(".json"))
  .map((f) =>
    LessonSchema.parse(JSON.parse(readFileSync(join(lessonsDir, f), "utf-8"))),
  );
const pool = drillPool(lessons, 50);

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

describe("出題池(全資料)", () => {
  it("動詞與形容詞、非補充、可活用;重列的字去重", () => {
    expect(pool.length).toBeGreaterThan(450);
    for (const v of pool) {
      expect(conjClass(v.pos)).not.toBeNull();
      expect(v.note).not.toBe("補充單字(自行練習發音)");
    }
    // 排除清單不在池中
    for (const id of [
      "L07-V006",
      "L32-V010",
      "L40-V055",
      "L47-V004",
      "L50-V010",
    ]) {
      expect(pool.some((v) => v.id === id)).toBe(false);
    }
    // 気が つきます(L31、L34)只留第 31 課
    expect(
      pool.filter((v) => v.kana === "きがつきます").map((v) => v.lessonId),
    ).toEqual([31]);
    // 目が覚めます(L30)/目が 覚めます(L45):只差空格,只留第 30 課
    expect(
      pool.filter((v) => v.kana === "めがさめます").map((v) => v.id),
    ).toEqual(["L30-V055"]);
  });

  it("第 1–3 課沒有可練的活用(第 4 課起才有動詞ます系);第 4–50 課皆有「活用練習」", () => {
    for (const l of lessons) expect(lessonHasDrill(l)).toBe(l.id >= 4);
    expect(drillPool(lessons, 3)).toEqual([]);
    expect(availableForms("verb", 3)).toEqual([]);
  });
});

describe("每個字 × 每一形(全資料)", () => {
  it(
    "錯誤選項不含該字任何依規則成立的形、不重複;選擇題 4 個選項、恰一個正解;正解的輸入判為對",
    () => {
      let questions = 0;
      /** 錯誤規則一個都沒有(全靠同字其他形補足)的題:只該是Ⅱ類的辞書形(食べる 沒有常見的錯誤規則) */
      const noRuleBased = new Set<string>();
      /** 選項表面文字相同、只差讀音(forceReading)的題 */
      const forced = new Set<string>();
      for (const v of pool) {
        /** 正確形的讀音 → 最早導入的課(Ⅱ類的可能形 = 被動形,取可能形的第 27 課) */
        const validLesson = new Map<string, number>();
        for (const f of formsOf(v.pos)) {
          const c = conjugate(v, f);
          const lesson = formIntro(v.pos, f)?.lesson;
          if (!c || lesson === undefined) continue;
          const key = normalizeReading(c.kana);
          validLesson.set(key, Math.min(lesson, validLesson.get(key) ?? 99));
        }
        // 錯誤選項連不練的形(わかれる、降れ…)也不可以是
        const valid = new Set(
          formsOf(v.pos).map((f) =>
            normalizeReading(conjugateByRule(v, f)?.kana ?? ""),
          ),
        );
        valid.add(normalizeReading(v.kana));
        // 動I/動II 的錯誤規則保留語幹:ます形去掉最後一音 + ます(います 這種沒有語幹者至少保留第一個音)
        const masu = normalizeReading(conjugate(v, "masu")?.kana ?? "");
        const stem = masu.slice(0, Math.max(1, masu.length - 3));
        // 進階形各有排除:只出能推導的(字, 形)
        for (const form of formsOf(v.pos).filter((f) => conjugate(v, f))) {
          const wrong = wrongConjugations(v, form);
          const keys = wrong.map((c) => normalizeReading(c.kana));
          expect(new Set(keys).size, `${v.id} ${form}`).toBe(keys.length);
          for (const k of keys) {
            expect(valid.has(k), `${v.id} ${form} ${k}`).toBe(false);
            if (v.pos === "動I" || v.pos === "動II")
              expect(k.startsWith(stem), `${v.id} ${form} ${k}`).toBe(true);
          }

          // 範圍取該形的導入課(最嚴:補足選項能用的形最少)
          const intro = formIntro(v.pos, form)?.lesson ?? 50;
          const q = makeDrillQuestion(v, form, "mcq", seeded(questions), intro);
          expect(q, `${v.id} ${form}`).not.toBeNull();
          if (!q) continue;
          questions++;
          if (form !== "masu" && wrong.length === 0)
            noRuleBased.add(`${v.pos}:${form}`);
          // て/た/ない/なかった 與形容詞各形:至少 2 個錯誤規則(ます系只有名詞句語尾 1–2 個);
          // 進階形至少 1 個(Ⅱ類的可能/命令/被動只有 ら抜き 等一種常見錯誤,另由易混淆的同字其他形補足)
          if (isAdvancedForm(form)) {
            expect(wrong.length, `${v.id} ${form}`).toBeGreaterThanOrEqual(1);
          } else if (
            !["masu", "masen", "mashita", "masendeshita", "dict"].includes(form)
          ) {
            expect(wrong.length, `${v.id} ${form}`).toBeGreaterThanOrEqual(2);
          }
          expect(q.options, `${v.id} ${form}`).toHaveLength(OPTION_COUNT);
          expect(q.options.filter((o) => o.correct)).toHaveLength(1);
          const optionKeys = q.options.map((o) => normalizeReading(o.kana));
          expect(new Set(optionKeys).size, `${v.id} ${form}`).toBe(
            OPTION_COUNT,
          );
          const accepted = new Set(
            q.accepted.map((a) => normalizeReading(a.kana)),
          );
          for (const o of q.options) {
            if (o.correct) continue;
            expect(accepted.has(normalizeReading(o.kana))).toBe(false);
            // 補足的正確形:範圍內已教過
            const lesson = validLesson.get(normalizeReading(o.kana));
            if (lesson !== undefined)
              expect(lesson, `${v.id} ${form} ← ${o.kana}`).toBeLessThanOrEqual(
                intro,
              );
          }
          // 表面文字相同的選項 ⇔ forceReading(選項與正解一律顯示讀音)
          const surfaces = q.options.map((o) =>
            o.ruby
              .map((seg) => seg.b)
              .join("")
              .replace(/\s+/g, ""),
          );
          expect(q.forceReading, `${v.id} ${form}`).toBe(
            new Set(surfaces).size < surfaces.length,
          );
          if (q.forceReading) forced.add(`${v.id}:${form}`);
          for (const a of q.accepted)
            expect(checkDrillAnswer(a.kana, q), `${v.id} ${form}`).toBe(true);
        }
      }
      expect(questions).toBeGreaterThan(6000);
      expect([...noRuleBased]).toEqual(["動II:dict"]);
      // 只差讀音的只有来る系(来ます、持って 来ます…)的て/た/ない/なかった/辞書形與全部進階形
      const kuru = pool.filter(
        (v) => v.pos === "動III" && /来$/.test(v.ruby.at(-2)?.b ?? ""),
      );
      expect(kuru.length).toBeGreaterThanOrEqual(4);
      expect([...forced].sort()).toEqual(
        kuru
          .flatMap((v) =>
            [
              "te",
              "nai",
              "dict",
              "ta",
              "nakatta",
              "potential",
              "volitional",
              "imperative",
              "prohibitive",
              "conditional",
              "passive",
              "causative",
            ].map((f) => `${v.id}:${f}`),
          )
          .sort(),
      );
    },
    SLOW_TEST_TIMEOUT, // 全部字 × 全部形的迴圈較久(單獨約 8 秒)
  );

  it(
    "一回合:範圍第 1–20 課、全部形 → 10 題且字不重複",
    () => {
      const upTo20 = drillPool(lessons, 20);
      const qs = makeDrillRound(
        upTo20,
        { verb: availableForms("verb", 20), adj: availableForms("iAdj", 20) },
        { rng: seeded(42) },
      );
      expect(qs).toHaveLength(10);
      expect(new Set(qs.map((q) => q.item.id)).size).toBe(10);
      for (const q of qs) expect(q.item.lessonId).toBeLessThanOrEqual(20);
    },
    SLOW_TEST_TIMEOUT, // 全部字 × 全部形的迴圈較久(單獨約 8 秒)
  );
});

describe("進階形(T11.5,全資料)", () => {
  const byId = (id: string): DrillItem => {
    const v = pool.find((x) => x.id === id);
    if (!v) throw new Error(`池中沒有 ${id}`);
    return v;
  };
  const seedRound = (items: readonly DrillItem[], forms: ConjForm[]) =>
    makeDrillRound(
      items,
      { verb: forms, adj: [] },
      { rng: seeded(5), count: 200 },
    );

  it("出題池以(字, 形)判斷:わかります 在池中,練て形但不出可能形、命令形", () => {
    const wakaru = byId("L09-V001");
    expect(
      seedRound([wakaru], ["te", "potential", "imperative"]).map((q) => q.form),
    ).toEqual(["te"]);
    expect(seedRound([wakaru], ["potential"])).toEqual([]);
    // 降ります〔雨が〜〕只練條件形
    const rain = byId("L14-V017");
    expect(
      seedRound(
        [rain],
        [
          "potential",
          "volitional",
          "imperative",
          "prohibitive",
          "conditional",
          "passive",
          "causative",
        ],
      ).map((q) => q.form),
    ).toEqual(["conditional"]);
  });

  it(
    "範圍第 1–27 課:可開放可能形,出的題皆為可推導的(字, 形)",
    () => {
      expect(availableForms("verb", 26)).not.toContain("potential");
      expect(availableForms("verb", 27)).toContain("potential");
      expect(availableForms("verb", 27)).not.toContain("volitional");
      const upTo27 = drillPool(lessons, 27);
      const qs = makeDrillRound(
        upTo27,
        { verb: ["potential"], adj: [] },
        { rng: seeded(7), maxLesson: 27, count: 200 },
      );
      expect(qs.length).toBe(
        upTo27.filter((v) => conjugate(v, "potential")).length,
      );
      expect(qs.some((q) => q.item.id === "L09-V001")).toBe(false); // わかります
      expect(qs.some((q) => q.item.id === "L18-V001")).toBe(false); // できます
      for (const q of qs) {
        expect(q.item.lessonId).toBeLessThanOrEqual(27);
        // 範圍內還沒教被動(L37)、使役(L48):不當作易混淆的選項
        for (const o of q.options.filter((x) => !x.correct)) {
          for (const f of ["passive", "causative"] as const) {
            expect(o.kana, `${q.item.id} ${f}`).not.toBe(
              conjugate(q.item, f)?.kana,
            );
          }
        }
      }
    },
    SLOW_TEST_TIMEOUT, // 全部字 × 全部形的迴圈較久(單獨約 8 秒)
  );

  it("第 50 課:動I 可能形的選項含被動形(書ける ↔ 書かれる)、使役形的選項含被動形(書かせる ↔ 書かれる)", () => {
    const kaku = byId("L06-V007");
    const kana = (form: ConjForm) =>
      makeDrillQuestion(kaku, form, "mcq", seeded(1), 50)?.options.map(
        (o) => o.kana,
      ) ?? [];
    expect(kana("potential")).toEqual(
      expect.arrayContaining(["かける", "かかれる"]),
    );
    expect(kana("causative")).toEqual(
      expect.arrayContaining(["かかせる", "かかれる"]),
    );
    expect(kana("passive")).toEqual(
      expect.arrayContaining(["かかれる", "かかせる"]),
    );
    // する:できる/される/させる 互為干擾
    const suru = byId("L04-V005");
    const suruKana = makeDrillQuestion(
      suru,
      "potential",
      "mcq",
      seeded(1),
      50,
    )?.options.map((o) => o.kana);
    expect(suruKana).toEqual(
      expect.arrayContaining(["べんきょうできる", "べんきょうされる"]),
    );
  });
});
