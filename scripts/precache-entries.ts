import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface PrecacheEntry {
  url: string;
  revision: string;
}

// @serwist/next 一旦收到 additionalPrecacheEntries 就會「取代」內建的 public/ 掃描
// (見其 src/index.ts 的 resolvedManifestEntries 分支),因此這裡鏡射其排除規則:
// SW 產物自身不可進 precache manifest。
const SW_ARTIFACTS = [/^sw\.js$/, /^sw\.js\.map$/, /^swe-worker-.*\.js$/];

/** 遞迴收集 public/ 下所有檔案,以內容 hash 為 revision(內容未變即不重新下載)。 */
export function collectPublicEntries(publicDir: string): PrecacheEntry[] {
  const entries: PrecacheEntry[] = [];
  walk(publicDir, "");
  return entries;

  function walk(dir: string, relPrefix: string): void {
    for (const dirent of readdirSync(dir, { withFileTypes: true })) {
      const rel = relPrefix ? `${relPrefix}/${dirent.name}` : dirent.name;
      if (dirent.isDirectory()) {
        walk(join(dir, dirent.name), rel);
      } else if (dirent.isFile() && !SW_ARTIFACTS.some((re) => re.test(rel))) {
        const content = readFileSync(join(dir, dirent.name));
        entries.push({
          url: `/${rel}`,
          revision: createHash("md5").update(content).digest("hex"),
        });
      }
    }
  }
}

/**
 * 產生全部頁面路由的 precache 條目:HTML 文件 + 對應 .txt(App Router 靜態匯出的
 * RSC payload,客端導覽時抓取)。這些檔案在 webpack 階段尚未產生、無從 hash,
 * revision 由呼叫端提供(每次 build 變動)。
 */
export function buildRouteEntries(lessonIds: number[], revision: string): PrecacheEntry[] {
  const routes = [
    "/",
    "/lessons",
    "/review",
    ...lessonIds.flatMap((id) => [`/lessons/${id}`, `/quiz/${id}`]),
  ];
  return routes.flatMap((route) => [
    { url: route, revision },
    { url: route === "/" ? "/index.txt" : `${route}.txt`, revision },
  ]);
}
