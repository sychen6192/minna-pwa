"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Minus, Plus } from "lucide-react";
import { Loading } from "@/components/Loading";
import { Button, buttonVariants } from "@/components/ui/button";
import type { ConjForm } from "@/lib/conjugate";
import { getLesson } from "@/lib/content";
import {
  DEFAULT_MAX_LESSON,
  DRILL_COUNT,
  DRILL_GROUPS,
  LAST_LESSON,
  availableGroupForms,
  drillPool,
  formLabel,
  formLabelLang,
  groupFormLesson,
  groupOf,
  makeDrillRound,
  parseUpto,
  type DrillGroup,
  type DrillItem,
  type DrillSelection,
} from "@/lib/drill";
import { UPTO_PARAM } from "@/lib/urlParams";
import { useSetting, useTtsEnabled } from "@/lib/useSetting";
import { cn } from "@/lib/utils";
import type { Lesson, RubySeg } from "@/schemas/lesson";
import { DrillQuestionView } from "./DrillQuestionView";
import { DrillResult } from "./DrillResult";
import {
  EMPTY_ANSWER,
  loadDrillState,
  saveDrillState,
  returningFromGrammar,
  type DrillAnswer,
  type DrillRound,
  type DrillState,
} from "./drillState";

/** 開關鈕按下時的樣子(同課程頁的分段鈕) */
const TOGGLE_BUTTON =
  "font-normal text-muted-foreground aria-pressed:border-link aria-pressed:bg-link/10 aria-pressed:text-link";

const formKey = (group: DrillGroup, form: ConjForm) => `${group}:${form}`;

function clampLesson(n: number): number {
  return Math.min(LAST_LESSON, Math.max(1, Math.round(n)));
}

/** 初始範圍:網址 ?upto= → 已有卡片的最大課號 → 預設第 14 課(卡片以 db.ts 讀取,動態載入) */
async function initialRange(
  upto: number | null,
): Promise<Pick<DrillState, "maxLesson" | "source">> {
  if (upto !== null) return { maxLesson: upto, source: "upto" };
  try {
    const { db } = await import("@/lib/db");
    const last = await db.cards.orderBy("lessonId").last();
    return last
      ? { maxLesson: clampLesson(last.lessonId), source: "cards" }
      : { maxLesson: DEFAULT_MAX_LESSON, source: "default" };
  } catch {
    return { maxLesson: DEFAULT_MAX_LESSON, source: "fallback" };
  }
}

/** 活用練習(T11.4,F7.3):範圍與形的設定 → 10 題(選擇/輸入)→ 結果。不寫入 SRS/DB。 */
export default function DrillPage() {
  const [state, setState] = useState<DrillState | null>(null);
  const [lessons, setLessons] = useState<ReadonlyMap<number, Lesson>>(
    new Map(),
  );
  const [error, setError] = useState<string | null>(null);
  const furigana = useSetting("furigana");
  const ttsEnabled = useTtsEnabled();
  // 從結果頁「換範圍」回到設定畫面:焦點移到標題(按鈕已卸載,不掉到 body)
  const [focusSetup, setFocusSetup] = useState(false);

  // 初始化(記憶體中的狀態,?upto= 指定了別的範圍則一律重新設定):
  // - 從「看文法」連結返回:接續原畫面(回饋或結果頁)
  // - 回合進行中:接續
  // - 其餘(結果頁或設定畫面):回到設定;範圍重新推算(卡片可能已增加),使用者調整過的範圍
  //   在沒有 ?upto= 時沿用;勾選的形沿用
  useEffect(() => {
    let active = true;
    const upto = parseUpto(window.location.search);
    const prev = loadDrillState();
    const returning = returningFromGrammar();
    const sameRange = upto === null || upto === prev?.maxLesson;
    if (prev && sameRange && (returning || (prev.round && !prev.round.done))) {
      setState(prev);
      return;
    }
    const excluded = prev?.excluded ?? [];
    if (prev && prev.source === "manual" && upto === null) {
      setState({ ...prev, round: null });
      return;
    }
    void initialRange(upto).then((range) => {
      if (active) setState({ ...range, excluded, round: null });
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (state) saveDrillState(state);
  }, [state]);

  // 載入第 1–maxLesson 課(content.ts 有記憶體快取;範圍縮小時沿用已載入者)
  const maxLesson = state?.maxLesson ?? null;
  useEffect(() => {
    if (maxLesson === null) return;
    const missing = Array.from({ length: maxLesson }, (_, i) => i + 1).filter(
      (id) => !lessons.has(id),
    );
    if (missing.length === 0) return;
    let active = true;
    Promise.all(missing.map((id) => getLesson(id)))
      .then((loaded) => {
        if (!active) return;
        setLessons(
          (prev) =>
            new Map([...prev, ...loaded.map((l) => [l.id, l] as const)]),
        );
      })
      .catch((e: unknown) => {
        if (active) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      active = false;
    };
  }, [maxLesson, lessons]);

  const pool = useMemo<DrillItem[] | null>(() => {
    if (maxLesson === null) return null;
    for (let id = 1; id <= maxLesson; id++) if (!lessons.has(id)) return null;
    return drillPool([...lessons.values()], maxLesson);
  }, [lessons, maxLesson]);

  const selection = useMemo<DrillSelection | null>(() => {
    if (!state) return null;
    const excluded = new Set(state.excluded);
    const pick = (group: DrillGroup) =>
      availableGroupForms(group, state.maxLesson).filter(
        (f) => !excluded.has(formKey(group, f)),
      );
    return { verb: pick("verb"), adj: pick("adj") };
  }, [state]);

  if (error) {
    return (
      <p className="px-4 py-8 text-center text-sm text-destructive">
        載入課程失敗:{error}
      </p>
    );
  }
  // 設定讀到後才渲染:接續的題目不先閃出 furigana、回饋的發音鈕不晚一步出現
  if (
    !state ||
    !selection ||
    furigana === undefined ||
    ttsEnabled === undefined
  ) {
    return <Loading />;
  }

  const update = (patch: Partial<DrillState>) =>
    setState((s) => (s ? { ...s, ...patch } : s));
  const setRound = (round: DrillRound | null) => update({ round });

  function start() {
    if (!pool || !selection || !state) return;
    const questions = makeDrillRound(pool, selection, {
      maxLesson: state.maxLesson,
    });
    setRound({
      questions,
      index: 0,
      answer: EMPTY_ANSWER,
      results: [],
      done: questions.length === 0,
    });
  }

  const { round } = state;
  if (round && round.done) {
    return (
      <DrillResult
        results={round.results}
        furigana={furigana}
        canRestart={pool !== null}
        onRestart={start}
        onChangeRange={() => {
          setFocusSetup(true);
          setRound(null);
        }}
      />
    );
  }
  if (round) {
    const question = round.questions[round.index];
    const answer = (next: DrillAnswer, given: RubySeg[]) =>
      setRound({
        ...round,
        answer: next,
        results: [...round.results, { question, correct: next.correct, given }],
      });
    const next = () =>
      setRound(
        round.index + 1 >= round.questions.length
          ? { ...round, done: true }
          : { ...round, index: round.index + 1, answer: EMPTY_ANSWER },
      );
    return (
      <DrillQuestionView
        key={`${round.index}`}
        question={question}
        index={round.index}
        total={round.questions.length}
        answer={round.answer}
        furigana={furigana}
        tts={ttsEnabled}
        onInputChange={(input) =>
          setRound({ ...round, answer: { ...round.answer, input } })
        }
        onAnswer={answer}
        onNext={next}
      />
    );
  }

  return (
    <DrillSetup
      state={state}
      pool={pool}
      selection={selection}
      focusHeading={focusSetup}
      onRangeChange={(n) => {
        const maxLesson = clampLesson(n);
        update({ maxLesson, source: "manual" });
        // 範圍寫回網址(replaceState 不新增歷史紀錄):從「看文法」返回或重新整理時 ?upto= 與範圍一致
        // (SW 查 precache 時忽略此參數,離線重新整理亦可,urlParams.ts)
        window.history.replaceState(null, "", `?${UPTO_PARAM}=${maxLesson}`);
      }}
      onToggle={(group, form) => {
        const key = formKey(group, form);
        update({
          excluded: state.excluded.includes(key)
            ? state.excluded.filter((k) => k !== key)
            : [...state.excluded, key],
        });
      }}
      onStart={start}
    />
  );
}

/** 範圍說明:預設值的來源(使用者調整過範圍 = manual,不再顯示) */
function rangeHint(state: DrillState): string | null {
  switch (state.source) {
    case "cards":
      return "預設為已加入複習的最後一課。";
    case "default":
      return `還沒有加入複習的單字,先以第 1–${DEFAULT_MAX_LESSON} 課為範圍,可自行調整。`;
    default:
      return null;
  }
}

function DrillSetup({
  state,
  pool,
  selection,
  focusHeading,
  onRangeChange,
  onToggle,
  onStart,
}: {
  state: DrillState;
  /** 出題池;載入中為 null */
  pool: DrillItem[] | null;
  selection: DrillSelection;
  /** 掛載時焦點移到標題(從結果頁「換範圍」回來) */
  focusHeading: boolean;
  onRangeChange: (maxLesson: number) => void;
  onToggle: (group: DrillGroup, form: ConjForm) => void;
  onStart: () => void;
}) {
  const rangeId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (focusHeading) headingRef.current?.focus();
    // 只在掛載時
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const { maxLesson } = state;
  const excluded = new Set(state.excluded);
  const counts: Record<DrillGroup, number> = { verb: 0, adj: 0 };
  for (const item of pool ?? []) {
    const group = groupOf(item.pos);
    if (group) counts[group]++;
  }
  const anyAvailable = DRILL_GROUPS.some(
    ({ group }) => availableGroupForms(group, maxLesson).length > 0,
  );
  const selectedCount = DRILL_GROUPS.reduce(
    (n, { group }) => n + (counts[group] > 0 ? selection[group].length : 0),
    0,
  );
  const hint = rangeHint(state);
  const firstLesson = Math.min(
    ...DRILL_GROUPS.flatMap(({ group, forms }) =>
      forms.map((f) => groupFormLesson(group, f)),
    ),
  );

  return (
    <div>
      <h1
        ref={headingRef}
        tabIndex={-1}
        className="px-4 pt-3 text-lg font-bold outline-none"
      >
        活用練習
      </h1>
      <p className="px-4 pt-1 pb-3 text-sm text-muted-foreground">
        依課程進度練習動詞與形容詞的活用形;單次練習,不影響複習排程。
      </p>

      <section
        aria-labelledby={rangeId}
        className="mx-4 rounded-xl border border-border bg-card p-4"
      >
        <div className="flex items-center gap-2">
          <h2 id={rangeId} className="mr-auto text-sm font-medium">
            範圍
          </h2>
          <Button
            variant="outline"
            size="icon"
            aria-label="範圍減少一課"
            disabled={maxLesson <= 1}
            onClick={() => onRangeChange(maxLesson - 1)}
          >
            <Minus className="size-4" aria-hidden />
          </Button>
          <select
            aria-labelledby={rangeId}
            value={maxLesson}
            onChange={(e) => onRangeChange(Number(e.target.value))}
            className="h-11 rounded-lg border border-input bg-background px-3 text-base tabular-nums"
          >
            {Array.from({ length: LAST_LESSON }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                {n === 1 ? "第 1 課" : `第 1–${n} 課`}
              </option>
            ))}
          </select>
          <Button
            variant="outline"
            size="icon"
            aria-label="範圍增加一課"
            disabled={maxLesson >= LAST_LESSON}
            onClick={() => onRangeChange(maxLesson + 1)}
          >
            <Plus className="size-4" aria-hidden />
          </Button>
        </div>
        {hint && <p className="mt-2 text-xs text-muted-foreground">{hint}</p>}
      </section>

      {DRILL_GROUPS.map(({ group, label, forms }) => {
        const headingId = `${rangeId}-${group}`;
        const empty = pool !== null && counts[group] === 0;
        return (
          <section
            key={group}
            aria-labelledby={headingId}
            className="px-4 pt-5"
          >
            <h2
              id={headingId}
              className="mb-2 flex items-baseline gap-2 text-sm font-medium"
            >
              {label}{" "}
              <span className="text-xs font-normal text-muted-foreground tabular-nums">
                {pool === null ? "…" : `${counts[group]} 個`}
              </span>
            </h2>
            <div
              role="group"
              aria-labelledby={headingId}
              className="flex flex-wrap gap-2"
            >
              {forms.map((form) => {
                const lesson = groupFormLesson(group, form);
                const locked = lesson > maxLesson;
                const pressed =
                  !locked && !empty && !excluded.has(formKey(group, form));
                const name = formLabel(group, form);
                return (
                  <button
                    key={form}
                    type="button"
                    aria-pressed={pressed}
                    disabled={locked || empty}
                    onClick={() => onToggle(group, form)}
                    className={buttonVariants({
                      variant: "outline",
                      size: "sm",
                      className: cn("flex-col gap-0 leading-5", TOGGLE_BUTTON),
                    })}
                  >
                    <span lang={formLabelLang(name)}>{name}</span>
                    {locked && (
                      <span className="text-[11px] leading-3.5">
                        第 {lesson} 課學
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}

      {/*
        黏在底部導覽上方:小螢幕上不必捲到最下面才能開始。底部導覽實際比 4rem 矮,
        after 以背景色往下延伸,蓋住與導覽之間的縫(延伸部分在導覽之下,不影響版面)
      */}
      <div className="sticky bottom-[calc(4rem_+_env(safe-area-inset-bottom))] mt-3 bg-background px-4 pt-3 pb-2 after:absolute after:inset-x-0 after:top-full after:h-4 after:bg-background">
        <Button
          onClick={onStart}
          disabled={pool === null || selectedCount === 0}
          className="h-12 w-full"
        >
          開始練習({DRILL_COUNT} 題)
        </Button>
        <p
          className="mt-2 text-center text-xs text-muted-foreground"
          aria-live="polite"
        >
          {!anyAvailable
            ? `第 ${firstLesson} 課起才有可練習的活用形。`
            : pool === null
              ? "載入單字中…"
              : selectedCount === 0
                ? "請至少選一種形。"
                : null}
        </p>
      </div>
    </div>
  );
}
