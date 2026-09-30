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

- [x] **T6.1 Serwist 整合**
  做什麼:接入 Serwist(設定以官方文件為準,D8),precache app shell 與 `/data/**`。
  驗收:build 後產出 service worker;DevTools 離線模式可開首頁與任一課。

- [x] **T6.2 Manifest 與 icons**
  做什麼:`manifest.json`(standalone、theme color)、512 / 192 icon、iOS meta 標籤。
  驗收:Chrome 顯示可安裝;iOS 加入主畫面後 standalone 開啟。

- [x] **T6.3 儲存持久化**
  做什麼:啟動時呼叫 `navigator.storage.persist()`;未安裝時顯示加入主畫面提示(含 iOS 引導文案)。
  驗收:persist 呼叫有測試;提示僅在未安裝時出現。

- [x] **T6.4 PWA 驗收**
  做什麼:Lighthouse PWA 項目全過;SW 更新策略(偵測新版 → 提示重新整理)。
  驗收:Lighthouse 報告留存於 PR;更新提示流程手動驗證。

## Phase 7 — 統計、資料管理與部署(F5、F6、N6)

- [x] **T7.1 統計頁**(`/stats`)
  做什麼:Recharts——12 週複習熱力圖、7 / 30 天到期預測、留存率、各課進度;聚合邏輯集中 `src/lib/stats.ts`。
  驗收:stats.ts 單元測試(以合成 logs 驗證聚合正確)。

- [x] **T7.2 匯出 / 匯入 / 重置**
  做什麼:依 DATA_MODEL §3;匯入與重置皆雙重確認。`/settings` 頁一併涵蓋 F6.1 設定控制(每日新卡/複習上限、TTS、furigana)。
  驗收:匯出 → 重置 → 匯入後,卡片狀態與統計完全還原(測試覆蓋)。

- [x] **T7.3 部署文件化**
  做什麼:新增 `docs/DEPLOY.md`——Cloudflare Pages 設定、自訂網域;Actions 自動部署。部署採公開網址(2026-07-10 修訂,原 Cloudflare Access 方案撤回,見 SPEC N6 / ADR D7),站台加 noindex(meta robots + `X-Robots-Tag`)。
  驗收:照文件可從零完成一次部署;站點公開可用且 noindex 生效(HTML meta 與資料檔 header 皆驗證)。

- [x] **T7.4 收尾**
  做什麼:bundle 預算檢查(N4:首頁 gzip < 200 KB)、鍵盤 / 對比度快掃、README 更新為實際狀態。補 `/quiz` 選課入口頁(BottomNav 既有連結原為 404)。
  驗收:`pnpm build` 輸出體積記錄於 PR;README 與現況一致。

- [x] **T7.5 首頁儀表板與 favicon 收尾**(驗收時發現的腳手架殘留)
  做什麼:首頁 `/`(PWA start_url)原為 T0.1 佔位「建置中」,改為今日儀表板——到期複習張數(→ /review)、已開始課數 / 累計卡片、快捷入口;三態(空 DB / 有到期 / 無到期)。BottomNav 補「首頁」分頁(原無回首頁入口)。`src/app/favicon.ico` 原為 Next.js 預設 logo,改用 app icon(藍底「み」)。新增純函式 `studySummary`(stats.ts)。
  驗收:`pnpm verify` 全綠;首頁三態測試、BottomNav 6 分頁測試、studySummary 單元測試;線上 favicon 為 app icon。

## Phase 8 — 對標頂尖日語 app 的強化(Tier 1,2026-07-10 對標評估後追加)

依市場對標(Anki/WaniKani/jpdb/Bunpro/Renshuu)評估;本階段四項皆「資料現成、相容純靜態離線」,見對標評分卡與路線圖。

- [x] **T8.1 語境例句上卡 + 朗讀**
  做什麼:複習卡揭曉後,顯示同課語境例句(含翻譯、furigana)與例句/單字 TTS 發音鈕。純函式 `findExampleSentence`(examples.ts):掃該課文法例句與会話,取含單字表面形的最短句;無則不顯示(誠實版,約 1/4 卡片受惠、零誤配)。876 句例句的完整舞台留待文法功能。
  驗收:`findExampleSentence` 單元測試(命中/取最短/null/略過單字元);複習頁例句與發音鈕測試。

- [x] **T8.2 Leech 頑固卡偵測 + 練習**
  做什麼:依 `lapses` 門檻(4,對標 Anki leech)偵測頑固卡;首頁琥珀色警示顯示數量並連到 `/practice`。新增 `/practice` 頑固卡練習頁——翻卡練習(依 lapses 由多到少、含例句與發音),純曝光不改 FSRS 排程。srs.ts 新增 `isLeech`/`countLeeches`/`getLeeches`;抽出共用 `SpeakButton` 元件(複習頁共用)。
  驗收:srs leech 單元測試;練習頁(空/翻卡/逐張完成)與首頁警示測試;`/practice` 入 SW precache。

- [x] **T8.3 Streak + 每日目標**
  做什麼:由 logs 算連續學習天數(含今日未複習的寬限)+ 今日目標進度環,顯示於儀表板(溫和單人版,無社交)。stats.ts 新增 `computeStreak`/`reviewsToday`;新增 `dailyGoal` 設定(預設 20)與設定頁控制;DATA_MODEL 同步。
  驗收:`computeStreak`/`reviewsToday` 單元測試(連續/中斷/寬限/空);首頁 streak 卡測試;`pnpm verify` 全綠。

- [x] **T8.4 課程列表真實進度**
  做什麼:課程列表右側「未開始」佔位接上實際狀態(未開始/進行中/已完成),源自各課 added·learned。stats.ts 新增 `lessonStatus`;列表頁讀 `db.cards` 計算並以色彩徽章顯示。
  驗收:`lessonStatus` 單元測試(四態);列表頁狀態渲染測試。

## Phase 9 — 對標強化 Tier 2(2026-07-10 追加)

- [x] **T9.1 文法速查 + 全文檢索**(SPEC F4)
  做什麼:新增 `/grammar` 文法速查頁——跨課文法列表(課號排序)+ MiniSearch 客戶端全文檢索(涵蓋文型、解說、例句、單字;CJK bigram tokenizer)。搜尋結果跳課程內頁錨點(LessonDetail 讀 hash 自動切文型分頁並捲動)。入口:首頁快捷(4 格),BottomNav 維持 6 分頁。索引於首次使用時以全 50 課建構(已 precache,離線可用),模組層快取。
  驗收:search.ts 單元測試(四類文件命中、CJK 子字串、空查詢);文法頁與 hash 切分頁測試;`/grammar` 入 precache;`pnpm verify` 全綠。

- [x] **T9.2 回想方向雙向卡**(義→日,設定可開關)
- [x] **T9.3 可 suspend / 跳過已會**(自訂課序暫緩:教材順序即自然序)
- [x] **T9.4 統計加 SRS 階段分布 + 可設 Desired Retention**

- [x] **T9.5 單字重音標記(pitch accent,SPEC F1.5)**(原 Tier 3 首項,2026-07-10 提前)
  做什麼:`pnpm enrich:accents`(scripts/enrich-accents.ts)以 kanjium 重音辭典(CC BY-SA 4.0)於建置期回填 `vocab.accent`——四層配對:表記+讀音精確、ます形音韻規則(核固定在「ま」= 拍數-1;kanjium 不收ます形)、表記唯一、讀音唯一(同音詞重音一致才採用),寧缺勿錯;覆蓋 82.9%(1744/2105),未命中(多詞慣用句、kanjium 未收之國名/こそあど等)誠實不標。手術式逐行寫回保持既有格式,diff 僅 accent 行。新增 `src/lib/pitch.ts`(拍切分、音高型)與 `PitchAccent` 元件(高拍上線、下降核豎線、平板尾延伸線、[n] 型號徽章),顯示於課程單字列與複習/練習卡背面。
  驗收:pitch.ts 與 enrich-accents 純函式測試、PitchAccent 元件測試、課程頁/複習頁 wiring 測試;`pnpm validate:content` 51/51;`pnpm verify` 全綠。

## Phase 10 — UI/UX 與學習正確性精進(2026-09-28 稽核後追加)

依 `docs/reports/2026-09-uiux-learning-audit.md`(5 維度稽核 + 逐項對抗驗證)排定。本輪範圍 = A 學習正確性 + B UI/UX;C 新學習內容、D 內容資料品質留待下一輪(候選清單見報告)。使用者決策(2026-09-28):學習日於**凌晨 4 點**換日;「補充單字(自行練習發音)」**預設排除**於整課加入與測驗出題。

### A. 學習正確性

- [x] **T10.1 學習日(4 點換日)與 ts-fsrs UTC 日界修正**
  做什麼:新增純函式 `src/lib/studyDay.ts`(`ROLLOVER_HOUR = 4`、`studyDayStart`、`nextStudyDayStart`、`studyDayKey`、`toFsrsTime`/輸出換回)。ts-fsrs 以 UTC 日期算 `elapsed_days`(台灣等於 08:00 換日),srs.ts 餵入 ts-fsrs 的所有時間(now、`due`、`last_review`)先平移成「UTC 日 = 本地學習日」,輸出以呼叫當下的 now 為基準換回真實時間(不對平移後的時刻再查一次時差,避免 DST 偏一小時);`previewIntervals` 同步。到期判定改為「按日」:`due < nextStudyDayStart(now)`(buildQueue、countDue、明日到期預估)。stats.ts 的分日(reviewsToday、computeStreak、dailyReviewCounts、dueForecast、retention 週界)改用 `studyDayKey`。DATA_MODEL §4 先更新。
  驗收:studyDay.ts 單元測試(Asia/Taipei 與 America/New_York DST 前後);srs 測試——22:00 評 Good(3 天)之卡於第 3 天 07:30 入列、跨 08:00 兩次複習的 `elapsedDays` 相同、03:00 的複習算前一天;stats 既有 00:00 分日測試改 4 點語意;`pnpm verify` 全綠。

- [x] **T10.2 今日佇列正確性**
  做什麼:(1) `buildQueue` 讀今日(學習日)logs:新卡額度 = `newPerDay − 今日首評的相異新卡數`(log.state===0 即評分前為 New),複習額度同理扣今日已複習筆數——修正「每次載入」重給 10 張的漏洞。(2) 雙向卡 sibling bury:同一 baseVocabId 今日已評過或已在佇列者不再入列;New 的 `@r` 卡須正向兄弟已非 New 且首評不在今日;正向卡先填滿新卡額度。(3) srs 新增共用 `queueCounts(now)`(`{ due, fresh, newCapReached }`)與 `hasAnyCards()`;首頁 Hero 顯示「複習 X + 新卡 Y」並在 >0 時給「開始複習」,全 0 才慶祝;`/review` 空狀態區分「尚未加入單字」「今日完成」「今日新卡已達上限」。(4) 今日目標改為 `min(dailyGoal, 今日已複習 + 佇列剩餘)`,佇列清空即算達標。(5) 首頁與 `/review`(僅空/結算狀態)在 `visibilitychange`/`pageshow` 可見時重新計算「今天」。(6) 開啟 fuzz,以 `GenSeedStrategyWithCardId` 為種子(`toFsrsCard` 帶 `card_id`),預估間隔與實際套用一致、兄弟卡不再同日成團;需確定值的測試改用關閉 fuzz 的內部選項。
  驗收:srs 測試——評完 newPerDay 張後同日 buildQueue 無新卡、隔日恢復;複習上限同理;reverseCards 開啟時同日佇列不同時含 X 與 X@r;preview 與 rate 間隔一致;首頁「只有新卡」顯示開始複習;review 空 DB 顯示引導;`pnpm verify` 全綠。

- [x] **T10.3 複習 session 體驗**
  做什麼:(1) 評「重來」的卡於本 session 約 5 張後重看(只曝光、不呼叫 `rate()`、不寫 log;按鈕「還不熟,再一次」(最多再 2 次)/「記住了」),結算頁列出本次答錯的字。(2) 復原:`rate()` 回傳 `{ card, prev, logId }`,新增 `undoRate()`(同一 transaction put 回 prev、刪 log);頂列「↶ 復原」可撤回上一個評分或略過(含移除插入的重看項、離開結算頁)。(3) 防重入:評分/略過進行中忽略輸入、RatingButtons 傳 disabled、忽略 `e.repeat`。(4)「已會·略過」只在翻面後出現、移離計數器;srs 新增 `setWordSuspended(vocabId, s)` 同時作用於 fwd 與 `@r`,課程頁與複習頁共用,暫停查詢以字為單位;`addCards`/`ensureReverseCards` 建 `@r` 時繼承正向卡的 suspended。(5) 翻面後顯示 `vocab.note` 搭配提示(`displayNote` 過濾「読み物」「会話」「補充單字(自行練習發音)」段落標記;rev 卡只在翻面後顯示);rev 卡題面加「詞性・第 N 課」以消除同義詞歧義。(6) 結算頁主連結改「回首頁」並顯示今日目標/連續天數。
  驗收:review 頁測試(重來後計數 +1、重看項不寫 log;復原後回到上一張已翻面且 logs 還原;連按兩次只評一次;翻面前無略過鍵);srs 測試(undoRate 還原 deep-equal、setWordSuspended 雙向、@r 繼承暫停);displayNote 測試;`pnpm verify` 全綠。

- [x] **T10.4 測驗判分與出題**
  做什麼:(1) 輸入比對正規化改 `toHiragana(toKatakana(s))`(長音「ー」羅馬字/平假名作答不再判錯)。(2) 新增 `acceptedAnswers(v)`:由 ruby 逐段 `r ?? b` 推導並併入 kana——「／」拆候選、［］〔〕可省略(含/不含皆可)、（）為替代說法(括號內外各為一答)、去除空白與「、・。」、「―/—」視同「ー」。(3) 只有含漢字讀音(`ruby.some(s => s.r)`)且表面不含「〜」「…」的字出輸入題,否則改出選擇題(純假名字的題幹不再等於答案)。(4) 補充單字(note = 補充單字(自行練習發音))不出題,仍可當干擾項。(5) 錯題加入複習改用新 `srs.requeueWrong()`:不存在者建立、已暫停者恢復、未到期者 due 提前至現在(不寫 log、不改 S/D;今日已評過、受兄弟卡 bury 者提前至下一學習日),結果頁顯示實際數量(新加入/提前到今天/明天複習/恢復/已在今日佇列/待學新卡)。(6) 結果頁加「再測一次」與「下一課測驗 →」。
  驗收:quiz 測試(ko-hi-/こーひー/kaado/kouhii 對 コーヒー、すき/すきな 對 すき［な］、おっと/しゅじん、トイレ/おてあらい、いい/よい、［お］仕事、ねこ≠コーヒー;純假名字不出輸入題;補充單字不出題);requeueWrong 測試(已評 Good 之卡隔日入列且 logs 不變、暫停者恢復);QuizResult 測試;`pnpm verify` 全綠。

- [x] **T10.5 語境例句邊界比對**
  做什麼:`findExampleSentence` 改為分かち書き邊界感知:跳過含「→」的活用對照行與「正規化後等於單字本身」的句子;假名開頭的單字須從句首或空白/「、「」…。?!」等之後開始;漢字開頭的單字前一字為漢字/數字(複合詞尾,社員 ⊂ 会社員)不配;前一字為「お」「ご」不配;同課有同表面形的另一字時須句中含其 note 的搭配名詞(名詞+助詞,如「音が」)。維持「寧可漏,不可誤配」。
  驗收:examples 測試改用教材空格格式,新增 うん≠ううん、すぐ≠まっすぐ、そこ≠あそこ、社員≠会社員、帰りに≠お帰りに、L47 します 配「音が しますね」、含 → 之行不選、句子=單字不選;全資料命中數與誤配清單記錄於 commit;`pnpm verify` 全綠。

- [x] **T10.6 全域設定生效**
  做什麼:(1) 課程頁初始 furigana 讀 `getSetting("furigana")`,頁內切換只影響本頁;furigana 隱藏時含漢字的字不顯示重音讀音(避免洩漏讀音)。(2) `ttsEnabled` 關閉時不渲染任何發音鈕(課程頁、複習、練習、測驗)。(3) tts.ts:語音清單非同步載入(`voiceschanged` + 逾時)、優先 `localService` 的 ja 語音並快取;朗讀文字去除［］〔〕（）〜…／等記號。
  驗收:LessonDetail 測試(全域 hide → 無 rt;hide 時含漢字字無重音讀音;ttsEnabled=false 無發音鈕);tts 測試(延遲 voiceschanged、localService 優先、記號剝除);`pnpm verify` 全綠。

- [x] **T10.7 進度與統計語意**
  做什麼:(1) `lessonProgress`:正向卡已會(suspended)計為已學會;最後一次評分為「重來」的卡不計為已學會(`lastRatingByCard(logs)` 純函式),課程列表一併讀 logs;統計「學習中」改為「Review 且最後評分為重來」。(2) 頑固卡於 stability ≥ 成熟門檻後解除(`isLeech`)。(3) 統計卡數與首頁一致(註明單字/卡片)。(4)「重置所有進度」保留設定(只清 cards/logs/progress),文案同步;DATA_MODEL 註記。
  驗收:stats 測試(已會計入完成、只答過重來者不算已學會、階段分布);isLeech 成熟解除測試;backup 測試(重置後 settings 保留);`pnpm verify` 全綠。

### B. UI/UX

- [x] **T10.8 日文排版**
  做什麼:`RubyText` 根元素 `lang="ja"`;PitchAccent 視覺層與降級文字加 `lang="ja"`,中文說明改 sr-only(不把 ja 掛在中文標籤上);課名、文型 pattern、会話說話者、分頁標籤等日文加 `lang="ja"`。globals.css 移除 Arial,定義 `--font-sans`(繁中系統字)與 `--font-jp`(Hiragino / Noto Sans JP / Yu Gothic 等系統字,不下載 web font),`:lang(ja)` 套用。`rt` 至少 10px;日文 `word-break: keep-all` + `overflow-wrap: anywhere`(依教材空格斷行);例句/会話行距一致。純假名字的單字列不重複顯示讀音(以 PitchAccent 取代標題)。pitch.ts 對 kana 內非假名字元(…、、)不計拍、原樣顯示。
  驗收:RubyText/PitchAccent 測試(lang、sr-only 文字)、pitchPattern('…ばい',0) 拍型、LessonDetail 純假名字只渲染一次;light/dark 截圖回歸;`pnpm verify` 全綠。

- [x] **T10.9 Design tokens、深色模式與對比**
  做什麼:globals.css 以 shadcn 命名建立語意 token(background/foreground/card/muted/muted-foreground/border/input/primary/link/success/warning/destructive/rating-*/pitch/heat-0..4),深色值放在 `@media (prefers-color-scheme: dark)`(不用 `.dark` class、不跑 `shadcn init`),`@theme inline` 映射為 Tailwind 色彩;`color-scheme: light dark`;themeColor 依配色。全站替換寫死的 bg-white/neutral-*/sky-*/text-foreground/50 等(stats、settings、PwaSetup、UpdatePrompt、Heatmap、Recharts 顏色與 Tooltip)。新增 shadcn 樣式 `src/components/ui/button.tsx`(`buttonVariants`,不含 asChild/radix)統一主/次/ghost 按鈕與 Link 按鈕。BottomNav active 態加顏色與指示條。所有文字對比 ≥ 4.5:1(兩種配色)。
  驗收:Button 測試;既有測試全綠;light/dark 截圖回歸(統計/設定無白塊);首頁 gzip JS 仍 < 200 KB;`pnpm verify` 全綠。

- [x] **T10.10 觸控、無障礙與提示**
  做什麼:icon/文字按鈕觸控區 ≥ 44px(負 margin 保持版面);翻卡按鈕不以 aria-label 覆蓋內容、翻面後焦點移至答案;評分鍵 accessible name 含間隔、快捷鍵數字僅桌面顯示;課程頁分頁改 aria-pressed 分段按鈕(或補齊 tabpanel);回饋加 `role="status"`;輸入框 ≥ 16px(避免 iOS 放大)。安裝提示拆為首頁內嵌卡片(非 fixed,不遮擋操作),`ensurePersistentStorage` 仍於每頁啟動執行。新增繁中 `not-found.tsx`;載入文字抽成共用 `Loading`(role=status)。
  驗收:PwaSetup/InstallPrompt 測試(每頁 persist、首頁才顯示提示、standalone 或已關閉不顯示);RatingButtons/review 無障礙名稱測試;Playwright 量測主要互動元素 ≥ 44px;`pnpm verify` 全綠。

- [x] **T10.11 導覽與流程**
  做什麼:課程內頁標頭加「測驗本課」「‹ 上一課」「下一課 ›」;「整課加入複習」預設排除補充單字(按鈕註明「不含補充 N 字」),加入後以 role=status 顯示「已加入 N 字 · 開始複習 →」(`addCards` 回傳新建數);note 段落標記(読み物/会話/補充)改小徽章。文法速查錨點改於分頁 commit 後捲動(修 client 導覽不捲動)、單字搜尋結果帶單字錨點並短暫高亮;分頁與搜尋字串以 `history.replaceState` 存於 URL;分頁列與搜尋框 sticky。課程列表先渲染索引再補狀態,返回時捲動位置可還原。
  驗收:LessonDetail 測試(上/下一課連結、整課加入排除補充並顯示數量、分頁 hash 同步、錨點捲動被呼叫、單字錨點);search 測試(單字 anchor);lessons 列表 db pending 時已渲染;`pnpm verify` 全綠。

## Phase 11 — 新學習內容(2026-09-29 追加,稽核報告 C 組)

依 `docs/reports/2026-09-uiux-learning-audit.md` 的 C 組候選(LC-01/02/04/05/08/09/10/11,含驗證者修正)。全部為單次練習、不寫入 SRS;活用形由規則推導、不寫入 `public/data`,不確定者排除(寧缺勿錯)。對應 SPEC F7、F3.1。

- [x] **T11.1 課程頁自我測驗與詞性篩選**(LC-02,F7.1)
  做什麼:単語分頁加「遮住:無/中文/日文」分段按鈕(aria-pressed),被遮欄位改為可點擊揭示(button + aria-expanded),遮日文時保留發音鈕,提供「全部顯示/重新遮住」(只作用於目前篩出的字);詞性篩選 chips(全部/名詞/動詞/形容詞/其他),分組邏輯為純函式 `src/lib/vocabFilter.ts`;文型與会話分頁「隱藏中譯」開關(點句揭示)。狀態只在元件內(不新增 settings key)。
  驗收:vocabFilter 單元測試(13 種 PosEnum 全覆蓋);LessonDetail 測試(遮罩切換、點擊揭示、篩選、隱藏中譯);`pnpm verify` 全綠。

- [x] **T11.2 会話朗讀與角色扮演**(LC-04,F7.2)
  做什麼:文型例句與会話每句加發音鈕(`speechText` 清理);純函式 `src/lib/dialogue.ts`(`isTitleLine`、`speakersOf`、`buildPlayback(lines, {role})`);`tts.ts` 新增可取消的 `speakSequence`;会話分頁工具列「▶ 全部播放」(目前句高亮、可停止)與「扮演:[說話者]」(該角色台詞遮住、輪到時暫停等「下一句」)。標題行(L15/L23/L24/L41 的 D01)顯示為小標,不列入播放與扮演。TTS 關閉或無日語語音時隱藏播放功能。
  驗收:dialogue 測試(4 種標題寫法、扮演產生 wait);speakSequence mock 測試(串接、中途取消);LessonDetail 会話測試;`pnpm verify` 全綠。

- [x] **T11.3 活用引擎(基本形)**(LC-01,F7.3)
  做什麼:純函式 `src/lib/conjugate.ts`。動詞(ます形 → ません/ました/ませんでした/て/た/ない/なかった/辞書形)、い形容詞(くない/かった/くなかった/くて/く 與丁寧體)、な形容詞(じゃ ない/だった/じゃ なかった/で/に 與丁寧體;く/に 為「〜く/に なります」L19-G04,對應 golden L19-S08/S09);輸出 `{ ruby, kana }`,只活用最後一個空格分隔的詞、前綴原樣保留,来る系改寫「来」段讀音(こ/き/く)。例外:行く系 て/た、ある→ない、-aru 敬語(いらっしゃる/おっしゃる/くださる/なさる)、する複合、いい→よ-。排除清單(回傳 null):L40-V055(非ます形)、L32-V010(並列兩詞)、L50-V010(ございます,ござる 系不練習)、pos 誤標的 L07-V006、L47-V004..006(資料修正後移除)。`FORM_INTRO`:各形 → {課號, 文法點 id}(ます系 L04-G03、て L14-G03、ない L17-G01、辞書 L18-G01、た L19-G01、普通形 L20-G01;形容詞丁寧體 L08-G02、L12-G01/G02,て形 L16-G02/G03,く/に L19-G04,普通形 L20-G01)。
  驗收:教材對照 golden test(L14-S11..S14、L17-S01/S02、L19-S08/S09);每條例外各一例;全資料 property test(所有非排除動詞/形容詞皆產生輸出、ruby 串接讀音 = kana、漢字段 r 未被拆壞、排除清單恰為上列);`pnpm verify` 全綠。

- [x] **T11.4 活用練習頁 `/drill`**(LC-01,F7.3)
  做什麼:新增 `/drill` 靜態頁(加入 SW precache 路由)。範圍預設為已開始學習的最大課號(可調整),只開放該課以前已導入的形;題目從範圍內動詞/形容詞抽樣(排除補充單字)。四選一(干擾項以錯誤規則產生,例:書きて/書って/書んで,過濾等於正解者、不重複)與輸入題(沿用 quiz.ts 正規化);答錯顯示正解、朗讀,並連到該形的文法解說(`/lessons/N#Lxx-Gxx`);結果頁分數與錯題。入口:`/quiz` 頁頂端「練習」區塊、課程頁標頭(本課有動詞或形容詞時)。
  驗收:干擾項與出題純函式測試(不含正解、不重複、依範圍開放形);頁面測試(作答、回饋、結果);`pnpm verify` 全綠;build 後 `/drill` 可離線開啟。

- [x] **T11.5 進階活用形**(LC-01,F7.3)
  做什麼:`conjugate.ts` 加可能(L27-G01)、意向(L31-G01)、命令/禁止(L33-G01)、條件ば(L35-G01,含形容詞 〜ければ/〜なら)、受身(L37-G01)、使役(L48-G01);可能/受身/使役以辞書形作答(題目標明);する→できる、来る→来られる/来よう/来い 等例外;各形排除清單(教材明說無此形者,如 わかります/できます/あります/見えます/聞こえます 無可能形,及語意不成立者,後者依 id 列於 `conjugateExclusions.ts`),出題以(字, 形)逐一判斷,`/drill` 依進度開放。
  驗收:教材對照 golden(L48-S01..S03 等)、各例外測試、全資料 property test;`pnpm verify` 全綠。

- [x] **T11.6 例句重組**(LC-05,F7.4)
  做什麼:純函式 `src/lib/reorder.ts`(`chunkRuby` 只在無 r 段的半形空格與「、」後切、空格丟棄、「、」附前塊;抽取時多出空格的片段併入相鄰塊:純記號、單獨的 お/ご(含緊接漢字段後者)、英數字(9 時→9時、871 の→871の)、後接漢字的純片假名或促音收尾片段(ワット 先生、引っ 越し);`isReorderable` 3–8 塊、句末標點至多一個且在句尾、排除含「→」對照行(12 行)與標題行,另排除對話者標記(Ａ:)、［］〔〕（）／記號、外文片語、詞被切開而規則併不回的 3 句(L08-S15、L28-S10、L50-S14),可移動的塊至少兩種文字;`makeReorderItem` 6 塊以上固定首尾、打亂必與原句不同(洗出原順序時左移一位);`checkOrder` 以塊文字比對)。以課為單位的重組練習 `/reorder/[id]`(`/reorder` 選課;同課重列句去重、中譯標示較晚課次「(第 N 課)」的例句不出題;至多 8 題,題幹為中譯,點塊依序排入答案列、可移回;答錯標出位置不對的格並顯示教材原句與朗讀,註明「語序以教材為準」;略過;結果頁;換題/作答/移回後 300ms 內的點擊忽略,防雙擊跳過回饋)。入口:`/quiz` 練習區塊與課程頁標頭(上/下一課改為 ‹ › 箭頭,375px 寬排得進一列)。實測可出題 760 句(文型例句 593 + 会話 167;各課出題池合計 751,每課 3–23 句)。
  驗收:reorder 測試(真實 L14/L36 句:接回一致、r 段不拆、「、」附前塊、抽取痕跡併塊、打亂≠原順序、重複塊以文字比對、排除規則);全資料測試(可出題句數、每課可組成一回合、切塊無抽取痕跡);頁面測試(排入/移回、答對/答錯回饋、略過、結果、雙擊防護);`pnpm verify` 全綠。

- [x] **T11.7 助詞搭配練習**(LC-11,F7.5)
  做什麼:純函式 `src/lib/particles.ts`(`parseCollocation(note)` → `{ noun, particle, predicate, reading?, gloss? }`,只取 note 原文、不補新搭配:［…］〔…〕與無括號、〔〜を します:中譯〕(名詞單字本身在前)、〜後的後續(〜が あります)、並列(〔うちが〜〕〔パンが〜〕、〔音／声が〜〕;［でんきが〜］［電気が〜］合併為帶讀音的名詞);沒有助詞、〜不是單字本身、選項以外的助詞(から/まで/より/の,現有資料 0 筆)與並列兩詞的單字(L32-V010)排除);題目「たばこ（　）吸います」從 を/に/が/で/へ/と 出 4 個選項(依此順序;方向的 に/へ 算同一格,選項中至多一個;教材搭配外同義也自然的助詞依單字 id 列於 `ALSO_NATURAL`、不當干擾項(友達と 会います、公園で 散歩します…),干擾項因此不足 3 個者不出題(L50-V027);單字的可省略前綴［お］依讀音顯示為お或省略);標示「教材搭配」並註明其他助詞有時也自然;範圍同 `/drill`(?upto=),作為其另一分頁(「活用/助詞」分段鈕,`?mode=particle` 加入 SW 忽略參數);每回合 10 題,〔〜を します〕型至多 2 題;作答/換題/進結果頁後 300ms 雙擊防護。
  驗收:parse 測試(三種寫法與不可解析回傳 null、覆蓋數記錄:可解析 171、出題池 169)、選項測試(含正解、不重複、に/へ 至多一個、`ALSO_NATURAL` 不出現);頁面測試;`pnpm verify` 全綠。

- [x] **T11.8 測驗新題型:聽力與例句填空**(LC-08、LC-10,F3.1)
  做什麼:`quiz.ts` 新題型 `listen`(聽發音選中文;朗讀文字用清理後的表面形;只在 ttsEnabled 且有日語語音時啟用;排除 kana 含非假名字元者)與 `cloze`(以 `examples.ts` 的邊界比對找本課例句,把單字所在段挖空,同詞性干擾項;排除慣用語、句=字、含→ 行,並顯示中譯);測驗開始前可勾選題型。
  驗收:generateQuiz listen/cloze 測試(挖空位置正確、同句只挖一處、無語音時不出 listen);QuizRunner 測試;`pnpm verify` 全綠。

- [x] **T11.9 動詞語境例句擴充**(LC-09)
  做什麼:`findExampleSentence` 對動詞追加活用形比對(用 `conjugate.ts` 的形:ます系 〜ません/〜ました/〜ましょう/〜まして、〜たい/〜ながら/〜にくい 等、て/た/ない/なかった/〜なければ/〜なくて/辞書/意向/條件形,被動形與Ⅱ・Ⅲ類的可能/使役形再依Ⅱ類活用;Ⅰ類可能/使役形常與別的動詞同形(切れる、知らせる)不收),只在全課沒有ます形命中時才用(ます形一律優先),同樣取最短句。須在文節開頭(漢字開頭也須在句首/空格/「、」等之後)、右邊界合規(詞尾後為邊界字元或 〜と/〜のが/〜たら 等)、句中該段讀音與推導讀音相同(開(あ)いて ≠ 開(ひら)いて);ます形語幹不足 2 字(します/出ます/来ます…)與同課同表面字沿用 T10.5 的 note 名詞守門(名詞須在活用形之前;note 多個括號皆收);無漢字動詞語幹不足 3 字者只收ます系,其餘形也須 note 名詞,且前一詞為て形(補助動詞位置)不配;あります 另不配 〜じゃ/では/く ありません(否定);義項不同者依 id 排除(L24-V004)。`findExampleMatch` 回傳比對種類 `kind: 'exact' | 'conjugated'`,例句填空只用 exact。維持寧可漏、不可誤配。
  驗收:examples 測試(会います 命中「会いましょう」、L34-V007 します 不命中、L46-V032 出ます［本が〜］ 不命中「バスが 出た」(L46-V004［バスが〜］命中),各規則一例);全資料既有誤配清單仍不出現,命中數 before/after 記錄於 commit(動詞 42 → 141,全部單字 434 → 533;新增 99 組逐一核對);例句填空不用活用形命中(填空 370 字不變);`pnpm verify` 全綠。

> **Phase 11 整體審查修正(2026-09-30)**:活用練習補上與助詞搭配、例句重組、測驗一致的 300ms 雙擊防護(換題後點選項、作答後點「下一題」、結果頁進場時的按鈕與「看文法」連結),單字測驗結果頁一併補上;防護共用 `src/lib/useTapGuard.ts`(起點於 layout 階段記下,非同步載入後的第一題也不會晚記);「下一題」被底部導覽列擋住時捲出(`src/lib/scroll.ts`,活用/助詞/重組/測驗共用);`/grammar?q=` 加入 SW precache 忽略參數(離線重新整理可開);活用練習開始鈕顯示實際題數((字, 形)不足 10 組時);輸入題接受平文式羅馬字「tch」(出張 shutchou);時間相關測試改用 `src/test/` 共用 helper(停住/步進時鐘、長計時器、慢測試逾時)。

## Phase 12 — 內容資料品質(2026-09-30 追加,稽核報告 D 組)

依 `docs/reports/2026-09-uiux-learning-audit.md` 的 D 組(DQ-07 content-lint、DQ-08 標點、資料修正清單「不需 PDF」各項;DQ-06 例句圈號只記錄編號模型)排定,數字為 2026-09-30 四份偵察對真實 `public/data` 的實測。使用者決策(2026-09-30):不需 PDF 的資料修正以**腳本手術式寫回** `public/data`(禁止手改),commit 逐筆說明;「需對照 PDF 校讀」清單不在範圍內(本環境沒有 PDF),留在報告作為清單;唯一例外是第 4 項 furigana 跨越記號,偵察證明分段方式唯一、不需 PDF,排為 T12.5。寫入 `public/data` 的只有 `scripts/fix-content.ts`(宣告式修正清單,T12.2 起)與 `scripts/normalize-zh-punct.ts`(規則式,T12.6),寫法比照 `enrich-accents.ts`(見 T12.2)。先上 content-lint(T12.1),現存問題列為精確的待修清單,之後每個修正任務以「待修清單少了哪些 id」驗收;每筆修正另由 vitest 資料測試釘住(CI 只跑 `pnpm verify`,不跑 `validate:content`),日後從 PDF 重新抽取而蓋回時 `pnpm verify` 失敗。`VocabItem.id`(= cardId)一律不變;D id 只在 T12.4 的 4 課遞補(D/S/G id 未持久化,DATA_MODEL §2),S id 不重編(程式與測試有引用)。App 介面文案的半形標點不改(評估後延後,見報告)。

- [x] **T12.1 content-lint**(DQ-07)
  做什麼:純函式 `scripts/content-lint.ts`(不讀檔、無副作用;匯出 `RULES`、`lintContent(ctx)`、`formatReport`、`punctuationSummary`、`big5Charset`;非執行期程式,不放 `src/lib`)。(1) **error 15 條**(現況皆 0 或只剩待修清單;T12.5 把 ruby-r-scope 升為 error、T12.6 再加 zh-punct,共 17 條):lesson-set(課號 1..50 依序、檔名 = id)、index-match(index.json 的 title/vocabCount/grammarCount = 課程檔)、id-format(V/G/S/D 格式與前綴 = 課號;S/D 在 Zod 只是 string)、id-unique(全域 3,846 個)、id-sequence(V/G/D 依陣列順序自 V001/G01/D01 連號;S 不含)、ruby-han-has-r、ruby-r-hiragana、ruby-r-target(有 r 的段須含漢字或數字)、text-hygiene(首尾/連續空白、全形空白、NBSP、tab、換行、零寬、半形片假名;檢查串接後的表面,54 個 `{b:" "}` 分隔段合法)、ja-lookalike-dash(日文欄位不含 ‐―−－─～~ｰ 等近似字)、kana-no-han-latin、verb-class-shape(ます前一字的段與 動I/II/III 相符;動詞末詞為 します/来ます 者須為動III)、adjective-shape(い形 kana 以い結尾;表面含［な］〔な〕者為な形)、dialogue-speaker(会話每行 speaker 非空且不含「標題」)、zh-glyph(meaning/translation/explanation 不含 Big5 標準字集——A140–A3BF、A440–C67E、C940–F9FE,排除 HKSCS——以外的漢字與日文字形黑名單 `証伝弁体虫芸豊糸缶与触党痴`;explanation 先剝除「」『』〔〕與含假名的引用日文,meaning/translation 只剝「」;稽核原列 warning,2026-09-30 決定升為 error)。Big5 字集以 `TextDecoder("big5")` 建立、經 ctx 注入,無 ICU 時明確丟錯。(2) **待修清單** `PENDING_FIXES`(規則 → id,恰 11 id / 12 筆:ja-lookalike-dash L04-V050×2;zh-glyph L41-G04、L43-D08、L48-V011;verb-class-shape L47-V004..006;dialogue-speaker L15/L23/L24/L41-D01):命中者標為待修、不算失敗;清單有多餘項也算失敗(不成為永久漏洞)。(3) **warning 10 條**:kana-symbols(19)、kana-vs-ruby(6)、ruby-r-scope(9)、verb-not-masu(1)、na-adjective-marker(7)、cross-lesson-duplicate(33 組 / 74 筆)、pos-inconsistent(8)、sentence-id-order(2:L01、L37)、speaker-alias(1:L02)、zh-lookalike(4);另印中文欄位半/全形標點比例摘要。(4) `validate-content.ts`:加上直接執行才跑 main 的守門;`validateFile` 回傳 parse 結果;Zod 或檔名有錯時照舊 exit 1 並略過 lint;否則 error 印「✗ [規則] N 筆 — 說明」與前 5 筆並 exit 1,待修印「⏳」不影響結束碼,warning 印「⚠」、前 5 筆、「…另 N 筆」與標點摘要,**永不改變結束碼**;`--all`、`--rule <id>` 印完整清單(PDF 校讀用)。文件:DATA_MODEL §1.1(S/D id 格式由 content-lint 把關)與 §4 新增不變式「content-lint error 規則全過」、PIPELINE §1 步驟 4 與 §3、ARCHITECTURE 工具表與 scripts 目錄。
  驗收:`scripts/content-lint.test.ts` 每條規則至少一正一反合成案例(含 Big5 排除 HKSCS、剝除引用日文後 会/来/帰/辞 不誤報、`{b:" "}` 分隔段不誤報、待修清單多一項即失敗);`scripts/content-lint.data.test.ts` 對真實資料——50 課與 index.json 通過 Zod、檔名 = id、每條 error 規則以 `it.each` 斷言除待修清單外 `toEqual([])`、待修命中恰為上列 11 id、warning 釘 id 清單(cross-lesson-duplicate 釘組數;這是 ratchet,日後任何資料修正(含 PDF 校讀)須在同一 commit 更新);測試不 import `validate-content.ts`;`pnpm validate:content` 51/51 通過並印出 warning 與待修;`pnpm verify` 全綠。

- [x] **T12.2 修正腳本與文字修正**(資料修正清單 2、3 + 偵察補列 1 筆)
  做什麼:`scripts/fix-content.ts` + `pnpm fix:content`(`--check` 只列狀態,有待套用項 exit 1)。寫法比照 `enrich-accents.ts`:純函式核心、直接執行才跑 main;以唯一的 `"id": "<id>",` 行定位物件、在其範圍內替換恰好一次的 `"key": JSON.stringify(from)`(課程檔排版不一,序列化器只能逐位元重現 5/50 檔,不得整檔重寫);寫入前重新 parse,與「記憶體中套用修正的預期模型」`isDeepStrictEqual`、核對 key 順序、`LessonSchema.parse`;重跑 0 變動且逐位元相同。宣告式 `CORRECTIONS`,每筆 `{ kind: "field", lesson, id, field, from, to, reason }`(kind 區分修正種類,T12.4、T12.5 各加一種),field ∈ `pos`/`kana`/`meaning`/`explanation`/`translation`/`ruby.<i>.b`;日文與 enum 欄位比對整值,中文欄位比對子字串(from 恰出現一次;與 T12.6 標點正規化的先後互不影響;同一欄位可有多筆不同 from 的修正)。狀態:現值為 to(子字串:不含 from 且含 to)= 已套用、不動作;為 from = 套用;其他 = 報錯中止;全部套用後每筆須呈已套用(否則不冪等,拒絕寫入)。本任務 6 筆:L04-V050 `ruby.0.b` 與 `kana`「え―と」(U+2015)→「えーと」(U+30FC);L41-G04 explanation「証明」→「證明」、L48-V011 meaning「簽証」→「簽證」(日文字形外洩的字形正規化;中文取自 PDF 中文版,原文可能即印如此,commit 註明);L43-D08 translation「渡辺」→「渡邊」(自譯,其餘 7 處皆為渡邊;speaker 與日文 ruby 的渡辺不動);L49-D02 translation「漢斯・施密特」→「漢斯·施密特」(自譯,與 L01「邁克·米勒」一致;偵察補列、稽核清單外)。`tts.ts`、`quiz.ts` 的「教材的 え―と」註解改為曾出現(正規化行為與其單元測試保留)。文件:ARCHITECTURE 工具表與 scripts 目錄加 fix-content;PIPELINE 註明 `fix:content` 是允許寫入 `public/data` 的來源(DATA_MODEL §4-2 的 fixture)。
  驗收:`scripts/fix-content.test.ts`(合成 RAW:只有目標行改變、重跑逐位元相同、現值不符即丟錯、子字串出現 0 或 2 次即丟錯、key 順序不變、`--check` 判定);`scripts/fix-content.data.test.ts` 對真實資料 `it.each(CORRECTIONS)` 狀態皆為已套用(任一筆改回即失敗);content-lint 待修清單移除 L04-V050、L41-G04、L43-D08、L48-V011(剩 7 id),warning kana-symbols 19 → 18、zh-lookalike 4 → 3;`tts.data.test.ts` 該列改為 えーと,`quiz.data.test.ts` 聽力 1988 → 1989(填空 370 不變);重跑 `enrich:accents`(kanjium 來源 `pipeline/work/accents.txt`)、`build:index` 無差異,第二次 `pnpm fix:content` 0 變動;`pnpm validate:content` 通過;`pnpm verify` 全綠;commit 逐筆列出 6 筆修正與理由。

- [x] **T12.3 動詞分類修正**(資料修正清單 1)
  做什麼:`CORRECTIONS` 加 4 筆 pos:L07-V006 借ります 動I → 動II;L47-V004/005/006「します」〔音／声が〜〕〔味が〜〕〔においが〜〕動I → 動III。`conjugate.ts` 刪除 `CONJUGATION_EXCLUDED` 的這 4 筆與 TODO 註解(剩 L32-V010、L40-V055、L50-V010);`conjugateExclusions.ts` 把 L47-V004..006 加入無意志動詞組(只留條件形;否則會推導出「音が できる/しよう/しろ」)。`conjugate.test.ts`、`drill.test.ts` 以 L07-V006 當「依 id 排除」樣本的測試改用仍在清單的 L40-V055(fixture 離れます),保住該機制的測試。連動修正(實作時發現):修正後 L47 的 3 個「します」與 長生きします、婚約します 同為動III,中→日選擇題(選項只顯示 ruby、不顯示 note)必出重複的「します」;`quiz.ts` 的日→中/中→日選項改以顯示的文字去重(中文 / 日文表面形,同聽力與填空的 distinctBy),順帶修好既有的重複選項(日→中:L03 そこ/あそこ、L30 まとめます/片づけます 中文相同;中→日:あります、います、出ます 各有多筆)。
  驗收:content-lint 待修清單移除 L47-V004..006(verb-class-shape 為 0,剩 4 id),warning pos-inconsistent 8 → 7;`quiz.test.ts`、`quiz.data.test.ts`(全部 50 課 × 課號 ±2 出題池)日→中/中→日選項顯示的文字不重複;`fix-content.data.test.ts` 釘住 4 筆(借ります 無形狀規則可偵測,只靠此測試);`conjugate.data.test.ts`——排除清單恰為 3 筆、L07-V006 推導 借りて、L47-V004 推導 して、覆蓋 動詞 451/458 → 455/458(動I 226/232 → 226/228、動II 128/129 → 129/130、動III 97/97 → 100/100)、ok 589 → 593、基本形 451 → 455、`ADVANCED_TOTAL` 2456 → 2466、`EXCLUSION_KANA` 補 3 列、conditionalOnly 91 → 94、進階形 可能/意向/命令 309 → 310、禁止 316 → 317、條件 433 → 437、受身 324 → 325、使役 318 → 319;`drill.data.test.ts` L07-V006 進入出題池、L47-V004..006 因重列去重不在池中(保留 L06-V010 します);`examples.data.test.ts` 動詞例句 42/99/141 → 42/100/142、全部單字 533 → 534,新增配對 L07-V006 → L07-S15「銀行から お 金を 借りました。」(資料原樣,「お 金」的空白見 T12.7);`pnpm validate:content` 通過;`pnpm verify` 全綠。

- [x] **T12.4 会話標題移入 `dialogueTitle`**(資料修正清單 4)
  做什麼:先改 DATA_MODEL 與 `LessonSchema`:§1.2 新增選填 `dialogueTitle: { ruby: RubySeg[](min 1), translation: string(min 1) }`(置於 `dialogues` 前;Zod 丟棄未知 key 且 `content.ts` 以 safeParse 載入,schema 必須與資料同一個 commit 或更早,否則標題默默消失);§1.1 註明 D 從 01 連號;§4-1 註明「不得改變既有 id」指 `VocabItem.id`(cardId),D/S/G id 未持久化,重編須在同一 commit 更新程式、測試與文件的引用;PIPELINE §2 註明会話標題存 `dialogueTitle`、不當第一行台詞。`fix-content.ts` 新增「標題」修正種類:D01 完全等於預期(speaker 為「（標題）」「標題」或缺漏)且尚無 `dialogueTitle` 時,把該行的 ruby 與 translation 移入 `dialogueTitle`、後續 D id 依序遞補(L15/L23/L24 D02..D12 → D01..D11、L41 D02..D13 → D01..D12);已套用 = `dialogueTitle` 等於預期、D 從 01 連號、dialogues 不含該句。執行期:LessonDetail 会話分頁改讀 `lesson.dialogueTitle` 顯示小標(ruby + 中譯,隱藏中譯時同樣可點擊揭示);刪除 `dialogue.ts` 的 `isTitleLine`/`TITLE_SPEAKER_RE`、`reorder.ts` `isReorderable` 的 index 參數、`quiz.ts` `makeCloze` 的標題集合,改寫 dialogue.ts 開頭註解。
  驗收:schema 測試(`lesson.test.ts`:有/無 dialogueTitle、空 ruby 或空 translation 失敗);`fix-content.test.ts`(標題移入 + 重編號 + key 順序、重跑不變);`fix-content.data.test.ts` 4 筆已套用;content-lint 待修清單清空並刪除 `PENDING_FIXES` 機制(15 條 error 在真實資料上零例外),ruby、text-hygiene 與 zh-glyph 規則涵蓋 `dialogueTitle`;資料測試釘住——有 `dialogueTitle` 的課恰為 [15, 23, 24, 41]、会話台詞 528 → 524 行(`dialogue.test.ts`)、例句重組 760 句與各課出題池 751 不變(`reorder.data.test.ts`)、填空 370 不變(`quiz.data.test.ts`)、語境例句改配真正的台詞 L15-V025 → L15-D09、L24-V001 → L24-D04、L41-V036 → L41-D05(`examples.data.test.ts`);`dialogue.test.ts`、`reorder.test.ts`、`reorder.data.test.ts`、`quiz.test.ts`、`quiz.data.test.ts`、`LessonDetail.test.tsx` 改用新結構(fixture 的 L24-D01「標題」改為 dialogueTitle;標題以小標顯示、不列入播放與扮演);行為符合 SPEC F7.2、F3.1(規劃時已更新),ARCHITECTURE(dialogue.ts 說明)同步;`pnpm validate:content` 通過;`pnpm verify` 全綠。

- [ ] **T12.5 furigana 不跨越記號**(PDF 校讀清單第 4 項;偵察證明分段方式唯一、不需 PDF)
  做什麼:`fix-content.ts` 新增「ruby 分段」修正種類(一段換成多段;宣告 `{ lesson, id, field: "ruby.<i>", from: RubySeg, to: RubySeg[] }`,只在串接的 `b` 不變、讀音只取假名後不變時允許,否則報錯),修正恰為 content-lint warning ruby-r-scope 的 9 段:L02-V039 `{違います。/ちがいます}` → `{違/ちが}{います。}`;L02-V036 〜語、L23-V013 〜屋、L37-V030 〜中 的「〜」獨立成段;L21-S12「「来週」的「「」獨立;L11-S05/S07/S09/S11 的「…」獨立。ruby-r-scope 由 warning 升為 error(error 16 條、warning 9 條;T12.6 再加 zh-punct)。
  驗收:`fix-content.test.ts`(分段:串接與讀音不變才允許、違反即丟錯、key 順序與排版不變、重跑不變);`fix-content.data.test.ts` 9 筆已套用;content-lint ruby-r-scope 在真實資料為 0;`quiz.data.test.ts` 例句填空 370 → 371(L11-V012 8つ 新增 L11-S05 挖空);這 4 個單字的可答讀音與朗讀文字、5 句的例句重組切塊不變(資料測試釘住);`pnpm validate:content` 通過;`pnpm verify` 全綠。

- [ ] **T12.6 中文標點全形化**(DQ-08)
  做什麼:稽核原建議顯示層 `normalizeZhPunct()`;實測改為**建置期改寫資料**(顯示層須在 12 檔約 31 處呼叫、新元件易漏,且修不到 quiz.ts 不認「﹐」的干擾項 bug,mock 內容的 UI 測試也測不到)。`scripts/normalize-zh-punct.ts` + `pnpm normalize:zh-punct`(先印 dry-run 摘要,`--check` 有待改項 exit 1)。純函式 `normalizeZhPunct`:R1 `,` → `，`(保留千分位 `\d,\d{3}(?!\d)`)、R2 `;` → `；`、R3 `:` → `：`(保留 `\d:\d`)、R4 `?` → `？`、`!` → `！`、R5 `(` → `（`、`)` → `）`(不論是否成對,連帶修好「1）」列舉與寬度不一的括號對)、R6 刪除被轉換標點兩側的 ASCII 空白(其他空白保留)、R7 小型變體 ﹐﹑﹖(與防禦性的 ﹔﹕﹗﹙﹚)→ 一般全形、R8 成對的 ASCII `"` → “ ”(奇數個不動)、R9 `～`(U+FF5E)→ `〜`(U+301C,與其餘 143 筆一致);`.` `-` `/` `…` `、`、全形英數、U+2011 不動。欄位:vocab.meaning、vocab.note(段落標記 `SECTION_MARKER_NOTES` 除外,由 `notes.ts` import)、grammar.explanation、examples 與 dialogues 的 translation、dialogueTitle.translation;pattern、title、speaker、ruby、kana 不動。只替換原始 JSON 中這些鍵的字串值(與 fix-content 共用手術式替換 helper),寫入前後 Zod 驗證、id 與非中文欄位完全相同、行數不變。實測改動 535 筆值(note 38、meaning 46、explanation 189(含只因 R9 而變的 L41-G04;L22-G02 另有半形標點,已計入)、例句 125、会話 137;T12.2–T12.5 不影響此數),commit 寫入規則、各欄位數量、8 個保留的千分位與特例(以腳本摘要為準)。文件:DATA_MODEL §4 新增不變式(中文欄位標點全形,只有千分位半形)、PIPELINE 抽取後步驟加 `normalize:zh-punct`、ARCHITECTURE 工具表與 scripts 目錄;行為符合 SPEC F1.6(規劃時已追加)。
  驗收:`scripts/normalize-zh-punct.test.ts` 逐條覆蓋 R1–R9(1,000,000 與「12,34」、10:00、「日圓,5」要轉、1) 與 (1) 列舉、巢狀與寬度不一的括號、R6 保留分かち書き空白、奇數個 `"` 不動、871-6813/7./ＣＤ/「はい/いいえ」不動、空字串、冪等)與 raw JSON fixture(只改中文鍵、跳過段落標記 note、排版與行數不變、重跑不變);content-lint 新增 error「zh-punct」(所有中文欄位值 `normalizeZhPunct(v) === v`,段落標記 note 除外;error 共 17 條),真實資料剩下的半形 `, ; : ? ! ( )` 恰為 8 個千分位(L03-D09、L13-D10、L14-D09、L14-D11、L33-D10、L33-D11、L40-S11、L42-S20),warning zh-lookalike 3 → 1(剩 L49-G01 U+2011);`quiz.data.test.ts` 新增 L05-V001「去」與 L37-V040「去，進入」可互換(原「﹐」未被切開);`particles.data.test.ts:100-105` 的 5 個 note 冒號與 `ReorderRunner.test.tsx` 3 處中譯改全形,parseCollocations 175 條逐筆不變;第二次執行 0 變動;`pnpm validate:content` 通過;`pnpm verify` 全綠。

- [ ] **T12.7 DQ-06 編號模型與文件收尾**
  做什麼:稽核報告 D 組標示完成狀態,PDF 校讀清單補列 T12.3 發現的「お + 空白 + 漢字」分段空白(例句與会話 19 句,如 L07-S15「お 金」、L16-S02「お 茶」、L50-S14「お 飲み 物」;疑為 furigana 造成的抽取空白,content-lint 不報),C 組實測數字同步(LC-01 455/458、LC-04 524 行 + 4 個標題、LC-08 1989、LC-09 動詞 42 → 142、全部單字 434 → 534、LC-10 填空 370 → 371);PIPELINE §2 補日後 PDF 重抽的規格——例句圈號 `label` 的編號模型(整課連續、標在每組首行;「…」答句、「Ｂ:」行與成對句不另編號,由解說衍生的說明行不編號;DQ-06 證據見報告)、重新抽取後依序跑 `fix:content` → `normalize:zh-punct` → `enrich:accents` → `build:index` → `validate:content`;README 更新為 Phase 12 現況(已知限制 §D 改為剩下的 PDF 校讀清單、会話標題改述為 `dialogueTitle`、指令加 `fix:content`/`normalize:zh-punct`、451/458 → 455/458、「7 個動詞整字排除」→ 3 個、533 → 534、填空 370 → 371、測試數、文件地圖「Phase 10–12 依據」、任務 60 → 67 項)。CLAUDE.md 不在本任務修改。
  驗收:文件數字與資料測試一致(逐一對照上列);`pnpm verify` 全綠。
