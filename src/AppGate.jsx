import React, { useEffect, useState } from 'react';
import { isSetUp, setupStore, fetchStore, verifyPin, isUnlocked, setUnlocked, updateStore } from './lib/localStore.js';
import { LoadingScreen, PinSetupScreen, PinLockScreen } from './AuthScreens.jsx';
import StudioAdmin from './App.jsx';

export default function AppGate() {
  const [phase, setPhase] = useState('loading'); // loading | setup | locked | admin
  const [store, setStore] = useState(null);

  useEffect(() => {
    (async () => {
      if (!isSetUp()) {
        setPhase('setup');
        return;
      }
      const s = await fetchStore();
      setStore(s);
      setPhase(isUnlocked() ? 'admin' : 'locked');
    })();
  }, []);

  const handleSetup = async (name, pin) => {
    const s = await setupStore(name, pin);
    setStore(s);
    setUnlocked(true);
    setPhase('admin');
  };

  const handleUnlock = (pin) => {
    if (!verifyPin(pin)) return false;
    setUnlocked(true);
    setPhase('admin');
    return true;
  };

  const handleLock = () => {
    setUnlocked(false);
    setPhase('locked');
  };

  const handleStoreChange = async (patch) => {
    const updated = await updateStore(store.id, patch);
    setStore(updated);
    return updated;
  };

  switch (phase) {
    case 'loading':
      return <LoadingScreen />;
    case 'setup':
      return <PinSetupScreen onSubmit={handleSetup} />;
    case 'locked':
      return <PinLockScreen store={store} onUnlock={handleUnlock} />;
    case 'admin':
      return <StudioAdmin store={store} onStoreChange={handleStoreChange} onLogout={handleLock} />;
    default:
      return <LoadingScreen />;
  }
}
