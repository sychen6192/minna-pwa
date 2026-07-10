# DEPLOY — Cloudflare Pages 部署指南

> **決策記錄(2026-07-10)**:原方案(N6 初版)要求部署置於 Cloudflare Access 之後。
> 使用者決定改為**公開網址、免登入使用**,版權風險自行承擔;SPEC N6 與 ADR D7 已同步修訂。
> 降低曝光的緩解措施:全站 noindex(HTML meta robots + `X-Robots-Tag` header)、不散佈網址、repo 維持 private。

架構:GitHub Actions(CI 綠燈後)以 `wrangler pages deploy` 直傳 `out/` 到 Cloudflare Pages(direct upload,不用 Pages 的 git 整合)。

## 1. 一次性設定(Cloudflare 端,約 5 分鐘)

### 1.1 建立 Pages 專案

擇一:

- **Dashboard**:Workers & Pages → Create → Pages → *Upload assets* → 專案名 `minna-pwa`(先隨便傳一個空檔完成建立即可,之後由 CI 覆蓋),production branch 設 `main`。
- **本機 CLI**:
  ```bash
  pnpm dlx wrangler login
  pnpm dlx wrangler pages project create minna-pwa --production-branch=main
  ```

> 專案名決定網址:`minna-pwa.pages.dev`。被占用就換名字,並同步改 `.github/workflows/ci.yml` 裡的 `--project-name`。

### 1.2 建立 API Token

Dashboard 右上頭像 → My Profile → **API Tokens** → Create Token → *Create Custom Token*:

- Permissions:**Account → Cloudflare Pages → Edit**(僅此一項)
- Account Resources:限定你的帳號

建立後複製 token(只顯示一次)。另外到任一 zone 或 Workers & Pages 首頁右側複製 **Account ID**。

### 1.3 設定 GitHub Secrets

Repo → Settings → Secrets and variables → Actions → New repository secret:

| Secret 名稱 | 值 |
|---|---|
| `CLOUDFLARE_API_TOKEN` | 1.2 的 token |
| `CLOUDFLARE_ACCOUNT_ID` | 1.2 的 Account ID |

之後每次 push `main`,CI 全綠就會自動部署。secrets 未設定時 deploy step 會自動跳過(CI 保持綠燈)。

### 自訂網域(選用)

Pages 專案 → Custom domains 加網域(zone 需在同帳號)。

## 2. noindex(版權緩解,必須)

兩層,缺一不可,皆已入庫:

1. **HTML meta**:`src/app/layout.tsx` 的 `metadata.robots = { index: false, follow: false }`
   → 所有頁面輸出 `<meta name="robots" content="noindex, nofollow">`。
2. **HTTP header**:`public/_headers`(Cloudflare Pages 原生支援)對全站補 `X-Robots-Tag: noindex`
   → 涵蓋非 HTML 資源(`/data/**` JSON、icons、sw.js)。

> 注意:**不要**加 `robots.txt` 全站 Disallow——爬蟲被擋在外面就讀不到 noindex 指令,
> 已被收錄的頁面反而移不掉。noindex 需要允許抓取才會生效。

## 3. 部署流程(日常)

1. push `main` → GitHub Actions:`pnpm verify` → `pnpm build` → `wrangler pages deploy out`。
2. Actions log 的 deploy step 會印出部署網址。
3. 內容更新(`public/data/**`)與程式更新走同一條路;SW 會在使用者端提示「新版本已就緒」。

## 4. 驗證清單(驗收標準)

| # | 檢查 | 預期 |
|---|---|---|
| 1 | `curl -sI https://minna-pwa.pages.dev` | `200`,且含 `x-robots-tag: noindex` |
| 2 | `curl -s https://minna-pwa.pages.dev \| grep -o '<meta name="robots"[^>]*>'` | `content` 含 `noindex` |
| 3 | `curl -sI https://minna-pwa.pages.dev/data/lessons/L01.json` | `200`,且含 `x-robots-tag: noindex` |
| 4 | 無痕視窗開站 | app 直接可用(免登入);DevTools 確認 SW activated |
| 5 | 進站後開飛航模式重開 | 離線可瀏覽任一課 |

全部通過 = T7.3 驗收成立。
