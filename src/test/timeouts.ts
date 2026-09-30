/**
 * 全教材資料迴圈等較久的測試(單獨數秒):`pnpm verify` 平行跑或機器忙時超過 vitest 預設的 5 秒,
 * 以此放寬(it 的第三個參數)。
 */
export const SLOW_TEST_TIMEOUT = 60_000;
