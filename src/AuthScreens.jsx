import React, { useState } from 'react';

/* ============================================================
   買斷版：不接雲端帳號系統，改成「開店設定一次」+「PIN 碼鎖定」。
   資料全部存在使用者自己瀏覽器的 localStorage，沒有登入、沒有雲端同步。
   ============================================================ */

export function AuthStyles() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Noto+Serif+TC:wght@500;600;700&family=Noto+Sans+TC:wght@300;400;500;600&display=swap');
      .auth-root {
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        background: #f1ebe5;
        font-family: 'Noto Sans TC', sans-serif;
        color: #4a3b34;
        padding: 24px;
      }
      .auth-card {
        width: 100%;
        max-width: 380px;
        background: #ffffff;
        border: 1px solid #ded4cc;
        border-radius: 10px;
        padding: 36px 30px;
      }
      .auth-title { font-family: 'Noto Serif TC', serif; font-size: 22px; font-weight: 600; margin: 0 0 6px 0; text-align: center; }
      .auth-subtitle { font-size: 13px; color: #8f8178; margin: 0 0 24px 0; text-align: center; }
      .auth-field { display: block; margin-bottom: 14px; }
      .auth-field span { display: block; font-size: 12px; color: #8f8178; margin-bottom: 5px; }
      .auth-field input {
        width: 100%; padding: 10px 12px; border: 1px solid #ded4cc; border-radius: 6px;
        font-family: inherit; font-size: 14px; background: #fff; color: #4a3b34;
      }
      .auth-error { background: #fbe9e7; color: #b56f65; font-size: 12.5px; padding: 9px 12px; border-radius: 6px; margin-bottom: 14px; }
      .auth-success { background: #eef4ea; color: #4c7a3f; font-size: 12.5px; padding: 9px 12px; border-radius: 6px; margin-bottom: 14px; }
      .auth-btn {
        width: 100%; padding: 11px; border: none; border-radius: 6px; background: #c58f82; color: #fff;
        font-family: inherit; font-size: 14px; font-weight: 600; cursor: pointer; margin-top: 4px;
      }
      .auth-btn:disabled { opacity: 0.6; cursor: default; }
      .auth-links { display: flex; justify-content: space-between; margin-top: 16px; font-size: 12.5px; }
      .auth-links button { background: none; border: none; color: #8f8178; text-decoration: underline; cursor: pointer; font-family: inherit; padding: 0; }
      .auth-loading { text-align: center; color: #8f8178; font-size: 13px; }
      .pin-input {
        width: 100%; text-align: center; letter-spacing: 0.6em; font-size: 26px; padding: 12px 10px 12px 16px;
        border: 1px solid #ded4cc; border-radius: 8px; font-family: inherit; background: #fff; color: #4a3b34;
      }
    `}</style>
  );
}

function AuthLayout({ title, subtitle, children, logoUrl }) {
  return (
    <div className="auth-root">
      <AuthStyles />
      <div className="auth-card">
        {logoUrl && <img src={logoUrl} alt={title} style={{ width: 96, display: 'block', margin: '0 auto 16px' }} />}
        <h1 className="auth-title">{title}</h1>
        {subtitle && <p className="auth-subtitle">{subtitle}</p>}
        {children}
      </div>
    </div>
  );
}

function Field({ label, ...props }) {
  return (
    <label className="auth-field">
      <span>{label}</span>
      <input {...props} />
    </label>
  );
}

export function LoadingScreen({ text }) {
  return (
    <div className="auth-root">
      <AuthStyles />
      <p className="auth-loading">{text || '載入中⋯'}</p>
    </div>
  );
}

// 全新裝置第一次開啟：設定店名 + 4 位數 PIN 碼
export function PinSetupScreen({ onSubmit }) {
  const [name, setName] = useState('');
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    if (!/^\d{4}$/.test(pin)) { setError('PIN 碼請輸入 4 位數字'); return; }
    if (pin !== confirmPin) { setError('兩次輸入的 PIN 碼不一致'); return; }
    setBusy(true);
    setError('');
    try {
      await onSubmit(name.trim(), pin);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <AuthLayout title="歡迎！先設定這台裝置" subtitle="資料會存在這個瀏覽器裡，記得之後在「品牌設定」定期做備份">
      <form onSubmit={submit}>
        {error && <div className="auth-error">{error}</div>}
        <Field label="工作室 / 店家名稱" value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：小美美睫工作室" autoFocus required />
        <Field label="設定 4 位數 PIN 碼" inputMode="numeric" maxLength={4} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="0000" required />
        <Field label="再輸入一次 PIN 碼" inputMode="numeric" maxLength={4} value={confirmPin} onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="0000" required />
        <button className="auth-btn" type="submit" disabled={busy}>{busy ? '設定中⋯' : '完成設定，進入後台'}</button>
      </form>
      <p className="auth-subtitle" style={{ marginTop: 20, marginBottom: 0 }}>
        這個 PIN 碼只是輕量防護，不是雲端帳號密碼，換裝置或忘記 PIN 碼都要靠備份檔案處理，請務必記住。
      </p>
    </AuthLayout>
  );
}

// 日常開啟：輸入 PIN 碼解鎖
export function PinLockScreen({ store, onUnlock }) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');

  const submit = (e) => {
    e.preventDefault();
    if (!/^\d{4}$/.test(pin)) { setError('請輸入 4 位數字'); return; }
    const ok = onUnlock(pin);
    if (!ok) {
      setError('PIN 碼不正確');
      setPin('');
    }
  };

  return (
    <AuthLayout title={store?.name || '工作室後台'} subtitle="輸入 PIN 碼進入後台" logoUrl={store?.logoUrl}>
      <form onSubmit={submit}>
        {error && <div className="auth-error">{error}</div>}
        <input
          className="pin-input"
          inputMode="numeric"
          maxLength={4}
          value={pin}
          onChange={(e) => { setPin(e.target.value.replace(/\D/g, '').slice(0, 4)); setError(''); }}
          placeholder="••••"
          autoFocus
        />
        <button className="auth-btn" type="submit">進入</button>
      </form>
    </AuthLayout>
  );
}
