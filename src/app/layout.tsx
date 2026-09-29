import type { Metadata, Viewport } from "next";
import { BottomNav } from "@/components/BottomNav";
import { PwaSetup } from "@/components/PwaSetup";
import { UpdatePrompt } from "@/components/UpdatePrompt";
import "./globals.css";

export const metadata: Metadata = {
  title: "みんなの日本語 學習",
  description: "《大家的日本語》初級 I・II 個人學習 PWA",
  // N6 版權緩解:公開部署但不讓搜尋引擎收錄(另有 public/_headers 的 X-Robots-Tag)
  robots: { index: false, follow: false },
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    title: "みんなの日本語",
    statusBarStyle: "default",
  },
  icons: {
    apple: "/icons/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  // 瀏覽器 UI 色依系統配色:淺色用主色(--primary),深色與頁面底色(--background)一致
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#0069a8" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
  // 延伸至 iOS 瀏海/Home indicator 區,配合 safe-area-inset-* 定位
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-Hant">
      <body className="antialiased">
        <div className="mx-auto flex min-h-screen max-w-screen-sm flex-col">
          {/* 預留底部導覽高度(4rem + iOS safe-area) */}
          <main className="flex-1 pb-[calc(4rem_+_env(safe-area-inset-bottom))]">{children}</main>
          <BottomNav />
          <PwaSetup />
          {/* 置於 PwaSetup 之後:同位置重疊時更新提示優先顯示 */}
          <UpdatePrompt />
        </div>
      </body>
    </html>
  );
}
