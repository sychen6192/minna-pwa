import { afterEach, vi } from "vitest";
import { cancelSpeech, isTtsSupported, speak } from "./tts";

// 假的 Utterance:記錄建構參數
class FakeUtterance {
  text: string;
  lang = "";
  voice: unknown = null;
  constructor(text: string) {
    this.text = text;
  }
}

const jaVoice = { lang: "ja-JP", name: "Kyoko" } as SpeechSynthesisVoice;
const enVoice = { lang: "en-US", name: "Alex" } as SpeechSynthesisVoice;

function installSynth(voices: SpeechSynthesisVoice[]) {
  const synth = {
    getVoices: vi.fn(() => voices),
    speak: vi.fn(),
    cancel: vi.fn(),
  };
  vi.stubGlobal("speechSynthesis", synth);
  vi.stubGlobal("SpeechSynthesisUtterance", FakeUtterance);
  return synth;
}

afterEach(() => {
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

describe("speak", () => {
  it("正常:以 ja-JP 與日語 voice 朗讀", () => {
    const synth = installSynth([enVoice, jaVoice]);
    speak("にほんご");
    expect(synth.speak).toHaveBeenCalledTimes(1);
    const utt = synth.speak.mock.calls[0][0] as FakeUtterance;
    expect(utt.text).toBe("にほんご");
    expect(utt.lang).toBe("ja-JP");
    expect(utt.voice).toBe(jaVoice);
  });

  it("無日語 voice:靜默降級,不朗讀", () => {
    const synth = installSynth([enVoice]);
    speak("にほんご");
    expect(synth.speak).not.toHaveBeenCalled();
  });

  it("voice 清單為空:靜默降級", () => {
    const synth = installSynth([]);
    speak("にほんご");
    expect(synth.speak).not.toHaveBeenCalled();
  });

  it("連點:每次朗讀前先 cancel 中斷前一次", () => {
    const synth = installSynth([jaVoice]);
    speak("いち");
    speak("に");
    expect(synth.cancel).toHaveBeenCalledTimes(2);
    expect(synth.speak).toHaveBeenCalledTimes(2);
  });

  it("空字串:不動作", () => {
    const synth = installSynth([jaVoice]);
    speak("");
    expect(synth.speak).not.toHaveBeenCalled();
  });

  it("不支援:不丟錯", () => {
    vi.stubGlobal("speechSynthesis", undefined);
    expect(() => speak("x")).not.toThrow();
  });
});

describe("cancelSpeech", () => {
  it("呼叫底層 cancel", () => {
    const synth = installSynth([jaVoice]);
    cancelSpeech();
    expect(synth.cancel).toHaveBeenCalledTimes(1);
  });

  it("不支援時不丟錯", () => {
    vi.stubGlobal("speechSynthesis", undefined);
    expect(() => cancelSpeech()).not.toThrow();
  });
});
