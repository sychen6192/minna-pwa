import {
  displayNote,
  isSupplementary,
  SECTION_MARKER_NOTES,
  SUPPLEMENT_NOTE,
} from "./notes";

describe("displayNote", () => {
  it("段落標記(読み物/会話/補充單字)不顯示", () => {
    expect(displayNote("読み物")).toBeNull();
    expect(displayNote("会話")).toBeNull();
    expect(displayNote("補充單字(自行練習發音)")).toBeNull();
    expect(SECTION_MARKER_NOTES).toContain(SUPPLEMENT_NOTE);
  });

  it("搭配與補充說明原樣回傳", () => {
    expect(displayNote("〔電車に〜〕")).toBe("〔電車に〜〕");
    expect(displayNote("［友達に〜］")).toBe("［友達に〜］");
    expect(displayNote("〔〜を します:做運動〕")).toBe(
      "〔〜を します:做運動〕",
    );
    expect(displayNote("接尾")).toBe("接尾");
  });

  it("只過濾完全相同的標記:含標記字樣的其他 note 仍顯示", () => {
    expect(displayNote("会話で使う")).toBe("会話で使う");
    expect(displayNote("読み物 ")).toBe("読み物 ");
  });

  it("無 note 或空白 → null", () => {
    expect(displayNote(undefined)).toBeNull();
    expect(displayNote("")).toBeNull();
    expect(displayNote("  ")).toBeNull();
  });
});

describe("isSupplementary", () => {
  it("只有 note 恰為「補充單字(自行練習發音)」者為補充單字", () => {
    expect(isSupplementary({ note: SUPPLEMENT_NOTE })).toBe(true);
    expect(isSupplementary({ note: "読み物" })).toBe(false);
    expect(isSupplementary({ note: "〔電車に〜〕" })).toBe(false);
    expect(isSupplementary({})).toBe(false);
  });
});
