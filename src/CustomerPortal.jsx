import React, { useMemo, useState } from 'react';
import { AuthStyles } from './AuthScreens.jsx';

function fmtMoney(n) {
  return '$' + Math.round(Number(n) || 0).toLocaleString('en-US');
}
function fmtDate(d) {
  if (!d) return '—';
  const [y, m, day] = d.split('-');
  return `${y}/${m}/${day}`;
}
function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function daysBetween(a, b) {
  return Math.round((new Date(b) - new Date(a)) / 86400000);
}
function addonsTotal(r) {
  return (r.addons || []).reduce((s, a) => s + Number(a.amount || 0), 0);
}
function recordTotal(r) {
  return Number(r.amount || 0) + addonsTotal(r);
}

function Field({ label, ...props }) {
  return (
    <label className="auth-field">
      <span>{label}</span>
      <input {...props} />
    </label>
  );
}

/* ============================================================
   顧客：登入 / 註冊（第一次要輸入手機號碼完成綁定）
   ============================================================ */

export function CustomerAuthScreen({ store, onLogin, onSignup }) {
  const [mode, setMode] = useState('login'); // login | signup
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const submitLogin = async (e) => {
    e.preventDefault();
    if (!email.trim() || !password) return;
    setBusy(true);
    setError('');
    try {
      await onLogin(email.trim(), password);
    } catch (err) {
      setError(err.message === 'Invalid login credentials' ? '帳號或密碼不正確' : err.message);
    } finally {
      setBusy(false);
    }
  };

  const submitSignup = async (e) => {
    e.preventDefault();
    if (!email.trim() || !phone.trim() || !name.trim()) return;
    if (password.length < 6) { setError('密碼至少需要 6 個字元'); return; }
    if (password !== confirmPassword) { setError('兩次輸入的密碼不一致'); return; }
    setBusy(true);
    setError('');
    try {
      const needsVerification = await onSignup(email.trim(), password, phone.trim(), name.trim());
      if (needsVerification) setDone(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-root">
      <AuthStyles />
      <div className="auth-card">
        {store?.logoUrl && <img src={store.logoUrl} alt={store.name} style={{ display: 'block', width: 110, margin: '0 auto 18px' }} />}
        <h1 className="auth-title">{store?.name || '會員中心'}</h1>
        <p className="auth-subtitle">{mode === 'login' ? '會員登入' : '第一次使用，註冊會員帳號'}</p>

        {done ? (
          <>
            <div className="auth-success">註冊信已寄出，請到 {email} 收信並點擊驗證連結，完成後就可以登入囉。</div>
            <button className="auth-btn" onClick={() => { setDone(false); setMode('login'); }}>回登入</button>
          </>
        ) : mode === 'login' ? (
          <form onSubmit={submitLogin}>
            {error && <div className="auth-error">{error}</div>}
            <Field label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus required />
            <Field label="密碼" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            <button className="auth-btn" type="submit" disabled={busy}>{busy ? '登入中⋯' : '登入'}</button>
            <div className="auth-links" style={{ justifyContent: 'center' }}>
              <button type="button" onClick={() => { setMode('signup'); setError(''); }}>還沒有帳號？註冊會員</button>
            </div>
          </form>
        ) : (
          <form onSubmit={submitSignup}>
            {error && <div className="auth-error">{error}</div>}
            <Field label="姓名" value={name} onChange={(e) => setName(e.target.value)} autoFocus required />
            <Field label="手機號碼" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="用來對應你在店家的消費紀錄" required />
            <Field label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            <Field label="密碼" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            <Field label="確認密碼" type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required />
            <button className="auth-btn" type="submit" disabled={busy}>{busy ? '註冊中⋯' : '註冊'}</button>
            <div className="auth-links" style={{ justifyContent: 'center' }}>
              <button type="button" onClick={() => { setMode('login'); setError(''); }}>已經有帳號？登入</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

export function CustomerBindScreen({ store, onSubmit, onLogout }) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    if (!phone.trim() || !name.trim()) return;
    setBusy(true);
    setError('');
    try {
      await onSubmit(phone.trim(), name.trim());
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <div className="auth-root">
      <AuthStyles />
      <div className="auth-card">
        <h1 className="auth-title">完成會員綁定</h1>
        <p className="auth-subtitle">{store?.name ? `連結到「${store.name}」` : ''}</p>
        <form onSubmit={submit}>
          {error && <div className="auth-error">{error}</div>}
          <Field label="姓名" value={name} onChange={(e) => setName(e.target.value)} autoFocus required />
          <Field label="手機號碼" value={phone} onChange={(e) => setPhone(e.target.value)} required />
          <button className="auth-btn" type="submit" disabled={busy}>{busy ? '處理中⋯' : '完成綁定'}</button>
        </form>
        <div className="auth-links" style={{ justifyContent: 'center' }}>
          <button onClick={onLogout}>登出</button>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   顧客會員中心（唯讀）
   ============================================================ */

export function CustomerPortalView({ store, customer, records, onLogout }) {
  const sorted = useMemo(() => [...records].sort((a, b) => (a.date < b.date ? 1 : -1)), [records]);
  const totalSpend = useMemo(() => records.reduce((s, r) => s + recordTotal(r), 0), [records]);
  const visitCount = records.length;

  const revisitHint = useMemo(() => {
    if (records.length === 0) return null;
    const last = [...records].sort((a, b) => (a.date < b.date ? -1 : 1))[records.length - 1];
    if (last.date > todayISO()) return null;
    const days = daysBetween(last.date, todayISO());
    if (days < 0) return null;
    const weeks = Math.floor(days / 7);
    return `距離上次保養已經 ${weeks > 0 ? `${weeks} 週` : `${days} 天`} 了，要不要預約下一次？`;
  }, [records]);

  return (
    <div className="app-root" style={{ background: '#f1ebe5', minHeight: '100vh', fontFamily: "'Noto Sans TC', sans-serif", color: '#4a3b34' }}>
      <AuthStyles />
      <div style={{ maxWidth: 640, margin: '0 auto', padding: '32px 20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 28 }}>
          <div>
            {store?.logoUrl && <img src={store.logoUrl} alt={store.name} style={{ width: 96, display: 'block', marginBottom: 8 }} />}
            <div style={{ fontSize: 13, color: '#8f8178' }}>{store?.name} · 會員中心</div>
          </div>
          <button className="auth-links" onClick={onLogout} style={{ background: 'none', border: '1px solid #ded4cc', borderRadius: 6, padding: '6px 14px', cursor: 'pointer', fontSize: 13 }}>登出</button>
        </div>

        <div style={{ background: '#fff', border: '1px solid #ded4cc', borderRadius: 10, padding: 20, marginBottom: 18 }}>
          <div style={{ fontFamily: "'Noto Serif TC', serif", fontSize: 20, fontWeight: 600, marginBottom: 4 }}>{customer.name}</div>
          <div style={{ fontSize: 13, color: '#8f8178' }}>會員編號 {customer.memberNo}{customer.birthday ? ` ・ 生日 ${fmtDate(customer.birthday)}` : ''}</div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 18 }}>
          <div style={{ background: '#fff', border: '1px solid #ded4cc', borderRadius: 10, padding: 16 }}>
            <div style={{ fontSize: 12, color: '#8f8178', marginBottom: 6 }}>累積消費</div>
            <div style={{ fontFamily: "'Noto Serif TC', serif", fontSize: 20, fontWeight: 600 }}>{fmtMoney(totalSpend)}</div>
          </div>
          <div style={{ background: '#fff', border: '1px solid #ded4cc', borderRadius: 10, padding: 16 }}>
            <div style={{ fontSize: 12, color: '#8f8178', marginBottom: 6 }}>消費次數</div>
            <div style={{ fontFamily: "'Noto Serif TC', serif", fontSize: 20, fontWeight: 600 }}>{visitCount}</div>
          </div>
        </div>

        {revisitHint && (
          <div style={{ background: '#f6ece9', border: '1px solid #e3c9c2', borderRadius: 10, padding: '14px 16px', marginBottom: 18, fontSize: 13.5 }}>
            {revisitHint}
          </div>
        )}

        <div style={{ background: '#fff', border: '1px solid #ded4cc', borderRadius: 10, padding: 20 }}>
          <div style={{ fontWeight: 600, marginBottom: 14 }}>我的服務紀錄</div>
          {sorted.length === 0 ? (
            <div style={{ color: '#8f8178', fontSize: 13, textAlign: 'center', padding: '20px 0' }}>目前還沒有服務紀錄</div>
          ) : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {sorted.map((r) => (
                <li key={r.id} style={{ borderTop: '1px solid #ded4cc', padding: '12px 0', display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{r.serviceName}</div>
                    <div style={{ fontSize: 12, color: '#8f8178' }}>{fmtDate(r.date)}{r.date > todayISO() ? '（預約）' : ''}</div>
                  </div>
                  <div style={{ fontWeight: 600 }}>{fmtMoney(recordTotal(r))}</div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
