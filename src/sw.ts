import { defaultCache } from "@serwist/next/worker";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { Serwist } from "serwist";
import { PRECACHE_IGNORED_URL_PARAMS } from "./lib/urlParams";

// injectionPoint(預設 "self.__SW_MANIFEST")的型別宣告,build 時由
// @serwist/webpack-plugin 置換為實際 precache manifest。
declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  precacheOptions: {
    cleanupOutdatedCaches: true,
    // App Router 客端導覽抓 RSC payload 時帶 ?_rsc=<hash>,app 自己的參數(/drill?upto=N)亦同:
    // 不忽略會 precache miss、離線開不了頁
    ignoreURLParametersMatching: [...PRECACHE_IGNORED_URL_PARAMS],
  },
  // 新版 SW 停在 waiting,由 UpdatePrompt 徵得同意後送 SKIP_WAITING 接管
  // (serwist 核心於 skipWaiting: false 時自動監聽該訊息)
  skipWaiting: false,
  clientsClaim: true,
  // 全站(頁面 + 資料)皆已預快取;navigation preload 只會平行發出用不到的網路請求
  navigationPreload: false,
  disableDevLogs: true,
  runtimeCaching: defaultCache,
});

serwist.addEventListeners();
