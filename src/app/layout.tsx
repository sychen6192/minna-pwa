import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "みんなの日本語 學習",
  description: "《大家的日本語》初級 I・II 個人學習 PWA",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-Hant">
      <body className="antialiased">{children}</body>
    </html>
  );
}
