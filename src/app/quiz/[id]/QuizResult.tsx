"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { RubyText, type FuriganaMode } from "@/components/RubyText";
import { Button, buttonVariants } from "@/components/ui/button";
import { queueCounts, requeueWrong, type RequeueResult } from "@/lib/srs";
import type { QuizCandidate } from "@/lib/quiz";
import { useEntryClickGuard } from "@/lib/useTapGuard";

export interface QuizResultItem {
  card: QuizCandidate;
  correct: boolean;
}

const LAST_LESSON = 50;

/**
 * 錯題加入複習的實際結果(每個字只歸入一類);全部原本就到期時回傳整句說明。
 * `reviewCapReached`:今日複習額度已用完(queueCounts),到期的字依到期先後排隊、不一定
 * 今天出現,此時不宣稱「今日」。
 */
export function describeRequeue(r: RequeueResult, reviewCapReached = false): string {
  const parts = [
    r.created > 0 && `新加入 ${r.created}`,
    r.requeued > 0 && `${reviewCapReached ? "提前到期" : "提前到今天"} ${r.requeued}`,
    r.tomorrow > 0 && `明天複習 ${r.tomorrow}`,
    r.unsuspended > 0 && `恢復 ${r.unsuspended}`,
    r.alreadyDue > 0 && `${reviewCapReached ? "已到期" : "已在今日佇列"} ${r.alreadyDue}`,
    r.pendingNew > 0 && `待學新卡 ${r.pendingNew}`,
  ].filter((p): p is string => typeof p === "string");
  if (parts.length === 1 && r.alreadyDue > 0) {
    return reviewCapReached ? "錯題皆已到期" : "錯題皆已在今日複習佇列中";
  }
  return parts.join(" · ");
}

/** 加入複習的結果 + 當下今日複習額度是否已用完 */
interface Outcome {
  result: RequeueResult;
  reviewCapReached: boolean;
}

/** 是否有字因這次操作而加入/恢復/提前(否則錯題本來就都在複習中)。 */
function requeueChanged(r: RequeueResult): boolean {
  return r.created + r.requeued + r.tomorrow + r.unsuspended > 0;
}

export function QuizResult({
  results,
  lessonId,
  furigana = "show",
  onRestart,
}: {
  results: QuizResultItem[];
  lessonId: number;
  furigana?: FuriganaMode;
  /** 以同一課重新出題(QuizRunner 提供) */
  onRestart?: () => void;
}) {
  const wrong = results.filter((r) => !r.correct);
  const correct = results.length - wrong.length;
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  // 進結果頁時「看結果」鈕已卸載:焦點移到標題(不掉到 body),螢幕閱讀器從成績開始念
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, []);
  // 剛進結果頁(TAP_GUARD_MS 內)的點擊不觸發按鈕與連結:雙擊「看結果」的第二下不會
  // 再測一次、換到下一課或把錯題加入複習(結果只在記憶體,離開就看不到)
  const guardClick = useEntryClickGuard();
  // 同步防重入(state 要等重繪才生效)
  const submitting = useRef(false);

  async function addWrongToReview() {
    if (submitting.current || outcome) return;
    submitting.current = true;
    setBusy(true);
    try {
      const now = Date.now();
      const result = await requeueWrong(
        wrong.map((r) => r.card.id),
        lessonId,
        now,
      );
      // 提前的卡排在逾期卡之後:今日複習額度用完時不一定今天出現(讀不到時照一般說明)
      const counts = await queueCounts(now).catch(() => null);
      setOutcome({ result, reviewCapReached: counts?.reviewCapReached === true });
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  // 以 aria-disabled 取代 disabled:按下後焦點留在按鈕上(disabled 會把焦點丟到 body),
  // 結果由下方 live region 播報
  const requeueLocked = busy || outcome !== null;

  return (
    <div className="px-4 py-8" onClickCapture={guardClick}>
      <h1 ref={headingRef} tabIndex={-1} className="text-center text-lg font-bold outline-none">
        測驗完成
      </h1>
      <p className="mt-4 text-center text-3xl font-bold">
        {correct} / {results.length}
      </p>

      {wrong.length === 0 ? (
        <p className="mt-6 text-center text-sm text-success">全部答對 🎉</p>
      ) : (
        <>
          <div className="mt-6">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-medium">錯題({wrong.length})</h2>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void addWrongToReview()}
                aria-disabled={requeueLocked}
                className="font-normal aria-disabled:cursor-default aria-disabled:opacity-50"
              >
                {outcome === null
                  ? "錯題加入複習"
                  : requeueChanged(outcome.result)
                    ? "已加入複習"
                    : "已在複習中"}
              </Button>
            </div>
            {/* live region 先掛載、結果出來再填入,螢幕閱讀器才會播報 */}
            <div
              role="status"
              className="text-right text-xs text-foreground/70"
            >
              {outcome && (
                <div className="mb-2">
                  <p>{describeRequeue(outcome.result, outcome.reviewCapReached)}</p>
                  {outcome.reviewCapReached &&
                    outcome.result.requeued + outcome.result.alreadyDue > 0 && (
                      <p className="mt-0.5 text-muted-foreground">
                        今日複習已達上限,到期的字依到期先後出現,不一定在今天
                      </p>
                    )}
                  {outcome.result.tomorrow > 0 && (
                    <p className="mt-0.5 text-muted-foreground">
                      今天已複習過的字,明天再出現
                    </p>
                  )}
                  {outcome.result.created + outcome.result.pendingNew > 0 && (
                    <p className="mt-0.5 text-muted-foreground">
                      新卡依每日新卡上限陸續出現
                    </p>
                  )}
                </div>
              )}
            </div>
            <ul className="divide-y divide-border border-y border-border">
              {wrong.map((r) => (
                <li
                  key={r.card.id}
                  className="flex items-baseline justify-between gap-3 py-2"
                >
                  <span className="text-lg">
                    <RubyText segments={r.card.ruby} furigana={furigana} />
                  </span>
                  <span className="text-sm text-muted-foreground">
                    {r.card.meaning}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}

      <div className="mt-8 flex flex-col items-center gap-1">
        <div className="flex w-full max-w-xs gap-2">
          {onRestart && (
            <Button variant="outline" onClick={onRestart} className="flex-1 px-4">
              再測一次
            </Button>
          )}
          {lessonId < LAST_LESSON && (
            <Link
              href={`/quiz/${lessonId + 1}`}
              className={buttonVariants({ className: "flex-1 px-4" })}
            >
              下一課測驗 →
            </Link>
          )}
        </div>
        <Link
          href={`/lessons/${lessonId}`}
          className={buttonVariants({ variant: "link", className: "px-3 text-sm" })}
        >
          回課程
        </Link>
      </div>
    </div>
  );
}
