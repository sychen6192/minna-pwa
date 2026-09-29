import type { IntervalPreviews, ReviewRating } from "@/lib/srs";
import { cn } from "@/lib/utils";

interface RatingDef {
  rating: ReviewRating;
  key: keyof IntervalPreviews;
  label: string;
  className: string;
}

const RATINGS: RatingDef[] = [
  { rating: 1, key: "again", label: "重來", className: "text-rating-again" },
  { rating: 2, key: "hard", label: "困難", className: "text-rating-hard" },
  { rating: 3, key: "good", label: "良好", className: "text-rating-good" },
  { rating: 4, key: "easy", label: "輕鬆", className: "text-rating-easy" },
];

function formatDays(days: number): string {
  return days < 1 ? "<1 天" : `${days} 天`;
}

/**
 * 快捷鍵數字:只在精確指標(滑鼠/觸控板,多半有實體鍵盤)的裝置顯示;
 * 對輔助技術隱藏(不併入按鈕名稱)。
 */
export function ShortcutHint({ children }: { children: React.ReactNode }) {
  return (
    <span
      aria-hidden="true"
      className="hidden text-[10px] text-muted-foreground pointer-fine:block"
    >
      {children}
    </span>
  );
}

interface RatingButtonsProps {
  previews: IntervalPreviews | null;
  onRate: (rating: ReviewRating) => void;
  disabled?: boolean;
}

/**
 * 四鍵評分;鍵上顯示預估下次間隔(桌面另顯示快捷鍵 1–4)。
 * 不設 aria-label:名稱由內容組成,念作「良好 3 天」(間隔也要讓輔助技術聽到)。
 */
export function RatingButtons({
  previews,
  onRate,
  disabled,
}: RatingButtonsProps) {
  return (
    <div className="grid grid-cols-4 gap-2 px-4">
      {RATINGS.map(({ rating, key, label, className }) => (
        <button
          key={rating}
          type="button"
          disabled={disabled}
          onClick={() => onRate(rating)}
          className={cn(
            "flex min-h-11 flex-col items-center justify-center gap-0.5 rounded border border-input py-2 disabled:opacity-40",
            className,
          )}
        >
          <span className="text-sm font-medium">{label}</span>{" "}
          {/* 預估載入前的佔位不念出 */}
          <span aria-hidden={previews ? undefined : true} className="text-[10px] text-muted-foreground">
            {previews ? formatDays(previews[key].days) : "—"}
          </span>
          <ShortcutHint>{rating}</ShortcutHint>
        </button>
      ))}
    </div>
  );
}
