import { beforeEach } from "vitest";
import {
  DEFAULT_SETTINGS,
  db,
  ensureDefaultSettings,
  getAllSettings,
  getSetting,
  setSetting,
  type CardRow,
} from "./db";

beforeEach(async () => {
  await Promise.all([
    db.cards.clear(),
    db.logs.clear(),
    db.progress.clear(),
    db.settings.clear(),
  ]);
});

function makeCard(overrides: Partial<CardRow> = {}): CardRow {
  return {
    cardId: "L13-V001",
    lessonId: 13,
    type: "vocab",
    due: 1000,
    stability: 0,
    difficulty: 0,
    reps: 0,
    lapses: 0,
    state: 0,
    ...overrides,
  };
}

describe("MinnaDB schema", () => {
  it("可開庫且四個 store 存在", async () => {
    await db.open();
    expect(db.isOpen()).toBe(true);
    expect(db.tables.map((t) => t.name).sort()).toEqual([
      "cards",
      "logs",
      "progress",
      "settings",
    ]);
  });

  it("cards:以 cardId 主鍵讀寫", async () => {
    await db.cards.put(makeCard());
    const row = await db.cards.get("L13-V001");
    expect(row?.lessonId).toBe(13);
  });

  it("cards:可用 lessonId 索引查詢", async () => {
    await db.cards.bulkPut([
      makeCard({ cardId: "L13-V001", lessonId: 13 }),
      makeCard({ cardId: "L13-V002", lessonId: 13 }),
      makeCard({ cardId: "L14-V001", lessonId: 14 }),
    ]);
    const l13 = await db.cards.where("lessonId").equals(13).toArray();
    expect(l13).toHaveLength(2);
  });

  it("cards:可用 due 索引排序查詢到期卡", async () => {
    await db.cards.bulkPut([
      makeCard({ cardId: "a", due: 300 }),
      makeCard({ cardId: "b", due: 100 }),
      makeCard({ cardId: "c", due: 200 }),
    ]);
    const dueBefore250 = await db.cards
      .where("due")
      .belowOrEqual(250)
      .toArray();
    expect(dueBefore250.map((c) => c.cardId).sort()).toEqual(["b", "c"]);
  });

  it("logs:id 自動遞增", async () => {
    const id1 = await db.logs.add({
      cardId: "L13-V001",
      rating: 3,
      state: 0,
      due: 0,
      elapsedDays: 0,
      reviewedAt: 1000,
    });
    const id2 = await db.logs.add({
      cardId: "L13-V001",
      rating: 4,
      state: 1,
      due: 0,
      elapsedDays: 1,
      reviewedAt: 2000,
    });
    expect(id2).toBe((id1 as number) + 1);
    expect(await db.logs.count()).toBe(2);
  });
});

describe("settings", () => {
  it("ensureDefaultSettings:寫入 4 個預設值", async () => {
    await ensureDefaultSettings();
    expect(await db.settings.count()).toBe(4);
    expect(await getAllSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it("ensureDefaultSettings:冪等,不覆蓋既有值", async () => {
    await setSetting("newPerDay", 25);
    await ensureDefaultSettings();
    await ensureDefaultSettings();
    expect(await db.settings.count()).toBe(4);
    expect(await getSetting("newPerDay")).toBe(25); // 既有值保留
  });

  it("getSetting:未設定時回退預設", async () => {
    expect(await getSetting("furigana")).toBe("show");
    expect(await getSetting("maxReviewsPerDay")).toBe(200);
  });

  it("setSetting / getSetting:寫入後讀回", async () => {
    await setSetting("furigana", "hide");
    await setSetting("ttsEnabled", false);
    expect(await getSetting("furigana")).toBe("hide");
    expect(await getSetting("ttsEnabled")).toBe(false);
  });

  it("getAllSettings:以預設補齊部分設定", async () => {
    await setSetting("newPerDay", 5);
    expect(await getAllSettings()).toEqual({
      ...DEFAULT_SETTINGS,
      newPerDay: 5,
    });
  });
});
