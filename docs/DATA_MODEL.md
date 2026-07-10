# DATA_MODEL — 資料契約

> `src/schemas/lesson.ts`(Zod)是唯一真相。本文件描述其意圖與範例;若實作與本文不一致,以程式碼為準,並回頭修正本文件。

## 1. 內容資料(唯讀,建置期產生)

### 1.1 ID 規約

| 類型 | 格式 | 範例 |
|---|---|---|
| 課 | 整數 1–50 | `13` |
| 單字(= SRS cardId) | `L{課號2位}-V{流水3位}` | `L13-V007` |
| 文法點 | `L{課號2位}-G{流水2位}` | `L13-G02` |
| 文法例句 | `L{課號2位}-S{流水2位}` | `L13-S01` |
| 会話句 | `L{課號2位}-D{流水2位}` | `L13-D01` |

### 1.2 Zod schema(實作基準)

```ts
import { z } from "zod";

/** ruby 分段:漢字段帶讀音 r;送り仮名與純假名段省略 r */
export const RubySegSchema = z.object({
  b: z.string().min(1),              // base 文字
  r: z.string().min(1).optional(),   // 讀音(平假名)
});

export const PosEnum = z.enum([
  "名", "動I", "動II", "動III", "い形", "な形",
  "副", "助詞", "接続", "疑問詞", "数量詞", "慣用", "其他",
]);

export const VocabItemSchema = z.object({
  id: z.string().regex(/^L\d{2}-V\d{3}$/),
  ruby: z.array(RubySegSchema).min(1),
  kana: z.string().min(1),           // 全假名讀音(輸入比對、排序用)
  accent: z.number().int().min(0).optional(),
  meaning: z.string().min(1),        // 繁體中文釋義
  pos: PosEnum,
  note: z.string().optional(),       // 補充(接續、慣用情境等)
  audio: z.string().optional(),      // v1 不產音檔,欄位預留
});

export const SentenceSchema = z.object({
  id: z.string(),
  ruby: z.array(RubySegSchema).min(1),
  translation: z.string().min(1),
  speaker: z.string().optional(),    // 会話用
});

export const GrammarPointSchema = z.object({
  id: z.string().regex(/^L\d{2}-G\d{2}$/),
  pattern: z.string().min(1),        // 例:「(名詞)が ほしいです」
  explanation: z.string().min(1).optional(), // 選填(防禦性);實務上每課皆有
  examples: z.array(SentenceSchema).min(1),
});

export const LessonSchema = z.object({
  id: z.number().int().min(1).max(50),
  title: z.string().min(1),
  vocab: z.array(VocabItemSchema).min(1),
  grammar: z.array(GrammarPointSchema),
  dialogues: z.array(SentenceSchema),
});

export const LessonIndexSchema = z.object({
  lessons: z
    .array(
      z.object({
        id: z.number().int().min(1).max(50),
        title: z.string(),
        vocabCount: z.number().int().min(0),
        grammarCount: z.number().int().min(0),
      }),
    )
    .length(50),
});

export type Lesson = z.infer<typeof LessonSchema>;
export type VocabItem = z.infer<typeof VocabItemSchema>;
export type GrammarPoint = z.infer<typeof GrammarPointSchema>;
```

### 1.3 範例(`public/data/lessons/L13.json` 縮樣)

```json
{
  "id": 13,
  "title": "〜が ほしいです",
  "vocab": [
    {
      "id": "L13-V001",
      "ruby": [{ "b": "遊", "r": "あそ" }, { "b": "びます" }],
      "kana": "あそびます",
      "meaning": "玩、遊玩",
      "pos": "動I"
    },
    {
      "id": "L13-V002",
      "ruby": [{ "b": "さびしい" }],
      "kana": "さびしい",
      "meaning": "寂寞的",
      "pos": "い形"
    }
  ],
  "grammar": [
    {
      "id": "L13-G01",
      "pattern": "(名詞)が ほしいです",
      "explanation": "表達說話者想要某物。否定形:ほしくないです。",
      "examples": [
        {
          "id": "L13-S01",
          "ruby": [
            { "b": "車", "r": "くるま" },
            { "b": "が ほしいです" }
          ],
          "translation": "我想要車子。"
        }
      ]
    }
  ],
  "dialogues": []
}
```

## 2. 使用者資料(IndexedDB / Dexie)

DB 名稱 `minna`,version 1:

```ts
// src/lib/db.ts — Dexie stores 定義
cards:    "cardId, due, state, lessonId"
logs:     "++id, cardId, reviewedAt"
progress: "key, lessonId"            // key = `${lessonId}:${section}`
settings: "key"
```

```ts
interface CardRow {
  cardId: string;            // = VocabItem.id
  lessonId: number;
  type: "vocab";             // v2 預留 "grammar"
  due: number;               // epoch ms(number 以利索引排序)
  stability: number;
  difficulty: number;
  reps: number;
  lapses: number;
  state: 0 | 1 | 2 | 3;      // ts-fsrs State:New / Learning / Review / Relearning
  lastReview?: number;       // epoch ms
}

interface LogRow {
  id?: number;               // auto increment
  cardId: string;
  rating: 1 | 2 | 3 | 4;     // Again / Hard / Good / Easy
  state: 0 | 1 | 2 | 3;      // 評分當下的卡片狀態
  due: number;               // 評分前的 due
  elapsedDays: number;
  reviewedAt: number;        // epoch ms
}
// 欄位對齊 ts-fsrs 的 ReviewLog,足以日後餵 FSRS optimizer 做個人化參數

interface ProgressRow {
  key: string;               // `${lessonId}:${section}`,section ∈ vocab|grammar|dialogue|quiz
  lessonId: number;
  completedAt: number;
}

interface SettingsRow { key: string; value: unknown }
```

settings 預設值(首次啟動寫入):

| key | 預設 |
|---|---|
| `newPerDay` | 10 |
| `maxReviewsPerDay` | 200 |
| `dailyGoal` | 20(每日複習目標張數,首頁進度環) |
| `reverseCards` | false(開啟後新增單字同時建義→日回想卡;cardId 加 `@r` 尾綴) |
| `ttsEnabled` | true |
| `furigana` | `"show"`(`show` \| `hide`) |
| `installPromptDismissed` | false(加入主畫面提示已被關閉) |

## 3. 匯出 / 匯入格式

```json
{
  "version": 1,
  "exportedAt": "2026-06-11T12:00:00.000Z",
  "cards": [],
  "logs": [],
  "progress": [],
  "settings": []
}
```

匯入規則:`version` 相符才允許;匯入 = 全清後寫入(UI 端雙重確認)。

## 4. 不變式(違反即 bug)

1. `cardId` 永遠等於內容資料的 `VocabItem.id`;**內容重新產生不得改變既有 id**(pipeline 必須依教材原順序穩定編號)。
2. `public/data/**` 只能由 pipeline 或 fixture 任務產生,手改視為錯誤。
3. 使用者資料只進 IndexedDB;任何元件不得繞過 `db.ts` 直接開 Dexie 連線。
4. `due`、`reviewedAt` 等時間一律存 epoch ms(number),顯示層才轉時區。
