import type { Pos, RubySeg } from "@/schemas/lesson";
import {
  ADJ_FORMS,
  CONJUGATION_EXCLUDED,
  FORM_INTRO,
  VERB_FORMS,
  conjClass,
  conjugate,
  formIntro,
  formsOf,
  isConjugable,
  type ConjForm,
  type ConjugableItem,
  type FormIntro,
} from "./conjugate";

/** 精簡的 ruby 寫法:以「|」分段,「漢字(よみ)」為漢字段,其餘為假名段 */
function rb(text: string): RubySeg[] {
  return text.split("|").map((part) => {
    const m = /^(.+)\((.+)\)$/.exec(part);
    return m ? { b: m[1], r: m[2] } : { b: part };
  });
}

/** 測試用單字;kana 預設為 ruby 讀音去空白 */
function item(pos: Pos, ruby: string, kana?: string): ConjugableItem {
  const segs = rb(ruby);
  return {
    id: "L99-V001",
    pos,
    ruby: segs,
    kana:
      kana ??
      segs
        .map((s) => s.r ?? s.b)
        .join("")
        .replace(/\s/g, ""),
  };
}

/** 活用結果的 ruby 以同一精簡寫法表示(便於比對) */
function show(v: ConjugableItem, form: ConjForm): string | null {
  const c = conjugate(v, form);
  return c && c.ruby.map((s) => (s.r ? `${s.b}(${s.r})` : s.b)).join("|");
}

function kana(v: ConjugableItem, form: ConjForm): string | null {
  return conjugate(v, form)?.kana ?? null;
}

describe("Ⅰ類動詞:ます形最後一音(い段)的各行", () => {
  // [ruby, て形, た形, ない形, 辞書形](L14-G03 練習A1、L17-G01、L18-G01、L19-G01)
  it.each([
    ["買(か)|います", "かって", "かった", "かわない", "かう"], // い → わ
    ["待(ま)|ちます", "まって", "まった", "またない", "まつ"],
    ["帰(かえ)|ります", "かえって", "かえった", "かえらない", "かえる"],
    ["飲(の)|みます", "のんで", "のんだ", "のまない", "のむ"],
    ["遊(あそ)|びます", "あそんで", "あそんだ", "あそばない", "あそぶ"],
    ["死(し)|にます", "しんで", "しんだ", "しなない", "しぬ"],
    ["書(か)|きます", "かいて", "かいた", "かかない", "かく"],
    ["泳(およ)|ぎます", "およいで", "およいだ", "およがない", "およぐ"],
    ["話(はな)|します", "はなして", "はなした", "はなさない", "はなす"],
  ])("%s → %s / %s / %s / %s", (ruby, te, ta, nai, dict) => {
    const v = item("動I", ruby);
    expect(kana(v, "te")).toBe(te);
    expect(kana(v, "ta")).toBe(ta);
    expect(kana(v, "nai")).toBe(nai);
    expect(kana(v, "nakatta")).toBe(nai.replace(/い$/, "かった"));
    expect(kana(v, "dict")).toBe(dict);
  });

  it("只改假名段,漢字段與讀音原樣保留", () => {
    const v = item("動I", "書(か)|きます");
    expect(show(v, "te")).toBe("書(か)|いて");
    expect(show(v, "nai")).toBe("書(か)|かない");
    expect(show(v, "dict")).toBe("書(か)|く");
  });

  it("ます系只換「ます」", () => {
    const v = item("動I", "書(か)|きます");
    expect(show(v, "masu")).toBe("書(か)|きます");
    expect(show(v, "masen")).toBe("書(か)|きません");
    expect(show(v, "mashita")).toBe("書(か)|きました");
    expect(show(v, "masendeshita")).toBe("書(か)|きませんでした");
  });

  it("行く系:最後一詞讀音為 いきます 者 て/た 形為 って/った,其餘照規則", () => {
    const iku = item("動I", "行(い)|きます");
    expect(show(iku, "te")).toBe("行(い)|って");
    expect(show(iku, "ta")).toBe("行(い)|った");
    expect(show(iku, "nai")).toBe("行(い)|かない");
    expect(show(iku, "dict")).toBe("行(い)|く");
    expect(kana(item("動I", "うまく いきます"), "te")).toBe("うまくいって");
    // 同樣是「〜きます」但不是行く:照 き → いて
    expect(kana(item("動I", "聞(き)|きます"), "te")).toBe("きいて");
    expect(kana(item("動I", "引(ひ)|きます"), "te")).toBe("ひいて");
    expect(kana(item("動I", "歩(ある)|きます"), "ta")).toBe("あるいた");
  });

  it("あります:ない形 ない、なかった;其他形照 り 行", () => {
    const v = item("動I", "あります");
    expect(show(v, "nai")).toBe("ない");
    expect(show(v, "nakatta")).toBe("なかった");
    expect(show(v, "te")).toBe("あって");
    expect(show(v, "dict")).toBe("ある");
  });

  it("-aru 敬語:〜います 依 り 行活用(不是 い → わ/う)", () => {
    const v = item("動I", "いらっしゃいます");
    expect(kana(v, "dict")).toBe("いらっしゃる");
    expect(kana(v, "te")).toBe("いらっしゃって");
    expect(kana(v, "ta")).toBe("いらっしゃった");
    expect(kana(v, "nai")).toBe("いらっしゃらない");
    expect(kana(v, "nakatta")).toBe("いらっしゃらなかった");
    expect(kana(item("動I", "おっしゃいます"), "nai")).toBe("おっしゃらない");
    expect(kana(item("動I", "くださいます"), "dict")).toBe("くださる");
    expect(kana(item("動I", "なさいます"), "nai")).toBe("なさらない");
    // 一般的 〜います 仍是 い → わ
    expect(kana(item("動I", "言(い)|います"), "nai")).toBe("いわない");
  });

  it("ございます:不推導(回傳 null)", () => {
    const v = item("動I", "ございます");
    for (const form of VERB_FORMS) expect(conjugate(v, form)).toBeNull();
  });
});

describe("Ⅱ類動詞", () => {
  it("ます → る/て/た/ない/なかった", () => {
    const v = item("動II", "食(た)|べます");
    expect(show(v, "dict")).toBe("食(た)|べる");
    expect(show(v, "te")).toBe("食(た)|べて");
    expect(show(v, "ta")).toBe("食(た)|べた");
    expect(show(v, "nai")).toBe("食(た)|べない");
    expect(show(v, "nakatta")).toBe("食(た)|べなかった");
  });

  it("語幹整個在漢字段(寝(ね)[ます])也可以", () => {
    const v = item("動II", "寝(ね)|ます");
    expect(show(v, "dict")).toBe("寝(ね)|る");
    expect(show(v, "masen")).toBe("寝(ね)|ません");
  });

  it("着ます(動II)與来ます(動III)同讀音,依詞性區分", () => {
    expect(show(item("動II", "着(き)|ます"), "nai")).toBe("着(き)|ない");
    expect(show(item("動III", "来(き)|ます"), "nai")).toBe("来(こ)|ない");
  });
});

describe("Ⅲ類動詞", () => {
  it("する複合:します → する/して/した/しない/しなかった", () => {
    const v = item("動III", "勉強(べんきょう)|します");
    expect(show(v, "dict")).toBe("勉強(べんきょう)|する");
    expect(show(v, "te")).toBe("勉強(べんきょう)|して");
    expect(show(v, "ta")).toBe("勉強(べんきょう)|した");
    expect(show(v, "nai")).toBe("勉強(べんきょう)|しない");
    expect(show(v, "nakatta")).toBe("勉強(べんきょう)|しなかった");
    expect(show(item("動III", "します"), "dict")).toBe("する");
    expect(show(item("動III", "そのままに します"), "te")).toBe(
      "そのままに して",
    );
  });

  it("来ます:改寫「来」段讀音(く/こ/き)", () => {
    const v = item("動III", "来(き)|ます");
    expect(show(v, "dict")).toBe("来(く)|る");
    expect(show(v, "nai")).toBe("来(こ)|ない");
    expect(show(v, "nakatta")).toBe("来(こ)|なかった");
    expect(show(v, "te")).toBe("来(き)|て");
    expect(show(v, "ta")).toBe("来(き)|た");
    expect(show(v, "masen")).toBe("来(き)|ません");
    expect(kana(v, "nai")).toBe("こない");
  });

  it("来ます複合:前綴原樣保留,只改最後的「来」", () => {
    const v = item("動III", "持(も)|って |来(き)|ます");
    expect(show(v, "nai")).toBe("持(も)|って |来(こ)|ない");
    expect(kana(v, "dict")).toBe("もってくる");
  });

  it("假名書寫的 きます(動III)同樣推導", () => {
    const v = item("動III", "きます");
    expect(show(v, "dict")).toBe("くる");
    expect(show(v, "nai")).toBe("こない");
    expect(show(v, "te")).toBe("きて");
    expect(show(item("動III", "持(も)|って きます"), "nai")).toBe(
      "持(も)|って こない",
    );
  });

  it("最後一詞不是 きます/来ます 的「〜きます」動III(詞性誤標)回傳 null", () => {
    for (const ruby of ["起(お)|きます", "できます", "生(い)|きます"]) {
      const v = item("動III", ruby);
      for (const form of VERB_FORMS) expect(conjugate(v, form)).toBeNull();
    }
  });
});

describe("い形容詞", () => {
  it("去掉「い」:くない/かった/くなかった/くて/く 與丁寧體", () => {
    const v = item("い形", "寒(さむ)|い");
    expect(show(v, "neg")).toBe("寒(さむ)|くない");
    expect(show(v, "past")).toBe("寒(さむ)|かった");
    expect(show(v, "pastNeg")).toBe("寒(さむ)|くなかった");
    expect(show(v, "te")).toBe("寒(さむ)|くて");
    expect(show(v, "adv")).toBe("寒(さむ)|く");
    expect(show(v, "negPolite")).toBe("寒(さむ)|くないです");
    expect(show(v, "pastPolite")).toBe("寒(さむ)|かったです");
    expect(show(v, "pastNegPolite")).toBe("寒(さむ)|くなかったです");
  });

  it("いい → よ-;替代說法「いい （よい）」只活用括號外", () => {
    expect(show(item("い形", "いい"), "neg")).toBe("よくない");
    expect(show(item("い形", "いい"), "past")).toBe("よかった");
    const alt = item("い形", "いい （よい）", "いい");
    expect(show(alt, "te")).toBe("よくて");
    expect(kana(alt, "pastNegPolite")).toBe("よくなかったです");
  });

  it("只看整個詞是 いい:かわいい 照一般規則", () => {
    expect(kana(item("い形", "かわいい"), "neg")).toBe("かわいくない");
  });

  it("同讀音並列只活用第一個寫法", () => {
    const v = item("い形", "暑(あつ)|い、|熱(あつ)|い", "あつい");
    expect(show(v, "neg")).toBe("暑(あつ)|くない");
    expect(kana(v, "neg")).toBe("あつくない");
  });

  it("並列的「、」不在假名段結尾(無法確定第一個寫法)時回傳 null", () => {
    expect(
      conjugate(item("い形", "あつい、あつい", "あつい"), "neg"),
    ).toBeNull();
  });
});

describe("な形容詞", () => {
  it("［な］在假名段:去掉後接語尾,「じゃ ない」保留分かち書き空格", () => {
    const v = item("な形", "静(しず)|か［な］", "しずか");
    expect(show(v, "neg")).toBe("静(しず)|かじゃ ない");
    expect(show(v, "past")).toBe("静(しず)|かだった");
    expect(show(v, "pastNeg")).toBe("静(しず)|かじゃ なかった");
    expect(show(v, "te")).toBe("静(しず)|かで");
    expect(show(v, "adv")).toBe("静(しず)|かに");
    expect(show(v, "negPolite")).toBe("静(しず)|かじゃ ありません");
    expect(show(v, "pastPolite")).toBe("静(しず)|かでした");
    expect(show(v, "pastNegPolite")).toBe("静(しず)|かじゃ ありませんでした");
    expect(kana(v, "neg")).toBe("しずかじゃない");
  });

  it("［な］自成一段、〔な〕、無括號(漢字段結尾)", () => {
    expect(show(item("な形", "有名(ゆうめい)|［な］", "ゆうめい"), "neg")).toBe(
      "有名(ゆうめい)|じゃ ない",
    );
    expect(show(item("な形", "いろいろ〔な〕", "いろいろ"), "past")).toBe(
      "いろいろだった",
    );
    expect(show(item("な形", "大変(たいへん)"), "te")).toBe(
      "大変(たいへん)|で",
    );
  });

  it("kana 欄含［な］(すき［な］)時輸出 kana 為純假名", () => {
    const v = item("な形", "好(す)|き［な］", "すき［な］");
    expect(kana(v, "neg")).toBe("すきじゃない");
  });
});

describe("回傳 null 的情況", () => {
  it("不活用的詞性", () => {
    const noun = item("名", "学生(がくせい)");
    for (const form of [...VERB_FORMS, ...ADJ_FORMS]) {
      expect(conjugate(noun, form)).toBeNull();
    }
  });

  it("詞性沒有此形:動詞問形容詞專屬的形、形容詞問動詞專屬的形", () => {
    const verb = item("動I", "書(か)|きます");
    expect(conjugate(verb, "adv")).toBeNull();
    expect(conjugate(verb, "negPolite")).toBeNull();
    const adj = item("い形", "寒(さむ)|い");
    expect(conjugate(adj, "dict")).toBeNull();
    expect(conjugate(adj, "masen")).toBeNull();
    // te 兩者共用,依詞性決定語尾
    expect(kana(verb, "te")).toBe("かいて");
    expect(kana(adj, "te")).toBe("さむくて");
  });

  it("動詞不是ます形", () => {
    expect(conjugate(item("動II", "離(はな)|れた"), "te")).toBeNull();
  });

  it("Ⅰ類的最後一音不在假名段、或不是い段", () => {
    expect(conjugate(item("動I", "書き(かき)|ます"), "te")).toBeNull();
    expect(conjugate(item("動I", "変(か)|えます"), "te")).toBeNull();
  });

  it("ruby 讀音與 kana 欄不一致(資料有誤)", () => {
    expect(
      conjugate(item("動I", "書(か)|きます", "よみます"), "te"),
    ).toBeNull();
  });

  it("殘留無法處理的記號", () => {
    expect(
      conjugate(item("動I", "〜を |書(か)|きます", "をかきます"), "te"),
    ).toBeNull();
  });

  it("排除清單中的 id,即使形狀可推導", () => {
    const v = { ...item("動I", "借(か)|ります"), id: "L07-V006" };
    expect(CONJUGATION_EXCLUDED.has(v.id)).toBe(true);
    expect(conjugate(v, "te")).toBeNull();
    expect(isConjugable(v)).toBe(false);
  });
});

describe("isConjugable", () => {
  it("未指定形:該詞性每一形都能推導", () => {
    expect(isConjugable(item("動I", "書(か)|きます"))).toBe(true);
    expect(isConjugable(item("な形", "大変(たいへん)"))).toBe(true);
    expect(isConjugable(item("名", "学生(がくせい)"))).toBe(false);
    expect(isConjugable(item("動I", "ございます"))).toBe(false);
  });

  it("指定形:看該形", () => {
    const verb = item("動I", "書(か)|きます");
    expect(isConjugable(verb, "nai")).toBe(true);
    expect(isConjugable(verb, "adv")).toBe(false);
  });
});

it("不改動輸入的 ruby", () => {
  const v = item("動III", "持(も)|って |来(き)|ます");
  const before = JSON.parse(JSON.stringify(v.ruby)) as RubySeg[];
  for (const form of VERB_FORMS) conjugate(v, form);
  expect(v.ruby).toEqual(before);
});

describe("類別、形與導入課次", () => {
  it("conjClass / formsOf", () => {
    expect(conjClass("動I")).toBe("verb");
    expect(conjClass("動III")).toBe("verb");
    expect(conjClass("い形")).toBe("iAdj");
    expect(conjClass("な形")).toBe("naAdj");
    expect(conjClass("副")).toBeNull();
    expect(formsOf("動II")).toBe(VERB_FORMS);
    expect(formsOf("な形")).toBe(ADJ_FORMS);
    expect(formsOf("名")).toEqual([]);
  });

  it("FORM_INTRO:lesson 與文法點 id 的課號一致;各形依導入順序排列", () => {
    const tables: [Readonly<Record<string, FormIntro>>, readonly string[]][] = [
      [FORM_INTRO.verb, VERB_FORMS],
      [FORM_INTRO.iAdj, ADJ_FORMS],
      [FORM_INTRO.naAdj, ADJ_FORMS],
    ];
    for (const [table, forms] of tables) {
      expect(Object.keys(table).sort()).toEqual([...forms].sort());
      const intros = forms.map((f) => table[f]);
      for (const intro of intros) {
        expect(intro.grammarId).toMatch(/^L\d{2}-G\d{2}$/);
        expect(intro.lesson).toBe(Number(intro.grammarId.slice(1, 3)));
      }
      const lessons = intros.map((i) => i.lesson);
      expect(lessons).toEqual([...lessons].sort((a, b) => a - b));
    }
  });

  it("formIntro 依詞性區分共用的 te", () => {
    expect(formIntro("動I", "te")).toEqual({
      lesson: 14,
      grammarId: "L14-G03",
    });
    expect(formIntro("い形", "te")).toEqual({
      lesson: 16,
      grammarId: "L16-G02",
    });
    expect(formIntro("な形", "te")).toEqual({
      lesson: 16,
      grammarId: "L16-G03",
    });
    expect(formIntro("い形", "pastPolite")?.grammarId).toBe("L12-G02");
    expect(formIntro("な形", "pastPolite")?.grammarId).toBe("L12-G01");
    expect(formIntro("動II", "nakatta")?.grammarId).toBe("L20-G01");
    expect(formIntro("動I", "adv")).toBeNull();
    expect(formIntro("い形", "dict")).toBeNull();
    expect(formIntro("名", "te")).toBeNull();
  });
});
