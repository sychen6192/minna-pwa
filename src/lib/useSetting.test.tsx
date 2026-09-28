import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";
import { db, setSetting } from "./db";
import { useSetting, useTtsEnabled } from "./useSetting";

beforeEach(async () => {
  await db.settings.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** mock 的 speechSynthesis(只需觀察是否開始載入語音清單) */
function installSynth() {
  const getVoices = vi.fn(() => [
    { lang: "ja-JP", name: "Kyoko", localService: true },
  ]);
  vi.stubGlobal(
    "speechSynthesis",
    Object.assign(new EventTarget(), {
      getVoices,
      speak: vi.fn(),
      cancel: vi.fn(),
    }),
  );
  vi.stubGlobal("SpeechSynthesisUtterance", class {});
  return getVoices;
}

describe("useSetting", () => {
  it("讀取中為 undefined,讀到後回傳已存的值", async () => {
    await setSetting("furigana", "hide");
    const { result } = renderHook(() => useSetting("furigana"));
    expect(result.current).toBeUndefined();
    await waitFor(() => expect(result.current).toBe("hide"));
  });

  it("未設定時回傳預設值", async () => {
    const { result } = renderHook(() => useSetting("ttsEnabled"));
    await waitFor(() => expect(result.current).toBe(true));
  });

  it("讀取失敗時回退預設值(頁面不會卡在載入中)", async () => {
    vi.spyOn(db.settings, "get").mockRejectedValue(
      new Error("IndexedDB 無法使用"),
    );
    const { result } = renderHook(() => useSetting("furigana"));
    await waitFor(() => expect(result.current).toBe("show"));
  });

  it("設定列存在但缺 value(手改備份匯入):回退預設值", async () => {
    await db.settings.put({ key: "furigana", value: undefined });
    const { result } = renderHook(() => useSetting("furigana"));
    await waitFor(() => expect(result.current).toBe("show"));
  });
});

describe("useTtsEnabled", () => {
  it("開啟(預設):回傳 true 並預載日語 voice", async () => {
    const getVoices = installSynth();
    const { result } = renderHook(() => useTtsEnabled());
    await waitFor(() => expect(result.current).toBe(true));
    expect(getVoices).toHaveBeenCalled();
  });

  it("關閉:回傳 false,不碰語音 API", async () => {
    const getVoices = installSynth();
    await setSetting("ttsEnabled", false);
    const { result } = renderHook(() => useTtsEnabled());
    await waitFor(() => expect(result.current).toBe(false));
    expect(getVoices).not.toHaveBeenCalled();
  });
});
