"use client";

import { useState } from "react";
import Link from "next/link";
import { RubyText, type FuriganaMode } from "@/components/RubyText";
import { requeueWrong, type RequeueResult } from "@/lib/srs";
import type { QuizCandidate } from "@/lib/quiz";

export interface QuizResultItem {
  card: QuizCandidate;
  correct: boolean;
}

const LAST_LESSON = 50;

/** 錯題加入複習的實際結果(每個字只歸入一類);全部原本就在今日佇列時回傳整句說明。 */
export function describeRequeue(r: RequeueResult): string {
  const parts = [
    r.created > 0 && `新加入 ${r.created}`,
    r.requeued > 0 && `提前到今天 ${r.requeued}`,
    r.tomorrow > 0 && `明天複習 ${r.tomorrow}`,
    r.unsuspended > 0 && `恢復 ${r.unsuspended}`,
    r.alreadyDue > 0 && `已在今日佇列 ${r.alreadyDue}`,
    r.pendingNew > 0 && `待學新卡 ${r.pendingNew}`,
  ].filter((p): p is string => typeof p === "string");
  if (parts.length === 1 && r.alreadyDue > 0) return "錯題皆已在今日複習佇列中";
  return parts.join(" · ");
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
  const [outcome, setOutcome] = useState<RequeueResult | null>(null);

  async function addWrongToReview() {
    if (busy || outcome) return;
    setBusy(true);
    try {
      setOutcome(
        await requeueWrong(
          wrong.map((r) => r.card.id),
          lessonId,
        ),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="px-4 py-8">
      <h1 className="text-center text-lg font-bold">測驗完成</h1>
      <p className="mt-4 text-center text-3xl font-bold">
        {correct} / {results.length}
      </p>

      {wrong.length === 0 ? (
        <p className="mt-6 text-center text-sm text-green-700">全部答對 🎉</p>
      ) : (
        <>
          <div className="mt-6">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-medium">錯題({wrong.length})</h2>
              <button
                type="button"
                onClick={() => void addWrongToReview()}
                disabled={busy || outcome !== null}
                className="rounded border border-foreground/20 px-3 py-1 text-xs disabled:opacity-40"
              >
                {outcome === null
                  ? "錯題加入複習"
                  : requeueChanged(outcome)
                    ? "已加入複習"
                    : "已在複習中"}
              </button>
            </div>
            {/* live region 先掛載、結果出來再填入,螢幕閱讀器才會播報 */}
            <div
              role="status"
              className="text-right text-xs text-foreground/70"
            >
              {outcome && (
                <div className="mb-2">
                  <p>{describeRequeue(outcome)}</p>
                  {outcome.tomorrow > 0 && (
                    <p className="mt-0.5 text-foreground/60">
                      今天已複習過的字,明天再出現
                    </p>
                  )}
                  {outcome.created + outcome.pendingNew > 0 && (
                    <p className="mt-0.5 text-foreground/60">
                      新卡依每日新卡上限陸續出現
                    </p>
                  )}
                </div>
              )}
            </div>
            <ul className="divide-y divide-foreground/10 border-y border-foreground/10">
              {wrong.map((r) => (
                <li
                  key={r.card.id}
                  className="flex items-baseline justify-between gap-3 py-2"
                >
                  <span className="text-lg">
                    <RubyText segments={r.card.ruby} furigana={furigana} />
                  </span>
                  <span className="text-sm text-foreground/60">
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
            <button
              type="button"
              onClick={onRestart}
              className="inline-flex min-h-11 flex-1 items-center justify-center rounded-lg border border-foreground/20 px-4 font-medium"
            >
              再測一次
            </button>
          )}
          {lessonId < LAST_LESSON && (
            <Link
              href={`/quiz/${lessonId + 1}`}
              className="inline-flex min-h-11 flex-1 items-center justify-center rounded-lg bg-sky-600 px-4 font-medium text-white transition-colors active:bg-sky-700"
            >
              下一課測驗 →
            </Link>
          )}
        </div>
        <Link
          href={`/lessons/${lessonId}`}
          className="inline-flex min-h-11 items-center px-3 text-sm text-sky-700 underline dark:text-sky-400"
        >
          回課程
        </Link>
      </div>
    </div>
  );
}
