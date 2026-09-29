"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { Check, Eye, EyeOff, Plus } from "lucide-react";
import { Loading } from "@/components/Loading";
import { PitchAccent, hasPitch } from "@/components/PitchAccent";
import { RubyText, type FuriganaMode } from "@/components/RubyText";
import { SpeakButton } from "@/components/SpeakButton";
import { Button, buttonVariants } from "@/components/ui/button";
import { getLesson } from "@/lib/content";
import { jaLang } from "@/lib/lang";
import { lessonTabHash, parseLessonHash, type LessonTab } from "@/lib/lessonHash";
import { displayNote, isSupplementary, noteSection, type VocabSection } from "@/lib/notes";
import { kanaHeadword } from "@/lib/pitch";
import { capNote } from "@/lib/queueNote";
import {
  addCards,
  existingCardIds,
  queueCounts,
  setWordSuspended,
  suspendedWordIds,
} from "@/lib/srs";
import { speechText } from "@/lib/tts";
import { useSetting, useTtsEnabled } from "@/lib/useSetting";
import { cn } from "@/lib/utils";
import type { Lesson } from "@/schemas/lesson";

type Tab = LessonTab;

const TABS: { key: Tab; label: string }[] = [
  { key: "vocab", label: "単語" },
  { key: "grammar", label: "文型" },
  { key: "dialogue", label: "会話" },
];

const LAST_LESSON = 50;

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
  // 設定讀到後才渲染內容,避免先閃出 furigana / 發音鈕
  const ready = lesson !== null && globalFurigana !== undefined && ttsEnabled !== undefined;
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [suspended, setSuspendedIds] = useState<Set<string>>(new Set());
  // 上兩者的初始值已讀到(讀取失敗也算):單字錨點等它才捲動(見下方)
  const [cardStateLoaded, setCardStateLoaded] = useState(false);
  // 整課加入的結果(「已加入 N 字 · 開始複習 →」);未整課加入為 null
  const [addAllResult, setAddAllResult] = useState<AddAllResult | null>(null);
  const headerRef = useRef<HTMLElement>(null);

  useEffect(() => {
    let active = true;
    getLesson(id)
      .then((data) => {
        if (active) setLesson(data);
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

  const navLink = buttonVariants({ variant: "ghost", size: "sm", className: "gap-1 font-normal" });

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
            className="ml-3 gap-1.5 font-normal text-muted-foreground aria-pressed:border-link aria-pressed:bg-link/10 aria-pressed:text-link"
          >
            {furigana === "show" ? (
              <Eye className="size-4" aria-hidden />
            ) : (
              <EyeOff className="size-4" aria-hidden />
            )}
            假名
          </Button>
        </div>
        {/* 流程互連:本課測驗、上/下一課(不必回列表找) */}
        <nav aria-label="課程導覽" className="mt-2 flex items-center gap-2">
          <Link
            href={`/quiz/${lesson.id}`}
            className={buttonVariants({ variant: "outline", size: "sm", className: "font-normal" })}
          >
            測驗本課
          </Link>
          <div className="ml-auto flex items-center">
            {lesson.id > 1 && (
              <Link href={`/lessons/${lesson.id - 1}`} className={navLink}>
                <span aria-hidden>‹</span>上一課
              </Link>
            )}
            {lesson.id < LAST_LESSON && (
              <Link href={`/lessons/${lesson.id + 1}`} className={navLink}>
                下一課<span aria-hidden>›</span>
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
          onAddOne={addOne}
          onAddAll={addAll}
          onToggleSuspend={toggleSuspend}
        />
      )}
      {tab === "grammar" && <GrammarList lesson={lesson} furigana={furigana} />}
      {tab === "dialogue" && (
        <DialogueList lesson={lesson} furigana={furigana} />
      )}
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

function VocabList({
  lesson,
  furigana,
  tts,
  added,
  suspended,
  addAllResult,
  highlighted,
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

  return (
    <div>
      <div className="flex items-center justify-end gap-3 px-4 py-2">
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
      <ul ref={listRef}>
        {lesson.vocab.map((v) => {
          const isAdded = added.has(v.id);
          // 隱藏假名時,含漢字讀音的字不顯示重音列(它寫出完整讀音);純假名字照常顯示
          const readingHidden = furigana === "hide" && v.ruby.some((s) => s.r !== undefined);
          const spoken = speechText(v); // 名稱與實際朗讀一致(同複習/練習的 SpeakButton)
          // 純假名字:重音標記本身就是標題,不再重複列一份相同的假名
          const pitchHead = kanaHeadword(v);
          // 段落標記(読み物/会話/補充單字)改徽章;其餘 note(搭配、說明)照常顯示
          const section = noteSection(v.note);
          const note = displayNote(v.note);
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
                  {pitchHead !== null ? (
                    <PitchAccent kana={pitchHead} accent={v.accent} />
                  ) : (
                    <RubyText segments={v.ruby} furigana={furigana} />
                  )}
                  {tts && <SpeakButton text={spoken} />}
                  {pitchHead === null && hasPitch(v.kana, v.accent) && !readingHidden && (
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
                      aria-label={`加入複習:${v.kana}`}
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
                      aria-label={`恢復複習:${v.kana}`}
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
                        aria-label={`標記已會:${v.kana}`}
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
                {v.meaning}
                {section && <SectionBadge section={section} />}
              </div>
              {note && <div className="text-xs text-muted-foreground">{note}</div>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function GrammarList({
  lesson,
  furigana,
}: {
  lesson: Lesson;
  furigana: FuriganaMode;
}) {
  if (lesson.grammar.length === 0) {
    return <Empty>本課沒有文型</Empty>;
  }
  return (
    <div>
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
            {g.examples.map((s) => (
              <li key={s.id}>
                {/* 行高足以容納 furigana:有無讀音的行距一致 */}
                <div className="leading-ruby">
                  <RubyText segments={s.ruby} furigana={furigana} />
                </div>
                <div className="text-xs text-muted-foreground">
                  {s.translation}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function DialogueList({
  lesson,
  furigana,
}: {
  lesson: Lesson;
  furigana: FuriganaMode;
}) {
  if (lesson.dialogues.length === 0) {
    return <Empty>本課沒有会話</Empty>;
  }
  return (
    <ul className="px-4 py-2">
      {lesson.dialogues.map((d) => (
        <li key={d.id} className="py-2">
          {d.speaker && (
            <div lang="ja" className="mb-0.5 text-xs text-muted-foreground">
              {d.speaker}
            </div>
          )}
          <div className="leading-ruby">
            <RubyText segments={d.ruby} furigana={furigana} />
          </div>
          <div className="text-xs text-muted-foreground">{d.translation}</div>
        </li>
      ))}
    </ul>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-4 py-8 text-center text-sm text-muted-foreground">
      {children}
    </p>
  );
}
