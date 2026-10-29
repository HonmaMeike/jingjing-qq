import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ToastProvider } from './components/ui';
import { AppProvider } from './app/AppProvider';
import './styles/global.css';

class RootErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error) { console.error('UI crash', error); }
  render() {
    if (this.state.error) {
      return (
        <div style={{ height: '100%', display: 'grid', placeItems: 'center', padding: 30, background: '#07111f', color: '#eef7ff' }}>
          <div style={{ maxWidth: 560 }}>
            <h2>鲸鲸撞到了界面礁石</h2>
            <pre style={{ whiteSpace: 'pre-wrap', color: '#ff9aa8', fontSize: 12 }}>{this.state.error.message}</pre>
            <button className="btn btn--primary" onClick={() => location.reload()}>重新加载</button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RootErrorBoundary>
      <ToastProvider>
        <AppProvider>
          <App />
        </AppProvider>
      </ToastProvider>
    </RootErrorBoundary>
  </React.StrictMode>,
);
