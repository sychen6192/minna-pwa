"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { Volume2 } from "lucide-react";
import { Loading } from "@/components/Loading";
import { RubyText, type FuriganaMode } from "@/components/RubyText";
import { Button, buttonVariants } from "@/components/ui/button";
import { getLesson } from "@/lib/content";
import { DEFAULT_SETTINGS, getSetting, setSetting } from "@/lib/db";
import { jaLang } from "@/lib/lang";
import { displayNote } from "@/lib/notes";
import {
  QUESTION_TYPES,
  answerLabel,
  checkAnswer,
  generateQuiz,
  listenText,
  parseQuizTypes,
  quizWordCount,
  type ClozeQuestion,
  type McqQuestion,
  type Question,
  type QuestionType,
  type QuizCandidate,
} from "@/lib/quiz";
import { BOTTOM_NAV_SCROLL_MARGIN, revealAboveNav } from "@/lib/scroll";
import { cancelSpeech, speak } from "@/lib/tts";
import { useJaVoiceAvailable, useTtsEnabled } from "@/lib/useSetting";
import { tapGuarded } from "@/lib/useTapGuard";
import { cn } from "@/lib/utils";
import type { Lesson } from "@/schemas/lesson";
import { QuizResult } from "./QuizResult";

const QUIZ_COUNT = 10;
const NEIGHBOR_OFFSETS = [-2, -1, 1, 2];

/** 開關鈕按下時的樣子(同課程頁、練習頁的分段鈕) */
const TOGGLE_BUTTON =
  "font-normal text-muted-foreground aria-pressed:border-link aria-pressed:bg-link/10 aria-pressed:text-link";

/** 題型選單的名稱 */
const TYPE_LABELS: Readonly<Record<QuestionType, string>> = {
  "jp-to-zh": "日→中",
  "zh-to-jp": "中→日",
  input: "輸入假名",
  cloze: "例句填空",
  listen: "聽力",
};

/** 作答時進度列左側的題型說明 */
const TYPE_PROMPTS: Readonly<Record<QuestionType, string>> = {
  "jp-to-zh": "選出中文意思",
  "zh-to-jp": "選出日文",
  input: "輸入假名讀音",
  cloze: "選出填入空格的詞",
  listen: "聽發音,選出意思",
};

/** 例句填空的句子超過此字數時縮小字級 */
const LONG_CLOZE_CHARS = 30;

type Phase = "loading" | "error" | "setup" | "quiz" | "done";

interface Result {
  card: QuizCandidate;
  correct: boolean;
}

/**
 * 實際出題的題型:儲存的選擇中目前可用者(聽力要有日語語音);全都不可用時(只選了聽力而
 * 此裝置沒有語音)退回預設題型中可用者。
 */
function effectiveTypes(
  selected: readonly QuestionType[],
  listenOk: boolean,
): QuestionType[] {
  const usable = (t: QuestionType) => t !== "listen" || listenOk;
  const on = selected.filter(usable);
  return on.length > 0 ? on : DEFAULT_SETTINGS.quizTypes.filter(usable);
}

/** 題型切換後要儲存的選擇:聽力暫時不可用時保留原本對它的選擇 */
function toggledTypes(
  stored: readonly QuestionType[],
  listenOk: boolean,
  type: QuestionType,
): QuestionType[] {
  const current = effectiveTypes(stored, listenOk);
  const on = new Set(current);
  if (on.has(type)) on.delete(type);
  else on.add(type);
  if (!listenOk && stored.includes("listen")) on.add("listen");
  return QUESTION_TYPES.filter((t) => on.has(t));
}

/** 聽力題:朗讀正解(在點擊事件內呼叫,行動版瀏覽器才會出聲);其他題型則停止上一題的朗讀 */
function playQuestion(q: Question | undefined) {
  if (q?.type === "listen") speak(listenText(q.answer));
  else cancelSpeech();
}

export function QuizRunner({ id }: { id: number }) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [error, setError] = useState<string | null>(null);
  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [pool, setPool] = useState<QuizCandidate[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [furigana, setFurigana] = useState<FuriganaMode>("show");
  // 題型選擇(設定 quizTypes,聽力可能暫時不可用)與本回合實際用的題型(再測一次沿用)
  const [storedTypes, setStoredTypes] = useState<QuestionType[]>(
    DEFAULT_SETTINGS.quizTypes,
  );
  const [roundTypes, setRoundTypes] = useState<QuestionType[]>([]);
  const ttsEnabled = useTtsEnabled();
  const voiceAvailable = useJaVoiceAvailable(ttsEnabled);
  const listenOk = voiceAvailable === true;

  const [index, setIndex] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [checked, setChecked] = useState(false);
  const [lastCorrect, setLastCorrect] = useState<boolean | null>(null);
  const [results, setResults] = useState<Result[]>([]);
  // 焦點接手:作答後被選的選項/輸入框會 disabled(焦點掉到 body)→ 移到「下一題」;
  // 換題後移到新題幹(螢幕閱讀器先念題目)。首次載入不搶焦點
  const nextRef = useRef<HTMLButtonElement>(null);
  const stemRef = useRef<HTMLDivElement>(null);
  const focusStem = useRef(false);
  // 題目出現的時刻(點擊防護:開始測驗、再測一次、下一題時在點擊內記下;雙擊的第二下
  // 落在新題的選項上不作答)
  const shownAt = useRef(0);
  const answered =
    phase === "quiz" && questions[index] !== undefined
      ? questions[index].type === "input"
        ? checked
        : selectedId !== null
      : false;

  useEffect(() => {
    const next = nextRef.current;
    if (!answered || !next) return;
    next.focus();
    revealAboveNav(next);
  }, [answered]);

  useEffect(() => {
    if (!focusStem.current) return;
    focusStem.current = false;
    stemRef.current?.focus();
  }, [index, questions, phase]);

  useEffect(() => {
    let active = true;
    (async () => {
      const target = await getLesson(id);
      const neighborIds = NEIGHBOR_OFFSETS.map((o) => id + o).filter(
        (n) => n >= 1 && n <= 50,
      );
      const neighbors = await Promise.all(
        neighborIds.map((n) => getLesson(n).catch(() => null)),
      );
      const loaded: QuizCandidate[] = [target, ...neighbors]
        .filter((l) => l !== null)
        .flatMap((l) => l.vocab.map((v) => ({ ...v, lessonId: l.id })));
      const [furi, types] = await Promise.all([
        getSetting("furigana"),
        getSetting("quizTypes"),
      ]);
      if (!active) return;
      setFurigana(furi);
      setStoredTypes(parseQuizTypes(types) ?? DEFAULT_SETTINGS.quizTypes);
      setLesson(target);
      setPool(loaded);
      setPhase("setup");
    })().catch((e: unknown) => {
      if (active) {
        setError(e instanceof Error ? e.message : String(e));
        setPhase("error");
      }
    });
    return () => {
      active = false;
    };
  }, [id]);

  if (phase === "loading")
    return (
      <Centered>
        <Loading className="p-0" />
      </Centered>
    );
  if (phase === "error" || lesson === null)
    return (
      <Centered>
        <span className="text-destructive">載入測驗失敗:{error}</span>
      </Centered>
    );

  /** 以指定題型出題並從第 1 題開始(開始測驗、再測一次),作答狀態歸零 */
  function begin(types: QuestionType[]) {
    const qs = generateQuiz(id, pool, {
      count: QUIZ_COUNT,
      types,
      lesson: lesson ?? undefined,
      listenAvailable: listenOk,
    });
    focusStem.current = true;
    shownAt.current = Date.now();
    setRoundTypes(types);
    setQuestions(qs);
    setIndex(0);
    setSelectedId(null);
    setInput("");
    setChecked(false);
    setLastCorrect(null);
    setResults([]);
    setPhase(qs.length === 0 ? "done" : "quiz");
    playQuestion(qs[0]);
  }

  function toggleType(type: QuestionType) {
    const next = toggledTypes(storedTypes, listenOk, type);
    setStoredTypes(next);
    // 寫入失敗(私密瀏覽等)只影響下次的預設,不擋測驗
    void setSetting("quizTypes", next).catch(() => {});
  }

  if (phase === "setup") {
    const selected = effectiveTypes(storedTypes, listenOk);
    return (
      <QuizSetup
        lesson={lesson}
        selected={selected}
        count={Math.min(
          QUIZ_COUNT,
          quizWordCount(id, pool, {
            types: selected,
            lesson,
            listenAvailable: listenOk,
          }),
        )}
        listen={
          ttsEnabled === false
            ? "tts-off"
            : voiceAvailable === false
              ? "no-voice"
              : listenOk
                ? "ok"
                : "checking"
        }
        onToggle={toggleType}
        onStart={() => begin(selected)}
      />
    );
  }

  if (phase === "done") {
    return (
      <QuizResult
        results={results}
        lessonId={id}
        furigana={furigana}
        // 再測一次:同一課、同樣題型重新出題(題目重新抽)
        onRestart={() => begin(roundTypes)}
      />
    );
  }

  const q = questions[index];
  const note = displayNote(q.answer.note);

  function recordResult(correct: boolean) {
    setLastCorrect(correct);
    setResults((r) => [...r, { card: q.answer, correct }]);
  }

  function selectOption(option: McqQuestion["options"][number]) {
    if (selectedId !== null || tapGuarded(shownAt.current)) {
      return;
    }
    setSelectedId(option.id);
    recordResult(option.correct);
  }

  function submitInput() {
    if (checked || input.trim() === "") return;
    setChecked(true);
    recordResult(checkAnswer(input, q.answer));
  }

  function next() {
    if (index + 1 >= questions.length) {
      cancelSpeech();
      setPhase("done");
      return;
    }
    focusStem.current = true;
    shownAt.current = Date.now();
    setIndex((i) => i + 1);
    setSelectedId(null);
    setInput("");
    setChecked(false);
    setLastCorrect(null);
    playQuestion(questions[index + 1]);
  }

  return (
    <div className="flex min-h-[80vh] flex-col">
      {/* 進度(左側為本題題型的作答說明) */}
      <div className="px-4 py-2">
        <div className="flex justify-between gap-3 text-xs text-muted-foreground">
          <span>{TYPE_PROMPTS[q.type]}</span>
          <span className="shrink-0">
            第 {index + 1} / {questions.length} 題
          </span>
        </div>
        <div className="mt-1 h-1 w-full rounded bg-muted">
          <div
            className="h-1 rounded bg-muted-foreground transition-all"
            style={{ width: `${(index / questions.length) * 100}%` }}
          />
        </div>
      </div>

      <div className="flex flex-1 flex-col justify-center gap-6 px-4">
        {/* 題幹(換題後接手焦點) */}
        <div
          ref={stemRef}
          tabIndex={-1}
          className="text-center text-2xl outline-none"
        >
          {q.type === "zh-to-jp" ? (
            q.answer.meaning
          ) : q.type === "jp-to-zh" ? (
            <RubyText segments={q.answer.ruby} furigana={furigana} />
          ) : q.type === "listen" ? (
            <ListenStem question={q} answered={answered} />
          ) : q.type === "cloze" ? (
            <ClozeStem question={q} answered={answered} furigana={furigana} />
          ) : (
            <div className="space-y-2">
              <div className="text-base text-foreground/70">
                {q.answer.meaning}
              </div>
              <RubyText segments={q.answer.ruby} furigana="hide" />
            </div>
          )}
        </div>

        {/* 作答區 */}
        {q.type === "input" ? (
          <InputArea
            value={input}
            checked={checked}
            onChange={setInput}
            onSubmit={submitInput}
          />
        ) : (
          <McqOptions
            question={q}
            furigana={furigana}
            selectedId={selectedId}
            onSelect={selectOption}
          />
        )}

        {/*
          回饋(答錯列出可接受的讀音;搭配 note 如〔電車に〜〕一併提示)。
          live region 先掛載、作答後再填入內容,螢幕閱讀器才會播報
        */}
        <div role="status" className="space-y-1 text-center">
          {answered && (
            <>
              <p
                className={
                  lastCorrect
                    ? "font-medium text-success"
                    : "font-medium text-destructive"
                }
              >
                {lastCorrect ? (
                  "答對 ✓"
                ) : (
                  <>
                    答錯 ✗(<span lang="ja">{answerLabel(q.answer)}</span>)
                  </>
                )}
              </p>
              {note && <p className="text-sm text-foreground/70">{note}</p>}
            </>
          )}
        </div>
      </div>

      <div className="px-4 pb-4">
        <Button
          ref={nextRef}
          onClick={next}
          disabled={!answered}
          className={cn("h-12 w-full", BOTTOM_NAV_SCROLL_MARGIN)}
        >
          {index + 1 >= questions.length ? "看結果" : "下一題"}
        </Button>
      </div>
    </div>
  );
}

/** 聽力題的狀態:可用、設定關閉發音、沒有日語語音、檢查語音中 */
type ListenState = "ok" | "tts-off" | "no-voice" | "checking";

/**
 * 開始前的題型選擇(F3.1):預設全選(聽力要有日語語音),一鍵開始;至少保留一種。
 * 選擇寫入設定 quizTypes,下次沿用。
 */
function QuizSetup({
  lesson,
  selected,
  count,
  listen,
  onToggle,
  onStart,
}: {
  lesson: Lesson;
  selected: readonly QuestionType[];
  /** 以目前題型出題的題數(本課可出題的字較少時少於 10 題) */
  count: number;
  listen: ListenState;
  onToggle: (type: QuestionType) => void;
  onStart: () => void;
}) {
  const headingId = useId();
  const listenHintId = useId();
  // 想取消最後一種題型時的提示(按其他題型後清除)
  const [lastHint, setLastHint] = useState(false);

  function toggle(type: QuestionType) {
    if (selected.length === 1 && selected[0] === type) {
      setLastHint(true);
      return;
    }
    setLastHint(false);
    onToggle(type);
  }

  return (
    <div className="px-4 pt-3 pb-4">
      <h1 className="text-lg font-bold">第 {lesson.id} 課 單字測驗</h1>
      <p lang={jaLang(lesson.title)} className="text-sm text-muted-foreground">
        {lesson.title}
      </p>

      <section
        aria-labelledby={headingId}
        className="mt-4 rounded-xl border border-border bg-card p-4"
      >
        <h2 id={headingId} className="text-sm font-medium">
          題型
        </h2>
        <div
          role="group"
          aria-labelledby={headingId}
          className="mt-2 flex flex-wrap gap-2"
        >
          {QUESTION_TYPES.map((type) => {
            const unavailable = type === "listen" && listen !== "ok";
            return (
              <button
                key={type}
                type="button"
                aria-pressed={!unavailable && selected.includes(type)}
                disabled={unavailable}
                aria-describedby={
                  type === "listen" && unavailable ? listenHintId : undefined
                }
                onClick={() => toggle(type)}
                className={buttonVariants({
                  variant: "outline",
                  size: "sm",
                  className: TOGGLE_BUTTON,
                })}
              >
                {TYPE_LABELS[type]}
              </button>
            );
          })}
        </div>
        {/* mt-3.5:「設定」連結的觸控區上下各伸出 14px,不蓋到上方的題型鈕 */}
        <p
          id={listenHintId}
          className="mt-3.5 text-xs text-muted-foreground empty:hidden"
        >
          {listen === "tts-off" ? (
            <>
              聽力題需要開啟發音(
              {/* 觸控區 44px:負 margin 抵銷,不撐高這行小字 */}
              <Link
                href="/settings"
                className="-mx-1 -my-3.5 inline-flex min-h-11 items-center px-1 text-link underline underline-offset-4"
              >
                設定
              </Link>
              )。
            </>
          ) : listen === "no-voice" ? (
            "此裝置沒有日語語音,無法出聽力題。"
          ) : null}
        </p>
        {/* live region 常駐(不以 hidden 隱藏),內容出現時才會播報 */}
        <p aria-live="polite" className="mt-1 text-xs text-destructive">
          {lastHint ? "至少要保留一種題型。" : null}
        </p>
      </section>

      <Button
        onClick={onStart}
        disabled={count === 0}
        className="mt-4 h-12 w-full"
      >
        {count > 0 ? `開始測驗(${count} 題)` : "開始測驗"}
      </Button>
      <p
        aria-live="polite"
        className="mt-2 text-center text-xs text-muted-foreground"
      >
        {count === 0
          ? "本課沒有適合這些題型的字,請加選其他題型。"
          : "單次測驗,答錯的字可在結果頁加入複習。"}
      </p>
    </div>
  );
}

/** 聽力題幹:重播鈕;作答後揭示單字(含讀音) */
function ListenStem({
  question: q,
  answered,
}: {
  question: McqQuestion;
  answered: boolean;
}) {
  return (
    <div className="flex flex-col items-center gap-3">
      <p className="sr-only">聽發音,選出意思。</p>
      <Button
        variant="outline"
        onClick={() => speak(listenText(q.answer))}
        className="h-12 gap-2 px-5 text-base font-normal"
      >
        <Volume2 className="size-5" aria-hidden />
        再聽一次
      </Button>
      {/* 預留高度(作答前以虛線框佔位):揭示時不推擠下方選項 */}
      <div className="flex min-h-14 items-end justify-center text-3xl">
        {answered ? (
          <RubyText segments={q.answer.ruby} furigana="show" />
        ) : (
          <span
            aria-hidden
            className="mb-1 h-10 w-28 rounded-lg border-2 border-dashed border-muted-foreground"
          />
        )}
      </div>
    </div>
  );
}

/** 例句填空題幹:空格前後的原句(ruby)與中譯;作答後空格填入正解 */
function ClozeStem({
  question: q,
  answered,
  furigana,
}: {
  question: ClozeQuestion;
  answered: boolean;
  furigana: FuriganaMode;
}) {
  const answerText = q.answer.ruby.map((s) => s.b).join("");
  const length = [...q.cloze.before, ...q.cloze.after].reduce(
    (n, s) => n + s.b.length,
    answerText.length,
  );
  return (
    <div className="space-y-3">
      <p className="sr-only">選出填入空格的詞:</p>
      {/* 会話長句(小螢幕 4 行以上)縮小一級,選項與「下一題」不被擠出畫面 */}
      <p
        className={cn(
          "leading-ruby",
          length > LONG_CLOZE_CHARS ? "text-lg" : "text-xl",
        )}
      >
        <RubyText segments={q.cloze.before} furigana={furigana} />
        <span
          aria-hidden
          lang="ja"
          className={cn(
            "mx-1 inline-flex h-[1.5em] min-w-[3em] items-center justify-center rounded-lg border-2 px-1.5 align-middle leading-none",
            answered
              ? "border-success text-success"
              : "border-dashed border-muted-foreground",
          )}
        >
          {answered && <RubyText segments={q.answer.ruby} furigana="hide" />}
        </span>
        <span className="sr-only">
          {answered ? (
            <>
              (<span lang="ja">{answerText}</span>)
            </>
          ) : (
            "(空格)"
          )}
        </span>
        <RubyText segments={q.cloze.after} furigana={furigana} />
      </p>
      <p className="text-sm text-muted-foreground">{q.cloze.translation}</p>
    </div>
  );
}

function McqOptions({
  question,
  furigana,
  selectedId,
  onSelect,
}: {
  question: McqQuestion | ClozeQuestion;
  furigana: FuriganaMode;
  selectedId: string | null;
  onSelect: (o: McqQuestion["options"][number]) => void;
}) {
  const answered = selectedId !== null;
  // 選項為中文:日→中、聽力;為日文:中→日、例句填空
  const zhOptions = question.type === "jp-to-zh" || question.type === "listen";
  return (
    <ul className="space-y-2">
      {question.options.map((o) => {
        const state = !answered
          ? "idle"
          : o.correct
            ? "correct"
            : o.id === selectedId
              ? "wrong"
              : "idle";
        return (
          <li key={o.id}>
            <button
              type="button"
              disabled={answered}
              onClick={() => onSelect(o)}
              className={
                "w-full rounded border px-4 py-3 text-left disabled:opacity-100 " +
                (state === "correct"
                  ? "border-success bg-success/10"
                  : state === "wrong"
                    ? "border-destructive bg-destructive/10"
                    : "border-input")
              }
            >
              {zhOptions ? (
                o.candidate.meaning
              ) : (
                <RubyText segments={o.candidate.ruby} furigana={furigana} />
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function InputArea({
  value,
  checked,
  onChange,
  onSubmit,
}: {
  value: string;
  checked: boolean;
  onChange: (v: string) => void;
  onSubmit: () => void;
}) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
      className="flex gap-2"
    >
      <input
        type="text"
        aria-label="輸入假名"
        value={value}
        disabled={checked}
        onChange={(e) => onChange(e.target.value)}
        // 16px 以上:iOS Safari 不會在 focus 時放大頁面
        className="h-11 min-w-0 flex-1 rounded border border-input bg-transparent px-3 text-base"
        autoComplete="off"
        // 羅馬字作答:避免行動鍵盤自動大寫/自動校正把 koohii 改成別的字
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
      />
      <Button
        type="submit"
        variant="outline"
        disabled={checked || value.trim() === ""}
        className="h-auto px-4 font-normal"
      >
        作答
      </Button>
    </form>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-4 text-center text-sm">
      {children}
    </div>
  );
}
