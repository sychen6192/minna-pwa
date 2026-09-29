import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  LessonSchema,
  type RubySeg,
  type Sentence,
  type VocabItem,
} from "@/schemas/lesson";
import {
  ADJ_FORMS,
  CONJUGATION_EXCLUDED,
  FORM_INTRO,
  VERB_FORMS,
  conjClass,
  conjugate,
  formsOf,
  isConjugable,
  type ConjForm,
  type Conjugated,
} from "./conjugate";

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
  const sentence = new Map(examples.map((s) => [s.id, s]));

  it("含「→」的例句恰為 golden 8 行 + 名詞(L19-S10)與使役(L48-S01..S03,T11.5)", () => {
    const arrowRows = examples
      .filter((s) => s.ruby.some((seg) => seg.b.includes("→")))
      .map((s) => s.id);
    expect(arrowRows.sort()).toEqual(
      [
        ...GOLDEN.map(([sid]) => sid),
        "L19-S10",
        "L48-S01",
        "L48-S02",
        "L48-S03",
      ].sort(),
    );
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
  it("恰為文件所列 7 筆", () => {
    expect([...CONJUGATION_EXCLUDED.keys()].sort()).toEqual([
      "L07-V006", // 借ります 動I 誤標
      "L32-V010", // 治ります、直ります
      "L40-V055", // 離れた
      "L47-V004", // します 動I 誤標
      "L47-V005",
      "L47-V006",
      "L50-V010", // ございます
    ]);
    for (const id of CONJUGATION_EXCLUDED.keys()) {
      expect(conjClass(word(id).pos), id).not.toBeNull();
    }
  });

  it("各筆的排除理由仍成立(資料修正後失敗:請自 CONJUGATION_EXCLUDED 移除並更新覆蓋數)", () => {
    // pos 誤標(資料修正清單 1):修正為 動II/動III 後,這幾筆應改由規則推導
    expect(word("L07-V006").pos).toBe("動I");
    for (const id of ["L47-V004", "L47-V005", "L47-V006"]) {
      expect(word(id).pos, id).toBe("動I");
      expect(word(id).kana, id).toBe("します");
    }
    expect(word("L40-V055").kana.endsWith("ます")).toBe(false);
    expect(surfaceOf(word("L32-V010").ruby)).toContain("、");
    expect(word("L50-V010").kana).toBe("ございます");
  });

  it("全部動詞/形容詞中,無法活用者恰為排除清單;其餘每一形皆有輸出", () => {
    const failed = conjugable
      .filter((v) => formsOf(v.pos).some((f) => conjugate(v, f) === null))
      .map((v) => v.id);
    expect(failed.sort()).toEqual([...CONJUGATION_EXCLUDED.keys()].sort());
    for (const id of failed) {
      for (const f of formsOf(word(id).pos)) {
        expect(conjugate(word(id), f), `${id} ${f}`).toBeNull();
      }
    }
  });

  it("覆蓋數:動詞 451/458(動I 226/232、動II 128/129、動III 97/97)、形容詞 138/138", () => {
    const count = (pred: (v: VocabItem) => boolean) => {
      const all = conjugable.filter(pred);
      return [all.filter((v) => isConjugable(v)).length, all.length];
    };
    expect(count((v) => conjClass(v.pos) === "verb")).toEqual([451, 458]);
    expect(count((v) => v.pos === "動I")).toEqual([226, 232]);
    expect(count((v) => v.pos === "動II")).toEqual([128, 129]);
    expect(count((v) => v.pos === "動III")).toEqual([97, 97]);
    expect(count((v) => v.pos === "い形")).toEqual([85, 85]);
    expect(count((v) => v.pos === "な形")).toEqual([53, 53]);
  });
});

describe("全部教材動詞/形容詞的輸出性質", () => {
  const ok = conjugable.filter((v) => isConjugable(v));
  /** [單字, 形, 輸出] */
  const outputs = ok.flatMap((v) =>
    formsOf(v.pos).map((f) => [v, f, conj(v.id, f)] as const),
  );

  it("資料載入完整", () => {
    expect(ok.length).toBe(589);
    expect(outputs.length).toBe(
      451 * VERB_FORMS.length + 138 * ADJ_FORMS.length,
    );
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

it("FORM_INTRO 的文法點都存在於教材資料", () => {
  for (const table of [FORM_INTRO.verb, FORM_INTRO.iAdj, FORM_INTRO.naAdj]) {
    for (const { grammarId } of Object.values(table)) {
      expect(grammarIds.has(grammarId), grammarId).toBe(true);
    }
  }
});
