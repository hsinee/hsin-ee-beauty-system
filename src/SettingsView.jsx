import React, { useRef, useState } from 'react';
import { Trash2, GripVertical } from 'lucide-react';
import { exportBackup, restoreFromBackup, restoreStoreSettings, verifyPin, updateStore } from './lib/localStore.js';

// 拖曳排序：抓住拖曳手把（setPointerCapture 讓後面的移動/放開事件都固定送到這個手把，
// 不會因為清單重新排序、手把在畫面上的位置跟著換了就追丟），移動時用 elementFromPoint
// 找出目前壓在哪一列上面，跟原本拖的那一列不同就直接交換順序，放開就結束。
// 用滑鼠事件也是同一套（PointerEvent 本身就同時涵蓋滑鼠和觸控）。
//
// 之前試過用 requestAnimationFrame 節流＋FLIP 動畫讓排序有滑動效果，結果在實際裝置上
// 反而更卡（每次排序都要量測所有列的位置，強制瀏覽器重新計算版面，比原本單純交換陣列
// 還貴），而且拖曳判定變慢之後，手指反而更容易被系統判定成「長按選字」而跳出選字狀態。
// 所以拿掉那些花俏的動畫，改成最單純、開銷最小的寫法：判斷到要換順序就直接換，靠下面的
// CSS（.reorder-row 全面關掉文字選取／長按選單）來解決選到字的問題，用最少的運算量換取
// 手指跟畫面之間的延遲降到最低——拖曳排序真正「順不順」，反應延遲比有沒有動畫更關鍵。
function useDragReorder(items, setItems) {
  const [draggingId, setDraggingId] = useState(null);
  // 放開／取消時一定要明確釋放指標鎖定，不要依賴瀏覽器自動釋放——沒放乾淨的話，
  // 拖曳手把會一直吃掉後面的點擊事件，導致放開拖曳之後畫面其他按鈕點了沒反應。
  const releaseCapture = (e) => {
    if (e && e.pointerId != null && e.currentTarget?.releasePointerCapture) {
      try { e.currentTarget.releasePointerCapture(e.pointerId); } catch (err) { /* 沒有鎖定就不用釋放 */ }
    }
  };
  const dragHandleProps = (id) => ({
    onPointerDown: (e) => {
      e.preventDefault();
      setDraggingId(id);
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch (err) { /* 沒有真正作用中的指標時 capture 會失敗 */ }
    },
    onPointerMove: (e) => {
      if (draggingId == null) return;
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const row = el && el.closest('[data-reorder-id]');
      if (!row) return;
      const overId = row.getAttribute('data-reorder-id');
      if (overId === String(draggingId)) return;
      const fromIndex = items.findIndex((it) => String(it.id) === String(draggingId));
      const toIndex = items.findIndex((it) => String(it.id) === overId);
      if (fromIndex === -1 || toIndex === -1) return;
      const next = [...items];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      setItems(next);
    },
    onPointerUp: (e) => { releaseCapture(e); setDraggingId(null); },
    onPointerCancel: (e) => { releaseCapture(e); setDraggingId(null); },
  });
  return { draggingId, dragHandleProps };
}

function downloadJSON(filename, obj) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function newId(prefix) {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return prefix + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
}

const STARTER_TEMPLATES = [
  {
    name: '預約提醒',
    content: 'Hi {{姓名}}您好，提醒您 {{日期}} {{時間}} 在{{店名}}有預約唷！地址：{{地址}}，如需更改時間歡迎與我們聯繫～',
  },
  {
    name: '回訪提醒',
    content: 'Hi {{姓名}}，您上次到{{店名}}的服務已經有一段時間囉，很想念您，歡迎回來保養～有任何問題歡迎加LINE詢問：{{LINE}}',
  },
  {
    name: '訂金/付款通知',
    content: 'Hi {{姓名}}，已收到您的款項，期待 {{日期}} {{時間}} 為您服務！有任何問題歡迎聯繫電話 {{電話}} 或 LINE：{{LINE}}',
  },
];

function resizeImageToDataUrl(file, maxSize = 300) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('讀取圖片失敗'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('圖片格式無法讀取'));
      img.onload = () => {
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/png'));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
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

export default function SettingsView({ store, onSave }) {
  const [form, setForm] = useState({
    name: store.name || '',
    loginTitle: store.loginTitle || '',
    primaryColor: store.primaryColor || '#c58f82',
    backgroundColor: store.backgroundColor || '#f1ebe5',
    phone: store.phone || '',
    igHandle: store.igHandle || '',
    lineId: store.lineId || '',
    address: store.address || '',
    discountPresetsEnabled: !!store.discountPresetsEnabled,
  });
  const [logoUrl, setLogoUrl] = useState(store.logoUrl || '');
  const [priceTiers, setPriceTiers] = useState(
    store.priceTiers && store.priceTiers.length ? store.priceTiers : [{ id: newId('tier'), label: '原價' }]
  );
  const [products, setProducts] = useState(store.products || []);
  const productDrag = useDragReorder(products, setProducts);
  const [templates, setTemplates] = useState(store.messageTemplates || []);
  const [contracts, setContracts] = useState(store.contracts || []);
  const [staff, setStaff] = useState(store.staff || []);
  const [customerFields, setCustomerFields] = useState(store.customerFields || []);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupError, setBackupError] = useState('');
  const [backupDone, setBackupDone] = useState('');
  const [pendingImport, setPendingImport] = useState(null);
  const fileInputRef = useRef(null);

  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmNewPin, setConfirmNewPin] = useState('');
  const [pinError, setPinError] = useState('');
  const [pinDone, setPinDone] = useState('');

  const handleChangePin = async (e) => {
    e.preventDefault();
    setPinError('');
    setPinDone('');
    if (!verifyPin(currentPin)) { setPinError('目前的 PIN 碼不正確'); return; }
    if (!/^\d{4}$/.test(newPin)) { setPinError('新 PIN 碼請輸入 4 位數字'); return; }
    if (newPin !== confirmNewPin) { setPinError('兩次輸入的新 PIN 碼不一致'); return; }
    await updateStore(store.id, { pin: newPin });
    setCurrentPin('');
    setNewPin('');
    setConfirmNewPin('');
    setPinDone('PIN 碼已更新');
  };

  const set = (k) => (e) => { setForm({ ...form, [k]: e.target.value }); setSaved(false); };
  const setChecked = (k) => (e) => { setForm({ ...form, [k]: e.target.checked }); setSaved(false); };

  const setProductField = (id, field, value) => {
    setProducts(products.map((p) => (p.id === id ? { ...p, [field]: value } : p)));
    setSaved(false);
  };
  const addProduct = () => {
    setProducts([...products, { id: newId('prod'), name: '', price: '', stock: '', lowStockThreshold: '' }]);
    setSaved(false);
  };
  const removeProduct = (id) => {
    setProducts(products.filter((p) => p.id !== id));
    setSaved(false);
  };

  const setStaffField = (id, field, value) => {
    setStaff(staff.map((s) => (s.id === id ? { ...s, [field]: value } : s)));
    setSaved(false);
  };
  const addStaff = () => {
    setStaff([...staff, { id: newId('staff'), name: '', active: true }]);
    setSaved(false);
  };
  const removeStaff = (id) => {
    setStaff(staff.filter((s) => s.id !== id));
    setSaved(false);
  };

  const handleExportBackup = async () => {
    setBackupBusy(true);
    setBackupError('');
    setBackupDone('');
    try {
      const backup = await exportBackup(store);
      const safeName = (store.name || '工作室').replace(/[\\/:*?"<>|]/g, '');
      const stamp = new Date().toISOString().slice(0, 10);
      downloadJSON(`${safeName}_備份_${stamp}.json`, backup);
      setBackupDone('已下載備份檔');
    } catch (err) {
      setBackupError(err.message);
    } finally {
      setBackupBusy(false);
    }
  };

  const handleImportClick = () => fileInputRef.current?.click();

  const handleImportFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBackupError('');
    setBackupDone('');
    try {
      const backup = JSON.parse(await file.text());
      if (!backup || (!backup.data && !backup.store)) throw new Error('empty');
      setPendingImport(backup);
    } catch (err) {
      setBackupError('這個檔案不是有效的備份檔（JSON 格式錯誤）');
    }
  };

  const cancelImport = () => setPendingImport(null);

  const handleRestoreAll = async () => {
    const ok = window.confirm(
      '還原備份會刪除目前系統裡「這間店」所有的客戶、服務項目、服務紀錄、成本資料，改成備份檔裡的內容，動作無法復原。\n\n確定要繼續嗎？'
    );
    if (!ok) return;
    setBackupBusy(true);
    try {
      await restoreFromBackup(store.id, pendingImport);
      if (pendingImport.store) await restoreStoreSettings(store.id, pendingImport);
      setBackupDone('還原完成，頁面即將重新整理');
      setTimeout(() => window.location.reload(), 1200);
    } catch (err) {
      setBackupError(err.message);
      setBackupBusy(false);
    }
  };

  const handleRestoreSettingsOnly = async () => {
    setBackupBusy(true);
    try {
      await restoreStoreSettings(store.id, pendingImport);
      setBackupDone('品牌設定已還原（客戶資料未變動），頁面即將重新整理');
      setTimeout(() => window.location.reload(), 1200);
    } catch (err) {
      setBackupError(err.message);
      setBackupBusy(false);
    }
  };

  const setTierLabel = (id, label) => {
    setPriceTiers(priceTiers.map((t) => (t.id === id ? { ...t, label } : t)));
    setSaved(false);
  };
  const setTrialDefault = (id) => {
    setPriceTiers(priceTiers.map((t) => ({ ...t, trialDefault: t.id === id })));
    setSaved(false);
  };
  const addTier = () => {
    setPriceTiers([...priceTiers, { id: newId('tier'), label: '' }]);
    setSaved(false);
  };
  const removeTier = (id) => {
    if (priceTiers.length <= 1) return;
    setPriceTiers(priceTiers.filter((t) => t.id !== id));
    setSaved(false);
  };

  const setCustomFieldLabel = (id, label) => {
    setCustomerFields(customerFields.map((f) => (f.id === id ? { ...f, label } : f)));
    setSaved(false);
  };
  const setCustomFieldRequired = (id, required) => {
    setCustomerFields(customerFields.map((f) => (f.id === id ? { ...f, required } : f)));
    setSaved(false);
  };
  const addCustomField = () => {
    setCustomerFields([...customerFields, { id: newId('field'), label: '', required: false }]);
    setSaved(false);
  };
  const removeCustomField = (id) => {
    setCustomerFields(customerFields.filter((f) => f.id !== id));
    setSaved(false);
  };

  const setTemplateField = (id, field, value) => {
    setTemplates(templates.map((t) => (t.id === id ? { ...t, [field]: value } : t)));
    setSaved(false);
  };
  const addTemplate = () => {
    setTemplates([...templates, { id: newId('tpl'), name: '', content: '' }]);
    setSaved(false);
  };
  const applyStarterTemplates = () => {
    setTemplates([...templates, ...STARTER_TEMPLATES.map((t) => ({ ...t, id: newId('tpl') }))]);
    setSaved(false);
  };
  const removeTemplate = (id) => {
    setTemplates(templates.filter((t) => t.id !== id));
    setSaved(false);
  };

  const setContractField = (id, field, value) => {
    setContracts(contracts.map((c) => (c.id === id ? { ...c, [field]: value } : c)));
    setSaved(false);
  };
  const addContract = () => {
    setContracts([...contracts, { id: newId('contract'), name: '', content: '' }]);
    setSaved(false);
  };
  const removeContract = (id) => {
    setContracts(contracts.filter((c) => c.id !== id));
    setSaved(false);
  };

  const handleLogoChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await resizeImageToDataUrl(file, 300);
      setLogoUrl(dataUrl);
      setSaved(false);
    } catch (err) {
      setError(err.message);
    }
  };

  const submit = async () => {
    const cleanedTiers = priceTiers.map((t) => ({ ...t, label: t.label.trim() })).filter((t) => t.label);
    if (cleanedTiers.length === 0) {
      setError('至少要保留一個價格方案');
      return;
    }
    const cleanedTemplates = templates.map((t) => ({ ...t, name: t.name.trim(), content: t.content.trim() })).filter((t) => t.name && t.content);
    const cleanedCustomerFields = customerFields.map((f) => ({ ...f, label: f.label.trim() })).filter((f) => f.label);
    const cleanNum = (v) => (v === '' || v === undefined || v === null ? '' : Number(v) || 0);
    const cleanedProducts = products
      .map((p) => ({ ...p, name: p.name.trim(), price: Number(p.price) || 0, stock: cleanNum(p.stock), lowStockThreshold: cleanNum(p.lowStockThreshold) }))
      .filter((p) => p.name);
    const cleanedContracts = contracts.map((c) => ({ ...c, name: c.name.trim(), content: c.content.trim() })).filter((c) => c.name && c.content);
    const cleanedStaff = staff.map((s) => ({ ...s, name: s.name.trim() })).filter((s) => s.name);
    setSaving(true);
    setError('');
    try {
      await onSave({ ...form, logoUrl, priceTiers: cleanedTiers, messageTemplates: cleanedTemplates, customerFields: cleanedCustomerFields, products: cleanedProducts, contracts: cleanedContracts, staff: cleanedStaff });
      setPriceTiers(cleanedTiers);
      setTemplates(cleanedTemplates);
      setContracts(cleanedContracts);
      setCustomerFields(cleanedCustomerFields);
      setProducts(cleanedProducts);
      setStaff(cleanedStaff);
      setSaved(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div className="view-head">
        <div>
          <h2 className="serif">品牌設定</h2>
          <p className="muted">這裡設定的內容會套用到整個系統的外觀與提醒訊息</p>
        </div>
      </div>

      <div className="panel" style={{ maxWidth: 480 }}>
        <Field label="Logo">
          {logoUrl && <img src={logoUrl} alt="logo" style={{ width: 96, display: 'block', marginBottom: 10, borderRadius: 6 }} />}
          <input type="file" accept="image/*" onChange={handleLogoChange} />
        </Field>
        <Field label="品牌 / 店家名稱"><input value={form.name} onChange={set('name')} placeholder="例如：芯伊 HSIN.EE" /></Field>
        <Field label="後台副標題" hint="顯示在後台側邊欄 Logo 下方"><input value={form.loginTitle} onChange={set('loginTitle')} placeholder="例如：芯伊工作室後台" /></Field>
        <Field label="品牌主色" hint="按鈕、選單標示等強調色">
          <input type="color" value={form.primaryColor} onChange={set('primaryColor')} style={{ width: 60, height: 34, padding: 2 }} />
        </Field>
        <Field label="系統背景色" hint="整個後台的底色，建議選淺色，避免文字看不清楚">
          <input type="color" value={form.backgroundColor} onChange={set('backgroundColor')} style={{ width: 60, height: 34, padding: 2 }} />
        </Field>
        <Field label="店家電話"><input value={form.phone} onChange={set('phone')} /></Field>
        <Field label="IG"><input value={form.igHandle} onChange={set('igHandle')} placeholder="@your_studio" /></Field>
        <Field label="LINE ID"><input value={form.lineId} onChange={set('lineId')} /></Field>
        <Field label="工作室地址" hint="會出現在預約提醒訊息裡"><textarea rows={2} value={form.address} onChange={set('address')} /></Field>
      </div>

      <div className="panel" style={{ maxWidth: 480, marginTop: 18 }}>
        <div className="field-label" style={{ marginBottom: 4 }}>價格方案</div>
        <p className="muted small" style={{ marginBottom: 12 }}>
          每個服務項目都會依這裡設定的方案分別填價格。用不到多種價格的店家，留一個方案就好；
          需要「新客優惠價」之類邏輯的店家，可以多加方案，並勾選其中一個當作首次消費的預設方案。
        </p>
        {priceTiers.map((t) => (
          <div key={t.id} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginBottom: 8, maxWidth: '100%' }}>
            <input
              value={t.label}
              onChange={(e) => setTierLabel(t.id, e.target.value)}
              placeholder="方案名稱，例如：原價"
              style={{ flex: '1 1 140px', minWidth: 0 }}
            />
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--taupe, #8f8178)', whiteSpace: 'nowrap' }}>
              <input type="radio" name="trialDefault" checked={!!t.trialDefault} onChange={() => setTrialDefault(t.id)} />
              新客預設
            </label>
            <button
              type="button"
              className="icon-btn ghost"
              onClick={() => removeTier(t.id)}
              disabled={priceTiers.length <= 1}
              title="刪除方案"
            ><Trash2 size={14} /></button>
          </div>
        ))}
        <button type="button" className="btn-secondary small" onClick={addTier}>+ 新增方案</button>

        <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--line, #ded4cc)' }}>
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13 }}>
            <input type="checkbox" checked={form.discountPresetsEnabled} onChange={setChecked('discountPresetsEnabled')} style={{ marginTop: 2 }} />
            <span>
              啟用折扣快速選擇（例如九折、八折）
              <br />
              <span className="muted small">開啟後，新增服務紀錄時可以直接選折扣成數自動算金額，不用自己按計算機。不需要打折的店家可以不用開啟。</span>
            </span>
          </label>
        </div>
      </div>

      <div className="panel" style={{ maxWidth: 480, marginTop: 18 }}>
        <div className="field-label" style={{ marginBottom: 4 }}>商品項目</div>
        <p className="muted small" style={{ marginBottom: 12 }}>
          店裡如果有賣保養品、工具等零售商品，可以先在這裡建好名稱和價格。之後新增服務紀錄時，
          如果這位客人這次也順便買了商品，直接勾選就好，不用每次手動輸入金額，
          而且會跟「加購」分開統計，方便你知道商品銷售額。
        </p>
        <p className="muted small" style={{ marginBottom: 12 }}>
          庫存和低庫存提醒都是選填：填了庫存數字，之後客人購買這個商品時系統會自動幫你扣庫存（編輯或刪除紀錄也會自動加回來）；
          不填庫存就代表這個商品不追蹤庫存。庫存數字本身也可以隨時回來這裡手動修改（例如盤點、進貨）。
        </p>
        <p className="muted small" style={{ marginBottom: 12 }}>可以按住最前面的「⠿」拖曳調整商品排列順序，新增服務紀錄時就會照這個順序顯示。</p>
        {products.map((p) => (
          <div
            key={p.id}
            data-reorder-id={p.id}
            className={`reorder-row${productDrag.draggingId === p.id ? ' dragging' : ''}`}
            style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginBottom: 8, maxWidth: '100%', padding: '4px 6px' }}
          >
            <span
              {...productDrag.dragHandleProps(p.id)}
              className="icon-btn ghost drag-handle"
              style={{ cursor: 'grab', touchAction: 'none' }}
              title="拖曳排序"
            ><GripVertical size={16} /></span>
            <input
              value={p.name}
              onChange={(e) => setProductField(p.id, 'name', e.target.value)}
              placeholder="商品名稱，例如：保濕精華"
              style={{ flex: '1 1 140px', minWidth: 0 }}
            />
            <input
              type="number"
              value={p.price}
              onChange={(e) => setProductField(p.id, 'price', e.target.value)}
              placeholder="價格"
              style={{ width: 90, minWidth: 0 }}
            />
            <input
              type="number"
              value={p.stock ?? ''}
              onChange={(e) => setProductField(p.id, 'stock', e.target.value)}
              placeholder="庫存（選填）"
              style={{ width: 100, minWidth: 0 }}
            />
            <input
              type="number"
              value={p.lowStockThreshold ?? ''}
              onChange={(e) => setProductField(p.id, 'lowStockThreshold', e.target.value)}
              placeholder="低庫存提醒門檻"
              style={{ width: 110, minWidth: 0 }}
            />
            <button
              type="button"
              className="icon-btn ghost"
              onClick={() => removeProduct(p.id)}
              title="刪除商品"
            ><Trash2 size={14} /></button>
          </div>
        ))}
        <button type="button" className="btn-secondary small" onClick={addProduct}>+ 新增商品</button>
      </div>

      <div className="panel" style={{ maxWidth: 480, marginTop: 18 }}>
        <div className="field-label" style={{ marginBottom: 4 }}>客戶自訂欄位</div>
        <p className="muted small" style={{ marginBottom: 12 }}>
          新增客戶時，除了姓名/電話這些基本資料，你可以自己加欄位讓員工填寫（例如過敏史、拍照意願、
          會員等級等等，任何美業項目都能自己定義）。勾選「必填」的欄位，新增客戶時沒填會擋下不能存檔。
        </p>
        {customerFields.map((f) => (
          <div key={f.id} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginBottom: 8, maxWidth: '100%' }}>
            <input
              value={f.label}
              onChange={(e) => setCustomFieldLabel(f.id, e.target.value)}
              placeholder="欄位名稱，例如：過敏史"
              style={{ flex: '1 1 140px', minWidth: 0 }}
            />
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--taupe, #8f8178)', whiteSpace: 'nowrap' }}>
              <input type="checkbox" checked={!!f.required} onChange={(e) => setCustomFieldRequired(f.id, e.target.checked)} />
              必填
            </label>
            <button
              type="button"
              className="icon-btn ghost"
              onClick={() => removeCustomField(f.id)}
              title="刪除欄位"
            ><Trash2 size={14} /></button>
          </div>
        ))}
        <button type="button" className="btn-secondary small" onClick={addCustomField}>+ 新增欄位</button>
      </div>

      <div className="panel" style={{ maxWidth: 480, marginTop: 18 }}>
        <div className="field-label" style={{ marginBottom: 4 }}>訊息範本</div>
        <p className="muted small" style={{ marginBottom: 12 }}>
          自己新增任意數量的範本，例如「預約提醒」「施作前注意事項」「施作後保養」「訂金通知」。
          內容裡可以用這些變數，複製時會自動換成當下這位客人的資料：
          <br />
          <code>{'{{姓名}}'}</code> <code>{'{{日期}}'}</code> <code>{'{{時間}}'}</code>{' '}
          <code>{'{{會員編號}}'}</code> <code>{'{{店名}}'}</code> <code>{'{{地址}}'}</code>{' '}
          <code>{'{{電話}}'}</code> <code>{'{{IG}}'}</code> <code>{'{{LINE}}'}</code>{' '}
          <code>{'{{到期日}}'}</code>（只有回訪提醒那裡才有值）
        </p>
        {templates.map((t) => (
          <div key={t.id} style={{ border: '1px solid var(--line, #ded4cc)', borderRadius: 6, padding: 12, marginBottom: 10 }}>
            <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
              <input
                value={t.name}
                onChange={(e) => setTemplateField(t.id, 'name', e.target.value)}
                placeholder="範本名稱，例如：預約提醒"
                style={{ flex: '1 1 140px', minWidth: 0 }}
              />
              <button type="button" className="icon-btn ghost" onClick={() => removeTemplate(t.id)} title="刪除範本">
                <Trash2 size={14} />
              </button>
            </div>
            <textarea
              rows={4}
              value={t.content}
              onChange={(e) => setTemplateField(t.id, 'content', e.target.value)}
              placeholder={'例如：Hi {{姓名}}～提醒您明天 {{時間}} 有預約唷！地址：{{地址}}'}
              style={{ width: '100%' }}
            />
          </div>
        ))}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button type="button" className="btn-secondary small" onClick={addTemplate}>+ 新增範本</button>
          {templates.length === 0 && (
            <button type="button" className="text-link" onClick={applyStarterTemplates}>套用範例範本，之後可以自己改</button>
          )}
        </div>
      </div>

      <div className="panel" style={{ maxWidth: 480, marginTop: 18 }}>
        <div className="field-label" style={{ marginBottom: 4 }}>契約範本</div>
        <p className="muted small" style={{ marginBottom: 12 }}>
          新增契約全文（例如同意書、注意事項聲明），存好後到「服務項目」編輯畫面，把需要的服務項目
          連結到對應的契約。之後新增這個服務的紀錄時，會先顯示這份契約內容給客戶看，並要求客戶簽名才能完成。
        </p>
        {contracts.map((c) => (
          <div key={c.id} style={{ border: '1px solid var(--line, #ded4cc)', borderRadius: 6, padding: 12, marginBottom: 10 }}>
            <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
              <input
                value={c.name}
                onChange={(e) => setContractField(c.id, 'name', e.target.value)}
                placeholder="契約名稱，例如：熱蠟除毛服務同意書"
                style={{ flex: '1 1 140px', minWidth: 0 }}
              />
              <button type="button" className="icon-btn ghost" onClick={() => removeContract(c.id)} title="刪除契約">
                <Trash2 size={14} />
              </button>
            </div>
            <textarea
              rows={8}
              value={c.content}
              onChange={(e) => setContractField(c.id, 'content', e.target.value)}
              placeholder="貼上完整契約內容⋯"
              style={{ width: '100%' }}
            />
          </div>
        ))}
        <button type="button" className="btn-secondary small" onClick={addContract}>+ 新增契約</button>
      </div>

      <div className="panel" style={{ maxWidth: 480, marginTop: 18 }}>
        <div className="field-label" style={{ marginBottom: 4 }}>服務老師</div>
        <p className="muted small" style={{ marginBottom: 12 }}>
          建好名單後，新增服務紀錄時可以選這次是哪位老師服務的，「業績」頁面就能依老師分別統計；
          編輯紀錄時如果改到金額、服務老師等關鍵欄位，系統也會記一筆修改紀錄，方便對業績帳的時候查對。
        </p>
        {staff.map((s) => (
          <div key={s.id} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginBottom: 8, maxWidth: '100%' }}>
            <input
              value={s.name}
              onChange={(e) => setStaffField(s.id, 'name', e.target.value)}
              placeholder="老師姓名"
              style={{ flex: '1 1 140px', minWidth: 0 }}
            />
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, whiteSpace: 'nowrap' }}>
              <input type="checkbox" checked={s.active !== false} onChange={(e) => setStaffField(s.id, 'active', e.target.checked)} />
              啟用中
            </label>
            <button type="button" className="icon-btn ghost" onClick={() => removeStaff(s.id)} title="刪除">
              <Trash2 size={14} />
            </button>
          </div>
        ))}
        <button type="button" className="btn-secondary small" onClick={addStaff}>+ 新增服務老師</button>
      </div>

      <div className="panel" style={{ maxWidth: 480, marginTop: 18 }}>
        <div className="field-label" style={{ marginBottom: 4 }}>資料備份 / 換裝置</div>
        <p className="muted small" style={{ marginBottom: 12 }}>
          匯出一份完整備份檔（.json），可以自己留存，或是換手機/平板時，先在舊裝置匯出，
          登入新裝置後在這裡匯入即可搬過去。跟 Dashboard 那個「匯出全部系統資料」不一樣：
          那個 Excel 是給人看的報表，這裡的備份檔是給系統讀回去用的。
        </p>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
          <button type="button" className="btn-secondary small" onClick={handleExportBackup} disabled={backupBusy}>
            {backupBusy ? '處理中⋯' : '匯出備份 (.json)'}
          </button>
          <button type="button" className="btn-secondary small" onClick={handleImportClick} disabled={backupBusy}>
            選擇備份檔匯入
          </button>
          <input ref={fileInputRef} type="file" accept="application/json,.json" onChange={handleImportFile} style={{ display: 'none' }} />
        </div>
        <p className="muted small" style={{ color: '#b56f65' }}>
          ⚠️ 匯入備份預設會覆蓋目前系統裡這間店現有的客戶／服務項目／服務紀錄／成本資料，無法復原，請小心操作。
        </p>
        {backupError && <p style={{ color: '#b56f65', fontSize: 13 }}>{backupError}</p>}
        {backupDone && <p style={{ color: '#4c7a3f', fontSize: 13 }}>{backupDone}</p>}

        {pendingImport && (
          <div style={{ marginTop: 12, padding: 12, background: 'var(--beige, #f1ebe5)', borderRadius: 6 }}>
            <p className="muted small" style={{ marginBottom: 10 }}>
              備份檔已讀取{pendingImport.exportedAt ? `（匯出時間：${new Date(pendingImport.exportedAt).toLocaleString()}）` : ''}，請選擇要還原的內容：
            </p>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button type="button" className="btn-primary" onClick={handleRestoreAll} disabled={backupBusy}>
                還原全部（含客戶資料，會覆蓋）
              </button>
              {pendingImport.store && (
                <button type="button" className="btn-secondary small" onClick={handleRestoreSettingsOnly} disabled={backupBusy}>
                  只還原品牌設定（不影響客戶資料）
                </button>
              )}
              <button type="button" className="text-link" onClick={cancelImport} disabled={backupBusy}>取消</button>
            </div>
            <p className="muted small" style={{ marginTop: 8 }}>
              「只還原品牌設定」適合同一家店在瀏覽器分頁和主畫面圖示上資料不同步的情況，
              可以放心用，不會動到這個裝置上的客戶／服務／紀錄／成本資料，也不會改 PIN 碼。
            </p>
          </div>
        )}
      </div>

      <div className="panel" style={{ maxWidth: 480, marginTop: 18 }}>
        <div className="field-label" style={{ marginBottom: 4 }}>PIN 碼</div>
        <p className="muted small" style={{ marginBottom: 12 }}>更改進入後台用的 4 位數 PIN 碼，需要先輸入目前的 PIN 碼才能改。</p>
        <form onSubmit={handleChangePin}>
          {pinError && <p style={{ color: '#b56f65', fontSize: 13 }}>{pinError}</p>}
          {pinDone && <p style={{ color: '#4c7a3f', fontSize: 13 }}>{pinDone}</p>}
          <Field label="目前 PIN 碼">
            <input inputMode="numeric" maxLength={4} value={currentPin} onChange={(e) => setCurrentPin(e.target.value.replace(/\D/g, '').slice(0, 4))} />
          </Field>
          <Field label="新 PIN 碼">
            <input inputMode="numeric" maxLength={4} value={newPin} onChange={(e) => setNewPin(e.target.value.replace(/\D/g, '').slice(0, 4))} />
          </Field>
          <Field label="再輸入一次新 PIN 碼">
            <input inputMode="numeric" maxLength={4} value={confirmNewPin} onChange={(e) => setConfirmNewPin(e.target.value.replace(/\D/g, '').slice(0, 4))} />
          </Field>
          <button type="submit" className="btn-secondary small">更新 PIN 碼</button>
        </form>
      </div>

      <div className="panel" style={{ maxWidth: 480, marginTop: 18 }}>
        {error && <p style={{ color: '#b56f65', fontSize: 13 }}>{error}</p>}
        <div className="modal-actions">
          <button className="btn-primary full" onClick={submit} disabled={saving}>
            {saving ? '儲存中⋯' : saved ? '已儲存' : '儲存設定'}
          </button>
        </div>
      </div>

      <p className="muted small" style={{ marginTop: 18, wordBreak: 'break-all' }}>
        目前使用的網址：{typeof window !== 'undefined' ? window.location.origin : ''}
        <br />
        如果不同裝置／不同進入方式（主畫面圖示 vs. 瀏覽器分頁）看到的資料不一樣，先確認這裡顯示的網址是否一致。
      </p>
    </div>
  );
}
