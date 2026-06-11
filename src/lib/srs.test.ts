import { beforeEach } from "vitest";
import { db, getSetting, setSetting } from "./db";
import { addCards, buildQueue, countDue, previewIntervals, rate } from "./srs";

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
