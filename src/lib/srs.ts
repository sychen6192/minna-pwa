import {
  createEmptyCard,
  fsrs,
  GenSeedStrategyWithCardId,
  Rating,
  State,
  StrategyMode,
  type Card,
  type FSRS,
  type Grade,
  type ReviewLog,
} from "ts-fsrs";
import { db, getAllSettings, type CardRow, type LogRow } from "@/lib/db";
import {
  addStudyDays,
  fromFsrsTime,
  nextStudyDayStart,
  studyDayStart,
  toFsrsTime,
} from "@/lib/studyDay";

/** 評分:Again / Hard / Good / Easy(對齊 ts-fsrs Rating 1–4) */
export type ReviewRating = 1 | 2 | 3 | 4;

/** 餵給 ts-fsrs 的 fuzz 種子欄位(toFsrsCard 帶入 = cardId)。 */
const SEED_FIELD = "card_id";

/**
 * - short-term off → 純以「天」排程,CardRow 不需持久化 learning_steps
 * - fuzz on → 評分歷史相同的卡(含雙向兄弟卡)不再同日成團到期。ts-fsrs 只對 ≥ 2.5 天的
 *   間隔加 fuzz:預設保留率 0.9 下新卡首評(Good 為 3 天)不受影響,之後的複習才錯開;
 *   兄弟卡同日不出由 planQueue 的 bury 保證。
 *   種子 = card_id + reps(GenSeedStrategyWithCardId,與評分時刻無關),故同一張卡的
 *   previewIntervals 與 rate 得到相同的 fuzz:預估即實際。fuzz 後間隔仍為整數天。
 * request_retention(目標保留率)由 `desiredRetention` 設定決定(T9.4)。
 */
function buildScheduler(requestRetention: number, fuzz: boolean): FSRS {
  return fsrs({
    enable_short_term: false,
    enable_fuzz: fuzz,
    request_retention: requestRetention,
  }).useStrategy(StrategyMode.SEED, GenSeedStrategyWithCardId(SEED_FIELD));
}

let fuzzEnabled = true;

// 依保留率(與 fuzz 開關)快取 scheduler,避免每次評分重建
let schedulerCache: { retention: number; fuzz: boolean; instance: FSRS } | null = null;

/** 測試專用:關閉 fuzz 以取得確定的間隔(正式程式碼不呼叫)。回傳先前的設定。 */
export function setFuzzForTesting(enabled: boolean): boolean {
  const prev = fuzzEnabled;
  fuzzEnabled = enabled;
  schedulerCache = null;
  return prev;
}

async function getScheduler(): Promise<FSRS> {
  const { desiredRetention } = await getAllSettings();
  if (
    !schedulerCache ||
    schedulerCache.retention !== desiredRetention ||
    schedulerCache.fuzz !== fuzzEnabled
  ) {
    schedulerCache = {
      retention: desiredRetention,
      fuzz: fuzzEnabled,
      instance: buildScheduler(desiredRetention, fuzzEnabled),
    };
  }
  return schedulerCache.instance;
}

// ── CardRow ↔ ts-fsrs Card 轉換 ─────────────────────────────────────
// 餵入 ts-fsrs 的時間(now、due、last_review)一律先經 toFsrsTime 平移成「UTC 日 = 本地
// 學習日」,輸出再以同一次呼叫的 now 為基準經 fromFsrsTime 換回(studyDay.ts)。
// DB 內永遠是真實時刻(DATA_MODEL §4-5)。

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

/** ts-fsrs Card + fuzz 種子欄位(TypeConvert.card 以 spread 複製,額外欄位會保留)。 */
type SeededCard = Card & { [SEED_FIELD]: string };

function toFsrsCard(row: CardRow): SeededCard {
  return {
    [SEED_FIELD]: row.cardId,
    due: new Date(toFsrsTime(row.due)),
    stability: row.stability,
    difficulty: row.difficulty,
    elapsed_days: 0, // deprecated,FSRS 內部以 last_review 重算
    scheduled_days: 0, // short-term 關閉,長期排程不需此輸入
    learning_steps: 0,
    reps: row.reps,
    lapses: row.lapses,
    state: row.state as State,
    last_review:
      row.lastReview !== undefined
        ? new Date(toFsrsTime(row.lastReview))
        : undefined,
  };
}

/** 套用 ts-fsrs 輸出(平移時間)並換回真實時刻;`now` 為該次評分的真實時刻。 */
function applyFsrsCard(row: CardRow, card: Card, now: number): CardRow {
  return {
    ...row,
    due: fromFsrsTime(card.due.getTime(), now),
    stability: card.stability,
    difficulty: card.difficulty,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state as CardRow["state"],
    lastReview: card.last_review
      ? fromFsrsTime(card.last_review.getTime(), now)
      : undefined,
  };
}

/**
 * ts-fsrs ReviewLog → LogRow。時間欄位取真實值:`due` 為卡片評分前的 due
 * (ts-fsrs 的 log.due 是平移後的 last_review ?? due),`reviewedAt` 為評分時刻。
 */
function toLogRow(prev: CardRow, log: ReviewLog, now: number): LogRow {
  return {
    cardId: prev.cardId,
    rating: log.rating as LogRow["rating"],
    state: log.state as LogRow["state"],
    due: prev.due,
    elapsedDays: log.elapsed_days,
    reviewedAt: now,
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

export interface QueueCounts {
  /** 今日佇列中的到期(複習)卡數 */
  due: number;
  /** 今日佇列中的新卡數 */
  fresh: number;
  /**
   * 今日新卡額度已用完,且仍有新卡等到明天(因額度延後,或因兄弟卡 bury 延後的 `@r`)。
   * `newPerDay` 為 0 時亦為 true(頁面另給文案)。
   */
  newCapReached: boolean;
  /** 今日可引入、但因額度用完而延到明天的新卡數(調高 newPerDay 今日即可引入;不含 bury 者) */
  newCapped: number;
  /** 今日剩餘新卡額度(尚未首評者;佇列中的新卡仍計在內) */
  newRemaining: number;
  /** 今日已首評的相異新卡數 */
  newToday: number;
  /** 每日新卡上限(設定值) */
  newPerDay: number;
  /** 今日複習額度已用完,且仍有到期卡等到明天 */
  reviewCapReached: boolean;
}

/** 今日佇列的組成(buildQueue 與 queueCounts 共用 planQueue,數字與實際佇列一致)。 */
interface QueuePlan extends Omit<QueueCounts, "due" | "fresh"> {
  due: CardRow[];
  fresh: CardRow[];
}

/**
 * 今日佇列(DATA_MODEL §4-5、SPEC F2.1):
 * - 到期卡:state≠New、未暫停、`due < nextStudyDayStart(now)`(按日,含逾期),依 due 由舊到新;
 *   額度 = maxReviewsPerDay − 今日已複習筆數(評分前 state≠New 的 log;首評不佔複習額度)。
 * - 新卡:state=New、未暫停,依 cardId(= 教材順序);額度 = newPerDay − 今日首評的相異新卡數
 *   (log.state 為評分前狀態,state=New 即首評)。上限以學習日計,重開頁面不會再發新額度。
 * - 兄弟卡 bury:同一字(baseVocabId)今日已評過或已入列者,另一方向今日不再入列(仍保持
 *   到期,下一學習日才出)。New 的 `@r` 卡須正向卡已非 New 且今日未評(首評不在今日);
 *   正向新卡先填滿額度,剩餘才給 `@r`。
 */
async function planQueue(now: number): Promise<QueuePlan> {
  const { newPerDay, maxReviewsPerDay } = await getAllSettings();
  const dayEnd = nextStudyDayStart(now);

  const todayLogs = await db.logs
    .where("reviewedAt")
    .between(studyDayStart(now), dayEnd, true, false)
    .toArray();
  const newToday = new Set(
    todayLogs.filter((l) => l.state === State.New).map((l) => l.cardId),
  ).size;
  const reviewsToday = todayLogs.filter((l) => l.state !== State.New).length;
  const newRemaining = Math.max(0, newPerDay - newToday);
  const reviewRemaining = Math.max(0, maxReviewsPerDay - reviewsToday);

  // 今日已評過或已入列的字(bury 依據)
  const seen = new Set(todayLogs.map((l) => baseVocabId(l.cardId)));

  const dueCandidates = (await db.cards.where("due").below(dayEnd).toArray())
    .filter((c) => c.state !== State.New && !c.suspended)
    .sort((a, b) => a.due - b.due || a.cardId.localeCompare(b.cardId));
  const due: CardRow[] = [];
  let reviewCapReached = false;
  for (const c of dueCandidates) {
    const base = baseVocabId(c.cardId);
    if (seen.has(base)) continue;
    if (due.length >= reviewRemaining) {
      reviewCapReached = true; // 尚有未 bury 的到期卡因額度等到明天
      break;
    }
    seen.add(base);
    due.push(c);
  }

  const newCards = (await db.cards.where("state").equals(State.New).toArray())
    .filter((c) => !c.suspended)
    .sort((a, b) => a.cardId.localeCompare(b.cardId));
  const fwdNew = newCards.filter((c) => cardDirection(c) === "fwd");
  const revNew = newCards.filter((c) => cardDirection(c) === "rev");
  const revSiblings = await db.cards.bulkGet(revNew.map((c) => baseVocabId(c.cardId)));
  // 正向卡仍為 New 的 @r 卡不可入選(正向卡首評若在今日,已由 seen 擋下)
  const revEligible = revNew.filter((_, i) => {
    const fwd = revSiblings[i];
    return fwd !== undefined && fwd.state !== State.New;
  });

  const fresh: CardRow[] = [];
  let newCapped = 0;
  let newBuried = 0;
  for (const c of [...fwdNew, ...revEligible]) {
    const base = baseVocabId(c.cardId);
    if (seen.has(base)) {
      newBuried++;
      continue;
    }
    if (fresh.length >= newRemaining) {
      newCapped++;
      continue;
    }
    seen.add(base);
    fresh.push(c);
  }

  return {
    due,
    fresh,
    newCapReached: newRemaining === 0 && newCapped + newBuried > 0,
    newCapped,
    newRemaining,
    newToday,
    newPerDay,
    reviewCapReached,
  };
}

/** 今日佇列:到期卡(依 due)在前、新卡(正向先、`@r` 後)在後。規則見 planQueue。 */
export async function buildQueue(now: number = Date.now()): Promise<CardRow[]> {
  const { due, fresh } = await planQueue(now);
  return [...due, ...fresh];
}

/** 今日佇列的張數摘要(首頁 Hero、複習頁空狀態);與 buildQueue 同一計算。 */
export async function queueCounts(now: number = Date.now()): Promise<QueueCounts> {
  const plan = await planQueue(now);
  return { ...plan, due: plan.due.length, fresh: plan.fresh.length };
}

/** 是否已加入任何卡片(含暫停卡)。用於區分「尚未加入單字」與「今日完成」。 */
export async function hasAnyCards(): Promise<boolean> {
  return (await db.cards.count()) > 0;
}

/** 標記卡片「已會/暫停」或恢復;暫停的卡不再進入複習佇列。 */
export async function setSuspended(cardId: string, suspended: boolean): Promise<void> {
  await db.cards.update(cardId, { suspended });
}

/** 「已會/暫停」卡數量。 */
export function countSuspended(): Promise<number> {
  return db.cards.filter((c) => c.suspended === true).count();
}

/** 回傳 `cardIds` 中處於暫停狀態的子集(課程頁標示用)。 */
export async function suspendedCardIds(cardIds: string[]): Promise<string[]> {
  if (cardIds.length === 0) return [];
  const rows = await db.cards.where("cardId").anyOf(cardIds).toArray();
  return rows.filter((c) => c.suspended === true).map((c) => c.cardId);
}

/**
 * 回傳 `vocabIds` 中已加入複習(已建立卡片)的 id 子集。
 * 用於課程頁標示「已加入」狀態。
 */
export async function existingCardIds(vocabIds: string[]): Promise<string[]> {
  if (vocabIds.length === 0) return [];
  return db.cards.where("cardId").anyOf(vocabIds).primaryKeys();
}

/** 在 `end`(epoch ms,不含)之前到期的複習卡數(state≠New、排除暫停)。 */
function countDueBefore(end: number): Promise<number> {
  return db.cards
    .where("due")
    .below(end)
    .filter((c) => c.state !== State.New && !c.suspended)
    .count();
}

/**
 * 今日(`now` 所屬學習日)到期的複習卡數:`due < nextStudyDayStart(now)`,含逾期;
 * 不含新卡、暫停卡,也不套 maxReviewsPerDay 上限。與 buildQueue 的到期判定一致。
 */
export function countDue(now: number): Promise<number> {
  return countDueBefore(nextStudyDayStart(now));
}

/**
 * 到明日學習日結束前到期的複習卡數(今日未完成者 + 明日到期者)。
 * 用於複習頁空狀態/結算頁的「明日到期」預估。
 */
export function countDueByTomorrow(now: number): Promise<number> {
  return countDueBefore(addStudyDays(now, 2));
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

/** 頑固卡數量(`lapses` 未建索引,以 filter 全掃;個人資料量無虞;排除已暫停)。 */
export function countLeeches(): Promise<number> {
  return db.cards.filter((c) => isLeech(c) && !c.suspended).count();
}

/** 取得所有頑固卡(排除已暫停),依 lapses 由多到少(最卡的排前面)。 */
export async function getLeeches(): Promise<CardRow[]> {
  const rows = await db.cards.filter((c) => isLeech(c) && !c.suspended).toArray();
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
  const scheduler = await getScheduler();
  return db.transaction("rw", db.cards, db.logs, async () => {
    const row = await db.cards.get(cardId);
    if (!row) throw new Error(`找不到卡片:${cardId}`);
    const { card, log } = scheduler.next(
      toFsrsCard(row),
      new Date(toFsrsTime(now)),
      rating as Grade,
    );
    const updated = applyFsrsCard(row, card, now);
    await db.cards.put(updated);
    await db.logs.add(toLogRow(row, log, now));
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
 * 時間平移與 rate() 相同,同一 now 下預估的 due 即實際套用的 due。
 */
export async function previewIntervals(
  cardId: string,
  now: number = Date.now(),
): Promise<IntervalPreviews> {
  const row = await db.cards.get(cardId);
  if (!row) throw new Error(`找不到卡片:${cardId}`);
  const scheduler = await getScheduler();
  const preview = scheduler.repeat(
    toFsrsCard(row),
    new Date(toFsrsTime(now)),
  );
  const pick = (g: Grade): RatingPreview => ({
    due: fromFsrsTime(preview[g].card.due.getTime(), now),
    days: preview[g].card.scheduled_days,
  });
  return {
    again: pick(Rating.Again),
    hard: pick(Rating.Hard),
    good: pick(Rating.Good),
    easy: pick(Rating.Easy),
  };
}
