/**
 * 東京式ピッチアクセント(重音)的純函式邏輯。
 * accent 語意(同辭書慣例):0 = 平板型;n ≥ 1 = 第 n 拍為下降核(頭高/中高/尾高)。
 * 資料由建置期 scripts/enrich-accents.ts 依 kanjium 辭典回填至 vocab.accent。
 */

/** 併入前一拍的小書き假名(拗音・合拗音);っ/ッ・ー・ん 各自成拍 */
const SMALL_KANA = new Set("ゃゅょぁぃぅぇぉゎャュョァィゥェォヮ");

/** 計拍字元:平/片假名、長音ー、踊り字(ゝゞヽヾ)。其餘(…、・〜［］空白、漢字、英數)皆不計拍 */
const KANA_RE = /[ぁ-ゖァ-ヺーゝゞヽヾ]/;

/** 是否為計拍的假名字元(`splitMorae` 與 enrich-accents 的拍數共用此定義) */
export function isKana(ch: string): boolean {
  return KANA_RE.test(ch);
}

/**
 * 將假名字串切成拍(mora)。拗音併入前一拍;促音・長音・撥音獨立成拍。
 * 非假名字元(…、・〜［］等教材記號)不計拍、直接略過——與 enrich-accents 回填 accent 時
 * 剝除記號後計算的拍數一致(…ばい = 2 拍)。
 */
export function splitMorae(kana: string): string[] {
  return pitchUnits(kana)
    .filter((u) => u.mora)
    .map((u) => u.text);
}

/** 逐字切出拍與記號(記號原樣保留、不計拍;小書き只併入緊鄰的前一拍) */
function pitchUnits(kana: string): { text: string; mora: boolean }[] {
  const units: { text: string; mora: boolean }[] = [];
  for (const ch of kana) {
    const last = units[units.length - 1];
    if (!isKana(ch)) {
      units.push({ text: ch, mora: false });
    } else if (SMALL_KANA.has(ch) && last?.mora) {
      last.text += ch;
    } else {
      units.push({ text: ch, mora: true });
    }
  }
  return units;
}

export interface PitchMora {
  text: string;
  /** 此拍是否為高音 */
  high: boolean;
  /** 下降核:此拍之後音高下降(尾高型下降發生在後接助詞) */
  dropAfter: boolean;
  /** 非假名記號(…、・〜［］等):原樣顯示,不計拍、無音高 */
  mark?: true;
}

/**
 * 計算逐拍音高型。
 * - 平板 [0]:低高高…(無核)
 * - 頭高 [1]:高低低…
 * - 中高/尾高 [n]:低高…高(至第 n 拍)後降
 * 非假名記號以 `mark` 項原樣穿插其間(不計拍,…ばい [0] = … 、ば低、い高)。
 * accent 缺值、為負、超出拍數(壞資料)或沒有任何拍,一律回傳 null,由呼叫端降級為純文字。
 */
export function pitchPattern(
  kana: string,
  accent: number | undefined,
): PitchMora[] | null {
  const units = pitchUnits(kana);
  const moraCount = units.filter((u) => u.mora).length;
  if (moraCount === 0) return null;
  if (accent === undefined || accent < 0 || accent > moraCount) return null;

  let pos = 0; // 拍序(1 起算)
  return units.map(({ text, mora }): PitchMora => {
    if (!mora) return { text, high: false, dropAfter: false, mark: true };
    pos += 1;
    const high =
      accent === 0 ? pos >= 2 : accent === 1 ? pos === 1 : pos >= 2 && pos <= accent;
    return { text, high, dropAfter: pos === accent };
  });
}

/**
 * 表面本身就是讀音:表面只有假名與記號(無漢字、英數),且其假名與 kana 完全相同。
 * 例:どうぞ。/ どうぞ、［カセット］テープ / カセットテープ → true;
 * 好き / すき、ハンサム［な］/ ハンサム、2、3〜 / に、さん → false(標題與讀音不同)。
 */
export function isKanaSurface(vocab: { ruby: readonly { b: string; r?: string }[]; kana: string }): boolean {
  const surface = vocab.ruby.map((s) => s.b).join("");
  const letters = (s: string) => [...s].filter(isKana).join("");
  const hasOtherLetters = [...surface].some((ch) => !isKana(ch) && /[\p{L}\p{N}]/u.test(ch));
  return !hasOtherLetters && letters(surface) === letters(vocab.kana);
}

/**
 * 純假名字(`isKanaSurface`)且有可標記的 accent 時,標題可直接以重音標記呈現,不必再另列一份
 * 相同的假名。回傳要交給 PitchAccent 的表面文字(記號如「。」「〜」「［］」原樣保留、不計拍,
 * 拍數與 kana 相同);否則 null。
 */
export function kanaHeadword(vocab: {
  ruby: readonly { b: string; r?: string }[];
  kana: string;
  accent?: number;
}): string | null {
  if (!isKanaSurface(vocab)) return null;
  const surface = vocab.ruby.map((s) => s.b).join("");
  return pitchPattern(surface, vocab.accent) ? surface : null;
}
