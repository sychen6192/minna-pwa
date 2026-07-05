import type { IntervalPreviews, ReviewRating } from "@/lib/srs";
import { cn } from "@/lib/utils";

interface RatingDef {
  rating: ReviewRating;
  key: keyof IntervalPreviews;
  label: string;
  className: string;
}

const RATINGS: RatingDef[] = [
  { rating: 1, key: "again", label: "重來", className: "text-red-600" },
  { rating: 2, key: "hard", label: "困難", className: "text-orange-700" },
  { rating: 3, key: "good", label: "良好", className: "text-green-700" },
  { rating: 4, key: "easy", label: "輕鬆", className: "text-sky-700" },
];

function formatDays(days: number): string {
  return days < 1 ? "<1 天" : `${days} 天`;
}

interface RatingButtonsProps {
  previews: IntervalPreviews | null;
  onRate: (rating: ReviewRating) => void;
  disabled?: boolean;
}

/** 四鍵評分;鍵上顯示預估下次間隔(數字 1–4 對應快捷鍵)。 */
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
          aria-label={label}
          disabled={disabled}
          onClick={() => onRate(rating)}
          className={cn(
            "flex flex-col items-center gap-0.5 rounded border border-foreground/15 py-2 disabled:opacity-40",
            className,
          )}
        >
          <span className="text-sm font-medium">{label}</span>
          <span className="text-[10px] text-foreground/60">
            {previews ? formatDays(previews[key].days) : "—"}
          </span>
          <span className="text-[10px] text-foreground/60">{rating}</span>
        </button>
      ))}
    </div>
  );
}
