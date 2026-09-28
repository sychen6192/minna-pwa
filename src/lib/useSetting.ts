import { useEffect, useState } from "react";
import {
  DEFAULT_SETTINGS,
  getSetting,
  type Settings,
  type SettingsKey,
} from "@/lib/db";
import { loadJaVoice } from "@/lib/tts";

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
        // 列存在但缺 value(手改的備份匯入不檢查內容)也回退預設,否則會永遠停在讀取中
        if (active) setValue(v ?? DEFAULT_SETTINGS[key]);
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
 */
export function useTtsEnabled(): boolean | undefined {
  const enabled = useSetting("ttsEnabled");
  useEffect(() => {
    if (enabled) void loadJaVoice();
  }, [enabled]);
  return enabled;
}
