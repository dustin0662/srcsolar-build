import React from 'react'
import { createRoot } from 'react-dom/client'
import PanelScanner from './panel_scanner.jsx'

// Standalone Panel Scanner app — boots straight into the scanner with no portal
// and no login. Deployed as its own page (scan.html) so it can live at its own
// URL / custom domain. Backed by the same /.netlify/functions/scanner.

class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { err: null } }
  static getDerivedStateFromError(err) { return { err } }
  componentDidCatch(err, info) { try { console.error('Scanner error:', err, info) } catch (e) {} }
  render() {
    if (this.state.err) {
      return React.createElement('div', { style: { minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24, background: '#f5f2ee', color: '#1a1a2e', fontFamily: "'Barlow Condensed', sans-serif", textAlign: 'center' } },
        React.createElement('div', { style: { fontFamily: "'Bebas Neue', sans-serif", fontSize: 30, letterSpacing: 2, color: '#F97316' } }, 'Something went wrong'),
        React.createElement('div', { style: { fontSize: 15, color: '#777', maxWidth: 360 } }, 'The scanner hit an error. Reloading usually fixes it — your logged panels are saved.'),
        React.createElement('button', { onClick: () => window.location.reload(), style: { background: '#F97316', color: '#1a1206', border: 'none', padding: '14px 24px', borderRadius: 8, fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 14, letterSpacing: 2, textTransform: 'uppercase', cursor: 'pointer' } }, 'Reload')
      )
    }
    return this.props.children
  }
}

createRoot(document.getElementById('root')).render(
  React.createElement(ErrorBoundary, null, React.createElement(PanelScanner, {}))
)

// Register the service worker so the scanner is installable as a PWA (Add to
// Home Screen) on Android & iPhone. Network-only SW — no stale caching.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  })
}

