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
  DRILL_LEVELS,
  LAST_LESSON,
  availableGroupForms,
  drillPool,
  drillableCounts,
  formLabel,
  formLabelLang,
  groupFormLesson,
  groupOf,
  levelForms,
  makeDrillRound,
  parseUpto,
  type DrillGroup,
  type DrillItem,
  type DrillSelection,
} from "@/lib/drill";
import {
  PARTICLE_COUNT,
  PARTICLE_FIRST_LESSON,
  makeParticleRound,
  particlePool,
  type ParticleItem,
} from "@/lib/particles";
import { drillSearch, parseDrillMode, type DrillMode } from "@/lib/urlParams";
import { useSetting, useTtsEnabled } from "@/lib/useSetting";
import { cn } from "@/lib/utils";
import type { Lesson, RubySeg } from "@/schemas/lesson";
import { DrillQuestionView } from "./DrillQuestionView";
import { DrillResult } from "./DrillResult";
import { ParticleQuestionView } from "./ParticleQuestionView";
import { ParticleResult } from "./ParticleResult";
import { ParticleSetup } from "./ParticleSetup";
import {
  EMPTY_ANSWER,
  loadDrillState,
  saveDrillState,
  returningFromGrammar,
  type DrillAnswer,
  type DrillRound,
  type DrillState,
  type ParticleRound,
} from "./drillState";

/** 開關鈕按下時的樣子(同課程頁的分段鈕) */
const TOGGLE_BUTTON =
  "font-normal text-muted-foreground aria-pressed:border-link aria-pressed:bg-link/10 aria-pressed:text-link";

const formKey = (group: DrillGroup, form: ConjForm) => `${group}:${form}`;

/** 練習類型的分段鈕 */
const MODES: readonly { mode: DrillMode; label: string }[] = [
  { mode: "conj", label: "活用" },
  { mode: "particle", label: "助詞" },
];

/** 目前類型的回合(活用 / 助詞搭配) */
function currentRound(state: DrillState): DrillRound | ParticleRound | null {
  return state.mode === "conj" ? state.round : state.particleRound;
}

/**
 * 網址寫回範圍與類型(replaceState 不新增歷史紀錄):從「看文法」返回或重新整理時一致
 * (SW 查 precache 時忽略這些參數,離線重新整理亦可,urlParams.ts)。範圍只在來自網址或
 * 使用者調整時寫出,其餘(依卡片推算)留給下次重新推算
 */
function syncUrl(state: Pick<DrillState, "mode" | "maxLesson" | "source">) {
  const explicit = state.source === "manual" || state.source === "upto";
  const search = drillSearch(explicit ? state.maxLesson : null, state.mode);
  window.history.replaceState(null, "", search || window.location.pathname);
}

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

/**
 * 活用練習(T11.4、T11.5,F7.3)與助詞搭配(T11.7,F7.5):類型、範圍(與形)的設定 → 10 題 → 結果。
 * 不寫入 SRS/DB。
 */
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

  // 初始化(記憶體中的狀態,?upto= / ?mode= 指定了別的範圍或類型則一律重新設定):
  // - 類型:?mode= → 帶 ?upto= 而沒有 mode 者為活用(課程頁的「活用練習」連結;本頁寫回的網址
  //   助詞搭配必帶 mode)→ 記憶體中上次的類型 → 活用
  // - 從「看文法」連結返回:接續原畫面(回饋或結果頁)
  // - 回合進行中:接續
  // - 其餘(結果頁或設定畫面):回到設定;範圍重新推算(卡片可能已增加),使用者調整過的範圍
  //   在沒有 ?upto= 時沿用;勾選的形沿用
  useEffect(() => {
    let active = true;
    const search = window.location.search;
    const upto = parseUpto(search);
    const prev = loadDrillState();
    const mode: DrillMode =
      parseDrillMode(search) ??
      (upto !== null ? "conj" : (prev?.mode ?? "conj"));
    // 沿用記憶體中的助詞搭配(網址沒有 ?mode=)時寫回網址:重新整理後仍是助詞搭配
    const settle = (next: DrillState) => {
      setState(next);
      if (next.mode === "particle" && parseDrillMode(search) === null)
        syncUrl(next);
    };
    const returning = returningFromGrammar();
    const sameRange = upto === null || upto === prev?.maxLesson;
    const prevRound = prev ? currentRound(prev) : null;
    if (
      prev &&
      prev.mode === mode &&
      sameRange &&
      (returning || (prevRound && !prevRound.done))
    ) {
      settle(prev);
      return;
    }
    const excluded = prev?.excluded ?? [];
    const noRounds = { round: null, particleRound: null };
    if (prev && prev.source === "manual" && upto === null) {
      settle({ ...prev, mode, ...noRounds });
      return;
    }
    void initialRange(upto).then((range) => {
      if (active) settle({ ...range, mode, excluded, ...noRounds });
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

  // 第 1–maxLesson 課全部載入後才有出題池(載入中為 null)
  const loaded = useMemo<Lesson[] | null>(() => {
    if (maxLesson === null) return null;
    for (let id = 1; id <= maxLesson; id++) if (!lessons.has(id)) return null;
    return [...lessons.values()];
  }, [lessons, maxLesson]);
  const pool = useMemo<DrillItem[] | null>(
    () =>
      loaded === null || maxLesson === null
        ? null
        : drillPool(loaded, maxLesson),
    [loaded, maxLesson],
  );
  const particles = useMemo<ParticleItem[] | null>(
    () =>
      loaded === null || maxLesson === null
        ? null
        : particlePool(loaded, maxLesson),
    [loaded, maxLesson],
  );

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
  const setParticleRound = (particleRound: ParticleRound | null) =>
    update({ particleRound });

  function start() {
    if (!state) return;
    if (state.mode === "particle") {
      if (!particles) return;
      const questions = makeParticleRound(particles);
      setParticleRound({
        questions,
        index: 0,
        selected: null,
        results: [],
        done: questions.length === 0,
      });
      return;
    }
    if (!pool || !selection) return;
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

  const { particleRound } = state;
  if (state.mode === "particle" && particleRound?.done) {
    return (
      <ParticleResult
        results={particleRound.results}
        furigana={furigana}
        canRestart={particles !== null}
        onRestart={start}
        onChangeRange={() => {
          setFocusSetup(true);
          setParticleRound(null);
        }}
      />
    );
  }
  if (state.mode === "particle" && particleRound) {
    const question = particleRound.questions[particleRound.index];
    return (
      <ParticleQuestionView
        key={`${particleRound.index}`}
        question={question}
        index={particleRound.index}
        total={particleRound.questions.length}
        selected={particleRound.selected}
        furigana={furigana}
        tts={ttsEnabled}
        onAnswer={(selected) =>
          setParticleRound({
            ...particleRound,
            selected,
            results: [
              ...particleRound.results,
              { question, selected, correct: selected === question.answer },
            ],
          })
        }
        onNext={() =>
          setParticleRound(
            particleRound.index + 1 >= particleRound.questions.length
              ? { ...particleRound, done: true }
              : {
                  ...particleRound,
                  index: particleRound.index + 1,
                  selected: null,
                },
          )
        }
      />
    );
  }

  const round = state.mode === "conj" ? state.round : null;
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
      particles={particles}
      selection={selection}
      focusHeading={focusSetup}
      onModeChange={(mode) => {
        if (mode === state.mode) return;
        update({ mode, round: null, particleRound: null });
        syncUrl({ ...state, mode });
      }}
      onRangeChange={(n) => {
        const maxLesson = clampLesson(n);
        update({ maxLesson, source: "manual" });
        syncUrl({ mode: state.mode, maxLesson, source: "manual" });
      }}
      onToggle={(group, form) => {
        const key = formKey(group, form);
        update({
          excluded: state.excluded.includes(key)
            ? state.excluded.filter((k) => k !== key)
            : [...state.excluded, key],
        });
      }}
      onSetForms={(group, forms, on) => {
        const keys = new Set(forms.map((f) => formKey(group, f)));
        const rest = state.excluded.filter((k) => !keys.has(k));
        update({ excluded: on ? rest : [...rest, ...keys] });
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
  particles,
  selection,
  focusHeading,
  onModeChange,
  onRangeChange,
  onToggle,
  onSetForms,
  onStart,
}: {
  state: DrillState;
  /** 活用練習的出題池;載入中為 null */
  pool: DrillItem[] | null;
  /** 助詞搭配的出題池;載入中為 null */
  particles: ParticleItem[] | null;
  selection: DrillSelection;
  /** 掛載時焦點移到標題(從結果頁「換範圍」回來) */
  focusHeading: boolean;
  onModeChange: (mode: DrillMode) => void;
  onRangeChange: (maxLesson: number) => void;
  onToggle: (group: DrillGroup, form: ConjForm) => void;
  /** 一列(基本/進階)的形全選(on)或取消全選 */
  onSetForms: (
    group: DrillGroup,
    forms: readonly ConjForm[],
    on: boolean,
  ) => void;
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
  // 範圍內的字數(0 則該組的形不可選)
  const counts: Record<DrillGroup, number> = { verb: 0, adj: 0 };
  for (const item of pool ?? []) {
    const group = groupOf(item.pos);
    if (group) counts[group]++;
  }
  // 標題顯示的字數:勾選的形實際能出題者(進階形各有排除,只勾可能形時不算 わかります)
  const drillable = useMemo(
    () => (pool === null ? null : drillableCounts(pool, selection)),
    [pool, selection],
  );
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
  const { mode } = state;
  // 形的 chips 只在活用練習顯示
  const conjGroups = mode === "conj" ? DRILL_GROUPS : [];
  // 開始鈕與其下的提示(依類型)
  const particleCount = particles?.length ?? 0;
  const canStart =
    mode === "conj"
      ? pool !== null && selectedCount > 0
      : particles !== null && particleCount > 0;
  // 助詞搭配:範圍內的搭配不足 10 個時為全部;沒有搭配時不標題數
  const questionCount =
    mode === "conj"
      ? DRILL_COUNT
      : particles === null
        ? PARTICLE_COUNT
        : Math.min(PARTICLE_COUNT, particleCount);
  const startHint =
    mode === "conj"
      ? !anyAvailable
        ? `第 ${firstLesson} 課起才有可練習的活用形。`
        : pool === null
          ? "載入單字中…"
          : selectedCount === 0
            ? "請至少選一種形。"
            : null
      : maxLesson < PARTICLE_FIRST_LESSON
        ? `第 ${PARTICLE_FIRST_LESSON} 課起才有教材標註的助詞搭配。`
        : particles === null
          ? "載入單字中…"
          : null;

  return (
    <div>
      <h1
        ref={headingRef}
        tabIndex={-1}
        className="px-4 pt-3 text-lg font-bold outline-none"
      >
        活用・助詞練習
      </h1>
      {/* 分段按鈕(aria-pressed,同課程頁分頁):切換練習類型;範圍兩者共用 */}
      <div
        role="group"
        aria-label="練習類型"
        className="mx-4 mt-2 flex border-b border-border"
      >
        {MODES.map(({ mode: m, label }) => (
          <button
            key={m}
            type="button"
            aria-pressed={mode === m}
            onClick={() => onModeChange(m)}
            className={cn(
              "-mb-px min-h-11 flex-1 border-b-2 text-sm transition-colors",
              mode === m
                ? "border-foreground font-medium"
                : "border-transparent text-muted-foreground",
            )}
          >
            {label}
          </button>
        ))}
      </div>
      <p className="px-4 pt-3 pb-3 text-sm text-muted-foreground">
        {mode === "conj"
          ? "依課程進度練習動詞與形容詞的活用形;"
          : "依課程進度練習單字的助詞搭配;"}
        單次練習,不影響複習排程。
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

      {mode === "particle" && <ParticleSetup particles={particles} />}

      {conjGroups.map(({ group, label }) => {
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
              className="flex items-baseline gap-2 text-sm font-medium"
            >
              {label}{" "}
              <span className="text-xs font-normal text-muted-foreground tabular-nums">
                {drillable === null ? "…" : `${drillable[group]} 個`}
              </span>
            </h2>
            {/* 形 chips 分兩列:基本形、進階形(第 27 課起;形容詞為條件形),各列可全選/取消全選 */}
            <div role="group" aria-labelledby={headingId} className="space-y-1">
              {DRILL_LEVELS.map(({ level, label: levelLabel }) => {
                const forms = levelForms(group, level);
                if (forms.length === 0) return null;
                const levelId = `${headingId}-${level}`;
                const selectable = empty
                  ? []
                  : forms.filter((f) => groupFormLesson(group, f) <= maxLesson);
                const allOn = selectable.every(
                  (f) => !excluded.has(formKey(group, f)),
                );
                const toggleText = allOn ? "取消全選" : "全選";
                return (
                  <div key={level} role="group" aria-labelledby={levelId}>
                    <div className="flex min-h-11 items-center justify-between">
                      <h3
                        id={levelId}
                        className="text-xs text-muted-foreground"
                      >
                        {levelLabel}
                      </h3>
                      {selectable.length >= 2 && (
                        <button
                          type="button"
                          aria-label={`${toggleText}:${label}・${levelLabel}`}
                          onClick={() => onSetForms(group, selectable, !allOn)}
                          className="-mr-2 inline-flex min-h-11 min-w-11 items-center justify-end px-2 text-xs text-link underline-offset-4 hover:underline"
                        >
                          {toggleText}
                        </button>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {forms.map((form) => {
                        const lesson = groupFormLesson(group, form);
                        const locked = lesson > maxLesson;
                        const pressed =
                          !locked &&
                          !empty &&
                          !excluded.has(formKey(group, form));
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
                              className: cn(
                                "flex-col gap-0 leading-5",
                                TOGGLE_BUTTON,
                              ),
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
                  </div>
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
        <Button onClick={onStart} disabled={!canStart} className="h-12 w-full">
          {questionCount > 0 ? `開始練習(${questionCount} 題)` : "開始練習"}
        </Button>
        <p
          className="mt-2 text-center text-xs text-muted-foreground"
          aria-live="polite"
        >
          {startHint}
        </p>
      </div>
    </div>
  );
}
