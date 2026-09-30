/**
 * 課程 JSON 的手術式替換:scripts/fix-content.ts 使用,T12.6 的 normalize-zh-punct 共用。
 *
 * 課程檔排版不一(ruby 陣列有單行與逐段換行兩種),任何序列化器都只能逐位元重現 5/50 檔,
 * 所以不得以 JSON.stringify 或 prettier 整檔重寫:以行為單位定位物件,只替換目標
 * `"key": "value"`,其餘位元不動。本模組只保證「恰好一處」;呼叫端須在寫入前重新 parse,
 * 與預期模型核對。
 */

/** 物件的行範圍(含首尾):open 為「{」行(可帶 key,如 `"dialogueTitle": {`),close 為「}」或「},」行 */
export interface ObjectSpan {
  open: number;
  close: number;
}

const OPEN_RE = /^(\s*)(?:"[^"\\]*": )?\{$/;

/** 自物件開頭行起算範圍:結尾為第一個同縮排的「}」或「},」 */
export function objectSpanAt(
  lines: readonly string[],
  open: number,
): ObjectSpan {
  const line = lines[open] ?? "";
  // 以「\n」切行後 CRLF 檔的每行尾端留有 \r,開頭與結尾都比對不到:明確指出換行格式
  if (line.endsWith("\r")) {
    throw new Error(`第 ${open + 1} 行以 CR 結尾:課程檔為 CRLF 換行,請轉為 LF`);
  }
  const m = OPEN_RE.exec(line);
  if (!m) throw new Error(`第 ${open + 1} 行不是物件開頭「{」`);
  const indent = m[1];
  for (let i = open + 1; i < lines.length; i++) {
    if (lines[i] === `${indent}}` || lines[i] === `${indent}},`) {
      return { open, close: i };
    }
  }
  throw new Error(`第 ${open + 1} 行的物件找不到結尾`);
}

/** 以唯一的 `"id": "<id>",` 行定位物件(前一行須為物件開頭「{」) */
export function findObjectById(
  lines: readonly string[],
  id: string,
): ObjectSpan {
  const idLine = `"id": ${JSON.stringify(id)},`;
  const hits = lines.flatMap((line, i) => (line.trim() === idLine ? [i] : []));
  if (hits.length !== 1) {
    throw new Error(`${id}:id 行有 ${hits.length} 處(應恰為 1)`);
  }
  if (hits[0] === 0) throw new Error(`${id}:id 行前沒有物件開頭「{」`);
  return objectSpanAt(lines, hits[0] - 1);
}

/** `"key": <JSON 字串>`:與課程檔的字串編碼一致(非 ASCII 原樣,「"」「\」跳脫) */
export const stringToken = (key: string, value: string) =>
  `${JSON.stringify(key)}: ${JSON.stringify(value)}`;

/**
 * 把範圍內恰好一處的 `"key": JSON.stringify(from)` 換成 to,回傳所在行號。
 * 0 處或多處即丟錯(不猜);範圍外、同一行的其他文字都不動。
 */
export function replaceStringValue(
  lines: string[],
  span: ObjectSpan,
  key: string,
  from: string,
  to: string,
): number {
  const needle = stringToken(key, from);
  const hits: number[] = [];
  for (let i = span.open; i <= span.close; i++) {
    const count = lines[i].split(needle).length - 1;
    for (let k = 0; k < count; k++) hits.push(i);
  }
  if (hits.length !== 1) {
    throw new Error(
      `${needle} 在第 ${span.open + 1}–${span.close + 1} 行有 ${hits.length} 處(應恰為 1)`,
    );
  }
  const at = hits[0];
  // 以函式回傳替換字串:to 含 $& 之類時不被當成替換樣式
  lines[at] = lines[at].replace(needle, () => stringToken(key, to));
  return at;
}
