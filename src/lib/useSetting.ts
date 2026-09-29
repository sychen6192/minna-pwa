import { useEffect, useState } from "react";
import {
  DEFAULT_SETTINGS,
  getSetting,
  type Settings,
  type SettingsKey,
} from "@/lib/db";
import { cancelSpeech, loadJaVoice, onVoicesChanged } from "@/lib/tts";

/**
 * 讀取單一全域設定(經 db.ts,掛載時讀一次):讀取中為 undefined,讀取失敗或值缺漏時回退預設值。
 * 會引入 Dexie:首頁(bundle 預算)勿用。
 */
export function useSetting<K extends SettingsKey>(
  key: K,
): Settings[K] | undefined {
  const [value, setValue] = useState<Settings[K]>();
  useEffect(() => {
    let active = true;
    getSetting(key)
      .catch(() => DEFAULT_SETTINGS[key])
      .then((v) => {
        // 列存在但缺 value 時 getSetting 已回退預設,不會停在讀取中(undefined)
        if (active) setValue(v);
      });
    return () => {
      active = false;
    };
  }, [key]);
  return value;
}

/**
 * 設定「TTS 發音」(`ttsEnabled`):false 時頁面不渲染任何發音鈕;讀取中為 undefined。
 * 開啟時順便預載日語 voice,首次點擊即可在點擊事件內同步發音。
 * 使用它的頁面(有發音鈕者)卸載時取消朗讀:離開頁面後不再讀出上一頁的字,
 * 包括語音清單載入前點下、仍在等待中的請求(tts.speak)。
 */
export function useTtsEnabled(): boolean | undefined {
  const enabled = useSetting("ttsEnabled");
  useEffect(() => {
    if (enabled) void loadJaVoice();
  }, [enabled]);
  useEffect(() => cancelSpeech, []);
  return enabled;
}

/**
 * 是否有可用的日語 voice(`enabled` = 設定 ttsEnabled):会話全部播放、扮演等只靠語音運作的功能,
 * 沒有語音時整個隱藏(單字/例句發音鈕則照 ttsEnabled 顯示、無語音時靜默)。
 * 設定讀取中或第一次查詢中為 undefined(呼叫端可先不渲染,避免控制項晚出現而推擠版面);
 * 設定關閉或無日語 voice 時為 false。語音清單晚到(逾時 VOICE_TIMEOUT_MS 之後)時:
 * - 觸發 `voiceschanged` 的引擎(Chrome/Android)由 onVoicesChanged 重新判斷
 * - 不觸發事件的引擎(WebKit/WebView)在 `recheckKey` 改變時重掃(如切換分頁);重掃不回到 undefined
 */
export function useJaVoiceAvailable(
  enabled: boolean | undefined,
  recheckKey?: string,
): boolean | undefined {
  const [available, setAvailable] = useState<boolean>();
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    const check = () => {
      void loadJaVoice().then((voice) => {
        if (active) setAvailable(voice !== null);
      });
    };
    check(); // 先建立 tts 模組的語音快取與其監聽,再訂閱:事件到時快取已更新
    const unsubscribe = onVoicesChanged(check);
    return () => {
      active = false;
      unsubscribe();
    };
  }, [enabled, recheckKey]);
  if (enabled === undefined) return undefined;
  return enabled && available;
}
