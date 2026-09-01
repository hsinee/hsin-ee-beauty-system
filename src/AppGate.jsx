import React, { useEffect, useState, useCallback } from 'react';
import { supabase } from './lib/supabase.js';
import {
  findMyProfile,
  findMyCustomerLink,
  fetchStore,
  bootstrapStore,
  updateStore,
  bindCustomerAccount,
  fetchCustomerPortalBundle,
} from './lib/dataApi.js';
import {
  LoadingScreen,
  LoginScreen,
  SignupScreen,
  ForgotPasswordScreen,
  ResetPasswordScreen,
  OnboardingScreen,
} from './AuthScreens.jsx';
import { CustomerAuthScreen, CustomerBindScreen, CustomerPortalView } from './CustomerPortal.jsx';
import StudioAdmin from './App.jsx';

function getPortalStoreId() {
  const params = new URLSearchParams(window.location.search);
  return params.get('portal') || '';
}

export default function AppGate() {
  const [phase, setPhase] = useState('loading');
  // loading | login | signup | forgot | reset | onboarding | admin | customerAuth | customerBind | portal
  const [session, setSession] = useState(null);
  const [store, setStore] = useState(null);
  const [customer, setCustomer] = useState(null);
  const [portalRecords, setPortalRecords] = useState([]);
  const [error, setError] = useState('');
  const portalStoreId = getPortalStoreId();

  const resolve = useCallback(async (sess) => {
    try {
      if (!sess) {
        if (portalStoreId) {
          const s = await fetchStore(portalStoreId);
          setStore(s);
          setPhase('customerAuth');
        } else {
          setPhase((p) => (p === 'signup' || p === 'forgot' ? p : 'login'));
        }
        return;
      }

      const profile = await findMyProfile();
      if (profile) {
        const s = await fetchStore(profile.store_id);
        setStore(s);
        setPhase('admin');
        return;
      }

      const customerLink = await findMyCustomerLink();
      if (customerLink) {
        const s = await fetchStore(customerLink.store_id);
        const bundle = await fetchCustomerPortalBundle();
        setStore(s);
        setCustomer(bundle.customer);
        setPortalRecords(bundle.records);
        setPhase('portal');
        return;
      }

      // 已登入但既不是店家也不是客戶：全新帳號
      if (portalStoreId) {
        const s = await fetchStore(portalStoreId);
        setStore(s);
        setPhase('customerBind');
      } else {
        setPhase('onboarding');
      }
    } catch (e) {
      setError(e.message || '載入失敗');
    }
  }, [portalStoreId]);

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      resolve(data.session);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((event, sess) => {
      if (!mounted) return;
      setSession(sess);
      if (event === 'PASSWORD_RECOVERY') {
        setPhase('reset');
        return;
      }
      if (event === 'SIGNED_OUT') {
        setStore(null);
        setCustomer(null);
        setPhase(portalStoreId ? 'customerAuth' : 'login');
        return;
      }
      resolve(sess);
    });

    return () => { mounted = false; sub.subscription.unsubscribe(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleLogin = async (email, password) => {
    const { error: err } = await supabase.auth.signInWithPassword({ email, password });
    if (err) throw err;
  };

  const handleSignup = async (email, password, storeName) => {
    const { data, error: err } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: window.location.origin + '/', data: { pending_store_name: storeName } },
    });
    if (err) throw err;
    if (data.session) {
      // 沒有開啟 Email 驗證：直接進開店流程
      await resolve(data.session);
      return false;
    }
    return true; // 需要去信箱驗證
  };

  const handleForgotPassword = async (email) => {
    const { error: err } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + '/',
    });
    if (err) throw err;
  };

  const handleResetPassword = async (password) => {
    const { error: err } = await supabase.auth.updateUser({ password });
    if (err) throw err;
    const { data } = await supabase.auth.getSession();
    setSession(data.session);
    await resolve(data.session);
  };

  const handleOnboardingSubmit = async (storeName) => {
    const storeId = await bootstrapStore(storeName);
    const s = await fetchStore(storeId);
    setStore(s);
    setPhase('admin');
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
  };

  const handleStoreChange = async (patch) => {
    const updated = await updateStore(store.id, patch);
    setStore(updated);
    return updated;
  };

  const handleCustomerSignup = async (email, password, phone, name) => {
    const { data, error: err } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: window.location.origin + '/?portal=' + portalStoreId },
    });
    if (err) throw err;
    if (data.session) {
      await bindCustomerAccount(portalStoreId, phone, name);
      await resolve(data.session);
      return false;
    }
    return true;
  };

  const handleCustomerBindSubmit = async (phone, name) => {
    await bindCustomerAccount(portalStoreId || store.id, phone, name);
    const { data } = await supabase.auth.getSession();
    await resolve(data.session);
  };

  if (error) {
    return <LoadingScreen text={`發生錯誤：${error}`} />;
  }

  switch (phase) {
    case 'loading':
      return <LoadingScreen />;
    case 'login':
      return (
        <LoginScreen
          onLogin={handleLogin}
          onGoSignup={() => setPhase('signup')}
          onGoForgot={() => setPhase('forgot')}
        />
      );
    case 'signup':
      return <SignupScreen onSignup={handleSignup} onGoLogin={() => setPhase('login')} />;
    case 'forgot':
      return <ForgotPasswordScreen onSubmit={handleForgotPassword} onGoLogin={() => setPhase('login')} />;
    case 'reset':
      return <ResetPasswordScreen onSubmit={handleResetPassword} />;
    case 'onboarding':
      return (
        <OnboardingScreen
          email={session?.user?.email}
          initialStoreName={session?.user?.user_metadata?.pending_store_name}
          onSubmit={handleOnboardingSubmit}
          onLogout={handleLogout}
        />
      );
    case 'admin':
      return <StudioAdmin store={store} onStoreChange={handleStoreChange} onLogout={handleLogout} />;
    case 'customerAuth':
      return (
        <CustomerAuthScreen
          store={store}
          onLogin={handleLogin}
          onSignup={handleCustomerSignup}
        />
      );
    case 'customerBind':
      return <CustomerBindScreen store={store} onSubmit={handleCustomerBindSubmit} onLogout={handleLogout} />;
    case 'portal':
      return <CustomerPortalView store={store} customer={customer} records={portalRecords} onLogout={handleLogout} />;
    default:
      return <LoadingScreen />;
  }
}
