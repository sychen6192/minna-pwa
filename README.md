# minna-pwa — 大家的日本語學習 PWA

以《大家的日本語》初級 I・II(共 50 課)為內容的**單一使用者**日語學習 PWA。內容於建置期由 PDF 抽成結構化 JSON,執行期為完全離線的純靜態應用。

> ⚠️ **版權**:教材內容受著作權保護,僅供個人學習使用。本 repo 必須維持 **private**,原始 PDF 永不入庫。部署為公開網址(2026-07-10 決定,使用者自承版權風險;見 `docs/DEPLOY.md`),已設 noindex,**請勿散佈網址**。

## 功能(v1 現況)

- **課程瀏覽**:50 課完整単語/文型/会話,furigana 一鍵切換(ruby 讀音為教材原文),Web Speech 日語發音(單字、文型例句、会話逐句),東京式重音標記(高低線 + [n] 型號,覆蓋 82.3%);課程頁標頭直達本課測驗、活用練習、例句重組與上/下一課(‹ ›),整課加入不含補充單字,文法/單字搜尋結果直達錨點
- **課程頁自我測驗**:単語可遮住中文或日文、點擊逐項揭示(全部顯示/重新遮住),詞性篩選(名詞/動詞/形容詞/其他);文型與会話可隱藏中譯
- **会話模式**:全部播放(目前句高亮、可停止)與角色扮演(所選角色的台詞先遮住,輪到時暫停等「下一句」);会話標題行不列入播放與扮演。需開啟發音且裝置有日語語音
- **SRS 複習**:ts-fsrs 排程(學習日凌晨 4 點換日)、翻卡四鍵評分(含預估間隔)、卡背同課語境例句(可朗讀;533 字有例句,動詞全課沒有ます形時改配活用形,如 会います →「会いましょう」)、答錯的卡本次稍後重看、復原上一次評分、鍵盤操作(空白翻面、1–4 評分)、每日新卡/複習上限(以學習日計,重開不再發額度)、可選回想方向卡(中→日)、頑固卡集中練習;首頁顯示今日佇列、每日目標與連續天數
- **測驗**:每課 10 題,開始前以「題型」開關選擇(預設全選,選擇存於設定、下次沿用):日→中、中→日四選一、輸入題(WanaKana 正規化比對;長音、［］可省略、（）與「／」替代答案皆判對,羅馬字 nn、tch 等 IME/平文式寫法亦可)、聽力(聽發音選中文、可再聽一次;需日語語音)、例句填空(本課例句挖空選詞,370 字可出);意思可互換的字(では／それでは、どこ／どちら…)不同時當選項;錯題如實加入複習、再測一次/下一課
- **練習**(單次練習、不寫入 SRS;入口在測驗頁頂端「練習」區塊與課程頁標頭):
  - **活用練習**(`/drill`):動詞與形容詞的基本形(ます系、て、た、ない、なかった、辞書形;形容詞否定/過去/て形/〜く・に,普通形與丁寧體)與進階形(可能、意向、命令/禁止、條件、受身、使役),依教材導入課次與學習進度開放(預設範圍為已加入卡片的最大課,可調整);四選一(干擾項為常見錯誤活用)與輸入題,答錯連到該形的文法解說。活用形由規則推導(451/458 動詞、138 形容詞),不確定者排除
  - **助詞搭配**(`/drill` 的「助詞」分頁):取教材單字 note 的搭配出選助詞題(169 條,如 たばこ（　）吸います),標示為教材搭配
  - **例句重組**(`/reorder`):依教材分かち書き把例句與会話切塊,看中譯排回原句(JLPT 文法「並べ替え」形式;每回合至多 8 句,50 課共 751 句可出)
  - 測驗與各練習在換題、作答、進結果頁後 300ms 內忽略點擊(雙擊的第二下不會誤答或跳過結果)
- **介面**:跟隨系統深色模式(語意色彩 token,文字對比 ≥ 4.5:1)、日文系統字型(`lang="ja"`)、觸控區 ≥ 44px
- **統計**:12 週複習熱力圖、7/30 天到期預測、留存率(整體/近 30 天/12 週曲線)、卡片階段分布、各課進度
- **設定與資料**:學習參數調整(每日上限與目標、目標保留率、回想卡、發音、furigana);匯出/匯入(單一 JSON,雙重確認)/重置(保留設定)
- **PWA**:全站 + 50 課內容 precache(423 條目,含各練習頁),首次載入後完全離線(帶 `?upto=`、`?mode=` 的練習網址與文法速查 `?q=` 亦可);可安裝(manifest + icons);SW 更新提示;`storage.persist()` 保護學習紀錄

## 指令

```bash
pnpm dev              # 開發(SW 停用)
pnpm build            # 靜態匯出至 out/(含 service worker)
pnpm verify           # lint + typecheck + test(commit 前必跑)
pnpm validate:content # public/data/** 全量 Zod 驗證
```

## 內容管線(已完成,一次性)

PDF 具文字層,採 `pdftotext -layout` 抽文字 → Claude Code 依 `docs/PIPELINE.md` 慣例直抽為 JSON → `pnpm validate:content`(Zod 單一真相)把關;讀音由使用者人工校讀。50/50 課已收錄於 `public/data/`。

單字重音(pitch accent)由 `pnpm enrich:accents` 自 [kanjium](https://github.com/mifunetoshiro/kanjium) 重音資料回填(CC BY-SA 4.0),覆蓋 1790/2176(82.3%),配對不確定者寧缺勿錯。致謝:_"The pitch accent notation … were provided by Uros O. through his free database."_

活用形、例句重組的切塊、助詞搭配與語境例句都在執行期由規則從教材資料推導(`src/lib/` 純函式),不寫回 `public/data/`。

## 部署

GitHub Actions:push `main` → verify + build → `wrangler pages deploy` 至 Cloudflare Pages(公開網址 + noindex)。完整設定(API token、secrets、noindex 驗證)見 `docs/DEPLOY.md`。

## 品質基線(2026-09,詳見 `docs/reports/`)

- 首頁 JS(gzip)**165.3 KB** < N4 預算 200 KB(`next build` First Load 122 kB);預算只約束首頁,其他頁 First Load(未壓縮)如 `/stats` 284 kB(Recharts)、`/quiz/[id]` 202 kB、`/drill` 201 kB 不在範圍。量測方式見 `docs/reports/bundle.md`
- Lighthouse(2026-07):PWA 類別滿分(lighthouse@11)、Accessibility **100**、Performance 97、SEO 100
- 測試:69 檔 1375 例(lib 純函式全覆蓋 + 教材全資料測試 + UI 關鍵路徑;時間相關的測試以 `src/test/` 的共用 helper 明確控制時鐘與計時器)

## 已知限制

- 跨裝置同步、手寫漢字練習、原版 CD 音檔:明確不做(SPEC §5);文法點 SRS 卡留待 v2
- 聽力題與会話全部播放/角色扮演靠 Web Speech:需開啟發音且裝置有日語語音(沒有時聽力題停用並說明原因,播放與扮演隱藏);發音為合成語音,重音以引擎為準
- 練習以教材為準、寧缺勿錯:活用形由規則推導,7 個動詞(詞性誤標、並列兩詞、非ます形、ございます)整字排除,進階形另依教材與語意逐(字, 形)排除;例句重組只認教材語序;助詞搭配只取教材 note,其他助詞有時也自然;語境例句與例句填空找不到可靠配對就不出
- 內容資料待修(`docs/reports/2026-09-uiux-learning-audit.md` §D):不需 PDF 的 fixture 修正(L07-V006/L47-V004..006 動詞分類、え―と、zh 日文字形、会話標題行)尚未寫回,目前以活用排除清單與執行期標題行判定因應;需對照 PDF 校讀的 9 項(L40-V055「離れた」、kana 記號契約、furigana 跨記號、缺［な］的な形容詞、跨課重複、複製例句、例句圈號、L02 会話 speaker「山田一郎/山田」在扮演時被拆成兩個角色…)仍待處理

## 文件地圖

| 檔案 | 內容 |
|---|---|
| `CLAUDE.md` | Agent 操作守則(Claude Code 自動載入) |
| `docs/SPEC.md` | 產品規格:功能與非功能需求 |
| `docs/ARCHITECTURE.md` | 架構、技術選型、目錄結構、ADR |
| `docs/DATA_MODEL.md` | Zod / Dexie 資料契約 |
| `docs/PIPELINE.md` | PDF 抽取管線規格與收錄慣例 |
| `docs/DEPLOY.md` | Cloudflare Pages 部署指南(公開 + noindex) |
| `docs/reports/` | Lighthouse 與 bundle 量測報告;2026-09 UI/UX 與學習正確性稽核(Phase 10、11 依據) |
| `IMPLEMENTATION_PLAN.md` | 任務清單與驗收(60 項) |

## 技術棧

Next.js 15(App Router、`output: 'export'`)・TypeScript strict・Tailwind・Serwist・Dexie(IndexedDB)・ts-fsrs・WanaKana・Recharts・Vitest(+fake-indexeddb)。細節與 ADR 見 `docs/ARCHITECTURE.md`。
