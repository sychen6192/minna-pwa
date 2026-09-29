import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { LessonSchema, type VocabItem } from "@/schemas/lesson";
import { kanaHeadword, pitchPattern, splitMorae } from "./pitch";

// 以實際教材資料(public/data)驗證重音顯示:enrich-accents 寫入的每個 accent 都畫得出來,
// 且記號不計拍(DQ-09)。
const lessonsDir = join(process.cwd(), "public", "data", "lessons");
const vocab: VocabItem[] = readdirSync(lessonsDir)
  .filter((f) => f.endsWith(".json"))
  .flatMap(
    (f) =>
      LessonSchema.parse(JSON.parse(readFileSync(join(lessonsDir, f), "utf-8")))
        .vocab,
  );
const byId = new Map(vocab.map((v) => [v.id, v]));

function word(id: string): VocabItem {
  const v = byId.get(id);
  if (!v) throw new Error(`找不到 ${id}`);
  return v;
}

describe("重音 × 教材單字(T10.8)", () => {
  it("資料載入完整", () => {
    expect(vocab.length).toBeGreaterThan(2000);
  });

  it("每個帶 accent 的字都畫得出重音(accent 不超過拍數)", () => {
    const broken = vocab.filter(
      (v) => v.accent !== undefined && pitchPattern(v.kana, v.accent) === null,
    );
    expect(broken.map((v) => `${v.id} ${v.kana} [${v.accent}]`)).toEqual([]);
  });

  it("L44-V019 …ばい [0]:… 不計拍,ば 低、い 高", () => {
    const v = word("L44-V019");
    expect(v.kana).toBe("…ばい");
    const morae = pitchPattern(v.kana, v.accent)?.filter((m) => !m.mark);
    expect(morae?.map((m) => [m.text, m.high])).toEqual([
      ["ば", false],
      ["い", true],
    ]);
  });

  it("L17-V032 に、さん [1]:、 不計拍,3 拍頭高", () => {
    const v = word("L17-V032");
    expect(splitMorae(v.kana)).toEqual(["に", "さ", "ん"]);
    expect(pitchPattern(v.kana, v.accent)?.find((m) => m.dropAfter)?.text).toBe("に");
  });

  it("純假名標題:拍數與 kana 相同(重音位置不因記號偏移)", () => {
    const heads = vocab.flatMap((v) => {
      const head = kanaHeadword(v);
      return head === null ? [] : [{ v, head }];
    });
    expect(heads.length).toBeGreaterThan(400);
    for (const { v, head } of heads) {
      expect(splitMorae(head)).toEqual(splitMorae(v.kana));
    }
    expect(kanaHeadword(word("L02-V043"))).toBe("どうぞ。");
    expect(kanaHeadword(word("L09-V003"))).toBeNull(); // 好き［な］:含漢字
  });
});
