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
                              人工對照 PDF 校讀  ←  pnpm validate:content(Zod + content-lint)
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
   - ruby 分段:漢字段附平假名讀音;送り仮名與純假名段不附 `r`(例:`遊びます`+`あそびます` → `[{b:"遊",r:"あそ"},{b:"びます"}]`)。帶 `r` 的段只含漢字或數字:furigana 不跨越記號(〜、…、「 等)與送り仮名,記號不併入帶 `r` 的段、可與假名同段(`〜語` → `[{b:"〜"},{b:"語",r:"ご"}]`、`違います。` → `[{b:"違",r:"ちが"},{b:"います。"}]`;content-lint error ruby-r-scope)。
   - 文法/会話的 furigana 在版面上以小字浮在漢字上方,`pdftotext` 排到上一行,需依位置重建。**此處最易出錯,校讀重點。**
   - `pos` 落在 PosEnum;慣用表達(おなかが すきました 等)用「慣用」。
   - 外來語 `kana` 沿用教材片假名原樣(プール、スキー),`ruby` 該段不附 `r`。
   - 濾掉頁尾雜訊(`課:13 (頁:1/9)` 之類)。
   - 單字/文法依教材原順序編號(id 穩定性是硬需求,見 DATA_MODEL §4)。
   - **不得**增刪、潤飾或「補完」教材內容;唯一例外是 `会話` 中譯(來源無)。
4. **驗證**:`pnpm validate:content`——先以 Zod(單一真相)驗證全部檔案與檔名,通過後執行 content-lint(`scripts/content-lint.ts`,規則見該檔 `RULES`)。Zod 或 content-lint **error**(id 格式/連號、ruby 讀音與 furigana 範圍、字元衛生、日文近似字、詞性形狀、会話 speaker、中文字形等)失敗即修(exit 1);**warning**(kana 記號、kana 與 ruby 不一致、跨課重複、詞性不一致等)是需要對照 PDF 判斷的可疑項,只列出、不影響結束碼。預設每條規則只印前 5 筆;`pnpm validate:content --all` 印全部清單、`--rule <id>` 只印一條規則的完整清單,作為校讀清單。warning 清單由 `scripts/content-lint.data.test.ts` 以 id 釘住(ratchet),資料修正須在同一個 commit 更新。
5. **索引**:50 課全數通過後,由腳本產生 `public/data/index.json`。

## 2. 已知特例

- **50 課的 PDF 皆含「文法」段**(在「問題」之後)。`GrammarPoint.explanation` 仍設為**選填**(防禦性:若某課缺解說則可留空),但實務上每課都應填入該段中文解說。
- `会話` 中譯為自譯(來源無中文);`vocab`/`grammar` 中文皆取自 PDF。
- **会話標題**(2026-09-30,T12.4):会話前的標題(如 L24「手伝って くれますか」)存於課層級的 `dialogueTitle`(ruby + 自譯中譯,置於 `dialogues` 前),**不當 `dialogues` 的第一行台詞**;`dialogues` 只收有說話者的台詞,D 自 `D01` 連號(content-lint error dialogue-speaker、id-sequence 把關)。每課只有一段会話,課層級一個欄位即足夠。舊抽取把 L15/L23/L24/L41 的標題放在 D01(speaker 為「標題」「（標題）」或缺漏),已由 `fix:content` 移出;其餘 46 課目前沒有 `dialogueTitle`(教材是否有標題需對照 PDF)。
- **資料修正**(2026-09-30,T12.2):不需對照 PDF 的修正(稽核 2026-09 §D)列在 `scripts/fix-content.ts` 的 `CORRECTIONS`(每筆宣告現值、修正值與理由;種類有欄位值修正、「会話標題行移入 `dialogueTitle` 並遞補 D id」(T12.4)與「ruby 分段」(一段換成多段,串接的表面與只取假名的讀音須不變;T12.5)),以 `pnpm fix:content` 手術式寫回;`pnpm fix:content --check` 只列狀態,有待套用項 exit 1。它是 DATA_MODEL §4-2 所說的 fixture、允許寫入 `public/data` 的來源(pipeline 側另有只寫 accent 行的 `enrich:accents` 與產生 index.json 的 `build:index`),修正一律加進清單、不得手改 JSON。每筆由 `scripts/fix-content.data.test.ts` 在 `pnpm verify` 釘住:日後從 PDF 重新抽取而蓋回時測試失敗,重跑 `pnpm fix:content` 即復原;現值既非修正前也非修正後(資料已另被改動)時腳本報錯中止,需人工判斷。
- `ことば` 末段「請自行練習發音」:**收國家/地名等實詞**(アメリカ、韓国…);**略過虛構專有名詞**(校名/公司名/店名/機構名,如 IMC、さくら大学),因其僅為課文範例且常無假名讀音。

## 3. 驗收標準

- `pnpm validate:content` 對 50 課 + index **全數通過**(Zod + content-lint error 規則 0 筆,沒有例外清單)
- content-lint warning 逐項對照 PDF 判斷(`--all` 清單),確認為教材原樣者保留、抽取錯誤者修正
- 隨機抽 5 課與 PDF 人工對照:單字遺漏率 < 2%;**讀音錯誤零容忍**(發現即修正並記錄改進)

## 4. 安全與版權

- 原始 PDF 永不 commit(在 repo 外)。
- 抽出的 JSON 屬版權內容:只進 private repo,部署必過 Cloudflare Access。
