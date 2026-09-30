import { useLayoutEffect, useRef, type MouseEvent, type RefObject } from "react";

/**
 * 換題、作答、進結果頁後的點擊防護時間:雙擊時第二下會落在剛換到同一位置的鈕上
 * (「下一題」→ 新題的選項、「看結果」→ 結果頁的「再練一次」),此時間內忽略
 * (測驗、活用/助詞練習、例句重組、複習頁共用)
 */
export const TAP_GUARD_MS = 300;

/** 距 `since`(Date.now() 的時刻)還不到 TAP_GUARD_MS */
export function tapGuarded(since: number): boolean {
  return Date.now() - since < TAP_GUARD_MS;
}

/**
 * 掛載時刻(點擊防護的起點);作答等元件內的變化可再寫入 `.current = Date.now()` 重新起算。
 * 以 useLayoutEffect 記下:與新畫面的 DOM 在同一個 commit,早於任何能點到新畫面的事件。
 * useEffect 在非同步更新(載入完成)後的掛載會另排一個 task 執行,可能晚於第一個點擊才記下,
 * 把該點擊之後的時刻當成起點。
 */
export function useShownAt(): RefObject<number> {
  const shownAt = useRef(0);
  useLayoutEffect(() => {
    shownAt.current = Date.now();
  }, []);
  return shownAt;
}

/**
 * 結果頁等整頁的進場防護:掛在外層的 onClickCapture,掛載後 TAP_GUARD_MS 內的點擊
 * 不觸發任何按鈕與連結(capture 階段攔下:preventDefault 擋掉 <a> 的導覽、
 * stopPropagation 擋掉 onClick)。
 */
export function useEntryClickGuard(): (e: MouseEvent) => void {
  const shownAt = useShownAt();
  return (e: MouseEvent) => {
    if (tapGuarded(shownAt.current)) {
      e.preventDefault();
      e.stopPropagation();
    }
  };
}
