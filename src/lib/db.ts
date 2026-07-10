import Dexie, { type Table } from "dexie";

// ── 使用者資料 row 型別(DATA_MODEL §2)──────────────────────────────

export interface CardRow {
  cardId: string; // fwd = VocabItem.id;rev = `${VocabItem.id}@r`(T9.2 雙向卡)
  lessonId: number;
  type: "vocab"; // v2 預留 "grammar"
  direction?: "fwd" | "rev"; // 缺省(舊資料)視為 "fwd";rev = 義→日回想卡
  due: number; // epoch ms
  stability: number;
  difficulty: number;
  reps: number;
  lapses: number;
  state: 0 | 1 | 2 | 3; // ts-fsrs State:New / Learning / Review / Relearning
  lastReview?: number; // epoch ms
  suspended?: boolean; // 已會/暫停:排除於複習佇列與到期/頑固卡計數(T9.3)
}

export interface LogRow {
  id?: number; // auto increment
  cardId: string;
  rating: 1 | 2 | 3 | 4; // Again / Hard / Good / Easy
  state: 0 | 1 | 2 | 3; // 評分當下的卡片狀態
  due: number; // 評分前的 due
  elapsedDays: number;
  reviewedAt: number; // epoch ms
}

export interface ProgressRow {
  key: string; // `${lessonId}:${section}`
  lessonId: number;
  completedAt: number;
}

export interface SettingsRow {
  key: string;
  value: unknown;
}

// ── 設定(預設值見 DATA_MODEL §2)────────────────────────────────────

export interface Settings {
  newPerDay: number;
  maxReviewsPerDay: number;
  dailyGoal: number; // 每日複習目標張數(首頁進度環,T8.3)
  reverseCards: boolean; // 產生義→日回想方向卡(T9.2)
  ttsEnabled: boolean;
  furigana: "show" | "hide";
  installPromptDismissed: boolean; // 安裝提示已被使用者關閉(T6.3)
}

export const DEFAULT_SETTINGS: Settings = {
  newPerDay: 10,
  maxReviewsPerDay: 200,
  dailyGoal: 20,
  reverseCards: false,
  ttsEnabled: true,
  furigana: "show",
  installPromptDismissed: false,
};

export type SettingsKey = keyof Settings;

// ── DB 定義(唯一入口,不得繞過此檔直接開 Dexie 連線)─────────────────

export class MinnaDB extends Dexie {
  cards!: Table<CardRow, string>;
  logs!: Table<LogRow, number>;
  progress!: Table<ProgressRow, string>;
  settings!: Table<SettingsRow, string>;

  constructor() {
    super("minna");
    this.version(1).stores({
      cards: "cardId, due, state, lessonId",
      logs: "++id, cardId, reviewedAt",
      progress: "key, lessonId",
      settings: "key",
    });
  }
}

export const db = new MinnaDB();

// ── 設定存取 ────────────────────────────────────────────────────────

/** 首次啟動:把尚未存在的預設設定寫入(冪等,不覆蓋既有值)。 */
export async function ensureDefaultSettings(): Promise<void> {
  await db.transaction("rw", db.settings, async () => {
    for (const key of Object.keys(DEFAULT_SETTINGS) as SettingsKey[]) {
      const existing = await db.settings.get(key);
      if (existing === undefined) {
        await db.settings.put({ key, value: DEFAULT_SETTINGS[key] });
      }
    }
  });
}

/** 讀取單一設定;未設定時回退預設值。 */
export async function getSetting<K extends SettingsKey>(
  key: K,
): Promise<Settings[K]> {
  const row = await db.settings.get(key);
  return row ? (row.value as Settings[K]) : DEFAULT_SETTINGS[key];
}

/** 寫入單一設定。 */
export async function setSetting<K extends SettingsKey>(
  key: K,
  value: Settings[K],
): Promise<void> {
  await db.settings.put({ key, value });
}

/** 讀取全部設定(以預設值補齊缺漏)。 */
export async function getAllSettings(): Promise<Settings> {
  const rows = await db.settings.toArray();
  const stored = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  // stored 的值型別為 unknown,以預設值為基底覆蓋,結構符合 Settings
  return { ...DEFAULT_SETTINGS, ...stored } as Settings;
}
