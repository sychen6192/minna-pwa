/**
 * pnpm enrich:accents [--source <accents.txt>]
 *
 * 以 kanjium 重音辭典(CC BY-SA 4.0)回填 public/data/lessons/*.json 的
 * vocab.accent(東京式:0 = 平板,n = 第 n 拍後下降)。建置期一次性工具,
 * 重跑冪等;public/data 禁止手改,一律經本腳本產生。
 *
 * 配對分層(寧缺勿錯,不確定就不標):
 *   T1 exact   表記+讀音精確配對(純假名詞的讀音欄為空,以表記代讀音)
 *   T2 masu    ます形音韻規則:重音核固定在「ま」= 拍數-1(kanjium 不收ます形;
 *              適用動詞與「表面無空格」的單詞慣用句;含を的片語除外)
 *   T3 surface 表記唯一:同表記所有詞條重音一致才採用
 *   T4 reading 讀音唯一:所有同音詞重音一致才採用(排除橋/箸/端類歧義)
 *
 * 來源預設下載至 pipeline/work/accents.txt(gitignored,中間產物不入庫)。
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { splitMorae } from "../src/lib/pitch";
import { LessonSchema } from "../src/schemas/lesson";

const KANJIUM_URL =
  "https://raw.githubusercontent.com/mifunetoshiro/kanjium/master/data/source_files/raw/accents.txt";
const DEFAULT_SOURCE = "pipeline/work/accents.txt";
const LESSONS_DIR = "public/data/lessons";
const MISSES_REPORT = "pipeline/work/accent-misses.txt";

// ---------- 正規化 ----------

/** 片假名 → 平假名(長音ー保留;讀音比對用) */
function toHiragana(s: string): string {
  let out = "";
  for (const ch of s) {
    const code = ch.codePointAt(0) as number;
    out += code >= 0x30a1 && code <= 0x30f6 ? String.fromCodePoint(code - 0x60) : ch;
  }
  return out;
}

/** 配對前剝除的標點・空白・括注(教材表記如「お名前は?」「…歳」) */
const STRIP_CHARS = new Set("。、?!?!・…()()[]［］「」 　〜~");

function normalize(s: string): string {
  let out = "";
  for (const ch of s) if (!STRIP_CHARS.has(ch)) out += ch;
  return out;
}

// ---------- kanjium 解析 ----------

export interface AccentDict {
  /** `表記\t讀音(平仮名)` → 首見重音(kanjium 首列為最常用) */
  bySurfaceReading: Map<string, number>;
  /** 表記 → 重音(null = 各詞條不一致,不可用) */
  bySurface: Map<string, number | null>;
  /** 讀音(平仮名)→ 重音(null = 同音詞歧義,不可用) */
  byReading: Map<string, number | null>;
}

/** 取重音欄第一個數值(如 "0,2" → 0;無數值回傳 null) */
function firstAccent(field: string): number | null {
  const m = /\d+/.exec(field.split(",")[0] ?? "");
  return m ? Number(m[0]) : null;
}

function setUnanimous(map: Map<string, number | null>, key: string, value: number): void {
  if (!map.has(key)) map.set(key, value);
  else if (map.get(key) !== value) map.set(key, null);
}

/** 解析 kanjium accents.txt(表記\t讀音\t重音;讀音欄空 = 表記即假名) */
export function parseAccents(text: string): AccentDict {
  const dict: AccentDict = {
    bySurfaceReading: new Map(),
    bySurface: new Map(),
    byReading: new Map(),
  };
  for (const line of text.split("\n")) {
    const parts = line.split("\t");
    if (parts.length !== 3) continue;
    const [surface, reading, accentField] = parts;
    const accent = firstAccent(accentField);
    if (surface === "" || accent === null) continue;
    const readingHira = toHiragana(reading !== "" ? reading : surface);

    const key = `${surface}\t${readingHira}`;
    if (!dict.bySurfaceReading.has(key)) dict.bySurfaceReading.set(key, accent);
    setUnanimous(dict.bySurface, surface, accent);
    setUnanimous(dict.byReading, readingHira, accent);
  }
  return dict;
}

// ---------- 配對 ----------

export type MatchTier = "exact" | "masu" | "surface" | "reading" | "miss";
export interface MatchResult {
  accent?: number;
  tier: MatchTier;
}

interface VocabLike {
  ruby: { b: string; r?: string }[];
  kana: string;
  pos: string;
}

/** 為單一單字配對重音;所有層都要求 0 ≤ accent ≤ 拍數(防壞資料)。 */
export function matchAccent(vocab: VocabLike, dict: AccentDict): MatchResult {
  const surfaceRaw = vocab.ruby.map((s) => s.b).join("");
  const surface = normalize(surfaceRaw);
  const kanaHira = toHiragana(normalize(vocab.kana));
  const moraCount = splitMorae(kanaHira).length;
  const valid = (a: number | null | undefined): a is number =>
    a !== null && a !== undefined && a >= 0 && a <= moraCount;

  const exact = dict.bySurfaceReading.get(`${surface}\t${kanaHira}`);
  if (valid(exact)) return { accent: exact, tier: "exact" };

  // ます形:重音核固定在「ま」(= 拍數-1)。多詞句(表面含空格)無單一核,不標。
  if (kanaHira.endsWith("ます") && !kanaHira.includes("を")) {
    const inner = surfaceRaw.trim().replace(/[。 　]+$/u, "");
    const isSingleWord = !/[ 　]/u.test(inner);
    if (vocab.pos.startsWith("動") || isSingleWord) {
      return { accent: moraCount - 1, tier: "masu" };
    }
  }

  const bySurface = dict.bySurface.get(surface);
  if (valid(bySurface)) return { accent: bySurface, tier: "surface" };

  const byReading = dict.byReading.get(kanaHira);
  if (valid(byReading)) return { accent: byReading, tier: "reading" };

  return { tier: "miss" };
}

// ---------- 手術式寫回(保持既有序列化格式,diff 只有 accent 行) ----------

const ACCENT_LINE = /^\s*"accent": \d+,$/;
const KANA_LINE = /^(\s*)"kana": ".*",$/;

/**
 * 在第 i 個 `"kana":` 行後插入第 i 個 accent(undefined 不插);
 * 既有 accent 行先剝除,故重跑冪等。kana 只出現在 vocab(Sentence 無此欄)。
 */
export function insertAccents(raw: string, accents: (number | undefined)[]): string {
  const lines = raw.split("\n").filter((line) => !ACCENT_LINE.test(line));
  const out: string[] = [];
  let index = 0;
  for (const line of lines) {
    out.push(line);
    const m = KANA_LINE.exec(line);
    if (m) {
      const accent = accents[index];
      if (accent !== undefined) out.push(`${m[1]}"accent": ${accent},`);
      index += 1;
    }
  }
  if (index !== accents.length) {
    throw new Error(`kana 行數(${index})與 vocab 數(${accents.length})不符,拒絕寫入`);
  }
  return out.join("\n");
}

// ---------- 主流程 ----------

async function loadSource(): Promise<string> {
  const argIndex = process.argv.indexOf("--source");
  const source = argIndex >= 0 ? process.argv[argIndex + 1] : DEFAULT_SOURCE;
  if (!source) throw new Error("--source 需要路徑參數");
  if (!existsSync(source)) {
    if (argIndex >= 0) throw new Error(`找不到指定來源:${source}`);
    console.log(`下載 kanjium 重音辭典 → ${source}`);
    const res = await fetch(KANJIUM_URL);
    if (!res.ok) throw new Error(`下載失敗:HTTP ${res.status}`);
    mkdirSync(dirname(source), { recursive: true });
    writeFileSync(source, await res.text(), "utf8");
  }
  return readFileSync(source, "utf8");
}

async function main(): Promise<void> {
  const dict = parseAccents(await loadSource());
  console.log(
    `辭典載入:${dict.bySurfaceReading.size.toLocaleString()} 表記+讀音鍵\n`,
  );

  const tally = new Map<MatchTier, number>();
  const misses: string[] = [];

  const files = readdirSync(LESSONS_DIR)
    .filter((n) => /^L\d{2}\.json$/.test(n))
    .sort();
  for (const name of files) {
    const file = join(LESSONS_DIR, name);
    const raw = readFileSync(file, "utf8");
    const lesson = LessonSchema.parse(JSON.parse(raw)); // 進場驗證

    const results = lesson.vocab.map((v) => matchAccent(v, dict));
    const next = insertAccents(raw, results.map((r) => r.accent));

    // 出場驗證:契約 + 逐項核對寫入的 accent
    const reparsed = LessonSchema.parse(JSON.parse(next));
    reparsed.vocab.forEach((v, i) => {
      if (v.accent !== results[i].accent) {
        throw new Error(`${name} ${v.id}:寫入核對失敗`);
      }
    });
    writeFileSync(file, next, "utf8");

    results.forEach((r, i) => {
      tally.set(r.tier, (tally.get(r.tier) ?? 0) + 1);
      if (r.tier === "miss") {
        const v = lesson.vocab[i];
        misses.push(`${v.id}\t${v.pos}\t${v.kana}\t${v.ruby.map((s) => s.b).join("")}`);
      }
    });
    console.log(`✓ ${name}(${lesson.vocab.length} 字)`);
  }

  const total = [...tally.values()].reduce((a, b) => a + b, 0);
  const matched = total - (tally.get("miss") ?? 0);
  console.log("\n=== 覆蓋率 ===");
  for (const tier of ["exact", "masu", "surface", "reading", "miss"] as const) {
    const n = tally.get(tier) ?? 0;
    console.log(`${tier.padEnd(8)} ${String(n).padStart(5)}(${((n / total) * 100).toFixed(1)}%)`);
  }
  console.log(`總覆蓋:${matched}/${total}(${((matched / total) * 100).toFixed(1)}%)`);

  mkdirSync(dirname(MISSES_REPORT), { recursive: true });
  writeFileSync(MISSES_REPORT, misses.join("\n") + "\n", "utf8");
  console.log(`未命中清單 → ${MISSES_REPORT}(${misses.length} 筆)`);
}

// 直接執行才跑 main(測試 import 純函式時不觸發)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
