import { afterEach, vi } from "vitest";
import { revealAboveNav } from "./scroll";

/** jsdom 不排版:以 mock 給定元素的下緣(視窗座標)與 scroll-margin-bottom */
function element(bottom: number, scrollMarginBottom: string): HTMLElement {
  const el = document.createElement("button");
  el.style.scrollMarginBottom = scrollMarginBottom;
  el.getBoundingClientRect = () =>
    DOMRect.fromRect({ y: bottom - 48, height: 48 });
  document.body.append(el);
  return el;
}

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe("revealAboveNav", () => {
  it("被底部導覽列(scroll-margin-bottom)擋住時往下捲出被擋的部分", () => {
    const scrollTo = vi.fn();
    vi.stubGlobal("scrollTo", scrollTo);
    const nav = 64;
    // 下緣在導覽列上緣之下 36px(仍在視窗內:Chromium 聚焦時不會捲)
    revealAboveNav(element(window.innerHeight - nav + 36, `${nav}px`));
    expect(scrollTo).toHaveBeenCalledExactlyOnceWith({
      top: window.scrollY + 36,
    });
  });

  it("完整露出(或恰好貼齊導覽列)時不捲", () => {
    const scrollTo = vi.fn();
    vi.stubGlobal("scrollTo", scrollTo);
    revealAboveNav(element(window.innerHeight - 64, "64px"));
    revealAboveNav(element(100, "64px"));
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("沒有 scroll-margin 時以視窗下緣為準", () => {
    const scrollTo = vi.fn();
    vi.stubGlobal("scrollTo", scrollTo);
    revealAboveNav(element(window.innerHeight + 10, ""));
    expect(scrollTo).toHaveBeenCalledExactlyOnceWith({
      top: window.scrollY + 10,
    });
  });
});
