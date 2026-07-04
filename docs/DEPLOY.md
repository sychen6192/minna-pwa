# DEPLOY — Cloudflare Pages + Access 部署指南

> **N6 硬性要求**:教材內容有版權、僅供個人使用,部署**必須**置於 Cloudflare Access 之後。
> 完成本文全部步驟前,不要把網址分享給任何人。

架構:GitHub Actions(CI 綠燈後)以 `wrangler pages deploy` 直傳 `out/` 到 Cloudflare Pages(direct upload,不用 Pages 的 git 整合);存取控制由 Zero Trust Access 的 One-time PIN(email OTP)把關。

## 1. 一次性設定(Cloudflare 端,約 10 分鐘)

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

## 2. Cloudflare Access(必須,在第一次部署後立刻設定)

> 重要事實(官方 Known issues):Pages 專案設定裡的一鍵「Enable access policy」**只保護 preview 部署**
> (`<hash>.minna-pwa.pages.dev`),**不含** production 網域 `minna-pwa.pages.dev`。
> 要兩個 Access application 才能全蓋,步驟如下。

1. 首次使用 Zero Trust:Dashboard → Zero Trust → 依指示選 team name(免費方案即可)。
2. **先建 preview 保護**:Workers & Pages → `minna-pwa` → Settings → **Enable access policy**。
3. **改成保護 production**:Zero Trust → Access → Applications → 找到剛建立的 `minna-pwa.pages.dev` 應用 → Configure →
   Public hostname 區塊把 Subdomain 欄的 `*` **移除**(變成 `minna-pwa.pages.dev` 本體)→ 必要時改 Application name 避免重名錯誤 → 儲存。
4. **補回 preview 保護**:回到 Pages 專案 Settings 再按一次 **Enable access policy**,產生第二個(wildcard)應用。
5. **Policy 內容**(兩個應用都檢查):Allow → Include → **Emails** → 只填你自己的 email。
   登入方式用預設的 **One-time PIN** 即可(免設 IdP)。
6. **Session 時長**:應用設定裡把 Session Duration 調到 **1 個月**(個人 app,減少重登;見 §4 PWA 互動)。

### 自訂網域(選用)

Pages 專案 → Custom domains 加網域(zone 需在同帳號)。加了就**必須**再建一個 Access 應用:
Zero Trust → Access → Applications → *Create new application* → Self-hosted → Public hostname 選該網域 → 同樣的 email policy。
(官方警告:漏了這步會出現「登入頁渲染但登入無效」的狀態。)

## 3. 部署流程(日常)

1. push `main` → GitHub Actions:`pnpm verify` → `pnpm build` → `wrangler pages deploy out`。
2. Actions log 的 deploy step 會印出部署網址。
3. 內容更新(`public/data/**`)與程式更新走同一條路;SW 會在使用者端提示「新版本已就緒」。

## 4. PWA × Access 互動(本 app 特有,務必理解)

- **離線不受影響**:SW 已 precache 全站;Access 只擋「網路請求」,離線時 SW 直接供應快取,app 照常可用。
- **Access session 過期後**:app 從快取照常開啟與使用(感覺不到擋);但背景的 SW 更新檢查、新資源抓取會拿到 302 登入頁而**靜默失敗**——「新版本已就緒」不會出現。**解法**:偶爾(或看到很久沒更新時)在瀏覽器開一次網址、完成 OTP 重新登入,更新就會恢復。
- **iOS 加入主畫面**:先在 Safari 完成 OTP 登入,再加入主畫面;standalone 內 session 過期時會看到 Access 登入頁,OTP 流程可直接在裡面完成。
- SW 檔案(`/sw.js`)同樣在 Access 後面:未授權者連 SW 都拿不到,版權內容零外洩面。

## 5. 驗證清單(驗收標準)

| # | 檢查 | 預期 |
|---|---|---|
| 1 | 無痕視窗開 `https://minna-pwa.pages.dev` | 出現 Cloudflare Access 登入頁,**看不到任何 app 內容** |
| 2 | `curl -sI https://minna-pwa.pages.dev` | `302` 且 `location:` 指向 `cloudflareaccess.com` |
| 3 | `curl -sI https://minna-pwa.pages.dev/data/lessons/L01.json` | 同樣 `302`(資料檔也被擋) |
| 4 | 輸入你的 email → OTP → 進站 | app 正常;DevTools 確認 SW activated |
| 5 | 進站後開飛航模式重開 | 離線可瀏覽任一課 |
| 6 | 用非允許清單的 email 要求 OTP | 收不到核可(Access 拒絕) |

全部通過 = T7.3 驗收成立。
