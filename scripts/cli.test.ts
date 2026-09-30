import { spawnSync } from "node:child_process";
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { SLOW_TEST_TIMEOUT } from "../src/test/timeouts";
import { inFile, isMain } from "./lib/cli";

// 內容腳本的 CLI 行為(結束碼、錯誤訊息、--check 不寫檔)以子行程實跑驗證:純函式的單元測試
// 測不到 main。寫入模式只在暫存目錄的資料副本上執行,不動 repo 的 public/data。
const ROOT = process.cwd();
const TSX = join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");
const tmp = mkdtempSync(join(tmpdir(), "minna-cli-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const run = (script: string, args: readonly string[], cwd: string) => {
  const r = spawnSync(process.execPath, [TSX, script, ...args], {
    cwd,
    encoding: "utf8",
  });
  return { status: r.status, out: r.stdout, err: r.stderr };
};

/** 真實 public/data 的副本(寫入模式與注入錯誤用) */
const copyData = (name: string) => {
  const dir = join(tmp, name);
  cpSync(join(ROOT, "public", "data"), join(dir, "public", "data"), {
    recursive: true,
  });
  return dir;
};
const lessonFile = (dir: string, tag: string) =>
  join(dir, "public", "data", "lessons", `${tag}.json`);

describe("isMain / inFile", () => {
  it("isMain 比對真實路徑:經 symlink 的進入點仍判定為直接執行;其他檔、無 argv 或非 file: URL 為否", () => {
    const dir = join(tmp, "is-main");
    cpSync(join(ROOT, "scripts", "lib", "cli.ts"), join(dir, "real", "a.ts"));
    symlinkSync(join(dir, "real"), join(dir, "link"));
    const url = pathToFileURL(join(dir, "real", "a.ts")).href;
    expect(isMain(url, join(dir, "real", "a.ts"))).toBe(true);
    expect(isMain(url, join(dir, "link", "a.ts"))).toBe(true);
    expect(isMain(url, join(dir, "real", "b.ts"))).toBe(false);
    expect(isMain(url, undefined)).toBe(false);
    expect(isMain("data:text/javascript,1", join(dir, "real", "a.ts"))).toBe(
      false,
    );
  });

  it("inFile:錯誤訊息前加上檔名;成功時原樣回傳", () => {
    expect(inFile("L15.json", () => 1)).toBe(1);
    expect(() =>
      inFile("public/data/lessons/L15.json", () => {
        throw new Error("第 3 行有誤");
      }),
    ).toThrow("public/data/lessons/L15.json:第 3 行有誤");
  });
});

describe("經 symlink 路徑執行(進入點與 import.meta.url 寫法不同)仍會跑 main", () => {
  const link = join(tmp, "repo-link");
  symlinkSync(ROOT, link);

  it(
    "validate:content、fix:content --check、normalize:zh-punct --check 皆印出報告",
    () => {
      const v = run(join(link, "scripts", "validate-content.ts"), [], ROOT);
      expect(v.status).toBe(0);
      expect(v.out).toMatch(/(\d+)\/\1 檔通過驗證/);
      expect(v.out).toContain("✓ content-lint:error");
      const f = run(join(link, "scripts", "fix-content.ts"), ["--check"], ROOT);
      expect(f.status).toBe(0);
      expect(f.out).toMatch(/全部 \d+ 筆修正皆已套用,沒有變動/);
      const n = run(
        join(link, "scripts", "normalize-zh-punct.ts"),
        ["--check"],
        ROOT,
      );
      expect(n.status).toBe(0);
      expect(n.out).toMatch(/中文值 \d+ 筆皆已正規化,沒有變動/);
    },
    SLOW_TEST_TIMEOUT,
  );
});

describe("結束碼與錯誤訊息(資料副本)", () => {
  it(
    "中文半形標點:validate:content 與 normalize --check exit 1 且不寫檔;寫入後逐位元復原、驗證通過",
    () => {
      const dir = copyData("zh-punct");
      const file = lessonFile(dir, "L01");
      const original = readFileSync(file, "utf8");
      // 兩側非空白、非數字的「，」:改回半形後 R1 必轉回、R6 不刪空白,寫入後應逐位元復原
      const broken = original.replace(
        /("translation": "[^"\n]*?[^\s\d])，(?=[^\s\d])/,
        "$1,",
      );
      expect(broken).not.toBe(original);
      writeFileSync(file, broken, "utf8");

      const v = run(join(ROOT, "scripts", "validate-content.ts"), [], dir);
      expect(v.status).toBe(1);
      expect(v.out).toContain("✗ [zh-punct] 1 筆");
      const check = run(
        join(ROOT, "scripts", "normalize-zh-punct.ts"),
        ["--check"],
        dir,
      );
      expect(check.status).toBe(1);
      expect(check.out).toMatch(/待正規化 1\/\d+ 筆\(1 個檔\)/);
      expect(readFileSync(file, "utf8")).toBe(broken);

      const write = run(
        join(ROOT, "scripts", "normalize-zh-punct.ts"),
        [],
        dir,
      );
      expect(write.status).toBe(0);
      expect(readFileSync(file, "utf8")).toBe(original);
      expect(
        run(join(ROOT, "scripts", "validate-content.ts"), [], dir).status,
      ).toBe(0);
    },
    SLOW_TEST_TIMEOUT,
  );

  it(
    "Zod 失敗:validate:content exit 1 並略過 content-lint;兩個寫入腳本 exit 1,錯誤訊息指出檔名與欄位路徑、不寫檔",
    () => {
      const dir = copyData("zod");
      const file = lessonFile(dir, "L15");
      const broken = readFileSync(file, "utf8").replace(
        /"pos": "名"/,
        '"pos": "名詞"',
      );
      writeFileSync(file, broken, "utf8");

      const v = run(join(ROOT, "scripts", "validate-content.ts"), [], dir);
      expect(v.status).toBe(1);
      expect(v.err).toContain("✗ public/data/lessons/L15.json");
      expect(v.err).toContain("略過 content-lint");
      expect(v.out).not.toContain("content-lint:error");

      for (const script of ["normalize-zh-punct.ts", "fix-content.ts"]) {
        const r = run(join(ROOT, "scripts", script), [], dir);
        expect(r.status, script).toBe(1);
        expect(r.err, script).toMatch(
          /^public\/data\/lessons\/L15\.json:不符 LessonSchema:vocab\.\d+\.pos:/,
        );
      }
      expect(readFileSync(file, "utf8")).toBe(broken);
    },
    SLOW_TEST_TIMEOUT,
  );

  it(
    "JSON 語法錯誤:fix:content --check 的錯誤訊息指出檔名",
    () => {
      const dir = copyData("json");
      const file = lessonFile(dir, "L41");
      writeFileSync(
        file,
        readFileSync(file, "utf8").replace('"id": 41,', '"id": 41,,'),
        "utf8",
      );
      const r = run(join(ROOT, "scripts", "fix-content.ts"), ["--check"], dir);
      expect(r.status).toBe(1);
      expect(r.err).toMatch(/^public\/data\/lessons\/L41\.json:JSON 解析失敗:/);
    },
    SLOW_TEST_TIMEOUT,
  );
});
