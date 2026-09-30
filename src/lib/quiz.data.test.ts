import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  LessonSchema,
  type Lesson,
  type RubySeg,
  type VocabItem,
} from "@/schemas/lesson";
import { isTitleLine } from "./dialogue";
import { isSupplementary } from "./notes";
import {
  acceptedAnswers,
  canInput,
  canListen,
  checkAnswer,
  generateQuiz,
  listenText,
  makeCloze,
  type QuestionType,
  type QuizCandidate,
} from "./quiz";
import { speechText } from "./tts";

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

// ── 聽力與例句填空 × 全部教材(T11.8)──────────────────────────────────

const lessons: Lesson[] = readdirSync(lessonsDir)
  .filter((f) => f.endsWith(".json"))
  .map((f) =>
    LessonSchema.parse(JSON.parse(readFileSync(join(lessonsDir, f), "utf-8"))),
  )
  .sort((a, b) => a.id - b.id);
const surface = (segs: RubySeg[]) => segs.map((s) => s.b).join("");
/** 出題對象:補充單字不出題 */
const targets = (l: Lesson) => l.vocab.filter((v) => !isSupplementary(v));

describe("例句填空 × 全部教材(T11.8)", () => {
  const clozes = lessons.flatMap((l) =>
    targets(l).flatMap((v) => {
      const cloze = makeCloze(v, l);
      return cloze ? [{ l, v, cloze }] : [];
    }),
  );

  it("可出填空的字數(記錄於 commit)與每課至少一字", () => {
    expect(clozes).toHaveLength(370);
    for (const l of lessons) {
      expect(
        clozes.filter((c) => c.l.id === l.id).length,
        `第 ${l.id} 課`,
      ).toBeGreaterThan(0);
    }
  });

  it("挖空處恰為單字表面形、同句只出現一次;前後段接回即原句", () => {
    for (const { l, v, cloze } of clozes) {
      const sentence = [
        ...l.grammar.flatMap((g) => g.examples),
        ...l.dialogues,
      ].find((s) => s.id === cloze.sentenceId);
      const word = surface(v.ruby);
      const text = sentence ? surface(sentence.ruby) : "";
      expect(surface(cloze.before) + word + surface(cloze.after), v.id).toBe(
        text,
      );
      expect(text.split(word), v.id).toHaveLength(2);
      // 未拆開帶讀音的漢字段:前後段的漢字段都是原句的完整段
      for (const seg of [...cloze.before, ...cloze.after]) {
        if (seg.r !== undefined)
          expect(sentence?.ruby, v.id).toContainEqual(seg);
      }
    }
  });

  it("不出慣用語;不選含→的對照行、会話標題行與較晚課次的例句", () => {
    expect(clozes.filter((c) => c.v.pos === "慣用")).toEqual([]);
    for (const { l, v, cloze } of clozes) {
      expect(surface(cloze.before) + surface(cloze.after), v.id).not.toContain(
        "→",
      );
      expect(cloze.translation, v.id).not.toMatch(/第\s*\d+\s*課[）)]\s*$/);
      const titleIds = l.dialogues
        .filter((line, i) => isTitleLine(line, i))
        .map((line) => line.id);
      expect(titleIds, v.id).not.toContain(cloze.sentenceId);
    }
  });
});

describe("聽力題 × 全部教材(T11.8)", () => {
  const all = lessons.flatMap(targets);
  const listenable = all.filter(canListen);

  it("可出聽力題的字數(記錄於 commit);排除的是 kana 含記號或表面含〜…者", () => {
    expect(listenable).toHaveLength(1988);
    for (const v of all.filter((w) => !canListen(w))) {
      expect(
        /[^ぁ-ゖァ-ヺー]/.test(v.kana) || /[〜…]/.test(surface(v.ruby)),
        v.id,
      ).toBe(true);
    }
  });

  it("朗讀文字不含教材記號;不讀表面形時讀 kana", () => {
    for (const v of listenable) {
      const text = listenText(v);
      expect(text, v.id).not.toMatch(/[［］〔〕（）〜…／]/);
      if (!/[㐀-鿿々]/.test(text)) expect(text, v.id).toBe(speechText(v));
    }
  });

  it("教材中同一表面形有不同讀音者(降ります、開きます…)一律讀 kana", () => {
    const readings = new Map<string, Set<string>>();
    for (const v of listenable) {
      const key = speechText(surface(v.ruby));
      readings.set(key, (readings.get(key) ?? new Set()).add(v.kana));
    }
    const homographs = listenable.filter(
      (v) => (readings.get(speechText(surface(v.ruby)))?.size ?? 0) > 1,
    );
    // 單一漢字(何、方)本來就讀 kana;降ります、開きます 列於 READ_KANA_SURFACES
    expect([...new Set(homographs.map((v) => surface(v.ruby)))].sort()).toEqual(
      ["何", "方", "降ります", "開きます"].sort(),
    );
    for (const v of homographs) expect(listenText(v), v.id).toBe(speechText(v));
  });
});

describe("聽力、填空的干擾項 × 教材:可互換的字不同時出現(T11.8)", () => {
  /** 同 QuizRunner:目標課 + 前後兩課 */
  const poolFor = (id: number): QuizCandidate[] =>
    lessons
      .filter((l) => Math.abs(l.id - id) <= 2)
      .flatMap((l) => l.vocab.map((v) => ({ ...v, lessonId: l.id })));
  /** 同時當選項會都算對的字(中譯分不出來、禮貌形、同義) */
  const pairs: [number, string, string][] = [
    [2, "それ", "あれ"],
    [3, "どこ", "どちら"],
    [3, "ここ", "こちら"],
    [3, "あそこ", "あちら"],
    [3, "あそこ", "そちら"],
    [3, "あそこ", "そこ"],
    [3, "あちら", "そちら"],
    [10, "中", "奥"],
    [29, "袋", "ポケット"],
    [49, "では", "それでは"],
  ];

  it.each([["cloze"], ["listen"]] as QuestionType[][])("%s", (type) => {
    let checked = 0;
    for (const lessonId of [...new Set(pairs.map(([id]) => id))]) {
      const lesson = lessons.find((l) => l.id === lessonId);
      for (let seed = 1; seed <= 30; seed++) {
        let x = seed;
        const rng = () => ((x = (x * 16807) % 2147483647) - 1) / 2147483646;
        const qs = generateQuiz(lessonId, poolFor(lessonId), {
          types: [type],
          lesson,
          listenAvailable: true,
          rng,
        });
        for (const q of qs) {
          if (q.type === "input") continue;
          const shown = q.options.map((o) => surface(o.candidate.ruby));
          for (const [id, a, b] of pairs) {
            if (id !== lessonId) continue;
            const answer = surface(q.answer.ruby);
            if (answer !== a && answer !== b) continue;
            checked++;
            expect(shown, `${type} ${answer}`).not.toContain(
              answer === a ? b : a,
            );
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(100);
  });
});
