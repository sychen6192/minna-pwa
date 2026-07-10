import type { Lesson, RubySeg, Sentence, VocabItem } from "@/schemas/lesson";

// ruby 分段的表面文字(串接 base,忽略讀音)
function surface(segs: RubySeg[]): string {
  return segs.map((s) => s.b).join("");
}

/**
 * 為單字找一句「同課語境例句」:掃該課的文法例句與会話,取文字含該單字表面形、
 * 且最短的一句(i+1 傾向——越短通常越單純)。找不到回傳 null。
 *
 * 以完整表面形(如「遊びます」)子字串比對,不做詞幹/活用還原:寧可漏,不可誤配。
 * 單一字元的單字(多為單漢字或助詞)易被較長詞包含(「本」⊂「日本」),故略過。
 */
export function findExampleSentence(vocab: VocabItem, lesson: Lesson): Sentence | null {
  const word = surface(vocab.ruby);
  if (word.length < 2) return null;

  const candidates: Sentence[] = [
    ...lesson.grammar.flatMap((g) => g.examples),
    ...lesson.dialogues,
  ];

  let best: Sentence | null = null;
  let bestLen = Infinity;
  for (const s of candidates) {
    const text = surface(s.ruby);
    if (text.includes(word) && text.length < bestLen) {
      best = s;
      bestLen = text.length;
    }
  }
  return best;
}
