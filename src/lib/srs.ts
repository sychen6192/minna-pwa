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
import { baseVocabId, cardDirection, REVERSE_SUFFIX } from "@/lib/cardId";
import { db, getAllSettings, type CardRow, type LogRow } from "@/lib/db";
import { MATURE_STABILITY } from "@/lib/stats";
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

// 卡片 id / 方向工具定義於 cardId.ts(不依賴 ts-fsrs,供 stats 等共用),此處轉匯出
export { baseVocabId, cardDirection, REVERSE_SUFFIX };

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
 * 新建某字的回想卡(`@r`);「已會」以字為單位,正向卡已暫停者回想卡一併暫停(T10.3)。
 */
function newReverseRow(
  fwd: CardRow | undefined,
  vocabId: string,
  lessonId: number,
  at: Date,
): CardRow {
  const row = newCardRow(`${vocabId}${REVERSE_SUFFIX}`, lessonId, at, "rev");
  return fwd?.suspended === true ? { ...row, suspended: true } : row;
}

/**
 * 將單字加入複習(冪等):已存在的 cardId 不重複建立、不重置進度。
 * `reverseCards` 設定開啟時,同時建立義→日回想方向卡(cardId 加 `@r`,繼承正向卡的暫停狀態)。
 * 回傳實際新建的正向卡數(= 新加入的字數;補建的 `@r` 不計),供「已加入 N 字」回饋(T10.11)。
 */
export async function addCards(
  vocabIds: string[],
  lessonId: number,
  now: number = Date.now(),
): Promise<number> {
  if (vocabIds.length === 0) return 0;
  const { reverseCards } = await getAllSettings();
  return db.transaction("rw", db.cards, async () => {
    const wanted = reverseCards
      ? [...vocabIds, ...vocabIds.map((id) => `${id}${REVERSE_SUFFIX}`)]
      : vocabIds;
    const existing = new Map(
      (await db.cards.where("cardId").anyOf(wanted).toArray()).map((c) => [c.cardId, c]),
    );
    const at = new Date(now);
    const toAdd: CardRow[] = [];
    for (const id of new Set(vocabIds)) {
      if (!existing.has(id)) toAdd.push(newCardRow(id, lessonId, at));
    }
    const created = toAdd.length;
    if (reverseCards) {
      for (const id of new Set(vocabIds)) {
        if (!existing.has(`${id}${REVERSE_SUFFIX}`)) {
          toAdd.push(newReverseRow(existing.get(id), id, lessonId, at));
        }
      }
    }
    if (toAdd.length > 0) await db.cards.bulkAdd(toAdd);
    return created;
  });
}

/**
 * 為所有既有的正向卡補上回想方向卡(冪等;繼承正向卡的暫停狀態)。用於使用者中途開啟
 * `reverseCards` 時,讓設定立即對已加入的字生效。回傳新建立的回想卡數量。
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
      .map((c) => newReverseRow(c, c.cardId, c.lessonId, at));
    if (toAdd.length > 0) await db.cards.bulkAdd(toAdd);
    return toAdd.length;
  });
}

/** requeueWrong 的結果:每個字只歸入一類(優先序同欄位順序)。 */
export interface RequeueResult {
  /** 原本未加入複習、新建卡片的字數(新卡,依每日新卡額度出現) */
  created: number;
  /** 今日已評過、受兄弟卡 bury 今日不再出的字數:未到期的卡提前到下一學習日開始(含同時恢復暫停者) */
  tomorrow: number;
  /** 由「已會/暫停」恢復的字數 */
  unsuspended: number;
  /** 原本就有卡今日到期(已在今日佇列)的字數;另一方向未到期的卡仍照規則提前 */
  alreadyDue: number;
  /** 原本未到期、due 提前到現在(今日佇列)的字數 */
  requeued: number;
  /** 仍是待學新卡、未變動的字數(依每日新卡額度與教材順序引入,不一定今天出現) */
  pendingNew: number;
}

/**
 * 測驗錯題加入複習(T10.4)。同一 transaction 內以字為單位處理:
 * - 尚無正向卡 → 照 addCards 建立(`reverseCards` 開啟時含 `@r`);已有正向卡而缺 `@r` 者一併補建。
 * - 已暫停(已會)→ 正向與 `@r` 一併恢復(同 setWordSuspended);新建的 `@r` 因此也不暫停。
 * - 已學過(state≠New)且今日未到期(`due ≥ nextStudyDayStart(now)`)的卡 → `due` 提前到 now。
 *   不寫 log、不動 stability/difficulty/lastReview:下次評分時 ts-fsrs 以距 lastReview 的
 *   實際天數計算,等同提前複習;提前的卡佔今日複習額度。
 * - 今日已評過的字受兄弟卡 bury(planQueue)今日不會再出:未到期的卡改提前到下一學習日開始,
 *   歸入 `tomorrow`,結果頁據此如實顯示。
 * - 分類看「這個字何時會出現」:原本就有卡今日到期者歸 alreadyDue(即使另一方向被提前);
 *   只有新卡者歸 pendingNew(受每日新卡額度限制,不宣稱已在今日佇列)。
 * 冪等:再呼叫一次時,已提前者歸入 alreadyDue(今日已評者仍為 tomorrow)。
 */
export async function requeueWrong(
  vocabIds: string[],
  lessonId: number,
  now: number = Date.now(),
): Promise<RequeueResult> {
  const result: RequeueResult = {
    created: 0,
    tomorrow: 0,
    unsuspended: 0,
    alreadyDue: 0,
    requeued: 0,
    pendingNew: 0,
  };
  const words = [...new Set(vocabIds.map(baseVocabId))];
  if (words.length === 0) return result;
  const { reverseCards } = await getAllSettings();
  const dayEnd = nextStudyDayStart(now);

  await db.transaction("rw", db.cards, db.logs, async () => {
    const existing = new Map(
      (
        await db.cards
          .where("cardId")
          .anyOf(words.flatMap((id) => [id, `${id}${REVERSE_SUFFIX}`]))
          .toArray()
      ).map((c) => [c.cardId, c]),
    );
    const reviewedToday = new Set(
      (
        await db.logs
          .where("reviewedAt")
          .between(studyDayStart(now), dayEnd, true, false)
          .toArray()
      ).map((l) => baseVocabId(l.cardId)),
    );
    const at = new Date(now);
    const toPut: CardRow[] = [];

    for (const id of words) {
      const revId = `${id}${REVERSE_SUFFIX}`;
      const buried = reviewedToday.has(id);
      const target = buried ? dayEnd : now;
      const own = [existing.get(id), existing.get(revId)].filter(
        (c): c is CardRow => c !== undefined,
      );
      // 已會以字為單位:任一方向暫停即兩個方向一併恢復
      const wasSuspended = own.some((c) => c.suspended === true);
      // 寫入前已有學過的卡今日到期:這個字本來就在今日佇列
      const dueToday = own.some((c) => c.state !== State.New && c.due < dayEnd);
      let moved = false;
      const updated = new Map<string, CardRow>();
      for (const c of own) {
        const move = c.state !== State.New && c.due >= dayEnd && c.due !== target;
        if (!wasSuspended && !move) continue;
        const row: CardRow = { ...c };
        if (wasSuspended) row.suspended = false;
        if (move) {
          row.due = target;
          moved = true;
        }
        updated.set(row.cardId, row);
      }
      toPut.push(...updated.values());

      const prevFwd = existing.get(id);
      const fwd = updated.get(id) ?? prevFwd ?? newCardRow(id, lessonId, at);
      if (!prevFwd) toPut.push(fwd);
      if (reverseCards && !existing.has(revId)) {
        toPut.push(newReverseRow(fwd, id, lessonId, at));
      }

      if (!prevFwd) result.created++;
      else if (buried) result.tomorrow++;
      else if (wasSuspended) result.unsuspended++;
      else if (dueToday) result.alreadyDue++;
      else if (moved) result.requeued++;
      else result.pendingNew++;
    }
    if (toPut.length > 0) await db.cards.bulkPut(toPut);
  });
  return result;
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

/**
 * 以字為單位標記「已會/暫停」或恢復(T10.3):同時作用於正向卡與 `@r` 回想卡(存在者);
 * 暫停的卡不再進入複習佇列。`vocabId` 傳入回想卡 id 亦可(取 baseVocabId)。
 */
export async function setWordSuspended(vocabId: string, suspended: boolean): Promise<void> {
  const base = baseVocabId(vocabId);
  await db.cards
    .where("cardId")
    .anyOf([base, `${base}${REVERSE_SUFFIX}`])
    .modify({ suspended });
}

/**
 * 「已會」的字數:以字為單位(T10.3),任一方向的卡暫停即算、雙向卡不重複計
 * (與 suspendedWordIds 一致)。
 */
export async function countSuspended(): Promise<number> {
  const rows = await db.cards.filter((c) => c.suspended === true).toArray();
  return new Set(rows.map((c) => baseVocabId(c.cardId))).size;
}

/**
 * 回傳 `vocabIds` 中「已會」的字(任一方向的卡暫停即算;課程頁標示用)。
 * 舊資料可能只暫停了單一方向,恢復時 setWordSuspended 會一併恢復兩個方向。
 */
export async function suspendedWordIds(vocabIds: string[]): Promise<string[]> {
  if (vocabIds.length === 0) return [];
  const ids = [...vocabIds, ...vocabIds.map((id) => `${id}${REVERSE_SUFFIX}`)];
  const rows = await db.cards.where("cardId").anyOf(ids).toArray();
  const suspended = new Set(
    rows.filter((c) => c.suspended === true).map((c) => baseVocabId(c.cardId)),
  );
  return vocabIds.filter((id) => suspended.has(id));
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

/**
 * 是否為頑固卡:複習階段已遺忘達門檻次數,且尚未成熟。`lapses` 只增不減,故以
 * stability ≥ MATURE_STABILITY(已成熟)視為已克服而解除;之後再遺忘、stability 掉回
 * 門檻下即再次列入。
 */
export function isLeech(card: CardRow): boolean {
  return card.lapses >= LEECH_THRESHOLD && card.stability < MATURE_STABILITY;
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

export interface RateResult {
  /** 評分後的卡片 */
  card: CardRow;
  /** 評分前的卡片(undoRate 還原用) */
  prev: CardRow;
  /** 此次評分寫入的 log id(undoRate 刪除用) */
  logId: number;
}

/**
 * 評分:更新卡片 FSRS 狀態並寫入複習紀錄(log)。回傳更新後的卡片與復原所需的
 * 評分前快照、log id(見 undoRate)。
 */
export async function rate(
  cardId: string,
  rating: ReviewRating,
  now: number = Date.now(),
): Promise<RateResult> {
  const scheduler = await getScheduler();
  return db.transaction("rw", db.cards, db.logs, async () => {
    const prev = await db.cards.get(cardId);
    if (!prev) throw new Error(`找不到卡片:${cardId}`);
    const { card, log } = scheduler.next(
      toFsrsCard(prev),
      new Date(toFsrsTime(now)),
      rating as Grade,
    );
    const updated = applyFsrsCard(prev, card, now);
    await db.cards.put(updated);
    const logId = await db.logs.add(toLogRow(prev, log, now));
    return { card: updated, prev, logId };
  });
}

/**
 * 復原一次評分(T10.3):同一 transaction 內放回評分前的卡片、刪除該筆 log。
 * 今日上限由 logs 計算(planQueue),刪 log 後額度隨之回復。以快照還原,不經 ts-fsrs。
 */
export async function undoRate({
  prev,
  logId,
}: Pick<RateResult, "prev" | "logId">): Promise<void> {
  await db.transaction("rw", db.cards, db.logs, async () => {
    await db.cards.put(prev);
    await db.logs.delete(logId);
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
