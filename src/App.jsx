import React, { useState, useEffect, useRef, useMemo, useCallback } from "react"
import ScreeningSolutions from "./ScreeningSolutions.jsx"
import SiteMap from "./site_map.jsx"
import PilePlan from "./pile_plan.jsx"
import BidExportButtons, { exportBidProposal, exportExecutionPlan } from "./bid_export.jsx"
import { Search, Plus, Trash2, Edit, Download, Upload, X, Check, ChevronLeft, ChevronRight, Menu, User, Users, Shield, Calendar as CalIcon, FileText, Settings as SettingsIcon, BarChart3, ClipboardList, FlaskConical, History as HistoryIcon, Home, Scale, ChevronDown, AlertTriangle, Info, MessageCircle, Send, Loader2, Eye, EyeOff } from "lucide-react"
import * as XLSX from "xlsx"

const CSS = `
html{-webkit-text-size-adjust:100%;scroll-behavior:smooth;touch-action:manipulation}
body{overflow-x:hidden;-webkit-overflow-scrolling:touch}
input,select,textarea{font-size:16px !important}
@media(max-width:768px){
  body{padding-bottom:env(safe-area-inset-bottom,0)}
  .desktop-only{display:none !important}
  input,select,textarea{font-size:16px !important}
}
@import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Barlow:wght@300;400;600&family=Barlow+Condensed:wght@400;600;700&display=swap');
*{box-sizing:border-box;margin:0;padding:0}
@keyframes spin{to{transform:rotate(360deg)}}@keyframes spinR{to{transform:rotate(-360deg)}}
@keyframes pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.18)}}
@keyframes pulseGlow{0%,100%{filter:drop-shadow(0 0 4px #F97316)}50%{filter:drop-shadow(0 0 18px #F97316)}}
@keyframes twinkle{0%,100%{opacity:.1}50%{opacity:.9}}
@keyframes letterIn{0%{opacity:0;transform:translateY(38px) skewY(8deg)}100%{opacity:1;transform:translateY(0)}}
@keyframes subIn{0%{opacity:0;letter-spacing:.8em}100%{opacity:1;letter-spacing:.36em}}
@keyframes glowPulse{0%,100%{box-shadow:0 0 28px rgba(249,115,22,.5)}50%{box-shadow:0 0 70px rgba(249,115,22,1)}}
@keyframes wave{0%{transform:scale(.2);opacity:.9}100%{transform:scale(3);opacity:0}}
@keyframes bounce{0%,100%{transform:translateY(0)}50%{transform:translateY(-8px)}}
@keyframes sonarWave{0%{r:6;opacity:.9}100%{r:28;opacity:0}}
@keyframes prismRay{0%{opacity:0;transform:scaleY(0)}100%{opacity:.75;transform:scaleY(1)}}
@keyframes mountainGlow{0%,100%{filter:drop-shadow(0 0 4px rgba(249,115,22,.3))}50%{filter:drop-shadow(0 0 18px rgba(249,115,22,.8))}}
@keyframes cityFlicker{0%,100%{opacity:.5}50%{opacity:1}}
@keyframes grassTrack{0%,100%{transform:rotateX(0)}50%{transform:rotateX(22deg)}}
@keyframes scrollLine{0%{transform:translateX(-100%)}100%{transform:translateX(100%)}}
@keyframes shimmer{0%{left:-60%}100%{left:160%}}
@keyframes siteLight{0%,100%{opacity:.5}50%{opacity:1}}
@keyframes rayIn{0%{transform:scaleY(0);opacity:0}60%{transform:scaleY(1.1)}100%{transform:scaleY(1);opacity:1}}
@keyframes dustPuff{0%{opacity:.6;transform:scale(1)}100%{opacity:0;transform:scale(2.5) translate(4px,-8px)}}
`

const A='#F97316', G='#EAB308', N='#1e3a5f'

const SKY_STOPS=[
  ['#010108','#03011a','#140506','#220400'],['#040115','#0a041c','#200b04','#d45808'],
  ['#0a1225','#183050','#7a2006','#ff8c00'],['#163050','#234e80','#60a0c0','#ffc440'],
  ['#0048a0','#1070c0','#54a0c0','#c0e0ff'],['#122040','#235070','#b06030','#e89030'],
  ['#240a00','#501600','#b03000','#ff3800'],['#010106','#040818','#070e18','#100318'],
]
const SUN_STOPS=[[18,88],[27,78],[40,64],[54,40],[68,18],[80,42],[90,70],[97,92]]
const h2r=h=>[1,3,5].map(i=>parseInt(h.slice(i,i+2),16))
const lc=(c1,c2,t)=>{ const a=h2r(c1),b=h2r(c2); return `rgb(${a.map((v,i)=>Math.round(v+(b[i]-v)*t)).join(',')})` }
const lv=(a,b,t)=>a+(b-a)*t
function skyAt(p){const idx=p*(SKY_STOPS.length-1),i=Math.min(SKY_STOPS.length-2,Math.floor(idx)),t=idx-i;return SKY_STOPS[i].map((c,ci)=>lc(c,SKY_STOPS[i+1][ci],t))}
function sunAt(p){const idx=p*(SUN_STOPS.length-1),i=Math.min(SUN_STOPS.length-2,Math.floor(idx)),t=idx-i;return[lv(SUN_STOPS[i][0],SUN_STOPS[i+1][0],t),lv(SUN_STOPS[i][1],SUN_STOPS[i+1][1],t)]}

function bbox(pts){
  const pairs=pts.trim().split(/\s+/).map(p=>p.split(',').map(Number))
  const xs=pairs.map(p=>p[0]),ys=pairs.map(p=>p[1])
  return{x:Math.min(...xs),y:Math.min(...ys),w:Math.max(...xs)-Math.min(...xs),h:Math.max(...ys)-Math.min(...ys)}
}

const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v))
const phaseP=(scrollP,start,end)=>clamp((scrollP-start)/(end-start),0,1)

// ── 4 zones matching real aerial solar construction photo ──────────
const Z_PTS = [
  '211,0 533,0 600,0 622,31 589,59 589,248 111,248 111,203 61,203 61,126 111,64 211,0',
  '111,259 589,259 589,303 689,303 733,414 733,526 644,537 589,537 467,537 411,537 278,537 222,492 156,470 50,437 39,359 56,281 111,259',
  '156,481 278,548 411,548 589,548 644,548 700,548 700,620 633,681 578,714 422,720 278,720 222,720 178,720 144,692 133,648 117,603 133,548 156,481',
  '822,120 822,359 989,359 1000,314 1000,126 822,120',
]
const Z_BBOXES = Z_PTS.map(bbox)

// Construction phase timing per zone: [pileStart, pileEnd, tubeStart, tubeEnd, panelStart, panelEnd]
const Z_PHASES = [
  [0.08, 0.28,  0.20, 0.40,  0.34, 0.54],
  [0.16, 0.36,  0.28, 0.48,  0.42, 0.62],
  [0.26, 0.46,  0.38, 0.58,  0.50, 0.70],
  [0.20, 0.40,  0.32, 0.52,  0.44, 0.64],
]

// ── SINGLE ZONE: renders pile → tube → panel phases ─────────────────────────






// SVG construction overlays (piles → tubes → panels) draw on top.

// ── AERIAL PHOTO BACKGROUND ────────────────────────────────────────────────────
function AerialBG({ scrollP }) {
  const sky = skyAt(scrollP)
  const ph = scrollP * 6
  const phases = Z_PHASES.map(([ps,pe,ts,te,ms,me])=>({
    pileP: phaseP(scrollP,ps,pe), tubeP: phaseP(scrollP,ts,te), panelP: phaseP(scrollP,ms,me)
  }))
  const overallP = phases.reduce((s,p)=>s+(p.pileP+p.tubeP+p.panelP)/3,0)/phases.length
  const totalPct = Math.round(phases.reduce((s,p)=>s+p.panelP,0)/phases.length*100)
  const completion = phases.reduce((s,p)=>s+p.panelP,0)/phases.length
  const nightOp = ph>5?clamp((ph-5)*2.5,0,1):0
  const phLabel = overallP<0.12?'SITE CLEARED':overallP<0.35?'PILE INSTALLATION':overallP<0.56?'TORQUE TUBE & RACKING':overallP<0.78?'MODULE PLACEMENT':'COMMISSIONING'
  const skyBg = 'linear-gradient(to bottom,'+sky[0]+','+sky[1]+' 55%,'+sky[2]+' 85%,transparent)'
  return (
    <div style={{position:'fixed',inset:0,zIndex:0,overflow:'hidden',background:'#010108'}}>
      <div style={{position:'absolute',top:0,left:0,right:0,height:'28%',background:skyBg,transition:'background 1.4s'}}/>
      {nightOp>0&&<div style={{position:'absolute',inset:0,background:'rgba(0,5,18,'+nightOp*0.55+')'}}/>}
      <svg viewBox="0 0 1200 720" style={{position:'absolute',inset:0,width:'100%',height:'100%',display:'block'}}>
        <defs>
          <pattern id="pileGrid" x="0" y="0" width="20" height="10" patternUnits="userSpaceOnUse"><circle cx="10" cy="5" r="2" fill="#505850" opacity=".88"/></pattern>
          <pattern id="rackGrid" x="0" y="0" width="20" height="10" patternUnits="userSpaceOnUse"><rect x="0" y="3.8" width="20" height="2.4" fill="#7a9896" opacity=".82"/><circle cx="10" cy="5" r="2" fill="#96b2b0" opacity=".88"/></pattern>
          <pattern id="panelGrid" x="0" y="0" width="20" height="10" patternUnits="userSpaceOnUse"><rect x=".5" y=".5" width="19" height="9" fill="#1a304e" rx=".3" opacity=".82"/><line x1="10" y1=".5" x2="10" y2="9.5" stroke="rgba(60,110,170,.35)" strokeWidth=".6"/></pattern>
          {Z_PTS.map((pts,i)=><clipPath key={i} id={'cp-z'+i}><polygon points={pts}/></clipPath>)}
          <filter id="blurM"><feGaussianBlur stdDeviation="3"/></filter>
          <radialGradient id="vig" cx="50%" cy="50%" r="58%"><stop offset="36%" stopColor="transparent"/><stop offset="72%" stopColor="rgba(0,0,0,.22)"/><stop offset="100%" stopColor="rgba(0,0,0,.92)"/></radialGradient>
        </defs>
        {phases.map((ph2,zi)=>{const pts=Z_PTS[zi],b=Z_BBOXES[zi],pW=b.w*ph2.pileP,tW=b.w*ph2.tubeP,mW=b.w*ph2.panelP;const completion=(ph2.pileP+ph2.tubeP+ph2.panelP)/3;return(<g key={zi}>{ph2.pileP>0.01&&<g clipPath={'url(#cp-z'+zi+')'}><clipPath id={'pi-'+zi}><rect x={b.x-2} y={b.y-2} width={clamp(pW+2,0,b.w+4)} height={b.h+4}/></clipPath><g clipPath={'url(#pi-'+zi+')'} opacity={Math.min(1,ph2.pileP*3)}><polygon points={pts} fill="url(#pileGrid)"/></g></g>}{ph2.tubeP>0.01&&<g clipPath={'url(#cp-z'+zi+')'}><clipPath id={'tu-'+zi}><rect x={b.x-2} y={b.y-2} width={clamp(tW+2,0,b.w+4)} height={b.h+4}/></clipPath><g clipPath={'url(#tu-'+zi+')'} opacity={Math.min(1,ph2.tubeP*2.5)}><polygon points={pts} fill="url(#rackGrid)"/></g></g>}{ph2.panelP>0.01&&<g clipPath={'url(#cp-z'+zi+')'}><clipPath id={'pa-'+zi}><rect x={b.x-2} y={b.y-2} width={clamp(mW+2,0,b.w+4)} height={b.h+4}/></clipPath><g clipPath={'url(#pa-'+zi+')'} opacity={Math.min(1,ph2.panelP*2)}><polygon points={pts} fill="url(#panelGrid)"/></g></g>}<polygon points={pts} fill="none" stroke="rgba(249,115,22,.2)" strokeWidth="1" opacity={0.2+completion*0.3}/></g>)})}
        <rect x="0" y="0" width="1200" height="720" fill="url(#vig)"/>
        <text x="1162" y="100" textAnchor="end" fill="rgba(249,115,22,.5)" fontSize="7.5" fontFamily="'Barlow Condensed',sans-serif" letterSpacing="2">{phLabel}</text>
        {scrollP>0.12&&<g opacity={clamp((scrollP-0.12)*6,0,1)}><rect x="36" y="103" width="120" height="25" fill="rgba(0,0,0,.55)" rx="2"/><text x="48" y="119" fill="rgba(249,115,22,.78)" fontSize="9" fontFamily="'Barlow Condensed',sans-serif" letterSpacing="1">INSTALLED</text><text x="148" y="119" textAnchor="end" fill="#F97316" fontSize="12" fontFamily="'Bebas Neue',sans-serif">{totalPct}%</text></g>}
      </svg>
    </div>
  )
}

const LOGO_SRC="data:image/webp;base64,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";



// ── GLB MODEL VIEWER (lazy-loads three.js) ──────────────────────────────────
function GLBViewer({ src, height }) {
  const mountRef = useRef(null)
  const [error, setError] = useState(false)
  const [loaded, setLoaded] = useState(false)
  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return
    let cancelled = false
    let renderer, controls, rafId, onResize
    Promise.all([
      import('three'),
      import('three/examples/jsm/loaders/GLTFLoader.js'),
      import('three/examples/jsm/controls/OrbitControls.js')
    ]).then(([THREE, gltfMod, ocMod]) => {
      if (cancelled || !mountRef.current) return
      const GLTFLoader = gltfMod.GLTFLoader
      const OrbitControls = ocMod.OrbitControls
      const w = mount.clientWidth
      const h = height
      const scene = new THREE.Scene()
      const camera = new THREE.PerspectiveCamera(45, w/h, 0.1, 5000)
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
      renderer.setSize(w, h)
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
      if (THREE.sRGBEncoding !== undefined) renderer.outputEncoding = THREE.sRGBEncoding
      mount.appendChild(renderer.domElement)
      scene.add(new THREE.HemisphereLight(0xffffff, 0x202030, 1.1))
      const dir = new THREE.DirectionalLight(0xffffff, 1.2)
      dir.position.set(40, 80, 60)
      scene.add(dir)
      const fill = new THREE.DirectionalLight(0xffe2b5, 0.5)
      fill.position.set(-40, 20, -30)
      scene.add(fill)
      controls = new OrbitControls(camera, renderer.domElement)
      controls.enableDamping = true
      controls.dampingFactor = 0.08
      controls.autoRotate = true
      controls.autoRotateSpeed = 0.5
      controls.enablePan = false
      new GLTFLoader().load(src, (gltf) => {
        if (cancelled) return
        const model = gltf.scene
        const box = new THREE.Box3().setFromObject(model)
        const size = box.getSize(new THREE.Vector3())
        const center = box.getCenter(new THREE.Vector3())
        model.position.sub(center)
        const maxDim = Math.max(size.x, size.y, size.z)
        const fitDist = maxDim / (2 * Math.tan(Math.PI * camera.fov / 360))
        camera.position.set(fitDist*0.45, fitDist*0.25, fitDist*0.45)
        camera.near = Math.max(maxDim/100, 0.01)
        camera.far = maxDim * 20
        camera.updateProjectionMatrix()
        controls.target.set(0,0,0)
        controls.minDistance = fitDist * 0.3
        controls.maxDistance = fitDist * 3
        controls.update()
        scene.add(model)
        setLoaded(true)
      }, undefined, () => setError(true))
      const animate = () => {
        rafId = requestAnimationFrame(animate)
        controls.update()
        renderer.render(scene, camera)
      }
      animate()
      onResize = () => {
        if (!mountRef.current) return
        const nw = mountRef.current.clientWidth
        camera.aspect = nw / h
        camera.updateProjectionMatrix()
        renderer.setSize(nw, h)
      }
      window.addEventListener('resize', onResize)
    }).catch(() => setError(true))
    return () => {
      cancelled = true
      if (rafId) cancelAnimationFrame(rafId)
      if (onResize) window.removeEventListener('resize', onResize)
      if (controls) controls.dispose()
      if (renderer) {
        renderer.dispose()
        if (mount.contains(renderer.domElement)) mount.removeChild(renderer.domElement)
      }
    }
  }, [src, height])
  return (
    <div ref={mountRef} style={{width:'100%',height:height,position:'relative',cursor:'grab'}}>
      {!loaded && !error && <div style={{position:'absolute',inset:0,display:'flex',alignItems:'center',justifyContent:'center',color:'rgba(249,115,22,.55)',fontFamily:"'Barlow Condensed',sans-serif",fontSize:11,letterSpacing:'3px',textTransform:'uppercase'}}>Loading site model…</div>}
      {error && <div style={{position:'absolute',inset:0,display:'flex',alignItems:'center',justifyContent:'center',color:'rgba(249,115,22,.6)',fontFamily:"'Barlow Condensed',sans-serif",fontSize:11,letterSpacing:'2px',textTransform:'uppercase'}}>Model unavailable</div>}
    </div>
  )
}

// ── ICON COMPONENTS — no template literals inside JSX ────────────────────────
function OrbitalIcon({on}) {
  const pu  = {animation: on?'pulse 1.4s ease-in-out infinite':'none', transformOrigin:'center'}
  const pg  = {animation: on?'pulseGlow 1.8s ease-in-out infinite':'none'}
  const sp3  = {animation: on?'spin 3s linear infinite':'none', transformOrigin:'32px 32px'}
  const sr45 = {animation: on?'spinR 4.5s linear infinite':'none', transformOrigin:'32px 32px'}
  return (
    <svg width="64" height="64" viewBox="0 0 64 64" fill="none">
      <defs>
        <radialGradient id="og" cx="38%" cy="32%">
          <stop offset="0%" stopColor="#FFE082"/>
          <stop offset="100%" stopColor="#F97316"/>
        </radialGradient>
      </defs>
      <g style={pu}><circle cx="32" cy="32" r="10" fill="url(#og)" style={pg}/></g>
      <g style={sp3}>
        <ellipse cx="32" cy="32" rx="26" ry="9" stroke="#F97316" strokeWidth="1.5" fill="none" opacity=".65"/>
        <circle cx="58" cy="32" r="5" fill="#F97316"/>
      </g>
      <g style={sr45}>
        <ellipse cx="32" cy="32" rx="20" ry="8" stroke="#EAB308" strokeWidth="1" fill="none" opacity=".45" transform="rotate(55,32,32)"/>
        <circle cx="32" cy="12" r="3.5" fill="#EAB308"/>
      </g>
      {on && [0,60,120,180,240,300].map(a => {
        const r = a*Math.PI/180
        return <line key={a} x1={32+13*Math.cos(r)} y1={32+13*Math.sin(r)} x2={32+18*Math.cos(r)} y2={32+18*Math.sin(r)} stroke="#EAB308" strokeWidth="1.5" strokeLinecap="round"/>
      })}
    </svg>
  )
}
function SunnyIcon({on}) {
  const pu = {animation: on?'pulse 1.4s ease-in-out infinite':'none', transformOrigin:'center'}
  return (
    <svg width="64" height="64" viewBox="0 0 64 64" fill="none">
      <circle cx="32" cy="32" r="15" fill="#FFD700" style={pu}/>
      <circle cx="32" cy="32" r="11" fill="#FF9800"/>
      {on && <><circle cx="28" cy="29" r="2.5" fill="#333"/><circle cx="36" cy="29" r="2.5" fill="#333"/><path d="M27 37 Q32 43 37 37" stroke="#333" strokeWidth="2.5" fill="none" strokeLinecap="round"/></>}
      {[0,45,90,135,180,225,270,315].map((a,i) => {
        const r  = a*Math.PI/180
        const x1 = 32+18*Math.cos(r), y1 = 32+18*Math.sin(r)
        const x2 = 32+26*Math.cos(r), y2 = 32+26*Math.sin(r)
        const anim   = on ? ('bounce ' + (.55+i*.08) + 's ease-in-out infinite') : 'none'
        const origin = x1 + 'px ' + y1 + 'px'
        return <line key={a} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#FFD700" strokeWidth="2.5" strokeLinecap="round" style={{animation:anim, transformOrigin:origin}}/>
      })}
    </svg>
  )
}
function TrackerIcon({on}) {
  const pu = {animation: on?'pulse 1.4s ease-in-out infinite':'none', transformOrigin:'center'}
  const pg = {animation: on?'pulseGlow 1.8s ease-in-out infinite':'none'}
  return (
    <svg width="64" height="64" viewBox="0 0 64 64" fill="none">
      <circle cx="32" cy="13" r="8" fill="#F97316" style={{...pu,...pg}}/>
      {on && [0,45,90,135,180,225,270,315].map(a => {
        const r = a*Math.PI/180
        return <line key={a} x1={32+10*Math.cos(r)} y1={13+10*Math.sin(r)} x2={32+15*Math.cos(r)} y2={13+15*Math.sin(r)} stroke="#F97316" strokeWidth="2" strokeLinecap="round"/>
      })}
      {[-18,-7,4,15,26].map((ox, i) => {
        const anim   = on ? ('grassTrack ' + (2+i*.28) + 's ease-in-out infinite') : 'none'
        const origin = (32+ox) + 'px 40px'
        return (
          <g key={i} style={{animation:anim, transformOrigin:origin}}>
            <rect x={32+ox-4} y="28" width="8" height="12" rx="1" fill="#1e3a5f" stroke="#4a90d9" strokeWidth=".8"/>
            <line x1={32+ox-4} y1="31" x2={32+ox+4} y2="31" stroke="#4a90d9" strokeWidth=".5" opacity=".7"/>
            <line x1={32+ox-4} y1="34" x2={32+ox+4} y2="34" stroke="#4a90d9" strokeWidth=".5" opacity=".7"/>
            <line x1={32+ox} y1="28" x2={32+ox} y2="40" stroke="#4a90d9" strokeWidth=".7"/>
            <rect x={32+ox-1} y="40" width="2" height="8" fill="#555"/>
          </g>
        )
      })}
    </svg>
  )
}
function CityIcon({on}) {
  const pu = {animation: on?'pulse 1.4s ease-in-out infinite':'none', transformOrigin:'center'}
  return (
    <svg width="64" height="64" viewBox="0 0 64 64" fill="none">
      <rect x="4"  y="44" width="11" height="22" fill="#1e3a5f" rx="1"/>
      <rect x="17" y="34" width="13" height="32" fill="#265a8a" rx="1"/>
      <rect x="32" y="40" width="9"  height="26" fill="#1e3a5f" rx="1"/>
      <rect x="43" y="28" width="15" height="38" fill="#265a8a" rx="1"/>
      {on && [[6,50],[8,56],[19,40],[22,48],[34,46],[45,34],[48,42],[54,36]].map(([x,y],i) => {
        const anim  = 'cityFlicker ' + (1+i*.2) + 's ease-in-out infinite'
        const delay = (i*.15) + 's'
        return <rect key={i} x={x} y={y} width="3" height="3" fill="#FFD700" opacity=".8" style={{animation:anim, animationDelay:delay}}/>
      })}
      <rect x="5"  y="42" width="9"  height="3" fill="#F97316" rx=".5" opacity={on?1:.4}/>
      <rect x="18" y="32" width="11" height="3" fill="#F97316" rx=".5" opacity={on?1:.4}/>
      <rect x="33" y="38" width="7"  height="3" fill="#F97316" rx=".5" opacity={on?1:.4}/>
      <rect x="44" y="26" width="13" height="3" fill="#F97316" rx=".5" opacity={on?1:.4}/>
      <circle cx="32" cy="11" r="7" fill="#EAB308" style={pu}/>
      {on && <circle cx="32" cy="11" r="12" stroke="#EAB308" strokeWidth="1.5" fill="none" style={{animation:'wave 2s ease-out infinite'}}/>}
    </svg>
  )
}
function MountainIcon({on}) {
  const pu = {animation: on?'pulse 1.4s ease-in-out infinite':'none', transformOrigin:'center'}
  const pg = {animation: on?'pulseGlow 1.8s ease-in-out infinite':'none'}
  return (
    <svg width="64" height="64" viewBox="0 0 64 64" fill="none">
      <path d="M6 62 L32 16 L58 62Z" fill="#1e3a5f" stroke="#4a90d9" strokeWidth="1"/>
      <path d="M24 62 L40 36 L56 62Z" fill="#142f52"/>
      <path d="M32 16 L27 28 L37 28Z" fill="white" opacity=".6"/>
      {on && (
        <g style={{animation:'mountainGlow 2s ease-in-out infinite'}}>
          {[0,1,2,3].map(i => {
            const tr = 'rotate(-22,' + (12+i*9) + ',' + (52+i*2) + ')'
            return <rect key={i} x={9+i*9} y={50+i*2} width="6" height="4" fill="#F97316" rx=".5" transform={tr} opacity=".85"/>
          })}
        </g>
      )}
      <circle cx="54" cy="13" r="8" fill="#F97316" style={{...pg,...pu}}/>
      {on && [0,45,90,135,180,225,270,315].map(a => {
        const r = a*Math.PI/180
        return <line key={a} x1={54+10*Math.cos(r)} y1={13+10*Math.sin(r)} x2={54+15*Math.cos(r)} y2={13+15*Math.sin(r)} stroke="#F97316" strokeWidth="2" strokeLinecap="round"/>
      })}
    </svg>
  )
}
function SwarmIcon({on}) {
  const pu = {animation: on?'pulse 1.4s ease-in-out infinite':'none', transformOrigin:'center'}
  return (
    <svg width="64" height="64" viewBox="0 0 64 64" fill="none">
      <circle cx="32" cy="32" r="8" fill="#F97316" style={pu}/>
      {[0,1,2,3,4,5,6,7].map(i => {
        const anim = on ? ('spin ' + (3+i*.3) + 's linear infinite') : 'none'
        return (
          <g key={i} style={{animation:anim, transformOrigin:'32px 32px'}}>
            <circle cx={32+22*Math.cos((i/8)*2*Math.PI)} cy={32+22*Math.sin((i/8)*2*Math.PI)} r={i%2===0?4.5:3} fill={i%2===0?'#F97316':'#EAB308'} opacity=".85"/>
          </g>
        )
      })}
      {on && <>
        <circle cx="32" cy="32" r="14" stroke="#F97316" strokeWidth="1" fill="none" style={{animation:'wave 1.8s ease-out infinite'}}/>
        <circle cx="32" cy="32" r="14" stroke="#F97316" strokeWidth="1" fill="none" style={{animation:'wave 1.8s ease-out infinite', animationDelay:'.6s'}}/>
      </>}
    </svg>
  )
}
function PulseIcon({on}) {
  return (
    <svg width="64" height="64" viewBox="0 0 64 64" fill="none">
      <circle cx="32" cy="32" r="6" fill="#F97316"/>
      {on
        ? [1,2,3].map(i => {
            const anim  = 'sonarWave ' + (i*.65) + 's ease-out infinite'
            const delay = (i*.26) + 's'
            return <circle key={i} cx="32" cy="32" r="6" stroke="#F97316" strokeWidth={2.5-i*.4} fill="none" style={{animation:anim, animationDelay:delay}}/>
          })
        : [1,2,3].map(i => <circle key={i} cx="32" cy="32" r={6+i*9} stroke="#F97316" strokeWidth={2-i*.4} fill="none" opacity={.35-i*.08}/>)
      }
      <path d="M4 32 H18 L22 22 L26 42 L30 30 L34 32 H60" stroke={on?'#EAB308':'#F97316'} strokeWidth="1.5" fill="none" opacity={on?1:.4} style={on?{animation:'pulse 1s ease-in-out infinite',transformOrigin:'32px 32px'}:{}}/>
    </svg>
  )
}
function PrismIcon({on}) {
  const pu = {animation: on?'pulse 1.4s ease-in-out infinite':'none', transformOrigin:'center'}
  const pg = {animation: on?'pulseGlow 1.8s ease-in-out infinite':'none'}
  return (
    <svg width="64" height="64" viewBox="0 0 64 64" fill="none">
      <defs>
        <linearGradient id="pg2" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#4a90d9" stopOpacity=".4"/>
          <stop offset="100%" stopColor="#F97316" stopOpacity=".4"/>
        </linearGradient>
      </defs>
      <path d="M32 6 L62 58 L2 58Z" stroke="#4a90d9" strokeWidth="2" fill="url(#pg2)"/>
      {on && ['#FF4444','#FF9900','#FFD700','#44FF44','#4499FF','#AA44FF'].map((c,i) => {
        const delay = (i*.09) + 's'
        return <line key={i} x1="32" y1="14" x2={2+i*12} y2="58" stroke={c} strokeWidth="2" opacity=".7" style={{animation:'prismRay .6s ease forwards', animationDelay:delay, transformOrigin:'32px 14px'}}/>
      })}
      <circle cx="32" cy="8" r="6" fill="#F97316" style={{...pu,...pg}}/>
    </svg>
  )
}
function UnityIcon({on}) {
  const pu  = {animation: on?'pulse 1.4s ease-in-out infinite':'none', transformOrigin:'center'}
  const sr5 = {animation: on?'spinR 5s linear infinite':'none', transformOrigin:'24px 32px'}
  const ss5 = {animation: on?'spin 5s linear infinite':'none', transformOrigin:'40px 32px'}
  return (
    <svg width="64" height="64" viewBox="0 0 64 64" fill="none">
      <circle cx="24" cy="32" r="16" stroke="#1e3a5f" strokeWidth="2" fill="none" style={sr5}/>
      <circle cx="40" cy="32" r="16" stroke="#F97316" strokeWidth="2" fill="none" style={ss5}/>
      <path d="M32 19 Q40 25 40 32 Q40 39 32 45 Q24 39 24 32 Q24 25 32 19Z" fill="#F97316" opacity={on?.45:.2}/>
      <circle cx="32" cy="32" r="6" fill="#F97316" style={pu}/>
      {on && <circle cx="32" cy="32" r="10" stroke="#EAB308" strokeWidth="1" fill="none" style={{animation:'wave 2s ease-out infinite'}}/>}
    </svg>
  )
}
function Icon({type, on}) {
  if(type==='orbital')  return <OrbitalIcon  on={on}/>
  if(type==='sunny')    return <SunnyIcon    on={on}/>
  if(type==='tracker')  return <TrackerIcon  on={on}/>
  if(type==='city')     return <CityIcon     on={on}/>
  if(type==='mountain') return <MountainIcon on={on}/>
  if(type==='swarm')    return <SwarmIcon    on={on}/>
  if(type==='pulse')    return <PulseIcon    on={on}/>
  if(type==='prism')    return <PrismIcon    on={on}/>
  if(type==='unity')    return <UnityIcon    on={on}/>
  return null
}
// ── LOADER ───────────────────────────────────────────────────────────────────
function Loader({phase,prog}){
  const progWidth = prog + '%'
  const progBg    = 'linear-gradient(to right,#F97316,#EAB308)'
  return(
    <div style={{position:'fixed',inset:0,zIndex:1000,overflow:'hidden',background:'#010108'}}>
      <div style={{position:'absolute',top:0,left:0,right:0,bottom:'50%',background:'#010108',zIndex:20,transition:'transform .95s cubic-bezier(.76,0,.24,1)',transform:phase>=5?'translateY(-102%)':'translateY(0)'}}/>
      <div style={{position:'absolute',top:'50%',left:0,right:0,bottom:0,background:'#010108',zIndex:20,transition:'transform .95s cubic-bezier(.76,0,.24,1)',transform:phase>=5?'translateY(102%)':'translateY(0)'}}/>
      {phase>=1&&<div style={{position:'absolute',bottom:0,left:0,right:0,height:'40%',zIndex:2,opacity:clamp((phase-1)*.7,0,1),transition:'opacity .8s'}}>
        <svg viewBox="0 0 1200 280" preserveAspectRatio="xMidYMax slice" style={{width:'100%',height:'100%'}}>
          <rect width="1200" height="280" fill="#8a7248"/>
          <path d="M 28,20 L 300,14 L 308,0 L 660,0 L 658,16 L 720,8 L 1070,4 L 1078,200 L 725,205 L 610,240 L 86,245 L 30,200 Z" fill="rgba(180,68,24,0.75)"/>
          {Z_PTS.map((pts,i)=>{
            const shifted = pts.trim().split(/\s+/).map(p=>{
              const parts = p.split(',')
              return parts[0] + ',' + Math.max(0, parseFloat(parts[1])-440)
            }).join(' ')
            return <polygon key={i} points={shifted} fill="rgba(0,0,0,.55)" stroke="rgba(200,80,24,.4)" strokeWidth="1.5"/>
          })}
        </svg>
      </div>}
      {phase>=1&&<div style={{position:'absolute',bottom:'30%',left:0,right:0,height:'30%',background:'radial-gradient(ellipse 80% 60% at 50% 100%,rgba(249,115,22,.32) 0%,transparent 70%)',zIndex:3,opacity:phase>=4?0:1,transition:'opacity .5s'}}/>}
      {phase>=1&&<div style={{position:'absolute',left:'50%',bottom:'33%',zIndex:4,transform:'translateX(-50%)',opacity:phase>=4?0:1,transition:'opacity .4s'}}>
        <div style={{width:86,height:86,borderRadius:'50%',background:'radial-gradient(circle at 38% 32%,#FFE082,#F97316)',animation:'glowPulse 2s ease-in-out infinite',position:'relative',boxShadow:'0 0 60px 30px rgba(249,115,22,.4)'}}>
          {phase>=2&&[0,30,60,90,120,150,180,210,240,270,300,330].map(a=>{
            const rayBg  = 'linear-gradient(to bottom,' + (a%60===0?'#EAB308':'#F97316') + ',transparent)'
            const rayTr  = 'translate(-50%,43px) rotate(' + a + 'deg)'
            const rayDly = (a/360*.4) + 's'
            return(
              <div key={a} style={{position:'absolute',top:'50%',left:'50%',width:2,height:48,
                background:rayBg,transformOrigin:'top center',transform:rayTr,
                animation:'rayIn .55s ease forwards',animationDelay:rayDly,opacity:0}}/>
            )
          })}
        </div>
      </div>}
      {phase>=2&&<div style={{position:'absolute',bottom:'52%',left:0,right:0,display:'flex',justifyContent:'center',gap:5,zIndex:5,opacity:phase>=4?0:1,transition:'opacity .4s'}}>
        {"SUNRISE".split("").map((l,i)=>{
          const dly = (.35+i*.06) + 's'
          return(
            <span key={i} style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:'clamp(42px,9vw,98px)',color:'#F5F0EB',display:'inline-block',animation:'letterIn .55s cubic-bezier(.34,1.56,.64,1) forwards',animationDelay:dly,opacity:0,textShadow:'0 0 40px rgba(249,115,22,.7)'}}>{l}</span>
          )
        })}
      </div>}
      {phase>=2&&<div style={{position:'absolute',bottom:'46%',left:0,right:0,textAlign:'center',zIndex:5,fontFamily:"'Barlow Condensed',sans-serif",fontSize:'clamp(11px,1.8vw,15px)',letterSpacing:'.36em',color:'#F97316',textTransform:'uppercase',animation:'subIn .8s ease .5s both',opacity:phase>=4?0:1,transition:'opacity .4s'}}>CONSTRUCTION & DEVELOPMENT</div>}
      {phase>=3&&<div style={{position:'absolute',bottom:'30%',left:'50%',transform:'translateX(-50%)',width:'min(440px,72vw)',zIndex:5,opacity:phase>=4?0:1,transition:'opacity .4s'}}>
        <div style={{display:'flex',justifyContent:'space-between',fontFamily:"'Barlow Condensed',sans-serif",fontSize:11,letterSpacing:'.2em',color:'#ccc',textShadow:'0 1px 3px rgba(0,0,0,0.95), 0 0 12px rgba(0,0,0,1)',textTransform:'uppercase',marginBottom:9}}>
          <span>Deploying Solar Field</span><span style={{color:'#F97316',fontWeight:700}}>{Math.round(prog)}%</span>
        </div>
        <div style={{height:3,background:'rgba(255,255,255,.07)',borderRadius:2,overflow:'hidden',position:'relative'}}>
          <div style={{position:'absolute',inset:'0 auto 0 0',width:progWidth,background:progBg,transition:'width .1s',boxShadow:'0 0 14px rgba(249,115,22,.9)'}}/>
          <div style={{position:'absolute',inset:'0 auto 0 0',width:'36%',background:'linear-gradient(to right,transparent,rgba(255,255,255,.35),transparent)',animation:'shimmer 1.6s ease-in-out infinite'}}/>
        </div>
        <div style={{display:'flex',gap:18,marginTop:10,fontFamily:"'Barlow Condensed',sans-serif",fontSize:10,letterSpacing:'.18em',textTransform:'uppercase'}}>
          {['Piles','Trackers','Modules','Electrical'].map((t,i)=><span key={t} style={{color:prog>i*22+12?'#F97316':'#333',transition:'color .4s'}}>{prog>i*22+12?'✓ ':''}{t}</span>)}
        </div>
      </div>}
      {phase>=4&&<div style={{position:'absolute',bottom:'24%',left:0,right:0,textAlign:'center',zIndex:5,fontFamily:"'Barlow Condensed',sans-serif",fontSize:13,letterSpacing:'.3em',color:'#22C55E',textTransform:'uppercase',opacity:phase>=5?0:1,transition:'opacity .3s'}}>⬤ &nbsp;SOLAR FIELD ONLINE</div>}
    </div>
  )
}

// ── PROJECT CARD ─────────────────────────────────────────────────────────────
function ProjectCard({p,i}){
  const[on,setOn]=useState(false);const[vis,setVis]=useState(false);const ref=useRef()
  useEffect(()=>{const io=new IntersectionObserver(([e])=>{if(e.isIntersecting){setVis(true);io.disconnect()}},{threshold:.15});if(ref.current)io.observe(ref.current);return()=>io.disconnect()},[])
  return(<div ref={ref} onMouseEnter={()=>setOn(true)} onMouseLeave={()=>setOn(false)} onClick={()=>setOn(v=>!v)} style={{background:on?'rgba(249,115,22,.07)':'rgba(8,8,20,.22)',backdropFilter:'blur(14px)',borderLeft:'3px solid ' + (on?A:'rgba(249,115,22,.2)'),border:'1px solid rgba(255,255,255,.05)',borderLeftWidth:3,borderLeftColor:on?A:'rgba(249,115,22,.2)',padding:'30px 26px',cursor:'pointer',transition:'all .35s cubic-bezier(.34,1.56,.64,1)',transform:vis?(on?'translateX(4px)':'translateX(0)'):'translateX(-18px)',opacity:vis?1:0,transitionDelay:(i*.06)+"s",position:'relative',overflow:'hidden'}}>
    {on&&<div style={{position:'absolute',inset:0,background:'linear-gradient(135deg,transparent 35%,rgba(249,115,22,.06) 50%,transparent 65%)',animation:'shimmer 1.5s ease-in-out infinite'}}/>}
    <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:40,color:on?A:'#F5F0EB',lineHeight:1,transition:'color .3s'}}>{p.mw}<span style={{fontSize:19,color:'rgba(245,240,235,.45)'}}>MW</span></div>
    <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:16,fontWeight:700,letterSpacing:'2px',textTransform:'uppercase',margin:'9px 0 4px',color:'#F5F0EB'}}>{p.name}</div>
    <div style={{fontSize:12,color:'#ccc',textShadow:'0 1px 3px rgba(0,0,0,0.95), 0 0 12px rgba(0,0,0,1)',fontFamily:"'Barlow Condensed',sans-serif",letterSpacing:'1.5px'}}>{p.loc}</div>
    <div style={{display:'flex',alignItems:'center',gap:10,marginTop:16,paddingTop:14,borderTop:'1px solid rgba(255,255,255,.06)'}}>
      <div style={{flex:1,height:3,background:'rgba(249,115,22,.1)',borderRadius:2,overflow:'hidden'}}><div style={{height:'100%',background:'linear-gradient(to right,#F97316,#EAB308)',width:vis?(p.fill*100)+'%':0,transition:'width 1.2s ease',transitionDelay:(.3+i*.07)+'s'}}/></div>
      <span style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:11,letterSpacing:'1.5px',textTransform:'uppercase',color:'#ccc',textShadow:'0 1px 3px rgba(0,0,0,0.95), 0 0 12px rgba(0,0,0,1)',whiteSpace:'nowrap'}}>{p.mods} Modules</span>
    </div>
  </div>)
}
function CapCard({c,ci}){
  const[hov,setHov]=useState(false)
  return(<div onMouseEnter={()=>setHov(true)} onMouseLeave={()=>setHov(false)} style={{background:hov?'rgba(249,115,22,.07)':'rgba(8,8,20,.18)',backdropFilter:'blur(14px)',padding:'48px 36px',position:'relative',overflow:'hidden',transition:'transform .4s cubic-bezier(.34,1.56,.64,1)',transform:hov?'translateY(-5px)':'translateY(0)',border:'1px solid rgba(255,255,255,.05)',borderBottom:'3px solid ' + (hov?A:'transparent')}}>
    <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:75,color:'rgba(249,115,22,' + (hov?.16:.05) + ')',lineHeight:1,position:'absolute',top:16,right:22,transition:'color .4s'}}>{c.n}</div>
    <div style={{width:48,height:48,background:'rgba(249,115,22,.1)',border:'1px solid rgba(249,115,22,.22)',display:'flex',alignItems:'center',justifyContent:'center',clipPath:'polygon(8px 0%,100% 0%,calc(100% - 8px) 100%,0% 100%)',marginBottom:24}}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={A} strokeWidth="1.5">
        {ci===0&&<><path d="M9 12l2 2 4-4"/><circle cx="12" cy="12" r="9"/></>}
        {ci===1&&<><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></>}
        {ci===2&&<><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></>}
      </svg>
    </div>
    <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:19,fontWeight:700,letterSpacing:'2px',textTransform:'uppercase',marginBottom:12}}>{c.t}</div>
    <p style={{fontSize:15,fontWeight:300,color:'#777',lineHeight:1.7}}>{c.b}</p>
  </div>)
}

const CAPS=[{n:'01',t:'ISNet Compliance',b:'Full ISNetworld compliance ensuring safety protocols, training records, and insurance coverage meet the most stringent standards for utility-scale solar.'},{n:'02',t:'Apprenticeship Enabled',b:'Certified apprenticeship programs combining site experience with technical training to build skilled local labor pools for every region we operate.'},{n:'03',t:'EPC Subcontracting',b:'Precision tracking installation, pile driving, and mechanical assembly for utility-scale EPCs with industry-leading accuracy and zero schedule slippage.'}]
const PROJS=[{mw:'210',name:'Grimes Solar',loc:'Iola, TX',mods:'500,000',fill:1.0,icon:'orbital'},{mw:'135',name:'Happy Solar',loc:'White County, AR',mods:'285,000',fill:.57,icon:'sunny'},{mw:'80',name:'Grasshopper Solar',loc:'Chase City, VA',mods:'78,000',fill:.16,icon:'tracker'},{mw:'50',name:'Salt City Solar',loc:'Ross County, OH',mods:'125,000',fill:.25,icon:'city'},{mw:'50',name:'Whitehorn Solar',loc:'Gretna, VA',mods:'180,000',fill:.36,icon:'mountain'},{mw:'6.7',name:'Locust Solar',loc:'Cortland, NY',mods:'15,000',fill:.03,icon:'swarm'},{mw:'4.8',name:'Remsen Solar',loc:'E. Syracuse, NY',mods:'10,000',fill:.02,icon:'pulse'},{mw:'4.4',name:'Taft Solar',loc:'E. Syracuse, NY',mods:'10,000',fill:.02,icon:'prism'},{mw:'2.93',name:'Union Solar',loc:'Union, ME',mods:'8,000',fill:.016,icon:'unity'}]

// ── SEC with mobile padding ────────────────────────────────────────────────
function Sec({children,id,style={}}){
  const ref=useRef();const[vis,setVis]=useState(false)
  useEffect(()=>{const io=new IntersectionObserver(([e])=>{if(e.isIntersecting){setVis(true);io.disconnect()}},{threshold:.06});if(ref.current)io.observe(ref.current);return()=>io.disconnect()},[])
  return <section id={id} ref={ref} style={{position:'relative',zIndex:5,padding:'clamp(36px,6vw,96px) clamp(14px,4vw,48px)',transition:'opacity .8s,transform .8s',opacity:vis?1:0,transform:vis?'translateY(0)':'translateY(28px)',color:'#F5F0EB',...style}}>{children}</section>
}

// ── EXTENDED SERVICES (collapsible sub-scopes) ─────────────────────────────
const EXT_SERVICES=[
  {t:'3rd Party Progress Auditing',d:'Independent, proof-based models showing exactly where every project stands.'},
  {t:'3D Photogrammetry Reporting',d:'High-resolution drone-derived scans of as-built site conditions, delivered to your team.'},
  {t:'Survey Solutions',d:'Layout, staking, and as-built survey support across utility-scale solar sites.'},
  {t:'Fencing & Ironworks',d:'Perimeter security and structural ironwork integrated with mechanical scope.'},
  {t:'Electrical & Civil (via Partners)',d:'Full-scale electrical and civil execution through trusted partners — one accountable team, end-to-end scope.'}
]
function ExtendedServices({m,A,BB,NB}){
  const [open,setOpen]=useState(false)
  return (
    <div style={{marginTop:m?28:36}}>
      <button onClick={()=>setOpen(o=>!o)} style={{display:'inline-flex',alignItems:'center',gap:10,background:'transparent',border:'1px solid '+A,color:A,padding:m?'12px 20px':'14px 28px',...NB,fontSize:m?12:13,letterSpacing:'2.5px',textTransform:'uppercase',fontWeight:700,cursor:'pointer',transition:'all .25s',clipPath:'polygon(8px 0%,100% 0%,calc(100% - 8px) 100%,0% 100%)'}} onMouseEnter={e=>{e.currentTarget.style.background='rgba(249,115,22,.12)'}} onMouseLeave={e=>{e.currentTarget.style.background='transparent'}}>
        {open?'Hide Extended Services':'View Extended Services'}
        <span style={{display:'inline-block',transition:'transform .25s',transform:open?'rotate(180deg)':'rotate(0deg)'}}>▾</span>
      </button>
      {open&&(
        <div style={{marginTop:m?20:28,display:'grid',gridTemplateColumns:m?'1fr':'repeat(3,1fr)',gap:m?10:14}}>
          {EXT_SERVICES.map(s=>(
            <div key={s.t} style={{padding:m?'16px 18px':'22px 22px',background:'rgba(8,8,20,.55)',backdropFilter:'blur(8px)',border:'1px solid rgba(249,115,22,.22)'}}>
              <div style={{...BB,fontSize:m?17:20,letterSpacing:1.2,color:A,marginBottom:m?6:10,lineHeight:1.15}}>{s.t}</div>
              <div style={{...NB,fontSize:m?13:14,fontWeight:300,color:'#CCC8C2',lineHeight:1.6}}>{s.d}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ═══ CONSTANTS ═══
const CSG='#F97316', CSGD='#e0650f', CSBG='#f2f2ee', CSNAV='#0f0f0f', CSFF="'Barlow Condensed',sans-serif"
const storage = window.storage || { get:async()=>null, set:async()=>null, delete:async()=>null, list:async()=>({keys:[]}) }

// ═══ HELPERS ═══
const uid=()=>Math.random().toString(36).slice(2,10)
const now=()=>new Date().toISOString()
const fmt=(d)=>{if(!d)return'';const dt=new Date(d);return dt.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}
const fmtTime=(d)=>{if(!d)return'';const dt=new Date(d);return dt.toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})}

async function sGet(key){try{const r=await storage.get(key);return r?JSON.parse(r.value):null}catch(e){return null}}
async function sSet(key,val){try{await storage.set(key,JSON.stringify(val))}catch(e){console.error('storage set error',e)}}

const PROFILE_COLORS=['#e74c3c','#3498db','#2ecc71','#9b59b6','#e67e22','#1abc9c','#34495e','#f39c12']

const TABS=[
  {id:'dashboard',label:'Dashboard',icon:Home},
  {id:'employees',label:'Employees',icon:Users},
  {id:'picker',label:'Picker',icon:FlaskConical},
  {id:'drugtests',label:'Drug Tests',icon:ClipboardList},
  {id:'screenings',label:'Screenings',icon:Shield},
  {id:'history',label:'History',icon:HistoryIcon},
  {id:'calendar',label:'Calendar',icon:CalIcon},
  {id:'reports',label:'Reports',icon:BarChart3},
  {id:'settings',label:'Settings',icon:SettingsIcon},
  {id:'profile',label:'Profile',icon:User},
]

const MOB_TABS=['dashboard','picker','drugtests','screenings']

const TEST_TYPES=['random','pre-employment','incident','scheduled','follow-up','return-to-duty']
const POSITIONS=['Staff','Supervisor','Manager','Director','Executive','Other']
const DEPTS=['Operations','Safety','Engineering','Admin','HR','Finance','Field','Other']

// ═══ TOAST SYSTEM ═══
function Toasts({toasts,remove}){
  return <div style={{position:'fixed',top:16,right:16,zIndex:9999,display:'flex',flexDirection:'column',gap:8}}>
    {toasts.map(t=>(
      <div key={t.id} style={{background:t.type==='error'?'#dc2626':t.type==='warning'?'#d97706':'#16a34a',color:'#fff',padding:'12px 20px',borderRadius:6,fontFamily:CSFF,fontSize:14,display:'flex',alignItems:'center',gap:10,boxShadow:'0 4px 20px rgba(0,0,0,.3)',animation:'slideIn .3s ease',minWidth:250}}>
        <span style={{flex:1}}>{t.msg}</span>
        <X size={16} style={{cursor:'pointer',opacity:.7}} onClick={()=>remove(t.id)}/>
      </div>
    ))}
  </div>
}

function useToast(){
  const[toasts,setToasts]=useState([])
  const add=useCallback((msg,type='info')=>{
    const id=uid()
    setToasts(p=>[...p,{id,msg,type}])
    setTimeout(()=>setToasts(p=>p.filter(t=>t.id!==id)),5000)
  },[])
  const remove=useCallback((id)=>setToasts(p=>p.filter(t=>t.id!==id)),[])
  return{toasts,add,remove}
}

// ═══ SPLASH SCREEN ═══
function Splash({onDone}){
  const[phase,setPhase]=useState(0)
  useEffect(()=>{
    const t=[setTimeout(()=>setPhase(1),400),setTimeout(()=>setPhase(2),1200),setTimeout(()=>setPhase(3),2200),setTimeout(()=>setPhase(4),3400),setTimeout(()=>onDone(),5000)]
    return()=>t.forEach(clearTimeout)
  },[onDone])
  return(
    <div style={{position:'fixed',inset:0,background:'#f5f2ee',zIndex:10000,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',fontFamily:CSFF}}>
      <Scale size={64} color={CSG} style={{transform:phase>=1?'scale(1)':'scale(0)',transition:'transform .8s cubic-bezier(.34,1.56,.64,1)',opacity:phase>=1?1:0}}/>
      <div style={{marginTop:28,fontSize:36,letterSpacing:6,fontWeight:700,color:'#1a1a2e',fontFamily:"'Bebas Neue',sans-serif",opacity:phase>=2?1:0,transform:phase>=2?'translateY(0)':'translateY(20px)',transition:'all .7s ease'}}>
        Clear<span style={{color:CSG}}>Screen</span> HR
      </div>
      <div style={{width:200,height:2,background:'rgba(0,0,0,.1)',marginTop:20,borderRadius:2,overflow:'hidden',opacity:phase>=3?1:0,transition:'opacity .4s'}}>
        <div style={{width:phase>=3?'100%':'0%',height:'100%',background:'linear-gradient(90deg,transparent,'+CSG+',transparent)',transition:'width 1.2s ease'}}/>
      </div>
      <div style={{marginTop:24,fontSize:13,letterSpacing:3,color:'#888',opacity:phase>=4?1:0,transition:'opacity .8s'}}>Made by Dustin Hanson</div>
    </div>
  )
}

// ═══ PROFILE PICKER ═══
function ProfilePicker({profiles,onSelect,onCreate,onDelete}){
  const[adding,setAdding]=useState(false)
  const[name,setName]=useState('')
  const[confirmDel,setConfirmDel]=useState(null)
  return(
    <div style={{position:'fixed',inset:0,background:'#f5f2ee',zIndex:9000,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',fontFamily:CSFF,padding:20}}>
      <Scale size={36} color={CSG}/>
      <div style={{fontSize:28,letterSpacing:4,fontWeight:700,color:'#1a1a2e',marginTop:12,fontFamily:"'Bebas Neue',sans-serif"}}>Clear<span style={{color:CSG}}>Screen</span> HR</div>
      <div style={{fontSize:13,letterSpacing:2,color:'#888',marginTop:6,marginBottom:36}}>SELECT PROFILE</div>
      <div style={{display:'flex',flexWrap:'wrap',gap:16,justifyContent:'center',maxWidth:600}}>
        {profiles.map((p,i)=>(
          <div key={p.id} style={{width:m?120:140,background:'#ffffff',border:'1px solid rgba(0,0,0,.12)',borderRadius:8,padding:'20px 16px',textAlign:'center',cursor:'pointer',transition:'all .2s',position:'relative'}}
            onClick={function(){onSelect(p)}} onMouseEnter={function(e){e.currentTarget.style.borderColor=CSG}} onMouseLeave={function(e){e.currentTarget.style.borderColor='rgba(0,0,0,.12)'}}>
            <div style={{width:48,height:48,borderRadius:'50%',background:PROFILE_COLORS[i%PROFILE_COLORS.length],display:'flex',alignItems:'center',justifyContent:'center',margin:'0 auto 10px',fontSize:20,fontWeight:700,color:'#fff'}}>{p.name.slice(0,2).toUpperCase()}</div>
            <div style={{color:'#1a1a2e',fontSize:15,fontWeight:600}}>{p.name}</div>
            <div style={{position:'absolute',top:6,right:6,cursor:'pointer',opacity:.4,transition:'opacity .2s'}} onClick={function(e){e.stopPropagation();setConfirmDel(p.id)}} onMouseEnter={function(e){e.currentTarget.style.opacity=1}} onMouseLeave={function(e){e.currentTarget.style.opacity=.4}}>
              <Trash2 size={14} color="#f66"/>
            </div>
            {confirmDel===p.id&&(
              <div style={{position:'absolute',inset:0,background:'rgba(0,0,0,.85)',borderRadius:8,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:8}} onClick={function(e){e.stopPropagation()}}>
                <div style={{color:'#f66',fontSize:12,letterSpacing:1}}>DELETE?</div>
                <div style={{display:'flex',gap:8}}>
                  <div style={{background:'#f66',color:'#fff',padding:'4px 14px',borderRadius:4,cursor:'pointer',fontSize:12}} onClick={function(){onDelete(p.id);setConfirmDel(null)}}>Yes</div>
                  <div style={{background:'#f0ede8',color:'#1a1a2e',padding:'4px 14px',borderRadius:4,cursor:'pointer',fontSize:12}} onClick={function(){setConfirmDel(null)}}>No</div>
                </div>
              </div>
            )}
          </div>
        ))}
        <div style={{width:m?120:140,background:'#ffffff',border:'2px dashed rgba(0,0,0,.15)',borderRadius:8,padding:'20px 16px',textAlign:'center',cursor:'pointer',transition:'all .2s',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center'}}
          onClick={function(){setAdding(true)}} onMouseEnter={function(e){e.currentTarget.style.borderColor=CSG}} onMouseLeave={function(e){e.currentTarget.style.borderColor='rgba(0,0,0,.15)'}}>
          <Plus size={28} color="#888"/>
          <div style={{color:'#888',fontSize:13,marginTop:6}}>New Profile</div>
        </div>
      </div>
      {adding&&(
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.5)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:9500}} onClick={()=>setAdding(false)}>
          <div style={{background:'#ffffff',border:'1px solid rgba(0,0,0,.12)',borderRadius:8,padding:28,width:'90%',maxWidth:320}} onClick={e=>e.stopPropagation()}>
            <div style={{color:'#1a1a2e',fontSize:16,fontWeight:600,marginBottom:16}}>New Profile</div>
            <input value={name} onChange={e=>setName(e.target.value)} placeholder="Profile name" style={{width:'100%',background:'#f9f7f5',border:'1px solid rgba(0,0,0,.15)',color:'#1a1a2e',padding:'10px 14px',borderRadius:4,fontSize:14,fontFamily:CSFF,outline:'none',boxSizing:'border-box'}} autoFocus onKeyDown={e=>{if(e.key==='Enter'&&name.trim()){onCreate(name.trim());setName('');setAdding(false)}}}/>
            <div style={{display:'flex',gap:8,marginTop:16}}>
              <div style={{flex:1,background:CSG,color:'#000',padding:'10px 0',borderRadius:4,textAlign:'center',cursor:'pointer',fontWeight:700,fontSize:13}} onClick={()=>{if(name.trim()){onCreate(name.trim());setName('');setAdding(false)}}}>Create</div>
              <div style={{flex:1,background:'#f0ede8',color:'#1a1a2e',padding:'10px 0',borderRadius:4,textAlign:'center',cursor:'pointer',fontSize:13}} onClick={()=>setAdding(false)}>Cancel</div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ═══ E-SIGNATURE PAD ═══
function SignaturePad({onSave,onCancel}){
  const canRef=useRef(null)
  const drawing=useRef(false)
  const start=e=>{drawing.current=true;const c=canRef.current.getContext('2d');const r=canRef.current.getBoundingClientRect();c.beginPath();c.moveTo(e.clientX-r.left,e.clientY-r.top)}
  const move=e=>{if(!drawing.current)return;const c=canRef.current.getContext('2d');const r=canRef.current.getBoundingClientRect();c.lineTo(e.clientX-r.left,e.clientY-r.top);c.strokeStyle='#000';c.lineWidth=2;c.stroke()}
  const end=()=>{drawing.current=false}
  const clear=()=>{const c=canRef.current.getContext('2d');c.clearRect(0,0,400,150)}
  return(
    <div style={{background:'#fff',borderRadius:8,padding:20,width:420,maxWidth:'90vw'}}>
      <div style={{fontFamily:CSFF,fontSize:16,fontWeight:700,marginBottom:12}}>E-Signature</div>
      <canvas ref={canRef} width={400} height={150} style={{border:'1px solid #ccc',borderRadius:4,cursor:'crosshair',width:'100%'}} onMouseDown={start} onMouseMove={move} onMouseUp={end} onMouseLeave={end}/>
      <div style={{display:'flex',gap:8,marginTop:12}}>
        <div style={{flex:1,background:CSG,color:'#000',padding:'10px 0',borderRadius:4,textAlign:'center',cursor:'pointer',fontFamily:CSFF,fontWeight:700,fontSize:13}} onClick={()=>onSave(canRef.current.toDataURL())}>Save</div>
        <div style={{background:'#eee',color:'#333',padding:'10px 16px',borderRadius:4,textAlign:'center',cursor:'pointer',fontFamily:CSFF,fontSize:13}} onClick={clear}>Clear</div>
        <div style={{background:'#eee',color:'#333',padding:'10px 16px',borderRadius:4,textAlign:'center',cursor:'pointer',fontFamily:CSFF,fontSize:13}} onClick={onCancel}>Cancel</div>
      </div>
    </div>
  )
}

// ═══ DISCLAIMER & T&C MODALS ═══
const TC_TEXT=`ClearScreen HR Terms & Conditions

1. Acceptance of Terms: By using ClearScreen HR, you agree to these terms.
2. License: Limited, non-transferable license for internal business use only.
3. Intellectual Property: ClearScreen HR is the exclusive intellectual property of Dustin Hanson and is shared in good faith. Use constitutes acceptance of all Terms & Conditions. This software is provided 'as-is' without warranty of any kind.
4. Data Responsibility: User is solely responsible for data accuracy and compliance.
5. No Legal Advice: This software does not constitute legal or compliance advice.
6. Confidentiality: All employee data must be handled per applicable privacy laws.
7. DOT Compliance: Software assists with but does not guarantee DOT compliance.
8. SAMHSA Guidelines: Random selection uses CSPRNG but user must verify compliance.
9. MRO Process: Software facilitates but does not replace qualified MRO review.
10. Record Retention: User responsible for meeting retention requirements.
11. Data Security: User must implement appropriate access controls.
12. Liability Limitation: No liability for errors, omissions, or compliance failures.
13. Indemnification: User indemnifies developer against all claims.
14. Modifications: Terms may be updated; continued use implies acceptance.
15. Severability: Invalid provisions do not affect remaining terms.
16. Governing Law: Governed by applicable federal and state laws.
17. Dispute Resolution: Disputes resolved through binding arbitration.
18. Export Controls: User must comply with applicable export laws.
19. Third-Party Services: EmailJS integration governed by their own terms.
20. Audit Rights: Developer may audit usage for compliance with these terms.
21. Training: User responsible for training personnel on proper software use.
22. Backup: User responsible for maintaining adequate data backups.
23. Updates: No obligation to provide updates or new features.
24. Support: Support provided at developer's discretion.
25. Termination: License may be terminated for violation of terms.`

function DisclaimerModal({onAccept}){
  const[agreed,setAgreed]=useState(false)
  const[showTC,setShowTC]=useState(false)
  return(
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.6)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:9900,padding:20,fontFamily:CSFF}}>
      {showTC?(
        <div style={{background:'#fff',borderRadius:8,padding:28,maxWidth:600,maxHeight:'80vh',overflow:'auto',width:'100%'}}>
          <div style={{fontSize:18,fontWeight:700,marginBottom:16}}>Terms & Conditions</div>
          <pre style={{whiteSpace:'pre-wrap',fontSize:13,lineHeight:1.7,color:'#444'}}>{TC_TEXT}</pre>
          <div style={{background:CSG,color:'#000',padding:'12px 0',borderRadius:4,textAlign:'center',cursor:'pointer',fontWeight:700,marginTop:20}} onClick={()=>setShowTC(false)}>Close</div>
        </div>
      ):(
        <div style={{background:'#fff',borderRadius:8,padding:28,maxWidth:480,width:'100%'}}>
          <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:16}}>
            <AlertTriangle size={24} color="#d97706"/>
            <div style={{fontSize:18,fontWeight:700}}>Important Disclaimer</div>
          </div>
          <p style={{fontSize:14,lineHeight:1.7,color:'#555',marginBottom:16}}>
            ClearScreen HR is a screening management tool designed to assist with drug testing program administration. It is <strong>not a substitute</strong> for legal counsel, qualified MRO review, or official compliance mechanisms.
          </p>
          <p style={{fontSize:14,lineHeight:1.7,color:'#555',marginBottom:20}}>
            Users are solely responsible for ensuring compliance with DOT 49 CFR Part 40, SAMHSA guidelines, and all applicable federal, state, and local regulations.
          </p>
          <label style={{display:'flex',alignItems:'flex-start',gap:10,cursor:'pointer',marginBottom:20}}>
            <input type="checkbox" checked={agreed} onChange={e=>setAgreed(e.target.checked)} style={{marginTop:3,accentColor:CSG}}/>
            <span style={{fontSize:13,color:'#555'}}>I have read and agree to the <span style={{color:CSGD,cursor:'pointer',textDecoration:'underline'}} onClick={e=>{e.preventDefault();setShowTC(true)}}>Terms & Conditions</span></span>
          </label>
          <div style={{background:agreed?CSG:'#ddd',color:agreed?'#000':'#999',padding:'12px 0',borderRadius:4,textAlign:'center',cursor:agreed?'pointer':'default',fontWeight:700,fontSize:14,transition:'all .2s'}} onClick={()=>agreed&&onAccept()}>Accept & Continue</div>
        </div>
      )}
    </div>
  )
}

// ═══ HR COMPLIANCE CHAT ═══
function ComplianceChat({show,onToggle}){
  const[msgs,setMsgs]=useState([{role:'assistant',content:'Welcome to HR Compliance Assistant. I specialize in DOT 49 CFR Part 40, SAMHSA guidelines, SAP procedures, and MRO processes. How can I help?'}])
  const[input,setInput]=useState('')
  const[loading,setLoading]=useState(false)
  const endRef=useRef(null)
  useEffect(()=>{endRef.current?.scrollIntoView({behavior:'smooth'})},[msgs])
  const send=async()=>{
    if(!input.trim()||loading)return
    const q=input.trim();setInput('');setMsgs(p=>[...p,{role:'user',content:q}]);setLoading(true)
    try{
      const res=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:'claude-sonnet-4-20250514',max_tokens:1000,system:'You are an HR compliance specialist expert in DOT 49 CFR Part 40, SAMHSA workplace drug testing guidelines, SAP (Substance Abuse Professional) processes, and MRO (Medical Review Officer) procedures. Give concise, accurate compliance guidance.',messages:[...msgs.filter(m=>m.role!=='system'),{role:'user',content:q}]})})
      const data=await res.json()
      const text=data.content?.map(c=>c.text||'').join('')||'Sorry, I could not process that request.'
      setMsgs(p=>[...p,{role:'assistant',content:text}])
    }catch(e){setMsgs(p=>[...p,{role:'assistant',content:'Connection error. Please try again.'}])}
    setLoading(false)
  }
  if(!show)return(
    <div onClick={onToggle} style={{position:'fixed',bottom:24,right:24,width:56,height:56,borderRadius:'50%',background:CSG,display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer',boxShadow:'0 4px 20px rgba(0,0,0,.3)',zIndex:9000,transition:'transform .2s'}} onMouseEnter={e=>e.currentTarget.style.transform='scale(1.1)'} onMouseLeave={e=>e.currentTarget.style.transform='scale(1)'}>
      <MessageCircle size={24} color="#000"/>
    </div>
  )
  return(
    <div style={{position:'fixed',bottom:24,right:24,width:380,maxWidth:'calc(100vw - 48px)',height:520,maxHeight:'calc(100vh - 100px)',background:'#fff',borderRadius:12,boxShadow:'0 8px 40px rgba(0,0,0,.25)',zIndex:9000,display:'flex',flexDirection:'column',fontFamily:CSFF,overflow:'hidden'}}>
      <div style={{background:CSNAV,color:'#fff',padding:'14px 18px',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
        <div style={{display:'flex',alignItems:'center',gap:8}}><Scale size={18} color={CSG}/><span style={{fontWeight:700,letterSpacing:1}}>HR Compliance</span></div>
        <X size={18} style={{cursor:'pointer',opacity:.7}} onClick={onToggle}/>
      </div>
      <div style={{flex:1,overflow:'auto',padding:14,display:'flex',flexDirection:'column',gap:10}}>
        {msgs.map((m,i)=>(
          <div key={i} style={{alignSelf:m.role==='user'?'flex-end':'flex-start',maxWidth:'85%',background:m.role==='user'?CSG:'#f0f0ee',color:'#000',padding:'10px 14px',borderRadius:10,fontSize:13,lineHeight:1.6,whiteSpace:'pre-wrap'}}>{m.content}</div>
        ))}
        {loading&&<div style={{alignSelf:'flex-start',padding:'10px 14px'}}><Loader2 size={18} style={{animation:'spin 1s linear infinite'}} color="#888"/></div>}
        <div ref={endRef}/>
      </div>
      <div style={{padding:10,borderTop:'1px solid #eee',display:'flex',gap:8}}>
        <input value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>e.key==='Enter'&&send()} placeholder="Ask about compliance..." style={{flex:1,border:'1px solid #ddd',borderRadius:6,padding:'10px 12px',fontSize:13,fontFamily:CSFF,outline:'none'}}/>
        <div onClick={send} style={{width:40,height:40,borderRadius:6,background:CSG,display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer'}}><Send size={16} color="#000"/></div>
      </div>
    </div>
  )
}

// ═══ EQUIPMENT MANAGER MODULE ═══
var EQ_GOLD='#F97316',EQ_NAV='#ffffff',EQ_BG='#f5f2ee',EQ_FF="'Barlow Condensed',sans-serif",EQ_BB="'Bebas Neue',sans-serif"
var EQ_TYPES=['Work Trucks','PD10','ATV/Buggies','Skidsteer W/Forks','Telehandler','MiniEx','Klemm Drill']

function EquipmentManager({onExit,portalUser}){
  var[user,setUser]=useState(function(){
    if(portalUser){return{id:'portal_'+portalUser,name:portalUser,username:portalUser,accountType:'admin'}}
    try{var u=localStorage.getItem('eq_user');return u?JSON.parse(u):null}catch(e2){return null}
  })
  var[projects,setProjects]=useState([])
  var[selProj,setSelProj]=useState(null)
  var[equipment,setEquipment]=useState([])
  var[tools,setTools]=useState([])
  var[eqLog,setEqLog]=useState([])
  var[toolLog,setToolLog]=useState([])
  var[page,setPage]=useState('projects')
  var[mob,setMob]=useState(typeof window!=='undefined'&&window.innerWidth<768)
  var[drawer,setDrawer]=useState(false)
  var[toasts,setToasts]=useState([])
  // Auth
  var[loginU,setLU]=useState('')
  var[loginP,setLP]=useState('')
  var[signUp,setSignUp]=useState(false)
  var[err,setErr]=useState('')
  var[users,setUsrs]=useState([])
  // Forms
  var[eqForm,setEqForm]=useState(null)
  var[toolForm,setToolForm]=useState(null)
  var[newProj,setNP]=useState('')
  var[newColor,setNC]=useState('#3498db')
  var[eqFilter,setEqFilter]=useState('all')
  var[eqSearch,setEqSearch]=useState('')
  var[toolSearch,setToolSearch]=useState('')

  function toast(msg,type){var id=uid();setToasts(function(p){return p.concat([{id:id,msg:msg,type:type||'info'}])});setTimeout(function(){setToasts(function(p){return p.filter(function(t){return t.id!==id})})},4000)}
  function eqHash(s){var h=5381;for(var i=0;i<s.length;i++){h=((h<<5)+h)+s.charCodeAt(i);h=h&h}return Math.abs(h).toString(36)}

  useEffect(function(){var h=function(){setMob(window.innerWidth<768)};window.addEventListener('resize',h);return function(){window.removeEventListener('resize',h)}},[])
  useEffect(function(){sGet('eq_projects').then(function(p){setProjects(p||[])});sGet('eq_users').then(function(u){setUsrs(u||[])})},[])
  useEffect(function(){if(!selProj)return;sGet('eq_equip_'+selProj.id).then(function(e){setEquipment(e||[])});sGet('eq_tools_'+selProj.id).then(function(t){setTools(t||[])});sGet('eq_eqlog_'+selProj.id).then(function(l){setEqLog(l||[])});sGet('eq_toollog_'+selProj.id).then(function(l){setToolLog(l||[])})},[selProj])

  function svP(p){setProjects(p);sSet('eq_projects',p)}
  function svE(e){setEquipment(e);if(selProj)sSet('eq_equip_'+selProj.id,e)}
  function svT(t){setTools(t);if(selProj)sSet('eq_tools_'+selProj.id,t)}
  function svEL(l){setEqLog(l);if(selProj)sSet('eq_eqlog_'+selProj.id,l)}
  function svTL(l){setToolLog(l);if(selProj)sSet('eq_toollog_'+selProj.id,l)}

  function logEq(action,item){var entry={id:uid(),date:new Date().toISOString(),user:user?user.name:'Unknown',action:action,item:item.type||item.name||'',detail:JSON.stringify(item)};svEL(eqLog.concat([entry]))}
  function logTool(action,item){var entry={id:uid(),date:new Date().toISOString(),user:user?user.name:'Unknown',action:action,item:item.name||'',serial:item.serial||'',detail:JSON.stringify(item)};svTL(toolLog.concat([entry]))}

  // Auth
  function login(){setErr('');var u=users.find(function(x){return x.username===loginU&&x.passwordHash===eqHash(loginP)});if(!u){setErr('Invalid credentials');return}setUser(u);localStorage.setItem('eq_user',JSON.stringify(u))}
  function doSignup(){setErr('');if(!loginU.trim()||!loginP.trim()){setErr('Fill all fields');return}if(users.find(function(x){return x.username===loginU})){setErr('Username taken');return}var u={id:uid(),name:loginU,username:loginU,passwordHash:eqHash(loginP),createdAt:new Date().toISOString()};var nu=users.concat([u]);setUsrs(nu);sSet('eq_users',nu);setUser(u);localStorage.setItem('eq_user',JSON.stringify(u));toast('Welcome!')}
  function logout(){localStorage.removeItem('eq_user');setUser(null)}

  // Project CRUD
  function createProj(){if(!newProj.trim())return;var p={id:uid(),name:newProj.trim(),color:newColor,createdAt:new Date().toISOString()};svP(projects.concat([p]));setNP('');toast('Project created')}

  // Equipment CRUD
  function saveEquip(eq){
    var isNew=!equipment.find(function(e){return e.id===eq.id})
    if(isNew){svE(equipment.concat([eq]));logEq('ADDED',eq);toast('Equipment added')}
    else{svE(equipment.map(function(e){return e.id===eq.id?eq:e}));logEq('UPDATED',eq);toast('Equipment updated')}
    setEqForm(null)
  }
  function deleteEquip(id){var eq=equipment.find(function(e){return e.id===id});svE(equipment.filter(function(e){return e.id!==id}));if(eq)logEq('REMOVED',eq);toast('Removed','warning')}

  // Tool CRUD
  function saveTool(t){
    var isNew=!tools.find(function(x){return x.id===t.id})
    if(isNew){svT(tools.concat([t]));logTool('ADDED',t);toast('Tool added')}
    else{svT(tools.map(function(x){return x.id===t.id?t:x}));logTool('UPDATED',t);toast('Tool updated')}
    setToolForm(null)
  }
  function toggleToolStatus(t){
    var newStatus=t.status==='working'?'broken':'working'
    var updated=Object.assign({},t,{status:newStatus,statusChangedAt:new Date().toISOString(),statusChangedBy:user?user.name:'Unknown'})
    svT(tools.map(function(x){return x.id===t.id?updated:x}))
    logTool(newStatus==='broken'?'MARKED BROKEN':'MARKED WORKING',updated)
    toast(t.name+' → '+newStatus)
  }

  // Export
  function exportExcel(){
    try{
      var wb=XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(equipment.map(function(e){return{Type:e.type,Qty:e.qty,RentalCompany:e.rental,Rep:e.rep,Phone:e.phone,DayIn:e.dayIn,EstDayOut:e.dayOut,Notes:e.notes||''}})),'Equipment')
      XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(tools.map(function(t){return{Name:t.name,Serial:t.serial,Cost:t.cost,Acquired:t.acquired,Status:t.status,LastChanged:t.statusChangedAt||'',ChangedBy:t.statusChangedBy||''}})),'Tools & Inventory')
      XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(eqLog.map(function(l){return{Date:new Date(l.date).toLocaleString(),User:l.user,Action:l.action,Item:l.item}})),'Equipment Log')
      XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(toolLog.map(function(l){return{Date:new Date(l.date).toLocaleString(),User:l.user,Action:l.action,Item:l.item,Serial:l.serial||''}})),'Tooling Log')
      XLSX.writeFile(wb,'EquipmentManager_'+(selProj?selProj.name:'export')+'.xlsx')
      toast('Excel exported')
    }catch(e2){toast('Export failed','error')}
  }

  var IS={width:'100%',padding:'10px 12px',border:'1px solid #ddd',borderRadius:4,fontSize:16,fontFamily:EQ_FF,outline:'none',boxSizing:'border-box',marginBottom:10}
  var today=new Date().toISOString().slice(0,10)

  // Login
  if(!user){
    return (
      <div style={{position:'fixed',inset:0,background:EQ_NAV,display:'flex',alignItems:'center',justifyContent:'center',fontFamily:EQ_FF,zIndex:2000}}>
        <div style={{width:'90%',maxWidth:360,background:'#fff',borderRadius:12,padding:m?24:32}}>
          <div style={{textAlign:'center',marginBottom:24}}>
            <div style={{fontSize:28,fontWeight:700,letterSpacing:3,fontFamily:EQ_BB}}>SRC&D</div>
            <div style={{fontSize:12,color:'#888',letterSpacing:2,fontFamily:EQ_FF}}>EQUIPMENT MANAGER</div>
          </div>
          {err&&<div style={{background:'#fee',color:'#c00',padding:8,borderRadius:4,marginBottom:10,fontSize:13}}>{err}</div>}
          <input value={loginU} onChange={function(e){setLU(e.target.value)}} placeholder="Username" style={IS}/>
          <input type="password" value={loginP} onChange={function(e){setLP(e.target.value)}} placeholder="Password" style={IS} onKeyDown={function(e){if(e.key==='Enter'){if(signUp)doSignup();else login()}}}/>
          <div style={{display:'flex',gap:8}}>
            <div onClick={function(){if(signUp)doSignup();else login()}} style={{flex:1,padding:12,background:EQ_GOLD,borderRadius:4,textAlign:'center',cursor:'pointer',fontWeight:700,fontSize:14,letterSpacing:2,color:'#fff'}}>{signUp?'SIGN UP':'SIGN IN'}</div>
          </div>
          <div style={{textAlign:'center',marginTop:12,fontSize:13,color:'#888'}}><span onClick={function(){setSignUp(!signUp);setErr('')}} style={{color:EQ_GOLD,cursor:'pointer'}}>{signUp?'← Back to Login':'Create Account →'}</span></div>
        </div>
      </div>
    )
  }

  // Filtered equipment
  var filteredEq=equipment.filter(function(e){
    if(eqFilter!=='all'&&e.type!==eqFilter)return false
    if(eqSearch){var s=eqSearch.toLowerCase();return(e.type||'').toLowerCase().indexOf(s)>=0||(e.rental||'').toLowerCase().indexOf(s)>=0||(e.rep||'').toLowerCase().indexOf(s)>=0}
    return true
  })
  var filteredTools=tools.filter(function(t){
    if(!toolSearch)return true
    var s=toolSearch.toLowerCase();return(t.name||'').toLowerCase().indexOf(s)>=0||(t.serial||'').toLowerCase().indexOf(s)>=0
  })
  var overdueEq=equipment.filter(function(e){return e.dayOut&&e.dayOut<today})

  var navItems=[{id:'projects',label:'Projects',ico:'📁'},{id:'equipment',label:'Equipment',ico:'🚜'},{id:'tools',label:'Tools',ico:'🔧'},{id:'records',label:'Records',ico:'📊'}]

  var sidebar=(
    <div style={{width:mob?260:200,background:EQ_NAV,color:'#1a1a2e',display:'flex',flexDirection:'column',flexShrink:0,fontFamily:EQ_FF,height:'100%',borderRight:'1px solid rgba(0,0,0,.08)'}}>
      <div style={{padding:'14px 12px',borderBottom:'1px solid rgba(0,0,0,.08)'}}>
        <div style={{display:'flex',alignItems:'center',gap:8}}>
          <div style={{fontSize:13,fontWeight:700}}>{user.name}</div>
        </div>
        {selProj&&<div style={{marginTop:8,padding:'4px 8px',background:selProj.color+'22',borderLeft:'3px solid '+selProj.color,borderRadius:3,fontSize:11,color:'#666'}}>{selProj.name}</div>}
      </div>
      <div style={{flex:1,padding:'6px 0'}}>
        {navItems.map(function(n){return (
          <div key={n.id} onClick={function(){setPage(n.id);setDrawer(false)}} style={{display:'flex',alignItems:'center',gap:8,padding:'9px 12px',cursor:'pointer',color:page===n.id?EQ_GOLD:'#666',background:page===n.id?'rgba(249,115,22,.08)':'transparent',borderRight:page===n.id?'3px solid '+EQ_GOLD:'3px solid transparent',fontSize:13,letterSpacing:1}}><span>{n.ico}</span>{n.label}</div>
        )})}
      </div>
      <div style={{padding:10,borderTop:'1px solid rgba(0,0,0,.08)'}}>
        <div onClick={logout} style={{padding:'6px 10px',background:'#f0ede8',borderRadius:4,textAlign:'center',cursor:'pointer',fontSize:11,color:'#666',marginBottom:4}}>Sign Out</div>
        {onExit&&<div onClick={onExit} style={{padding:'6px 10px',background:'#f0ede8',borderRadius:4,textAlign:'center',cursor:'pointer',fontSize:11,color:'#666'}}>✕ Exit</div>}
      </div>
    </div>
  )

  return (
    <div style={{position:'fixed',inset:0,display:'flex',fontFamily:EQ_FF,overflow:'hidden',background:EQ_BG,zIndex:2000}}>
      {!mob&&sidebar}
      <div style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden'}}>
        <div style={{background:EQ_NAV,color:'#1a1a2e',padding:'10px 16px',display:'flex',alignItems:'center',justifyContent:'space-between',flexShrink:0,borderBottom:'1px solid rgba(0,0,0,.08)'}}>
          <div style={{display:'flex',alignItems:'center',gap:10}}>
            {mob&&<span onClick={function(){setDrawer(true)}} style={{fontSize:20,cursor:'pointer'}}>☰</span>}
            <span style={{fontWeight:700,letterSpacing:2,fontSize:14,fontFamily:EQ_BB}}>{(navItems.find(function(n){return n.id===page})||{label:''}).label.toUpperCase()}</span>
          </div>
          <div style={{display:'flex',gap:6,alignItems:'center'}}>
            {selProj&&page!=='projects'&&<div onClick={exportExcel} style={{padding:'4px 10px',background:'#f0ede8',borderRadius:3,cursor:'pointer',fontSize:10,color:'#666',letterSpacing:1,fontFamily:EQ_FF}}>Export XLSX</div>}
          </div>
        </div>
        <div style={{flex:1,overflow:'auto',padding:mob?12:'20px 28px'}}>

          {/* ═══ PROJECTS ═══ */}
          {page==='projects'&&<div>
            <div style={{fontSize:22,fontWeight:700,letterSpacing:2,marginBottom:16,fontFamily:EQ_BB}}>PROJECTS</div>
            <div style={{display:'flex',gap:8,marginBottom:16}}>
              <input value={newProj} onChange={function(e){setNP(e.target.value)}} placeholder="New project" style={{flex:1,padding:'8px 12px',border:'1px solid #ddd',borderRadius:4,fontSize:13,fontFamily:EQ_FF,outline:'none'}} onKeyDown={function(e){if(e.key==='Enter')createProj()}}/>
              <input type="color" value={newColor} onChange={function(e){setNC(e.target.value)}} style={{width:38,height:38,border:'none',cursor:'pointer',borderRadius:4}}/>
              <div onClick={createProj} style={{padding:'8px 16px',background:EQ_GOLD,color:'#fff',borderRadius:4,cursor:'pointer',fontWeight:700,fontSize:12}}>+ CREATE</div>
            </div>
            {projects.map(function(p){return (
              <div key={p.id} onClick={function(){setSelProj(p);setPage('equipment')}} style={{background:'#fff',borderRadius:8,padding:16,marginBottom:8,cursor:'pointer',borderLeft:'4px solid '+p.color,transition:'transform .15s'}} onMouseEnter={function(e){e.currentTarget.style.transform='translateY(-2px)'}} onMouseLeave={function(e){e.currentTarget.style.transform='translateY(0)'}}>
                <div style={{fontWeight:700,fontSize:15}}>{p.name}</div>
                <div style={{fontSize:11,color:'#888',marginTop:4}}>Created {new Date(p.createdAt).toLocaleDateString()}</div>
              </div>
            )})}
            {projects.length===0&&<div style={{textAlign:'center',padding:30,color:'#aaa'}}>No projects yet</div>}
          </div>}

          {/* ═══ EQUIPMENT ═══ */}
          {page==='equipment'&&!selProj&&<div style={{textAlign:'center',padding:40,color:'#888'}}>Select a project<br/><span onClick={function(){setPage('projects')}} style={{color:EQ_GOLD,cursor:'pointer'}}>← Projects</span></div>}
          {page==='equipment'&&selProj&&<div>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12,flexWrap:'wrap',gap:8}}>
              <div style={{fontSize:22,fontWeight:700,letterSpacing:2,fontFamily:EQ_BB}}>{selProj.name} — EQUIPMENT</div>
              <div onClick={function(){setEqForm({id:uid(),type:'Work Trucks',qty:1,rental:'',rep:'',phone:'',dayIn:today,dayOut:'',notes:''})}} style={{padding:'8px 16px',background:EQ_GOLD,color:'#fff',borderRadius:4,cursor:'pointer',fontWeight:700,fontSize:12}}>+ Add Equipment</div>
            </div>
            {overdueEq.length>0&&<div style={{background:'#fee',border:'1px solid #fcc',borderRadius:6,padding:'10px 14px',marginBottom:12,fontSize:13,color:'#c00',display:'flex',alignItems:'center',gap:8}}>⚠ {overdueEq.length} equipment past estimated day out</div>}
            <div style={{display:'flex',gap:6,marginBottom:12,flexWrap:'wrap'}}>
              <input value={eqSearch} onChange={function(e){setEqSearch(e.target.value)}} placeholder="Search..." style={{flex:1,minWidth:150,padding:'7px 10px',border:'1px solid #ddd',borderRadius:4,fontSize:12,fontFamily:EQ_FF,outline:'none'}}/>
              <div onClick={function(){setEqFilter('all')}} style={{padding:'6px 12px',borderRadius:4,fontSize:11,fontWeight:600,cursor:'pointer',background:eqFilter==='all'?EQ_GOLD:'#fff',color:eqFilter==='all'?'#fff':'#666',border:'1px solid '+(eqFilter==='all'?EQ_GOLD:'#ddd')}}>All</div>
              {EQ_TYPES.map(function(t){return <div key={t} onClick={function(){setEqFilter(eqFilter===t?'all':t)}} style={{padding:'6px 10px',borderRadius:4,fontSize:11,fontWeight:600,cursor:'pointer',background:eqFilter===t?EQ_GOLD:'#fff',color:eqFilter===t?'#fff':'#666',border:'1px solid '+(eqFilter===t?EQ_GOLD:'#ddd')}}>{t}</div>})}
            </div>
            {filteredEq.map(function(eq){
              var overdue=eq.dayOut&&eq.dayOut<today
              return (
                <div key={eq.id} style={{background:'#fff',borderRadius:6,padding:'12px 16px',marginBottom:6,borderLeft:'3px solid '+(overdue?'#ef4444':EQ_GOLD)}}>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:6}}>
                    <div>
                      <div style={{fontWeight:700,fontSize:14}}>{eq.type} <span style={{fontWeight:400,color:'#888'}}>× {eq.qty}</span></div>
                      <div style={{fontSize:12,color:'#555',marginTop:2}}>{eq.rental} · {eq.rep} · {eq.phone}</div>
                      <div style={{fontSize:11,color:'#888',marginTop:2}}>In: {eq.dayIn} → Out: {eq.dayOut||'TBD'}{overdue&&<span style={{color:'#ef4444',fontWeight:700}}> OVERDUE</span>}</div>
                    </div>
                    <div style={{display:'flex',gap:4}}>
                      <div onClick={function(){setEqForm(Object.assign({},eq))}} style={{padding:'4px 10px',background:'#f0f0ec',borderRadius:3,cursor:'pointer',fontSize:10,fontWeight:600}}>Edit</div>
                      <div onClick={function(){deleteEquip(eq.id)}} style={{padding:'4px 10px',background:'#fee',color:'#c00',borderRadius:3,cursor:'pointer',fontSize:10}}>Remove</div>
                    </div>
                  </div>
                  {eq.notes&&<div style={{fontSize:11,color:'#888',marginTop:4}}>Notes: {eq.notes}</div>}
                </div>
              )
            })}
            {filteredEq.length===0&&<div style={{background:'#fff',borderRadius:6,padding:20,color:'#aaa',textAlign:'center'}}>No equipment</div>}
          </div>}

          {/* ═══ TOOLS ═══ */}
          {page==='tools'&&!selProj&&<div style={{textAlign:'center',padding:40,color:'#888'}}>Select a project<br/><span onClick={function(){setPage('projects')}} style={{color:EQ_GOLD,cursor:'pointer'}}>← Projects</span></div>}
          {page==='tools'&&selProj&&<div>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12,flexWrap:'wrap',gap:8}}>
              <div style={{fontSize:22,fontWeight:700,letterSpacing:2,fontFamily:EQ_BB}}>TOOLS & INVENTORY</div>
              <div onClick={function(){setToolForm({id:uid(),name:'',serial:'',cost:'',acquired:today,status:'working',statusChangedAt:'',statusChangedBy:''})}} style={{padding:'8px 16px',background:EQ_GOLD,color:'#fff',borderRadius:4,cursor:'pointer',fontWeight:700,fontSize:12}}>+ Add Tool</div>
            </div>
            <input value={toolSearch} onChange={function(e){setToolSearch(e.target.value)}} placeholder="Search tools..." style={{width:'100%',padding:'8px 12px',border:'1px solid #ddd',borderRadius:4,fontSize:12,fontFamily:EQ_FF,outline:'none',marginBottom:12,boxSizing:'border-box'}}/>
            {filteredTools.map(function(t){return (
              <div key={t.id} style={{background:'#fff',borderRadius:6,padding:'12px 16px',marginBottom:6,borderLeft:'3px solid '+(t.status==='working'?'#22c55e':'#ef4444')}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:6}}>
                  <div>
                    <div style={{fontWeight:700,fontSize:14}}>{t.name}</div>
                    <div style={{fontSize:12,color:'#555',marginTop:2}}>SN: {t.serial} · ${t.cost} · Acquired: {t.acquired}</div>
                    {t.statusChangedAt&&<div style={{fontSize:10,color:'#888',marginTop:2}}>Status changed: {new Date(t.statusChangedAt).toLocaleString()} by {t.statusChangedBy}</div>}
                  </div>
                  <div style={{display:'flex',gap:4,alignItems:'center'}}>
                    <div onClick={function(){toggleToolStatus(t)}} style={{padding:'4px 12px',borderRadius:3,cursor:'pointer',fontSize:11,fontWeight:700,background:t.status==='working'?'#dcfce7':'#fee',color:t.status==='working'?'#16a34a':'#dc2626'}}>{t.status==='working'?'✓ Working':'✕ Broken'}</div>
                    <div onClick={function(){setToolForm(Object.assign({},t))}} style={{padding:'4px 10px',background:'#f0f0ec',borderRadius:3,cursor:'pointer',fontSize:10}}>Edit</div>
                  </div>
                </div>
              </div>
            )})}
            {filteredTools.length===0&&<div style={{background:'#fff',borderRadius:6,padding:20,color:'#aaa',textAlign:'center'}}>No tools</div>}
          </div>}

          {/* ═══ RECORDS ═══ */}
          {page==='records'&&<div>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16,flexWrap:'wrap',gap:8}}>
              <div style={{fontSize:22,fontWeight:700,letterSpacing:2,fontFamily:EQ_BB}}>RECORDS & LOGS</div>
              {selProj&&<div onClick={exportExcel} style={{padding:'8px 16px',background:EQ_GOLD,color:'#fff',borderRadius:4,cursor:'pointer',fontWeight:700,fontSize:12}}>📊 Export XLSX</div>}
            </div>
            {!selProj&&<div style={{color:'#888',textAlign:'center',padding:20}}>Select a project first</div>}
            {selProj&&<div>
              <div style={{fontSize:16,fontWeight:700,letterSpacing:1,marginBottom:8,fontFamily:EQ_BB}}>EQUIPMENT LOG ({eqLog.length})</div>
              <div style={{background:'#fff',borderRadius:6,overflow:'hidden',marginBottom:20}}>
                {eqLog.slice().reverse().slice(0,30).map(function(l){return (
                  <div key={l.id} style={{padding:'8px 12px',borderBottom:'1px solid #f0f0ec',fontSize:12,display:'flex',justifyContent:'space-between',flexWrap:'wrap',gap:4}}>
                    <div><span style={{fontWeight:600}}>{l.action}</span> — {l.item}</div>
                    <div style={{color:'#888'}}>{l.user} · {new Date(l.date).toLocaleString()}</div>
                  </div>
                )})}
                {eqLog.length===0&&<div style={{padding:16,color:'#aaa',textAlign:'center'}}>No equipment logs</div>}
              </div>
              <div style={{fontSize:16,fontWeight:700,letterSpacing:1,marginBottom:8}}>TOOLING LOG ({toolLog.length})</div>
              <div style={{background:'#fff',borderRadius:6,overflow:'hidden'}}>
                {toolLog.slice().reverse().slice(0,30).map(function(l){return (
                  <div key={l.id} style={{padding:'8px 12px',borderBottom:'1px solid #f0f0ec',fontSize:12,display:'flex',justifyContent:'space-between',flexWrap:'wrap',gap:4}}>
                    <div><span style={{fontWeight:600}}>{l.action}</span> — {l.item}{l.serial?' ('+l.serial+')':''}</div>
                    <div style={{color:'#888'}}>{l.user} · {new Date(l.date).toLocaleString()}</div>
                  </div>
                )})}
                {toolLog.length===0&&<div style={{padding:16,color:'#aaa',textAlign:'center'}}>No tooling logs</div>}
              </div>
            </div>}
          </div>}

        </div>
        {mob&&<div style={{background:EQ_NAV,display:'flex',justifyContent:'space-around',padding:'8px 0',borderTop:'1px solid rgba(0,0,0,.08)',flexShrink:0}}>
          {navItems.map(function(n){return (
            <div key={n.id} onClick={function(){setPage(n.id)}} style={{display:'flex',flexDirection:'column',alignItems:'center',gap:1,cursor:'pointer',color:page===n.id?EQ_GOLD:'#888',fontSize:9}}><span style={{fontSize:16}}>{n.ico}</span>{n.label}</div>
          )})}
        </div>}
      </div>

      {/* Mobile drawer */}
      {mob&&drawer&&<div>
        <div onClick={function(){setDrawer(false)}} style={{position:'fixed',inset:0,background:'rgba(0,0,0,.5)',zIndex:900}}/>
        <div style={{position:'fixed',top:0,left:0,bottom:0,width:260,zIndex:901,background:EQ_NAV}}>{sidebar}</div>
      </div>}

      {/* Equipment form modal */}
      {eqForm&&<div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.5)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:7000,padding:16}}>
        <div style={{background:'#fff',borderRadius:10,padding:20,width:'95vw',maxWidth:460,maxHeight:'85vh',overflow:'auto',fontFamily:EQ_FF}} onClick={function(e){e.stopPropagation()}}>
          <div style={{display:'flex',justifyContent:'space-between',marginBottom:14}}>
            <div style={{fontSize:16,fontWeight:700}}>{equipment.find(function(e){return e.id===eqForm.id})?'Edit Equipment':'Add Equipment'}</div>
            <span onClick={function(){setEqForm(null)}} style={{cursor:'pointer',color:'#888',fontSize:18}}>✕</span>
          </div>
          <div style={{fontSize:10,letterSpacing:2,color:'#888',marginBottom:4}}>TYPE *</div>
          <select value={eqForm.type} onChange={function(e){setEqForm(Object.assign({},eqForm,{type:e.target.value}))}} style={IS}>
            {EQ_TYPES.map(function(t){return <option key={t} value={t}>{t}</option>})}
          </select>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
            <div><div style={{fontSize:10,letterSpacing:2,color:'#888',marginBottom:4}}>QTY</div><input type="number" min="1" value={eqForm.qty} onChange={function(e){setEqForm(Object.assign({},eqForm,{qty:parseInt(e.target.value)||1}))}} style={IS}/></div>
            <div><div style={{fontSize:10,letterSpacing:2,color:'#888',marginBottom:4}}>PHONE *</div><input value={eqForm.phone} onChange={function(e){setEqForm(Object.assign({},eqForm,{phone:e.target.value}))}} placeholder="Rep phone" style={IS}/></div>
          </div>
          <div style={{fontSize:10,letterSpacing:2,color:'#888',marginBottom:4}}>RENTAL COMPANY *</div>
          <input value={eqForm.rental} onChange={function(e){setEqForm(Object.assign({},eqForm,{rental:e.target.value}))}} placeholder="Company name" style={IS}/>
          <div style={{fontSize:10,letterSpacing:2,color:'#888',marginBottom:4}}>REPRESENTATIVE *</div>
          <input value={eqForm.rep} onChange={function(e){setEqForm(Object.assign({},eqForm,{rep:e.target.value}))}} placeholder="Rep name" style={IS}/>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
            <div><div style={{fontSize:10,letterSpacing:2,color:'#888',marginBottom:4}}>DAY IN</div><input type="date" value={eqForm.dayIn} onChange={function(e){setEqForm(Object.assign({},eqForm,{dayIn:e.target.value}))}} style={IS}/></div>
            <div><div style={{fontSize:10,letterSpacing:2,color:'#888',marginBottom:4}}>EST. DAY OUT</div><input type="date" value={eqForm.dayOut} onChange={function(e){setEqForm(Object.assign({},eqForm,{dayOut:e.target.value}))}} style={IS}/></div>
          </div>
          <div style={{fontSize:10,letterSpacing:2,color:'#888',marginBottom:4}}>NOTES</div>
          <textarea value={eqForm.notes||''} onChange={function(e){setEqForm(Object.assign({},eqForm,{notes:e.target.value}))}} rows={2} style={Object.assign({},IS,{resize:'vertical'})}/>
          <div style={{display:'flex',gap:8,marginTop:6}}>
            <div onClick={function(){if(!eqForm.rental||!eqForm.rep||!eqForm.phone){toast('Fill rental company, rep, and phone','error');return}saveEquip(eqForm)}} style={{flex:1,padding:12,background:EQ_GOLD,color:'#fff',borderRadius:4,textAlign:'center',cursor:'pointer',fontWeight:700,fontSize:14}}>SAVE</div>
            <div onClick={function(){setEqForm(null)}} style={{padding:'12px 16px',background:'#eee',borderRadius:4,cursor:'pointer',fontSize:13}}>Cancel</div>
          </div>
        </div>
      </div>}

      {/* Tool form modal */}
      {toolForm&&<div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.5)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:7000,padding:16}}>
        <div style={{background:'#fff',borderRadius:10,padding:20,width:'95vw',maxWidth:420,fontFamily:EQ_FF}} onClick={function(e){e.stopPropagation()}}>
          <div style={{display:'flex',justifyContent:'space-between',marginBottom:14}}>
            <div style={{fontSize:16,fontWeight:700}}>{tools.find(function(t){return t.id===toolForm.id})?'Edit Tool':'Add Tool'}</div>
            <span onClick={function(){setToolForm(null)}} style={{cursor:'pointer',color:'#888',fontSize:18}}>✕</span>
          </div>
          <div style={{fontSize:10,letterSpacing:2,color:'#888',marginBottom:4}}>TOOL NAME *</div>
          <input value={toolForm.name} onChange={function(e){setToolForm(Object.assign({},toolForm,{name:e.target.value}))}} placeholder="e.g. Impact Driver" style={IS}/>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
            <div><div style={{fontSize:10,letterSpacing:2,color:'#888',marginBottom:4}}>SERIAL NUMBER</div><input value={toolForm.serial} onChange={function(e){setToolForm(Object.assign({},toolForm,{serial:e.target.value}))}} style={IS}/></div>
            <div><div style={{fontSize:10,letterSpacing:2,color:'#888',marginBottom:4}}>COST ($)</div><input type="number" value={toolForm.cost} onChange={function(e){setToolForm(Object.assign({},toolForm,{cost:e.target.value}))}} style={IS}/></div>
          </div>
          <div style={{fontSize:10,letterSpacing:2,color:'#888',marginBottom:4}}>DATE ACQUIRED</div>
          <input type="date" value={toolForm.acquired} onChange={function(e){setToolForm(Object.assign({},toolForm,{acquired:e.target.value}))}} style={IS}/>
          <div style={{display:'flex',gap:8,marginTop:6}}>
            <div onClick={function(){if(!toolForm.name){toast('Enter tool name','error');return}saveTool(toolForm)}} style={{flex:1,padding:12,background:EQ_GOLD,color:'#fff',borderRadius:4,textAlign:'center',cursor:'pointer',fontWeight:700,fontSize:14}}>SAVE</div>
            <div onClick={function(){setToolForm(null)}} style={{padding:'12px 16px',background:'#eee',borderRadius:4,cursor:'pointer',fontSize:13}}>Cancel</div>
          </div>
        </div>
      </div>}

      {/* Toasts */}
      <div style={{position:'fixed',top:16,right:16,zIndex:9999,display:'flex',flexDirection:'column',gap:6}}>
        {toasts.map(function(t){return <div key={t.id} style={{background:t.type==='error'?'#dc2626':t.type==='warning'?'#d97706':'#16a34a',color:'#fff',padding:'10px 16px',borderRadius:6,fontFamily:EQ_FF,fontSize:13,boxShadow:'0 4px 16px rgba(0,0,0,.3)',minWidth:200}}>{t.msg}</div>})}
      </div>
    </div>
  )
}



// ═══════════════════════════════════════════════════════════════════════
//  CALCULATION ENGINE — faithfully recreates every Excel formula chain
// ═══════════════════════════════════════════════════════════════════════

function computeStaffingRate(baseRate, fringe, payrollTaxPct, hoursPerDay, wageType, pwMultiplier) {
  const std = 8, otMult = 1.5;
  const otHours = hoursPerDay > std ? hoursPerDay - std : 0;
  const payroll = baseRate * payrollTaxPct;
  if (wageType === "Prevailing Wage") {
    const pwRate = (baseRate + fringe) * pwMultiplier;
    return (pwRate * std) + (pwRate * otMult * otHours);
  }
  return ((baseRate + fringe + payroll) * std) + ((((baseRate + payroll) * otMult) + fringe) * otHours);
}

function computeAll(p) {
  const r = {};
  r.systemKW = p.systemSizeMW * 1000;
  r.systemWDC = p.systemSizeMW * 1000000;
  r.payrollTaxPct = p.ficaSS + p.medical + p.futa + p.suta + p.workersComp + p.umbrella + p.genLiability + p.payrollService;

  const roles = [
    { key: "admin", base: p.adminRate, fringe: 0 },
    { key: "generalLabor", base: p.generalLaborRate, fringe: p.generalLaborFringe },
    { key: "generalLaborApp", base: p.generalLaborRate, fringe: p.generalLaborFringe },
    { key: "telehandlerOp", base: p.telehandlerOpRate, fringe: p.telehandlerOpFringe },
    { key: "telehandlerOpApp", base: p.telehandlerOpRate, fringe: p.telehandlerOpFringe },
    { key: "pileDriverOp", base: p.pileDriverOpRate, fringe: p.pileDriverOpFringe },
    { key: "pileDriverOpApp", base: p.pileDriverOpRate, fringe: p.pileDriverOpFringe },
    { key: "skidSteerOp", base: p.skidSteerOpRate, fringe: p.skidSteerOpFringe },
    { key: "skidSteerOpApp", base: p.skidSteerOpRate, fringe: p.skidSteerOpFringe },
  ];
  roles.forEach(({ key, base, fringe }) => {
    r[`${key}DayRate`] = computeStaffingRate(base, fringe, r.payrollTaxPct, p.workHoursPerDay, p.wageType, p.pwMultiplier);
    r[`${key}HourlyRate`] = r[`${key}DayRate`] / p.workHoursPerDay;
  });

  const adjEff = p.fuelEfficiency;
  r.pileDriverFuelPerDay = p.pileDriverGalHr * p.workHoursPerDay * adjEff * p.dieselPerGallon;
  r.skidSteerFuelPerDay = p.skidSteerGalHr * p.workHoursPerDay * adjEff * p.dieselPerGallon;
  r.telehandlerFuelPerDay = p.telehandlerGalHr * p.workHoursPerDay * adjEff * p.dieselPerGallon;
  r.companyTruckFuelPerDay = p.companyTruckGalHr * p.workHoursPerDay * adjEff * p.dieselPerGallon;
  r.utvFuelPerDay = p.utvGalHr * p.workHoursPerDay * adjEff * p.dieselPerGallon;

  // PILE DRIVING
  r.totalPiles = p.rackingPiles + p.inverterPiles + p.cabPiles + p.combinerBoxPiles + p.loadBreakPiles;
  const minPerPile = p.estDriveTime + p.estTransitionTime;
  r.pileManhours = Math.ceil((minPerPile * r.totalPiles) / 60);
  r.pileAdjustedManhours = Math.round(r.pileManhours / p.pileEfficiency);
  r.pileDaysToComplete = Math.max(1, Math.ceil(Math.ceil(r.pileAdjustedManhours / p.numExcavators) / p.workHoursPerDay));
  r.pilesPerDayPerMachine = r.totalPiles / r.pileDaysToComplete;
  r.pileCalendarDays = Math.ceil(r.pileDaysToComplete * 7 / p.workdaysInWeek);
  r.pileTotalStaff = p.pileSkidSteerOps + p.pileGroundMan + p.pileAdditionalLaborers + p.numExcavators + Math.round(p.pileAdditionalLaborers * p.apprenticeReqPct);
  r.pileTotalManHours = r.pileTotalStaff * r.pileDaysToComplete * p.workHoursPerDay;
  const pileJourneymen = p.pileAdditionalLaborers + p.pileGroundMan - Math.floor((p.pileAdditionalLaborers + p.pileGroundMan) * p.apprenticeReqPct);
  const pileApprentices = Math.ceil((p.pileAdditionalLaborers + p.pileGroundMan) * p.apprenticeReqPct);
  r.pileLaborCost = (pileJourneymen * r.generalLaborDayRate * r.pileDaysToComplete) + (pileApprentices * r.generalLaborAppDayRate * r.pileDaysToComplete) + (p.numExcavators * r.pileDriverOpDayRate * r.pileDaysToComplete) + (p.pileSkidSteerOps * r.skidSteerOpDayRate * r.pileDaysToComplete);
  r.pilePerDiemCost = p.includeHotelPerDiem ? r.pileTotalStaff * p.perDiem * p.perDiemPct * r.pileCalendarDays : 0;
  r.pileEquipRental = (p.numExcavators * p.pileDriverEquipDaily * r.pileCalendarDays) + (p.pileSkidSteerOps * p.skidSteerEquipDaily * r.pileCalendarDays);
  r.pileFuelCost = (p.numExcavators * r.pileDriverFuelPerDay * r.pileDaysToComplete) + (p.pileSkidSteerOps * r.skidSteerFuelPerDay * r.pileDaysToComplete);
  r.pileScopeTotal = r.pileLaborCost + r.pilePerDiemCost + r.pileEquipRental + r.pileFuelCost;

  // RACKING
  r.linearFeetRacking = p.calculateByModules ? Math.ceil(((p.moduleWidth + 1) * p.moduleCount) / 12) : p.manualLinearFeet;
  r.rackingManhours = Math.ceil(r.linearFeetRacking / p.rackingLfPerHourPerMan);
  r.rackingAdjustedManhours = Math.ceil(r.rackingManhours / p.rackingEfficiency);
  r.rackingDaysToComplete = Math.max(1, Math.ceil(Math.ceil(r.rackingAdjustedManhours / p.rackingTotalWorkers) / p.workHoursPerDay));
  r.rackingCalendarDays = Math.ceil(r.rackingDaysToComplete * 7 / p.workdaysInWeek);
  r.rackingManHours = p.rackingTotalWorkers * r.rackingDaysToComplete * p.workHoursPerDay;
  r.rackingLaborCost = (p.rackingGeneralLabor * r.generalLaborDayRate * r.rackingDaysToComplete) + (p.rackingGeneralLaborApp * r.generalLaborAppDayRate * r.rackingDaysToComplete) + (p.rackingTelehandlerOps * r.telehandlerOpDayRate * r.rackingDaysToComplete) + (p.rackingSkidSteerOps * r.skidSteerOpDayRate * r.rackingDaysToComplete);
  r.rackingPerDiemCost = p.includeHotelPerDiem ? p.rackingTotalWorkers * p.perDiem * p.perDiemPct * r.rackingCalendarDays : 0;
  r.rackingEquipRental = (p.rackingSkidSteerOps * p.skidSteerEquipDaily * r.rackingCalendarDays) + (p.rackingTelehandlerOps * p.telehandlerEquipDaily * r.rackingCalendarDays) + (1 * p.companyTruckEquipDaily * r.rackingCalendarDays);
  r.rackingFuelCost = (p.rackingSkidSteerOps * r.skidSteerFuelPerDay * r.rackingDaysToComplete) + (p.rackingTelehandlerOps * r.telehandlerFuelPerDay * r.rackingDaysToComplete) + (1 * r.companyTruckFuelPerDay * r.rackingDaysToComplete);
  r.rackingScopeTotal = r.rackingLaborCost + r.rackingPerDiemCost + r.rackingEquipRental + r.rackingFuelCost;

  // MODULES
  r.moduleCount = p.moduleCount;
  r.moduleManhours = Math.ceil(r.moduleCount / p.modulesPerHourPerMan);
  r.moduleAdjustedManhours = Math.ceil(r.moduleManhours / p.moduleEfficiency);
  r.moduleDaysToComplete = Math.max(1, Math.ceil(Math.ceil(r.moduleAdjustedManhours / p.moduleTotalWorkers) / p.workHoursPerDay));
  r.moduleCalendarDays = Math.ceil(r.moduleDaysToComplete * 7 / p.workdaysInWeek);
  r.moduleManHours = p.moduleTotalWorkers * r.moduleDaysToComplete * p.workHoursPerDay;
  r.moduleLaborCost = (p.moduleGeneralLabor * r.generalLaborDayRate * r.moduleDaysToComplete) + (p.moduleGeneralLaborApp * r.generalLaborAppDayRate * r.moduleDaysToComplete) + (p.moduleSkidSteerOps * r.skidSteerOpDayRate * r.moduleDaysToComplete);
  r.modulePerDiemCost = p.includeHotelPerDiem ? p.moduleTotalWorkers * p.perDiem * p.perDiemPct * r.moduleCalendarDays : 0;
  r.moduleEquipRental = p.moduleSkidSteerOps * p.skidSteerEquipDaily * r.moduleCalendarDays;
  r.moduleFuelCost = p.moduleSkidSteerOps * r.skidSteerFuelPerDay * r.moduleDaysToComplete;
  r.moduleScopeTotal = r.moduleLaborCost + r.modulePerDiemCost + r.moduleEquipRental + r.moduleFuelCost;

  // QA/QC
  r.qcPileHours = Math.ceil(p.qcPileMultiplier * r.totalPiles);
  r.qcRackingHours = Math.ceil(p.qcRackMultiplier * r.linearFeetRacking);
  r.qcModuleHours = Math.ceil(p.qcModuleMultiplier * r.moduleCount);
  r.qcTotalHours = r.qcPileHours + r.qcRackingHours + r.qcModuleHours;
  r.qcWorkdays = Math.ceil(Math.ceil(r.qcTotalHours / p.qcNumMen) / p.workHoursPerDay);
  r.qcCalendarDays = Math.ceil(r.qcWorkdays * 7 / p.workdaysInWeek);
  r.qcManHours = p.qcNumMen * r.qcWorkdays * p.workHoursPerDay;
  const qcJourney = p.qcNumMen - p.qcApprentices;
  r.qcLaborCost = (qcJourney * r.generalLaborDayRate * r.qcWorkdays) + (p.qcApprentices * r.generalLaborDayRate * r.qcWorkdays);
  r.qcPerDiemCost = p.includeHotelPerDiem ? p.qcNumMen * p.perDiem * p.perDiemPct * r.qcCalendarDays : 0;
  r.qcScopeTotal = r.qcLaborCost + r.qcPerDiemCost;

  // MATERIAL HANDLING
  r.matHandlWorkDays = r.pileDaysToComplete + 3;
  r.matHandlCalendarDays = Math.ceil(r.matHandlWorkDays * 7 / p.workdaysInWeek);
  r.matHandlManHours = p.matHandlCrewSize * r.matHandlWorkDays * p.workHoursPerDay;
  r.matHandlLaborCost = (p.matHandlAdmin * r.adminDayRate * r.matHandlWorkDays) + (p.matHandlGeneralLabor * r.generalLaborHourlyRate * r.matHandlWorkDays * p.workHoursPerDay) + (p.matHandlTeleOps * r.telehandlerOpHourlyRate * r.matHandlWorkDays * p.workHoursPerDay) + (p.matHandlSkidOps * r.skidSteerOpHourlyRate * r.matHandlWorkDays * p.workHoursPerDay);
  r.matHandlPerDiemCost = p.includeHotelPerDiem ? p.matHandlCrewSize * p.perDiem * p.perDiemPct * r.matHandlCalendarDays : 0;
  r.matHandlEquipRental = (p.matHandlSkidOps * p.skidSteerEquipDaily * r.matHandlCalendarDays) + (p.matHandlTeleOps * p.telehandlerEquipDaily * r.matHandlCalendarDays);
  r.matHandlFuelCost = (p.matHandlSkidOps * r.skidSteerFuelPerDay * r.matHandlWorkDays) + (p.matHandlTeleOps * r.telehandlerFuelPerDay * r.matHandlWorkDays);
  r.matHandlScopeTotal = r.matHandlLaborCost + r.matHandlPerDiemCost + r.matHandlEquipRental + r.matHandlFuelCost;

  // SCHEDULE
  r.totalCalendarDays = r.pileCalendarDays + r.rackingCalendarDays + r.moduleCalendarDays + 6;
  r.totalWorkDays = r.pileDaysToComplete + r.rackingDaysToComplete + r.moduleDaysToComplete + 4;
  r.totalMonths = r.totalCalendarDays / 30.44;

  // GENERAL CONDITIONS
  r.totalManHoursAll = r.pileTotalManHours + r.rackingManHours + r.moduleManHours + r.qcManHours + r.matHandlManHours;
  r.cartsUtvCost = p.gcCartsRate * p.gcCartsQty * r.totalCalendarDays;
  r.cartsUtvFuelCost = r.utvFuelPerDay * p.gcCartsQty * r.totalWorkDays;
  r.maintenanceCost = p.gcMaintenanceRate * r.totalMonths;
  r.sanitaryCost = p.gcSanitaryRate * p.gcSanitaryQty * r.totalCalendarDays;
  r.safetyCost = p.gcSafetyRate * r.totalManHoursAll;
  r.siteOfficeCost = p.gcSiteOfficeRate * r.totalMonths;
  r.smallToolsCost = p.gcSmallToolsRate * r.totalManHoursAll;
  r.fuelDeliveryCost = p.gcFuelDeliveryRate;
  r.pileSurveyCost = p.gcPileSurveyRate * r.totalPiles;
  r.addlMobSurveyCost = p.gcAddlMobRate;
  r.twistBarsCost = p.gcTwistBarsRate * p.gcTwistBarsQty;
  r.payrollCost = p.gcPayrollRate * p.gcPayrollQty * r.totalWorkDays;
  r.gcTotalCost = r.cartsUtvCost + r.cartsUtvFuelCost + r.maintenanceCost + r.sanitaryCost + r.safetyCost + r.siteOfficeCost + r.smallToolsCost + r.fuelDeliveryCost + r.pileSurveyCost + r.addlMobSurveyCost + r.twistBarsCost + r.payrollCost;

  // MANAGEMENT
  const calcMgmt = (unburdened, qty, calDays, pctTime, isSalary, inclPD) => {
    if (qty === 0) return 0;
    const burdened = unburdened * p.mgmtBurdenMultiplier;
    const wDays = Math.ceil(calDays * pctTime);
    const hours = isSalary ? 8 : 8 + ((p.workHoursPerDay - 8) * 1.5);
    const pd = inclPD ? calDays * pctTime * p.mgmtPerDiem : 0;
    return (burdened * qty * wDays * hours) + pd;
  };
  r.mgmtSuperCost = calcMgmt(p.mgmtSuperRate, p.mgmtSuperQty, r.totalCalendarDays, p.mgmtPctOnSite, false, p.mgmtSuperPerDiem);
  r.mgmtForemanCost = calcMgmt(p.mgmtForemanRate, p.mgmtForemanQty, r.totalCalendarDays, p.mgmtPctOnSite, false, p.mgmtForemanPerDiem);
  r.mgmtSafetyCost = calcMgmt(p.mgmtSafetyRate, p.mgmtSafetyQty, r.totalCalendarDays, p.mgmtPctOnSite, false, p.mgmtSafetyPerDiem);
  r.mgmtTotalCost = r.mgmtSuperCost + r.mgmtForemanCost + r.mgmtSafetyCost;

  // MOBILIZATION
  r.mobCompanyTruckCost = p.mobCompanyTruckRate * p.mobCompanyTruckQty * (p.milesFromHQ / p.mobMPH);
  r.mobTrailerCost = p.mobTrailerRate * p.mobTrailerQty * (p.milesFromHQ * 2);
  r.mobRentalEquipCost = p.mobRentalEquipRate * p.mobRentalEquipQty * (p.mobExtraMobs + 1);
  r.mobLaborCost = r.generalLaborHourlyRate * (p.milesFromHQ / p.mobMPH);
  r.mobPerDiemCost = p.perDiem * 3;
  r.mobTotalCost = r.mobCompanyTruckCost + r.mobTrailerCost + r.mobRentalEquipCost + r.mobLaborCost + r.mobPerDiemCost;

  // WASTE
  r.wasteTotal = p.wasteDumpsterQty * p.wasteDumpsterEmptied * p.wasteDumpsterRate * 2;

  // FUEL TOTALS
  r.totalFuelCost = r.pileFuelCost + r.rackingFuelCost + r.moduleFuelCost + r.matHandlFuelCost + r.cartsUtvFuelCost;

  // ESTIMATE SUMMARY
  r.subtotalCost = r.gcTotalCost + r.mgmtTotalCost + r.mobTotalCost + r.wasteTotal + r.matHandlScopeTotal + r.pileScopeTotal + r.qcScopeTotal + r.rackingScopeTotal + r.moduleScopeTotal;
  r.contingencyAmt = r.subtotalCost * p.contingencyPct;
  r.subtotalWithContingency = r.subtotalCost + r.contingencyAmt;
  r.markupAmt = r.subtotalWithContingency * p.markupPct / (1 - p.markupPct);
  r.preBondTotal = r.subtotalWithContingency + r.markupAmt;
  r.bondAmt = r.preBondTotal * p.bondPct;
  r.postBondTotal = r.preBondTotal + r.bondAmt;
  r.dollarPerWatt = r.preBondTotal / r.systemWDC;
  r.dollarPerWattWithBond = r.postBondTotal / r.systemWDC;

  r.totalApprenticeHours = (pileApprentices * r.pileDaysToComplete * p.workHoursPerDay) + (p.rackingGeneralLaborApp * r.rackingDaysToComplete * p.workHoursPerDay) + (p.moduleGeneralLaborApp * r.moduleDaysToComplete * p.workHoursPerDay) + (p.qcApprentices * r.qcWorkdays * p.workHoursPerDay);
  r.apprenticePct = r.totalManHoursAll > 0 ? r.totalApprenticeHours / r.totalManHoursAll : 0;
  r.apprenticeMet = r.apprenticePct >= p.apprenticeReqPct;
  r.manHoursPerMW = r.totalManHoursAll / p.systemSizeMW;
  return r;
}

// ═══════════════════════════════════════════════════════════════════════
//  DEFAULT BID PARAMETERS
// ═══════════════════════════════════════════════════════════════════════

const DEFAULTS = {
  projectName: "", projectLocation: "", clientName: "", clientContact: "", bidDate: "",
  systemSizeMW: 5, milesFromHQ: 500, workdaysInWeek: 5, workHoursPerDay: 10,
  apprenticeReqPct: 0.15, perDiem: 125, perDiemPct: 1, wageType: "Union", pwMultiplier: 1,
  includeHotelPerDiem: true, status: "Draft",
  adminRate: 30, generalLaborRate: 25.20, generalLaborFringe: 9.85,
  telehandlerOpRate: 34.73, telehandlerOpFringe: 12.12,
  pileDriverOpRate: 38.61, pileDriverOpFringe: 12.18,
  skidSteerOpRate: 34.73, skidSteerOpFringe: 12.12,
  ficaSS: 0.062, medical: 0.0145, futa: 0.06, suta: 0.05,
  workersComp: 0.09, umbrella: 0.01, genLiability: 0.01, payrollService: 0.01,
  pileDriverEquipDaily: 734, skidSteerEquipDaily: 145, telehandlerEquipDaily: 175, companyTruckEquipDaily: 67,
  pileDriverGalHr: 2, skidSteerGalHr: 3.2, telehandlerGalHr: 1.5, companyTruckGalHr: 1.55, utvGalHr: 1,
  fuelEfficiency: 0.8, dieselPerGallon: 5.089,
  rackingPiles: 2000, inverterPiles: 0, cabPiles: 10, combinerBoxPiles: 20, loadBreakPiles: 0,
  estDriveTime: 3, estTransitionTime: 3, pileEfficiency: 1.1, numExcavators: 2,
  pileSkidSteerOps: 1, pileGroundMan: 2, pileAdditionalLaborers: 5,
  moduleCount: 10000, moduleWidth: 47.88, calculateByModules: true, manualLinearFeet: 40000,
  rackingLfPerHourPerMan: 17, rackingEfficiency: 1, rackingTotalWorkers: 20,
  rackingGeneralLabor: 8, rackingGeneralLaborApp: 7, rackingTelehandlerOps: 1, rackingSkidSteerOps: 4,
  modulesPerHourPerMan: 13, moduleEfficiency: 1, moduleTotalWorkers: 12,
  moduleGeneralLabor: 4, moduleGeneralLaborApp: 5, moduleSkidSteerOps: 3,
  qcPileMultiplier: 0.085, qcRackMultiplier: 0.009, qcModuleMultiplier: 0.008, qcNumMen: 3, qcApprentices: 1,
  matHandlCrewSize: 4, matHandlAdmin: 1, matHandlGeneralLabor: 1, matHandlTeleOps: 1, matHandlSkidOps: 1,
  gcCartsRate: 52, gcCartsQty: 5, gcMaintenanceRate: 2000, gcSanitaryRate: 4, gcSanitaryQty: 4,
  gcSafetyRate: 0.75, gcSiteOfficeRate: 2500, gcSmallToolsRate: 2.5,
  gcFuelDeliveryRate: 1000, gcPileSurveyRate: 6, gcAddlMobRate: 1000,
  gcTwistBarsRate: 200, gcTwistBarsQty: 2, gcPayrollRate: 137.5, gcPayrollQty: 6,
  mgmtBurdenMultiplier: 1.3, mgmtPerDiem: 135, mgmtPctOnSite: 0.89,
  mgmtSuperRate: 57.69, mgmtSuperQty: 1, mgmtSuperPerDiem: true,
  mgmtForemanRate: 54.68, mgmtForemanQty: 1, mgmtForemanPerDiem: true,
  mgmtSafetyRate: 30, mgmtSafetyQty: 1, mgmtSafetyPerDiem: true,
  mobMPH: 40, mobCompanyTruckRate: 6.7, mobCompanyTruckQty: 1,
  mobTrailerRate: 0.5, mobTrailerQty: 1, mobRentalEquipRate: 500, mobRentalEquipQty: 19, mobExtraMobs: 1,
  wasteDumpsterQty: 6, wasteDumpsterEmptied: 1, wasteDumpsterRate: 1000,
  contingencyPct: 0.03, markupPct: 0.20, bondPct: 0.02,
};

// ═══════════════════════════════════════════════════════════════════════
//  STORAGE HELPERS
// ═══════════════════════════════════════════════════════════════════════

async function loadProjects() {
  try {
    const res = await sGet("precon_bids");
    return res || [];
  } catch(e) { return []; }
}
async function saveProjects(projects) {
  try { await sSet("precon_bids", projects); } catch (e) { console.error(e); }
  syncBidsToFieldReporting(projects);
  syncBidsToCompliance(projects);
}

function syncBidsToFieldReporting(bids) {
  try {
    var frProjects = JSON.parse(localStorage.getItem("cron_projects")||"[]");
    var changed = false;
    bids.forEach(function(bid) {
      var p = bid.params || {};
      if (!p.projectName || bid.archived) return;
      var r = computeAll(p);
      var frId = "fr-bid-" + bid.id;
      var existing = frProjects.find(function(fp){ return fp.id === frId; });
      var COLORS = {drilling:"#C0392B",piledriving:"#1565C0",postcaps:"#1A6B3A",torquetube:"#7B1FA2",modrails:"#E67E00",modules:"#00838F",pilepull:"#AD1457",qc:"#2E7D32",safety:"#4527A0",management:"#00695C"};
      var tasks = [
        {id:"drilling",    label:"Drilling / Fill and Compact", color:COLORS.drilling,    totalManHours:0, allocatedCost:0, unit:"piles",   crewSize:0, dailyTarget:""},
        {id:"piledriving", label:"Pile Driving",                color:COLORS.piledriving,  totalManHours:Math.round(r.pileTotalManHours||0),  allocatedCost:Math.round(r.pileScopeTotal||0),   unit:"piles",   crewSize:r.pileTotalStaff||0,   dailyTarget:Math.round(r.pilesPerDayPerMachine||0)+" piles/day"},
        {id:"postcaps",    label:"Post Caps / Bearings",        color:COLORS.postcaps,     totalManHours:Math.round((r.rackingManHours||0)*0.25), allocatedCost:Math.round((r.rackingScopeTotal||0)*0.25), unit:"LF", crewSize:0, dailyTarget:""},
        {id:"torquetube",  label:"Torque Tube Installation",    color:COLORS.torquetube,   totalManHours:Math.round((r.rackingManHours||0)*0.35), allocatedCost:Math.round((r.rackingScopeTotal||0)*0.35), unit:"LF", crewSize:0, dailyTarget:""},
        {id:"modrails",    label:"Modrails / Purlins",          color:COLORS.modrails,     totalManHours:Math.round((r.rackingManHours||0)*0.40), allocatedCost:Math.round((r.rackingScopeTotal||0)*0.40), unit:"LF", crewSize:0, dailyTarget:""},
        {id:"modules",     label:"Module Installation",         color:COLORS.modules,      totalManHours:Math.round(r.moduleManHours||0),   allocatedCost:Math.round(r.moduleScopeTotal||0),  unit:"modules", crewSize:p.moduleTotalWorkers||0, dailyTarget:Math.round((r.moduleCount||0)/(r.moduleDaysToComplete||1))+" modules/day"},
        {id:"pilepull",    label:"Pile Pull Testing",           color:COLORS.pilepull,     totalManHours:0, allocatedCost:0, unit:"piles", crewSize:0, dailyTarget:""},
        {id:"qc",          label:"Quality Control",             color:COLORS.qc,           totalManHours:Math.round(r.qcManHours||0),       allocatedCost:Math.round(r.qcScopeTotal||0),     unit:"units",   crewSize:p.qcNumMen||0, dailyTarget:""},
        {id:"safety",      label:"Safety Coordinator",          color:COLORS.safety,       totalManHours:0, allocatedCost:0, unit:"", crewSize:0, dailyTarget:""},
        {id:"management",  label:"Management",                  color:COLORS.management,   totalManHours:0, allocatedCost:Math.round(r.mgmtTotalCost||0), unit:"", crewSize:(p.mgmtSuperQty||0)+(p.mgmtForemanQty||0)+(p.mgmtSafetyQty||0), dailyTarget:""},
      ];
      var frProject = {
        id: frId,
        name: p.projectName,
        company: p.clientName || "",
        author: p.clientContact || "",
        color: "#1565C0",
        numBlocks: 1,
        logo: null,
        tasks: tasks,
        ownerId: "precon-sync",
        members: [],
        createdAt: new Date().toISOString(),
        startDate: p.bidDate || null,
        endDate: null,
        totalBid: Math.round(r.preBondTotal || 0),
        totalCost: Math.round(r.subtotalCost || 0),
        projectedProfit: Math.round((r.preBondTotal||0) - (r.subtotalCost||0)),
        profitMargin: r.preBondTotal ? Math.round(((r.preBondTotal - r.subtotalCost) / r.preBondTotal) * 1000) / 10 : 0,
        totalManHours: Math.round(r.totalManHoursAll || 0),
        peakManpower: Math.max(r.pileTotalStaff||0, p.rackingTotalWorkers||0, p.moduleTotalWorkers||0),
        workingDays: Math.round(r.totalWorkDays || 0),
        totalRackingLF: Math.round(r.linearFeetRacking || 0),
        kpis: {
          pilesPerDay: Math.round(r.pilesPerDayPerMachine || 0),
          rackingLFPerDay: r.rackingDaysToComplete ? Math.round(r.linearFeetRacking / r.rackingDaysToComplete) : 0,
          modulesPerDay: r.moduleDaysToComplete ? Math.round(r.moduleCount / r.moduleDaysToComplete) : 0,
          apprenticeshipHours: Math.round(r.totalApprenticeHours || 0),
          apprenticeshipPercent: Math.round((r.apprenticePct || 0) * 100),
        },
        fromPreCon: true,
        bidId: bid.id,
        systemSizeMW: p.systemSizeMW || 0,
        location: p.projectLocation || "",
      };
      // Also create scope config for KPI tracker
      var scopeCfg = {
        contractValue: Math.round(r.preBondTotal || 0),
        baselineCost: Math.round(r.subtotalCost || 0),
        laborRate: Math.round((r.generalLaborDayRate || 0) / (p.workHoursPerDay || 10) * 100) / 100,
        scopes: [
          {id:'survey',costCode:'01-200',label:'Survey & Layout',unit:'piles',taskIds:['drilling'],color:'#C0392B',plannedQty:0,planDays:0,planRate:0,crewSize:0,budgetCost:0,planHours:0},
          {id:'mathandling',costCode:'02-100',label:'Material Handling',unit:'piles',taskIds:[],color:'#8D6E63',plannedQty:r.totalPiles||0,planDays:r.matHandlWorkDays||0,planRate:0,crewSize:p.matHandlCrewSize||0,budgetCost:Math.round(r.matHandlScopeTotal||0),planHours:Math.round(r.matHandlManHours||0)},
          {id:'piledriving',costCode:'03-100',label:'Pile Driving',unit:'piles',taskIds:['piledriving'],color:'#1565C0',plannedQty:r.totalPiles||0,planDays:r.pileDaysToComplete||0,planRate:Math.round(r.pilesPerDayPerMachine||0),crewSize:r.pileTotalStaff||0,budgetCost:Math.round(r.pileScopeTotal||0),planHours:Math.round(r.pileTotalManHours||0)},
          {id:'racking',costCode:'04-100',label:'Racking Installation',unit:'LF',taskIds:['postcaps','torquetube','modrails'],color:'#7B1FA2',plannedQty:Math.round(r.linearFeetRacking||0),planDays:r.rackingDaysToComplete||0,planRate:r.rackingDaysToComplete?Math.round(r.linearFeetRacking/r.rackingDaysToComplete):0,crewSize:p.rackingTotalWorkers||0,budgetCost:Math.round(r.rackingScopeTotal||0),planHours:Math.round(r.rackingManHours||0)},
          {id:'modules',costCode:'05-100',label:'Module Installation',unit:'modules',taskIds:['modules'],color:'#00838F',plannedQty:r.moduleCount||0,planDays:r.moduleDaysToComplete||0,planRate:r.moduleDaysToComplete?Math.round(r.moduleCount/r.moduleDaysToComplete):0,crewSize:p.moduleTotalWorkers||0,budgetCost:Math.round(r.moduleScopeTotal||0),planHours:Math.round(r.moduleManHours||0)},
          {id:'qaqc',costCode:'06-100',label:'QA/QC & Remediation',unit:'units',taskIds:['qc','pilepull'],color:'#2E7D32',plannedQty:0,planDays:r.qcWorkdays||0,planRate:0,crewSize:p.qcNumMen||0,budgetCost:Math.round(r.qcScopeTotal||0),planHours:Math.round(r.qcManHours||0)},
          {id:'equipment',costCode:'07-100',label:'Equipment Rental & Fuel',unit:'$',taskIds:[],color:'#E65100',plannedQty:0,planDays:0,planRate:0,crewSize:0,budgetCost:Math.round((r.pileEquipRental||0)+(r.rackingEquipRental||0)+(r.moduleEquipRental||0)+(r.matHandlEquipRental||0)),planHours:0},
          {id:'sitemgmt',costCode:'08-100',label:'Site Management',unit:'$',taskIds:['management','safety'],color:'#00695C',plannedQty:0,planDays:0,planRate:0,crewSize:(p.mgmtSuperQty||0)+(p.mgmtForemanQty||0)+(p.mgmtSafetyQty||0),budgetCost:Math.round(r.mgmtTotalCost||0),planHours:0},
          {id:'genconditions',costCode:'09-100',label:'General Conditions',unit:'$',taskIds:[],color:'#455A64',plannedQty:0,planDays:0,planRate:0,crewSize:0,budgetCost:Math.round(r.gcTotalCost||0),planHours:0},
        ]
      };
      if (existing) {
        // Update existing — preserve entries, notes, etc. Only update bid-derived fields
        var idx = frProjects.indexOf(existing);
        frProjects[idx] = Object.assign({}, existing, {
          name: frProject.name, company: frProject.company, author: frProject.author,
          tasks: tasks, totalBid: frProject.totalBid, totalCost: frProject.totalCost,
          projectedProfit: frProject.projectedProfit, profitMargin: frProject.profitMargin,
          totalManHours: frProject.totalManHours, peakManpower: frProject.peakManpower,
          workingDays: frProject.workingDays, totalRackingLF: frProject.totalRackingLF,
          kpis: frProject.kpis, systemSizeMW: frProject.systemSizeMW, location: frProject.location,
          startDate: frProject.startDate || existing.startDate,
        });
        changed = true;
      } else {
        frProjects.push(frProject);
        changed = true;
      }
      localStorage.setItem("cron_scope_" + frId, JSON.stringify(scopeCfg));
    });
    if (changed) {
      localStorage.setItem("cron_projects", JSON.stringify(frProjects));
    }
  } catch(e) { console.error("Bid→FR sync error:", e); }
}
function syncBidsToCompliance(bids) {
  try {
    var compProjects = JSON.parse(localStorage.getItem("compliance_projects") || "[]");
    var changed = false;
    bids.forEach(function(bid) {
      var p = bid.params || {};
      if (!p.projectName || bid.archived) return;
      var compId = "comp-bid-" + bid.id;
      var existing = compProjects.find(function(cp) { return cp.id === compId; });
      var scopes = [];
      if ((p.rackingPiles || 0) + (p.inverterPiles || 0) > 0) scopes.push('Pile Driving');
      if ((p.rackingTotalWorkers || 0) > 0) scopes.push('Racking Installation');
      if ((p.moduleCount || 0) > 0) scopes.push('Module Installation');
      scopes.push('Material Handling', 'QA/QC', 'Site Management');
      if (!existing) {
        compProjects.push({ id: compId, name: p.projectName, bidId: bid.id, state: '', county: '', location: p.projectLocation || '', scopes: scopes, systemSizeMW: p.systemSizeMW || 0, contracts: [], createdAt: new Date().toISOString() });
        changed = true;
      } else if (existing.name !== p.projectName || existing.systemSizeMW !== (p.systemSizeMW || 0)) {
        existing.name = p.projectName;
        existing.scopes = scopes;
        existing.systemSizeMW = p.systemSizeMW || 0;
        if (!existing.location && p.projectLocation) existing.location = p.projectLocation;
        changed = true;
      }
    });
    if (changed) localStorage.setItem("compliance_projects", JSON.stringify(compProjects));
  } catch(e) { console.error("Bid→Compliance sync error:", e); }
}
async function loadClients() {
  try { const res = await sGet("precon_clients"); return res || []; } catch(e) { return []; }
}
async function saveClients(clients) {
  try { await sSet("precon_clients", clients); } catch (e) { console.error(e); }
}

// ═══════════════════════════════════════════════════════════════════════
//  FORMATTERS
// ═══════════════════════════════════════════════════════════════════════
const bdFmt = v => "$" + Number(v||0).toLocaleString("en-US", {minimumFractionDigits:2, maximumFractionDigits:2});
const bdFmtK = v => {const n=Number(v||0); return n>=1000000?"$"+(n/1000000).toFixed(2)+"M":n>=1000?"$"+(n/1000).toFixed(1)+"K":bdFmt(n);};
const bdFmtN = (v,d=0) => Number(v||0).toLocaleString("en-US",{minimumFractionDigits:d,maximumFractionDigits:d});
const bdFmtPct = v => (Number(v||0)*100).toFixed(1)+"%";

// ═══════════════════════════════════════════════════════════════════════
//  MICRO-COMPONENTS
// ═══════════════════════════════════════════════════════════════════════

function Field({label,value,onChange,type="number",step,min,suffix,prefix,disabled,options,wide}) {
  if (options) return (
    <div className={`fld ${wide?"wide":""}`}><label>{label}</label>
      <select value={value} onChange={e=>onChange(e.target.value)}>{options.map(o=><option key={o} value={o}>{o}</option>)}</select>
    </div>
  );
  if (type==="checkbox") return (
    <div className="fld chk"><label><input type="checkbox" checked={value} onChange={e=>onChange(e.target.checked)} disabled={disabled}/><span>{label}</span></label></div>
  );
  return (
    <div className={`fld ${wide?"wide":""}`}><label>{label}</label>
      <div className="inp-w">
        {prefix&&<span className="fx">{prefix}</span>}
        <input type={type} value={value} onChange={e=>onChange(type==="number"?parseFloat(e.target.value)||0:e.target.value)} step={step||(type==="number"?"any":undefined)} min={min} disabled={disabled}/>
        {suffix&&<span className="fx">{suffix}</span>}
      </div>
    </div>
  );
}

function Row({label,value,sub,hl,warn}) {
  return <div className={`rrow${hl?" hl":""}${warn?" warn":""}${sub?" sub":""}`}><span className="rl">{label}</span><span className="rv">{value}</span></div>;
}

function Card({title,children,accent,className=""}) {
  return <div className={`card ${className}`} style={accent?{borderTopColor:accent}:{}}><h3>{title}</h3>{children}</div>;
}

// ═══════════════════════════════════════════════════════════════════════
//  STATUS CONFIG
// ═══════════════════════════════════════════════════════════════════════
const STATUSES = {
  "Draft":     {color:"#6b7a90",bg:"#161c28",icon:"✎"},
  "Submitted": {color:"#4a9eff",bg:"#0f1e35",icon:"↗"},
  "Awarded":   {color:"#4ae68a",bg:"#0f2a1c",icon:"✓"},
  "Lost":      {color:"#ff6b6b",bg:"#2a1010",icon:"✗"},
  "Revision":  {color:"#f5a623",bg:"#2a1f0a",icon:"⟳"},
};

// ═══════════════════════════════════════════════════════════════════════
//  BID EDITOR — full calculator
// ═══════════════════════════════════════════════════════════════════════
const BD_TABS = [
  {id:"overview",label:"Project"},
  {id:"rates",label:"Rates"},
  {id:"pile",label:"Piles"},
  {id:"racking",label:"Racking"},
  {id:"modules",label:"Modules"},
  {id:"qaqc",label:"QA/QC"},
  {id:"gc",label:"GC & Mgmt"},
  {id:"summary",label:"Summary"},
];

function BidEditor({project, onSave, onBack, onExit}) {
  const [params, setParams] = useState(project.params);
  const [tab, setTab] = useState("overview");
  const [dirty, setDirty] = useState(false);

  const set = useCallback((k,v)=>{setParams(p=>({...p,[k]:v}));setDirty(true);},[]);
  const r = useMemo(()=>computeAll(params),[params]);

  const handleSave = ()=>{
    onSave({...project, params, lastModified: Date.now(), totalPrice: r.preBondTotal, systemMW: params.systemSizeMW, dollarPerWatt: r.dollarPerWatt});
    setDirty(false);
  };

  return (
    <div className="editor">
      <div className="ed-top">
        <button className="btn-back" onClick={onBack}>← Projects</button>
        <div className="ed-title">
          <h2>{params.projectName || "Untitled Bid"}</h2>
          <span className="ed-mw">{params.systemSizeMW} MW DC</span>
        </div>
        <div className="ed-actions">
          <BidExportButtons bid={params} computed={r}/>
          <div className="ed-price">{bdFmt(r.preBondTotal)}</div>
          <button className={`btn-save ${dirty?"pulse":""}`} onClick={handleSave}>{dirty?"Save Changes":"Saved ✓"}</button>
        </div>
      </div>

      <div className="tabs">
        {BD_TABS.map(t=><button key={t.id} className={tab===t.id?"active":""} onClick={()=>setTab(t.id)}>{t.label}</button>)}
      </div>

      <div className="ed-body">
        {tab==="overview" && <>
          <div className="g2">
            <Card title="Project Details">
              <Field label="Project Name" value={params.projectName} onChange={v=>set("projectName",v)} type="text" wide/>
              <Field label="Project Location" value={params.projectLocation} onChange={v=>set("projectLocation",v)} type="text" wide/>
              <Field label="Client Name" value={params.clientName} onChange={v=>set("clientName",v)} type="text" wide/>
              <Field label="Client Contact" value={params.clientContact} onChange={v=>set("clientContact",v)} type="text" wide/>
              <Field label="Bid Date" value={params.bidDate} onChange={v=>set("bidDate",v)} type="date" wide/>
              <Field label="System Size" value={params.systemSizeMW} onChange={v=>set("systemSizeMW",v)} suffix="MW DC" step={0.01}/>
              <Field label="Miles from HQ" value={params.milesFromHQ} onChange={v=>set("milesFromHQ",v)} suffix="mi"/>
              <Field label="Status" value={params.status} onChange={v=>set("status",v)} options={Object.keys(STATUSES)}/>
            </Card>
            <Card title="Work Schedule & Labor">
              <Field label="Workdays / Week" value={params.workdaysInWeek} onChange={v=>set("workdaysInWeek",v)} min={1}/>
              <Field label="Hours / Day" value={params.workHoursPerDay} onChange={v=>set("workHoursPerDay",v)} min={1}/>
              <Field label="Wage Type" value={params.wageType} onChange={v=>set("wageType",v)} options={["Union","Prevailing Wage"]}/>
              <Field label="PW Multiplier" value={params.pwMultiplier} onChange={v=>set("pwMultiplier",v)} step={0.1}/>
              <Field label="Apprentice Req %" value={params.apprenticeReqPct} onChange={v=>set("apprenticeReqPct",v)} step={0.01}/>
              <Field label="Per Diem" value={params.perDiem} onChange={v=>set("perDiem",v)} prefix="$" suffix="/day"/>
              <Field label="Per Diem Distribution" value={params.perDiemPct} onChange={v=>set("perDiemPct",v)} step={0.01}/>
              <Field label="Include Hotel/Per Diem?" value={params.includeHotelPerDiem} onChange={v=>set("includeHotelPerDiem",v)} type="checkbox"/>
            </Card>
          </div>
          <Card title="Calculated Overview">
            <div className="g4">
              <div className="stat-box"><div className="stat-val">{bdFmtN(r.totalCalendarDays)}</div><div className="stat-lbl">Calendar Days</div></div>
              <div className="stat-box"><div className="stat-val">{bdFmtN(r.totalWorkDays)}</div><div className="stat-lbl">Work Days</div></div>
              <div className="stat-box"><div className="stat-val">{bdFmtN(r.totalManHoursAll)}</div><div className="stat-lbl">Man-Hours</div></div>
              <div className="stat-box"><div className="stat-val">{bdFmtN(r.manHoursPerMW,0)}</div><div className="stat-lbl">Man-Hr/MW</div></div>
              <div className="stat-box"><div className="stat-val">{bdFmtPct(r.apprenticePct)}</div><div className="stat-lbl">Apprentice %</div></div>
              <div className={`stat-box ${r.apprenticeMet?"met":"unmet"}`}><div className="stat-val">{r.apprenticeMet?"✓ MET":"✗ NOT MET"}</div><div className="stat-lbl">IRA Req</div></div>
            </div>
          </Card>
        </>}

        {tab==="rates" && <div className="g2">
          <Card title="Base Hourly Rates">
            <Field label="Admin" value={params.adminRate} onChange={v=>set("adminRate",v)} prefix="$" suffix="/hr"/>
            <Field label="General Labor" value={params.generalLaborRate} onChange={v=>set("generalLaborRate",v)} prefix="$" suffix="/hr"/>
            <Field label="GL Fringe" value={params.generalLaborFringe} onChange={v=>set("generalLaborFringe",v)} prefix="$" suffix="/hr"/>
            <Field label="Telehandler Op" value={params.telehandlerOpRate} onChange={v=>set("telehandlerOpRate",v)} prefix="$" suffix="/hr"/>
            <Field label="Tele Fringe" value={params.telehandlerOpFringe} onChange={v=>set("telehandlerOpFringe",v)} prefix="$" suffix="/hr"/>
            <Field label="Pile Driver Op" value={params.pileDriverOpRate} onChange={v=>set("pileDriverOpRate",v)} prefix="$" suffix="/hr"/>
            <Field label="PD Fringe" value={params.pileDriverOpFringe} onChange={v=>set("pileDriverOpFringe",v)} prefix="$" suffix="/hr"/>
            <Field label="Skid Steer Op" value={params.skidSteerOpRate} onChange={v=>set("skidSteerOpRate",v)} prefix="$" suffix="/hr"/>
            <Field label="Skid Fringe" value={params.skidSteerOpFringe} onChange={v=>set("skidSteerOpFringe",v)} prefix="$" suffix="/hr"/>
            <hr className="div"/>
            <Row label="Payroll Tax Total" value={bdFmtPct(r.payrollTaxPct)} hl/>
          </Card>
          <Card title="Computed Day Rates & Equipment">
            <Row label="Admin/day" value={bdFmt(r.adminDayRate)}/>
            <Row label="General Labor/day" value={bdFmt(r.generalLaborDayRate)}/>
            <Row label="Telehandler Op/day" value={bdFmt(r.telehandlerOpDayRate)}/>
            <Row label="Pile Driver Op/day" value={bdFmt(r.pileDriverOpDayRate)}/>
            <Row label="Skid Steer Op/day" value={bdFmt(r.skidSteerOpDayRate)}/>
            <hr className="div"/>
            <Field label="PD Equipment" value={params.pileDriverEquipDaily} onChange={v=>set("pileDriverEquipDaily",v)} prefix="$" suffix="/day"/>
            <Field label="Skid Steer" value={params.skidSteerEquipDaily} onChange={v=>set("skidSteerEquipDaily",v)} prefix="$" suffix="/day"/>
            <Field label="Telehandler" value={params.telehandlerEquipDaily} onChange={v=>set("telehandlerEquipDaily",v)} prefix="$" suffix="/day"/>
            <Field label="Company Truck" value={params.companyTruckEquipDaily} onChange={v=>set("companyTruckEquipDaily",v)} prefix="$" suffix="/day"/>
            <hr className="div"/>
            <Field label="Diesel $/gal" value={params.dieselPerGallon} onChange={v=>set("dieselPerGallon",v)} prefix="$"/>
            <Field label="Fuel Efficiency" value={params.fuelEfficiency} onChange={v=>set("fuelEfficiency",v)} step={0.05}/>
          </Card>
        </div>}

        {tab==="pile" && <div className="g2">
          <Card title="Pile Counts & Production">
            <Field label="Racking Piles" value={params.rackingPiles} onChange={v=>set("rackingPiles",v)}/>
            <Field label="Inverter Piles" value={params.inverterPiles} onChange={v=>set("inverterPiles",v)}/>
            <Field label="CAB Piles" value={params.cabPiles} onChange={v=>set("cabPiles",v)}/>
            <Field label="Combiner Box Piles" value={params.combinerBoxPiles} onChange={v=>set("combinerBoxPiles",v)}/>
            <Field label="Load Break Piles" value={params.loadBreakPiles} onChange={v=>set("loadBreakPiles",v)}/>
            <hr className="div"/>
            <Field label="Drive Time (min)" value={params.estDriveTime} onChange={v=>set("estDriveTime",v)}/>
            <Field label="Transition Time (min)" value={params.estTransitionTime} onChange={v=>set("estTransitionTime",v)}/>
            <Field label="Efficiency" value={params.pileEfficiency} onChange={v=>set("pileEfficiency",v)} step={0.1}/>
            <Field label="# Pile Drivers" value={params.numExcavators} onChange={v=>set("numExcavators",v)}/>
            <hr className="div"/>
            <Field label="Skid Steer Ops" value={params.pileSkidSteerOps} onChange={v=>set("pileSkidSteerOps",v)}/>
            <Field label="Ground Men" value={params.pileGroundMan} onChange={v=>set("pileGroundMan",v)}/>
            <Field label="Addl Laborers" value={params.pileAdditionalLaborers} onChange={v=>set("pileAdditionalLaborers",v)}/>
          </Card>
          <Card title="Pile Results">
            <Row label="Total Piles" value={bdFmtN(r.totalPiles)} hl/>
            <Row label="Manhours Needed" value={bdFmtN(r.pileManhours)}/>
            <Row label="Adjusted Manhours" value={bdFmtN(r.pileAdjustedManhours)}/>
            <Row label="Days to Complete" value={bdFmtN(r.pileDaysToComplete)}/>
            <Row label="Calendar Days" value={bdFmtN(r.pileCalendarDays)}/>
            <Row label="Piles/Day" value={bdFmtN(r.pilesPerDayPerMachine,1)}/>
            <hr className="div"/>
            <Row label="Labor" value={bdFmt(r.pileLaborCost)} sub/>
            <Row label="Per Diem" value={bdFmt(r.pilePerDiemCost)} sub/>
            <Row label="Equipment" value={bdFmt(r.pileEquipRental)} sub/>
            <Row label="Fuel" value={bdFmt(r.pileFuelCost)} sub/>
            <Row label="Pile Total" value={bdFmt(r.pileScopeTotal)} hl/>
            <Row label="$/Pile" value={bdFmt(r.pileScopeTotal/r.totalPiles)}/>
            <Row label="$/Wdc" value={"$"+(r.pileScopeTotal/r.systemWDC).toFixed(4)}/>
          </Card>
        </div>}

        {tab==="racking" && <div className="g2">
          <Card title="Racking Parameters">
            <Field label="Calculate by Modules?" value={params.calculateByModules} onChange={v=>set("calculateByModules",v)} type="checkbox"/>
            <Field label="Module Count" value={params.moduleCount} onChange={v=>set("moduleCount",v)}/>
            <Field label="Module Width (in)" value={params.moduleWidth} onChange={v=>set("moduleWidth",v)} step={0.01} suffix="in"/>
            {!params.calculateByModules&&<Field label="Manual LF" value={params.manualLinearFeet} onChange={v=>set("manualLinearFeet",v)}/>}
            <hr className="div"/>
            <Field label="LF/Hr/Man" value={params.rackingLfPerHourPerMan} onChange={v=>set("rackingLfPerHourPerMan",v)}/>
            <Field label="Efficiency" value={params.rackingEfficiency} onChange={v=>set("rackingEfficiency",v)} step={0.1}/>
            <Field label="Total Workers" value={params.rackingTotalWorkers} onChange={v=>set("rackingTotalWorkers",v)}/>
            <hr className="div"/>
            <Field label="GL Journeymen" value={params.rackingGeneralLabor} onChange={v=>set("rackingGeneralLabor",v)}/>
            <Field label="GL Apprentice" value={params.rackingGeneralLaborApp} onChange={v=>set("rackingGeneralLaborApp",v)}/>
            <Field label="Telehandler Ops" value={params.rackingTelehandlerOps} onChange={v=>set("rackingTelehandlerOps",v)}/>
            <Field label="Skid Steer Ops" value={params.rackingSkidSteerOps} onChange={v=>set("rackingSkidSteerOps",v)}/>
          </Card>
          <Card title="Racking Results">
            <Row label="Linear Feet" value={bdFmtN(r.linearFeetRacking)} hl/>
            <Row label="Manhours" value={bdFmtN(r.rackingManhours)}/>
            <Row label="Days to Complete" value={bdFmtN(r.rackingDaysToComplete)}/>
            <Row label="Calendar Days" value={bdFmtN(r.rackingCalendarDays)}/>
            <Row label="Man-Hours" value={bdFmtN(r.rackingManHours)}/>
            <Row label="LF/Day" value={bdFmtN(r.linearFeetRacking/r.rackingDaysToComplete,0)}/>
            <hr className="div"/>
            <Row label="Labor" value={bdFmt(r.rackingLaborCost)} sub/>
            <Row label="Per Diem" value={bdFmt(r.rackingPerDiemCost)} sub/>
            <Row label="Equipment" value={bdFmt(r.rackingEquipRental)} sub/>
            <Row label="Fuel" value={bdFmt(r.rackingFuelCost)} sub/>
            <Row label="Racking Total" value={bdFmt(r.rackingScopeTotal)} hl/>
            <Row label="$/LF" value={bdFmt(r.rackingScopeTotal/r.linearFeetRacking)}/>
            <Row label="$/Wdc" value={"$"+(r.rackingScopeTotal/r.systemWDC).toFixed(4)}/>
          </Card>
        </div>}

        {tab==="modules" && <div className="g2">
          <Card title="Module Parameters">
            <Row label="Module Count" value={bdFmtN(r.moduleCount)} hl/>
            <Field label="Modules/Hr/Man" value={params.modulesPerHourPerMan} onChange={v=>set("modulesPerHourPerMan",v)}/>
            <Field label="Efficiency" value={params.moduleEfficiency} onChange={v=>set("moduleEfficiency",v)} step={0.1}/>
            <Field label="Total Workers" value={params.moduleTotalWorkers} onChange={v=>set("moduleTotalWorkers",v)}/>
            <hr className="div"/>
            <Field label="GL Journeymen" value={params.moduleGeneralLabor} onChange={v=>set("moduleGeneralLabor",v)}/>
            <Field label="GL Apprentice" value={params.moduleGeneralLaborApp} onChange={v=>set("moduleGeneralLaborApp",v)}/>
            <Field label="Skid Steer Ops" value={params.moduleSkidSteerOps} onChange={v=>set("moduleSkidSteerOps",v)}/>
          </Card>
          <Card title="Module Results">
            <Row label="Manhours" value={bdFmtN(r.moduleManhours)}/>
            <Row label="Days to Complete" value={bdFmtN(r.moduleDaysToComplete)}/>
            <Row label="Calendar Days" value={bdFmtN(r.moduleCalendarDays)}/>
            <Row label="Man-Hours" value={bdFmtN(r.moduleManHours)}/>
            <Row label="Modules/Day" value={bdFmtN(r.moduleCount/r.moduleDaysToComplete,0)}/>
            <hr className="div"/>
            <Row label="Labor" value={bdFmt(r.moduleLaborCost)} sub/>
            <Row label="Per Diem" value={bdFmt(r.modulePerDiemCost)} sub/>
            <Row label="Equipment" value={bdFmt(r.moduleEquipRental)} sub/>
            <Row label="Fuel" value={bdFmt(r.moduleFuelCost)} sub/>
            <Row label="Module Total" value={bdFmt(r.moduleScopeTotal)} hl/>
            <Row label="$/Module" value={bdFmt(r.moduleScopeTotal/r.moduleCount)}/>
          </Card>
        </div>}

        {tab==="qaqc" && <div className="g2">
          <Card title="QA/QC Multipliers">
            <Field label="Pile Mult" value={params.qcPileMultiplier} onChange={v=>set("qcPileMultiplier",v)} step={0.001}/>
            <Field label="Rack Mult" value={params.qcRackMultiplier} onChange={v=>set("qcRackMultiplier",v)} step={0.001}/>
            <Field label="Module Mult" value={params.qcModuleMultiplier} onChange={v=>set("qcModuleMultiplier",v)} step={0.001}/>
            <Field label="QC Staff" value={params.qcNumMen} onChange={v=>set("qcNumMen",v)}/>
            <Field label="Apprentices" value={params.qcApprentices} onChange={v=>set("qcApprentices",v)}/>
          </Card>
          <Card title="QA/QC Results">
            <Row label="Pile QC Hrs" value={bdFmtN(r.qcPileHours)} sub/>
            <Row label="Rack QC Hrs" value={bdFmtN(r.qcRackingHours)} sub/>
            <Row label="Module QC Hrs" value={bdFmtN(r.qcModuleHours)} sub/>
            <Row label="Total QC Hours" value={bdFmtN(r.qcTotalHours)} hl/>
            <Row label="Work Days" value={bdFmtN(r.qcWorkdays)}/>
            <Row label="Man-Hours" value={bdFmtN(r.qcManHours)}/>
            <hr className="div"/>
            <Row label="Labor" value={bdFmt(r.qcLaborCost)} sub/>
            <Row label="Per Diem" value={bdFmt(r.qcPerDiemCost)} sub/>
            <Row label="QA/QC Total" value={bdFmt(r.qcScopeTotal)} hl/>
          </Card>
        </div>}

        {tab==="gc" && <>
          <div className="g2">
            <Card title="General Conditions">
              <Field label="Carts/UTV Rate" value={params.gcCartsRate} onChange={v=>set("gcCartsRate",v)} prefix="$" suffix="/day"/>
              <Field label="Carts Qty" value={params.gcCartsQty} onChange={v=>set("gcCartsQty",v)}/>
              <Field label="Maintenance $/mo" value={params.gcMaintenanceRate} onChange={v=>set("gcMaintenanceRate",v)} prefix="$"/>
              <Field label="Sanitary Rate" value={params.gcSanitaryRate} onChange={v=>set("gcSanitaryRate",v)} prefix="$"/>
              <Field label="Sanitary Qty" value={params.gcSanitaryQty} onChange={v=>set("gcSanitaryQty",v)}/>
              <Field label="Safety $/man-hr" value={params.gcSafetyRate} onChange={v=>set("gcSafetyRate",v)} prefix="$"/>
              <Field label="Site Office $/mo" value={params.gcSiteOfficeRate} onChange={v=>set("gcSiteOfficeRate",v)} prefix="$"/>
              <Field label="Small Tools $/hr" value={params.gcSmallToolsRate} onChange={v=>set("gcSmallToolsRate",v)} prefix="$"/>
              <Field label="Pile Survey $/pile" value={params.gcPileSurveyRate} onChange={v=>set("gcPileSurveyRate",v)} prefix="$"/>
              <Field label="Payroll $/person" value={params.gcPayrollRate} onChange={v=>set("gcPayrollRate",v)} prefix="$"/>
              <Field label="Payroll # ppl" value={params.gcPayrollQty} onChange={v=>set("gcPayrollQty",v)}/>
              <hr className="div"/>
              <Row label="GC Total" value={bdFmt(r.gcTotalCost)} hl/>
            </Card>
            <Card title="Management">
              <Field label="Burden Mult" value={params.mgmtBurdenMultiplier} onChange={v=>set("mgmtBurdenMultiplier",v)} step={0.1}/>
              <Field label="Mgmt Per Diem" value={params.mgmtPerDiem} onChange={v=>set("mgmtPerDiem",v)} prefix="$"/>
              <Field label="% On Site" value={params.mgmtPctOnSite} onChange={v=>set("mgmtPctOnSite",v)} step={0.01}/>
              <hr className="div"/>
              <Field label="Super Rate" value={params.mgmtSuperRate} onChange={v=>set("mgmtSuperRate",v)} prefix="$"/>
              <Field label="Super Qty" value={params.mgmtSuperQty} onChange={v=>set("mgmtSuperQty",v)}/>
              <Field label="Foreman Rate" value={params.mgmtForemanRate} onChange={v=>set("mgmtForemanRate",v)} prefix="$"/>
              <Field label="Foreman Qty" value={params.mgmtForemanQty} onChange={v=>set("mgmtForemanQty",v)}/>
              <Field label="Safety Rate" value={params.mgmtSafetyRate} onChange={v=>set("mgmtSafetyRate",v)} prefix="$"/>
              <Field label="Safety Qty" value={params.mgmtSafetyQty} onChange={v=>set("mgmtSafetyQty",v)}/>
              <hr className="div"/>
              <Row label="Mgmt Total" value={bdFmt(r.mgmtTotalCost)} hl/>
            </Card>
          </div>
          <div className="g2">
            <Card title="Mobilization">
              <Field label="Truck Rate" value={params.mobCompanyTruckRate} onChange={v=>set("mobCompanyTruckRate",v)} prefix="$" suffix="/mi"/>
              <Field label="Trailer Rate" value={params.mobTrailerRate} onChange={v=>set("mobTrailerRate",v)} prefix="$" suffix="/mi"/>
              <Field label="Rental Equip Rate" value={params.mobRentalEquipRate} onChange={v=>set("mobRentalEquipRate",v)} prefix="$"/>
              <Field label="Rental Equip Qty" value={params.mobRentalEquipQty} onChange={v=>set("mobRentalEquipQty",v)}/>
              <Field label="Extra Mobs" value={params.mobExtraMobs} onChange={v=>set("mobExtraMobs",v)}/>
              <Row label="Mob Total" value={bdFmt(r.mobTotalCost)} hl/>
            </Card>
            <Card title="Waste Management">
              <Field label="Dumpster Qty" value={params.wasteDumpsterQty} onChange={v=>set("wasteDumpsterQty",v)}/>
              <Field label="Emptied/Mo" value={params.wasteDumpsterEmptied} onChange={v=>set("wasteDumpsterEmptied",v)}/>
              <Field label="Rate" value={params.wasteDumpsterRate} onChange={v=>set("wasteDumpsterRate",v)} prefix="$"/>
              <Row label="Waste Total" value={bdFmt(r.wasteTotal)} hl/>
            </Card>
          </div>
        </>}

        {tab==="summary" && <>
          <div className="hero">
            <div className="hero-label">TOTAL BID PRICE</div>
            <div className="hero-big">{bdFmt(r.preBondTotal)}</div>
            <div className="hero-sub">{(r.dollarPerWatt*100).toFixed(2)}¢/Wdc &nbsp;·&nbsp; {params.systemSizeMW} MW DC</div>
            <div className="hero-bond">With {bdFmtPct(params.bondPct)} Bond: <strong>{bdFmt(r.postBondTotal)}</strong> ({(r.dollarPerWattWithBond*100).toFixed(2)}¢/Wdc)</div>
            {(()=>{
              const sc=[
                {l:"Piles",v:r.pileScopeTotal,c:"#4a7cff"},{l:"Racking",v:r.rackingScopeTotal,c:"#4ae68a"},
                {l:"Modules",v:r.moduleScopeTotal,c:"#f5a623"},{l:"QA/QC",v:r.qcScopeTotal,c:"#e04a7a"},
                {l:"Mat Handl",v:r.matHandlScopeTotal,c:"#9b59b6"},{l:"GC",v:r.gcTotalCost,c:"#3498db"},
                {l:"Mgmt",v:r.mgmtTotalCost,c:"#1abc9c"},{l:"Mob",v:r.mobTotalCost,c:"#e67e22"},
                {l:"Waste",v:r.wasteTotal,c:"#95a5a6"},
              ];
              const tot=sc.reduce((s,x)=>s+x.v,0);
              return <>
                <div className="scope-bar">{sc.map(s=><div key={s.l} style={{width:`${(s.v/tot)*100}%`,background:s.c}}/>)}</div>
                <div className="scope-leg">{sc.map(s=><span key={s.l}><i style={{background:s.c}}/>{s.l} {bdFmtPct(s.v/tot)}</span>)}</div>
              </>;
            })()}
          </div>
          <div className="g2">
            <Card title="Cost Breakdown">
              <Row label="General Conditions" value={bdFmt(r.gcTotalCost)}/>
              <Row label="Management" value={bdFmt(r.mgmtTotalCost)}/>
              <Row label="Mobilization" value={bdFmt(r.mobTotalCost)}/>
              <Row label="Waste Management" value={bdFmt(r.wasteTotal)}/>
              <Row label="Material Handling" value={bdFmt(r.matHandlScopeTotal)}/>
              <Row label="Pile Driving" value={bdFmt(r.pileScopeTotal)}/>
              <Row label="QA/QC" value={bdFmt(r.qcScopeTotal)}/>
              <Row label="Racking" value={bdFmt(r.rackingScopeTotal)}/>
              <Row label="Modules" value={bdFmt(r.moduleScopeTotal)}/>
              <hr className="div"/>
              <Row label="Subtotal" value={bdFmt(r.subtotalCost)} hl/>
            </Card>
            <Card title="Financials">
              <Field label="Contingency %" value={params.contingencyPct} onChange={v=>set("contingencyPct",v)} step={0.01}/>
              <Row label="Contingency" value={bdFmt(r.contingencyAmt)} sub/>
              <Row label="Sub + Contingency" value={bdFmt(r.subtotalWithContingency)}/>
              <hr className="div"/>
              <Field label="Markup %" value={params.markupPct} onChange={v=>set("markupPct",v)} step={0.01}/>
              <Row label="Markup" value={bdFmt(r.markupAmt)} sub/>
              <Row label="Pre-Bond Total" value={bdFmt(r.preBondTotal)} hl/>
              <hr className="div"/>
              <Field label="Bond %" value={params.bondPct} onChange={v=>set("bondPct",v)} step={0.01}/>
              <Row label="Bond" value={bdFmt(r.bondAmt)} sub/>
              <Row label="Post-Bond Total" value={bdFmt(r.postBondTotal)} hl/>
              <hr className="div"/>
              <Row label="$/Wdc Pre-Bond" value={"$"+r.dollarPerWatt.toFixed(4)}/>
              <Row label="$/Wdc Post-Bond" value={"$"+r.dollarPerWattWithBond.toFixed(4)}/>
              <Row label="Total Fuel Cost" value={bdFmt(r.totalFuelCost)}/>
            </Card>
          </div>
        </>}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
//  DASHBOARD
// ═══════════════════════════════════════════════════════════════════════

function Dashboard({projects, clients, view, onOpen, onCreate, onDuplicate, onDelete, onArchive, onExit}) {
  // Filter by view
  const filtered = useMemo(()=>{
    if(view==='archived') return projects.filter(p=>p.archived);
    if(view && view.startsWith('client:')){
      const cid = view.slice(7);
      const cli = (clients||[]).find(c=>c.id===cid);
      const name = (cli&&cli.name||'').trim().toLowerCase();
      return projects.filter(p=>!p.archived && (p.params.clientName||'').trim().toLowerCase()===name);
    }
    return projects.filter(p=>!p.archived);
  },[projects, view, clients]);

  const totals = useMemo(()=>{
    let totalVal=0,totalMW=0,awarded=0,active=0;
    filtered.forEach(p=>{
      const r=computeAll(p.params);
      totalVal+=r.preBondTotal; totalMW+=p.params.systemSizeMW;
      if(p.params.status==="Awarded")awarded++;
      if(p.params.status!=="Lost")active++;
    });
    return {totalVal,totalMW,awarded,active,total:filtered.length};
  },[filtered]);

  let viewLabel = 'Active Bids', viewSub = 'Currently in pipeline';
  if(view==='archived'){ viewLabel='Archived Bids'; viewSub='Hidden from main dashboard'; }
  else if(view && view.startsWith('client:')){
    const cli = (clients||[]).find(c=>c.id===view.slice(7));
    viewLabel = cli?cli.name:'Client'; viewSub = 'Client portfolio';
  }

  const isArchivedView = view==='archived';

  return (
    <div className="dash">
      <div className="dash-head">
        <div>
          <div className="dash-eyebrow">Mechanical Bid Dashboard</div>
          <h1>{viewLabel}</h1>
          <p className="dash-sub">{viewSub}</p>
        </div>
        <button className="btn-new" onClick={onCreate}>+ New Bid</button>
      </div>

      {filtered.length > 0 && (
        <div className="dash-stats">
          <div className="ds"><div className="ds-v">{totals.total}</div><div className="ds-l">{isArchivedView?'Archived':'Total'} Bids</div></div>
          <div className="ds"><div className="ds-v">{totals.active}</div><div className="ds-l">Active</div></div>
          <div className="ds"><div className="ds-v">{totals.awarded}</div><div className="ds-l">Awarded</div></div>
          <div className="ds"><div className="ds-v">{bdFmtN(totals.totalMW,1)} MW</div><div className="ds-l">Capacity</div></div>
          <div className="ds accent"><div className="ds-v">{bdFmtK(totals.totalVal)}</div><div className="ds-l">Pipeline Value</div></div>
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">{isArchivedView?'▢':'⚡'}</div>
          <h2>{isArchivedView?'No archived bids':(view&&view.startsWith('client:'))?'No bids for this client yet':'No bids yet'}</h2>
          <p>{isArchivedView?'Archived bids appear here. Use the ▢ button on a bid to archive it.':(view&&view.startsWith('client:'))?'Create a bid and set the client name to match this portfolio.':'Create your first mechanical bid to get started.'}</p>
          {!isArchivedView && <button className="btn-new lg" onClick={onCreate}>+ {(view&&view.startsWith('client:'))?'New Bid':'Create First Bid'}</button>}
        </div>
      ) : (
        <div className="proj-grid">
          {filtered.sort((a,b)=>(b.lastModified||0)-(a.lastModified||0)).map(proj=>{
            const r = computeAll(proj.params);
            const st = STATUSES[proj.params.status]||STATUSES.Draft;
            return (
              <div className={"proj-card"+(proj.archived?' archived':'')} key={proj.id} onClick={()=>onOpen(proj.id)}>
                <div className="pc-top">
                  <div className="pc-status" style={{color:st.color,background:st.bg}}>{st.icon} {proj.params.status}</div>
                  <div className="pc-actions" onClick={e=>e.stopPropagation()}>
                    <button title="Duplicate" onClick={()=>onDuplicate(proj.id)}>⧉</button>
                    <button title={proj.archived?'Unarchive':'Archive'} className="arch" onClick={()=>onArchive(proj.id)}>{proj.archived?'↩':'▢'}</button>
                    <button title="Delete" className="del" onClick={()=>onDelete(proj.id)}>✕</button>
                  </div>
                </div>
                <h3 className="pc-name">{proj.params.projectName||"Untitled"}</h3>
                <div className="pc-loc">{proj.params.projectLocation||"No location"}</div>
                <div className="pc-client">{proj.params.clientName||"Unassigned client"}</div>
                <div className="pc-metrics">
                  <div><span className="pc-mv">{proj.params.systemSizeMW}</span><span className="pc-ml">MW</span></div>
                  <div><span className="pc-mv">{bdFmtN(r.totalPiles)}</span><span className="pc-ml">Piles</span></div>
                  <div><span className="pc-mv">{bdFmtN(r.totalWorkDays)}</span><span className="pc-ml">Days</span></div>
                </div>
                <div className="pc-price">{bdFmt(r.preBondTotal)}</div>
                <div className="pc-watt">{(r.dollarPerWatt*100).toFixed(2)}¢/Wdc</div>
                {proj.lastModified && <div className="pc-date">Updated {new Date(proj.lastModified).toLocaleDateString()}</div>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
//  SIDEBAR
// ═══════════════════════════════════════════════════════════════════════

function PreConSidebar({onExit, onCreate, view, setView, recent, clients, archivedCount, newClientName, setNewClientName, createClient, deleteClient, onOpen}){
  return (
    <aside className="precon-side">
      <div className="ps-top">
        <button className="ps-back" onClick={onExit} title="Back to Portal">← Portal</button>
        <div className="ps-brand">
          <div className="ps-brand-t">PreCon</div>
          <div className="ps-brand-s">Mechanical Bids</div>
        </div>
      </div>
      <button className="ps-newbid" onClick={onCreate}>+ New Bid</button>

      <div className="ps-section">
        <div className="ps-h">Views</div>
        <button className={"ps-link"+(view==='active'?' on':'')} onClick={()=>setView('active')}>
          <span className="ps-ico">▦</span><span className="ps-link-name">Active Bids</span>
        </button>
        <button className={"ps-link"+(view==='archived'?' on':'')} onClick={()=>setView('archived')}>
          <span className="ps-ico">▢</span><span className="ps-link-name">Archived</span><span className="ps-count">{archivedCount}</span>
        </button>
      </div>

      <div className="ps-section">
        <div className="ps-h">Recent Projects</div>
        {recent.length===0 && <div className="ps-empty">No projects yet</div>}
        {recent.map(p=>(
          <button key={p.id} className="ps-link sm" onClick={()=>onOpen(p.id)} title={p.params.projectName||'Untitled'}>
            <span className="ps-ico">·</span>
            <span className="ps-link-col">
              <span className="ps-link-name">{p.params.projectName||'Untitled'}</span>
              {p.params.clientName && <span className="ps-link-sub">{p.params.clientName}</span>}
            </span>
          </button>
        ))}
      </div>

      <div className="ps-section">
        <div className="ps-h">Client Portfolios</div>
        {clients.length===0 && <div className="ps-empty">Add a client below</div>}
        {clients.map(c=>(
          <div key={c.id} className={"ps-cli"+(view==='client:'+c.id?' on':'')}>
            <button className="ps-link" onClick={()=>setView('client:'+c.id)} title={c.name}>
              <span className="ps-ico">◆</span><span className="ps-link-name">{c.name}</span><span className="ps-count">{c.count}</span>
            </button>
            <button className="ps-del" title="Remove client" onClick={()=>{ if(window.confirm('Remove client "'+c.name+'"? Bids stay but lose the link.')) deleteClient(c.id); }}>✕</button>
          </div>
        ))}
        <div className="ps-addcli">
          <input placeholder="New client name" value={newClientName} onChange={e=>setNewClientName(e.target.value)} onKeyDown={e=>e.key==='Enter'&&createClient()}/>
          <button onClick={createClient} title="Add client">+</button>
        </div>
      </div>
    </aside>
  );
}

// ═══════════════════════════════════════════════════════════════════════
//  MAIN APP
// ═══════════════════════════════════════════════════════════════════════

function PreConControls({onExit, portalUser}){
  const [projects, setProjects] = useState([]);
  const [clients, setClients] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [view, setView] = useState('active'); // 'active' | 'archived' | 'client:<id>'
  const [newClientName, setNewClientName] = useState('');

  useEffect(()=>{
    Promise.all([loadProjects(), loadClients()]).then(([p,c])=>{setProjects(p);setClients(c);setLoading(false);});
  },[]);
  useEffect(()=>{if(!loading)saveProjects(projects);},[projects,loading]);
  useEffect(()=>{if(!loading)saveClients(clients);},[clients,loading]);

  const createProject = ()=>{
    const id = "bid_"+Date.now()+"_"+Math.random().toString(36).slice(2,6);
    const newP = {id, params:{...DEFAULTS, projectName:"New Bid "+(projects.length+1), bidDate:new Date().toISOString().split("T")[0]}, lastModified:Date.now(), totalPrice:0, archived:false};
    setProjects(p=>[...p,newP]);
    setActiveId(id);
    setView('active');
  };

  const saveProject = (updated)=>{
    setProjects(ps=>ps.map(p=>p.id===updated.id?updated:p));
  };

  const duplicateProject = (id)=>{
    const src = projects.find(p=>p.id===id);
    if(!src)return;
    const newId = "bid_"+Date.now()+"_"+Math.random().toString(36).slice(2,6);
    const dup = {...src, id:newId, params:{...src.params, projectName:src.params.projectName+" (Copy)", status:"Draft"}, lastModified:Date.now(), archived:false};
    setProjects(p=>[...p,dup]);
  };

  const deleteProject = (id)=>{
    setProjects(ps=>ps.filter(p=>p.id!==id));
    setConfirmDelete(null);
    if(activeId===id) setActiveId(null);
  };

  const archiveProject = (id)=>{
    setProjects(ps=>ps.map(p=>p.id===id?{...p,archived:!p.archived,lastModified:Date.now()}:p));
  };

  const createClient = ()=>{
    const name = (newClientName||"").trim();
    if(!name) return;
    if(clients.some(c=>c.name.toLowerCase()===name.toLowerCase())){ setNewClientName(''); return; }
    const id = 'cli_'+Date.now()+'_'+Math.random().toString(36).slice(2,6);
    setClients(c=>[...c,{id,name,createdAt:Date.now()}]);
    setNewClientName('');
  };

  const deleteClient = (id)=>{
    setClients(c=>c.filter(x=>x.id!==id));
    if(view==='client:'+id) setView('active');
  };

  const activeProject = projects.find(p=>p.id===activeId);
  const recentProjects = projects.filter(p=>!p.archived).sort((a,b)=>(b.lastModified||0)-(a.lastModified||0)).slice(0,5);
  const clientCounts = clients.map(c=>({...c,count:projects.filter(p=>!p.archived && (p.params.clientName||'').trim().toLowerCase()===c.name.toLowerCase()).length}));
  const archivedCount = projects.filter(p=>p.archived).length;

  if(loading) return <div className="app" style={{position:"fixed",inset:0,zIndex:2000}}><div className="loading">Loading bids…</div></div>;

  return (
    <div className="app precon-app" style={{position:"fixed",inset:0,zIndex:2000,overflow:"hidden"}}>
      <style>{`
@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600&display=swap');
*{margin:0;padding:0;box-sizing:border-box;}
.app{font-family:'Barlow Condensed',sans-serif;background:#f5f4f0;color:#333;min-height:100vh;}
.loading{display:flex;align-items:center;justify-content:center;height:100vh;font-size:16px;color:#888;}

/* DASHBOARD */
.dash{max-width:1200px;margin:0 auto;padding:20px;}
.dash-head{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:24px;flex-wrap:wrap;gap:12px;}
.dash-head h1{font-family:'Bebas Neue',sans-serif;font-size:28px;font-weight:400;color:#1a1a2e;letter-spacing:2px;text-transform:uppercase;}
.dash-sub{font-size:13px;color:#888;margin-top:2px;letter-spacing:1px;}
.btn-new{font-family:'Barlow Condensed',sans-serif;font-size:14px;font-weight:700;padding:10px 20px;border:none;border-radius:4px;background:#F97316;color:#fff;cursor:pointer;transition:all .2s;letter-spacing:1px;text-transform:uppercase;}
.btn-new:hover{background:#e0650f;box-shadow:0 4px 16px rgba(196,30,46,.25);}
.btn-new.lg{padding:14px 32px;font-size:16px;}

.dash-stats{display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin-bottom:24px;}
@media(max-width:700px){.dash-stats{grid-template-columns:repeat(3,1fr);}}
.ds{background:#fff;border:1px solid #e8e6e0;border-radius:8px;padding:14px;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,.04);}
.ds.accent{border-color:#F97316;background:#fffdf5;}
.ds-v{font-family:'JetBrains Mono',monospace;font-size:18px;font-weight:700;color:#1a1a1a;}
.ds.accent .ds-v{color:#F97316;}
.ds-l{font-size:11px;color:#888;margin-top:2px;text-transform:uppercase;letter-spacing:1px;}

.empty-state{text-align:center;padding:80px 20px;}
.empty-icon{font-size:48px;margin-bottom:16px;}
.empty-state h2{font-size:20px;color:#1a1a1a;margin-bottom:6px;}
.empty-state p{color:#888;margin-bottom:20px;}

.proj-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:14px;}
.proj-card{background:#fff;border:1px solid #e8e6e0;border-radius:10px;padding:18px;cursor:pointer;transition:all .2s;position:relative;box-shadow:0 1px 3px rgba(0,0,0,.04);}
.proj-card:hover{border-color:#F97316;transform:translateY(-2px);box-shadow:0 6px 20px rgba(0,0,0,.08);}
.pc-top{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;}
.pc-status{font-size:11px;font-weight:700;padding:3px 10px;border-radius:20px;letter-spacing:1px;}
.pc-actions{display:flex;gap:4px;}
.pc-actions button{font-size:14px;background:transparent;border:1px solid #e8e6e0;color:#aaa;width:28px;height:28px;border-radius:6px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all .15s;}
.pc-actions button:hover{border-color:#F97316;color:#F97316;}
.pc-actions button.del:hover{border-color:#F97316;color:#F97316;}
.pc-name{font-family:'Bebas Neue',sans-serif;font-size:19px;font-weight:400;color:#1a1a2e;margin-bottom:3px;letter-spacing:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.pc-loc{font-size:12px;color:#888;margin-bottom:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.pc-client{font-size:12px;color:#aaa;margin-bottom:12px;}
.pc-metrics{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:12px;}
.pc-mv{font-family:'JetBrains Mono',monospace;font-size:15px;font-weight:600;color:#333;}
.pc-ml{font-size:10px;color:#aaa;margin-left:4px;text-transform:uppercase;}
.pc-price{font-family:'JetBrains Mono',monospace;font-size:20px;font-weight:700;color:#F97316;}
.pc-watt{font-family:'JetBrains Mono',monospace;font-size:12px;color:#F97316;margin-top:2px;}
.pc-date{font-size:11px;color:#ccc;margin-top:8px;}

/* CONFIRM MODAL */
.modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:999;display:flex;align-items:center;justify-content:center;padding:20px;}
.modal{background:#fff;border:1px solid #e8e6e0;border-radius:12px;padding:28px;max-width:380px;width:100%;text-align:center;box-shadow:0 12px 40px rgba(0,0,0,.15);}
.modal h3{font-size:17px;color:#1a1a1a;margin-bottom:8px;letter-spacing:1px;}
.modal p{font-size:13px;color:#888;margin-bottom:20px;}
.modal-btns{display:flex;gap:10px;justify-content:center;}
.modal-btns button{font-family:'Barlow Condensed',sans-serif;font-size:14px;font-weight:700;padding:9px 20px;border:none;border-radius:6px;cursor:pointer;letter-spacing:1px;}
.btn-cancel{background:#f0ede8;color:#666;}
.btn-danger{background:#F97316;color:#fff;}
.btn-danger:hover{background:#e0650f;}
.btn-exit{font-family:'Barlow Condensed',sans-serif;font-size:12px;font-weight:600;padding:7px 14px;border:1px solid #e0d0d0;border-radius:6px;background:transparent;color:#F97316;cursor:pointer;transition:all .15s;white-space:nowrap;}
.btn-exit:hover{border-color:#F97316;background:#fef5f5;}

/* EDITOR */
.editor{min-height:100vh;}
.ed-top{display:flex;align-items:center;gap:16px;padding:12px 20px;background:#fff;border-bottom:1px solid #e8e6e0;position:sticky;top:0;z-index:100;flex-wrap:wrap;box-shadow:0 1px 3px rgba(0,0,0,.04);}
.btn-back{font-family:'Barlow Condensed',sans-serif;font-size:13px;font-weight:600;padding:7px 14px;border:1px solid #e8e6e0;border-radius:6px;background:transparent;color:#888;cursor:pointer;transition:all .15s;white-space:nowrap;}
.btn-back:hover{border-color:#F97316;color:#1a1a1a;}
.ed-title{flex:1;min-width:120px;}
.ed-title h2{font-family:'Bebas Neue',sans-serif;font-size:20px;font-weight:400;color:#1a1a2e;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;letter-spacing:1px;}
.ed-mw{font-family:'JetBrains Mono',monospace;font-size:12px;color:#888;}
.ed-actions{display:flex;align-items:center;gap:12px;}
.ed-price{font-family:'JetBrains Mono',monospace;font-size:18px;font-weight:700;color:#F97316;}
.btn-save{font-family:'Barlow Condensed',sans-serif;font-size:13px;font-weight:700;padding:8px 16px;border:none;border-radius:6px;background:#f0ede8;color:#888;cursor:pointer;transition:all .15s;white-space:nowrap;letter-spacing:1px;}
.btn-save.pulse{background:#F97316;color:#fff;animation:pulse-glow 2s infinite;}
@keyframes pulse-glow{0%,100%{box-shadow:0 0 0 rgba(196,30,46,0);}50%{box-shadow:0 0 12px rgba(196,30,46,.35);}}

.tabs{display:flex;gap:2px;padding:6px 14px;background:#faf9f6;overflow-x:auto;border-bottom:1px solid #e8e6e0;-ms-overflow-style:none;scrollbar-width:none;}
.tabs::-webkit-scrollbar{display:none;}
.tabs button{font-family:'Barlow Condensed',sans-serif;font-size:13px;font-weight:600;padding:8px 14px;border:none;border-radius:6px;background:transparent;color:#aaa;cursor:pointer;white-space:nowrap;transition:all .15s;letter-spacing:1px;}
.tabs button:hover{color:#666;background:#f0ede8;}
.tabs button.active{color:#1a1a1a;background:#fff;box-shadow:inset 0 -2px 0 #F97316;}

.ed-body{padding:16px;max-width:1100px;margin:0 auto;}
.g2{display:grid;grid-template-columns:1fr 1fr;gap:12px;}
.g4{display:grid;grid-template-columns:repeat(6,1fr);gap:8px;}
@media(max-width:700px){.g2,.g4{grid-template-columns:1fr;}.g4{grid-template-columns:repeat(3,1fr);}}

.card{background:#fff;border:1px solid #e8e6e0;border-top:3px solid #F97316;border-radius:8px;padding:16px;margin-bottom:12px;box-shadow:0 1px 3px rgba(0,0,0,.03);}
.card h3{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;color:#F97316;margin-bottom:12px;}

.stat-box{background:#faf9f6;border:1px solid #e8e6e0;border-radius:8px;padding:10px;text-align:center;}
.stat-box.met{border-color:#2a8a3a;background:#f0faf2;}.stat-box.met .stat-val{color:#1a7a2e;}
.stat-box.unmet{border-color:#F97316;background:#fef5f5;}.stat-box.unmet .stat-val{color:#F97316;}
.stat-val{font-family:'JetBrains Mono',monospace;font-size:16px;font-weight:700;color:#1a1a1a;}
.stat-lbl{font-size:10px;color:#aaa;text-transform:uppercase;letter-spacing:1px;margin-top:2px;}

.fld{margin-bottom:8px;}
.fld label{display:block;font-size:12px;font-weight:600;color:#888;margin-bottom:2px;letter-spacing:.5px;}
.fld.chk label{display:flex;align-items:center;gap:7px;cursor:pointer;font-size:13px;color:#555;}
.fld.chk input[type=checkbox]{width:15px;height:15px;accent-color:#F97316;}
.inp-w{display:flex;align-items:center;background:#faf9f6;border:1px solid #e0ddd6;border-radius:6px;overflow:hidden;transition:border .15s;}
.inp-w:focus-within{border-color:#F97316;}
.inp-w .fx{font-size:11px;color:#bbb;padding:0 7px;font-family:'JetBrains Mono',monospace;}
.inp-w input,select{font-family:'Barlow Condensed',sans-serif;font-size:14px;color:#333;background:transparent;border:none;outline:none;padding:7px 9px;width:100%;}
select{background:#faf9f6;border:1px solid #e0ddd6;border-radius:6px;padding:7px 9px;font-family:'Barlow Condensed',sans-serif;font-size:14px;color:#333;}
input[type=number]::-webkit-inner-spin-button{opacity:.3;}
input[type=date]{color:#333;}
input[type=date]::-webkit-calendar-picker-indicator{filter:none;}

.rrow{display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:1px solid #f0ede8;font-size:14px;}
.rrow.sub{padding-left:12px;}.rrow.sub .rl{color:#ccc;font-size:13px;}
.rrow .rl{color:#888;}.rrow .rv{font-family:'JetBrains Mono',monospace;font-weight:600;color:#444;font-size:13px;}
.rrow.hl{background:#fffdf5;border-radius:6px;padding:7px 10px;margin:3px -10px;border:1px solid #f0e8d0;}.rrow.hl .rl{color:#1a1a1a;font-weight:700;}.rrow.hl .rv{color:#F97316;font-size:14px;}
.rrow.warn .rv{color:#F97316;}
.div{border:none;border-top:1px solid #f0ede8;margin:10px 0;}

.hero{background:#fff;border:1px solid #e8e6e0;border-radius:12px;padding:28px;text-align:center;margin-bottom:16px;box-shadow:0 2px 8px rgba(0,0,0,.04);}
.hero-label{font-size:11px;color:#F97316;text-transform:uppercase;letter-spacing:2px;font-weight:700;}
.hero-big{font-family:'JetBrains Mono',monospace;font-size:34px;font-weight:700;color:#F97316;margin:4px 0;}
.hero-sub{font-family:'JetBrains Mono',monospace;font-size:14px;color:#F97316;margin:2px 0;}
.hero-bond{font-size:12px;color:#aaa;margin-top:10px;}
.hero-bond strong{color:#F97316;}

.scope-bar{display:flex;gap:2px;height:8px;border-radius:4px;overflow:hidden;margin:14px 0 6px;}
.scope-bar div{min-width:3px;transition:width .3s;}
.scope-leg{display:flex;flex-wrap:wrap;gap:6px 10px;justify-content:center;}
.scope-leg span{font-size:10px;color:#888;display:flex;align-items:center;gap:4px;}
.scope-leg i{width:7px;height:7px;border-radius:2px;display:inline-block;}

/* ── PRECON LAYOUT + SIDEBAR ── */
.precon-app{display:flex;flex-direction:column;height:100vh;}
.precon-layout{flex:1;display:flex;min-height:0;}
.precon-side{width:240px;flex-shrink:0;background:#ffffff;color:#1a1a2e;display:flex;flex-direction:column;overflow-y:auto;border-right:1px solid rgba(0,0,0,.08);}
.precon-main{flex:1;min-width:0;overflow:auto;background:#f5f2ee;}
.ps-top{padding:14px 14px 10px;border-bottom:1px solid rgba(0,0,0,.08);}
.ps-back{width:100%;background:#f0ede8;color:#F97316;border:1px solid rgba(0,0,0,.1);border-radius:4px;padding:8px 10px;font-family:'Barlow Condensed',sans-serif;font-size:12px;letter-spacing:1.5px;text-transform:uppercase;cursor:pointer;transition:all .15s;margin-bottom:10px;}
.ps-back:hover{background:#e8e5e0;border-color:#F97316;color:#e0650f;}
.ps-brand-t{font-family:'Bebas Neue',sans-serif;font-size:22px;font-weight:400;color:#1a1a2e;letter-spacing:2px;text-transform:uppercase;line-height:1;}
.ps-brand-s{font-size:10px;color:#888;letter-spacing:1.5px;text-transform:uppercase;margin-top:3px;}
.ps-newbid{margin:14px 14px 0;background:#F97316;color:#fff;border:none;border-radius:4px;padding:11px 12px;font-family:'Barlow Condensed',sans-serif;font-size:13px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;cursor:pointer;transition:all .15s;}
.ps-newbid:hover{background:#e0650f;box-shadow:0 2px 12px rgba(196,30,46,.2);}
.ps-section{padding:18px 0 6px;border-top:1px solid rgba(0,0,0,.08);margin-top:14px;}
.ps-section:first-of-type{border-top:none;margin-top:6px;}
.ps-h{font-size:10px;letter-spacing:2px;text-transform:uppercase;color:#888;font-weight:700;padding:0 14px 6px;}
.ps-link{width:calc(100% - 8px);margin:1px 4px;background:transparent;color:#1a1a2e;border:none;text-align:left;padding:7px 10px;font-family:'Barlow Condensed',sans-serif;font-size:13px;cursor:pointer;border-radius:4px;display:flex;align-items:center;gap:8px;transition:all .12s;letter-spacing:.5px;}
.ps-link:hover{background:#f0ede8;color:#1a1a2e;}
.ps-link.on{background:#f5f2ee;color:#F97316;border-left:2px solid #F97316;padding-left:8px;}
.ps-link.sm{padding:5px 10px;font-size:12px;}
.ps-link-col{display:flex;flex-direction:column;flex:1;min-width:0;}
.ps-link-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.ps-link-sub{font-size:10px;color:#888;letter-spacing:1px;text-transform:uppercase;margin-top:1px;}
.ps-ico{color:#999;width:14px;flex-shrink:0;text-align:center;font-size:12px;}
.ps-link.on .ps-ico{color:#F97316;}
.ps-count{margin-left:auto;background:#f0ede8;color:#888;font-size:10px;padding:1px 7px;border-radius:10px;font-family:'JetBrains Mono',monospace;flex-shrink:0;}
.ps-link.on .ps-count{background:#F97316;color:#fff;}
.ps-empty{padding:4px 14px;font-size:11px;color:#999;font-style:italic;}
.ps-cli{display:flex;align-items:center;}
.ps-cli .ps-link{flex:1;}
.ps-del{background:transparent;border:none;color:#999;font-size:13px;cursor:pointer;padding:4px 10px;border-radius:4px;transition:all .12s;}
.ps-del:hover{color:#F97316;background:#f0ede8;}
.ps-addcli{display:flex;gap:4px;padding:6px 14px 14px;}
.ps-addcli input{flex:1;min-width:0;background:#f9f7f5;border:1px solid rgba(0,0,0,.12);color:#1a1a2e;padding:6px 9px;border-radius:4px;font-size:12px;font-family:'Barlow Condensed',sans-serif;outline:none;}
.ps-addcli input:focus{border-color:#F97316;}
.ps-addcli button{background:#F97316;color:#fff;border:none;border-radius:4px;width:28px;font-size:16px;font-weight:700;cursor:pointer;transition:all .15s;}
.ps-addcli button:hover{background:#e0650f;}

.dash-eyebrow{font-size:11px;color:#F97316;text-transform:uppercase;letter-spacing:3px;font-weight:700;margin-bottom:4px;}
.proj-card .pc-actions button.arch:hover{border-color:#F97316;color:#F97316;}
.proj-card.archived{opacity:.7;background:#fafaf6;}
.proj-card.archived:hover{opacity:1;}

@media(max-width:760px){
  .precon-layout{flex-direction:column;}
  .precon-side{width:100%;height:auto;max-height:42vh;}
}
      `}</style>

      {confirmDelete && (
        <div className="modal-overlay" onClick={()=>setConfirmDelete(null)}>
          <div className="modal" onClick={e=>e.stopPropagation()}>
            <h3>Delete this bid?</h3>
            <p>This action cannot be undone. The bid and all its data will be permanently removed.</p>
            <div className="modal-btns">
              <button className="btn-cancel" onClick={()=>setConfirmDelete(null)}>Cancel</button>
              <button className="btn-danger" onClick={()=>deleteProject(confirmDelete)}>Delete</button>
            </div>
          </div>
        </div>
      )}

      <div className="precon-layout">
        <PreConSidebar
          onExit={onExit}
          onCreate={createProject}
          view={view}
          setView={setView}
          recent={recentProjects}
          clients={clientCounts}
          archivedCount={archivedCount}
          newClientName={newClientName}
          setNewClientName={setNewClientName}
          createClient={createClient}
          deleteClient={deleteClient}
          onOpen={setActiveId}
        />
        <div className="precon-main">
          {activeProject ? (
            <BidEditor
              project={activeProject}
              onSave={saveProject}
              onBack={()=>setActiveId(null)}
              onExit={onExit}
            />
          ) : (
            <Dashboard
              projects={projects}
              clients={clients}
              view={view}
              onOpen={setActiveId}
              onCreate={createProject}
              onDuplicate={duplicateProject}
              onDelete={id=>setConfirmDelete(id)}
              onArchive={archiveProject}
              onExit={onExit}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
//  COMPLIANCE CENTER
// ═══════════════════════════════════════════════════════════════════════
var US_STATES = ['Alabama','Alaska','Arizona','Arkansas','California','Colorado','Connecticut','Delaware','Florida','Georgia','Hawaii','Idaho','Illinois','Indiana','Iowa','Kansas','Kentucky','Louisiana','Maine','Maryland','Massachusetts','Michigan','Minnesota','Mississippi','Missouri','Montana','Nebraska','Nevada','New Hampshire','New Jersey','New Mexico','New York','North Carolina','North Dakota','Ohio','Oklahoma','Oregon','Pennsylvania','Rhode Island','South Carolina','South Dakota','Tennessee','Texas','Utah','Vermont','Virginia','Washington','West Virginia','Wisconsin','Wyoming'];

var COMP_CATEGORIES = {
  Licensing:{color:'#3b82f6',icon:'L'},Permits:{color:'#8b5cf6',icon:'P'},Environmental:{color:'#22c55e',icon:'E'},
  Safety:{color:'#ef4444',icon:'S'},Insurance:{color:'#f97316',icon:'I'},Labor:{color:'#eab308',icon:'W'},
  Utility:{color:'#06b6d4',icon:'U'},Zoning:{color:'#14b8a6',icon:'Z'},Tax:{color:'#f59e0b',icon:'T'},Contractual:{color:'#6366f1',icon:'C'},Other:{color:'#6b7280',icon:'O'}
};

function ComplianceCenter({ onExit }) {
  var [projects, setProjects] = useState([]);
  var [selId, setSelId] = useState(null);
  var [items, setItems] = useState([]);
  var [apiKey, setApiKey] = useState('');
  var [showKey, setShowKey] = useState(false);
  var [generating, setGenerating] = useState(false);
  var [scanning, setScanning] = useState(false);
  var [error, setError] = useState('');
  var [filter, setFilter] = useState('all');
  var [catFilter, setCatFilter] = useState('all');
  var [mob, setMob] = useState(function() { return window.innerWidth < 768; });
  var [sideOpen, setSideOpen] = useState(window.innerWidth >= 768);
  var fileRef = useRef(null);

  useEffect(function() {
    function onResize() { var m = window.innerWidth < 768; setMob(m); if (!m) setSideOpen(true); }
    window.addEventListener('resize', onResize);
    return function() { window.removeEventListener('resize', onResize); };
  }, []);

  var BB = { fontFamily: "'Bebas Neue',sans-serif" };
  var NB = { fontFamily: "'Barlow Condensed',sans-serif" };
  var cardBg = '#ffffff';
  var borderC = 'rgba(0,0,0,.08)';
  var cuid = function() { return 'c' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36); };

  useEffect(function() {
    var envKey = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_ANTHROPIC_KEY) || '';
    var k = ''; try { k = localStorage.getItem('compliance_api_key') || ''; } catch(e) {}
    if (!k && envKey) { k = envKey; localStorage.setItem('compliance_api_key', envKey); }
    setApiKey(k);
    var bids = []; try { bids = JSON.parse(localStorage.getItem('precon_bids') || '[]'); } catch(e) {}
    if (bids.length > 0) syncBidsToCompliance(bids);
    var p = []; try { p = JSON.parse(localStorage.getItem('compliance_projects') || '[]'); } catch(e) {}
    setProjects(p);
    if (p.length > 0 && !selId) setSelId(p[0].id);
  }, []);

  useEffect(function() {
    if (!selId) { setItems([]); return; }
    var it = []; try { it = JSON.parse(localStorage.getItem('compliance_items_' + selId) || '[]'); } catch(e) {}
    setItems(it);
  }, [selId]);

  var proj = projects.find(function(p) { return p.id === selId; });

  function saveProj(updated) {
    setProjects(updated);
    localStorage.setItem('compliance_projects', JSON.stringify(updated));
  }
  function saveItems(pid, updated) {
    setItems(updated);
    localStorage.setItem('compliance_items_' + pid, JSON.stringify(updated));
  }
  function updateField(field, value) {
    if (!proj) return;
    var updated = projects.map(function(p) { return p.id === proj.id ? Object.assign({}, p, { [field]: value }) : p; });
    saveProj(updated);
  }
  function addManualItem() {
    if (!selId) return;
    var ni = { id: cuid(), title: 'New Compliance Item', description: '', category: 'Other', priority: 'medium', status: 'pending', estimatedDays: 0, agency: '', contractRef: '', source: 'manual', notes: '' };
    saveItems(selId, [ni].concat(items));
  }
  function updateItem(itemId, field, value) {
    var updated = items.map(function(it) { return it.id === itemId ? Object.assign({}, it, { [field]: value }) : it; });
    saveItems(selId, updated);
  }
  function deleteItem(itemId) {
    saveItems(selId, items.filter(function(it) { return it.id !== itemId; }));
  }
  function toggleStatus(itemId) {
    var it = items.find(function(i) { return i.id === itemId; });
    if (!it) return;
    var next = it.status === 'pending' ? 'in-progress' : it.status === 'in-progress' ? 'complete' : 'pending';
    updateItem(itemId, 'status', next);
  }

  function saveKey(k) {
    setApiKey(k);
    localStorage.setItem('compliance_api_key', k);
  }

  var CLAUDE_MODELS = ['claude-3-5-sonnet-20241022', 'claude-sonnet-4-20250514'];
  async function callClaude(messages, sysPrompt) {
    if (!apiKey) { setShowKey(true); throw new Error('API key required'); }
    var lastErr = '';
    for (var mi = 0; mi < CLAUDE_MODELS.length; mi++) {
      var mdl = CLAUDE_MODELS[mi];
      console.log('[Compliance] Calling Claude API with model:', mdl);
      var payload = { model: mdl, max_tokens: 8192, messages: messages };
      if (sysPrompt) payload.system = sysPrompt;
      try {
        var res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
          body: JSON.stringify(payload)
        });
        console.log('[Compliance] API response status:', res.status);
        if (!res.ok) { var e = await res.text(); console.error('[Compliance] API error (' + mdl + '):', e.slice(0, 500)); lastErr = 'API ' + res.status + ': ' + e.slice(0, 200); continue; }
        var data = await res.json();
        if (data.content && data.content[0] && data.content[0].text) {
          console.log('[Compliance] Success with', mdl, 'length:', data.content[0].text.length);
          return data.content[0].text;
        }
        lastErr = 'Empty response from ' + mdl; continue;
      } catch(fetchErr) { lastErr = fetchErr.message; console.error('[Compliance] Fetch error (' + mdl + '):', fetchErr); continue; }
    }
    throw new Error(lastErr || 'All models failed');
  }

  function parseJSON(text) {
    try { return JSON.parse(text); } catch(e) {}
    var m = text.match(/\[[\s\S]*\]/);
    if (m) try { return JSON.parse(m[0]); } catch(e) {}
    return [];
  }

  async function generateChecklist() {
    if (!proj) return;
    if (!proj.state) { setError('Set the project state before generating.'); return; }
    setGenerating(true); setError('');
    try {
      var sysMsg = 'You are a professional solar construction compliance consultant. Your role is to produce structured JSON checklists of permits, licenses, and regulatory requirements for utility-scale solar energy projects in the United States. Respond with only valid JSON arrays.';
      var prompt = 'Generate a compliance checklist for this solar construction project.\n\n' +
        'Project: ' + proj.name + '\nState: ' + proj.state + '\nCounty: ' + (proj.county || 'Not specified') + '\nCity/Location: ' + (proj.location || 'Not specified') + '\nSystem Size: ' + (proj.systemSizeMW || 0) + ' MW DC\nScope of Work: ' + (proj.scopes || []).join(', ') + '\n\n' +
        'Return a JSON array of compliance items. Each object needs:\n- "title": concise name (under 80 chars)\n- "description": what is required and how to fulfill it\n- "category": one of "Licensing", "Permits", "Environmental", "Safety", "Insurance", "Labor", "Utility", "Zoning", "Tax", "Contractual"\n- "priority": "critical", "high", "medium", or "low"\n- "estimatedDays": business days to complete\n- "agency": relevant authority\n\n' +
        'Be specific to ' + proj.state + (proj.county ? ', ' + proj.county : '') + '. Include federal (OSHA, EPA, NEPA, FAA, DOT, ITC/PTC), state (contractor licensing, interconnection, prevailing wage, bonding, siting permits, workers comp, tax incentives, fire code), and local/county (building permits, electrical permits, zoning, grading, stormwater, road use, business license) requirements.\n\nReturn ONLY the JSON array, no other text.';
      var text = await callClaude([{ role: 'user', content: prompt }], sysMsg);
      var parsed = parseJSON(text);
      var newItems = parsed.map(function(it) {
        return { id: cuid(), title: it.title || '', description: it.description || '', category: it.category || 'Other', priority: it.priority || 'medium', status: 'pending', estimatedDays: it.estimatedDays || 0, agency: it.agency || '', contractRef: '', source: 'ai', notes: '' };
      });
      var kept = items.filter(function(i) { return i.source !== 'ai'; });
      saveItems(selId, kept.concat(newItems));
    } catch(e) { console.error('[Compliance] Generate error:', e); setError(String(e.message || e)); }
    setGenerating(false);
  }

  async function handleContractUpload(e) {
    var file = e.target.files && e.target.files[0];
    if (!file) return;
    if (!apiKey) { setShowKey(true); return; }
    setScanning(true); setError('');
    try {
      var content = [];
      if (file.type === 'application/pdf' || file.name.endsWith('.pdf')) {
        var buf = await file.arrayBuffer();
        var b64 = btoa(new Uint8Array(buf).reduce(function(d, b) { return d + String.fromCharCode(b); }, ''));
        content = [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } }, { type: 'text', text: 'You are a solar construction compliance expert. Analyze this contract and extract ALL compliance obligations, requirements, certifications, insurance minimums, reporting requirements, deadlines, and conditions the contractor must fulfill.\n\nReturn a JSON array of items. Each must have:\n- "title": concise title\n- "description": the specific obligation\n- "category": one of "Licensing","Permits","Environmental","Safety","Insurance","Labor","Utility","Zoning","Tax","Contractual"\n- "priority": "critical","high","medium","low"\n- "contractRef": relevant section/clause\n\nReturn ONLY the JSON array.' }];
      } else if (file.type.startsWith('image/')) {
        var ibuf = await file.arrayBuffer();
        var ib64 = btoa(new Uint8Array(ibuf).reduce(function(d, b) { return d + String.fromCharCode(b); }, ''));
        content = [{ type: 'image', source: { type: 'base64', media_type: file.type, data: ib64 } }, { type: 'text', text: 'You are a solar construction compliance expert. Analyze this contract document image and extract ALL compliance obligations, requirements, certifications, insurance minimums, and conditions.\n\nReturn a JSON array of items. Each must have: "title", "description", "category" (Licensing/Permits/Environmental/Safety/Insurance/Labor/Utility/Zoning/Tax/Contractual), "priority" (critical/high/medium/low), "contractRef".\n\nReturn ONLY the JSON array.' }];
      } else {
        var txt = await file.text();
        content = [{ type: 'text', text: 'You are a solar construction compliance expert. Analyze the following contract text and extract ALL compliance obligations, requirements, certifications, insurance minimums, reporting requirements, and conditions.\n\nContract text:\n' + txt.slice(0, 80000) + '\n\nReturn a JSON array of items. Each must have: "title", "description", "category" (Licensing/Permits/Environmental/Safety/Insurance/Labor/Utility/Zoning/Tax/Contractual), "priority" (critical/high/medium/low), "contractRef".\n\nReturn ONLY the JSON array.' }];
      }
      var text = await callClaude([{ role: 'user', content: content }], 'You are a professional solar construction compliance consultant. Analyze contracts and extract regulatory obligations as structured JSON arrays.');
      var parsed = parseJSON(text);
      var newItems = parsed.map(function(it) {
        return { id: cuid(), title: it.title || '', description: it.description || '', category: it.category || 'Contractual', priority: it.priority || 'medium', status: 'pending', estimatedDays: 0, agency: '', contractRef: it.contractRef || '', source: 'contract', notes: 'From: ' + file.name };
      });
      var contracts = (proj.contracts || []).concat([{ id: cuid(), name: file.name, date: new Date().toISOString(), size: file.size, itemCount: newItems.length }]);
      updateField('contracts', contracts);
      saveItems(selId, items.concat(newItems));
    } catch(e) { setError(e.message); }
    setScanning(false);
    if (fileRef.current) fileRef.current.value = '';
  }

  var filtered = items.filter(function(it) {
    if (filter !== 'all' && it.status !== filter) return false;
    if (catFilter !== 'all' && it.category !== catFilter) return false;
    return true;
  });
  var grouped = {};
  filtered.forEach(function(it) { if (!grouped[it.category]) grouped[it.category] = []; grouped[it.category].push(it); });
  var totalItems = items.length;
  var doneItems = items.filter(function(i) { return i.status === 'complete'; }).length;
  var criticalPending = items.filter(function(i) { return i.priority === 'critical' && i.status !== 'complete'; }).length;

  var IST = { width: '100%', background: '#f9f7f5', border: '1px solid rgba(0,0,0,.12)', color: '#1a1a2e', padding: '10px 14px', fontFamily: "'Barlow',sans-serif", fontSize: 14, outline: 'none', borderRadius: 0, WebkitAppearance: 'none' };
  var priColors = { critical: '#ef4444', high: '#f97316', medium: '#eab308', low: '#6b7280' };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 2000, background: '#f5f2ee', display: 'flex', fontFamily: "'Barlow',sans-serif" }}>
      <input type="file" ref={fileRef} style={{ display: 'none' }} accept=".pdf,.txt,.doc,.docx,.png,.jpg,.jpeg" onChange={handleContractUpload} />

      {/* SIDEBAR */}
      <div style={{ width: mob ? (sideOpen ? '100%' : 0) : 280, flexShrink: 0, background: '#ffffff', borderRight: '1px solid ' + borderC, display: 'flex', flexDirection: 'column', overflow: 'hidden', transition: 'width .2s' }}>
        <div style={{ padding: '20px 16px 12px' }}>
          <div onClick={onExit} style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6, ...NB, fontSize: 11, letterSpacing: '2px', textTransform: 'uppercase', color: '#F97316', marginBottom: 12 }}>← Dashboard</div>
          <div style={{ ...BB, fontSize: 22, letterSpacing: 2, color: '#1a1a2e' }}>COMPLIANCE CENTER</div>
        </div>
        <div style={{ padding: '0 16px 12px' }}>
          <div onClick={function() { setShowKey(!showKey); }} style={{ cursor: 'pointer', ...NB, fontSize: 11, letterSpacing: '1px', color: apiKey ? '#22c55e' : '#ef4444', display: 'flex', alignItems: 'center', gap: 6 }}>
            {apiKey ? '● AI Connected' : '○ Set API Key'} <ChevronDown size={12} style={{ transform: showKey ? 'rotate(180deg)' : '', transition: '.2s' }} />
          </div>
          {showKey && <div style={{ marginTop: 8 }}>
            <input type="password" value={apiKey} onChange={function(e) { saveKey(e.target.value); }} placeholder="Anthropic API Key" style={{ ...IST, fontSize: 12, padding: '8px 10px' }} />
            <div style={{ ...NB, fontSize: 10, color: '#666', marginTop: 4 }}>Used for AI checklist generation & contract scanning</div>
          </div>}
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '0 8px 16px' }}>
          {projects.map(function(p) {
            var pItems = []; try { pItems = JSON.parse(localStorage.getItem('compliance_items_' + p.id) || '[]'); } catch(e) {}
            var done = pItems.filter(function(i) { return i.status === 'complete'; }).length;
            var total = pItems.length;
            var active = p.id === selId;
            return <div key={p.id} onClick={function() { setSelId(p.id); if (mob) setSideOpen(false); }} style={{ padding: '12px 12px', cursor: 'pointer', background: active ? 'rgba(249,115,22,.1)' : 'transparent', borderLeft: active ? '3px solid #F97316' : '3px solid transparent', marginBottom: 2, transition: 'all .15s' }}>
              <div style={{ ...NB, fontSize: 14, fontWeight: 600, color: active ? '#1a1a2e' : '#888', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</div>
              <div style={{ ...NB, fontSize: 11, color: '#666', marginTop: 2 }}>{p.state || 'No state set'} {total > 0 ? '• ' + done + '/' + total + ' done' : ''}</div>
            </div>;
          })}
          {projects.length === 0 && <div style={{ ...NB, fontSize: 13, color: '#666', padding: 16 }}>No projects yet. Create bids in PreCon to auto-populate.</div>}
        </div>
      </div>

      {/* MAIN CONTENT */}
      <div style={{ flex: 1, overflowY: 'auto', padding: mob ? '16px' : '28px 36px 60px' }}>
        {mob && <div onClick={function() { setSideOpen(true); }} style={{ cursor: 'pointer', ...NB, fontSize: 12, color: '#F97316', marginBottom: 12 }}>☰ Projects</div>}

        {!proj ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh' }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ ...BB, fontSize: 28, color: '#444' }}>SELECT A PROJECT</div>
              <div style={{ ...NB, fontSize: 14, color: '#666', marginTop: 8 }}>Choose a project from the sidebar to manage compliance items</div>
            </div>
          </div>
        ) : (
          <div>
            {/* PROJECT HEADER */}
            <div style={{ marginBottom: 24 }}>
              <div style={{ ...BB, fontSize: mob ? 28 : 36, letterSpacing: 2, color: '#1a1a2e', lineHeight: 1 }}>{proj.name}</div>
              <div style={{ ...NB, fontSize: 12, color: '#666', marginTop: 4 }}>{proj.systemSizeMW} MW • {(proj.scopes || []).join(', ')}</div>
            </div>

            {/* LOCATION FIELDS */}
            <div style={{ display: 'grid', gridTemplateColumns: mob ? '1fr' : '1fr 1fr 1fr', gap: 12, marginBottom: 24 }}>
              <div>
                <div style={{ ...NB, fontSize: 10, letterSpacing: '1.5px', textTransform: 'uppercase', color: '#666', marginBottom: 4 }}>State *</div>
                <select value={proj.state} onChange={function(e) { updateField('state', e.target.value); }} style={{ ...IST }}>
                  <option value="">Select State</option>
                  {US_STATES.map(function(s) { return <option key={s} value={s}>{s}</option>; })}
                </select>
              </div>
              <div>
                <div style={{ ...NB, fontSize: 10, letterSpacing: '1.5px', textTransform: 'uppercase', color: '#666', marginBottom: 4 }}>County</div>
                <input value={proj.county || ''} onChange={function(e) { updateField('county', e.target.value); }} placeholder="e.g. Harris County" style={IST} />
              </div>
              <div>
                <div style={{ ...NB, fontSize: 10, letterSpacing: '1.5px', textTransform: 'uppercase', color: '#666', marginBottom: 4 }}>Location / City</div>
                <input value={proj.location || ''} onChange={function(e) { updateField('location', e.target.value); }} placeholder="e.g. Houston" style={IST} />
              </div>
            </div>

            {/* STATS BAR */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 20 }}>
              <div style={{ background: cardBg, border: '1px solid ' + borderC, padding: '12px 18px', flex: '1 1 120px' }}>
                <div style={{ ...NB, fontSize: 10, color: '#666', textTransform: 'uppercase', letterSpacing: '1px' }}>Total Items</div>
                <div style={{ ...BB, fontSize: 24, color: '#1a1a2e' }}>{totalItems}</div>
              </div>
              <div style={{ background: cardBg, border: '1px solid ' + borderC, padding: '12px 18px', flex: '1 1 120px' }}>
                <div style={{ ...NB, fontSize: 10, color: '#666', textTransform: 'uppercase', letterSpacing: '1px' }}>Completed</div>
                <div style={{ ...BB, fontSize: 24, color: '#22c55e' }}>{doneItems}{totalItems > 0 ? <span style={{ fontSize: 14, color: '#666' }}> / {totalItems}</span> : ''}</div>
              </div>
              <div style={{ background: cardBg, border: '1px solid ' + borderC, padding: '12px 18px', flex: '1 1 120px' }}>
                <div style={{ ...NB, fontSize: 10, color: '#666', textTransform: 'uppercase', letterSpacing: '1px' }}>Critical Pending</div>
                <div style={{ ...BB, fontSize: 24, color: criticalPending > 0 ? '#ef4444' : '#22c55e' }}>{criticalPending}</div>
              </div>
              <div style={{ background: cardBg, border: '1px solid ' + borderC, padding: '12px 18px', flex: '1 1 120px' }}>
                <div style={{ ...NB, fontSize: 10, color: '#666', textTransform: 'uppercase', letterSpacing: '1px' }}>Progress</div>
                <div style={{ ...BB, fontSize: 24, color: '#F97316' }}>{totalItems > 0 ? Math.round(doneItems / totalItems * 100) : 0}%</div>
              </div>
            </div>

            {/* ACTION BUTTONS */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 20 }}>
              <div onClick={generating ? null : generateChecklist} style={{ cursor: generating ? 'wait' : 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 20px', background: generating ? 'rgba(249,115,22,.3)' : '#F97316', color: '#fff', ...NB, fontSize: 13, fontWeight: 600, letterSpacing: '1px', transition: 'all .2s' }}>
                {generating ? <><Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Generating...</> : <><FlaskConical size={14} /> Generate Compliance Checklist</>}
              </div>
              <div onClick={scanning ? null : function() { fileRef.current && fileRef.current.click(); }} style={{ cursor: scanning ? 'wait' : 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 20px', background: 'rgba(99,102,241,.15)', border: '1px solid rgba(99,102,241,.3)', color: '#818cf8', ...NB, fontSize: 13, fontWeight: 600, letterSpacing: '1px' }}>
                {scanning ? <><Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Scanning...</> : <><Upload size={14} /> Upload Contract</>}
              </div>
              <div onClick={addManualItem} style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 20px', background: 'rgba(0,0,0,.03)', border: '1px solid ' + borderC, color: '#666', ...NB, fontSize: 13, letterSpacing: '1px' }}>
                <Plus size={14} /> Add Item
              </div>
            </div>

            {/* ERROR */}
            {error && <div style={{ padding: '10px 16px', background: 'rgba(239,68,68,.1)', border: '1px solid rgba(239,68,68,.3)', color: '#ef4444', ...NB, fontSize: 13, marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              {error} <X size={14} style={{ cursor: 'pointer' }} onClick={function() { setError(''); }} />
            </div>}

            {/* CONTRACTS */}
            {(proj.contracts || []).length > 0 && <div style={{ marginBottom: 20 }}>
              <div style={{ ...NB, fontSize: 11, letterSpacing: '2px', textTransform: 'uppercase', color: '#666', marginBottom: 8 }}>UPLOADED CONTRACTS</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {(proj.contracts || []).map(function(c) {
                  return <div key={c.id} style={{ padding: '6px 12px', background: 'rgba(99,102,241,.08)', border: '1px solid rgba(99,102,241,.2)', ...NB, fontSize: 12, color: '#818cf8', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <FileText size={12} /> {c.name} <span style={{ color: '#666' }}>({c.itemCount || 0} items)</span>
                  </div>;
                })}
              </div>
            </div>}

            {/* FILTERS */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 16, alignItems: 'center' }}>
              <div style={{ ...NB, fontSize: 10, color: '#666', marginRight: 4 }}>STATUS:</div>
              {[['all', 'All'], ['pending', 'Pending'], ['in-progress', 'In Progress'], ['complete', 'Complete']].map(function(f) {
                var active = filter === f[0];
                return <div key={f[0]} onClick={function() { setFilter(f[0]); }} style={{ cursor: 'pointer', padding: '4px 12px', background: active ? 'rgba(249,115,22,.15)' : 'rgba(0,0,0,.02)', border: '1px solid ' + (active ? 'rgba(249,115,22,.3)' : borderC), color: active ? '#F97316' : '#888', ...NB, fontSize: 11 }}>{f[1]}</div>;
              })}
              <div style={{ width: 1, height: 16, background: borderC, margin: '0 4px' }} />
              <div style={{ ...NB, fontSize: 10, color: '#666', marginRight: 4 }}>CATEGORY:</div>
              <select value={catFilter} onChange={function(e) { setCatFilter(e.target.value); }} style={{ ...IST, width: 'auto', padding: '4px 10px', fontSize: 11 }}>
                <option value="all">All Categories</option>
                {Object.keys(COMP_CATEGORIES).map(function(c) { return <option key={c} value={c}>{c}</option>; })}
              </select>
            </div>

            {/* CHECKLIST */}
            {Object.keys(grouped).length === 0 && totalItems === 0 && (
              <div style={{ textAlign: 'center', padding: '60px 20px' }}>
                <div style={{ ...BB, fontSize: 24, color: '#444' }}>NO COMPLIANCE ITEMS</div>
                <div style={{ ...NB, fontSize: 14, color: '#666', marginTop: 8 }}>Set the state and click "Generate Compliance Checklist" to auto-populate requirements using AI, or upload a contract to scan for obligations.</div>
              </div>
            )}
            {Object.keys(grouped).sort().map(function(cat) {
              var catInfo = COMP_CATEGORIES[cat] || COMP_CATEGORIES.Other;
              return <div key={cat} style={{ marginBottom: 20 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <div style={{ width: 22, height: 22, borderRadius: 4, background: catInfo.color, display: 'flex', alignItems: 'center', justifyContent: 'center', ...BB, fontSize: 12, color: '#fff' }}>{catInfo.icon}</div>
                  <div style={{ ...NB, fontSize: 13, fontWeight: 600, letterSpacing: '1.5px', textTransform: 'uppercase', color: catInfo.color }}>{cat}</div>
                  <div style={{ ...NB, fontSize: 11, color: '#666' }}>({grouped[cat].length})</div>
                </div>
                {grouped[cat].map(function(it) {
                  var priC = priColors[it.priority] || '#6b7280';
                  var statusIcon = it.status === 'complete' ? '✓' : it.status === 'in-progress' ? '◐' : '○';
                  var statusColor = it.status === 'complete' ? '#22c55e' : it.status === 'in-progress' ? '#eab308' : '#666';
                  return <div key={it.id} style={{ display: 'flex', gap: 12, padding: '12px 16px', background: cardBg, border: '1px solid ' + borderC, marginBottom: 3 }}>
                    <div onClick={function() { toggleStatus(it.id); }} style={{ cursor: 'pointer', fontSize: 18, color: statusColor, flexShrink: 0, width: 24, textAlign: 'center', lineHeight: '24px', userSelect: 'none' }}>{statusIcon}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <input value={it.title} onChange={function(e) { updateItem(it.id, 'title', e.target.value); }} style={{ background: 'transparent', border: 'none', color: it.status === 'complete' ? '#999' : '#1a1a2e', ...NB, fontSize: 14, fontWeight: 600, flex: 1, minWidth: 120, outline: 'none', textDecoration: it.status === 'complete' ? 'line-through' : 'none' }} />
                        <span style={{ ...NB, fontSize: 10, padding: '2px 8px', background: priC + '22', color: priC, border: '1px solid ' + priC + '44', textTransform: 'uppercase', letterSpacing: '1px', flexShrink: 0 }}>{it.priority}</span>
                        {it.source === 'contract' && <span style={{ ...NB, fontSize: 10, padding: '2px 8px', background: 'rgba(99,102,241,.1)', color: '#818cf8', border: '1px solid rgba(99,102,241,.2)', flexShrink: 0 }}>CONTRACT</span>}
                        {it.source === 'ai' && <span style={{ ...NB, fontSize: 10, padding: '2px 8px', background: 'rgba(249,115,22,.1)', color: '#F97316', border: '1px solid rgba(249,115,22,.2)', flexShrink: 0 }}>AI</span>}
                      </div>
                      <textarea value={it.description} onChange={function(e) { updateItem(it.id, 'description', e.target.value); }} rows={2} style={{ ...IST, marginTop: 6, fontSize: 12, color: '#666', resize: 'vertical', minHeight: 36 }} />
                      <div style={{ display: 'flex', gap: 12, marginTop: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                        {it.agency && <span style={{ ...NB, fontSize: 11, color: '#666' }}>Agency: {it.agency}</span>}
                        {it.contractRef && <span style={{ ...NB, fontSize: 11, color: '#818cf8' }}>Ref: {it.contractRef}</span>}
                        {it.estimatedDays > 0 && <span style={{ ...NB, fontSize: 11, color: '#666' }}>~{it.estimatedDays} business days</span>}
                        <select value={it.priority} onChange={function(e) { updateItem(it.id, 'priority', e.target.value); }} style={{ ...IST, width: 'auto', padding: '2px 8px', fontSize: 11 }}>
                          <option value="critical">Critical</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
                        </select>
                        <select value={it.category} onChange={function(e) { updateItem(it.id, 'category', e.target.value); }} style={{ ...IST, width: 'auto', padding: '2px 8px', fontSize: 11 }}>
                          {Object.keys(COMP_CATEGORIES).map(function(c) { return <option key={c} value={c}>{c}</option>; })}
                        </select>
                        <Trash2 size={12} style={{ cursor: 'pointer', color: '#666', marginLeft: 'auto' }} onClick={function() { deleteItem(it.id); }} />
                      </div>
                    </div>
                  </div>;
                })}
              </div>;
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
//  CRM MODULE
// ═══════════════════════════════════════════════════════════════════════
function CRMModule({ onExit }) {
  const [tab, setTab] = useState('applicants');
  const [applicants, setApplicants] = useState([]);
  const [partners, setPartners] = useState([]);
  const [search, setSearch] = useState('');
  const [mob, setMob] = useState(window.innerWidth < 768);
  const BB = {fontFamily:"'Bebas Neue',sans-serif"};
  const NB = {fontFamily:"'Barlow Condensed',sans-serif"};
  const A = '#F97316';
  const BG='#f5f2ee';const CARD='#ffffff';const TEXT='#1a1a2e';const MID='#666';const DIM='#999';const BORDER='rgba(0,0,0,.08)';
  const STATUSES = ['New','Contacted','In Progress','Closed'];

  useEffect(function(){
    var h = function(){ setMob(window.innerWidth < 768); };
    window.addEventListener('resize', h);
    return function(){ window.removeEventListener('resize', h); };
  },[]);

  useEffect(function(){
    sGet('career_submissions').then(function(d){ setApplicants(d||[]); });
    sGet('contact_submissions').then(function(d){ setPartners(d||[]); });
  },[]);

  function updateStatus(type, id, status) {
    if (type === 'applicant') {
      var updated = applicants.map(function(a){ return a.id===id ? Object.assign({},a,{status:status}) : a; });
      setApplicants(updated);
      sSet('career_submissions', updated);
    } else {
      var updated2 = partners.map(function(p){ return p.id===id ? Object.assign({},p,{status:status}) : p; });
      setPartners(updated2);
      sSet('contact_submissions', updated2);
    }
  }

  var cardStyle = {background:CARD,border:'1px solid '+BORDER,padding:mob?'16px 14px':'20px 24px',boxShadow:'0 1px 4px rgba(0,0,0,.04)'};
  var labelStyle = {...NB,fontSize:10,letterSpacing:'2px',textTransform:'uppercase',color:A,marginBottom:4,display:'block'};

  var filteredApplicants = applicants.filter(function(a){
    if (!search) return true;
    var s = search.toLowerCase();
    return (a.name||'').toLowerCase().indexOf(s)>=0 || (a.email||'').toLowerCase().indexOf(s)>=0 || (a.position||'').toLowerCase().indexOf(s)>=0;
  });

  var filteredPartners = partners.filter(function(p){
    if (!search) return true;
    var s = search.toLowerCase();
    return (p.firstName||'').toLowerCase().indexOf(s)>=0 || (p.lastName||'').toLowerCase().indexOf(s)>=0 || (p.company||'').toLowerCase().indexOf(s)>=0 || (p.email||'').toLowerCase().indexOf(s)>=0;
  });

  return (
    <div style={{minHeight:'100vh',background:BG,color:TEXT,padding:mob?'20px 14px':'40px 48px'}}>
      <div style={{maxWidth:1200,margin:'0 auto'}}>
        <div style={{cursor:'pointer',display:'inline-flex',alignItems:'center',gap:8,...NB,fontSize:12,letterSpacing:'2px',textTransform:'uppercase',color:A,marginBottom:28,transition:'opacity .2s'}} onClick={onExit} onMouseEnter={function(e){e.currentTarget.style.opacity='.7'}} onMouseLeave={function(e){e.currentTarget.style.opacity='1'}}>
          ← Back to Dashboard
        </div>
        <div style={{...BB,fontSize:mob?'clamp(32px,8vw,48px)':'clamp(40px,5vw,64px)',letterSpacing:2,marginBottom:4}}>CRM</div>
        <div style={{...NB,fontSize:13,color:MID,letterSpacing:'1.5px',marginBottom:28}}>Applicant & partner inquiry tracking</div>

        <div style={{display:'flex',gap:0,marginBottom:24,borderBottom:'1px solid '+BORDER}}>
          {[{k:'applicants',l:'Applicants ('+applicants.length+')'},{k:'partners',l:'Partners ('+partners.length+')'}].map(function(t){
            return <button key={t.k} onClick={function(){setTab(t.k);setSearch('')}} style={{padding:mob?'8px 14px':'10px 20px',cursor:'pointer',fontSize:11,letterSpacing:'2px',textTransform:'uppercase',fontWeight:700,transition:'all .2s',background:tab===t.k?A:'transparent',color:tab===t.k?'#fff':MID,border:'none',borderBottom:tab===t.k?'2px solid '+A:'2px solid transparent',...NB}}>{t.l}</button>;
          })}
        </div>

        <div style={{marginBottom:20}}>
          <input value={search} onChange={function(e){setSearch(e.target.value)}} placeholder="Search by name, email, or company..." style={{width:'100%',maxWidth:400,padding:'10px 14px',background:CARD,border:'1px solid '+BORDER,color:TEXT,...NB,fontSize:14,outline:'none'}}/>
        </div>

        {tab==='applicants' && (
          <div>
            {filteredApplicants.length === 0 ? (
              <div style={{textAlign:'center',padding:60,color:DIM}}><div style={{...BB,fontSize:24,marginBottom:8}}>NO APPLICANTS</div><div style={{...NB,fontSize:13}}>Career applications from the landing page will appear here.</div></div>
            ) : (
              <div style={{display:'grid',gap:12}}>
                {filteredApplicants.sort(function(a,b){return new Date(b.submittedAt)-new Date(a.submittedAt)}).map(function(a){
                  var st = a.status || 'New';
                  var stColor = st==='Closed'?DIM:st==='Contacted'?'#3b82f6':st==='In Progress'?'#22c55e':A;
                  return (
                    <div key={a.id} style={cardStyle}>
                      <div style={{display:'flex',justifyContent:'space-between',alignItems:mob?'flex-start':'center',flexDirection:mob?'column':'row',gap:mob?10:0,marginBottom:12}}>
                        <div>
                          <div style={{...BB,fontSize:20,letterSpacing:1}}>{a.name}</div>
                          <div style={{...NB,fontSize:12,color:MID}}>{a.email} {a.phone && '· '+a.phone}</div>
                        </div>
                        <div style={{display:'flex',alignItems:'center',gap:10}}>
                          <span style={{...NB,fontSize:10,letterSpacing:'1px',padding:'4px 10px',background:stColor+'18',color:stColor,fontWeight:600}}>{st.toUpperCase()}</span>
                          <select value={st} onChange={function(e){updateStatus('applicant',a.id,e.target.value)}} style={{...NB,fontSize:11,padding:'4px 8px',background:CARD,border:'1px solid '+BORDER,color:TEXT,cursor:'pointer'}}>
                            {STATUSES.map(function(s){return <option key={s} value={s}>{s}</option>})}
                          </select>
                        </div>
                      </div>
                      <div style={{display:'grid',gridTemplateColumns:mob?'1fr':'1fr 1fr 1fr',gap:10}}>
                        <div><span style={labelStyle}>Position</span><div style={{...NB,fontSize:13}}>{a.position||'—'}</div></div>
                        <div><span style={labelStyle}>Experience</span><div style={{...NB,fontSize:13}}>{a.experience||'—'}</div></div>
                        <div><span style={labelStyle}>Submitted</span><div style={{...NB,fontSize:13}}>{a.submittedAt?new Date(a.submittedAt).toLocaleDateString():' —'}</div></div>
                      </div>
                      {a.message && <div style={{marginTop:10}}><span style={labelStyle}>Message</span><div style={{...NB,fontSize:13,color:MID,lineHeight:1.5}}>{a.message}</div></div>}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {tab==='partners' && (
          <div>
            {filteredPartners.length === 0 ? (
              <div style={{textAlign:'center',padding:60,color:DIM}}><div style={{...BB,fontSize:24,marginBottom:8}}>NO PARTNER INQUIRIES</div><div style={{...NB,fontSize:13}}>Contact form submissions from the landing page will appear here.</div></div>
            ) : (
              <div style={{display:'grid',gap:12}}>
                {filteredPartners.sort(function(a,b){return new Date(b.submittedAt)-new Date(a.submittedAt)}).map(function(p){
                  var st = p.status || 'New';
                  var stColor = st==='Closed'?DIM:st==='Contacted'?'#3b82f6':st==='In Progress'?'#22c55e':A;
                  return (
                    <div key={p.id} style={cardStyle}>
                      <div style={{display:'flex',justifyContent:'space-between',alignItems:mob?'flex-start':'center',flexDirection:mob?'column':'row',gap:mob?10:0,marginBottom:12}}>
                        <div>
                          <div style={{...BB,fontSize:20,letterSpacing:1}}>{(p.firstName||'')+' '+(p.lastName||'')}</div>
                          <div style={{...NB,fontSize:12,color:MID}}>{p.email} {p.company && '· '+p.company}</div>
                        </div>
                        <div style={{display:'flex',alignItems:'center',gap:10}}>
                          <span style={{...NB,fontSize:10,letterSpacing:'1px',padding:'4px 10px',background:stColor+'18',color:stColor,fontWeight:600}}>{st.toUpperCase()}</span>
                          <select value={st} onChange={function(e){updateStatus('partner',p.id,e.target.value)}} style={{...NB,fontSize:11,padding:'4px 8px',background:CARD,border:'1px solid '+BORDER,color:TEXT,cursor:'pointer'}}>
                            {STATUSES.map(function(s){return <option key={s} value={s}>{s}</option>})}
                          </select>
                        </div>
                      </div>
                      <div style={{display:'grid',gridTemplateColumns:mob?'1fr':'1fr 1fr',gap:10}}>
                        <div><span style={labelStyle}>Company / EPC</span><div style={{...NB,fontSize:13}}>{p.company||'—'}</div></div>
                        <div><span style={labelStyle}>Submitted</span><div style={{...NB,fontSize:13}}>{p.submittedAt?new Date(p.submittedAt).toLocaleDateString():'—'}</div></div>
                      </div>
                      {p.details && <div style={{marginTop:10}}><span style={labelStyle}>Project Details</span><div style={{...NB,fontSize:13,color:MID,lineHeight:1.5}}>{p.details}</div></div>}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
//  TIMEKEEPING MODULE
// ═══════════════════════════════════════════════════════════════════════
function TimekeepingModule({ onExit, portalUser }) {
  const [tab, setTab] = useState('clock');
  const [mob, setMob] = useState(window.innerWidth < 768);
  const [workers, setWorkers] = useState([]);
  const [punches, setPunches] = useState({});
  const [breadcrumbs, setBreadcrumbs] = useState({});
  const [selWorker, setSelWorker] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [showAssign, setShowAssign] = useState(false);
  const [fieldProjects, setFieldProjects] = useState([]);
  const [eqProjects, setEqProjects] = useState([]);
  const [addForm, setAddForm] = useState({name:'',email:'',phone:'',address:'',role:'Apprentice',bankName:'',routingNumber:'',accountNumber:'',accountType:'checking'});
  const [mapWorker, setMapWorker] = useState(null);
  const [mapDate, setMapDate] = useState(new Date().toISOString().slice(0,10));
  const [assignTab, setAssignTab] = useState('project');
  const [eqForProject, setEqForProject] = useState([]);
  const [tkInvites, setTkInvites] = useState([]);
  const [invitePhone, setInvitePhone] = useState('');
  const [inviteName, setInviteName] = useState('');
  const [weekOffset, setWeekOffset] = useState(0);
  const [payrollWorker, setPayrollWorker] = useState(null);
  const geoWatch = useRef(null);
  const isAdmin = portalUser && (portalUser.role === 'admin' || portalUser.accountType === 'admin');
  const today = new Date().toISOString().slice(0,10);
  const BB = {fontFamily:"'Bebas Neue',sans-serif"};
  const NB = {fontFamily:"'Barlow Condensed',sans-serif"};
  const A = '#F97316';
  const TK_BG='#f5f2ee';const TK_CARD='#ffffff';const TK_TEXT='#1a1a2e';const TK_MID='#666';const TK_DIM='#999';const TK_BORDER='rgba(0,0,0,.08)';

  useEffect(function(){
    var h = function(){ setMob(window.innerWidth < 768); };
    window.addEventListener('resize', h);
    return function(){ window.removeEventListener('resize', h); };
  }, []);

  useEffect(function(){
    sGet('tk_workers').then(function(w){ setWorkers(w || []); });
    sGet('tk_punches').then(function(p){ setPunches(p || {}); });
    sGet('tk_breadcrumbs').then(function(b){ setBreadcrumbs(b || {}); });
    sGet('tk_invites').then(function(inv){ setTkInvites(inv || []); });
    var fp = JSON.parse(localStorage.getItem('cron_projects') || '[]');
    setFieldProjects(fp);
    sGet('eq_projects').then(function(ep){ setEqProjects(ep || []); });
  }, []);

  function saveWorkers(w) {
    setWorkers(w);
    sSet('tk_workers', w);
    syncToScreening(w);
  }

  function savePunches(p) { setPunches(p); sSet('tk_punches', p); }
  function saveBreadcrumbs(b) { setBreadcrumbs(b); sSet('tk_breadcrumbs', b); }

  function syncToScreening(w) {
    try {
      var hrEmp = JSON.parse(localStorage.getItem('hr_employees') || '[]');
      var changed = false;
      w.forEach(function(wk) {
        var exists = hrEmp.some(function(e){ return e.id === 'tk-' + wk.id; });
        if (!exists) {
          hrEmp.push({
            id: 'tk-' + wk.id,
            name: wk.name,
            position: wk.role || 'Staff',
            title: wk.role || '',
            department: 'Field',
            isManagement: false,
            isExempt: false,
            notes: 'Phone: ' + (wk.phone||'') + ' | Email: ' + (wk.email||''),
            prescriptions: '',
            fromTimekeeping: true
          });
          changed = true;
        }
      });
      if (changed) localStorage.setItem('hr_employees', JSON.stringify(hrEmp));
    } catch(e) { console.error('TK→SS sync error:', e); }
  }

  function addWorker() {
    if (!addForm.name.trim()) return;
    var w = {
      id: 'w' + Date.now().toString(36) + Math.random().toString(36).slice(2,6),
      name: addForm.name.trim(),
      email: addForm.email.trim(),
      phone: addForm.phone.trim(),
      address: addForm.address.trim(),
      role: addForm.role || 'Apprentice',
      directDeposit: {
        bankName: addForm.bankName.trim(),
        routingNumber: addForm.routingNumber.trim(),
        accountNumber: addForm.accountNumber.trim(),
        accountType: addForm.accountType || 'checking'
      },
      projects: [],
      equipment: [],
      createdAt: new Date().toISOString()
    };
    saveWorkers([...workers, w]);
    setAddForm({name:'',email:'',phone:'',address:'',role:'Apprentice',bankName:'',routingNumber:'',accountNumber:'',accountType:'checking'});
    setShowAdd(false);
  }

  function sendInvite() {
    if (!invitePhone.trim()) return;
    var inv = {
      id: 'inv' + Date.now().toString(36),
      phone: invitePhone.trim(),
      name: inviteName.trim() || '',
      sentAt: new Date().toISOString(),
      sentBy: portalUser ? portalUser.name : 'Admin',
      status: 'pending'
    };
    var next = [...tkInvites, inv];
    setTkInvites(next);
    sSet('tk_invites', next);
    setInvitePhone('');
    setInviteName('');
  }

  function revokeInvite(id) {
    var next = tkInvites.filter(function(i){ return i.id !== id; });
    setTkInvites(next);
    sSet('tk_invites', next);
  }

  function getMonday(offset) {
    var d = new Date();
    var day = d.getDay();
    var diff = d.getDate() - day + (day === 0 ? -6 : 1) + (offset * 7);
    var mon = new Date(d.setDate(diff));
    mon.setHours(0,0,0,0);
    return mon;
  }

  function getWeekDates(offset) {
    var mon = getMonday(offset);
    var dates = [];
    for (var i = 0; i < 7; i++) {
      var d = new Date(mon);
      d.setDate(d.getDate() + i);
      dates.push(d.toISOString().slice(0,10));
    }
    return dates;
  }

  function getWeeklyHours(workerId, weekDates) {
    var total = 0;
    weekDates.forEach(function(date) {
      total += parseFloat(getTotalHours(workerId, date));
    });
    return total.toFixed(2);
  }

  function getWeeklyHoursByProject(workerId, weekDates) {
    var w = workers.find(function(wk){ return wk.id === workerId; });
    if (!w) return {};
    var result = {};
    (w.projects || []).forEach(function(p) {
      result[p.name] = 0;
    });
    var totalH = 0;
    weekDates.forEach(function(date) {
      totalH += parseFloat(getTotalHours(workerId, date));
    });
    if ((w.projects || []).length === 0) {
      result['Unassigned'] = totalH;
    } else if ((w.projects || []).length === 1) {
      result[(w.projects[0]).name] = totalH;
    } else {
      (w.projects || []).forEach(function(p) {
        result[p.name] = parseFloat((totalH / (w.projects||[]).length).toFixed(2));
      });
    }
    return result;
  }

  function exportWeekly() {
    var weekDates = getWeekDates(weekOffset);
    var mon = getMonday(weekOffset);
    var sun = new Date(mon); sun.setDate(sun.getDate()+6);
    var label = mon.toLocaleDateString('en-US',{month:'short',day:'numeric'}) + ' - ' + sun.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
    var allProjects = {};
    workers.forEach(function(w) {
      (w.projects || []).forEach(function(p) { allProjects[p.name] = true; });
    });
    var projNames = Object.keys(allProjects);
    if (projNames.length === 0) projNames = ['Unassigned'];
    var header = ['Employee','Role','Phone'].concat(weekDates.map(function(d){ return new Date(d+'T12:00:00').toLocaleDateString('en-US',{weekday:'short',month:'numeric',day:'numeric'}); })).concat(['Total Hours','Projects']);
    var rows = [header];
    workers.forEach(function(w) {
      var dailyHours = weekDates.map(function(d){ return parseFloat(getTotalHours(w.id, d)); });
      var total = dailyHours.reduce(function(s,h){return s+h},0);
      rows.push([
        w.name,
        w.role || '',
        w.phone || '',
      ].concat(dailyHours.map(function(h){return h.toFixed(2)})).concat([
        total.toFixed(2),
        (w.projects||[]).map(function(p){return p.name}).join(', ') || 'Unassigned'
      ]));
    });
    rows.push([]);
    rows.push(['Week:', label]);
    rows.push(['Generated:', new Date().toLocaleString()]);
    var ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = header.map(function(h,i){ return {wch: i===0?25:i<=2?18:12}; });
    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Weekly Hours');
    var projSheet = [['Project','Employee','Role','Weekly Hours']];
    projNames.forEach(function(pn) {
      workers.forEach(function(w) {
        var assigned = (w.projects||[]).some(function(p){return p.name===pn}) || (pn==='Unassigned' && (w.projects||[]).length===0);
        if (assigned) {
          var hrs = getWeeklyHours(w.id, weekDates);
          projSheet.push([pn, w.name, w.role||'', parseFloat(hrs)]);
        }
      });
    });
    var ws2 = XLSX.utils.aoa_to_sheet(projSheet);
    ws2['!cols'] = [{wch:25},{wch:25},{wch:18},{wch:14}];
    XLSX.utils.book_append_sheet(wb, ws2, 'By Project');
    XLSX.writeFile(wb, 'Timekeeping_' + weekDates[0] + '_to_' + weekDates[6] + '.xlsx');
  }

  function removeWorker(id) {
    if (!window.confirm('Remove this worker?')) return;
    saveWorkers(workers.filter(function(w){ return w.id !== id; }));
    if (selWorker && selWorker.id === id) setSelWorker(null);
  }

  function updateWorker(id, patch) {
    var updated = workers.map(function(w){ return w.id === id ? Object.assign({}, w, patch) : w; });
    saveWorkers(updated);
    if (selWorker && selWorker.id === id) setSelWorker(Object.assign({}, selWorker, patch));
  }

  function getLocation() {
    return new Promise(function(resolve, reject) {
      if (!navigator.geolocation) return reject('Geolocation not supported');
      navigator.geolocation.getCurrentPosition(
        function(pos) { resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy, ts: Date.now() }); },
        function(err) { reject(err.message); },
        { enableHighAccuracy: true, timeout: 15000 }
      );
    });
  }

  function punchIn(workerId) {
    getLocation().then(function(loc) {
      var key = workerId + '_' + today;
      var dayPunches = (punches[key] || []).slice();
      dayPunches.push({ type: 'in', time: new Date().toISOString(), location: loc });
      var next = Object.assign({}, punches);
      next[key] = dayPunches;
      savePunches(next);
      startTracking(workerId);
    }).catch(function(err) {
      alert('GPS required to punch in. Error: ' + err);
    });
  }

  function punchOut(workerId) {
    getLocation().then(function(loc) {
      var key = workerId + '_' + today;
      var dayPunches = (punches[key] || []).slice();
      dayPunches.push({ type: 'out', time: new Date().toISOString(), location: loc });
      var next = Object.assign({}, punches);
      next[key] = dayPunches;
      savePunches(next);
      stopTracking(workerId);
    }).catch(function(err) {
      alert('GPS required to punch out. Error: ' + err);
    });
  }

  function startTracking(workerId) {
    if (geoWatch.current) navigator.geolocation.clearWatch(geoWatch.current);
    geoWatch.current = navigator.geolocation.watchPosition(
      function(pos) {
        var key = workerId + '_' + today;
        sGet('tk_breadcrumbs').then(function(allB) {
          var b = allB || {};
          var trail = (b[key] || []).slice();
          trail.push({ lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy, ts: Date.now() });
          b[key] = trail;
          saveBreadcrumbs(b);
        });
      },
      function(){},
      { enableHighAccuracy: true, maximumAge: 30000 }
    );
  }

  function stopTracking() {
    if (geoWatch.current) { navigator.geolocation.clearWatch(geoWatch.current); geoWatch.current = null; }
  }

  useEffect(function(){ return function(){ stopTracking(); }; }, []);

  function isPunchedIn(workerId) {
    var key = workerId + '_' + today;
    var dp = punches[key] || [];
    if (dp.length === 0) return false;
    return dp[dp.length - 1].type === 'in';
  }

  function getTotalHours(workerId, date) {
    var key = workerId + '_' + (date || today);
    var dp = punches[key] || [];
    var total = 0;
    for (var i = 0; i < dp.length - 1; i += 2) {
      if (dp[i].type === 'in' && dp[i+1]) {
        var start = new Date(dp[i].time).getTime();
        var end = new Date(dp[i+1].time).getTime();
        total += (end - start);
      }
    }
    if (dp.length % 2 === 1 && dp[dp.length-1].type === 'in') {
      total += (Date.now() - new Date(dp[dp.length-1].time).getTime());
    }
    return (total / 3600000).toFixed(2);
  }

  function assignProject(workerId, projectId, projectName, source) {
    updateWorker(workerId, {
      projects: (workers.find(function(w){return w.id===workerId}).projects || []).concat([{id: projectId, name: projectName, source: source, assignedAt: new Date().toISOString()}])
    });
  }

  function unassignProject(workerId, projectId) {
    var w = workers.find(function(w){return w.id===workerId});
    updateWorker(workerId, {
      projects: (w.projects || []).filter(function(p){ return p.id !== projectId; })
    });
  }

  function assignEquipment(workerId, eqItem) {
    var w = workers.find(function(wk){return wk.id===workerId});
    updateWorker(workerId, {
      equipment: (w.equipment || []).concat([{id: 'eq'+Date.now(), type: eqItem.type, serial: eqItem.serial || eqItem.name || '', projectId: eqItem.projectId, assignedAt: new Date().toISOString()}])
    });
  }

  function unassignEquipment(workerId, eqId) {
    var w = workers.find(function(wk){return wk.id===workerId});
    updateWorker(workerId, {
      equipment: (w.equipment || []).filter(function(e){ return e.id !== eqId; })
    });
  }

  function loadEquipForProject(pid) {
    sGet('eq_equip_' + pid).then(function(eq) { setEqForProject(eq || []); });
  }

  var ROLES = ['Apprentice','Foreman','Journeyman','Construction Manager','Project Manager','Project Controls','Admin','Senior Estimator','Senior Business Development Officer'];

  var tBarStyle = function(t) {
    return {
      padding: mob ? '8px 14px' : '10px 20px', cursor: 'pointer', fontSize: 11,
      letterSpacing: '2px', textTransform: 'uppercase', fontWeight: 700, transition: 'all .2s',
      background: tab === t ? A : 'transparent', color: tab === t ? '#fff' : TK_MID,
      border: 'none', borderBottom: tab === t ? '2px solid ' + A : '2px solid transparent',
      ...NB
    };
  };

  var cardStyle = {
    background: TK_CARD, border: '1px solid '+TK_BORDER,
    padding: mob ? 14 : 20, marginBottom: 12, borderRadius: 4, boxShadow:'0 1px 4px rgba(0,0,0,.06)'
  };

  var btnPrimary = {
    background: A, color: '#fff', border: 'none', padding: '10px 22px', cursor: 'pointer',
    fontSize: 12, letterSpacing: '1.5px', textTransform: 'uppercase', fontWeight: 700, borderRadius: 4, ...NB
  };

  var btnSecondary = {
    background: 'transparent', color: A, border: '1px solid ' + A, padding: '8px 18px', cursor: 'pointer',
    fontSize: 11, letterSpacing: '1.5px', textTransform: 'uppercase', fontWeight: 600, borderRadius: 4, ...NB
  };

  var inputStyle = {
    width: '100%', padding: '10px 14px', background: '#fff', border: '1px solid rgba(0,0,0,.15)',
    color: TK_TEXT, fontSize: 14, borderRadius: 4, outline: 'none', ...NB
  };

  var labelStyle = { ...NB, fontSize: 10, letterSpacing: '2px', textTransform: 'uppercase', color: A, marginBottom: 4, display: 'block' };

  return (
    <div style={{position:'fixed',inset:0,zIndex:2000,background:TK_BG,overflow:'auto',color:TK_TEXT}}>
      <div style={{padding: mob ? '14px 16px' : '16px 32px', borderBottom: '1px solid '+TK_BORDER, background:TK_CARD, display:'flex', alignItems:'center', gap: 14, flexWrap:'wrap', boxShadow:'0 1px 4px rgba(0,0,0,.06)'}}>
        <div onClick={onExit} style={{cursor:'pointer',display:'flex',alignItems:'center',gap:6,...NB,fontSize:11,letterSpacing:'2px',textTransform:'uppercase',color:A,transition:'opacity .2s'}}
          onMouseEnter={function(e){e.currentTarget.style.opacity='.7'}} onMouseLeave={function(e){e.currentTarget.style.opacity='1'}}>
          ← Dashboard
        </div>
        <div style={{width:1,height:20,background:TK_BORDER}}/>
        <div style={{...BB,fontSize: mob ? 18 : 24, letterSpacing: '2px', color: TK_TEXT}}>TIMEKEEPING</div>
        <div style={{marginLeft:'auto',display:'flex',gap:4,flexWrap:'wrap'}}>
          {['clock','roster','gps','payroll','invites','admin'].map(function(t){
            if (['admin','payroll','invites'].indexOf(t) >= 0 && !isAdmin) return null;
            var labels = {clock:'Time Clock',roster:'Roster',gps:'GPS Trail',payroll:'Payroll',invites:'Invites',admin:'Manage'};
            return <button key={t} onClick={function(){setTab(t)}} style={tBarStyle(t)}>{labels[t]}</button>;
          })}
        </div>
      </div>

      <div style={{maxWidth:1200,margin:'0 auto',padding: mob ? '20px 14px' : '32px 32px'}}>

        {/* ═══ TIME CLOCK TAB ═══ */}
        {tab === 'clock' && (
          <div>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:24,flexWrap:'wrap',gap:12}}>
              <div>
                <div style={{...BB,fontSize: mob ? 28 : 36,letterSpacing:2}}>TIME CLOCK</div>
                <div style={{...NB,fontSize:12,color:TK_MID,letterSpacing:'1px'}}>{new Date().toLocaleDateString('en-US',{weekday:'long',year:'numeric',month:'long',day:'numeric'})}</div>
              </div>
            </div>
            {workers.length === 0 ? (
              <div style={{textAlign:'center',padding:60,color:TK_DIM}}>
                <div style={{fontSize:48,marginBottom:16}}>&#128337;</div>
                <div style={{...NB,fontSize:16,letterSpacing:'1px'}}>No workers registered yet</div>
                <div style={{...NB,fontSize:12,color:TK_MID,marginTop:8}}>Go to the Roster tab to add employees</div>
              </div>
            ) : (
              <div style={{display:'grid',gridTemplateColumns: mob ? '1fr' : 'repeat(auto-fill, minmax(320px, 1fr))', gap:14}}>
                {workers.map(function(w) {
                  var active = isPunchedIn(w.id);
                  var hours = getTotalHours(w.id);
                  return (
                    <div key={w.id} style={{...cardStyle, borderLeft: '3px solid ' + (active ? '#22c55e' : '#555')}}>
                      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
                        <div>
                          <div style={{...BB,fontSize:20,letterSpacing:1}}>{w.name}</div>
                          <div style={{...NB,fontSize:11,color:TK_MID,letterSpacing:'1px'}}>{w.role}</div>
                          {(w.projects||[]).length > 0 && <div style={{...NB,fontSize:10,color:A,marginTop:4}}>{(w.projects||[]).map(function(p){return p.name}).join(', ')}</div>}
                        </div>
                        <div style={{textAlign:'right'}}>
                          <div style={{...NB,fontSize:10,letterSpacing:'1px',color: active ? '#22c55e' : '#ef4444',textTransform:'uppercase',fontWeight:700}}>{active ? '● Clocked In' : '○ Off'}</div>
                          <div style={{...BB,fontSize:24,color:TK_TEXT,marginTop:4}}>{hours}h</div>
                        </div>
                      </div>
                      <div style={{display:'flex',gap:8,marginTop:14}}>
                        {!active ? (
                          <button onClick={function(){punchIn(w.id)}} style={{...btnPrimary,background:'#22c55e',flex:1}}>&#9654; Clock In</button>
                        ) : (
                          <button onClick={function(){punchOut(w.id)}} style={{...btnPrimary,background:'#ef4444',flex:1}}>&#9632; Clock Out</button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ═══ ROSTER TAB ═══ */}
        {tab === 'roster' && (
          <div>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:24,flexWrap:'wrap',gap:12}}>
              <div style={{...BB,fontSize: mob ? 28 : 36,letterSpacing:2}}>EMPLOYEE ROSTER</div>
              {isAdmin && <button onClick={function(){setShowAdd(true)}} style={btnPrimary}>+ Add Employee</button>}
            </div>

            {showAdd && (
              <div style={{...cardStyle,marginBottom:24,border:'1px solid '+A}}>
                <div style={{...BB,fontSize:18,letterSpacing:1,marginBottom:16}}>NEW EMPLOYEE</div>
                <div style={{display:'grid',gridTemplateColumns: mob ? '1fr' : '1fr 1fr',gap:14}}>
                  <div><label style={labelStyle}>Full Name *</label><input value={addForm.name} onChange={function(e){setAddForm(Object.assign({},addForm,{name:e.target.value}))}} style={inputStyle} placeholder="John Smith"/></div>
                  <div><label style={labelStyle}>Email *</label><input value={addForm.email} onChange={function(e){setAddForm(Object.assign({},addForm,{email:e.target.value}))}} style={inputStyle} placeholder="john@company.com" type="email"/></div>
                  <div><label style={labelStyle}>Phone *</label><input value={addForm.phone} onChange={function(e){setAddForm(Object.assign({},addForm,{phone:e.target.value}))}} style={inputStyle} placeholder="(555) 123-4567" type="tel"/></div>
                  <div><label style={labelStyle}>Home Address (tax purposes) *</label><input value={addForm.address} onChange={function(e){setAddForm(Object.assign({},addForm,{address:e.target.value}))}} style={inputStyle} placeholder="123 Main St, City, ST 12345"/></div>
                  <div>
                    <label style={labelStyle}>Role</label>
                    <select value={addForm.role} onChange={function(e){setAddForm(Object.assign({},addForm,{role:e.target.value}))}} style={{...inputStyle,cursor:'pointer'}}>
                      {ROLES.map(function(r){return <option key={r} value={r}>{r}</option>})}
                    </select>
                  </div>
                </div>
                <div style={{...BB,fontSize:16,letterSpacing:1,marginTop:20,marginBottom:12,color:A}}>DIRECT DEPOSIT INFORMATION</div>
                <div style={{display:'grid',gridTemplateColumns: mob ? '1fr' : '1fr 1fr',gap:14}}>
                  <div><label style={labelStyle}>Bank Name *</label><input value={addForm.bankName} onChange={function(e){setAddForm(Object.assign({},addForm,{bankName:e.target.value}))}} style={inputStyle} placeholder="Chase, Wells Fargo, etc."/></div>
                  <div><label style={labelStyle}>Routing Number *</label><input value={addForm.routingNumber} onChange={function(e){setAddForm(Object.assign({},addForm,{routingNumber:e.target.value.replace(/\D/g,'')}))}} style={inputStyle} placeholder="9 digits" maxLength={9}/></div>
                  <div><label style={labelStyle}>Account Number *</label><input value={addForm.accountNumber} onChange={function(e){setAddForm(Object.assign({},addForm,{accountNumber:e.target.value.replace(/\D/g,'')}))}} style={inputStyle} placeholder="Account number" type="password"/></div>
                  <div>
                    <label style={labelStyle}>Account Type</label>
                    <select value={addForm.accountType} onChange={function(e){setAddForm(Object.assign({},addForm,{accountType:e.target.value}))}} style={{...inputStyle,cursor:'pointer'}}>
                      <option value="checking">Checking</option>
                      <option value="savings">Savings</option>
                    </select>
                  </div>
                </div>
                <div style={{display:'flex',gap:10,marginTop:18}}>
                  <button onClick={addWorker} style={btnPrimary}>Save Employee</button>
                  <button onClick={function(){setShowAdd(false)}} style={btnSecondary}>Cancel</button>
                </div>
              </div>
            )}

            {workers.length === 0 ? (
              <div style={{textAlign:'center',padding:60,color:TK_DIM}}>
                <div style={{...NB,fontSize:14}}>No employees registered. Click "+ Add Employee" to get started.</div>
              </div>
            ) : (
              <div>
                {workers.map(function(w) {
                  var expanded = selWorker && selWorker.id === w.id;
                  return (
                    <div key={w.id} style={cardStyle}>
                      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',cursor:'pointer'}} onClick={function(){setSelWorker(expanded ? null : w)}}>
                        <div style={{display:'flex',alignItems:'center',gap:14}}>
                          <div style={{width:36,height:36,borderRadius:'50%',background:'rgba(249,115,22,.15)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:14,fontWeight:700,color:A}}>{w.name.charAt(0)}</div>
                          <div>
                            <div style={{...BB,fontSize:18,letterSpacing:1}}>{w.name}</div>
                            <div style={{...NB,fontSize:11,color:TK_MID}}>{w.role} · {w.email}</div>
                          </div>
                        </div>
                        <div style={{...NB,fontSize:18,color:TK_MID}}>{expanded ? '▲' : '▼'}</div>
                      </div>
                      {expanded && (
                        <div style={{marginTop:16,paddingTop:16,borderTop:'1px solid '+TK_BORDER}}>
                          <div style={{display:'grid',gridTemplateColumns: mob ? '1fr' : '1fr 1fr 1fr',gap:12,marginBottom:16}}>
                            <div><span style={labelStyle}>Phone</span><div style={{...NB,fontSize:14}}>{w.phone || '—'}</div></div>
                            <div><span style={labelStyle}>Email</span><div style={{...NB,fontSize:14}}>{w.email || '—'}</div></div>
                            <div><span style={labelStyle}>Address</span><div style={{...NB,fontSize:14}}>{w.address || '—'}</div></div>
                          </div>
                          <div style={{marginBottom:14}}>
                            <span style={labelStyle}>Role</span>
                            {isAdmin ? (
                              <select value={w.role||'Apprentice'} onChange={function(e){e.stopPropagation();var updated=workers.map(function(wk){return wk.id===w.id?Object.assign({},wk,{role:e.target.value}):wk});saveWorkers(updated)}} style={{...NB,fontSize:14,padding:'6px 10px',background:TK_CARD,border:'1px solid '+TK_BORDER,color:TK_TEXT,outline:'none',cursor:'pointer'}}>
                                {ROLES.map(function(r){return <option key={r} value={r}>{r}</option>})}
                              </select>
                            ) : (
                              <div style={{...NB,fontSize:14}}>{w.role || '—'}</div>
                            )}
                          </div>
                          <div style={{marginBottom:14}}>
                            <span style={labelStyle}>Assigned Projects</span>
                            {(w.projects||[]).length === 0 ? <div style={{...NB,fontSize:12,color:TK_DIM}}>None assigned</div> : (
                              <div style={{display:'flex',flexWrap:'wrap',gap:6,marginTop:4}}>
                                {(w.projects||[]).map(function(p){return (
                                  <span key={p.id} style={{...NB,fontSize:11,padding:'4px 10px',background:'rgba(249,115,22,.12)',color:A,borderRadius:3,display:'inline-flex',alignItems:'center',gap:6}}>
                                    {p.name} <span style={{fontSize:9,color:TK_MID}}>({p.source})</span>
                                    {isAdmin && <span onClick={function(e){e.stopPropagation();unassignProject(w.id,p.id)}} style={{cursor:'pointer',color:'#ef4444',fontWeight:700}}>✕</span>}
                                  </span>
                                )})}
                              </div>
                            )}
                          </div>
                          <div style={{marginBottom:14}}>
                            <span style={labelStyle}>Assigned Equipment</span>
                            {(w.equipment||[]).length === 0 ? <div style={{...NB,fontSize:12,color:TK_DIM}}>None assigned</div> : (
                              <div style={{display:'flex',flexWrap:'wrap',gap:6,marginTop:4}}>
                                {(w.equipment||[]).map(function(eq){return (
                                  <span key={eq.id} style={{...NB,fontSize:11,padding:'4px 10px',background:'rgba(34,197,94,.12)',color:'#22c55e',borderRadius:3,display:'inline-flex',alignItems:'center',gap:6}}>
                                    {eq.type} {eq.serial && '('+eq.serial+')'}
                                    {isAdmin && <span onClick={function(e){e.stopPropagation();unassignEquipment(w.id,eq.id)}} style={{cursor:'pointer',color:'#ef4444',fontWeight:700}}>✕</span>}
                                  </span>
                                )})}
                              </div>
                            )}
                          </div>
                          {isAdmin && (
                            <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
                              <button onClick={function(){setSelWorker(w);setShowAssign(true);setAssignTab('project')}} style={btnSecondary}>Assign Project</button>
                              <button onClick={function(){setSelWorker(w);setShowAssign(true);setAssignTab('equipment')}} style={{...btnSecondary,color:'#22c55e',borderColor:'#22c55e'}}>Assign Equipment</button>
                              <button onClick={function(){removeWorker(w.id)}} style={{...btnSecondary,color:'#ef4444',borderColor:'#ef4444',marginLeft:'auto'}}>Remove</button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ═══ GPS TRAIL TAB ═══ */}
        {tab === 'gps' && (
          <div>
            <div style={{...BB,fontSize: mob ? 28 : 36,letterSpacing:2,marginBottom:6}}>GPS TRAIL</div>
            <div style={{...NB,fontSize:12,color:TK_MID,letterSpacing:'1px',marginBottom:24}}>View worker location breadcrumbs by day</div>
            <div style={{display:'flex',gap:14,marginBottom:20,flexWrap:'wrap',alignItems:'flex-end'}}>
              <div>
                <label style={labelStyle}>Employee</label>
                <select value={mapWorker||''} onChange={function(e){setMapWorker(e.target.value)}} style={{...inputStyle,width:220,cursor:'pointer'}}>
                  <option value="">Select worker...</option>
                  {workers.map(function(w){return <option key={w.id} value={w.id}>{w.name}</option>})}
                </select>
              </div>
              <div>
                <label style={labelStyle}>Date</label>
                <input type="date" value={mapDate} onChange={function(e){setMapDate(e.target.value)}} style={{...inputStyle,width:180}}/>
              </div>
            </div>
            {mapWorker ? (function(){
              var key = mapWorker + '_' + mapDate;
              var trail = breadcrumbs[key] || [];
              var dayPunches = punches[key] || [];
              var wName = (workers.find(function(w){return w.id===mapWorker}) || {}).name || 'Unknown';
              return (
                <div>
                  <div style={{...cardStyle,marginBottom:16}}>
                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
                      <div style={{...BB,fontSize:20,letterSpacing:1}}>{wName}</div>
                      <div style={{...NB,fontSize:12,color:A}}>{trail.length} GPS points · {getTotalHours(mapWorker, mapDate)}h worked</div>
                    </div>
                    {dayPunches.length > 0 && (
                      <div style={{marginBottom:12}}>
                        <span style={labelStyle}>Punch Log</span>
                        <div style={{display:'flex',flexWrap:'wrap',gap:8,marginTop:4}}>
                          {dayPunches.map(function(p, i){
                            return <span key={i} style={{...NB,fontSize:11,padding:'4px 10px',background: p.type==='in'?'rgba(34,197,94,.12)':'rgba(239,68,68,.12)',color: p.type==='in'?'#22c55e':'#ef4444',borderRadius:3}}>
                              {p.type==='in'?'▶ IN':'■ OUT'} {new Date(p.time).toLocaleTimeString()} ({p.location.lat.toFixed(4)}, {p.location.lng.toFixed(4)})
                            </span>;
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                  {trail.length === 0 ? (
                    <div style={{textAlign:'center',padding:40,color:TK_DIM}}>
                      <div style={{...NB,fontSize:14}}>No GPS breadcrumbs recorded for this date</div>
                    </div>
                  ) : (
                    <div style={{...cardStyle}}>
                      <span style={labelStyle}>Location Trail</span>
                      <div style={{maxHeight:400,overflowY:'auto',marginTop:8}}>
                        <table style={{width:'100%',borderCollapse:'collapse'}}>
                          <thead>
                            <tr style={{borderBottom:'1px solid '+TK_BORDER}}>
                              <th style={{...NB,fontSize:10,letterSpacing:'1px',color:TK_MID,padding:'8px 10px',textAlign:'left'}}>#</th>
                              <th style={{...NB,fontSize:10,letterSpacing:'1px',color:TK_MID,padding:'8px 10px',textAlign:'left'}}>TIME</th>
                              <th style={{...NB,fontSize:10,letterSpacing:'1px',color:TK_MID,padding:'8px 10px',textAlign:'left'}}>LATITUDE</th>
                              <th style={{...NB,fontSize:10,letterSpacing:'1px',color:TK_MID,padding:'8px 10px',textAlign:'left'}}>LONGITUDE</th>
                              <th style={{...NB,fontSize:10,letterSpacing:'1px',color:TK_MID,padding:'8px 10px',textAlign:'left'}}>ACCURACY</th>
                            </tr>
                          </thead>
                          <tbody>
                            {trail.map(function(pt, i){
                              return <tr key={i} style={{borderBottom:'1px solid '+TK_BORDER}}>
                                <td style={{...NB,fontSize:12,padding:'6px 10px',color:TK_MID}}>{i+1}</td>
                                <td style={{...NB,fontSize:12,padding:'6px 10px'}}>{new Date(pt.ts).toLocaleTimeString()}</td>
                                <td style={{...NB,fontSize:12,padding:'6px 10px',color:A}}>{pt.lat.toFixed(6)}</td>
                                <td style={{...NB,fontSize:12,padding:'6px 10px',color:A}}>{pt.lng.toFixed(6)}</td>
                                <td style={{...NB,fontSize:12,padding:'6px 10px',color:TK_MID}}>±{pt.acc.toFixed(0)}m</td>
                              </tr>;
                            })}
                          </tbody>
                        </table>
                      </div>
                      <div style={{marginTop:12,...NB,fontSize:11,color:TK_MID}}>
                        Start: {new Date(trail[0].ts).toLocaleTimeString()} → End: {new Date(trail[trail.length-1].ts).toLocaleTimeString()}
                        {trail.length >= 2 && ' · ' + (function(){
                          var d = 0;
                          for(var i=1;i<trail.length;i++){
                            var R=6371e3;var p1=trail[i-1].lat*Math.PI/180;var p2=trail[i].lat*Math.PI/180;
                            var dp=(trail[i].lat-trail[i-1].lat)*Math.PI/180;var dl=(trail[i].lng-trail[i-1].lng)*Math.PI/180;
                            var a=Math.sin(dp/2)*Math.sin(dp/2)+Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)*Math.sin(dl/2);
                            d+=R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
                          }
                          return (d*0.000621371).toFixed(2)+' miles total distance';
                        })()}
                      </div>
                    </div>
                  )}
                </div>
              );
            })() : (
              <div style={{textAlign:'center',padding:60,color:TK_DIM}}>
                <div style={{fontSize:48,marginBottom:16}}>&#128205;</div>
                <div style={{...NB,fontSize:14}}>Select an employee to view their GPS trail</div>
              </div>
            )}
          </div>
        )}

        {/* ═══ PAYROLL TAB ═══ */}
        {tab === 'payroll' && isAdmin && (function(){
          var weekDates = getWeekDates(weekOffset);
          var mon = getMonday(weekOffset);
          var sun = new Date(mon); sun.setDate(sun.getDate()+6);
          var weekLabel = mon.toLocaleDateString('en-US',{month:'short',day:'numeric'}) + ' – ' + sun.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
          var allProjects = {};
          workers.forEach(function(w){ (w.projects||[]).forEach(function(p){ allProjects[p.name] = true; }); });
          var projNames = Object.keys(allProjects);
          if (projNames.length === 0 && workers.length > 0) projNames = ['Unassigned'];
          return (
            <div>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:24,flexWrap:'wrap',gap:12}}>
                <div>
                  <div style={{...BB,fontSize: mob ? 28 : 36,letterSpacing:2}}>WEEKLY PAYROLL</div>
                  <div style={{...NB,fontSize:12,color:TK_MID,letterSpacing:'1px'}}>Hours summary by project · Mon–Sun</div>
                </div>
                <button onClick={exportWeekly} style={btnPrimary}>↓ Export XLSX</button>
              </div>
              <div style={{display:'flex',alignItems:'center',gap:14,marginBottom:24}}>
                <button onClick={function(){setWeekOffset(weekOffset-1)}} style={btnSecondary}>← Prev</button>
                <div style={{...BB,fontSize:20,letterSpacing:1,minWidth:220,textAlign:'center'}}>{weekLabel}</div>
                <button onClick={function(){setWeekOffset(weekOffset+1)}} style={{...btnSecondary,opacity:weekOffset>=0?.4:1}} disabled={weekOffset>=0}>Next →</button>
                {weekOffset!==0 && <button onClick={function(){setWeekOffset(0)}} style={{...NB,fontSize:10,color:A,background:'none',border:'none',cursor:'pointer',textDecoration:'underline'}}>Current Week</button>}
              </div>

              {workers.length === 0 ? (
                <div style={{textAlign:'center',padding:60,color:TK_DIM}}><div style={{...NB,fontSize:14}}>No employees registered</div></div>
              ) : (
                <div>
                  <div style={{...cardStyle,overflowX:'auto'}}>
                    <table style={{width:'100%',borderCollapse:'collapse',minWidth:700}}>
                      <thead>
                        <tr style={{borderBottom:'2px solid '+A}}>
                          <th style={{...NB,fontSize:10,letterSpacing:'1.5px',color:A,padding:'10px 12px',textAlign:'left'}}>EMPLOYEE</th>
                          <th style={{...NB,fontSize:10,letterSpacing:'1.5px',color:TK_MID,padding:'10px 8px',textAlign:'left'}}>ROLE</th>
                          {weekDates.map(function(d){return <th key={d} style={{...NB,fontSize:10,letterSpacing:'1px',color:TK_MID,padding:'10px 8px',textAlign:'center'}}>{new Date(d+'T12:00:00').toLocaleDateString('en-US',{weekday:'short',month:'numeric',day:'numeric'})}</th>})}
                          <th style={{...NB,fontSize:10,letterSpacing:'1.5px',color:A,padding:'10px 8px',textAlign:'center',fontWeight:700}}>TOTAL</th>
                        </tr>
                      </thead>
                      <tbody>
                        {workers.map(function(w){
                          var dailyH = weekDates.map(function(d){return parseFloat(getTotalHours(w.id,d))});
                          var total = dailyH.reduce(function(s,h){return s+h},0);
                          return (
                            <tr key={w.id} style={{borderBottom:'1px solid '+TK_BORDER,cursor:'pointer',background: payrollWorker===w.id?'rgba(249,115,22,.06)':'transparent'}} onClick={function(){setPayrollWorker(payrollWorker===w.id?null:w.id)}}>
                              <td style={{...NB,fontSize:13,padding:'10px 12px',fontWeight:600}}>{w.name}</td>
                              <td style={{...NB,fontSize:12,padding:'10px 8px',color:TK_MID}}>{w.role}</td>
                              {dailyH.map(function(h,i){return <td key={i} style={{...NB,fontSize:13,padding:'10px 8px',textAlign:'center',color:h>0?TK_TEXT:'#999'}}>{h>0?h.toFixed(2):'—'}</td>})}
                              <td style={{...BB,fontSize:18,padding:'10px 8px',textAlign:'center',color:total>0?A:'#444'}}>{total.toFixed(2)}</td>
                            </tr>
                          );
                        })}
                        <tr style={{borderTop:'2px solid '+A}}>
                          <td colSpan={2} style={{...BB,fontSize:14,padding:'10px 12px',color:A}}>TOTALS</td>
                          {weekDates.map(function(d,di){
                            var dayTotal = workers.reduce(function(s,w){return s+parseFloat(getTotalHours(w.id,d))},0);
                            return <td key={di} style={{...BB,fontSize:14,padding:'10px 8px',textAlign:'center',color:dayTotal>0?TK_TEXT:'#999'}}>{dayTotal>0?dayTotal.toFixed(2):'—'}</td>;
                          })}
                          <td style={{...BB,fontSize:20,padding:'10px 8px',textAlign:'center',color:A}}>
                            {workers.reduce(function(s,w){return s+parseFloat(getWeeklyHours(w.id,weekDates))},0).toFixed(2)}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>

                  {payrollWorker && (function(){
                    var w = workers.find(function(wk){return wk.id===payrollWorker});
                    if(!w) return null;
                    var dd = w.directDeposit || {};
                    return (
                      <div style={{...cardStyle,marginTop:16,border:'1px solid '+A}}>
                        <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',flexWrap:'wrap',gap:12}}>
                          <div>
                            <div style={{...BB,fontSize:22,letterSpacing:1}}>{w.name}</div>
                            <div style={{...NB,fontSize:11,color:TK_MID}}>{w.role} · {w.phone}</div>
                          </div>
                          <div style={{...BB,fontSize:28,color:A}}>{getWeeklyHours(w.id,weekDates)}h</div>
                        </div>
                        <div style={{marginTop:16,paddingTop:14,borderTop:'1px solid '+TK_BORDER}}>
                          <div style={{...BB,fontSize:14,letterSpacing:1,color:A,marginBottom:10}}>DIRECT DEPOSIT</div>
                          <div style={{display:'grid',gridTemplateColumns: mob?'1fr':'1fr 1fr 1fr 1fr',gap:12}}>
                            <div><span style={labelStyle}>Bank</span><div style={{...NB,fontSize:14}}>{dd.bankName||'—'}</div></div>
                            <div><span style={labelStyle}>Routing #</span><div style={{...NB,fontSize:14}}>{dd.routingNumber||'—'}</div></div>
                            <div><span style={labelStyle}>Account #</span><div style={{...NB,fontSize:14}}>{dd.accountNumber||'—'}</div></div>
                            <div><span style={labelStyle}>Type</span><div style={{...NB,fontSize:14,textTransform:'capitalize'}}>{dd.accountType||'—'}</div></div>
                          </div>
                        </div>
                        <div style={{marginTop:14,paddingTop:14,borderTop:'1px solid '+TK_BORDER}}>
                          <div style={{...BB,fontSize:14,letterSpacing:1,color:TK_MID,marginBottom:8}}>TAX INFO</div>
                          <div style={{display:'grid',gridTemplateColumns: mob?'1fr':'1fr 1fr',gap:12}}>
                            <div><span style={labelStyle}>Address</span><div style={{...NB,fontSize:14}}>{w.address||'—'}</div></div>
                            <div><span style={labelStyle}>Email</span><div style={{...NB,fontSize:14}}>{w.email||'—'}</div></div>
                          </div>
                        </div>
                      </div>
                    );
                  })()}

                  {projNames.length > 0 && (
                    <div style={{marginTop:24}}>
                      <div style={{...BB,fontSize:20,letterSpacing:1,marginBottom:14}}>HOURS BY PROJECT</div>
                      {projNames.map(function(pn){
                        var projWorkers = workers.filter(function(w){
                          return (w.projects||[]).some(function(p){return p.name===pn}) || (pn==='Unassigned' && (w.projects||[]).length===0);
                        });
                        var projTotal = projWorkers.reduce(function(s,w){return s+parseFloat(getWeeklyHours(w.id,weekDates))},0);
                        var appHrs = projWorkers.filter(function(w){return w.role==='Apprentice'}).reduce(function(s,w){return s+parseFloat(getWeeklyHours(w.id,weekDates))},0);
                        var jourHrs = projWorkers.filter(function(w){return w.role==='Journeyman'}).reduce(function(s,w){return s+parseFloat(getWeeklyHours(w.id,weekDates))},0);
                        var trackedHrs = appHrs + jourHrs;
                        var ratio = trackedHrs > 0 ? appHrs / trackedHrs : 0;
                        var target = 0.15;
                        var deficit = trackedHrs > 0 && ratio < target ? Math.ceil((target * jourHrs - appHrs) / (1 - target)) : 0;
                        var belowTarget = trackedHrs > 0 && ratio < target;
                        return (
                          <div key={pn} style={{...cardStyle,marginBottom:10}}>
                            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
                              <div style={{...BB,fontSize:16,letterSpacing:1,color:A}}>{pn}</div>
                              <div style={{...BB,fontSize:22}}>{projTotal.toFixed(2)}h</div>
                            </div>
                            {trackedHrs > 0 && (
                              <div style={{marginBottom:10,padding:'10px 14px',background:belowTarget?'rgba(239,68,68,.08)':'rgba(34,197,94,.08)',border:'1px solid '+(belowTarget?'rgba(239,68,68,.25)':'rgba(34,197,94,.25)'),display:'flex',flexDirection:mob?'column':'row',gap:mob?8:20,alignItems:mob?'flex-start':'center',justifyContent:'space-between'}}>
                                <div>
                                  <div style={{...NB,fontSize:10,letterSpacing:'2px',textTransform:'uppercase',color:belowTarget?'#ef4444':'#22c55e',marginBottom:4}}>APPRENTICE RATIO</div>
                                  <div style={{display:'flex',alignItems:'baseline',gap:8}}>
                                    <span style={{...BB,fontSize:24,color:belowTarget?'#ef4444':'#22c55e'}}>{(ratio*100).toFixed(1)}%</span>
                                    <span style={{...NB,fontSize:11,color:TK_MID}}>target: {(target*100)}%</span>
                                  </div>
                                  <div style={{...NB,fontSize:11,color:TK_MID,marginTop:2}}>Apprentice: {appHrs.toFixed(1)}h · Journeyman: {jourHrs.toFixed(1)}h</div>
                                </div>
                                {belowTarget && (
                                  <div style={{...NB,fontSize:12,color:'#ef4444',fontWeight:600,textAlign:mob?'left':'right'}}>
                                    ⚠ Below 15% — needs ~{deficit}h more apprentice hours
                                  </div>
                                )}
                              </div>
                            )}
                            {projWorkers.map(function(w){
                              var hrs = getWeeklyHours(w.id,weekDates);
                              return <div key={w.id} style={{display:'flex',justifyContent:'space-between',padding:'4px 0',...NB,fontSize:12}}>
                                <span>{w.name} <span style={{color:TK_MID}}>({w.role})</span></span>
                                <span style={{color:parseFloat(hrs)>0?TK_TEXT:'#999'}}>{hrs}h</span>
                              </div>;
                            })}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })()}

        {/* ═══ INVITES TAB ═══ */}
        {tab === 'invites' && isAdmin && (
          <div>
            <div style={{...BB,fontSize: mob ? 28 : 36,letterSpacing:2,marginBottom:6}}>PHONE INVITES</div>
            <div style={{...NB,fontSize:12,color:TK_MID,letterSpacing:'1px',marginBottom:24}}>Invite workers to Timekeeping via phone number</div>

            <div style={{...cardStyle,marginBottom:24,border:'1px solid '+A}}>
              <div style={{...BB,fontSize:16,letterSpacing:1,marginBottom:14}}>SEND INVITE</div>
              <div style={{display:'grid',gridTemplateColumns: mob?'1fr':'1fr 1fr auto',gap:14,alignItems:'flex-end'}}>
                <div><label style={labelStyle}>Phone Number *</label><input value={invitePhone} onChange={function(e){setInvitePhone(e.target.value)}} style={inputStyle} placeholder="(555) 123-4567" type="tel"/></div>
                <div><label style={labelStyle}>Name (optional)</label><input value={inviteName} onChange={function(e){setInviteName(e.target.value)}} style={inputStyle} placeholder="Worker name"/></div>
                <button onClick={sendInvite} style={{...btnPrimary,height:44}}>Send Invite</button>
              </div>
            </div>

            {tkInvites.length === 0 ? (
              <div style={{textAlign:'center',padding:40,color:TK_DIM}}><div style={{...NB,fontSize:14}}>No invites sent yet</div></div>
            ) : (
              <div>
                <div style={{...NB,fontSize:10,letterSpacing:'1.5px',color:TK_MID,marginBottom:10}}>{tkInvites.length} INVITE{tkInvites.length!==1?'S':''} SENT</div>
                {tkInvites.map(function(inv){
                  return (
                    <div key={inv.id} style={{...cardStyle,marginBottom:8,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                      <div>
                        <div style={{...NB,fontSize:14,fontWeight:600}}>{inv.phone} {inv.name && <span style={{color:TK_MID}}>· {inv.name}</span>}</div>
                        <div style={{...NB,fontSize:10,color:TK_MID}}>Sent {new Date(inv.sentAt).toLocaleDateString()} by {inv.sentBy}</div>
                      </div>
                      <div style={{display:'flex',alignItems:'center',gap:10}}>
                        <span style={{...NB,fontSize:10,letterSpacing:'1px',textTransform:'uppercase',padding:'4px 10px',borderRadius:3,
                          background: inv.status==='accepted'?'rgba(34,197,94,.12)':'rgba(234,179,8,.12)',
                          color: inv.status==='accepted'?'#22c55e':'#eab308'
                        }}>{inv.status}</span>
                        <button onClick={function(){revokeInvite(inv.id)}} style={{...NB,fontSize:10,background:'none',border:'1px solid #ef4444',color:'#ef4444',padding:'4px 10px',borderRadius:3,cursor:'pointer'}}>Revoke</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ═══ ADMIN / MANAGE TAB ═══ */}
        {tab === 'admin' && isAdmin && (
          <div>
            <div style={{...BB,fontSize: mob ? 28 : 36,letterSpacing:2,marginBottom:6}}>MANAGE ASSIGNMENTS</div>
            <div style={{...NB,fontSize:12,color:TK_MID,letterSpacing:'1px',marginBottom:24}}>Assign workers to projects and equipment</div>

            {workers.length === 0 ? (
              <div style={{textAlign:'center',padding:60,color:TK_DIM}}>
                <div style={{...NB,fontSize:14}}>Add employees in the Roster tab first</div>
              </div>
            ) : (
              <div style={{display:'grid',gridTemplateColumns: mob ? '1fr' : '1fr 1fr',gap:20}}>
                <div>
                  <div style={{...BB,fontSize:18,letterSpacing:1,marginBottom:14,color:A}}>WORKERS</div>
                  {workers.map(function(w){
                    var sel = selWorker && selWorker.id === w.id;
                    return (
                      <div key={w.id} onClick={function(){setSelWorker(sel?null:w)}} style={{...cardStyle,cursor:'pointer',borderColor: sel?A:TK_BORDER,marginBottom:8}}>
                        <div style={{...BB,fontSize:16,letterSpacing:1}}>{w.name}</div>
                        <div style={{...NB,fontSize:10,color:TK_MID}}>{w.role} · {(w.projects||[]).length} projects · {(w.equipment||[]).length} equipment</div>
                      </div>
                    );
                  })}
                </div>
                <div>
                  {selWorker ? (
                    <div>
                      <div style={{...BB,fontSize:18,letterSpacing:1,marginBottom:14,color:A}}>ASSIGN TO {selWorker.name.toUpperCase()}</div>
                      <div style={{display:'flex',gap:8,marginBottom:16}}>
                        <button onClick={function(){setAssignTab('project')}} style={assignTab==='project'?btnPrimary:btnSecondary}>Projects</button>
                        <button onClick={function(){setAssignTab('equipment')}} style={assignTab==='equipment'?{...btnPrimary,background:'#22c55e'}:{...btnSecondary,color:'#22c55e',borderColor:'#22c55e'}}>Equipment</button>
                      </div>

                      {assignTab === 'project' && (
                        <div>
                          <div style={{...NB,fontSize:10,letterSpacing:'1.5px',color:TK_MID,marginBottom:8}}>FIELD MANAGER PROJECTS</div>
                          {fieldProjects.length === 0 ? <div style={{...NB,fontSize:12,color:TK_DIM}}>No field projects found</div> :
                            fieldProjects.map(function(fp){
                              var already = (selWorker.projects||[]).some(function(p){return p.id===fp.id});
                              return (
                                <div key={fp.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'8px 12px',marginBottom:4,background:'rgba(0,0,0,.03)',borderRadius:3}}>
                                  <span style={{...NB,fontSize:13}}>{fp.name}</span>
                                  {already ?
                                    <span style={{...NB,fontSize:10,color:'#22c55e'}}>✓ Assigned</span> :
                                    <button onClick={function(){assignProject(selWorker.id,fp.id,fp.name,'Field Manager')}} style={{...NB,fontSize:10,padding:'4px 12px',background:A,color:'#fff',border:'none',borderRadius:3,cursor:'pointer'}}>Assign</button>
                                  }
                                </div>
                              );
                            })
                          }
                          <div style={{...NB,fontSize:10,letterSpacing:'1.5px',color:TK_MID,marginBottom:8,marginTop:16}}>EQUIPMENT MANAGER PROJECTS</div>
                          {eqProjects.length === 0 ? <div style={{...NB,fontSize:12,color:TK_DIM}}>No equipment projects found</div> :
                            eqProjects.map(function(ep){
                              var already = (selWorker.projects||[]).some(function(p){return p.id===ep.id});
                              return (
                                <div key={ep.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'8px 12px',marginBottom:4,background:'rgba(0,0,0,.03)',borderRadius:3}}>
                                  <span style={{...NB,fontSize:13}}>{ep.name}</span>
                                  {already ?
                                    <span style={{...NB,fontSize:10,color:'#22c55e'}}>✓ Assigned</span> :
                                    <button onClick={function(){assignProject(selWorker.id,ep.id,ep.name,'Equipment Mgr')}} style={{...NB,fontSize:10,padding:'4px 12px',background:A,color:'#fff',border:'none',borderRadius:3,cursor:'pointer'}}>Assign</button>
                                  }
                                </div>
                              );
                            })
                          }
                        </div>
                      )}

                      {assignTab === 'equipment' && (
                        <div>
                          <div style={{...NB,fontSize:10,letterSpacing:'1.5px',color:TK_MID,marginBottom:8}}>SELECT PROJECT TO VIEW EQUIPMENT</div>
                          <select onChange={function(e){if(e.target.value)loadEquipForProject(e.target.value)}} style={{...inputStyle,marginBottom:14,cursor:'pointer'}}>
                            <option value="">Choose project...</option>
                            {eqProjects.map(function(ep){return <option key={ep.id} value={ep.id}>{ep.name}</option>})}
                          </select>
                          {eqForProject.length > 0 && eqForProject.map(function(eq, i){
                            var already = (selWorker.equipment||[]).some(function(e){return e.type===eq.type&&e.serial===(eq.serial||eq.name||'')});
                            return (
                              <div key={i} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'8px 12px',marginBottom:4,background:'rgba(0,0,0,.03)',borderRadius:3}}>
                                <span style={{...NB,fontSize:13}}>{eq.type || eq.name} {eq.serial ? '('+eq.serial+')' : eq.qty ? '(qty: '+eq.qty+')' : ''}</span>
                                {already ?
                                  <span style={{...NB,fontSize:10,color:'#22c55e'}}>✓ Assigned</span> :
                                  <button onClick={function(){assignEquipment(selWorker.id,eq)}} style={{...NB,fontSize:10,padding:'4px 12px',background:'#22c55e',color:'#fff',border:'none',borderRadius:3,cursor:'pointer'}}>Assign</button>
                                }
                              </div>
                            );
                          })}
                          {eqForProject.length === 0 && <div style={{...NB,fontSize:12,color:TK_DIM}}>Select a project to see available equipment</div>}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div style={{textAlign:'center',padding:40,color:TK_DIM}}>
                      <div style={{...NB,fontSize:14}}>Select a worker from the left to manage assignments</div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ═══ ASSIGN MODAL ═══ */}
      {showAssign && selWorker && (
        <div style={{position:'fixed',inset:0,zIndex:3000,background:'rgba(0,0,0,.4)',display:'flex',alignItems:'center',justifyContent:'center',padding:20}} onClick={function(){setShowAssign(false)}}>
          <div style={{background:'#fff',border:'1px solid '+A,borderRadius:6,padding:28,maxWidth:500,width:'100%',maxHeight:'80vh',overflowY:'auto'}} onClick={function(e){e.stopPropagation()}}>
            <div style={{...BB,fontSize:22,letterSpacing:1,marginBottom:4}}>ASSIGN TO {selWorker.name.toUpperCase()}</div>
            <div style={{display:'flex',gap:8,marginBottom:16}}>
              <button onClick={function(){setAssignTab('project')}} style={assignTab==='project'?btnPrimary:btnSecondary}>Projects</button>
              <button onClick={function(){setAssignTab('equipment')}} style={assignTab==='equipment'?{...btnPrimary,background:'#22c55e'}:{...btnSecondary,color:'#22c55e',borderColor:'#22c55e'}}>Equipment</button>
            </div>
            {assignTab==='project' && (
              <div>
                {[...fieldProjects.map(function(p){return Object.assign({},p,{source:'Field Manager'})}),...eqProjects.map(function(p){return Object.assign({},p,{source:'Equipment Mgr'})})].map(function(p){
                  var already = (selWorker.projects||[]).some(function(x){return x.id===p.id});
                  return <div key={p.id+p.source} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'8px 12px',marginBottom:4,background:'rgba(0,0,0,.03)',borderRadius:3}}>
                    <span style={{...NB,fontSize:13}}>{p.name} <span style={{fontSize:9,color:TK_MID}}>({p.source})</span></span>
                    {already ? <span style={{...NB,fontSize:10,color:'#22c55e'}}>✓</span> :
                      <button onClick={function(){assignProject(selWorker.id,p.id,p.name,p.source);setSelWorker(Object.assign({},selWorker,{projects:(selWorker.projects||[]).concat([{id:p.id,name:p.name,source:p.source}])}))}} style={{...NB,fontSize:10,padding:'4px 12px',background:A,color:'#fff',border:'none',borderRadius:3,cursor:'pointer'}}>Assign</button>}
                  </div>;
                })}
              </div>
            )}
            {assignTab==='equipment' && (
              <div>
                <select onChange={function(e){if(e.target.value)loadEquipForProject(e.target.value)}} style={{...inputStyle,marginBottom:14,cursor:'pointer'}}>
                  <option value="">Choose project...</option>
                  {eqProjects.map(function(ep){return <option key={ep.id} value={ep.id}>{ep.name}</option>})}
                </select>
                {eqForProject.map(function(eq,i){
                  return <div key={i} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'8px 12px',marginBottom:4,background:'rgba(0,0,0,.03)',borderRadius:3}}>
                    <span style={{...NB,fontSize:13}}>{eq.type||eq.name}</span>
                    <button onClick={function(){assignEquipment(selWorker.id,eq);}} style={{...NB,fontSize:10,padding:'4px 12px',background:'#22c55e',color:'#fff',border:'none',borderRadius:3,cursor:'pointer'}}>Assign</button>
                  </div>;
                })}
              </div>
            )}
            <button onClick={function(){setShowAssign(false)}} style={{...btnSecondary,marginTop:16,width:'100%'}}>Close</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
//  STAKEHOLDER REPORTS DASHBOARD
// ═══════════════════════════════════════════════════════════════════════
function StakeholderReports({ onExit }) {
  const [tab, setTab] = useState('overview');
  const [data, setData] = useState(null);

  useEffect(() => {
    function load() {
      var projects = [];
      try { projects = JSON.parse(localStorage.getItem("cron_projects") || "[]"); } catch(e) {}
      var bids = [];
      try { bids = JSON.parse(localStorage.getItem("precon_bids") || "[]"); } catch(e) {}

      var projectKPIs = [];
      projects.forEach(function(proj) {
        var kpi = null;
        try { kpi = JSON.parse(localStorage.getItem("fr_kpi_" + proj.id) || "null"); } catch(e) {}
        var entries = [];
        try { entries = JSON.parse(localStorage.getItem("cron_entries_" + proj.id) || "[]"); } catch(e) {}
        var scopeCfg = null;
        try { scopeCfg = JSON.parse(localStorage.getItem("cron_scope_" + proj.id) || "null"); } catch(e) {}

        var totalEntries = entries.length;
        var thisWeekEntries = 0;
        var thisQuarterEntries = 0;
        var now = new Date();
        var weekAgo = new Date(now.getTime() - 7 * 86400000);
        var qStart = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);
        entries.forEach(function(e) {
          var d = new Date(e.date || e.createdAt);
          if (d >= weekAgo) thisWeekEntries++;
          if (d >= qStart) thisQuarterEntries++;
        });

        var completedTasks = 0;
        var inProgressTasks = 0;
        var totalTasks = (proj.tasks || []).length;
        (proj.tasks || []).forEach(function(t) {
          var allocated = t.totalManHours || 0;
          var taskEntries = entries.filter(function(e) { return e.taskId === t.id; });
          var worked = taskEntries.reduce(function(s, e) { return s + (e.manHours || e.workers * (e.hours || 0) || 0); }, 0);
          if (allocated > 0 && worked >= allocated) completedTasks++;
          else if (worked > 0) inProgressTasks++;
        });

        projectKPIs.push({
          id: proj.id,
          name: proj.name,
          company: proj.company || '',
          color: proj.color || '#1565C0',
          fromPreCon: proj.fromPreCon || false,
          systemSizeMW: proj.systemSizeMW || 0,
          location: proj.location || '',
          totalBid: proj.totalBid || 0,
          totalCost: proj.totalCost || 0,
          projectedProfit: proj.projectedProfit || 0,
          profitMargin: proj.profitMargin || 0,
          totalManHours: proj.totalManHours || 0,
          peakManpower: proj.peakManpower || 0,
          workingDays: proj.workingDays || 0,
          kpi: kpi,
          scopeCfg: scopeCfg,
          totalEntries: totalEntries,
          thisWeekEntries: thisWeekEntries,
          thisQuarterEntries: thisQuarterEntries,
          completedTasks: completedTasks,
          inProgressTasks: inProgressTasks,
          totalTasks: totalTasks,
          tasks: proj.tasks || [],
          entries: entries,
        });
      });

      var activeBids = bids.filter(function(b) { return !b.archived && b.params && b.params.projectName; });

      setData({ projects: projectKPIs, bids: activeBids, totalProjects: projects.length });
    }
    load();
    var iv = setInterval(load, 5000);
    return function() { clearInterval(iv); };
  }, []);

  if (!data) return null;

  var BB = { fontFamily: "'Bebas Neue',sans-serif" };
  var NB = { fontFamily: "'Barlow Condensed',sans-serif" };
  var cardBg = '#ffffff';
  var borderC = 'rgba(0,0,0,.08)';

  var totalRevenue = data.projects.reduce(function(s, p) { return s + p.totalBid; }, 0);
  var totalCost = data.projects.reduce(function(s, p) { return s + p.totalCost; }, 0);
  var totalProfit = totalRevenue - totalCost;
  var avgMargin = totalRevenue > 0 ? ((totalRevenue - totalCost) / totalRevenue * 100) : 0;
  var totalMW = data.projects.reduce(function(s, p) { return s + p.systemSizeMW; }, 0);
  var totalMH = data.projects.reduce(function(s, p) { return s + p.totalManHours; }, 0);
  var weekActivity = data.projects.reduce(function(s, p) { return s + p.thisWeekEntries; }, 0);
  var quarterActivity = data.projects.reduce(function(s, p) { return s + p.thisQuarterEntries; }, 0);
  var allInProgress = data.projects.reduce(function(s, p) { return s + p.inProgressTasks; }, 0);
  var allCompleted = data.projects.reduce(function(s, p) { return s + p.completedTasks; }, 0);

  function fmt$(v) { return v >= 1000000 ? '$' + (v / 1000000).toFixed(2) + 'M' : v >= 1000 ? '$' + (v / 1000).toFixed(0) + 'K' : '$' + Math.round(v); }
  function fmtN(v) { return v >= 1000000 ? (v / 1000000).toFixed(1) + 'M' : v >= 1000 ? (v / 1000).toFixed(1) + 'K' : String(Math.round(v)); }

  function healthScore(p) {
    var score = 100;
    if (p.thisWeekEntries === 0 && p.totalEntries > 0) score -= 30;
    if (p.inProgressTasks === 0 && p.completedTasks === 0 && p.totalTasks > 0) score -= 20;
    if (p.kpi && p.kpi.earnedValue) {
      var spi = p.kpi.earnedValue.spi || 1;
      var cpi = p.kpi.earnedValue.cpi || 1;
      if (spi < 0.8) score -= 25;
      else if (spi < 0.95) score -= 10;
      if (cpi < 0.8) score -= 25;
      else if (cpi < 0.95) score -= 10;
    }
    return Math.max(0, Math.min(100, score));
  }

  function healthColor(s) { return s >= 80 ? '#22c55e' : s >= 60 ? '#eab308' : '#ef4444'; }

  var tabs = [
    { id: 'overview', label: 'Overview' },
    { id: 'projects', label: 'Projects' },
    { id: 'financial', label: 'Financial' },
    { id: 'activity', label: 'Activity' },
  ];

  function MetricCard({ label, value, sub, color }) {
    return React.createElement('div', { style: { background: cardBg, border: '1px solid ' + borderC, padding: '20px 24px', flex: '1 1 200px', minWidth: 180 } },
      React.createElement('div', { style: { ...NB, fontSize: 11, letterSpacing: '2px', textTransform: 'uppercase', color: '#666', marginBottom: 8 } }, label),
      React.createElement('div', { style: { ...BB, fontSize: 32, color: color || '#1a1a2e', lineHeight: 1 } }, value),
      sub ? React.createElement('div', { style: { ...NB, fontSize: 12, color: '#666', marginTop: 6 } }, sub) : null
    );
  }

  function ProjectRow({ p }) {
    var hs = healthScore(p);
    var pct = p.totalManHours > 0 && p.kpi ? Math.min(100, Math.round((p.kpi.totalMH || 0) / p.totalManHours * 100)) : 0;
    return React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 16, padding: '14px 20px', background: cardBg, border: '1px solid ' + borderC, marginBottom: 6 } },
      React.createElement('div', { style: { width: 10, height: 10, borderRadius: '50%', background: healthColor(hs), flexShrink: 0 } }),
      React.createElement('div', { style: { flex: 1, minWidth: 0 } },
        React.createElement('div', { style: { ...NB, fontSize: 15, fontWeight: 600, color: '#1a1a2e', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, p.name),
        React.createElement('div', { style: { ...NB, fontSize: 11, color: '#666' } }, p.company + (p.location ? ' • ' + p.location : '') + (p.systemSizeMW ? ' • ' + p.systemSizeMW + ' MW' : ''))
      ),
      React.createElement('div', { style: { textAlign: 'right', minWidth: 80 } },
        React.createElement('div', { style: { ...NB, fontSize: 13, color: '#1a1a2e' } }, fmt$(p.totalBid)),
        React.createElement('div', { style: { ...NB, fontSize: 11, color: p.profitMargin > 15 ? '#22c55e' : p.profitMargin > 8 ? '#eab308' : '#ef4444' } }, p.profitMargin.toFixed(1) + '% margin')
      ),
      React.createElement('div', { style: { textAlign: 'center', minWidth: 70 } },
        React.createElement('div', { style: { ...BB, fontSize: 20, color: healthColor(hs) } }, hs),
        React.createElement('div', { style: { ...NB, fontSize: 10, color: '#666' } }, 'HEALTH')
      ),
      React.createElement('div', { style: { width: 100, height: 6, background: '#fff', borderRadius: 3, overflow: 'hidden' } },
        React.createElement('div', { style: { width: pct + '%', height: '100%', background: 'linear-gradient(90deg, #F97316, #EAB308)', borderRadius: 3 } })
      ),
      React.createElement('div', { style: { ...NB, fontSize: 11, color: '#666', minWidth: 40, textAlign: 'right' } }, pct + '%')
    );
  }

  function OverviewTab() {
    return React.createElement('div', null,
      React.createElement('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 28 } },
        React.createElement(MetricCard, { label: 'Active Projects', value: data.projects.length, sub: totalMW.toFixed(1) + ' MW total capacity' }),
        React.createElement(MetricCard, { label: 'Total Revenue', value: fmt$(totalRevenue), color: '#22c55e', sub: fmt$(totalProfit) + ' projected profit' }),
        React.createElement(MetricCard, { label: 'Avg Margin', value: avgMargin.toFixed(1) + '%', color: avgMargin > 15 ? '#22c55e' : '#eab308' }),
        React.createElement(MetricCard, { label: 'Man-Hours', value: fmtN(totalMH), sub: fmtN(weekActivity) + ' entries this week' })
      ),
      React.createElement('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 28 } },
        React.createElement(MetricCard, { label: 'Tasks In Progress', value: allInProgress, color: '#F97316' }),
        React.createElement(MetricCard, { label: 'Tasks Completed', value: allCompleted, color: '#22c55e' }),
        React.createElement(MetricCard, { label: 'Active Bids', value: data.bids.length, sub: 'in PreCon pipeline' }),
        React.createElement(MetricCard, { label: 'Quarter Activity', value: quarterActivity, sub: 'reports filed this quarter' })
      ),
      React.createElement('div', { style: { ...NB, fontSize: 12, letterSpacing: '2px', textTransform: 'uppercase', color: '#666', marginBottom: 12 } }, 'PROJECT HEALTH'),
      data.projects.length === 0
        ? React.createElement('div', { style: { ...NB, fontSize: 14, color: '#666', padding: 20 } }, 'No projects yet. Create bids in PreCon or projects in Field Reporting.')
        : data.projects.map(function(p) { return React.createElement(ProjectRow, { key: p.id, p: p }); })
    );
  }

  function ProjectsTab() {
    return React.createElement('div', null,
      data.projects.map(function(p) {
        var hs = healthScore(p);
        var ev = p.kpi && p.kpi.earnedValue ? p.kpi.earnedValue : null;
        return React.createElement('div', { key: p.id, style: { background: cardBg, border: '1px solid ' + borderC, padding: 24, marginBottom: 16 } },
          React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 } },
            React.createElement('div', null,
              React.createElement('div', { style: { ...BB, fontSize: 24, color: '#1a1a2e' } }, p.name),
              React.createElement('div', { style: { ...NB, fontSize: 12, color: '#666' } }, [p.company, p.location, p.systemSizeMW ? p.systemSizeMW + ' MW' : ''].filter(Boolean).join(' • '))
            ),
            React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
              React.createElement('div', { style: { width: 12, height: 12, borderRadius: '50%', background: healthColor(hs) } }),
              React.createElement('span', { style: { ...BB, fontSize: 22, color: healthColor(hs) } }, hs)
            )
          ),
          React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginBottom: 16 } },
            React.createElement('div', { style: { padding: '10px 12px', background: 'rgba(0,0,0,.02)', border: '1px solid rgba(0,0,0,.06)' } },
              React.createElement('div', { style: { ...NB, fontSize: 10, color: '#666', textTransform: 'uppercase', letterSpacing: '1px' } }, 'Contract'),
              React.createElement('div', { style: { ...BB, fontSize: 18, color: '#1a1a2e' } }, fmt$(p.totalBid))
            ),
            React.createElement('div', { style: { padding: '10px 12px', background: 'rgba(0,0,0,.02)', border: '1px solid rgba(0,0,0,.06)' } },
              React.createElement('div', { style: { ...NB, fontSize: 10, color: '#666', textTransform: 'uppercase', letterSpacing: '1px' } }, 'Profit'),
              React.createElement('div', { style: { ...BB, fontSize: 18, color: '#22c55e' } }, fmt$(p.projectedProfit))
            ),
            React.createElement('div', { style: { padding: '10px 12px', background: 'rgba(0,0,0,.02)', border: '1px solid rgba(0,0,0,.06)' } },
              React.createElement('div', { style: { ...NB, fontSize: 10, color: '#666', textTransform: 'uppercase', letterSpacing: '1px' } }, 'Man-Hours'),
              React.createElement('div', { style: { ...BB, fontSize: 18, color: '#1a1a2e' } }, fmtN(p.totalManHours))
            ),
            React.createElement('div', { style: { padding: '10px 12px', background: 'rgba(0,0,0,.02)', border: '1px solid rgba(0,0,0,.06)' } },
              React.createElement('div', { style: { ...NB, fontSize: 10, color: '#666', textTransform: 'uppercase', letterSpacing: '1px' } }, 'Duration'),
              React.createElement('div', { style: { ...BB, fontSize: 18, color: '#1a1a2e' } }, p.workingDays + ' days')
            )
          ),
          ev ? React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))', gap: 8 } },
            React.createElement('div', { style: { padding: '8px 10px', background: 'rgba(249,115,22,.08)', border: '1px solid rgba(249,115,22,.2)' } },
              React.createElement('div', { style: { ...NB, fontSize: 9, color: '#F97316', textTransform: 'uppercase' } }, 'SPI'),
              React.createElement('div', { style: { ...BB, fontSize: 16, color: (ev.spi || 1) >= 0.95 ? '#22c55e' : '#ef4444' } }, (ev.spi || 1).toFixed(2))
            ),
            React.createElement('div', { style: { padding: '8px 10px', background: 'rgba(249,115,22,.08)', border: '1px solid rgba(249,115,22,.2)' } },
              React.createElement('div', { style: { ...NB, fontSize: 9, color: '#F97316', textTransform: 'uppercase' } }, 'CPI'),
              React.createElement('div', { style: { ...BB, fontSize: 16, color: (ev.cpi || 1) >= 0.95 ? '#22c55e' : '#ef4444' } }, (ev.cpi || 1).toFixed(2))
            ),
            React.createElement('div', { style: { padding: '8px 10px', background: 'rgba(249,115,22,.08)', border: '1px solid rgba(249,115,22,.2)' } },
              React.createElement('div', { style: { ...NB, fontSize: 9, color: '#F97316', textTransform: 'uppercase' } }, 'EV'),
              React.createElement('div', { style: { ...BB, fontSize: 16, color: '#1a1a2e' } }, fmt$(ev.ev || 0))
            ),
            React.createElement('div', { style: { padding: '8px 10px', background: 'rgba(249,115,22,.08)', border: '1px solid rgba(249,115,22,.2)' } },
              React.createElement('div', { style: { ...NB, fontSize: 9, color: '#F97316', textTransform: 'uppercase' } }, 'EAC'),
              React.createElement('div', { style: { ...BB, fontSize: 16, color: '#1a1a2e' } }, fmt$(ev.eac || 0))
            )
          ) : null,
          React.createElement('div', { style: { display: 'flex', gap: 16, marginTop: 14, ...NB, fontSize: 12 } },
            React.createElement('span', { style: { color: '#666' } }, p.totalEntries + ' total reports'),
            React.createElement('span', { style: { color: p.thisWeekEntries > 0 ? '#22c55e' : '#ef4444' } }, p.thisWeekEntries + ' this week'),
            React.createElement('span', { style: { color: '#666' } }, p.inProgressTasks + ' in-progress / ' + p.completedTasks + ' done')
          )
        );
      })
    );
  }

  function FinancialTab() {
    return React.createElement('div', null,
      React.createElement('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 28 } },
        React.createElement(MetricCard, { label: 'Total Pipeline', value: fmt$(totalRevenue + data.bids.reduce(function(s, b) { var r = computeAll(b.params || {}); return s + (r.preBondTotal || 0); }, 0)), color: '#818cf8' }),
        React.createElement(MetricCard, { label: 'Awarded Revenue', value: fmt$(totalRevenue), color: '#22c55e' }),
        React.createElement(MetricCard, { label: 'Total Costs', value: fmt$(totalCost), color: '#ef4444' }),
        React.createElement(MetricCard, { label: 'Net Profit', value: fmt$(totalProfit), color: totalProfit > 0 ? '#22c55e' : '#ef4444' })
      ),
      React.createElement('div', { style: { ...NB, fontSize: 12, letterSpacing: '2px', textTransform: 'uppercase', color: '#666', marginBottom: 12 } }, 'PROJECT FINANCIALS'),
      React.createElement('div', { style: { background: cardBg, border: '1px solid ' + borderC, overflow: 'hidden' } },
        React.createElement('div', { style: { display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 80px', padding: '10px 16px', background: 'rgba(255,255,255,.03)', borderBottom: '1px solid ' + borderC, ...NB, fontSize: 10, color: '#666', textTransform: 'uppercase', letterSpacing: '1px' } },
          React.createElement('div', null, 'Project'),
          React.createElement('div', { style: { textAlign: 'right' } }, 'Revenue'),
          React.createElement('div', { style: { textAlign: 'right' } }, 'Cost'),
          React.createElement('div', { style: { textAlign: 'right' } }, 'Profit'),
          React.createElement('div', { style: { textAlign: 'right' } }, 'Margin')
        ),
        data.projects.map(function(p) {
          return React.createElement('div', { key: p.id, style: { display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 80px', padding: '12px 16px', borderBottom: '1px solid ' + borderC } },
            React.createElement('div', { style: { ...NB, fontSize: 13, color: '#1a1a2e', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, p.name),
            React.createElement('div', { style: { ...NB, fontSize: 13, color: '#1a1a2e', textAlign: 'right' } }, fmt$(p.totalBid)),
            React.createElement('div', { style: { ...NB, fontSize: 13, color: '#ef4444', textAlign: 'right' } }, fmt$(p.totalCost)),
            React.createElement('div', { style: { ...NB, fontSize: 13, color: '#22c55e', textAlign: 'right' } }, fmt$(p.projectedProfit)),
            React.createElement('div', { style: { ...NB, fontSize: 13, color: p.profitMargin > 15 ? '#22c55e' : '#eab308', textAlign: 'right' } }, p.profitMargin.toFixed(1) + '%')
          );
        }),
        React.createElement('div', { style: { display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 80px', padding: '12px 16px', background: 'rgba(249,115,22,.05)', ...NB, fontSize: 13, fontWeight: 700 } },
          React.createElement('div', { style: { color: '#F97316' } }, 'TOTAL'),
          React.createElement('div', { style: { textAlign: 'right', color: '#1a1a2e' } }, fmt$(totalRevenue)),
          React.createElement('div', { style: { textAlign: 'right', color: '#ef4444' } }, fmt$(totalCost)),
          React.createElement('div', { style: { textAlign: 'right', color: '#22c55e' } }, fmt$(totalProfit)),
          React.createElement('div', { style: { textAlign: 'right', color: avgMargin > 15 ? '#22c55e' : '#eab308' } }, avgMargin.toFixed(1) + '%')
        )
      ),
      data.bids.length > 0 ? React.createElement('div', { style: { marginTop: 28 } },
        React.createElement('div', { style: { ...NB, fontSize: 12, letterSpacing: '2px', textTransform: 'uppercase', color: '#666', marginBottom: 12 } }, 'PIPELINE — ACTIVE BIDS'),
        data.bids.map(function(b) {
          var p = b.params || {};
          var r = computeAll(p);
          return React.createElement('div', { key: b.id, style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', background: cardBg, border: '1px solid ' + borderC, marginBottom: 4 } },
            React.createElement('div', null,
              React.createElement('div', { style: { ...NB, fontSize: 14, color: '#1a1a2e' } }, p.projectName || 'Untitled'),
              React.createElement('div', { style: { ...NB, fontSize: 11, color: '#666' } }, [p.clientName, p.systemSizeMW ? p.systemSizeMW + ' MW' : '', p.status || 'Draft'].filter(Boolean).join(' • '))
            ),
            React.createElement('div', { style: { ...BB, fontSize: 18, color: '#818cf8' } }, fmt$(r.preBondTotal || 0))
          );
        })
      ) : null
    );
  }

  function ActivityTab() {
    var allTasks = [];
    data.projects.forEach(function(p) {
      (p.tasks || []).forEach(function(t) {
        var taskEntries = p.entries.filter(function(e) { return e.taskId === t.id; });
        var worked = taskEntries.reduce(function(s, e) { return s + (e.manHours || e.workers * (e.hours || 0) || 0); }, 0);
        var allocated = t.totalManHours || 0;
        var pct = allocated > 0 ? Math.min(100, Math.round(worked / allocated * 100)) : 0;
        var lastEntry = taskEntries.length > 0 ? taskEntries.sort(function(a, b) { return new Date(b.date || b.createdAt) - new Date(a.date || a.createdAt); })[0] : null;
        var lastDate = lastEntry ? new Date(lastEntry.date || lastEntry.createdAt) : null;
        var daysSince = lastDate ? Math.floor((new Date() - lastDate) / 86400000) : null;
        allTasks.push({
          project: p.name,
          projectColor: p.color,
          task: t.label || t.id,
          taskColor: t.color,
          worked: worked,
          allocated: allocated,
          pct: pct,
          status: allocated > 0 && worked >= allocated ? 'done' : worked > 0 ? 'active' : 'pending',
          daysSince: daysSince,
          weekEntries: taskEntries.filter(function(e) { return new Date(e.date || e.createdAt) >= new Date(Date.now() - 7 * 86400000); }).length,
        });
      });
    });

    var active = allTasks.filter(function(t) { return t.status === 'active'; });
    var done = allTasks.filter(function(t) { return t.status === 'done'; });
    var stale = active.filter(function(t) { return t.daysSince !== null && t.daysSince >= 5; });

    return React.createElement('div', null,
      React.createElement('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 28 } },
        React.createElement(MetricCard, { label: 'Active Tasks', value: active.length, color: '#F97316' }),
        React.createElement(MetricCard, { label: 'Completed', value: done.length, color: '#22c55e' }),
        React.createElement(MetricCard, { label: 'Stale (5+ days)', value: stale.length, color: stale.length > 0 ? '#ef4444' : '#22c55e' }),
        React.createElement(MetricCard, { label: 'Week Reports', value: weekActivity })
      ),
      stale.length > 0 ? React.createElement('div', { style: { marginBottom: 28 } },
        React.createElement('div', { style: { ...NB, fontSize: 12, letterSpacing: '2px', textTransform: 'uppercase', color: '#ef4444', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 } },
          React.createElement(AlertTriangle, { size: 14 }), 'ENGAGEMENT ALERTS — NO ACTIVITY 5+ DAYS'
        ),
        stale.map(function(t, i) {
          return React.createElement('div', { key: i, style: { display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', background: 'rgba(239,68,68,.06)', border: '1px solid rgba(239,68,68,.2)', marginBottom: 4 } },
            React.createElement('div', { style: { width: 8, height: 8, borderRadius: '50%', background: '#ef4444', animation: 'pulse 2s infinite' } }),
            React.createElement('div', { style: { flex: 1 } },
              React.createElement('div', { style: { ...NB, fontSize: 13, color: '#1a1a2e' } }, t.task),
              React.createElement('div', { style: { ...NB, fontSize: 11, color: '#666' } }, t.project)
            ),
            React.createElement('div', { style: { ...NB, fontSize: 12, color: '#ef4444' } }, t.daysSince + ' days idle'),
            React.createElement('div', { style: { ...NB, fontSize: 11, color: '#666' } }, t.pct + '% complete')
          );
        })
      ) : null,
      React.createElement('div', { style: { ...NB, fontSize: 12, letterSpacing: '2px', textTransform: 'uppercase', color: '#666', marginBottom: 12 } }, 'ALL IN-PROGRESS TASKS'),
      active.length === 0
        ? React.createElement('div', { style: { ...NB, fontSize: 14, color: '#666', padding: 20 } }, 'No tasks currently in progress.')
        : active.map(function(t, i) {
          return React.createElement('div', { key: i, style: { display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', background: cardBg, border: '1px solid ' + borderC, marginBottom: 4 } },
            React.createElement('div', { style: { width: 4, height: 28, background: t.taskColor || '#F97316', borderRadius: 2 } }),
            React.createElement('div', { style: { flex: 1, minWidth: 0 } },
              React.createElement('div', { style: { ...NB, fontSize: 13, color: '#1a1a2e' } }, t.task),
              React.createElement('div', { style: { ...NB, fontSize: 11, color: '#666' } }, t.project)
            ),
            React.createElement('div', { style: { width: 80, height: 5, background: '#fff', borderRadius: 3, overflow: 'hidden' } },
              React.createElement('div', { style: { width: t.pct + '%', height: '100%', background: t.taskColor || '#F97316', borderRadius: 3 } })
            ),
            React.createElement('div', { style: { ...NB, fontSize: 11, color: '#666', minWidth: 55, textAlign: 'right' } }, t.pct + '% • ' + Math.round(t.worked) + 'h'),
            t.weekEntries === 0 && t.daysSince !== null && t.daysSince >= 3
              ? React.createElement(AlertTriangle, { size: 12, color: '#eab308', style: { flexShrink: 0 } })
              : null
          );
        }),
      done.length > 0 ? React.createElement('div', { style: { marginTop: 28 } },
        React.createElement('div', { style: { ...NB, fontSize: 12, letterSpacing: '2px', textTransform: 'uppercase', color: '#22c55e', marginBottom: 12 } }, 'COMPLETED THIS QUARTER (' + done.length + ')'),
        done.slice(0, 20).map(function(t, i) {
          return React.createElement('div', { key: i, style: { display: 'flex', alignItems: 'center', gap: 12, padding: '8px 16px', background: cardBg, border: '1px solid ' + borderC, marginBottom: 3, opacity: 0.7 } },
            React.createElement(Check, { size: 14, color: '#22c55e' }),
            React.createElement('div', { style: { ...NB, fontSize: 13, color: '#1a1a2e', flex: 1 } }, t.task),
            React.createElement('div', { style: { ...NB, fontSize: 11, color: '#666' } }, t.project),
            React.createElement('div', { style: { ...NB, fontSize: 11, color: '#22c55e' } }, Math.round(t.worked) + 'h')
          );
        })
      ) : null
    );
  }

  var content;
  if (tab === 'overview') content = React.createElement(OverviewTab, null);
  else if (tab === 'projects') content = React.createElement(ProjectsTab, null);
  else if (tab === 'financial') content = React.createElement(FinancialTab, null);
  else content = React.createElement(ActivityTab, null);

  return React.createElement('div', { style: { position: 'fixed', inset: 0, zIndex: 2000, background: '#f5f2ee', overflow: 'auto', fontFamily: "'Barlow',sans-serif" } },
    React.createElement('div', { style: { maxWidth: 1400, margin: '0 auto', padding: '24px 32px 60px' } },
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 32 } },
        React.createElement('div', null,
          React.createElement('div', { onClick: onExit, style: { cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8, ...NB, fontSize: 12, letterSpacing: '2px', textTransform: 'uppercase', color: '#F97316', marginBottom: 12, transition: 'opacity .2s' }, onMouseEnter: function(e){e.currentTarget.style.opacity='.7'}, onMouseLeave: function(e){e.currentTarget.style.opacity='1'} }, '← Back to Dashboard'),
          React.createElement('div', { style: { ...BB, fontSize: 'clamp(32px,5vw,52px)', letterSpacing: 2, color: '#1a1a2e', lineHeight: 1 } }, 'STAKEHOLDER REPORTS')
        ),
        React.createElement('div', { style: { ...NB, fontSize: 11, color: '#666' } }, 'Last refreshed: ' + new Date().toLocaleTimeString())
      ),
      React.createElement('div', { style: { display: 'flex', gap: 0, marginBottom: 28, borderBottom: '1px solid ' + borderC } },
        tabs.map(function(t) {
          var active = t.id === tab;
          return React.createElement('div', { key: t.id, onClick: function() { setTab(t.id); }, style: { padding: '12px 24px', cursor: 'pointer', ...NB, fontSize: 13, letterSpacing: '1.5px', textTransform: 'uppercase', color: active ? '#F97316' : '#888', borderBottom: active ? '2px solid #F97316' : '2px solid transparent', transition: 'all .2s' } }, t.label);
        })
      ),
      content
    )
  );
}

export default function App(){
  const[loading,setLoading]=useState(true)
  const[phase,setPhase]=useState(0)
  const[prog,setProg]=useState(0)
  const[scrollY,setScrollY]=useState(0)
  const[totalH,setTotalH]=useState(4000)
  const[mob,setMob]=useState(typeof window!=='undefined'?window.innerWidth<768:false)
  const[page,setPage]=useState('landing')
  const[user,setUser]=useState(null)
  const[loginErr,setLoginErr]=useState('')
  const[loginUser,setLoginUser]=useState('')
  const[loginPass,setLoginPass]=useState('')
  const[careerForm,setCareerForm]=useState({name:'',email:'',phone:'',position:'',experience:'',message:''})
  const[careerSubmitted,setCareerSubmitted]=useState(false)
  const[contactForm,setContactForm]=useState({firstName:'',lastName:'',company:'',email:'',details:''})
  const[contactSubmitted,setContactSubmitted]=useState(false)
  const[loginEmail,setLoginEmail]=useState('')
  const[portalUsers,setPortalUsers]=useState([])
  const[invites,setInvites]=useState([])
  const[accessReqs,setAccessReqs]=useState([])
  const[siteSettings,setSiteSettings]=useState({heroTitle:'WE DOMINATE SOLAR',heroSub:'The technical powerhouse delivering dominance, precision, and efficiency for the nation\'s largest utility-scale projects.',contactEmail:'Kaleb.LeBaron@sunriseconstructionco.com',contactPhone:'+1 (619) 870-4491',contactAddr:'12856 N Hwy 183 Ste B PMB 2011 Austin TX 78750',portalTitle:'EMPLOYEE PORTAL'})
  const[adminTab,setAdminTab2]=useState('invite')
  const[invForm,setInvForm]=useState({name:'',email:'',role:'member',tools:['field','equipment','hr','precon','compliance','hse','stakeholders','timekeeping','crm','sitemap','pileplan']})
  const[reqReason,setReqReason]=useState('')
  const[reqTool,setReqTool]=useState('')

  function pHash(s){var h=5381;for(var i=0;i<s.length;i++){h=((h<<5)+h)+s.charCodeAt(i);h=h&h}return Math.abs(h).toString(36)}

  useEffect(function(){sGet('portal_users').then(function(u){
    if(!u||u.length===0){
      var admin={id:uid(),name:'Dustin Hanson',email:'dustin.hanson@sunriseconstructionco.com',role:'admin',tools:['field','equipment','hr','precon','compliance','hse','stakeholders','timekeeping','crm','sitemap','pileplan','admin'],passwordHash:pHash('admin123'),createdAt:new Date().toISOString()}
      setPortalUsers([admin]);sSet('portal_users',[admin])
    }else{setPortalUsers(u)}
  });sGet('portal_invites').then(function(i){setInvites(i||[])});sGet('portal_requests').then(function(r){setAccessReqs(r||[])});
    // Check for invite token in URL
    try{var params=new URLSearchParams(window.location.search);var invToken=params.get('invite');if(invToken){setPage('login');setLoginErr('You have an invitation! Set a password below to create your account.');window._pendingInvite=invToken}}catch(e3){}sGet('portal_site').then(function(s){if(s)setSiteSettings(function(prev){return Object.assign({},prev,s)})})
  },[])

  function svPU(u){setPortalUsers(u);sSet('portal_users',u)}
  function svInv(i){setInvites(i);sSet('portal_invites',i)}
  function svReqs(r){setAccessReqs(r);sSet('portal_requests',r)}
  function svSite(s){setSiteSettings(s);sSet('portal_site',s)}

  function doPortalLogin(){
    setLoginErr('')
    if(!loginEmail.trim()||!loginPass.trim()){setLoginErr('Enter email and password');return}
    if(loginEmail.indexOf('@sunriseconstructionco.com')<0){setLoginErr('Only @sunriseconstructionco.com emails allowed');return}
    var u=portalUsers.find(function(x){return x.email===loginEmail&&x.passwordHash===pHash(loginPass)})
    if(!u){setLoginErr('Invalid credentials or no account. Contact admin for invite.');return}
    setUser(u);setPage('dashboard')
  }

  function doInviteSignup(token){
    setLoginErr('')
    try{
      var inv=JSON.parse(atob(token))
      if(!inv||!inv.email){setLoginErr('Invalid invite');return}
      if(portalUsers.find(function(x){return x.email===inv.email})){setLoginErr('Account already exists. Sign in.');return}
      if(!loginPass.trim()){setLoginErr('Set a password');return}
      var u={id:uid(),name:inv.name||'',email:inv.email,role:inv.role||'member',tools:inv.tools||[],passwordHash:pHash(loginPass),createdAt:new Date().toISOString(),invitedBy:inv.invitedBy||''}
      svPU(portalUsers.concat([u]))
      svInv(invites.map(function(x){return x.email===inv.email?Object.assign({},x,{used:true}):x}))
      setUser(u);setPage('dashboard')
    }catch(e2){setLoginErr('Invalid invite link')}
  }

  function sendInvite(){
    if(!invForm.email||invForm.email.indexOf('@sunriseconstructionco.com')<0){return}
    if(portalUsers.find(function(x){return x.email===invForm.email})){return}
    var inv={id:uid(),name:invForm.name,email:invForm.email,role:invForm.role,tools:invForm.tools,createdAt:new Date().toISOString(),invitedBy:user?user.name:'Admin',used:false}
    svInv(invites.concat([inv]))
    var token=btoa(JSON.stringify({name:inv.name,email:inv.email,role:inv.role,tools:inv.tools,invitedBy:inv.invitedBy}))
    var link=window.location.origin+window.location.pathname+'?invite='+token
    window.open('https://mail.google.com/mail/?view=cm&fs=1&to='+encodeURIComponent(inv.email)+'&su='+encodeURIComponent('SRC%26D Employee Portal Invitation')+'&body='+encodeURIComponent('You have been invited to the SRC%26D Employee Portal.\n\nClick to join:\n'+link),'_blank')
    setInvForm({name:'',email:'',role:'member',tools:['field','equipment','hr','precon','compliance','hse','stakeholders','timekeeping','crm','sitemap','pileplan']})
  }

  function submitAccessReq(){
    if(!reqTool||!reqReason.trim())return
    var r={id:uid(),userId:user?user.id:'',userName:user?user.name:'',userEmail:user?user.email:'',tool:reqTool,reason:reqReason,status:'pending',createdAt:new Date().toISOString()}
    svReqs(accessReqs.concat([r]));setReqTool('');setReqReason('')
  }

  function approveReq(reqId){
    var req=accessReqs.find(function(r){return r.id===reqId})
    if(!req)return
    svReqs(accessReqs.map(function(r){return r.id===reqId?Object.assign({},r,{status:'approved'}):r}))
    var pu=portalUsers.map(function(u){if(u.id===req.userId){var t=u.tools?u.tools.concat([req.tool]):[req.tool];return Object.assign({},u,{tools:t})}return u})
    svPU(pu)
    if(user&&user.id===req.userId){setUser(Object.assign({},user,{tools:(user.tools||[]).concat([req.tool])}))}
  }

  function denyReq(reqId){svReqs(accessReqs.map(function(r){return r.id===reqId?Object.assign({},r,{status:'denied'}):r}))}

  var isPortalAdmin=user&&user.role==='admin'
  var userTools=user&&user.tools?user.tools:[]
  function hasTool(t){return isPortalAdmin||userTools.indexOf(t)>=0}

  var TOOL_LABELS={field:'Field Manager',equipment:'Equipment Manager',hr:'Screening Solutions',precon:'PreCon Controls',compliance:'Compliance Center',hse:'HS&E',stakeholders:'Stakeholder Reports',timekeeping:'Timekeeping',crm:'CRM',sitemap:'Site Map',pileplan:'Pile Plan'}

  const boxRef=useRef()

  useEffect(()=>{
    const onResize=()=>setMob(window.innerWidth<768)
    window.addEventListener('resize',onResize)
    return()=>window.removeEventListener('resize',onResize)
  },[])

  useEffect(()=>{
    function onMsg(e){ if(e.data && e.data.type==='FR_EXIT') setPage('dashboard'); }
    window.addEventListener('message', onMsg);
    return ()=> window.removeEventListener('message', onMsg);
  },[])

  useEffect(()=>{
    const ts=[setTimeout(()=>setPhase(1),320),setTimeout(()=>setPhase(2),1050),setTimeout(()=>setPhase(3),1850),setTimeout(()=>setPhase(4),3100),setTimeout(()=>setPhase(5),3550),setTimeout(()=>setLoading(false),4500)]
    let p=0;const iv=setInterval(()=>{p=Math.min(100,p+Math.random()*5.5+2);setProg(p);if(p>=100)clearInterval(iv)},80)
    return()=>{ts.forEach(clearTimeout);clearInterval(iv)}
  },[])

  useEffect(()=>{
    if(loading)return;const el=boxRef.current;if(!el)return
    const fn=()=>{setScrollY(el.scrollTop);setTotalH(el.scrollHeight)}
    el.addEventListener('scroll',fn,{passive:true});setTimeout(fn,100)
    return()=>el.removeEventListener('scroll',fn)
  },[loading])

  const vp=typeof window!=='undefined'?window.innerHeight:700
  const scrollP=totalH>vp?scrollY/Math.max(totalH-vp,1):0
  const BB={fontFamily:"'Bebas Neue',sans-serif"}
  const NB={fontFamily:"'Barlow Condensed',sans-serif"}
  const m=mob

  const phases2=Z_PHASES.map(([ps,pe,ts,te,ms,me])=>({pileP:phaseP(scrollP,ps,pe),tubeP:phaseP(scrollP,ts,te),panelP:phaseP(scrollP,ms,me)}))
  const overallP2=phases2.reduce((s,p)=>s+(p.pileP+p.tubeP+p.panelP)/3,0)/phases2.length
  const phLabel2=overallP2<0.15?'SITE PREP':overallP2<0.35?'PILE INSTALL':overallP2<0.55?'RACKING':overallP2<0.75?'MODULES':'OPERATIONAL'

  const IST={width:'100%',background:'#f9f7f5',border:'1px solid rgba(0,0,0,.12)',color:'#1a1a2e',padding:'12px 16px',fontFamily:"'Barlow',sans-serif",fontSize:16,outline:'none',borderRadius:0,WebkitAppearance:'none'}
  const fIn=e=>{e.target.style.borderColor='rgba(249,115,22,.5)';e.target.style.boxShadow='0 0 0 3px rgba(249,115,22,.08)'}
  const fOut=e=>{e.target.style.borderColor='rgba(0,0,0,.12)';e.target.style.boxShadow=''}

  return(
    <div style={{position:'fixed',inset:0,fontFamily:"'Barlow',sans-serif"}}>
      <style>{CSS}</style>
      {loading&&<Loader phase={phase} prog={prog}/>}
      <div ref={boxRef} style={{position:'absolute',inset:0,overflowY:'scroll',overflowX:'hidden'}}>
        <AerialBG scrollP={scrollP}/>

        {/* Phase label — hide on mobile */}
        {/* ── NAV ── */}
        <nav style={{position:'fixed',top:0,left:0,right:0,zIndex:100,display:'flex',alignItems:'center',justifyContent:'space-between',padding:m?'14px 20px':'16px 40px',background:'rgba(2,2,12,.85)',backdropFilter:'blur(14px)',borderBottom:'1px solid rgba(249,115,22,.1)'}}>
          <div style={{display:'flex',alignItems:'center',gap:10,flexShrink:0,marginRight:m?0:20}}>
            <img src={LOGO_SRC} alt="SRC" style={{width:m?36:48,height:m?36:48,objectFit:"contain"}}/>
            <div>
              <div style={{...BB,fontSize:m?17:21,letterSpacing:'4px',color:'#F5F0EB',lineHeight:1}}>SUNRISE</div>
              <div style={{...NB,fontSize:m?7:9,letterSpacing:'2px',color:A,textTransform:'uppercase',whiteSpace:'nowrap'}}>Construction & Development</div>
            </div>
          </div>

          {/* Nav links — hidden on mobile */}
          {!m&&<div style={{display:'flex',gap:22}}>
            {['Safety','Capabilities','Portfolio','Careers','Contact'].map(l=>(
              <a key={l} href={'#'+l.toLowerCase()} style={{...NB,fontSize:12,letterSpacing:'2px',textTransform:'uppercase',color:'#666',whiteSpace:'nowrap',textDecoration:'none',transition:'color .2s'}} onMouseEnter={e=>e.target.style.color=A} onMouseLeave={e=>e.target.style.color='#CCC8C2'}>{l}</a>
            ))}
          </div>}

          {page==='landing'&&<div style={{...NB,fontSize:m?10:12,letterSpacing:m?'1px':'2px',textTransform:'uppercase',color:'#666',cursor:'pointer',transition:'color .2s',whiteSpace:'nowrap'}} onClick={function(){setPage('login')}} onMouseEnter={e=>e.target.style.color=A} onMouseLeave={e=>e.target.style.color='#CCC8C2'}>Employee Portal</div>}
          {page!=='landing'&&<div style={{...NB,fontSize:m?10:12,letterSpacing:m?'1px':'2px',textTransform:'uppercase',color:'#666',cursor:'pointer',transition:'color .2s',whiteSpace:'nowrap'}} onClick={function(){setPage('landing');setUser(null)}} onMouseEnter={e=>e.target.style.color=A} onMouseLeave={e=>e.target.style.color='#CCC8C2'}>Back to Site</div>}
          <a href="#contact" style={{background:A,color:'#1a1206',...NB,fontSize:m?11:13,fontWeight:700,letterSpacing:m?'2px':'3px',textTransform:'uppercase',textDecoration:'none',padding:m?'8px 12px':'10px 26px',clipPath:'polygon(8px 0%,100% 0%,calc(100% - 8px) 100%,0% 100%)',transition:'background .2s',whiteSpace:'nowrap'}} onMouseEnter={e=>e.target.style.background='#FB923C'} onMouseLeave={e=>e.target.style.background=A}>
            {m?'Get In Touch':'Partner Now'}
          </a>
        </nav>


        {/* ── PHASE LABEL ── */}
        {page==='landing'&&!m&&<div style={{position:'fixed',top:76,right:20,zIndex:90,...NB,fontSize:9,letterSpacing:'4px',textTransform:'uppercase',color:'rgba(249,115,22,.5)'}}>{phLabel2}</div>}

        {/* ══════════════════════════════════════════════
            LOGIN PAGE
            ══════════════════════════════════════════════ */}
        {page==='login'&&(
          <div style={{minHeight:'100vh',display:'flex',alignItems:'center',justifyContent:'center',position:'relative',zIndex:10,padding:m?'80px 16px 40px':'120px 48px',background:'#f5f2ee'}}>
            <div style={{width:m?'100%':420,maxWidth:'95vw',background:'#ffffff',border:'1px solid rgba(0,0,0,.1)',boxShadow:'0 4px 24px rgba(0,0,0,.08)',padding:m?'36px 28px':'48px 40px'}}>
              <div style={{textAlign:'center',marginBottom:32}}>
                <img src={LOGO_SRC} alt="SRC&D" style={{width:72,height:72,objectFit:'contain',marginBottom:16}}/>
                <div style={{...BB,fontSize:28,letterSpacing:'4px',color:'#1a1a2e'}}>{ siteSettings.portalTitle}</div>
                <div style={{...NB,fontSize:12,letterSpacing:'3px',color:A,textTransform:'uppercase',marginTop:4}}>Sunrise Construction & Development</div>
              </div>
              {loginErr&&<div style={{background:'rgba(239,68,68,.12)',border:'1px solid rgba(239,68,68,.3)',color:'#EF4444',padding:'10px 14px',marginBottom:16,fontSize:13,...NB,letterSpacing:'1px'}}>{loginErr}</div>}
              <div style={{marginBottom:16}}>
                <div style={{...NB,fontSize:10,letterSpacing:'3px',textTransform:'uppercase',color:A,marginBottom:6}}>EMAIL</div>
                <input value={loginEmail} onChange={function(e){setLoginEmail(e.target.value)}} style={{...IST}} onFocus={fIn} onBlur={fOut} placeholder="name@sunriseconstructionco.com"/>
              </div>
              <div style={{marginBottom:24}}>
                <div style={{...NB,fontSize:10,letterSpacing:'3px',textTransform:'uppercase',color:A,marginBottom:6}}>PASSWORD</div>
                <input type="password" value={loginPass} onChange={function(e){setLoginPass(e.target.value)}} style={{...IST}} onFocus={fIn} onBlur={fOut} placeholder="Enter password" onKeyDown={function(e){if(e.key==='Enter')doPortalLogin()}}/>
              </div>
              <div style={{cursor:'pointer',background:A,color:'#1a1206',textAlign:'center',...NB,fontSize:14,fontWeight:700,letterSpacing:'3px',textTransform:'uppercase',padding:'14px 0',clipPath:'polygon(10px 0%,100% 0%,calc(100% - 10px) 100%,0% 100%)',transition:'background .2s'}} onClick={doPortalLogin} onMouseEnter={function(e){e.target.style.background='#FB923C'}} onMouseLeave={function(e){e.target.style.background=A}}>
                Sign In
              </div>
              {window._pendingInvite&&<div style={{cursor:'pointer',background:'#22c55e',color:'#fff',textAlign:'center',...NB,fontSize:14,fontWeight:700,letterSpacing:'3px',textTransform:'uppercase',padding:'14px 0',marginTop:12,transition:'background .2s'}} onClick={function(){doInviteSignup(window._pendingInvite);window._pendingInvite=null}}>
                ACCEPT INVITE & CREATE ACCOUNT
              </div>}
              <div style={{textAlign:'center',marginTop:20,...NB,fontSize:11,letterSpacing:'1.5px',color:'#555'}}>
                Invite-only access · @sunriseconstructionco.com
              </div>
              <div style={{textAlign:'center',marginTop:8,...NB,fontSize:11,color:'#555'}}>
                Default admin: dustin.hanson@sunriseconstructionco.com / admin123
              </div>
            </div>
          </div>
        )}

        {page==='dashboard'&&(
          <div style={{minHeight:'100vh',position:'relative',zIndex:10,padding:m?'76px 14px 32px':'120px 48px 80px',background:'#f5f2ee'}}>
            <div style={{maxWidth:1200,margin:'0 auto'}}>
              <div style={{marginBottom:m?28:40}}>
                <div style={{...NB,fontSize:12,letterSpacing:'4px',textTransform:'uppercase',color:A,marginBottom:8,display:'flex',alignItems:'center',gap:12}}>
                  <div style={{width:22,height:1,background:A}}/>Welcome back
                </div>
                <div style={{...BB,fontSize:m?'clamp(32px,8vw,48px)':'clamp(36px,5vw,56px)',letterSpacing:2,color:'#1a1a2e',textShadow:'none'}}>
                  {user ? user.name.toUpperCase() : 'OPERATOR'}
                </div>
                <div style={{...NB,fontSize:13,color:'#666',letterSpacing:'1.5px',marginTop:4}}>{user?user.email:''} · {user?user.role.toUpperCase():'MEMBER'}</div>
              </div>
              <div style={{display:'grid',gridTemplateColumns:m?'1fr':'repeat(4, 1fr)',gap:m?14:20}}>
                {[
                  {key:'field',    label:'Field Manager',       icon:'F', desc:'Daily logs, crew tracking & site progress'},
                  {key:'equipment',label:'Equipment Manager',    icon:'E', desc:'Asset tracking, maintenance & utilization'},
                  {key:'hr',       label:'Screening Solutions',  icon:'S', desc:'Drug screening & compliance management'},
                  {key:'precon',   label:'PreCon Controls',      icon:'P', desc:'Estimating, takeoffs & bid management'},
                  {key:'compliance',label:'Compliance Center',   icon:'C', desc:'ISNet, licensing & regulatory docs'},
                  {key:'hse',      label:'HS&E',                 icon:'S', desc:'Safety incidents, training & audits'},
                  {key:'stakeholders',label:'Stakeholder Reports',icon:'R', desc:'Owner updates, financials & milestones'},
                  {key:'timekeeping',label:'Timekeeping',         icon:'T', desc:'Clock in/out, GPS tracking & crew assignments'},
                  {key:'crm',       label:'CRM',                  icon:'C', desc:'Applicant & partner inquiry tracking'},
                  {key:'sitemap',   label:'Site Map',              icon:'M', desc:'Drawing import & construction progress tracking'},
                  {key:'pileplan',  label:'Pile Plan',            icon:'P', desc:'Pile dot layout with editable task color legend & % complete'},
                ].filter(function(tile){return hasTool(tile.key)}).map(function(tile){
                  return (
                    <div key={tile.key} onClick={function(){setPage(tile.key)}} style={{
                      background:'#ffffff',backdropFilter:'blur(12px)',
                      border:'1px solid rgba(0,0,0,.08)',
                      padding:m?'24px 18px':'32px 28px',
                      cursor:'pointer',transition:'all .3s',position:'relative',overflow:'hidden',boxShadow:'0 1px 4px rgba(0,0,0,.06)'
                    }}
                    onMouseEnter={function(e){e.currentTarget.style.borderColor='rgba(249,115,22,.5)';e.currentTarget.style.background='rgba(249,115,22,.06)';e.currentTarget.style.transform='translateY(-4px)'}}
                    onMouseLeave={function(e){e.currentTarget.style.borderColor='rgba(0,0,0,.08)';e.currentTarget.style.background='#ffffff';e.currentTarget.style.transform='translateY(0)'}}>
                      <div style={{...BB,fontSize:m?36:48,color:A,opacity:.18,position:'absolute',top:m?12:16,right:m?14:20,lineHeight:1}}>{tile.icon}</div>
                      <div style={{...NB,fontSize:10,letterSpacing:'3px',textTransform:'uppercase',color:A,marginBottom:8}}>MODULE</div>
                      <div style={{...BB,fontSize:m?20:26,letterSpacing:'2px',color:'#1a1a2e',marginBottom:8}}>{tile.label.toUpperCase()}</div>
                      <div style={{...NB,fontSize:12,color:'#666',letterSpacing:'1px',lineHeight:1.5}}>{tile.desc}</div>
                      <div style={{marginTop:16,...NB,fontSize:10,letterSpacing:'2px',textTransform:'uppercase',color:A,display:'flex',alignItems:'center',gap:6}}>
                        Launch <span style={{fontSize:14}}>&#8594;</span>
                      </div>
                    </div>
                  )
                })}
                {isPortalAdmin&&(
                  <div onClick={function(){setPage('admin')}} style={{background:'#ffffff',backdropFilter:'blur(12px)',border:'1px solid rgba(0,0,0,.08)',padding:m?'24px 18px':'32px 28px',cursor:'pointer',transition:'all .3s',position:'relative',overflow:'hidden'}}
                    onMouseEnter={function(e){e.currentTarget.style.borderColor='rgba(249,115,22,.5)';e.currentTarget.style.background='rgba(249,115,22,.06)';e.currentTarget.style.transform='translateY(-4px)'}}
                    onMouseLeave={function(e){e.currentTarget.style.borderColor='rgba(0,0,0,.08)';e.currentTarget.style.background='#ffffff';e.currentTarget.style.transform='translateY(0)'}}>
                    <div style={{...BB,fontSize:m?36:48,color:A,opacity:.18,position:'absolute',top:m?12:16,right:m?14:20,lineHeight:1}}>&#9881;</div>
                    <div style={{...NB,fontSize:10,letterSpacing:'3px',textTransform:'uppercase',color:'#EF4444',marginBottom:8}}>ADMIN</div>
                    <div style={{...BB,fontSize:m?20:26,letterSpacing:'2px',color:'#1a1a2e',marginBottom:8}}>ADMIN DASHBOARD</div>
                    <div style={{...NB,fontSize:12,color:'#888',letterSpacing:'1px',lineHeight:1.5}}>Users, invites, access & site editor</div>
                    <div style={{marginTop:16,...NB,fontSize:10,letterSpacing:'2px',textTransform:'uppercase',color:'#EF4444',display:'flex',alignItems:'center',gap:6}}>
                      Manage <span style={{fontSize:14}}>&#8594;</span>
                    </div>
                  </div>
                )}
                {!isPortalAdmin&&(
                  <div onClick={function(){setPage('request')}} style={{background:'#ffffff',backdropFilter:'blur(12px)',border:'1px dashed rgba(249,115,22,.25)',padding:m?'24px 18px':'32px 28px',cursor:'pointer',transition:'all .3s'}}
                    onMouseEnter={function(e){e.currentTarget.style.borderColor='rgba(249,115,22,.5)'}}
                    onMouseLeave={function(e){e.currentTarget.style.borderColor='rgba(249,115,22,.25)'}}>
                    <div style={{...NB,fontSize:10,letterSpacing:'3px',textTransform:'uppercase',color:'#888',marginBottom:8}}>NEED ACCESS?</div>
                    <div style={{...BB,fontSize:m?20:26,letterSpacing:'2px',color:'#1a1a2e',marginBottom:8}}>REQUEST ACCESS</div>
                    <div style={{...NB,fontSize:12,color:'#888',letterSpacing:'1px',lineHeight:1.5}}>Request access to additional tools</div>
                  </div>
                )}
              </div>
              <div style={{marginTop:m?28:40,textAlign:'center'}}>
                <div style={{display:'inline-block',cursor:'pointer',...NB,fontSize:12,letterSpacing:'2px',textTransform:'uppercase',color:'#777',transition:'color .2s'}} onClick={function(){setPage('landing');setUser(null)}} onMouseEnter={function(e){e.target.style.color=A}} onMouseLeave={function(e){e.target.style.color='#777'}}>
                  &#8592; Sign Out & Return to Site
                </div>
              </div>
            </div>
          </div>
        )}


        {/* ══ ADMIN DASHBOARD ══ */}
        {page==='admin'&&isPortalAdmin&&(
          <div style={{minHeight:'100vh',position:'relative',zIndex:10,padding:m?'76px 14px 32px':'120px 48px 80px',background:'#f5f2ee'}}>
            <div style={{maxWidth:1200,margin:'0 auto'}}>
              <div style={{cursor:'pointer',display:'inline-flex',alignItems:'center',gap:8,...NB,fontSize:12,letterSpacing:'2px',textTransform:'uppercase',color:A,marginBottom:28}} onClick={function(){setPage('dashboard')}}>&#8592; Back to Dashboard</div>
              <div style={{...BB,fontSize:m?'clamp(32px,8vw,48px)':'clamp(40px,5vw,64px)',letterSpacing:2,color:'#1a1a2e',textShadow:'none',marginBottom:24}}>ADMIN DASHBOARD</div>
              <div style={{display:'flex',gap:8,marginBottom:20,flexWrap:'wrap'}}>
                {['invite','users','requests','editor'].map(function(t){return (
                  <div key={t} onClick={function(){setAdminTab2(t)}} style={{padding:'8px 18px',...NB,fontSize:12,letterSpacing:'2px',textTransform:'uppercase',cursor:'pointer',background:adminTab===t?A:'#ffffff',color:adminTab===t?'#fff':'#666',border:'1px solid '+(adminTab===t?A:'rgba(0,0,0,.1)'),transition:'all .2s'}}>{t==='editor'?'Site Editor':t}</div>
                )})}
              </div>
              {adminTab==='invite'&&<div style={{background:'#ffffff',backdropFilter:'blur(12px)',border:'1px solid rgba(0,0,0,.08)',padding:m?24:32}}>
                <div style={{...BB,fontSize:22,letterSpacing:2,color:'#1a1a2e',marginBottom:20}}>INVITE USER</div>
                <div style={{marginBottom:12}}><div style={{...NB,fontSize:10,letterSpacing:'3px',textTransform:'uppercase',color:A,marginBottom:4}}>NAME</div><input value={invForm.name} onChange={function(e){setInvForm(Object.assign({},invForm,{name:e.target.value}))}} style={{...IST}} onFocus={fIn} onBlur={fOut} placeholder="Full name"/></div>
                <div style={{marginBottom:12}}><div style={{...NB,fontSize:10,letterSpacing:'3px',textTransform:'uppercase',color:A,marginBottom:4}}>EMAIL</div><input value={invForm.email} onChange={function(e){setInvForm(Object.assign({},invForm,{email:e.target.value}))}} style={{...IST}} onFocus={fIn} onBlur={fOut} placeholder="name@sunriseconstructionco.com"/></div>
                <div style={{marginBottom:12}}>
                  <div style={{...NB,fontSize:10,letterSpacing:'3px',textTransform:'uppercase',color:A,marginBottom:4}}>ROLE</div>
                  <div style={{display:'flex',gap:8}}>
                    <div onClick={function(){setInvForm(Object.assign({},invForm,{role:'member'}))}} style={{padding:'8px 18px',...NB,fontSize:12,letterSpacing:'2px',cursor:'pointer',background:invForm.role==='member'?A:'transparent',color:invForm.role==='member'?'#1a1206':'#888',border:'1px solid '+(invForm.role==='member'?A:'rgba(0,0,0,.15)')}}>Member</div>
                    <div onClick={function(){setInvForm(Object.assign({},invForm,{role:'admin'}))}} style={{padding:'8px 18px',...NB,fontSize:12,letterSpacing:'2px',cursor:'pointer',background:invForm.role==='admin'?A:'transparent',color:invForm.role==='admin'?'#1a1206':'#888',border:'1px solid '+(invForm.role==='admin'?A:'rgba(0,0,0,.15)')}}>Admin</div>
                  </div>
                </div>
                <div style={{marginBottom:16}}>
                  <div style={{...NB,fontSize:10,letterSpacing:'3px',textTransform:'uppercase',color:A,marginBottom:6}}>TOOL ACCESS</div>
                  <div style={{display:'flex',flexWrap:'wrap',gap:6}}>
                    {Object.keys(TOOL_LABELS).map(function(tk){var on=invForm.tools.indexOf(tk)>=0;return (
                      <div key={tk} onClick={function(){var nt=on?invForm.tools.filter(function(x){return x!==tk}):invForm.tools.concat([tk]);setInvForm(Object.assign({},invForm,{tools:nt}))}} style={{padding:'6px 14px',...NB,fontSize:11,letterSpacing:'1px',cursor:'pointer',background:on?'rgba(249,115,22,.15)':'transparent',color:on?A:'#666',border:'1px solid '+(on?A:'rgba(0,0,0,.15)'),transition:'all .2s'}}>{TOOL_LABELS[tk]}</div>
                    )})}
                  </div>
                </div>
                <div style={{cursor:'pointer',background:A,color:'#1a1206',textAlign:'center',...NB,fontSize:14,fontWeight:700,letterSpacing:'3px',textTransform:'uppercase',padding:'14px 0'}} onClick={sendInvite}>SEND INVITE VIA GMAIL</div>
              </div>}
              {adminTab==='users'&&<div style={{background:'#ffffff',backdropFilter:'blur(12px)',border:'1px solid rgba(0,0,0,.08)',padding:m?16:24}}>
                <div style={{...BB,fontSize:22,letterSpacing:2,color:'#1a1a2e',marginBottom:16}}>USERS ({portalUsers.length})</div>
                {portalUsers.map(function(u2){return (
                  <div key={u2.id} style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'12px 0',borderBottom:'1px solid rgba(0,0,0,.06)',flexWrap:'wrap',gap:8}}>
                    <div>
                      <div style={{...NB,fontSize:14,color:'#1a1a2e',fontWeight:600}}>{u2.name}</div>
                      <div style={{...NB,fontSize:11,color:'#888'}}>{u2.email} · {u2.role}</div>
                      <div style={{...NB,fontSize:10,color:'#555',marginTop:2}}>Tools: {(u2.tools||[]).join(', ')}</div>
                    </div>
                    <div style={{display:'flex',gap:6}}>
                      <div onClick={function(){var nu=portalUsers.map(function(x){return x.id===u2.id?Object.assign({},x,{role:x.role==='admin'?'member':'admin'}):x});svPU(nu)}} style={{padding:'4px 12px',...NB,fontSize:10,letterSpacing:'1px',cursor:'pointer',background:u2.role==='admin'?'rgba(59,130,246,.15)':'rgba(234,179,8,.15)',color:u2.role==='admin'?'#60a5fa':'#eab308'}}>{u2.role==='admin'?'Demote':'Promote'}</div>
                      {u2.email!=='dustin.hanson@sunriseconstructionco.com'&&<div onClick={function(){svPU(portalUsers.filter(function(x){return x.id!==u2.id}))}} style={{padding:'4px 12px',...NB,fontSize:10,letterSpacing:'1px',cursor:'pointer',background:'rgba(239,68,68,.12)',color:'#ef4444'}}>Remove</div>}
                    </div>
                  </div>
                )})}
              </div>}
              {adminTab==='requests'&&<div style={{background:'#ffffff',backdropFilter:'blur(12px)',border:'1px solid rgba(0,0,0,.08)',padding:m?16:24}}>
                <div style={{...BB,fontSize:22,letterSpacing:2,color:'#1a1a2e',marginBottom:16}}>ACCESS REQUESTS</div>
                {accessReqs.filter(function(r){return r.status==='pending'}).length===0&&<div style={{...NB,fontSize:13,color:'#888'}}>No pending requests</div>}
                {accessReqs.slice().reverse().map(function(r){return (
                  <div key={r.id} style={{padding:'12px 0',borderBottom:'1px solid rgba(0,0,0,.06)'}}>
                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:8}}>
                      <div>
                        <div style={{...NB,fontSize:14,color:'#1a1a2e'}}>{r.userName} requests <span style={{color:A}}>{TOOL_LABELS[r.tool]||r.tool}</span></div>
                        <div style={{...NB,fontSize:11,color:'#888'}}>{r.reason}</div>
                        <div style={{...NB,fontSize:10,color:'#555'}}>{new Date(r.createdAt).toLocaleDateString()}</div>
                      </div>
                      {r.status==='pending'&&<div style={{display:'flex',gap:6}}>
                        <div onClick={function(){approveReq(r.id)}} style={{padding:'4px 14px',...NB,fontSize:11,cursor:'pointer',background:'rgba(34,197,94,.15)',color:'#22c55e'}}>Approve</div>
                        <div onClick={function(){denyReq(r.id)}} style={{padding:'4px 14px',...NB,fontSize:11,cursor:'pointer',background:'rgba(239,68,68,.12)',color:'#ef4444'}}>Deny</div>
                      </div>}
                      {r.status!=='pending'&&<div style={{...NB,fontSize:11,color:r.status==='approved'?'#22c55e':'#ef4444'}}>{r.status.toUpperCase()}</div>}
                    </div>
                  </div>
                )})}
              </div>}
              {adminTab==='editor'&&<div style={{background:'#ffffff',backdropFilter:'blur(12px)',border:'1px solid rgba(0,0,0,.08)',padding:m?16:24}}>
                <div style={{...BB,fontSize:22,letterSpacing:2,color:'#1a1a2e',marginBottom:16}}>SITE EDITOR</div>
                <div style={{...NB,fontSize:11,color:'#888',marginBottom:16}}>Changes save automatically. Refresh to see updates on landing page.</div>
                {[{k:'heroTitle',l:'HERO TITLE'},{k:'heroSub',l:'HERO SUBTITLE'},{k:'contactEmail',l:'CONTACT EMAIL'},{k:'contactPhone',l:'CONTACT PHONE'},{k:'contactAddr',l:'CONTACT ADDRESS'},{k:'portalTitle',l:'PORTAL LOGIN TITLE'}].map(function(f){return (
                  <div key={f.k} style={{marginBottom:14}}>
                    <div style={{...NB,fontSize:10,letterSpacing:'3px',textTransform:'uppercase',color:A,marginBottom:4}}>{f.l}</div>
                    {f.k==='heroSub'||f.k==='contactAddr'?<textarea value={siteSettings[f.k]||''} onChange={function(e){var ns=Object.assign({},siteSettings);ns[f.k]=e.target.value;svSite(ns)}} rows={2} style={{...IST,resize:'vertical'}}/>:<input value={siteSettings[f.k]||''} onChange={function(e){var ns=Object.assign({},siteSettings);ns[f.k]=e.target.value;svSite(ns)}} style={{...IST}} onFocus={fIn} onBlur={fOut}/>}
                  </div>
                )})}
              </div>}
            </div>
          </div>
        )}

        {/* ══ REQUEST ACCESS ══ */}
        {page==='request'&&!isPortalAdmin&&(
          <div style={{minHeight:'100vh',position:'relative',zIndex:10,padding:m?'76px 14px 32px':'120px 48px 80px'}}>
            <div style={{maxWidth:600,margin:'0 auto'}}>
              <div style={{cursor:'pointer',display:'inline-flex',alignItems:'center',gap:8,...NB,fontSize:12,letterSpacing:'2px',textTransform:'uppercase',color:A,marginBottom:28}} onClick={function(){setPage('dashboard')}}>&#8592; Back</div>
              <div style={{...BB,fontSize:m?28:40,letterSpacing:2,color:'#1a1a2e',textShadow:'none',marginBottom:24}}>REQUEST ACCESS</div>
              <div style={{background:'#ffffff',backdropFilter:'blur(12px)',border:'1px solid rgba(0,0,0,.08)',padding:m?24:32}}>
                <div style={{marginBottom:16}}>
                  <div style={{...NB,fontSize:10,letterSpacing:'3px',textTransform:'uppercase',color:A,marginBottom:6}}>SELECT TOOL</div>
                  <div style={{display:'flex',flexWrap:'wrap',gap:6}}>
                    {Object.keys(TOOL_LABELS).filter(function(tk){return !hasTool(tk)}).map(function(tk){return (
                      <div key={tk} onClick={function(){setReqTool(tk)}} style={{padding:'6px 14px',...NB,fontSize:11,letterSpacing:'1px',cursor:'pointer',background:reqTool===tk?'rgba(249,115,22,.15)':'transparent',color:reqTool===tk?A:'#666',border:'1px solid '+(reqTool===tk?A:'#444')}}>{TOOL_LABELS[tk]}</div>
                    )})}
                  </div>
                  {Object.keys(TOOL_LABELS).filter(function(tk){return !hasTool(tk)}).length===0&&<div style={{...NB,fontSize:13,color:'#22c55e'}}>You have access to all tools!</div>}
                </div>
                <div style={{marginBottom:16}}>
                  <div style={{...NB,fontSize:10,letterSpacing:'3px',textTransform:'uppercase',color:A,marginBottom:4}}>REASON</div>
                  <textarea value={reqReason} onChange={function(e){setReqReason(e.target.value)}} rows={3} style={{...IST,resize:'vertical'}} placeholder="Why do you need access to this tool?"/>
                </div>
                <div style={{cursor:'pointer',background:reqTool&&reqReason.trim()?A:'#444',color:reqTool&&reqReason.trim()?'#1a1206':'#888',textAlign:'center',...NB,fontSize:14,fontWeight:700,letterSpacing:'3px',textTransform:'uppercase',padding:'14px 0'}} onClick={function(){if(reqTool&&reqReason.trim()){submitAccessReq()}}}>SUBMIT REQUEST</div>
              </div>
              {accessReqs.filter(function(r){return r.userId===(user?user.id:'')}).length>0&&<div style={{marginTop:20}}>
                <div style={{...NB,fontSize:12,letterSpacing:'2px',color:'#888',marginBottom:8}}>YOUR REQUESTS</div>
                {accessReqs.filter(function(r){return r.userId===(user?user.id:'')}).map(function(r){return (
                  <div key={r.id} style={{background:'rgba(8,8,20,.5)',padding:'10px 14px',marginBottom:6,display:'flex',justifyContent:'space-between',...NB,fontSize:12}}>
                    <span style={{color:'#F5F0EB'}}>{TOOL_LABELS[r.tool]||r.tool}</span>
                    <span style={{color:r.status==='approved'?'#22c55e':r.status==='denied'?'#ef4444':'#eab308'}}>{r.status.toUpperCase()}</span>
                  </div>
                )})}
              </div>}
            </div>
          </div>
        )}

        {/* ══════════════════════════════════════════════
            MODULE PLACEHOLDER PAGES
            ══════════════════════════════════════════════ */}
        {page==='precon'&&<PreConControls onExit={function(){setPage('dashboard')}} portalUser={user&&user.name?user.name:user}/>}
        {page==='equipment'&&<EquipmentManager onExit={function(){setPage('dashboard')}} portalUser={user&&user.name?user.name:user}/>}
        {page==='field'&&(function(){
          var em=(user&&user.email)||(user&&user.name)||user||'';
          var nm=(user&&user.name)||(user&&user.email)||user||'';
          var src='/field-reporting.html?u='+encodeURIComponent(em)+'&n='+encodeURIComponent(nm);
          return <div style={{position:'fixed',inset:0,zIndex:2000,background:'#0F4C81'}}>
            <iframe src={src} style={{width:'100%',height:'100%',border:'none'}} allow="camera;microphone;fullscreen" title="Field Reporting"/>
          </div>;
        })()}
        {page==='hr'&&<div style={{position:'fixed',inset:0,zIndex:2000,background:'#f5f2ee',overflow:'auto'}}><ScreeningSolutions onExit={function(){setPage('dashboard')}} portalUser={user||null}/></div>}
        {page==='stakeholders'&&<StakeholderReports onExit={function(){setPage('dashboard')}}/>}
        {page==='compliance'&&<ComplianceCenter onExit={function(){setPage('dashboard')}}/>}
        {page==='timekeeping'&&<TimekeepingModule onExit={function(){setPage('dashboard')}} portalUser={user||null}/>}
        {page==='crm'&&<CRMModule onExit={function(){setPage('dashboard')}}/>}
        {page==='sitemap'&&<div style={{position:'fixed',inset:0,zIndex:2000,background:'#f5f2ee',overflow:'auto'}}><SiteMap onExit={function(){setPage('dashboard')}}/></div>}
        {page==='pileplan'&&<PilePlan onExit={function(){setPage('dashboard')}}/>}
        {['hse'].includes(page)&&(
          <div style={{minHeight:'100vh',position:'relative',zIndex:10,padding:m?'76px 14px 32px':'120px 48px 80px'}}>
            <div style={{maxWidth:1200,margin:'0 auto'}}>
              <div style={{cursor:'pointer',display:'inline-flex',alignItems:'center',gap:8,...NB,fontSize:12,letterSpacing:'2px',textTransform:'uppercase',color:A,marginBottom:28,transition:'opacity .2s'}} onClick={()=>setPage('dashboard')} onMouseEnter={e=>e.currentTarget.style.opacity='.7'} onMouseLeave={e=>e.currentTarget.style.opacity='1'}>
                ← Back to Dashboard
              </div>
              <div style={{...BB,fontSize:m?'clamp(32px,8vw,48px)':'clamp(40px,5vw,64px)',letterSpacing:2,color:'#1a1a2e',textShadow:'none',marginBottom:16}}>
                HS&E
              </div>
              <div style={{...NB,fontSize:14,color:'#666',letterSpacing:'1.5px'}}>Module content coming soon.</div>
            </div>
          </div>
        )}

        {/* ── LANDING PAGE CONTENT ── */}
        {page==='landing'&&<>
        {/* ── HERO ── */}
        <section style={{minHeight:'100vh',display:'flex',flexDirection:'column',justifyContent:'center',position:'relative',padding:m?'90px 24px 60px':'120px 48px 80px',zIndex:5}}>
          <div style={{maxWidth:m?'100%':1200,margin:'0 auto',width:'100%'}}>
            <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:16,...NB,fontSize:m?10:12,letterSpacing:'4px',textTransform:'uppercase',color:A}}>
              <div style={{width:28,height:1,background:A}}/>Elite Solar Subcontractor
            </div>
            <h1 style={{...BB,fontSize:m?'clamp(58px,16vw,88px)':'clamp(70px,10.5vw,155px)',lineHeight:.9,letterSpacing:2,color:'#F5F0EB',textShadow:'0 2px 8px rgba(0,0,0,1), 0 0 20px rgba(0,0,0,0.9)'}}>
              <span style={{display:'block',WebkitTextFillColor:'transparent',WebkitTextStroke:'2.5px rgba(245,240,235,.65)',textShadow:'0 0 18px rgba(249,115,22,.35)'}}>WE</span>
              <span style={{display:'block',color:'#F5F0EB',textShadow:'0 0 80px rgba(249,115,22,.28)'}}>DOMINATE</span>
              <span style={{display:'block',WebkitTextFillColor:'transparent',WebkitTextStroke:'2.5px rgba(245,240,235,.65)',textShadow:'0 0 18px rgba(249,115,22,.35)'}}>SOLAR</span>
            </h1>
            <p style={{fontSize:m?15:17,fontWeight:300,color:'#666',maxWidth:460,lineHeight:1.75,margin:m?'18px 0':'26px 0'}}>
              The technical powerhouse delivering dominance, precision, and efficiency for the nation's largest utility-scale projects.
            </p>
            <div style={{display:'flex',gap:m?14:20,alignItems:'center',flexWrap:'wrap'}}>
              <a href="#contact" style={{display:'inline-flex',alignItems:'center',gap:10,background:A,color:'#1a1206',...NB,fontSize:m?12:14,fontWeight:700,letterSpacing:'3px',textTransform:'uppercase',textDecoration:'none',padding:m?'13px 24px':'15px 34px',clipPath:'polygon(12px 0%,100% 0%,calc(100% - 12px) 100%,0% 100%)',transition:'all .25s'}} onMouseEnter={e=>{e.currentTarget.style.background='#FB923C'}} onMouseLeave={e=>{e.currentTarget.style.background=A}}>
                Partner Now →
              </a>
              <a href="#portfolio" style={{...NB,fontSize:m?12:13,letterSpacing:'2.5px',textTransform:'uppercase',color:'#666',textDecoration:'none',borderBottom:'1px solid rgba(255,255,255,.2)',paddingBottom:3,transition:'color .2s'}}>
                View Portfolio →
              </a>
            </div>

            {/* Stats — inline on mobile, absolute on desktop */}
            {m?(
              <div style={{display:'flex',gap:32,marginTop:36,paddingTop:28,borderTop:'1px solid rgba(255,255,255,.06)'}}>
                {[{n:'500+',l:'MW Combined Experience'},{n:'1.2M+',l:'Modules Placed'},{n:'9',l:'States'}].map(s=>(
                  <div key={s.n}>
                    <div style={{...BB,fontSize:32,color:A,lineHeight:1}}>{s.n}</div>
                    <div style={{...NB,fontSize:9,letterSpacing:'2px',textTransform:'uppercase',color:'#ccc',textShadow:'0 1px 3px rgba(0,0,0,0.95), 0 0 12px rgba(0,0,0,1)',marginTop:3}}>{s.l}</div>
                  </div>
                ))}
              </div>
            ):(
              <div style={{position:'absolute',right:48,bottom:'14%',display:'flex',flexDirection:'column',gap:26}}>
                {[{n:'500+',l:'Megawatts Installed'},{n:'1.2M+',l:'Modules Placed'}].map(s=>(
                  <div key={s.n} style={{textAlign:'right'}}>
                    <div style={{...BB,fontSize:50,color:A,lineHeight:1,textShadow:'0 0 30px rgba(249,115,22,.4)'}}>{s.n}</div>
                    <div style={{...NB,fontSize:11,letterSpacing:'3px',textTransform:'uppercase',color:'#ccc',textShadow:'0 1px 3px rgba(0,0,0,0.95), 0 0 12px rgba(0,0,0,1)',marginTop:4}}>{s.l}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Scroll indicator — desktop only */}
          {!m&&<div style={{position:'absolute',bottom:34,left:48,display:'flex',alignItems:'center',gap:12,...NB,fontSize:11,letterSpacing:'3px',textTransform:'uppercase',color:'#bbb',textShadow:'0 1px 3px rgba(0,0,0,0.95), 0 0 12px rgba(0,0,0,1)'}}>
            <div style={{width:38,height:1,background:'#333',overflow:'hidden',position:'relative'}}><div style={{position:'absolute',inset:0,background:A,animation:'scrollLine 2s ease-in-out infinite'}}/></div>Scroll
          </div>}
        </section>

        {/* ── STATS ── */}
        <Sec id="stats" style={{padding:m?'32px 20px':'56px 48px'}}>
          <div style={{maxWidth:1100,margin:'0 auto',background:'rgba(2,2,12,.82)',backdropFilter:'blur(16px)',border:'1px solid rgba(249,115,22,.1)',padding:m?'28px 20px':'46px 40px'}}>
            <div style={{textAlign:'center',marginBottom:m?22:32}}>
              <div style={{...NB,fontSize:m?10:11,letterSpacing:'4px',textTransform:'uppercase',color:A,marginBottom:8,display:'inline-flex',alignItems:'center',gap:12}}>
                <div style={{width:22,height:1,background:A}}/>our team has combined experience over:<div style={{width:22,height:1,background:A}}/>
              </div>
            </div>
            {m?(
              <div style={{display:'flex',justifyContent:'space-around',gap:16}}>
                {[{n:'500+',l:'MW Combined Experience'},{n:'1.2M+',l:'Modules Placed'},{n:'9',l:'States Worked'},{n:'0',l:'Schedule Slippage'}].map(s=>(
                  <div key={s.n} style={{textAlign:'center'}}>
                    <div style={{...BB,fontSize:38,color:'#F5F0EB',lineHeight:1}}>{s.n}</div>
                    <div style={{...NB,fontSize:9,letterSpacing:'2px',textTransform:'uppercase',color:'#ccc',textShadow:'0 1px 3px rgba(0,0,0,0.95), 0 0 12px rgba(0,0,0,1)',marginTop:6}}>{s.l}</div>
                  </div>
                ))}
              </div>
            ):(
              <div style={{display:'grid',gridTemplateColumns:'1fr auto 1fr auto 1fr auto 1fr',alignItems:'center'}}>
                <div style={{textAlign:'center'}}><div style={{...BB,fontSize:60,color:'#F5F0EB',lineHeight:1}}>500+</div><div style={{...NB,fontSize:11,letterSpacing:'3px',textTransform:'uppercase',color:'#ccc',textShadow:'0 1px 3px rgba(0,0,0,0.95), 0 0 12px rgba(0,0,0,1)',marginTop:8}}>Megawatts Our Team Installed</div></div>
                <div style={{width:1,height:70,background:'linear-gradient(to bottom,transparent,rgba(249,115,22,.4),transparent)',margin:'0 12px'}}/>
                <div style={{textAlign:'center'}}><div style={{...BB,fontSize:60,color:'#F5F0EB',lineHeight:1}}>1.2M+</div><div style={{...NB,fontSize:11,letterSpacing:'3px',textTransform:'uppercase',color:'#ccc',textShadow:'0 1px 3px rgba(0,0,0,0.95), 0 0 12px rgba(0,0,0,1)',marginTop:8}}>Modules Team Placed</div></div>
                <div style={{width:1,height:70,background:'linear-gradient(to bottom,transparent,rgba(249,115,22,.4),transparent)',margin:'0 12px'}}/>
                <div style={{textAlign:'center'}}><div style={{...BB,fontSize:60,color:'#F5F0EB',lineHeight:1}}>9</div><div style={{...NB,fontSize:11,letterSpacing:'3px',textTransform:'uppercase',color:'#ccc',textShadow:'0 1px 3px rgba(0,0,0,0.95), 0 0 12px rgba(0,0,0,1)',marginTop:8}}>States Team Worked</div></div>
                <div style={{width:1,height:70,background:'linear-gradient(to bottom,transparent,rgba(249,115,22,.4),transparent)',margin:'0 12px'}}/>
                <div style={{textAlign:'center'}}><div style={{...BB,fontSize:60,color:A,lineHeight:1,textShadow:'0 0 24px rgba(249,115,22,.4)'}}>0</div><div style={{...NB,fontSize:11,letterSpacing:'3px',textTransform:'uppercase',color:'#ccc',textShadow:'0 1px 3px rgba(0,0,0,0.95), 0 0 12px rgba(0,0,0,1)',marginTop:8}}>Schedule Slippage</div></div>
              </div>
            )}
          </div>
        </Sec>

        {/* ── SERVICES ── */}
        <Sec id="services">
          <div style={{maxWidth:1200,margin:'0 auto'}}>
            <div style={{...NB,fontSize:11,letterSpacing:'4px',textTransform:'uppercase',color:A,marginBottom:14,display:'flex',alignItems:'center',gap:12}}>
              <div style={{width:22,height:1,background:A}}/>Our Core Scope
            </div>
            <h2 style={{...BB,fontSize:'clamp(36px,8vw,76px)',letterSpacing:2,marginBottom:m?18:24,color:'#F5F0EB',textShadow:'0 2px 8px rgba(0,0,0,1), 0 0 20px rgba(0,0,0,0.9)'}}>TURNKEY MECHANICAL INSTALLATION</h2>
            <p style={{...NB,fontSize:m?16:19,fontWeight:300,color:'#E8E2DC',lineHeight:1.7,marginBottom:m?18:24,maxWidth:860}}>We provide <strong style={{color:A,fontWeight:600}}>transparent, turnkey mechanical installation services for EPCs in the solar sector</strong> &mdash; piles, racking, modules, and trackers delivered with real-time proof.</p>
            <p style={{...NB,fontSize:m?14:15,fontWeight:300,color:'#9C9690',lineHeight:1.7,maxWidth:760,fontStyle:'italic'}}>Beyond the core scope, our team and partners offer supporting services to round out full-scope construction solutions.</p>
            <ExtendedServices m={m} A={A} BB={BB} NB={NB}/>
          </div>
        </Sec>

        {/* ── SAFETY ── */}
        <Sec id="safety">
          <div style={{maxWidth:1200,margin:'0 auto'}}>
            <div style={{...NB,fontSize:11,letterSpacing:'4px',textTransform:'uppercase',color:A,marginBottom:14,display:'flex',alignItems:'center',gap:12}}>
              <div style={{width:22,height:1,background:A}}/>Our Commitment
            </div>
            <h2 style={{...BB,fontSize:'clamp(36px,8vw,76px)',letterSpacing:2,marginBottom:m?28:48,color:'#F5F0EB',textShadow:'0 2px 8px rgba(0,0,0,1), 0 0 20px rgba(0,0,0,0.9)'}}>SAFETY &amp; QUALITY FIRST</h2>
            <div style={{display:'grid',gridTemplateColumns:m?'1fr':'1fr 1fr',gap:m?32:68,alignItems:'center'}}>
              <div>
                <p style={{fontSize:m?15:17,fontWeight:300,color:'#666',lineHeight:1.8,marginBottom:18}}>Getting it done right the first time through leading communication and transparency.</p>
                <p style={{fontSize:m?15:17,fontWeight:300,color:'#666',lineHeight:1.8,marginBottom:m?20:28}}>Our commitment to excellence drives every pile we drive and every module we secure — with zero compromise.</p>
                <div>{['ISNetworld Certified','OSHA Compliant','Apprenticeship Enabled','Safety First Promise','Zero Tolerance'].map(t=>(
                  <span key={t} style={{display:'inline-block',padding:'6px 14px',border:'1px solid rgba(249,115,22,.28)',fontSize:m?9:11,letterSpacing:'2px',textTransform:'uppercase',color:A,...NB,background:'rgba(249,115,22,.05)',clipPath:'polygon(6px 0%,100% 0%,calc(100% - 6px) 100%,0% 100%)',margin:'3px 2px'}}>{t}</span>
                ))}</div>
              </div>
              <div style={{display:'grid',gridTemplateColumns:m?'1fr 1fr':'1fr 1fr 1fr',gap:m?6:10}}>
                {[{n:'100%',l:'Compliance',hi:false},{n:'0',l:'Incidents',hi:true},{n:'A+',l:'Safety Rating',hi:false},{n:'24/7',l:'Oversight',hi:false},{n:'CREW\nFIRST',l:'Culture',hi:false},{n:'TOP\nTIER',l:'Training',hi:false}].map(s=>(
                  <div key={s.l} style={{height:m?80:102,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',background:s.hi?'rgba(249,115,22,.08)':'rgba(8,8,20,.55)',backdropFilter:'blur(8px)',border:'1px solid '+(s.hi?'rgba(249,115,22,.4)':'rgba(249,115,22,.18)'),transition:'all .3s'}}>
                    <div style={{...BB,fontSize:s.n.includes('\n')?(m?16:22):(m?22:30),color:A,lineHeight:1.1,textAlign:'center',whiteSpace:'pre-line'}}>{s.n}</div>
                    <div style={{...NB,fontSize:m?8:10,letterSpacing:'1px',textTransform:'uppercase',color:'#ccc',textShadow:'0 1px 3px rgba(0,0,0,0.95), 0 0 12px rgba(0,0,0,1)',marginTop:3}}>{s.l}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Sec>

        {/* ── CAPABILITIES ── */}
        <Sec id="capabilities">
          <div style={{maxWidth:1200,margin:'0 auto'}}>
            <div style={{...NB,fontSize:11,letterSpacing:'4px',textTransform:'uppercase',color:A,marginBottom:14,display:'flex',alignItems:'center',gap:12}}>
              <div style={{width:22,height:1,background:A}}/>What We Deliver
            </div>
            <h2 style={{...BB,fontSize:'clamp(36px,8vw,76px)',letterSpacing:2,marginBottom:m?24:48,color:'#F5F0EB',textShadow:'0 2px 8px rgba(0,0,0,1), 0 0 20px rgba(0,0,0,0.9)'}}>CAPABILITIES</h2>
            <div style={{display:'grid',gridTemplateColumns:m?'1fr':'repeat(3,1fr)',gap:2}}>
              {CAPS.map((c,ci)=><CapCard key={ci} c={c} ci={ci}/>)}
            </div>
          </div>
        </Sec>

        {/* ── PORTFOLIO ── */}
        <Sec id="portfolio">
          <div style={{maxWidth:1200,margin:'0 auto'}}>
            <div style={{display:'flex',alignItems:'flex-end',justifyContent:'space-between',marginBottom:m?24:48,flexWrap:'wrap',gap:14}}>
              <div>
                <div style={{...NB,fontSize:11,letterSpacing:'4px',textTransform:'uppercase',color:A,marginBottom:12,display:'flex',alignItems:'center',gap:12}}>
                  <div style={{width:22,height:1,background:A}}/>Track Record
                </div>
                <h2 style={{...BB,fontSize:'clamp(36px,8vw,76px)',letterSpacing:2,color:'#F5F0EB',textShadow:'0 2px 8px rgba(0,0,0,1), 0 0 20px rgba(0,0,0,0.9)'}}>PROJECT PORTFOLIO</h2>
                <p style={{...NB,fontSize:m?14:16,lineHeight:1.7,color:'#ccc',textShadow:'0 1px 4px rgba(0,0,0,0.9)',marginBottom:m?20:32,maxWidth:600}}>Our team's personal portfolio's.</p>
              </div>
              {!m&&<p style={{maxWidth:280,fontSize:15,fontWeight:300,color:'#ccc',textShadow:'0 1px 3px rgba(0,0,0,0.95), 0 0 12px rgba(0,0,0,1)',lineHeight:1.7}}></p>}
            </div>
            <div style={{display:'grid',gridTemplateColumns:m?'1fr':mob?'1fr 1fr':'repeat(3,1fr)',gap:2}}>
              {PROJS.map((p,i)=><ProjectCard key={p.name} p={p} i={i}/>)}
            </div>
          </div>
        </Sec>

        {/* ── TRACKING / SITE PROGRESS MAP ── */}
        <Sec id="tracking">
          <div style={{maxWidth:1400,margin:'0 auto'}}>
            <img src="/site-progress-map.jpg" alt="Site Progress Map" style={{width:'100%',height:'auto',display:'block'}}/>
            <div style={{display:'grid',gridTemplateColumns:m?'1fr':'1fr 1fr',gap:m?14:20,marginTop:m?14:20}}>
              <div style={{position:'relative',overflow:'hidden',border:'1px solid rgba(249,115,22,.18)',background:'rgba(8,8,20,.65)',backdropFilter:'blur(8px)'}}>
                <GLBViewer src="/models/midway.glb" height={m?200:280}/>
                <div style={{position:'absolute',top:10,left:12,...NB,fontSize:9,letterSpacing:'2px',textTransform:'uppercase',color:'rgba(249,115,22,.7)',pointerEvents:'none'}}>▲ LIVE SITE MODEL</div>
                <div style={{position:'absolute',bottom:10,right:12,...NB,fontSize:9,letterSpacing:'1.5px',textTransform:'uppercase',color:'rgba(249,115,22,.55)',pointerEvents:'none'}}>MIDWAY · 11/4/25</div>
                <div style={{position:'absolute',inset:0,background:'radial-gradient(ellipse at center,transparent 55%,rgba(0,0,0,.45) 100%)',pointerEvents:'none'}}/>
              </div>
              <div style={{display:'flex',flexDirection:'column',justifyContent:'center',padding:m?'20px 0':0}}>
                <p style={{fontSize:m?14:16,fontWeight:300,color:'#777',lineHeight:1.8,marginBottom:12}}>Precision is the backbone of utility-scale operations. Our industry-leading production tracking provides EPCs with absolute transparency — position by position, scope by scope.</p>
                <div style={{display:'inline-flex',alignItems:'center',gap:14,background:'rgba(249,115,22,.07)',border:'1px solid rgba(249,115,22,.2)',padding:m?'14px 20px':'18px 28px',clipPath:'polygon(12px 0%,100% 0%,calc(100% - 12px) 100%,0% 100%)',alignSelf:'flex-start'}}>
                  <div style={{...BB,fontSize:m?38:50,color:A,lineHeight:1}}>99.8<span style={{fontSize:m?18:24}}>%</span></div>
                  <div style={{...NB,fontSize:m?10:12,letterSpacing:'2px',textTransform:'uppercase',color:'#666'}}>Production<br/>Tracking Accuracy</div>
                </div>
              </div>
            </div>
          </div>
        </Sec>

        {/* ── COVERAGE ── */}
        <div style={{background:A,padding:m?'20px 20px':'28px 48px',display:'flex',alignItems:'center',justifyContent:'center',gap:m?12:34,flexWrap:'wrap',position:'relative',zIndex:5}}>
          {['National Coverage','Utility-Scale','ISNet Compliant','Safety First'].map(t=>(
            <div key={t} style={{display:'flex',alignItems:'center',gap:8,...NB,fontSize:m?10:13,letterSpacing:m?'2px':'3px',textTransform:'uppercase',color:'#fff',textShadow:'none',fontWeight:700}}>
              <div style={{width:4,height:4,background:'#fff',borderRadius:'50%'}}/>{t}
            </div>
          ))}
          <a href="#contact" style={{background:'#080808',color:A,padding:m?'10px 20px':'12px 32px',...NB,fontSize:m?11:13,fontWeight:700,letterSpacing:'3px',textTransform:'uppercase',textDecoration:'none',clipPath:'polygon(8px 0%,100% 0%,calc(100% - 8px) 100%,0% 100%)'}} onMouseEnter={e=>e.currentTarget.style.background='#1a1a1a'} onMouseLeave={e=>e.currentTarget.style.background='#080808'}>Partner Now →</a>
        </div>

        {/* ── CONTACT ── */}
        <Sec id="contact">
          <div style={{maxWidth:1200,margin:'0 auto',display:'grid',gridTemplateColumns:m?'1fr':'1fr 1fr',gap:m?36:88}}>
            <div>
              <div style={{...NB,fontSize:11,letterSpacing:'4px',textTransform:'uppercase',color:A,marginBottom:14,display:'flex',alignItems:'center',gap:12}}>
                <div style={{width:22,height:1,background:A}}/>Make a Connection
              </div>
              <h2 style={{...BB,fontSize:'clamp(32px,7vw,66px)',letterSpacing:2,marginBottom:m?20:34,color:'#F5F0EB',textShadow:'0 2px 8px rgba(0,0,0,1), 0 0 20px rgba(0,0,0,0.9)'}}>GET IN TOUCH</h2>
              {[{l:'Headquarters',v:'12856 N Hwy 183, Ste B PMB 2011\nAustin, TX 78750'},{l:'Phone',v:'+1 (619) 870-4491'},{l:'Email',v:'Kaleb.LeBaron@sunriseconstructionco.com'}].map(c=>(
                <div key={c.l} style={{padding:'16px 0',borderBottom:'1px solid rgba(255,255,255,.06)'}}>
                  <div style={{...NB,fontSize:10,letterSpacing:'3px',textTransform:'uppercase',color:A,marginBottom:4}}>{c.l}</div>
                  <div style={{fontSize:m?13:15,fontWeight:300,color:'#F5F0EB',whiteSpace:'pre-line',wordBreak:'break-all'}}>{c.v}</div>
                </div>
              ))}
            </div>
            <div>
              <div style={{...NB,fontSize:11,letterSpacing:'4px',textTransform:'uppercase',color:A,marginBottom:18,display:'flex',alignItems:'center',gap:12}}>
                <div style={{width:22,height:1,background:A}}/>Start a Conversation
              </div>
              {contactSubmitted?(
                <div style={{background:'rgba(34,197,94,.12)',border:'1px solid rgba(34,197,94,.3)',padding:m?'24px 20px':'32px 28px',textAlign:'center'}}>
                  <div style={{...BB,fontSize:28,letterSpacing:2,color:'#22c55e',marginBottom:8}}>MESSAGE SENT</div>
                  <div style={{...NB,fontSize:14,color:'#ccc'}}>Thank you for reaching out. Our team will be in touch shortly.</div>
                  <div onClick={function(){setContactSubmitted(false);setContactForm({firstName:'',lastName:'',company:'',email:'',details:''})}} style={{display:'inline-block',marginTop:16,...NB,fontSize:12,letterSpacing:'2px',color:A,cursor:'pointer'}}>Send Another Message</div>
                </div>
              ):(
              <div style={{display:'flex',flexDirection:'column',gap:12}}>
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
                  <div>
                    <div style={{...NB,fontSize:10,letterSpacing:'2px',textTransform:'uppercase',color:'#ccc',textShadow:'0 1px 3px rgba(0,0,0,0.95), 0 0 12px rgba(0,0,0,1)',marginBottom:6}}>First Name</div>
                    <input value={contactForm.firstName} onChange={function(e){setContactForm(Object.assign({},contactForm,{firstName:e.target.value}))}} placeholder="John" style={IST} onFocus={fIn} onBlur={fOut}/>
                  </div>
                  <div>
                    <div style={{...NB,fontSize:10,letterSpacing:'2px',textTransform:'uppercase',color:'#ccc',textShadow:'0 1px 3px rgba(0,0,0,0.95), 0 0 12px rgba(0,0,0,1)',marginBottom:6}}>Last Name</div>
                    <input value={contactForm.lastName} onChange={function(e){setContactForm(Object.assign({},contactForm,{lastName:e.target.value}))}} placeholder="Smith" style={IST} onFocus={fIn} onBlur={fOut}/>
                  </div>
                </div>
                <div>
                  <div style={{...NB,fontSize:10,letterSpacing:'2px',textTransform:'uppercase',color:'#ccc',textShadow:'0 1px 3px rgba(0,0,0,0.95), 0 0 12px rgba(0,0,0,1)',marginBottom:6}}>Company / EPC</div>
                  <input value={contactForm.company} onChange={function(e){setContactForm(Object.assign({},contactForm,{company:e.target.value}))}} placeholder="Company Name" style={IST} onFocus={fIn} onBlur={fOut}/>
                </div>
                <div>
                  <div style={{...NB,fontSize:10,letterSpacing:'2px',textTransform:'uppercase',color:'#ccc',textShadow:'0 1px 3px rgba(0,0,0,0.95), 0 0 12px rgba(0,0,0,1)',marginBottom:6}}>Email</div>
                  <input type="email" value={contactForm.email} onChange={function(e){setContactForm(Object.assign({},contactForm,{email:e.target.value}))}} placeholder="john@company.com" style={IST} onFocus={fIn} onBlur={fOut}/>
                </div>
                <div>
                  <div style={{...NB,fontSize:10,letterSpacing:'2px',textTransform:'uppercase',color:'#ccc',textShadow:'0 1px 3px rgba(0,0,0,0.95), 0 0 12px rgba(0,0,0,1)',marginBottom:6}}>Project Details</div>
                  <textarea value={contactForm.details} onChange={function(e){setContactForm(Object.assign({},contactForm,{details:e.target.value}))}} placeholder="MW capacity, location, timeline..." style={{...IST,minHeight:m?80:105,resize:'vertical'}} onFocus={fIn} onBlur={fOut}/>
                </div>
                <div onClick={function(){if(!contactForm.firstName||!contactForm.email){return}var sub=Object.assign({},contactForm,{id:uid(),submittedAt:new Date().toISOString(),type:'partner'});sGet('contact_submissions').then(function(prev){sSet('contact_submissions',(prev||[]).concat([sub]))});setContactSubmitted(true)}} onMouseEnter={function(e){e.currentTarget.style.background='#FB923C'}} onMouseLeave={function(e){e.currentTarget.style.background=contactForm.firstName&&contactForm.email?A:'rgba(249,115,22,.3)'}} style={{display:'inline-flex',alignItems:'center',gap:10,background:contactForm.firstName&&contactForm.email?A:'rgba(249,115,22,.3)',color:contactForm.firstName&&contactForm.email?'#1a1206':'#888',cursor:contactForm.firstName&&contactForm.email?'pointer':'default',...NB,fontSize:m?12:14,fontWeight:700,letterSpacing:'3px',textTransform:'uppercase',padding:m?'13px 24px':'15px 34px',border:'none',clipPath:'polygon(12px 0%,100% 0%,calc(100% - 12px) 100%,0% 100%)',transition:'all .25s',alignSelf:'flex-start'}}>
                  Send Message →
                </div>
              </div>
              )}
            </div>
          </div>
        </Sec>

        {/* ── FOOTER ── */}
        {/* ── CAREERS ── */}
        <Sec id="careers">
          <div style={{maxWidth:900,margin:'0 auto'}}>
            <div style={{...NB,fontSize:12,letterSpacing:'4px',textTransform:'uppercase',color:A,marginBottom:14,display:'flex',alignItems:'center',gap:12}}>
              <div style={{width:22,height:1,background:A}}/>Join Our Team
            </div>
            <h2 style={{...BB,fontSize:'clamp(36px,8vw,76px)',letterSpacing:2,marginBottom:m?16:24,color:'#F5F0EB',textShadow:'0 2px 8px rgba(0,0,0,1), 0 0 20px rgba(0,0,0,0.9)'}}>CAREERS</h2>
            <p style={{...NB,fontSize:m?14:16,lineHeight:1.8,color:'#ccc',textShadow:'0 1px 4px rgba(0,0,0,0.9)',marginBottom:m?24:36,maxWidth:600}}>
              We're building the future of solar energy across 9 states. If you're ready to join a team that's installed 500+ MW and placed 1.2M+ modules, we want to hear from you.
            </p>
            {careerSubmitted?(
              <div style={{background:'rgba(34,197,94,.12)',border:'1px solid rgba(34,197,94,.3)',padding:m?'24px 20px':'32px 28px',textAlign:'center'}}>
                <div style={{...BB,fontSize:28,letterSpacing:2,color:'#22c55e',marginBottom:8}}>APPLICATION RECEIVED</div>
                <div style={{...NB,fontSize:14,color:'#ccc'}}>Thank you for your interest. Our team will review your application and reach out if there's a match.</div>
                <div onClick={function(){setCareerSubmitted(false);setCareerForm({name:'',email:'',phone:'',position:'',experience:'',message:''})}} style={{display:'inline-block',marginTop:16,...NB,fontSize:12,letterSpacing:'2px',color:A,cursor:'pointer'}}>Submit Another Application</div>
              </div>
            ):(
              <div style={{display:'grid',gridTemplateColumns:m?'1fr':'1fr 1fr',gap:m?12:20}}>
                <div>
                  <div style={{marginBottom:14}}>
                    <div style={{...NB,fontSize:10,letterSpacing:'3px',textTransform:'uppercase',color:A,marginBottom:6}}>FULL NAME *</div>
                    <input value={careerForm.name} onChange={function(e){setCareerForm(Object.assign({},careerForm,{name:e.target.value}))}} style={{...IST}} onFocus={fIn} onBlur={fOut} placeholder="Your full name"/>
                  </div>
                  <div style={{marginBottom:14}}>
                    <div style={{...NB,fontSize:10,letterSpacing:'3px',textTransform:'uppercase',color:A,marginBottom:6}}>EMAIL *</div>
                    <input value={careerForm.email} onChange={function(e){setCareerForm(Object.assign({},careerForm,{email:e.target.value}))}} style={{...IST}} onFocus={fIn} onBlur={fOut} placeholder="your@email.com"/>
                  </div>
                  <div style={{marginBottom:14}}>
                    <div style={{...NB,fontSize:10,letterSpacing:'3px',textTransform:'uppercase',color:A,marginBottom:6}}>PHONE</div>
                    <input value={careerForm.phone} onChange={function(e){setCareerForm(Object.assign({},careerForm,{phone:e.target.value}))}} style={{...IST}} onFocus={fIn} onBlur={fOut} placeholder="(xxx) xxx-xxxx"/>
                  </div>
                  <div style={{marginBottom:14}}>
                    <div style={{...NB,fontSize:10,letterSpacing:'3px',textTransform:'uppercase',color:A,marginBottom:6}}>POSITION OF INTEREST</div>
                    <select value={careerForm.position} onChange={function(e){setCareerForm(Object.assign({},careerForm,{position:e.target.value}))}} style={{...IST,appearance:'auto'}} onFocus={fIn} onBlur={fOut}>
                      <option value="">Select a position...</option>
                      <option value="Civil Foreman">Civil Foreman</option>
                      <option value="Pile Crew Lead">Pile Crew Lead</option>
                      <option value="Tracker Installer">Tracker Installer</option>
                      <option value="Electrician">Electrician</option>
                      <option value="Equipment Operator">Equipment Operator</option>
                      <option value="Site Superintendent">Site Superintendent</option>
                      <option value="Project Manager">Project Manager</option>
                      <option value="Safety Manager">Safety Manager</option>
                      <option value="QA/QC Inspector">QA/QC Inspector</option>
                      <option value="Field Engineer">Field Engineer</option>
                      <option value="General Laborer">General Laborer</option>
                      <option value="Other">Other</option>
                    </select>
                  </div>
                </div>
                <div>
                  <div style={{marginBottom:14}}>
                    <div style={{...NB,fontSize:10,letterSpacing:'3px',textTransform:'uppercase',color:A,marginBottom:6}}>YEARS OF EXPERIENCE</div>
                    <select value={careerForm.experience} onChange={function(e){setCareerForm(Object.assign({},careerForm,{experience:e.target.value}))}} style={{...IST,appearance:'auto'}} onFocus={fIn} onBlur={fOut}>
                      <option value="">Select...</option>
                      <option value="0-1">0-1 years</option>
                      <option value="2-4">2-4 years</option>
                      <option value="5-9">5-9 years</option>
                      <option value="10+">10+ years</option>
                    </select>
                  </div>
                  <div style={{marginBottom:14}}>
                    <div style={{...NB,fontSize:10,letterSpacing:'3px',textTransform:'uppercase',color:A,marginBottom:6}}>TELL US ABOUT YOURSELF</div>
                    <textarea value={careerForm.message} onChange={function(e){setCareerForm(Object.assign({},careerForm,{message:e.target.value}))}} rows={4} style={{...IST,resize:'vertical'}} onFocus={fIn} onBlur={fOut} placeholder="Relevant skills, certifications, availability..."/>
                  </div>
                  <div style={{marginBottom:14}}>
                    <div style={{...NB,fontSize:10,letterSpacing:'3px',textTransform:'uppercase',color:A,marginBottom:6}}>RESUME (PDF)</div>
                    <label style={{display:'flex',alignItems:'center',gap:10,padding:'12px 16px',background:'rgba(249,115,22,.06)',border:'1px dashed rgba(249,115,22,.3)',cursor:'pointer',transition:'background .2s'}} onMouseEnter={function(e){e.currentTarget.style.background='rgba(249,115,22,.12)'}} onMouseLeave={function(e){e.currentTarget.style.background='rgba(249,115,22,.06)'}}>
                      <span style={{...NB,fontSize:13,color:A,letterSpacing:'1px'}}>Upload Resume</span>
                      <input type="file" accept=".pdf,.doc,.docx" style={{display:'none'}} onChange={function(e){if(e.target.files&&e.target.files[0]){setCareerForm(Object.assign({},careerForm,{resume:e.target.files[0].name}))}}}/>
                      {careerForm.resume&&<span style={{...NB,fontSize:11,color:'#888'}}>{careerForm.resume}</span>}
                    </label>
                  </div>
                </div>
                <div style={{gridColumn:m?'1':'1 / -1',marginTop:m?8:16}}>
                  <div onClick={function(){if(!careerForm.name||!careerForm.email){return}var submission=Object.assign({},careerForm,{id:uid(),submittedAt:new Date().toISOString()});sGet('career_submissions').then(function(prev){sSet('career_submissions',(prev||[]).concat([submission]))});setCareerSubmitted(true)}} style={{cursor:careerForm.name&&careerForm.email?'pointer':'default',background:careerForm.name&&careerForm.email?A:'rgba(249,115,22,.3)',color:careerForm.name&&careerForm.email?'#1a1206':'#888',textAlign:'center',...NB,fontSize:15,fontWeight:700,letterSpacing:'3px',textTransform:'uppercase',padding:'16px 0',clipPath:'polygon(10px 0%,100% 0%,calc(100% - 10px) 100%,0% 100%)',transition:'background .2s'}}>
                    SUBMIT APPLICATION
                  </div>
                  <div style={{textAlign:'center',marginTop:12,...NB,fontSize:11,color:'#666',letterSpacing:'1px'}}>
                    We are an equal opportunity employer. All positions require travel to project sites across the US.
                  </div>
                </div>
              </div>
            )}
          </div>
        </Sec>

                <footer style={{background:'rgba(1,1,6,.96)',padding:m?'28px 20px':'38px 48px',borderTop:'1px solid rgba(249,115,22,.1)',display:'flex',alignItems:m?'flex-start':'center',flexDirection:m?'column':'row',justifyContent:'space-between',flexWrap:'wrap',gap:m?16:18,position:'relative',zIndex:5}}>
          <div style={{display:'flex',alignItems:'center',gap:12,opacity:.7}}>
            <img src={LOGO_SRC} alt="SRC" style={{width:36,height:36,objectFit:"contain"}}/>
            <div><div style={{...BB,fontSize:16,letterSpacing:'4px',color:'#F5F0EB',lineHeight:1}}>SUNRISE</div><div style={{...NB,fontSize:8,letterSpacing:'3px',color:A,textTransform:'uppercase'}}>Construction & Development</div></div>
          </div>
          <div style={{...NB,fontSize:m?9:11,letterSpacing:'2px',textTransform:'uppercase',color:'#ddd',textShadow:'0 1px 3px rgba(0,0,0,0.95), 0 0 12px rgba(0,0,0,1)',textAlign:m?'left':'center'}}>
            © 2026 Sunrise Construction & Development. All Rights Reserved.{!m&&<br/>}{m?' ':''}Elite Subcontracting for Utility-Scale Solar Dominance.
          </div>
          {!m&&<div style={{display:'flex',alignItems:'center',gap:12}}>
            <div style={{padding:'7px 14px',border:'1px solid rgba(249,115,22,.25)',...NB,fontSize:10,letterSpacing:'2.5px',textTransform:'uppercase',color:A}}>ISNet Compliant</div>
            <div style={{...NB,fontSize:11,letterSpacing:'2px',textTransform:'uppercase',color:'#ddd',textShadow:'0 1px 3px rgba(0,0,0,0.95), 0 0 12px rgba(0,0,0,1)'}}>National Coverage</div>
          </div>}
        </footer>
        </>}
      </div>
    </div>
  )
}


