import { pitchPattern, splitMorae } from "@/lib/pitch";
import { cn } from "@/lib/utils";

/** accent 型的中文名(無障礙標籤與學習提示用) */
function accentTypeName(accent: number, moraCount: number): string {
  if (accent === 0) return "平板";
  if (accent === 1) return "頭高";
  return accent === moraCount ? "尾高" : "中高";
}

/**
 * 東京式重音標記:高拍上緣畫線、下降核右側豎線(標準辭書畫法)、
 * 平板型尾端延伸線(表示後接助詞維持高),並附 [n] 型號徽章。
 * 無 accent 資料或資料不合法時,降級為純文字 kana。
 */
export function PitchAccent({
  kana,
  accent,
  className,
}: {
  kana: string;
  accent?: number;
  className?: string;
}) {
  const pattern = pitchPattern(kana, accent);
  if (pattern === null || accent === undefined) {
    return <span className={className}>{kana}</span>;
  }

  const typeName = accentTypeName(accent, pattern.length);
  return (
    <span
      aria-label={`${kana}、重音 ${accent} 型(${typeName})`}
      className={cn("inline-flex items-baseline whitespace-nowrap", className)}
    >
      <span aria-hidden className="inline-flex">
        {pattern.map((m, i) => (
          <span
            key={i}
            data-mora
            data-high={m.high ? "" : undefined}
            data-drop={m.dropAfter ? "" : undefined}
            className={cn(
              "border-t-2 border-t-transparent",
              m.high && "border-t-red-600",
              m.dropAfter && "border-r-2 border-r-red-600",
            )}
          >
            {m.text}
          </span>
        ))}
        {/* 平板型:尾端延伸線表示「後接助詞仍為高」,與尾高型視覺區隔 */}
        {accent === 0 && (
          <span data-tail className="w-1.5 self-stretch border-t-2 border-t-red-600" />
        )}
      </span>
      <span
        aria-hidden
        className="ml-1 self-center text-[0.7em] tabular-nums text-foreground/50"
      >
        [{accent}]
      </span>
    </span>
  );
}

/** 是否有可標記的重音資料(呼叫端決定要不要佔版面時用) */
export function hasPitch(kana: string, accent?: number): boolean {
  return (
    accent !== undefined && accent >= 0 && accent <= splitMorae(kana).length
  );
}
