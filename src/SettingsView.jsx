import React, { useState } from 'react';

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
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  const set = (k) => (e) => { setForm({ ...form, [k]: e.target.value }); setSaved(false); };

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
    setSaving(true);
    setError('');
    try {
      await onSave({ ...form, logoUrl });
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
