"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Check, ChevronLeft, ChevronRight, Eye, EyeOff, Play, Plus, Square } from "lucide-react";
import { Loading } from "@/components/Loading";
import { PitchAccent, hasPitch } from "@/components/PitchAccent";
import { RubyText, type FuriganaMode } from "@/components/RubyText";
import { SpeakButton } from "@/components/SpeakButton";
import { Button, buttonVariants } from "@/components/ui/button";
import { getLesson } from "@/lib/content";
import { buildPlayback, isTitleLine, speakersOf, type PlaybackStep } from "@/lib/dialogue";
import { jaLang } from "@/lib/lang";
import { lessonTabHash, parseLessonHash, type LessonTab } from "@/lib/lessonHash";
import { displayNote, isSupplementary, noteSection, type VocabSection } from "@/lib/notes";
import { kanaHeadword } from "@/lib/pitch";
import { capNote } from "@/lib/queueNote";
import { lessonHasReorder } from "@/lib/reorder";
import {
  addCards,
  existingCardIds,
  queueCounts,
  setWordSuspended,
  suspendedWordIds,
} from "@/lib/srs";
import { speakSequence, speechText } from "@/lib/tts";
import { drillHref } from "@/lib/urlParams";
import { useJaVoiceAvailable, useSetting, useTtsEnabled } from "@/lib/useSetting";
import { cn } from "@/lib/utils";
import { countByPosGroup, filterByPosGroup, POS_FILTERS, type PosFilter } from "@/lib/vocabFilter";
import type { Lesson, Sentence } from "@/schemas/lesson";

type Tab = LessonTab;

const TABS: { key: Tab; label: string }[] = [
  { key: "vocab", label: "単語" },
  { key: "grammar", label: "文型" },
  { key: "dialogue", label: "会話" },
];

const LAST_LESSON = 50;

/** 単語分頁的自我測驗遮罩(F7.1):遮住中文(釋義)或日文(標題字、讀音) */
type VocabMask = "none" | "meaning" | "japanese";

const MASKS: { key: VocabMask; label: string }[] = [
  { key: "none", label: "無" },
  { key: "meaning", label: "中文" },
  { key: "japanese", label: "日文" },
];

/** 開關鈕與分段鈕:按下時的樣子(假名、遮住、詞性、隱藏中譯共用) */
const TOGGLE_BUTTON =
  "font-normal text-muted-foreground aria-pressed:border-link aria-pressed:bg-link/10 aria-pressed:text-link";

/** 揭示鈕(RevealButton)的焦點外框:畫在按鈕內的色塊/內容上 */
const REVEAL_FOCUS_RING =
  "group-focus-visible:outline-2 group-focus-visible:outline-offset-2 group-focus-visible:outline-ring";

/** 單字錨點(搜尋結果)捲到後的高亮時間 */
const HIGHLIGHT_MS = 2000;

/** 錨點捲動讓出黏在頂端的分頁列(按鈕 min-h-11 + 底框 1px):目標緊貼分頁列下緣,不露出上一列 */
const ANCHOR_SCROLL_MARGIN = "scroll-mt-[calc(2.75rem_+_1px)]";

/** 單字錨點的短暫高亮:淡底(10%,次要文字對比仍 ≥ 4.5:1)+ 左側色條(深色底上淡底不明顯,靠色條辨識) */
const ANCHOR_HIGHLIGHT = "bg-link/10 shadow-[inset_3px_0_0_var(--color-link)]";

/** 整課加入的結果 */
interface AddAllResult {
  /** 實際新加入的字數 */
  created: number;
  /** 今日佇列仍空時的說明(如新卡額度已用完);null = 今日有卡可複習,給「開始複習」連結 */
  emptyNote: string | null;
}

/** 待捲動的錨點:目標分頁 commit 後才捲(見下方 effect) */
interface PendingAnchor {
  id: string;
  tab: Tab;
  highlight: boolean;
}

export function LessonDetail({ id }: { id: number }) {
  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("vocab");
  // furigana 初始值 = 全域設定;頁內切換只影響本頁(不寫回設定)
  const globalFurigana = useSetting("furigana");
  const [furiganaOverride, setFuriganaOverride] = useState<FuriganaMode | null>(null);
  const furigana = furiganaOverride ?? globalFurigana ?? "show";
  const ttsEnabled = useTtsEnabled();
  // 会話全部播放/扮演只靠語音運作:沒有日語 voice 時隱藏。在頁面層查詢(切到会話分頁時多已查好);
  // 換分頁時重掃(語音清單晚到、又不觸發 voiceschanged 的引擎)
  const jaVoice = useJaVoiceAvailable(ttsEnabled, tab);
  // 設定讀到後才渲染內容,避免先閃出 furigana / 發音鈕
  const ready = lesson !== null && globalFurigana !== undefined && ttsEnabled !== undefined;
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [suspended, setSuspendedIds] = useState<Set<string>>(new Set());
  // 上兩者的初始值已讀到(讀取失敗也算):單字錨點等它才捲動(見下方)
  const [cardStateLoaded, setCardStateLoaded] = useState(false);
  // 整課加入的結果(「已加入 N 字 · 開始複習 →」);未整課加入為 null
  const [addAllResult, setAddAllResult] = useState<AddAllResult | null>(null);
  // 自我測驗(F7.1)與会話扮演(F7.2):遮罩、詞性篩選、隱藏中譯、扮演的說話者只存於本頁 state
  // (不寫設定);切換分頁時保留
  const [mask, setMask] = useState<VocabMask>("none");
  const [posFilter, setPosFilter] = useState<PosFilter>("all");
  const [hideTranslations, setHideTranslations] = useState(false);
  const [role, setRole] = useState<string | null>(null);
  const headerRef = useRef<HTMLElement>(null);
  // 本課有可練的動詞/形容詞、且到本課已教過至少一種活用形:標頭給「活用練習」(範圍到本課)
  const [hasDrill, setHasDrill] = useState(false);
  // 本課有可重組的例句/台詞(reorder.ts,純函式、體積小,靜態載入):標頭給「例句重組」
  const hasReorder = useMemo(() => lesson !== null && lessonHasReorder(lesson), [lesson]);

  useEffect(() => {
    let active = true;
    // 活用練習的判斷(drill.ts,含活用引擎與 wanakana)動態載入、與課程資料並行:
    // 不計入課程頁 first-load JS;連結與內容同時出現(不晚一步推擠標頭)。載入失敗只是不給連結
    Promise.all([getLesson(id), import("@/lib/drill").catch(() => null)])
      .then(([data, drill]) => {
        if (!active) return;
        setHasDrill(drill?.lessonHasDrill(data) ?? false);
        setLesson(data);
      })
      .catch((e: unknown) => {
        if (active) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      active = false;
    };
  }, [id]);

  // 初始化「已加入複習」與「已會/暫停」狀態(已會以字為單位:任一方向暫停即算)
  useEffect(() => {
    if (!lesson) return;
    let active = true;
    const ids = lesson.vocab.map((v) => v.id);
    Promise.all([existingCardIds(ids), suspendedWordIds(ids)])
      .then(([addedIds, suspIds]) => {
        if (!active) return;
        setAdded(new Set(addedIds));
        setSuspendedIds(new Set(suspIds));
        setCardStateLoaded(true);
      })
      .catch(() => {
        if (active) setCardStateLoaded(true);
      });
    return () => {
      active = false;
    };
  }, [lesson]);

  const toggleSuspend = useCallback(async (cardId: string, next: boolean) => {
    await setWordSuspended(cardId, next); // 正向與回想卡一併
    setSuspendedIds((prev) => {
      const s = new Set(prev);
      if (next) s.add(cardId);
      else s.delete(cardId);
      return s;
    });
  }, []);

  // URL hash → 分頁與錨點(lessonHash.ts):內容就緒時套用一次,之後隨 hashchange(手改網址、前進/後退)。
  // 文法點 #Lxx-Gxx → 文型並捲動(F4.1);單字 #Lxx-Vxxx → 単語、捲動並高亮;#grammar 等 → 還原分頁。
  // layout effect:在繪製前切好分頁,不先閃出単語分頁
  const [pendingAnchor, setPendingAnchor] = useState<PendingAnchor | null>(null);
  const [highlighted, setHighlighted] = useState<string | null>(null);

  // 分頁列已黏在頂端(捲過標頭)時捲回內容開頭:換分頁後短分頁不致停在頁尾、長分頁從頭看起
  const scrollToContentTop = useCallback(() => {
    const header = headerRef.current;
    if (!header) return;
    const contentTop = header.getBoundingClientRect().bottom + window.scrollY;
    if (window.scrollY > contentTop) window.scrollTo({ top: contentTop });
  }, []);

  useLayoutEffect(() => {
    if (!ready) return;
    const apply = (fromHashChange: boolean) => {
      const target = parseLessonHash(window.location.hash);
      if (!target) return;
      setTab(target.tab);
      if (target.anchor) {
        // 單字錨點:目標字可能被詞性篩選掉(不在 DOM),先回到「全部」
        if (target.tab === "vocab") setPosFilter("all");
        setPendingAnchor({ id: target.anchor, tab: target.tab, highlight: target.highlight });
      } else if (fromHashChange) {
        scrollToContentTop(); // 初次套用不捲:返回本頁時交給瀏覽器還原捲動位置
      }
    };
    const onHashChange = () => apply(true);
    apply(false);
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, [ready, scrollToContentTop]);
  // 待目標分頁 commit 後才捲動:client 導覽時 Next 的 hash 捲動早於內容載入,找不到錨點;
  // 同一次 render 切分頁並設錨點,此時 DOM 已有目標元素(scroll-mt 讓出黏在頂端的分頁列)
  useLayoutEffect(() => {
    if (!pendingAnchor || pendingAnchor.tab !== tab) return;
    // 單字列:初始加入狀態到了列內鈕才換寬(+ → ✓ 已會),上方的列可能因此換行而位移;
    // 沒有 CSS scroll anchoring 的瀏覽器(Safari)先捲會停在錯位處,故等狀態讀到才捲
    if (pendingAnchor.tab === "vocab" && !cardStateLoaded) return;
    setPendingAnchor(null);
    const el = document.getElementById(pendingAnchor.id);
    if (!el) return;
    el.scrollIntoView({ block: "start" });
    if (pendingAnchor.highlight) setHighlighted(pendingAnchor.id);
  }, [pendingAnchor, tab, cardStateLoaded]);
  useEffect(() => {
    if (highlighted === null) return;
    const timer = window.setTimeout(() => setHighlighted(null), HIGHLIGHT_MS);
    return () => window.clearTimeout(timer);
  }, [highlighted]);

  const selectTab = useCallback(
    (key: Tab) => {
      setTab(key);
      // 分頁存於 URL hash:replaceState 不新增歷史紀錄,返回本頁時由上方 effect 還原
      window.history.replaceState(null, "", lessonTabHash(key));
      scrollToContentTop();
    },
    [scrollToContentTop],
  );

  const addOne = useCallback(
    async (cardId: string) => {
      if (!lesson) return;
      await addCards([cardId], lesson.id);
      setAdded((prev) => new Set(prev).add(cardId));
    },
    [lesson],
  );

  // 同步防重入(state 要等重繪才生效):連點時第二次會得到「新加入 0 字」
  const addingAll = useRef(false);
  const addAll = useCallback(async () => {
    if (!lesson || addingAll.current) return;
    addingAll.current = true;
    try {
      // 補充單字(自行練習發音)不整課加入(仍可單字加入);回傳值 = 實際新加入的字數
      const ids = lesson.vocab.filter((v) => !isSupplementary(v)).map((v) => v.id);
      const created = await addCards(ids, lesson.id);
      // 今日佇列仍空(新卡額度已用完等)時不給「開始複習」:點進去只會看到上限說明。讀不到照常給連結
      const counts = await queueCounts().catch(() => null);
      const emptyNote =
        counts && counts.due + counts.fresh === 0
          ? (capNote(counts) ?? "今天沒有要複習的卡片")
          : null;
      setAdded((prev) => new Set([...prev, ...ids]));
      setAddAllResult({ created, emptyNote });
    } finally {
      addingAll.current = false;
    }
  }, [lesson]);

  if (error) {
    return (
      <p className="px-4 py-8 text-center text-sm text-destructive">
        載入課程失敗:{error}
      </p>
    );
  }

  if (!lesson || !ready) {
    return <Loading />;
  }

  // 上/下一課只用箭頭圖示(名稱在 aria-label):三個練習入口與箭頭在 375px 寬排得進一列
  const navLink = buttonVariants({ variant: "ghost", size: "icon" });

  return (
    <div>
      <header ref={headerRef} className="px-4 pt-3 pb-2">
        <div className="flex items-start justify-between">
          <div className="min-w-0">
            <div className="text-xs text-muted-foreground">第 {lesson.id} 課</div>
            <h1 lang={jaLang(lesson.title)} className="text-lg font-bold">
              {lesson.title}
            </h1>
          </div>
          {/* 開關鈕:名稱固定「假名」,狀態只由 aria-pressed(與外觀、圖示)表示,不讓文字與狀態互相矛盾 */}
          <Button
            variant="outline"
            size="sm"
            aria-pressed={furigana === "show"}
            onClick={() => setFuriganaOverride(furigana === "show" ? "hide" : "show")}
            className={cn("ml-3 gap-1.5", TOGGLE_BUTTON)}
          >
            {furigana === "show" ? (
              <Eye className="size-4" aria-hidden />
            ) : (
              <EyeOff className="size-4" aria-hidden />
            )}
            假名
          </Button>
        </div>
        {/* 流程互連:本課測驗、活用練習、例句重組、上/下一課(不必回列表找) */}
        <nav aria-label="課程導覽" className="mt-2 flex flex-wrap items-center gap-1.5">
          <Link
            href={`/quiz/${lesson.id}`}
            className={buttonVariants({ variant: "outline", size: "sm", className: "font-normal" })}
          >
            測驗本課
          </Link>
          {hasDrill && (
            <Link
              href={drillHref(lesson.id)}
              className={buttonVariants({ variant: "outline", size: "sm", className: "font-normal" })}
            >
              活用練習
            </Link>
          )}
          {hasReorder && (
            <Link
              href={`/reorder/${lesson.id}`}
              className={buttonVariants({ variant: "outline", size: "sm", className: "font-normal" })}
            >
              例句重組
            </Link>
          )}
          {/* -mr-3:箭頭圖示對齊內容右緣(與「假名」鈕切齊),觸控區延伸到頁面留白 */}
          <div className="-mr-3 ml-auto flex items-center">
            {lesson.id > 1 && (
              <Link
                href={`/lessons/${lesson.id - 1}`}
                aria-label="上一課"
                title="上一課"
                className={navLink}
              >
                <ChevronLeft className="size-5" aria-hidden />
              </Link>
            )}
            {lesson.id < LAST_LESSON && (
              <Link
                href={`/lessons/${lesson.id + 1}`}
                aria-label="下一課"
                title="下一課"
                className={navLink}
              >
                <ChevronRight className="size-5" aria-hidden />
              </Link>
            )}
          </div>
        </nav>
      </header>

      {/* 分段按鈕(aria-pressed):一次只按下一個;不宣告 tablist(未實作 tabpanel 與方向鍵)。
          黏在頂端:長列表中也能直接切換分頁 */}
      <div
        role="group"
        aria-label="課程內容"
        className="sticky top-0 z-10 flex border-b border-border bg-background"
      >
        {TABS.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            lang="ja"
            aria-pressed={tab === key}
            onClick={() => selectTab(key)}
            className={cn(
              "min-h-11 flex-1 text-sm transition-colors",
              tab === key
                ? "border-b-2 border-foreground font-medium"
                : "text-muted-foreground",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "vocab" && (
        <VocabList
          lesson={lesson}
          furigana={furigana}
          tts={ttsEnabled === true}
          added={added}
          suspended={suspended}
          addAllResult={addAllResult}
          highlighted={highlighted}
          mask={mask}
          posFilter={posFilter}
          onMaskChange={setMask}
          onPosFilterChange={setPosFilter}
          onAddOne={addOne}
          onAddAll={addAll}
          onToggleSuspend={toggleSuspend}
        />
      )}
      {tab === "grammar" && (
        <GrammarList
          lesson={lesson}
          furigana={furigana}
          tts={ttsEnabled === true}
          hideTranslations={hideTranslations}
          onHideTranslationsChange={setHideTranslations}
        />
      )}
      {tab === "dialogue" &&
        (jaVoice === undefined ? (
          // 第一次查詢日語 voice 中(直接開啟 #dialogue 且語音清單晚到):查好再渲染,
          // 全部播放與扮演不會晚出現而把台詞往下推
          <Loading />
        ) : (
          <DialogueList
            lesson={lesson}
            furigana={furigana}
            tts={ttsEnabled === true}
            canPlay={jaVoice}
            hideTranslations={hideTranslations}
            onHideTranslationsChange={setHideTranslations}
            roleChoice={role}
            onRoleChange={setRole}
          />
        ))}
    </div>
  );
}

/*
 * 單字列的小鈕:點擊區 44×44,以負 margin 抵銷、列高與版面不變(圖示佔 16px、text-xs 佔一行 16px);
 * relative 讓延伸的點擊區疊在相鄰文字之上(否則後方的非定位元素會蓋住它)。
 * 不用 rounded-full:圓角會裁掉點擊判定,四角點不到(維持 Button 的 rounded-lg)。
 * 不畫 ghost 的 hover/按下底色:44px 的底色會蓋住相鄰的單字與讀音,改以文字色回饋。
 */
const ROW_BUTTON_FEEDBACK = "hover:bg-transparent active:bg-transparent";
const ROW_ICON_BUTTON = cn("relative -m-3.5", ROW_BUTTON_FEEDBACK);
const ROW_TEXT_BUTTON = cn(
  "relative -mx-2 -my-3.5 min-w-11 px-2 text-xs font-normal underline underline-offset-2",
  ROW_BUTTON_FEEDBACK,
);

/** 列內換鈕後這段時間內忽略該列的點擊(同 /review 換卡後的點擊防護) */
const ROW_CHANGE_GUARD_MS = 300;

/** note 為段落標記的字:以小徽章標示出處,不當註解顯示(読み物/会話 為日文用語) */
const SECTION_BADGES: Record<VocabSection, { label: string; lang?: "ja"; title?: string }> = {
  supplementary: { label: "補充", title: "補充單字(自行練習發音),不含於整課加入" },
  reading: { label: "読み物", lang: "ja" },
  dialogue: { label: "会話", lang: "ja" },
};

function SectionBadge({ section }: { section: VocabSection }) {
  const { label, lang, title } = SECTION_BADGES[section];
  return (
    <span
      lang={lang}
      title={title}
      className="ml-1.5 inline-block rounded bg-muted px-1.5 align-[0.125em] text-[11px] leading-4 text-muted-foreground"
    >
      {label}
    </span>
  );
}

/**
 * 自我測驗(F7.1)已揭示的項目 id(單字、例句、会話):只存在所在分頁的元件 state,
 * 換分頁回來即重新遮住;遮罩或「隱藏中譯」改變時由呼叫端清空。
 */
function useRevealed() {
  const [revealed, setRevealed] = useState<ReadonlySet<string>>(new Set());
  const toggleRevealed = useCallback((id: string) => {
    setRevealed((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }, []);
  return { revealed, setRevealed, toggleRevealed };
}

/**
 * 自我測驗遮住的欄位(F7.1):遮住時是「顯示中文」等佔位,點擊(或 Enter/Space)揭示、再點一次遮回。
 * 狀態以 aria-expanded 表示;遮住時答案不渲染(輔助技術也讀不到),名稱帶上看得到的另一欄
 * (「顯示中文:あそびます」)以便在列表中區分。揭示後按鈕仍在原處,焦點不會掉到 body。
 * 觸控區 ≥ 44px 由呼叫端以 padding + 負 margin 延伸(`className`),揭示前後列高不變。
 * 焦點外框畫在佔位色塊/揭示的內容上(group-focus-visible),不畫在延伸的點擊區外圍(會劃過上下行的字)。
 */
function RevealButton({
  open,
  onToggle,
  placeholder,
  context,
  className,
  pillClassName,
  children,
}: {
  open: boolean;
  onToggle: () => void;
  /** 遮住時的佔位文字(也是按鈕名稱的開頭) */
  placeholder: string;
  /** 遮住時接在名稱後的辨識文字(只給輔助技術;同列內鈕的「加入複習:あそびます」) */
  context?: string;
  className?: string;
  /** 佔位色塊的字級與行高:與被遮的文字同高 */
  pillClassName?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-expanded={open}
      // 揭示後名稱 = 內容本身(答案);遮住時為「顯示中文:あそびます」(含看得到的佔位文字)
      aria-label={open || context === undefined ? undefined : `${placeholder}:${context}`}
      onClick={onToggle}
      className={cn(
        "group inline-block min-w-11 cursor-pointer text-left focus-visible:outline-hidden",
        className,
      )}
    >
      {open ? (
        <span className={cn("rounded-sm", REVEAL_FOCUS_RING)}>{children}</span>
      ) : (
        <span
          className={cn(
            "inline-block rounded-md bg-muted px-2 align-middle text-muted-foreground",
            REVEAL_FOCUS_RING,
            pillClassName,
          )}
        >
          {placeholder}
        </span>
      )}
    </button>
  );
}

function VocabList({
  lesson,
  furigana,
  tts,
  added,
  suspended,
  addAllResult,
  highlighted,
  mask,
  posFilter,
  onMaskChange,
  onPosFilterChange,
  onAddOne,
  onAddAll,
  onToggleSuspend,
}: {
  lesson: Lesson;
  furigana: FuriganaMode;
  /** 設定「TTS 發音」;false 時不渲染發音鈕 */
  tts: boolean;
  added: Set<string>;
  suspended: Set<string>;
  /** 整課加入的結果(null = 尚未整課加入) */
  addAllResult: AddAllResult | null;
  /** 單字錨點捲到後短暫高亮的字 */
  highlighted: string | null;
  mask: VocabMask;
  posFilter: PosFilter;
  onMaskChange: (mask: VocabMask) => void;
  onPosFilterChange: (filter: PosFilter) => void;
  onAddOne: (cardId: string) => Promise<void>;
  onAddAll: () => Promise<void>;
  onToggleSuspend: (cardId: string, next: boolean) => Promise<void>;
}) {
  // 補充單字不含於整課加入:其餘都已加入即視為整課已加入
  const supplementaryCount = lesson.vocab.filter(isSupplementary).length;
  const allAdded = lesson.vocab.every((v) => isSupplementary(v) || added.has(v.id));
  // 整課加入後按鈕變 disabled、焦點會掉到 body:改移到結果訊息(其中有「開始複習 →」)
  const noticeRef = useRef<HTMLParagraphElement>(null);
  const focusNotice = useRef(false);
  useEffect(() => {
    if (addAllResult === null || !focusNotice.current) return;
    focusNotice.current = false;
    noticeRef.current?.focus();
  }, [addAllResult]);
  // 列內的鈕會換成同一位置的另一顆(+ → 已會 → 已會·恢復):
  // - 換鈕後 ROW_CHANGE_GUARD_MS 內忽略該列的點擊:連點兩下的第二下會落在新鈕上(剛加入就被標為已會)
  // - 焦點原在鈕上(鍵盤操作)時,換鈕後交給同一列的新鈕,不掉到 body
  const listRef = useRef<HTMLUListElement>(null);
  const changedAt = useRef(new Map<string, number>());
  const refocusId = useRef<string | null>(null);

  useEffect(() => {
    const id = refocusId.current;
    if (id === null) return;
    const target = listRef.current?.querySelector<HTMLElement>(`[data-row-action="${id}"]`);
    // 尚未換鈕(焦點仍在原鈕上):這次更新來自別處(如初始狀態晚到),等換鈕那次再接手
    if (target && target === document.activeElement) return;
    refocusId.current = null;
    target?.focus();
  }, [added, suspended]);

  async function rowAction(id: string, button: HTMLElement, action: () => Promise<void>) {
    const last = changedAt.current.get(id);
    if (last !== undefined && Date.now() - last < ROW_CHANGE_GUARD_MS) return;
    changedAt.current.set(id, Date.now());
    if (document.activeElement === button) refocusId.current = id;
    try {
      await action();
    } catch (e) {
      refocusId.current = null;
      throw e;
    } finally {
      changedAt.current.set(id, Date.now());
    }
  }

  // 自我測驗:已揭示的字(切換遮罩時清空;換分頁回來也重新遮住)
  const { revealed, setRevealed, toggleRevealed } = useRevealed();
  const maskLabelId = useId();
  const changeMask = (next: VocabMask) => {
    if (next === mask) return;
    onMaskChange(next);
    setRevealed(new Set());
  };
  // 詞性篩選:沒有字的組不顯示 chip;目前的組沒有字時回到全部
  const counts = countByPosGroup(lesson.vocab);
  const filter = counts[posFilter] > 0 ? posFilter : "all";
  const shown = filterByPosGroup(lesson.vocab, filter);
  const allRevealed = shown.every((v) => revealed.has(v.id));
  // 全部顯示/重新遮住只作用於目前篩出的字(與按鈕文字的判定一致):
  // 還沒測的組不會先被揭示,其他組逐字揭示的也不會被遮回
  const toggleShown = () =>
    setRevealed((prev) => {
      const next = new Set(prev);
      for (const v of shown) {
        if (allRevealed) next.delete(v.id);
        else next.add(v.id);
      }
      return next;
    });

  return (
    <div>
      <div className="flex items-center justify-end gap-3 px-4 pt-2">
        {/* live region 先掛載、加入後再填入,螢幕閱讀器才會播報。
            鍵盤操作移入焦點時顯示外框(focus-visible;滑鼠點擊不顯示) */}
        <p
          ref={noticeRef}
          role="status"
          tabIndex={-1}
          className="mr-auto min-w-0 rounded-sm text-sm text-foreground/70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          {addAllResult !== null && (
            <>
              {addAllResult.created > 0
                ? `已加入 ${addAllResult.created} 字`
                : "本課單字皆已加入"}{" "}
              ·{" "}
              {addAllResult.emptyNote ?? (
                <Link
                  href="/review"
                  className="inline-flex min-h-11 items-center font-medium text-link underline-offset-4 hover:underline"
                >
                  開始複習 →
                </Link>
              )}
            </>
          )}
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            focusNotice.current = true;
            onAddAll().catch(() => {
              focusNotice.current = false;
            });
          }}
          disabled={allAdded}
          className="font-normal"
        >
          {allAdded
            ? "整課已加入"
            : supplementaryCount > 0
              ? `整課加入複習(不含補充 ${supplementaryCount} 字)`
              : "整課加入複習"}
        </Button>
      </div>
      {/* 自我測驗與詞性篩選(F7.1):aria-pressed 分段鈕(同分頁列,不宣告 radiogroup) */}
      <div className="space-y-2 border-b border-border px-4 pt-2 pb-3">
        {/* flex-wrap:約 340px 以下「全部顯示」排到下一行 */}
        <div className="flex flex-wrap items-center gap-2">
          <div role="group" aria-labelledby={maskLabelId} className="flex items-center gap-1">
            <span
              id={maskLabelId}
              className="mr-1 shrink-0 text-sm whitespace-nowrap text-muted-foreground"
            >
              遮住
            </span>
            {MASKS.map(({ key, label }) => (
              <button
                key={key}
                type="button"
                aria-pressed={mask === key}
                onClick={() => changeMask(key)}
                className={buttonVariants({
                  variant: "outline",
                  size: "sm",
                  className: cn("min-w-11", TOGGLE_BUTTON), // 「無」單字寬 40px
                })}
              >
                {label}
              </button>
            ))}
          </div>
          {mask !== "none" && (
            <Button
              variant="ghost"
              size="sm"
              onClick={toggleShown}
              className="ml-auto gap-1.5 font-normal text-link"
            >
              {allRevealed ? (
                <EyeOff className="size-4" aria-hidden />
              ) : (
                <Eye className="size-4" aria-hidden />
              )}
              {allRevealed ? "重新遮住" : "全部顯示"}
            </Button>
          )}
        </div>
        {/* 等寬欄、字數排在名稱下方:五組都在時 320px 寬也排得進一列 */}
        <div
          role="group"
          aria-label="詞性篩選"
          className="grid auto-cols-fr grid-flow-col gap-1"
        >
          {POS_FILTERS.filter(({ key }) => key === "all" || counts[key] > 0).map(
            ({ key, label }) => (
              <button
                key={key}
                type="button"
                aria-pressed={filter === key}
                onClick={() => onPosFilterChange(key)}
                className={buttonVariants({
                  variant: "outline",
                  size: "sm",
                  className: cn("flex-col gap-0 px-1 leading-5", TOGGLE_BUTTON),
                })}
              >
                {label}{" "}
                <span className="text-[11px] leading-3.5 tabular-nums">{counts[key]}</span>
              </button>
            ),
          )}
        </div>
      </div>
      <ul ref={listRef}>
        {shown.map((v) => {
          const isAdded = added.has(v.id);
          // 隱藏假名時,含漢字讀音的字不顯示重音列(它寫出完整讀音);純假名字照常顯示
          const readingHidden = furigana === "hide" && v.ruby.some((s) => s.r !== undefined);
          const spoken = speechText(v); // 名稱與實際朗讀一致(同複習/練習的 SpeakButton)
          // 純假名字:重音標記本身就是標題,不再重複列一份相同的假名
          const pitchHead = kanaHeadword(v);
          // 段落標記(読み物/会話/補充單字)改徽章;其餘 note(搭配、說明)照常顯示
          const section = noteSection(v.note);
          const note = displayNote(v.note);
          // 自我測驗:被遮的欄位未揭示前不渲染;note 常含日文搭配或中文釋義,遮住任一邊時一併隱藏
          const masked = mask !== "none" && !revealed.has(v.id);
          const hideJa = masked && mask === "japanese";
          // 列內鈕的名稱:遮日文時改以釋義辨識(kana 會把答案讀給螢幕閱讀器)
          const who = hideJa ? v.meaning : v.kana;
          const headword =
            pitchHead !== null ? (
              <PitchAccent kana={pitchHead} accent={v.accent} />
            ) : (
              <RubyText segments={v.ruby} furigana={furigana} />
            );
          return (
            <li
              key={v.id}
              id={v.id}
              className={cn(
                ANCHOR_SCROLL_MARGIN,
                // 高亮淡出用過場;減少動態效果時直接消失
                "border-b border-border px-4 py-3 motion-safe:transition-[background-color,box-shadow] motion-safe:duration-500",
                highlighted === v.id && ANCHOR_HIGHLIGHT,
              )}
            >
              <div className="flex items-baseline justify-between gap-3">
                <span className="flex flex-wrap items-center gap-2 text-lg">
                  {mask === "japanese" ? (
                    // relative:往下延伸的點擊區疊在釋義那一行之上;
                    // mr-1.5:發音鈕往左延伸 14px(gap-2 只有 8px),避免蓋到色塊右端
                    <RevealButton
                      open={!hideJa}
                      onToggle={() => toggleRevealed(v.id)}
                      placeholder="顯示日文"
                      context={v.meaning}
                      className="relative -my-2 mr-1.5 py-2"
                      pillClassName="px-3 text-sm leading-7"
                    >
                      {headword}
                    </RevealButton>
                  ) : (
                    headword
                  )}
                  {/* 遮日文時仍可發音:聽音回想 */}
                  {tts && (
                    <SpeakButton
                      text={spoken}
                      ariaLabel={hideJa ? `播放發音:${v.meaning}` : undefined}
                    />
                  )}
                  {pitchHead === null && hasPitch(v.kana, v.accent) && !readingHidden && !hideJa && (
                    <PitchAccent
                      kana={v.kana}
                      accent={v.accent}
                      className="text-sm text-foreground/70"
                    />
                  )}
                </span>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="text-xs text-muted-foreground">{v.pos}</span>
                  {!isAdded ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`加入複習:${who}`}
                      data-row-action={v.id}
                      onClick={(e) => void rowAction(v.id, e.currentTarget, () => onAddOne(v.id))}
                      className={cn(
                        ROW_ICON_BUTTON,
                        "text-muted-foreground hover:text-foreground active:text-foreground",
                      )}
                    >
                      <Plus className="size-4" aria-hidden />
                    </Button>
                  ) : suspended.has(v.id) ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`恢復複習:${who}`}
                      data-row-action={v.id}
                      onClick={(e) =>
                        void rowAction(v.id, e.currentTarget, () => onToggleSuspend(v.id, false))
                      }
                      className={cn(ROW_TEXT_BUTTON, "text-warning")}
                    >
                      已會·恢復
                    </Button>
                  ) : (
                    <span className="flex items-center gap-2">
                      <span className="text-success">
                        <Check className="size-4" aria-hidden />
                        <span className="sr-only">已加入複習</span>
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`標記已會:${who}`}
                        data-row-action={v.id}
                        onClick={(e) =>
                          void rowAction(v.id, e.currentTarget, () => onToggleSuspend(v.id, true))
                        }
                        className={cn(
                          ROW_TEXT_BUTTON,
                          "text-muted-foreground hover:text-foreground active:text-foreground",
                        )}
                      >
                        已會
                      </Button>
                    </span>
                  )}
                </div>
              </div>
              <div className="text-sm text-foreground/70">
                {mask === "meaning" ? (
                  // 不設 relative:列右上 +/已會 鈕往下延伸的點擊區仍疊在它上面
                  <RevealButton
                    open={!masked}
                    onToggle={() => toggleRevealed(v.id)}
                    placeholder="顯示中文"
                    context={v.kana}
                    className="-my-3 py-3"
                    pillClassName="text-xs leading-5"
                  >
                    {v.meaning}
                  </RevealButton>
                ) : (
                  v.meaning
                )}
                {section && <SectionBadge section={section} />}
              </div>
              {note && !masked && <div className="text-xs text-muted-foreground">{note}</div>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** 「隱藏中譯」開關(文型、会話共用;F7.1):名稱固定,狀態由 aria-pressed 表示(同「假名」)。靠右(ml-auto) */
function HideTranslationsToggle({
  hidden,
  onChange,
}: {
  hidden: boolean;
  onChange: (hidden: boolean) => void;
}) {
  return (
    <Button
      variant="outline"
      size="sm"
      aria-pressed={hidden}
      onClick={() => onChange(!hidden)}
      className={cn("ml-auto gap-1.5", TOGGLE_BUTTON)}
    >
      {/* 圖示表示中譯目前看不看得到 */}
      {hidden ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
      隱藏中譯
    </Button>
  );
}

/** 文型/会話分頁頂端的工具列(隱藏中譯;会話另有全部播放與扮演) */
function Toolbar({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2 px-4 pt-2">{children}</div>;
}

/** 例句/会話的中譯:隱藏中譯時改為點擊揭示 */
function Translation({
  sentence,
  hidden,
  open,
  onToggle,
}: {
  sentence: Sentence;
  hidden: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  if (!hidden) return sentence.translation;
  return (
    // 往下延伸 8px(不超過與下一句的間距,文型例句 space-y-2)。往上:
    // - 遮住時延伸 20px 到句子本身(點句揭示),點擊區 44px
    // - 揭示後只延伸 8px,留在例句行(leading-ruby)字下的半行距(約 9px)內,不蓋到日文字
    //   (長按查字、選字不受影響);再點遮回是次要操作,點擊區 32px
    <RevealButton
      open={open}
      onToggle={onToggle}
      placeholder="顯示中譯"
      className={cn("-mb-2 pb-2", open ? "-mt-2 pt-2" : "-mt-5 pt-5")}
      pillClassName="text-xs leading-4"
    >
      {sentence.translation}
    </RevealButton>
  );
}

/** 句子的朗讀文字:ruby 表面串接後清理教材記號(同複習頁例句) */
function sentenceSpeech(s: Sentence): string {
  return speechText(s.ruby.map((seg) => seg.b).join(""));
}

/**
 * 例句/台詞的發音鈕(T11.2):排在文字欄右側(li 為 flex、gap-4),圖示與句子第一行(leading-ruby 35.2px)垂直置中。
 * 44px 點擊區左右各延伸 14px,gap-4(16px)讓它不蓋到文字欄內的揭示鈕(中譯、台詞佔位、下一句)。
 * `belowSpeaker`:句子上方有說話者列(text-xs 16px + mb-0.5)時下移對齊句子。
 */
function SentenceSpeakButton({
  text,
  ariaLabel,
  belowSpeaker = false,
}: {
  text: string;
  ariaLabel: string;
  belowSpeaker?: boolean;
}) {
  return (
    <SpeakButton
      text={text}
      ariaLabel={ariaLabel}
      className={belowSpeaker ? "mt-3.5" : "-mt-1"}
    />
  );
}

/**
 * 全部播放中目前句的停止鈕(F7.2):取代該句的發音鈕,位置與點擊區相同(SpeakButton 的圖示鈕)。
 * 目前句會自動捲入畫面:長会話中工具列的「停止」捲出畫面時,也不必捲回頂端才能停止。
 */
function LineStopButton({
  onStop,
  belowSpeaker,
}: {
  onStop: (button: HTMLButtonElement) => void;
  belowSpeaker: boolean;
}) {
  return (
    <button
      type="button"
      aria-label="停止播放"
      onClick={(e) => onStop(e.currentTarget)}
      className={buttonVariants({
        variant: "ghost",
        size: "icon",
        className: cn(
          "relative -m-3.5 font-normal text-link hover:bg-transparent active:bg-transparent",
          belowSpeaker ? "mt-3.5" : "-mt-1",
        ),
      })}
    >
      <Square className="size-4 fill-current" aria-hidden />
    </button>
  );
}

function GrammarList({
  lesson,
  furigana,
  tts,
  hideTranslations,
  onHideTranslationsChange,
}: {
  lesson: Lesson;
  furigana: FuriganaMode;
  /** 設定「TTS 發音」;false 時不渲染發音鈕 */
  tts: boolean;
  hideTranslations: boolean;
  onHideTranslationsChange: (hidden: boolean) => void;
}) {
  const { revealed, setRevealed, toggleRevealed } = useRevealed();
  const setHidden = (hidden: boolean) => {
    onHideTranslationsChange(hidden);
    setRevealed(new Set());
  };
  if (lesson.grammar.length === 0) {
    return <Empty>本課沒有文型</Empty>;
  }
  return (
    <div>
      <Toolbar>
        <HideTranslationsToggle hidden={hideTranslations} onChange={setHidden} />
      </Toolbar>
      {lesson.grammar.map((g) => (
        <section
          key={g.id}
          id={g.id}
          className={cn(ANCHOR_SCROLL_MARGIN, "border-b border-border px-4 py-3")}
        >
          <h2 lang={jaLang(g.pattern)} className="font-medium">
            {g.pattern}
          </h2>
          <p className="mt-1 text-sm text-foreground/70">{g.explanation}</p>
          <ul className="mt-2 space-y-2">
            {g.examples.map((s) => {
              const spoken = sentenceSpeech(s);
              return (
                <li key={s.id} className="flex items-start gap-4">
                  <div className="min-w-0 flex-1">
                    {/* 行高足以容納 furigana:有無讀音的行距一致 */}
                    <div className="leading-ruby">
                      <RubyText segments={s.ruby} furigana={furigana} />
                    </div>
                    <div className="text-xs text-muted-foreground">
                      <Translation
                        sentence={s}
                        hidden={hideTranslations}
                        open={revealed.has(s.id)}
                        onToggle={() => toggleRevealed(s.id)}
                      />
                    </div>
                  </div>
                  {tts && (
                    // 名稱帶句子(同單字的「顯示中文:あそびます」):一課數十顆鈕在輔助技術的清單中可分辨
                    <SentenceSpeakButton text={spoken} ariaLabel={`播放例句發音:${spoken}`} />
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** 会話全部播放中的狀態(F7.2) */
interface Playback {
  steps: PlaybackStep[];
  /** 目前步驟(高亮的台詞) */
  index: number;
  /** 停在扮演的台詞,等使用者說完按「下一句」 */
  waiting: boolean;
}

/** 目前句捲入畫面時讓出底部導覽列(4rem + safe-area;頂端的分頁列由 ANCHOR_SCROLL_MARGIN 讓出) */
const BOTTOM_SCROLL_MARGIN = "scroll-mb-[calc(4rem_+_env(safe-area-inset-bottom))]";

/** 元素在視窗中看得到的範圍(視窗座標):扣掉它的 scroll-margin(黏在頂端的分頁列、固定的底部導覽列) */
function visibleBounds(el: HTMLElement): { top: number; bottom: number } {
  const style = getComputedStyle(el);
  return {
    top: parseFloat(style.scrollMarginTop) || 0,
    bottom: window.innerHeight - (parseFloat(style.scrollMarginBottom) || 0),
  };
}

/** 元素完全在看得到的範圍外 */
function isOutOfView(el: HTMLElement): boolean {
  const { top, bottom } = visibleBounds(el);
  const rect = el.getBoundingClientRect();
  return rect.bottom <= top || rect.top >= bottom;
}

/**
 * 把元素捲入畫面、讓出它的 scroll-margin(黏在頂端的分頁列、固定的底部導覽列);已完整可見則不捲。
 * 回傳是否捲動。不用 scrollIntoView({ block: "nearest" }):Chromium 只看元素本身是否在視窗內,
 * 被底部導覽列擋住(元素仍在視窗內)時不會捲動。
 */
function scrollIntoViewNearest(el: HTMLElement, behavior: ScrollBehavior): boolean {
  const { top, bottom } = visibleBounds(el);
  const rect = el.getBoundingClientRect();
  let delta = 0;
  if (rect.top < top) delta = rect.top - top;
  // 比可見範圍高時對齊上緣(先看到說話者與句首)
  else if (rect.bottom > bottom) delta = Math.min(rect.bottom - bottom, rect.top - top);
  if (delta === 0) return false;
  window.scrollTo({ top: window.scrollY + delta, behavior });
  return true;
}

/** 自動捲動後的這段時間內(平滑捲動可能仍在進行),上一句還沒捲入不算使用者捲離 */
const AUTO_SCROLL_SETTLE_MS = 1000;

/**
 * 会話分頁(F7.2):逐句發音、全部播放(目前句高亮、可停止)與角色扮演。
 * - 標題行(dialogue.ts isTitleLine)顯示為台詞上方的小標,不列入播放與扮演
 * - 扮演:所選說話者的台詞以「顯示台詞」佔位遮住(可點擊偷看);播放到時暫停並顯示「下一句」,
 *   使用者說完再按,該句揭示後繼續。重新播放或換角色時再遮住
 * - 被遮台詞的中譯是開口的提示:沒有隱藏中譯時照常顯示(純文字);隱藏中譯時不顯示
 *   (與其他句一樣看不到中譯;不另設點擊揭示,以免與佔位鈕的點擊區重疊),揭示台詞後同其他句可點擊揭示
 * - 播放中目前句捲入畫面,其發音鈕換成停止鈕(工具列捲出畫面時也按得到);使用者把上一句捲出畫面
 *   (往回看)時不再把畫面拉回,輪到扮演的台詞(要按「下一句」)仍會捲入
 * - 全部播放與扮演只靠語音運作:TTS 關閉或沒有日語 voice 時整個隱藏(`canPlay`)
 * - 播放狀態只在本元件:換分頁或離開頁面(卸載)即停止;扮演的說話者由頁面保存(換分頁保留)
 */
function DialogueList({
  lesson,
  furigana,
  tts,
  canPlay,
  hideTranslations,
  onHideTranslationsChange,
  roleChoice,
  onRoleChange,
}: {
  lesson: Lesson;
  furigana: FuriganaMode;
  /** 設定「TTS 發音」;false 時不渲染發音鈕 */
  tts: boolean;
  /** TTS 開啟且有日語 voice:顯示全部播放與扮演 */
  canPlay: boolean;
  hideTranslations: boolean;
  onHideTranslationsChange: (hidden: boolean) => void;
  /** 扮演的說話者(null = 不扮演) */
  roleChoice: string | null;
  onRoleChange: (speaker: string | null) => void;
}) {
  const { revealed, setRevealed, toggleRevealed } = useRevealed();
  const setHidden = (hidden: boolean) => {
    onHideTranslationsChange(hidden);
    setRevealed(new Set());
  };
  const dialogues = lesson.dialogues;
  const speakers = useMemo(() => speakersOf(dialogues), [dialogues]);
  const speech = useMemo(
    () => new Map(dialogues.map((d) => [d.id, sentenceSpeech(d)])),
    [dialogues],
  );
  // 扮演的說話者:不能播放時一併失效,不留下無法解除的遮罩
  const role = canPlay ? roleChoice : null;
  // 扮演時已揭示的台詞(按「下一句」或點擊佔位)
  const [roleRevealed, setRoleRevealed] = useState<ReadonlySet<string>>(new Set());
  const [playback, setPlayback] = useState<Playback | null>(null);
  // 進行中的 speakSequence 的取消函式;runRef 每次開始/停止遞增,舊一輪的回呼一律忽略
  const cancelRef = useRef<(() => void) | null>(null);
  const runRef = useRef(0);
  const playRef = useRef<HTMLButtonElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const lineRefs = useRef(new Map<string, HTMLLIElement>());
  // 以鍵盤揭示台詞時,佔位鈕消失後焦點交給同一句的下一顆鈕
  const refocusLine = useRef<string | null>(null);
  const roleLabelId = useId();

  const stop = useCallback(() => {
    runRef.current++;
    cancelRef.current?.();
    cancelRef.current = null;
    setPlayback(null);
  }, []);
  // 卸載(換分頁、離開頁面)時停止播放
  useEffect(() => stop, [stop]);

  const currentId = playback ? playback.steps[playback.index].lineId : null;
  const waiting = playback?.waiting === true;
  // 上一次的目前句:判斷使用者是否已把畫面捲離播放位置
  const prevCurrentRef = useRef<string | null>(null);
  // 上一次自動捲動的時間(performance.now)
  const autoScrollAtRef = useRef(Number.NEGATIVE_INFINITY);
  // 目前句(含「下一句」鈕)捲入畫面,已在畫面內不捲;減少動態效果時不平滑捲動。
  // 使用者把上一句捲出畫面(往回看前文)時不拉回;開始播放與輪到扮演的台詞一律捲。
  // 剛自動捲動過(短句讀完時平滑捲動可能還沒把上一句捲入)不算捲離,否則會從此不再跟隨
  useEffect(() => {
    const prevId = prevCurrentRef.current;
    prevCurrentRef.current = currentId;
    const el = currentId === null ? undefined : lineRefs.current.get(currentId);
    if (!el) return;
    const prev = prevId === null || prevId === currentId ? undefined : lineRefs.current.get(prevId);
    const settling = performance.now() - autoScrollAtRef.current < AUTO_SCROLL_SETTLE_MS;
    if (!waiting && !settling && prev && isOutOfView(prev)) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    if (scrollIntoViewNearest(el, reduce ? "auto" : "smooth")) {
      autoScrollAtRef.current = performance.now();
    }
  }, [currentId, waiting]);
  // 停在扮演的台詞:焦點在播放鈕、上一次按「下一句」後停放的台詞列(或無焦點)時移到「下一句」,
  // 鍵盤可直接繼續
  useEffect(() => {
    if (!waiting) return;
    const active = document.activeElement;
    if (
      active === null ||
      active === document.body ||
      active === playRef.current ||
      (active instanceof HTMLLIElement && [...lineRefs.current.values()].includes(active))
    ) {
      nextRef.current?.focus({ preventScroll: true });
    }
  }, [waiting, currentId]);
  useEffect(() => {
    const id = refocusLine.current;
    if (id === null) return;
    refocusLine.current = null;
    lineRefs.current.get(id)?.querySelector<HTMLElement>("button")?.focus();
  }, [roleRevealed]);

  if (dialogues.length === 0) {
    return <Empty>本課沒有会話</Empty>;
  }

  const title = isTitleLine(dialogues[0], 0) ? dialogues[0] : null;
  const lines = title ? dialogues.slice(1) : dialogues;

  // 從第 start 步播放:連續的 speak 一次交給 speakSequence;遇到 wait(扮演的台詞)停下等「下一句」
  const run = (steps: PlaybackStep[], start: number, runId: number) => {
    if (runId !== runRef.current) return;
    cancelRef.current = null;
    if (start >= steps.length) {
      setPlayback(null);
      return;
    }
    if (steps[start].action === "wait") {
      setPlayback({ steps, index: start, waiting: true });
      return;
    }
    let end = start;
    while (end < steps.length && steps[end].action === "speak") end++;
    setPlayback({ steps, index: start, waiting: false });
    cancelRef.current = speakSequence(
      steps.slice(start, end).map((step) => speech.get(step.lineId) ?? ""),
      {
        onStart: (i) => {
          if (runId === runRef.current) setPlayback({ steps, index: start + i, waiting: false });
        },
        onEnd: (finished) => {
          if (runId !== runRef.current) return;
          if (finished) {
            run(steps, end, runId);
          } else {
            // 被單句發音鈕等其他朗讀中斷、或引擎出錯:回到待機
            cancelRef.current = null;
            setPlayback(null);
          }
        },
      },
    );
  };

  const play = () => {
    stop();
    setRoleRevealed(new Set()); // 重新遮住扮演的台詞
    run(buildPlayback(dialogues, { role }), 0, runRef.current);
  };

  const next = (button: HTMLButtonElement) => {
    if (!playback?.waiting) return;
    const { steps, index } = playback;
    // 焦點在「下一句」上(鍵盤操作):它將消失,先停放在這句台詞列(不在按鈕上:再按 Enter
    // 不會誤觸停止;列就在畫面內),下次暫停再移回「下一句」
    if (document.activeElement === button) {
      lineRefs.current.get(steps[index].lineId)?.focus({ preventScroll: true });
    }
    setRoleRevealed((prev) => new Set(prev).add(steps[index].lineId));
    run(steps, index + 1, runRef.current);
  };

  const stopAtLine = (id: string, button: HTMLButtonElement) => {
    // 鍵盤操作:停止鈕將換回發音鈕,焦點先停放在這句台詞列(不掉到 body)
    if (document.activeElement === button) lineRefs.current.get(id)?.focus({ preventScroll: true });
    stop();
  };

  const changeRole = (speaker: string) => {
    stop();
    onRoleChange(role === speaker ? null : speaker);
    setRoleRevealed(new Set());
  };

  const revealLine = (id: string) => {
    const active = document.activeElement;
    if (active instanceof HTMLElement && lineRefs.current.get(id)?.contains(active)) {
      refocusLine.current = id;
    }
    setRoleRevealed((prev) => new Set(prev).add(id));
  };

  const playing = playback !== null;
  const lastStep = playback !== null && playback.index === playback.steps.length - 1;

  return (
    <div>
      <Toolbar>
        {canPlay && (
          // 同一顆鈕切換播放/停止:按下後焦點留在原處
          <Button
            ref={playRef}
            variant="outline"
            size="sm"
            onClick={playing ? stop : play}
            className="gap-1.5 font-normal"
          >
            {playing ? (
              <Square className="size-4" aria-hidden />
            ) : (
              <Play className="size-4" aria-hidden />
            )}
            {playing ? "停止" : "全部播放"}
          </Button>
        )}
        <HideTranslationsToggle hidden={hideTranslations} onChange={setHidden} />
        {/* 扮演:aria-pressed 開關,再按一次取消(同一時間只扮演一位);w-full 排在播放列下方 */}
        {canPlay && speakers.length > 0 && (
          // 標籤與 chips 分欄:chips 換行時對齊第一顆,不縮到「扮演」下方;標籤行高同按鈕(44px)對齊第一列
          <div role="group" aria-labelledby={roleLabelId} className="flex w-full items-start gap-1">
            <span
              id={roleLabelId}
              className="mr-1 shrink-0 text-sm leading-11 text-muted-foreground"
            >
              扮演
            </span>
            <div className="flex min-w-0 flex-1 flex-wrap gap-1">
              {speakers.map((speaker) => (
                <button
                  key={speaker}
                  type="button"
                  lang="ja"
                  aria-pressed={role === speaker}
                  onClick={() => changeRole(speaker)}
                  className={buttonVariants({
                    variant: "outline",
                    size: "sm",
                    className: cn("min-w-11", TOGGLE_BUTTON),
                  })}
                >
                  {speaker}
                </button>
              ))}
            </div>
          </div>
        )}
      </Toolbar>
      {/* 会話標題(L15/L23/L24/L41):台詞上方的小標,不是說話者的台詞 */}
      {title && (
        <div className="px-4 pt-3">
          <h2 className="leading-ruby font-bold">
            <RubyText segments={title.ruby} furigana={furigana} />
          </h2>
          <div className="text-xs text-muted-foreground">
            <Translation
              sentence={title}
              hidden={hideTranslations}
              open={revealed.has(title.id)}
              onToggle={() => toggleRevealed(title.id)}
            />
          </div>
        </div>
      )}
      <ul className="py-2">
        {lines.map((d) => {
          const isRole = role !== null && d.speaker?.trim() === role;
          const masked = isRole && !roleRevealed.has(d.id);
          const current = d.id === currentId;
          return (
            <li
              key={d.id}
              ref={(el) => {
                if (el) lineRefs.current.set(d.id, el);
                else lineRefs.current.delete(d.id);
              }}
              aria-current={current ? "step" : undefined}
              // 按「下一句」後鍵盤焦點停放處(見 next);不在 Tab 順序內
              tabIndex={-1}
              className={cn(
                ANCHOR_SCROLL_MARGIN,
                BOTTOM_SCROLL_MARGIN,
                "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
                // 目前句高亮(同單字錨點):淡底 + 左側色條;減少動態效果時直接切換
                "flex items-start gap-4 px-4 py-2 motion-safe:transition-[background-color,box-shadow] motion-safe:duration-300",
                current && ANCHOR_HIGHLIGHT,
              )}
            >
              <div className="min-w-0 flex-1">
                {d.speaker && (
                  <div className="mb-0.5 text-xs text-muted-foreground">
                    <span lang="ja">{d.speaker}</span>
                    {isRole && (
                      <span className="ml-1.5 inline-block rounded bg-link/10 px-1.5 align-[0.0625em] text-[11px] leading-4 text-link">
                        你
                      </span>
                    )}
                  </div>
                )}
                <div className="leading-ruby">
                  {masked ? (
                    // 點擊區往上延伸 16px 到說話者列(非互動文字),下方不延伸:不蓋到中譯與「下一句」
                    <RevealButton
                      open={false}
                      onToggle={() => revealLine(d.id)}
                      placeholder="顯示台詞"
                      // 名稱帶看得到的中譯(「顯示台詞:謝謝你。」)以分辨各句;隱藏中譯時不帶(不從名稱洩漏)
                      context={hideTranslations ? undefined : d.translation}
                      className="-mt-4 pt-4"
                      pillClassName="px-3 text-sm leading-7"
                    >
                      {null}
                    </RevealButton>
                  ) : (
                    <RubyText segments={d.ruby} furigana={furigana} />
                  )}
                </div>
                {masked ? (
                  !hideTranslations && (
                    <div className="text-xs text-muted-foreground">{d.translation}</div>
                  )
                ) : (
                  <div className="text-xs text-muted-foreground">
                    <Translation
                      sentence={d}
                      hidden={hideTranslations}
                      open={revealed.has(d.id)}
                      onToggle={() => toggleRevealed(d.id)}
                    />
                  </div>
                )}
                {current && waiting && (
                  // pt-2:與上方中譯(遮住時往下延伸 8px 的點擊區)不重疊
                  <div className="pt-2">
                    <Button
                      ref={nextRef}
                      size="sm"
                      onClick={(e) => next(e.currentTarget)}
                      className="gap-1.5"
                    >
                      {lastStep ? "完成" : "下一句"}
                      {lastStep ? (
                        <Check className="size-4" aria-hidden />
                      ) : (
                        <Play className="size-4" aria-hidden />
                      )}
                    </Button>
                  </div>
                )}
              </div>
              {current ? (
                <LineStopButton
                  onStop={(button) => stopAtLine(d.id, button)}
                  belowSpeaker={Boolean(d.speaker)}
                />
              ) : (
                // 被遮的台詞不給發音鈕(會洩漏答案);揭示後可聽範讀
                tts &&
                !masked && (
                  <SentenceSpeakButton
                    text={speech.get(d.id) ?? ""}
                    ariaLabel={d.speaker ? `播放 ${d.speaker} 的台詞` : "播放台詞發音"}
                    belowSpeaker={Boolean(d.speaker)}
                  />
                )
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-4 py-8 text-center text-sm text-muted-foreground">
      {children}
    </p>
  );
}
