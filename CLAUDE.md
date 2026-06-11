# CLAUDE.md — みんなの日本語 學習 PWA

單一使用者的日語學習 PWA:《大家的日本語》初級 I・II 共 50 課,內容於建置期由 PDF 抽成結構化 JSON,執行期是完全離線的靜態 PWA(FSRS 間隔重複 + 測驗 + 統計)。本 repo 目前只有規格文件,程式碼由你依計畫逐步建立。

## 開始前必讀(依序)

1. `docs/SPEC.md` — 要做什麼(功能與非功能需求)
2. `docs/ARCHITECTURE.md` — 怎麼做(架構、目錄結構、技術決策 ADR)
3. `docs/DATA_MODEL.md` — 資料契約(Zod 為唯一真相)
4. `IMPLEMENTATION_PLAN.md` — 任務清單、依賴與驗收標準

`docs/PIPELINE.md` 只在執行 Phase 5 時才需要讀。

## 核心工作流

1. 執行 `/next-task` 取得下一個任務;**先提出實作計畫(檔案、測試、風險),經確認後才動工**。
2. 一次只做一個任務,不擴大範圍。發現規格或計畫有問題:停下來討論,先更新文件再實作。
3. 完成後執行 `/verify`,全綠才算完成。
4. 勾選 `IMPLEMENTATION_PLAN.md` 對應 checkbox,以 conventional commit 提交(一個任務一個 commit,type 用英文、描述用繁體中文)。

## 指令

- `pnpm dev` / `pnpm build`
- `pnpm verify` = lint + typecheck + test(commit 前必跑)
- `pnpm validate:content` = 驗證 `public/data/**` 全部 JSON 通過 Zod

## 硬性規則

- Next.js 15 App Router、`output: 'export'` 純靜態:**禁止** API routes、server actions、任何 runtime 後端依賴。
- **禁止** localStorage / sessionStorage。使用者狀態一律經 `src/lib/db.ts`(Dexie / IndexedDB)。
- `public/data/**` 由 pipeline 或 fixture 任務產生:**禁止手改**。要改就改 pipeline 或 fixture,並在 commit 說明。
- TypeScript strict。出現 `any` 必須附註解理由。
- UI 只用 shadcn/ui + Tailwind,不引入其他元件庫。
- FSRS 只透過 `src/lib/srs.ts` 操作;頁面與元件不得直接 import `ts-fsrs`。
- 套件 API 不確定時(Serwist、ts-fsrs、Dexie、Next 15),查官方文件,不要憑記憶猜。
- `pipeline/input/`(原始 PDF)與中間產物永不入庫;本 repo 必須維持 **private**(教材版權,僅個人使用)。

## 測試方針

- Vitest(IndexedDB 相關測試用 fake-indexeddb)。
- `src/lib/` 的純函式邏輯**必測**:`srs.ts`、`quiz.ts`、`content.ts`、`stats.ts`。
- UI 元件以關鍵路徑的輕量測試為主,不追求覆蓋率數字。

## 語言慣例

- 與使用者溝通、commit 描述、文件:繁體中文(技術名詞保留英文)。
- 程式碼識別字、註解內的 API 名稱:英文。
- App 介面文案:繁體中文;日文內容依資料原樣呈現。
