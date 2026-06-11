// jest-dom 斷言(toBeInTheDocument 等)並擴充 vitest 的 expect 型別
import "@testing-library/jest-dom/vitest";
// 為 IndexedDB 相關測試提供記憶體實作(CLAUDE.md 測試方針)
import "fake-indexeddb/auto";
