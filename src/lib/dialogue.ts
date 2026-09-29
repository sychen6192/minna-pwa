import type { Sentence } from "@/schemas/lesson";

/**
 * 会話朗讀與角色扮演(T11.2,F7.2)的純函式:標題行判定、說話者清單、播放步驟。
 *
 * 教材資料中少數課的第一行是会話標題而非台詞,寫法不一(pipeline 統一前以此執行期防護):
 * L15-D01 speaker「（標題）」、L24-D01「標題」、L23-D01 與 L41-D01 沒有 speaker;其餘 46 課沒有標題行。
 */

type Line = Pick<Sentence, "id" | "speaker">;

/** speaker 欄的標題標記(「標題」「（標題）」) */
const TITLE_SPEAKER_RE = /標題/;

/** 第一行(index 0)且 speaker 缺漏/空白或含「標題」者為会話標題:以小標顯示,不列入播放與扮演。 */
export function isTitleLine(
  line: Pick<Sentence, "speaker">,
  index: number,
): boolean {
  if (index !== 0) return false;
  const speaker = line.speaker?.trim();
  return !speaker || TITLE_SPEAKER_RE.test(speaker);
}

/** 会話中的說話者(依首次出現順序、不重複;不含標題行與無 speaker 的行):扮演的選項。 */
export function speakersOf(lines: readonly Line[]): string[] {
  const speakers: string[] = [];
  lines.forEach((line, i) => {
    const speaker = line.speaker?.trim();
    if (!speaker || isTitleLine(line, i) || speakers.includes(speaker)) return;
    speakers.push(speaker);
  });
  return speakers;
}

/** 播放步驟:speak = 以 TTS 朗讀;wait = 扮演的角色的台詞,暫停等使用者說完再繼續 */
export interface PlaybackStep {
  lineId: string;
  action: "speak" | "wait";
}

/** 「全部播放」的步驟:依序跳過標題行;指定 `role` 時該說話者的台詞為 wait。 */
export function buildPlayback(
  lines: readonly Line[],
  { role }: { role?: string | null } = {},
): PlaybackStep[] {
  return lines.flatMap((line, i): PlaybackStep[] => {
    if (isTitleLine(line, i)) return [];
    const isRole = role != null && line.speaker?.trim() === role;
    return [{ lineId: line.id, action: isRole ? "wait" : "speak" }];
  });
}
