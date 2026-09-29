"use client";

import { useEffect, useRef, useState } from "react";
import { Loading } from "@/components/Loading";
import { RubyText, type FuriganaMode } from "@/components/RubyText";
import { Button } from "@/components/ui/button";
import { getLesson } from "@/lib/content";
import { getSetting } from "@/lib/db";
import { displayNote } from "@/lib/notes";
import {
  answerLabel,
  checkAnswer,
  generateQuiz,
  type McqQuestion,
  type Question,
  type QuizCandidate,
} from "@/lib/quiz";
import { QuizResult } from "./QuizResult";

const QUIZ_COUNT = 10;
const NEIGHBOR_OFFSETS = [-2, -1, 1, 2];

type Phase = "loading" | "error" | "quiz" | "done";

interface Result {
  card: QuizCandidate;
  correct: boolean;
}

export function QuizRunner({ id }: { id: number }) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [error, setError] = useState<string | null>(null);
  const [pool, setPool] = useState<QuizCandidate[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [furigana, setFurigana] = useState<FuriganaMode>("show");

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
  const answered =
    phase === "quiz" && questions[index] !== undefined
      ? questions[index].type === "input"
        ? checked
        : selectedId !== null
      : false;

  useEffect(() => {
    if (answered) nextRef.current?.focus();
  }, [answered]);

  useEffect(() => {
    if (!focusStem.current) return;
    focusStem.current = false;
    stemRef.current?.focus();
  }, [index, questions]);

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
      const furi = await getSetting("furigana");
      const qs = generateQuiz(id, loaded, { count: QUIZ_COUNT });
      if (!active) return;
      setFurigana(furi);
      setPool(loaded);
      setQuestions(qs);
      setPhase(qs.length === 0 ? "done" : "quiz");
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
  if (phase === "error")
    return (
      <Centered>
        <span className="text-destructive">載入測驗失敗:{error}</span>
      </Centered>
    );

  // 再測一次:同一課重新出題(題目與題型重新抽),作答狀態歸零
  function restart() {
    const qs = generateQuiz(id, pool, { count: QUIZ_COUNT });
    focusStem.current = true;
    setQuestions(qs);
    setIndex(0);
    setSelectedId(null);
    setInput("");
    setChecked(false);
    setLastCorrect(null);
    setResults([]);
    setPhase(qs.length === 0 ? "done" : "quiz");
  }

  if (phase === "done") {
    return (
      <QuizResult
        results={results}
        lessonId={id}
        furigana={furigana}
        onRestart={restart}
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
    if (selectedId !== null) return;
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
      setPhase("done");
      return;
    }
    focusStem.current = true;
    setIndex((i) => i + 1);
    setSelectedId(null);
    setInput("");
    setChecked(false);
    setLastCorrect(null);
  }

  return (
    <div className="flex min-h-[80vh] flex-col">
      {/* 進度 */}
      <div className="px-4 py-2">
        <div className="text-center text-xs text-muted-foreground">
          第 {index + 1} / {questions.length} 題
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
        <div ref={stemRef} tabIndex={-1} className="text-center text-2xl outline-none">
          {q.type === "zh-to-jp" ? (
            q.answer.meaning
          ) : q.type === "jp-to-zh" ? (
            <RubyText segments={q.answer.ruby} furigana={furigana} />
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
        <Button ref={nextRef} onClick={next} disabled={!answered} className="h-12 w-full">
          {index + 1 >= questions.length ? "看結果" : "下一題"}
        </Button>
      </div>
    </div>
  );
}

function McqOptions({
  question,
  furigana,
  selectedId,
  onSelect,
}: {
  question: McqQuestion;
  furigana: FuriganaMode;
  selectedId: string | null;
  onSelect: (o: McqQuestion["options"][number]) => void;
}) {
  const answered = selectedId !== null;
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
              {question.type === "jp-to-zh" ? (
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
