import React, { useState } from 'react';
import { Trash2 } from 'lucide-react';

function newTierId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'tier-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
}

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
    phone: store.phone || '',
    igHandle: store.igHandle || '',
    lineId: store.lineId || '',
    address: store.address || '',
  });
  const [logoUrl, setLogoUrl] = useState(store.logoUrl || '');
  const [priceTiers, setPriceTiers] = useState(
    store.priceTiers && store.priceTiers.length ? store.priceTiers : [{ id: newTierId(), label: '原價' }]
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  const set = (k) => (e) => { setForm({ ...form, [k]: e.target.value }); setSaved(false); };

  const setTierLabel = (id, label) => {
    setPriceTiers(priceTiers.map((t) => (t.id === id ? { ...t, label } : t)));
    setSaved(false);
  };
  const setTrialDefault = (id) => {
    setPriceTiers(priceTiers.map((t) => ({ ...t, trialDefault: t.id === id })));
    setSaved(false);
  };
  const addTier = () => {
    setPriceTiers([...priceTiers, { id: newTierId(), label: '' }]);
    setSaved(false);
  };
  const removeTier = (id) => {
    if (priceTiers.length <= 1) return;
    setPriceTiers(priceTiers.filter((t) => t.id !== id));
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
    setSaving(true);
    setError('');
    try {
      await onSave({ ...form, logoUrl, priceTiers: cleanedTiers });
      setPriceTiers(cleanedTiers);
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
        <Field label="登入頁標題" hint="顯示在後台登入頁"><input value={form.loginTitle} onChange={set('loginTitle')} placeholder="例如：芯伊工作室後台" /></Field>
        <Field label="品牌主色">
          <input type="color" value={form.primaryColor} onChange={set('primaryColor')} style={{ width: 60, height: 34, padding: 2 }} />
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
      </div>

      <div className="panel" style={{ maxWidth: 480, marginTop: 18 }}>
        {error && <p style={{ color: '#b56f65', fontSize: 13 }}>{error}</p>}
        <div className="modal-actions">
          <button className="btn-primary full" onClick={submit} disabled={saving}>
            {saving ? '儲存中⋯' : saved ? '已儲存' : '儲存設定'}
          </button>
        </div>
      </div>
    </div>
  );
}
