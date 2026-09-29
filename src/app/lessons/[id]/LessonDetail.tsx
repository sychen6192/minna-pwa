"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Eye, EyeOff, Plus } from "lucide-react";
import { Loading } from "@/components/Loading";
import { PitchAccent, hasPitch } from "@/components/PitchAccent";
import { RubyText, type FuriganaMode } from "@/components/RubyText";
import { SpeakButton } from "@/components/SpeakButton";
import { Button } from "@/components/ui/button";
import { getLesson } from "@/lib/content";
import { jaLang } from "@/lib/lang";
import { kanaHeadword } from "@/lib/pitch";
import { addCards, existingCardIds, setWordSuspended, suspendedWordIds } from "@/lib/srs";
import { speechText } from "@/lib/tts";
import { useSetting, useTtsEnabled } from "@/lib/useSetting";
import { cn } from "@/lib/utils";
import type { Lesson } from "@/schemas/lesson";

type Tab = "vocab" | "grammar" | "dialogue";

const TABS: { key: Tab; label: string }[] = [
  { key: "vocab", label: "単語" },
  { key: "grammar", label: "文型" },
  { key: "dialogue", label: "会話" },
];

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
      })
      .catch(() => {});
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

  // 文法錨點深連結(F4.1):#Lxx-Gxx → 切至文型分頁(內容渲染後),
  // 待文型分頁 commit 後再捲動(rAF 不保證分頁已渲染,設定載入改變時序後常捲不到)
  const [anchor, setAnchor] = useState<string | null>(null);
  useEffect(() => {
    if (!ready) return;
    const hash = decodeURIComponent(window.location.hash.slice(1));
    if (!/-G\d+$/.test(hash)) return;
    setTab("grammar");
    setAnchor(hash);
  }, [ready]);
  useEffect(() => {
    if (!anchor || tab !== "grammar") return;
    document.getElementById(anchor)?.scrollIntoView({ block: "start" });
    setAnchor(null);
  }, [anchor, tab]);

  const addOne = useCallback(
    async (cardId: string) => {
      if (!lesson) return;
      await addCards([cardId], lesson.id);
      setAdded((prev) => new Set(prev).add(cardId));
    },
    [lesson],
  );

  const addAll = useCallback(async () => {
    if (!lesson) return;
    const ids = lesson.vocab.map((v) => v.id);
    await addCards(ids, lesson.id);
    setAdded(new Set(ids));
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

  return (
    <div>
      <header className="flex items-start justify-between px-4 py-3">
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
      </header>

      {/* 分段按鈕(aria-pressed):一次只按下一個;不宣告 tablist(未實作 tabpanel 與方向鍵) */}
      <div role="group" aria-label="課程內容" className="flex border-b border-border">
        {TABS.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            lang="ja"
            aria-pressed={tab === key}
            onClick={() => setTab(key)}
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

function VocabList({
  lesson,
  furigana,
  tts,
  added,
  suspended,
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
  onAddOne: (cardId: string) => Promise<void>;
  onAddAll: () => void;
  onToggleSuspend: (cardId: string, next: boolean) => Promise<void>;
}) {
  const allAdded = lesson.vocab.every((v) => added.has(v.id));
  // 列內的鈕會換成同一位置的另一顆(+ → 已會 → 已會·恢復):
  // - 換鈕後 ROW_CHANGE_GUARD_MS 內忽略該列的點擊:連點兩下的第二下會落在新鈕上(剛加入就被標為已會)
  // - 焦點原在鈕上(鍵盤操作)時,換鈕後交給同一列的新鈕,不掉到 body
  const listRef = useRef<HTMLUListElement>(null);
  const changedAt = useRef(new Map<string, number>());
  const refocusId = useRef<string | null>(null);

  useEffect(() => {
    const id = refocusId.current;
    if (id === null) return;
    refocusId.current = null;
    listRef.current?.querySelector<HTMLElement>(`[data-row-action="${id}"]`)?.focus();
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
      <div className="flex justify-end px-4 py-2">
        <Button
          variant="outline"
          size="sm"
          onClick={onAddAll}
          disabled={allAdded}
          className="font-normal"
        >
          {allAdded ? "整課已加入" : "整課加入複習"}
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
          return (
            <li key={v.id} className="border-b border-border px-4 py-3">
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
              <div className="text-sm text-foreground/70">{v.meaning}</div>
              {v.note && (
                <div className="text-xs text-muted-foreground">{v.note}</div>
              )}
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
          className="scroll-mt-4 border-b border-border px-4 py-3"
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
