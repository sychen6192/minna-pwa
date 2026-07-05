# Lighthouse 報告(T6.4 PWA 驗收)

執行日期:2026-07-04;對象:`pnpm build` 產物經本地靜態伺服器(clean-URL,等同 Cloudflare Pages 行為)。

## lighthouse11-pwa.json — PWA 類別(lighthouse@11.7.1)

> Lighthouse 12 起移除 PWA 類別,以最後支援該類別的 v11 執行(SPEC N2 註記)。

**PWA score:1.0(滿分)**

| Audit | 結果 |
|---|---|
| installable-manifest | ✓ |
| splash-screen | ✓ |
| themed-omnibox | ✓ |
| content-width | ✓ |
| viewport | ✓ |
| maskable-icon | ✓ |
| pwa-cross-browser / pwa-page-transitions / pwa-each-page-has-url | manual(人工核對項,自動評分不適用) |

## lighthouse13-baseline.json — 現行版四類別(lighthouse@13.4.0)

| 類別 | 分數 |
|---|---|
| Performance | 97 |
| Accessibility | 95 |
| Best Practices | 96 |
| SEO | 100 |

基線分數供 T7.4 收尾(bundle 預算、a11y 快掃)比對。

## 更新(2026-07-05,T7.4)

對比度修正後重測 Accessibility:**95 → 100**(無失敗 audit)。首頁 bundle 量測見 `bundle.md`。
