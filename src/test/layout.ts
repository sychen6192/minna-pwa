import { vi } from "vitest";

/**
 * jsdom 不排版:textContent 為 `text` 的元素下緣在視窗下緣之下 `px`(被固定的底部導覽列擋住),
 * 其餘元素在畫面頂端。回傳 window.scrollTo 的 mock 與還原函式(在 finally 呼叫)。
 */
export function coverByBottomNav(
  text: string,
  px = 40,
): { scrollTo: ReturnType<typeof vi.fn>; restore: () => void } {
  const scrollTo = vi.fn();
  vi.stubGlobal("scrollTo", scrollTo);
  const rect = vi
    .spyOn(HTMLElement.prototype, "getBoundingClientRect")
    .mockImplementation(function (this: HTMLElement) {
      const bottom = this.textContent === text ? window.innerHeight + px : 0;
      return DOMRect.fromRect({ y: bottom - 48, height: 48 });
    });
  return {
    scrollTo,
    restore: () => {
      rect.mockRestore();
      vi.unstubAllGlobals();
    },
  };
}
