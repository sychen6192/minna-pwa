# PIPELINE — PDF → JSON 抽取管線(Phase 5 專用)

目標:把 `pipeline/input/` 內 50 份《大家的日本語》PDF 轉為通過 Zod 驗證的 `public/data/lessons/L01–L50.json` 與 `index.json`。一次性流程,**由使用者本人觸發執行**(Claude Code 負責寫程式,跑批與 API key 由人控制)。

## 0. 前置

- Python 3.12 + uv 管理;依賴:`pymupdf`、`anthropic`、`typer`
- 環境變數 `ANTHROPIC_API_KEY`(放 `.env`,不入庫)
- PDF 命名規約:`L01.pdf` … `L50.pdf`,放 `pipeline/input/`(gitignored)

## 1. 流程

```
偵測文字層 → 組 prompt → Claude API → 寬鬆檢查 → 寫 JSON → pnpm validate:content(嚴格)
                                          └→ 失敗 → pipeline/review/ + 原因 → 人工修正
```

1. **文字層偵測**(PyMuPDF):`page.get_text()` 有效字元率 > 60% → 文字模式;否則 → 影像模式(整頁渲染 300 dpi PNG)。
2. **呼叫 Claude**:
   - 使用 **Message Batches API**(50 課一批,成本約一半,24 小時內回);單課試跑(`--lesson 13`)走一般 Messages API 方便迭代。
   - 文字模式傳抽出文字;影像模式傳頁面圖片(vision)。
   - 模型與 API 細節以官方文件為準(D8)。
3. **Prompt 要求**(`pipeline/prompts/extract.md`,版本控管,L13 試跑迭代定稿後才跑全量):
   - 僅輸出 JSON(無 markdown fence、無前後說明),結構對齊 `docs/DATA_MODEL.md` §1.2
   - ruby 分段:漢字段附平假名讀音;送り仮名與純假名段不附 `r`
   - `pos` 必須落在 PosEnum;無法分類用「其他」並寫入 `note`
   - 單字依教材原順序編號(id 穩定性是硬需求,見 DATA_MODEL §4)
   - **不得**增刪、翻譯潤飾或「補完」教材內容;不確定的選填欄位留空,不准猜
4. **驗證分工**:Python 端只做「JSON 可解析 + 頂層欄位存在」的寬鬆檢查;嚴格驗證一律走 `pnpm validate:content`(Zod,單一真相)。
5. **失敗處理**:未過驗證的課寫到 `pipeline/review/Lxx.json` 並附錯誤摘要,人工修正後重新驗證;禁止為了過驗證而放寬 schema。
6. **索引**:50 課全數通過後,由腳本產生 `public/data/index.json`(id、title、vocabCount、grammarCount)。

## 2. 驗收標準

- `pnpm validate:content` 對 50 課 + index **全數通過**
- 隨機抽 5 課與 PDF 人工對照:單字遺漏率 < 2%;**讀音錯誤零容忍**(發現即修正並記錄 prompt 改進)

## 3. 成本與時間(粗估,以實際為準)

- 50 課 × 約 20–40 頁;Batch API 折扣後預估在個位數至十餘美元區間
- 跑批 + 人工抽查約 1–2 個晚上

## 4. 安全與版權

- 原始 PDF 與中間產物(`input/`、`work/`)永不 commit(.gitignore 已涵蓋)
- 抽出的 JSON 屬版權內容:只進 private repo,部署必過 Cloudflare Access
- `.env` 不入庫;API key 不出現在任何 log 或 commit
