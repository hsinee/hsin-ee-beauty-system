# 美業工作室營運系統 V7

多租戶 SaaS 版本：Vite + React 前端，Supabase（PostgreSQL + Auth + RLS）後端。
每間店家獨立註冊、資料互相隔離，品牌（Logo／店名／主色／聯絡方式）由店家登入後自行設定。

## 首次設定

1. 在 Supabase 專案的 SQL Editor 貼上並執行 `supabase/schema.sql`（建表 + RLS + RPC，只需執行一次）。
2. 複製 `.env.example` 為 `.env`，填入 Supabase 專案的 `VITE_SUPABASE_URL` 與 `VITE_SUPABASE_PUBLISHABLE_KEY`。
3. 在 Supabase → Authentication → URL Configuration 設定 Site URL 為你的部署網址。

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

- `src/AppGate.jsx`：登入狀態判斷（店家 / 客戶 / 全新帳號）與畫面路由
- `src/AuthScreens.jsx`：店家登入／註冊／忘記密碼／重設密碼／開店流程
- `src/CustomerPortal.jsx`：客戶會員中心（登入／註冊綁定／唯讀資料）
- `src/SettingsView.jsx`：品牌設定頁
- `src/lib/supabase.js`、`src/lib/dataApi.js`：Supabase client 與資料存取層
- `src/App.jsx`：店家後台主體（Dashboard／客戶／日曆／服務項目／成本／回訪提醒）
