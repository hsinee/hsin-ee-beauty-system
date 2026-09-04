import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell
} from 'recharts';
import {
  Search, Plus, X, ChevronRight, ChevronLeft, Trash2, Pencil, Bell,
  Users, LayoutGrid, Sparkles, Wallet, ClipboardList, Menu, CalendarDays, Clock, Download, Settings as SettingsIcon
} from 'lucide-react';
import * as XLSX from 'xlsx';
import {
  fetchStoreBundle,
  saveCustomer as apiSaveCustomer,
  saveCustomersBulk as apiSaveCustomersBulk,
  deleteCustomer as apiDeleteCustomer,
  saveService as apiSaveService,
  deleteService as apiDeleteService,
  saveRecord as apiSaveRecord,
  deleteRecord as apiDeleteRecord,
  saveExpense as apiSaveExpense,
  deleteExpense as apiDeleteExpense,
} from './lib/localStore.js';
import SettingsView from './SettingsView.jsx';

/* ============================================================
   常數 / 預設值
   ============================================================ */

const DEFAULT_SOURCES = ['IG', 'Threads', 'Google', '朋友介紹', 'LINE', '自然搜尋', '其他'];
const PAYMENT_METHODS = ['現金', '轉帳', 'LINE Pay', '信用卡', '其他'];

const RECORD_STATUS_OPTIONS = [
  { id: 'pending', label: '待確認' },
  { id: 'confirmed', label: '已確認' },
  { id: 'arrived', label: '已到店' },
  { id: 'no_show', label: '未到店' },
  { id: 'cancelled', label: '已取消' },
  { id: 'postponed', label: '延期' },
];
function recordStatusLabel(id) {
  return (RECORD_STATUS_OPTIONS.find((s) => s.id === id) || {}).label || id;
}

const PAYMENT_STATUS_OPTIONS = [
  { id: 'pre_order', label: '預購' },
  { id: 'paid_full', label: '已付全款' },
  { id: 'deposit_only', label: '已付訂金' },
  { id: 'stored_value', label: '使用儲值扣款' },
  { id: 'unpaid', label: '未收款' },
];
function paymentStatusLabel(id) {
  return (PAYMENT_STATUS_OPTIONS.find((s) => s.id === id) || {}).label || id;
}
// 回訪優惠視窗：最近一次服務後 6 週（42 天）內回訪享優惠，
// 從第 4 週開始（滿 22 天）就在「回訪提醒」列表跳出來，讓店家有時間主動聯繫
const REVISIT_WINDOW_DAYS = 42;
const REVISIT_ALERT_START_DAY = 22;
// 每個分類對應到固定成本／變動成本，用於毛利、淨利計算
const EXPENSE_CATEGORIES = [
  { name: '耗材用品', type: 'variable' },
  { name: '保養產品', type: 'variable' },
  { name: '工作室房租', type: 'fixed' },
  { name: '水電雜費', type: 'fixed' },
  { name: '行銷推廣', type: 'fixed' },
  { name: '其他支出', type: 'fixed' },
];
function expenseCategoryType(name) {
  const found = EXPENSE_CATEGORIES.find((c) => c.name === name);
  return found ? found.type : 'variable';
}


function uid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// 價格方案不再寫死：改成每間店在「品牌設定」自己定義（store.priceTiers），
// 適用任何美業項目，不假設一定要有「首次體驗價／品牌體驗價」這種分法。
function tierLabel(priceTiers, tierId) {
  const t = (priceTiers || []).find((x) => x.id === tierId);
  return t ? t.label : (tierId || '');
}

// 新店家一開始服務項目是空的，由店家自己在「服務項目」頁新增，不繼承任何預設項目。
function emptyData() {
  return {
    customers: [],
    services: [],
    expenses: [],
    records: [],
    appointments: [],
    sources: DEFAULT_SOURCES,
  };
}

/* ============================================================
   工具函式
   ============================================================ */

function toLocalISO(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function todayISO() {
  return toLocalISO(new Date());
}
function fmtMoney(n) {
  const v = Math.round(Number(n) || 0);
  return '$' + v.toLocaleString('en-US');
}
function fmtDate(d) {
  if (!d) return '—';
  const [y, m, day] = d.split('-');
  return `${y}/${m}/${day}`;
}
function daysBetween(a, b) {
  return Math.round((new Date(b) - new Date(a)) / 86400000);
}
function addDays(dateStr, n) {
  const [y, m, day] = dateStr.split('-').map(Number);
  return toLocalISO(new Date(y, m - 1, day + n));
}
function monthKey(d) {
  return d.slice(0, 7);
}
function isBirthdayThisMonth(birthday) {
  if (!birthday) return false;
  const bMonth = birthday.slice(5, 7);
  const thisMonth = todayISO().slice(5, 7);
  return bMonth === thisMonth;
}
function nextMemberNo(customers) {
  let max = 0;
  customers.forEach((c) => {
    const m = /^W(\d+)$/.exec(c.memberNo || '');
    if (m) max = Math.max(max, parseInt(m[1], 10));
  });
  return 'W' + String(max + 1).padStart(3, '0');
}

/* ============================================================
   既有客戶資料匯入（Excel／CSV 範本）
   ============================================================ */

const CUSTOMER_IMPORT_BASE_COLUMNS = ['姓名', '手機', 'LINE', 'Email', '生日', '得知來源', '備註', '儲值餘額'];

function customerImportColumns(store) {
  return [...CUSTOMER_IMPORT_BASE_COLUMNS, ...(store.customerFields || []).map((f) => f.label)];
}

function downloadCustomerImportTemplate(store) {
  const cols = customerImportColumns(store);
  const ws = XLSX.utils.aoa_to_sheet([cols]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '客戶名單');
  XLSX.writeFile(wb, '客戶資料匯入範本.xlsx');
}

// Excel 日期儲存格讀進來可能是 JS Date 物件，其他情況（純文字欄位）就是字串，
// 兩種都正規化成 YYYY-MM-DD，格式不對就乾脆留空，不硬擋匯入（生日不是必填欄位）。
function normalizeImportedBirthday(value) {
  if (!value) return '';
  if (value instanceof Date && !isNaN(value)) return toLocalISO(value);
  const s = String(value).trim().replace(/\//g, '-');
  return /^\d{4}-\d{1,2}-\d{1,2}$/.test(s) ? s : '';
}

function parseCustomerImportRows(rows, store, existingCustomers) {
  const customFields = store.customerFields || [];
  let nextNum = parseInt(nextMemberNo(existingCustomers).slice(1), 10);
  const valid = [];
  const errors = [];

  rows.forEach((row, idx) => {
    const rowNo = idx + 2; // Excel 第一列是欄位標題
    const name = String(row['姓名'] || '').trim();
    const phone = String(row['手機'] || '').trim();
    if (!name && !phone && Object.values(row).every((v) => !String(v || '').trim())) return; // 整列空白，跳過不算錯誤
    if (!name || !phone) {
      errors.push({ row: rowNo, reason: '姓名或手機空白' });
      return;
    }
    const missingRequired = customFields.find((f) => f.required && !String(row[f.label] || '').trim());
    if (missingRequired) {
      errors.push({ row: rowNo, reason: `缺少必填欄位「${missingRequired.label}」` });
      return;
    }
    const customFieldValues = {};
    customFields.forEach((f) => { customFieldValues[f.id] = String(row[f.label] || '').trim(); });
    valid.push({
      id: uid(),
      memberNo: 'W' + String(nextNum++).padStart(3, '0'),
      name,
      phone,
      lineId: String(row['LINE'] || '').trim(),
      email: String(row['Email'] || '').trim(),
      birthday: normalizeImportedBirthday(row['生日']),
      source: String(row['得知來源'] || '').trim() || '其他',
      notes: String(row['備註'] || '').trim(),
      storedValueBalance: Number(row['儲值餘額']) || 0,
      customFields: customFieldValues,
      firstVisitDate: '',
      reminderSentFor: '',
    });
  });

  return { valid, errors };
}

function CustomerImportModal({ store, data, onClose, onImport }) {
  const fileInputRef = useRef(null);
  const [fileName, setFileName] = useState('');
  const [parsed, setParsed] = useState(null); // { valid, errors }
  const [parseError, setParseError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setParseError('');
    setParsed(null);
    setFileName(file.name);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array', cellDates: true });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
      setParsed(parseCustomerImportRows(rows, store, data.customers));
    } catch (err) {
      setParseError('這個檔案讀不出來，請確認是不是 .xlsx 或 .csv 檔');
    }
  };

  const confirmImport = async () => {
    if (!parsed || parsed.valid.length === 0) return;
    setBusy(true);
    try {
      await onImport(parsed.valid);
      setDone(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="匯入客戶資料" onClose={onClose}>
      <p className="muted small" style={{ marginBottom: 12 }}>
        適合原本已經有一批客戶名單、想一次搬進系統的情況。步驟：先下載範本，把既有的客戶資料貼進對應欄位，
        存好後在這裡選檔案上傳。姓名和手機是必填，其他欄位可以留空。
      </p>
      <button type="button" className="btn-secondary small" onClick={() => downloadCustomerImportTemplate(store)} style={{ marginBottom: 14 }}>
        下載匯入範本 (.xlsx)
      </button>

      {done ? (
        <p style={{ color: '#4c7a3f', fontSize: 13 }}>
          已成功匯入 {parsed.valid.length} 位客戶，關閉視窗就能在客戶列表看到。
        </p>
      ) : (
        <>
          <button type="button" className="btn-secondary small" onClick={() => fileInputRef.current?.click()} disabled={busy}>
            選擇填好的檔案
          </button>
          <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" onChange={handleFile} style={{ display: 'none' }} />
          {fileName && <p className="muted small" style={{ marginTop: 8 }}>已選擇：{fileName}</p>}
          {parseError && <p style={{ color: '#b56f65', fontSize: 13, marginTop: 8 }}>{parseError}</p>}

          {parsed && (
            <div style={{ marginTop: 14 }}>
              <p className="muted small">
                共讀到 {parsed.valid.length + parsed.errors.length} 筆，可匯入 {parsed.valid.length} 筆
                {parsed.errors.length > 0 ? `，有 ${parsed.errors.length} 筆資料不完整、不會匯入：` : '。'}
              </p>
              {parsed.errors.length > 0 && (
                <ul className="muted small" style={{ margin: '6px 0 0 18px', maxHeight: 140, overflowY: 'auto' }}>
                  {parsed.errors.slice(0, 20).map((e, i) => (
                    <li key={i}>第 {e.row} 列：{e.reason}</li>
                  ))}
                  {parsed.errors.length > 20 && <li>...還有 {parsed.errors.length - 20} 筆</li>}
                </ul>
              )}
              <div className="modal-actions" style={{ marginTop: 14 }}>
                <button className="btn-primary full" onClick={confirmImport} disabled={busy || parsed.valid.length === 0}>
                  {busy ? '匯入中⋯' : `確認匯入 ${parsed.valid.length} 位客戶`}
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </Modal>
  );
}

function getRangeDates(period, customStart, customEnd) {
  const now = new Date();
  const end = todayISO();
  let start = end;
  if (period === 'today') {
    start = end;
  } else if (period === 'week') {
    const d = new Date(now);
    const day = d.getDay() || 7;
    d.setDate(d.getDate() - day + 1);
    start = toLocalISO(d);
  } else if (period === 'month') {
    start = toLocalISO(new Date(now.getFullYear(), now.getMonth(), 1));
  } else if (period === 'quarter') {
    const q = Math.floor(now.getMonth() / 3);
    start = toLocalISO(new Date(now.getFullYear(), q * 3, 1));
  } else if (period === 'year') {
    start = toLocalISO(new Date(now.getFullYear(), 0, 1));
    return { start, end: toLocalISO(new Date(now.getFullYear(), 11, 31)) };
  } else if (period === 'custom') {
    start = customStart || end;
    return { start, end: customEnd || end };
  }
  return { start, end };
}

/* ============================================================
   複製到剪貼簿（含備援機制）
   ============================================================ */

// 在部分沙盒環境（例如某些內嵌 iframe）navigator.clipboard 會被封鎖且靜默失敗，
// 導致按鈕看起來「沒有反應」。這裡先試現代 API，失敗就退回傳統的
// textarea + execCommand('copy') 做法，兩者都失敗才回傳 false。
async function copyToClipboard(text) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (e) {
    // fall through to legacy method
  }
  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.top = '0';
    textarea.style.left = '-9999px';
    textarea.setAttribute('readonly', '');
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(textarea);
    return ok;
  } catch (e) {
    return false;
  }
}

/* ============================================================
   共用小元件
   ============================================================ */

function Modal({ title, onClose, children, wide }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className={'modal-panel' + (wide ? ' wide' : '')} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="icon-btn" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

function Field({ label, children, hint }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

function KpiCard({ label, value, sub }) {
  return (
    <div className="kpi-card">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
      {sub && <div className="kpi-sub">{sub}</div>}
    </div>
  );
}

function renderTemplate(content, vars) {
  return (content || '').replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, key) => {
    const v = vars[key];
    return v !== undefined && v !== null ? String(v) : '';
  });
}

// 共用的「複製訊息」按鈕：下拉列出店家在品牌設定自訂的所有範本，
// 點哪個就依 vars 代入佔位符、複製到剪貼簿，不用切分頁。
function TemplatePickerButton({ templates, vars, label }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [fallbackText, setFallbackText] = useState(null);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  const pick = async (t) => {
    setOpen(false);
    const msg = renderTemplate(t.content, vars);
    const ok = await copyToClipboard(msg);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } else {
      setFallbackText(msg);
    }
  };

  if (!templates || templates.length === 0) {
    return (
      <button type="button" className="btn-secondary small" disabled title="請先到「品牌設定」新增訊息範本">
        {label || '複製訊息'}
      </button>
    );
  }

  return (
    <div className="template-picker" ref={wrapRef}>
      <button type="button" className="btn-secondary small" onClick={() => setOpen((v) => !v)}>
        {copied ? '已複製' : (label || '複製訊息')}
      </button>
      {open && (
        <div className="template-menu">
          {templates.map((t) => (
            <button key={t.id} type="button" className="template-menu-item" onClick={() => pick(t)}>{t.name}</button>
          ))}
        </div>
      )}
      {fallbackText && <CopyFallbackModal text={fallbackText} onClose={() => setFallbackText(null)} />}
    </div>
  );
}

function CopyFallbackModal({ text, onClose }) {
  const textareaRef = useRef(null);
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.select();
    }
  }, []);
  return (
    <Modal title="複製訊息" onClose={onClose}>
      <p className="muted small">這個環境無法自動複製，麻煩手動全選（已預選）後用 Cmd/Ctrl + C 複製：</p>
      <textarea ref={textareaRef} readOnly rows={9} className="fallback-textarea" value={text} onFocus={(e) => e.target.select()} />
      <div className="modal-actions">
        <button className="btn-primary full" onClick={onClose}>關閉</button>
      </div>
    </Modal>
  );
}

/* ============================================================
   共用統計計算
   ============================================================ */

function addonsTotal(record) {
  return (record.addons || []).reduce((s, a) => s + Number(a.amount || 0), 0);
}
function productsTotal(record) {
  const raw = (record.products || []).reduce((s, p) => s + Number(p.price || 0) * Number(p.qty || 1), 0);
  return Math.max(0, raw - Number(record.productDiscount || 0));
}
function recordTotal(record) {
  return Number(record.amount || 0) + addonsTotal(record) + productsTotal(record);
}
// 這筆紀錄目前實際從客人儲值餘額扣了多少錢（沒有用儲值扣款就是 0）。
// 新增/編輯/刪除紀錄時都要用「新舊差額」去調整餘額，不能每次都整筆再扣一次，
// 不然改過的紀錄或刪除的紀錄會讓餘額對不起來。
function storedValueImpact(record) {
  return record && record.paymentStatus === 'stored_value' ? recordTotal(record) : 0;
}

function computeCoreStats(data, range) {
  const { records, expenses } = data;
  const inRange = records.filter((r) => r.date >= range.start && r.date <= range.end);

  const firstVisit = {};
  records.forEach((r) => {
    if (!firstVisit[r.customerId] || r.date < firstVisit[r.customerId]) {
      firstVisit[r.customerId] = r.date;
    }
  });

  const newCustomerIds = new Set();
  let returningVisits = 0;
  inRange.forEach((r) => {
    if (firstVisit[r.customerId] === r.date) newCustomerIds.add(r.customerId);
    else returningVisits += 1;
  });

  const revenue = inRange.reduce((s, r) => s + recordTotal(r), 0);
  const visits = inRange.length;
  const avgTicket = visits ? revenue / visits : 0;

  const expInRange = expenses.filter((e) => e.date >= range.start && e.date <= range.end);
  const fixedCost = expInRange.filter((e) => e.type === 'fixed').reduce((s, e) => s + Number(e.amount || 0), 0);
  const variableCost = expInRange.filter((e) => e.type === 'variable').reduce((s, e) => s + Number(e.amount || 0), 0);
  const grossProfit = revenue - variableCost;
  const netProfit = grossProfit - fixedCost;

  return { inRange, revenue, visits, newCount: newCustomerIds.size, returningVisits, avgTicket, fixedCost, variableCost, grossProfit, netProfit };
}

function getCalendarRange(period) {
  const now = new Date();
  if (period === 'day') {
    const d = todayISO();
    return { start: d, end: d };
  }
  if (period === 'week') {
    const d = new Date(now);
    const day = d.getDay() || 7;
    const monday = new Date(d);
    monday.setDate(d.getDate() - day + 1);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    return { start: toLocalISO(monday), end: toLocalISO(sunday) };
  }
  const start = toLocalISO(new Date(now.getFullYear(), now.getMonth(), 1));
  const end = toLocalISO(new Date(now.getFullYear(), now.getMonth() + 1, 0));
  return { start, end };
}
const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六'];

function buildMonthGrid(monthCursor) {
  const year = monthCursor.getFullYear();
  const month = monthCursor.getMonth();
  const firstDay = new Date(year, month, 1);
  const startWeekday = firstDay.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(toLocalISO(new Date(year, month, d)));
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

function monthRange(offset) {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth() + offset;
  const start = toLocalISO(new Date(y, m, 1));
  const end = toLocalISO(new Date(y, m + 1, 0));
  const label = new Date(y, m, 1).toLocaleDateString('zh-TW', { year: 'numeric', month: 'long' });
  return { start, end, label };
}

// 依照目前選擇的期間類型，往前推算對應的比較期間（例如本月→上月、本季→上一季），
// 並保留相同的天數長度，讓比較是公平的區間對區間。
const PREV_PERIOD_LABEL = { today: '昨日', week: '上週', month: '上月', quarter: '上一季', year: '去年', custom: '比較期間' };

function shiftRangeByPeriod(period, range, customStart, customEnd) {
  const elapsedDays = daysBetween(range.start, range.end);
  let prevStart;
  if (period === 'today') {
    prevStart = addDays(range.start, -1);
  } else if (period === 'week') {
    prevStart = addDays(range.start, -7);
  } else if (period === 'month') {
    const [y, m] = range.start.split('-').map(Number);
    prevStart = toLocalISO(new Date(y, m - 2, 1));
  } else if (period === 'quarter') {
    const [y, m] = range.start.split('-').map(Number);
    prevStart = toLocalISO(new Date(y, m - 4, 1));
  } else if (period === 'year') {
    const [y] = range.start.split('-').map(Number);
    prevStart = toLocalISO(new Date(y - 1, 0, 1));
  } else {
    const length = daysBetween(customStart, customEnd);
    prevStart = addDays(customStart, -(length + 1));
  }
  const prevEnd = addDays(prevStart, elapsedDays);
  return { start: prevStart, end: prevEnd };
}

function pctChange(curr, prev) {
  if (!prev) return curr ? null : 0;
  return ((curr - prev) / Math.abs(prev)) * 100;
}

/* ============================================================
   Dashboard
   ============================================================ */

const PERIODS = [
  { id: 'today', label: '今日' },
  { id: 'week', label: '本週' },
  { id: 'month', label: '本月' },
  { id: 'year', label: '今年' },
  { id: 'custom', label: '自訂' },
];

function Dashboard({ data, store }) {
  const [period, setPeriod] = useState('month');
  const [customStart, setCustomStart] = useState(todayISO());
  const [customEnd, setCustomEnd] = useState(todayISO());
  const [compareStart, setCompareStart] = useState('');
  const [compareEnd, setCompareEnd] = useState('');

  const range = getRangeDates(period, customStart, customEnd);

  const stats = useMemo(() => {
    const { records, customers } = data;
    const core = computeCoreStats(data, range);
    const inRange = core.inRange;

    // 回訪率（全歷史累積：有 >=2 筆消費者 / 有 >=1 筆消費者）
    const visitCountByCustomer = {};
    records.forEach((r) => { visitCountByCustomer[r.customerId] = (visitCountByCustomer[r.customerId] || 0) + 1; });
    const totalCust = Object.keys(visitCountByCustomer).length;
    const repeatCust = Object.values(visitCountByCustomer).filter((c) => c >= 2).length;
    const retentionRate = totalCust ? (repeatCust / totalCust) * 100 : 0;

    // 每日 / 每月營收趨勢
    const span = daysBetween(range.start, range.end);
    const groupByMonth = span > 45;
    const trendMap = {};
    inRange.forEach((r) => {
      const key = groupByMonth ? monthKey(r.date) : r.date;
      trendMap[key] = (trendMap[key] || 0) + recordTotal(r);
    });
    const trend = Object.entries(trendMap)
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([k, v]) => ({ label: groupByMonth ? k.slice(2) : k.slice(5), value: v }));

    // 服務項目營收（加購、產品銷售分別另外歸成一類，讓總額跟營收對得起來）
    const serviceMap = {};
    let addonRevenue = 0;
    let productRevenue = 0;
    inRange.forEach((r) => {
      serviceMap[r.serviceName] = (serviceMap[r.serviceName] || 0) + Number(r.amount || 0);
      addonRevenue += addonsTotal(r);
      productRevenue += productsTotal(r);
    });
    if (addonRevenue > 0) serviceMap['加購'] = addonRevenue;
    if (productRevenue > 0) serviceMap['產品銷售'] = productRevenue;
    const serviceRevenue = Object.entries(serviceMap)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([k, v]) => ({ label: k, value: v }));

    const newVsReturning = [
      { label: '新客', value: core.newCount },
      { label: '舊客回訪', value: core.returningVisits },
    ];

    // 建議回訪：預估回訪日已過期的客人
    const dueForVisit = [];
    Object.keys(visitCountByCustomer).forEach((cid) => {
      const custRecords = records.filter((r) => r.customerId === cid).sort((a, b) => (a.date < b.date ? -1 : 1));
      if (custRecords.length >= 2) {
        const gaps = [];
        for (let i = 1; i < custRecords.length; i++) gaps.push(daysBetween(custRecords[i - 1].date, custRecords[i].date));
        const avgGap = Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length);
        const last = custRecords[custRecords.length - 1].date;
        const predicted = addDays(last, avgGap);
        if (predicted < todayISO()) {
          const cust = customers.find((c) => c.id === cid);
          if (cust) dueForVisit.push({ ...cust, predicted, avgGap, last });
        }
      }
    });
    dueForVisit.sort((a, b) => (a.predicted < b.predicted ? -1 : 1));

    return {
      ...core, retentionRate,
      trend, serviceRevenue, newVsReturning, dueForVisit: dueForVisit.slice(0, 6),
    };
  }, [data, range.start, range.end]);

  const periodCompare = useMemo(() => {
    const useManual = period === 'custom' && compareStart && compareEnd;
    const prevRange = useManual ? { start: compareStart, end: compareEnd } : shiftRangeByPeriod(period, range, customStart, customEnd);
    const curr = computeCoreStats(data, range);
    const prev = computeCoreStats(data, prevRange);
    const currLabel = period === 'custom' ? `${fmtDate(range.start)}–${fmtDate(range.end)}` : PERIODS.find((p) => p.id === period).label;
    const prevLabel = period === 'custom' ? `${fmtDate(prevRange.start)}–${fmtDate(prevRange.end)}` : PREV_PERIOD_LABEL[period];
    return {
      currLabel, prevLabel,
      rows: [
        { label: '營收', curr: curr.revenue, prev: prev.revenue, fmt: fmtMoney },
        { label: '服務人次', curr: curr.visits, prev: prev.visits, fmt: (v) => v },
        { label: '新客人數', curr: curr.newCount, prev: prev.newCount, fmt: (v) => v },
        { label: '平均客單價', curr: curr.avgTicket, prev: prev.avgTicket, fmt: fmtMoney },
        { label: '毛利', curr: curr.grossProfit, prev: prev.grossProfit, fmt: fmtMoney },
        { label: '淨利', curr: curr.netProfit, prev: prev.netProfit, fmt: fmtMoney },
      ],
    };
  }, [data, period, range.start, range.end, customStart, customEnd, compareStart, compareEnd]);

  return (
    <div>
      <div className="view-head">
        <div>
          <h2 className="serif">營運總覽</h2>
          <p className="muted">{fmtDate(range.start)} — {fmtDate(range.end)}</p>
        </div>
        <div className="calendar-head-actions">
          <div className="period-tabs">
            {PERIODS.map((p) => (
              <button
                key={p.id}
                className={'period-tab' + (period === p.id ? ' active' : '')}
                onClick={() => setPeriod(p.id)}
              >{p.label}</button>
            ))}
          </div>
          <button className="btn-secondary" onClick={() => exportAllSystemData(data, store)} disabled={data.customers.length === 0}>
            <Download size={16} /> 匯出全部系統資料
          </button>
        </div>
      </div>

      {period === 'custom' && (
        <div className="custom-range">
          <input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} />
          <span className="muted">至</span>
          <input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} />
        </div>
      )}

      {period === 'custom' && (
        <div className="custom-range compare-range">
          <span className="muted small">比較期間</span>
          <input type="date" value={compareStart} onChange={(e) => setCompareStart(e.target.value)} />
          <span className="muted">至</span>
          <input type="date" value={compareEnd} onChange={(e) => setCompareEnd(e.target.value)} />
          <span className="muted small">留空則自動抓等長的前一段期間</span>
        </div>
      )}

      <div className="kpi-grid">
        <KpiCard label="期間營收" value={fmtMoney(stats.revenue)} />
        <KpiCard label="服務人次" value={stats.visits} />
        <KpiCard label="新客人數" value={stats.newCount} />
        <KpiCard label="舊客回訪人次" value={stats.returningVisits} />
        <KpiCard label="平均客單價" value={fmtMoney(stats.avgTicket)} />
        <KpiCard label="累積回訪率" value={stats.retentionRate.toFixed(0) + '%'} sub="全歷史客人中，消費 ≥2 次的比例" />
        <KpiCard label="期間毛利" value={fmtMoney(stats.grossProfit)} sub="營收－變動成本" />
        <KpiCard label="期間淨利" value={fmtMoney(stats.netProfit)} sub="毛利－固定成本" />
      </div>

      <div className="panel" style={{ marginBottom: 18 }}>
        <h4 className="panel-title">{periodCompare.currLabel} vs {periodCompare.prevLabel}</h4>
        <table className="compare-table">
          <thead>
            <tr><th></th><th>{periodCompare.currLabel}</th><th>{periodCompare.prevLabel}</th><th>成長率</th></tr>
          </thead>
          <tbody>
            {periodCompare.rows.map((r) => {
              const change = pctChange(r.curr, r.prev);
              const positive = change !== null && change >= 0;
              return (
                <tr key={r.label}>
                  <td className="muted">{r.label}</td>
                  <td className="strong">{r.fmt(r.curr)}</td>
                  <td className="muted">{r.fmt(r.prev)}</td>
                  <td className={change === null ? 'muted' : positive ? 'change-up' : 'change-down'}>
                    {change === null ? '—' : `${positive ? '+' : ''}${change.toFixed(0)}%`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="chart-grid">
        <div className="panel">
          <h4 className="panel-title">營收趨勢</h4>
          {stats.trend.length === 0 ? (
            <EmptyHint text="這段期間還沒有服務紀錄" />
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={stats.trend} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#ded4cc" />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#8f8178' }} axisLine={{ stroke: '#ded4cc' }} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: '#8f8178' }} axisLine={false} tickLine={false} width={50} />
                <Tooltip formatter={(v) => fmtMoney(v)} contentStyle={{ fontSize: 12, borderRadius: 6, borderColor: '#ded4cc' }} />
                <Line type="monotone" dataKey="value" stroke="#c58f82" strokeWidth={2.5} dot={{ r: 3, fill: '#c58f82' }} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="panel">
          <h4 className="panel-title">各服務項目營收</h4>
          {stats.serviceRevenue.length === 0 ? (
            <EmptyHint text="這段期間還沒有服務紀錄" />
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={stats.serviceRevenue} layout="vertical" margin={{ top: 5, right: 20, left: 10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#ded4cc" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11, fill: '#8f8178' }} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="label" tick={{ fontSize: 12, fill: '#4a3b34' }} axisLine={false} tickLine={false} width={70} />
                <Tooltip formatter={(v) => fmtMoney(v)} contentStyle={{ fontSize: 12, borderRadius: 6, borderColor: '#ded4cc' }} />
                <Bar dataKey="value" fill="#d4a396" radius={[0, 3, 3, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="panel">
          <h4 className="panel-title">新客 / 舊客回訪</h4>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={stats.newVsReturning} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#ded4cc" />
              <XAxis dataKey="label" tick={{ fontSize: 12, fill: '#4a3b34' }} axisLine={{ stroke: '#ded4cc' }} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: '#8f8178' }} axisLine={false} tickLine={false} width={40} />
              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 6, borderColor: '#ded4cc' }} />
              <Bar dataKey="value" radius={[3, 3, 0, 0]}>
                <Cell fill="#c58f82" />
                <Cell fill="#d4a396" />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="panel">
          <h4 className="panel-title">建議回訪</h4>
          {stats.dueForVisit.length === 0 ? (
            <EmptyHint text="目前沒有超過預估回訪日的客人" />
          ) : (
            <ul className="due-list">
              {stats.dueForVisit.map((c) => (
                <li key={c.id}>
                  <Bell size={14} />
                  <span className="due-name">{c.name}</span>
                  <span className="muted">預估 {fmtDate(c.predicted)} 回訪（平均 {c.avgGap} 天）</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function EmptyHint({ text }) {
  return <div className="empty-hint">{text}</div>;
}

/* ============================================================
   客戶 CRM
   ============================================================ */

function customerSummary(customer, records) {
  const own = records.filter((r) => r.customerId === customer.id).sort((a, b) => (a.date < b.date ? -1 : 1));
  const total = own.reduce((s, r) => s + recordTotal(r), 0);
  const last = own.length ? own[own.length - 1] : null;
  const first = own.length ? own[0] : null;
  return { own, total, count: own.length, last, first };
}

function exportAllSystemData(data, store) {
  const wb = XLSX.utils.book_new();

  const customerFields = store?.customerFields || [];
  const custRows = data.customers.map((c) => {
    const s = customerSummary(c, data.records);
    const row = {
      會員編號: c.memberNo,
      姓名: c.name,
      電話: c.phone,
      LINE: c.lineId || '',
      Email: c.email || '',
      生日: c.birthday || '',
      得知來源: c.source || '',
    };
    customerFields.forEach((f) => { row[f.label] = (c.customFields || {})[f.id] || ''; });
    row.備註 = c.notes || '';
    row.首次消費日期 = s.first ? s.first.date : (c.firstVisitDate || '');
    row.近期消費日期 = s.last ? s.last.date : '';
    row.儲值餘額 = c.storedValueBalance || 0;
    row.累積消費 = s.total;
    row.消費次數 = s.count;
    row.平均客單價 = s.count ? Math.round(s.total / s.count) : 0;
    return row;
  });
  const custSheet = XLSX.utils.json_to_sheet(custRows);
  custSheet['!cols'] = [
    { wch: 10 }, { wch: 10 }, { wch: 14 }, { wch: 12 }, { wch: 18 }, { wch: 12 },
    { wch: 10 }, { wch: 12 }, { wch: 14 }, { wch: 24 }, { wch: 12 }, { wch: 12 },
    { wch: 10 }, { wch: 10 }, { wch: 8 }, { wch: 10 },
  ];
  XLSX.utils.book_append_sheet(wb, custSheet, '客戶資料');

  const recordRows = [...data.records]
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .map((r) => {
      const c = data.customers.find((cc) => cc.id === r.customerId);
      return {
        客戶姓名: c ? c.name : '（已刪除客戶）',
        會員編號: c ? c.memberNo : '',
        日期: r.date,
        時間: r.time || '',
        服務項目: r.serviceName,
        價格方案: tierLabel(store?.priceTiers, r.priceTier),
        原價: r.listPrice,
        服務折扣: r.discount || 0,
        服務金額: r.amount,
        加購項目: (r.addons || []).map((a) => `${a.type}${a.description ? '(' + a.description + ')' : ''} $${a.amount}`).join('、'),
        加購金額: addonsTotal(r),
        購買產品: (r.products || []).map((p) => `${p.name} x${p.qty || 1} $${p.price}`).join('、'),
        產品折扣: r.productDiscount || 0,
        產品金額: productsTotal(r),
        總金額: recordTotal(r),
        付款方式: r.paymentMethod,
        付款狀態: paymentStatusLabel(r.paymentStatus),
        預約狀態: recordStatusLabel(r.status),
        已收訂金: r.depositPaid ? `是（$${r.depositAmount || 0}）` : '否',
        客源: r.source || '',
        備註: r.notes || '',
      };
    });
  const recordSheet = XLSX.utils.json_to_sheet(recordRows);
  XLSX.utils.book_append_sheet(wb, recordSheet, '服務紀錄');

  const apptRows = [...data.appointments]
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .map((a) => {
      const c = data.customers.find((cc) => cc.id === a.customerId);
      return {
        客戶姓名: c ? c.name : '（已刪除客戶）',
        會員編號: c ? c.memberNo : '',
        日期: a.date,
        時間: a.time || '',
        服務項目: a.serviceName || '',
        備註: a.notes || '',
        已提醒: a.reminderSent ? '是' : '否',
      };
    });
  if (apptRows.length > 0) {
    const apptSheet = XLSX.utils.json_to_sheet(apptRows);
    XLSX.utils.book_append_sheet(wb, apptSheet, '預約紀錄');
  }

  const priceTiers = store?.priceTiers || [{ id: 'default', label: '原價' }];
  const serviceRows = data.services.map((s) => {
    const row = { 項目名稱: s.name, 分類: s.category || '' };
    priceTiers.forEach((t) => { row[t.label] = (s.prices || {})[t.id] ?? ''; });
    row.操作時間 = s.duration;
    row.狀態 = s.active ? '啟用' : '停用';
    return row;
  });
  const serviceSheet = XLSX.utils.json_to_sheet(serviceRows);
  XLSX.utils.book_append_sheet(wb, serviceSheet, '服務項目');

  const expenseRows = [...data.expenses]
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .map((e) => ({
      日期: e.date,
      分類: e.category,
      類型: e.type === 'fixed' ? '固定成本' : '變動成本',
      項目說明: e.item,
      金額: e.amount,
      付款方式: e.paymentMethod,
      備註: e.notes || '',
    }));
  const expenseSheet = XLSX.utils.json_to_sheet(expenseRows);
  XLSX.utils.book_append_sheet(wb, expenseSheet, '成本支出');

  const safeName = (store?.name || '工作室').replace(/[\\/:*?"<>|]/g, '');
  XLSX.writeFile(wb, `${safeName}_全部資料_${todayISO()}.xlsx`);
}

function CustomersView({ data, store, onOpenCustomer, onAddCustomer, onEditCustomer, onImportCustomers }) {
  const [q, setQ] = useState('');

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    let list = data.customers;
    if (term) {
      list = list.filter((c) =>
        c.name.toLowerCase().includes(term) ||
        (c.phone || '').includes(term) ||
        (c.memberNo || '').toLowerCase().includes(term) ||
        (c.lineId || '').toLowerCase().includes(term)
      );
    }
    return list
      .map((c) => ({ c, s: customerSummary(c, data.records) }))
      .sort((a, b) => {
        const da = a.s.last ? a.s.last.date : '';
        const db = b.s.last ? b.s.last.date : '';
        return da < db ? 1 : -1;
      });
  }, [q, data.customers, data.records]);

  return (
    <div>
      <div className="view-head">
        <div>
          <h2 className="serif">客戶</h2>
          <p className="muted">共 {data.customers.length} 位客人</p>
        </div>
        <div className="button-group">
          <button className="btn-secondary" onClick={() => exportAllSystemData(data, store)} disabled={data.customers.length === 0}>
            <Download size={16} /> 匯出全部系統資料
          </button>
          <button className="btn-secondary" onClick={onImportCustomers}>匯入客戶資料</button>
          <button className="btn-primary" onClick={onAddCustomer}><Plus size={16} /> 新增客戶</button>
        </div>
      </div>

      <div className="search-bar">
        <Search size={16} />
        <input placeholder="搜尋姓名 / 電話 / 會員編號 / LINE" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      {filtered.length === 0 ? (
        <EmptyHint text={data.customers.length === 0 ? '還沒有客戶資料，點右上角新增第一位客人' : '找不到符合的客戶'} />
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>姓名</th>
                <th>電話</th>
                <th>會員編號</th>
                <th>類型</th>
                <th>最近服務</th>
                <th>累積消費</th>
                <th>次數</th>
                <th>生日</th>
                <th></th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(({ c, s }) => (
                <tr key={c.id} onClick={() => onOpenCustomer(c.id)}>
                  <td className="strong">{c.name}</td>
                  <td>{c.phone}</td>
                  <td>{c.memberNo}</td>
                  <td>{s.count > 1 ? '舊客' : '新客'}</td>
                  <td>{s.last ? fmtDate(s.last.date) : '—'}</td>
                  <td>{fmtMoney(s.total)}</td>
                  <td>{s.count}</td>
                  <td>{isBirthdayThisMonth(c.birthday) ? <span className="badge-birthday">🎂 本月生日</span> : '—'}</td>
                  <td>
                    <button className="icon-btn ghost" onClick={(e) => { e.stopPropagation(); onEditCustomer(c); }}><Pencil size={14} /></button>
                  </td>
                  <td><ChevronRight size={16} className="muted" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function CustomerFormModal({ data, store, customer, onClose, onSave, onDelete }) {
  const customerFields = store.customerFields || [];
  const knownSource = customer && (data.sources.includes(customer.source) ? customer.source : '其他');
  const [form, setForm] = useState(customer ? {
    name: customer.name, phone: customer.phone, lineId: customer.lineId || '',
    email: customer.email || '', birthday: customer.birthday || '', source: knownSource,
    otherSource: knownSource === '其他' && customer.source !== '其他' ? customer.source : '',
    notes: customer.notes || '',
    storedValueBalance: String(customer.storedValueBalance || 0),
    customFields: { ...(customer.customFields || {}) },
  } : { name: '', phone: '', lineId: '', email: '', birthday: '', source: data.sources[0], otherSource: '', notes: '', storedValueBalance: '0', customFields: {} });
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const setCustomField = (id) => (e) => setForm({ ...form, customFields: { ...form.customFields, [id]: e.target.value } });
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [error, setError] = useState('');

  const submit = () => {
    if (!form.name.trim() || !form.phone.trim()) { setError('姓名和手機是必填欄位'); return; }
    const missing = customerFields.find((f) => f.required && !(form.customFields[f.id] || '').trim());
    if (missing) { setError(`「${missing.label}」是必填欄位`); return; }
    setError('');
    const resolvedSource = form.source === '其他' && form.otherSource.trim() ? form.otherSource.trim() : form.source;
    if (customer) {
      onSave({
        ...customer,
        name: form.name.trim(),
        phone: form.phone.trim(),
        lineId: form.lineId.trim(),
        email: form.email.trim(),
        birthday: form.birthday || '',
        source: resolvedSource,
        notes: form.notes.trim(),
        storedValueBalance: Number(form.storedValueBalance) || 0,
        customFields: form.customFields,
      });
    } else {
      const memberNo = nextMemberNo(data.customers);
      onSave({
        id: uid(),
        memberNo,
        name: form.name.trim(),
        phone: form.phone.trim(),
        lineId: form.lineId.trim(),
        email: form.email.trim(),
        birthday: form.birthday || '',
        source: resolvedSource,
        notes: form.notes.trim(),
        storedValueBalance: Number(form.storedValueBalance) || 0,
        customFields: form.customFields,
        firstVisitDate: todayISO(),
        reminderSentFor: '',
      });
    }
  };

  return (
    <Modal title={customer ? '編輯客戶' : '新增客戶'} onClose={onClose}>
      <Field label="姓名 *"><input value={form.name} onChange={set('name')} placeholder="客人姓名" autoFocus /></Field>
      <Field label="手機 *"><input value={form.phone} onChange={set('phone')} placeholder="09XX-XXX-XXX" /></Field>
      <Field label="LINE 名稱（選填）"><input value={form.lineId} onChange={set('lineId')} /></Field>
      <Field label="Email（選填）"><input value={form.email} onChange={set('email')} /></Field>
      <Field label="生日（選填）" hint="用來標示本月壽星，只需要正確的月份和日期"><input type="date" value={form.birthday} onChange={set('birthday')} /></Field>
      <Field label="儲值餘額（選填）" hint="客人預先儲值的金額，服務時可選「使用儲值扣款」自動扣除">
        <input type="number" value={form.storedValueBalance} onChange={set('storedValueBalance')} />
      </Field>
      <Field label="得知來源（選填）">
        <select value={form.source} onChange={set('source')}>
          {data.sources.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </Field>
      {form.source === '其他' && (
        <Field label="請說明其他來源（選填）">
          <input value={form.otherSource} onChange={set('otherSource')} placeholder="例如：路過看到招牌" />
        </Field>
      )}

      {customerFields.map((f) => (
        <Field key={f.id} label={f.label + (f.required ? ' *' : '（選填）')}>
          <input value={form.customFields[f.id] || ''} onChange={setCustomField(f.id)} />
        </Field>
      ))}

      <Field label="備註（選填）"><textarea rows={3} value={form.notes} onChange={set('notes')} placeholder="內部備註" /></Field>

      {error && <p style={{ color: '#b56f65', fontSize: 13 }}>{error}</p>}

      <div className="modal-actions">
        {customer && !confirmingDelete && (
          <button className="btn-danger" onClick={() => setConfirmingDelete(true)}><Trash2 size={14} /> 刪除客戶</button>
        )}
        {customer && confirmingDelete && (
          <div className="delete-confirm-row">
            <span className="muted small">確定刪除？服務紀錄會一併刪除，無法復原</span>
            <button className="btn-secondary small" onClick={() => setConfirmingDelete(false)}>取消</button>
            <button className="btn-danger small" onClick={() => onDelete(customer.id)}>確定刪除</button>
          </div>
        )}
        {!confirmingDelete && <button className="btn-primary full" onClick={submit}>儲存客戶</button>}
      </div>
    </Modal>
  );
}


function CustomerDetail({ data, store, customerId, onBack, onAddRecord, onEditRecord, onDeleteRecord, onDeleteAppointment, onEditCustomer }) {
  const customer = data.customers.find((c) => c.id === customerId);
  if (!customer) return null;
  const s = customerSummary(customer, data.records);
  const storedValueUsedTotal = s.own.reduce((sum, r) => sum + storedValueImpact(r), 0);

  const upcoming = [
    ...s.own.filter((r) => r.date >= todayISO()).map((r) => ({ ...r, source: 'record' })),
    ...data.appointments.filter((a) => a.customerId === customerId && a.date >= todayISO()).map((a) => ({ ...a, source: 'appointment' })),
  ].sort((a, b) => (a.date !== b.date ? (a.date < b.date ? -1 : 1) : (a.time || '').localeCompare(b.time || '')));

  let retentionNote = null;
  if (s.own.length >= 2) {
    const gaps = [];
    for (let i = 1; i < s.own.length; i++) gaps.push(daysBetween(s.own[i - 1].date, s.own[i].date));
    const avgGap = Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length);
    const predicted = addDays(s.last.date, avgGap);
    retentionNote = { avgGap, predicted, overdue: predicted < todayISO() };
  }

  return (
    <div>
      <button className="back-link" onClick={onBack}><ChevronLeft size={16} /> 返回客戶列表</button>

      <div className="customer-head">
        <div>
          <h2 className="serif">{customer.name}{isBirthdayThisMonth(customer.birthday) && <span className="badge-birthday inline">🎂 本月生日</span>}</h2>
          <p className="muted">會員編號 {customer.memberNo} ・ {customer.phone}{customer.lineId ? ` ・ LINE ${customer.lineId}` : ''}</p>
        </div>
        <div className="button-group">
          <button className="btn-secondary" onClick={() => onEditCustomer(customer)}><Pencil size={14} /> 編輯客戶</button>
          <button className="btn-primary" onClick={() => onAddRecord(customer.id)}><Plus size={16} /> 新增服務／預約</button>
        </div>
      </div>

      <div className="kpi-grid narrow">
        <KpiCard label="首次消費日期" value={fmtDate(s.first ? s.first.date : customer.firstVisitDate)} />
        <KpiCard label="近期消費日期" value={s.last ? fmtDate(s.last.date) : '—'} />
        <KpiCard label="生日" value={customer.birthday ? fmtDate(customer.birthday) : '未填寫'} />
        <KpiCard label="累積消費" value={fmtMoney(s.total)} />
        <KpiCard
          label="儲值餘額"
          value={fmtMoney(customer.storedValueBalance)}
          sub={storedValueUsedTotal > 0 ? `目前紀錄裡共扣過 ${fmtMoney(storedValueUsedTotal)}` : undefined}
        />
        <KpiCard label="消費次數" value={s.count} />
        <KpiCard label="平均客單價" value={fmtMoney(s.count ? s.total / s.count : 0)} />
        <KpiCard
          label="回訪狀態"
          value={retentionNote ? (retentionNote.overdue ? '🔔 建議回訪' : '穩定回訪中') : '尚無足夠資料'}
          sub={retentionNote ? `平均每 ${retentionNote.avgGap} 天回訪，預估下次 ${fmtDate(retentionNote.predicted)}` : null}
        />
      </div>

      <div className="panel notes-panel">
        {(store.customerFields || []).some((f) => (customer.customFields || {})[f.id]) && (
          <div className="notes-tags">
            {(store.customerFields || []).map((f) => {
              const val = (customer.customFields || {})[f.id];
              return val ? <span key={f.id} className="tag tag-custom">{f.label}：{val}</span> : null;
            })}
          </div>
        )}
        <p className="notes-text">{customer.notes ? customer.notes : <span className="muted">還沒有備註，點「編輯客戶」新增</span>}</p>
      </div>

      {upcoming.length > 0 && (
        <>
          <h4 className="panel-title" style={{ marginTop: 28 }}>即將到來的服務／預約</h4>
          <ul className="appointment-list">
            {upcoming.map((a) => (
              <li key={a.source + '-' + a.id} className="appointment-card">
                <div className="appointment-time">{a.time ? (<><Clock size={13} /> {a.time}</>) : '未定時間'}</div>
                <div className="appointment-main">
                  <span className="strong">{fmtDate(a.date)}</span>
                  {a.source === 'record' && a.status && <span className={'tier-tag status-' + a.status}>{recordStatusLabel(a.status)}</span>}
                  {a.serviceName && <div className="muted small">{a.serviceName}{a.source === 'record' ? ` ・ ${fmtMoney(a.amount)}` : ''}</div>}
                  {a.notes && <div className="muted small">備註：{a.notes}</div>}
                </div>
                <div className="appointment-actions">
                  <button className="icon-btn ghost" onClick={() => (a.source === 'record' ? onDeleteRecord : onDeleteAppointment)(a.id)}><Trash2 size={14} /></button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      <h4 className="panel-title" style={{ marginTop: 28 }}>服務歷史</h4>
      {s.own.length === 0 ? (
        <EmptyHint text="這位客人還沒有服務紀錄" />
      ) : (
        <ul className="timeline">
          {[...s.own].reverse().map((r) => (
            <li key={r.id} className="timeline-item">
              <div className="timeline-date">{fmtDate(r.date)}</div>
              <div className="timeline-content">
                <div className="timeline-row">
                  <span className="strong">
                    {r.serviceName}
                    {r.priceTier && r.priceTier !== (store.priceTiers[0] && store.priceTiers[0].id) && (
                      <span className={'tier-tag tier-' + r.priceTier}>
                        {tierLabel(store.priceTiers, r.priceTier)}
                      </span>
                    )}
                    {r.status && r.status !== 'confirmed' && (
                      <span className={'tier-tag status-' + r.status}>{recordStatusLabel(r.status)}</span>
                    )}
                  </span>
                  <span className="strong">{fmtMoney(recordTotal(r))}</span>
                </div>
                {r.addons && r.addons.length > 0 && (
                  <div className="muted small">加購：{r.addons.map((a) => `${a.type}${a.description ? '(' + a.description + ')' : ''} ${fmtMoney(a.amount)}`).join('、')}</div>
                )}
                {r.products && r.products.length > 0 && (
                  <div className="muted small">
                    購買產品：{r.products.map((p) => `${p.name} x${p.qty || 1} ${fmtMoney(p.price)}`).join('、')}
                    {r.productDiscount ? ` ・ 產品折扣：${fmtMoney(r.productDiscount)}` : ''}
                  </div>
                )}
                <div className="muted small">
                  付款：{r.paymentMethod}{r.paymentStatus ? `（${paymentStatusLabel(r.paymentStatus)}）` : ''}
                  {r.discount ? ` ・ 服務折扣：${fmtMoney(r.discount)}（原價 ${fmtMoney(r.listPrice)}）` : ''}
                  {r.source ? ` ・ 來源：${r.source}` : ''}
                  {r.notes ? ` ・ 備註：${r.notes}` : ''}
                </div>
                {r.depositPaid && <span className="tag tag-deposit">已收訂金 {fmtMoney(r.depositAmount || 0)}</span>}
              </div>
              <div className="timeline-actions">
                <button className="icon-btn ghost" onClick={() => onEditRecord(r)}><Pencil size={14} /></button>
                <button className="icon-btn ghost" onClick={() => onDeleteRecord(r.id)}><Trash2 size={14} /></button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ============================================================
   回訪提醒（6 週優惠倒數）
   ============================================================ */

function computeRevisitList(data) {
  const list = [];
  data.customers.forEach((c) => {
    const own = data.records.filter((r) => r.customerId === c.id).sort((a, b) => (a.date < b.date ? -1 : 1));
    if (own.length === 0) return;
    const lastDate = own[own.length - 1].date;
    const daysElapsed = daysBetween(lastDate, todayISO());
    if (daysElapsed >= REVISIT_ALERT_START_DAY && daysElapsed <= REVISIT_WINDOW_DAYS) {
      const daysRemaining = REVISIT_WINDOW_DAYS - daysElapsed;
      const alreadyReminded = c.reminderSentFor === lastDate;
      list.push({ customer: c, lastDate, daysElapsed, daysRemaining, alreadyReminded });
    }
  });
  list.sort((a, b) => a.daysRemaining - b.daysRemaining);
  return list;
}

function RevisitView({ data, store, onOpenCustomer, onMarkReminded }) {
  const list = useMemo(() => computeRevisitList(data), [data]);

  return (
    <div>
      <div className="view-head">
        <div>
          <h2 className="serif">回訪提醒</h2>
          <p className="muted">最近一次服務滿 {REVISIT_ALERT_START_DAY} 天起，到優惠期限（{REVISIT_WINDOW_DAYS} 天）前顯示在這裡</p>
          <p className="muted small">※ 超過 {REVISIT_WINDOW_DAYS} 天沒回訪的客人不會出現在這份名單，這是設計上的優惠倒數清單，不是「多久沒來都列出來」的名單</p>
        </div>
      </div>

      {list.length === 0 ? (
        <EmptyHint text="目前沒有客人進入回訪優惠倒數期間" />
      ) : (
        <ul className="revisit-list">
          {list.map((item) => (
            <li key={item.customer.id} className={'revisit-card' + (item.daysRemaining <= 7 ? ' urgent' : '')}>
              <div className="revisit-main">
                <div className="revisit-name-row">
                  <span className="strong">{item.customer.name}</span>
                  {item.alreadyReminded && <span className="badge-reminded">已提醒</span>}
                </div>
                <div className="muted small">
                  {item.customer.phone}{item.customer.lineId ? ` ・ LINE ${item.customer.lineId}` : ''} ・ 最近服務 {fmtDate(item.lastDate)}
                </div>
              </div>
              <div className="revisit-countdown">
                <div className={'countdown-number' + (item.daysRemaining <= 7 ? ' urgent' : '')}>{item.daysRemaining}</div>
                <div className="muted small">天內優惠到期</div>
              </div>
              <div className="revisit-actions">
                <TemplatePickerButton
                  templates={store.messageTemplates}
                  vars={{
                    姓名: item.customer.name,
                    會員編號: item.customer.memberNo,
                    日期: fmtDate(item.lastDate),
                    店名: store.name,
                    地址: store.address,
                    電話: store.phone,
                    IG: store.igHandle,
                    LINE: store.lineId,
                    到期日: fmtDate(addDays(item.lastDate, REVISIT_WINDOW_DAYS)),
                  }}
                  label="複製提醒訊息"
                />
                <button
                  className={'btn-secondary small' + (item.alreadyReminded ? ' active' : '')}
                  onClick={() => onMarkReminded(item.customer.id, item.lastDate, !item.alreadyReminded)}
                >{item.alreadyReminded ? '取消標記' : '標記已提醒'}</button>
                <button className="text-link" onClick={() => onOpenCustomer(item.customer.id)}>查看客戶</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ============================================================
   日曆 / 預約提醒
   ============================================================ */

const CALENDAR_PERIODS = [
  { id: 'day', label: '本日' },
  { id: 'week', label: '本週' },
  { id: 'month', label: '本月' },
];

function AppointmentCardItem({ a, store, onToggleReminded, onDelete, onEdit, onOpenCustomer }) {
  const upcoming = a.date >= todayISO();
  return (
    <li className={'appointment-card' + (a.source === 'record' && !upcoming ? ' is-record' : '')}>
      <div className="appointment-time">
        {a.time ? (<><Clock size={13} /> {a.time}</>) : (upcoming ? '未定時間' : '已完成服務')}
      </div>
      <div className="appointment-main">
        <button className="text-link strong" onClick={() => onOpenCustomer(a.customerId)}>{a.customer.name}</button>
        <span className="muted small"> {a.customer.phone}{a.customer.lineId ? ` ・ LINE ${a.customer.lineId}` : ''}</span>
        {a.source === 'record' && a.status && a.status !== 'confirmed' && (
          <span className={'tier-tag status-' + a.status}>{recordStatusLabel(a.status)}</span>
        )}
        {a.serviceName && <div className="muted small">{a.serviceName}{a.source === 'record' ? ` ・ ${fmtMoney(recordTotal(a))}` : ''}</div>}
        {a.source === 'record' && a.addons && a.addons.length > 0 && (
          <div className="muted small">加購：{a.addons.map((x) => x.type).join('、')}</div>
        )}
        {a.notes && <div className="muted small">備註：{a.notes}</div>}
        {a.source === 'record' && a.depositPaid && <span className="tag tag-deposit">已收訂金 {fmtMoney(a.depositAmount || 0)}</span>}
      </div>
      <div className="appointment-actions">
        {upcoming ? (
          <>
            {a.reminderSent && <span className="badge-reminded">已提醒</span>}
            <TemplatePickerButton
              templates={store.messageTemplates}
              vars={{
                姓名: a.customer.name,
                會員編號: a.customer.memberNo,
                日期: fmtDate(a.date),
                時間: a.time || '',
                店名: store.name,
                地址: store.address,
                電話: store.phone,
                IG: store.igHandle,
                LINE: store.lineId,
              }}
              label="複製提醒訊息"
            />
            <button className={'btn-secondary small' + (a.reminderSent ? ' active' : '')} onClick={() => onToggleReminded(a)}>
              {a.reminderSent ? '取消標記' : '標記已提醒'}
            </button>
            {a.source === 'record' && onEdit && <button className="icon-btn ghost" onClick={() => onEdit(a)}><Pencil size={14} /></button>}
            <button className="icon-btn ghost" onClick={() => onDelete(a)}><Trash2 size={14} /></button>
          </>
        ) : (
          <>
            <span className="source-badge">已完成</span>
            {a.source === 'record' && onEdit && <button className="icon-btn ghost" onClick={() => onEdit(a)}><Pencil size={14} /></button>}
            <button className="icon-btn ghost" onClick={() => onDelete(a)}><Trash2 size={14} /></button>
          </>
        )}
      </div>
    </li>
  );
}

function CalendarView({ data, store, onAddRecord, onEditRecord, onDeleteRecord, onDeleteAppointment, onToggleRecordReminded, onToggleAppointmentReminded, onOpenCustomer }) {
  const [period, setPeriod] = useState('week');
  const [monthCursor, setMonthCursor] = useState(new Date());
  const [selectedDay, setSelectedDay] = useState(todayISO());

  const range = useMemo(() => {
    if (period === 'month') {
      return {
        start: toLocalISO(new Date(monthCursor.getFullYear(), monthCursor.getMonth(), 1)),
        end: toLocalISO(new Date(monthCursor.getFullYear(), monthCursor.getMonth() + 1, 0)),
      };
    }
    return getCalendarRange(period);
  }, [period, monthCursor]);

  const items = useMemo(() => {
    const apptItems = data.appointments
      .filter((a) => a.date >= range.start && a.date <= range.end)
      .map((a) => ({ ...a, source: 'appointment', customer: data.customers.find((c) => c.id === a.customerId) }));
    const recordItems = data.records
      .filter((r) => r.date >= range.start && r.date <= range.end)
      .map((r) => ({ ...r, source: 'record', customer: data.customers.find((c) => c.id === r.customerId) }));
    return [...apptItems, ...recordItems]
      .filter((a) => a.customer)
      .sort((a, b) => {
        if (a.date !== b.date) return a.date < b.date ? -1 : 1;
        return (a.time || '').localeCompare(b.time || '');
      });
  }, [data.appointments, data.records, data.customers, range.start, range.end]);

  const grouped = useMemo(() => {
    const map = {};
    items.forEach((a) => { (map[a.date] = map[a.date] || []).push(a); });
    return Object.entries(map).sort((a, b) => (a[0] < b[0] ? -1 : 1));
  }, [items]);

  const groupedMap = useMemo(() => Object.fromEntries(grouped), [grouped]);

  const totalCount = items.length;
  const grid = useMemo(() => buildMonthGrid(monthCursor), [monthCursor]);
  const monthLabel = monthCursor.toLocaleDateString('zh-TW', { year: 'numeric', month: 'long' });
  const selectedList = grouped.find(([d]) => d === selectedDay)?.[1] || [];

  const handleToggle = (item) => {
    const fn = item.source === 'record' ? onToggleRecordReminded : onToggleAppointmentReminded;
    fn(item.id, !item.reminderSent);
  };
  const handleDelete = (item) => {
    const fn = item.source === 'record' ? onDeleteRecord : onDeleteAppointment;
    fn(item.id);
  };

  const goPrevMonth = () => { setMonthCursor(new Date(monthCursor.getFullYear(), monthCursor.getMonth() - 1, 1)); setSelectedDay(null); };
  const goNextMonth = () => { setMonthCursor(new Date(monthCursor.getFullYear(), monthCursor.getMonth() + 1, 1)); setSelectedDay(null); };
  const goThisMonth = () => { setMonthCursor(new Date()); setSelectedDay(todayISO()); };

  return (
    <div>
      <div className="view-head">
        <div>
          <h2 className="serif">日曆</h2>
          <p className="muted">
            {period === 'month'
              ? monthLabel
              : `${fmtDate(range.start)}${range.start !== range.end ? ` — ${fmtDate(range.end)}` : ''}`
            } ・ 共 {totalCount} 筆（服務／預約紀錄）
          </p>
        </div>
        <div className="calendar-head-actions">
          <div className="period-tabs">
            {CALENDAR_PERIODS.map((p) => (
              <button
                key={p.id}
                className={'period-tab' + (period === p.id ? ' active' : '')}
                onClick={() => setPeriod(p.id)}
              >{p.label}</button>
            ))}
          </div>
          <button className="btn-primary" onClick={onAddRecord}><Plus size={16} /> 新增服務／預約</button>
        </div>
      </div>

      <p className="calendar-hint muted small">新增服務紀錄時填的日期（跟選填的時間），會自動顯示在這裡，不用重複輸入。</p>

      {period === 'month' ? (
        <>
          <div className="month-nav">
            <button className="icon-btn ghost" onClick={goPrevMonth}><ChevronLeft size={18} /></button>
            <span className="month-nav-label">{monthLabel}</span>
            <button className="icon-btn ghost" onClick={goNextMonth}><ChevronRight size={18} /></button>
            <button className="text-link" onClick={goThisMonth}>回到本月</button>
          </div>

          <div className="month-grid-wrap">
            <div className="month-grid-header">
              {WEEKDAY_LABELS.map((w) => <div key={w} className="month-grid-header-cell">{w}</div>)}
            </div>
            <div className="month-grid">
              {grid.map((date, i) => {
                if (!date) return <div key={'empty-' + i} className="month-cell empty" />;
                const list = groupedMap[date] || [];
                const dayNum = Number(date.slice(8, 10));
                return (
                  <button
                    key={date}
                    className={'month-cell' + (date === todayISO() ? ' today' : '') + (date === selectedDay ? ' selected' : '')}
                    onClick={() => setSelectedDay(date)}
                  >
                    <span className="month-cell-day">{dayNum}</span>
                    {list.length > 0 && (
                      <div className="month-cell-preview">
                        {list.slice(0, 2).map((a) => (
                          <span key={a.source + '-' + a.id} className="month-cell-chip">
                            {a.time ? a.time + ' ' : ''}{a.customer.name}
                          </span>
                        ))}
                        {list.length > 2 && <span className="month-cell-more">+{list.length - 2} 筆</span>}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          <h4 className="panel-title" style={{ marginTop: 22 }}>
            {selectedDay ? `${fmtDate(selectedDay)}（週${WEEKDAY_LABELS[new Date(selectedDay + 'T00:00:00').getDay()]}）的安排` : '點選日期查看當天安排'}
          </h4>
          {!selectedDay ? (
            <EmptyHint text="點選上方日期查看當天的服務／預約" />
          ) : selectedList.length === 0 ? (
            <EmptyHint text="這天還沒有安排" />
          ) : (
            <ul className="appointment-list">
              {selectedList.map((a) => (
                <AppointmentCardItem
                  key={a.source + '-' + a.id}
                  a={a}
                  store={store}
                  onToggleReminded={handleToggle}
                  onDelete={handleDelete}
                  onEdit={(item) => onEditRecord(item)}
                  onOpenCustomer={onOpenCustomer}
                />
              ))}
            </ul>
          )}
        </>
      ) : grouped.length === 0 ? (
        <EmptyHint text="這段期間還沒有預約或服務紀錄" />
      ) : (
        <div className="calendar-groups">
          {grouped.map(([date, list]) => (
            <div key={date} className="calendar-day-group">
              <h4 className="calendar-day-heading">{fmtDate(date)}（週{WEEKDAY_LABELS[new Date(date + 'T00:00:00').getDay()]}）</h4>
              <ul className="appointment-list">
                {list.map((a) => (
                  <AppointmentCardItem
                    key={a.source + '-' + a.id}
                    a={a}
                    store={store}
                    onToggleReminded={handleToggle}
                    onDelete={handleDelete}
                    onEdit={(item) => onEditRecord(item)}
                    onOpenCustomer={onOpenCustomer}
                  />
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ============================================================
   新增服務紀錄
   ============================================================ */

function CustomerQuickPreview({ customer, records, store }) {
  const own = records.filter((r) => r.customerId === customer.id).sort((a, b) => (a.date < b.date ? 1 : -1));
  const recent = own.slice(0, 3);
  const customerFields = store?.customerFields || [];

  return (
    <div className="quick-preview">
      {customerFields.some((f) => (customer.customFields || {})[f.id]) && (
        <div className="notes-tags">
          {customerFields.map((f) => {
            const val = (customer.customFields || {})[f.id];
            return val ? <span key={f.id} className="tag tag-custom">{f.label}：{val}</span> : null;
          })}
        </div>
      )}

      {customer.notes && <p className="quick-preview-notes">備註：{customer.notes}</p>}

      {recent.length === 0 ? (
        <p className="muted small">這是這位客人的第一筆服務紀錄</p>
      ) : (
        <ul className="quick-preview-list">
          {recent.map((r) => (
            <li key={r.id}>
              <span className="muted small">{fmtDate(r.date)}</span>
              <span className="small">{r.serviceName}</span>
              <span className="muted small">{fmtMoney(recordTotal(r))}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const ADDON_TYPES = ['敷膜', '面膜', '其他'];
const DISCOUNT_PRESETS = [95, 90, 85, 80, 75, 70];

function AddRecordModal({ data, store, prefillCustomerId, record, onClose, onSave, onQuickAddCustomer }) {
  const priceTiers = store.priceTiers;
  const trialTier = priceTiers.find((t) => t.trialDefault) || null;
  const isEditing = !!record;
  const [customerId, setCustomerId] = useState((record && record.customerId) || prefillCustomerId || '');
  const [customerQuery, setCustomerQuery] = useState('');
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [quickName, setQuickName] = useState('');
  const [quickPhone, setQuickPhone] = useState('');

  const [date, setDate] = useState((record && record.date) || todayISO());
  const [time, setTime] = useState((record && record.time) || '');
  const [serviceId, setServiceId] = useState((record && record.serviceId) || '');
  const [listPrice, setListPrice] = useState(record ? String(record.listPrice) : '');
  const [hasDiscount, setHasDiscount] = useState(record ? !!record.discount : false);
  const [discountAmount, setDiscountAmount] = useState(record && record.discount ? String(record.discount) : '');
  const [priceTier, setPriceTier] = useState((record && record.priceTier) || priceTiers[0].id);
  const [paymentMethod, setPaymentMethod] = useState((record && record.paymentMethod) || PAYMENT_METHODS[0]);
  const [source, setSource] = useState(() => {
    const s = record && record.source;
    if (!s) return '回訪';
    return data.sources.includes(s) ? s : '其他';
  });
  const [otherSource, setOtherSource] = useState(() => {
    const s = record && record.source;
    return s && s !== '回訪' && !data.sources.includes(s) ? s : '';
  });
  const [notes, setNotes] = useState((record && record.notes) || '');
  const [addons, setAddons] = useState((record && record.addons) || []);
  const [productQtys, setProductQtys] = useState(() => {
    const map = {};
    (record && record.products || []).forEach((p) => { map[p.id] = p.qty || 1; });
    return map;
  });
  const [hasProductDiscount, setHasProductDiscount] = useState(record ? !!record.productDiscount : false);
  const [productDiscountAmount, setProductDiscountAmount] = useState(record && record.productDiscount ? String(record.productDiscount) : '');
  const [depositAmount, setDepositAmount] = useState(record && record.depositAmount ? String(record.depositAmount) : '');
  const [status, setStatus] = useState((record && record.status) || 'confirmed');
  const [paymentStatus, setPaymentStatus] = useState((record && record.paymentStatus) || 'paid_full');

  const activeServices = data.services.filter((s) => s.active);
  const selectedService = activeServices.find((s) => s.id === serviceId);
  const priceAutoFillRef = useRef(!isEditing); // 編輯模式下第一次不自動覆蓋已帶入的價格

  const isFirstTime = useMemo(() => {
    if (!customerId) return false;
    return !data.records.some((r) => r.customerId === customerId && r.id !== (record ? record.id : null));
  }, [customerId, data.records, record]);

  const daysSinceLast = useMemo(() => {
    if (!customerId || isFirstTime) return null;
    const own = data.records.filter((r) => r.customerId === customerId && r.id !== (record ? record.id : null)).sort((a, b) => (a.date < b.date ? -1 : 1));
    if (own.length === 0) return null;
    return daysBetween(own[own.length - 1].date, todayISO());
  }, [customerId, isFirstTime, data.records, record]);

  // 客人選定後，依「首次消費 / 老客人」自動預選合理的價格方案（編輯模式不覆蓋，因為方案已經存在紀錄裡）
  // 只有店家有設定「首次體驗預設方案」時才會自動切到那個方案，沒設定的店就一律用第一個方案。
  useEffect(() => {
    if (!customerId || isEditing) return;
    setPriceTier(isFirstTime && trialTier ? trialTier.id : priceTiers[0].id);
  }, [customerId, isFirstTime, isEditing]);

  // 服務項目或價格方案改變時，自動帶入對應價格；編輯模式的第一次不覆蓋已存在的原始價格
  useEffect(() => {
    if (!selectedService) return;
    if (!priceAutoFillRef.current) {
      priceAutoFillRef.current = true;
      return;
    }
    const val = (selectedService.prices || {})[priceTier];
    setListPrice(val !== undefined && val !== null ? String(val) : '');
  }, [serviceId, priceTier]);

  const custMatches = useMemo(() => {
    const term = customerQuery.trim().toLowerCase();
    if (!term) return [];
    return data.customers.filter((c) =>
      c.name.toLowerCase().includes(term) ||
      (c.phone || '').includes(term) ||
      (c.memberNo || '').toLowerCase().includes(term)
    ).slice(0, 6);
  }, [customerQuery, data.customers]);

  const chosenCustomer = data.customers.find((c) => c.id === customerId);

  const selectService = (id) => setServiceId(id);

  const addAddonLine = () => {
    setAddons([...addons, { id: uid(), type: ADDON_TYPES[0], description: '', amount: '' }]);
  };
  const updateAddonLine = (id, field, value) => {
    setAddons(addons.map((a) => (a.id === id ? { ...a, [field]: value } : a)));
  };
  const removeAddonLine = (id) => {
    setAddons(addons.filter((a) => a.id !== id));
  };
  const addonSum = addons.reduce((s, a) => s + Number(a.amount || 0), 0);

  const storeProducts = store.products || [];
  const toggleProduct = (id) => {
    setProductQtys((prev) => {
      const next = { ...prev };
      if (next[id]) delete next[id]; else next[id] = 1;
      return next;
    });
  };
  const setProductQty = (id, qty) => {
    setProductQtys((prev) => ({ ...prev, [id]: qty }));
  };
  const selectedProducts = storeProducts
    .filter((p) => productQtys[p.id])
    .map((p) => ({ id: p.id, name: p.name, price: p.price, qty: Number(productQtys[p.id]) || 1 }));
  const productsSum = selectedProducts.reduce((s, p) => s + Number(p.price || 0) * Number(p.qty || 1), 0);

  // 服務折扣跟產品折扣分開算，因為有些店家只想打服務的折扣、有些只想打產品的折扣，
  // 兩個混在一起容易搞混是折在哪裡。
  const applyDiscountPreset = (pct) => {
    setDiscountAmount(String(Math.round(Number(listPrice || 0) * (1 - pct / 100))));
  };
  const applyProductDiscountPreset = (pct) => {
    setProductDiscountAmount(String(Math.round(productsSum * (1 - pct / 100))));
  };

  const discountApplied = hasDiscount ? Math.min(Number(discountAmount || 0), Number(listPrice || 0)) : 0;
  const productDiscountApplied = hasProductDiscount ? Math.min(Number(productDiscountAmount || 0), productsSum) : 0;
  const finalAmount = Math.max(0, Number(listPrice || 0) - discountApplied);
  const productsFinal = Math.max(0, productsSum - productDiscountApplied);
  const grandTotal = finalAmount + productsFinal + addonSum;

  const canSubmit = customerId && (serviceId ? listPrice !== '' : selectedProducts.length > 0);

  const submit = () => {
    if (!canSubmit) return;
    onSave({
      id: isEditing ? record.id : uid(),
      customerId,
      date,
      time,
      serviceId,
      serviceName: selectedService ? selectedService.name : '（僅購買產品）',
      listPrice: serviceId ? Number(listPrice) : 0,
      priceTier,
      discount: discountApplied,
      amount: finalAmount,
      addons: addons
        .filter((a) => a.amount !== '' && Number(a.amount) > 0)
        .map((a) => ({ id: a.id, type: a.type, description: a.description.trim(), amount: Number(a.amount) })),
      products: selectedProducts,
      productDiscount: productDiscountApplied,
      depositPaid: paymentStatus === 'deposit_only',
      depositAmount: paymentStatus === 'deposit_only' ? Number(depositAmount || 0) : 0,
      paymentMethod,
      status,
      paymentStatus,
      source: isFirstTime ? (source === '其他' && otherSource.trim() ? otherSource.trim() : source) : '回訪',
      notes: notes.trim(),
      reminderSent: isEditing ? (record.reminderSent || false) : false,
    });
  };

  const [quickAddBusy, setQuickAddBusy] = useState(false);
  const quickAddSubmit = async () => {
    if (!quickName.trim() || !quickPhone.trim() || quickAddBusy) return;
    setQuickAddBusy(true);
    try {
      const newCust = await onQuickAddCustomer({ name: quickName.trim(), phone: quickPhone.trim(), source });
      // 這個 setTimeout 不是隨便加的：本機存檔幾乎是同步完成，如果緊接著在這個
      // click 事件裡就切換畫面（搜尋框換成「更換」按鈕），瀏覽器有時會把同一次
      // 點擊的 mouseup 誤判成點在新出現的「更換」按鈕上，導致選好的客人又被清掉。
      // 延一個 tick 讓這次點擊事件完全處理完，再切換畫面就不會有這個問題。
      await new Promise((r) => setTimeout(r, 0));
      setCustomerId(newCust.id);
      setCustomerQuery('');
      setShowQuickAdd(false);
    } finally {
      setQuickAddBusy(false);
    }
  };

  return (
    <Modal title={isEditing ? '編輯服務／預約紀錄' : '新增服務／預約紀錄'} onClose={onClose} wide>
      <Field label="客人">
        {chosenCustomer ? (
          <>
            <div className="chosen-customer">
              <span className="strong">{chosenCustomer.name}</span>
              <span className="muted small">{chosenCustomer.phone}</span>
              {!isEditing && <button className="text-link" onClick={() => setCustomerId('')}>更換</button>}
            </div>
            <CustomerQuickPreview customer={chosenCustomer} records={data.records} store={store} />
          </>
        ) : (
          <>
            <input
              placeholder="輸入姓名、電話或會員編號搜尋"
              value={customerQuery}
              onChange={(e) => setCustomerQuery(e.target.value)}
              autoFocus
            />
            {custMatches.length > 0 && (
              <ul className="autocomplete">
                {custMatches.map((c) => (
                  <li
                    key={c.id}
                    onMouseDown={(e) => { e.preventDefault(); setCustomerId(c.id); setCustomerQuery(''); }}
                  >
                    <span className="strong">{c.name}</span> <span className="muted small">{c.memberNo} ・ {c.phone}</span>
                  </li>
                ))}
              </ul>
            )}
            {customerQuery.trim() && custMatches.length === 0 && !showQuickAdd && (
              <button className="text-link" onClick={() => { setShowQuickAdd(true); setQuickName(customerQuery); }}>
                找不到「{customerQuery}」，點此快速新增客人
              </button>
            )}
            {showQuickAdd && (
              <div className="quick-add-box">
                <input placeholder="姓名" value={quickName} onChange={(e) => setQuickName(e.target.value)} />
                <input placeholder="手機" value={quickPhone} onChange={(e) => setQuickPhone(e.target.value)} />
                <button className="btn-secondary small" onClick={quickAddSubmit} disabled={quickAddBusy}>{quickAddBusy ? '建立中⋯' : '建立客人'}</button>
              </div>
            )}
          </>
        )}
      </Field>

      <Field label="服務日期" hint="時間預約可填，現場服務可留空">
        <div className="date-time-group">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </div>
      </Field>

      <Field label="服務項目" hint={storeProducts.length > 0 ? '只買產品、沒有服務項目的話可以留空' : undefined}>
        <select value={serviceId} onChange={(e) => selectService(e.target.value)}>
          <option value="">請選擇</option>
          {activeServices.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </Field>

      {selectedService && priceTiers.length > 1 && (
        <Field label="價格方案">
          <div className="pill-group">
            {priceTiers.map((t) => (
              <button
                key={t.id}
                type="button"
                className={'pill' + (priceTier === t.id ? ' active' : '')}
                onClick={() => setPriceTier(t.id)}
              >{t.label}（{fmtMoney((selectedService.prices || {})[t.id])}）</button>
            ))}
          </div>
          {isFirstTime && <span className="field-hint">首次消費，請選擇合適的價格方案</span>}
          {!isFirstTime && daysSinceLast !== null && daysSinceLast <= REVISIT_WINDOW_DAYS && (
            <span className="field-hint">距離上次服務 {daysSinceLast} 天，仍在 6 週回訪優惠期內</span>
          )}
          {!isFirstTime && daysSinceLast !== null && daysSinceLast > REVISIT_WINDOW_DAYS && (
            <span className="field-hint">距離上次服務 {daysSinceLast} 天，已超過 6 週，建議選「{priceTiers[0].label}」</span>
          )}
        </Field>
      )}

      <div className="field-row">
        <Field label="實際價格" hint="選好方案會自動帶入，也可以手動微調">
          <input type="number" value={listPrice} onChange={(e) => setListPrice(e.target.value)} />
        </Field>
        <Field label="付款方式">
          <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
            {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </Field>
      </div>

      <div className="field-row">
        <Field label="預約狀態">
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            {RECORD_STATUS_OPTIONS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </Field>
        <Field
          label="付款狀態"
          hint={paymentStatus === 'stored_value' && chosenCustomer
            ? `目前餘額 ${fmtMoney(chosenCustomer.storedValueBalance)}，扣款後剩 ${fmtMoney(chosenCustomer.storedValueBalance - grandTotal)}`
            : undefined}
        >
          <select value={paymentStatus} onChange={(e) => setPaymentStatus(e.target.value)}>
            {PAYMENT_STATUS_OPTIONS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </Field>
      </div>

      {paymentStatus === 'deposit_only' && (
        <Field label="訂金金額" hint="選填，沒填金額也會標示已收訂金">
          <input type="number" value={depositAmount} onChange={(e) => setDepositAmount(e.target.value)} placeholder="0" />
        </Field>
      )}

      <label className="checkbox-row">
        <input type="checkbox" checked={hasDiscount} onChange={(e) => setHasDiscount(e.target.checked)} />
        服務有折扣金額
      </label>

      {hasDiscount && (
        <Field
          label="服務折扣金額"
          hint={store.discountPresetsEnabled ? '這裡的折扣只算在服務金額上，不影響購買產品' : undefined}
        >
          {store.discountPresetsEnabled && (
            <div className="pill-group" style={{ marginBottom: 8 }}>
              {DISCOUNT_PRESETS.map((pct) => (
                <button key={pct} type="button" className="pill" onClick={() => applyDiscountPreset(pct)}>
                  {pct / 10} 折
                </button>
              ))}
            </div>
          )}
          <input type="number" value={discountAmount} onChange={(e) => setDiscountAmount(e.target.value)} placeholder="0" />
        </Field>
      )}

      {storeProducts.length > 0 && (
        <div className="addon-section">
          <div className="addon-header">
            <span className="field-label">購買產品（非加購）</span>
          </div>
          <div className="addon-list">
            {storeProducts.map((p) => (
              <div className="product-row" key={p.id}>
                <label className="product-row-label">
                  <input type="checkbox" checked={!!productQtys[p.id]} onChange={() => toggleProduct(p.id)} />
                  <span>{p.name}（{fmtMoney(p.price)}）</span>
                </label>
                {productQtys[p.id] ? (
                  <input
                    type="number"
                    min="1"
                    value={productQtys[p.id]}
                    onChange={(e) => setProductQty(p.id, e.target.value)}
                    className="product-row-qty"
                  />
                ) : null}
              </div>
            ))}
          </div>

          <label className="checkbox-row">
            <input type="checkbox" checked={hasProductDiscount} onChange={(e) => setHasProductDiscount(e.target.checked)} />
            產品有折扣金額
          </label>
          {hasProductDiscount && (
            <Field
              label="產品折扣金額"
              hint={store.discountPresetsEnabled ? '這裡的折扣只算在購買產品上，不影響服務金額' : undefined}
            >
              {store.discountPresetsEnabled && (
                <div className="pill-group" style={{ marginBottom: 8 }}>
                  {DISCOUNT_PRESETS.map((pct) => (
                    <button key={pct} type="button" className="pill" onClick={() => applyProductDiscountPreset(pct)}>
                      {pct / 10} 折
                    </button>
                  ))}
                </div>
              )}
              <input type="number" value={productDiscountAmount} onChange={(e) => setProductDiscountAmount(e.target.value)} placeholder="0" />
            </Field>
          )}
        </div>
      )}

      <div className="addon-section">
        <div className="addon-header">
          <span className="field-label">加購項目（敷膜／面膜等）</span>
          <button type="button" className="text-link" onClick={addAddonLine}>+ 新增加購</button>
        </div>
        {addons.length > 0 && (
          <div className="addon-list">
            {addons.map((a) => (
              <div className="addon-row" key={a.id}>
                <select value={a.type} onChange={(e) => updateAddonLine(a.id, 'type', e.target.value)}>
                  {ADDON_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
                <input placeholder="說明（選填）" value={a.description} onChange={(e) => updateAddonLine(a.id, 'description', e.target.value)} />
                <input type="number" placeholder="金額" value={a.amount} onChange={(e) => updateAddonLine(a.id, 'amount', e.target.value)} />
                <button type="button" className="icon-btn ghost" onClick={() => removeAddonLine(a.id)}><X size={14} /></button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="final-amount-row breakdown">
        <div className="final-amount-line"><span className="muted">服務金額</span><span>{fmtMoney(finalAmount)}</span></div>
        {addonSum > 0 && <div className="final-amount-line"><span className="muted">加購金額</span><span>{fmtMoney(addonSum)}</span></div>}
        {productsSum > 0 && <div className="final-amount-line"><span className="muted">產品金額</span><span>{fmtMoney(productsFinal)}</span></div>}
        <div className="final-amount-line total"><span className="strong">總金額</span><span className="strong">{fmtMoney(grandTotal)}</span></div>
      </div>

      {isFirstTime && (
        <>
          <Field label="客戶來源" hint="這是這位客人的第一筆消費">
            <select value={source} onChange={(e) => setSource(e.target.value)}>
              {data.sources.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
          {source === '其他' && (
            <Field label="請說明其他來源（選填）">
              <input value={otherSource} onChange={(e) => setOtherSource(e.target.value)} placeholder="例如：路過看到招牌" />
            </Field>
          )}
        </>
      )}

      <Field label="備註"><textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>

      <div className="modal-actions">
        <button className="btn-primary full" disabled={!canSubmit} onClick={submit}>{isEditing ? '儲存修改' : '完成服務'}</button>
      </div>
    </Modal>
  );
}

/* ============================================================
   服務項目管理
   ============================================================ */

function ServicesView({ data, store, onSave, onDelete }) {
  const [editing, setEditing] = useState(null); // service object or 'new'
  const priceTiers = store.priceTiers;

  return (
    <div>
      <div className="view-head">
        <div>
          <h2 className="serif">服務項目</h2>
          <p className="muted">調整價格不會影響過去已完成的服務紀錄</p>
        </div>
        <button className="btn-primary" onClick={() => setEditing('new')}><Plus size={16} /> 新增項目</button>
      </div>

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>項目</th><th>分類</th>
              {priceTiers.map((t) => <th key={t.id}>{t.label}</th>)}
              <th>時間</th><th>狀態</th><th></th>
            </tr>
          </thead>
          <tbody>
            {data.services.map((s) => (
              <tr key={s.id}>
                <td className="strong">{s.name}</td>
                <td>{s.category}</td>
                {priceTiers.map((t) => <td key={t.id}>{fmtMoney((s.prices || {})[t.id])}</td>)}
                <td>{s.duration} 分</td>
                <td>{s.active ? '啟用' : '停用'}</td>
                <td>
                  <button className="icon-btn ghost" onClick={() => setEditing(s)}><Pencil size={14} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <ServiceFormModal
          store={store}
          service={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSave={(s) => { onSave(s); setEditing(null); }}
          onDelete={editing !== 'new' ? () => { onDelete(editing.id); setEditing(null); } : null}
        />
      )}
    </div>
  );
}

function ServiceFormModal({ store, service, onClose, onSave, onDelete }) {
  const priceTiers = store.priceTiers;
  const [name, setName] = useState(service?.name || '');
  const [category, setCategory] = useState(service?.category || '');
  const [prices, setPrices] = useState(() => {
    const init = {};
    priceTiers.forEach((t) => { init[t.id] = service?.prices?.[t.id] ?? ''; });
    return init;
  });
  const [duration, setDuration] = useState(service?.duration ? String(service.duration) : '');
  const [active, setActive] = useState(service ? service.active !== false : true);

  const setPrice = (tierId) => (e) => setPrices({ ...prices, [tierId]: e.target.value });

  const submit = () => {
    if (!name.trim()) return;
    const priceValues = {};
    priceTiers.forEach((t) => { priceValues[t.id] = Number(prices[t.id]) || 0; });
    onSave({
      id: service ? service.id : uid(),
      name: name.trim(),
      category: category.trim(),
      prices: priceValues,
      duration: Number(duration) || 0,
      active,
    });
  };

  return (
    <Modal title={service ? '編輯服務項目' : '新增服務項目'} onClose={onClose}>
      <Field label="項目名稱"><input value={name} onChange={(e) => setName(e.target.value)} autoFocus /></Field>
      <Field label="分類"><input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="例如：腿部 / 臉部" /></Field>
      {priceTiers.map((t) => (
        <Field key={t.id} label={t.label}>
          <input type="number" value={prices[t.id]} onChange={setPrice(t.id)} />
        </Field>
      ))}
      <Field label="操作時間（分）"><input type="number" value={duration} onChange={(e) => setDuration(e.target.value)} /></Field>
      <label className="checkbox-row">
        <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
        啟用中（客人可預約 / 新增紀錄時可選擇）
      </label>
      <div className="modal-actions">
        {onDelete && <button className="btn-danger" onClick={onDelete}><Trash2 size={14} /> 刪除</button>}
        <button className="btn-primary full" onClick={submit}>儲存</button>
      </div>
    </Modal>
  );
}

/* ============================================================
   成本管理
   ============================================================ */

function ExpensesView({ data, onSave, onDelete }) {
  const [expenseModal, setExpenseModal] = useState(null); // null | 'new' | expense object
  const [period, setPeriod] = useState('month');
  const [customStart, setCustomStart] = useState(todayISO());
  const [customEnd, setCustomEnd] = useState(todayISO());
  const [compareStart, setCompareStart] = useState('');
  const [compareEnd, setCompareEnd] = useState('');

  const sorted = [...data.expenses].sort((a, b) => (a.date < b.date ? 1 : -1));
  const total = data.expenses.reduce((s, e) => s + Number(e.amount), 0);

  const byCategory = useMemo(() => {
    const map = {};
    EXPENSE_CATEGORIES.forEach((c) => { map[c.name] = 0; });
    data.expenses.forEach((e) => { map[e.category] = (map[e.category] || 0) + Number(e.amount || 0); });
    return EXPENSE_CATEGORIES.map((c) => ({ name: c.name, total: map[c.name] || 0 }));
  }, [data.expenses]);

  const range = getRangeDates(period, customStart, customEnd);

  const periodCompare = useMemo(() => {
    const useManual = period === 'custom' && compareStart && compareEnd;
    const prevRange = useManual ? { start: compareStart, end: compareEnd } : shiftRangeByPeriod(period, range, customStart, customEnd);
    const sumByCategory = (r) => {
      const map = {};
      EXPENSE_CATEGORIES.forEach((c) => { map[c.name] = 0; });
      data.expenses
        .filter((e) => e.date >= r.start && e.date <= r.end)
        .forEach((e) => { map[e.category] = (map[e.category] || 0) + Number(e.amount || 0); });
      return map;
    };
    const currMap = sumByCategory(range);
    const prevMap = sumByCategory(prevRange);
    const currTotal = Object.values(currMap).reduce((a, b) => a + b, 0);
    const prevTotal = Object.values(prevMap).reduce((a, b) => a + b, 0);
    const rows = EXPENSE_CATEGORIES.map((c) => ({ label: c.name, curr: currMap[c.name], prev: prevMap[c.name] }));
    const currLabel = period === 'custom' ? `${fmtDate(range.start)}–${fmtDate(range.end)}` : PERIODS.find((p) => p.id === period).label;
    const prevLabel = period === 'custom' ? `${fmtDate(prevRange.start)}–${fmtDate(prevRange.end)}` : PREV_PERIOD_LABEL[period];
    return { currLabel, prevLabel, currTotal, prevTotal, rows };
  }, [data.expenses, period, range.start, range.end, customStart, customEnd, compareStart, compareEnd]);

  return (
    <div>
      <div className="view-head">
        <div>
          <h2 className="serif">成本</h2>
          <p className="muted">累積支出 {fmtMoney(total)}</p>
        </div>
        <button className="btn-primary" onClick={() => setExpenseModal('new')}><Plus size={16} /> 新增支出</button>
      </div>

      <div className="period-tabs" style={{ marginBottom: 14 }}>
        {PERIODS.map((p) => (
          <button
            key={p.id}
            className={'period-tab' + (period === p.id ? ' active' : '')}
            onClick={() => setPeriod(p.id)}
          >{p.label}</button>
        ))}
      </div>

      {period === 'custom' && (
        <div className="custom-range">
          <input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} />
          <span className="muted">至</span>
          <input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} />
        </div>
      )}

      {period === 'custom' && (
        <div className="custom-range compare-range">
          <span className="muted small">比較期間</span>
          <input type="date" value={compareStart} onChange={(e) => setCompareStart(e.target.value)} />
          <span className="muted">至</span>
          <input type="date" value={compareEnd} onChange={(e) => setCompareEnd(e.target.value)} />
          <span className="muted small">留空則自動抓等長的前一段期間</span>
        </div>
      )}

      <div className="panel" style={{ marginBottom: 24 }}>
        <h4 className="panel-title">{periodCompare.currLabel} vs {periodCompare.prevLabel}</h4>
        <table className="compare-table">
          <thead>
            <tr><th></th><th>{periodCompare.currLabel}</th><th>{periodCompare.prevLabel}</th><th>成長率</th></tr>
          </thead>
          <tbody>
            <tr>
              <td className="strong">支出總額</td>
              <td className="strong">{fmtMoney(periodCompare.currTotal)}</td>
              <td className="muted">{fmtMoney(periodCompare.prevTotal)}</td>
              {(() => {
                const change = pctChange(periodCompare.currTotal, periodCompare.prevTotal);
                const positive = change !== null && change >= 0;
                return (
                  <td className={change === null ? 'muted' : positive ? 'change-down' : 'change-up'}>
                    {change === null ? '—' : `${positive ? '+' : ''}${change.toFixed(0)}%`}
                  </td>
                );
              })()}
            </tr>
            {periodCompare.rows.map((r) => {
              const change = pctChange(r.curr, r.prev);
              const positive = change !== null && change >= 0;
              return (
                <tr key={r.label}>
                  <td className="muted">{r.label}</td>
                  <td>{fmtMoney(r.curr)}</td>
                  <td className="muted">{fmtMoney(r.prev)}</td>
                  <td className={change === null ? 'muted' : positive ? 'change-down' : 'change-up'}>
                    {change === null ? '—' : `${positive ? '+' : ''}${change.toFixed(0)}%`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <h4 className="panel-title">各分類累積花費</h4>
      <div className="category-summary-grid">
        {byCategory.map((c) => (
          <div className="category-summary-card" key={c.name}>
            <div className="kpi-label">{c.name}</div>
            <div className="kpi-value small">{fmtMoney(c.total)}</div>
          </div>
        ))}
      </div>

      <h4 className="panel-title" style={{ marginTop: 24 }}>支出明細</h4>
      {sorted.length === 0 ? (
        <EmptyHint text="還沒有成本紀錄" />
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th>日期</th><th>分類</th><th>項目</th><th>金額</th><th>付款方式</th><th></th></tr></thead>
            <tbody>
              {sorted.map((e) => (
                <tr key={e.id}>
                  <td>{fmtDate(e.date)}</td>
                  <td>{e.category}</td>
                  <td>{e.item}</td>
                  <td>{fmtMoney(e.amount)}</td>
                  <td>{e.paymentMethod}</td>
                  <td>
                    <button className="icon-btn ghost" onClick={() => setExpenseModal(e)}><Pencil size={14} /></button>
                    <button className="icon-btn ghost" onClick={() => onDelete(e.id)}><Trash2 size={14} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {expenseModal && (
        <ExpenseFormModal
          expense={expenseModal === 'new' ? null : expenseModal}
          onClose={() => setExpenseModal(null)}
          onSave={(e) => { onSave(e); setExpenseModal(null); }}
        />
      )}
    </div>
  );
}

function ExpenseFormModal({ expense, onClose, onSave }) {
  const isEditing = !!expense;
  const [category, setCategory] = useState(expense ? expense.category : EXPENSE_CATEGORIES[0].name);
  const [date, setDate] = useState(expense ? expense.date : todayISO());
  const [item, setItem] = useState(expense ? expense.item : '');
  const [amount, setAmount] = useState(expense ? String(expense.amount) : '');
  const [paymentMethod, setPaymentMethod] = useState(expense ? expense.paymentMethod : PAYMENT_METHODS[0]);
  const [notes, setNotes] = useState(expense ? (expense.notes || '') : '');

  const submit = () => {
    if (!amount || Number(amount) <= 0) return;
    onSave({
      id: isEditing ? expense.id : uid(),
      category,
      type: expenseCategoryType(category),
      date,
      item: item.trim() || category,
      amount: Number(amount),
      paymentMethod,
      notes: notes.trim(),
    });
  };

  return (
    <Modal title={isEditing ? '編輯支出' : '新增支出'} onClose={onClose}>
      <Field label="分類">
        <select value={category} onChange={(e) => setCategory(e.target.value)}>
          {EXPENSE_CATEGORIES.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
        </select>
      </Field>
      <Field label="日期"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      <Field label="項目說明"><input value={item} onChange={(e) => setItem(e.target.value)} placeholder="例如：9 月房租" /></Field>
      <div className="field-row">
        <Field label="金額"><input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus /></Field>
        <Field label="付款方式">
          <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
            {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </Field>
      </div>
      <Field label="備註"><textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      <div className="modal-actions">
        <button className="btn-primary full" onClick={submit}>儲存支出</button>
      </div>
    </Modal>
  );
}

/* ============================================================
   主程式
   ============================================================ */

const NAV = [
  { id: 'dashboard', label: '總覽', icon: LayoutGrid },
  { id: 'customers', label: '客戶', icon: Users },
  { id: 'calendar', label: '日曆', icon: CalendarDays },
  { id: 'revisit', label: '回訪提醒', icon: Bell },
  { id: 'services', label: '服務項目', icon: Sparkles },
  { id: 'expenses', label: '成本', icon: Wallet },
  { id: 'settings', label: '品牌設定', icon: SettingsIcon },
];

function BrowserModeWarning() {
  const [dismissed, setDismissed] = useState(() => {
    try { return sessionStorage.getItem('beauty_system_browser_warning_dismissed') === '1'; } catch (e) { return false; }
  });
  const isStandalone = typeof window !== 'undefined' && (
    window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone
  );
  if (isStandalone || dismissed) return null;
  const dismiss = () => {
    try { sessionStorage.setItem('beauty_system_browser_warning_dismissed', '1'); } catch (e) {}
    setDismissed(true);
  };
  return (
    <div style={{ background: '#fdf3e7', border: '1px solid #e8c9a0', color: '#8a5a2b', borderRadius: 6, padding: '10px 14px', marginBottom: 16, fontSize: 13, display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
      <span>⚠️ 你正在用「瀏覽器分頁」打開系統，這裡的資料跟手機主畫面圖示是各自獨立的兩份，不會自動同步。建議平常都用主畫面圖示操作，這裡只用來做品牌設定同步等特殊用途。</span>
      <button type="button" onClick={dismiss} style={{ background: 'none', border: 'none', color: '#8a5a2b', cursor: 'pointer', fontSize: 13, flexShrink: 0, textDecoration: 'underline' }}>知道了</button>
    </div>
  );
}

function GlobalStyles({ mobileNavOpen, primaryColor, backgroundColor }) {
  const rose = primaryColor || '#c58f82';
  const cream = backgroundColor || '#f1ebe5';
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Noto+Serif+TC:wght@400;500;600;700&family=Noto+Sans+TC:wght@300;400;500;600;700&display=swap');

      .app-root {
        --cream: ${cream};
        --beige: ${cream};
        --rose: ${rose};
        --rose-deep: ${rose};
        --brown: #4a3b34;
        --taupe: #8f8178;
        --line: #ded4cc;
        --white: #ffffff;
        --alert: #b56f65;
    
        font-family: 'Noto Sans TC', sans-serif;
        color: var(--brown);
        background: var(--cream);
        min-height: 100vh;
        display: flex;
        font-weight: 400;
        -webkit-font-smoothing: antialiased;
      }
      .app-root * { box-sizing: border-box; }
      .app-root .serif { font-family: 'Noto Serif TC', serif; }
      .app-root h2.serif { font-size: 24px; font-weight: 600; margin: 0 0 4px 0; letter-spacing: 0.02em; }
      .app-root .muted { color: var(--taupe); font-size: 13px; margin: 0; }
      .app-root .muted.small { font-size: 12px; }
      .app-root .strong { font-weight: 600; }
    
      /* ---- Sidebar ---- */
      .sidebar {
        width: 220px;
        flex-shrink: 0;
        background: var(--beige);
        border-right: 1px solid var(--line);
        padding: 32px 20px;
        display: flex;
        flex-direction: column;
      }
      .brand { margin-bottom: 40px; }
      .brand-logo { display: block; width: 140px; height: auto; }
      .brand-logo.mobile { width: 92px; }
      .brand-sub { font-size: 12px; color: var(--taupe); margin-top: 6px; }
      .nav-list { list-style: none; padding: 0; margin: 0; }
      .nav-item {
        padding: 10px 4px;
        border-top: 1px solid var(--line);
        cursor: pointer;
        font-size: 14px;
        color: var(--taupe);
        display: flex;
        align-items: center;
        gap: 10px;
        position: relative;
      }
      .nav-item:last-child { border-bottom: 1px solid var(--line); }
      .nav-item.active { color: var(--brown); font-weight: 600; }
      .nav-item.active::before {
        content: ''; position: absolute; left: -20px; top: 0; bottom: 0; width: 3px; background: var(--rose-deep);
      }
      .nav-item:hover { color: var(--brown); }
    
      /* ---- Main ---- */
      .main-area { flex: 1; padding: 40px 44px 64px; max-width: 1100px; }
      .mobile-header { display: none; }
      .mobile-nav { display: none; }
    
      .view-head { display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 24px; flex-wrap: wrap; gap: 14px; }
    
      .period-tabs { display: flex; gap: 4px; background: var(--white); border: 1px solid var(--line); border-radius: 6px; padding: 3px; }
      .period-tab { border: none; background: transparent; font-family: inherit; font-size: 13px; padding: 6px 12px; border-radius: 4px; cursor: pointer; color: var(--taupe); }
      .period-tab.active { background: var(--rose-deep); color: var(--white); }
    
      .custom-range { display: flex; align-items: center; gap: 10px; margin-bottom: 20px; }
      .custom-range input { font-family: inherit; padding: 6px 8px; border: 1px solid var(--line); border-radius: 4px; background: var(--white); color: var(--brown); }
      .custom-range.compare-range { flex-wrap: wrap; margin-top: -8px; }
    
      .kpi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; margin-bottom: 32px; }
      .kpi-grid.narrow { grid-template-columns: repeat(3, 1fr); }
      .kpi-card { background: var(--white); border: 1px solid var(--line); border-radius: 6px; padding: 16px 18px; }
      .kpi-label { font-size: 12px; color: var(--taupe); margin-bottom: 6px; }
      .kpi-value { font-family: 'Noto Serif TC', serif; font-size: 22px; font-weight: 600; }
      .kpi-sub { font-size: 11px; color: var(--taupe); margin-top: 4px; }
    
      .chart-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; }
      .panel { background: var(--white); border: 1px solid var(--line); border-radius: 6px; padding: 20px; }
      .panel-title { font-size: 14px; font-weight: 600; margin: 0 0 14px 0; }
    
      .empty-hint { padding: 40px 10px; text-align: center; color: var(--taupe); font-size: 13px; border: 1px dashed var(--line); border-radius: 6px; }
    
      .due-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 10px; }
      .due-list li { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--alert); }
      .due-list .due-name { font-weight: 600; color: var(--brown); }
      .due-list .muted { font-size: 12px; }
    
      .badge-birthday { display: inline-block; background: var(--beige); color: var(--rose-deep); font-size: 11px; padding: 3px 8px; border-radius: 20px; }
      .badge-birthday.inline { margin-left: 10px; font-size: 12px; vertical-align: middle; }
    
      .compare-table { width: 100%; border-collapse: collapse; font-size: 13px; }
      .compare-table th { text-align: left; padding: 8px 10px; font-weight: 500; color: var(--taupe); font-size: 12px; border-bottom: 1px solid var(--line); }
      .compare-table th:not(:first-child), .compare-table td:not(:first-child) { text-align: right; }
      .compare-table td { padding: 10px; border-bottom: 1px solid var(--line); }
      .compare-table tr:last-child td { border-bottom: none; }
      .change-up { color: var(--rose-deep); font-weight: 600; }
      .change-down { color: var(--alert); font-weight: 600; }
    
      .category-summary-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
      .category-summary-card { background: var(--white); border: 1px solid var(--line); border-radius: 6px; padding: 14px 16px; }
      .kpi-value.small { font-family: 'Noto Serif TC', serif; font-size: 17px; font-weight: 600; }
    
      .final-amount-row { display: flex; justify-content: space-between; align-items: center; background: var(--beige); border-radius: 6px; padding: 10px 14px; font-size: 14px; }
      .final-amount-row.breakdown { flex-direction: column; align-items: stretch; gap: 4px; }
      .final-amount-line { display: flex; justify-content: space-between; font-size: 13px; }
      .final-amount-line.total { padding-top: 6px; margin-top: 2px; border-top: 1px solid var(--line); font-size: 15px; }
    
      .addon-section { display: flex; flex-direction: column; gap: 8px; }
      .addon-header { display: flex; justify-content: space-between; align-items: center; }
      .addon-list { display: flex; flex-direction: column; gap: 8px; }
      .addon-row { display: grid; grid-template-columns: 100px 1fr 90px auto; gap: 6px; align-items: center; }
      .addon-row select, .addon-row input { font-family: inherit; font-size: 13px; padding: 7px 8px; border: 1px solid var(--line); border-radius: 5px; background: var(--white); color: var(--brown); }
      .product-row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
      .product-row-label { display: flex; align-items: center; gap: 6px; flex: 1 1 160px; min-width: 0; font-size: 13px; }
      .product-row-label span { min-width: 0; overflow-wrap: break-word; }
      .product-row-qty { width: 60px; flex: 0 0 60px; font-family: inherit; font-size: 13px; padding: 7px 8px; border: 1px solid var(--line); border-radius: 5px; background: var(--white); color: var(--brown); box-sizing: border-box; }
    
      .revisit-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
      .revisit-card { display: flex; align-items: center; gap: 20px; background: var(--white); border: 1px solid var(--line); border-radius: 8px; padding: 16px 20px; flex-wrap: wrap; }
      .revisit-card.urgent { border-color: var(--alert); }
      .revisit-main { flex: 1; min-width: 180px; }
      .revisit-name-row { display: flex; align-items: center; gap: 8px; margin-bottom: 2px; font-size: 15px; }
      .badge-reminded { font-size: 11px; background: var(--beige); color: var(--taupe); padding: 2px 8px; border-radius: 20px; }
      .revisit-countdown { text-align: center; min-width: 70px; }
      .countdown-number { font-family: 'Noto Serif TC', serif; font-size: 24px; font-weight: 700; color: var(--rose-deep); line-height: 1; }
      .countdown-number.urgent { color: var(--alert); }
      .revisit-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
      .btn-secondary.active { background: var(--rose-deep); color: var(--white); border-color: var(--rose-deep); }
    
      .pill-group { display: flex; gap: 8px; flex-wrap: wrap; }

      .template-picker { position: relative; display: inline-block; }
      .template-menu {
        position: absolute; top: calc(100% + 4px); left: 0; z-index: 20;
        background: var(--white); border: 1px solid var(--line); border-radius: 6px;
        box-shadow: 0 8px 24px rgba(74,59,50,0.14); min-width: 160px; max-width: 240px;
        display: flex; flex-direction: column; padding: 4px; max-height: 240px; overflow-y: auto;
      }
      .template-menu-item {
        text-align: left; background: none; border: none; font-family: inherit; font-size: 13px;
        color: var(--brown); padding: 8px 10px; border-radius: 4px; cursor: pointer; white-space: nowrap;
        overflow: hidden; text-overflow: ellipsis;
      }
      .template-menu-item:hover { background: var(--cream); }
      .pill { font-family: inherit; font-size: 12px; padding: 7px 14px; border-radius: 20px; border: 1px solid var(--line); background: var(--white); color: var(--taupe); cursor: pointer; }
      .pill.active { background: var(--rose-deep); border-color: var(--rose-deep); color: var(--white); }
    
      .delete-confirm-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; flex: 1; }
      .btn-danger.small { padding: 6px 12px; font-size: 12px; }
    
      .notes-panel { margin-bottom: 8px; }
      .notes-tags { display: flex; gap: 8px; margin-bottom: 10px; flex-wrap: wrap; }
      .tag { font-size: 11px; padding: 4px 10px; border-radius: 20px; background: var(--beige); color: var(--taupe); }
      .tag-custom { background: var(--beige); color: var(--rose-deep); }
      .tag-deposit { display: inline-block; margin-top: 6px; background: #E5EEE3; color: #5A7A54; }
      .notes-text { font-size: 13px; line-height: 1.6; margin: 0; white-space: pre-wrap; }
    
      .tier-tag { display: inline-block; font-size: 10px; font-weight: 500; padding: 2px 7px; border-radius: 20px; margin-left: 8px; vertical-align: middle; }
      .tier-tag.tier-trial { background: var(--beige); color: var(--rose-deep); }
      .tier-tag.tier-brand { background: #E5EEE3; color: #5A7A54; }
      .tier-tag.status-pending { background: #FDF3D9; color: #9A7B1E; }
      .tier-tag.status-arrived { background: #E5EEE3; color: #5A7A54; }
      .tier-tag.status-no_show { background: #FBE9E7; color: #b56f65; }
      .tier-tag.status-cancelled { background: #F0E4E1; color: #8f8178; }
      .tier-tag.status-postponed { background: #E6EEF5; color: #4A6C8C; }
    
      .quick-preview { background: var(--cream); border: 1px solid var(--line); border-radius: 6px; padding: 12px 14px; margin-top: 8px; }
      .quick-preview-notes { font-size: 12px; color: var(--brown); margin: 6px 0; line-height: 1.5; }
      .quick-preview-list { list-style: none; margin: 6px 0 0; padding: 0; display: flex; flex-direction: column; gap: 5px; }
      .quick-preview-list li { display: flex; justify-content: space-between; gap: 10px; font-size: 12px; }
    
      .calendar-head-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
      .calendar-hint { margin: -10px 0 18px 0; }
      .calendar-groups { display: flex; flex-direction: column; gap: 22px; }
      .calendar-day-group { }
      .calendar-day-heading { font-family: 'Noto Serif TC', serif; font-size: 15px; font-weight: 600; margin: 0 0 10px 0; padding-bottom: 8px; border-bottom: 1px solid var(--line); }
      .appointment-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
      .appointment-card { display: flex; align-items: center; gap: 18px; background: var(--white); border: 1px solid var(--line); border-radius: 8px; padding: 14px 18px; flex-wrap: wrap; }
      .appointment-card.is-record { background: var(--cream); }
      .appointment-time { display: flex; align-items: center; gap: 5px; font-size: 13px; font-weight: 600; color: var(--rose-deep); min-width: 84px; }
      .appointment-main { flex: 1; min-width: 160px; }
      .appointment-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
      .source-badge { font-size: 11px; padding: 3px 9px; border-radius: 20px; background: var(--beige); color: var(--taupe); }
    
      .month-nav { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; }
      .month-nav-label { font-family: 'Noto Serif TC', serif; font-size: 16px; font-weight: 600; min-width: 110px; text-align: center; }
      .month-grid-wrap { background: var(--white); border: 1px solid var(--line); border-radius: 8px; padding: 16px; }
      .month-grid-header { display: grid; grid-template-columns: repeat(7, 1fr); margin-bottom: 6px; }
      .month-grid-header-cell { text-align: center; font-size: 12px; color: var(--taupe); padding: 6px 0; }
      .month-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px; }
      .month-cell { position: relative; min-height: 76px; border: 1px solid transparent; border-radius: 6px; background: var(--cream); font-family: inherit; cursor: pointer; display: flex; flex-direction: column; align-items: flex-start; justify-content: flex-start; padding: 6px; gap: 3px; overflow: hidden; }
      .month-cell.empty { background: transparent; cursor: default; min-height: 76px; }
      .month-cell-day { font-size: 12px; color: var(--brown); }
      .month-cell.today .month-cell-day { font-weight: 700; color: var(--rose-deep); }
      .month-cell.today { border-color: var(--rose-deep); }
      .month-cell.selected { background: var(--beige); border-color: var(--rose-deep); }
      .month-cell-preview { display: flex; flex-direction: column; gap: 2px; width: 100%; }
      .month-cell-chip { font-size: 10px; color: var(--rose-deep); background: var(--white); border-radius: 3px; padding: 1px 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; width: 100%; text-align: left; }
      .month-cell-more { font-size: 10px; color: var(--taupe); padding-left: 4px; }
    
      /* ---- Search / Table ---- */
      .search-bar { display: flex; align-items: center; gap: 8px; background: var(--white); border: 1px solid var(--line); border-radius: 6px; padding: 10px 14px; margin-bottom: 18px; color: var(--taupe); max-width: 360px; }
      .search-bar input { border: none; outline: none; font-family: inherit; font-size: 14px; flex: 1; background: transparent; color: var(--brown); }
    
      .table-wrap { background: var(--white); border: 1px solid var(--line); border-radius: 6px; overflow: hidden; overflow-x: auto; }
      .data-table { width: 100%; border-collapse: collapse; font-size: 13px; }
      .data-table th { text-align: left; padding: 12px 16px; font-weight: 500; color: var(--taupe); font-size: 12px; border-bottom: 1px solid var(--line); white-space: nowrap; }
      .data-table td { padding: 12px 16px; border-bottom: 1px solid var(--line); white-space: nowrap; }
      .data-table tbody tr:last-child td { border-bottom: none; }
      .data-table tbody tr:hover { background: var(--cream); cursor: pointer; }
    
      /* ---- Buttons ---- */
      .btn-primary { display: inline-flex; align-items: center; gap: 6px; background: var(--rose-deep); color: var(--white); border: none; border-radius: 6px; padding: 10px 18px; font-family: inherit; font-size: 13px; font-weight: 600; cursor: pointer; }
      .btn-primary:hover { background: #a77a6e; }
      .btn-primary:disabled { opacity: 0.4; cursor: not-allowed; }
      .btn-primary.full { width: 100%; justify-content: center; }
      .btn-secondary { background: var(--beige); color: var(--brown); border: 1px solid var(--line); border-radius: 6px; padding: 8px 14px; font-family: inherit; font-size: 13px; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; }
      .btn-secondary:disabled { opacity: 0.4; cursor: not-allowed; }
      .btn-secondary.small { padding: 6px 10px; font-size: 12px; }
      .btn-danger { display: inline-flex; align-items: center; gap: 6px; background: transparent; color: var(--alert); border: 1px solid var(--alert); border-radius: 6px; padding: 9px 14px; font-family: inherit; font-size: 13px; cursor: pointer; }
      .icon-btn { background: transparent; border: none; cursor: pointer; color: var(--taupe); padding: 4px; display: flex; align-items: center; }
      .icon-btn.ghost:hover { color: var(--alert); }
      .text-link { background: none; border: none; color: var(--rose-deep); font-family: inherit; font-size: 13px; cursor: pointer; text-decoration: underline; padding: 4px 0; text-align: left; }
    
      /* ---- Forms / Modal ---- */
      .modal-overlay { position: fixed; inset: 0; background: rgba(74,59,50,0.35); display: flex; align-items: center; justify-content: center; z-index: 50; padding: 20px; }
      .modal-panel { background: var(--cream); border-radius: 10px; width: 420px; max-width: 100%; max-height: 88vh; overflow-y: auto; box-shadow: 0 20px 50px rgba(74,59,50,0.25); }
      .modal-panel.wide { width: 520px; }
      .modal-head { display: flex; justify-content: space-between; align-items: center; padding: 20px 24px; border-bottom: 1px solid var(--line); }
      .modal-head h3 { font-family: 'Noto Serif TC', serif; font-size: 17px; margin: 0; font-weight: 600; }
      .modal-body { padding: 20px 24px 24px; display: flex; flex-direction: column; gap: 14px; }
      .modal-actions { margin-top: 6px; display: flex; gap: 10px; }
    
      .field { display: flex; flex-direction: column; gap: 6px; flex: 1; }
      .field-row { display: flex; gap: 12px; flex-wrap: wrap; }
      .field-row > label { flex: 1 1 140px; min-width: 0; }
      .date-time-group { display: flex; gap: 8px; }
      .date-time-group input { flex: 1 1 0; min-width: 0; }
      .field-label { font-size: 12px; color: var(--taupe); }
      .field-hint { font-size: 11px; color: var(--taupe); }
      .field input, .field select, .field textarea {
        font-family: inherit; font-size: 14px; padding: 9px 12px; border: 1px solid var(--line); border-radius: 5px; background: var(--white); color: var(--brown); width: 100%; min-width: 0; box-sizing: border-box;
      }
      .field textarea { resize: vertical; }
      .fallback-textarea { width: 100%; font-family: inherit; font-size: 13px; padding: 10px 12px; border: 1px solid var(--line); border-radius: 5px; background: var(--white); color: var(--brown); resize: vertical; margin: 10px 0; white-space: pre-wrap; }
      .checkbox-row { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--brown); }
    
      .chosen-customer { display: flex; align-items: center; gap: 10px; background: var(--white); border: 1px solid var(--line); border-radius: 5px; padding: 9px 12px; }
      .autocomplete { list-style: none; margin: 4px 0 0; padding: 0; background: var(--white); border: 1px solid var(--line); border-radius: 5px; overflow: hidden; }
      .autocomplete li { padding: 9px 12px; font-size: 13px; cursor: pointer; border-bottom: 1px solid var(--line); }
      .autocomplete li:last-child { border-bottom: none; }
      .autocomplete li:hover { background: var(--cream); }
      .quick-add-box { display: flex; flex-direction: column; gap: 8px; background: var(--white); border: 1px dashed var(--line); border-radius: 6px; padding: 12px; margin-top: 6px; }
      .quick-add-box input { font-family: inherit; padding: 8px 10px; border: 1px solid var(--line); border-radius: 5px; }
    
      /* ---- Customer detail ---- */
      .back-link { display: inline-flex; align-items: center; gap: 4px; background: none; border: none; color: var(--taupe); font-family: inherit; font-size: 13px; cursor: pointer; margin-bottom: 18px; padding: 0; }
      .customer-head { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 22px; flex-wrap: wrap; gap: 12px; }
      .button-group { display: flex; gap: 10px; flex-wrap: wrap; }
      .timeline { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
      .timeline-item { display: flex; gap: 18px; align-items: flex-start; padding: 16px 0; border-top: 1px solid var(--line); }
      .timeline-item:first-child { border-top: none; }
      .timeline-actions { display: flex; gap: 2px; flex-shrink: 0; }
      .timeline-date { width: 88px; flex-shrink: 0; font-size: 13px; color: var(--taupe); padding-top: 2px; }
      .timeline-content { flex: 1; }
      .timeline-row { display: flex; justify-content: space-between; margin-bottom: 4px; font-size: 14px; }
    
      /* ---- Floating add button ---- */
      .fab { position: fixed; bottom: 52px; right: 28px; background: var(--rose-deep); color: var(--white); border: none; border-radius: 30px; padding: 14px 22px; font-family: inherit; font-size: 14px; font-weight: 600; display: flex; align-items: center; gap: 8px; box-shadow: 0 8px 20px rgba(74,59,50,0.25); cursor: pointer; z-index: 30; }
      .app-footer { position: fixed; left: 0; right: 0; bottom: 0; margin: 0; padding: 6px 12px; text-align: center; font-size: 10px; color: var(--taupe); opacity: 0.8; background: var(--beige); border-top: 1px solid var(--line); z-index: 25; }
    
      .loading-screen { min-height: 100vh; display: flex; align-items: center; justify-content: center; font-family: 'Noto Serif TC', serif; color: var(--taupe); background: var(--cream); width: 100%; }
    
      .lock-screen { min-height: 100vh; width: 100%; display: flex; align-items: center; justify-content: center; background: var(--cream); }
      .lock-card { background: var(--white); border: 1px solid var(--line); border-radius: 12px; padding: 40px 36px; width: 320px; max-width: 90vw; text-align: center; box-shadow: 0 20px 50px rgba(74,59,50,0.1); }
      .lock-logo { width: 120px; margin: 0 auto 18px; }
      .lock-input { width: 100%; font-family: inherit; font-size: 15px; padding: 11px 14px; border: 1px solid var(--line); border-radius: 6px; background: var(--cream); color: var(--brown); text-align: center; letter-spacing: 0.1em; }
      .lock-error { color: var(--alert); font-size: 12px; margin-top: 8px; }
    
      .logout-btn { margin-top: 20px; width: 100%; background: none; border: 1px solid var(--line); border-radius: 6px; padding: 9px; font-family: inherit; font-size: 12px; color: var(--taupe); cursor: pointer; }
      .logout-btn:hover { color: var(--alert); border-color: var(--alert); }
    
      @media (max-width: 860px) {
        .app-root { flex-direction: column; }
        .sidebar { display: none; }
        .mobile-header { display: flex; align-items: center; justify-content: space-between; padding: 16px 20px; background: var(--beige); border-bottom: 1px solid var(--line); }
        .mobile-nav { display: ${mobileNavOpen ? 'flex' : 'none'}; flex-direction: column; background: var(--beige); border-bottom: 1px solid var(--line); }
        .mobile-nav .nav-item { padding: 14px 20px; border-top: 1px solid var(--line); }
        .main-area { padding: 24px 18px 120px; }
        .kpi-grid, .kpi-grid.narrow { grid-template-columns: 1fr 1fr; }
        .chart-grid { grid-template-columns: 1fr; }
        .category-summary-grid { grid-template-columns: 1fr 1fr; }
        .compare-table { font-size: 12px; }
        .month-grid-wrap { padding: 10px; }
        .month-cell-day { font-size: 11px; }
        .month-cell { padding: 4px; min-height: 58px; }
        .month-cell-chip { font-size: 9px; }
        .view-head { align-items: flex-start; }
        .addon-row { grid-template-columns: 1fr 1fr; grid-template-areas: "type amount" "desc desc"; }
        .addon-row select { grid-area: type; }
        .addon-row input[type="number"] { grid-area: amount; }
        .addon-row input:not([type="number"]) { grid-area: desc; }
        .addon-row .icon-btn { grid-column: 1 / -1; justify-self: end; }
      }
    `}</style>
  );
}

function reportError(e) {
  alert('操作失敗：' + (e?.message || '請稍後再試，或檢查網路連線'));
}

export default function StudioAdmin({ store, onStoreChange, onLogout }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [view, setView] = useState('dashboard');
  const [selectedCustomerId, setSelectedCustomerId] = useState(null);
  const [customerModal, setCustomerModal] = useState(null); // null | 'new' | customer object
  const [showImportCustomers, setShowImportCustomers] = useState(false);
  const [addRecordFor, setAddRecordFor] = useState(null); // null | 'global' | customerId
  const [editingRecord, setEditingRecord] = useState(null); // null | record object
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const bundle = await fetchStoreBundle();
        setData({ ...bundle, appointments: [], sources: DEFAULT_SOURCES });
      } catch (e) {
        setLoadError(e.message || '資料載入失敗');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const updateData = useCallback((mutator) => {
    setData((prev) => {
      const next = { ...prev };
      mutator(next);
      return next;
    });
  }, []);

  if (loading || !data) {
    return (
      <div className="app-root">
        <GlobalStyles mobileNavOpen={false} primaryColor={store.primaryColor} backgroundColor={store.backgroundColor} />
        <div className="loading-screen">載入中⋯</div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="app-root">
        <GlobalStyles mobileNavOpen={false} primaryColor={store.primaryColor} backgroundColor={store.backgroundColor} />
        <div className="loading-screen">資料載入失敗：{loadError}</div>
      </div>
    );
  }

  const openCustomer = (id) => { setSelectedCustomerId(id); setView('customerDetail'); };

  const handleSaveCustomer = async (customer) => {
    try {
      const saved = await apiSaveCustomer(customer, store.id);
      updateData((d) => {
        const exists = d.customers.some((c) => c.id === saved.id);
        d.customers = exists ? d.customers.map((c) => (c.id === saved.id ? saved : c)) : [...d.customers, saved];
      });
      setCustomerModal(null);
    } catch (e) {
      reportError(e);
    }
  };

  const handleImportCustomers = async (customers) => {
    await apiSaveCustomersBulk(customers, store.id);
    updateData((d) => { d.customers = [...d.customers, ...customers]; });
  };

  const handleDeleteCustomer = async (id) => {
    try {
      await apiDeleteCustomer(id);
      updateData((d) => {
        d.customers = d.customers.filter((c) => c.id !== id);
        d.records = d.records.filter((r) => r.customerId !== id);
      });
      setCustomerModal(null);
      if (selectedCustomerId === id) {
        setSelectedCustomerId(null);
        setView('customers');
      }
    } catch (e) {
      reportError(e);
    }
  };

  const quickAddCustomer = async ({ name, phone, source }) => {
    const memberNo = nextMemberNo(data.customers);
    const cust = { id: uid(), memberNo, name, phone, lineId: '', email: '', birthday: '', source: source || '其他', firstVisitDate: todayISO(), notes: '', customFields: {}, reminderSentFor: '' };
    try {
      const saved = await apiSaveCustomer(cust, store.id);
      updateData((d) => { d.customers = [...d.customers, saved]; });
      return saved;
    } catch (e) {
      reportError(e);
      throw e;
    }
  };

  // 依「新舊差額」調整客人儲值餘額。newRecord 為 null 代表這筆紀錄被刪除了。
  const applyStoredValueDelta = async (customerId, oldRecord, newRecord) => {
    const delta = storedValueImpact(newRecord) - storedValueImpact(oldRecord);
    if (delta === 0) return;
    const customer = data.customers.find((c) => c.id === customerId);
    if (!customer) return;
    const updatedCustomer = await apiSaveCustomer(
      { ...customer, storedValueBalance: (Number(customer.storedValueBalance) || 0) - delta },
      store.id
    );
    updateData((d) => { d.customers = d.customers.map((c) => (c.id === updatedCustomer.id ? updatedCustomer : c)); });
  };

  const handleAddRecord = async (record) => {
    try {
      const saved = await apiSaveRecord(record, store.id);
      updateData((d) => {
        const exists = d.records.some((r) => r.id === saved.id);
        d.records = exists ? d.records.map((r) => (r.id === saved.id ? saved : r)) : [...d.records, saved];
      });
      await applyStoredValueDelta(saved.customerId, null, saved);
      setAddRecordFor(null);
    } catch (e) {
      reportError(e);
    }
  };

  const handleUpdateRecord = async (record) => {
    try {
      const oldRecord = data.records.find((r) => r.id === record.id);
      const saved = await apiSaveRecord(record, store.id);
      updateData((d) => { d.records = d.records.map((r) => (r.id === saved.id ? saved : r)); });
      await applyStoredValueDelta(saved.customerId, oldRecord, saved);
      setEditingRecord(null);
    } catch (e) {
      reportError(e);
    }
  };

  const handleDeleteRecord = async (id) => {
    try {
      const record = data.records.find((r) => r.id === id);
      await apiDeleteRecord(id);
      updateData((d) => { d.records = d.records.filter((r) => r.id !== id); });
      if (record) await applyStoredValueDelta(record.customerId, record, null);
    } catch (e) {
      reportError(e);
    }
  };

  const handleToggleRecordReminded = async (id, mark) => {
    const record = data.records.find((r) => r.id === id);
    if (!record) return;
    try {
      const saved = await apiSaveRecord({ ...record, reminderSent: mark }, store.id);
      updateData((d) => {
        d.records = d.records.map((r) => r.id === id ? saved : r);
      });
    } catch (e) {
      reportError(e);
    }
  };

  const handleSaveService = async (svc) => {
    try {
      const saved = await apiSaveService(svc, store.id);
      updateData((d) => {
        const exists = d.services.some((s) => s.id === saved.id);
        d.services = exists ? d.services.map((s) => (s.id === saved.id ? saved : s)) : [...d.services, saved];
      });
    } catch (e) {
      reportError(e);
    }
  };
  const handleDeleteService = async (id) => {
    try {
      await apiDeleteService(id);
      updateData((d) => { d.services = d.services.filter((s) => s.id !== id); });
    } catch (e) {
      reportError(e);
    }
  };

  const handleSaveExpense = async (exp) => {
    try {
      const saved = await apiSaveExpense(exp, store.id);
      updateData((d) => {
        const exists = d.expenses.some((e) => e.id === saved.id);
        d.expenses = exists ? d.expenses.map((e) => (e.id === saved.id ? saved : e)) : [...d.expenses, saved];
      });
    } catch (e) {
      reportError(e);
    }
  };
  const handleDeleteExpense = async (id) => {
    try {
      await apiDeleteExpense(id);
      updateData((d) => { d.expenses = d.expenses.filter((e) => e.id !== id); });
    } catch (e) {
      reportError(e);
    }
  };

  const handleMarkReminded = async (customerId, lastDate, mark) => {
    const customer = data.customers.find((c) => c.id === customerId);
    if (!customer) return;
    try {
      const saved = await apiSaveCustomer({ ...customer, reminderSentFor: mark ? lastDate : '' }, store.id);
      updateData((d) => {
        d.customers = d.customers.map((c) => c.id === customerId ? saved : c);
      });
    } catch (e) {
      reportError(e);
    }
  };

  // 舊版預約資料（appointments）在新架構下一律是空陣列，這兩個 handler 不會有東西可操作，
  // 純粹是保留給共用元件的 props 介面，避免元件內部判斷 source === 'appointment' 的分支報錯。
  const handleDeleteAppointment = () => {};
  const handleToggleAppointmentReminded = () => {};

  const goto = (id) => { setView(id); setMobileNavOpen(false); };

  const handleSaveStoreSettings = async (patch) => {
    const updated = await onStoreChange(patch);
    return updated;
  };

  return (
    <div className="app-root">
      <GlobalStyles mobileNavOpen={mobileNavOpen} primaryColor={store.primaryColor} backgroundColor={store.backgroundColor} />

      <aside className="sidebar">
        <div className="brand">
          {store.logoUrl ? (
            <img src={store.logoUrl} alt={store.name} className="brand-logo" />
          ) : (
            <div className="serif" style={{ fontSize: 20, fontWeight: 600 }}>{store.name}</div>
          )}
          <div className="brand-sub">{store.loginTitle || '工作室後台'}</div>
        </div>
        <ul className="nav-list">
          {NAV.map((n) => (
            <li key={n.id} className={'nav-item' + (view === n.id || (n.id === 'customers' && view === 'customerDetail') ? ' active' : '')} onClick={() => goto(n.id)}>
              <n.icon size={15} /> {n.label}
            </li>
          ))}
        </ul>
        <button className="logout-btn" onClick={onLogout}>鎖定</button>
      </aside>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="mobile-header">
          {store.logoUrl ? (
            <img src={store.logoUrl} alt={store.name} className="brand-logo mobile" />
          ) : (
            <div className="serif" style={{ fontSize: 16, fontWeight: 600 }}>{store.name}</div>
          )}
          <button className="icon-btn" onClick={() => setMobileNavOpen((v) => !v)}><Menu size={20} /></button>
        </div>
        <ul className="nav-list mobile-nav">
          {NAV.map((n) => (
            <li key={n.id} className={'nav-item' + (view === n.id ? ' active' : '')} onClick={() => goto(n.id)}>
              <n.icon size={15} /> {n.label}
            </li>
          ))}
          <li className="nav-item" onClick={onLogout}>鎖定</li>
        </ul>

        <main className="main-area">
          <BrowserModeWarning />

          {view === 'dashboard' && <Dashboard data={data} store={store} />}

          {view === 'customers' && (
            <CustomersView
              data={data}
              store={store}
              onOpenCustomer={openCustomer}
              onAddCustomer={() => setCustomerModal('new')}
              onEditCustomer={(c) => setCustomerModal(c)}
              onImportCustomers={() => setShowImportCustomers(true)}
            />
          )}

          {view === 'customerDetail' && (
            <CustomerDetail
              data={data}
              store={store}
              customerId={selectedCustomerId}
              onBack={() => setView('customers')}
              onAddRecord={(cid) => setAddRecordFor(cid)}
              onEditRecord={(r) => setEditingRecord(r)}
              onDeleteRecord={handleDeleteRecord}
              onDeleteAppointment={handleDeleteAppointment}
              onEditCustomer={(c) => setCustomerModal(c)}
            />
          )}

          {view === 'calendar' && (
            <CalendarView
              data={data}
              store={store}
              onAddRecord={() => setAddRecordFor('global')}
              onEditRecord={(r) => setEditingRecord(r)}
              onDeleteRecord={handleDeleteRecord}
              onDeleteAppointment={handleDeleteAppointment}
              onToggleRecordReminded={handleToggleRecordReminded}
              onToggleAppointmentReminded={handleToggleAppointmentReminded}
              onOpenCustomer={openCustomer}
            />
          )}

          {view === 'revisit' && (
            <RevisitView data={data} store={store} onOpenCustomer={openCustomer} onMarkReminded={handleMarkReminded} />
          )}

          {view === 'services' && <ServicesView data={data} store={store} onSave={handleSaveService} onDelete={handleDeleteService} />}

          {view === 'expenses' && <ExpensesView data={data} onSave={handleSaveExpense} onDelete={handleDeleteExpense} />}

          {view === 'settings' && <SettingsView store={store} onSave={handleSaveStoreSettings} />}
        </main>
      </div>

      <button className="fab" onClick={() => setAddRecordFor('global')}><Plus size={18} /> 新增服務</button>

      <p className="app-footer">© {new Date().getFullYear()} HSIN.EE 網站. All Rights Reserved.</p>

      {showImportCustomers && (
        <CustomerImportModal
          store={store}
          data={data}
          onClose={() => setShowImportCustomers(false)}
          onImport={handleImportCustomers}
        />
      )}

      {customerModal && (
        <CustomerFormModal
          data={data}
          store={store}
          customer={customerModal === 'new' ? null : customerModal}
          onClose={() => setCustomerModal(null)}
          onSave={handleSaveCustomer}
          onDelete={handleDeleteCustomer}
        />
      )}

      {addRecordFor && (
        <AddRecordModal
          data={data}
          store={store}
          prefillCustomerId={addRecordFor === 'global' ? '' : addRecordFor}
          onClose={() => setAddRecordFor(null)}
          onSave={handleAddRecord}
          onQuickAddCustomer={quickAddCustomer}
        />
      )}

      {editingRecord && (
        <AddRecordModal
          data={data}
          store={store}
          record={editingRecord}
          onClose={() => setEditingRecord(null)}
          onSave={handleUpdateRecord}
          onQuickAddCustomer={quickAddCustomer}
        />
      )}
    </div>
  );
}
