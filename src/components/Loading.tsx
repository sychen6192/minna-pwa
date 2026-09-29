import { cn } from "@/lib/utils";

/**
 * 共用載入提示:`role="status"`(polite live region),輔助技術會念出載入狀態。
 * 資料為本機靜態 JSON + SW 快取,載入很短,不做骨架屏。
 */
export function Loading({
  label = "載入中…",
  className,
}: {
  label?: string;
  className?: string;
}) {
  return (
    <p
      role="status"
      aria-live="polite"
      className={cn("px-4 py-8 text-center text-sm text-muted-foreground", className)}
    >
      {label}
    </p>
  );
}
