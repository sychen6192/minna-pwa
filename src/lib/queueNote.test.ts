import { describe, expect, it } from "vitest";
import type { QueueCounts } from "./srs";
import { capNote } from "./queueNote";

const EMPTY: QueueCounts = {
  due: 0,
  fresh: 0,
  newCapReached: false,
  newCapped: 0,
  newRemaining: 10,
  newToday: 0,
  newPerDay: 10,
  reviewCapReached: false,
};

describe("capNote", () => {
  it("沒有因上限等待的卡:null", () => {
    expect(capNote(EMPTY)).toBeNull();
  });

  it("新卡額度用完:明天繼續;上限為 0 另給說明", () => {
    const capped = { ...EMPTY, newCapReached: true, newRemaining: 0, newToday: 10, newCapped: 3 };
    expect(capNote(capped)).toBe("今日新卡已達上限,明天繼續");
    expect(capNote({ ...capped, newPerDay: 0, newToday: 0 })).toBe(
      "每日新卡上限設為 0,暫不引入新卡",
    );
  });

  it("複習額度用完優先於新卡額度", () => {
    expect(capNote({ ...EMPTY, reviewCapReached: true, newCapReached: true })).toBe(
      "今日複習已達上限,明天繼續",
    );
  });
});
