import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    console.error('HSIN-EE App runtime error:', error, info);
  }
  render() {
    if (this.state.error) {
      return React.createElement('div', {
        style: { padding: 32, fontFamily: 'system-ui, sans-serif', lineHeight: 1.6 }
      },
        React.createElement('h2', null, '系統載入時發生錯誤'),
        React.createElement('p', null, '請重新整理頁面；若仍是白畫面，請把這裡顯示的錯誤截圖給我。'),
        React.createElement('pre', { style: { whiteSpace: 'pre-wrap', background: '#f6f6f6', padding: 16, borderRadius: 8 } }, String(this.state.error?.stack || this.state.error))
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById('root')).render(
  <ErrorBoundary><App /></ErrorBoundary>
);
