import type { DrillQuestion } from "@/lib/drill";
import type { RubySeg } from "@/schemas/lesson";

/** 一題的作答狀態 */
export interface DrillAnswer {
  /** 選擇題選中的選項 id;輸入題為 null */
  selectedId: string | null;
  /** 輸入題的輸入 */
  input: string;
  /** 已作答(選擇題選了選項、輸入題送出) */
  answered: boolean;
  correct: boolean;
}

export interface DrillResultItem {
  question: DrillQuestion;
  correct: boolean;
  /**
   * 作答內容(選擇題為所選選項的 ruby,只差讀音的選項才分得出來;輸入題為輸入的單一段);
   * 錯題列表顯示
   */
  given: RubySeg[];
}

/** 進行中(或已完成)的一回合 */
export interface DrillRound {
  questions: DrillQuestion[];
  index: number;
  answer: DrillAnswer;
  results: DrillResultItem[];
  done: boolean;
}

/** 頁面狀態:範圍、取消勾選的形(`${group}:${form}`)與回合;回合為 null = 設定畫面 */
export interface DrillState {
  maxLesson: number;
  /** 範圍的來源:網址 ?upto=、已有卡片的最大課號、沒有卡片時的預設值、讀取失敗、使用者調整 */
  source: "upto" | "cards" | "default" | "fallback" | "manual";
  excluded: readonly string[];
  round: DrillRound | null;
}

export const EMPTY_ANSWER: DrillAnswer = {
  selectedId: null,
  input: "",
  answered: false,
  correct: false,
};

/**
 * 本次 app 生命週期內的練習狀態(只在記憶體):離開後回到 /drill 時接續進行中的回合;
 * 從回饋或結果頁的「看文法」連結返回則接續原畫面(含結果頁)。不寫入 DB 或 storage,重新整理即清空。
 */
let saved: DrillState | null = null;
/**
 * 經「看文法」連結離開本頁,且之後畫面沒有變動。掛載時只讀不清(StrictMode 重跑 effect 結果一致),
 * 畫面一有變動(存入不同的狀態)即清除。
 */
let leftForGrammar = false;

export function loadDrillState(): DrillState | null {
  return saved;
}

export function saveDrillState(state: DrillState): void {
  if (state !== saved) leftForGrammar = false;
  saved = state;
}

/** 「看文法」連結的 onClick:返回時接續原畫面 */
export function markLeftForGrammar(): void {
  leftForGrammar = true;
}

/** 是否從「看文法」連結返回(離開後畫面沒有變動) */
export function returningFromGrammar(): boolean {
  return leftForGrammar;
}

/** 測試用:清空記憶體中的練習狀態 */
export function clearDrillState(): void {
  saved = null;
  leftForGrammar = false;
}
