import React, { useState } from 'react';

/* ============================================================
   帳號相關畫面（登入 / 註冊 / 忘記密碼 / 重設密碼 / 開店）共用外殼
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
    `}</style>
  );
}

function AuthLayout({ title, subtitle, children }) {
  return (
    <div className="auth-root">
      <AuthStyles />
      <div className="auth-card">
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

export function LoginScreen({ appTitle, onLogin, onGoSignup, onGoForgot }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
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

  return (
    <AuthLayout title={appTitle || '店家後台登入'} subtitle="輸入 Email 與密碼登入">
      <form onSubmit={submit}>
        {error && <div className="auth-error">{error}</div>}
        <Field label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus required />
        <Field label="密碼" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        <button className="auth-btn" type="submit" disabled={busy}>{busy ? '登入中⋯' : '登入'}</button>
      </form>
      <div className="auth-links">
        <button onClick={onGoForgot}>忘記密碼？</button>
        <button onClick={onGoSignup}>還沒有帳號？註冊店家</button>
      </div>
      <p className="auth-subtitle" style={{ marginTop: 20, marginBottom: 0 }}>
        你是顧客嗎？請使用店家提供給你的專屬連結進入會員中心。
      </p>
    </AuthLayout>
  );
}

export function SignupScreen({ onSignup, onGoLogin }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [storeName, setStoreName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!email.trim() || !storeName.trim()) return;
    if (password.length < 6) { setError('密碼至少需要 6 個字元'); return; }
    if (password !== confirmPassword) { setError('兩次輸入的密碼不一致'); return; }
    setBusy(true);
    setError('');
    try {
      const needsVerification = await onSignup(email.trim(), password, storeName.trim());
      if (needsVerification) setDone(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <AuthLayout title="請確認信箱" subtitle="">
        <div className="auth-success">
          註冊信已寄出，請到 {email} 收信並點擊驗證連結，完成後就可以登入了。
        </div>
        <button className="auth-btn" onClick={onGoLogin}>回登入頁</button>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="註冊店家帳號" subtitle="建立你自己的工作室後台">
      <form onSubmit={submit}>
        {error && <div className="auth-error">{error}</div>}
        <Field label="工作室 / 店家名稱" value={storeName} onChange={(e) => setStoreName(e.target.value)} placeholder="例如：小美美睫工作室" autoFocus required />
        <Field label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <Field label="密碼" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        <Field label="確認密碼" type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required />
        <button className="auth-btn" type="submit" disabled={busy}>{busy ? '註冊中⋯' : '註冊'}</button>
      </form>
      <div className="auth-links" style={{ justifyContent: 'center' }}>
        <button onClick={onGoLogin}>已經有帳號？登入</button>
      </div>
    </AuthLayout>
  );
}

export function ForgotPasswordScreen({ onSubmit, onGoLogin }) {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!email.trim()) return;
    setBusy(true);
    setError('');
    try {
      await onSubmit(email.trim());
      setSent(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <AuthLayout title="請check信箱" subtitle="">
        <div className="auth-success">重設密碼信已寄出，請到 {email} 收信並點擊連結設定新密碼。</div>
        <button className="auth-btn" onClick={onGoLogin}>回登入頁</button>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="忘記密碼" subtitle="輸入註冊時使用的 Email，我們會寄送重設密碼連結">
      <form onSubmit={submit}>
        {error && <div className="auth-error">{error}</div>}
        <Field label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus required />
        <button className="auth-btn" type="submit" disabled={busy}>{busy ? '寄送中⋯' : '寄送重設密碼信'}</button>
      </form>
      <div className="auth-links" style={{ justifyContent: 'center' }}>
        <button onClick={onGoLogin}>回登入頁</button>
      </div>
    </AuthLayout>
  );
}

export function ResetPasswordScreen({ onSubmit }) {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    if (password.length < 6) { setError('密碼至少需要 6 個字元'); return; }
    if (password !== confirmPassword) { setError('兩次輸入的密碼不一致'); return; }
    setBusy(true);
    setError('');
    try {
      await onSubmit(password);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <AuthLayout title="設定新密碼" subtitle="">
      <form onSubmit={submit}>
        {error && <div className="auth-error">{error}</div>}
        <Field label="新密碼" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus required />
        <Field label="確認新密碼" type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required />
        <button className="auth-btn" type="submit" disabled={busy}>{busy ? '儲存中⋯' : '設定新密碼並登入'}</button>
      </form>
    </AuthLayout>
  );
}

export function OnboardingScreen({ email, initialStoreName, onSubmit, onLogout }) {
  const [storeName, setStoreName] = useState(initialStoreName || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    if (!storeName.trim()) return;
    setBusy(true);
    setError('');
    try {
      await onSubmit(storeName.trim());
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <AuthLayout title="歡迎！先建立你的工作室" subtitle={email ? `目前登入：${email}` : ''}>
      <form onSubmit={submit}>
        {error && <div className="auth-error">{error}</div>}
        <Field label="工作室 / 店家名稱" value={storeName} onChange={(e) => setStoreName(e.target.value)} placeholder="例如：小美美睫工作室" autoFocus required />
        <button className="auth-btn" type="submit" disabled={busy}>{busy ? '建立中⋯' : '建立工作室，進入後台'}</button>
      </form>
      <div className="auth-links" style={{ justifyContent: 'center' }}>
        <button onClick={onLogout}>登出</button>
      </div>
    </AuthLayout>
  );
}
