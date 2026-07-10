import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach } from "vitest";
import { buildRouteEntries, collectPublicEntries } from "./precache-entries";

let tempDirs: string[] = [];

function makePublicDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "precache-entries-test-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
  tempDirs = [];
});

describe("collectPublicEntries", () => {
  it("遞迴收集檔案,url 為根相對路徑、revision 為內容 hash", () => {
    const dir = makePublicDir();
    mkdirSync(join(dir, "data/lessons"), { recursive: true });
    writeFileSync(join(dir, "data/index.json"), '{"lessons":[]}');
    writeFileSync(join(dir, "data/lessons/L01.json"), '{"id":1}');

    const entries = collectPublicEntries(dir);
    const urls = entries.map((e) => e.url).sort();

    expect(urls).toEqual(["/data/index.json", "/data/lessons/L01.json"]);
    for (const entry of entries) {
      expect(entry.revision).toMatch(/^[0-9a-f]+$/);
    }
  });

  it("相同內容 → 相同 revision;內容不同 → 不同 revision", () => {
    const dir = makePublicDir();
    mkdirSync(join(dir, "data"), { recursive: true });
    writeFileSync(join(dir, "data/a.json"), '{"x":1}');
    writeFileSync(join(dir, "data/b.json"), '{"x":1}');
    writeFileSync(join(dir, "data/c.json"), '{"x":2}');

    const byUrl = new Map(collectPublicEntries(dir).map((e) => [e.url, e.revision]));

    expect(byUrl.get("/data/a.json")).toBe(byUrl.get("/data/b.json"));
    expect(byUrl.get("/data/a.json")).not.toBe(byUrl.get("/data/c.json"));
  });

  it("排除 service worker 產物(sw.js、sw.js.map、swe-worker-*.js)", () => {
    const dir = makePublicDir();
    mkdirSync(join(dir, "data"), { recursive: true });
    writeFileSync(join(dir, "sw.js"), "// sw");
    writeFileSync(join(dir, "sw.js.map"), "{}");
    writeFileSync(join(dir, "swe-worker-abc123.js"), "// swe");
    writeFileSync(join(dir, "data/keep.json"), "{}");

    const urls = collectPublicEntries(dir).map((e) => e.url);

    expect(urls).toEqual(["/data/keep.json"]);
  });

  it("排除 Cloudflare Pages 平台檔(_headers、_redirects;僅根層,平台不供應)", () => {
    const dir = makePublicDir();
    mkdirSync(join(dir, "data"), { recursive: true });
    writeFileSync(join(dir, "_headers"), "/*\n  X-Robots-Tag: noindex\n");
    writeFileSync(join(dir, "_redirects"), "");
    writeFileSync(join(dir, "data/keep.json"), "{}");

    const urls = collectPublicEntries(dir).map((e) => e.url);

    expect(urls).toEqual(["/data/keep.json"]);
  });
});

describe("buildRouteEntries", () => {
  it("涵蓋固定頁面與每課的 lessons / quiz 路由", () => {
    const urls = buildRouteEntries([1, 2], "rev1").map((e) => e.url);

    for (const expected of ["/", "/lessons", "/review", "/practice", "/stats", "/settings", "/quiz", "/lessons/1", "/lessons/2", "/quiz/1", "/quiz/2"]) {
      expect(urls).toContain(expected);
    }
  });

  it("每個路由都附帶 .txt RSC payload 條目(/ 對應 /index.txt)", () => {
    const urls = buildRouteEntries([1], "rev1").map((e) => e.url);

    for (const expected of ["/index.txt", "/lessons.txt", "/review.txt", "/stats.txt", "/settings.txt", "/quiz.txt", "/lessons/1.txt", "/quiz/1.txt"]) {
      expect(urls).toContain(expected);
    }
  });

  it("條目數 =(固定 7 頁 + 每課 2 頁)× 2,且全部使用指定 revision", () => {
    const entries = buildRouteEntries([1, 2, 3], "build-abc");

    expect(entries).toHaveLength((7 + 3 * 2) * 2);
    for (const entry of entries) {
      expect(entry.revision).toBe("build-abc");
    }
  });
});
