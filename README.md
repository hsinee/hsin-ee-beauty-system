# 美業工作室營運系統 V8

買斷版：純前端 Vite + React 應用，**不接任何後端資料庫**。資料存在使用者自己瀏覽器的
`localStorage` 裡，用 4 位數 PIN 碼做輕量鎖定，換裝置或備份靠「品牌設定」頁的 JSON 匯出／匯入。

這代表：
- 部署一次（例如 Vercel），賣給多少店家都不會增加你的主機費，因為完全沒有共用資料庫。
- 每個裝置（每個瀏覽器）的資料互相獨立，不會即時同步——換手機/平板要自己匯出備份再匯入。
- 沒有客戶會員中心（客人自己登入看消費紀錄），因為沒有共用後端可以串接客人的手機。

## 首次使用

1. 打開網站，第一次會要求設定店名與 4 位數 PIN 碼。
2. 之後每次打開都用這個 PIN 碼解鎖。
3. 進「品牌設定」定期匯出備份 `.json`，換裝置或想留存都靠這個檔案。

## 本機開發

```bash
npm install
npm run dev
```

## 建置

```bash
npm run build
```

## 架構

- `src/AppGate.jsx`：判斷「還沒設定 / PIN 鎖定中 / 已解鎖」並路由到對應畫面
- `src/AuthScreens.jsx`：開店設定（設定店名＋PIN）與 PIN 解鎖畫面
- `src/SettingsView.jsx`：品牌設定（Logo／主色／聯絡方式）、價格方案、訊息範本、PIN 碼變更、資料備份匯出匯入
- `src/lib/localStore.js`：所有資料存取都經過這一層，實際存在 `localStorage`
- `src/App.jsx`：店家後台主體（Dashboard／客戶／日曆／服務項目／成本／回訪提醒）
- `public/manifest.webmanifest`、`index.html` 的 PWA meta tags：讓網頁可以「加到主畫面」，用起來更像一個安裝過的 App（本質上還是同一個網站，不需要上架）
