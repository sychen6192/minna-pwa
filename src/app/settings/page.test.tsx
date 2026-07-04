import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, vi } from "vitest";
import { BACKUP_VERSION } from "@/lib/backup";
import { DEFAULT_SETTINGS, db, getSetting } from "@/lib/db";
import SettingsPage from "./page";

const sampleCard = {
  cardId: "L01-V001",
  lessonId: 1,
  type: "vocab" as const,
  due: 1,
  stability: 1,
  difficulty: 5,
  reps: 1,
  lapses: 0,
  state: 2 as const,
};

function backupFile(overrides: Record<string, unknown> = {}): File {
  const content = JSON.stringify({
    version: BACKUP_VERSION,
    exportedAt: "2026-07-01T00:00:00.000Z",
    cards: [sampleCard],
    logs: [],
    progress: [],
    settings: [{ key: "newPerDay", value: 7 }],
    ...overrides,
  });
  return new File([content], "minna-backup.json", { type: "application/json" });
}

beforeEach(async () => {
  await Promise.all([
    db.cards.clear(),
    db.logs.clear(),
    db.progress.clear(),
    db.settings.clear(),
  ]);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("SettingsPage 學習設定(F6.1)", () => {
  it("變更 furigana 預設即寫入 DB", async () => {
    const user = userEvent.setup();
    render(<SettingsPage />);
    const select = await screen.findByLabelText("Furigana 預設");

    await user.selectOptions(select, "hide");

    expect(await getSetting("furigana")).toBe("hide");
  });

  it("變更每日新卡上限即寫入 DB", async () => {
    const user = userEvent.setup();
    render(<SettingsPage />);
    const input = await screen.findByLabelText("每日新卡上限");

    await user.clear(input);
    await user.type(input, "25");

    expect(await getSetting("newPerDay")).toBe(25);
  });
});

describe("SettingsPage 重置(F6.3)", () => {
  it("需雙重確認:第一次點擊不執行,確認後清空並回填預設", async () => {
    await db.cards.put(sampleCard);
    const user = userEvent.setup();
    render(<SettingsPage />);

    await user.click(await screen.findByRole("button", { name: "重置所有進度" }));
    expect(await db.cards.count()).toBe(1); // 尚未執行
    expect(screen.getByText(/無法復原/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "確定重置" }));

    expect(await screen.findByText(/已重置/)).toBeInTheDocument();
    expect(await db.cards.count()).toBe(0);
    expect(await db.settings.count()).toBe(Object.keys(DEFAULT_SETTINGS).length);
  });
});

describe("SettingsPage 匯入(F6.2)", () => {
  it("選檔後顯示摘要,確認覆蓋才寫入", async () => {
    const user = userEvent.setup();
    render(<SettingsPage />);

    await user.upload(await screen.findByLabelText("選擇備份檔"), backupFile());

    // 摘要(尚未寫入)
    expect(await screen.findByText(/1 張卡片/)).toBeInTheDocument();
    expect(await db.cards.count()).toBe(0);

    await user.click(screen.getByRole("button", { name: "確認覆蓋" }));

    expect(await screen.findByText(/匯入完成/)).toBeInTheDocument();
    expect(await db.cards.toArray()).toEqual([sampleCard]);
    expect(await getSetting("newPerDay")).toBe(7);
  });

  it("version 不符:顯示錯誤且不寫入", async () => {
    const user = userEvent.setup();
    render(<SettingsPage />);

    await user.upload(
      await screen.findByLabelText("選擇備份檔"),
      backupFile({ version: 99 }),
    );

    expect(await screen.findByText(/版本不符/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "確認覆蓋" })).not.toBeInTheDocument();
    expect(await db.cards.count()).toBe(0);
  });
});

describe("SettingsPage 匯出(F6.2)", () => {
  it("點匯出:以 Blob 觸發下載", async () => {
    const createObjectURL = vi.fn<(blob: Blob) => string>(() => "blob:mock");
    const revokeObjectURL = vi.fn();
    // 以獨立 stub 物件取代,不可 Object.assign 真的 URL(會永久污染其他測試)
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });

    const user = userEvent.setup();
    render(<SettingsPage />);

    await user.click(await screen.findByRole("button", { name: "匯出備份" }));

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(createObjectURL.mock.calls[0][0]).toBeInstanceOf(Blob);
  });
});
