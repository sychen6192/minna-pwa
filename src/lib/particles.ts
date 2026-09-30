import { isSupplementary } from "@/lib/notes";
import type { Lesson, RubySeg, VocabItem } from "@/schemas/lesson";

/**
 * 助詞搭配練習(T11.7,F7.5):題目只取單字 note 中教材原有的搭配(〔たばこを〜〕、
 * 〔〜を します：做作業〕),不補新的搭配;題幹「たばこ（　）吸います」,從 を/に/が/で/へ/と 選。
 * 單次練習、不寫入 SRS/DB。
 */

/** 選項的助詞;選項依此順序排列(位置不洩漏答案,找選項也快) */
export const PARTICLES = ["を", "に", "が", "で", "へ", "と"] as const;
export type Particle = (typeof PARTICLES)[number];

/** 一回合的題數(範圍內的搭配不足時為全部) */
export const PARTICLE_COUNT = 10;
/** 選項數(正解 + 3 個干擾項) */
export const PARTICLE_OPTION_COUNT = 4;
/** 最早有教材搭配的課(第 6 課〔たばこを〜〕;資料測試驗證) */
export const PARTICLE_FIRST_LESSON = 6;

/** note 中代表單字本身的記號 */
export const WORD_MARK = "〜";

/** note 中的一個助詞搭配(教材原文;〜 = 單字本身) */
export interface Collocation {
  /** 空格前的名詞:note 的名詞(〔たばこを〜〕的 たばこ),或 "〜" = 單字本身(〔〜を します〕) */
  noun: string;
  /** 名詞的讀音:note 並列假名與漢字(［でんきが〜］［電気が〜］)時才有 */
  reading?: string;
  particle: Particle;
  /** 空格後:"〜"(單字本身)、"〜が あります"(單字 + note 的後續)、"します"(〔〜を します〕的述語) */
  predicate: string;
  /** note 冒號後的中譯(〔〜を します：做作業〕) */
  gloss?: string;
}

// ── 解析 note ────────────────────────────────────────────────────────

/**
 * 解析時認得的助詞:選項以外的 から/まで/より/の 也要認得,「学校まで〜」才不會被切成
 * 学校ま + で。解析到選項以外的助詞時排除該搭配(答案不在選項組裡會變成一眼可辨的異類;
 * 現有教材 note 沒有這種搭配)。
 */
const NOTE_PARTICLE = "から|まで|より|を|に|が|で|へ|と|の";
/** 名詞在〜之前:たばこを〜、コンピューターに〜が あります */
const NOUN_FIRST_RE = new RegExp(`^(.+?)(${NOTE_PARTICLE})\\s*〜(.*)$`);
/** 單字本身在前(名詞單字):〜を します、〜が でます、〜を かきます */
const WORD_FIRST_RE = new RegExp(`^〜\\s*(${NOTE_PARTICLE})\\s*(\\S+ます)$`);
/** 括號內沒有〜:〔ワープロを〕(打ちます) */
const NO_MARK_RE = new RegExp(`^(.+?)(${NOTE_PARTICLE})$`);
/** 名詞:不含空白、括號、〜…、標點(並列的「／」另外切開) */
const NOUN_RE = /^[^\s［］〔〕（）()〜～…:：、。]+$/;
/** 整個 note 由一或多組括號組成:［たばこを〜］、［でんきが〜］［電気が〜］ */
const GROUPS_RE = /^(?:[［〔][^［］〔〕]*[］〕])+$/;
const GROUP_RE = /[［〔]([^［］〔〕]*)[］〕]/g;
const HIRAGANA_RE = /^[ぁ-ゖー]+$/;
const KANJI_RE = /^[\p{Script=Han}々]+$/u;

function isParticle(p: string): p is Particle {
  return (PARTICLES as readonly string[]).includes(p);
}

/** 未閉合的括號數(［〔 +1、］〕 −1) */
function openDepth(s: string): number {
  let depth = 0;
  for (const c of s) {
    if (c === "［" || c === "〔") depth++;
    else if (c === "］" || c === "〕") depth--;
  }
  return depth;
}

/**
 * 去掉冒號(半/全形;教材資料為全形,T12.6)後的中譯說明。整個 note 以括號包住時(〔〜を します：做作業〕、
 * 〔コンピューターに〜が あります：〔對電腦〕感興趣〕),冒號前留下的開括號與說明結尾的閉括號各去掉。
 */
function splitGloss(note: string): { head: string; gloss?: string } {
  const colon = note.search(/[:：]/);
  if (colon < 0) return { head: note.trim() };
  let head = note.slice(0, colon);
  let gloss = note.slice(colon + 1);
  if (/^[［〔]/.test(head) && openDepth(head) > 0) {
    head = head.slice(1);
    gloss = gloss.replace(/[］〕]$/, "");
  }
  gloss = gloss.trim();
  return { head: head.trim(), gloss: gloss === "" ? undefined : gloss };
}

/** 一段搭配(括號內或整個 note)→ 搭配;名詞以「／」並列時各為一個(〔音／声が〜〕) */
function parseBody(
  body: string,
  bracketed: boolean,
  gloss: string | undefined,
): Collocation[] | null {
  const withGloss = (c: Collocation): Collocation =>
    gloss === undefined ? c : { ...c, gloss };
  const nounFirst = (noun: string, particle: string, predicate: string) => {
    if (!isParticle(particle)) return null;
    const nouns = noun.split("／");
    if (!nouns.every((n) => NOUN_RE.test(n))) return null;
    return nouns.map((n) => withGloss({ noun: n, particle, predicate }));
  };

  const m = NOUN_FIRST_RE.exec(body);
  if (m) {
    const rest = m[3].trimEnd(); // 〜 之後照 note 原樣(〜が あります)
    if (rest.includes(WORD_MARK)) return null;
    return nounFirst(m[1].trim(), m[2], WORD_MARK + rest);
  }
  const w = WORD_FIRST_RE.exec(body);
  if (w) {
    if (!isParticle(w[1])) return null;
    return [withGloss({ noun: WORD_MARK, particle: w[1], predicate: w[2] })];
  }
  // 沒有〜的寫法只認括號內者(〔ワープロを〕);裸的「禮貌形」「接尾」等說明不是搭配
  const n = bracketed ? NO_MARK_RE.exec(body) : null;
  if (n) return nounFirst(n[1].trim(), n[2], WORD_MARK);
  return null;
}

/**
 * 單字 note 中的助詞搭配(教材原文,全部並列者)。認得的寫法:
 * - ［たばこを〜］、〔電話を〜〕、〔ワープロを〕(括號內沒有〜)
 * - 〔〜を します：做作業〕、〜を します：問候(名詞單字本身在前;冒號後為中譯)
 * - 〔コンピューターに〜が あります：…〕(〜之後還有 note 的後續)
 * - 並列:〔うちが〜〕〔パンが〜〕〔肉が〜〕、〔音／声が〜〕;［でんきが〜］［電気が〜］(假名與漢字
 *   並列同一個名詞)合併為一個帶讀音的名詞
 * 任何一段無法解析、助詞不在選項組(から/まで/より/の)、沒有助詞(〔〜します：進行確認〕)
 * 或〜不是單字本身(〔〜の こと〕)時回傳 []。
 */
export function parseCollocations(note: string | undefined): Collocation[] {
  if (note === undefined) return [];
  const { head, gloss } = splitGloss(note.trim());
  if (head === "") return [];
  const grouped = GROUPS_RE.test(head);
  const bodies = grouped
    ? [...head.matchAll(GROUP_RE)].map((m) => m[1].trim())
    : [head];
  const parsed: Collocation[] = [];
  for (const body of bodies) {
    const list = parseBody(body, grouped, gloss);
    if (list === null) return [];
    parsed.push(...list);
  }

  // ［でんきが〜］［電気が〜］:同一個名詞的讀音與漢字 → 一個帶讀音的名詞
  if (bodies.length === 2 && parsed.length === 2) {
    const [kana, kanji] = parsed;
    if (
      HIRAGANA_RE.test(kana.noun) &&
      KANJI_RE.test(kanji.noun) &&
      kana.particle === kanji.particle &&
      kana.predicate === kanji.predicate
    ) {
      return [{ ...kanji, reading: kana.noun }];
    }
  }

  const seen = new Set<string>();
  return parsed.filter((c) => {
    const key = `${c.noun}|${c.particle}|${c.predicate}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** note 中的第一個助詞搭配;無法解析回傳 null */
export function parseCollocation(note: string | undefined): Collocation | null {
  return parseCollocations(note)[0] ?? null;
}

// ── 出題池 ──────────────────────────────────────────────────────────

/** 練習用單字:教材單字 + 所屬課號 + note 中的搭配 */
export interface ParticleItem extends VocabItem {
  lessonId: number;
  /** 教材並列的搭配(出題時擇一) */
  collocations: Collocation[];
}

/** ruby 的表面文字 */
function surface(ruby: readonly RubySeg[]): string {
  return ruby.map((s) => s.b).join("");
}

/**
 * 單字可用的搭配:「〜を します」型(單字本身在助詞前)只用於名詞單字;單字並列兩詞者
 * (治ります、直ります 與〔病気が〜〕〔故障が〜〕,無法確定哪個名詞配哪個字)整筆排除;
 * 扣掉同義也自然的助詞(ALSO_NATURAL)後湊不滿 3 個干擾項者不出題(ビデオに／を／で 撮ります)。
 */
export function collocationsOf(v: VocabItem): Collocation[] {
  if (surface(v.ruby).includes("、")) return [];
  const alsoNatural = alsoNaturalOf(v.id);
  return parseCollocations(v.note).filter(
    (c) =>
      (c.noun !== WORD_MARK || v.pos === "名") &&
      canMakeOptions(c.particle, alsoNatural),
  );
}

/**
 * 題目中的單字 ruby:教材以［お］標示可省略的前綴(［お］花見)。讀音(kana)含此前綴者顯示為
 * お(お花見、お祈り),不含者省略(仕事),題幹與朗讀一致
 */
function wordRuby(v: VocabItem): readonly RubySeg[] {
  const [first, ...rest] = v.ruby;
  const optional =
    first !== undefined && first.r === undefined
      ? /^［(.+)］$/.exec(first.b)
      : null;
  if (!optional) return v.ruby;
  return v.kana.startsWith(optional[1]) ? [{ b: optional[1] }, ...rest] : rest;
}

/**
 * 出題池:第 1–maxLesson 課有教材搭配、不是補充單字的字。不同課重列的同一個搭配
 * (表面文字忽略空格)只留最早的一筆。
 */
export function particlePool(
  lessons: readonly Lesson[],
  maxLesson: number,
): ParticleItem[] {
  const seen = new Set<string>();
  const pool: ParticleItem[] = [];
  for (const lesson of [...lessons].sort((a, b) => a.id - b.id)) {
    if (lesson.id > maxLesson) continue;
    for (const v of lesson.vocab) {
      if (isSupplementary(v)) continue;
      const collocations = collocationsOf(v);
      if (collocations.length === 0) continue;
      const key = collocations
        .map((c) => collocationSurface(c, wordRuby(v)))
        .join("|")
        .replace(/\s+/g, "");
      if (seen.has(key)) continue;
      seen.add(key);
      pool.push({ ...v, lessonId: lesson.id, collocations });
    }
  }
  return pool;
}

// ── 題目 ────────────────────────────────────────────────────────────

type Rng = () => number;

export interface ParticleQuestion {
  item: ParticleItem;
  collocation: Collocation;
  /** 題幹空格前(名詞)的 ruby:note 的名詞為純文字(並列假名時帶讀音),「〜」為單字本身的 ruby */
  before: RubySeg[];
  /** 題幹空格後(述語)的 ruby:單字本身的 ruby(+ note 的後續),或 note 的述語(します) */
  after: RubySeg[];
  answer: Particle;
  /** 4 個選項(PARTICLES 順序),正解恰一個 */
  options: Particle[];
}

/** note 的一段文字(〜 = 單字本身)→ ruby:〜 換成單字的 ruby,其餘為純文字 */
function partRuby(
  text: string,
  word: readonly RubySeg[],
  reading?: string,
): RubySeg[] {
  if (reading !== undefined) return [{ b: text, r: reading }];
  const out: RubySeg[] = [];
  text.split(WORD_MARK).forEach((piece, i) => {
    if (i > 0) out.push(...word.map((s) => ({ ...s })));
    if (piece !== "") out.push({ b: piece });
  });
  return out;
}

/** 搭配的表面文字(教材分かち書き:助詞後空一格):たばこを 吸います、宿題を します */
function collocationSurface(c: Collocation, word: readonly RubySeg[]): string {
  return `${surface(partRuby(c.noun, word, c.reading))}${c.particle} ${surface(partRuby(c.predicate, word))}`;
}

/**
 * 方向、到達點的 に/へ 常可互換(右へ／右に 曲がります):兩者算同一格,一題的選項中至多一個。
 * 一個是正解時另一個不當干擾項(不出兩個都對的題);都不是正解時也只出其一(兩個都出現時
 * 正解必非二者,等於刪掉兩個選項)
 */
function slotOf(p: Particle): Particle {
  return p === "へ" ? "に" : p;
}

/**
 * 教材搭配之外、同義也自然的助詞(依單字 id;寧缺勿錯):不當干擾項,不會把自然的說法判錯。
 * 只刪干擾項、不補搭配;扣掉後干擾項不足者不出題(collocationsOf)。資料測試驗證 id 與 note 一致
 */
export const ALSO_NATURAL: Readonly<Record<string, readonly Particle[]>> = {
  "L06-V011": ["と"], // ［友達に〜］会います:友達と 会います
  "L12-V014": ["で"], // 〔コーヒーが〜〕いい:コーヒーで いい
  "L13-V011": ["で"], // 〔公園を〜〕散歩します:公園で 散歩します
  "L19-V001": ["を"], // 〔山に〜〕登ります:山を 登ります
  "L23-V005": ["を"], // 〔ドアに〜〕触ります:ドアを 触ります
  "L32-V003": ["で"], // 〔試験に〜〕失敗します:試験で 失敗します
  "L34-V005": ["に"], // 〔しょうゆを〜〕つけます:しょうゆに つけます
  "L47-V002": ["と"], // 〔人が〜〕別れます:人と 別れます
  "L47-V035": ["に"], // 〔男性と〜〕比べます:男性に 比べます
  "L50-V027": ["を", "で"], // 〔ビデオに〜〕撮ります:ビデオを／で 撮ります(干擾項不足,不出題)
};

function alsoNaturalOf(id: string): readonly Particle[] {
  return ALSO_NATURAL[id] ?? [];
}

/** 干擾項候選:正解同格者(に/へ)與同義也自然者以外的助詞 */
function distractorCandidates(
  answer: Particle,
  alsoNatural: readonly Particle[],
): Particle[] {
  return PARTICLES.filter(
    (p) => slotOf(p) !== slotOf(answer) && !alsoNatural.includes(p),
  );
}

/** 湊得出 3 個不同格的干擾項 */
function canMakeOptions(
  answer: Particle,
  alsoNatural: readonly Particle[],
): boolean {
  const slots = new Set(distractorCandidates(answer, alsoNatural).map(slotOf));
  return slots.size >= PARTICLE_OPTION_COUNT - 1;
}

/** Fisher–Yates,以注入的 rng 取得確定性(測試)/隨機(執行期) */
function shuffle<T>(arr: readonly T[], rng: Rng): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * 選項:正解 + 以 rng 從其餘助詞抽 3 個(與正解同格的に/へ、同義也自然者不抽;に/へ 至多一個),
 * 依 PARTICLES 順序排列。候選不足時(呼叫端應先以 collocationsOf 排除)選項少於 4 個
 */
export function particleOptions(
  answer: Particle,
  rng: Rng,
  alsoNatural: readonly Particle[] = [],
): Particle[] {
  const slots = new Set<Particle>([slotOf(answer)]);
  const picked = new Set<Particle>([answer]);
  for (const p of shuffle(distractorCandidates(answer, alsoNatural), rng)) {
    if (picked.size >= PARTICLE_OPTION_COUNT) break;
    if (slots.has(slotOf(p))) continue;
    slots.add(slotOf(p));
    picked.add(p);
  }
  return PARTICLES.filter((p) => picked.has(p));
}

/** 出一題:教材並列多個搭配時以 rng 擇一 */
export function makeParticleQuestion(
  item: ParticleItem,
  rng: Rng = Math.random,
): ParticleQuestion {
  const { collocations } = item;
  const collocation =
    collocations.length > 1
      ? (collocations[Math.floor(rng() * collocations.length)] ??
        collocations[0])
      : collocations[0];
  const word = wordRuby(item);
  return {
    item,
    collocation,
    before: partRuby(collocation.noun, word, collocation.reading),
    after: partRuby(collocation.predicate, word),
    answer: collocation.particle,
    options: particleOptions(collocation.particle, rng, alsoNaturalOf(item.id)),
  };
}

export interface MakeParticleRoundOptions {
  count?: number;
  rng?: Rng;
}

/**
 * 一回合中〔〜を します〕型(單字本身在助詞前)至多幾題:這型答案幾乎都是「を」,且集中在前段
 * (第 1–14 課 32 個搭配中占 15 個),不設上限時容易整回合都是「〇〇（　）します」
 */
export const MAX_WORD_FIRST = 2;

/** 〔〜を します〕型:單字本身在助詞前 */
export function isWordFirst(item: ParticleItem): boolean {
  return item.collocations[0]?.noun === WORD_MARK;
}

/**
 * 出一回合:從出題池不重複抽 count 題(不足時為全部);〔〜を します〕型至多 MAX_WORD_FIRST 題,
 * 其他搭配不足時才補,補完再打亂一次(不集中在回合末尾)
 */
export function makeParticleRound(
  pool: readonly ParticleItem[],
  { count = PARTICLE_COUNT, rng = Math.random }: MakeParticleRoundOptions = {},
): ParticleQuestion[] {
  const picked: ParticleItem[] = [];
  const deferred: ParticleItem[] = [];
  let wordFirst = 0;
  for (const item of shuffle(pool, rng)) {
    if (picked.length >= count) break;
    if (isWordFirst(item)) {
      if (wordFirst >= MAX_WORD_FIRST) {
        deferred.push(item);
        continue;
      }
      wordFirst++;
    }
    picked.push(item);
  }
  picked.push(...deferred.slice(0, Math.max(0, count - picked.length)));
  return shuffle(picked, rng).map((item) => makeParticleQuestion(item, rng));
}

// ── 顯示與朗讀 ───────────────────────────────────────────────────────

/** 完整搭配的 ruby(回饋、錯題):名詞 + 助詞 + 空格 + 述語 */
export function collocationRuby(q: ParticleQuestion): RubySeg[] {
  return [...q.before, { b: `${q.answer} ` }, ...q.after];
}

/** 完整搭配的表面文字:たばこを 吸います */
export function collocationText(q: ParticleQuestion): string {
  return surface(collocationRuby(q));
}

/**
 * 朗讀用文字(交給 tts.ts 的 speechText 清除記號):單字本身用 kana(同單字朗讀),
 * note 的名詞有讀音用讀音、否則用表面文字
 */
export function collocationSpeech(q: ParticleQuestion): string {
  const { noun, reading, particle, predicate } = q.collocation;
  const word = q.item.kana;
  const nounText = reading ?? noun.split(WORD_MARK).join(word);
  return `${nounText}${particle} ${predicate.split(WORD_MARK).join(word)}`;
}

/** 回饋的中譯:note 有中譯(〔〜を します：做作業〕)用之,否則為單字釋義 */
export function collocationMeaning(q: ParticleQuestion): string {
  return q.collocation.gloss ?? q.item.meaning;
}
