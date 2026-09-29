import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

/** 404(靜態匯出為 out/404.html,套用 root layout,底部導覽照常可用) */
export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-4 text-center">
      <p className="text-5xl font-bold tabular-nums text-muted-foreground">404</p>
      <h1 className="mt-3 text-lg font-bold">找不到這個頁面</h1>
      <p className="mt-1 text-sm text-muted-foreground">網址可能打錯了,或這個頁面已不存在。</p>
      <div className="mt-6 flex gap-2">
        <Link href="/" className={buttonVariants({ className: "px-6" })}>
          回首頁
        </Link>
        <Link href="/lessons" className={buttonVariants({ variant: "outline", className: "px-6" })}>
          課程列表
        </Link>
      </div>
    </div>
  );
}
