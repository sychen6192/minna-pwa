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

- [ ] **T10.10 觸控、無障礙與提示**
  做什麼:icon/文字按鈕觸控區 ≥ 44px(負 margin 保持版面);翻卡按鈕不以 aria-label 覆蓋內容、翻面後焦點移至答案;評分鍵 accessible name 含間隔、快捷鍵數字僅桌面顯示;課程頁分頁改 aria-pressed 分段按鈕(或補齊 tabpanel);回饋加 `role="status"`;輸入框 ≥ 16px(避免 iOS 放大)。安裝提示拆為首頁內嵌卡片(非 fixed,不遮擋操作),`ensurePersistentStorage` 仍於每頁啟動執行。新增繁中 `not-found.tsx`;載入文字抽成共用 `Loading`(role=status)。
  驗收:PwaSetup/InstallPrompt 測試(每頁 persist、首頁才顯示提示、standalone 或已關閉不顯示);RatingButtons/review 無障礙名稱測試;Playwright 量測主要互動元素 ≥ 44px;`pnpm verify` 全綠。

- [ ] **T10.11 導覽與流程**
  做什麼:課程內頁標頭加「測驗本課」「‹ 上一課」「下一課 ›」;「整課加入複習」預設排除補充單字(按鈕註明「不含補充 N 字」),加入後以 role=status 顯示「已加入 N 字 · 開始複習 →」(`addCards` 回傳新建數);note 段落標記(読み物/会話/補充)改小徽章。文法速查錨點改於分頁 commit 後捲動(修 client 導覽不捲動)、單字搜尋結果帶單字錨點並短暫高亮;分頁與搜尋字串以 `history.replaceState` 存於 URL;分頁列與搜尋框 sticky。課程列表先渲染索引再補狀態,返回時捲動位置可還原。
  驗收:LessonDetail 測試(上/下一課連結、整課加入排除補充並顯示數量、分頁 hash 同步、錨點捲動被呼叫、單字錨點);search 測試(單字 anchor);lessons 列表 db pending 時已渲染;`pnpm verify` 全綠。
