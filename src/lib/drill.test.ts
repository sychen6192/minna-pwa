import type { Lesson, Pos, RubySeg, VocabItem } from "@/schemas/lesson";
import {
  ADVANCED_VERB_FORMS,
  conjugate,
  conjugateByRule,
  formsOf,
  type ConjForm,
} from "./conjugate";
import {
  DRILL_GROUPS,
  DRILL_LEVELS,
  OPTION_COUNT,
  availableForms,
  availableGroupForms,
  canInputDrill,
  checkDrillAnswer,
  drillPool,
  drillableCounts,
  formLabel,
  formLabelLang,
  formLevel,
  formPrompt,
  grammarHref,
  grammarLinks,
  groupFormLesson,
  lessonHasDrill,
  levelForms,
  makeDrillQuestion,
  makeDrillRound,
  parseUpto,
  wrongConjugations,
  type DrillItem,
} from "./drill";
import { normalizeReading } from "./quiz";

/** 精簡的 ruby 寫法:以「|」分段,「漢字(よみ)」為漢字段,其餘為假名段(同 conjugate.test.ts) */
function rb(text: string): RubySeg[] {
  return text.split("|").map((part) => {
    const m = /^(.+)\((.+)\)$/.exec(part);
    return m ? { b: m[1], r: m[2] } : { b: part };
  });
}

let seq = 0;
/** 測試用單字;kana 預設為 ruby 讀音去空白與［な］ */
function item(
  pos: Pos,
  ruby: string,
  extra: Partial<DrillItem> = {},
): DrillItem {
  const segs = rb(ruby);
  seq++;
  return {
    id: `L99-V${String(seq).padStart(3, "0")}`,
    pos,
    ruby: segs,
    kana: segs
      .map((s) => s.r ?? s.b)
      .join("")
      .replace(/\s|［な］/g, ""),
    meaning: "測試",
    lessonId: 14,
    ...extra,
  };
}

const kanaOf = (ruby: readonly RubySeg[]) =>
  ruby
    .map((s) => s.r ?? s.b)
    .join("")
    .replace(/\s/g, "");
const wrongKana = (v: DrillItem, form: ConjForm) =>
  wrongConjugations(v, form).map((c) => c.kana);

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

const kaku = item("動I", "書(か)|きます");
const kau = item("動I", "買(か)|います");
const iku = item("動I", "行(い)|きます");
const hanasu = item("動I", "話(はな)|します");
const aru = item("動I", "あります");
const irassharu = item("動I", "いらっしゃいます");
const taberu = item("動II", "食(た)|べます");
const miru = item("動II", "見(み)|ます");
const okiru = item("動II", "起(お)|きます");
const iru = item("動II", "います");
const neru = item("動II", "寝(ね)|ます");
const suru = item("動III", "します");
const benkyou = item("動III", "勉強(べんきょう)|します");
const kuru = item("動III", "来(き)|ます");
const mottekuru = item("動III", "持(も)|って |来(き)|ます");
const takai = item("い形", "高(たか)|い");
const ii = item("い形", "いい （よい）", { kana: "いい" });
const kirei = item("な形", "きれい［な］");
const shizuka = item("な形", "静(しず)|か［な］");
const taihen = item("な形", "大変(たいへん)");

const SAMPLES = [
  kaku,
  kau,
  iku,
  hanasu,
  aru,
  irassharu,
  taberu,
  miru,
  okiru,
  iru,
  neru,
  suru,
  benkyou,
  kuru,
  mottekuru,
  takai,
  ii,
  kirei,
  shizuka,
  taihen,
];

describe("availableForms:依範圍開放已導入的形", () => {
  it("動詞:第 4 課ます系,14 て形、17 ない形、18 辞書形、19 た形、20 なかった;不練 masu", () => {
    expect(availableForms("verb", 3)).toEqual([]);
    expect(availableForms("verb", 4)).toEqual([
      "masen",
      "mashita",
      "masendeshita",
    ]);
    expect(availableForms("verb", 13)).toEqual([
      "masen",
      "mashita",
      "masendeshita",
    ]);
    expect(availableForms("verb", 14)).toContain("te");
    expect(availableForms("verb", 16)).not.toContain("nai");
    expect(availableForms("verb", 17)).toContain("nai");
    expect(availableForms("verb", 18)).toContain("dict");
    expect(availableForms("verb", 19)).toContain("ta");
    expect(availableForms("verb", 19)).not.toContain("nakatta");
    expect(availableForms("verb", 20)).toEqual([
      "masen",
      "mashita",
      "masendeshita",
      "te",
      "nai",
      "dict",
      "ta",
      "nakatta",
    ]);
    expect(availableForms("verb", 50)).not.toContain("masu");
  });

  it("形容詞:第 8 課否定(丁寧),12 過去(丁寧),16 て形,19 連用,20 普通形;い/な形容詞相同", () => {
    for (const cls of ["iAdj", "naAdj"] as const) {
      expect(availableForms(cls, 7)).toEqual([]);
      expect(availableForms(cls, 8)).toEqual(["negPolite"]);
      expect(availableForms(cls, 12)).toEqual([
        "negPolite",
        "pastPolite",
        "pastNegPolite",
      ]);
      expect(availableForms(cls, 16)).toContain("te");
      expect(availableForms(cls, 19)).toContain("adv");
      expect(availableForms(cls, 19)).not.toContain("neg");
      expect(availableForms(cls, 20)).toHaveLength(8);
    }
  });

  it("分組:各形的導入課號與範圍內可練的形", () => {
    expect(groupFormLesson("verb", "nai")).toBe(17);
    expect(groupFormLesson("adj", "te")).toBe(16);
    expect(groupFormLesson("adj", "nai")).toBe(Infinity);
    expect(availableGroupForms("adj", 12)).toEqual([
      "negPolite",
      "pastPolite",
      "pastNegPolite",
    ]);
    expect(DRILL_GROUPS.map((g) => g.group)).toEqual(["verb", "adj"]);
  });

  it("形名:動詞與形容詞同名的 te 皆為て形;含假名者標日文", () => {
    expect(formLabel("verb", "te")).toBe("て形");
    expect(formLabel("adj", "te")).toBe("て形");
    expect(formLabel("verb", "masen")).toBe("否定(丁寧)");
    expect(formLabel("adj", "neg")).toBe("否定(普通)");
    expect(formLabel("adj", "adv")).toBe("連用(〜く/〜に)");
    expect(formLabelLang("ない形")).toBe("ja");
    expect(formLabelLang("過去否定(丁寧)")).toBeUndefined();
  });

  it("進階形:動詞第 27 課可能、31 意向、33 命令/禁止、35 條件、37 被動、48 使役;形容詞第 35 課條件形", () => {
    expect(availableForms("verb", 26)).toHaveLength(8);
    expect(availableForms("verb", 27).slice(8)).toEqual(["potential"]);
    expect(availableForms("verb", 33).slice(8)).toEqual([
      "potential",
      "volitional",
      "imperative",
      "prohibitive",
    ]);
    expect(availableForms("verb", 47)).not.toContain("causative");
    expect(availableForms("verb", 50).slice(8)).toEqual(ADVANCED_VERB_FORMS);
    for (const cls of ["iAdj", "naAdj"] as const) {
      expect(availableForms(cls, 34)).not.toContain("conditional");
      expect(availableForms(cls, 35)).toContain("conditional");
    }
    expect(groupFormLesson("verb", "potential")).toBe(27);
    expect(groupFormLesson("verb", "causative")).toBe(48);
    expect(groupFormLesson("verb", "conditional")).toBe(35);
    expect(groupFormLesson("adj", "conditional")).toBe(35);
    expect(groupFormLesson("adj", "potential")).toBe(Infinity);
  });

  it("層級:基本/進階兩列,每組的形恰分成兩列(教材順序)", () => {
    expect(DRILL_LEVELS.map((l) => l.label)).toEqual(["基本", "進階"]);
    expect(levelForms("verb", "advanced")).toEqual(ADVANCED_VERB_FORMS);
    expect(levelForms("verb", "basic")).toEqual([
      "masen",
      "mashita",
      "masendeshita",
      "te",
      "nai",
      "dict",
      "ta",
      "nakatta",
    ]);
    expect(levelForms("adj", "advanced")).toEqual(["conditional"]);
    expect(levelForms("adj", "basic")).toHaveLength(8);
    for (const { group, forms } of DRILL_GROUPS) {
      expect([
        ...levelForms(group, "basic"),
        ...levelForms(group, "advanced"),
      ]).toEqual(forms);
    }
    expect(formLevel("te")).toBe("basic");
    expect(formLevel("conditional")).toBe("advanced");
  });

  it("進階形的形名與題目(可能/被動/使役 標明答辞書形)", () => {
    expect(ADVANCED_VERB_FORMS.map((f) => formLabel("verb", f))).toEqual([
      "可能形",
      "意向形",
      "命令形",
      "禁止形",
      "條件形(ば)",
      "被動形",
      "使役形",
    ]);
    expect(formLabel("adj", "conditional")).toBe("條件形(〜ければ/〜なら)");
    expect(formPrompt("verb", "potential")).toBe("可能形(辞書形)");
    expect(formPrompt("verb", "passive")).toBe("被動形(辞書形)");
    expect(formPrompt("verb", "causative")).toBe("使役形(辞書形)");
    expect(formPrompt("verb", "imperative")).toBe("命令形");
    expect(formPrompt("verb", "te")).toBe("て形");
    expect(formPrompt("adj", "conditional")).toBe("條件形(〜ければ/〜なら)");
    expect(formLabelLang("可能形")).toBeUndefined();
    expect(formLabelLang("條件形(ば)")).toBe("ja");
  });
});

describe("parseUpto", () => {
  it.each([
    ["?upto=17", 17],
    ["?upto=1", 1],
    ["?upto=50", 50],
    ["?foo=1&upto=20", 20],
    ["?upto=0", null],
    ["?upto=51", null],
    ["?upto=abc", null],
    ["?upto=3.5", null],
    ["", null],
  ])("%s → %s", (search, expected) => {
    expect(parseUpto(search)).toBe(expected);
  });
});

function lesson(id: number, vocab: VocabItem[]): Lesson {
  return { id, title: `第${id}課`, vocab, grammar: [], dialogues: [] };
}

function vocab(
  id: string,
  pos: Pos,
  ruby: string,
  extra: Partial<VocabItem> = {},
): VocabItem {
  // 多出的 lessonId 由 drillPool 以所在課號覆寫
  return { ...item(pos, ruby, extra), id };
}

describe("drillPool:範圍內可練的動詞與形容詞", () => {
  const lessons = [
    lesson(5, [
      vocab("L05-V001", "動I", "行(い)|きます"),
      vocab("L05-V002", "名", "駅(えき)"),
      vocab("L05-V003", "名", "大阪(おおさか)", {
        note: "補充單字(自行練習發音)",
      }),
    ]),
    lesson(4, [
      vocab("L04-V001", "動II", "起(お)|きます"),
      // 補充單字不出題
      vocab("L04-V002", "動I", "書(か)|きます", {
        note: "補充單字(自行練習發音)",
      }),
    ]),
    lesson(7, [
      // 排除清單(conjugate 回傳 null)
      vocab("L07-V006", "動I", "借(か)|ります"),
      vocab("L07-V001", "動I", "切(き)|ります"),
    ]),
    lesson(8, [
      vocab("L08-V001", "な形", "静(しず)|か［な］"),
      vocab("L08-V002", "い形", "高(たか)|い"),
    ]),
    lesson(9, [
      // 不同課重列的同一個字只留最早的
      vocab("L09-V001", "動I", "行(い)|きます"),
      vocab("L09-V002", "な形", "静(しず)|か"),
    ]),
  ];

  it("只取第 1–maxLesson 課、可活用、非補充;依課號排序並附課號", () => {
    expect(drillPool(lessons, 7).map((v) => [v.id, v.lessonId])).toEqual([
      ["L04-V001", 4],
      ["L05-V001", 5],
      ["L07-V001", 7],
    ]);
  });

  it("重列的字只差空格(目が覚めます/目が 覚めます)也視為同一個字", () => {
    const spaced = [
      lesson(30, [vocab("L30-V055", "動II", "目(め)|が|覚(さ)|めます")]),
      lesson(45, [vocab("L45-V029", "動II", "目(め)|が |覚(さ)|めます")]),
    ];
    expect(drillPool(spaced, 50).map((v) => v.id)).toEqual(["L30-V055"]);
  });

  it("重列的字(同詞性、同基底表記與讀音)只留最早一筆", () => {
    expect(drillPool(lessons, 9).map((v) => v.id)).toEqual([
      "L04-V001",
      "L05-V001",
      "L07-V001",
      "L08-V001",
      "L08-V002",
    ]);
  });

  it("lessonHasDrill:本課有可練的字,且該類別到本課已導入至少一形", () => {
    expect(
      lessonHasDrill(lesson(4, [vocab("L04-V001", "動II", "起(お)|きます")])),
    ).toBe(true);
    // 第 3 課之前沒有任何活用形
    expect(
      lessonHasDrill(lesson(3, [vocab("L03-V001", "動I", "行(い)|きます")])),
    ).toBe(false);
    // 形容詞的活用第 8 課才導入
    expect(
      lessonHasDrill(lesson(5, [vocab("L05-V001", "い形", "高(たか)|い")])),
    ).toBe(false);
    expect(
      lessonHasDrill(lesson(8, [vocab("L08-V001", "い形", "高(たか)|い")])),
    ).toBe(true);
    expect(
      lessonHasDrill(lesson(14, [vocab("L14-V001", "名", "駅(えき)")])),
    ).toBe(false);
    // 只有補充單字
    expect(
      lessonHasDrill(
        lesson(14, [
          vocab("L14-V001", "動I", "書(か)|きます", {
            note: "補充單字(自行練習發音)",
          }),
        ]),
      ),
    ).toBe(false);
  });
});

describe("wrongConjugations:常見的規則錯誤", () => {
  it("書きます て形:當成Ⅱ類與別行的語尾(書きて/書って/書んで)", () => {
    expect(wrongKana(kaku, "te").slice(0, 3)).toEqual([
      "かきて",
      "かって",
      "かんで",
    ]);
    expect(wrongConjugations(kaku, "te")[0].ruby).toEqual(rb("書(か)|きて"));
  });

  it("買います ない形:い段誤變 あ/や(買あない/買やない),不含正解 買わない", () => {
    const w = wrongKana(kau, "nai");
    expect(w).toEqual(
      expect.arrayContaining(["かあない", "かやない", "かいない"]),
    );
    expect(w).not.toContain("かわない");
  });

  it("行きます て形:照一般規則的「行いて」", () => {
    expect(wrongKana(iku, "te")).toContain("いいて");
    expect(wrongKana(iku, "te")).not.toContain("いって");
  });

  it("話します て形:當成Ⅱ類的「話して」恰為正解 → 過濾", () => {
    expect(wrongKana(hanasu, "te")).not.toContain("はなして");
    expect(wrongKana(hanasu, "te").slice(0, 3)).toEqual([
      "はなって",
      "はなんで",
      "はないて",
    ]);
  });

  it("例外照一般規則:ある → あらない、いらっしゃる → いらっしゃわない/いらっしゃう", () => {
    expect(wrongKana(aru, "nai")[0]).toBe("あらない");
    expect(wrongKana(aru, "nai")).not.toContain("ない");
    expect(wrongKana(irassharu, "nai")[0]).toBe("いらっしゃわない");
    expect(wrongKana(irassharu, "dict")[0]).toBe("いらっしゃう");
  });

  it("Ⅱ類當成Ⅰ類:食べらない、起いて、起かない、起く", () => {
    expect(wrongKana(taberu, "nai")).toEqual(["たべらない", "たべるない"]);
    expect(wrongKana(taberu, "te")).toEqual(["たべって", "たべんで"]);
    expect(wrongKana(okiru, "te")[0]).toBe("おいて");
    expect(wrongKana(okiru, "nai")[0]).toBe("おかない");
    expect(wrongKana(okiru, "dict")).toEqual(["おく"]);
    // ます形最後一音在漢字段(見(み)ます):不套行
    expect(wrongKana(miru, "nai")).toEqual(["みらない", "みるない"]);
  });

  it("います:去掉最後一音就沒有語幹,不出「って/う/わない」,改當成「る」結尾的Ⅰ類", () => {
    expect(wrongKana(iru, "te")).toEqual(["いって", "いんで"]);
    expect(wrongKana(iru, "nai")).toEqual(["いらない", "いるない"]);
    expect(wrongKana(iru, "dict")).toEqual([]);
    for (const form of formsOf(iru.pos))
      for (const k of wrongKana(iru, form))
        expect(k.startsWith("い")).toBe(true);
  });

  it("する:すない、しる(しない 是正確的ない形,不列為錯誤規則)", () => {
    expect(wrongKana(suru, "nai")).toEqual(["すない", "さない", "しらない"]);
    expect(wrongKana(suru, "dict")).toEqual(["しる", "す"]);
    expect(wrongKana(benkyou, "te")[0]).toBe("べんきょうしって");
  });

  it("来る:きない/くない、こて;漢字段讀音跟著改寫", () => {
    expect(wrongKana(kuru, "nai")).toEqual(["きない", "くない", "かない"]);
    expect(wrongKana(kuru, "dict")).toEqual(["きる", "こる"]);
    expect(wrongConjugations(kuru, "te")[0].ruby).toEqual(rb("来(こ)|て"));
    // 複合動詞:前綴保留
    expect(wrongConjugations(mottekuru, "nai")[0].ruby).toEqual(
      rb("持(も)|って |来(き)|ない"),
    );
  });

  it("ます系:名詞句的語尾(書きますでした、書きませんだった)", () => {
    expect(wrongKana(kaku, "mashita")).toEqual(["かきますでした"]);
    expect(wrongKana(kaku, "masendeshita")).toEqual([
      "かきませんだった",
      "かきますじゃありませんでした",
    ]);
  });

  it("い形容詞:保留「い」(高いでした、高いくない)、套な形容詞的規則(高いじゃ ない)", () => {
    expect(wrongKana(takai, "pastPolite")[0]).toBe("たかいでした");
    expect(wrongKana(takai, "neg")).toEqual(["たかいくない", "たかいじゃない"]);
    expect(wrongConjugations(takai, "neg")[1].ruby).toEqual(
      rb("高(たか)|いじゃ ない"),
    );
    expect(wrongKana(takai, "pastNegPolite")).toContain("たかくないでした");
  });

  it("いい:照一般規則的「いくない」在最前,不含正解 よくない", () => {
    expect(wrongKana(ii, "neg")[0]).toBe("いくない");
    expect(wrongKana(ii, "neg")).not.toContain("よくない");
    expect(wrongKana(ii, "past")[0]).toBe("いかった");
  });

  it("な形容詞:套い形容詞的規則(きれいくない)、混用(きれいじゃくない),不含「では」寫法", () => {
    expect(wrongKana(kirei, "neg")).toEqual([
      "きれいくない",
      "きれいじゃくない",
      "きれいなじゃない",
    ]);
    expect(wrongKana(shizuka, "pastPolite")).toEqual([
      "しずかかったです",
      "しずかなでした",
    ]);
    // 語幹末為漢字段:接成新的假名段
    expect(wrongConjugations(taihen, "neg")[0].ruby).toEqual(
      rb("大変(たいへん)|くない"),
    );
    for (const form of [
      "neg",
      "pastNeg",
      "negPolite",
      "pastNegPolite",
    ] as const) {
      expect(wrongKana(shizuka, form).some((k) => k.includes("では"))).toBe(
        false,
      );
    }
  });

  it("每個樣本 × 每一形:不含該字任何依規則成立的形(含不練的進階形、題目基底與「では」)、不重複、ruby 與 kana 一致", () => {
    for (const v of SAMPLES) {
      const valid = new Set(
        formsOf(v.pos).map((f) =>
          normalizeReading(conjugateByRule(v, f)?.kana ?? ""),
        ),
      );
      valid.add(normalizeReading(v.kana));
      for (const form of formsOf(v.pos)) {
        const wrong = wrongConjugations(v, form);
        const keys = wrong.map((c) => normalizeReading(c.kana));
        expect(new Set(keys).size).toBe(keys.length);
        for (const c of wrong) {
          expect(valid.has(normalizeReading(c.kana))).toBe(false);
          expect(normalizeReading(c.kana)).not.toMatch(
            /^(.*)では(ない|なかった|ありません)/,
          );
          expect(kanaOf(c.ruby)).toBe(c.kana);
        }
      }
    }
  });

  it("不活用或該詞性沒有此形:空陣列", () => {
    expect(wrongConjugations(item("名", "駅(えき)"), "te")).toEqual([]);
    expect(wrongConjugations(kaku, "adv")).toEqual([]);
    // 不練的進階形(あります 的可能形)
    expect(wrongConjugations(aru, "potential")).toEqual([]);
  });
});

describe("wrongConjugations:進階形的常見錯誤", () => {
  it("可能形:ら抜き(食べれる、来れる)、多加「れ」(書けれる)、當成Ⅱ類(書きられる);する(しれる)", () => {
    expect(wrongKana(taberu, "potential")).toEqual(["たべれる"]);
    expect(wrongKana(okiru, "potential")).toEqual(["おきれる", "おける"]);
    expect(wrongKana(kaku, "potential")).toEqual([
      "かけれる",
      "かきられる",
      "かかられる",
    ]);
    expect(wrongConjugations(kuru, "potential")[0].ruby).toEqual(
      rb("来(こ)|れる"),
    );
    expect(wrongKana(benkyou, "potential")[0]).toBe("べんきょうしれる");
  });

  it("意向形:辞書形 + よう(書くよう)、當成Ⅱ類(書きよう)、食べろう、来(き)よう", () => {
    expect(wrongKana(kaku, "volitional")).toEqual([
      "かくよう",
      "かきよう",
      "かこよう",
    ]);
    expect(wrongKana(taberu, "volitional")).toEqual(["たべろう", "たべるよう"]);
    expect(wrongConjugations(kuru, "volitional")[0].ruby).toEqual(
      rb("来(き)|よう"),
    );
  });

  it("命令形/禁止形:書きろ、書けろ;書けな、書かな;来(こ)るな(禁止形讀 く)", () => {
    expect(wrongKana(kaku, "imperative").slice(0, 2)).toEqual([
      "かきろ",
      "かけろ",
    ]);
    expect(wrongKana(taberu, "imperative")).toEqual(["たべれ"]);
    expect(wrongKana(kaku, "prohibitive").slice(0, 2)).toEqual([
      "かけな",
      "かかな",
    ]);
    // 書きな(= 書きなさい)在口語中成立,不列為錯誤
    expect(wrongKana(kaku, "prohibitive")).not.toContain("かきな");
    expect(wrongConjugations(kuru, "prohibitive")[0].ruby).toEqual(
      rb("来(こ)|るな"),
    );
  });

  it("條件形:書きれば、書くれば;形容詞 高いければ、いい → いければ、静かななら", () => {
    expect(wrongKana(kaku, "conditional")).toEqual([
      "かきれば",
      "かくれば",
      "かくば",
    ]);
    expect(wrongKana(takai, "conditional").slice(0, 2)).toEqual([
      "たかいければ",
      "たかいれば",
    ]);
    expect(wrongKana(ii, "conditional")[0]).toBe("いければ");
    expect(wrongKana(shizuka, "conditional")[0]).toBe("しずかななら");
    // 成立的「高いなら」「静かならば」不列
    expect(wrongKana(takai, "conditional")).not.toContain("たかいなら");
    expect(wrongKana(shizuka, "conditional")).not.toContain("しずかならば");
  });

  it("被動/使役:書かられる、さ入れ 書かさせる、買あれる/買あせる、食べせる;する(さられる、しさせる)", () => {
    expect(wrongKana(kaku, "passive")).toEqual(["かかられる", "かきられる"]);
    expect(wrongKana(kaku, "causative")).toEqual(["かかさせる", "かきさせる"]);
    expect(wrongKana(kau, "passive")).toContain("かあれる");
    expect(wrongKana(kau, "causative")).toContain("かあせる");
    expect(wrongKana(taberu, "causative")).toEqual(["たべせる", "たべらせる"]);
    // 「少了さ」恰為使役義的他動詞(見せる、着せる、寝せる):不當錯誤選項
    const kiru = item("動II", "着(き)|ます");
    expect(wrongKana(miru, "causative")).toEqual(["みらせる"]);
    expect(wrongKana(kiru, "causative")).toEqual(["きらせる"]);
    expect(wrongKana(neru, "causative")).toEqual(["ねらせる"]);
    for (let seed = 1; seed <= 20; seed++) {
      const q = makeDrillQuestion(miru, "causative", "mcq", seeded(seed), 50);
      expect(q?.options.map((o) => o.kana)).not.toContain("みせる");
      expect(q?.options).toHaveLength(4);
    }
    expect(wrongKana(taberu, "passive")).toEqual(["たべれる"]);
    expect(wrongKana(suru, "passive")).toEqual(["しられる", "さられる"]);
    expect(wrongKana(suru, "causative")).toEqual(["しさせる", "すさせる"]);
  });

  it("錯誤選項不可是該字依規則成立、但不練的形(わかります:わかれる 不當作錯誤)", () => {
    const wakaru = item("動I", "わかります");
    expect(conjugate(wakaru, "potential")).toBeNull();
    for (const f of formsOf(wakaru.pos)) {
      expect(wrongKana(wakaru, f)).not.toContain("わかれる");
    }
  });
});

describe("makeDrillQuestion", () => {
  it("選擇題:4 個選項、恰一個正解、選項讀音不重複、正解 = conjugate(不練的形回傳 null)", () => {
    for (const v of SAMPLES) {
      for (const form of formsOf(v.pos)) {
        if (conjugate(v, form) === null) {
          expect(makeDrillQuestion(v, form, "mcq", seeded(1))).toBeNull();
          continue;
        }
        const q = makeDrillQuestion(v, form, "mcq", seeded(1));
        expect(q).not.toBeNull();
        if (!q) continue;
        expect(q.options).toHaveLength(OPTION_COUNT);
        expect(q.options.filter((o) => o.correct)).toHaveLength(1);
        const keys = q.options.map((o) => normalizeReading(o.kana));
        expect(new Set(keys).size).toBe(OPTION_COUNT);
        expect(q.options.find((o) => o.correct)?.kana).toBe(
          conjugate(v, form)?.kana,
        );
      }
    }
  });

  it("錯誤規則不足時以同一個字的其他正確形補足(食べる:辞書形 → 食べた/食べて/食べない)", () => {
    const q = makeDrillQuestion(taberu, "dict", "mcq", seeded(1));
    expect(
      q?.options
        .filter((o) => !o.correct)
        .map((o) => o.kana)
        .sort(),
    ).toEqual(["たべた", "たべて", "たべない"].sort());
  });

  it("補足的形只用範圍內已教過的形(第 1–14 課:寝て 題不出た形 寝た),範圍較大時才用", () => {
    const early = makeDrillQuestion(neru, "te", "mcq", seeded(1), 14);
    expect(early?.options.map((o) => o.kana).sort()).toEqual(
      ["ねて", "ねって", "ねんで", "ねます"].sort(),
    );
    const later = makeDrillQuestion(neru, "te", "mcq", seeded(1), 19);
    expect(later?.options.map((o) => o.kana)).toContain("ねた");
  });

  it("選項只差讀音(来る:来て きて/こて/くて)時 forceReading;一般的題不需要", () => {
    const te = makeDrillQuestion(kuru, "te", "mcq", seeded(1));
    const surfaces = te?.options.map((o) => o.ruby.map((s) => s.b).join(""));
    expect(new Set(surfaces).size).toBeLessThan(OPTION_COUNT);
    expect(te?.forceReading).toBe(true);
    expect(makeDrillQuestion(kuru, "nai", "input")?.forceReading).toBe(true);
    expect(makeDrillQuestion(kaku, "te", "mcq", seeded(1))?.forceReading).toBe(
      false,
    );
    expect(makeDrillQuestion(kaku, "te", "input")?.forceReading).toBe(false);
  });

  it("補足的形不可是本題可接受的寫法(静かじゃ ない 題不出 静かでは ない)", () => {
    const q = makeDrillQuestion(shizuka, "neg", "mcq", seeded(3));
    expect(q?.options.some((o) => o.kana.includes("では"))).toBe(false);
  });

  it("選項順序由 rng 決定:同一種子結果相同", () => {
    const a = makeDrillQuestion(kaku, "te", "mcq", seeded(7));
    const b = makeDrillQuestion(kaku, "te", "mcq", seeded(7));
    expect(a?.options.map((o) => o.id)).toEqual(b?.options.map((o) => o.id));
    const orders = new Set(
      [1, 2, 3, 4, 5, 6].map((s) =>
        makeDrillQuestion(kaku, "te", "mcq", seeded(s))
          ?.options.map((o) => o.id)
          .join(","),
      ),
    );
    expect(orders.size).toBeGreaterThan(1);
  });

  it("輸入題:沒有選項;な形容詞否定另接受「では」", () => {
    const q = makeDrillQuestion(shizuka, "pastNegPolite", "input");
    expect(q?.options).toEqual([]);
    expect(q?.accepted.map((a) => a.kana)).toEqual([
      "しずかじゃありませんでした",
      "しずかではありませんでした",
    ]);
    expect(makeDrillQuestion(shizuka, "past", "input")?.accepted).toHaveLength(
      1,
    );
    expect(makeDrillQuestion(takai, "neg", "input")?.accepted).toHaveLength(1);
  });

  it("無法推導:null", () => {
    expect(makeDrillQuestion(kaku, "adv", "mcq")).toBeNull();
    expect(makeDrillQuestion(item("名", "駅(えき)"), "te", "mcq")).toBeNull();
    expect(makeDrillQuestion(irassharu, "imperative", "mcq")).toBeNull();
  });

  it("進階形:錯誤規則與易混淆的同字其他形交錯(書ける:書けれる、書かれる、書きられる);範圍內還沒教的形不混入", () => {
    const at50 = makeDrillQuestion(kaku, "potential", "mcq", seeded(1), 50);
    expect(at50?.options.map((o) => o.kana).sort()).toEqual(
      ["かける", "かけれる", "かかれる", "かきられる"].sort(),
    );
    // 第 27–36 課:被動(L37)、使役(L48)還沒教
    const at30 = makeDrillQuestion(kaku, "potential", "mcq", seeded(1), 30);
    expect(at30?.options.map((o) => o.kana).sort()).toEqual(
      ["かける", "かけれる", "かきられる", "かかられる"].sort(),
    );
    // 使役 ↔ 被動、命令 ↔ 禁止
    expect(
      makeDrillQuestion(kaku, "causative", "mcq", seeded(1), 50)?.options.map(
        (o) => o.kana,
      ),
    ).toContain("かかれる");
    expect(
      makeDrillQuestion(kaku, "imperative", "mcq", seeded(1), 50)?.options.map(
        (o) => o.kana,
      ),
    ).toContain("かくな");
  });

  it("Ⅱ類的可能形 = 被動形(食べられる):互為正解時不當作錯誤選項", () => {
    for (const form of ["potential", "passive"] as const) {
      const q = makeDrillQuestion(taberu, form, "mcq", seeded(2), 50);
      expect(q?.answer.kana).toBe("たべられる");
      expect(q?.options.filter((o) => o.kana === "たべられる")).toHaveLength(1);
      expect(q?.options.find((o) => o.kana === "たべられる")?.correct).toBe(
        true,
      );
      // ら抜き 為錯誤選項
      expect(q?.options.find((o) => o.kana === "たべれる")?.correct).toBe(
        false,
      );
    }
  });

  it("来る 的進階形:選項表面相同、只差讀音 → forceReading", () => {
    for (const form of ADVANCED_VERB_FORMS) {
      expect(
        makeDrillQuestion(kuru, form, "mcq", seeded(1), 50)?.forceReading,
        form,
      ).toBe(true);
    }
    expect(
      makeDrillQuestion(kaku, "potential", "mcq", seeded(1), 50)?.forceReading,
    ).toBe(false);
  });
});

describe("checkDrillAnswer:輸入題判分(沿用 quiz.ts 正規化)", () => {
  const te = makeDrillQuestion(kaku, "te", "input");
  const neg = makeDrillQuestion(shizuka, "neg", "input");
  const negPolite = makeDrillQuestion(kirei, "pastNegPolite", "input");
  const masen = makeDrillQuestion(
    item("動I", "読(よ)|みます"),
    "masen",
    "input",
  );

  it.each(["kaite", "かいて", "カイテ", " kaite "])(
    "書いて:%s → 對",
    (input) => {
      expect(te && checkDrillAnswer(input, te)).toBe(true);
    },
  );

  it.each(["kakite", "かって", "書いて"])(
    "書いて:%s → 錯(漢字輸入不要求)",
    (input) => {
      expect(te && checkDrillAnswer(input, te)).toBe(false);
    },
  );

  it.each([
    "shizukajanai",
    "しずかじゃ ない",
    "shizuka dewa nai",
    "shizuka de wa nai",
    "しずかではない",
  ])("静かじゃ ない:%s → 對(じゃ/では 皆可)", (input) => {
    expect(neg && checkDrillAnswer(input, neg)).toBe(true);
  });

  it("きれいじゃ ありませんでした:では 版本亦對;きれいくなかったです 錯", () => {
    expect(
      negPolite && checkDrillAnswer("kireidewaarimasendeshita", negPolite),
    ).toBe(true);
    expect(
      negPolite && checkDrillAnswer("きれいくなかったです", negPolite),
    ).toBe(false);
  });

  it("IME 習慣的 nn:yomimasenn → 對", () => {
    expect(masen && checkDrillAnswer("yomimasenn", masen)).toBe(true);
  });

  it("進階形:只接受題目要求的形狀(辞書形 書ける;書けます、ら抜き 食べれる 為錯)", () => {
    const potential = makeDrillQuestion(kaku, "potential", "input");
    expect(potential && checkDrillAnswer("kakeru", potential)).toBe(true);
    expect(potential && checkDrillAnswer("かけます", potential)).toBe(false);
    const taberareru = makeDrillQuestion(taberu, "potential", "input");
    expect(taberareru && checkDrillAnswer("taberareru", taberareru)).toBe(true);
    expect(taberareru && checkDrillAnswer("たべれる", taberareru)).toBe(false);
    const koi = makeDrillQuestion(kuru, "imperative", "input");
    expect(koi && checkDrillAnswer("koi", koi)).toBe(true);
    expect(koi && checkDrillAnswer("kiro", koi)).toBe(false);
    const kuruna = makeDrillQuestion(kuru, "prohibitive", "input");
    expect(kuruna && checkDrillAnswer("くるな", kuruna)).toBe(true);
    expect(kuruna && checkDrillAnswer("こるな", kuruna)).toBe(false);
    const nara = makeDrillQuestion(shizuka, "conditional", "input");
    expect(nara && checkDrillAnswer("shizukanara", nara)).toBe(true);
  });
});

describe("canInputDrill", () => {
  it("基底 + 一個假名(きれいで、きれいに)不出輸入題;其餘可以", () => {
    const answer = (v: DrillItem, f: ConjForm) => {
      const c = conjugate(v, f);
      if (!c) throw new Error("無法活用");
      return c;
    };
    expect(canInputDrill(kirei, answer(kirei, "te"))).toBe(false);
    expect(canInputDrill(kirei, answer(kirei, "adv"))).toBe(false);
    expect(canInputDrill(kirei, answer(kirei, "neg"))).toBe(true);
    expect(canInputDrill(takai, answer(takai, "adv"))).toBe(true);
    expect(canInputDrill(kuru, answer(kuru, "te"))).toBe(true);
    expect(canInputDrill(kaku, answer(kaku, "masen"))).toBe(true);
  });
});

describe("makeDrillRound", () => {
  const verbs = [
    "書(か)|きます",
    "読(よ)|みます",
    "待(ま)|ちます",
    "帰(かえ)|ります",
    "食(た)|べます",
    "見(み)|ます",
    "起(お)|きます",
    "勉強(べんきょう)|します",
    "来(き)|ます",
    "遊(あそ)|びます",
    "急(いそ)|ぎます",
    "話(はな)|します",
  ].map((r, i) => item(i < 4 || i > 8 ? "動I" : i < 7 ? "動II" : "動III", r));
  const adjs = [takai, kirei];

  it("10 題、字不重複、形只取勾選中該組的形", () => {
    const qs = makeDrillRound(
      [...verbs, ...adjs],
      { verb: ["te", "nai"], adj: [] },
      { rng: seeded(1) },
    );
    expect(qs).toHaveLength(10);
    expect(new Set(qs.map((q) => q.item.id)).size).toBe(10);
    for (const q of qs) {
      expect(q.group).toBe("verb");
      expect(["te", "nai"]).toContain(q.form);
    }
  });

  it("各形平均分配(出現次數相差不超過 1)", () => {
    const qs = makeDrillRound(
      verbs,
      { verb: ["te", "nai", "dict"], adj: [] },
      { rng: seeded(2) },
    );
    const counts = ["te", "nai", "dict"].map(
      (f) => qs.filter((q) => q.form === f).length,
    );
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
  });

  it("選擇題與輸入題交替;不適合輸入(きれいで)者改出選擇題", () => {
    const qs = makeDrillRound(
      verbs,
      { verb: ["te"], adj: [] },
      { rng: seeded(3) },
    );
    expect(qs.map((q) => q.type)).toEqual(
      Array.from({ length: 10 }, (_, i) => (i % 2 === 0 ? "mcq" : "input")),
    );
    const adjRound = makeDrillRound(
      [kirei],
      { verb: [], adj: ["te", "adv"] },
      { rng: seeded(3) },
    );
    expect(adjRound.map((q) => q.type)).toEqual(["mcq", "mcq"]);
  });

  it("字不夠時同一個字換別的形,(字, 形)不重複", () => {
    const qs = makeDrillRound(
      [kaku, taberu],
      { verb: ["masen", "te", "nai"], adj: [] },
      { rng: seeded(4) },
    );
    expect(qs).toHaveLength(6);
    expect(new Set(qs.map((q) => `${q.item.id}:${q.form}`)).size).toBe(6);
  });

  it("逐(字, 形)判斷:不練的進階形只少那一形(わかります 無可能形,仍出て形)", () => {
    const wakaru = item("動I", "わかります");
    const qs = makeDrillRound(
      [wakaru, kaku],
      { verb: ["te", "potential"], adj: [] },
      { rng: seeded(6) },
    );
    expect(qs.map((q) => `${q.item.kana}:${q.form}`).sort()).toEqual(
      ["わかります:te", "かきます:te", "かきます:potential"].sort(),
    );
    expect(makeDrillRound([wakaru], { verb: ["potential"], adj: [] })).toEqual(
      [],
    );
  });

  it("drillableCounts:各組只算勾選的形至少有一形能出題的字", () => {
    const wakaru = item("動I", "わかります");
    const pool = [wakaru, kaku, takai];
    expect(
      drillableCounts(pool, { verb: ["potential"], adj: ["neg"] }),
    ).toEqual({ verb: 1, adj: 1 });
    expect(
      drillableCounts(pool, { verb: ["te", "potential"], adj: [] }),
    ).toEqual({ verb: 2, adj: 0 });
    expect(drillableCounts([], { verb: ["te"], adj: ["neg"] })).toEqual({
      verb: 0,
      adj: 0,
    });
  });

  it("勾選中沒有適用的形:空陣列;同一種子結果相同", () => {
    expect(makeDrillRound(verbs, { verb: [], adj: ["neg"] })).toEqual([]);
    expect(makeDrillRound([], { verb: ["te"], adj: [] })).toEqual([]);
    const a = makeDrillRound(
      verbs,
      { verb: ["te", "nai"], adj: [] },
      { rng: seeded(9) },
    );
    const b = makeDrillRound(
      verbs,
      { verb: ["te", "nai"], adj: [] },
      { rng: seeded(9) },
    );
    expect(a.map((q) => `${q.item.id}:${q.form}:${q.type}`)).toEqual(
      b.map((q) => `${q.item.id}:${q.form}:${q.type}`),
    );
  });
});

describe("grammarLinks:該形的文法解說", () => {
  it("導入文法點;普通形另附規則所在的文法點", () => {
    expect(grammarLinks("動I", "te")).toEqual([
      { lesson: 14, grammarId: "L14-G03" },
    ]);
    expect(grammarLinks("動II", "nakatta")).toEqual([
      { lesson: 20, grammarId: "L20-G01" },
      { lesson: 17, grammarId: "L17-G01" },
    ]);
    expect(grammarLinks("い形", "neg")).toEqual([
      { lesson: 20, grammarId: "L20-G01" },
      { lesson: 8, grammarId: "L08-G02" },
    ]);
    expect(grammarLinks("い形", "past")[1]).toEqual({
      lesson: 12,
      grammarId: "L12-G02",
    });
    expect(grammarLinks("な形", "pastNeg")[1]).toEqual({
      lesson: 12,
      grammarId: "L12-G01",
    });
    expect(grammarLinks("名", "te")).toEqual([]);
  });

  it("進階形:連到寫了變換規則的文法點(不另附)", () => {
    expect(grammarLinks("動I", "potential")).toEqual([
      { lesson: 27, grammarId: "L27-G01" },
    ]);
    expect(grammarLinks("動II", "volitional")).toEqual([
      { lesson: 31, grammarId: "L31-G01" },
    ]);
    expect(grammarLinks("動III", "prohibitive")).toEqual([
      { lesson: 33, grammarId: "L33-G01" },
    ]);
    expect(grammarLinks("い形", "conditional")).toEqual([
      { lesson: 35, grammarId: "L35-G01" },
    ]);
    expect(grammarLinks("動I", "passive")[0].grammarId).toBe("L37-G01");
    expect(grammarLinks("動I", "causative")[0].grammarId).toBe("L48-G01");
  });

  it("網址:/lessons/N#Lxx-Gxx(課程頁切到文型並捲動)", () => {
    expect(grammarHref({ lesson: 14, grammarId: "L14-G03" })).toBe(
      "/lessons/14#L14-G03",
    );
  });
});
