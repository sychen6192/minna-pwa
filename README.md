# minna-pwa — 大家的日本語學習 PWA

以《大家的日本語》初級 I・II(共 50 課)為內容的**單一使用者**日語學習 PWA。內容於建置期由 PDF 抽成結構化 JSON,執行期為完全離線的純靜態應用。

> ⚠️ **版權**:教材內容受著作權保護,僅供個人學習使用。本 repo 必須維持 **private**,部署必須置於 Cloudflare Access 之後(見 `docs/DEPLOY.md`),原始 PDF 永不入庫。

## 功能(v1 現況)

- **課程瀏覽**:50 課完整単語/文型/会話,furigana 一鍵切換(ruby 讀音為教材原文),Web Speech 日語發音
- **SRS 複習**:ts-fsrs 排程、翻卡四鍵評分(含預估間隔)、鍵盤操作(空白翻面、1–4 評分)、每日新卡/複習上限
- **測驗**:每課 10 題(日→中、中→日四選一 + 輸入題,WanaKana 正規化比對)、錯題一鍵加入複習
- **統計**:12 週複習熱力圖、7/30 天到期預測、留存率(整體/近 30 天/12 週曲線)、各課進度
- **設定與資料**:學習參數調整;匯出/匯入(單一 JSON,雙重確認)/重置
- **PWA**:全站 + 50 課內容 precache(~290 條目),首次載入後完全離線;可安裝(manifest + icons);SW 更新提示;`storage.persist()` 保護學習紀錄

## 指令

```bash
pnpm dev              # 開發(SW 停用)
pnpm build            # 靜態匯出至 out/(含 service worker)
pnpm verify           # lint + typecheck + test(commit 前必跑)
pnpm validate:content # public/data/** 全量 Zod 驗證
```

## 內容管線(已完成,一次性)

PDF 具文字層,採 `pdftotext -layout` 抽文字 → Claude Code 依 `docs/PIPELINE.md` 慣例直抽為 JSON → `pnpm validate:content`(Zod 單一真相)把關;讀音由使用者人工校讀。50/50 課已收錄於 `public/data/`。

## 部署

GitHub Actions:push `main` → verify + build → `wrangler pages deploy` 至 Cloudflare Pages。完整設定(API token、secrets、**Cloudflare Access 必須步驟**、PWA×Access 注意事項)見 `docs/DEPLOY.md`。

## 品質基線(2026-07,詳見 `docs/reports/`)

- 首頁 JS(gzip)**185.4 KB** < N4 預算 200 KB;`/stats` 271 KB(Recharts,不在預算範圍)
- Lighthouse:PWA 類別滿分(lighthouse@11)、Accessibility **100**、Performance 97、SEO 100
- 測試:26 檔 200+ 例(lib 純函式全覆蓋 + UI 關鍵路徑)

## 已知限制(v1 未含)

- SPEC F4(文法查閱頁與 MiniSearch 全文檢索)未實作——實作計畫從未包含對應任務,留待 v1.1 決定
- 課程列表的進度標示仍為佔位文字(「未開始」),未接 IndexedDB 實際狀態
- 跨裝置同步、聽力、手寫:明確不做(SPEC §5)

## 文件地圖

| 檔案 | 內容 |
|---|---|
| `CLAUDE.md` | Agent 操作守則(Claude Code 自動載入) |
| `docs/SPEC.md` | 產品規格:功能與非功能需求 |
| `docs/ARCHITECTURE.md` | 架構、技術選型、目錄結構、ADR |
| `docs/DATA_MODEL.md` | Zod / Dexie 資料契約 |
| `docs/PIPELINE.md` | PDF 抽取管線規格與收錄慣例 |
| `docs/DEPLOY.md` | Cloudflare Pages + Access 部署指南 |
| `docs/reports/` | Lighthouse 與 bundle 量測報告 |
| `IMPLEMENTATION_PLAN.md` | 任務清單與驗收(30 項) |

## 技術棧

Next.js 15(App Router、`output: 'export'`)・TypeScript strict・Tailwind・Serwist・Dexie(IndexedDB)・ts-fsrs・WanaKana・Recharts・Vitest(+fake-indexeddb)。細節與 ADR 見 `docs/ARCHITECTURE.md`。
