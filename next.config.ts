import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 純靜態輸出:build 直接產出 out/(ADR D2,禁 API routes / server actions)
  output: "export",
  // 靜態匯出無 Image Optimization server,關閉以避免 build 失敗
  images: { unoptimized: true },
};

export default nextConfig;
