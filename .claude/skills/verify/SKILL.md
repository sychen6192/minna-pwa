---
name: verify
description: 完成任何任務或 commit 之前的完整品質驗證。任何實作完成準備提交時、或使用者要求驗證時使用。
---

# 驗證流程

依序執行,全部通過才算完成:

1. `pnpm lint`
2. `pnpm typecheck`
3. `pnpm test`
4. 若本次變更涉及 `public/data/`、`src/schemas/` 或 `scripts/validate-content.ts`:加跑 `pnpm validate:content`

## 規則

- 任一步失敗:回報原因 → 修復 → **從第 1 步重跑**,直到全綠。
- **不得**以跳過測試、放寬 lint 規則、`as any`、刪除斷言等方式讓驗證通過;若認為規則本身不合理,先停下提出討論。
- 全綠後以一行摘要回報各步驟結果與測試數量,才進行 commit。
