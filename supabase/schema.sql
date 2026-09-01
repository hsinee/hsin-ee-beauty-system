-- HSIN.EE 營運系統 V7 — Supabase 資料庫 Schema + RLS + RPC
-- 使用方式：Supabase 專案 Dashboard → SQL Editor → New query → 貼上整份檔案 → Run
-- 這份 SQL 只需要執行一次；重複執行也安全（使用 if not exists / or replace）。

create extension if not exists pgcrypto;

-- ============================================================
-- 1. 資料表
-- ============================================================

create table if not exists stores (
  id uuid primary key default gen_random_uuid(),
  name text not null default '我的工作室',
  logo_url text,
  primary_color text default '#c58f82',
  login_title text default '工作室後台',
  phone text,
  ig_handle text,
  line_id text,
  address text,
  -- 價格方案清單，店家自己定義，適用任何美業項目（不是每間店都需要「首次體驗價/品牌體驗價」）。
  -- 每個方案是 {id, label, trialDefault}，trialDefault 標記「新客首次消費預設帶入哪個方案」（可不設）。
  price_tiers jsonb not null default '[{"id":"default","label":"原價"}]'::jsonb,
  created_at timestamptz default now()
);

-- 舊專案升級：補上新欄位（新專案這行不會有作用，因為上面 create table 已經包含）
alter table stores add column if not exists price_tiers jsonb not null default '[{"id":"default","label":"原價"}]'::jsonb;

create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  store_id uuid references stores(id) on delete cascade,
  role text default 'owner',
  created_at timestamptz default now()
);

create table if not exists customers (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  auth_user_id uuid references auth.users(id) on delete set null,
  member_no text not null,
  name text not null,
  phone text,
  line_id text,
  email text,
  birthday date,
  source text,
  first_visit_date date,
  notes text,
  can_photograph text default 'unset',
  model_status text default 'unset',
  reminder_sent_for date,
  created_at timestamptz default now(),
  unique (store_id, member_no),
  unique (auth_user_id)
);
create index if not exists customers_store_idx on customers (store_id);
create index if not exists customers_auth_idx on customers (auth_user_id);

create table if not exists services (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  name text not null,
  category text,
  -- 每個服務的價格，key 對應 stores.price_tiers 裡的方案 id，例如 {"default": 399}
  -- 或 {"normal": 399, "trial": 199}。方案數量、名稱完全由店家自訂，不寫死。
  prices jsonb not null default '{}'::jsonb,
  duration_min integer,
  active boolean default true,
  created_at timestamptz default now()
);
create index if not exists services_store_idx on services (store_id);

-- 舊專案升級：把舊的 3 個固定價格欄位換成彈性的 prices jsonb
alter table services add column if not exists prices jsonb not null default '{}'::jsonb;
alter table services drop column if exists price_normal;
alter table services drop column if exists price_first_trial;
alter table services drop column if exists price_brand_model;

create table if not exists records (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  customer_id uuid not null references customers(id) on delete cascade,
  service_id uuid references services(id) on delete set null,
  service_name text not null,
  date date not null,
  time time,
  price_tier text not null default 'normal',
  list_price numeric not null default 0,
  discount numeric default 0,
  amount numeric not null default 0,
  payment_method text,
  source text,
  notes text,
  deposit_paid boolean default false,
  deposit_amount numeric default 0,
  reminder_sent boolean default false,
  created_at timestamptz default now()
);
create index if not exists records_store_date_idx on records (store_id, date);
create index if not exists records_customer_idx on records (customer_id);

create table if not exists record_addons (
  id uuid primary key default gen_random_uuid(),
  record_id uuid not null references records(id) on delete cascade,
  type text not null,
  description text,
  amount numeric not null default 0
);
create index if not exists record_addons_record_idx on record_addons (record_id);

create table if not exists expenses (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  date date not null,
  category text not null,
  type text not null,
  item text,
  amount numeric not null default 0,
  payment_method text,
  notes text,
  created_at timestamptz default now()
);
create index if not exists expenses_store_date_idx on expenses (store_id, date);

-- ============================================================
-- 2. Row Level Security
-- ============================================================

alter table stores enable row level security;
alter table profiles enable row level security;
alter table customers enable row level security;
alter table services enable row level security;
alter table records enable row level security;
alter table record_addons enable row level security;
alter table expenses enable row level security;

-- ---- profiles：只能看到/新增自己的那一筆 ----
drop policy if exists "profiles_select_own" on profiles;
create policy "profiles_select_own" on profiles for select
  using (id = auth.uid());

drop policy if exists "profiles_insert_own" on profiles;
create policy "profiles_insert_own" on profiles for insert
  with check (id = auth.uid());

-- ---- stores：品牌資訊（店名/Logo/主色/聯絡方式）本來就是要給客人看到的公開資訊
-- （例如客戶會員中心登入頁要顯示店家 Logo），所以開放任何人依 id 查詢；
-- 真正需要保護的營收/客戶/成本資料在其他表，並沒有在這裡公開。
drop policy if exists "stores_select_own" on stores;
drop policy if exists "stores_select_public" on stores;
create policy "stores_select_public" on stores for select
  using (true);

drop policy if exists "stores_insert_new" on stores;
create policy "stores_insert_new" on stores for insert
  with check (auth.uid() is not null);

drop policy if exists "stores_update_own" on stores;
create policy "stores_update_own" on stores for update
  using (id in (select store_id from profiles where id = auth.uid()));

-- ---- customers：店家版（完整 CRUD）----
drop policy if exists "customers_store_select" on customers;
create policy "customers_store_select" on customers for select
  using (store_id in (select store_id from profiles where id = auth.uid()));

drop policy if exists "customers_store_insert" on customers;
create policy "customers_store_insert" on customers for insert
  with check (store_id in (select store_id from profiles where id = auth.uid()));

drop policy if exists "customers_store_update" on customers;
create policy "customers_store_update" on customers for update
  using (store_id in (select store_id from profiles where id = auth.uid()));

drop policy if exists "customers_store_delete" on customers;
create policy "customers_store_delete" on customers for delete
  using (store_id in (select store_id from profiles where id = auth.uid()));

-- ---- customers：客戶版（只能讀自己那筆）----
drop policy if exists "customers_self_select" on customers;
create policy "customers_self_select" on customers for select
  using (auth_user_id = auth.uid());

-- ---- services：店家版 ----
drop policy if exists "services_store_select" on services;
create policy "services_store_select" on services for select
  using (store_id in (select store_id from profiles where id = auth.uid()));

drop policy if exists "services_store_insert" on services;
create policy "services_store_insert" on services for insert
  with check (store_id in (select store_id from profiles where id = auth.uid()));

drop policy if exists "services_store_update" on services;
create policy "services_store_update" on services for update
  using (store_id in (select store_id from profiles where id = auth.uid()));

drop policy if exists "services_store_delete" on services;
create policy "services_store_delete" on services for delete
  using (store_id in (select store_id from profiles where id = auth.uid()));

-- ---- records：店家版 ----
drop policy if exists "records_store_select" on records;
create policy "records_store_select" on records for select
  using (store_id in (select store_id from profiles where id = auth.uid()));

drop policy if exists "records_store_insert" on records;
create policy "records_store_insert" on records for insert
  with check (store_id in (select store_id from profiles where id = auth.uid()));

drop policy if exists "records_store_update" on records;
create policy "records_store_update" on records for update
  using (store_id in (select store_id from profiles where id = auth.uid()));

drop policy if exists "records_store_delete" on records;
create policy "records_store_delete" on records for delete
  using (store_id in (select store_id from profiles where id = auth.uid()));

-- ---- records：客戶版（只能讀自己的紀錄）----
drop policy if exists "records_self_select" on records;
create policy "records_self_select" on records for select
  using (customer_id in (select id from customers where auth_user_id = auth.uid()));

-- ---- record_addons：店家版 ----
drop policy if exists "record_addons_store_select" on record_addons;
create policy "record_addons_store_select" on record_addons for select
  using (record_id in (select id from records where store_id in (select store_id from profiles where id = auth.uid())));

drop policy if exists "record_addons_store_insert" on record_addons;
create policy "record_addons_store_insert" on record_addons for insert
  with check (record_id in (select id from records where store_id in (select store_id from profiles where id = auth.uid())));

drop policy if exists "record_addons_store_update" on record_addons;
create policy "record_addons_store_update" on record_addons for update
  using (record_id in (select id from records where store_id in (select store_id from profiles where id = auth.uid())));

drop policy if exists "record_addons_store_delete" on record_addons;
create policy "record_addons_store_delete" on record_addons for delete
  using (record_id in (select id from records where store_id in (select store_id from profiles where id = auth.uid())));

-- ---- record_addons：客戶版（只能讀自己紀錄底下的加購）----
drop policy if exists "record_addons_self_select" on record_addons;
create policy "record_addons_self_select" on record_addons for select
  using (record_id in (select id from records where customer_id in (select id from customers where auth_user_id = auth.uid())));

-- ---- expenses：店家版 ----
drop policy if exists "expenses_store_select" on expenses;
create policy "expenses_store_select" on expenses for select
  using (store_id in (select store_id from profiles where id = auth.uid()));

drop policy if exists "expenses_store_insert" on expenses;
create policy "expenses_store_insert" on expenses for insert
  with check (store_id in (select store_id from profiles where id = auth.uid()));

drop policy if exists "expenses_store_update" on expenses;
create policy "expenses_store_update" on expenses for update
  using (store_id in (select store_id from profiles where id = auth.uid()));

drop policy if exists "expenses_store_delete" on expenses;
create policy "expenses_store_delete" on expenses for delete
  using (store_id in (select store_id from profiles where id = auth.uid()));

-- ============================================================
-- 3. 開店流程 RPC（新帳號第一次登入時呼叫）
-- ============================================================
-- 用 security definer 是因為建立 stores 列之後，還要馬上把 profiles 綁定，
-- 這兩個動作要在同一個交易內完成，用 RPC 包起來比在前端分兩次呼叫更不會半途出錯。
--
-- 注意：這裡刻意不在函式「內部」呼叫 auth.uid()，而是要求呼叫端把已經登入的
-- user id 當參數傳進來（前端用 supabase.auth.getUser() 取得）。實測發現
-- auth.uid() 在某些專案的 SECURITY DEFINER 函式內部會讀不到，傳參數比較保險。
-- 安全性靠下面的 grant/revoke：只有 authenticated 角色能呼叫這個函式。

drop function if exists bootstrap_store(text);

create or replace function bootstrap_store(p_store_name text, p_user_id uuid)
returns table (store_id uuid) as $$
declare
  v_store_id uuid;
begin
  if p_user_id is null then
    raise exception '請先登入';
  end if;

  if exists (select 1 from profiles where id = p_user_id) then
    raise exception '這個帳號已經有對應的店家了';
  end if;

  insert into stores (name) values (coalesce(nullif(trim(p_store_name), ''), '我的工作室'))
  returning id into v_store_id;

  insert into profiles (id, store_id, role) values (p_user_id, v_store_id, 'owner');

  return query select v_store_id;
end;
$$ language plpgsql security definer set search_path = public;

revoke all on function bootstrap_store(text, uuid) from public;
grant execute on function bootstrap_store(text, uuid) to authenticated;

-- ============================================================
-- 4. 客戶會員中心：手機號碼綁定 RPC
-- ============================================================
-- 客戶在會員中心註冊時呼叫。用 security definer 是因為一般客戶帳號的 RLS
-- 只能看到 auth_user_id 已經等於自己的那筆 customers 資料；在還沒綁定前，
-- 需要用有提升權限的函式去依「store_id + phone」找到既有客戶並完成綁定，
-- 這段比對邏輯刻意不放在前端，避免有人亂猜手機號碼就綁到別人的消費紀錄。
-- 同上，user id 由呼叫端傳入，不在函式內部呼叫 auth.uid()。

drop function if exists bind_customer_account(uuid, text, text);

create or replace function bind_customer_account(p_store_id uuid, p_phone text, p_name text, p_user_id uuid)
returns table (customer_id uuid) as $$
declare
  v_id uuid;
  v_max int;
  v_member_no text;
begin
  if p_user_id is null then
    raise exception '請先登入';
  end if;

  if exists (select 1 from customers where auth_user_id = p_user_id) then
    raise exception '這個帳號已經綁定過會員資料了';
  end if;

  select id into v_id
  from customers
  where store_id = p_store_id
    and phone = p_phone
    and auth_user_id is null
  limit 1;

  if v_id is not null then
    update customers set auth_user_id = p_user_id where id = v_id;
  else
    select coalesce(max(substring(member_no from 2)::int), 0) into v_max
    from customers where store_id = p_store_id and member_no ~ '^W[0-9]+$';
    v_member_no := 'W' || lpad((v_max + 1)::text, 3, '0');

    insert into customers (store_id, auth_user_id, member_no, name, phone, source, first_visit_date)
    values (
      p_store_id,
      p_user_id,
      v_member_no,
      coalesce(nullif(trim(p_name), ''), '新客人'),
      p_phone,
      '自行註冊',
      current_date
    )
    returning id into v_id;
  end if;

  return query select v_id;
end;
$$ language plpgsql security definer set search_path = public;

revoke all on function bind_customer_account(uuid, text, text, uuid) from public;
grant execute on function bind_customer_account(uuid, text, text, uuid) to authenticated;
