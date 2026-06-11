import type { RubySeg } from "@/schemas/lesson";
import { cn } from "@/lib/utils";

export type FuriganaMode = "show" | "hide";

interface RubyTextProps {
  /** ruby 分段:漢字段帶讀音 r,純假名段省略 r */
  segments: RubySeg[];
  /** furigana 顯示模式;預設顯示 */
  furigana?: FuriganaMode;
  className?: string;
}

/**
 * 以原生 <ruby> 渲染帶 furigana 的日文。
 * 純展示元件:讀音是否顯示由 furigana prop 控制(由上層接設定/頁內切換)。
 */
export function RubyText({
  segments,
  furigana = "show",
  className,
}: RubyTextProps) {
  const showFurigana = furigana === "show";
  return (
    <span className={cn(className)}>
      {segments.map((seg, i) =>
        seg.r ? (
          <ruby key={i}>
            {seg.b}
            {showFurigana ? <rt>{seg.r}</rt> : null}
          </ruby>
        ) : (
          <span key={i}>{seg.b}</span>
        ),
      )}
    </span>
  );
}
