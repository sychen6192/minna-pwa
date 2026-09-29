/**
 * App 自己的網址查詢參數,與 SW precache 查找時要去除的參數(sw.ts 引用:不依賴 DOM,可打包進 SW)。
 * 靜態匯出的 precache 條目只有不帶參數的網址(/drill、/drill.txt):帶參數的導覽若不去除參數,
 * precache miss → 離線時開不了頁。新增 app 參數時一併加入 PRECACHE_IGNORED_URL_PARAMS。
 */

/** 活用練習的範圍(課程頁連結 /drill?upto=N;/drill 以 window.location 讀取) */
export const UPTO_PARAM = "upto";

/** SW precache 比對時忽略的參數:App Router 客端導覽抓 RSC payload 的 ?_rsc=<hash>,與 app 參數 */
export const PRECACHE_IGNORED_URL_PARAMS: readonly RegExp[] = [
  /^_rsc$/,
  new RegExp(`^${UPTO_PARAM}$`),
];

/** 活用練習頁的網址(範圍:第 1–upto 課) */
export function drillHref(upto: number): string {
  return `/drill?${UPTO_PARAM}=${upto}`;
}
