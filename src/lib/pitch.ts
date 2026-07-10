/**
 * 東京式ピッチアクセント(重音)的純函式邏輯。
 * accent 語意(同辭書慣例):0 = 平板型;n ≥ 1 = 第 n 拍為下降核(頭高/中高/尾高)。
 * 資料由建置期 scripts/enrich-accents.ts 依 kanjium 辭典回填至 vocab.accent。
 */

/** 併入前一拍的小書き假名(拗音・合拗音);っ/ッ・ー・ん 各自成拍 */
const SMALL_KANA = new Set("ゃゅょぁぃぅぇぉゎャュョァィゥェォヮ");

/** 將假名字串切成拍(mora)。拗音併入前一拍;促音・長音・撥音獨立成拍。 */
export function splitMorae(kana: string): string[] {
  const morae: string[] = [];
  for (const ch of kana) {
    if (SMALL_KANA.has(ch) && morae.length > 0) {
      morae[morae.length - 1] += ch;
    } else {
      morae.push(ch);
    }
  }
  return morae;
}

export interface PitchMora {
  text: string;
  /** 此拍是否為高音 */
  high: boolean;
  /** 下降核:此拍之後音高下降(尾高型下降發生在後接助詞) */
  dropAfter: boolean;
}

/**
 * 計算逐拍音高型。
 * - 平板 [0]:低高高…(無核)
 * - 頭高 [1]:高低低…
 * - 中高/尾高 [n]:低高…高(至第 n 拍)後降
 * accent 缺值、為負、或超出拍數(壞資料)一律回傳 null,由呼叫端降級為純文字。
 */
export function pitchPattern(
  kana: string,
  accent: number | undefined,
): PitchMora[] | null {
  const morae = splitMorae(kana);
  if (morae.length === 0) return null;
  if (accent === undefined || accent < 0 || accent > morae.length) return null;

  return morae.map((text, i) => {
    const pos = i + 1; // 拍序(1 起算)
    const high =
      accent === 0 ? pos >= 2 : accent === 1 ? pos === 1 : pos >= 2 && pos <= accent;
    return { text, high, dropAfter: pos === accent };
  });
}
