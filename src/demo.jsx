import './demo-shim.js'
import './fonts.css'
import React from 'react'
import { createRoot } from 'react-dom/client'
import PilePlan from './pile_plan.jsx'

createRoot(document.getElementById('root')).render(
  React.createElement(PilePlan, { portalUser: { name: 'Demo Admin', role: 'admin' }, onExit: null, demo: window.__TT_DEMO })
)
