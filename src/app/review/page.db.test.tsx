// 複習頁 × 真實 srs/db(fake-indexeddb):驗證 session 內重看與復原對 logs 的實際影響(T10.3)
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { db } from "@/lib/db";
import { addCards } from "@/lib/srs";
import type { Lesson } from "@/schemas/lesson";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
  }: {
    href: string;
    children: React.ReactNode;
  }) => <a href={href}>{children}</a>,
}));

const lesson: Lesson = {
  id: 13,
  title: "〜が ほしいです",
  vocab: [
    {
      id: "L13-V001",
      ruby: [{ b: "遊", r: "あそ" }, { b: "びます" }],
      kana: "あそびます",
      meaning: "玩、遊玩",
      pos: "動I",
    },
    {
      id: "L13-V002",
      ruby: [{ b: "ほしい" }],
      kana: "ほしい",
      meaning: "想要",
      pos: "い形",
    },
  ],
  grammar: [],
  dialogues: [],
};
vi.mock("@/lib/content", () => ({ getLesson: async () => lesson }));
vi.mock("@/lib/tts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tts")>()),
  speak: () => {},
}));

import ReviewPage from "./page";

beforeEach(async () => {
  await Promise.all([db.cards.clear(), db.logs.clear(), db.settings.clear()]);
  await addCards(["L13-V001", "L13-V002"], 13);
});

const key = (k: string) =>
  fireEvent.keyDown(window, k === " " ? { code: "Space" } : { key: k });

/**
 * 在 act 內讀 DB:讀取期間頁面仍可能因非同步載入(預估間隔、結算資料)而更新,
 * 包在 act 內才不會有「not wrapped in act」警告。
 */
const inAct = <T,>(read: () => Promise<T>): Promise<T> => act(read);

describe("ReviewPage × DB", () => {
  it("重來後重看項只曝光:整個 session 只有兩筆 log(每張一般卡一筆)", async () => {
    render(<ReviewPage />);
    await screen.findByText("1 / 2");
    key(" ");
    key("1");
    expect(await screen.findByText("2 / 3")).toBeInTheDocument();
    expect(await inAct(() => db.logs.count())).toBe(1);

    key(" ");
    key("3");
    expect(await screen.findByText("3 / 3")).toBeInTheDocument();
    key(" ");
    await screen.findByRole("button", { name: "記住了" });
    key("3");
    expect(await screen.findByText("本次複習結算")).toBeInTheDocument();
    expect(await inAct(() => db.logs.count())).toBe(2);
    expect((await inAct(() => db.logs.toArray())).map((l) => [l.cardId, l.rating])).toEqual([
      ["L13-V001", 1],
      ["L13-V002", 3],
    ]);
  });

  it("復原評分:卡片與 logs 還原,回到上一張已翻面", async () => {
    const before = await db.cards.get("L13-V001");
    const user = userEvent.setup();
    render(<ReviewPage />);
    await screen.findByText("1 / 2");
    key(" ");
    key("4");
    expect(await screen.findByText("2 / 2")).toBeInTheDocument();
    expect(await inAct(() => db.logs.count())).toBe(1);

    await user.click(screen.getByRole("button", { name: "復原" }));
    expect(await screen.findByText("1 / 2")).toBeInTheDocument();
    expect(screen.getByText("玩、遊玩")).toBeInTheDocument();
    expect(await inAct(() => db.logs.count())).toBe(0);
    expect(await inAct(() => db.cards.get("L13-V001"))).toEqual(before);
  });

  it("略過與復原:兩個方向一併暫停/恢復", async () => {
    await db.settings.put({ key: "reverseCards", value: true });
    await addCards(["L13-V001"], 13); // 補建 L13-V001@r
    const user = userEvent.setup();
    render(<ReviewPage />);
    await screen.findByText("1 / 2");
    key(" ");
    await user.click(await screen.findByRole("button", { name: "已會·略過" }));
    await screen.findByText("2 / 2");
    const suspended = async () =>
      (await inAct(() => db.cards.bulkGet(["L13-V001", "L13-V001@r"]))).map(
        (c) => c?.suspended,
      );
    expect(await suspended()).toEqual([true, true]);

    await user.click(screen.getByRole("button", { name: "復原" }));
    await screen.findByText("1 / 2");
    await act(async () => {});
    expect(await suspended()).toEqual([false, false]);
  });
});
