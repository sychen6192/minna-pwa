/**
 * 單字 `note` 的呈現(T10.3):教材的 note 多為助詞搭配(〔電車に〜〕)或補充說明,
 * 但也混有標示單字出處段落的標記,後者不是學習提示。
 */

/** 「補充單字(自行練習發音)」段落標記(教材中僅此一種寫法)。 */
export const SUPPLEMENT_NOTE = "補充單字(自行練習發音)";
/** 「読み物」(課文閱讀)段落的單字。 */
export const READING_NOTE = "読み物";
/** 「会話」段落的單字。 */
export const DIALOGUE_NOTE = "会話";

/** 段落標記:note 完全等於這些值時只表示出處,不當提示顯示。 */
export const SECTION_MARKER_NOTES: readonly string[] = [
  READING_NOTE,
  DIALOGUE_NOTE,
  SUPPLEMENT_NOTE,
];

/** 單字出處段落(由段落標記 note 判斷):補充單字 / 読み物 / 会話。 */
export type VocabSection = "supplementary" | "reading" | "dialogue";

const SECTION_BY_NOTE: ReadonlyMap<string, VocabSection> = new Map([
  [SUPPLEMENT_NOTE, "supplementary"],
  [READING_NOTE, "reading"],
  [DIALOGUE_NOTE, "dialogue"],
]);

/**
 * note 為段落標記時回傳所屬段落(課程頁改以小徽章標示,T10.11);其餘 note(搭配、補充說明)
 * 與無 note 回傳 null。與 displayNote 互補:標記只走這裡,不當提示文字。
 */
export function noteSection(note: string | undefined): VocabSection | null {
  return note === undefined ? null : (SECTION_BY_NOTE.get(note) ?? null);
}

/**
 * 教材標為「補充單字(自行練習發音)」的字(多為專有名詞):預設不出題、不整課加入複習(T10.4/T10.11),
 * 仍可當選擇題干擾項、仍可單字加入。
 */
export function isSupplementary(v: { note?: string }): boolean {
  return v.note === SUPPLEMENT_NOTE;
}

/** 卡片上要顯示的 note:段落標記與空值回傳 null,其餘原樣回傳。 */
export function displayNote(note: string | undefined): string | null {
  if (note === undefined || note.trim() === "") return null;
  return SECTION_MARKER_NOTES.includes(note) ? null : note;
}
