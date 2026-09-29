import { Fragment } from "react";
import { pitchPattern, type PitchMora } from "@/lib/pitch";
import { cn } from "@/lib/utils";

/** accent 型的中文名(無障礙標籤與學習提示用) */
function accentTypeName(accent: number, moraCount: number): string {
  if (accent === 0) return "平板";
  if (accent === 1) return "頭高";
  return accent === moraCount ? "尾高" : "中高";
}

type Indexed = { m: PitchMora; i: number };

/** 開括號類記號:黏在下一拍(不留在行尾);其餘記號(。、］〜 等)黏在前一拍(不出現在行首) */
const OPENING = new Set("［「『（(〔【〈《[");

/**
 * 依教材的分かち書き空格切成詞組(保留原索引與空格原文):詞組間可換行、詞組內原則上不斷行。
 * 詞組內再以「一拍 + 黏著的記號」為最小單位(禁則:句號不落在行首、開括號不留在行尾)。
 */
function layoutWords(pattern: PitchMora[]): { sep: string; units: Indexed[][] }[] {
  const words: { sep: string; units: Indexed[][] }[] = [];
  let sep = "";
  let leading: Indexed[] = [];
  const flushLeading = () => {
    const units = words[words.length - 1]?.units;
    if (leading.length > 0 && units) {
      if (units.length > 0) units[units.length - 1].push(...leading);
      else units.push(leading);
    }
    leading = [];
  };
  pattern.forEach((m, i) => {
    if (m.mark && /^\s$/u.test(m.text)) {
      flushLeading();
      sep += m.text;
      return;
    }
    if (words.length === 0 || sep !== "") {
      words.push({ sep: words.length > 0 ? sep : "", units: [] });
      sep = "";
    }
    const units = words[words.length - 1].units;
    if (!m.mark) {
      units.push([...leading, { m, i }]);
      leading = [];
    } else if (OPENING.has(m.text) || units.length === 0) {
      leading.push({ m, i });
    } else {
      units[units.length - 1].push({ m, i });
    }
  });
  flushLeading();
  return words;
}

/**
 * 東京式重音標記:高拍上緣畫線、下降核右側豎線(標準辭書畫法)、
 * 平板型尾端延伸線(表示後接助詞維持高),並附 [n] 型號徽章。
 * 非假名記號(…、〜 等)原樣顯示、不畫線。無 accent 資料或資料不合法時,降級為純文字 kana。
 *
 * 斷行:依教材空格切成詞組,只在空格處換行(同 RubyText 的 keep-all);型號徽章黏在最後一組。
 * 單一詞組仍比容器寬時(窄螢幕 + 大字級),組內 flex-wrap 先讓徽章、再於拍間換行(記號隨拍,
 * 守禁則),不撐破版面。
 *
 * 語言標記:視覺層(逐拍 span)標 `lang="ja"` 但對輔助技術隱藏;另以 sr-only 文字
 * 「<ja>讀音</ja>、重音 n 型(…)」朗讀——中文說明不掛 ja,避免以日語語音念中文。
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
    return (
      <span lang="ja" className={className}>
        {kana}
      </span>
    );
  }

  const morae = pattern.filter((m) => !m.mark);
  const typeName = accentTypeName(accent, morae.length);
  // 平板型尾端延伸線接在最後一拍之後(句號等尾隨記號之前)
  const lastMora = pattern.map((m) => !m.mark).lastIndexOf(true);
  const words = layoutWords(pattern);
  return (
    <span className={className}>
      <span aria-hidden lang="ja">
        {words.map((word, w) => (
          <Fragment key={w}>
            {word.sep}
            <span data-word className="inline-flex flex-wrap justify-center">
              {word.units.map((unit) => {
                const pieces = unit.map(({ m, i }) => (
                  <Fragment key={i}>
                    {m.mark ? (
                      <span data-mark className="whitespace-pre">
                        {m.text}
                      </span>
                    ) : (
                      <span
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
                    )}
                    {/* 平板型:尾端延伸線表示「後接助詞仍為高」,與尾高型視覺區隔 */}
                    {accent === 0 && i === lastMora && (
                      <span data-tail className="w-1.5 self-stretch border-t-2 border-t-red-600" />
                    )}
                  </Fragment>
                ));
                // 單拍無附帶者直接當 flex 項目;有記號或尾線者包成不可拆的一組
                return unit.length === 1 && !(accent === 0 && unit[0].i === lastMora) ? (
                  pieces[0]
                ) : (
                  <span key={unit[0].i} className="inline-flex">
                    {pieces}
                  </span>
                );
              })}
              {w === words.length - 1 && (
                <span
                  data-badge
                  className="ml-1 self-center text-[0.7em] tabular-nums text-foreground/50"
                >
                  [{accent}]
                </span>
              )}
            </span>
          </Fragment>
        ))}
      </span>
      <span className="sr-only">
        <span lang="ja">{morae.map((m) => m.text).join("")}</span>、重音 {accent} 型({typeName})
      </span>
    </span>
  );
}

/** 是否有可標記的重音資料(呼叫端決定要不要佔版面時用) */
export function hasPitch(kana: string, accent?: number): boolean {
  return pitchPattern(kana, accent) !== null;
}
