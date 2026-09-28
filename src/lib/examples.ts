import type { Lesson, RubySeg, Sentence, VocabItem } from "@/schemas/lesson";

// ruby 分段的表面文字(串接 base,忽略讀音)
function surface(segs: RubySeg[]): string {
  return segs.map((s) => s.b).join("");
}

/** 詞的左邊界:教材例句以空格分かち書き,這些字元之後(或句首)才是一個詞的開頭 */
const BOUNDARY_RE = /[\s、。,，「」『』（(…？！?!]/;
/** 漢字(含々〆ヶ)與數字:漢字開頭的字若緊接在這些字之後,是較長複合詞的一部分(社員 ⊂ 会社員) */
const COMPOUND_RE = /[㐀-鿿豈-﫿々〆ヶ0-9０-９]/;
/** 敬語前綴:前一字為「お」「ご」者是另一個詞(帰りに ≠ お帰りに) */
const HONORIFIC_PREFIX_RE = /[おご]/;
/** 判斷「句子就是單字本身」時忽略的字元 */
const IGNORED_RE = /[\s。、?？!！…「」]/g;
/** 活用對照行(寒い → 寒く なります)的記號:這類行不是語境例句 */
const TABLE_ROW_MARK = "→";
/** note 的搭配名詞:〔音／声が〜〕→ 音、声;［バスが〜］→ バス */
const NOTE_NOUN_RE = /([^〔〕［］（）\s〜]+)([がをにへとで])〜/;

function normalize(text: string): string {
  return text.replace(IGNORED_RE, "");
}

/**
 * text 的第 at 字是否為一個詞的開頭。假名開頭的詞(kanaLead)須在句首或邊界字元之後
 * (うん ⊄ ううん、すぐ ⊄ まっすぐ、ですから ⊄ 元気ですから);漢字開頭的詞只排除接在
 * 漢字/數字之後的複合詞尾(イタリア料理 的 料理 仍算);前一字為「お」「ご」一律不算。
 */
function startsWord(text: string, at: number, kanaLead: boolean): boolean {
  if (at === 0) return true;
  const prev = text[at - 1];
  if (HONORIFIC_PREFIX_RE.test(prev)) return false;
  return kanaLead ? BOUNDARY_RE.test(prev) : !COMPOUND_RE.test(prev);
}

/** text 是否在某個詞的開頭處出現 word(逐一檢查每個出現位置)。 */
function containsWord(text: string, word: string, kanaLead: boolean): boolean {
  for (let i = text.indexOf(word); i >= 0; i = text.indexOf(word, i + 1)) {
    if (startsWord(text, i, kanaLead)) return true;
  }
  return false;
}

/**
 * 由 note 解析搭配名詞與助詞,轉成句中須出現的片段:〔音／声が〜〕→ 音が、声が。助詞為 が
 * 時也收 は/も(音も します);其他助詞不換(〔日本に〜〕います 的「日本は …」是別的意思)。
 * 要求名詞後接助詞,避免單字元名詞命中較長的詞(音 ⊂ 音楽)。
 * 解析不出(無 note、無「名詞+助詞〜」)回傳空陣列。
 */
function collocations(note: string | undefined): string[] {
  const m = note === undefined ? null : NOTE_NOUN_RE.exec(note);
  if (!m) return [];
  const particles = m[2] === "が" ? ["が", "は", "も"] : [m[2]];
  return m[1]
    .split("／")
    .filter((noun) => noun.length > 0)
    .flatMap((noun) => particles.map((p) => noun + p));
}

/**
 * 為單字找一句「同課語境例句」:掃該課的文法例句與会話,取在詞邊界上含該單字表面形、
 * 且最短的一句(i+1 傾向——越短通常越單純)。找不到回傳 null。
 *
 * 以完整表面形(如「遊びます」,記號［］〔〕〜 等照字面)比對,不做詞幹/活用還原,並依教材
 * 分かち書き判斷詞邊界(見 startsWord):寧可漏,不可誤配。另外略過:
 * - 單一字元的單字(多為單漢字或助詞),易是較長詞的開頭(「日」⊂「日曜日」)
 * - 含「→」的活用對照行,與正規化後等於單字本身的句子(「お茶」「ただいま。」)
 * - 同課有同表面形的另一字時(L47 します×3),須句中含該字 note 的搭配名詞(音が);
 *   note 解析不出名詞則不配
 */
export function findExampleSentence(
  vocab: VocabItem,
  lesson: Lesson,
): Sentence | null {
  const word = surface(vocab.ruby);
  if (word.length < 2) return null;
  const kanaLead = vocab.ruby[0].r === undefined;

  const homonym = lesson.vocab.some(
    (v) => v.id !== vocab.id && surface(v.ruby) === word,
  );
  const required = homonym ? collocations(vocab.note) : [];
  if (homonym && required.length === 0) return null;

  const candidates: Sentence[] = [
    ...lesson.grammar.flatMap((g) => g.examples),
    ...lesson.dialogues,
  ];

  let best: Sentence | null = null;
  let bestLen = Infinity;
  for (const s of candidates) {
    const text = surface(s.ruby);
    if (text.length >= bestLen) continue;
    if (text.includes(TABLE_ROW_MARK)) continue;
    if (normalize(text) === normalize(word)) continue;
    if (!containsWord(text, word, kanaLead)) continue;
    if (
      homonym &&
      !required.some((c) => containsWord(text, c, !COMPOUND_RE.test(c[0])))
    ) {
      continue;
    }
    best = s;
    bestLen = text.length;
  }
  return best;
}
