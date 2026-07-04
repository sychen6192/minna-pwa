import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import withSerwistInit from "@serwist/next";
import type { NextConfig } from "next";
import { buildRouteEntries, collectPublicEntries } from "./scripts/precache-entries";

// 匯出的 HTML/.txt 在 webpack 階段尚未產生、無從 hash,改以「每次 build 必變」的
// revision 標記(HTML 引用 hashed asset,本就須隨版重抓);public/ 檔案則用內容 hash。
const buildRevision =
  spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf-8" }).stdout?.trim() || randomUUID();

const lessonIndex = JSON.parse(
  readFileSync(join(process.cwd(), "public/data/index.json"), "utf-8"),
) as { lessons: { id: number }[] };
const lessonIds = lessonIndex.lessons.map((lesson) => lesson.id);

const withSerwist = withSerwistInit({
  swSrc: "src/sw.ts",
  swDest: "public/sw.js",
  // 開發期停用 SW,避免快取干擾;離線驗證一律用 build 產物
  disable: process.env.NODE_ENV === "development",
  // 注意:提供 additionalPrecacheEntries 會「取代」內建的 public/ 掃描,
  // 故 collectPublicEntries 需自行涵蓋 public/**(含 /data/**)
  additionalPrecacheEntries: [
    ...collectPublicEntries(join(process.cwd(), "public")),
    ...buildRouteEntries(lessonIds, buildRevision),
    // App Router metadata 檔(src/app/favicon.ico)同樣於 webpack 後才輸出
    { url: "/favicon.ico", revision: buildRevision },
  ],
});

const nextConfig: NextConfig = {
  // 純靜態輸出:build 直接產出 out/(ADR D2,禁 API routes / server actions)
  output: "export",
  // 靜態匯出無 Image Optimization server,關閉以避免 build 失敗
  images: { unoptimized: true },
};

export default withSerwist(nextConfig);
