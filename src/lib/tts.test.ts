import { afterEach, vi } from "vitest";
import {
  cancelSpeech,
  isTtsSupported,
  loadJaVoice,
  pickJaVoice,
  speak,
  speakSequence,
  speechText,
  VOICE_TIMEOUT_MS,
} from "./tts";

// 假的 Utterance:記錄建構參數;事件由測試手動觸發(onend/onerror)
class FakeUtterance {
  text: string;
  lang = "";
  voice: unknown = null;
  rate?: number;
  onend: (() => void) | null = null;
  onerror: ((e: { error: string }) => void) | null = null;
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

describe("speakSequence", () => {
  /** 最後送出的 utterance(目前正在讀的那句) */
  function last(
    synth: ReturnType<typeof installSynth>["synth"],
  ): FakeUtterance {
    return synth.speak.mock.lastCall?.[0] as FakeUtterance;
  }
  /** 模擬引擎讀完目前這句 */
  function finishCurrent(synth: ReturnType<typeof installSynth>["synth"]) {
    last(synth).onend?.();
  }

  it("串接:前一句 onend 後才送出下一句,依序通知 onStart,全部讀完 onEnd(true)", () => {
    const { synth } = installSynth([enVoice, jaVoice]);
    const onStart = vi.fn();
    const onEnd = vi.fn();
    speakSequence(["いち", "に", "さん"], { onStart, onEnd });

    // 語音已載入:第一句同步送出(維持在點擊事件內)
    expect(spoken(synth)).toEqual([{ text: "いち", voice: jaVoice }]);
    expect(onStart.mock.calls).toEqual([[0]]);
    expect(last(synth).lang).toBe("ja-JP");

    finishCurrent(synth);
    expect(spoken(synth).map((u) => u.text)).toEqual(["いち", "に"]);
    expect(onStart.mock.calls).toEqual([[0], [1]]);
    expect(onEnd).not.toHaveBeenCalled();

    finishCurrent(synth);
    finishCurrent(synth);
    expect(spoken(synth).map((u) => u.text)).toEqual(["いち", "に", "さん"]);
    expect(onStart.mock.calls).toEqual([[0], [1], [2]]);
    expect(onEnd).toHaveBeenCalledExactlyOnceWith(true);
    // 開始時中斷進行中的朗讀一次;串接的句子之間不再 cancel
    expect(synth.cancel).toHaveBeenCalledTimes(1);
  });

  it("中途取消:停止底層朗讀,之後的 onend 不再送出下一句,也不通知 onEnd", () => {
    const { synth } = installSynth([jaVoice]);
    const onEnd = vi.fn();
    const cancel = speakSequence(["いち", "に", "さん"], { onEnd });
    finishCurrent(synth); // 讀到第二句
    const second = last(synth);
    synth.cancel.mockClear();

    cancel();
    expect(synth.cancel).toHaveBeenCalledTimes(1);
    // 引擎在 cancel 後補發被中斷那句的事件:忽略
    second.onerror?.({ error: "interrupted" });
    second.onend?.();
    expect(spoken(synth).map((u) => u.text)).toEqual(["いち", "に"]);
    expect(onEnd).not.toHaveBeenCalled();

    // 重複取消無作用
    cancel();
    expect(synth.cancel).toHaveBeenCalledTimes(1);
  });

  it("讀完後才呼叫取消:不 cancel 底層(不會切掉之後的單次朗讀)", () => {
    const { synth } = installSynth([jaVoice]);
    const cancel = speakSequence(["いち"]);
    finishCurrent(synth);
    speak("に");
    synth.cancel.mockClear();
    cancel();
    expect(synth.cancel).not.toHaveBeenCalled();
  });

  it("與單次 speak 不重疊:speak() 中斷序列並通知 onEnd(false)", () => {
    const { synth } = installSynth([jaVoice]);
    const onEnd = vi.fn();
    speakSequence(["いち", "に"], { onEnd });
    const first = last(synth);

    speak("ほか");
    expect(onEnd).toHaveBeenCalledExactlyOnceWith(false);
    first.onend?.(); // 被中斷那句的 onend:不接著讀「に」
    expect(spoken(synth).map((u) => u.text)).toEqual(["いち", "ほか"]);
  });

  it("cancelSpeech 與新的序列也會中斷進行中的序列", () => {
    const { synth } = installSynth([jaVoice]);
    const a = vi.fn();
    speakSequence(["いち"], { onEnd: a });
    cancelSpeech();
    expect(a).toHaveBeenCalledExactlyOnceWith(false);

    const b = vi.fn();
    const c = vi.fn();
    speakSequence(["に"], { onEnd: b });
    const old = last(synth);
    speakSequence(["さん"], { onEnd: c });
    expect(b).toHaveBeenCalledExactlyOnceWith(false);
    old.onend?.();
    expect(spoken(synth).map((u) => u.text)).toEqual(["いち", "に", "さん"]);
    finishCurrent(synth);
    expect(c).toHaveBeenCalledExactlyOnceWith(true);
  });

  it("開始時作廢等待語音清單中的單次 speak", async () => {
    const { synth, loadVoices } = installSynth([]);
    speak("まえ");
    speakSequence(["いち"]);
    loadVoices([jaVoice]);
    await flush();
    expect(spoken(synth).map((u) => u.text)).toEqual(["いち"]);
  });

  it("語音清單晚到:等載入後才開始;等待中取消則不朗讀", async () => {
    const { synth, loadVoices } = installSynth([]);
    const onStart = vi.fn();
    speakSequence(["いち", "に"], { onStart });
    expect(synth.speak).not.toHaveBeenCalled();
    loadVoices([jaVoice]);
    await flush();
    expect(spoken(synth)).toEqual([{ text: "いち", voice: jaVoice }]);
    expect(onStart).toHaveBeenCalledWith(0);

    const second = installSynth([]);
    const onEnd = vi.fn();
    const cancel = speakSequence(["さん"], { onEnd });
    cancel();
    second.loadVoices([jaVoice]);
    await flush();
    expect(second.synth.speak).not.toHaveBeenCalled();
    expect(onEnd).not.toHaveBeenCalled();
  });

  it("rate:設在每一句的 utterance 上;未指定時不設", () => {
    const { synth } = installSynth([jaVoice]);
    speakSequence(["いち", "に"], { rate: 0.8 });
    expect(last(synth).rate).toBe(0.8);
    finishCurrent(synth);
    expect(last(synth).rate).toBe(0.8);

    speakSequence(["さん"]);
    expect(last(synth).rate).toBeUndefined();
  });

  it("引擎出錯:停止序列並通知 onEnd(false)", () => {
    const { synth } = installSynth([jaVoice]);
    const onEnd = vi.fn();
    speakSequence(["いち", "に"], { onEnd });
    last(synth).onerror?.({ error: "synthesis-failed" });
    expect(onEnd).toHaveBeenCalledExactlyOnceWith(false);
    expect(synth.speak).toHaveBeenCalledTimes(1);
  });

  it("無日語 voice 或不支援:不朗讀,非同步通知 onEnd(false);沒有句子:onEnd(true)", async () => {
    const { synth } = installSynth([enVoice]);
    const noVoice = vi.fn();
    speakSequence(["いち"], { onEnd: noVoice });
    expect(noVoice).not.toHaveBeenCalled(); // 呼叫端先拿到取消函式
    await flush();
    expect(noVoice).toHaveBeenCalledExactlyOnceWith(false);
    expect(synth.speak).not.toHaveBeenCalled();

    const empty = vi.fn();
    speakSequence([], { onEnd: empty });
    await flush();
    expect(empty).toHaveBeenCalledExactlyOnceWith(true);

    vi.stubGlobal("speechSynthesis", undefined);
    const unsupported = vi.fn();
    expect(() => speakSequence(["いち"], { onEnd: unsupported })).not.toThrow();
    await flush();
    expect(unsupported).toHaveBeenCalledExactlyOnceWith(false);
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

  it("／ 並列的形讀成停頓(四個都讀);單字的 ／ 仍只讀第一個候選", () => {
    expect(speechText("ここ／そこ／あそこ／どこ")).toBe("ここ、そこ、あそこ、どこ");
    expect(speechText("…うん、暇 ／暇だ ／暇だよ。")).toBe("うん、暇、暇だ、暇だよ。");
    expect(speechText({ ruby: [{ b: "おっと／しゅじん" }], kana: "おっと／しゅじん" })).toBe(
      "おっと",
    );
  });

  it("緊接假名的短平假名（…）是語尾:保留內容;其餘（…）仍是替代說法", () => {
    expect(speechText("かける、かけ（ない）、かけて")).toBe("かける、かけない、かけて");
    // 較長的假名(替代說法)、前有空白、半形括號:只讀括號外
    expect(speechText("やりました（あげました）。")).toBe("やりました。");
    expect(speechText("かけ （ない）")).toBe("かけ");
    expect(speechText("かけ(ない)")).toBe("かけ");
  });

  it("〜 … 刪除,句中標點與空白保留", () => {
    expect(speechText("…はい、アメリカ人です。")).toBe(
      "はい、アメリカ人です。",
    );
    expect(speechText("ちょっと……。")).toBe("ちょっと。");
    expect(speechText("〜が、〜")).toBe("が");
  });

  it("行首對話者標記(Ａ:)去除;活用對照的 → 讀成停頓、語幹分隔 - 去除", () => {
    expect(speechText("Ａ:あしたも 来ましょうか。")).toBe(
      "あしたも 来ましょうか。",
    );
    expect(speechText("B: ええ。")).toBe("ええ。");
    expect(speechText("かきます → かいて")).toBe("かきます、かいて");
    expect(speechText("かき-ます → かか-ない")).toBe("かきます、かかない");
    // 句中的英文字母與冒號不動
    expect(speechText("ＣＤを 借りました。")).toBe("ＣＤを 借りました。");
  });

  it("―/— 視為長音;無記號的句子原樣", () => {
    expect(speechText("え―と")).toBe("えーと");
    expect(speechText("え—と")).toBe("えーと");
    expect(speechText("公園で 遊びます。")).toBe("公園で 遊びます。");
  });
});
