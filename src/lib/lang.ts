/**
 * 介面上日文字串的語言標記(`lang="ja"`):讓瀏覽器以日文字形(今/直/骨…)與日文斷行規則
 * 呈現、輔助朗讀改用日語語音。<html> 為 zh-Hant,日文內容須逐處標記。
 */

/** 平/片假名:含假名者必為日文 */
const KANA_RE = /[ぁ-ゖァ-ヺ]/;

/**
 * 中文說明才會出現的字詞(虛詞、日文不用的繁體字形與詞;「假」日文寫作「仮」)。課名/文型中少數沒有假名的字串是
 * 中文說明(「動詞的活用」「普通形(常體)」「句子修飾名詞」),其餘無假名者多為日文術語(数量詞、謙譲語)。
 */
const ZH_ONLY_RE = /[的與體會區變為說這們假]|句子|表達|被動|字典/;

/**
 * 課名、文型等「可能是日文術語、也可能是中文說明」的字串是否為日文:
 * 有假名 → 日文;否則含中文專用字 → 中文;其餘(純漢字術語)視為日文。
 * 單字、例句、会話一律是日文,直接標 `lang="ja"`,不需經過此判斷。
 */
export function isJapanese(s: string): boolean {
  if (KANA_RE.test(s)) return true;
  return !ZH_ONLY_RE.test(s);
}

/** JSX 用:日文回傳 "ja",否則 undefined(沿用 <html lang="zh-Hant">) */
export function jaLang(s: string): "ja" | undefined {
  return isJapanese(s) ? "ja" : undefined;
}
