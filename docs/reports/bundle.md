# Bundle 量測(T7.4,2026-07-05;T7.5 首頁改儀表板後更新 2026-07-10;Phase 10 後重測 2026-09-29;Phase 11 後重測 2026-09-30)

量測方式:`out/index.html` 實際引用的資產逐一 `gzip -9` 加總(`next build` 之 First Load 欄為未壓縮值)。

## 2026-09-30 重新量測(Phase 11 後)

量測方式同下。Phase 11 新增的練習頁(`/drill`、`/reorder`、`/reorder/[id]`)與測驗新題型都不在首頁引用之列,首頁 JS 幾乎不變。

| 資產 | gzip |
|---|---|
| chunks/3976b0ab(React/框架) | 54.1 KB |
| chunks/884(App Router runtime + Serwist window) | 47.8 KB |
| polyfills | 39.4 KB |
| chunks/505 | 8.5 KB |
| app/page(儀表板) | 5.7 KB |
| app/layout | 4.0 KB |
| chunks/498 | 3.4 KB |
| webpack runtime + main-app | 2.2 KB |
| app/not-found | 0.2 KB |
| **JS 合計** | **165.3 KB ✓** |
| CSS | 7.4 KB |
| sw.js(另計,非首屏必要;precache 423 條目) | 15.4 KB |

| 路由 | First Load JS(未壓縮,`next build`) |
|---|---|
| `/` | 122 kB |
| `/drill` | 201 kB |
| `/grammar` | 143 kB |
| `/lessons` | 169 kB |
| `/lessons/[id]` | 192 kB |
| `/practice` | 191 kB |
| `/quiz`(入口) | 137 kB |
| `/quiz/[id]` | 202 kB |
| `/reorder`(選課) | 136 kB |
| `/reorder/[id]` | 175 kB |
| `/review` | 194 kB |
| `/settings` | 176 kB |
| `/stats` | **284 kB**(Recharts;N4 僅約束首頁) |

## 2026-09 重新量測(Phase 10 後)

量測方式同下(`out/index.html` 引用的資產逐一 `gzip -9` 加總,KB = 1000 bytes)。

| 資產 | gzip |
|---|---|
| chunks/3976b0ab(React/框架) | 54.1 KB |
| chunks/884(App Router runtime + Serwist window) | 47.8 KB |
| polyfills | 39.4 KB |
| chunks/505 | 8.5 KB |
| app/page(儀表板) | 5.7 KB |
| app/layout | 4.0 KB |
| chunks/498 | 3.4 KB |
| webpack runtime + main-app | 2.2 KB |
| app/not-found | 0.2 KB |
| **JS 合計** | **165.2 KB ✓** |
| CSS | 6.8 KB |
| sw.js(另計,非首屏必要) | 14.9 KB |

2026-07 表中的 chunks/362(30.9 KB)已不在首頁引用之列。

| 路由 | First Load JS(未壓縮,`next build`) |
|---|---|
| `/` | 122 kB |
| `/grammar` | 143 kB |
| `/lessons` | 169 kB |
| `/lessons/[id]` | 186 kB |
| `/practice` | 184 kB |
| `/quiz`(入口) | 135 kB |
| `/quiz/[id]` | 186 kB |
| `/review` | 187 kB |
| `/settings` | 176 kB |
| `/stats` | **284 kB**(Recharts;N4 僅約束首頁) |

## 首頁(N4 預算:JS gzip < 200 KB)

T7.5 將首頁從佔位頁改為今日儀表板。資料層(Dexie / ts-fsrs / stats / content)
以動態 `import()` 載入,不計入首屏 bundle;首頁 JS gzip 由儀表板一度升至 212.6 KB
(破預算)後,經動態載入回落至 **187.4 KB ✓**(First Load 未壓縮 104→109 kB)。

| 資產 | gzip |
|---|---|
| chunks/3976b0ab(React/框架) | 54.3 KB |
| chunks/884(App Router runtime + Serwist window) | 47.8 KB |
| polyfills | 39.4 KB |
| chunks/362 | 30.9 KB |
| chunks/505 | 8.6 KB |
| app/page(儀表板)+ app/layout | 7.9 KB |
| chunks/498 | 3.4 KB |
| webpack runtime + main-app | 2.0 KB |
| **JS 合計** | **187.4 KB ✓** |
| CSS | 4.5 KB |
| sw.js(另計,非首屏必要) | 14.8 KB |

> 資料層 chunk(Dexie 等,約 24 KB gzip)於首屏後才由 `import()` 取回,不在上表。

## 各頁 First Load(未壓縮,`next build` 輸出)

| 路由 | First Load JS |
|---|---|
| `/` | 109 kB |
| `/lessons` | 126 kB |
| `/quiz`(入口) | 126 kB |
| `/lessons/[id]` | 171 kB |
| `/review` | 174 kB |
| `/quiz/[id]` | 179 kB |
| `/settings` | 155 kB |
| `/stats` | **271 kB**(Recharts;N4 僅約束首頁,如實記錄) |

## 備註

- polyfills 38.6 KB 為最大單一可削減項(browserslist 收斂可省),v1 不動。
- 內容資料(`/data/**` 約 1 MB)由 SW precache,不計入首屏 bundle。
