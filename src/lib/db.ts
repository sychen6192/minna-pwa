import Dexie, { type Table } from "dexie";
import type { QuestionType } from "@/lib/quiz";

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
  due: number; // 評分前的 due(真實時刻)
  elapsedDays: number; // 距上次複習的學習日數(DATA_MODEL §4-5)
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
  desiredRetention: number; // FSRS 目標保留率 0.80–0.97(T9.4)
  ttsEnabled: boolean;
  furigana: "show" | "hide";
  installPromptDismissed: boolean; // 安裝提示已被使用者關閉(T6.3)
  quizTypes: QuestionType[]; // 單字測驗的題型選擇(T11.8;聽力只在有日語語音時出題)
}

export const DEFAULT_SETTINGS: Settings = {
  newPerDay: 10,
  maxReviewsPerDay: 200,
  dailyGoal: 20,
  reverseCards: false,
  desiredRetention: 0.9,
  ttsEnabled: true,
  furigana: "show",
  installPromptDismissed: false,
  quizTypes: ["jp-to-zh", "zh-to-jp", "input", "cloze", "listen"],
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

/**
 * 設定列是否帶值。備份匯入不檢查設定內容(backup.ts),手改的備份可能留下缺 value 的列;
 * 這種列視同未設定,否則每日上限會變成 NaN 而失效。
 */
function hasValue(row: SettingsRow | undefined): row is SettingsRow {
  return row !== undefined && row.value !== undefined && row.value !== null;
}

/** 讀取單一設定;未設定(或列缺值)時回退預設值。 */
export async function getSetting<K extends SettingsKey>(
  key: K,
): Promise<Settings[K]> {
  const row = await db.settings.get(key);
  return hasValue(row) ? (row.value as Settings[K]) : DEFAULT_SETTINGS[key];
}

/** 寫入單一設定。 */
export async function setSetting<K extends SettingsKey>(
  key: K,
  value: Settings[K],
): Promise<void> {
  await db.settings.put({ key, value });
}

/** 讀取全部設定(以預設值補齊缺漏;缺值的列同未設定)。 */
export async function getAllSettings(): Promise<Settings> {
  const rows = await db.settings.toArray();
  const stored = Object.fromEntries(rows.filter(hasValue).map((r) => [r.key, r.value]));
  // stored 的值型別為 unknown,以預設值為基底覆蓋,結構符合 Settings
  return { ...DEFAULT_SETTINGS, ...stored } as Settings;
}
