import { beforeEach } from "vitest";
import { db, getSetting, setSetting } from "./db";
import {
  addCards,
  baseVocabId,
  cardDirection,
  ensureReverseCards,
  buildQueue,
  countDue,
  countLeeches,
  existingCardIds,
  getLeeches,
  isLeech,
  LEECH_THRESHOLD,
  previewIntervals,
  rate,
} from "./srs";
import type { CardRow } from "./db";

const NOW = Date.UTC(2026, 0, 1, 9, 0, 0); // 固定時間,確定性測試
const DAY = 86_400_000;

beforeEach(async () => {
  await Promise.all([db.cards.clear(), db.logs.clear(), db.settings.clear()]);
});

describe("addCards", () => {
  it("建立新卡(state=New),buildQueue 取得", async () => {
    await addCards(["L13-V001", "L13-V002"], 13, NOW);
    expect(await db.cards.count()).toBe(2);
    const card = await db.cards.get("L13-V001");
    expect(card?.state).toBe(0); // New
    expect(card?.lessonId).toBe(13);
    expect(card?.due).toBe(NOW);
  });

  it("冪等:重複加入不產生重複卡", async () => {
    await addCards(["L13-V001"], 13, NOW);
    await addCards(["L13-V001", "L13-V002"], 13, NOW);
    expect(await db.cards.count()).toBe(2);
  });

  it("冪等:不重置既有卡的進度", async () => {
    await addCards(["L13-V001"], 13, NOW);
    await rate("L13-V001", 3, NOW); // 評分後 reps=1、離開 New
    await addCards(["L13-V001"], 13, NOW + DAY);
    const card = await db.cards.get("L13-V001");
    expect(card?.reps).toBe(1);
    expect(card?.state).not.toBe(0);
  });
});

describe("buildQueue", () => {
  it("新卡受 newPerDay 上限裁切", async () => {
    await addCards(["a", "b", "c", "d", "e"], 13, NOW);
    await setSetting("newPerDay", 2);
    const queue = await buildQueue(NOW);
    expect(queue).toHaveLength(2);
    expect(queue.every((c) => c.state === 0)).toBe(true);
  });

  it("到期卡受 maxReviewsPerDay 上限裁切", async () => {
    await addCards(["a", "b", "c"], 13, NOW);
    const due = (await rate("a", 3, NOW)).due;
    await rate("b", 3, NOW);
    await rate("c", 3, NOW); // 三張同 due(fuzz 關閉)
    await setSetting("newPerDay", 0);
    await setSetting("maxReviewsPerDay", 2);
    const queue = await buildQueue(due);
    expect(queue).toHaveLength(2);
    expect(queue.every((c) => c.state !== 0)).toBe(true);
  });

  it("到期卡在前、新卡在後", async () => {
    await addCards(["rev"], 13, NOW);
    const due = (await rate("rev", 3, NOW)).due;
    await addCards(["new1"], 13, due); // 新卡
    const queue = await buildQueue(due);
    expect(queue.map((c) => c.cardId)).toEqual(["rev", "new1"]);
  });

  it("未到期的卡不入列", async () => {
    await addCards(["a"], 13, NOW);
    const due = (await rate("a", 3, NOW)).due;
    await setSetting("newPerDay", 0);
    const queue = await buildQueue(due - DAY); // 到期前一天
    expect(queue).toHaveLength(0);
  });
});

describe("rate", () => {
  it("更新卡片:離開 New、reps 遞增、due 前移", async () => {
    await addCards(["a"], 13, NOW);
    const updated = await rate("a", 3, NOW);
    expect(updated.reps).toBe(1);
    expect(updated.state).not.toBe(0);
    expect(updated.due).toBeGreaterThan(NOW);
  });

  it("寫入 log 且欄位正確", async () => {
    await addCards(["a"], 13, NOW);
    await rate("a", 3, NOW);
    const logs = await db.logs.toArray();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      cardId: "a",
      rating: 3,
      state: 0, // 評分當下(New)
      reviewedAt: NOW,
      elapsedDays: 0,
    });
    expect(typeof logs[0].due).toBe("number");
  });

  it("四評分:下次 due Again < Hard < Good < Easy", async () => {
    await addCards(["a", "b", "c", "d"], 13, NOW);
    const again = await rate("a", 1, NOW);
    const hard = await rate("b", 2, NOW);
    const good = await rate("c", 3, NOW);
    const easy = await rate("d", 4, NOW);
    expect(again.due).toBeLessThan(hard.due);
    expect(hard.due).toBeLessThan(good.due);
    expect(good.due).toBeLessThan(easy.due);
  });

  it("找不到卡片時丟錯", async () => {
    await expect(rate("missing", 3, NOW)).rejects.toThrow(/找不到卡片/);
  });
});

describe("countDue", () => {
  it("計算指定時間前到期的複習卡(排除 New)", async () => {
    await addCards(["a", "b", "new"], 13, NOW);
    const dueA = (await rate("a", 3, NOW)).due;
    await rate("b", 3, NOW); // 與 a 同 due
    expect(await countDue(dueA - DAY)).toBe(0); // 尚未到期
    expect(await countDue(dueA)).toBe(2); // a、b 到期;new 仍為 New 不計
  });
});

describe("existingCardIds", () => {
  it("回傳已加入的 id 子集", async () => {
    await addCards(["a", "b"], 13, NOW);
    expect((await existingCardIds(["a", "c"])).sort()).toEqual(["a"]);
    expect(await existingCardIds([])).toEqual([]);
    expect(await existingCardIds(["x", "y"])).toEqual([]);
  });
});

describe("previewIntervals", () => {
  it("四鍵預估遞增:Again ≤ Hard ≤ Good < Easy(不寫入資料)", async () => {
    await addCards(["a"], 13, NOW);
    const p = await previewIntervals("a", NOW);

    expect(p.again.due).toBeLessThanOrEqual(p.hard.due);
    expect(p.hard.due).toBeLessThanOrEqual(p.good.due);
    expect(p.good.due).toBeLessThan(p.easy.due);
    expect(p.again.due).toBeLessThan(p.easy.due);
    expect(p.easy.days).toBeGreaterThanOrEqual(p.good.days);

    // 預估不應改變卡片或寫 log
    expect((await db.cards.get("a"))?.reps).toBe(0);
    expect(await db.logs.count()).toBe(0);
  });

  it("找不到卡片時丟錯", async () => {
    await expect(previewIntervals("missing", NOW)).rejects.toThrow(
      /找不到卡片/,
    );
  });

  it("不改動既有設定值", async () => {
    await addCards(["a"], 13, NOW);
    await previewIntervals("a", NOW);
    expect(await getSetting("newPerDay")).toBe(10);
  });
});

describe("leech 頑固卡", () => {
  function card(id: string, lapses: number): CardRow {
    return {
      cardId: id,
      lessonId: 13,
      type: "vocab",
      due: NOW,
      stability: 1,
      difficulty: 5,
      reps: lapses,
      lapses,
      state: 2,
    };
  }

  it("isLeech:達門檻為 true,未達為 false", () => {
    expect(isLeech(card("a", LEECH_THRESHOLD - 1))).toBe(false);
    expect(isLeech(card("b", LEECH_THRESHOLD))).toBe(true);
    expect(isLeech(card("c", LEECH_THRESHOLD + 3))).toBe(true);
  });

  it("countLeeches:只算達門檻的卡", async () => {
    await db.cards.bulkAdd([
      card("a", 0),
      card("b", LEECH_THRESHOLD - 1),
      card("c", LEECH_THRESHOLD),
      card("d", LEECH_THRESHOLD + 2),
    ]);
    expect(await countLeeches()).toBe(2);
  });

  it("getLeeches:依 lapses 由多到少", async () => {
    await db.cards.bulkAdd([
      card("mid", LEECH_THRESHOLD + 1),
      card("low", LEECH_THRESHOLD - 1), // 非 leech,不應出現
      card("high", LEECH_THRESHOLD + 5),
      card("min", LEECH_THRESHOLD),
    ]);
    const leeches = await getLeeches();
    expect(leeches.map((c) => c.cardId)).toEqual(["high", "mid", "min"]);
  });
})

describe("雙向卡(T9.2)", () => {
  it("baseVocabId:去除回想卡尾綴", () => {
    expect(baseVocabId("L13-V001")).toBe("L13-V001");
    expect(baseVocabId("L13-V001@r")).toBe("L13-V001");
  });

  it("cardDirection:缺省視為 fwd", () => {
    expect(cardDirection({ direction: "rev" } as never)).toBe("rev");
    expect(cardDirection({} as never)).toBe("fwd");
  });

  it("reverseCards 關閉:addCards 只建正向卡", async () => {
    await addCards(["L13-V001"], 13, NOW);
    expect(await db.cards.count()).toBe(1);
    expect((await db.cards.get("L13-V001"))?.direction).toBe("fwd");
    expect(await db.cards.get("L13-V001@r")).toBeUndefined();
  });

  it("reverseCards 開啟:addCards 同時建正向+回想卡,且冪等", async () => {
    await setSetting("reverseCards", true);
    await addCards(["L13-V001", "L13-V002"], 13, NOW);
    expect(await db.cards.count()).toBe(4);
    expect((await db.cards.get("L13-V001@r"))?.direction).toBe("rev");
    expect((await db.cards.get("L13-V001@r"))?.lessonId).toBe(13);

    await addCards(["L13-V001", "L13-V002"], 13, NOW + DAY);
    expect(await db.cards.count()).toBe(4); // 冪等
  });

  it("ensureReverseCards:為既有正向卡回填回想卡(冪等,回傳新增數)", async () => {
    await addCards(["L13-V001", "L13-V002"], 13, NOW); // reverseCards 關,只有 2 張正向
    expect(await db.cards.count()).toBe(2);

    const added = await ensureReverseCards(NOW);
    expect(added).toBe(2);
    expect(await db.cards.count()).toBe(4);
    expect((await db.cards.get("L13-V002@r"))?.direction).toBe("rev");

    expect(await ensureReverseCards(NOW)).toBe(0); // 再跑不重複
    expect(await db.cards.count()).toBe(4);
  });

  it("回想卡進入到期佇列,並保留 base 單字 id 對應", async () => {
    await setSetting("reverseCards", true);
    await addCards(["L13-V001"], 13, NOW);
    const rev = await db.cards.get("L13-V001@r");
    expect(rev?.state).toBe(0); // New
    expect(baseVocabId(rev!.cardId)).toBe("L13-V001");
    const queue = await buildQueue(NOW);
    expect(queue.map((c) => c.cardId).sort()).toEqual(["L13-V001", "L13-V001@r"]);
  });
})
