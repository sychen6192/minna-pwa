import type { DayCount } from "@/lib/stats";

// 順序色階:單一色相(sky)由淺到深;層級 0 為中性底(無活動)。
// 淺步對白底對比不足屬熱力圖天性,以每格 title tooltip 補救(dataviz 規範)。
const LEVEL_CLASSES = [
  "bg-neutral-100",
  "bg-sky-200",
  "bg-sky-400",
  "bg-sky-600",
  "bg-sky-800",
] as const;

/** 固定分級:0 / 1–4 / 5–9 / 10–19 / 20+ */
export function heatLevel(count: number): 0 | 1 | 2 | 3 | 4 {
  if (count <= 0) return 0;
  if (count <= 4) return 1;
  if (count <= 9) return 2;
  if (count <= 19) return 3;
  return 4;
}

/** "YYYY-MM-DD" 以本地時區解析(new Date(string) 會落在 UTC,西半球時區會偏移一天) */
function parseLocalDate(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** GitHub 風格活動熱力圖:欄 = 週(週一起算),列 = 星期 */
export function Heatmap({ data }: { data: DayCount[] }) {
  const padCount = data.length ? (parseLocalDate(data[0].date).getDay() + 6) % 7 : 0;

  return (
    <div className="overflow-x-auto">
      <div
        role="img"
        aria-label="每日複習量熱力圖"
        className="grid w-max grid-flow-col grid-rows-7 gap-1"
      >
        {Array.from({ length: padCount }, (_, i) => (
          <span key={`pad-${i}`} aria-hidden="true" className="h-3 w-3" />
        ))}
        {data.map((day) => (
          <span
            key={day.date}
            title={`${day.date}:${day.count} 次複習`}
            data-level={heatLevel(day.count)}
            className={`h-3 w-3 rounded-[2px] ${LEVEL_CLASSES[heatLevel(day.count)]}`}
          />
        ))}
      </div>
    </div>
  );
}
