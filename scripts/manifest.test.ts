import { readFileSync } from "node:fs";
import { join } from "node:path";

const publicDir = join(process.cwd(), "public");

interface ManifestIcon {
  src: string;
  sizes: string;
  type: string;
  purpose?: string;
}

function readManifest(): {
  name: string;
  short_name: string;
  start_url: string;
  id: string;
  display: string;
  theme_color: string;
  background_color: string;
  icons: ManifestIcon[];
} {
  return JSON.parse(readFileSync(join(publicDir, "manifest.json"), "utf-8"));
}

/** 讀 PNG IHDR(signature 8 bytes + chunk length/type 8 bytes → width/height 各 4 bytes) */
function pngSize(path: string): { width: number; height: number } {
  const buf = readFileSync(path);
  expect(buf.subarray(1, 4).toString("ascii")).toBe("PNG");
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

describe("manifest.json", () => {
  it("含 Chrome 安裝必要欄位:name、standalone、start_url、id", () => {
    const manifest = readManifest();
    expect(manifest.name).toBeTruthy();
    expect(manifest.short_name).toBeTruthy();
    expect(manifest.display).toBe("standalone");
    expect(manifest.start_url).toBe("/");
    expect(manifest.id).toBe("/");
    expect(manifest.theme_color).toMatch(/^#[0-9a-fA-F]{6}$/);
    expect(manifest.background_color).toMatch(/^#[0-9a-fA-F]{6}$/);
  });

  it("icons 宣告涵蓋 192 與 512(any)以及 512 maskable", () => {
    const icons = readManifest().icons;
    const bySizePurpose = (size: string, purpose: string) =>
      icons.find((i) => i.sizes === size && (i.purpose ?? "any") === purpose);

    expect(bySizePurpose("192x192", "any")).toBeDefined();
    expect(bySizePurpose("512x512", "any")).toBeDefined();
    expect(bySizePurpose("512x512", "maskable")).toBeDefined();
  });
});

describe("icon 檔案", () => {
  it("manifest 宣告的每個 icon 檔案存在,且 PNG 實際尺寸與宣告一致", () => {
    for (const icon of readManifest().icons) {
      const [w, h] = icon.sizes.split("x").map(Number);
      const actual = pngSize(join(publicDir, icon.src));
      expect(actual, icon.src).toEqual({ width: w, height: h });
    }
  });

  it("apple-touch-icon 為 180×180", () => {
    expect(pngSize(join(publicDir, "icons/apple-touch-icon.png"))).toEqual({
      width: 180,
      height: 180,
    });
  });
});
