import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { LessonSchema, type VocabItem } from "@/schemas/lesson";
import { isSupplementary } from "./notes";
import { acceptedAnswers, canInput, checkAnswer } from "./quiz";

// 以實際教材資料(public/data)驗證輸入題判分:每個字照資料的讀音作答都要判對。
const lessonsDir = join(process.cwd(), "public", "data", "lessons");
const vocab: VocabItem[] = readdirSync(lessonsDir)
  .filter((f) => f.endsWith(".json"))
  .flatMap(
    (f) =>
      LessonSchema.parse(JSON.parse(readFileSync(join(lessonsDir, f), "utf-8")))
        .vocab,
  );

/** 去掉可省略括號(保留內容)後依「／」拆開:使用者照資料打字會輸入的樣子 */
const typedForms = (s: string) => s.replace(/[［］〔〕]/g, "").split("／");

describe("輸入題判分 × 全部教材單字(T10.4)", () => {
  it("資料載入完整", () => {
    expect(vocab.length).toBeGreaterThan(2000);
  });

  it("每個字都至少有一個可輸入的答案", () => {
    expect(
      vocab.filter((v) => acceptedAnswers(v).length === 0).map((v) => v.id),
    ).toEqual([]);
  });

  it("照 kana 作答皆判對;唯一例外是 kana 串接了（）替代說法的 L03-V016(DQ-02 資料問題)", () => {
    const rejected = vocab
      .filter((v) => typedForms(v.kana).some((form) => !checkAnswer(form, v)))
      .map((v) => `${v.id} ${v.kana}`);
    expect(rejected).toEqual(["L03-V016 トイレおてあらい"]);
  });

  it("照 ruby 讀音(r ?? b 串接)作答皆判對;例外皆屬設計上不收的整串照抄", () => {
    const rejected = vocab
      .filter((v) => v.ruby.some((s) => s.r !== undefined))
      .filter((v) => {
        const reading = v.ruby.map((s) => s.r ?? s.b).join("");
        // 含數字/英文字母的讀音(2、3日)無法以假名輸入,不列入
        return typedForms(reading).some(
          (form) => !/[0-9A-Za-z０-９]/.test(form) && !checkAnswer(form, v),
        );
      })
      .map((v) => v.id);
    expect(rejected).toEqual([
      "L03-V016", // トイレ（おてあらい）:（）是替代說法,トイレ、おてあらい 各自判對,連打不算
      "L03-V039", // 「〜を」みせて ください:「〜を」是語境,答案是 みせてください
      "L08-V017", // 暑い、熱い(あつい、あつい):同讀音並列,答 あつい
      "L09-V040", // 早く、速く
      "L12-V004", // 速い、早い
      "L12-V008", // 暖かい、温かい
      "L32-V010", // 治ります、直ります
      "L33-V046", // キトク（きとく）:同上（）替代說法
    ]);
  });

  it("可出輸入題的字:題幹(隱藏假名)有被遮住的讀音(漢字或數字),且不等於任何答案", () => {
    for (const v of vocab.filter(canInput)) {
      const surface = v.ruby.map((s) => s.b).join("");
      expect(
        v.ruby.some((s) => s.r !== undefined && /[^ぁ-ゖァ-ヺー]/.test(s.b)),
        v.id,
      ).toBe(true);
      for (const a of acceptedAnswers(v)) expect(surface, v.id).not.toBe(a);
    }
  });

  it("每課扣除補充單字後仍有可出輸入題的字", () => {
    const lessonIds = new Set(vocab.map((v) => v.id.slice(0, 3)));
    for (const l of lessonIds) {
      const eligible = vocab.filter(
        (v) => v.id.startsWith(l) && !isSupplementary(v) && canInput(v),
      );
      expect(eligible.length, l).toBeGreaterThan(0);
    }
  });
});
