import { z } from "zod";

/** ruby 分段:漢字段帶讀音 r;送り仮名與純假名段省略 r */
export const RubySegSchema = z.object({
  b: z.string().min(1), // base 文字
  r: z.string().min(1).optional(), // 讀音(平假名)
});

export const PosEnum = z.enum([
  "名",
  "動I",
  "動II",
  "動III",
  "い形",
  "な形",
  "副",
  "助詞",
  "接続",
  "疑問詞",
  "数量詞",
  "慣用",
  "其他",
]);

export const VocabItemSchema = z.object({
  id: z.string().regex(/^L\d{2}-V\d{3}$/),
  ruby: z.array(RubySegSchema).min(1),
  kana: z.string().min(1), // 全假名讀音(輸入比對、排序用)
  accent: z.number().int().min(0).optional(),
  meaning: z.string().min(1), // 繁體中文釋義
  pos: PosEnum,
  note: z.string().optional(), // 補充(接續、慣用情境等)
  audio: z.string().optional(), // v1 不產音檔,欄位預留
});

export const SentenceSchema = z.object({
  id: z.string(),
  ruby: z.array(RubySegSchema).min(1),
  translation: z.string().min(1),
  speaker: z.string().optional(), // 会話用
});

export const GrammarPointSchema = z.object({
  id: z.string().regex(/^L\d{2}-G\d{2}$/),
  pattern: z.string().min(1), // 例:「(名詞)が ほしいです」
  // 少數課(L7/27/35)無「文法」段,故選填(見 PIPELINE §2)
  explanation: z.string().min(1).optional(),
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
export type Sentence = z.infer<typeof SentenceSchema>;
export type RubySeg = z.infer<typeof RubySegSchema>;
export type Pos = z.infer<typeof PosEnum>;
export type LessonIndex = z.infer<typeof LessonIndexSchema>;
