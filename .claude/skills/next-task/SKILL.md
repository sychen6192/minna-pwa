---
name: next-task
description: 從 IMPLEMENTATION_PLAN.md 取得下一個任務,以「先計畫、後實作」流程執行。開始新工作、或使用者說「繼續」「下一個」「next」時使用。
---

# 任務執行流程

1. 讀取 `IMPLEMENTATION_PLAN.md`,找出**第一個未勾選、且其依賴 phase 已完成**的任務(Phase 5 可與 2–4 平行,其餘依序)。
2. 對照 `docs/` 相關章節,輸出實作計畫:
   - 任務目標與驗收標準(摘自計畫文件,不要改寫)
   - 預計新增 / 修改的檔案清單
   - 測試項目
   - 風險或文件中未明確之處(若有,提出建議解法)
3. **等使用者確認計畫後才開始實作。** 若發現計畫或規格本身有問題,先停下討論,文件更新取得共識後再繼續。
4. 實作完成後執行 verify 技能的完整流程,全綠後:
   - 勾選 `IMPLEMENTATION_PLAN.md` 中該任務的 checkbox
   - conventional commit(type 英文、描述繁體中文),一個任務一個 commit
5. 回報:完成了什麼、測試結果摘要、下一個任務是什麼。
