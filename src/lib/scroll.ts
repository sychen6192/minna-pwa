/** 捲入畫面(聚焦、revealAboveNav)時讓出固定的底部導覽列(4rem + safe-area)的 scroll-margin */
export const BOTTOM_NAV_SCROLL_MARGIN =
  "scroll-mb-[calc(4rem_+_env(safe-area-inset-bottom))]";

/**
 * 元素被固定的底部導覽列擋住(長句在小螢幕上把「下一題」推到導覽列下)時往下捲,
 * 讓出它的 scroll-margin-bottom(BOTTOM_NAV_SCROLL_MARGIN);沒被擋住則不捲。
 * 不靠聚焦或 scrollIntoView({ block: "nearest" }):Chromium 只看元素本身是否在視窗內,
 * 被導覽列擋住(仍在視窗內)時不會捲動(同課程頁会話的 scrollIntoViewNearest)。
 */
export function revealAboveNav(el: HTMLElement): void {
  const margin = parseFloat(getComputedStyle(el).scrollMarginBottom) || 0;
  const hidden =
    el.getBoundingClientRect().bottom - (window.innerHeight - margin);
  if (hidden > 0) window.scrollTo({ top: window.scrollY + hidden });
}
