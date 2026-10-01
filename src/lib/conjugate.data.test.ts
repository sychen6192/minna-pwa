import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  LessonSchema,
  type RubySeg,
  type Sentence,
  type VocabItem,
} from "@/schemas/lesson";
import {
  ADVANCED_VERB_FORMS,
  BASIC_ADJ_FORMS,
  BASIC_VERB_FORMS,
  CONJUGATION_EXCLUDED,
  FORM_INTRO,
  TEXTBOOK_NO_FORM,
  VERB_FORMS,
  basicFormsOf,
  conjClass,
  conjugate,
  conjugateByRule,
  formsOf,
  isConjugable,
  type AdvancedVerbForm,
  type ConjForm,
  type Conjugated,
} from "./conjugate";
import {
  FORM_EXCLUSION_ID_COUNT,
  FORM_EXCLUSIONS,
} from "./conjugateExclusions";

// 以實際教材資料(public/data)驗證活用引擎:教材對照行、例外、全部動詞/形容詞。
const lessonsDir = join(process.cwd(), "public", "data", "lessons");
const lessons = readdirSync(lessonsDir)
  .filter((f) => f.endsWith(".json"))
  .map((f) =>
    LessonSchema.parse(JSON.parse(readFileSync(join(lessonsDir, f), "utf-8"))),
  );
const vocab: VocabItem[] = lessons.flatMap((l) => l.vocab);
const examples: Sentence[] = lessons.flatMap((l) =>
  l.grammar.flatMap((g) => g.examples),
);
const grammarIds = new Set(lessons.flatMap((l) => l.grammar.map((g) => g.id)));
const byId = new Map(vocab.map((v) => [v.id, v]));
/** 動詞與形容詞 */
const conjugable = vocab.filter((v) => conjClass(v.pos) !== null);

function word(id: string): VocabItem {
  const v = byId.get(id);
  if (!v) throw new Error(`找不到 ${id}`);
  return v;
}

/** ruby 的精簡表示:以「|」分段,漢字段寫成「漢字(よみ)」 */
function compact(ruby: readonly RubySeg[]): string {
  return ruby.map((s) => (s.r ? `${s.b}(${s.r})` : s.b)).join("|");
}

function conj(id: string, form: ConjForm): Conjugated {
  const c = conjugate(word(id), form);
  if (!c) throw new Error(`${id} ${form} 無法活用`);
  return c;
}

const show = (id: string, form: ConjForm) => compact(conj(id, form).ruby);
const kana = (id: string, form: ConjForm) => conj(id, form).kana;
const surfaceOf = (ruby: readonly RubySeg[]) => ruby.map((s) => s.b).join("");

describe("教材活用對照行(golden)", () => {
  /**
   * 「A → B」行切成左右兩半:去掉語幹分隔「-」(かき-ます)、兩端空白與空段,
   * 相鄰假名段合併(與 conjugate 的輸出格式一致)。
   */
  function splitArrow(s: Sentence): [RubySeg[], RubySeg[]] {
    const i = s.ruby.findIndex((seg) => seg.b.includes("→"));
    const [before, after] = s.ruby[i].b.split("→");
    const tidy = (segs: RubySeg[]): RubySeg[] => {
      const out: RubySeg[] = [];
      segs.forEach((seg, k) => {
        let b = seg.b.replace(/-/g, "");
        if (k === 0) b = b.trimStart();
        if (k === segs.length - 1) b = b.trimEnd();
        if (b === "") return;
        const prev = out[out.length - 1];
        if (seg.r === undefined && prev && prev.r === undefined) prev.b += b;
        else out.push(seg.r === undefined ? { b } : { b, r: seg.r });
      });
      return out;
    };
    return [
      tidy([...s.ruby.slice(0, i), { b: before }]),
      tidy([{ b: after }, ...s.ruby.slice(i + 1)]),
    ];
  }

  // 對照行 → 對應單字與形;L19 的「〜く/に なります」比對連用形 + なります
  const GOLDEN: [string, string, ConjForm, string][] = [
    ["L14-S11", "L06-V007", "te", ""], // かきます → かいて
    ["L14-S12", "L05-V001", "te", ""], // いきます → いって(例外)
    ["L14-S13", "L06-V001", "te", ""], // たべます → たべて
    ["L14-S14", "L05-V002", "te", ""], // きます → きて
    ["L17-S01", "L06-V007", "nai", ""], // かき-ます → かか-ない
    ["L17-S02", "L05-V002", "nai", ""], // き-ます → こ-ない
    ["L19-S08", "L08-V018", "adv", " なります"], // 寒い → 寒く なります
    ["L19-S09", "L08-V007", "adv", " なります"], // 元気［な］ → 元気に なります
  ];
  /** 使役對照行(T11.5):右邊是使役動詞的ます形(L48-G01 使役動詞依Ⅱ類活用) */
  const GOLDEN_CAUSATIVE: [string, string][] = [
    ["L48-S01", "L05-V001"], // 行きます → 行かせます
    ["L48-S02", "L06-V001"], // 食べます → 食べさせます
    ["L48-S03", "L05-V002"], // 来ます → 来(こ)させます
  ];
  const sentence = new Map(examples.map((s) => [s.id, s]));

  it("含「→」的例句恰為 golden 8 行 + 使役 3 行 + 名詞(L19-S10)", () => {
    const arrowRows = examples
      .filter((s) => s.ruby.some((seg) => seg.b.includes("→")))
      .map((s) => s.id);
    expect(arrowRows.sort()).toEqual(
      [
        ...GOLDEN.map(([sid]) => sid),
        ...GOLDEN_CAUSATIVE.map(([sid]) => sid),
        "L19-S10",
      ].sort(),
    );
  });

  it.each(GOLDEN_CAUSATIVE)("%s:%s 的使役形(ます形)", (sid, vid) => {
    const s = sentence.get(sid);
    if (!s) throw new Error(`找不到 ${sid}`);
    const [left, right] = splitArrow(s);
    expect(compact(left)).toBe(compact(word(vid).ruby));
    // 辞書形(〜させる)→ ます形(〜させます)
    expect(show(vid, "causative").replace(/る$/, "ます")).toBe(compact(right));
  });

  it.each(GOLDEN)("%s:%s 的 %s", (sid, vid, form, suffix) => {
    const s = sentence.get(sid);
    if (!s) throw new Error(`找不到 ${sid}`);
    const [left, right] = splitArrow(s);
    const v = word(vid);
    const out = conj(vid, form);
    const expected = compact(right).replace(new RegExp(`${suffix}$`), "");
    // 左邊是該單字(讀音一致;漢字行連表面形一致)
    const leftReading = left.map((seg) => seg.r ?? seg.b).join("");
    expect(leftReading.replace(/［な］$/, "")).toBe(v.kana);
    if (left.some((seg) => seg.r)) {
      expect(surfaceOf(left)).toBe(surfaceOf(v.ruby));
      expect(compact(out.ruby)).toBe(expected); // 漢字行比對 ruby(含讀音)
    } else {
      expect(out.kana).toBe(expected); // 假名行比對讀音
    }
  });

  it("き-ます → こ-ない 的 ruby:来(こ)ない", () => {
    expect(show("L05-V002", "nai")).toBe("来(こ)|ない");
    // 同讀音的着ます(動II)て形同為 きて、ない形為 きない
    expect(kana("L22-V001", "te")).toBe("きて");
    expect(kana("L22-V001", "nai")).toBe("きない");
  });
});

describe("例外(教材單字)", () => {
  it("行く系:行きます、持って 行きます、連れて 行きます、うまく いきます → って/った", () => {
    expect(show("L05-V001", "te")).toBe("行(い)|って");
    expect(show("L17-V009", "te")).toBe("持(も)|って |行(い)|って");
    expect(show("L24-V002", "ta")).toBe("連(つ)|れて |行(い)|った");
    expect(show("L45-V006", "te")).toBe("うまく いって");
    expect(kana("L17-V009", "nai")).toBe("もっていかない"); // て/た 以外照規則
  });

  it.each([
    ["L06-V005", "聞(き)|いて"],
    ["L23-V003", "引(ひ)|いて"],
    ["L27-V008", "開(ひら)|いて"],
    ["L23-V008", "歩(ある)|いて"],
    ["L06-V007", "書(か)|いて"],
  ])("「〜きます」但不是行く:%s → %s", (id, expected) => {
    expect(show(id, "te")).toBe(expected);
  });

  it.each(["L09-V002", "L10-V002", "L21-V006"])(
    "あります(%s)→ ない/なかった",
    (id) => {
      expect(show(id, "nai")).toBe("ない");
      expect(show(id, "nakatta")).toBe("なかった");
      expect(show(id, "dict")).toBe("ある");
      expect(show(id, "te")).toBe("あって");
    },
  );

  it.each([
    ["L15-V026", "いらっしゃ"],
    ["L40-V048", "いらっしゃ"],
    ["L49-V006", "いらっしゃ"],
    ["L49-V008", "おっしゃ"],
    ["L41-V002", "くださ"],
    ["L49-V009", "なさ"],
  ])("-aru 敬語 %s:%sる/って/った/らない", (id, stem) => {
    expect(kana(id, "dict")).toBe(`${stem}る`);
    expect(kana(id, "te")).toBe(`${stem}って`);
    expect(kana(id, "ta")).toBe(`${stem}った`);
    expect(kana(id, "nai")).toBe(`${stem}らない`);
    expect(kana(id, "nakatta")).toBe(`${stem}らなかった`);
  });

  it("ございます(L50-V010)不推導", () => {
    for (const form of VERB_FORMS) {
      expect(conjugate(word("L50-V010"), form)).toBeNull();
    }
  });

  it("する複合:勉強します、します、そのままに します、長生きします", () => {
    expect(show("L04-V005", "dict")).toBe("勉強(べんきょう)|する");
    expect(show("L04-V005", "te")).toBe("勉強(べんきょう)|して");
    expect(show("L04-V005", "nai")).toBe("勉強(べんきょう)|しない");
    expect(show("L04-V005", "ta")).toBe("勉強(べんきょう)|した");
    expect(show("L06-V010", "dict")).toBe("する");
    expect(show("L30-V015", "nai")).toBe("そのままに しない");
    expect(show("L47-V003", "dict")).toBe("長生(ながい)|きする");
  });

  it.each([
    ["L05-V002", ""],
    ["L17-V010", "持(も)|って |"],
    ["L24-V003", "連(つ)|れて |"],
    ["L46-V003", "帰(かえ)|って |"],
  ])("来ます系 %s:「来」的讀音 く/こ/き", (id, prefix) => {
    expect(show(id, "dict")).toBe(`${prefix}来(く)|る`);
    expect(show(id, "nai")).toBe(`${prefix}来(こ)|ない`);
    expect(show(id, "nakatta")).toBe(`${prefix}来(こ)|なかった`);
    expect(show(id, "te")).toBe(`${prefix}来(き)|て`);
    expect(show(id, "ta")).toBe(`${prefix}来(き)|た`);
    expect(show(id, "masen")).toBe(`${prefix}来(き)|ません`);
  });

  it("着ます(L22-V001 動II)與来ます同讀音,依詞性區分", () => {
    expect(show("L22-V001", "dict")).toBe("着(き)|る");
    expect(show("L22-V001", "nai")).toBe("着(き)|ない");
  });

  it("降ります:ふります(動I)與おります(動II)依詞性區分", () => {
    expect(show("L14-V017", "nai")).toBe("降(ふ)|らない");
    expect(show("L14-V017", "te")).toBe("降(ふ)|って");
    expect(show("L16-V002", "nai")).toBe("降(お)|りない");
    expect(show("L16-V002", "te")).toBe("降(お)|りて");
  });

  it("いい → よ-:L08-V015「いい （よい）」、L12-V014「いい」;かわいい 照一般規則", () => {
    expect(show("L08-V015", "negPolite")).toBe("よくないです");
    expect(show("L08-V015", "te")).toBe("よくて");
    expect(show("L12-V014", "past")).toBe("よかった");
    expect(show("L12-V014", "adv")).toBe("よく");
    expect(show("L41-V007", "neg")).toBe("かわいくない");
  });

  it.each([
    ["L08-V017", "暑(あつ)|くない", "あつくない"],
    ["L12-V004", "速(はや)|くない", "はやくない"],
    ["L12-V008", "暖(あたた)|かくない", "あたたかくない"],
  ])("並列寫法只活用第一個:%s → %s", (id, ruby, reading) => {
    expect(show(id, "neg")).toBe(ruby);
    expect(kana(id, "neg")).toBe(reading);
  });

  it("な形容詞:［な］在假名段、自成一段、〔な〕、kana 含［な］", () => {
    expect(show("L08-V003", "neg")).toBe("静(しず)|かじゃ ない");
    expect(show("L08-V005", "pastNegPolite")).toBe(
      "有名(ゆうめい)|じゃ ありませんでした",
    );
    expect(show("L10-V003", "past")).toBe("いろいろだった");
    expect(kana("L09-V003", "neg")).toBe("すきじゃない");
    expect(show("L09-V003", "neg")).toBe("好(す)|きじゃ ない");
  });

  it.each([
    ["L13-V012", "大変(たいへん)"],
    ["L19-V028", "無理(むり)"],
    ["L21-V010", "同(おな)|じ"],
    ["L32-V044", "元気(げんき)"],
    ["L42-V019", "安全(あんぜん)"],
    ["L44-V008", "安全(あんぜん)"],
    ["L44-V009", "丁寧(ていねい)"],
  ])("無［な］的な形容詞 %s(%s)", (id, stem) => {
    const sep = stem.endsWith(")") ? "|" : "";
    expect(show(id, "neg")).toBe(`${stem}${sep}じゃ ない`);
    expect(show(id, "past")).toBe(`${stem}${sep}だった`);
    expect(show(id, "te")).toBe(`${stem}${sep}で`);
  });

  it("多詞單字只活用最後一詞,前綴與分段原樣保留", () => {
    expect(show("L21-V007", "te")).toBe("役(やく)|に |立(た)|って");
    expect(show("L34-V004", "te")).toBe("気(き)|が |ついて");
    expect(show("L34-V033", "dict")).toBe("お|茶(ちゃ)|を |たてる");
    expect(show("L38-V036", "nai")).toBe("似(に)|て いない");
    expect(show("L50-V009", "dict")).toBe("お|目(め)|に かかる");
  });
});

describe("排除清單", () => {
  it("恰為文件所列 3 筆", () => {
    expect([...CONJUGATION_EXCLUDED.keys()].sort()).toEqual([
      "L32-V010", // 治ります、直ります
      "L40-V055", // 離れた
      "L50-V010", // ございます
    ]);
    for (const id of CONJUGATION_EXCLUDED.keys()) {
      expect(conjClass(word(id).pos), id).not.toBeNull();
    }
  });

  it("各筆的排除理由仍成立(資料修正後失敗:請自 CONJUGATION_EXCLUDED 移除並更新覆蓋數)", () => {
    expect(word("L40-V055").kana.endsWith("ます")).toBe(false);
    expect(surfaceOf(word("L32-V010").ruby)).toContain("、");
    expect(word("L50-V010").kana).toBe("ございます");
  });

  it("詞性修正後由規則推導(T12.3,fix-content):借ります 動II → 借りて;します〔音／声が〜〕等 動III → して", () => {
    expect(word("L07-V006").pos).toBe("動II");
    expect(show("L07-V006", "te")).toBe("借(か)|りて");
    expect(show("L07-V006", "nai")).toBe("借(か)|りない");
    expect(show("L07-V006", "dict")).toBe("借(か)|りる");
    for (const id of ["L47-V004", "L47-V005", "L47-V006"]) {
      expect(word(id).pos, id).toBe("動III");
      expect(show(id, "te"), id).toBe("して");
      expect(show(id, "nai"), id).toBe("しない");
      expect(show(id, "dict"), id).toBe("する");
    }
  });

  it("全部動詞/形容詞中,基本形無法活用者恰為排除清單;其餘每一個基本形皆有輸出", () => {
    const failed = conjugable
      .filter((v) => basicFormsOf(v.pos).some((f) => conjugate(v, f) === null))
      .map((v) => v.id);
    expect(failed.sort()).toEqual([...CONJUGATION_EXCLUDED.keys()].sort());
    for (const id of failed) {
      // 排除清單中的字連進階形也不推導
      for (const f of formsOf(word(id).pos)) {
        expect(conjugate(word(id), f), `${id} ${f}`).toBeNull();
        expect(conjugateByRule(word(id), f), `${id} ${f}`).toBeNull();
      }
    }
  });

  it("覆蓋數:動詞 455/458(動I 226/228、動II 129/130、動III 100/100)、形容詞 138/138", () => {
    const count = (pred: (v: VocabItem) => boolean) => {
      const all = conjugable.filter(pred);
      return [all.filter((v) => isConjugable(v)).length, all.length];
    };
    expect(count((v) => conjClass(v.pos) === "verb")).toEqual([455, 458]);
    expect(count((v) => v.pos === "動I")).toEqual([226, 228]);
    expect(count((v) => v.pos === "動II")).toEqual([129, 130]);
    expect(count((v) => v.pos === "動III")).toEqual([100, 100]);
    expect(count((v) => v.pos === "い形")).toEqual([85, 85]);
    expect(count((v) => v.pos === "な形")).toEqual([53, 53]);
  });
});

describe("全部教材動詞/形容詞的輸出性質(基本形 + 進階形)", () => {
  const ok = conjugable.filter((v) => isConjugable(v));
  /** [單字, 形, 輸出]:基本形全部、進階形中練習者 */
  const outputs = ok.flatMap((v) =>
    formsOf(v.pos).flatMap((f) => {
      const c = conjugate(v, f);
      return c ? [[v, f, c] as const] : [];
    }),
  );

  it("資料載入完整", () => {
    expect(ok.length).toBe(593);
    const basic = outputs.filter(([v, f]) => basicFormsOf(v.pos).includes(f));
    expect(basic.length).toBe(
      455 * BASIC_VERB_FORMS.length + 138 * BASIC_ADJ_FORMS.length,
    );
    expect(outputs.length - basic.length).toBe(ADVANCED_TOTAL);
  });

  it("kana = ruby 讀音(r ?? b)串接去空白,且只含假名", () => {
    const bad = outputs
      .filter(([, , c]) => {
        const reading = c.ruby.map((s) => s.r ?? s.b).join("");
        return (
          c.kana !== reading.replace(/\s/g, "") ||
          !/^[ぁ-ゖァ-ヺー]+$/.test(c.kana)
        );
      })
      .map(([v, f, c]) => `${v.id} ${f} ${c.kana}`);
    expect(bad).toEqual([]);
  });

  it("沒有空段、不殘留教材記號、不以空白開頭或結尾", () => {
    const bad = outputs
      .filter(([, , c]) => {
        const surface = surfaceOf(c.ruby);
        return (
          c.ruby.some((s) => s.b === "" || s.r === "") ||
          /[［］〔〕（）、〜…／]/.test(surface) ||
          surface !== surface.trim()
        );
      })
      .map(([v, f, c]) => `${v.id} ${f} ${compact(c.ruby)}`);
    expect(bad).toEqual([]);
  });

  it("漢字段(b 與 r)原樣保留;唯一例外是来る系「来」的讀音", () => {
    const kanji = (ruby: readonly RubySeg[]) =>
      ruby.filter((s) => s.r !== undefined).map((s) => `${s.b}(${s.r})`);
    for (const [v, f, c] of outputs) {
      const before = kanji(v.ruby);
      const after = kanji(c.ruby).map((k) =>
        v.pos === "動III" && /^来\([くこ]\)$/.test(k) ? "来(き)" : k,
      );
      // 並列寫法(暑い、熱い)只留第一個寫法的漢字段
      const expected = surfaceOf(v.ruby).includes("、")
        ? before.slice(0, after.length)
        : before;
      expect(after, `${v.id} ${f}`).toEqual(expected);
    }
  });

  it("最後一個空格之前的前綴原樣保留", () => {
    for (const [v, f, c] of outputs) {
      const surface = surfaceOf(v.ruby);
      if (/[（、]/.test(surface)) continue; // 替代說法與並列另有測試
      const prefix = surface.slice(0, surface.lastIndexOf(" ") + 1);
      expect(surfaceOf(c.ruby).startsWith(prefix), `${v.id} ${f}`).toBe(true);
    }
  });

  /** 某字某形的 ruby 精簡表示 */
  const out = (v: VocabItem, f: ConjForm) => compact(conj(v.id, f).ruby);

  it("動詞:ます形為原字;ます系只換語尾;た形 = て形的 て/で → た/だ;なかった = ない形的 い → かった", () => {
    for (const v of ok.filter((w) => conjClass(w.pos) === "verb")) {
      const masu = out(v, "masu");
      expect(masu, v.id).toBe(compact(v.ruby));
      const stem = masu.slice(0, -"ます".length);
      expect(out(v, "masen"), v.id).toBe(`${stem}ません`);
      expect(out(v, "mashita"), v.id).toBe(`${stem}ました`);
      expect(out(v, "masendeshita"), v.id).toBe(`${stem}ませんでした`);
      expect(out(v, "ta"), v.id).toBe(
        out(v, "te").replace(/て$/, "た").replace(/で$/, "だ"),
      );
      expect(out(v, "te"), v.id).toMatch(/[てで]$/);
      expect(out(v, "nakatta"), v.id).toBe(
        out(v, "nai").replace(/い$/, "かった"),
      );
      expect(out(v, "nai"), v.id).toMatch(/ない$/);
      expect(out(v, "dict"), v.id).toMatch(/[うくぐすつぬぶむる]$/);
    }
  });

  it("形容詞:丁寧體 = 普通形 + です(い形)/ ない → ありません、だった → でした(な形)", () => {
    for (const v of ok.filter((w) => conjClass(w.pos) === "iAdj")) {
      expect(out(v, "negPolite"), v.id).toBe(`${out(v, "neg")}です`);
      expect(out(v, "pastPolite"), v.id).toBe(`${out(v, "past")}です`);
      expect(out(v, "pastNegPolite"), v.id).toBe(`${out(v, "pastNeg")}です`);
      expect(out(v, "te"), v.id).toBe(out(v, "adv") + "て");
      expect(out(v, "neg"), v.id).toBe(out(v, "adv") + "ない");
    }
    for (const v of ok.filter((w) => conjClass(w.pos) === "naAdj")) {
      expect(out(v, "negPolite"), v.id).toBe(
        out(v, "neg").replace(/ない$/, "ありません"),
      );
      expect(out(v, "pastNegPolite"), v.id).toBe(
        out(v, "pastNeg").replace(/なかった$/, "ありませんでした"),
      );
      expect(out(v, "pastPolite"), v.id).toBe(
        out(v, "past").replace(/だった$/, "でした"),
      );
      expect(out(v, "adv"), v.id).toBe(out(v, "te").replace(/で$/, "に"));
    }
  });
});

/** 進階形的輸出總數(練習的字 × 形;動詞 7 形 + 形容詞條件形) */
const ADVANCED_TOTAL = 2466;

describe("進階形(T11.5):教材例句 golden", () => {
  const all = lessons.flatMap((l) => [
    ...l.grammar.flatMap((g) => g.examples),
    ...l.dialogues,
  ]);
  const sentenceOf = new Map(all.map((s) => [s.id, s]));

  /**
   * 例句中的活用形:辞書形的可能/被動/使役動詞依Ⅱ類改成句中的語尾(話せる → 話せます、
   * 書かれる → 書かれました、輸出される → 輸出されて);其餘形原樣。比對 ruby 的精簡表示
   * (漢字段與讀音都要一致);L27-S01 為全假名行,比對讀音。
   */
  const GOLDEN_SENTENCES: [
    string,
    string,
    AdvancedVerbForm | "adjConditional",
    string,
  ][] = [
    // 可能(L27-G01)
    ["L27-S03", "L14-V013", "potential", "ます"], // 話せます
    ["L27-S04", "L05-V001", "potential", "ますか"], // 行けますか
    ["L27-S05", "L06-V011", "potential", "ませんでした"], // 会えませんでした
    ["L27-S06", "L06-V006", "potential", "ます"], // 読めます
    ["L27-S07", "L18-V007", "potential", "ます"], // 換えられます
    ["L27-S08", "L06-V004", "potential", "ます"], // 見られます(L27-G03)
    ["L27-S10", "L06-V005", "potential", "ます"], // 聞けます(L27-G03)
    ["L28-S06", "L05-V002", "potential", "る"], // 来(こ)られる
    ["L43-D04", "L16-V005", "potential", "る"], // 入れられる
    // 意向(L31-G01)
    ["L31-S02", "L04-V004", "volitional", ""], // 休もう
    ["L31-S04", "L14-V011", "volitional", ""], // 手伝おう
    // 命令・禁止(L33-G01)
    ["L33-S01", "L14-V005", "imperative", ""], // 急げ
    ["L33-S03", "L04-V002", "imperative", ""], // 寝ろ
    ["L33-S05", "L05-V002", "imperative", ""], // 来(こ)い
    ["L33-S07", "L33-V001", "imperative", ""], // 逃げろ
    ["L33-S09", "L04-V004", "imperative", ""], // 休め
    ["L33-S11", "L25-V016", "imperative", ""], // 頑張れ
    ["L33-S02", "L23-V005", "prohibitive", ""], // 触るな
    ["L33-S04", "L26-V003", "prohibitive", ""], // 遅れるな
    ["L33-S06", "L06-V002", "prohibitive", ""], // 飲むな
    ["L33-S08", "L15-V003", "prohibitive", ""], // 使うな
    ["L33-S10", "L04-V004", "prohibitive", ""], // 休むな
    ["L33-S12", "L21-V005", "prohibitive", ""], // 負けるな
    ["L33-S14", "L13-V006", "prohibitive", ""], // 入るな
    // 條件(L35-G01)
    ["L35-S01", "L16-V010", "conditional", ""], // 押せば
    ["L35-S02", "L05-V001", "conditional", ""], // 行けば
    ["L35-S06", "L19-V028", "adjConditional", ""], // 無理なら(な形容詞)
    // 被動(L37-G01)
    ["L37-S00", "L28-V003", "passive", "ました"], // かまれました
    ["L37-S01", "L37-V001", "passive", "ました"], // 褒められました
    ["L37-S02", "L37-V006", "passive", "ました"], // 頼まれました
    ["L37-S04", "L37-V010", "passive", "ました"], // 壊されました
    ["L37-S07", "L37-V017", "passive", "ました"], // 発見されました
    ["L37-S08", "L37-V013", "passive", "て"], // 輸出されて
    ["L37-S09", "L27-V008", "passive", "ました"], // 開かれました
    ["L37-S10", "L06-V007", "passive", "ました"], // 書かれました
    ["L37-S11", "L37-V016", "passive", "ました"], // 発明されました
    ["L39-S06", "L37-V002", "passive", "ました"], // しかられました
    // 使役(L48-G01)
    ["L48-S04", "L17-V013", "causative", "ます"], // 出張させます
    ["L48-S05", "L13-V001", "causative", "ました"], // 遊ばせました
    ["L48-S06", "L23-V008", "causative", "ます"], // 歩かせます
    ["L48-S08", "L14-V011", "causative", "ます"], // 手伝わせます
    ["L48-S09", "L21-V002", "causative", "ました"], // 言わせました
    ["L48-S10", "L05-V001", "causative", "ますから"], // 行かせますから
    ["L48-S13", "L17-V011", "causative", "ました"], // 心配させました(情動動詞,L48-G03 註2)
    ["L48-S15", "L39-V010", "causative", "て"], // 早退させて
  ];

  /** 可能/被動/使役輸出辞書形(〜る),例句多為ます形等 */
  const DICT_SHAPE = new Set<string>(["potential", "passive", "causative"]);

  it.each(GOLDEN_SENTENCES)("%s:%s 的 %s", (sid, vid, form, ending) => {
    const s = sentenceOf.get(sid);
    if (!s) throw new Error(`找不到 ${sid}`);
    const c = conj(vid, form === "adjConditional" ? "conditional" : form);
    const expected = DICT_SHAPE.has(form)
      ? compact(c.ruby).replace(/る$/, ending)
      : compact(c.ruby) + ending;
    expect(compact(s.ruby)).toContain(expected);
  });

  it("L27-S01「かける、かけ（ない）、かけて」:書きます 的可能形 かける", () => {
    const s = sentenceOf.get("L27-S01");
    expect(s?.ruby.map((seg) => seg.r ?? seg.b).join("")).toMatch(/^かける、/);
    expect(kana("L06-V007", "potential")).toBe("かける");
  });

  it("L33-S13「止まれ」:規則推導與教材一致;L29-V014 為〔電梯〕停了(無意志),不練命令形", () => {
    const s = sentenceOf.get("L33-S13");
    const rule = conjugateByRule(word("L29-V014"), "imperative");
    expect(rule && compact(rule.ruby)).toBe("止(と)|まれ");
    expect(s && compact(s.ruby)).toContain("止(と)|まれ");
    expect(conjugate(word("L29-V014"), "imperative")).toBeNull();
  });
});

/**
 * FORM_EXCLUSIONS 各 id 對應的字(教材 kana):排除清單以 id 為鍵,資料重新編號時不可悄悄排除到別的字
 * (順序同 conjugateExclusions.ts)
 */
const EXCLUSION_KANA: readonly (readonly [id: string, kana: string])[] = [
  ["L41-V001", "いただきます"],
  ["L49-V007", "めしあがります"],
  ["L49-V010", "ごらんになります"],
  ["L50-V001", "まいります"],
  ["L50-V002", "おります"],
  ["L50-V003", "いただきます"],
  ["L50-V004", "もうします"],
  ["L50-V005", "いたします"],
  ["L50-V006", "はいけんします"],
  ["L50-V007", "ぞんじます"],
  ["L50-V008", "うかがいます"],
  ["L50-V009", "おめにかかります"],
  ["L09-V001", "わかります"],
  ["L09-V002", "あります"],
  ["L10-V002", "あります"],
  ["L11-V001", "います"],
  ["L11-V003", "かかります"],
  ["L14-V017", "ふります"],
  ["L18-V001", "できます"],
  ["L20-V001", "いります"],
  ["L21-V003", "たります"],
  ["L21-V006", "あります"],
  ["L21-V007", "やくにたちます"],
  ["L22-V005", "うまれます"],
  ["L23-V006", "でます"],
  ["L23-V007", "うごきます"],
  ["L25-V002", "つきます"],
  ["L25-V004", "とります"],
  ["L26-V004", "まにあいます"],
  ["L26-V028", "かたづきます"],
  ["L26-V031", "もえます"],
  ["L27-V005", "みえます"],
  ["L27-V006", "きこえます"],
  ["L27-V007", "できます"],
  ["L28-V001", "うれます"],
  ["L28-V005", "ちがいます"],
  ["L29-V001", "あきます"],
  ["L29-V002", "しまります"],
  ["L29-V003", "つきます"],
  ["L29-V004", "きえます"],
  ["L29-V005", "こみます"],
  ["L29-V006", "すきます"],
  ["L29-V007", "こわれます"],
  ["L29-V008", "われます"],
  ["L29-V009", "おれます"],
  ["L29-V010", "やぶれます"],
  ["L29-V011", "よごれます"],
  ["L29-V012", "つきます"],
  ["L29-V013", "はずれます"],
  ["L29-V014", "とまります"],
  ["L29-V017", "かかります"],
  ["L29-V044", "たおれます"],
  ["L30-V055", "めがさめます"],
  ["L31-V001", "はじまります"],
  ["L31-V044", "きがつきます"],
  ["L32-V006", "やみます"],
  ["L32-V007", "はれます"],
  ["L32-V008", "くもります"],
  ["L32-V009", "ふきます"],
  ["L32-V011", "つづきます"],
  ["L32-V012", "ひきます"],
  ["L32-V054", "あたります"],
  ["L33-V052", "なくなります"],
  ["L34-V004", "きがつきます"],
  ["L34-V006", "みつかります"],
  ["L34-V050", "にえます"],
  ["L35-V002", "かわります"],
  ["L35-V006", "かかります"],
  ["L36-V001", "とどきます"],
  ["L36-V007", "すぎます"],
  ["L38-V003", "なくなります"],
  ["L38-V036", "にています"],
  ["L38-V040", "じかんがたちます"],
  ["L39-V002", "たおれます"],
  ["L39-V003", "やけます"],
  ["L39-V036", "ぶつかります"],
  ["L39-V041", "あいます"],
  ["L40-V004", "あいます"],
  ["L40-V006", "とうちゃくします"],
  ["L41-V038", "たすかります"],
  ["L43-V001", "ふえます"],
  ["L43-V002", "へります"],
  ["L43-V003", "あがります"],
  ["L43-V004", "さがります"],
  ["L43-V005", "きれます"],
  ["L43-V006", "とれます"],
  ["L43-V007", "おちます"],
  ["L43-V008", "なくなります"],
  ["L44-V003", "かわきます"],
  ["L44-V004", "ぬれます"],
  ["L44-V005", "すべります"],
  ["L44-V006", "おきます"],
  ["L45-V002", "あいます"],
  ["L45-V006", "うまくいきます"],
  ["L45-V029", "めがさめます"],
  ["L45-V032", "なります"],
  ["L46-V004", "でます"],
  ["L46-V025", "てにはいります"],
  ["L46-V032", "でます"],
  ["L47-V004", "します"],
  ["L47-V005", "します"],
  ["L47-V006", "します"],
  ["L49-V025", "だします"],
  ["L50-V033", "かないます"],
  ["L04-V006", "おわります"],
  ["L13-V004", "つかれます"],
  ["L17-V011", "しんぱいします"],
  ["L32-V052", "こまります"],
  ["L35-V001", "さきます"],
  ["L35-V003", "こまります"],
  ["L36-V005", "ふとります"],
  ["L36-V006", "やせます"],
  ["L36-V008", "なれます"],
  ["L39-V006", "びっくりします"],
  ["L39-V007", "がっかりします"],
  ["L39-V008", "あんしんします"],
  ["L40-V007", "よいます"],
  ["L50-V025", "きんちょうします"],
  ["L32-V002", "せいこうします"],
  ["L32-V004", "ごうかくします"],
  ["L45-V025", "ゆうしょうします"],
  ["L49-V031", "じゅしょうします"],
  ["L17-V003", "なくします"],
  ["L21-V005", "まけます"],
  ["L26-V003", "おくれます"],
  ["L29-V015", "まちがえます"],
  ["L29-V016", "おとします"],
  ["L32-V003", "しっぱいします"],
  ["L39-V009", "ちこくします"],
  ["L15-V007", "しります"],
  ["L21-V001", "おもいます"],
  ["L24-V001", "くれます"],
  ["L35-V047", "まじわります"],
  ["L47-V033", "しりあいます"],
  ["L39-V040", "せいようかします"],
  ["L39-V005", "しにます"],
  ["L40-V063", "うわさします"],
  ["L50-V037", "かんしゃします"],
  ["L41-V006", "しんせつにします"],
  ["L47-V003", "ながいきします"],
  ["L23-V010", "きをつけます"],
  ["L48-V023", "かわりをします"],
  ["L50-V042", "めいわくをかけます"],
  ["L32-V048", "むりをします"],
  ["L14-V014", "みせます"],
  ["L30-V011", "しらせます"],
  ["L34-V035", "のせます"],
  ["L07-V004", "もらいます"],
  ["L19-V006", "なります"],
  ["L31-V040", "あつまります"],
  ["L47-V001", "あつまります"],
  ["L40-V061", "てにいれます"],
  ["L48-V031", "とらえます"],
  ["L50-V043", "いかします"],
  ["L41-V003", "やります"],
];

describe("進階形(T11.5):例外與排除", () => {
  const verbs = conjugable.filter(
    (v) => conjClass(v.pos) === "verb" && isConjugable(v),
  );
  const lastWord = (v: VocabItem) => {
    const words = v.ruby
      .map((s) => s.r ?? s.b)
      .join("")
      .split(/\s+/);
    return words[words.length - 1] ?? "";
  };
  const ARU = [
    "L15-V026",
    "L40-V048",
    "L49-V006",
    "L49-V008",
    "L41-V002",
    "L49-V009",
  ];

  it("する → できる/しよう/しろ/するな/すれば/される/させる(勉強します)", () => {
    expect(
      ADVANCED_VERB_FORMS.map((f) =>
        show("L04-V005", f).replace(/^勉強\(べんきょう\)\|/, ""),
      ),
    ).toEqual([
      "できる",
      "しよう",
      "しろ",
      "するな",
      "すれば",
      "される",
      "させる",
    ]);
    expect(show("L06-V010", "potential")).toBe("できる");
    expect(show("L30-V015", "potential")).toBe("そのままに できる");
  });

  it.each([
    ["L05-V002", ""],
    ["L17-V010", "持(も)|って |"],
    ["L24-V003", "連(つ)|れて |"],
    ["L46-V003", "帰(かえ)|って |"],
  ])(
    "来ます系 %s:来(こ)られる/来(こ)よう/来(こ)い/来(く)るな/来(く)れば/来(こ)させる",
    (id, prefix) => {
      expect(show(id, "potential")).toBe(`${prefix}来(こ)|られる`);
      expect(show(id, "volitional")).toBe(`${prefix}来(こ)|よう`);
      expect(show(id, "imperative")).toBe(`${prefix}来(こ)|い`);
      expect(show(id, "prohibitive")).toBe(`${prefix}来(く)|るな`);
      expect(show(id, "conditional")).toBe(`${prefix}来(く)|れば`);
      expect(show(id, "passive")).toBe(`${prefix}来(こ)|られる`);
      expect(show(id, "causative")).toBe(`${prefix}来(こ)|させる`);
    },
  );

  it("行く系:進階形照規則(行ける、行こう、行け、行けば、行かれる、行かせる)", () => {
    expect(ADVANCED_VERB_FORMS.map((f) => kana("L05-V001", f))).toEqual([
      "いける",
      "いこう",
      "いけ",
      "いくな",
      "いけば",
      "いかれる",
      "いかせる",
    ]);
    expect(show("L17-V009", "potential")).toBe("持(も)|って |行(い)|ける");
  });

  it("い → わ:買われる、買わせる;可能 買える、意向 買おう", () => {
    expect(kana("L06-V008", "passive")).toBe("かわれる");
    expect(kana("L06-V008", "causative")).toBe("かわせる");
    expect(kana("L06-V008", "potential")).toBe("かえる");
    expect(kana("L06-V008", "volitional")).toBe("かおう");
  });

  it("あります:條件形 あれば;可能(L27-G02 推知)、命令(L33-G01 明說)與其他進階形不練", () => {
    for (const id of ["L09-V002", "L10-V002", "L21-V006"]) {
      expect(show(id, "conditional")).toBe("あれば");
      for (const f of ADVANCED_VERB_FORMS.filter((x) => x !== "conditional")) {
        expect(conjugate(word(id), f), `${id} ${f}`).toBeNull();
      }
    }
  });

  it("-aru 敬語 6 筆:進階形一律不推導(命令形 いらっしゃい、ください 不規則),基本形照常", () => {
    for (const id of ARU) {
      expect(kana(id, "te")).toMatch(/って$/);
      for (const f of ADVANCED_VERB_FORMS) {
        expect(conjugate(word(id), f), `${id} ${f}`).toBeNull();
        expect(conjugateByRule(word(id), f), `${id} ${f}`).toBeNull();
      }
    }
  });

  it("教材明說或推知沒有此形(TEXTBOOK_NO_FORM):わかります/できます/あります 無可能、命令;見えます/聞こえます 無可能", () => {
    const hit = verbs
      .filter((v) => TEXTBOOK_NO_FORM.has(lastWord(v)))
      .map((v) => v.id);
    expect(hit.sort()).toEqual(
      [
        "L09-V001", // わかります
        "L09-V002", // あります
        "L10-V002",
        "L21-V006",
        "L18-V001", // できます
        "L27-V007",
        "L27-V005", // 見えます
        "L27-V006", // 聞こえます
      ].sort(),
    );
    for (const id of hit) {
      for (const f of TEXTBOOK_NO_FORM.get(lastWord(word(id))) ?? []) {
        expect(conjugate(word(id), f), `${id} ${f}`).toBeNull();
        // 規則上推導得出(わかれる、できられる…):只是教材說不用
        expect(conjugateByRule(word(id), f), `${id} ${f}`).not.toBeNull();
      }
    }
  });

  it("わかります:不練可能形(L27-G01)與命令形,基本形照常練(て形 わかって)", () => {
    expect(isConjugable(word("L09-V001"))).toBe(true);
    expect(kana("L09-V001", "te")).toBe("わかって");
    expect(conjugate(word("L09-V001"), "potential")).toBeNull();
    expect(conjugate(word("L09-V001"), "imperative")).toBeNull();
    expect(kana("L09-V001", "conditional")).toBe("わかれば");
  });

  it("「〜を」前綴的可能形不練(L27-G02 對象用が),其他形照常", () => {
    const wo = verbs
      .filter((v) => {
        const words = v.ruby
          .map((s) => s.r ?? s.b)
          .join("")
          .split(/\s+/);
        return (
          words.length > 1 && (words[words.length - 2] ?? "").endsWith("を")
        );
      })
      .map((v) => v.id);
    expect(wo.sort()).toEqual(
      [
        "L23-V010", // 気を つけます
        "L32-V048", // 無理を します
        "L34-V033", // お茶を たてます
        "L38-V039", // 世話を します
        "L48-V003", // 世話を します
        "L48-V023", // 代わりを します
        "L50-V042", // 迷惑を かけます
      ].sort(),
    );
    for (const id of wo) {
      expect(conjugate(word(id), "potential"), id).toBeNull();
      expect(conjugate(word(id), "conditional"), id).not.toBeNull();
    }
    expect(show("L34-V033", "volitional")).toBe("お|茶(ちゃ)|を |たてよう");
  });

  it("FORM_EXCLUSIONS:每個 id 只屬一組、為教材中可活用的動詞(非 -aru 敬語),排除的形依規則推導得出", () => {
    expect(FORM_EXCLUSIONS.size).toBe(FORM_EXCLUSION_ID_COUNT);
    for (const [id, { forms, reason }] of FORM_EXCLUSIONS) {
      const v = word(id);
      expect(conjClass(v.pos), id).toBe("verb");
      expect(isConjugable(v), id).toBe(true);
      expect(ARU, id).not.toContain(id);
      expect(forms.length, id).toBeGreaterThan(0);
      expect(reason.length, id).toBeGreaterThan(0);
      for (const f of forms) {
        expect(conjugateByRule(v, f), `${id} ${f}`).not.toBeNull();
        expect(conjugate(v, f), `${id} ${f}`).toBeNull();
      }
    }
  });

  it("FORM_EXCLUSIONS 的 id 恰對到預期的字(kana 快照)", () => {
    expect([...FORM_EXCLUSIONS.keys()]).toEqual(
      EXCLUSION_KANA.map(([id]) => id),
    );
    for (const [id, k] of EXCLUSION_KANA) expect(word(id).kana, id).toBe(k);
  });

  it("排除恰為:-aru 敬語、TEXTBOOK_NO_FORM、「〜を」前綴的可能形、FORM_EXCLUSIONS(其餘皆練)", () => {
    for (const v of verbs) {
      for (const f of ADVANCED_VERB_FORMS) {
        const expectedExcluded =
          ARU.includes(v.id) ||
          (TEXTBOOK_NO_FORM.get(lastWord(v))?.includes(f) ?? false) ||
          (f === "potential" &&
            /を\s\S+$/.test(v.ruby.map((s) => s.r ?? s.b).join(""))) ||
          (FORM_EXCLUSIONS.get(v.id)?.forms.includes(f) ?? false);
        expect(conjugate(v, f) === null, `${v.id} ${f}`).toBe(expectedExcluded);
      }
    }
  });

  it("無意志動詞只練條件形;條件形只有敬語動詞不練", () => {
    const conditionalOnly = verbs
      .filter((v) =>
        ADVANCED_VERB_FORMS.every(
          (f) => (conjugate(v, f) !== null) === (f === "conditional"),
        ),
      )
      .map((v) => v.id);
    expect(conditionalOnly).toContain("L14-V017"); // 降ります〔雨が〜〕
    expect(conditionalOnly).toContain("L38-V036"); // 似て います
    expect(conditionalOnly).toContain("L45-V006"); // うまく いきます
    expect(conditionalOnly).toContain("L20-V001"); // 要ります
    // します〔音／声が〜〕:不出「音が できる/しよう/しろ」
    expect(conditionalOnly).toContain("L47-V004");
    // 無意志動詞 92 + くれます、交わります
    expect(conditionalOnly).toHaveLength(94);
    const noConditional = verbs
      .filter((v) => conjugate(v, "conditional") === null)
      .map((v) => v.id);
    expect(noConditional).toHaveLength(18); // -aru 敬語 6 + 尊敬語/謙讓語 12
  });

  it("覆蓋數(可活用的 455 個動詞、138 個形容詞中練習者)", () => {
    const count = (f: ConjForm, cls: string) =>
      conjugable.filter(
        (v) => conjClass(v.pos) === cls && conjugate(v, f) !== null,
      ).length;
    expect(
      Object.fromEntries(ADVANCED_VERB_FORMS.map((f) => [f, count(f, "verb")])),
    ).toEqual({
      potential: 310,
      volitional: 310,
      imperative: 310,
      prohibitive: 317,
      conditional: 437,
      passive: 325,
      causative: 319,
    });
    expect(count("conditional", "iAdj") + count("conditional", "naAdj")).toBe(
      138,
    );
  });
});

describe("進階形(T11.5):全部教材動詞的輸出性質", () => {
  const verbs = conjugable.filter(
    (v) => conjClass(v.pos) === "verb" && isConjugable(v),
  );
  /** [單字, 形, 輸出](練習者) */
  const outputs = verbs.flatMap((v) =>
    ADVANCED_VERB_FORMS.flatMap((f) => {
      const c = conjugate(v, f);
      return c ? [[v, f, c] as const] : [];
    }),
  );
  const out = (v: VocabItem, f: ConjForm) => compact(conj(v.id, f).ruby);
  const has = (v: VocabItem, f: ConjForm) => conjugate(v, f) !== null;

  it("kana = ruby 讀音串接去空白、只含假名;漢字段原樣(来 的讀音:こ 可能/意向/命令/被動/使役,く 禁止/條件)", () => {
    const KURU_READING: Readonly<Record<AdvancedVerbForm, string>> = {
      potential: "こ",
      volitional: "こ",
      imperative: "こ",
      prohibitive: "く",
      conditional: "く",
      passive: "こ",
      causative: "こ",
    };
    const kanji = (ruby: readonly RubySeg[]) =>
      ruby.filter((s) => s.r !== undefined).map((s) => `${s.b}(${s.r})`);
    for (const [v, f, c] of outputs) {
      const reading = c.ruby.map((s) => s.r ?? s.b).join("");
      expect(c.kana, `${v.id} ${f}`).toBe(reading.replace(/\s/g, ""));
      expect(c.kana, `${v.id} ${f}`).toMatch(/^[ぁ-ゖァ-ヺー]+$/);
      expect(
        c.ruby.some((s) => s.b === "" || s.r === ""),
        `${v.id} ${f}`,
      ).toBe(false);
      const kuru = v.pos === "動III" && kanji(v.ruby).at(-1) === "来(き)";
      const expected = kuru
        ? [...kanji(v.ruby).slice(0, -1), `来(${KURU_READING[f]})`]
        : kanji(v.ruby);
      expect(kanji(c.ruby), `${v.id} ${f}`).toEqual(expected);
      // 前綴原樣保留
      const surface = surfaceOf(v.ruby);
      const prefix = surface.slice(0, surface.lastIndexOf(" ") + 1);
      expect(surfaceOf(c.ruby).startsWith(prefix), `${v.id} ${f}`).toBe(true);
    }
  });

  it("禁止形 = 辞書形 + な(L33-G01:任何動詞)", () => {
    for (const v of verbs.filter((w) => has(w, "prohibitive"))) {
      expect(out(v, "prohibitive"), v.id).toBe(`${out(v, "dict")}な`);
    }
  });

  it("Ⅰ類:可能 = 命令 + る、條件 = 命令 + ば(え段);被動/使役 = ない形的「ない」→ れる/せる(あ段)", () => {
    for (const v of verbs.filter((w) => w.pos === "動I")) {
      const imp = conjugateByRule(v, "imperative");
      if (!imp) continue;
      const e = compact(imp.ruby);
      const rule = (f: ConjForm) => {
        const c = conjugateByRule(v, f);
        return c && compact(c.ruby);
      };
      expect(rule("potential"), v.id).toBe(`${e}る`);
      expect(rule("conditional"), v.id).toBe(`${e}ば`);
      expect(rule("volitional"), v.id).toMatch(/[おこごそとのぼもろ]う$/);
      if (/^(ある|あります)$/.test(lastWord(v))) continue; // ない形為「ない」
      const nai = out(v, "nai").replace(/ない$/, "");
      expect(rule("passive"), v.id).toBe(`${nai}れる`);
      expect(rule("causative"), v.id).toBe(`${nai}せる`);
    }
  });

  it("Ⅱ類:語幹 + られる/よう/ろ/れば/られる/させる(可能形 = 被動形)", () => {
    for (const v of verbs.filter((w) => w.pos === "動II")) {
      const stem = out(v, "dict").replace(/る$/, "");
      const rule = (f: ConjForm) => {
        const c = conjugateByRule(v, f);
        return c && compact(c.ruby);
      };
      expect(rule("potential"), v.id).toBe(`${stem}られる`);
      expect(rule("volitional"), v.id).toBe(`${stem}よう`);
      expect(rule("imperative"), v.id).toBe(`${stem}ろ`);
      expect(rule("conditional"), v.id).toBe(`${stem}れば`);
      expect(rule("passive"), v.id).toBe(`${stem}られる`);
      expect(rule("causative"), v.id).toBe(`${stem}させる`);
    }
  });

  it("Ⅲ類 する:「する」→ できる/しよう/しろ/するな/すれば/される/させる", () => {
    const suru = verbs.filter(
      (w) => w.pos === "動III" && lastWord(w).endsWith("します"),
    );
    expect(suru.length).toBeGreaterThan(80);
    const ENDING: Readonly<Record<AdvancedVerbForm, string>> = {
      potential: "できる",
      volitional: "しよう",
      imperative: "しろ",
      prohibitive: "するな",
      conditional: "すれば",
      passive: "される",
      causative: "させる",
    };
    for (const v of suru) {
      const stem = out(v, "dict").replace(/する$/, "");
      for (const f of ADVANCED_VERB_FORMS) {
        const c = conjugateByRule(v, f);
        expect(c && compact(c.ruby), `${v.id} ${f}`).toBe(stem + ENDING[f]);
      }
    }
  });

  /** 最後一詞的讀音 */
  function lastWord(v: VocabItem): string {
    const words = v.ruby
      .map((s) => s.r ?? s.b)
      .join("")
      .split(/\s+/);
    return words[words.length - 1] ?? "";
  }
});

it("形容詞的條件形:い形容詞 = 連用 く → ければ(いい → よければ);な形容詞 = 語幹 + なら", () => {
  const ok = conjugable.filter((v) => isConjugable(v));
  for (const v of ok.filter((w) => conjClass(w.pos) === "iAdj")) {
    expect(show(v.id, "conditional"), v.id).toBe(
      show(v.id, "adv").replace(/く$/, "ければ"),
    );
  }
  for (const v of ok.filter((w) => conjClass(w.pos) === "naAdj")) {
    expect(show(v.id, "conditional"), v.id).toBe(
      show(v.id, "te").replace(/で$/, "なら"),
    );
  }
  expect(show("L08-V015", "conditional")).toBe("よければ");
  expect(show("L12-V014", "conditional")).toBe("よければ");
  expect(show("L41-V007", "conditional")).toBe("かわいければ");
  expect(show("L08-V003", "conditional")).toBe("静(しず)|かなら");
  expect(show("L13-V012", "conditional")).toBe("大変(たいへん)|なら");
});

it("FORM_INTRO 的文法點都存在於教材資料", () => {
  for (const table of [FORM_INTRO.verb, FORM_INTRO.iAdj, FORM_INTRO.naAdj]) {
    for (const { grammarId } of Object.values(table)) {
      expect(grammarIds.has(grammarId), grammarId).toBe(true);
    }
  }
});
