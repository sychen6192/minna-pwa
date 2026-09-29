import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { LessonSchema } from "@/schemas/lesson";
import { conjClass, conjugate, formIntro, formsOf } from "./conjugate";
import {
  OPTION_COUNT,
  availableForms,
  checkDrillAnswer,
  drillPool,
  lessonHasDrill,
  makeDrillQuestion,
  makeDrillRound,
  wrongConjugations,
} from "./drill";
import { normalizeReading } from "./quiz";

// 全部字 × 全部形的迴圈較久(單獨約 4 秒),verify 平行跑時放寬逾時
const SLOW = 30_000;

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
    "錯誤選項不含該字任何正確形、不重複;選擇題 4 個選項、恰一個正解;正解的輸入判為對",
    () => {
      let questions = 0;
      /** 錯誤規則一個都沒有(全靠同字其他形補足)的題:只該是Ⅱ類的辞書形(食べる 沒有常見的錯誤規則) */
      const noRuleBased = new Set<string>();
      /** 選項表面文字相同、只差讀音(forceReading)的題 */
      const forced = new Set<string>();
      for (const v of pool) {
        const validForm = new Map(
          formsOf(v.pos).map((f) => [
            normalizeReading(conjugate(v, f)?.kana ?? ""),
            f,
          ]),
        );
        const valid = new Set(validForm.keys());
        valid.add(normalizeReading(v.kana));
        // 動I/動II 的錯誤規則保留語幹:ます形去掉最後一音 + ます(います 這種沒有語幹者至少保留第一個音)
        const masu = normalizeReading(conjugate(v, "masu")?.kana ?? "");
        const stem = masu.slice(0, Math.max(1, masu.length - 3));
        for (const form of formsOf(v.pos)) {
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
          // て/た/ない/なかった 與形容詞各形:至少 2 個錯誤規則(ます系只有名詞句語尾 1–2 個)
          if (
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
            const f = validForm.get(normalizeReading(o.kana));
            if (f !== undefined)
              expect(
                formIntro(v.pos, f)?.lesson,
                `${v.id} ${form} ← ${f}`,
              ).toBeLessThanOrEqual(intro);
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
      expect(questions).toBeGreaterThan(4000);
      expect([...noRuleBased]).toEqual(["動II:dict"]);
      // 只差讀音的只有来る系(来ます、持って 来ます…)的て/た/ない/なかった/辞書形
      const kuru = pool.filter(
        (v) => v.pos === "動III" && /来$/.test(v.ruby.at(-2)?.b ?? ""),
      );
      expect(kuru.length).toBeGreaterThanOrEqual(4);
      expect([...forced].sort()).toEqual(
        kuru
          .flatMap((v) =>
            ["te", "nai", "dict", "ta", "nakatta"].map((f) => `${v.id}:${f}`),
          )
          .sort(),
      );
    },
    SLOW,
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
    SLOW,
  );
});
