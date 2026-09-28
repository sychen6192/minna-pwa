/**
 * 單字 `note` 的呈現(T10.3):教材的 note 多為助詞搭配(〔電車に〜〕)或補充說明,
 * 但也混有標示單字出處段落的標記,後者不是學習提示。
 */

/** 「補充單字(自行練習發音)」段落標記(教材中僅此一種寫法)。 */
export const SUPPLEMENT_NOTE = "補充單字(自行練習發音)";

/** 段落標記:note 完全等於這些值時只表示出處,不當提示顯示。 */
export const SECTION_MARKER_NOTES: readonly string[] = [
  "読み物",
  "会話",
  SUPPLEMENT_NOTE,
];

/** 卡片上要顯示的 note:段落標記與空值回傳 null,其餘原樣回傳。 */
export function displayNote(note: string | undefined): string | null {
  if (note === undefined || note.trim() === "") return null;
  return SECTION_MARKER_NOTES.includes(note) ? null : note;
}
