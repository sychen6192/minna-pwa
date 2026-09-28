import {
  canRelearnAgain,
  insertRelearn,
  MAX_RELEARN_REPEATS,
  RELEARN_GAP,
} from "./relearn";

type Item = { id: string; relearn?: number };
const make = (n: number): Item[] =>
  Array.from({ length: n }, (_, i) => ({ id: `c${i}` }));
const ids = (items: Item[]) =>
  items.map((x) => (x.relearn ? `${x.id}+${x.relearn}` : x.id));

describe("insertRelearn", () => {
  it("於 index 之後約 RELEARN_GAP 張處插入重看副本(relearn = 1),不改動原陣列", () => {
    expect(RELEARN_GAP).toBe(5);
    const items = make(10);
    const next = insertRelearn(items, 0);
    expect(ids(next)).toEqual([
      "c0",
      "c1",
      "c2",
      "c3",
      "c4",
      "c5",
      "c0+1",
      "c6",
      "c7",
      "c8",
      "c9",
    ]);
    expect(items).toHaveLength(10);
    expect(items[0].relearn).toBeUndefined();
  });

  it("剩餘不足 gap 張時插在最後", () => {
    const items = make(3);
    expect(ids(insertRelearn(items, 1))).toEqual(["c0", "c1", "c2", "c1+1"]);
    expect(ids(insertRelearn(items, 2))).toEqual(["c0", "c1", "c2", "c2+1"]);
  });

  it("重看項再插入時 relearn 遞增;「還不熟」最多再插入 MAX_RELEARN_REPEATS 次", () => {
    expect(MAX_RELEARN_REPEATS).toBe(2);
    let items: Item[] = [{ id: "x" }];
    items = insertRelearn(items, 0); // 評重來 → 第 1 次重看
    items = insertRelearn(items, 1); // 還不熟 → 第 2 次
    items = insertRelearn(items, 2); // 還不熟 → 第 3 次
    expect(ids(items)).toEqual(["x", "x+1", "x+2", "x+3"]);
    expect(canRelearnAgain(items[3])).toBe(false);
    expect(insertRelearn(items, 3)).toBe(items); // 已達上限:原陣列
  });

  it("index 無效時回傳原陣列", () => {
    const items = make(2);
    expect(insertRelearn(items, 5)).toBe(items);
  });

  it("canRelearnAgain:一般卡與未達上限的重看項為 true", () => {
    expect(canRelearnAgain({})).toBe(true);
    expect(canRelearnAgain({ relearn: 1 })).toBe(true);
    expect(canRelearnAgain({ relearn: MAX_RELEARN_REPEATS })).toBe(true);
    expect(canRelearnAgain({ relearn: MAX_RELEARN_REPEATS + 1 })).toBe(false);
  });
});
