# IMPLEMENTATION_PLAN — 分階段實作計畫

## 使用方式

- 由上而下執行;**一個任務 = 一個 conventional commit**,通過驗證後勾選 checkbox。
- 每個任務動工前先提出實作計畫並經確認(`/next-task` 流程)。
- Phase 5 依賴 Phase 1,可與 Phase 2–4 平行;其餘 phase 依序。

### 全域完成定義(DoD)

1. `/verify` 全綠(lint + typecheck + test;涉及 `public/data/` 或 `src/schemas/` 時加 `validate:content`)。
2. `src/lib/` 的純函式邏輯有對應單元測試。
3. 實作若與 `docs/` 不一致:先停下,更新文件取得共識後再繼續。

---

## Phase 0 — 專案初始化

- [x] **T0.1 腳手架**
  做什麼:pnpm + Next.js 15(App Router、TypeScript strict)+ Tailwind + shadcn/ui;`next.config` 設 `output: 'export'`。
  驗收:`pnpm dev` 可啟動;`pnpm build` 產出 `out/`;首頁為佔位頁。

- [x] **T0.2 品質工具**
  做什麼:ESLint + Prettier + Vitest(含 @testing-library/react、fake-indexeddb);scripts:`lint` / `typecheck` / `test` / `verify`。
  驗收:`pnpm verify` 全綠(至少含一個示範測試)。

- [x] **T0.3 CI**
  做什麼:GitHub Actions——push / PR 觸發 `pnpm verify` 與 `pnpm build`。
  驗收:workflow 推上 GitHub 後跑通一次。

## Phase 1 — 資料契約(所有後續 phase 的依賴)

- [x] **T1.1 Zod schema**
  做什麼:依 `docs/DATA_MODEL.md` §1.2 實作 `src/schemas/lesson.ts`。
  驗收:schema 單元測試通過(合法 / 非法樣本各 ≥ 3 例,含 id regex、PosEnum、ruby 結構)。

- [x] **T1.2 Fixture**
  做什麼:手寫縮樣 `public/data/lessons/L13.json`(≥ 8 個單字、2 個文法點、1 段会話)+ `public/data/index.json`(50 筆,未抽取的課先給佔位 title 與 0 計數)。
  驗收:fixture 通過 schema;課程頁開發期間以此為資料。

- [x] **T1.3 content.ts**
  做什麼:`getLessonIndex()`、`getLesson(id)`——fetch + Zod parse + 記憶體快取;失敗丟出含課號與欄位路徑的明確錯誤。
  驗收:單元測試(mock fetch:成功、404、schema 不符)通過。

- [x] **T1.4 validate:content**
  做什麼:`scripts/validate-content.ts` 掃描 `public/data/**` 全部驗證;接上 `pnpm validate:content`。
  驗收:現有 fixture 通過;塞一筆壞資料會失敗,且錯誤訊息指出檔案與欄位。

## Phase 2 — App shell 與課程瀏覽(F1)

- [x] **T2.1 Shell 與共用元件**
  做什麼:全域 layout、底部導覽(課程 / 複習 / 測驗 / 統計 / 設定)、`RubyText` 元件(吃 ruby 分段陣列,受 furigana 設定控制)。
  驗收:RubyText 單元測試(有 / 無讀音段、furigana 開關)。

- [x] **T2.2 課程列表頁**(`/lessons`)
  做什麼:讀 index.json 渲染 50 課(課號、標題、單字數);進度標示先佔位。
  驗收:離線資料(fixture index)正確呈現。

- [x] **T2.3 課程內頁**(`/lessons/[id]`)
  做什麼:単語 / 文型 / 会話 三分頁;`generateStaticParams` 產出 50 頁;頁內 furigana 快速切換。
  驗收:`pnpm build` 後 `out/` 含 50 課頁面;L13 三個分頁渲染正確。

- [x] **T2.4 TTS**
  做什麼:`src/lib/tts.ts` 包 Web Speech API(`ja-JP`、可取消、無可用 voice 時靜默降級);單字列表加發音鈕。
  驗收:tts.ts 單元測試(mock speechSynthesis:正常、無 voice、連點取消)。

## Phase 3 — SRS 複習(F2,核心)

- [x] **T3.1 db.ts**
  做什麼:Dexie schema v1(`docs/DATA_MODEL.md` §2)+ 首次啟動寫入預設 settings。
  驗收:fake-indexeddb 下開庫、讀寫、預設值測試通過。

- [x] **T3.2 srs.ts**
  做什麼:包 ts-fsrs——`addCards(vocabIds, lessonId)`(冪等)、`buildQueue(now)`(到期卡 + 新卡,受每日上限)、`rate(cardId, rating, now)`(更新卡片 + 寫 log)、`previewIntervals(cardId, now)`(四鍵預估間隔)。
  驗收:單元測試覆蓋——新卡入列、上限裁切、四種評分後 due 變化合理(Again < Hard < Good < Easy)、log 欄位正確、重複 addCards 不產生重複卡。

- [x] **T3.3 複習頁**(`/review`)
  做什麼:翻卡 UI、四鍵評分(顯示預估間隔)、鍵盤操作(空白翻面、1–4 評分)、session 結算頁。
  驗收:手動流程通過;佇列空時顯示「今日完成」狀態。

- [x] **T3.4 加入複習入口**
  做什麼:課程頁單字逐項與整課「加入複習」,接 `srs.addCards`。
  驗收:加入後 `/review` 佇列出現;重複加入冪等。

## Phase 4 — 測驗(F3)

- [x] **T4.1 quiz.ts 出題引擎**(純函式)
  做什麼:四選一(日→中、中→日)與輸入題;干擾項規則 = 同課同詞性優先 → 不足擴鄰近課 → 不重複、不含正解;輸入比對 = WanaKana `toHiragana` 正規化後全等。
  驗收:單元測試——干擾項規則順序、`sanpo` / `さんぽ` / `サンポ` 視為同答、單字不足課的退化行為。

- [x] **T4.2 測驗 UI**(`/quiz/[id]`)
  做什麼:每課 10 題(數量可設定)、即時對錯回饋、進度條。
  驗收:fixture 課可完整作答一輪。

- [x] **T4.3 結果頁**
  做什麼:分數、錯題清單、一鍵將錯題加入 SRS(走 `srs.addCards`,冪等)。
  驗收:錯題加入後出現在複習佇列。

## Phase 5 — 內容管線(依賴 Phase 1;可與 2–4 平行)

> ADR 變更:PDF 含文字層,改用 **`pdftotext` + Claude Code 直抽**(不需 Python/Batch API/API key)。**抽取由 Claude Code 做,讀音校讀由使用者本人執行**。規格詳見 `docs/PIPELINE.md`。

- [x] **T5.1 抽取前置**
  做什麼:安裝 poppler(`pdftotext`);確認 PDF 含文字層;訂出抽取慣例(ruby 對齊、pos、濾頁尾、跳過練習)。
  驗收:`pdftotext -layout 13.pdf` 能抽出完整 ことば/文型/例文/会話。

- [x] **T5.2 單課跑通(L13)**
  做什麼:抽 L13 → `public/data/lessons/L13.json`(取代 T1.2 fixture);解決 grammar explanation 來源缺口(見 PIPELINE §2)。
  驗收:`pnpm validate:content` 通過;與 PDF 人工對照(讀音零容忍)後抽取慣例定稿。

- [x] **T5.3 全量抽取(分批)**
  做什麼:其餘 49 課分批抽取;讀音/格式人工校讀。
  驗收:每課 `pnpm validate:content` 通過;抽查讀音正確。

- [x] **T5.4 索引與收尾**
  做什麼:產生正式 `index.json`;移除佔位資料。
  驗收:`pnpm validate:content` 50/50 通過;抽查 5 課符合 PIPELINE.md §3 標準。

## Phase 6 — PWA 化(N1–N3)

- [ ] **T6.1 Serwist 整合**
  做什麼:接入 Serwist(設定以官方文件為準,D8),precache app shell 與 `/data/**`。
  驗收:build 後產出 service worker;DevTools 離線模式可開首頁與任一課。

- [ ] **T6.2 Manifest 與 icons**
  做什麼:`manifest.json`(standalone、theme color)、512 / 192 icon、iOS meta 標籤。
  驗收:Chrome 顯示可安裝;iOS 加入主畫面後 standalone 開啟。

- [ ] **T6.3 儲存持久化**
  做什麼:啟動時呼叫 `navigator.storage.persist()`;未安裝時顯示加入主畫面提示(含 iOS 引導文案)。
  驗收:persist 呼叫有測試;提示僅在未安裝時出現。

- [ ] **T6.4 PWA 驗收**
  做什麼:Lighthouse PWA 項目全過;SW 更新策略(偵測新版 → 提示重新整理)。
  驗收:Lighthouse 報告留存於 PR;更新提示流程手動驗證。

## Phase 7 — 統計、資料管理與部署(F5、F6、N6)

- [ ] **T7.1 統計頁**(`/stats`)
  做什麼:Recharts——12 週複習熱力圖、7 / 30 天到期預測、留存率、各課進度;聚合邏輯集中 `src/lib/stats.ts`。
  驗收:stats.ts 單元測試(以合成 logs 驗證聚合正確)。

- [ ] **T7.2 匯出 / 匯入 / 重置**
  做什麼:依 DATA_MODEL §3;匯入與重置皆雙重確認。
  驗收:匯出 → 重置 → 匯入後,卡片狀態與統計完全還原(測試覆蓋)。

- [ ] **T7.3 部署文件化**
  做什麼:新增 `docs/DEPLOY.md`——Cloudflare Pages 設定、**Cloudflare Access 規則(必須,版權)**、自訂網域;Actions 自動部署。
  驗收:照文件可從零完成一次部署,未授權訪問被 Access 擋下。

- [ ] **T7.4 收尾**
  做什麼:bundle 預算檢查(N4:首頁 gzip < 200 KB)、鍵盤 / 對比度快掃、README 更新為實際狀態。
  驗收:`pnpm build` 輸出體積記錄於 PR;README 與現況一致。
