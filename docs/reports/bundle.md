# Bundle 量測(T7.4,2026-07-05)

量測方式:`out/index.html` 實際引用的資產逐一 `gzip -9` 加總(`next build` 之 First Load 欄為未壓縮值)。

## 首頁(N4 預算:JS gzip < 200 KB)

| 資產 | gzip |
|---|---|
| chunks/3976b0ab(React/框架) | 53.0 KB |
| chunks/884(App Router runtime + Serwist window) | 46.6 KB |
| polyfills | 38.6 KB |
| chunks/362 | 30.1 KB |
| chunks/505 | 8.4 KB |
| chunks/498 | 3.3 KB |
| app/layout | 3.5 KB |
| webpack runtime + main-app | 1.9 KB |
| **JS 合計** | **185.4 KB ✓** |
| CSS | 4.5 KB |
| sw.js(另計,非首屏必要) | 14.8 KB |

## 各頁 First Load(未壓縮,`next build` 輸出)

| 路由 | First Load JS |
|---|---|
| `/` | 104 kB |
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
