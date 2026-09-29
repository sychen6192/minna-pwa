import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/*
 * globals.css 的語意色彩 token 回歸測試:兩種配色下文字對比皆 ≥ 4.5:1(WCAG AA),
 * 每個 token 都有 `@theme inline` 映射(Tailwind utility 才存在);
 * 元件原始碼不得寫死色票(一律走 token,深色模式才會跟著切換)。
 */
const here = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));
const css = readFileSync(here("./globals.css"), "utf8");

type Tokens = Record<string, string>;

function parseTokens(block: string): Tokens {
  const out: Tokens = {};
  for (const m of block.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-f]{6})\s*;/gi))
    out[m[1]] = m[2];
  return out;
}

const rootBlock = css.match(/^:root\s*\{([\s\S]*?)^\}/m)?.[1] ?? "";
const darkBlock =
  css.match(
    /@media \(prefers-color-scheme: dark\)\s*\{\s*:root\s*\{([\s\S]*?)\}\s*\}/,
  )?.[1] ?? "";
const themeBlock = css.match(/@theme inline\s*\{([\s\S]*?)^\}/m)?.[1] ?? "";
const light = parseTokens(rootBlock);
const darkOverrides = parseTokens(darkBlock);
const dark: Tokens = { ...light, ...darkOverrides };

type Rgb = [number, number, number];
const rgb = (hex: string): Rgb =>
  [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as Rgb;
/** fg 以 alpha 疊在 bg 上(Tailwind 的 `bg-x/10`) */
const mix = (fg: Rgb, bg: Rgb, alpha: number): Rgb =>
  fg.map((c, i) => c * alpha + bg[i] * (1 - alpha)) as Rgb;
const channel = (c: number) => {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const luminance = ([r, g, b]: Rgb) =>
  0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const TEXT_TOKENS = [
  "foreground",
  "muted-foreground",
  "link",
  "success",
  "warning",
  "destructive",
  "rating-again",
  "rating-hard",
  "rating-good",
  "rating-easy",
  "tag-grammar",
  "tag-example",
  "tag-vocab",
];

describe("globals.css 色彩 token", () => {
  it("宣告 color-scheme: light dark,深色只覆寫已存在的 token", () => {
    expect(rootBlock).toMatch(/color-scheme:\s*light dark/);
    expect(Object.keys(darkOverrides).length).toBeGreaterThan(10);
    for (const key of Object.keys(darkOverrides))
      expect(light).toHaveProperty(key);
    // 不走 .dark class(shadcn init 的預設),以免深色失效
    const code = css.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(code).not.toMatch(/\.dark\b|@custom-variant dark/);
  });

  it("每個 token 都映射為 Tailwind 色彩(--color-*)", () => {
    for (const key of Object.keys(light)) {
      expect(themeBlock).toContain(`--color-${key}: var(--${key});`);
    }
  });

  describe.each([
    ["淺色", light],
    ["深色", dark],
  ] as const)("%s", (_, t) => {
    const c = (fg: string, bg: string) => contrast(rgb(t[fg]), rgb(t[bg]));

    it.each(TEXT_TOKENS)("text-%s 在 background 與 card 上 ≥ 4.5:1", (tok) => {
      expect(c(tok, "background")).toBeGreaterThanOrEqual(4.5);
      expect(c(tok, "card")).toBeGreaterThanOrEqual(4.5);
    });

    it("muted 底上的文字、填色按鈕上的文字 ≥ 4.5:1", () => {
      expect(c("foreground", "muted")).toBeGreaterThanOrEqual(4.5);
      expect(c("muted-foreground", "muted")).toBeGreaterThanOrEqual(4.5);
      expect(c("primary-foreground", "primary")).toBeGreaterThanOrEqual(4.5);
      expect(c("primary-foreground", "primary-hover")).toBeGreaterThanOrEqual(4.5);
      expect(c("destructive-foreground", "destructive")).toBeGreaterThanOrEqual(
        4.5,
      );
    });

    it("淡底(同色 10%、警示 15%)上的狀態文字 ≥ 4.5:1", () => {
      for (const surface of ["background", "card"]) {
        const base = rgb(t[surface]);
        for (const tok of [
          "success",
          "destructive",
          "tag-grammar",
          "tag-example",
          "tag-vocab",
        ]) {
          expect(
            contrast(rgb(t[tok]), mix(rgb(t[tok]), base, 0.1)),
          ).toBeGreaterThanOrEqual(4.5);
        }
        const warnTint = mix(rgb(t["warning-accent"]), base, 0.15);
        expect(contrast(rgb(t.warning), warnTint)).toBeGreaterThanOrEqual(4.5);
        const heroTint = mix(rgb(t.primary), base, 0.06);
        expect(contrast(rgb(t.link), heroTint)).toBeGreaterThanOrEqual(4.5);
        expect(
          contrast(rgb(t["muted-foreground"]), heroTint),
        ).toBeGreaterThanOrEqual(4.5);
      }
    });

    it("重音標記線與圖表系列(圖形)≥ 3:1", () => {
      for (const tok of ["pitch", "chart-1"]) {
        expect(c(tok, "background")).toBeGreaterThanOrEqual(3);
        expect(c(tok, "card")).toBeGreaterThanOrEqual(3);
      }
    });
  });
});

describe("元件只用語意 token,不寫死色票", () => {
  const srcDir = here("../");
  const files = readdirSync(srcDir, { recursive: true, encoding: "utf8" })
    .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f))
    // layout.tsx 的 themeColor 必須是色碼字面值(下方另驗與 token 一致)
    .filter((f) => !/(^|\/)app\/layout\.tsx$/.test(f));
  const FORBIDDEN: [string, RegExp][] = [
    [
      "Tailwind 色票(sky-600 等)",
      /\b(?:bg|text|border|divide|ring|outline|accent|fill|stroke|from|via|to|decoration|shadow|caret|placeholder)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/,
    ],
    ["bg-white/text-black 等", /\b(?:bg|text|border)-(?:white|black)\b/],
    ["dark: variant(深色由 token 切換)", /\bdark:/],
    ["低透明度 text-foreground(次要文字用 text-muted-foreground)", /\btext-foreground\/[1-6]\d\b/],
    ["色碼字面值", /#[0-9a-fA-F]{3,8}\b/],
  ];

  it("掃描到原始碼", () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it.each(FORBIDDEN)("不含%s", (_, re) => {
    const hits = files.flatMap((f) =>
      readFileSync(join(srcDir, f), "utf8")
        .split("\n")
        .flatMap((line, i) => (re.test(line) ? [`${f}:${i + 1}: ${line.trim()}`] : [])),
    );
    expect(hits).toEqual([]);
  });

  it("themeColor 與 manifest 對應 token(淺色 = primary、深色 = background)", () => {
    // 不 import layout.tsx(會連帶載入 globals.css 走 PostCSS),直接讀原始碼
    const layout = readFileSync(here("./layout.tsx"), "utf8");
    const themeColor = (scheme: string) =>
      layout.match(
        new RegExp(`\\(prefers-color-scheme: ${scheme}\\)",\\s*color:\\s*"(#[0-9a-f]{6})"`, "i"),
      )?.[1];
    expect(themeColor("light")).toBe(light.primary);
    expect(themeColor("dark")).toBe(dark.background);
    const manifest = JSON.parse(
      readFileSync(here("../../public/manifest.json"), "utf8"),
    ) as { theme_color: string };
    expect(manifest.theme_color).toBe(light.primary);
  });
});
