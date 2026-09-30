/**
 * App 自己的網址查詢參數,與 SW precache 查找時要去除的參數(sw.ts 引用:不依賴 DOM,可打包進 SW)。
 * 靜態匯出的 precache 條目只有不帶參數的網址(/drill、/drill.txt):帶參數的導覽若不去除參數,
 * precache miss → 離線時開不了頁。新增 app 參數時一併加入 PRECACHE_IGNORED_URL_PARAMS。
 */

/** 活用練習的範圍(課程頁連結 /drill?upto=N;/drill 以 window.location 讀取) */
export const UPTO_PARAM = "upto";

/** /drill 的練習類型(?mode=particle 為助詞搭配;未帶為活用,T11.7) */
export const MODE_PARAM = "mode";

/** /drill 的練習類型:活用、助詞搭配 */
export type DrillMode = "conj" | "particle";

/** SW precache 比對時忽略的參數:App Router 客端導覽抓 RSC payload 的 ?_rsc=<hash>,與 app 參數 */
export const PRECACHE_IGNORED_URL_PARAMS: readonly RegExp[] = [
  /^_rsc$/,
  new RegExp(`^${UPTO_PARAM}$`),
  new RegExp(`^${MODE_PARAM}$`),
];

/** /drill 的查詢字串:範圍(null = 不指定)與類型(活用為預設,不寫出);都沒有時為空字串 */
export function drillSearch(upto: number | null, mode: DrillMode): string {
  const params = new URLSearchParams();
  if (upto !== null) params.set(UPTO_PARAM, String(upto));
  if (mode === "particle") params.set(MODE_PARAM, mode);
  const search = params.toString();
  return search === "" ? "" : `?${search}`;
}

/** 練習頁的網址(範圍:第 1–upto 課;預設為活用練習) */
export function drillHref(upto: number, mode: DrillMode = "conj"): string {
  return `/drill${drillSearch(upto, mode)}`;
}

/** 網址參數 ?mode=;未帶或不合法時回傳 null */
export function parseDrillMode(search: string): DrillMode | null {
  const raw = new URLSearchParams(search).get(MODE_PARAM);
  return raw === "particle" || raw === "conj" ? raw : null;
}
