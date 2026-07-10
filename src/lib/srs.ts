import {
  createEmptyCard,
  fsrs,
  Rating,
  State,
  type Card,
  type FSRS,
  type Grade,
  type ReviewLog,
} from "ts-fsrs";
import { db, getAllSettings, type CardRow, type LogRow } from "@/lib/db";

/** 評分:Again / Hard / Good / Easy(對齊 ts-fsrs Rating 1–4) */
export type ReviewRating = 1 | 2 | 3 | 4;

/**
 * 關閉 short-term(intra-day learning steps)與 fuzz:
 * - short-term off → 純以「天」排程,CardRow 不需持久化 learning_steps
 * - fuzz off → 排程確定,利於測試與穩定預估
 */
const scheduler: FSRS = fsrs({
  enable_short_term: false,
  enable_fuzz: false,
});

// ── CardRow ↔ ts-fsrs Card 轉換 ─────────────────────────────────────

/** 回想方向卡的 cardId 尾綴(義→日,T9.2) */
export const REVERSE_SUFFIX = "@r";

/** 由 cardId 取回原單字 id(去除回想卡尾綴)。 */
export function baseVocabId(cardId: string): string {
  return cardId.endsWith(REVERSE_SUFFIX)
    ? cardId.slice(0, -REVERSE_SUFFIX.length)
    : cardId;
}

/** 卡片方向(缺省視為 fwd,相容舊資料)。 */
export function cardDirection(card: CardRow): "fwd" | "rev" {
  return card.direction ?? "fwd";
}

function newCardRow(
  cardId: string,
  lessonId: number,
  now: Date,
  direction: "fwd" | "rev" = "fwd",
): CardRow {
  const c = createEmptyCard(now);
  return {
    cardId,
    lessonId,
    type: "vocab",
    direction,
    due: c.due.getTime(),
    stability: c.stability,
    difficulty: c.difficulty,
    reps: c.reps,
    lapses: c.lapses,
    state: c.state as CardRow["state"],
    lastReview: c.last_review?.getTime(),
  };
}

function toFsrsCard(row: CardRow): Card {
  return {
    due: new Date(row.due),
    stability: row.stability,
    difficulty: row.difficulty,
    elapsed_days: 0, // deprecated,FSRS 內部以 last_review 重算
    scheduled_days: 0, // short-term 關閉,長期排程不需此輸入
    learning_steps: 0,
    reps: row.reps,
    lapses: row.lapses,
    state: row.state as State,
    last_review:
      row.lastReview !== undefined ? new Date(row.lastReview) : undefined,
  };
}

function applyFsrsCard(row: CardRow, card: Card): CardRow {
  return {
    ...row,
    due: card.due.getTime(),
    stability: card.stability,
    difficulty: card.difficulty,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state as CardRow["state"],
    lastReview: card.last_review?.getTime(),
  };
}

function toLogRow(cardId: string, log: ReviewLog): LogRow {
  return {
    cardId,
    rating: log.rating as LogRow["rating"],
    state: log.state as LogRow["state"],
    due: log.due.getTime(),
    elapsedDays: log.elapsed_days,
    reviewedAt: log.review.getTime(),
  };
}

// ── 公開 API ────────────────────────────────────────────────────────

/**
 * 將單字加入複習(冪等):已存在的 cardId 不重複建立、不重置進度。
 * `reverseCards` 設定開啟時,同時建立義→日回想方向卡(cardId 加 `@r`)。
 */
export async function addCards(
  vocabIds: string[],
  lessonId: number,
  now: number = Date.now(),
): Promise<void> {
  if (vocabIds.length === 0) return;
  const { reverseCards } = await getAllSettings();
  await db.transaction("rw", db.cards, async () => {
    const wanted: { id: string; dir: "fwd" | "rev" }[] = vocabIds.map((id) => ({
      id,
      dir: "fwd" as const,
    }));
    if (reverseCards) {
      for (const id of vocabIds) wanted.push({ id: `${id}${REVERSE_SUFFIX}`, dir: "rev" });
    }
    const existing = new Set(
      await db.cards.where("cardId").anyOf(wanted.map((w) => w.id)).primaryKeys(),
    );
    const at = new Date(now);
    const toAdd = wanted
      .filter((w) => !existing.has(w.id))
      .map((w) => newCardRow(w.id, lessonId, at, w.dir));
    if (toAdd.length > 0) await db.cards.bulkAdd(toAdd);
  });
}

/**
 * 為所有既有的正向卡補上回想方向卡(冪等)。用於使用者中途開啟 `reverseCards` 時,
 * 讓設定立即對已加入的字生效。回傳新建立的回想卡數量。
 */
export async function ensureReverseCards(now: number = Date.now()): Promise<number> {
  return db.transaction("rw", db.cards, async () => {
    const all = await db.cards.toArray();
    const existingIds = new Set(all.map((c) => c.cardId));
    const at = new Date(now);
    const toAdd = all
      .filter(
        (c) =>
          cardDirection(c) === "fwd" &&
          !existingIds.has(`${c.cardId}${REVERSE_SUFFIX}`),
      )
      .map((c) => newCardRow(`${c.cardId}${REVERSE_SUFFIX}`, c.lessonId, at, "rev"));
    if (toAdd.length > 0) await db.cards.bulkAdd(toAdd);
    return toAdd.length;
  });
}

/**
 * 今日佇列 = 到期卡(state≠New 且 due≤now,受 maxReviewsPerDay)
 *           + 新卡(state=New,受 newPerDay)。
 * 到期卡依 due 由舊到新;新卡依 cardId(= 教材順序)。
 */
export async function buildQueue(now: number = Date.now()): Promise<CardRow[]> {
  const { newPerDay, maxReviewsPerDay } = await getAllSettings();

  const dueCards = (await db.cards.where("due").belowOrEqual(now).toArray())
    .filter((c) => c.state !== State.New)
    .sort((a, b) => a.due - b.due)
    .slice(0, maxReviewsPerDay);

  const newCards = (await db.cards.where("state").equals(State.New).toArray())
    .sort((a, b) => a.cardId.localeCompare(b.cardId))
    .slice(0, newPerDay);

  return [...dueCards, ...newCards];
}

/**
 * 回傳 `vocabIds` 中已加入複習(已建立卡片)的 id 子集。
 * 用於課程頁標示「已加入」狀態。
 */
export async function existingCardIds(vocabIds: string[]): Promise<string[]> {
  if (vocabIds.length === 0) return [];
  return db.cards.where("cardId").anyOf(vocabIds).primaryKeys();
}

/**
 * 計算在 `at`(epoch ms)前到期的複習卡數量(state≠New)。
 * 用於結算頁的「明日到期預估」等統計。
 */
export async function countDue(at: number): Promise<number> {
  return db.cards
    .where("due")
    .belowOrEqual(at)
    .filter((c) => c.state !== State.New)
    .count();
}

/**
 * 頑固卡(leech)門檻:`lapses`(Review 階段遺忘次數,按「重來」累計)達此值即視為
 * 頑固卡。對標 Anki 的 leech 機制(預設 8);個人學習取較敏感的 4 以便及早加強。
 */
export const LEECH_THRESHOLD = 4;

/** 是否為頑固卡:複習階段已遺忘達門檻次數。 */
export function isLeech(card: CardRow): boolean {
  return card.lapses >= LEECH_THRESHOLD;
}

/** 頑固卡數量(`lapses` 未建索引,以 filter 全掃;個人資料量無虞)。 */
export function countLeeches(): Promise<number> {
  return db.cards.filter(isLeech).count();
}

/** 取得所有頑固卡,依 lapses 由多到少(最卡的排前面)。 */
export async function getLeeches(): Promise<CardRow[]> {
  const rows = await db.cards.filter(isLeech).toArray();
  return rows.sort((a, b) => b.lapses - a.lapses);
}

/**
 * 評分:更新卡片 FSRS 狀態並寫入複習紀錄(log)。回傳更新後的卡片。
 */
export async function rate(
  cardId: string,
  rating: ReviewRating,
  now: number = Date.now(),
): Promise<CardRow> {
  return db.transaction("rw", db.cards, db.logs, async () => {
    const row = await db.cards.get(cardId);
    if (!row) throw new Error(`找不到卡片:${cardId}`);
    const { card, log } = scheduler.next(
      toFsrsCard(row),
      new Date(now),
      rating as Grade,
    );
    const updated = applyFsrsCard(row, card);
    await db.cards.put(updated);
    await db.logs.add(toLogRow(cardId, log));
    return updated;
  });
}

export interface RatingPreview {
  /** 評分後的下次到期(epoch ms) */
  due: number;
  /** 排程間隔(天) */
  days: number;
}

export type IntervalPreviews = {
  [R in "again" | "hard" | "good" | "easy"]: RatingPreview;
};

/**
 * 四鍵預估間隔(不寫入任何資料)。卡片不存在則丟錯。
 */
export async function previewIntervals(
  cardId: string,
  now: number = Date.now(),
): Promise<IntervalPreviews> {
  const row = await db.cards.get(cardId);
  if (!row) throw new Error(`找不到卡片:${cardId}`);
  const preview = scheduler.repeat(toFsrsCard(row), new Date(now));
  const pick = (g: Grade): RatingPreview => ({
    due: preview[g].card.due.getTime(),
    days: preview[g].card.scheduled_days,
  });
  return {
    again: pick(Rating.Again),
    hard: pick(Rating.Hard),
    good: pick(Rating.Good),
    easy: pick(Rating.Easy),
  };
}
