import { beforeEach } from "vitest";
import type { LessonIndex } from "@/schemas/lesson";
import { BACKUP_VERSION, exportData, importData, resetAll } from "./backup";
import {
  DEFAULT_SETTINGS,
  db,
  getSetting,
  setSetting,
  type CardRow,
  type LogRow,
  type ProgressRow,
} from "./db";
import { lessonProgress, retentionRate } from "./stats";

const now = new Date("2026-07-04T12:00:00.000Z");

const seedCards: CardRow[] = [
  {
    cardId: "L01-V001",
    lessonId: 1,
    type: "vocab",
    due: now.getTime() + 86_400_000,
    stability: 12.5,
    difficulty: 4.2,
    reps: 6,
    lapses: 1,
    state: 2,
    lastReview: now.getTime() - 86_400_000,
  },
  {
    cardId: "L02-V003",
    lessonId: 2,
    type: "vocab",
    due: now.getTime(),
    stability: 0.5,
    difficulty: 6,
    reps: 1,
    lapses: 0,
    state: 1,
  },
];

const seedLogs: LogRow[] = [
  { id: 1, cardId: "L01-V001", rating: 3, state: 2, due: 0, elapsedDays: 1, reviewedAt: 100 },
  { id: 2, cardId: "L01-V001", rating: 1, state: 2, due: 0, elapsedDays: 3, reviewedAt: 200 },
  { id: 3, cardId: "L02-V003", rating: 4, state: 1, due: 0, elapsedDays: 0, reviewedAt: 300 },
];

const seedProgress: ProgressRow[] = [{ key: "1:vocab", lessonId: 1, completedAt: 500 }];

const index: LessonIndex = {
  lessons: [
    { id: 1, title: "第一課", vocabCount: 10, grammarCount: 3 },
    { id: 2, title: "第二課", vocabCount: 5, grammarCount: 2 },
  ],
};

async function seedAll(): Promise<void> {
  await db.cards.bulkPut(seedCards);
  await db.logs.bulkPut(seedLogs);
  await db.progress.bulkPut(seedProgress);
  await setSetting("newPerDay", 25);
  await setSetting("furigana", "hide");
}

beforeEach(async () => {
  await Promise.all([
    db.cards.clear(),
    db.logs.clear(),
    db.progress.clear(),
    db.settings.clear(),
  ]);
});

describe("exportData", () => {
  it("輸出 version / exportedAt 與四表全量(logs 保留原 id)", async () => {
    await seedAll();

    const backup = await exportData(now);

    expect(backup.version).toBe(BACKUP_VERSION);
    expect(backup.exportedAt).toBe("2026-07-04T12:00:00.000Z");
    expect(backup.cards).toEqual(seedCards);
    expect(backup.logs).toEqual(seedLogs);
    expect(backup.progress).toEqual(seedProgress);
    expect(backup.settings).toEqual(
      expect.arrayContaining([
        { key: "newPerDay", value: 25 },
        { key: "furigana", value: "hide" },
      ]),
    );
  });
});

describe("resetAll", () => {
  it("清空四表並回填預設 settings", async () => {
    await seedAll();

    await resetAll();

    expect(await db.cards.count()).toBe(0);
    expect(await db.logs.count()).toBe(0);
    expect(await db.progress.count()).toBe(0);
    expect(await db.settings.count()).toBe(Object.keys(DEFAULT_SETTINGS).length);
    expect(await getSetting("newPerDay")).toBe(DEFAULT_SETTINGS.newPerDay);
  });
});

describe("importData", () => {
  it("version 不符:丟明確錯誤,且現有資料不動", async () => {
    await seedAll();
    const backup = JSON.parse(JSON.stringify(await exportData(now)));
    backup.version = 2;

    await expect(importData(backup)).rejects.toThrow(/版本不符/);
    expect(await db.cards.count()).toBe(seedCards.length);
  });

  it("top-level 結構錯誤(缺表):丟格式錯誤", async () => {
    const invalid = { version: BACKUP_VERSION, exportedAt: "x", cards: [], logs: [] };

    await expect(importData(invalid)).rejects.toThrow(/格式/);
  });

  it("匯入 = 全清後寫入:既有資料不殘留", async () => {
    await seedAll();
    const backup = JSON.parse(
      JSON.stringify({
        version: BACKUP_VERSION,
        exportedAt: now.toISOString(),
        cards: [seedCards[1]],
        logs: [],
        progress: [],
        settings: [{ key: "newPerDay", value: 5 }],
      }),
    );

    await importData(backup);

    expect(await db.cards.toArray()).toEqual([seedCards[1]]);
    expect(await db.logs.count()).toBe(0);
    expect(await getSetting("newPerDay")).toBe(5);
  });

  it("驗收:匯出 → 重置 → 匯入,卡片狀態與統計完全還原", async () => {
    await seedAll();
    const statsBefore = {
      retention: retentionRate(await db.logs.toArray()),
      progress: lessonProgress(await db.cards.toArray(), index),
    };

    // 匯出並模擬「存檔再開檔」
    const fileContent = JSON.stringify(await exportData(now));

    await resetAll();
    expect(await db.cards.count()).toBe(0);
    expect(await getSetting("newPerDay")).toBe(DEFAULT_SETTINGS.newPerDay);

    await importData(JSON.parse(fileContent));

    expect(await db.cards.toArray()).toEqual(seedCards);
    expect(await db.logs.toArray()).toEqual(seedLogs);
    expect(await db.progress.toArray()).toEqual(seedProgress);
    expect(await getSetting("newPerDay")).toBe(25);
    expect(await getSetting("furigana")).toBe("hide");

    const statsAfter = {
      retention: retentionRate(await db.logs.toArray()),
      progress: lessonProgress(await db.cards.toArray(), index),
    };
    expect(statsAfter).toEqual(statsBefore);
  });
});
