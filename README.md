# minna-pwa — 大家的日本語學習 PWA

以《大家的日本語》初級 I・II(共 50 課)為內容來源的個人日語學習 PWA:

- **內容管線**:50 份 PDF →(PyMuPDF + Claude Batch API)→ 結構化 JSON,建置期一次性執行
- **學習端**:Next.js 15 純靜態 PWA + ts-fsrs 間隔重複 + IndexedDB,首次載入後完全離線

> ⚠️ **版權**:教材內容受著作權保護,僅供個人學習使用。本 repo 必須維持 **private**,部署後以 Cloudflare Access 限制存取,原始 PDF 永不入庫。

## 目前狀態

📋 規格文件已完成(`docs/` + `IMPLEMENTATION_PLAN.md`),程式碼尚未開始,由 Claude Code 依計畫實作。

## 用 Claude Code 開始開發

```bash
git clone <this-repo> && cd minna-pwa
claude
```

第一句 prompt:

> 請先閱讀 CLAUDE.md 與其指定的必讀文件,然後執行 /next-task,從 Phase 0 開始。

之後的日常循環就是:`/next-task` → 確認計畫 → 實作 → `/verify` → commit → 重複。

## 文件地圖

| 檔案 | 內容 | 給誰看 |
|---|---|---|
| `CLAUDE.md` | Agent 操作守則(Claude Code 自動載入) | Claude Code |
| `docs/SPEC.md` | 產品規格:功能與非功能需求 | 你 + Claude Code |
| `docs/ARCHITECTURE.md` | 三層架構、技術選型、目錄結構、ADR | 你 + Claude Code |
| `docs/DATA_MODEL.md` | Zod / Dexie 資料契約與範例 | Claude Code |
| `docs/PIPELINE.md` | PDF 抽取管線規格(Phase 5) | Claude Code |
| `IMPLEMENTATION_PLAN.md` | 分階段任務、依賴、驗收標準 | Claude Code(工作清單) |
| `.claude/skills/` | `/next-task`、`/verify` 工作流技能 | Claude Code |

## 技術棧速覽

Next.js 15(App Router, static export)・TypeScript strict・Tailwind + shadcn/ui・Serwist(PWA)・Dexie(IndexedDB)・ts-fsrs・WanaKana・MiniSearch・Recharts・Vitest。詳見 `docs/ARCHITECTURE.md`。
