import {
  GRAMMAR_QUERY_PARAM,
  MODE_PARAM,
  PRECACHE_IGNORED_URL_PARAMS,
  UPTO_PARAM,
  drillHref,
  drillSearch,
  parseDrillMode,
} from "./urlParams";

/** 模擬 serwist precache 查找:去除名稱符合忽略清單的參數(removeIgnoredSearchParams) */
function precacheKey(href: string): string {
  const url = new URL(href, "https://app.test");
  for (const name of [...url.searchParams.keys()]) {
    if (PRECACHE_IGNORED_URL_PARAMS.some((re) => re.test(name)))
      url.searchParams.delete(name);
  }
  return url.pathname + url.search;
}

describe("PRECACHE_IGNORED_URL_PARAMS:帶 app 參數的網址離線仍命中 precache", () => {
  it("課程頁的活用練習連結 /drill?upto=N → /drill;RSC payload 的 _rsc 一併去除", () => {
    expect(drillHref(14)).toBe(`/drill?${UPTO_PARAM}=14`);
    expect(precacheKey(drillHref(14))).toBe("/drill");
    expect(precacheKey("/drill.txt?upto=14&_rsc=abc123")).toBe("/drill.txt");
    expect(precacheKey("/quiz.txt?_rsc=abc123")).toBe("/quiz.txt");
  });

  it("助詞搭配 /drill?upto=N&mode=particle、/drill?mode=particle → /drill(T11.7)", () => {
    expect(drillHref(14, "particle")).toBe(
      `/drill?${UPTO_PARAM}=14&${MODE_PARAM}=particle`,
    );
    expect(precacheKey(drillHref(14, "particle"))).toBe("/drill");
    expect(precacheKey(`/drill${drillSearch(null, "particle")}`)).toBe(
      "/drill",
    );
    expect(precacheKey("/drill.txt?mode=particle&_rsc=abc123")).toBe(
      "/drill.txt",
    );
  });

  it("文法速查 /grammar?q=…(replaceState 寫入的搜尋字串)→ /grammar:離線重新整理仍開得了", () => {
    expect(GRAMMAR_QUERY_PARAM).toBe("q");
    expect(precacheKey(`/grammar?q=${encodeURIComponent("て")}`)).toBe(
      "/grammar",
    );
    expect(precacheKey("/grammar.txt?q=tai&_rsc=abc123")).toBe("/grammar.txt");
  });

  it("只去除這些參數(名稱完全相符)", () => {
    expect(precacheKey("/drill?utm_source=x")).toBe("/drill?utm_source=x");
    expect(precacheKey("/drill?uptox=1")).toBe("/drill?uptox=1");
    expect(precacheKey("/drill?modes=1")).toBe("/drill?modes=1");
    expect(precacheKey("/grammar?query=1")).toBe("/grammar?query=1");
  });
});

describe("drillSearch / parseDrillMode", () => {
  it("活用為預設、不寫出;範圍 null 不寫出;都沒有時為空字串", () => {
    expect(drillSearch(14, "conj")).toBe("?upto=14");
    expect(drillSearch(null, "conj")).toBe("");
    expect(drillSearch(null, "particle")).toBe("?mode=particle");
    expect(drillSearch(3, "particle")).toBe("?upto=3&mode=particle");
  });

  it("?mode= 只認 particle / conj", () => {
    expect(parseDrillMode("?mode=particle")).toBe("particle");
    expect(parseDrillMode("?upto=3&mode=conj")).toBe("conj");
    expect(parseDrillMode("?upto=3")).toBeNull();
    expect(parseDrillMode("?mode=kanji")).toBeNull();
    expect(parseDrillMode("")).toBeNull();
  });
});
