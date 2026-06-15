# PIPELINE — PDF → JSON 抽取管線(Phase 5 專用)

目標:把《大家的日本語》50 課 PDF 轉為通過 Zod 驗證的 `public/data/lessons/L01–L50.json` 與 `index.json`。一次性流程。

> **ADR 變更(2026-06)**:原規劃 Python(PyMuPDF)+ Claude Batch API。實測使用者的 PDF **皆含乾淨文字層**(非掃描),故改為更簡單的做法:**`pdftotext`(poppler)抽文字層 → Claude Code 直接結構化為 JSON → `pnpm validate:content`(Zod)把關**。優點:不需 API key、不需建 Python 管線、讀音直接取自教材文字層(非 OCR/視覺,符合「讀音零容忍」)。原 Batch API 方案僅在日後遇到掃描檔時才需要。

## 0. 前置

- poppler:`brew install poppler`(提供 `pdftotext` / `pdfinfo`)
- 原始 PDF 放 repo 外的本機資料夾(例:`/Users/sychen/projects/japanese/minna-pdf/`),依課號命名(`13.pdf` = 第 13 課)。**PDF 永不入庫**(版權)。
- Claude Code 只「讀取」PDF 抽出的文字;只有產出的 JSON 進 private repo。

## 1. 流程(逐課)

```
pdftotext -layout N.pdf  →  Claude Code 結構化 + ruby 對齊  →  寫 Lxx.json
                                                                  ↓
                              人工對照 PDF 校讀  ←  pnpm validate:content(Zod 嚴格)
```

1. **抽文字**:`pdftotext -layout <PDF> -`。每課頁面區塊順序固定:
   - `ことば`(單字:假名讀音｜漢字｜中文;部分含 `[てがみを〜]` 接續提示)
   - `文型`、`例文`(練習用範例句,**僅日文無中譯**)
   - `会話`(對話,含說話者;**僅日文無中譯**)
   - `練習 A/B/C`、`問題`(**不收**,資料模型無對應)
   - `文法`(在「問題」之後:文法點 + **中文解說** + 例句 ①②… **附中文翻譯**)
2. **三個資料來源(逐課)**:
   - **vocab** ← `ことば`:中文釋義、假名讀音皆取自 PDF。
   - **grammar** ← `文法`段:`pattern`(文法點標題,如「(名詞)が 欲しいです」)、`explanation`(該段中文解說)、`examples`(①②…例句,**中譯取自 PDF**)。⚠️ 不要用 `文型/例文` 段當 examples——那兩段無中譯。
   - **dialogues** ← `会話`:**PDF 無中文**,中譯由 Claude Code 自譯(單人自用,已與使用者確認)。
3. **結構化規約(Claude Code)**:
   - ruby 分段:漢字段附平假名讀音;送り仮名與純假名段不附 `r`(例:`遊びます`+`あそびます` → `[{b:"遊",r:"あそ"},{b:"びます"}]`)。
   - 文法/会話的 furigana 在版面上以小字浮在漢字上方,`pdftotext` 排到上一行,需依位置重建。**此處最易出錯,校讀重點。**
   - `pos` 落在 PosEnum;慣用表達(おなかが すきました 等)用「慣用」。
   - 外來語 `kana` 沿用教材片假名原樣(プール、スキー),`ruby` 該段不附 `r`。
   - 濾掉頁尾雜訊(`課:13 (頁:1/9)` 之類)。
   - 單字/文法依教材原順序編號(id 穩定性是硬需求,見 DATA_MODEL §4)。
   - **不得**增刪、潤飾或「補完」教材內容;唯一例外是 `会話` 中譯(來源無)。
4. **驗證**:`pnpm validate:content`(Zod,單一真相)。失敗即修。
5. **索引**:50 課全數通過後,由腳本產生 `public/data/index.json`。

## 2. 已知特例

- **L7、L27、L35 無「文法」段**(整課 PDF 不含)。這幾課 `grammar` 留空陣列 `[]`;`GrammarPoint.explanation` 因此設為**選填**(其餘課皆有解說)。
- `会話` 中譯為自譯(來源無中文);`vocab`/`grammar` 中文皆取自 PDF。

## 3. 驗收標準

- `pnpm validate:content` 對 50 課 + index **全數通過**
- 隨機抽 5 課與 PDF 人工對照:單字遺漏率 < 2%;**讀音錯誤零容忍**(發現即修正並記錄改進)

## 4. 安全與版權

- 原始 PDF 永不 commit(在 repo 外)。
- 抽出的 JSON 屬版權內容:只進 private repo,部署必過 Cloudflare Access。
