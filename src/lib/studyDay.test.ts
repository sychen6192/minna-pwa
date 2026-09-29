import { useTimeZone } from "@/test/timeZone";
import {
  addStudyDays,
  fromFsrsTime,
  nextStudyDayStart,
  ROLLOVER_HOUR,
  studyDayKey,
  studyDayStart,
  toFsrsTime,
} from "./studyDay";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** 本地時間(月份 1-based,以目前 process.env.TZ 解讀)。須在測試內呼叫。 */
function local(y: number, mo: number, d: number, h = 0, mi = 0): number {
  return new Date(y, mo - 1, d, h, mi).getTime();
}

/** ts-fsrs 視角的 UTC 日期 YYYY-MM-DD */
function utcDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

describe("學習日(Asia/Taipei,無 DST)", () => {
  useTimeZone("Asia/Taipei");

  it("換日時刻為凌晨 4 點", () => {
    expect(ROLLOVER_HOUR).toBe(4);
  });

  it("studyDayKey:03:59 屬前一日,04:00 起屬當日", () => {
    expect(studyDayKey(local(2026, 9, 2, 0, 0))).toBe("2026-09-01");
    expect(studyDayKey(local(2026, 9, 2, 3, 59))).toBe("2026-09-01");
    expect(studyDayKey(local(2026, 9, 2, 4, 0))).toBe("2026-09-02");
    expect(studyDayKey(local(2026, 9, 2, 23, 59))).toBe("2026-09-02");
  });

  it("studyDayStart / nextStudyDayStart:以 04:00 為界", () => {
    expect(studyDayStart(local(2026, 9, 2, 3, 59))).toBe(local(2026, 9, 1, 4));
    expect(studyDayStart(local(2026, 9, 2, 4, 0))).toBe(local(2026, 9, 2, 4));
    expect(nextStudyDayStart(local(2026, 9, 2, 3, 59))).toBe(
      local(2026, 9, 2, 4),
    );
    expect(nextStudyDayStart(local(2026, 9, 2, 4, 0))).toBe(
      local(2026, 9, 3, 4),
    );
  });

  it("跨月、跨年:元旦凌晨仍屬前一年最後一天", () => {
    expect(studyDayKey(local(2027, 1, 1, 2, 0))).toBe("2026-12-31");
    expect(studyDayStart(local(2027, 1, 1, 2, 0))).toBe(local(2026, 12, 31, 4));
    expect(studyDayKey(local(2026, 10, 1, 3, 0))).toBe("2026-09-30");
  });

  it("addStudyDays:回傳位移後學習日的起點(n 可為負)", () => {
    const t = local(2026, 9, 2, 3, 0); // 學習日 9/1
    expect(addStudyDays(t, 0)).toBe(local(2026, 9, 1, 4));
    expect(addStudyDays(t, 2)).toBe(local(2026, 9, 3, 4));
    expect(addStudyDays(t, -1)).toBe(local(2026, 8, 31, 4));
  });

  it("toFsrsTime:UTC 日期 = 本地學習日(跨 08:00 的兩刻同屬一日)", () => {
    // 未平移時 07:50 與 08:10 分屬 UTC 9/1 與 9/2(台灣 08:00 = UTC 00:00)
    expect(utcDate(local(2026, 9, 2, 7, 50))).toBe("2026-09-01");
    expect(utcDate(toFsrsTime(local(2026, 9, 2, 7, 50)))).toBe("2026-09-02");
    expect(utcDate(toFsrsTime(local(2026, 9, 2, 8, 10)))).toBe("2026-09-02");
    // 22:00 與凌晨 03:00 同屬 9/1 學習日
    expect(utcDate(toFsrsTime(local(2026, 9, 1, 22, 0)))).toBe("2026-09-01");
    expect(utcDate(toFsrsTime(local(2026, 9, 2, 3, 0)))).toBe("2026-09-01");
    // 時刻 = 距學習日起點的經過時間
    expect(toFsrsTime(local(2026, 9, 1, 22, 0))).toBe(
      Date.UTC(2026, 8, 1) + 18 * HOUR,
    );
  });

  it("fromFsrsTime:以 now 為基準換回,保持同一牆上時間", () => {
    const now = local(2026, 9, 1, 22, 0);
    expect(fromFsrsTime(toFsrsTime(now), now)).toBe(now);
    expect(fromFsrsTime(toFsrsTime(now) + 3 * DAY, now)).toBe(
      local(2026, 9, 4, 22, 0),
    );
    // 凌晨評分:牆上時間 03:00 保留,學習日同步 +3
    const early = local(2026, 9, 2, 3, 0);
    const due = fromFsrsTime(toFsrsTime(early) + 3 * DAY, early);
    expect(due).toBe(local(2026, 9, 5, 3, 0));
    expect(studyDayKey(due)).toBe("2026-09-04");
  });
});

describe("學習日(America/New_York,DST 前後)", () => {
  useTimeZone("America/New_York");

  it("DST 開始(2026-03-08 02:00 → 03:00):3/7 學習日只有 23 小時,邊界仍在 04:00", () => {
    const t = local(2026, 3, 7, 12);
    expect(nextStudyDayStart(t) - studyDayStart(t)).toBe(23 * HOUR);
    expect(new Date(nextStudyDayStart(t)).getHours()).toBe(4);
    expect(studyDayKey(local(2026, 3, 8, 3, 30))).toBe("2026-03-07"); // 03:30 EDT
    expect(studyDayKey(local(2026, 3, 8, 4, 0))).toBe("2026-03-08");
    expect(new Date(studyDayStart(local(2026, 3, 9, 12))).getHours()).toBe(4);
  });

  it("DST 結束(2026-11-01 02:00 → 01:00):10/31 學習日有 25 小時", () => {
    const t = local(2026, 10, 31, 12);
    expect(nextStudyDayStart(t) - studyDayStart(t)).toBe(25 * HOUR);
    expect(new Date(nextStudyDayStart(t)).getHours()).toBe(4);
    expect(studyDayKey(local(2026, 11, 1, 3, 30))).toBe("2026-10-31");
  });

  it("addStudyDays 跨 DST:以日期欄位運算,起點恆為 04:00", () => {
    const start = addStudyDays(local(2026, 3, 6, 12), 3);
    expect(start).toBe(local(2026, 3, 9, 4));
    expect(new Date(start).getHours()).toBe(4);
    expect(addStudyDays(start, -3)).toBe(local(2026, 3, 6, 4));
  });

  it("toFsrsTime:25 小時的學習日仍留在同一 UTC 日", () => {
    // 11/1 03:30 EST 距 10/31 04:00 EDT 已 24.5 小時,須截在同一 UTC 日
    expect(utcDate(toFsrsTime(local(2026, 11, 1, 3, 30)))).toBe("2026-10-31");
    expect(utcDate(toFsrsTime(local(2026, 11, 1, 4, 0)))).toBe("2026-11-01");
  });

  it("fromFsrsTime 跨 DST:不偏一小時、不跑到別的學習日", () => {
    const now = local(2026, 3, 7, 4, 30); // EST
    const due = fromFsrsTime(toFsrsTime(now) + 3 * DAY, now);
    expect(due).toBe(local(2026, 3, 10, 4, 30)); // EDT,同一牆上時間
    expect(new Date(due).getHours()).toBe(4);
    expect(studyDayKey(due)).toBe("2026-03-10");
  });
});

describe("學習日(Europe/Helsinki,DST 缺口 03:00 → 04:00)", () => {
  useTimeZone("Europe/Helsinki");

  it("fromFsrsTime:目標日的牆上時間不存在時截在目標學習日內", () => {
    // 3/29 03:00 EET 跳至 04:00 EEST,03:30 不存在;Date 會挪到 04:30(下一學習日)
    const now = local(2026, 3, 28, 3, 30); // 學習日 3/27
    const due = fromFsrsTime(toFsrsTime(now) + DAY, now);
    expect(studyDayKey(due)).toBe("2026-03-28");
    expect(due).toBe(addStudyDays(now, 2) - 1);
  });
});

describe("性質:toFsrsTime 的 UTC 日 = 學習日且不倒退;fromFsrsTime 落在學習日 + n", () => {
  // [時區, DST 開始日前後, DST 結束日前後](月份 1-based)
  const cases: [string, [number, number], [number, number]][] = [
    ["Asia/Taipei", [3, 6], [10, 30]],
    ["America/New_York", [3, 6], [10, 30]],
    ["Europe/Helsinki", [3, 27], [10, 23]],
  ];
  for (const [tz, [m1, d1], [m2, d2]] of cases) {
    describe(tz, () => {
      useTimeZone(tz);

      it("DST 切換前後每 17 分鐘取樣", () => {
        const ranges: [number, number][] = [
          [local(2026, m1, d1), local(2026, m1, d1 + 5)],
          [local(2026, m2, d2), local(2026, m2, d2 + 5)],
        ];
        for (const [from, to] of ranges) {
          let prev = -Infinity;
          for (let t = from; t < to; t += 17 * 60_000) {
            const f = toFsrsTime(t);
            expect(utcDate(f)).toBe(studyDayKey(t));
            expect(f).toBeGreaterThanOrEqual(prev);
            prev = f;
            for (const n of [1, 3]) {
              const due = fromFsrsTime(f + n * DAY, t);
              expect(studyDayKey(due)).toBe(studyDayKey(addStudyDays(t, n)));
            }
          }
        }
      });
    });
  }
});
