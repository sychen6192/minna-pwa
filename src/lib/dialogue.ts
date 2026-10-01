import type { Sentence } from "@/schemas/lesson";

/**
 * 会話朗讀與角色扮演(T11.2,F7.2)的純函式:說話者清單、播放步驟。
 *
 * `Lesson.dialogues` 的每一行都是台詞:会話標題不是台詞,存於 `Lesson.dialogueTitle`
 * (DATA_MODEL §1.2;T12.4 起,原為 L15/L23/L24/L41 的第一行),由課程頁另以小標顯示,
 * 不經過這裡。
 */

type Line = Pick<Sentence, "id" | "speaker">;

/** 会話中的說話者(依首次出現順序、不重複;不含無 speaker 的行):扮演的選項。 */
export function speakersOf(lines: readonly Line[]): string[] {
  const speakers: string[] = [];
  for (const line of lines) {
    const speaker = line.speaker?.trim();
    if (!speaker || speakers.includes(speaker)) continue;
    speakers.push(speaker);
  }
  return speakers;
}

/** 播放步驟:speak = 以 TTS 朗讀;wait = 扮演的角色的台詞,暫停等使用者說完再繼續 */
export interface PlaybackStep {
  lineId: string;
  action: "speak" | "wait";
}

/** 「全部播放」的步驟:依序每行一步;指定 `role` 時該說話者的台詞為 wait。 */
export function buildPlayback(
  lines: readonly Line[],
  { role }: { role?: string | null } = {},
): PlaybackStep[] {
  return lines.map((line): PlaybackStep => {
    const isRole = role != null && line.speaker?.trim() === role;
    return { lineId: line.id, action: isRole ? "wait" : "speak" };
  });
}
