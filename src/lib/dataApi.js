import { supabase } from './supabase.js';

/* ============================================================
   snake_case (資料庫) <-> camelCase (畫面用) 轉換
   ============================================================ */

export function customerFromRow(row) {
  return {
    id: row.id,
    memberNo: row.member_no,
    name: row.name,
    phone: row.phone || '',
    lineId: row.line_id || '',
    email: row.email || '',
    birthday: row.birthday || '',
    source: row.source || '',
    firstVisitDate: row.first_visit_date || '',
    notes: row.notes || '',
    canPhotograph: row.can_photograph || 'unset',
    modelStatus: row.model_status || 'unset',
    reminderSentFor: row.reminder_sent_for || '',
    authUserId: row.auth_user_id || null,
    storedValueBalance: Number(row.stored_value_balance) || 0,
  };
}

function customerToRow(c, storeId) {
  return {
    id: c.id,
    store_id: storeId,
    member_no: c.memberNo,
    name: c.name,
    phone: c.phone || null,
    line_id: c.lineId || null,
    email: c.email || null,
    birthday: c.birthday || null,
    source: c.source || null,
    first_visit_date: c.firstVisitDate || null,
    notes: c.notes || null,
    can_photograph: c.canPhotograph || 'unset',
    model_status: c.modelStatus || 'unset',
    reminder_sent_for: c.reminderSentFor || null,
    stored_value_balance: Number(c.storedValueBalance) || 0,
  };
}

export function serviceFromRow(row) {
  return {
    id: row.id,
    name: row.name,
    category: row.category || '',
    prices: row.prices || {},
    duration: row.duration_min || '',
    active: row.active !== false,
  };
}

function serviceToRow(s, storeId) {
  return {
    id: s.id,
    store_id: storeId,
    name: s.name,
    category: s.category || null,
    prices: s.prices || {},
    duration_min: s.duration ? Number(s.duration) : null,
    active: s.active !== false,
  };
}

export function recordFromRow(row) {
  return {
    id: row.id,
    customerId: row.customer_id,
    serviceId: row.service_id || '',
    serviceName: row.service_name,
    date: row.date,
    time: row.time || '',
    priceTier: row.price_tier || 'normal',
    listPrice: Number(row.list_price) || 0,
    discount: Number(row.discount) || 0,
    amount: Number(row.amount) || 0,
    paymentMethod: row.payment_method || '',
    source: row.source || '',
    notes: row.notes || '',
    depositPaid: !!row.deposit_paid,
    depositAmount: Number(row.deposit_amount) || 0,
    reminderSent: !!row.reminder_sent,
    status: row.status || 'confirmed',
    paymentStatus: row.payment_status || 'paid_full',
    addons: (row.record_addons || []).map((a) => ({
      id: a.id,
      type: a.type,
      description: a.description || '',
      amount: Number(a.amount) || 0,
    })),
  };
}

function recordToRow(r, storeId) {
  return {
    id: r.id,
    store_id: storeId,
    customer_id: r.customerId,
    service_id: r.serviceId || null,
    service_name: r.serviceName,
    date: r.date,
    time: r.time || null,
    price_tier: r.priceTier || 'normal',
    list_price: Number(r.listPrice) || 0,
    discount: Number(r.discount) || 0,
    amount: Number(r.amount) || 0,
    payment_method: r.paymentMethod || null,
    source: r.source || null,
    notes: r.notes || null,
    deposit_paid: !!r.depositPaid,
    deposit_amount: Number(r.depositAmount) || 0,
    reminder_sent: !!r.reminderSent,
    status: r.status || 'confirmed',
    payment_status: r.paymentStatus || 'paid_full',
  };
}

export function expenseFromRow(row) {
  return {
    id: row.id,
    date: row.date,
    category: row.category,
    type: row.type,
    item: row.item || '',
    amount: Number(row.amount) || 0,
    paymentMethod: row.payment_method || '',
    notes: row.notes || '',
  };
}

function expenseToRow(e, storeId) {
  return {
    id: e.id,
    store_id: storeId,
    date: e.date,
    category: e.category,
    type: e.type,
    item: e.item || null,
    amount: Number(e.amount) || 0,
    payment_method: e.paymentMethod || null,
    notes: e.notes || null,
  };
}

function storeFromRow(row) {
  return {
    id: row.id,
    name: row.name || '',
    logoUrl: row.logo_url || '',
    primaryColor: row.primary_color || '#c58f82',
    loginTitle: row.login_title || '',
    phone: row.phone || '',
    igHandle: row.ig_handle || '',
    lineId: row.line_id || '',
    address: row.address || '',
    priceTiers: row.price_tiers && row.price_tiers.length ? row.price_tiers : [{ id: 'default', label: '原價' }],
    messageTemplates: row.message_templates || [],
  };
}

function throwIfError(error) {
  if (error) throw error;
}

/* ============================================================
   帳號 / 店家
   ============================================================ */

export async function findMyProfile() {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, store_id, role')
    .maybeSingle();
  throwIfError(error);
  return data;
}

export async function findMyCustomerLink() {
  const { data, error } = await supabase
    .from('customers')
    .select('id, store_id')
    .not('auth_user_id', 'is', null)
    .maybeSingle();
  throwIfError(error);
  return data;
}

export async function fetchStore(storeId) {
  const { data, error } = await supabase.from('stores').select('*').eq('id', storeId).single();
  throwIfError(error);
  return storeFromRow(data);
}

export async function bootstrapStore(storeName) {
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  throwIfError(userErr);
  const { data, error } = await supabase.rpc('bootstrap_store', {
    p_store_name: storeName,
    p_user_id: userData.user.id,
  });
  throwIfError(error);
  return data[0].store_id;
}

export async function updateStore(storeId, patch) {
  const row = {};
  if (patch.name !== undefined) row.name = patch.name;
  if (patch.logoUrl !== undefined) row.logo_url = patch.logoUrl;
  if (patch.primaryColor !== undefined) row.primary_color = patch.primaryColor;
  if (patch.loginTitle !== undefined) row.login_title = patch.loginTitle;
  if (patch.phone !== undefined) row.phone = patch.phone;
  if (patch.igHandle !== undefined) row.ig_handle = patch.igHandle;
  if (patch.lineId !== undefined) row.line_id = patch.lineId;
  if (patch.address !== undefined) row.address = patch.address;
  if (patch.priceTiers !== undefined) row.price_tiers = patch.priceTiers;
  if (patch.messageTemplates !== undefined) row.message_templates = patch.messageTemplates;
  const { data, error } = await supabase.from('stores').update(row).eq('id', storeId).select().single();
  throwIfError(error);
  return storeFromRow(data);
}

export async function bindCustomerAccount(storeId, phone, name) {
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  throwIfError(userErr);
  const { data, error } = await supabase.rpc('bind_customer_account', {
    p_store_id: storeId,
    p_phone: phone,
    p_name: name,
    p_user_id: userData.user.id,
  });
  throwIfError(error);
  return data[0].customer_id;
}

/* ============================================================
   店家後台：整批載入
   ============================================================ */

export async function fetchStoreBundle() {
  const [{ data: customers, error: e1 }, { data: services, error: e2 }, { data: records, error: e3 }, { data: expenses, error: e4 }] =
    await Promise.all([
      supabase.from('customers').select('*').order('created_at', { ascending: true }),
      supabase.from('services').select('*').order('created_at', { ascending: true }),
      supabase.from('records').select('*, record_addons(*)').order('date', { ascending: true }),
      supabase.from('expenses').select('*').order('date', { ascending: true }),
    ]);
  throwIfError(e1); throwIfError(e2); throwIfError(e3); throwIfError(e4);
  return {
    customers: customers.map(customerFromRow),
    services: services.map(serviceFromRow),
    records: records.map(recordFromRow),
    expenses: expenses.map(expenseFromRow),
  };
}

/* ============================================================
   客戶
   ============================================================ */

export async function saveCustomer(customer, storeId) {
  const row = customerToRow(customer, storeId);
  const { data, error } = await supabase.from('customers').upsert(row).select().single();
  throwIfError(error);
  return customerFromRow(data);
}

export async function deleteCustomer(id) {
  const { error } = await supabase.from('customers').delete().eq('id', id);
  throwIfError(error);
}

/* ============================================================
   服務項目
   ============================================================ */

export async function saveService(service, storeId) {
  const row = serviceToRow(service, storeId);
  const { data, error } = await supabase.from('services').upsert(row).select().single();
  throwIfError(error);
  return serviceFromRow(data);
}

export async function deleteService(id) {
  const { error } = await supabase.from('services').delete().eq('id', id);
  throwIfError(error);
}

/* ============================================================
   服務／預約紀錄（含加購）
   ============================================================ */

export async function saveRecord(record, storeId) {
  const row = recordToRow(record, storeId);
  const { data, error } = await supabase.from('records').upsert(row).select().single();
  throwIfError(error);

  // 加購項目：整批刪除重建，簡單且每筆紀錄的加購數量很少，不需要做差異比對
  const { error: delErr } = await supabase.from('record_addons').delete().eq('record_id', data.id);
  throwIfError(delErr);

  const addonRows = (record.addons || [])
    .filter((a) => Number(a.amount) > 0)
    .map((a) => ({ record_id: data.id, type: a.type, description: a.description || null, amount: Number(a.amount) }));

  let addons = [];
  if (addonRows.length > 0) {
    const { data: inserted, error: addErr } = await supabase.from('record_addons').insert(addonRows).select();
    throwIfError(addErr);
    addons = inserted;
  }

  return recordFromRow({ ...data, record_addons: addons });
}

export async function deleteRecord(id) {
  const { error } = await supabase.from('records').delete().eq('id', id);
  throwIfError(error);
}

/* ============================================================
   成本支出
   ============================================================ */

export async function saveExpense(expense, storeId) {
  const row = expenseToRow(expense, storeId);
  const { data, error } = await supabase.from('expenses').upsert(row).select().single();
  throwIfError(error);
  return expenseFromRow(data);
}

export async function deleteExpense(id) {
  const { error } = await supabase.from('expenses').delete().eq('id', id);
  throwIfError(error);
}

/* ============================================================
   完整資料備份／還原（JSON，供換裝置或店家自行留存用）
   這跟 Dashboard 那個「匯出全部系統資料」Excel 不一樣：Excel 是給人看的報表，
   這裡的 JSON 備份是給系統自己讀回去用的，換裝置、或想留一份自己的備份都靠這個。
   ============================================================ */

const BACKUP_VERSION = 1;

export async function exportBackup(store) {
  const bundle = await fetchStoreBundle();
  return {
    backupVersion: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    storeName: store.name,
    data: bundle,
  };
}

// 還原會先清空這間店現有的客戶／服務／紀錄／成本，再整批寫入備份檔的內容，
// 是「整包覆蓋」不是「合併」，跟大部分本機備份工具的行為一致。
export async function restoreFromBackup(storeId, backup) {
  if (!backup || !backup.data) throw new Error('備份檔格式不正確');
  const { customers = [], services = [], records = [], expenses = [] } = backup.data;

  const delCustomers = await supabase.from('customers').delete().eq('store_id', storeId);
  throwIfError(delCustomers.error);
  const delServices = await supabase.from('services').delete().eq('store_id', storeId);
  throwIfError(delServices.error);
  const delExpenses = await supabase.from('expenses').delete().eq('store_id', storeId);
  throwIfError(delExpenses.error);

  if (customers.length) {
    const { error } = await supabase.from('customers').insert(customers.map((c) => customerToRow(c, storeId)));
    throwIfError(error);
  }
  if (services.length) {
    const { error } = await supabase.from('services').insert(services.map((s) => serviceToRow(s, storeId)));
    throwIfError(error);
  }
  if (records.length) {
    const { error } = await supabase.from('records').insert(records.map((r) => recordToRow(r, storeId)));
    throwIfError(error);

    const addonRows = [];
    records.forEach((r) => {
      (r.addons || []).forEach((a) => {
        if (Number(a.amount) > 0) {
          addonRows.push({ record_id: r.id, type: a.type, description: a.description || null, amount: Number(a.amount) });
        }
      });
    });
    if (addonRows.length) {
      const { error: addonErr } = await supabase.from('record_addons').insert(addonRows);
      throwIfError(addonErr);
    }
  }
  if (expenses.length) {
    const { error } = await supabase.from('expenses').insert(expenses.map((e) => expenseToRow(e, storeId)));
    throwIfError(error);
  }
}

/* ============================================================
   客戶會員中心：只讀
   ============================================================ */

export async function fetchCustomerPortalBundle() {
  const { data: customerRow, error: e1 } = await supabase.from('customers').select('*').single();
  throwIfError(e1);
  const { data: records, error: e2 } = await supabase
    .from('records')
    .select('*, record_addons(*)')
    .eq('customer_id', customerRow.id)
    .order('date', { ascending: true });
  throwIfError(e2);
  return {
    customer: customerFromRow(customerRow),
    records: records.map(recordFromRow),
  };
}
