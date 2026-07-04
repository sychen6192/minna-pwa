import type { Metadata, Viewport } from "next";
import { BottomNav } from "@/components/BottomNav";
import { PwaSetup } from "@/components/PwaSetup";
import "./globals.css";

export const metadata: Metadata = {
  title: "みんなの日本語 學習",
  description: "《大家的日本語》初級 I・II 個人學習 PWA",
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
  themeColor: "#0284c7",
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
          {/* pb-16 預留底部導覽高度 */}
          <main className="flex-1 pb-16">{children}</main>
          <BottomNav />
          <PwaSetup />
        </div>
      </body>
    </html>
  );
}
