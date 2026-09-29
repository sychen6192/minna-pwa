import { useEffect, useState } from "react";
import {
  DEFAULT_SETTINGS,
  getSetting,
  type Settings,
  type SettingsKey,
} from "@/lib/db";
import { cancelSpeech, loadJaVoice } from "@/lib/tts";

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
