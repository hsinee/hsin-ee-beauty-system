/* ============================================================
   本機資料層：買斷版不接雲端資料庫，所有資料存在使用者自己瀏覽器的
   localStorage 裡。换裝置／備份靠 Settings 頁的 JSON 匯出匯入。

   這個檔案刻意跟舊版 lib/dataApi.js（Supabase 版）維持一樣的函式名稱與
   大致相同的參數形狀，讓 App.jsx / SettingsView.jsx 幾乎不用改呼叫端的
   程式碼。第二個參數（storeId）在這裡用不到，保留只是為了相容舊的呼叫。
   ============================================================ */

const STORE_KEY = 'beauty_system_store_v1';
const DATA_KEY = 'beauty_system_data_v1';
const UNLOCK_KEY = 'beauty_system_unlocked_v1';

function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    return fallback;
  }
}

function saveJSON(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function emptyData() {
  return { customers: [], services: [], records: [], expenses: [] };
}

function defaultStore() {
  return {
    id: 'local',
    name: '我的工作室',
    logoUrl: '',
    primaryColor: '#c58f82',
    backgroundColor: '#f1ebe5',
    loginTitle: '工作室後台',
    phone: '',
    igHandle: '',
    lineId: '',
    address: '',
    priceTiers: [{ id: 'default', label: '原價' }],
    products: [],
    discountPresetsEnabled: false,
    messageTemplates: [
      {
        id: 'tpl-appointment-reminder',
        name: '預約提醒',
        content: 'Hi {{姓名}}您好，提醒您 {{日期}} {{時間}} 在{{店名}}有預約唷！地址：{{地址}}，如需更改時間歡迎與我們聯繫～',
      },
      {
        id: 'tpl-revisit-reminder',
        name: '回訪提醒',
        content: 'Hi {{姓名}}，您上次到{{店名}}的服務已經有一段時間囉，優惠將在 {{到期日}} 到期，歡迎回來保養～有任何問題歡迎加LINE詢問：{{LINE}}',
      },
      {
        id: 'tpl-payment-received',
        name: '訂金/付款通知',
        content: 'Hi {{姓名}}，已收到您的款項，期待 {{日期}} {{時間}} 為您服務！有任何問題歡迎聯繫電話 {{電話}} 或 LINE：{{LINE}}',
      },
    ],
    pin: '',
  };
}

/* ============================================================
   開店設定 / PIN 鎖定
   ============================================================ */

export function isSetUp() {
  return !!loadJSON(STORE_KEY, null);
}

export async function setupStore(name, pin) {
  const store = { ...defaultStore(), name: (name || '').trim() || '我的工作室', pin };
  saveJSON(STORE_KEY, store);
  saveJSON(DATA_KEY, emptyData());
  return store;
}

export function verifyPin(pin) {
  const store = loadJSON(STORE_KEY, null);
  return !!store && store.pin === pin;
}

export function isUnlocked() {
  return localStorage.getItem(UNLOCK_KEY) === '1';
}

export function setUnlocked(v) {
  if (v) localStorage.setItem(UNLOCK_KEY, '1');
  else localStorage.removeItem(UNLOCK_KEY);
}

/* ============================================================
   店家設定
   ============================================================ */

export async function fetchStore() {
  return loadJSON(STORE_KEY, defaultStore());
}

export async function updateStore(_storeId, patch) {
  const store = loadJSON(STORE_KEY, defaultStore());
  const updated = { ...store, ...patch };
  saveJSON(STORE_KEY, updated);
  return updated;
}

/* ============================================================
   店家後台：整批載入 / 逐筆存取
   ============================================================ */

export async function fetchStoreBundle() {
  return loadJSON(DATA_KEY, emptyData());
}

function withData(mutator) {
  const data = loadJSON(DATA_KEY, emptyData());
  const result = mutator(data);
  saveJSON(DATA_KEY, data);
  return result;
}

export async function saveCustomer(customer) {
  return withData((d) => {
    const exists = d.customers.some((c) => c.id === customer.id);
    d.customers = exists ? d.customers.map((c) => (c.id === customer.id ? customer : c)) : [...d.customers, customer];
    return customer;
  });
}

// 批次匯入既有客戶名單用，一次把多筆新客戶寫進去，比逐筆呼叫 saveCustomer 少很多次
// localStorage 寫入。
export async function saveCustomersBulk(customers) {
  return withData((d) => {
    d.customers = [...d.customers, ...customers];
    return customers;
  });
}

export async function deleteCustomer(id) {
  withData((d) => {
    d.customers = d.customers.filter((c) => c.id !== id);
    d.records = d.records.filter((r) => r.customerId !== id);
  });
}

export async function saveService(service) {
  return withData((d) => {
    const exists = d.services.some((s) => s.id === service.id);
    d.services = exists ? d.services.map((s) => (s.id === service.id ? service : s)) : [...d.services, service];
    return service;
  });
}

export async function deleteService(id) {
  withData((d) => { d.services = d.services.filter((s) => s.id !== id); });
}

export async function saveRecord(record) {
  return withData((d) => {
    const exists = d.records.some((r) => r.id === record.id);
    d.records = exists ? d.records.map((r) => (r.id === record.id ? record : r)) : [...d.records, record];
    return record;
  });
}

export async function deleteRecord(id) {
  withData((d) => { d.records = d.records.filter((r) => r.id !== id); });
}

export async function saveExpense(expense) {
  return withData((d) => {
    const exists = d.expenses.some((e) => e.id === expense.id);
    d.expenses = exists ? d.expenses.map((e) => (e.id === expense.id ? expense : e)) : [...d.expenses, expense];
    return expense;
  });
}

export async function deleteExpense(id) {
  withData((d) => { d.expenses = d.expenses.filter((e) => e.id !== id); });
}

/* ============================================================
   完整資料備份／還原（JSON，供換裝置或自行留存用）
   ============================================================ */

const BACKUP_VERSION = 2;

export async function exportBackup(store) {
  const data = loadJSON(DATA_KEY, emptyData());
  const { id, pin, ...storeSettings } = store || {};
  return {
    backupVersion: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    storeName: store?.name || '',
    store: storeSettings,
    data,
  };
}

// 還原是整包覆蓋目前這台裝置上的客戶／服務／紀錄／成本資料，不是合併。
export async function restoreFromBackup(_storeId, backup) {
  if (!backup || !backup.data) throw new Error('備份檔格式不正確');
  const { customers = [], services = [], records = [], expenses = [] } = backup.data;
  saveJSON(DATA_KEY, { customers, services, records, expenses });
}

// 只還原品牌設定（店名／Logo／顏色／價格方案／訊息範本等），完全不動客戶／服務／紀錄／成本資料。
// PIN 碼也不會被備份檔覆蓋，避免不同裝置互相鎖住彼此。
export async function restoreStoreSettings(_storeId, backup) {
  if (!backup || !backup.store) throw new Error('這份備份檔沒有品牌設定內容（可能是舊版備份檔）');
  const current = loadJSON(STORE_KEY, defaultStore());
  const { id, pin, ...incoming } = backup.store;
  const updated = { ...current, ...incoming };
  saveJSON(STORE_KEY, updated);
  return updated;
}
