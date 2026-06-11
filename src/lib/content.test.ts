import { afterEach, beforeEach, vi } from "vitest";
import { clearContentCache, getLesson, getLessonIndex } from "./content";

const validLesson = {
  id: 13,
  title: "テスト課",
  vocab: [
    {
      id: "L13-V001",
      ruby: [{ b: "犬", r: "いぬ" }],
      kana: "いぬ",
      meaning: "狗",
      pos: "名",
    },
  ],
  grammar: [],
  dialogues: [],
};

const validIndex = {
  lessons: Array.from({ length: 50 }, (_, i) => ({
    id: i + 1,
    title: `第 ${i + 1} 課`,
    vocabCount: 0,
    grammarCount: 0,
  })),
};

/** 建立類 Response 物件 */
function jsonResponse(data: unknown, init?: { ok?: boolean; status?: number }) {
  return {
    ok: init?.ok ?? true,
    status: init?.status ?? 200,
    json: async () => data,
  } as Response;
}

function mockFetch(handler: (url: string) => Response) {
  const fn = vi.fn((url: string) => Promise.resolve(handler(url)));
  vi.stubGlobal("fetch", fn);
  return fn;
}

beforeEach(() => {
  clearContentCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("getLessonIndex", () => {
  it("成功:回傳解析後的索引", async () => {
    mockFetch(() => jsonResponse(validIndex));
    const index = await getLessonIndex();
    expect(index.lessons).toHaveLength(50);
    expect(index.lessons[12].id).toBe(13);
  });

  it("快取:多次呼叫只 fetch 一次", async () => {
    const fn = mockFetch(() => jsonResponse(validIndex));
    await getLessonIndex();
    await getLessonIndex();
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith("/data/index.json");
  });

  it("schema 不符:丟出含欄位路徑的錯誤", async () => {
    mockFetch(() => jsonResponse({ lessons: [] })); // 長度不足 50
    await expect(getLessonIndex()).rejects.toThrow(/課程索引資料格式錯誤/);
  });

  it("失敗後清快取,可重試", async () => {
    const fn = mockFetch((url) =>
      url === "/data/index.json"
        ? jsonResponse(undefined, { ok: false, status: 500 })
        : jsonResponse(validIndex),
    );
    await expect(getLessonIndex()).rejects.toThrow(/HTTP 500/);
    // 改為成功回應後重試應再次 fetch 並成功
    fn.mockImplementation(() => Promise.resolve(jsonResponse(validIndex)));
    const index = await getLessonIndex();
    expect(index.lessons).toHaveLength(50);
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

describe("getLesson", () => {
  it("成功:回傳解析後的課程,並 fetch 補零後的路徑", async () => {
    const fn = mockFetch(() => jsonResponse(validLesson));
    const lesson = await getLesson(13);
    expect(lesson.id).toBe(13);
    expect(lesson.vocab[0].id).toBe("L13-V001");
    expect(fn).toHaveBeenCalledWith("/data/lessons/L13.json");
  });

  it("課號補零:第 1 課 → L01.json", async () => {
    const fn = mockFetch(() => jsonResponse({ ...validLesson, id: 1 }));
    await getLesson(1);
    expect(fn).toHaveBeenCalledWith("/data/lessons/L01.json");
  });

  it("快取:同課多次呼叫只 fetch 一次", async () => {
    const fn = mockFetch(() => jsonResponse(validLesson));
    await getLesson(13);
    await getLesson(13);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("404:丟出含課號與 HTTP 狀態的錯誤", async () => {
    mockFetch(() => jsonResponse(undefined, { ok: false, status: 404 }));
    await expect(getLesson(99)).rejects.toThrow(/第 99 課.*HTTP 404/);
  });

  it("schema 不符:錯誤訊息含課號與欄位路徑", async () => {
    const bad = {
      ...validLesson,
      vocab: [{ ...validLesson.vocab[0], id: "BAD" }],
    };
    mockFetch(() => jsonResponse(bad));
    await expect(getLesson(13)).rejects.toThrow(
      /第 13 課資料格式錯誤.*vocab\.0\.id/,
    );
  });
});
