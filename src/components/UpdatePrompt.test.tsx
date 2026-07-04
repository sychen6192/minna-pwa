import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { UpdatePrompt, type SerwistLike } from "./UpdatePrompt";

/** 最小可用的假 serwist(@serwist/window)事件目標 */
function createFakeSerwist() {
  const listeners = new Map<string, Set<(event: unknown) => void>>();
  const fake = {
    addEventListener: vi.fn((type: string, cb: (event: unknown) => void) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)?.add(cb);
    }),
    removeEventListener: vi.fn((type: string, cb: (event: unknown) => void) => {
      listeners.get(type)?.delete(cb);
    }),
    messageSkipWaiting: vi.fn(),
    emit(type: string) {
      for (const cb of listeners.get(type) ?? []) cb({ type });
    },
  };
  return fake;
}

const asSerwist = (fake: ReturnType<typeof createFakeSerwist>) =>
  fake as unknown as SerwistLike;

describe("UpdatePrompt 更新提示", () => {
  it("window.serwist 不存在(dev / 不支援):不渲染、不 crash", () => {
    render(<UpdatePrompt getSerwist={() => undefined} reload={vi.fn()} />);

    expect(screen.queryByRole("region", { name: "更新提示" })).not.toBeInTheDocument();
  });

  it("初始為隱藏;waiting 事件後顯示「新版本」提示", async () => {
    const fake = createFakeSerwist();
    render(<UpdatePrompt getSerwist={() => asSerwist(fake)} reload={vi.fn()} />);

    expect(screen.queryByRole("region", { name: "更新提示" })).not.toBeInTheDocument();

    act(() => fake.emit("waiting"));

    expect(await screen.findByRole("region", { name: "更新提示" })).toBeInTheDocument();
    expect(screen.getByText(/新版本/)).toBeInTheDocument();
  });

  it("點「立即更新」:送出 SKIP_WAITING,controlling 後執行 reload", async () => {
    const user = userEvent.setup();
    const fake = createFakeSerwist();
    const reload = vi.fn();
    render(<UpdatePrompt getSerwist={() => asSerwist(fake)} reload={reload} />);
    act(() => fake.emit("waiting"));
    await screen.findByRole("region", { name: "更新提示" });

    await user.click(screen.getByRole("button", { name: "立即更新" }));

    expect(fake.messageSkipWaiting).toHaveBeenCalledTimes(1);
    expect(reload).not.toHaveBeenCalled(); // 尚未接管,不能先 reload

    act(() => fake.emit("controlling"));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("點「稍後」:提示隱藏(本次載入不再顯示,不持久化)", async () => {
    const user = userEvent.setup();
    const fake = createFakeSerwist();
    render(<UpdatePrompt getSerwist={() => asSerwist(fake)} reload={vi.fn()} />);
    act(() => fake.emit("waiting"));
    await screen.findByRole("region", { name: "更新提示" });

    await user.click(screen.getByRole("button", { name: "稍後" }));

    expect(screen.queryByRole("region", { name: "更新提示" })).not.toBeInTheDocument();
  });

  it("unmount:移除 waiting 監聽,不遺留 listener", () => {
    const fake = createFakeSerwist();
    const { unmount } = render(
      <UpdatePrompt getSerwist={() => asSerwist(fake)} reload={vi.fn()} />,
    );

    unmount();

    expect(fake.removeEventListener).toHaveBeenCalledWith("waiting", expect.any(Function));
  });
});
