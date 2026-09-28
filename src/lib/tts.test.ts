import { afterEach, vi } from "vitest";
import {
  cancelSpeech,
  isTtsSupported,
  loadJaVoice,
  pickJaVoice,
  speak,
  speechText,
  VOICE_TIMEOUT_MS,
} from "./tts";

// 假的 Utterance:記錄建構參數
class FakeUtterance {
  text: string;
  lang = "";
  voice: unknown = null;
  constructor(text: string) {
    this.text = text;
  }
}

function voice(
  lang: string,
  name: string,
  localService = true,
): SpeechSynthesisVoice {
  return { lang, name, localService } as SpeechSynthesisVoice;
}

const jaVoice = voice("ja-JP", "Kyoko");
const enVoice = voice("en-US", "Alex");
const jaRemote = voice("ja-JP", "Google 日本語", false);
const jaLocal = voice("ja-JP", "O-Ren");

/** 以 EventTarget 模擬 speechSynthesis;`loadVoices` 模擬語音清單晚到(voiceschanged) */
function installSynth(initial: SpeechSynthesisVoice[]) {
  let voices = initial;
  const target = new EventTarget();
  const synth = Object.assign(target, {
    getVoices: vi.fn(() => voices),
    speak: vi.fn(),
    cancel: vi.fn(),
  });
  vi.stubGlobal("speechSynthesis", synth);
  vi.stubGlobal("SpeechSynthesisUtterance", FakeUtterance);
  return {
    synth,
    loadVoices(next: SpeechSynthesisVoice[]) {
      voices = next;
      target.dispatchEvent(new Event("voiceschanged"));
    },
  };
}

/** 朗讀內容(text + voice)依序列出 */
function spoken(synth: ReturnType<typeof installSynth>["synth"]) {
  return synth.speak.mock.calls.map(([u]) => {
    const utt = u as FakeUtterance;
    return { text: utt.text, voice: utt.voice };
  });
}

/** 讓等待語音清單的 promise 鏈跑完 */
async function flush() {
  for (let i = 0; i < 3; i++) await Promise.resolve();
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("isTtsSupported", () => {
  it("有 speechSynthesis 與 Utterance 時為 true", () => {
    installSynth([jaVoice]);
    expect(isTtsSupported()).toBe(true);
  });

  it("無 speechSynthesis 時為 false", () => {
    vi.stubGlobal("speechSynthesis", undefined);
    expect(isTtsSupported()).toBe(false);
  });
});

describe("pickJaVoice", () => {
  it("優先裝置內建(localService)的日語 voice", () => {
    expect(pickJaVoice([enVoice, jaRemote, jaLocal])).toBe(jaLocal);
  });

  it("沒有內建日語 voice 時退回任一日語 voice", () => {
    expect(pickJaVoice([enVoice, jaRemote])).toBe(jaRemote);
  });

  it("lang 大小寫/底線寫法(ja_JP)皆可;無日語 voice 為 null", () => {
    const underscore = voice("ja_JP", "Android");
    expect(pickJaVoice([enVoice, underscore])).toBe(underscore);
    expect(pickJaVoice([enVoice])).toBeNull();
    expect(pickJaVoice([])).toBeNull();
  });
});

describe("speak", () => {
  it("正常:以 ja-JP 與日語 voice 朗讀", () => {
    const { synth } = installSynth([enVoice, jaVoice]);
    speak("にほんご");
    expect(synth.speak).toHaveBeenCalledTimes(1);
    const utt = synth.speak.mock.calls[0][0] as FakeUtterance;
    expect(utt.text).toBe("にほんご");
    expect(utt.lang).toBe("ja-JP");
    expect(utt.voice).toBe(jaVoice);
  });

  it("清單已載入時同步朗讀(不等任何 promise,維持在點擊事件內)", () => {
    const { synth } = installSynth([jaVoice]);
    speak("にほんご");
    expect(synth.speak).toHaveBeenCalledTimes(1);
  });

  it("localService 優先:同時有線上與內建日語 voice 時用內建", () => {
    const { synth } = installSynth([jaRemote, enVoice, jaLocal]);
    speak("にほんご");
    expect(spoken(synth)).toEqual([{ text: "にほんご", voice: jaLocal }]);
  });

  it("只有線上日語 voice 時仍會朗讀(不因離線偏好而無聲)", () => {
    const { synth } = installSynth([jaRemote]);
    speak("にほんご");
    expect(spoken(synth)).toEqual([{ text: "にほんご", voice: jaRemote }]);
  });

  it("選定的 voice 快取:之後的朗讀不再掃描語音清單", () => {
    const { synth } = installSynth([jaVoice]);
    speak("いち");
    speak("に");
    expect(synth.getVoices).toHaveBeenCalledTimes(1);
    expect(spoken(synth).map((s) => s.voice)).toEqual([jaVoice, jaVoice]);
  });

  it("延遲的 voiceschanged:清單晚到時等它載入再朗讀", async () => {
    const { synth, loadVoices } = installSynth([]);
    speak("にほんご");
    expect(synth.speak).not.toHaveBeenCalled();

    loadVoices([enVoice, jaVoice]);
    await flush();
    expect(spoken(synth)).toEqual([{ text: "にほんご", voice: jaVoice }]);
  });

  it("延遲的清單也遵守 localService 優先", async () => {
    const { synth, loadVoices } = installSynth([]);
    speak("にほんご");
    loadVoices([jaRemote, jaLocal]);
    await flush();
    expect(spoken(synth)).toEqual([{ text: "にほんご", voice: jaLocal }]);
  });

  it("等待中連點:只讀最後一次", async () => {
    const { synth, loadVoices } = installSynth([]);
    speak("いち");
    speak("に");
    loadVoices([jaVoice]);
    await flush();
    expect(spoken(synth).map((s) => s.text)).toEqual(["に"]);
  });

  it("等待中 cancelSpeech:清單載入後不朗讀", async () => {
    const { synth, loadVoices } = installSynth([]);
    speak("にほんご");
    cancelSpeech();
    loadVoices([jaVoice]);
    await flush();
    expect(synth.speak).not.toHaveBeenCalled();
  });

  it("清單始終為空:等到逾時後靜默;之後的點擊不再等待", async () => {
    vi.useFakeTimers();
    const { synth } = installSynth([]);
    speak("にほんご");
    await vi.advanceTimersByTimeAsync(VOICE_TIMEOUT_MS - 1);
    expect(synth.speak).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(synth.speak).not.toHaveBeenCalled();

    // 逾時後已定案:再點不再排入等待(清單晚到也不會補讀舊請求)
    speak("もういちど");
    expect(vi.getTimerCount()).toBe(0);
    await flush();
    expect(synth.speak).not.toHaveBeenCalled();
  });

  it("逾時後語音才出現:之後的點擊可直接朗讀", async () => {
    vi.useFakeTimers();
    const { synth, loadVoices } = installSynth([]);
    speak("いち");
    await vi.advanceTimersByTimeAsync(VOICE_TIMEOUT_MS);
    loadVoices([jaVoice]);
    await flush();
    expect(synth.speak).not.toHaveBeenCalled(); // 逾時前的請求已作廢

    speak("に");
    expect(spoken(synth)).toEqual([{ text: "に", voice: jaVoice }]);
  });

  it("逾時後語音才出現且不觸發 voiceschanged(部分 WebKit):下次點擊重掃並朗讀", async () => {
    vi.useFakeTimers();
    let voices: SpeechSynthesisVoice[] = [];
    // 非 EventTarget 的舊實作:沒有 addEventListener,只能靠重掃 getVoices()
    const synth = {
      getVoices: vi.fn(() => voices),
      speak: vi.fn(),
      cancel: vi.fn(),
    };
    vi.stubGlobal("speechSynthesis", synth);
    vi.stubGlobal("SpeechSynthesisUtterance", FakeUtterance);

    speak("いち");
    await vi.advanceTimersByTimeAsync(VOICE_TIMEOUT_MS);
    expect(synth.speak).not.toHaveBeenCalled();

    voices = [jaRemote, jaLocal]; // 逾時後才補上,沒有事件
    speak("に");
    expect(synth.speak).toHaveBeenCalledTimes(1);
    const utt = synth.speak.mock.calls[0][0] as FakeUtterance;
    expect(utt.text).toBe("に");
    expect(utt.voice).toBe(jaLocal);

    // 找到後即快取:之後不再重掃
    const scans = synth.getVoices.mock.calls.length;
    speak("さん");
    expect(synth.getVoices).toHaveBeenCalledTimes(scans);
    expect(synth.speak).toHaveBeenCalledTimes(2);
  });

  it("清單之後再變動(內建語音晚到):快取更新為內建 voice", () => {
    const { synth, loadVoices } = installSynth([jaRemote]);
    speak("いち");
    loadVoices([jaRemote, jaLocal]);
    speak("に");
    expect(spoken(synth).map((s) => s.voice)).toEqual([jaRemote, jaLocal]);
  });

  it("無日語 voice:靜默降級,不朗讀", () => {
    const { synth } = installSynth([enVoice]);
    speak("にほんご");
    expect(synth.speak).not.toHaveBeenCalled();
  });

  it("連點:每次朗讀前先 cancel 中斷前一次", () => {
    const { synth } = installSynth([jaVoice]);
    speak("いち");
    speak("に");
    expect(synth.cancel).toHaveBeenCalledTimes(2);
    expect(synth.speak).toHaveBeenCalledTimes(2);
  });

  it("空字串:不動作", () => {
    const { synth } = installSynth([jaVoice]);
    speak("");
    expect(synth.speak).not.toHaveBeenCalled();
  });

  it("不支援:不丟錯", () => {
    vi.stubGlobal("speechSynthesis", undefined);
    expect(() => speak("x")).not.toThrow();
  });
});

describe("loadJaVoice", () => {
  it("不支援時為 null", async () => {
    vi.stubGlobal("speechSynthesis", undefined);
    await expect(loadJaVoice()).resolves.toBeNull();
  });

  it("清單晚到:voiceschanged 後回傳日語 voice(預載,之後同步朗讀)", async () => {
    const { synth, loadVoices } = installSynth([]);
    const pending = loadJaVoice();
    loadVoices([jaRemote, jaLocal]);
    await expect(pending).resolves.toBe(jaLocal);

    speak("にほんご");
    expect(spoken(synth)).toEqual([{ text: "にほんご", voice: jaLocal }]);
  });

  it("逾時仍無語音:null", async () => {
    vi.useFakeTimers();
    installSynth([]);
    const pending = loadJaVoice();
    await vi.advanceTimersByTimeAsync(VOICE_TIMEOUT_MS);
    await expect(pending).resolves.toBeNull();
  });

  it("逾時後清單才補上(無事件):再次呼叫會重掃取得 voice", async () => {
    vi.useFakeTimers();
    let voices: SpeechSynthesisVoice[] = [];
    vi.stubGlobal("speechSynthesis", {
      getVoices: () => voices,
      speak: vi.fn(),
      cancel: vi.fn(),
    });
    vi.stubGlobal("SpeechSynthesisUtterance", FakeUtterance);
    const first = loadJaVoice();
    await vi.advanceTimersByTimeAsync(VOICE_TIMEOUT_MS);
    await expect(first).resolves.toBeNull();

    voices = [jaVoice];
    await expect(loadJaVoice()).resolves.toBe(jaVoice);
  });
});

describe("cancelSpeech", () => {
  it("呼叫底層 cancel", () => {
    const { synth } = installSynth([jaVoice]);
    cancelSpeech();
    expect(synth.cancel).toHaveBeenCalledTimes(1);
  });

  it("不支援時不丟錯", () => {
    vi.stubGlobal("speechSynthesis", undefined);
    expect(() => cancelSpeech()).not.toThrow();
  });
});

describe("speechText(字串:例句)", () => {
  it("［］〔〕保留內容、只去括號", () => {
    expect(speechText("［お］酒")).toBe("お酒");
    expect(
      speechText("日本料理［の 中］で 何が いちばん おいしいですか。"),
    ).toBe("日本料理の 中で 何が いちばん おいしいですか。");
    expect(speechText("〔お〕国は どちらですか。")).toBe(
      "お国は どちらですか。",
    );
  });

  it("（）替代說法只讀括號外(全形/半形)", () => {
    expect(
      speechText("わたしは 息子に お菓子を やりました（あげました）。"),
    ).toBe("わたしは 息子に お菓子を やりました。");
    expect(speechText("そこに 置いといて (置いて おいて)ください。")).toBe(
      "そこに 置いといてください。",
    );
  });

  it("／ 只讀第一個候選", () => {
    expect(speechText("ここ／そこ／あそこ／どこ")).toBe("ここ");
  });

  it("〜 … 刪除,句中標點與空白保留", () => {
    expect(speechText("…はい、アメリカ人です。")).toBe(
      "はい、アメリカ人です。",
    );
    expect(speechText("ちょっと……。")).toBe("ちょっと。");
    expect(speechText("〜が、〜")).toBe("が");
  });

  it("―/— 視為長音;無記號的句子原樣", () => {
    expect(speechText("え―と")).toBe("えーと");
    expect(speechText("え—と")).toBe("えーと");
    expect(speechText("公園で 遊びます。")).toBe("公園で 遊びます。");
  });
});
