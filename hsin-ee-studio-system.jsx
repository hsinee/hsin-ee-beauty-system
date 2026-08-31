import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell
} from 'recharts';
import {
  Search, Plus, X, ChevronRight, ChevronLeft, Trash2, Pencil, Bell,
  Users, LayoutGrid, Sparkles, Wallet, ClipboardList, Menu, CalendarDays, Clock, Download
} from 'lucide-react';
import * as XLSX from 'xlsx';

/* ============================================================
   常數 / 預設值
   ============================================================ */

const STORAGE_KEY = 'hsin-ee-studio-data-v1';

const DEFAULT_SOURCES = ['IG', 'Threads', 'Google', '朋友介紹', 'LINE', '自然搜尋', '其他'];
const PAYMENT_METHODS = ['現金', '轉帳', 'LINE Pay', '信用卡', '其他'];
// 回訪優惠視窗：最近一次服務後 6 週（42 天）內回訪享優惠，
// 從第 4 週開始（滿 22 天）就在「回訪提醒」列表跳出來，讓店家有時間主動聯繫
const REVISIT_WINDOW_DAYS = 42;
const REVISIT_ALERT_START_DAY = 22;
// 每個分類對應到固定成本／變動成本，用於毛利、淨利計算
const EXPENSE_CATEGORIES = [
  { name: '熱蠟耗材', type: 'variable' },
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
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

const PRICE_TIERS = [
  { id: 'normal', label: '原價' },
  { id: 'trial', label: '首次體驗價' },
  { id: 'brand', label: '品牌體驗價' },
];

function defaultServices() {
  return [
    { id: uid(), name: '腋下', category: '手臂 / 腋下', priceNormal: 399, priceFirstTrial: 199, priceBrandModel: 149, duration: 20, active: true },
    { id: uid(), name: '比基尼線', category: '私密處', priceNormal: 800, priceFirstTrial: 500, priceBrandModel: 399, duration: 30, active: true },
    { id: uid(), name: '全私密處', category: '私密處', priceNormal: 1500, priceFirstTrial: 999, priceBrandModel: 799, duration: 45, active: true },
    { id: uid(), name: '小腿', category: '腿部', priceNormal: 600, priceFirstTrial: 399, priceBrandModel: 299, duration: 30, active: true },
    { id: uid(), name: '全腿', category: '腿部', priceNormal: 1200, priceFirstTrial: 799, priceBrandModel: 599, duration: 50, active: true },
    { id: uid(), name: '手臂', category: '手臂 / 腋下', priceNormal: 500, priceFirstTrial: 299, priceBrandModel: 249, duration: 25, active: true },
    { id: uid(), name: '臉部', category: '臉部', priceNormal: 400, priceFirstTrial: 250, priceBrandModel: 199, duration: 20, active: true },
    { id: uid(), name: '背部', category: '軀幹', priceNormal: 900, priceFirstTrial: 600, priceBrandModel: 499, duration: 35, active: true },
  ];
}

function emptyData() {
  return {
    customers: [],
    services: defaultServices(),
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
   儲存
   ============================================================ */

async function loadData() {
  try {
    const res = await window.storage.get(STORAGE_KEY);
    if (res && res.value) return JSON.parse(res.value);
    return null;
  } catch (e) {
    return null;
  }
}
async function persist(data) {
  try {
    await window.storage.set(STORAGE_KEY, JSON.stringify(data));
  } catch (e) {
    console.error('storage error', e);
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

  const revenue = inRange.reduce((s, r) => s + Number(r.amount || 0), 0);
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
  { id: 'quarter', label: '本季' },
  { id: 'year', label: '今年' },
  { id: 'custom', label: '自訂' },
];

function Dashboard({ data }) {
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
      trendMap[key] = (trendMap[key] || 0) + Number(r.amount || 0);
    });
    const trend = Object.entries(trendMap)
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([k, v]) => ({ label: groupByMonth ? k.slice(2) : k.slice(5), value: v }));

    // 服務項目營收
    const serviceMap = {};
    inRange.forEach((r) => { serviceMap[r.serviceName] = (serviceMap[r.serviceName] || 0) + Number(r.amount || 0); });
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
        <div className="period-tabs">
          {PERIODS.map((p) => (
            <button
              key={p.id}
              className={'period-tab' + (period === p.id ? ' active' : '')}
              onClick={() => setPeriod(p.id)}
            >{p.label}</button>
          ))}
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
                <CartesianGrid strokeDasharray="3 3" stroke="#E4DCD2" />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#9C8D82' }} axisLine={{ stroke: '#E4DCD2' }} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: '#9C8D82' }} axisLine={false} tickLine={false} width={50} />
                <Tooltip formatter={(v) => fmtMoney(v)} contentStyle={{ fontSize: 12, borderRadius: 6, borderColor: '#E4DCD2' }} />
                <Line type="monotone" dataKey="value" stroke="#B98077" strokeWidth={2.5} dot={{ r: 3, fill: '#B98077' }} />
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
                <CartesianGrid strokeDasharray="3 3" stroke="#E4DCD2" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11, fill: '#9C8D82' }} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="label" tick={{ fontSize: 12, fill: '#4A3B32' }} axisLine={false} tickLine={false} width={70} />
                <Tooltip formatter={(v) => fmtMoney(v)} contentStyle={{ fontSize: 12, borderRadius: 6, borderColor: '#E4DCD2' }} />
                <Bar dataKey="value" fill="#D9BEB6" radius={[0, 3, 3, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="panel">
          <h4 className="panel-title">新客 / 舊客回訪</h4>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={stats.newVsReturning} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E4DCD2" />
              <XAxis dataKey="label" tick={{ fontSize: 12, fill: '#4A3B32' }} axisLine={{ stroke: '#E4DCD2' }} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: '#9C8D82' }} axisLine={false} tickLine={false} width={40} />
              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 6, borderColor: '#E4DCD2' }} />
              <Bar dataKey="value" radius={[3, 3, 0, 0]}>
                <Cell fill="#B98077" />
                <Cell fill="#D9BEB6" />
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
  const total = own.reduce((s, r) => s + Number(r.amount || 0), 0);
  const last = own.length ? own[own.length - 1] : null;
  return { own, total, count: own.length, last };
}

const PHOTO_CONSENT_LABEL = { yes: '可以拍照', no: '不可拍照', unset: '拍照意願未確認' };
const MODEL_STATUS_LABEL = { active: '模特資格中', inactive: '已取消模特資格', unset: '非模特' };

function exportAllCustomerData(data) {
  const wb = XLSX.utils.book_new();

  const custRows = data.customers.map((c) => {
    const s = customerSummary(c, data.records);
    return {
      會員編號: c.memberNo,
      姓名: c.name,
      電話: c.phone,
      LINE: c.lineId || '',
      Email: c.email || '',
      生日: c.birthday || '',
      得知來源: c.source || '',
      拍照意願: PHOTO_CONSENT_LABEL[c.canPhotograph] || '拍照意願未確認',
      模特資格: MODEL_STATUS_LABEL[c.modelStatus] || '非模特',
      備註: c.notes || '',
      首次消費日期: c.firstVisitDate || '',
      近期消費日期: s.last ? s.last.date : '',
      累積消費: s.total,
      消費次數: s.count,
      平均客單價: s.count ? Math.round(s.total / s.count) : 0,
    };
  });
  const custSheet = XLSX.utils.json_to_sheet(custRows);
  custSheet['!cols'] = [
    { wch: 10 }, { wch: 10 }, { wch: 14 }, { wch: 12 }, { wch: 18 }, { wch: 12 },
    { wch: 10 }, { wch: 12 }, { wch: 14 }, { wch: 24 }, { wch: 12 }, { wch: 12 },
    { wch: 10 }, { wch: 8 }, { wch: 10 },
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
        價格方案: r.priceTier === 'trial' ? '首次體驗價' : r.priceTier === 'brand' ? '品牌體驗價' : '原價',
        原價: r.listPrice,
        折扣: r.discount || 0,
        實收金額: r.amount,
        付款方式: r.paymentMethod,
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

  XLSX.writeFile(wb, `HSIN_EE_客戶資料_${todayISO()}.xlsx`);
}

function CustomersView({ data, onOpenCustomer, onAddCustomer, onEditCustomer }) {
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
          <button className="btn-secondary" onClick={() => exportAllCustomerData(data)} disabled={data.customers.length === 0}>
            <Download size={16} /> 匯出所有客戶資料
          </button>
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

const PHOTO_CONSENT_OPTIONS = [
  { id: 'unset', label: '尚未確認' },
  { id: 'yes', label: '可以拍照' },
  { id: 'no', label: '不可拍照' },
];
const MODEL_STATUS_OPTIONS = [
  { id: 'unset', label: '非模特' },
  { id: 'active', label: '模特資格中' },
  { id: 'inactive', label: '已取消資格' },
];

function CustomerFormModal({ data, customer, onClose, onSave, onDelete }) {
  const [form, setForm] = useState(customer ? {
    name: customer.name, phone: customer.phone, lineId: customer.lineId || '',
    email: customer.email || '', birthday: customer.birthday || '', source: customer.source,
    notes: customer.notes || '', canPhotograph: customer.canPhotograph || 'unset', modelStatus: customer.modelStatus || 'unset',
  } : { name: '', phone: '', lineId: '', email: '', birthday: '', source: data.sources[0], notes: '', canPhotograph: 'unset', modelStatus: 'unset' });
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const submit = () => {
    if (!form.name.trim() || !form.phone.trim()) return;
    if (customer) {
      onSave({
        ...customer,
        name: form.name.trim(),
        phone: form.phone.trim(),
        lineId: form.lineId.trim(),
        email: form.email.trim(),
        birthday: form.birthday || '',
        source: form.source,
        notes: form.notes.trim(),
        canPhotograph: form.canPhotograph,
        modelStatus: form.modelStatus,
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
        source: form.source,
        notes: form.notes.trim(),
        canPhotograph: form.canPhotograph,
        modelStatus: form.modelStatus,
        firstVisitDate: todayISO(),
        reminderSentFor: '',
      });
    }
  };

  return (
    <Modal title={customer ? '編輯客戶' : '新增客戶'} onClose={onClose}>
      <Field label="姓名"><input value={form.name} onChange={set('name')} placeholder="客人姓名" autoFocus /></Field>
      <Field label="手機"><input value={form.phone} onChange={set('phone')} placeholder="09XX-XXX-XXX" /></Field>
      <Field label="LINE 名稱"><input value={form.lineId} onChange={set('lineId')} /></Field>
      <Field label="Email"><input value={form.email} onChange={set('email')} /></Field>
      <Field label="生日" hint="用來標示本月壽星，只需要正確的月份和日期"><input type="date" value={form.birthday} onChange={set('birthday')} /></Field>
      <Field label="得知來源">
        <select value={form.source} onChange={set('source')}>
          {data.sources.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </Field>

      <Field label="拍照意願">
        <div className="pill-group">
          {PHOTO_CONSENT_OPTIONS.map((o) => (
            <button key={o.id} type="button" className={'pill' + (form.canPhotograph === o.id ? ' active' : '')} onClick={() => setForm({ ...form, canPhotograph: o.id })}>{o.label}</button>
          ))}
        </div>
      </Field>

      <Field label="品牌模特資格">
        <div className="pill-group">
          {MODEL_STATUS_OPTIONS.map((o) => (
            <button key={o.id} type="button" className={'pill' + (form.modelStatus === o.id ? ' active' : '')} onClick={() => setForm({ ...form, modelStatus: o.id })}>{o.label}</button>
          ))}
        </div>
      </Field>

      <Field label="備註"><textarea rows={3} value={form.notes} onChange={set('notes')} placeholder="內部備註，例如拍照條件、特殊狀況等" /></Field>

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


function CustomerDetail({ data, customerId, onBack, onAddRecord, onDeleteRecord, onDeleteAppointment, onEditCustomer }) {
  const customer = data.customers.find((c) => c.id === customerId);
  if (!customer) return null;
  const s = customerSummary(customer, data.records);

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
        <KpiCard label="首次消費日期" value={fmtDate(customer.firstVisitDate)} />
        <KpiCard label="近期消費日期" value={s.last ? fmtDate(s.last.date) : '—'} />
        <KpiCard label="生日" value={customer.birthday ? fmtDate(customer.birthday) : '未填寫'} />
        <KpiCard label="累積消費" value={fmtMoney(s.total)} />
        <KpiCard label="消費次數" value={s.count} />
        <KpiCard label="平均客單價" value={fmtMoney(s.count ? s.total / s.count : 0)} />
        <KpiCard
          label="回訪狀態"
          value={retentionNote ? (retentionNote.overdue ? '🔔 建議回訪' : '穩定回訪中') : '尚無足夠資料'}
          sub={retentionNote ? `平均每 ${retentionNote.avgGap} 天回訪，預估下次 ${fmtDate(retentionNote.predicted)}` : null}
        />
      </div>

      <div className="panel notes-panel">
        <div className="notes-tags">
          <span className={'tag tag-photo-' + (customer.canPhotograph || 'unset')}>
            {customer.canPhotograph === 'yes' ? '可以拍照' : customer.canPhotograph === 'no' ? '不可拍照' : '拍照意願未確認'}
          </span>
          <span className={'tag tag-model-' + (customer.modelStatus || 'unset')}>
            {customer.modelStatus === 'active' ? '模特資格中' : customer.modelStatus === 'inactive' ? '已取消模特資格' : '非模特'}
          </span>
        </div>
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
                    {r.priceTier && r.priceTier !== 'normal' && (
                      <span className={'tier-tag tier-' + r.priceTier}>
                        {r.priceTier === 'trial' ? '首次體驗價' : '品牌體驗價'}
                      </span>
                    )}
                  </span>
                  <span className="strong">{fmtMoney(r.amount)}</span>
                </div>
                <div className="muted small">
                  付款：{r.paymentMethod}
                  {r.discount ? ` ・ 折扣：${fmtMoney(r.discount)}（原價 ${fmtMoney(r.listPrice)}）` : ''}
                  {r.source ? ` ・ 來源：${r.source}` : ''}
                  {r.notes ? ` ・ 備註：${r.notes}` : ''}
                </div>
              </div>
              <button className="icon-btn ghost" onClick={() => onDeleteRecord(r.id)}><Trash2 size={14} /></button>
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

function RevisitView({ data, onOpenCustomer, onMarkReminded }) {
  const list = useMemo(() => computeRevisitList(data), [data]);
  const [copiedId, setCopiedId] = useState('');
  const [fallbackText, setFallbackText] = useState(null);

  const copyMessage = async (item) => {
    const expireDate = fmtDate(addDays(item.lastDate, REVISIT_WINDOW_DAYS));
    const msg = `哈囉 ${item.customer.name}～提醒你上次到 HSIN.EE 除毛後的回訪優惠到 ${expireDate} 就到期囉，要幫你保留時段嗎？`;
    const ok = await copyToClipboard(msg);
    if (ok) {
      setCopiedId(item.customer.id);
      setTimeout(() => setCopiedId(''), 1800);
    } else {
      setFallbackText(msg);
    }
  };

  return (
    <div>
      <div className="view-head">
        <div>
          <h2 className="serif">回訪提醒</h2>
          <p className="muted">最近一次服務滿 {REVISIT_ALERT_START_DAY} 天起，到優惠期限（{REVISIT_WINDOW_DAYS} 天）前顯示在這裡</p>
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
                <button className="btn-secondary small" onClick={() => copyMessage(item)}>
                  {copiedId === item.customer.id ? '已複製訊息' : '複製提醒訊息'}
                </button>
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

      {fallbackText && <CopyFallbackModal text={fallbackText} onClose={() => setFallbackText(null)} />}
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

function AppointmentCardItem({ a, isCopied, onCopy, onToggleReminded, onDelete, onOpenCustomer }) {
  const upcoming = a.date >= todayISO();
  return (
    <li className={'appointment-card' + (a.source === 'record' && !upcoming ? ' is-record' : '')}>
      <div className="appointment-time">
        {a.time ? (<><Clock size={13} /> {a.time}</>) : (upcoming ? '未定時間' : '已完成服務')}
      </div>
      <div className="appointment-main">
        <button className="text-link strong" onClick={() => onOpenCustomer(a.customerId)}>{a.customer.name}</button>
        <span className="muted small"> {a.customer.phone}{a.customer.lineId ? ` ・ LINE ${a.customer.lineId}` : ''}</span>
        {a.serviceName && <div className="muted small">{a.serviceName}{a.source === 'record' ? ` ・ ${fmtMoney(a.amount)}` : ''}</div>}
        {a.notes && <div className="muted small">備註：{a.notes}</div>}
      </div>
      <div className="appointment-actions">
        {upcoming ? (
          <>
            {a.reminderSent && <span className="badge-reminded">已提醒</span>}
            <button className="btn-secondary small" onClick={() => onCopy(a)}>{isCopied ? '已複製訊息' : '複製提醒訊息'}</button>
            <button className={'btn-secondary small' + (a.reminderSent ? ' active' : '')} onClick={() => onToggleReminded(a)}>
              {a.reminderSent ? '取消標記' : '標記已提醒'}
            </button>
            <button className="icon-btn ghost" onClick={() => onDelete(a)}><Trash2 size={14} /></button>
          </>
        ) : (
          <>
            <span className="source-badge">已完成</span>
            <button className="icon-btn ghost" onClick={() => onDelete(a)}><Trash2 size={14} /></button>
          </>
        )}
      </div>
    </li>
  );
}

function CalendarView({ data, onAddRecord, onDeleteRecord, onDeleteAppointment, onToggleRecordReminded, onToggleAppointmentReminded, onOpenCustomer }) {
  const [period, setPeriod] = useState('week');
  const [monthCursor, setMonthCursor] = useState(new Date());
  const [selectedDay, setSelectedDay] = useState(todayISO());
  const [copiedId, setCopiedId] = useState('');
  const [fallbackText, setFallbackText] = useState(null);

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

  const copyReminder = async (appt) => {
    const msg = `Hi🤍～
提醒您明天 ${appt.time || ''} 在 HSIN.EE 有熱蠟保養預約唷！
⌂ 工作室地址
台北市大安區敦化南路一段190巷31號2樓
忠孝復興站 14號出口｜步行約2分鐘
( ˶ˊᵕˋ)੭ 前一天小提醒
・請勿使用酸類保養品
・請勿自行刮毛
・保養前可以多補充水分 ♡
明天見～期待為您服務 ( ˶ˆᗜˆ˵ )♡`;
    const ok = await copyToClipboard(msg);
    if (ok) {
      setCopiedId(appt.id);
      setTimeout(() => setCopiedId(''), 1800);
    } else {
      setFallbackText(msg);
    }
  };

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
                  isCopied={copiedId === a.id}
                  onCopy={copyReminder}
                  onToggleReminded={handleToggle}
                  onDelete={handleDelete}
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
                    isCopied={copiedId === a.id}
                    onCopy={copyReminder}
                    onToggleReminded={handleToggle}
                    onDelete={handleDelete}
                    onOpenCustomer={onOpenCustomer}
                  />
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      {fallbackText && <CopyFallbackModal text={fallbackText} onClose={() => setFallbackText(null)} />}
    </div>
  );
}

/* ============================================================
   新增服務紀錄
   ============================================================ */

function CustomerQuickPreview({ customer, records }) {
  const own = records.filter((r) => r.customerId === customer.id).sort((a, b) => (a.date < b.date ? 1 : -1));
  const recent = own.slice(0, 3);

  return (
    <div className="quick-preview">
      {(customer.canPhotograph !== 'unset' && customer.canPhotograph) || (customer.modelStatus !== 'unset' && customer.modelStatus) ? (
        <div className="notes-tags">
          {customer.canPhotograph && customer.canPhotograph !== 'unset' && (
            <span className={'tag tag-photo-' + customer.canPhotograph}>{customer.canPhotograph === 'yes' ? '可以拍照' : '不可拍照'}</span>
          )}
          {customer.modelStatus && customer.modelStatus !== 'unset' && (
            <span className={'tag tag-model-' + customer.modelStatus}>{customer.modelStatus === 'active' ? '模特資格中' : '已取消模特資格'}</span>
          )}
        </div>
      ) : null}

      {customer.notes && <p className="quick-preview-notes">備註：{customer.notes}</p>}

      {recent.length === 0 ? (
        <p className="muted small">這是這位客人的第一筆服務紀錄</p>
      ) : (
        <ul className="quick-preview-list">
          {recent.map((r) => (
            <li key={r.id}>
              <span className="muted small">{fmtDate(r.date)}</span>
              <span className="small">{r.serviceName}</span>
              <span className="muted small">{fmtMoney(r.amount)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AddRecordModal({ data, prefillCustomerId, onClose, onSave, onQuickAddCustomer }) {
  const [customerId, setCustomerId] = useState(prefillCustomerId || '');
  const [customerQuery, setCustomerQuery] = useState('');
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [quickName, setQuickName] = useState('');
  const [quickPhone, setQuickPhone] = useState('');

  const [date, setDate] = useState(todayISO());
  const [time, setTime] = useState('');
  const [serviceId, setServiceId] = useState('');
  const [listPrice, setListPrice] = useState('');
  const [hasDiscount, setHasDiscount] = useState(false);
  const [discountAmount, setDiscountAmount] = useState('');
  const [priceTier, setPriceTier] = useState('normal');
  const [paymentMethod, setPaymentMethod] = useState(PAYMENT_METHODS[0]);
  const [source, setSource] = useState('回訪');
  const [notes, setNotes] = useState('');

  const activeServices = data.services.filter((s) => s.active);
  const selectedService = activeServices.find((s) => s.id === serviceId);

  const isFirstTime = useMemo(() => {
    if (!customerId) return false;
    return !data.records.some((r) => r.customerId === customerId);
  }, [customerId, data.records]);

  const daysSinceLast = useMemo(() => {
    if (!customerId || isFirstTime) return null;
    const own = data.records.filter((r) => r.customerId === customerId).sort((a, b) => (a.date < b.date ? -1 : 1));
    if (own.length === 0) return null;
    return daysBetween(own[own.length - 1].date, todayISO());
  }, [customerId, isFirstTime, data.records]);

  // 客人選定後，依「首次消費 / 老客人」自動預選合理的價格方案
  useEffect(() => {
    if (!customerId) return;
    setPriceTier(isFirstTime ? 'trial' : 'normal');
  }, [customerId, isFirstTime]);

  // 服務項目或價格方案改變時，自動帶入對應價格
  useEffect(() => {
    if (!selectedService) return;
    const priceMap = { normal: selectedService.priceNormal, trial: selectedService.priceFirstTrial, brand: selectedService.priceBrandModel };
    const val = priceMap[priceTier];
    setListPrice(val !== undefined && val !== null ? String(val) : '');
  }, [serviceId, priceTier]);

  const custMatches = useMemo(() => {
    const term = customerQuery.trim().toLowerCase();
    if (!term) return [];
    return data.customers.filter((c) => c.name.toLowerCase().includes(term) || (c.phone || '').includes(term)).slice(0, 6);
  }, [customerQuery, data.customers]);

  const chosenCustomer = data.customers.find((c) => c.id === customerId);

  const selectService = (id) => setServiceId(id);

  const finalAmount = Math.max(0, Number(listPrice || 0) - (hasDiscount ? Number(discountAmount || 0) : 0));

  const canSubmit = customerId && serviceId && listPrice !== '';

  const submit = () => {
    if (!canSubmit) return;
    onSave({
      id: uid(),
      customerId,
      date,
      time,
      serviceId,
      serviceName: selectedService.name,
      listPrice: Number(listPrice),
      priceTier,
      discount: hasDiscount ? Number(discountAmount || 0) : 0,
      amount: finalAmount,
      paymentMethod,
      source: isFirstTime ? source : '回訪',
      notes: notes.trim(),
      reminderSent: false,
    });
  };

  const quickAddSubmit = () => {
    if (!quickName.trim() || !quickPhone.trim()) return;
    const newCust = onQuickAddCustomer({ name: quickName.trim(), phone: quickPhone.trim(), source });
    setCustomerId(newCust.id);
    setCustomerQuery('');
    setShowQuickAdd(false);
  };

  return (
    <Modal title="新增服務／預約紀錄" onClose={onClose} wide>
      <Field label="客人">
        {chosenCustomer ? (
          <>
            <div className="chosen-customer">
              <span className="strong">{chosenCustomer.name}</span>
              <span className="muted small">{chosenCustomer.phone}</span>
              <button className="text-link" onClick={() => setCustomerId('')}>更換</button>
            </div>
            <CustomerQuickPreview customer={chosenCustomer} records={data.records} />
          </>
        ) : (
          <>
            <input
              placeholder="輸入姓名或電話搜尋"
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
                    <span className="strong">{c.name}</span> <span className="muted small">{c.phone}</span>
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
                <button className="btn-secondary small" onClick={quickAddSubmit}>建立客人</button>
              </div>
            )}
          </>
        )}
      </Field>

      <div className="field-row">
        <Field label="日期"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="時間（預約可填，現場服務可留空）"><input type="time" value={time} onChange={(e) => setTime(e.target.value)} /></Field>
      </div>

      <Field label="服務項目">
        <select value={serviceId} onChange={(e) => selectService(e.target.value)}>
          <option value="">請選擇</option>
          {activeServices.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </Field>

      {selectedService && (
        <Field label="價格方案">
          <div className="pill-group">
            {PRICE_TIERS.map((t) => (
              <button
                key={t.id}
                type="button"
                className={'pill' + (priceTier === t.id ? ' active' : '')}
                onClick={() => setPriceTier(t.id)}
              >{t.label}（{fmtMoney(selectedService[t.id === 'normal' ? 'priceNormal' : t.id === 'trial' ? 'priceFirstTrial' : 'priceBrandModel'])}）</button>
            ))}
          </div>
          {isFirstTime && <span className="field-hint">首次消費，可選首次體驗價或品牌體驗價（模特招募）</span>}
          {!isFirstTime && daysSinceLast !== null && daysSinceLast <= REVISIT_WINDOW_DAYS && (
            <span className="field-hint">距離上次服務 {daysSinceLast} 天，仍在 6 週回訪優惠期內</span>
          )}
          {!isFirstTime && daysSinceLast !== null && daysSinceLast > REVISIT_WINDOW_DAYS && (
            <span className="field-hint">距離上次服務 {daysSinceLast} 天，已超過 6 週，建議選原價</span>
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

      <label className="checkbox-row">
        <input type="checkbox" checked={hasDiscount} onChange={(e) => setHasDiscount(e.target.checked)} />
        這筆有折扣金額
      </label>

      {hasDiscount && (
        <Field label="折扣金額">
          <input type="number" value={discountAmount} onChange={(e) => setDiscountAmount(e.target.value)} placeholder="0" />
        </Field>
      )}

      <div className="final-amount-row">
        <span className="muted">實收金額（自動計算）</span>
        <span className="strong">{fmtMoney(finalAmount)}</span>
      </div>

      {isFirstTime && (
        <Field label="客戶來源" hint="這是這位客人的第一筆消費">
          <select value={source} onChange={(e) => setSource(e.target.value)}>
            {data.sources.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
      )}

      <Field label="備註"><textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>

      <div className="modal-actions">
        <button className="btn-primary full" disabled={!canSubmit} onClick={submit}>完成服務</button>
      </div>
    </Modal>
  );
}

/* ============================================================
   服務項目管理
   ============================================================ */

function ServicesView({ data, onSave, onDelete }) {
  const [editing, setEditing] = useState(null); // service object or 'new'

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
              <th>項目</th><th>分類</th><th>原價</th><th>首次體驗價</th><th>品牌體驗價</th><th>時間</th><th>狀態</th><th></th>
            </tr>
          </thead>
          <tbody>
            {data.services.map((s) => (
              <tr key={s.id}>
                <td className="strong">{s.name}</td>
                <td>{s.category}</td>
                <td>{fmtMoney(s.priceNormal)}</td>
                <td>{fmtMoney(s.priceFirstTrial)}</td>
                <td>{fmtMoney(s.priceBrandModel)}</td>
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
          service={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSave={(s) => { onSave(s); setEditing(null); }}
          onDelete={editing !== 'new' ? () => { onDelete(editing.id); setEditing(null); } : null}
        />
      )}
    </div>
  );
}

function ServiceFormModal({ service, onClose, onSave, onDelete }) {
  const [form, setForm] = useState(service || {
    name: '', category: '', priceNormal: '', priceFirstTrial: '', priceBrandModel: '', duration: '', active: true,
  });
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = () => {
    if (!form.name.trim()) return;
    onSave({
      id: service ? service.id : uid(),
      name: form.name.trim(),
      category: form.category.trim(),
      priceNormal: Number(form.priceNormal) || 0,
      priceFirstTrial: Number(form.priceFirstTrial) || 0,
      priceBrandModel: Number(form.priceBrandModel) || 0,
      duration: Number(form.duration) || 0,
      active: form.active !== false,
    });
  };

  return (
    <Modal title={service ? '編輯服務項目' : '新增服務項目'} onClose={onClose}>
      <Field label="項目名稱"><input value={form.name} onChange={set('name')} autoFocus /></Field>
      <Field label="分類"><input value={form.category} onChange={set('category')} placeholder="例如：腿部 / 私密處" /></Field>
      <Field label="原價" hint="一般客人、超過 6 週回訪時的價格"><input type="number" value={form.priceNormal} onChange={set('priceNormal')} /></Field>
      <div className="field-row">
        <Field label="首次體驗價" hint="一般新客首次體驗價"><input type="number" value={form.priceFirstTrial} onChange={set('priceFirstTrial')} /></Field>
        <Field label="品牌體驗價" hint="體驗招募模特專用價"><input type="number" value={form.priceBrandModel} onChange={set('priceBrandModel')} /></Field>
      </div>
      <Field label="操作時間（分）"><input type="number" value={form.duration} onChange={set('duration')} /></Field>
      <label className="checkbox-row">
        <input type="checkbox" checked={form.active !== false} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
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
  const [showAdd, setShowAdd] = useState(false);
  const sorted = [...data.expenses].sort((a, b) => (a.date < b.date ? 1 : -1));
  const total = data.expenses.reduce((s, e) => s + Number(e.amount), 0);

  const byCategory = useMemo(() => {
    const map = {};
    EXPENSE_CATEGORIES.forEach((c) => { map[c.name] = 0; });
    data.expenses.forEach((e) => { map[e.category] = (map[e.category] || 0) + Number(e.amount || 0); });
    return EXPENSE_CATEGORIES.map((c) => ({ name: c.name, total: map[c.name] || 0 }));
  }, [data.expenses]);

  const monthCompare = useMemo(() => {
    const thisMonth = monthRange(0);
    const lastMonth = monthRange(-1);
    const sumByCategory = (range) => {
      const map = {};
      EXPENSE_CATEGORIES.forEach((c) => { map[c.name] = 0; });
      data.expenses
        .filter((e) => e.date >= range.start && e.date <= range.end)
        .forEach((e) => { map[e.category] = (map[e.category] || 0) + Number(e.amount || 0); });
      return map;
    };
    const currMap = sumByCategory(thisMonth);
    const prevMap = sumByCategory(lastMonth);
    const currTotal = Object.values(currMap).reduce((a, b) => a + b, 0);
    const prevTotal = Object.values(prevMap).reduce((a, b) => a + b, 0);
    const rows = EXPENSE_CATEGORIES.map((c) => ({ label: c.name, curr: currMap[c.name], prev: prevMap[c.name] }));
    return { thisLabel: thisMonth.label, lastLabel: lastMonth.label, currTotal, prevTotal, rows };
  }, [data.expenses]);

  return (
    <div>
      <div className="view-head">
        <div>
          <h2 className="serif">成本</h2>
          <p className="muted">累積支出 {fmtMoney(total)}</p>
        </div>
        <button className="btn-primary" onClick={() => setShowAdd(true)}><Plus size={16} /> 新增支出</button>
      </div>

      <div className="panel" style={{ marginBottom: 24 }}>
        <h4 className="panel-title">{monthCompare.thisLabel} vs {monthCompare.lastLabel}</h4>
        <table className="compare-table">
          <thead>
            <tr><th></th><th>{monthCompare.thisLabel}</th><th>{monthCompare.lastLabel}</th><th>成長率</th></tr>
          </thead>
          <tbody>
            <tr>
              <td className="strong">支出總額</td>
              <td className="strong">{fmtMoney(monthCompare.currTotal)}</td>
              <td className="muted">{fmtMoney(monthCompare.prevTotal)}</td>
              {(() => {
                const change = pctChange(monthCompare.currTotal, monthCompare.prevTotal);
                const positive = change !== null && change >= 0;
                return (
                  <td className={change === null ? 'muted' : positive ? 'change-down' : 'change-up'}>
                    {change === null ? '—' : `${positive ? '+' : ''}${change.toFixed(0)}%`}
                  </td>
                );
              })()}
            </tr>
            {monthCompare.rows.map((r) => {
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
                  <td><button className="icon-btn ghost" onClick={() => onDelete(e.id)}><Trash2 size={14} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showAdd && <ExpenseFormModal onClose={() => setShowAdd(false)} onSave={(e) => { onSave(e); setShowAdd(false); }} />}
    </div>
  );
}

function ExpenseFormModal({ onClose, onSave }) {
  const [category, setCategory] = useState(EXPENSE_CATEGORIES[0].name);
  const [date, setDate] = useState(todayISO());
  const [item, setItem] = useState('');
  const [amount, setAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState(PAYMENT_METHODS[0]);
  const [notes, setNotes] = useState('');

  const submit = () => {
    if (!amount || Number(amount) <= 0) return;
    onSave({
      id: uid(),
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
    <Modal title="新增支出" onClose={onClose}>
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
];

export default function App() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState('dashboard');
  const [selectedCustomerId, setSelectedCustomerId] = useState(null);
  const [customerModal, setCustomerModal] = useState(null); // null | 'new' | customer object
  const [addRecordFor, setAddRecordFor] = useState(null); // null | 'global' | customerId
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const initialized = useRef(false);

  useEffect(() => {
    (async () => {
      const loaded = await loadData();
      setData(loaded ? { ...emptyData(), ...loaded, appointments: loaded.appointments || [] } : emptyData());
      setLoading(false);
      initialized.current = true;
    })();
  }, []);

  useEffect(() => {
    if (!initialized.current || !data) return;
    persist(data);
  }, [data]);

  const updateData = useCallback((mutator) => {
    setData((prev) => {
      const next = { ...prev };
      mutator(next);
      return next;
    });
  }, []);

  if (loading || !data) {
    return <div className="loading-screen">載入中⋯</div>;
  }

  const openCustomer = (id) => { setSelectedCustomerId(id); setView('customerDetail'); };

  const handleSaveCustomer = (customer) => {
    updateData((d) => {
      const exists = d.customers.some((c) => c.id === customer.id);
      d.customers = exists ? d.customers.map((c) => (c.id === customer.id ? customer : c)) : [...d.customers, customer];
    });
    setCustomerModal(null);
  };

  const handleDeleteCustomer = (id) => {
    updateData((d) => {
      d.customers = d.customers.filter((c) => c.id !== id);
      d.records = d.records.filter((r) => r.customerId !== id);
    });
    setCustomerModal(null);
    if (selectedCustomerId === id) {
      setSelectedCustomerId(null);
      setView('customers');
    }
  };

  const quickAddCustomer = ({ name, phone, source }) => {
    const memberNo = nextMemberNo(data.customers);
    const cust = { id: uid(), memberNo, name, phone, lineId: '', email: '', birthday: '', source: source || '其他', firstVisitDate: todayISO(), notes: '', canPhotograph: 'unset', modelStatus: 'unset', reminderSentFor: '' };
    updateData((d) => { d.customers = [...d.customers, cust]; });
    return cust;
  };

  const handleAddRecord = (record) => {
    updateData((d) => { d.records = [...d.records, record]; });
    setAddRecordFor(null);
  };

  const handleDeleteRecord = (id) => {
    updateData((d) => { d.records = d.records.filter((r) => r.id !== id); });
  };

  const handleToggleRecordReminded = (id, mark) => {
    updateData((d) => {
      d.records = d.records.map((r) => r.id === id ? { ...r, reminderSent: mark } : r);
    });
  };

  const handleSaveService = (svc) => {
    updateData((d) => {
      const exists = d.services.some((s) => s.id === svc.id);
      d.services = exists ? d.services.map((s) => (s.id === svc.id ? svc : s)) : [...d.services, svc];
    });
  };
  const handleDeleteService = (id) => {
    updateData((d) => { d.services = d.services.filter((s) => s.id !== id); });
  };

  const handleSaveExpense = (exp) => {
    updateData((d) => { d.expenses = [...d.expenses, exp]; });
  };
  const handleDeleteExpense = (id) => {
    updateData((d) => { d.expenses = d.expenses.filter((e) => e.id !== id); });
  };

  const handleMarkReminded = (customerId, lastDate, mark) => {
    updateData((d) => {
      d.customers = d.customers.map((c) => c.id === customerId ? { ...c, reminderSentFor: mark ? lastDate : '' } : c);
    });
  };

  // 舊版預約資料（appointments）僅保留刪除與標記已提醒，供舊資料相容顯示；
  // 新增服務／預約一律走 handleAddRecord 統一表單。
  const handleDeleteAppointment = (id) => {
    updateData((d) => { d.appointments = d.appointments.filter((a) => a.id !== id); });
  };
  const handleToggleAppointmentReminded = (id, mark) => {
    updateData((d) => {
      d.appointments = d.appointments.map((a) => a.id === id ? { ...a, reminderSent: mark } : a);
    });
  };

  const goto = (id) => { setView(id); setMobileNavOpen(false); };

  return (
    <div className="app-root">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Noto+Serif+TC:wght@400;500;600;700&family=Noto+Sans+TC:wght@300;400;500;600;700&display=swap');

        .app-root {
          --cream: #FBF7F2;
          --beige: #F3EAE0;
          --rose: #C99A93;
          --rose-deep: #B98077;
          --brown: #4A3B32;
          --taupe: #9C8D82;
          --line: #E4DCD2;
          --white: #FFFFFF;
          --alert: #B15C52;

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
        .brand-mark { font-family: 'Noto Serif TC', serif; font-size: 20px; font-weight: 600; letter-spacing: 0.08em; }
        .brand-sub { font-size: 12px; color: var(--taupe); margin-top: 2px; }
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
        .main-area { flex: 1; padding: 40px 44px; max-width: 1100px; }
        .mobile-header { display: none; }

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
        .pill { font-family: inherit; font-size: 12px; padding: 7px 14px; border-radius: 20px; border: 1px solid var(--line); background: var(--white); color: var(--taupe); cursor: pointer; }
        .pill.active { background: var(--rose-deep); border-color: var(--rose-deep); color: var(--white); }

        .delete-confirm-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; flex: 1; }
        .btn-danger.small { padding: 6px 12px; font-size: 12px; }

        .notes-panel { margin-bottom: 8px; }
        .notes-tags { display: flex; gap: 8px; margin-bottom: 10px; flex-wrap: wrap; }
        .tag { font-size: 11px; padding: 4px 10px; border-radius: 20px; background: var(--beige); color: var(--taupe); }
        .tag-photo-yes { background: #E5EEE3; color: #5A7A54; }
        .tag-photo-no { background: #F3E1DE; color: var(--alert); }
        .tag-model-active { background: var(--beige); color: var(--rose-deep); font-weight: 600; }
        .tag-model-inactive { background: #EFEFEF; color: var(--taupe); }
        .notes-text { font-size: 13px; line-height: 1.6; margin: 0; white-space: pre-wrap; }

        .tier-tag { display: inline-block; font-size: 10px; font-weight: 500; padding: 2px 7px; border-radius: 20px; margin-left: 8px; vertical-align: middle; }
        .tier-tag.tier-trial { background: var(--beige); color: var(--rose-deep); }
        .tier-tag.tier-brand { background: #E5EEE3; color: #5A7A54; }

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
        .btn-primary:hover { background: #A66E64; }
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
        .field-row { display: flex; gap: 12px; }
        .field-label { font-size: 12px; color: var(--taupe); }
        .field-hint { font-size: 11px; color: var(--taupe); }
        .field input, .field select, .field textarea {
          font-family: inherit; font-size: 14px; padding: 9px 12px; border: 1px solid var(--line); border-radius: 5px; background: var(--white); color: var(--brown); width: 100%;
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
        .timeline-date { width: 88px; flex-shrink: 0; font-size: 13px; color: var(--taupe); padding-top: 2px; }
        .timeline-content { flex: 1; }
        .timeline-row { display: flex; justify-content: space-between; margin-bottom: 4px; font-size: 14px; }

        /* ---- Floating add button ---- */
        .fab { position: fixed; bottom: 28px; right: 28px; background: var(--rose-deep); color: var(--white); border: none; border-radius: 30px; padding: 14px 22px; font-family: inherit; font-size: 14px; font-weight: 600; display: flex; align-items: center; gap: 8px; box-shadow: 0 8px 20px rgba(74,59,50,0.25); cursor: pointer; z-index: 30; }

        .loading-screen { min-height: 100vh; display: flex; align-items: center; justify-content: center; font-family: 'Noto Serif TC', serif; color: #9C8D82; background: #FBF7F2; width: 100%; }

        @media (max-width: 860px) {
          .app-root { flex-direction: column; }
          .sidebar { display: none; }
          .mobile-header { display: flex; align-items: center; justify-content: space-between; padding: 16px 20px; background: var(--beige); border-bottom: 1px solid var(--line); }
          .mobile-nav { display: ${mobileNavOpen ? 'flex' : 'none'}; flex-direction: column; background: var(--beige); border-bottom: 1px solid var(--line); }
          .mobile-nav .nav-item { padding: 14px 20px; border-top: 1px solid var(--line); }
          .main-area { padding: 24px 18px 90px; }
          .kpi-grid, .kpi-grid.narrow { grid-template-columns: 1fr 1fr; }
          .chart-grid { grid-template-columns: 1fr; }
          .category-summary-grid { grid-template-columns: 1fr 1fr; }
          .compare-table { font-size: 12px; }
          .month-grid-wrap { padding: 10px; }
          .month-cell-day { font-size: 11px; }
          .month-cell { padding: 4px; min-height: 58px; }
          .month-cell-chip { font-size: 9px; }
          .view-head { align-items: flex-start; }
        }
      `}</style>

      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">HSIN.EE</div>
          <div className="brand-sub">工作室後台</div>
        </div>
        <ul className="nav-list">
          {NAV.map((n) => (
            <li key={n.id} className={'nav-item' + (view === n.id || (n.id === 'customers' && view === 'customerDetail') ? ' active' : '')} onClick={() => goto(n.id)}>
              <n.icon size={15} /> {n.label}
            </li>
          ))}
        </ul>
      </aside>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="mobile-header">
          <div className="brand-mark">HSIN.EE</div>
          <button className="icon-btn" onClick={() => setMobileNavOpen((v) => !v)}><Menu size={20} /></button>
        </div>
        <ul className="nav-list mobile-nav">
          {NAV.map((n) => (
            <li key={n.id} className={'nav-item' + (view === n.id ? ' active' : '')} onClick={() => goto(n.id)}>
              <n.icon size={15} /> {n.label}
            </li>
          ))}
        </ul>

        <main className="main-area">
          {view === 'dashboard' && <Dashboard data={data} />}

          {view === 'customers' && (
            <CustomersView data={data} onOpenCustomer={openCustomer} onAddCustomer={() => setCustomerModal('new')} onEditCustomer={(c) => setCustomerModal(c)} />
          )}

          {view === 'customerDetail' && (
            <CustomerDetail
              data={data}
              customerId={selectedCustomerId}
              onBack={() => setView('customers')}
              onAddRecord={(cid) => setAddRecordFor(cid)}
              onDeleteRecord={handleDeleteRecord}
              onDeleteAppointment={handleDeleteAppointment}
              onEditCustomer={(c) => setCustomerModal(c)}
            />
          )}

          {view === 'calendar' && (
            <CalendarView
              data={data}
              onAddRecord={() => setAddRecordFor('global')}
              onDeleteRecord={handleDeleteRecord}
              onDeleteAppointment={handleDeleteAppointment}
              onToggleRecordReminded={handleToggleRecordReminded}
              onToggleAppointmentReminded={handleToggleAppointmentReminded}
              onOpenCustomer={openCustomer}
            />
          )}

          {view === 'revisit' && (
            <RevisitView data={data} onOpenCustomer={openCustomer} onMarkReminded={handleMarkReminded} />
          )}

          {view === 'services' && <ServicesView data={data} onSave={handleSaveService} onDelete={handleDeleteService} />}

          {view === 'expenses' && <ExpensesView data={data} onSave={handleSaveExpense} onDelete={handleDeleteExpense} />}
        </main>
      </div>

      <button className="fab" onClick={() => setAddRecordFor('global')}><Plus size={18} /> 新增服務</button>

      {customerModal && (
        <CustomerFormModal
          data={data}
          customer={customerModal === 'new' ? null : customerModal}
          onClose={() => setCustomerModal(null)}
          onSave={handleSaveCustomer}
          onDelete={handleDeleteCustomer}
        />
      )}

      {addRecordFor && (
        <AddRecordModal
          data={data}
          prefillCustomerId={addRecordFor === 'global' ? '' : addRecordFor}
          onClose={() => setAddRecordFor(null)}
          onSave={handleAddRecord}
          onQuickAddCustomer={quickAddCustomer}
        />
      )}
    </div>
  );
}
