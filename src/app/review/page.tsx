"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { PitchAccent } from "@/components/PitchAccent";
import { RatingButtons } from "@/components/RatingButtons";
import { RubyText, type FuriganaMode } from "@/components/RubyText";
import { SpeakButton } from "@/components/SpeakButton";
import { getLesson } from "@/lib/content";
import { findExampleSentence } from "@/lib/examples";
import { db, getSetting, type CardRow } from "@/lib/db";
import { jaLang } from "@/lib/lang";
import { displayNote } from "@/lib/notes";
import { isKanaSurface, kanaHeadword } from "@/lib/pitch";
import { canRelearnAgain, insertRelearn } from "@/lib/relearn";
import {
  baseVocabId,
  buildQueue,
  cardDirection,
  countDueByTomorrow,
  hasAnyCards,
  previewIntervals,
  queueCounts,
  rate,
  setWordSuspended,
  undoRate,
  type IntervalPreviews,
  type QueueCounts,
  type RateResult,
  type ReviewRating,
} from "@/lib/srs";
import { computeStreak, effectiveGoal, reviewsToday, type GoalProgress } from "@/lib/stats";
import { studyDayKey } from "@/lib/studyDay";
import { speechText } from "@/lib/tts";
import { useTtsEnabled } from "@/lib/useSetting";
import { cn } from "@/lib/utils";
import type { Lesson, RubySeg, Sentence, VocabItem } from "@/schemas/lesson";

/** ruby 分段的表面文字(TTS 讀例句用) */
function plainText(segs: RubySeg[]): string {
  return segs.map((s) => s.b).join("");
}

interface SessionItem {
  card: CardRow;
  vocab: VocabItem;
  lessonTitle: string;
  example: Sentence | null;
  /** 本 session 內重看第幾次(缺省 = 一般卡;只曝光、不評分,見 lib/relearn) */
  relearn?: number;
}

type Phase = "loading" | "empty" | "review" | "summary" | "error";

/** 空狀態的區分依據:尚未加入單字 / 今日新卡已達上限 / 今日完成 */
interface EmptyInfo {
  hasCards: boolean;
  counts: QueueCounts;
}

async function loadEmptyInfo(now: number): Promise<EmptyInfo> {
  const [hasCards, counts] = await Promise.all([hasAnyCards(), queueCounts(now)]);
  return { hasCards, counts };
}

/** 「可在設定調整」:連到設定頁的每日新卡上限 */
function SettingsHint({ prefix }: { prefix: string }) {
  return (
    <p className="mt-2 text-sm text-foreground/60">
      {prefix}可在
      <Link href="/settings" className="text-sky-700 underline">
        設定
      </Link>
      調整
    </p>
  );
}

/** 今日新卡已達上限(`newCapReached`)時的說明;`newPerDay` 為 0 時另給文案。 */
function NewCapMessage({ counts }: { counts: QueueCounts }) {
  if (counts.newPerDay === 0) {
    return (
      <>
        <p className="text-lg font-medium">每日新卡上限設為 0</p>
        <SettingsHint prefix="暫不引入新卡;" />
      </>
    );
  }
  // 設定於今日調低時 newToday 可能大於上限,以上限封頂
  const introduced = Math.min(counts.newToday, counts.newPerDay);
  return (
    <>
      <p className="text-lg font-medium">
        今日新卡已達上限({introduced}/{counts.newPerDay})
      </p>
      {/* 只有因額度而延後的新卡,調高上限才能今天引入;bury 的回想卡本來就明天才出 */}
      {counts.newCapped > 0 ? (
        <SettingsHint prefix="明天繼續;" />
      ) : (
        <p className="mt-2 text-sm text-foreground/60">明天繼續</p>
      )}
    </>
  );
}

type Stats = { again: number; hard: number; good: number; easy: number };
const ZERO_STATS: Stats = { again: 0, hard: 0, good: 0, easy: 0 };
const STAT_KEY: Record<ReviewRating, keyof Stats> = {
  1: "again",
  2: "hard",
  3: "good",
  4: "easy",
};

/** 複習 session 的進度;整包快照即可復原上一步 */
interface Session {
  items: SessionItem[];
  index: number;
  stats: Stats;
  /** 本次評「重來」的字(結算頁列出) */
  missed: SessionItem[];
  /** 已完成的重看次數 */
  relearnViews: number;
  /** 本次「已會·略過」的字數 */
  skipped: number;
}

const EMPTY_SESSION: Session = {
  items: [],
  index: 0,
  stats: ZERO_STATS,
  missed: [],
  relearnViews: 0,
  skipped: 0,
};

/** 上一步(只保留一步):復原時先還原 DB,再放回動作前的 session 快照 */
interface UndoEntry {
  session: Session;
  db:
    | ({ kind: "rate" } & Pick<RateResult, "prev" | "logId">)
    | { kind: "skip"; vocabId: string }
    | { kind: "none" }; // 重看的決定只在 session 內
}

/** 結算頁資料:明日到期與今日目標/連續天數(與首頁同一套計算) */
interface SummaryInfo {
  tomorrowDue: number;
  todayCount: number;
  goal: GoalProgress;
  streak: number;
}

async function loadSummaryInfo(now: number): Promise<SummaryInfo> {
  const [tomorrowDue, logs, dailyGoal, counts] = await Promise.all([
    countDueByTomorrow(now),
    db.logs.toArray(),
    getSetting("dailyGoal"),
    queueCounts(now),
  ]);
  const date = new Date(now);
  const todayCount = reviewsToday(logs, date);
  return {
    tomorrowDue,
    todayCount,
    goal: effectiveGoal(dailyGoal, todayCount, counts.due + counts.fresh),
    streak: computeStreak(logs, date),
  };
}

/**
 * 換卡(含載入第一張、進結算頁)後這段時間內的點擊不生效:雙擊評分/略過鍵時,第二下會
 * 落在下一張卡上(翻開它)或結算頁的連結/復原上(離開結算頁)。
 */
const CHANGE_GUARD_MS = 300;

/**
 * state + 同步更新的 ref。事件處理一律讀 ref:連按時第二個事件可能早於重繪,
 * 讀 state 會拿到上一張卡。
 */
function useSyncedState<T>(initial: T): [T, { readonly current: T }, (value: T) => void] {
  const [state, setState] = useState(initial);
  const ref = useRef(initial);
  const set = useCallback((value: T) => {
    ref.current = value;
    setState(value);
  }, []);
  return [state, ref, set];
}

export default function ReviewPage() {
  const [phase, phaseRef, setPhase] = useSyncedState<Phase>("loading");
  const [error, setError] = useState<string | null>(null);
  const [session, sessionRef, setSession] = useSyncedState<Session>(EMPTY_SESSION);
  const [flipped, flippedRef, setFlipped] = useSyncedState(false);
  const [undo, undoRef, setUndo] = useSyncedState<UndoEntry | null>(null);
  const [furigana, setFurigana] = useState<FuriganaMode>("show");
  const ttsEnabled = useTtsEnabled();
  const [previews, setPreviews] = useState<IntervalPreviews | null>(null);
  const [tomorrowDue, setTomorrowDue] = useState(0);
  const [summary, setSummary] = useState<SummaryInfo | null>(null);
  const [emptyInfo, setEmptyInfo] = useState<EmptyInfo | null>(null);
  // 遞增即重新載入佇列(頁面重新可見時,見下)
  const [loadSeq, setLoadSeq] = useState(0);
  // 最近一次載入的時刻(判斷是否已跨學習日)
  const loadedAt = useRef(0);
  // 評分/略過/復原進行中:ref 供防重入(立即生效),state 供按鈕 disabled
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  // 換卡/進結算的時刻(CHANGE_GUARD_MS)
  const shownAt = useRef(0);

  // 載入佇列與卡片內容
  useEffect(() => {
    let active = true;
    (async () => {
      const now = Date.now();
      loadedAt.current = now;
      const showEmpty = async () => {
        const [due, info] = await Promise.all([countDueByTomorrow(now), loadEmptyInfo(now)]);
        if (active) {
          setTomorrowDue(due);
          setEmptyInfo(info);
          setUndo(null);
          setPhase("empty");
        }
      };
      const cards = await buildQueue(now);
      if (!active) return;
      if (cards.length === 0) {
        await showEmpty();
        return;
      }
      const furi = await getSetting("furigana");
      const lessonIds = [...new Set(cards.map((c) => c.lessonId))];
      const lessons = new Map<number, Lesson>();
      for (const id of lessonIds) lessons.set(id, await getLesson(id));
      const built = cards
        .map((card): SessionItem | null => {
          const lesson = lessons.get(card.lessonId);
          const vocab = lesson?.vocab.find((v) => v.id === baseVocabId(card.cardId));
          return lesson && vocab
            ? {
                card,
                vocab,
                lessonTitle: lesson.title,
                example: findExampleSentence(vocab, lesson),
              }
            : null;
        })
        .filter((x): x is SessionItem => x !== null);
      if (!active) return;
      if (built.length === 0) {
        await showEmpty();
        return;
      }
      setFurigana(furi);
      setSession({ ...EMPTY_SESSION, items: built });
      setFlipped(false);
      setUndo(null);
      setPreviews(null);
      shownAt.current = Date.now(); // 第一張也算換卡(首頁「開始複習」雙擊的第二下不翻面)
      setPhase("review");
    })().catch((e: unknown) => {
      if (active) {
        setError(e instanceof Error ? e.message : String(e));
        setPhase("error");
      }
    });
    return () => {
      active = false;
    };
  }, [loadSeq, setPhase, setSession, setFlipped, setUndo]);

  // 頁面重新可見(切回 App、bfcache 還原)時重算「今天」;不打斷進行中的 session:
  // 空狀態一律重載;結算頁只在跨學習日時重載(同日短暫切走不丟失結算)
  useEffect(() => {
    if (phase !== "empty" && phase !== "summary") return;
    function onVisible() {
      if (document.visibilityState !== "visible") return;
      if (phase === "summary" && studyDayKey(Date.now()) === studyDayKey(loadedAt.current)) {
        return;
      }
      setLoadSeq((n) => n + 1);
    }
    // 只處理 bfcache 還原;首次載入的 pageshow 不重複載入
    function onPageShow(e: PageTransitionEvent) {
      if (e.persisted) onVisible();
    }
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [phase]);

  // 當前卡片的預估間隔(重看項不評分,不需預估)
  useEffect(() => {
    if (phase !== "review") return;
    const item = session.items[session.index];
    if (!item || item.relearn !== undefined) return;
    let active = true;
    previewIntervals(item.card.cardId, Date.now())
      .then((p) => {
        if (active) setPreviews(p);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [phase, session.index, session.items]);

  /** 防重入:進行中的動作未結束前忽略其他評分/略過/復原 */
  const run = useCallback(async (action: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await action();
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, []);

  /** 目前已翻面的卡(未翻面或已結束則 null);讀 ref,見 useSyncedState */
  const flippedItem = useCallback((): { s: Session; item: SessionItem } | null => {
    const s = sessionRef.current;
    const item = s.items[s.index];
    return item && flippedRef.current ? { s, item } : null;
  }, [sessionRef, flippedRef]);

  /** 前往 next.index;超出即進結算(結算資料載入失敗不擋結算) */
  const goTo = useCallback(
    async (next: Session) => {
      if (next.index >= next.items.length) {
        const info = await loadSummaryInfo(Date.now()).catch(() => null);
        setSummary(info);
        setSession(next);
        setFlipped(false);
        shownAt.current = Date.now();
        setPhase("summary");
        return;
      }
      setSession(next);
      setFlipped(false);
      setPreviews(null);
      shownAt.current = Date.now();
    },
    [setPhase, setSession, setFlipped],
  );

  // 評分;「重來」的卡約 5 張後插入重看項(只曝光,不再評分)
  const handleRate = useCallback(
    (rating: ReviewRating) =>
      run(async () => {
        const cur = flippedItem();
        if (!cur || cur.item.relearn !== undefined) return;
        const { s, item } = cur;
        const { prev, logId } = await rate(item.card.cardId, rating, Date.now());
        const again = rating === 1;
        setUndo({ session: s, db: { kind: "rate", prev, logId } });
        const key = STAT_KEY[rating];
        await goTo({
          ...s,
          items: again ? insertRelearn(s.items, s.index) : s.items,
          index: s.index + 1,
          stats: { ...s.stats, [key]: s.stats[key] + 1 },
          missed: again ? [...s.missed, item] : s.missed,
        });
      }),
    [run, flippedItem, setUndo, goTo],
  );

  // 重看項:還不熟 → 再排一次重看(有上限);記住了 → 前進。不寫任何資料
  const handleRelearn = useCallback(
    (again: boolean) =>
      run(async () => {
        const cur = flippedItem();
        if (!cur || cur.item.relearn === undefined) return;
        const { s } = cur;
        setUndo({ session: s, db: { kind: "none" } });
        await goTo({
          ...s,
          items: again ? insertRelearn(s.items, s.index) : s.items,
          index: s.index + 1,
          relearnViews: s.relearnViews + 1,
        });
      }),
    [run, flippedItem, setUndo, goTo],
  );

  // 「已會」:以字為單位暫停(正向與回想卡)並跳下一張;可復原
  const handleSkip = useCallback(
    () =>
      run(async () => {
        const cur = flippedItem();
        if (!cur || cur.item.relearn !== undefined) return;
        const { s, item } = cur;
        const vocabId = baseVocabId(item.card.cardId);
        await setWordSuspended(vocabId, true);
        setUndo({ session: s, db: { kind: "skip", vocabId } });
        await goTo({ ...s, index: s.index + 1, skipped: s.skipped + 1 });
      }),
    [run, flippedItem, setUndo, goTo],
  );

  // 復原上一步:還原 DB(評分 → undoRate;略過 → 恢復),回到該卡的翻面狀態(含從結算頁返回)
  const handleUndo = useCallback(
    () =>
      run(async () => {
        const entry = undoRef.current;
        if (!entry) return;
        if (entry.db.kind === "rate") await undoRate(entry.db);
        else if (entry.db.kind === "skip") await setWordSuspended(entry.db.vocabId, false);
        setUndo(null);
        setSession(entry.session);
        setFlipped(true);
        setPreviews(null);
        setPhase("review");
      }),
    [run, undoRef, setUndo, setSession, setFlipped, setPhase],
  );

  // 點擊卡片翻面(換卡後 CHANGE_GUARD_MS 內忽略)
  const flipByClick = useCallback(() => {
    if (flippedRef.current || Date.now() - shownAt.current < CHANGE_GUARD_MS) return;
    setFlipped(true);
  }, [flippedRef, setFlipped]);

  // 結算頁剛出現(CHANGE_GUARD_MS 內)的點擊不觸發連結與復原:capture 階段攔下,
  // preventDefault 擋掉 <a> 的導覽、stopPropagation 擋掉 Link/按鈕的 onClick
  const guardSummaryClick = useCallback((e: React.MouseEvent) => {
    if (Date.now() - shownAt.current < CHANGE_GUARD_MS) {
      e.preventDefault();
      e.stopPropagation();
    }
  }, []);

  // 鍵盤:空白翻面、1–4 評分(重看項:1 還不熟、3 記住了);長按連發忽略。
  // 依賴皆穩定,掛載時訂閱一次,全部讀 ref(不因換卡/換階段重新訂閱而漏接按鍵)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (phaseRef.current !== "review") return;
      if (e.code === "Space") {
        e.preventDefault();
        if (!e.repeat && !flippedRef.current) setFlipped(true);
        return;
      }
      if (e.repeat || !flippedRef.current) return;
      const s = sessionRef.current;
      const item = s.items[s.index];
      if (!item) return;
      if (item.relearn !== undefined) {
        if (e.key === "1") void handleRelearn(true);
        else if (e.key === "3") void handleRelearn(false);
        return;
      }
      if (["1", "2", "3", "4"].includes(e.key)) {
        void handleRate(Number(e.key) as ReviewRating);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phaseRef, flippedRef, sessionRef, setFlipped, handleRate, handleRelearn]);

  if (phase === "loading") {
    return <Centered>載入中…</Centered>;
  }

  if (phase === "error") {
    return (
      <Centered>
        <span className="text-red-600">載入複習失敗:{error}</span>
      </Centered>
    );
  }

  if (phase === "empty") {
    if (emptyInfo && !emptyInfo.hasCards) {
      return (
        <Centered>
          <p className="text-lg font-medium">還沒有加入任何單字</p>
          <p className="mt-2 text-sm text-foreground/60">從課程挑一課,把單字加入複習吧。</p>
          <Link href="/lessons" className="mt-4 text-sm text-sky-700 underline">
            瀏覽課程
          </Link>
        </Centered>
      );
    }
    return (
      <Centered>
        {emptyInfo?.counts.newCapReached ? (
          <NewCapMessage counts={emptyInfo.counts} />
        ) : (
          <p className="text-lg font-medium">今日複習完成 🎉</p>
        )}
        <p className="mt-2 text-sm text-foreground/60">
          明日到期:{tomorrowDue} 張
        </p>
        <Link href="/" className="mt-4 text-sm text-sky-700 underline">
          回首頁
        </Link>
      </Centered>
    );
  }

  if (phase === "summary") {
    const { stats, missed } = session;
    const total = stats.again + stats.hard + stats.good + stats.easy;
    return (
      <div className="px-4 pb-8" onClickCapture={guardSummaryClick}>
        <div className="flex min-h-11 items-center justify-end">
          {undo && <UndoButton onClick={() => void handleUndo()} disabled={busy} />}
        </div>
        <h1 className="mt-2 text-center text-lg font-bold">本次複習結算</h1>
        <p className="mt-4 text-center text-3xl font-bold">{total}</p>
        <p className="text-center text-sm text-foreground/60">張卡片</p>
        <dl className="mx-auto mt-6 max-w-xs space-y-1 text-sm">
          <Row label="重來" value={stats.again} />
          <Row label="困難" value={stats.hard} />
          <Row label="良好" value={stats.good} />
          <Row label="輕鬆" value={stats.easy} />
          {session.skipped > 0 && <Row label="已會·略過" value={session.skipped} />}
          <Row label="明日到期" value={summary ? summary.tomorrowDue : "—"} />
        </dl>
        {missed.length > 0 && (
          <section className="mx-auto mt-6 max-w-xs">
            <h2 className="flex items-baseline justify-between text-sm font-medium">
              <span>本次答錯</span>
              <span className="text-xs font-normal text-foreground/60">
                重看 {session.relearnViews} 次
              </span>
            </h2>
            <ul className="mt-1 text-sm">
              {missed.map((it) => (
                <li
                  key={it.card.cardId}
                  className="flex items-baseline justify-between gap-3 border-b border-foreground/10 py-1.5"
                >
                  <RubyText segments={it.vocab.ruby} furigana={furigana} />
                  <span className="text-right text-foreground/70">{it.vocab.meaning}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
        {summary && (
          <p className="mt-6 text-center text-sm tabular-nums text-foreground/70">
            今日 {summary.todayCount}/{summary.goal.goal} · 🔥 {summary.streak}
          </p>
        )}
        <div className="mt-6 flex flex-col items-center gap-1">
          <Link
            href="/"
            className="inline-flex min-h-11 items-center justify-center rounded-lg bg-sky-600 px-8 font-medium text-white transition-colors active:bg-sky-700"
          >
            回首頁
          </Link>
          <Link
            href="/lessons"
            className="inline-flex min-h-11 items-center px-3 text-sm text-sky-700 underline dark:text-sky-400"
          >
            課程列表
          </Link>
        </div>
      </div>
    );
  }

  // phase === "review"
  const item = session.items[session.index];
  const isRev = cardDirection(item.card) === "rev";
  const isRelearn = item.relearn !== undefined;
  const note = displayNote(item.vocab.note);
  // 純假名字:標題即讀音 → 翻面後以重音標記取代標題,不再另列一行相同的假名
  const kanaOnly = isKanaSurface(item.vocab);
  const pitchHead = kanaHeadword(item.vocab);
  const answerHead =
    pitchHead !== null ? (
      <PitchAccent kana={pitchHead} accent={item.vocab.accent} />
    ) : (
      <RubyText segments={item.vocab.ruby} furigana={furigana} />
    );
  return (
    <div className="flex min-h-[80vh] flex-col">
      <div className="flex items-center justify-between px-4 py-2 text-xs text-foreground/60">
        <div className="flex items-center gap-1.5">
          <span className="rounded bg-foreground/5 px-1.5 py-0.5">
            {isRev ? "中 → 日" : "日 → 中"}
          </span>
          {isRelearn && (
            <span className="rounded bg-amber-500/15 px-1.5 py-0.5 font-medium text-amber-800 dark:text-amber-300">
              重看
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {undo && <UndoButton onClick={() => void handleUndo()} disabled={busy} />}
          <span className="tabular-nums">
            {session.index + 1} / {session.items.length}
          </span>
        </div>
      </div>

      <button
        type="button"
        aria-label={flipped ? "複習卡片" : "顯示答案"}
        onClick={flipByClick}
        className="flex flex-1 flex-col items-center justify-center gap-4 px-4 text-center"
      >
        {/* 提示面:回想卡(rev)給中文 + 詞性・課號(同義詞消歧,不洩漏讀音),辨識卡(fwd)給日文 */}
        {isRev ? (
          <div>
            <div className="text-2xl font-medium">{item.vocab.meaning}</div>
            <div className="mt-1 text-xs text-foreground/60">
              {item.vocab.pos}・第 {item.card.lessonId} 課
            </div>
          </div>
        ) : (
          <div className="text-3xl">
            {flipped ? answerHead : <RubyText segments={item.vocab.ruby} furigana={furigana} />}
          </div>
        )}
        {flipped && (
          <div className="space-y-1">
            {isRev ? (
              <>
                <div className="text-3xl">{answerHead}</div>
                {!kanaOnly && (
                  <div className="text-base text-foreground/70">
                    <PitchAccent kana={item.vocab.kana} accent={item.vocab.accent} />
                  </div>
                )}
              </>
            ) : (
              <>
                {!kanaOnly && (
                  <div className="text-base text-foreground/70">
                    <PitchAccent kana={item.vocab.kana} accent={item.vocab.accent} />
                  </div>
                )}
                <div className="text-lg">{item.vocab.meaning}</div>
              </>
            )}
            {/* 搭配提示(〔電車に〜〕等);回想卡只在翻面後顯示,以免洩題 */}
            {note && <div className="text-sm text-foreground/70">{note}</div>}
            {!isRev && (
              <div className="text-xs text-foreground/60">
                {item.vocab.pos}・<span lang={jaLang(item.lessonTitle)}>{item.lessonTitle}</span>
              </div>
            )}
          </div>
        )}
      </button>

      {/* 揭曉後的發音與例句(置於 flip button 外,避免 button 巢狀) */}
      {flipped && (
        <div className="space-y-2 px-4 pb-2">
          {ttsEnabled && (
            <div className="flex justify-center">
              <SpeakButton text={speechText(item.vocab)} label="發音" />
            </div>
          )}
          {item.example && (
            <div className="rounded-lg border border-foreground/10 bg-foreground/[0.02] p-3">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1 text-sm">
                  {/* 行高足以容納 furigana:有無讀音的行距一致 */}
                  <div className="text-base leading-ruby">
                    <RubyText segments={item.example.ruby} furigana={furigana} />
                  </div>
                  <p className="mt-1 text-xs text-foreground/60">
                    {item.example.translation}
                  </p>
                </div>
                {ttsEnabled && (
                  <SpeakButton
                    text={speechText(plainText(item.example.ruby))}
                    ariaLabel="播放例句發音"
                  />
                )}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="pb-4">
        {!flipped ? (
          <p className="text-center text-sm text-foreground/60">
            點擊卡片或按空白鍵顯示答案
          </p>
        ) : isRelearn ? (
          <>
            <RelearnButtons
              last={!canRelearnAgain(item)}
              onAgain={() => void handleRelearn(true)}
              onDone={() => void handleRelearn(false)}
              disabled={busy}
            />
            <p className="mt-2 text-center text-xs text-foreground/60">
              重看只為加深印象,不計分、不影響排程
            </p>
          </>
        ) : (
          <>
            <RatingButtons
              previews={previews}
              onRate={(r) => void handleRate(r)}
              disabled={busy}
            />
            {/* 次要動作:與計數器、評分鍵拉開距離,翻面後(已嘗試回想)才出現 */}
            <div className="mt-1 flex justify-center">
              <button
                type="button"
                onClick={() => void handleSkip()}
                disabled={busy}
                className="min-h-11 px-4 text-sm text-foreground/60 underline disabled:opacity-40"
              >
                已會·略過
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** 復原上一步(頂列/結算頁) */
function UndoButton({ onClick, disabled }: { onClick: () => void; disabled: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="-my-3 inline-flex min-h-11 items-center gap-1 rounded px-2 text-sm text-sky-700 disabled:opacity-40 dark:text-sky-400"
    >
      <span aria-hidden="true">↶</span>復原
    </button>
  );
}

/** 重看項的兩鍵(不評分;快捷鍵 1 / 3)。已達重看上限時「還不熟」改為明天再練(只前進)。 */
function RelearnButtons({
  last,
  onAgain,
  onDone,
  disabled,
}: {
  last: boolean;
  onAgain: () => void;
  onDone: () => void;
  disabled: boolean;
}) {
  const base =
    "flex flex-col items-center gap-0.5 rounded border border-foreground/15 py-3 disabled:opacity-40";
  return (
    <div className="grid grid-cols-2 gap-2 px-4">
      <button
        type="button"
        onClick={onAgain}
        disabled={disabled}
        className={cn(base, "text-red-600 dark:text-red-400")}
      >
        <span className="text-sm font-medium">{last ? "還不熟,明天再練" : "還不熟,再一次"}</span>
        <span aria-hidden="true" className="text-[10px] text-foreground/60">
          1
        </span>
      </button>
      <button
        type="button"
        onClick={onDone}
        disabled={disabled}
        className={cn(base, "text-green-700 dark:text-green-400")}
      >
        <span className="text-sm font-medium">記住了</span>
        <span aria-hidden="true" className="text-[10px] text-foreground/60">
          3
        </span>
      </button>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-4 text-center text-sm">
      {children}
    </div>
  );
}

function Row({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="flex justify-between border-b border-foreground/10 py-1">
      <dt className="text-foreground/60">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
