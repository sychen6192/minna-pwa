/**
 * Web Speech API(`ja-JP`)的輕量包裝。
 * 設計原則:無 API、無日語 voice 時一律靜默降級(不丟錯);朗讀前先取消
 * 進行中的語音,讓重複點擊可重播/中斷。
 * 語音清單非同步載入(Chrome 首次 getVoices() 為空,待 `voiceschanged`):首次使用時
 * 才開始監聽,最多等 VOICE_TIMEOUT_MS;選定的日語 voice 快取於模組內。
 * 是否渲染發音鈕(設定 `ttsEnabled`)由頁面決定(useTtsEnabled),本模組不讀 DB。
 */

import type { VocabItem } from "@/schemas/lesson";

const JA_LANG = "ja-JP";

/** 語音清單為空時,等待 `voiceschanged` 的上限。 */
export const VOICE_TIMEOUT_MS = 1500;

export function isTtsSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "speechSynthesis" in window &&
    "SpeechSynthesisUtterance" in window &&
    // 部分環境(與測試)以 undefined 覆寫 speechSynthesis
    window.speechSynthesis != null
  );
}

function isJaVoice(v: SpeechSynthesisVoice): boolean {
  return v.lang.toLowerCase().startsWith("ja"); // ja-JP;部分 Android 為 ja_JP
}

/** 挑日語 voice:優先裝置內建(localService,離線可用),沒有才用任一日語 voice(如線上語音)。 */
export function pickJaVoice(
  voices: readonly SpeechSynthesisVoice[],
): SpeechSynthesisVoice | null {
  const ja = voices.filter(isJaVoice);
  return ja.find((v) => v.localService) ?? ja[0] ?? null;
}

/** 某個 speechSynthesis 實例的語音狀態(以實例為鍵,換實例即重建) */
interface VoiceState {
  voice: SpeechSynthesisVoice | null;
  /** 語音清單已載入(非空),或已等到逾時 */
  settled: boolean;
  /** settled 時 resolve */
  ready: Promise<void>;
}

let state: { synth: SpeechSynthesis; voices: VoiceState } | null = null;

function voiceState(synth: SpeechSynthesis): VoiceState {
  if (state?.synth === synth) return state.voices;
  let resolveReady = () => {};
  const s: VoiceState = {
    voice: null,
    settled: false,
    ready: new Promise<void>((resolve) => {
      resolveReady = resolve;
    }),
  };
  state = { synth, voices: s };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const settle = () => {
    if (s.settled) return;
    s.settled = true;
    clearTimeout(timer);
    resolveReady();
  };
  const refresh = () => {
    const voices = synth.getVoices();
    s.voice = pickJaVoice(voices);
    if (voices.length > 0) settle();
  };
  // 常駐監聽:清單之後再變動(語音晚到、安裝新語音)也更新快取;舊實作可能不是 EventTarget
  synth.addEventListener?.("voiceschanged", refresh);
  refresh();
  if (!s.settled) {
    timer = setTimeout(() => {
      refresh();
      settle();
    }, VOICE_TIMEOUT_MS);
  }
  return s;
}

/**
 * 取得日語 voice:清單已載入時立即回傳;否則等 `voiceschanged`(最多 timeout)。
 * 無 API 或無日語 voice 時為 null。頁面可預先呼叫以預載(首次點擊即可同步發音)。
 */
export async function loadJaVoice(): Promise<SpeechSynthesisVoice | null> {
  if (!isTtsSupported()) return null;
  const synth = window.speechSynthesis;
  const s = voiceState(synth);
  if (!s.settled) await s.ready;
  return rescanIfMissing(synth, s);
}

/**
 * 已定案卻沒有日語 voice 時同步重掃一次:部分引擎(WebKit/WebView)在逾時後才補上
 * 語音清單且不觸發 `voiceschanged`;找到的 voice 才快取,「沒有」不視為永久結果。
 */
function rescanIfMissing(
  synth: SpeechSynthesis,
  s: VoiceState,
): SpeechSynthesisVoice | null {
  if (s.settled && !s.voice) s.voice = pickJaVoice(synth.getVoices());
  return s.voice;
}

/** 每次 speak/cancel 遞增:等待語音清單期間若又有新的朗讀或取消,舊請求作廢。 */
let requestSeq = 0;

function utter(
  synth: SpeechSynthesis,
  text: string,
  voice: SpeechSynthesisVoice,
) {
  synth.cancel(); // 中斷進行中的朗讀(支援連點重播)
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = JA_LANG;
  utterance.voice = voice;
  synth.speak(utterance);
}

/**
 * 以日語朗讀文字;不支援或無日語 voice 時靜默不動作。
 * 語音已載入時同步朗讀(維持在點擊事件內,行動版瀏覽器較不會擋);
 * 尚未載入時等待後再讀,期間的新請求會取代舊請求。
 */
export function speak(text: string): void {
  if (!isTtsSupported() || !text) return;
  const synth = window.speechSynthesis;
  const seq = ++requestSeq;
  const s = voiceState(synth);
  const voice = rescanIfMissing(synth, s);
  if (voice) {
    utter(synth, text, voice);
    return;
  }
  if (s.settled) return; // 清單已載入(或已逾時)卻無日語 voice → 靜默降級
  void s.ready.then(() => {
    if (seq === requestSeq && s.voice) utter(synth, text, s.voice);
  });
}

/** 取消目前朗讀(含等待語音清單中的請求)。 */
export function cancelSpeech(): void {
  requestSeq++;
  if (!isTtsSupported()) return;
  window.speechSynthesis.cancel();
}

// ── 朗讀文字 ───────────────────────────────────────────────────────

/** （…）替代說法(含半形與前置空白):只讀括號外 */
const ALT_PAREN_RE = /\s*[（(][^（）()]*[）)]/g;
/** ／ 並列候選:只讀第一個(去掉「／」及其後到空白為止) */
const SLASH_ALT_RE = /／[^\s／]*/g;
/** ［…］〔…〕可省略部分:保留內容、只去括號 */
const BRACKET_RE = /[［］〔〕]/g;
/** 〜 … 接續/省略記號 */
const ELLIPSIS_RE = /[〜～…‥]/g;
/** 教材以 ―(U+2015)/—(U+2014)記長音(え―と) */
const DASH_RE = /[―—]/g;
/** 單字不需要的標點與空白(に、さん → にさん) */
const WORD_PUNCT_RE = /[\s、。,\uFF0C・･「」『』!?\uFF01\uFF1F]/g;

function stripMarks(text: string): string {
  return text
    .replace(ALT_PAREN_RE, "")
    .replace(SLASH_ALT_RE, "")
    .replace(BRACKET_RE, "")
    .replace(ELLIPSIS_RE, "")
    .replace(DASH_RE, "ー");
}

/**
 * 單字的朗讀讀音:取 kana(學習者要學的是假名讀音的重音)。
 * 例外:（）替代說法被串接進 kana(トイレおてあらい)時,改由 ruby 讀音取括號外(トイレ)。
 */
function vocabReading(v: Pick<VocabItem, "ruby" | "kana">): string {
  const reading = v.ruby.map((s) => s.r ?? s.b).join("");
  if (/[（(]/.test(reading) && reading.replace(/[\s（）()]/g, "") === v.kana) {
    return reading;
  }
  return v.kana;
}

/**
 * 要交給 TTS 的文字:去除教材記號,避免朗讀「かっこ」「スラッシュ」或串接兩個候選。
 * - ［な］〔など〕:保留內容(すき［な］→ すきな)
 * - （…）:替代說法,只讀括號外
 * - ／:只讀第一個候選(おっと／しゅじん → おっと)
 * - 〜 …:刪除;―/— → ー(え―と → えーと)
 * 單字(VocabItem)另去除 、・ 與空白(に、さん → にさん);字串(例句)保留標點與空白。
 */
export function speechText(
  v: Pick<VocabItem, "ruby" | "kana"> | string,
): string {
  if (typeof v === "string") {
    return stripMarks(v)
      .replace(/^[\s、]+|[\s、]+$/g, "")
      .replace(/\s{2,}/g, " ");
  }
  return stripMarks(vocabReading(v)).replace(WORD_PUNCT_RE, "");
}
