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
  accent: z.number().int().min(0).optional(), // 東京式重音核:0=平板,n=第n拍後下降(kanjium 回填)
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
  due: number;               // 評分前的 due(真實時刻)
  elapsedDays: number;       // 距上次複習的學習日數(§4-5)
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
| `dailyGoal` | 20(每日複習目標張數,首頁進度環;有效目標 = min(dailyGoal, 今日已複習 + 今日佇列剩餘);今日已複習且佇列清空即算達標,今日無卡可做且未複習時維持設定值) |
| `reverseCards` | false(開啟後新增單字同時建義→日回想卡;cardId 加 `@r` 尾綴;「已會」以字為單位同時作用於兩個方向,`@r` 建立時繼承正向卡的暫停狀態;同一字的兩個方向不在同一學習日出現,`@r` 新卡於正向卡首評的隔日起才引入,見 §4-5) |
| `desiredRetention` | 0.9(FSRS 目標保留率,0.80–0.97;越高複習越頻繁) |
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

重置(F6.3):清空 `cards`、`logs`、`progress`,**保留 `settings`**(2026-09-28 修訂;原為連設定一起清除)。

## 4. 不變式(違反即 bug)

1. `cardId` 永遠等於內容資料的 `VocabItem.id`;**內容重新產生不得改變既有 id**(pipeline 必須依教材原順序穩定編號)。
2. `public/data/**` 只能由 pipeline 或 fixture 任務產生,手改視為錯誤。
3. 使用者資料只進 IndexedDB;任何元件不得繞過 `db.ts` 直接開 Dexie 連線。
4. `due`、`reviewedAt` 等時間一律存 epoch ms(number,真實時刻),顯示層才轉時區。
5. **學習日**(2026-09-28 追加):以本地時區**凌晨 4 點**換日(`src/lib/studyDay.ts`,對標 Anki)。每日上限、到期判定(`due` 落在今日學習日結束前即到期)、今日目標、streak 與統計分日一律依學習日。ts-fsrs 內部以 UTC 日期計算 `elapsed_days`,故 `srs.ts` 餵入 ts-fsrs 的時間先平移為「UTC 日 = 本地學習日」、輸出再換回真實時刻;DB 內永遠是真實時刻,平移只存在於 `srs.ts` 內部。細則:
   - 學習日邊界以本地日期欄位建構(`new Date(y, m, d, 4)`),DST 切換日的學習日為 23 或 25 小時,換日點不偏移;日期鍵 `studyDayKey` = 學習日的 `YYYY-MM-DD`。
   - 到期:`due < nextStudyDayStart(now)`(含逾期)。`countDue(now)` = 今日到期的複習卡數;`countDueByTomorrow(now)` = 到明日學習日結束前到期者(明日到期預估)。
   - 餵入:`toFsrsTime(t)` = 學習日日期的 UTC 00:00 + 距學習日起點的經過時間(上限 1 天 − 1 ms);now、`due`、`lastReview` 各自換算。
   - 換回:以該次呼叫的 now 為基準取整日差 n,結果為 now 的本地牆上時間 n 個日曆日之後(`due` 保持評分當下的牆上時間;遇 DST 跳時缺口而該時間不存在時,截在目標學習日內);不對平移後的時刻再查時差。`previewIntervals` 與 `rate` 用同一套換算,預估即實際。
   - `LogRow.due` 存卡片評分前的 `due`(真實時刻),不沿用 ts-fsrs `ReviewLog.due`(其值為 `last_review ?? due`);`reviewedAt` 為評分真實時刻;`elapsedDays` 以學習日計。
   - 每日上限(T10.2)由今日學習日的 logs 扣除:新卡額度 = `newPerDay` − 今日首評的相異新卡數(`LogRow.state` 為評分**前**狀態,`state = New` 即首評);複習額度 = `maxReviewsPerDay` − 今日評分前 `state ≠ New` 的筆數(首評不佔複習額度)。同日重開頁面不會再發額度。
   - 兄弟卡 bury(T10.2):同一字(`baseVocabId`)今日已評過或已入列者,另一方向今日不入列,卡片不改動、仍保持到期,下一學習日才出。New 的 `@r` 卡須正向卡已非 New 且首評不在今日;新卡額度先給正向卡。
   - fuzz(T10.2):ts-fsrs `enable_fuzz` 開啟,種子 = `cardId + reps`(`GenSeedStrategyWithCardId`,與評分時刻無關),同一張卡的預估與實際套用一致;fuzz 後間隔仍為整數天。ts-fsrs 只對 ≥ 2.5 天的間隔加 fuzz,預設保留率下新卡首評(Good 3 天)不受影響;兄弟卡同日不出由 bury 保證。
   - 復原與重看(T10.3):`rate()` 回傳 `{ card, prev, logId }`;`undoRate({ prev, logId })` 於同一 transaction 放回評分前的卡片、刪除該筆 log(logs 唯一的逐筆刪除路徑,重置/匯入的整表清除除外;每日上限由 logs 計算,復原後額度隨之回復)。複習 session 內的「重看」只存在頁面 state,不呼叫 `rate()`、不寫 log(同日再評分會重複扣 stability 與 lapses)。「已會」以字為單位:`setWordSuspended` 同時作用於正向卡與 `@r`,課程頁以任一方向暫停視為已會;新建 `@r` 繼承正向卡的 `suspended`。T10.3 前只暫停單一方向的既有資料不遷移,恢復時兩個方向一併恢復。
   - 錯題加入複習(T10.4):`requeueWrong(vocabIds, lessonId, now)` 於同一 transaction 以字為單位處理——無正向卡者照 `addCards` 建立(含 `@r`);已暫停者兩個方向一併恢復;已學過(state ≠ New)且 `due ≥ nextStudyDayStart(now)` 的卡把 `due` 設為 now(今日已評過、受 bury 者改設為 `nextStudyDayStart(now)`)。不寫 log、不改 stability/difficulty/lastReview,下次評分由 ts-fsrs 以距 lastReview 的實際學習日數計算(等同提前複習);提前的卡佔今日複習額度。回傳各類字數 `{ created, tomorrow, unsuspended, alreadyDue, requeued, pendingNew }`(每字只歸一類,優先序同此順序):分類依「這個字何時會出現」——原本就有學過的卡今日到期者為 `alreadyDue`(另一方向未到期的卡仍照規則提前),只有新卡者為 `pendingNew`(依每日新卡額度引入,不宣稱已在今日佇列)。
