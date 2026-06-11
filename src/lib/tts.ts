/**
 * Web Speech API(`ja-JP`)的輕量包裝。
 * 設計原則:無 API、無日語 voice 時一律靜默降級(不丟錯);朗讀前先取消
 * 進行中的語音,讓重複點擊可重播/中斷。
 */

const JA_LANG = "ja-JP";

export function isTtsSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "speechSynthesis" in window &&
    "SpeechSynthesisUtterance" in window
  );
}

function findJaVoice(synth: SpeechSynthesis): SpeechSynthesisVoice | undefined {
  return synth.getVoices().find((v) => v.lang.toLowerCase().startsWith("ja"));
}

/** 以日語朗讀文字;不支援或無日語 voice 時靜默不動作。 */
export function speak(text: string): void {
  if (!isTtsSupported() || !text) return;
  const synth = window.speechSynthesis;

  const voice = findJaVoice(synth);
  if (!voice) return; // 無日語 voice → 靜默降級

  synth.cancel(); // 中斷進行中的朗讀(支援連點重播)
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = JA_LANG;
  utterance.voice = voice;
  synth.speak(utterance);
}

/** 取消目前朗讀。 */
export function cancelSpeech(): void {
  if (!isTtsSupported()) return;
  window.speechSynthesis.cancel();
}
