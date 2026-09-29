import { lessonTabHash, parseLessonHash } from "./lessonHash";

describe("parseLessonHash", () => {
  it("文法點錨點 → 文型分頁並捲動(不高亮)", () => {
    expect(parseLessonHash("#L14-G03")).toEqual({
      tab: "grammar",
      anchor: "L14-G03",
      highlight: false,
    });
  });

  it("單字錨點 → 留在単語分頁、捲動並高亮", () => {
    expect(parseLessonHash("#L14-V003")).toEqual({
      tab: "vocab",
      anchor: "L14-V003",
      highlight: true,
    });
  });

  it("分頁名 → 該分頁(無錨點)", () => {
    expect(parseLessonHash("#grammar")).toEqual({ tab: "grammar", anchor: null, highlight: false });
    expect(parseLessonHash("#dialogue")).toEqual({
      tab: "dialogue",
      anchor: null,
      highlight: false,
    });
    expect(parseLessonHash("vocab")).toEqual({ tab: "vocab", anchor: null, highlight: false });
  });

  it("百分比編碼先解碼;不合法的編碼與未知值 → null", () => {
    expect(parseLessonHash("#L14%2DG03")?.anchor).toBe("L14-G03");
    expect(parseLessonHash("#%E0%A4%A")).toBeNull();
    expect(parseLessonHash("#top")).toBeNull();
    expect(parseLessonHash("#Grammar")).toBeNull();
    expect(parseLessonHash("")).toBeNull();
    expect(parseLessonHash("#")).toBeNull();
  });

  it("lessonTabHash 與 parseLessonHash 互為往返", () => {
    for (const tab of ["vocab", "grammar", "dialogue"] as const) {
      expect(parseLessonHash(lessonTabHash(tab))?.tab).toBe(tab);
    }
  });
});
