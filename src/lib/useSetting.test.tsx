import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";
import { db, setSetting } from "./db";
import { loadJaVoice, VOICE_TIMEOUT_MS } from "./tts";
import { useJaVoiceAvailable, useSetting, useTtsEnabled } from "./useSetting";

beforeEach(async () => {
  await db.settings.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** mock 的 speechSynthesis(只需觀察是否開始載入語音清單) */
function installSynth(
  voices: { lang: string; name: string; localService: boolean }[] = [
    { lang: "ja-JP", name: "Kyoko", localService: true },
  ],
) {
  const getVoices = vi.fn(() => voices);
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

  it("卸載(離開頁面)時取消朗讀", async () => {
    installSynth();
    const { result, unmount } = renderHook(() => useTtsEnabled());
    await waitFor(() => expect(result.current).toBe(true));
    const { cancel } = window.speechSynthesis as unknown as { cancel: ReturnType<typeof vi.fn> };
    expect(cancel).not.toHaveBeenCalled();
    unmount();
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("關閉:回傳 false,不碰語音 API", async () => {
    const getVoices = installSynth();
    await setSetting("ttsEnabled", false);
    const { result } = renderHook(() => useTtsEnabled());
    await waitFor(() => expect(result.current).toBe(false));
    expect(getVoices).not.toHaveBeenCalled();
  });
});

describe("useJaVoiceAvailable", () => {
  const KYOKO = { lang: "ja-JP", name: "Kyoko", localService: true };

  it("有日語 voice:查詢中為 undefined,查詢後為 true", async () => {
    installSynth();
    const { result } = renderHook(() => useJaVoiceAvailable(true));
    expect(result.current).toBeUndefined(); // 查詢中
    await waitFor(() => expect(result.current).toBe(true));
  });

  it("只有其他語言的 voice:false", async () => {
    installSynth([{ lang: "en-US", name: "Alex", localService: true }]);
    const { result } = renderHook(() => useJaVoiceAvailable(true));
    // 等 hook 內的同一查詢完成(清單已載入:立即 resolve)後仍為 false
    await act(() => loadJaVoice());
    expect(result.current).toBe(false);
  });

  it("不支援語音 API:false", async () => {
    vi.stubGlobal("speechSynthesis", undefined);
    const { result } = renderHook(() => useJaVoiceAvailable(true));
    await act(() => loadJaVoice());
    expect(result.current).toBe(false);
  });

  it("設定讀取中為 undefined、關閉為 false,都不碰語音 API", () => {
    const getVoices = installSynth();
    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean | undefined }) => useJaVoiceAvailable(enabled),
      { initialProps: { enabled: undefined as boolean | undefined } },
    );
    expect(result.current).toBeUndefined();
    rerender({ enabled: false });
    expect(result.current).toBe(false);
    expect(getVoices).not.toHaveBeenCalled();
  });

  it("語音清單在逾時後才到且觸發 voiceschanged(Chrome/Android):重新判斷為 true", async () => {
    vi.useFakeTimers();
    try {
      const voices: (typeof KYOKO)[] = [];
      installSynth(voices);
      const { result } = renderHook(() => useJaVoiceAvailable(true));
      await act(() => vi.advanceTimersByTimeAsync(VOICE_TIMEOUT_MS));
      expect(result.current).toBe(false); // 逾時:當下沒有日語 voice

      voices.push(KYOKO);
      await act(async () => {
        window.speechSynthesis.dispatchEvent(new Event("voiceschanged"));
      });
      expect(result.current).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("語音清單晚到但不觸發事件(WebKit):recheckKey 改變時重掃;重掃期間不回到 undefined", async () => {
    const voices: (typeof KYOKO)[] = [{ lang: "en-US", name: "Alex", localService: true }];
    installSynth(voices);
    const { result, rerender } = renderHook(
      ({ key }: { key: string }) => useJaVoiceAvailable(true, key),
      { initialProps: { key: "vocab" } },
    );
    await act(() => loadJaVoice());
    expect(result.current).toBe(false);

    voices.push(KYOKO);
    rerender({ key: "dialogue" });
    expect(result.current).toBe(false); // 重掃中:維持上次結果
    await waitFor(() => expect(result.current).toBe(true));
  });

  it("卸載時取消訂閱 voiceschanged", async () => {
    installSynth();
    const remove = vi.spyOn(window.speechSynthesis, "removeEventListener");
    const { unmount } = renderHook(() => useJaVoiceAvailable(true));
    unmount();
    expect(remove).toHaveBeenCalledWith("voiceschanged", expect.any(Function));
  });
});
