import { afterEach, beforeEach } from "vitest";
import { useTimeZone } from "@/test/timeZone";
import { db, getSetting, setSetting } from "./db";
import {
  addCards,
  baseVocabId,
  cardDirection,
  ensureReverseCards,
  buildQueue,
  countDueByTomorrow,
  countLeeches,
  hasAnyCards,
  queueCounts,
  setFuzzForTesting,
  setWordSuspended,
  suspendedWordIds,
  existingCardIds,
  getLeeches,
  isLeech,
  LEECH_THRESHOLD,
  previewIntervals,
  rate,
  requeueWrong,
  undoRate,
} from "./srs";
import { MATURE_STABILITY } from "./stats";
import { addStudyDays, nextStudyDayStart, studyDayKey, studyDayStart } from "./studyDay";
import type { CardRow } from "./db";

const NOW = Date.UTC(2026, 0, 1, 9, 0, 0); // 固定時間,確定性測試
const DAY = 86_400_000;

beforeEach(async () => {
  await Promise.all([db.cards.clear(), db.logs.clear(), db.settings.clear()]);
});

// 在任何測試改動前記下模組預設值(正式環境應開啟 fuzz,見「fuzz(T10.2)」)
const FUZZ_DEFAULT = setFuzzForTesting(true);

afterEach(() => {
  setFuzzForTesting(true); // 預設與正式環境相同(fuzz 開啟)
});

/** 佇列的 cardId(保留順序) */
const queueIds = (cards: CardRow[]) => cards.map((c) => c.cardId);

/** 已進入 Review 的卡(直接寫 DB,不經 rate;due/lastReview 由呼叫端指定)。 */
function reviewCard(cardId: string, due: number, overrides: Partial<CardRow> = {}): CardRow {
  return {
    cardId,
    lessonId: 13,
    type: "vocab",
    direction: cardId.endsWith("@r") ? "rev" : "fwd",
    due,
    stability: 10,
    difficulty: 5,
    reps: 3,
    lapses: 0,
    state: 2,
    lastReview: due - 10 * DAY,
    ...overrides,
  };
}

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

  it("回傳實際新建的正向卡數(已存在者與補建的 @r 不計;重複 id 只算一次)", async () => {
    expect(await addCards(["L13-V001", "L13-V002"], 13, NOW)).toBe(2);
    expect(await addCards(["L13-V001", "L13-V002", "L13-V003"], 13, NOW)).toBe(1);
    expect(await addCards(["L13-V001"], 13, NOW)).toBe(0);
    expect(await addCards([], 13, NOW)).toBe(0);
    expect(await addCards(["L13-V004", "L13-V004"], 13, NOW)).toBe(1);
    expect(await db.cards.count()).toBe(4);

    // 回想卡開啟:既有正向卡只補建 @r → 新加入 0 字;新字建兩張卡仍算 1 字
    await setSetting("reverseCards", true);
    expect(await addCards(["L13-V001", "L13-V005"], 13, NOW)).toBe(1);
    expect(await db.cards.get("L13-V001@r")).toBeDefined();
    expect(await db.cards.count()).toBe(7);
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
    const due = (await rate("a", 3, NOW)).card.due;
    await rate("b", 3, NOW);
    await rate("c", 3, NOW); // 三張同 due(新卡首評 Good 固定 3 天,fuzz 不作用)
    await setSetting("newPerDay", 0);
    await setSetting("maxReviewsPerDay", 2);
    const queue = await buildQueue(due);
    expect(queue).toHaveLength(2);
    expect(queue.every((c) => c.state !== 0)).toBe(true);
  });

  it("到期卡在前、新卡在後", async () => {
    await addCards(["rev"], 13, NOW);
    const due = (await rate("rev", 3, NOW)).card.due;
    await addCards(["new1"], 13, due); // 新卡
    const queue = await buildQueue(due);
    expect(queue.map((c) => c.cardId)).toEqual(["rev", "new1"]);
  });

  it("未到期的卡不入列", async () => {
    await addCards(["a"], 13, NOW);
    const due = (await rate("a", 3, NOW)).card.due;
    await setSetting("newPerDay", 0);
    expect(await buildQueue(due - DAY)).toHaveLength(0); // 到期前一天
    // 到期學習日的前一刻仍不入列
    expect(await buildQueue(studyDayStart(due) - 1)).toHaveLength(0);
  });

  it("按日到期:到期學習日一開始即入列(不必等到 due 的時刻)", async () => {
    await addCards(["a"], 13, NOW);
    const due = (await rate("a", 3, NOW)).card.due;
    await setSetting("newPerDay", 0);
    const queue = await buildQueue(studyDayStart(due));
    expect(queue.map((c) => c.cardId)).toEqual(["a"]);
  });
});

describe("rate", () => {
  it("更新卡片:離開 New、reps 遞增、due 前移", async () => {
    await addCards(["a"], 13, NOW);
    const { card: updated } = await rate("a", 3, NOW);
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
      due: NOW, // 評分前的 due(新卡建立時刻)
    });
  });

  it("log 時間欄位為真實時刻:due = 評分前的 due,reviewedAt = 評分時刻", async () => {
    await addCards(["a"], 13, NOW);
    const { card: first } = await rate("a", 3, NOW);
    const at = first.due + 2 * 3600_000; // 到期後 2 小時複習
    await rate("a", 3, at);
    const second = (await db.logs.toArray()).find((l) => l.state === 2);
    expect(second).toMatchObject({ due: first.due, reviewedAt: at });
    expect((await db.cards.get("a"))?.lastReview).toBe(at);
  });

  it("四評分:下次 due Again < Hard < Good < Easy", async () => {
    await addCards(["a", "b", "c", "d"], 13, NOW);
    const { card: again } = await rate("a", 1, NOW);
    const { card: hard } = await rate("b", 2, NOW);
    const { card: good } = await rate("c", 3, NOW);
    const { card: easy } = await rate("d", 4, NOW);
    expect(again.due).toBeLessThan(hard.due);
    expect(hard.due).toBeLessThan(good.due);
    expect(good.due).toBeLessThan(easy.due);
  });

  it("找不到卡片時丟錯", async () => {
    await expect(rate("missing", 3, NOW)).rejects.toThrow(/找不到卡片/);
  });
});

/** 今日佇列中的到期(複習)卡數 */
const dueCount = async (now: number) => (await queueCounts(now)).due;

describe("到期判定(按學習日)", () => {
  it("今日(學習日)到期的複習卡,當日稍晚才到期者也算(排除 New)", async () => {
    await addCards(["a", "b", "new"], 13, NOW);
    const dueA = (await rate("a", 3, NOW)).card.due;
    await rate("b", 3, NOW); // 與 a 同 due
    expect(await dueCount(dueA - DAY)).toBe(0); // 尚未到期
    expect(await dueCount(studyDayStart(dueA) - 1)).toBe(0); // 前一學習日最後一刻
    expect(await dueCount(studyDayStart(dueA))).toBe(2); // 到期日一開始即計
    expect(await dueCount(dueA)).toBe(2); // a、b 到期;new 仍為 New 不計
  });

  it("countDueByTomorrow:到明日學習日結束前到期者(明日到期預估)", async () => {
    await addCards(["a"], 13, NOW);
    const dueA = (await rate("a", 3, NOW)).card.due;
    expect(await countDueByTomorrow(addStudyDays(dueA, -2))).toBe(0); // 後天才到期
    expect(await dueCount(addStudyDays(dueA, -1))).toBe(0);
    expect(await countDueByTomorrow(addStudyDays(dueA, -1))).toBe(1); // 明日到期
    expect(await countDueByTomorrow(dueA)).toBe(1); // 今日未完成者也計入
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

  it("isLeech:成熟(stability ≥ MATURE_STABILITY)後解除;再遺忘、stability 掉回門檻下即再列入", () => {
    expect(isLeech({ ...card("m", 4), stability: 30 })).toBe(false);
    expect(isLeech({ ...card("m", LEECH_THRESHOLD + 5), stability: MATURE_STABILITY })).toBe(false);
    expect(isLeech({ ...card("m", LEECH_THRESHOLD), stability: MATURE_STABILITY - 0.1 })).toBe(true);
    expect(isLeech({ ...card("m", LEECH_THRESHOLD + 1), stability: 2 })).toBe(true); // 成熟後又遺忘
  });

  it("countLeeches / getLeeches:已成熟的頑固卡不再列入(首頁警示與練習清單)", async () => {
    await db.cards.bulkAdd([
      card("still", LEECH_THRESHOLD + 2),
      { ...card("recovered", LEECH_THRESHOLD + 6), stability: 30 },
    ]);
    expect(await countLeeches()).toBe(1);
    expect((await getLeeches()).map((c) => c.cardId)).toEqual(["still"]);
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

  it("回想卡保留 base 單字 id 對應,於正向卡首評的隔日起入列(T10.2 兄弟卡 bury)", async () => {
    await setSetting("reverseCards", true);
    await addCards(["L13-V001"], 13, NOW);
    const rev = await db.cards.get("L13-V001@r");
    expect(rev?.state).toBe(0); // New
    expect(baseVocabId(rev!.cardId)).toBe("L13-V001");
    // 正向卡仍為 New → 回想卡不入列
    expect(queueIds(await buildQueue(NOW))).toEqual(["L13-V001"]);
    await rate("L13-V001", 3, NOW);
    expect(await buildQueue(NOW + 60_000)).toEqual([]); // 首評在今日 → 回想卡 bury
    expect(queueIds(await buildQueue(addStudyDays(NOW, 1)))).toEqual(["L13-V001@r"]);
  });
})

describe("suspend 已會/暫停(T9.3;T10.3 以字為單位)", () => {
  it("setWordSuspended:暫停的卡不進複習佇列、不計到期", async () => {
    await addCards(["a", "b"], 13, NOW);
    await rate("a", 3, NOW); // a 進入複習態
    const dueA = (await db.cards.get("a"))!.due;

    await setWordSuspended("a", true);
    const queue = await buildQueue(dueA);
    expect(queue.map((c) => c.cardId)).not.toContain("a");
    expect(await dueCount(dueA)).toBe(0); // a 暫停、b 仍 New,皆不計

    // 恢復後又出現
    await setWordSuspended("a", false);
    expect((await buildQueue(dueA)).map((c) => c.cardId)).toContain("a");
  });

  it("暫停的新卡也不入列", async () => {
    await addCards(["a", "b"], 13, NOW);
    await setWordSuspended("a", true);
    const queue = await buildQueue(NOW);
    expect(queue.map((c) => c.cardId)).toEqual(["b"]);
  });

  it("suspendedWordIds", async () => {
    await addCards(["a", "b", "c"], 13, NOW);
    await setWordSuspended("a", true);
    await setWordSuspended("c", true);
    expect(await suspendedWordIds(["a", "b", "c"])).toEqual(["a", "c"]);
    expect(await suspendedWordIds([])).toEqual([]);
  });

  it("suspendedWordIds 以字計:雙向卡同一字只列一次,只暫停 @r 的舊資料也算", async () => {
    await setSetting("reverseCards", true);
    await addCards(["a", "b", "c"], 13, NOW);
    await setWordSuspended("a", true); // a 與 a@r 皆暫停
    await db.cards.update("b@r", { suspended: true }); // T10.3 前的單向暫停
    expect(await suspendedWordIds(["a", "b", "c"])).toEqual(["a", "b"]);
  });

  it("setWordSuspended:同時作用於正向與 @r(傳入 @r id 亦同),恢復亦雙向", async () => {
    await setSetting("reverseCards", true);
    await addCards(["X", "Y"], 13, NOW);
    const suspendedOf = async (id: string) => (await db.cards.get(id))?.suspended;

    await setWordSuspended("X@r", true); // 在複習中略過回想卡
    expect(await suspendedOf("X")).toBe(true);
    expect(await suspendedOf("X@r")).toBe(true);
    expect(await suspendedOf("Y")).toBeUndefined(); // 其他字不受影響
    expect(await suspendedOf("Y@r")).toBeUndefined();

    await setWordSuspended("X", false);
    expect(await suspendedOf("X")).toBe(false);
    expect(await suspendedOf("X@r")).toBe(false);
  });

  it("setWordSuspended:reverseCards 關閉(只有正向卡)時照常作用", async () => {
    await addCards(["X"], 13, NOW);
    await setWordSuspended("X", true);
    expect((await db.cards.get("X"))?.suspended).toBe(true);
    expect(await db.cards.count()).toBe(1); // 不會建立 @r
  });

  it("suspendedWordIds:任一方向暫停即算已會(舊資料只暫停 @r 時課程頁仍可恢復)", async () => {
    await setSetting("reverseCards", true);
    await addCards(["X", "Y"], 13, NOW);
    await db.cards.update("X@r", { suspended: true }); // T10.3 前的單向暫停
    expect(await suspendedWordIds(["X", "Y"])).toEqual(["X"]);

    await setWordSuspended("X", false); // 課程頁「已會·恢復」
    expect(await suspendedWordIds(["X", "Y"])).toEqual([]);
    expect((await db.cards.get("X@r"))?.suspended).toBe(false);
  });

  it("@r 建立時繼承正向卡的暫停狀態(addCards / ensureReverseCards),不入列", async () => {
    await addCards(["A", "B"], 13, NOW); // reverseCards 關:只有正向卡
    await rate("A", 3, NOW);
    await rate("B", 3, NOW);
    await setWordSuspended("A", true);

    // 中途開啟回想卡:ensureReverseCards 補建
    expect(await ensureReverseCards(NOW)).toBe(2);
    expect((await db.cards.get("A@r"))?.suspended).toBe(true);
    expect((await db.cards.get("B@r"))?.suspended).toBeUndefined();

    // addCards 對既有已暫停的正向卡補建 @r
    await setSetting("reverseCards", true);
    await addCards(["C"], 13, NOW);
    await setWordSuspended("C", true);
    await db.cards.delete("C@r");
    await addCards(["C"], 13, NOW);
    expect((await db.cards.get("C@r"))?.suspended).toBe(true);

    const later = addStudyDays(NOW, 1);
    expect(queueIds(await buildQueue(later))).toEqual(["B@r"]);
  });

  it("暫停的頑固卡不列入 leech", async () => {
    await db.cards.bulkAdd([
      { cardId: "x", lessonId: 1, type: "vocab", due: NOW, stability: 1, difficulty: 5, reps: 5, lapses: LEECH_THRESHOLD + 1, state: 2 },
    ]);
    expect(await countLeeches()).toBe(1);
    await setWordSuspended("x", true);
    expect(await countLeeches()).toBe(0);
    expect(await getLeeches()).toEqual([]);
  });
})

describe("復原評分(T10.3)", () => {
  it("rate 回傳 { card, prev, logId }:prev 為評分前的卡、logId 為寫入的 log", async () => {
    await addCards(["a"], 13, NOW);
    const before = await db.cards.get("a");
    const { card, prev, logId } = await rate("a", 3, NOW);
    expect(prev).toEqual(before);
    expect(card).toEqual(await db.cards.get("a"));
    expect((await db.logs.get(logId))?.cardId).toBe("a");
  });

  it("undoRate:卡片還原為評分前(deep-equal)、log 刪除", async () => {
    await addCards(["a"], 13, NOW);
    await rate("a", 3, NOW); // 先有一筆歷史,確認只刪本次
    const at = addStudyDays(NOW, 3);
    const before = await db.cards.get("a");
    const result = await rate("a", 1, at);
    expect(await db.logs.count()).toBe(2);

    await undoRate(result);
    expect(await db.cards.get("a")).toEqual(before);
    const logs = await db.logs.toArray();
    expect(logs).toHaveLength(1);
    expect(logs[0].reviewedAt).toBe(NOW);
  });

  it("undoRate 後今日新卡額度回復(上限由 logs 計算)", async () => {
    await setSetting("newPerDay", 1);
    await addCards(["a", "b"], 13, NOW);
    const result = await rate("a", 3, NOW);
    expect(await buildQueue(NOW + 60_000)).toEqual([]);

    await undoRate(result);
    expect(queueIds(await buildQueue(NOW + 60_000))).toEqual(["a"]);
    expect(await queueCounts(NOW + 60_000)).toMatchObject({ fresh: 1, newToday: 0 });
  });

  it("同日再以 rate() 重評會多扣一次(lapses +1)——session 內重看因此只曝光、不呼叫 rate()", async () => {
    await addCards(["a"], 13, NOW);
    await rate("a", 3, NOW);
    const at = addStudyDays(NOW, 3);
    const { card: first } = await rate("a", 1, at);
    const { card: second } = await rate("a", 1, at + 60_000);
    expect(second.lapses).toBe(first.lapses + 1);
    expect(second.stability).toBeLessThan(first.stability);
  });
});

describe("desiredRetention(T9.4)", () => {
  it("較高目標保留率 → 相同卡的 Good 間隔較短(複習更頻繁)", async () => {
    setFuzzForTesting(false); // 比較兩種保留率的確定間隔,不讓 fuzz 干擾
    await addCards(["a"], 13, NOW);
    await rate("a", 3, NOW); // 進入 Review 態,間隔對保留率較敏感
    const cardId = "a";

    await setSetting("desiredRetention", 0.97);
    const high = await previewIntervals(cardId, NOW);
    await setSetting("desiredRetention", 0.8);
    const low = await previewIntervals(cardId, NOW);

    expect(high.good.days).toBeLessThan(low.good.days);
  });
});

describe("學習日與 ts-fsrs 日界(T10.1,Asia/Taipei)", () => {
  useTimeZone("Asia/Taipei");

  /** 2026-09-dd hh:mm(台灣時間)。須在測試內呼叫。 */
  const at = (d: number, h: number, mi = 0) => new Date(2026, 8, d, h, mi).getTime();
  const ids = (cards: CardRow[]) => cards.map((c) => c.cardId).sort();
  /** 某卡最近一筆 log */
  async function lastLog(cardId: string) {
    const logs = await db.logs.where("cardId").equals(cardId).sortBy("reviewedAt");
    return logs[logs.length - 1];
  }

  it("22:00 評 Good(3 天)之卡,第 3 天 07:30 即入列;預估 = 實際", async () => {
    await setSetting("newPerDay", 0);
    await addCards(["a"], 13, at(1, 22));
    const preview = await previewIntervals("a", at(1, 22));
    expect(preview.good.days).toBe(3);

    const { card } = await rate("a", 3, at(1, 22));
    expect(card.due).toBe(at(4, 22)); // 真實時刻:同一牆上時間 3 天後
    expect(card.due).toBe(preview.good.due);
    expect(card.lastReview).toBe(at(1, 22));

    expect(await buildQueue(at(4, 3, 59))).toEqual([]); // 9/4 03:59 仍屬 9/3 學習日
    expect(ids(await buildQueue(at(4, 7, 30)))).toEqual(["a"]);
    expect(await dueCount(at(4, 7, 30))).toBe(1);
  });

  it("跨 08:00(UTC 換日)的兩次複習:elapsedDays 與 stability 相同", async () => {
    await addCards(["a", "b", "c"], 13, at(1, 7, 50));
    // a:07:50 → 3 天後 08:10(未平移時 ts-fsrs 會算成 4 天)
    await rate("a", 3, at(1, 7, 50));
    await rate("a", 3, at(4, 8, 10));
    // b:08:10 → 3 天後 08:30
    await rate("b", 3, at(1, 8, 10));
    await rate("b", 3, at(4, 8, 30));
    // c:對照組,兩次都在 08:00 前
    await rate("c", 3, at(1, 7, 50));
    await rate("c", 3, at(4, 7, 55));

    for (const id of ["a", "b", "c"]) {
      expect((await lastLog(id)).elapsedDays).toBe(3);
    }
    const [a, b, c] = await Promise.all(["a", "b", "c"].map((id) => db.cards.get(id)));
    expect(a?.stability).toBe(c?.stability);
    expect(b?.stability).toBe(c?.stability);
  });

  it("凌晨 03:00 的複習算前一個學習日", async () => {
    await setSetting("newPerDay", 0);
    await addCards(["a", "b"], 13, at(1, 22));
    // a:22:00 與隔天 03:00 同屬 9/1 學習日 → elapsedDays 0
    await rate("a", 3, at(1, 22));
    await rate("a", 3, at(2, 3));
    expect((await lastLog("a")).elapsedDays).toBe(0);

    // b:9/2 03:00 評 Good(3 天)→ 學習日 9/1 + 3 = 9/4,當天早上即入列
    const { card: b } = await rate("b", 3, at(2, 3));
    expect(b.due).toBe(at(5, 3));
    expect(studyDayKey(b.due)).toBe("2026-09-04");
    expect(ids(await buildQueue(at(4, 7, 30)))).toContain("b");
    expect(ids(await buildQueue(at(3, 23, 59)))).not.toContain("b");
  });
});

describe("學習日與 ts-fsrs 日界(T10.1,America/New_York DST)", () => {
  useTimeZone("America/New_York");

  /** 2026-mm-dd hh:mm(紐約時間)。須在測試內呼叫。 */
  const at = (mo: number, d: number, h: number, mi = 0) =>
    new Date(2026, mo - 1, d, h, mi).getTime();
  const ids = (cards: CardRow[]) => cards.map((c) => c.cardId).sort();

  it("DST 開始(3/8):due 保持牆上時間、按學習日入列、elapsedDays 以學習日計", async () => {
    await setSetting("newPerDay", 0);
    await addCards(["a", "b"], 13, at(3, 6, 18));
    const { card: a } = await rate("a", 3, at(3, 6, 18)); // EST
    expect(a.due).toBe(at(3, 9, 18)); // EDT:真實間隔少 1 小時,牆上時間不變
    const { card: b } = await rate("b", 3, at(3, 7, 4, 30)); // 3/7 學習日只有 23 小時
    expect(b.due).toBe(at(3, 10, 4, 30)); // 不偏成 03:30(否則會早一個學習日)
    expect(studyDayKey(b.due)).toBe("2026-03-10");

    expect(await buildQueue(at(3, 9, 3, 59))).toEqual([]);
    expect(ids(await buildQueue(at(3, 9, 7, 30)))).toEqual(["a"]);
    expect(ids(await buildQueue(at(3, 10, 4, 0)))).toEqual(["a", "b"]);

    // 3/6 18:00 EST = UTC 3/6 23:00;3/9 20:30 EDT = UTC 3/10 00:30 → 未平移時為 4 天
    await rate("a", 3, at(3, 9, 20, 30));
    const logs = await db.logs.where("cardId").equals("a").sortBy("reviewedAt");
    expect(logs[1].elapsedDays).toBe(3);
  });

  it("DST 結束(11/1):25 小時的學習日內兩次評分 elapsedDays 為 0", async () => {
    await addCards(["a"], 13, at(10, 31, 4, 30));
    await rate("a", 3, at(10, 31, 4, 30)); // EDT
    const now = at(11, 1, 3, 30); // EST,距 10/31 04:00 已 24.5 小時,仍屬 10/31
    const preview = await previewIntervals("a", now);
    const { card: good } = await rate("a", 3, now);
    const logs = await db.logs.where("cardId").equals("a").sortBy("reviewedAt");
    expect(logs[1].elapsedDays).toBe(0);
    // 下次到期:學習日 10/31 + 間隔天數,牆上時間 03:30 保留;預估 = 實際
    expect(good.due).toBe(preview.good.due);
    expect(studyDayKey(good.due)).toBe(
      studyDayKey(addStudyDays(now, preview.good.days)),
    );
    expect(new Date(good.due).getHours()).toBe(3);
  });
});

describe("每日上限以學習日計(T10.2)", () => {
  it("評完 newPerDay 張新卡後,同日重建佇列無新卡;隔日恢復", async () => {
    await setSetting("newPerDay", 2);
    await addCards(["a", "b", "c", "d", "e"], 13, NOW);
    const first = await buildQueue(NOW);
    expect(queueIds(first)).toEqual(["a", "b"]);
    for (const c of first) await rate(c.cardId, 3, NOW);

    expect(await buildQueue(NOW + 5 * 60_000)).toEqual([]); // 同日重開:不再發新額度
    expect(queueIds(await buildQueue(addStudyDays(NOW, 1)))).toEqual(["c", "d"]);
  });

  it("同日只補足剩餘額度;同一張卡的多筆首評 log 只計一次", async () => {
    await setSetting("newPerDay", 3);
    await addCards(["a", "b", "c", "d", "e"], 13, NOW);
    await rate("a", 3, NOW);
    expect(queueIds(await buildQueue(NOW + 60_000))).toEqual(["b", "c"]);

    await db.logs.add({ cardId: "a", rating: 3, state: 0, due: NOW, elapsedDays: 0, reviewedAt: NOW + 1 });
    expect(queueIds(await buildQueue(NOW + 60_000))).toEqual(["b", "c"]);
  });

  it("每日複習上限:扣今日已複習筆數(首評不佔額度),未排入者隔日補出", async () => {
    await addCards(["a", "b", "c"], 13, NOW);
    for (const id of ["a", "b", "c"]) await rate(id, 3, NOW); // 三張同 due
    const day = (await db.cards.get("a"))!.due;
    await setSetting("maxReviewsPerDay", 2);
    await addCards(["n1"], 13, day);

    expect(queueIds(await buildQueue(day))).toEqual(["a", "b", "n1"]);
    await rate("n1", 3, day); // 新卡首評:不佔複習額度
    expect(queueIds(await buildQueue(day + 60_000))).toEqual(["a", "b"]);

    await rate("a", 3, day);
    await rate("b", 3, day);
    expect(await buildQueue(day + 120_000)).toEqual([]); // 今日複習額度用完
    // c 仍到期,只因額度等到明天
    expect((await db.cards.get("c"))!.due).toBeLessThan(nextStudyDayStart(day));
    expect((await queueCounts(day + 120_000)).reviewCapReached).toBe(true);
    expect(queueIds(await buildQueue(addStudyDays(day, 1)))).toEqual(["c"]);
  });
});

describe("雙向卡兄弟 bury(T10.2)", () => {
  it("reverseCards 開啟:同日佇列不同時含 X 與 X@r;回想卡於正向卡首評隔日入列", async () => {
    await setSetting("reverseCards", true);
    await addCards(["X", "Y", "Z"], 13, NOW);
    const today = await buildQueue(NOW);
    expect(queueIds(today)).toEqual(["X", "Y", "Z"]); // 新卡額度全給正向卡
    const bases = today.map((c) => baseVocabId(c.cardId));
    expect(new Set(bases).size).toBe(bases.length);

    for (const c of today) await rate(c.cardId, 3, NOW);
    expect(await buildQueue(NOW + 60_000)).toEqual([]); // 首評在今日 → @r bury
    expect(queueIds(await buildQueue(addStudyDays(NOW, 1)))).toEqual(["X@r", "Y@r", "Z@r"]);
  });

  it("兄弟卡同日到期只出 due 較早者;被 bury 者保持到期、隔日才出", async () => {
    await setSetting("newPerDay", 0);
    await db.cards.bulkAdd([
      reviewCard("X", NOW),
      reviewCard("X@r", NOW - DAY), // 較早到期
      reviewCard("W", NOW),
    ]);
    expect(queueIds(await buildQueue(NOW))).toEqual(["X@r", "W"]);

    await rate("X@r", 3, NOW);
    await rate("W", 3, NOW);
    expect(await buildQueue(NOW + 60_000)).toEqual([]); // X 今日仍 bury
    expect((await db.cards.get("X"))!.due).toBe(NOW); // X 未被改動,仍到期
    expect(queueIds(await buildQueue(addStudyDays(NOW, 1)))).toEqual(["X"]);
  });

  it("正向新卡先填滿額度,剩餘才給 @r(正向卡已非 New 且首評不在今日)", async () => {
    await addCards(["B", "C"], 13, NOW); // reverseCards 關:只有正向新卡
    await db.cards.bulkAdd([
      reviewCard("A", addStudyDays(NOW, 5), { lastReview: addStudyDays(NOW, -1) }),
      { ...(await db.cards.get("B"))!, cardId: "A@r", direction: "rev" }, // New 回想卡
    ]);

    await setSetting("newPerDay", 2);
    expect(queueIds(await buildQueue(NOW))).toEqual(["B", "C"]);
    await setSetting("newPerDay", 3);
    expect(queueIds(await buildQueue(NOW))).toEqual(["B", "C", "A@r"]);
  });
});

describe("queueCounts / hasAnyCards(T10.2)", () => {
  it("與 buildQueue 同一計算;新卡額度用完且仍有新卡等待 → newCapReached", async () => {
    await setSetting("newPerDay", 2);
    await addCards(["a", "b", "c"], 13, NOW);
    expect(await queueCounts(NOW)).toEqual({
      due: 0,
      fresh: 2,
      newCapReached: false,
      newCapped: 1,
      newRemaining: 2,
      newToday: 0,
      newPerDay: 2,
      reviewCapReached: false,
    });

    await rate("a", 3, NOW);
    await rate("b", 3, NOW);
    expect(await queueCounts(NOW + 60_000)).toEqual({
      due: 0,
      fresh: 0,
      newCapReached: true,
      newCapped: 1,
      newRemaining: 0,
      newToday: 2,
      newPerDay: 2,
      reviewCapReached: false,
    });
    expect(await queueCounts(addStudyDays(NOW, 1))).toMatchObject({
      fresh: 1,
      newCapReached: false,
      newToday: 0,
    });
  });

  it("新卡已全部學過(無新卡等待)→ newCapReached 為 false", async () => {
    await setSetting("newPerDay", 2);
    await addCards(["a", "b"], 13, NOW);
    await rate("a", 3, NOW);
    await rate("b", 3, NOW);
    expect(await queueCounts(NOW + 60_000)).toMatchObject({
      fresh: 0,
      newCapReached: false,
    });
  });

  it("reverseCards:額度用完時只剩 bury 的 @r 新卡 → 仍算 newCapReached(明天出),但 newCapped 為 0", async () => {
    await setSetting("reverseCards", true);
    await setSetting("newPerDay", 3);
    await addCards(["X", "Y", "Z"], 13, NOW);
    for (const id of ["X", "Y", "Z"]) await rate(id, 3, NOW);
    expect(await queueCounts(NOW + 60_000)).toMatchObject({
      due: 0,
      fresh: 0,
      newCapReached: true,
      newCapped: 0,
      newRemaining: 0,
    });
  });

  it("額度未用完、只剩 bury 的 @r 新卡 → 不算 newCapReached(今日仍可加入新字)", async () => {
    await setSetting("reverseCards", true);
    await addCards(["X"], 13, NOW); // newPerDay 預設 10
    await rate("X", 3, NOW);
    expect(await queueCounts(NOW + 60_000)).toMatchObject({
      fresh: 0,
      newCapReached: false,
      newRemaining: 9,
    });
  });

  it("newPerDay 為 0 且有新卡 → newCapReached(頁面另給文案)", async () => {
    await setSetting("newPerDay", 0);
    await addCards(["a"], 13, NOW);
    expect(await queueCounts(NOW)).toMatchObject({
      fresh: 0,
      newCapReached: true,
      newCapped: 1,
      newPerDay: 0,
    });
  });

  it("複習額度用完且仍有未 bury 的到期卡 → reviewCapReached", async () => {
    await setSetting("newPerDay", 0);
    await db.cards.bulkAdd([reviewCard("X", NOW), reviewCard("W", NOW)]);
    await setSetting("maxReviewsPerDay", 1);
    expect(await queueCounts(NOW)).toMatchObject({ due: 1, reviewCapReached: true });
    await setSetting("maxReviewsPerDay", 2);
    expect(await queueCounts(NOW)).toMatchObject({ due: 2, reviewCapReached: false });

    // 額度用完,但剩下的到期卡只有 bury 的兄弟卡 → 不算
    await db.cards.clear();
    await db.cards.bulkAdd([reviewCard("X", NOW - DAY), reviewCard("X@r", NOW)]);
    await setSetting("maxReviewsPerDay", 1);
    expect(await queueCounts(NOW)).toMatchObject({ due: 1, reviewCapReached: false });
  });

  it("due 數含上限與 bury,與 buildQueue 長度一致", async () => {
    await setSetting("newPerDay", 0);
    await db.cards.bulkAdd([
      reviewCard("X", NOW),
      reviewCard("X@r", NOW),
      reviewCard("W", NOW),
      reviewCard("V", NOW),
    ]);
    await setSetting("maxReviewsPerDay", 2);
    const counts = await queueCounts(NOW);
    expect(counts.due).toBe((await buildQueue(NOW)).length);
    expect(counts.due).toBe(2);
    await setSetting("maxReviewsPerDay", 10);
    expect((await queueCounts(NOW)).due).toBe(3); // X 與 X@r 只出一張
  });

  it("hasAnyCards:空 DB 為 false;有卡(含暫停)為 true", async () => {
    expect(await hasAnyCards()).toBe(false);
    await addCards(["a"], 13, NOW);
    await setWordSuspended("a", true);
    expect(await hasAnyCards()).toBe(true);
  });
});

/** ts-fsrs get_fuzz_range 的區間(FUZZ_RANGES:2.5–7 天 ×0.15、7–20 天 ×0.1、20 天以上 ×0.05)。 */
function fuzzRange(ivl: number, elapsedDays: number): { min: number; max: number } {
  const delta =
    1 +
    0.15 * Math.max(Math.min(ivl, 7) - 2.5, 0) +
    0.1 * Math.max(Math.min(ivl, 20) - 7, 0) +
    0.05 * Math.max(ivl - 20, 0);
  let min = Math.max(2, Math.round(ivl - delta));
  const max = Math.round(ivl + delta);
  if (ivl > elapsedDays) min = Math.max(min, elapsedDays + 1);
  return { min: Math.min(min, max), max };
}

describe("fuzz(T10.2)", () => {
  const words = ["L13-V001", "L13-V002", "L13-V003", "L13-V004", "L13-V005", "L13-V006"];
  const cardIds = words.flatMap((w) => [w, `${w}@r`]);
  const RATING_KEY = { 1: "again", 2: "hard", 3: "good", 4: "easy" } as const;

  it("正式環境預設開啟 fuzz", () => {
    expect(FUZZ_DEFAULT).toBe(true);
  });

  it("預估即實際:previewIntervals 的 due 等於 rate 套用的 due(思考數秒後評分亦同)", async () => {
    await db.cards.bulkAdd(cardIds.map((id) => reviewCard(id, NOW)));
    for (const [i, id] of cardIds.entries()) {
      const rating = ((i % 4) + 1) as 1 | 2 | 3 | 4;
      const key = RATING_KEY[rating];
      const preview = await previewIntervals(id, NOW);
      const later = await previewIntervals(id, NOW + 4_000);
      expect(later[key].days).toBe(preview[key].days);
      const { card: rated } = await rate(id, rating, NOW);
      expect(rated.due).toBe(preview[key].due);
    }
  });

  it("同歷史的卡(含雙向兄弟卡)不再同日成團,且落在 fuzz 範圍內", async () => {
    await db.cards.bulkAdd(cardIds.map((id) => reviewCard(id, NOW)));
    const goodDays = async () =>
      Promise.all(cardIds.map(async (id) => (await previewIntervals(id, NOW)).good.days));

    setFuzzForTesting(false);
    const plain = await goodDays();
    expect(new Set(plain).size).toBe(1); // 無 fuzz:全部同一天
    const base = plain[0];

    setFuzzForTesting(true);
    const fuzzed = await goodDays();
    expect(new Set(fuzzed).size).toBeGreaterThan(2);
    expect(words.some((_, i) => fuzzed[2 * i] !== fuzzed[2 * i + 1])).toBe(true); // 兄弟卡錯開
    const { min, max } = fuzzRange(base, 10); // reviewCard:上次複習於 10 天前
    for (const d of fuzzed) {
      expect(d).toBeGreaterThanOrEqual(min);
      expect(d).toBeLessThanOrEqual(max);
    }
  });
});

describe("requeueWrong 錯題加入複習(T10.4)", () => {
  // NOW = 台北 17:00;測試內的「同一學習日」「隔日」不受執行環境時區影響
  useTimeZone("Asia/Taipei");
  const NONE = {
    created: 0,
    tomorrow: 0,
    unsuspended: 0,
    alreadyDue: 0,
    requeued: 0,
    pendingNew: 0,
  };

  it("未加入的字照 addCards 建立(新卡入列);空清單不動 DB", async () => {
    expect(await requeueWrong([], 13, NOW)).toEqual(NONE);
    expect(await requeueWrong(["a", "b", "a"], 13, NOW)).toEqual({ ...NONE, created: 2 });
    expect(await db.cards.count()).toBe(2);
    const a = await db.cards.get("a");
    expect(a?.state).toBe(0);
    expect(a?.lessonId).toBe(13);
    expect(a?.direction).toBe("fwd");
    expect(queueIds(await buildQueue(NOW))).toEqual(["a", "b"]);
  });

  it("reverseCards 開啟:同 addCards 建正向+回想卡;已有正向卡而缺 @r 者補建", async () => {
    await addCards(["a"], 13, NOW); // 關閉時加入:只有正向卡
    await setSetting("reverseCards", true);
    expect(await requeueWrong(["a", "b"], 13, NOW)).toEqual({ ...NONE, created: 1, pendingNew: 1 });
    expect((await db.cards.toCollection().primaryKeys()).sort()).toEqual(["a", "a@r", "b", "b@r"]);
    expect((await db.cards.get("b@r"))?.direction).toBe("rev");
  });

  it("reverseCards 開啟:已暫停、只有正向卡的字恢復,補建的 @r 不暫停", async () => {
    await addCards(["a"], 13, NOW);
    await rate("a", 3, NOW);
    await setWordSuspended("a", true);
    await setSetting("reverseCards", true);
    const next = addStudyDays(NOW, 1);

    expect(await requeueWrong(["a"], 13, next)).toEqual({ ...NONE, unsuspended: 1 });
    expect((await db.cards.get("a"))?.suspended).toBe(false);
    const rev = await db.cards.get("a@r");
    expect(rev?.direction).toBe("rev");
    expect(rev?.suspended).not.toBe(true);
    expect(await suspendedWordIds(["a"])).toEqual([]);
  });

  it("評 Good 之卡隔日加入:due 提前至現在並入列,logs、S/D/lastReview 不變;再呼叫一次為 alreadyDue", async () => {
    await addCards(["a"], 13, NOW);
    await rate("a", 3, NOW);
    const next = addStudyDays(NOW, 1) + 3_600_000; // 隔日 05:00(學習日)
    expect(queueIds(await buildQueue(next))).toEqual([]); // 原本 3 天後才到期
    const before = (await db.cards.get("a"))!;
    const logsBefore = await db.logs.toArray();

    expect(await requeueWrong(["a"], 13, next)).toEqual({ ...NONE, requeued: 1 });
    expect(queueIds(await buildQueue(next))).toEqual(["a"]);
    expect(await db.logs.toArray()).toEqual(logsBefore);
    expect(await db.cards.get("a")).toEqual({ ...before, due: next });

    // 冪等:已在今日佇列
    expect(await requeueWrong(["a"], 13, next + 60_000)).toEqual({ ...NONE, alreadyDue: 1 });
    expect((await db.cards.get("a"))?.due).toBe(next);
  });

  it("提前的卡下次評分以實際經過天數計算(等同提前複習)", async () => {
    await addCards(["a"], 13, NOW);
    await rate("a", 3, NOW);
    const next = addStudyDays(NOW, 1);
    await requeueWrong(["a"], 13, next);
    const { card } = await rate("a", 3, next);
    const log = (await db.logs.toArray()).at(-1)!;
    expect(log.elapsedDays).toBe(1);
    expect(log.due).toBe(next); // 評分前的 due = 提前後的時刻
    expect(card.due).toBeGreaterThan(next);
  });

  it("已暫停(已會)的字恢復並入列(正向與 @r 一併恢復)", async () => {
    await setSetting("reverseCards", true);
    await addCards(["a"], 13, NOW);
    await rate("a", 3, NOW);
    await setWordSuspended("a", true);
    const next = addStudyDays(NOW, 1);

    expect(await requeueWrong(["a"], 13, next)).toEqual({ ...NONE, unsuspended: 1 });
    expect((await db.cards.get("a"))?.suspended).toBe(false);
    expect((await db.cards.get("a@r"))?.suspended).toBe(false);
    expect(queueIds(await buildQueue(next))).toContain("a");
    expect(await suspendedWordIds(["a"])).toEqual([]);
  });

  it("今日已評過的字(兄弟卡 bury 今日不再出):due 提前到下一學習日開始,歸入 tomorrow", async () => {
    await addCards(["a"], 13, NOW);
    await rate("a", 3, NOW);
    const later = NOW + 60 * 60_000; // 台北 18:00,同一學習日

    expect(await requeueWrong(["a"], 13, later)).toEqual({ ...NONE, tomorrow: 1 });
    expect((await db.cards.get("a"))?.due).toBe(nextStudyDayStart(NOW));
    expect(queueIds(await buildQueue(later))).toEqual([]);
    expect(queueIds(await buildQueue(addStudyDays(NOW, 1)))).toEqual(["a"]);
    expect(await requeueWrong(["a"], 13, later + 60_000)).toEqual({ ...NONE, tomorrow: 1 });
  });

  it("今日已到期的複習卡歸 alreadyDue、待學新卡歸 pendingNew,皆不變動", async () => {
    await db.cards.bulkAdd([reviewCard("due", NOW - DAY), reviewCard("later", NOW + 5 * DAY)]);
    await addCards(["fresh"], 13, NOW);
    const snapshot = await db.cards.toArray();

    expect(await requeueWrong(["due", "fresh"], 13, NOW)).toEqual({
      ...NONE,
      alreadyDue: 1,
      pendingNew: 1,
    });
    expect(await db.cards.toArray()).toEqual(snapshot);

    expect(await requeueWrong(["later"], 13, NOW)).toEqual({ ...NONE, requeued: 1 });
    expect(queueIds(await buildQueue(NOW))).toEqual(["due", "later", "fresh"]);
  });

  it("新卡額度已用完時,待學新卡歸 pendingNew(今天不在佇列,不宣稱已入列)", async () => {
    await setSetting("newPerDay", 1);
    await addCards(["a", "b"], 13, NOW);
    expect(queueIds(await buildQueue(NOW))).toEqual(["a"]);

    expect(await requeueWrong(["b"], 13, NOW)).toEqual({ ...NONE, pendingNew: 1 });
    expect(queueIds(await buildQueue(NOW))).toEqual(["a"]);
  });

  it("一個方向今日已到期:整個字歸 alreadyDue;另一方向未到期的卡仍提前", async () => {
    await setSetting("reverseCards", true);
    await db.cards.bulkAdd([reviewCard("a", NOW - DAY), reviewCard("a@r", NOW + 20 * DAY)]);

    expect(await requeueWrong(["a"], 13, NOW)).toEqual({ ...NONE, alreadyDue: 1 });
    expect((await db.cards.get("a@r"))?.due).toBe(NOW);
    expect(queueIds(await buildQueue(NOW))).toEqual(["a"]); // @r 受兄弟卡 bury,下一學習日才出
  });

  it("今日評過又標已會的字:恢復並提前到下一學習日,歸入 tomorrow", async () => {
    await addCards(["a"], 13, NOW);
    await rate("a", 3, NOW);
    await setWordSuspended("a", true);
    const later = NOW + 60 * 60_000;

    expect(await requeueWrong(["a"], 13, later)).toEqual({ ...NONE, tomorrow: 1 });
    const a = await db.cards.get("a");
    expect(a?.suspended).toBe(false);
    expect(a?.due).toBe(nextStudyDayStart(NOW));
    expect(queueIds(await buildQueue(addStudyDays(NOW, 1)))).toEqual(["a"]);
  });
});
