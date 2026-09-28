import { beforeEach } from "vitest";
import { useTimeZone } from "@/test/timeZone";
import { db, getSetting, setSetting } from "./db";
import {
  addCards,
  baseVocabId,
  cardDirection,
  ensureReverseCards,
  buildQueue,
  countDue,
  countDueByTomorrow,
  countLeeches,
  countSuspended,
  setSuspended,
  suspendedCardIds,
  existingCardIds,
  getLeeches,
  isLeech,
  LEECH_THRESHOLD,
  previewIntervals,
  rate,
} from "./srs";
import { addStudyDays, studyDayKey, studyDayStart } from "./studyDay";
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
    expect(await buildQueue(due - DAY)).toHaveLength(0); // 到期前一天
    // 到期學習日的前一刻仍不入列
    expect(await buildQueue(studyDayStart(due) - 1)).toHaveLength(0);
  });

  it("按日到期:到期學習日一開始即入列(不必等到 due 的時刻)", async () => {
    await addCards(["a"], 13, NOW);
    const due = (await rate("a", 3, NOW)).due;
    await setSetting("newPerDay", 0);
    const queue = await buildQueue(studyDayStart(due));
    expect(queue.map((c) => c.cardId)).toEqual(["a"]);
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
      due: NOW, // 評分前的 due(新卡建立時刻)
    });
  });

  it("log 時間欄位為真實時刻:due = 評分前的 due,reviewedAt = 評分時刻", async () => {
    await addCards(["a"], 13, NOW);
    const first = await rate("a", 3, NOW);
    const at = first.due + 2 * 3600_000; // 到期後 2 小時複習
    await rate("a", 3, at);
    const second = (await db.logs.toArray()).find((l) => l.state === 2);
    expect(second).toMatchObject({ due: first.due, reviewedAt: at });
    expect((await db.cards.get("a"))?.lastReview).toBe(at);
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
  it("計算今日(學習日)到期的複習卡,當日稍晚才到期者也算(排除 New)", async () => {
    await addCards(["a", "b", "new"], 13, NOW);
    const dueA = (await rate("a", 3, NOW)).due;
    await rate("b", 3, NOW); // 與 a 同 due
    expect(await countDue(dueA - DAY)).toBe(0); // 尚未到期
    expect(await countDue(studyDayStart(dueA) - 1)).toBe(0); // 前一學習日最後一刻
    expect(await countDue(studyDayStart(dueA))).toBe(2); // 到期日一開始即計
    expect(await countDue(dueA)).toBe(2); // a、b 到期;new 仍為 New 不計
  });

  it("countDueByTomorrow:到明日學習日結束前到期者(明日到期預估)", async () => {
    await addCards(["a"], 13, NOW);
    const dueA = (await rate("a", 3, NOW)).due;
    expect(await countDueByTomorrow(addStudyDays(dueA, -2))).toBe(0); // 後天才到期
    expect(await countDue(addStudyDays(dueA, -1))).toBe(0);
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

describe("suspend 已會/暫停(T9.3)", () => {
  it("setSuspended:暫停的卡不進複習佇列、不計到期", async () => {
    await addCards(["a", "b"], 13, NOW);
    await rate("a", 3, NOW); // a 進入複習態
    const dueA = (await db.cards.get("a"))!.due;

    await setSuspended("a", true);
    const queue = await buildQueue(dueA);
    expect(queue.map((c) => c.cardId)).not.toContain("a");
    expect(await countDue(dueA)).toBe(0); // a 暫停、b 仍 New,皆不計

    // 恢復後又出現
    await setSuspended("a", false);
    expect((await buildQueue(dueA)).map((c) => c.cardId)).toContain("a");
  });

  it("暫停的新卡也不入列", async () => {
    await addCards(["a", "b"], 13, NOW);
    await setSuspended("a", true);
    const queue = await buildQueue(NOW);
    expect(queue.map((c) => c.cardId)).toEqual(["b"]);
  });

  it("countSuspended / suspendedCardIds", async () => {
    await addCards(["a", "b", "c"], 13, NOW);
    await setSuspended("a", true);
    await setSuspended("c", true);
    expect(await countSuspended()).toBe(2);
    expect((await suspendedCardIds(["a", "b", "c"])).sort()).toEqual(["a", "c"]);
    expect(await suspendedCardIds([])).toEqual([]);
  });

  it("暫停的頑固卡不列入 leech", async () => {
    await db.cards.bulkAdd([
      { cardId: "x", lessonId: 1, type: "vocab", due: NOW, stability: 1, difficulty: 5, reps: 5, lapses: LEECH_THRESHOLD + 1, state: 2 },
    ]);
    expect(await countLeeches()).toBe(1);
    await setSuspended("x", true);
    expect(await countLeeches()).toBe(0);
    expect(await getLeeches()).toEqual([]);
  });
})

describe("desiredRetention(T9.4)", () => {
  it("較高目標保留率 → 相同卡的 Good 間隔較短(複習更頻繁)", async () => {
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

    const card = await rate("a", 3, at(1, 22));
    expect(card.due).toBe(at(4, 22)); // 真實時刻:同一牆上時間 3 天後
    expect(card.due).toBe(preview.good.due);
    expect(card.lastReview).toBe(at(1, 22));

    expect(await buildQueue(at(4, 3, 59))).toEqual([]); // 9/4 03:59 仍屬 9/3 學習日
    expect(ids(await buildQueue(at(4, 7, 30)))).toEqual(["a"]);
    expect(await countDue(at(4, 7, 30))).toBe(1);
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
    const b = await rate("b", 3, at(2, 3));
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
    const a = await rate("a", 3, at(3, 6, 18)); // EST
    expect(a.due).toBe(at(3, 9, 18)); // EDT:真實間隔少 1 小時,牆上時間不變
    const b = await rate("b", 3, at(3, 7, 4, 30)); // 3/7 學習日只有 23 小時
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
    const good = await rate("a", 3, now);
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
