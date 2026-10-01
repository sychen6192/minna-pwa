/**
 * Web Speech API(`ja-JP`)的輕量包裝。
 * 設計原則:無 API、無日語 voice 時一律靜默降級(不丟錯);朗讀前先取消
 * 進行中的語音,讓重複點擊可重播/中斷。連續朗讀(speakSequence)與單次朗讀互斥,後者會中斷前者。
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

/**
 * 語音清單變動(晚到、安裝新語音)時通知,回傳取消訂閱:頁面據此重新判斷有無日語 voice
 * (useJaVoiceAvailable)。模組內的 voice 快取先於此更新(其監聽在首次 loadJaVoice/speak 時註冊,
 * 呼叫端應先呼叫 loadJaVoice 再訂閱)。無 API 或舊實作(非 EventTarget)時不通知。
 */
export function onVoicesChanged(listener: () => void): () => void {
  if (!isTtsSupported()) return () => {};
  const synth = window.speechSynthesis;
  synth.addEventListener?.("voiceschanged", listener);
  return () => synth.removeEventListener?.("voiceschanged", listener);
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
  interruptSequence();
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

/** 取消目前朗讀(含等待語音清單中的請求與進行中的 speakSequence)。 */
export function cancelSpeech(): void {
  requestSeq++;
  interruptSequence();
  if (!isTtsSupported()) return;
  window.speechSynthesis.cancel();
}

// ── 連續朗讀 ───────────────────────────────────────────────────────

export interface SpeakSequenceOptions {
  /** 第 i 句送出朗讀時(目前句高亮) */
  onStart?: (index: number) => void;
  /**
   * 序列結束:`finished` = 全部讀完;false = 被新的 speak/speakSequence/cancelSpeech 中斷、
   * 引擎出錯或沒有日語 voice。呼叫回傳的取消函式時不通知(呼叫端自己知道)。
   */
  onEnd?: (finished: boolean) => void;
  /** 語速(SpeechSynthesisUtterance.rate;預設不設,即引擎預設 1) */
  rate?: number;
}

/** 進行中的 speakSequence:同時只有一個,新的朗讀會中斷它(interrupt 會通知 onEnd(false)) */
let activeSequence: { interrupt: () => void } | null = null;

function interruptSequence() {
  const active = activeSequence;
  activeSequence = null;
  active?.interrupt();
}

/**
 * 依序朗讀多句(会話全部播放):前一句 `onend` 後才送出下一句,可隨時以回傳的函式取消。
 * - 與單次 speak() 不重疊:開始時中斷進行中的朗讀與序列(含等待語音清單中的 speak),
 *   之後的 speak()/cancelSpeech() 也會中斷本序列(通知 onEnd(false))
 * - 語音清單已載入時同步送出第一句(維持在點擊事件內);未載入時等待後再開始
 * - 無 API、無日語 voice 或沒有句子時不朗讀,非同步通知 onEnd(沒有句子為 true,其餘 false)
 */
export function speakSequence(
  texts: readonly string[],
  { onStart, onEnd, rate }: SpeakSequenceOptions = {},
): () => void {
  let done = false;
  // 目前這句:保留參照(部分 Chrome 版本會回收沒有參照的 utterance,之後不觸發 onend);
  // 事件只認目前這句,取消/中斷後舊句補發的 onend/onerror 一律忽略
  let current: SpeechSynthesisUtterance | null = null;
  const finish = (finished: boolean) => {
    if (done) return;
    done = true;
    current = null;
    if (activeSequence === handle) activeSequence = null;
    onEnd?.(finished);
  };
  const handle = { interrupt: () => finish(false) };
  const cancel = () => {
    if (done) return;
    done = true;
    if (activeSequence === handle) activeSequence = null;
    const speaking = current !== null;
    current = null;
    if (speaking) window.speechSynthesis.cancel();
  };

  if (!isTtsSupported() || texts.length === 0) {
    const finished = texts.length === 0;
    // 非同步通知:呼叫端拿到取消函式之後才收到結束
    queueMicrotask(() => finish(finished));
    return cancel;
  }

  interruptSequence();
  requestSeq++; // 等待語音清單中的單次 speak 作廢
  activeSequence = handle;
  const synth = window.speechSynthesis;

  const speakAt = (i: number, voice: SpeechSynthesisVoice) => {
    if (done) return;
    if (i >= texts.length) {
      finish(true);
      return;
    }
    const utterance = new SpeechSynthesisUtterance(texts[i]);
    utterance.lang = JA_LANG;
    utterance.voice = voice;
    if (rate !== undefined) utterance.rate = rate;
    utterance.onend = () => {
      if (current === utterance) speakAt(i + 1, voice);
    };
    utterance.onerror = () => {
      if (current === utterance) finish(false);
    };
    current = utterance;
    onStart?.(i);
    synth.speak(utterance);
  };
  const begin = (voice: SpeechSynthesisVoice) => {
    synth.cancel(); // 中斷進行中的單次朗讀
    speakAt(0, voice);
  };

  const s = voiceState(synth);
  const voice = rescanIfMissing(synth, s);
  if (voice) {
    begin(voice);
  } else if (s.settled) {
    queueMicrotask(() => finish(false)); // 清單已載入(或已逾時)卻無日語 voice
  } else {
    void s.ready.then(() => {
      if (done) return; // 等待期間已取消或被中斷
      if (s.voice) begin(s.voice);
      else finish(false);
    });
  }
  return cancel;
}

// ── 朗讀文字 ───────────────────────────────────────────────────────

/** （…）替代說法(含半形與前置空白):只讀括號外 */
const ALT_PAREN_RE = /\s*[（(][^（）()]*[）)]/g;
/** 單字的 ／ 並列候選:只讀第一個(去掉「／」及其後到空白為止;例句的 ／ 先轉為停頓) */
const SLASH_ALT_RE = /／[^\s／]*/g;
/** ［…］〔…〕可省略部分:保留內容、只去括號 */
const BRACKET_RE = /[［］〔〕]/g;
/** 〜 … 接續/省略記號 */
const ELLIPSIS_RE = /[〜～…‥]/g;
/** ―(U+2015)/—(U+2014)視同長音(資料曾以 え―と 記長音,T12.2 已修正為 えーと) */
const DASH_RE = /[―—]/g;
/** 單字不需要的標點與空白(に、さん → にさん) */
const WORD_PUNCT_RE = /[\s、。,\uFF0C・･「」『』!?\uFF01\uFF1F]/g;
/** 例句中並列的 ／(ここ／そこ／あそこ／どこ、暇 ／暇だ):教材要逐一教的形,讀成停頓 */
const SENTENCE_SLASH_RE = /\s*／\s*/g;
/** 例句中緊接假名的短平假名（…）是補上的語尾(かけ（ない） → かけない),不是替代說法:保留內容 */
const KANA_SUFFIX_PAREN_RE = /([ぁ-ゖ])（([ぁ-ゖ]{1,2})）/g;
/** 例句行首的對話者標記(Ａ:あしたも 来ましょうか。) */
const SPEAKER_PREFIX_RE = /^\s*[A-ZＡ-Ｚ]\s*[:：]\s*/;
/** 活用對照的「→」(かきます → かいて):讀成停頓 */
const ARROW_RE = /\s*→\s*/g;
/** 語幹與語尾間的分隔「-」(かき-ます):不用 lookbehind(舊版 Safari 不支援,整個模組會解析失敗) */
const KANA_HYPHEN_RE = /([ぁ-ゖァ-ヺ])-(?=[ぁ-ゖァ-ヺ])/g;

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
 * - ／:單字只讀第一個候選(おっと／しゅじん → おっと)
 * - 〜 …:刪除;―/— → ー(え―と → えーと)
 * 單字(VocabItem)另去除 、・ 與空白(に、さん → にさん);字串(例句、会話)保留標點與空白,
 * 另去除行首對話者標記(Ａ:)與語幹分隔「-」,活用對照的「→」與並列的「／」讀成停頓(、)
 * (ここ／そこ／あそこ／どこ 四個都讀);緊接假名的短平假名（ない）是語尾、保留內容(かけ（ない） → かけない)。
 */
export function speechText(
  v: Pick<VocabItem, "ruby" | "kana"> | string,
): string {
  if (typeof v === "string") {
    const text = v
      .replace(KANA_SUFFIX_PAREN_RE, "$1$2")
      .replace(SENTENCE_SLASH_RE, "、");
    return stripMarks(text)
      .replace(SPEAKER_PREFIX_RE, "")
      .replace(ARROW_RE, "、")
      .replace(KANA_HYPHEN_RE, "$1")
      .replace(/^[\s、]+|[\s、]+$/g, "")
      .replace(/\s{2,}/g, " ");
  }
  return stripMarks(vocabReading(v)).replace(WORD_PUNCT_RE, "");
}
