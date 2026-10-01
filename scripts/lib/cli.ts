/**
 * 內容腳本(scripts/*.ts)的 CLI 共用:「直接執行才跑 main」的判斷與錯誤訊息標上檔名。
 */
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** 真實路徑;檔案不存在(或 URL 不是 file:)時為 undefined */
const realpath = (path: () => string): string | undefined => {
  try {
    return realpathSync(path());
  } catch {
    return undefined;
  }
};

/**
 * metaUrl(呼叫端的 import.meta.url)是否為本次執行的進入點 argv1(測試 import 純函式時為否)。
 *
 * 不可比對 `import.meta.url === pathToFileURL(process.argv[1]).href`:import.meta.url 是解析
 * symlink 後的真實路徑,argv[1] 卻保留呼叫時的寫法,經 symlink 路徑執行時兩者不等,main
 * 靜默不跑且 exit 0(--check 與驗證關卡形同放行)。兩邊都取真實路徑再比對。
 */
export function isMain(
  metaUrl: string,
  argv1: string | undefined = process.argv[1],
): boolean {
  if (argv1 === undefined) return false;
  const entry = realpath(() => argv1);
  return (
    entry !== undefined && entry === realpath(() => fileURLToPath(metaUrl))
  );
}

/** 執行 fn;丟錯時訊息前加上檔名(「public/data/lessons/L15.json:…」),指出是哪個檔出錯 */
export function inFile<T>(file: string, fn: () => T): T {
  try {
    return fn();
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    throw new Error(`${file}:${message}`, { cause: e });
  }
}
