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

function newCardRow(cardId: string, lessonId: number, now: Date): CardRow {
  const c = createEmptyCard(now);
  return {
    cardId,
    lessonId,
    type: "vocab",
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
 */
export async function addCards(
  vocabIds: string[],
  lessonId: number,
  now: number = Date.now(),
): Promise<void> {
  if (vocabIds.length === 0) return;
  await db.transaction("rw", db.cards, async () => {
    const existing = new Set(
      await db.cards.where("cardId").anyOf(vocabIds).primaryKeys(),
    );
    const toAdd = vocabIds
      .filter((id) => !existing.has(id))
      .map((id) => newCardRow(id, lessonId, new Date(now)));
    if (toAdd.length > 0) await db.cards.bulkAdd(toAdd);
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
