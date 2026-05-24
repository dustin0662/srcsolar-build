import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'

class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { err: null }; }
  static getDerivedStateFromError(err) { return { err }; }
  componentDidCatch(err, info) { try { console.error('App error:', err, info); } catch (e) {} }
  render() {
    if (this.state.err) {
      return React.createElement('div', { style: { minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24, background: '#0a0a14', color: '#F5F0EB', fontFamily: "'Barlow Condensed', sans-serif", textAlign: 'center' } },
        React.createElement('div', { style: { fontFamily: "'Bebas Neue', sans-serif", fontSize: 30, letterSpacing: 2, color: '#F97316' } }, 'Something went wrong'),
        React.createElement('div', { style: { fontSize: 15, color: '#9a958d', maxWidth: 360 } }, 'The page hit an error. Reloading usually fixes it — your saved data is intact.'),
        React.createElement('button', { onClick: () => window.location.reload(), style: { background: '#F97316', color: '#1a1206', border: 'none', padding: '12px 22px', fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 14, letterSpacing: 2, textTransform: 'uppercase', cursor: 'pointer' } }, 'Reload')
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById('root')).render(
  React.createElement(ErrorBoundary, null, React.createElement(App))
)
