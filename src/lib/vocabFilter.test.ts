import { PosEnum, type Pos } from "@/schemas/lesson";
import {
  countByPosGroup,
  filterByPosGroup,
  POS_FILTERS,
  posGroup,
  type PosGroup,
} from "./vocabFilter";

/** 13 種詞性的預期分組(新增 PosEnum 值時下方「全覆蓋」測試會失敗,提醒補分組) */
const EXPECTED: Record<Pos, PosGroup> = {
  名: "noun",
  動I: "verb",
  動II: "verb",
  動III: "verb",
  い形: "adjective",
  な形: "adjective",
  副: "other",
  助詞: "other",
  接続: "other",
  疑問詞: "other",
  数量詞: "other",
  慣用: "other",
  其他: "other",
};

const word = (id: string, pos: Pos) => ({ id, pos });

describe("posGroup", () => {
  it("預期表涵蓋全部 13 種 PosEnum", () => {
    expect(PosEnum.options).toHaveLength(13);
    expect(Object.keys(EXPECTED).sort()).toEqual([...PosEnum.options].sort());
  });

  it.each(PosEnum.options)("%s → 預期分組", (pos) => {
    expect(posGroup(pos)).toBe(EXPECTED[pos]);
  });

  it("名詞只有「名」;動詞三類;形容詞い/な", () => {
    const of = (g: PosGroup) => PosEnum.options.filter((p) => posGroup(p) === g);
    expect(of("noun")).toEqual(["名"]);
    expect(of("verb")).toEqual(["動I", "動II", "動III"]);
    expect(of("adjective")).toEqual(["い形", "な形"]);
    expect(of("other")).toHaveLength(7);
  });
});

describe("filterByPosGroup", () => {
  const vocab = [
    word("V001", "動I"),
    word("V002", "名"),
    word("V003", "い形"),
    word("V004", "副"),
    word("V005", "動III"),
    word("V006", "な形"),
    word("V007", "慣用"),
    word("V008", "名"),
  ];
  const ids = (xs: { id: string }[]) => xs.map((x) => x.id);

  it("all:全部(新陣列,原順序)", () => {
    const out = filterByPosGroup(vocab, "all");
    expect(ids(out)).toEqual(ids(vocab));
    expect(out).not.toBe(vocab);
  });

  it("各組只留該組的字,保留原順序", () => {
    expect(ids(filterByPosGroup(vocab, "noun"))).toEqual(["V002", "V008"]);
    expect(ids(filterByPosGroup(vocab, "verb"))).toEqual(["V001", "V005"]);
    expect(ids(filterByPosGroup(vocab, "adjective"))).toEqual(["V003", "V006"]);
    expect(ids(filterByPosGroup(vocab, "other"))).toEqual(["V004", "V007"]);
  });

  it("保留元素型別與其他欄位(回傳原物件)", () => {
    const [first] = filterByPosGroup(vocab, "verb");
    expect(first).toBe(vocab[0]);
  });

  it("該組沒有字 → 空陣列", () => {
    expect(filterByPosGroup([word("V001", "名")], "verb")).toEqual([]);
    expect(filterByPosGroup([], "all")).toEqual([]);
  });
});

describe("countByPosGroup", () => {
  it("各組字數,all = 總數 = 各組加總", () => {
    const counts = countByPosGroup(PosEnum.options.map((p, i) => word(`V${i}`, p)));
    expect(counts).toEqual({ all: 13, noun: 1, verb: 3, adjective: 2, other: 7 });
  });

  it("空陣列全為 0", () => {
    expect(countByPosGroup([])).toEqual({ all: 0, noun: 0, verb: 0, adjective: 0, other: 0 });
  });
});

describe("POS_FILTERS", () => {
  it("chips 順序:全部/名詞/動詞/形容詞/其他,每個篩選值恰一次", () => {
    expect(POS_FILTERS.map((f) => f.label)).toEqual(["全部", "名詞", "動詞", "形容詞", "其他"]);
    expect(POS_FILTERS.map((f) => f.key)).toEqual(["all", "noun", "verb", "adjective", "other"]);
  });
});
