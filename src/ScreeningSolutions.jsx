import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import * as XLSX from "xlsx";
import {
  LayoutDashboard, Users, Shuffle, ClipboardList, Archive,
  CalendarDays, BarChart2, UserCircle, LogOut, Upload,
  ChevronLeft, ChevronRight, Download, HelpCircle, X, Send,
  CheckCircle2, Clock, AlertTriangle, Shield, Eye, EyeOff,
  Search, FileDown, Printer, RefreshCw, PenLine, Settings,
  Mail, Timer, Zap, Menu, Building2, Plus, FlaskConical,
  FileText, Ban, Pill, TestTube, Edit2, Trash2, HardDrive, FolderOpen
} from "lucide-react";
// ─── window.storage shims (replaces firebase.js for single-workspace portal use) ───
const _ss_store = (typeof window !== 'undefined' && window.storage) ? window.storage : {
  get:async(k)=>{ try{ const v=localStorage.getItem(k); return v==null?null:JSON.parse(v); }catch{return null} },
  set:async(k,v)=>{ try{ localStorage.setItem(k, JSON.stringify(v)); }catch{} },
  delete:async(k)=>{ try{ localStorage.removeItem(k); }catch{} },
  list:async(prefix)=>{ const keys=[]; for(let i=0;i<localStorage.length;i++){ const k=localStorage.key(i); if(!prefix||k.startsWith(prefix)) keys.push(k); } return {keys}; }
};
let _ss_currentUser = null;
const _ss_authListeners = new Set();
const auth = { get currentUser(){ return _ss_currentUser; } };
function onAuthStateChanged(_a, cb){ _ss_authListeners.add(cb); queueMicrotask(()=>cb(_ss_currentUser)); return ()=>_ss_authListeners.delete(cb); }
function _ss_setUser(u){ _ss_currentUser = u; _ss_authListeners.forEach(cb=>{ try{ cb(u); }catch{} }); }
async function loginUser(){ throw Object.assign(new Error('Sign-in disabled in portal mode.'),{code:'auth/disabled'}); }
async function registerUser(){ throw Object.assign(new Error('Registration disabled in portal mode.'),{code:'auth/disabled'}); }
async function logoutUser(){ _ss_setUser(null); }
async function findUserByEmail(){ return null; }
async function getUserProfile(uid){ return (await _ss_store.get('ss_user_'+uid))||{}; }
async function saveUserProfile(uid, patch){ const cur=(await _ss_store.get('ss_user_'+uid))||{}; await _ss_store.set('ss_user_'+uid, {...cur, ...patch}); }
async function getMyProfiles(uid){ return (await _ss_store.get('ss_profiles_'+uid))||[]; }
async function createProfile(name, color, user){
  const uid=user.uid; const list=await getMyProfiles(uid);
  const p={id:'p_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,8), name, color:color||'#f5c518', ownerUid:uid, ownerEmail:user.email, createdAt:Date.now()};
  list.push(p); await _ss_store.set('ss_profiles_'+uid, list); return p.id;
}
async function deleteProfile(id){
  const {keys}=await _ss_store.list('ss_profiles_');
  for(const k of keys){ const list=(await _ss_store.get(k))||[]; const next=list.filter(p=>p.id!==id); if(next.length!==list.length) await _ss_store.set(k,next); }
  await _ss_store.delete('ss_profdata_'+id);
}
async function updateProfileMeta(id, patch){
  const {keys}=await _ss_store.list('ss_profiles_');
  for(const k of keys){ const list=(await _ss_store.get(k))||[]; let changed=false; const next=list.map(p=>{ if(p.id===id){changed=true; return {...p,...patch}} return p; }); if(changed) await _ss_store.set(k,next); }
}
async function ssLoadProfileDataDirect(id){ return (await _ss_store.get('ss_profdata_'+id))||{}; }
// Alias preserves the firebase.js name for the module-level `store` helper below.
const loadProfileData = ssLoadProfileDataDirect;
async function saveProfileField(id, key, value){
  const cur=(await _ss_store.get('ss_profdata_'+id))||{}; cur[key]=value; await _ss_store.set('ss_profdata_'+id, cur);
}
async function sendInvite(){ throw new Error('Invites are disabled in portal mode.'); }
async function getMyInvites(){ return []; }
async function acceptInvite(){ throw new Error('Invites are disabled in portal mode.'); }
async function declineInvite(){ return; }
async function removeProfileMember(){ return; }
async function getProfileMembers(){ return []; }

const T = {
  bg:'#f2f2ee', panel:'#ffffff', card:'#ffffff',
  border:'#ddddd5', borderL:'#ccccC0',
  gold:'#F97316', goldL:'#fb923c', goldD:'#e0650f',
  text:'#0f0f0f', sub:'#2a2a2a', muted:'#666660',
  open:'#1a6fdb', prog:'#d97706', done:'#16a34a', warn:'#dc2626',
  nav:'#ffffff', navText:'#1a1a2e', navMuted:'#888880',
  shadow:'rgba(0,0,0,0.08)',
  pass:'#16a34a', fail:'#dc2626', pending:'#d97706', exempt:'#7c3aed',
};
const FONT_HEAD = "'Bebas Neue', sans-serif";
const FONT_BODY = "'Barlow Condensed', sans-serif";

const MONTHS=['January','February','March','April','May','June','July','August','September','October','November','December'];
const DAYS=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const INTERVAL_MS={minutes:60000,hours:3600000,days:86400000,weeks:604800000};
const DEFAULT_SCHED={enabled:false,intervalValue:7,intervalUnit:'days',nextPickAt:null,lastPickAt:null,emailTo:'',emailEnabled:false};
const DEFAULT_EMAIL={serviceId:'',templateId:'',publicKey:''};
const SCREEN_TYPES=['random','pre-employment','incident','scheduled','follow-up','return-to-duty'];
const POSITIONS=['Staff','Supervisor','Manager','Director','Executive','Other'];

const TC_SECTIONS=[
  {title:"PREAMBLE & PROPRIETARY NOTICE",body:`SCREENING SOLUTIONS is the exclusive intellectual property of Dustin Hanson, an individual residing in the United States of America. These Terms and Conditions of Use ("Agreement") constitute a legally binding contract between you ("User," "Licensee," or "You") and Dustin Hanson ("Owner," "Licensor," "Developer," or "We") governing your access to and use of the Screening Solutions software application, including all associated modules, features, data structures, algorithms, and documentation (collectively, the "Software" or "Application").\n\nBy accessing, installing, downloading, or otherwise using the Software in any capacity, you unconditionally accept, without limitation or qualification, all of the terms, conditions, obligations, representations, warranties, and covenants set forth in this Agreement.\n\nThis Software is shared by Dustin Hanson in good faith and as a courtesy to assist human resources professionals. Such sharing does not constitute a transfer, assignment, waiver, or abandonment of any intellectual property rights. All rights not expressly granted herein are expressly reserved by Dustin Hanson.`},
  {title:"SECTION 1: DEVELOPMENT STATUS & BETA DISCLAIMER",body:`THE SCREENING SOLUTIONS APPLICATION IS CURRENTLY IN AN ACTIVE DEVELOPMENT AND BETA TESTING PHASE. THE SOFTWARE IS PROVIDED TO USERS ON AN EXPERIMENTAL, PRE-RELEASE BASIS. DUSTIN HANSON MAKES NO REPRESENTATIONS OR WARRANTIES THAT THE SOFTWARE IS COMPLETE, STABLE, FREE FROM DEFECTS, OR SUITABLE FOR ANY PARTICULAR PURPOSE.\n\nUsers expressly acknowledge that: (a) the Software may contain bugs, errors, and defects; (b) features may be incomplete or non-functional; (c) data loss may occur; and (d) the Software may be modified or discontinued at any time without notice.\n\nUnder no circumstances should Screening Solutions be relied upon as the sole compliance mechanism for any regulated drug testing program.`},
  {title:"SECTION 2: INTELLECTUAL PROPERTY RIGHTS & OWNERSHIP",body:`All aspects of the Screening Solutions Application are the original, creative work product and proprietary intellectual property of Dustin Hanson. This includes but is not limited to: the software architecture; all source code; user interface designs; database schemas; algorithms for random employee selection; workflow designs; report generation methodologies; and all derivative works.\n\nThis Software is protected by applicable intellectual property laws of the United States including the Copyright Act (17 U.S.C. § 101 et seq.) and the Defend Trade Secrets Act (18 U.S.C. § 1831 et seq.), as well as international intellectual property treaties.\n\nThe good-faith sharing of this Software does not create any license beyond those expressly stated in this Agreement.`},
  {title:"SECTION 3: LICENSE GRANT & PERMITTED USE",body:`Subject to your full compliance with all terms, Dustin Hanson grants you a limited, non-exclusive, non-transferable, revocable license to use the Screening Solutions Application solely for your internal human resources management purposes.\n\nThis license does not include the right to: (a) copy or distribute the Software; (b) modify or create derivative works; (c) reverse engineer or decompile the Software; (d) use the Software to develop a competing product; or (e) use the Software in violation of applicable law.`},
  {title:"SECTION 4: DRUG SCREENING COMPLIANCE DISCLAIMER",body:`THE SCREENING SOLUTIONS APPLICATION IS DESIGNED TO ASSIST IN ORGANIZING WORKPLACE DRUG SCREENING PROGRAMS. IT IS NOT INTENDED TO CONSTITUTE LEGAL ADVICE, REGULATORY GUIDANCE, OR PROFESSIONAL CONSULTING SERVICES.\n\nCompliance with DOT regulations (49 CFR Part 40), SAMHSA guidelines, and applicable modal agency regulations remains entirely the responsibility of the regulated employer. Users are solely responsible for confirming that the Software's methodologies meet applicable legal requirements.\n\nDustin Hanson expressly disclaims all responsibility for any regulatory non-compliance or adverse consequences resulting from reliance upon the Software's outputs.`},
  {title:"SECTION 5: HIPAA & MEDICAL INFORMATION",body:`The Screening Solutions Application may be used in connection with processes involving sensitive medical or employment information. Users who are covered entities under HIPAA bear sole responsibility for ensuring compliance with applicable requirements.\n\nDustin Hanson does not represent that the Software is a HIPAA-compliant platform. No Business Associate Agreement is offered. Users should not use this Software to process protected health information without appropriate legal guidance.\n\nDrug test results, medical exemptions, prescription information, and related data entered into this Software must be handled with appropriate confidentiality protections consistent with applicable law.`},
  {title:"SECTION 6: PRIVACY POLICY & DATA COLLECTION",body:`The Software stores user-provided information locally in your browser's localStorage. This includes: user account credentials; employee roster data including position, title, and notes; drug screening records; test results; medical exemption notes; prescription information; and scheduling data.\n\nThe Software does not transmit employee data or screening records to external servers operated by Dustin Hanson. However, the Software communicates with EmailJS for notifications and Anthropic Claude AI for the compliance assistant, subject to their respective privacy policies.\n\nUsers retain full responsibility for the privacy and security of employee medical information and drug test results stored in connection with this Software.`},
  {title:"SECTION 7: DATA SECURITY & USER RESPONSIBILITY",body:`All data is stored in browser localStorage without enterprise-grade encryption. Users are responsible for: maintaining confidentiality of account credentials; implementing device-level security; restricting access to authorized personnel; and backing up records regularly via the export features.\n\nElectronic signatures captured through the Software are stored as bitmap image data and may not satisfy all electronic signature legal requirements. Users should consult legal counsel regarding the legal validity of these signatures for their specific use case.`},
  {title:"SECTION 8: LIMITATION OF LIABILITY",body:`TO THE MAXIMUM EXTENT PERMITTED BY LAW, DUSTIN HANSON SHALL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, INCLUDING LOSS OF DATA, REGULATORY FINES, EMPLOYMENT-RELATED CLAIMS, OR ANY OTHER PECUNIARY LOSS.\n\nDUSTIN HANSON'S TOTAL LIABILITY SHALL NOT EXCEED THE AMOUNT PAID BY YOU TO DUSTIN HANSON. BECAUSE THE SOFTWARE IS PROVIDED FREE OF CHARGE, THE APPLICABLE LIMITATION SHALL BE ZERO DOLLARS ($0.00).`},
  {title:"SECTION 9: DISCLAIMER OF WARRANTIES",body:`THE SOFTWARE IS PROVIDED "AS IS," "AS AVAILABLE," AND "WITH ALL FAULTS," WITHOUT WARRANTY OF ANY KIND. DUSTIN HANSON DISCLAIMS ALL WARRANTIES INCLUDING THE IMPLIED WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT.\n\nDustin Hanson does not warrant that the Software will meet your requirements, operate without interruption, or that data stored will be secure or preserved.`},
  {title:"SECTION 10: INDEMNIFICATION",body:`You agree to indemnify and hold harmless Dustin Hanson from any claims, liabilities, costs, and expenses arising from: your use or misuse of the Software; your violation of this Agreement; any drug screening program you operate; any employment-related claim arising from screening activities; any regulatory enforcement action; or any data breach related to your use of the Software.`},
  {title:"SECTION 11: DOT REGULATIONS & FEDERAL COMPLIANCE",body:`Organizations operating under DOT authority must comply with 49 CFR Part 40 and applicable modal regulations regardless of their use of this Software. The random selection feature is designed to produce statistically unbiased selections but compliance with DOT random testing requirements remains entirely the responsibility of the regulated employer.\n\nPre-employment, reasonable suspicion, post-accident, return-to-duty, and follow-up testing categories each have specific procedural requirements under DOT regulations that are beyond the scope of this Software.`},
  {title:"SECTION 12: ELECTRONIC SIGNATURES & LEGAL VALIDITY",body:`The electronic signature capture feature is provided as an administrative convenience tool. Dustin Hanson makes no warranty that signatures captured through this Software will be recognized as legally valid in any specific legal or regulatory context.\n\nUsers requiring legally enforceable electronic signatures should consult legal counsel and use dedicated, legally compliant electronic signature platforms.`},
  {title:"SECTION 13: RANDOM SELECTION METHODOLOGY",body:`The Software uses crypto.getRandomValues() for selection, excluding employees marked as exempt from random screening. The random selection is performed exclusively using employee identification numbers. Exempt status for management or other classifications is set by the user and the Software does not independently verify the appropriateness of any exemption.\n\nDustin Hanson makes no representation that any particular selection sequence constitutes a valid random selection for purposes of any specific regulatory program.`},
  {title:"SECTION 14: RECORD KEEPING & DATA RETENTION",body:`Records maintained by the Software may not satisfy all legal or regulatory record retention requirements. Users operating under specific record retention requirements must ensure compliant records are maintained through appropriate systems.\n\nRecords stored in localStorage are subject to loss from browser data clearing or device failure. Users are strongly advised to regularly export records using the Software's export functionality.`},
  {title:"SECTION 15: THIRD-PARTY SERVICES",body:`The Software integrates with: EmailJS for email notifications; Anthropic Claude AI for the compliance assistant; and browser Web Cryptography API for random selection. Each third-party service is governed by its own terms and privacy policy. Dustin Hanson is not responsible for third-party service availability, reliability, or legal compliance.`},
  {title:"SECTION 16: TERMINATION",body:`Dustin Hanson may terminate your access at any time. Upon termination, your license immediately ceases and all stored data may be lost. Dustin Hanson has no obligation to retrieve or preserve your data.`},
  {title:"SECTION 17: GOVERNING LAW",body:`This Agreement is governed by the laws of the state of Dustin Hanson's residence. Any disputes shall be brought exclusively in courts of competent jurisdiction in that state.`},
  {title:"SECTION 18: DISPUTE RESOLUTION & ARBITRATION",body:`ANY DISPUTE ARISING FROM THIS AGREEMENT SHALL BE SETTLED BY BINDING INDIVIDUAL ARBITRATION UNDER AAA RULES. YOU WAIVE YOUR RIGHT TO A JURY TRIAL AND CLASS ACTION PARTICIPATION.\n\nThe arbitrator shall apply governing law and have authority to grant any available remedy. Emergency injunctive relief remains available in court for intellectual property matters.`},
  {title:"SECTION 19: GOOD FAITH SHARING",body:`Screening Solutions is made available as an act of good faith to assist HR professionals. This does not reflect any intent to abandon intellectual property rights or create any ongoing obligation to continue providing the Software.\n\nDustin Hanson retains the right to modify terms, restrict access, discontinue the Software, or convert it to a commercial product at any time without notice.`},
  {title:"SECTION 20: HR COMPLIANCE ADVISORY DISCLAIMER",body:`AI-generated responses from the HR Compliance Assistant do not constitute legal advice. Responses may be inaccurate, outdated, or inapplicable to your situation. Always consult qualified legal counsel, SAPs, and MROs before making compliance decisions.\n\nDustin Hanson expressly disclaims all liability for actions taken in reliance upon AI-generated responses.`},
  {title:"SECTION 21: MODIFICATIONS",body:`Dustin Hanson may modify the Software and these Terms at any time without notice. Continued use constitutes acceptance of modified terms.`},
  {title:"SECTION 22: MEDICAL EXEMPTIONS & PRESCRIPTION DATA",body:`The Software provides fields for entering employee medical exemption notes and prescription information. This data is stored locally in browser storage. Users are solely responsible for: ensuring this information is handled in compliance with applicable medical privacy laws; restricting access to authorized personnel; and obtaining appropriate legal guidance regarding the collection, storage, and use of employee medical information.\n\nThe inclusion of medical exemption or prescription fields does not constitute medical or legal advice regarding their proper use in drug screening programs.`},
  {title:"SECTION 23: MANAGEMENT EXEMPTIONS",body:`The Software provides a feature to mark management-classified employees as exempt from random drug screening selections. Dustin Hanson makes no representation regarding the legal permissibility of exempting management employees from random drug screening programs under applicable regulations.\n\nUsers are solely responsible for ensuring that any exemptions comply with applicable DOT regulations, company policy, collective bargaining agreements, and applicable law. Under DOT regulations, generally all safety-sensitive employees must be included in the random testing pool regardless of classification.`},
  {title:"SECTION 24: SEVERABILITY & ENTIRE AGREEMENT",body:`If any provision is held invalid or unenforceable, the remainder continues in full force. This Agreement constitutes the entire agreement between the parties and supersedes all prior understandings.\n\nNo waiver by Dustin Hanson of any provision shall be effective unless in writing. Failure to enforce any provision does not constitute a waiver of the right to do so.`},
  {title:"SECTION 25: ACKNOWLEDGMENT",body:`BY CLICKING "I AGREE" OR USING THIS SOFTWARE, YOU ACKNOWLEDGE THAT: (1) YOU HAVE READ THESE TERMS; (2) YOU UNDERSTAND ALL TERMS; (3) YOU HAVE HAD OPPORTUNITY TO CONSULT LEGAL COUNSEL; (4) YOU AGREE TO BE LEGALLY BOUND; AND (5) YOU HAVE AUTHORITY TO ENTER THIS AGREEMENT.\n\nScreening Solutions — Proprietary Software © Dustin Hanson. All Rights Reserved. Version: BETA — Development Build. Not for use as the sole compliance mechanism in regulated drug testing programs.`},
];

const TUTORIAL=[
  {icon:'⚖',title:'Welcome to Screening Solutions',desc:'Your complete offline drug screening management platform. All data is saved locally on this computer — nothing is sent to the cloud. This tour covers every feature.',nav:null},
  {icon:'💾',title:'Your Data is Always Saved',desc:'Every change you make is saved to disk instantly and automatically. A rolling backup is also written every 500ms to a local backups folder. You never need to manually save.',nav:null},
  {icon:'📤',title:'Export & Import Your Profile',desc:'Use Settings → Export Profile to save a complete snapshot of all your data. Use Import Profile to restore from that file on any machine. Keep exports somewhere safe — USB drive, cloud folder, email to yourself.',nav:'settings'},
  {icon:'👥',title:'Employee Roster',desc:'Import via Excel or manually add employees. Click any employee name to add notes or prescription/medical exemptions. Management employees can be individually exempted from random picks.',nav:'employees'},
  {icon:'🎲',title:'Random Picker',desc:'Cryptographic randomness via crypto.getRandomValues(). Exempt employees excluded. Each random pick auto-creates a pending drug test in the Drug Tests tab.',nav:'picker'},
  {icon:'🧪',title:'Drug Tests',desc:'Pre-employment, incident, scheduled, and follow-up tests all live here — including auto-created random picks. Enter pass/fail results with MRO notes.',nav:'drugtests'},
  {icon:'⏰',title:'Auto-Scheduler',desc:'Set a pick interval. The scheduler runs while the app is open and picks automatically. Each pick auto-saves and creates a drug test.',nav:'settings'},
  {icon:'📋',title:'Active Screenings',desc:'Track random screenings Open → In Progress → Completed with e-signature. Completed records move to History as read-only.',nav:'screenings'},
  {icon:'📊',title:'Reports & Backups',desc:'Weekly/monthly/quarterly/annual Excel exports. Use Settings → Export Profile regularly and store copies off-machine for disaster recovery.',nav:'reports'},
  {icon:'✅',title:"You're All Set!",desc:'Every change auto-saves instantly. Use Settings → Export Profile regularly. Check the Backups panel in Settings to see your rolling backup history. The HR Assistant is always one click away.',nav:'settings'},
];

const fmtDate=(iso)=>!iso?'—':new Date(iso).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
const fmtDT=(iso)=>!iso?'—':new Date(iso).toLocaleString('en-US',{month:'short',day:'numeric',year:'numeric',hour:'2-digit',minute:'2-digit'});
const uid=()=>Date.now().toString(36)+Math.random().toString(36).slice(2);
function secureRand(n){const a=new Uint32Array(1);crypto.getRandomValues(a);return a[0]%n;}
function wasRecentPick(empId,screenings,months=3){const cut=new Date();cut.setMonth(cut.getMonth()-months);return screenings.some(s=>s.employeeId===empId&&new Date(s.pickedAt)>cut&&s.type==='random');}
function hexRgb(hex){return[parseInt(hex.slice(1,3),16),parseInt(hex.slice(3,5),16),parseInt(hex.slice(5,7),16)].join(',');}
function getCountdown(iso){if(!iso)return null;const diff=new Date(iso)-new Date();if(diff<=0)return'Imminent';const d=Math.floor(diff/86400000),h=Math.floor((diff%86400000)/3600000),m=Math.floor((diff%3600000)/60000),s=Math.floor((diff%60000)/1000);const p=[];if(d>0)p.push(d+'d');if(h>0)p.push(h+'h');p.push(m+'m');p.push(s+'s');return p.join(' ');}
function useIsMobile(){const[m,setM]=useState(typeof window!=='undefined'?window.innerWidth<768:false);useEffect(()=>{const h=()=>setM(window.innerWidth<768);window.addEventListener('resize',h);return()=>window.removeEventListener('resize',h);},[]);return m;}

// ── Firebase-backed store (per-profile, web + desktop) ────────────────────────
const IS_ELECTRON = typeof window !== 'undefined' && !!window.electronAPI;
let ACTIVE_PROFILE_ID = null;

const store = {
  setProfile(id) { ACTIVE_PROFILE_ID = id; },
  async get(k, fb) {
    try {
      if (!ACTIVE_PROFILE_ID) return fb;
      const data = await loadProfileData(ACTIVE_PROFILE_ID);
      return data[k] !== undefined ? data[k] : fb;
    } catch { return fb; }
  },
  async set(k, v) {
    try {
      if (!ACTIVE_PROFILE_ID) return;
      await saveProfileField(ACTIVE_PROFILE_ID, k, v);
      // Local backup only in Electron
      if (IS_ELECTRON && window.electronAPI)
        window.electronAPI.store.set(ACTIVE_PROFILE_ID, k, v).catch(() => {});
    } catch(e) { console.error('store.set error:', e); }
  },
};

async function sendEmail(cfg,to,employee,pickedAt,isAuto){
  if(!cfg.serviceId||!cfg.templateId||!cfg.publicKey||!to)return false;
  try{const res=await fetch('https://api.emailjs.com/api/v1.0/email/send',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({service_id:cfg.serviceId,template_id:cfg.templateId,user_id:cfg.publicKey,template_params:{to_email:to,employee_name:employee.name,employee_id:employee.id,pick_date:fmtDT(pickedAt),pick_type:isAuto?'Auto-Scheduled':'Manual Pick',reply_to:to}})});return res.status===200;}catch{return false;}
}

// ─── COMMON UI ────────────────────────────────────────────────────────────
function Btn({children,onClick,v='primary',size='md',style={},disabled=false,full=false}){
  const vars={primary:{background:T.gold,color:'#000',border:'2px solid '+T.goldD},secondary:{background:'#fff',color:T.text,border:'2px solid '+T.border},ghost:{background:'transparent',color:T.muted,border:'1px solid '+T.border},danger:{background:'#fff0f0',color:T.warn,border:'2px solid '+T.warn},success:{background:'#f0fff4',color:T.done,border:'2px solid '+T.done},warn:{background:'#fffbf0',color:T.prog,border:'2px solid '+T.prog},dark:{background:T.nav,color:T.gold,border:'2px solid '+T.gold},exempt:{background:'#f5f3ff',color:'#7c3aed',border:'2px solid #7c3aed'}};
  return <button onClick={disabled?undefined:onClick} style={{...vars[v],borderRadius:6,cursor:disabled?'not-allowed':'pointer',fontFamily:FONT_BODY,fontWeight:700,opacity:disabled?0.45:1,display:'inline-flex',alignItems:'center',justifyContent:'center',gap:6,width:full?'100%':undefined,transition:'all 0.15s',letterSpacing:'0.05em',textTransform:'uppercase',padding:size==='sm'?'5px 12px':size==='lg'?'12px 28px':'7px 16px',fontSize:size==='sm'?11:size==='lg'?14:12,...style}}>{children}</button>;
}

function Toggle({checked,onChange,label}){
  return <label style={{display:'flex',alignItems:'center',gap:10,cursor:'pointer'}}>
    <div onClick={onChange} style={{width:44,height:24,borderRadius:12,background:checked?T.gold:T.border,position:'relative',transition:'background 0.2s',flexShrink:0,border:'2px solid '+(checked?T.goldD:T.borderL)}}>
      <div style={{width:16,height:16,borderRadius:'50%',background:checked?'#000':'#fff',position:'absolute',top:2,left:checked?22:2,transition:'left 0.2s',boxShadow:'0 1px 3px rgba(0,0,0,0.3)'}}/>
    </div>
    {label&&<span style={{fontSize:13,color:T.text,fontFamily:FONT_BODY,fontWeight:600}}>{label}</span>}
  </label>;
}

function Badge({status}){
  const c={open:{bg:'#eff6ff',color:'#1d4ed8',b:'#bfdbfe',l:'Open'},in_progress:{bg:'#fffbeb',color:'#92400e',b:'#fde68a',l:'In Progress'},completed:{bg:'#f0fdf4',color:'#166534',b:'#bbf7d0',l:'Completed'},pass:{bg:'#f0fdf4',color:'#166534',b:'#bbf7d0',l:'PASS'},fail:{bg:'#fef2f2',color:'#dc2626',b:'#fecaca',l:'FAIL'},pending:{bg:'#fffbeb',color:'#92400e',b:'#fde68a',l:'Pending'},scheduled:{bg:'#eff6ff',color:'#1d4ed8',b:'#bfdbfe',l:'Scheduled'},exempt:{bg:'#f5f3ff',color:'#7c3aed',b:'#ddd6fe',l:'Exempt'}}[status]||{bg:'#f3f4f6',color:'#6b7280',b:'#e5e7eb',l:status||'—'};
  return <span style={{background:c.bg,color:c.color,border:'1px solid '+c.b,borderRadius:4,padding:'2px 8px',fontSize:10,fontWeight:800,letterSpacing:'0.08em',fontFamily:FONT_BODY,textTransform:'uppercase',whiteSpace:'nowrap'}}>{c.l}</span>;
}

function Modal({children,onClose,title,isMobile,width}){
  return <div onClick={e=>e.target===e.currentTarget&&onClose()} style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.55)',display:'flex',alignItems:isMobile?'flex-end':'center',justifyContent:'center',zIndex:2000,padding:isMobile?0:20}}>
    <div style={{background:'#fff',border:'2px solid '+T.border,borderRadius:isMobile?'16px 16px 0 0':'12px',width:'100%',maxWidth:isMobile?'100%':width||580,maxHeight:isMobile?'92vh':'90vh',overflow:'auto',boxShadow:'0 20px 60px rgba(0,0,0,0.2)'}}>
      <div style={{padding:'14px 20px',borderBottom:'2px solid '+T.border,display:'flex',alignItems:'center',justifyContent:'space-between',position:'sticky',top:0,background:T.nav,zIndex:1}}>
        <h3 style={{margin:0,color:T.gold,fontFamily:FONT_HEAD,fontSize:16,letterSpacing:'0.05em'}}>{title}</h3>
        <button onClick={onClose} style={{background:'none',border:'none',color:T.navMuted,cursor:'pointer',padding:4,display:'flex'}}><X size={18}/></button>
      </div>
      <div style={{padding:20}}>{children}</div>
    </div>
  </div>;
}

function Card({children,style={}}){return <div style={{background:'#fff',border:'1px solid '+T.border,borderRadius:10,padding:16,boxShadow:'0 1px 4px '+T.shadow,...style}}>{children}</div>;}

function SectionTitle({icon:Icon,children}){
  return <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:18,borderBottom:'3px solid '+T.gold,paddingBottom:10}}>
    <Icon size={20} color={T.goldD}/>
    <h2 style={{margin:0,fontFamily:FONT_HEAD,fontSize:22,color:T.text,letterSpacing:'0.05em'}}>{children}</h2>
  </div>;
}

function FieldInput({label,...props}){
  return <div style={{marginBottom:14}}>
    {label&&<label style={{display:'block',fontSize:11,fontWeight:700,color:T.sub,letterSpacing:'0.08em',textTransform:'uppercase',marginBottom:5,fontFamily:FONT_BODY}}>{label}</label>}
    <input {...props} style={{width:'100%',boxSizing:'border-box',background:'#fafafa',border:'2px solid '+T.border,borderRadius:6,padding:'10px 12px',color:T.text,fontSize:14,fontFamily:FONT_BODY,outline:'none',...props.style}}/>
  </div>;
}

function FieldSelect({label,children,...props}){
  return <div style={{marginBottom:14}}>
    {label&&<label style={{display:'block',fontSize:11,fontWeight:700,color:T.sub,letterSpacing:'0.08em',textTransform:'uppercase',marginBottom:5,fontFamily:FONT_BODY}}>{label}</label>}
    <select {...props} style={{width:'100%',boxSizing:'border-box',background:'#fafafa',border:'2px solid '+T.border,borderRadius:6,padding:'10px 12px',color:T.text,fontSize:14,fontFamily:FONT_BODY,outline:'none',...props.style}}>{children}</select>
  </div>;
}

function FieldTextarea({label,...props}){
  return <div style={{marginBottom:14}}>
    {label&&<label style={{display:'block',fontSize:11,fontWeight:700,color:T.sub,letterSpacing:'0.08em',textTransform:'uppercase',marginBottom:5,fontFamily:FONT_BODY}}>{label}</label>}
    <textarea {...props} style={{width:'100%',boxSizing:'border-box',background:'#fafafa',border:'2px solid '+T.border,borderRadius:6,padding:'10px 12px',color:T.text,fontSize:14,fontFamily:FONT_BODY,outline:'none',resize:'vertical',minHeight:80,...props.style}}/>
  </div>;
}

function MobileRow({label,value}){
  return <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'10px 0',borderBottom:'1px solid '+T.border}}>
    <span style={{fontSize:12,color:T.muted,fontFamily:FONT_BODY,fontWeight:700,textTransform:'uppercase',letterSpacing:'0.05em'}}>{label}</span>
    <span style={{fontSize:13,color:T.text,fontWeight:700,fontFamily:FONT_BODY,textAlign:'right',maxWidth:'60%'}}>{value}</span>
  </div>;
}

// ─── DISCLAIMER ───────────────────────────────────────────────────────────
function DisclaimerModal({onAccept}){
  return <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.85)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:9999,padding:20}}>
    <div style={{background:'#fff',borderRadius:12,maxWidth:560,width:'100%',overflow:'hidden',boxShadow:'0 40px 80px rgba(0,0,0,0.5)',border:'3px solid '+T.gold}}>
      <div style={{background:T.nav,padding:'20px 24px',display:'flex',alignItems:'center',gap:12}}>
        <AlertTriangle size={28} color={T.gold}/>
        <h2 style={{margin:0,fontFamily:FONT_HEAD,fontSize:22,color:T.gold,letterSpacing:'0.08em'}}>DEVELOPMENT NOTICE</h2>
      </div>
      <div style={{padding:24}}>
        <div style={{background:'#fffbeb',border:'2px solid '+T.gold,borderRadius:8,padding:16,marginBottom:18}}>
          <p style={{margin:'0 0 12px',fontFamily:FONT_BODY,fontSize:14,color:T.text,fontWeight:700,lineHeight:1.6}}>⚠ THIS APPLICATION IS CURRENTLY IN ACTIVE DEVELOPMENT AND BETA TESTING.</p>
          <p style={{margin:'0 0 10px',fontFamily:FONT_BODY,fontSize:13,color:T.sub,lineHeight:1.7}}>Not all features are complete or fully functional. You may encounter bugs, errors, data loss, or unexpected behavior. This software should <strong>not</strong> be used as the sole compliance mechanism for any regulated drug testing program.</p>
          <p style={{margin:0,fontFamily:FONT_BODY,fontSize:13,color:T.sub,lineHeight:1.7}}>Always verify all compliance activities with qualified legal counsel, certified Substance Abuse Professionals (SAPs), and licensed Medical Review Officers (MROs).</p>
        </div>
        <Btn onClick={onAccept} full size="lg" v="dark"><Shield size={15}/>I Understand — Proceed to Application</Btn>
      </div>
    </div>
  </div>;
}

function TCModal({onClose,isMobile}){
  return <Modal title="TERMS & CONDITIONS — SCREENING SOLUTIONS" onClose={onClose} isMobile={isMobile} width={700}>
    <div style={{background:'#fffbeb',border:'1px solid '+T.gold,borderRadius:6,padding:'10px 14px',marginBottom:16}}>
      <p style={{margin:0,fontSize:12,fontFamily:FONT_BODY,color:T.sub,fontWeight:700}}>Screening Solutions — Beta Software · Not a Final Product</p>
    </div>
    <div style={{fontFamily:FONT_BODY,fontSize:11,color:T.sub,lineHeight:1.8,maxHeight:'65vh',overflow:'auto',padding:'0 4px'}}>
      {TC_SECTIONS.map((sec,i)=>(
        <div key={i} style={{marginBottom:24}}>
          <h4 style={{fontFamily:FONT_HEAD,fontSize:13,color:T.text,letterSpacing:'0.05em',margin:'0 0 10px',borderBottom:'2px solid '+T.gold,paddingBottom:6}}>{sec.title}</h4>
          {sec.body.split('\n\n').map((para,j)=>(
            <p key={j} style={{margin:'0 0 10px',fontSize:10.5,lineHeight:1.75,color:'#444'}}>{para}</p>
          ))}
        </div>
      ))}
      <div style={{borderTop:'2px solid '+T.gold,paddingTop:14,marginTop:10}}>
        <p style={{fontSize:10,color:T.muted,textAlign:'center',fontStyle:'italic'}}>Screening Solutions — Version: BETA — Development Build. Not for use as the sole compliance mechanism in regulated drug testing programs.</p>
      </div>
    </div>
    <div style={{marginTop:16,display:'flex',justifyContent:'flex-end'}}><Btn onClick={onClose} v="dark">Close</Btn></div>
  </Modal>;
}

// ─── SIGNATURE PAD ────────────────────────────────────────────────────────
function SignaturePad({onSave,onCancel}){
  const cvs=useRef(null),drawing=useRef(false);
  const getXY=(e)=>{const r=cvs.current.getBoundingClientRect();const src=e.touches?e.touches[0]:e;return[src.clientX-r.left,src.clientY-r.top];};
  const start=(e)=>{drawing.current=true;const ctx=cvs.current.getContext('2d');const[x,y]=getXY(e);ctx.beginPath();ctx.moveTo(x,y);};
  const move=(e)=>{if(!drawing.current)return;e.preventDefault();const ctx=cvs.current.getContext('2d');const[x,y]=getXY(e);ctx.lineTo(x,y);ctx.strokeStyle='#000';ctx.lineWidth=2.5;ctx.lineCap='round';ctx.lineJoin='round';ctx.stroke();};
  const end=()=>{drawing.current=false;};
  const clear=()=>{const ctx=cvs.current.getContext('2d');ctx.clearRect(0,0,cvs.current.width,cvs.current.height);};
  return <div>
    <p style={{fontSize:12,color:T.muted,marginBottom:8,fontFamily:FONT_BODY}}>Draw your signature:</p>
    <canvas ref={cvs} width={500} height={120} style={{background:'#fafafa',border:'2px solid '+T.border,borderRadius:6,cursor:'crosshair',display:'block',width:'100%',touchAction:'none'}}
      onMouseDown={start} onMouseMove={move} onMouseUp={end} onMouseLeave={end} onTouchStart={start} onTouchMove={move} onTouchEnd={end}/>
    <div style={{display:'flex',gap:8,marginTop:10}}>
      <Btn onClick={clear} v="ghost" size="sm">Clear</Btn>
      <Btn onClick={onCancel} v="ghost" size="sm">Cancel</Btn>
      <Btn onClick={()=>onSave(cvs.current.toDataURL())} size="sm"><PenLine size={13}/>Sign & Complete</Btn>
    </div>
  </div>;
}


// ─── TUTORIAL ─────────────────────────────────────────────────────────────
function TutorialOverlay({onFinish,setView}){
  const[step,setStep]=useState(0);const isMobile=useIsMobile();const cur=TUTORIAL[step];const isLast=step===TUTORIAL.length-1;
  const goNext=()=>isLast?onFinish():setStep(s=>s+1);const goPrev=()=>{if(step>0)setStep(s=>s-1);};
  return <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.85)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:9000,padding:16}}>
    <div style={{width:'100%',maxWidth:500,background:'#fff',border:'3px solid '+T.gold,borderRadius:16,overflow:'hidden',boxShadow:'0 40px 100px rgba(0,0,0,0.5)',maxHeight:'95vh',display:'flex',flexDirection:'column'}}>
      <div style={{height:4,background:T.border,flexShrink:0}}><div style={{height:'100%',background:T.gold,width:((step+1)/TUTORIAL.length*100)+'%',transition:'width 0.4s'}}/></div>
      <div style={{background:T.nav,padding:'12px 20px',display:'flex',justifyContent:'space-between',alignItems:'center',flexShrink:0}}>
        <span style={{fontFamily:FONT_HEAD,fontSize:12,color:T.gold,letterSpacing:'0.1em'}}>STEP {step+1} OF {TUTORIAL.length}</span>
        <button onClick={onFinish} style={{background:'none',border:'none',color:T.navMuted,cursor:'pointer',fontFamily:FONT_BODY,fontSize:12}}>Skip</button>
      </div>
      <div style={{padding:isMobile?'20px 18px':'28px 36px',overflow:'auto',flex:1}}>
        <div style={{display:'flex',gap:4,marginBottom:20,justifyContent:'center'}}>
          {TUTORIAL.map((_,i)=><div key={i} onClick={()=>setStep(i)} style={{width:i===step?20:6,height:6,borderRadius:3,background:i===step?T.gold:i<step?T.goldD:T.border,transition:'all 0.3s',cursor:'pointer'}}/>)}
        </div>
        <div style={{textAlign:'center',marginBottom:20}}>
          <div style={{fontSize:48,marginBottom:10}}>{cur.icon}</div>
          <h2 style={{margin:'0 0 10px',fontFamily:FONT_HEAD,fontSize:isMobile?18:22,color:T.text,letterSpacing:'0.05em'}}>{cur.title}</h2>
          <p style={{margin:0,fontSize:isMobile?13:14,color:T.sub,lineHeight:1.7,fontFamily:FONT_BODY}}>{cur.desc}</p>
        </div>
        {cur.nav&&<div style={{textAlign:'center',marginBottom:14}}><Btn onClick={()=>{setView(cur.nav);onFinish();}} v="dark" size="sm"><Zap size={12}/>Go to this section</Btn></div>}
        <div style={{display:'flex',gap:10,justifyContent:'center'}}>
          {step>0&&<Btn onClick={goPrev} v="secondary"><ChevronLeft size={15}/>Prev</Btn>}
          <Btn onClick={goNext} size="lg" v="dark" style={{minWidth:150}}>{isLast?<><CheckCircle2 size={15}/>Get Started!</>:<>Next<ChevronRight size={15}/></>}</Btn>
        </div>
      </div>
    </div>
  </div>;
}

// ─── AUTH ─────────────────────────────────────────────────────────────────
function LoginView({allUsers,onLogin,onGoSetup}){
  const[email,setEmail]=useState('');const[pass,setPass]=useState('');const[show,setShow]=useState(false);const[err,setErr]=useState('');
  const submit=()=>{const u=allUsers.find(u=>u.email.toLowerCase()===email.toLowerCase()&&u.password===pass);if(!u){setErr('Invalid email or password.');return;}onLogin(u);};
  return <div style={{minHeight:'100vh',background:T.bg,display:'flex',alignItems:'center',justifyContent:'center',fontFamily:FONT_BODY,padding:16}}>
    <div style={{width:'100%',maxWidth:400}}>
      <div style={{textAlign:'center',marginBottom:32}}>
        <div style={{width:64,height:64,borderRadius:12,background:T.nav,display:'flex',alignItems:'center',justifyContent:'center',margin:'0 auto 14px',border:'3px solid '+T.gold}}><span style={{fontSize:28}}>⚖</span></div>
        <h1 style={{fontFamily:FONT_HEAD,fontSize:28,color:T.text,margin:'0 0 4px',letterSpacing:'0.08em'}}>SCREENING SOLUTIONS</h1>
        <p style={{color:T.muted,fontSize:13,margin:0}}>Drug Screening Management Platform</p>
        <div style={{display:'inline-block',marginTop:8,background:'#fffbeb',border:'1px solid '+T.gold,borderRadius:4,padding:'3px 10px'}}><span style={{fontSize:10,fontWeight:700,color:T.prog,letterSpacing:'0.08em'}}>⚠ BETA — DEVELOPMENT BUILD</span></div>
      </div>
      <Card style={{padding:24}}>
        <h3 style={{margin:'0 0 18px',color:T.text,fontFamily:FONT_HEAD,fontSize:18,letterSpacing:'0.05em'}}>SIGN IN</h3>
        <FieldInput label="Email" type="email" placeholder="you@company.com" value={email} onChange={e=>setEmail(e.target.value)}/>
        <div style={{position:'relative'}}>
          <FieldInput label="Password" type={show?'text':'password'} placeholder="••••••••" value={pass} onChange={e=>setPass(e.target.value)}/>
          <button onClick={()=>setShow(s=>!s)} style={{position:'absolute',right:12,top:28,background:'none',border:'none',color:T.muted,cursor:'pointer'}}>{show?<EyeOff size={15}/>:<Eye size={15}/>}</button>
        </div>
        {err&&<p style={{color:T.warn,fontSize:12,margin:'0 0 12px',fontWeight:700}}>{err}</p>}
        <Btn onClick={submit} full size="lg" v="dark">Sign In</Btn>
        <p style={{textAlign:'center',marginTop:14,fontSize:12,color:T.muted}}>No account? <span onClick={onGoSetup} style={{color:T.goldD,cursor:'pointer',fontWeight:700}}>Create profile →</span></p>
      </Card>
    </div>
  </div>;
}

function SetupView({allUsers,onSave,onBack}){
  const[form,setForm]=useState({email:'',username:'',password:'',confirm:'',profilePic:''});
  const[show,setShow]=useState(false);const[err,setErr]=useState('');const[agreed,setAgreed]=useState(false);const[showTC,setShowTC]=useState(false);
  const isMobile=useIsMobile();
  const set=(k,v)=>setForm(f=>({...f,[k]:v}));
  const handlePic=(e)=>{const f=e.target.files[0];if(!f)return;const r=new FileReader();r.onload=()=>set('profilePic',r.result);r.readAsDataURL(f);};
  const submit=()=>{
    if(!form.email||!form.username||!form.password){setErr('All fields required.');return;}
    if(form.password!==form.confirm){setErr('Passwords do not match.');return;}
    if(!agreed){setErr('You must agree to the Terms & Conditions.');return;}
    if(allUsers.find(u=>u.email.toLowerCase()===form.email.toLowerCase())){setErr('Email already registered.');return;}
    onSave({...form,id:uid(),confirm:undefined,tutorialSeen:false});
  };
  return <div style={{minHeight:'100vh',background:T.bg,display:'flex',alignItems:'center',justifyContent:'center',fontFamily:FONT_BODY,padding:16}}>
    {showTC&&<TCModal onClose={()=>setShowTC(false)} isMobile={isMobile}/>}
    <div style={{width:'100%',maxWidth:460}}>
      <div style={{textAlign:'center',marginBottom:20}}><h1 style={{fontFamily:FONT_HEAD,fontSize:24,color:T.text,margin:'0 0 4px',letterSpacing:'0.08em'}}>CREATE PROFILE</h1><p style={{color:T.muted,fontSize:13,margin:0}}>Set up your HR administrator account</p></div>
      <Card style={{padding:24}}>
        <div style={{textAlign:'center',marginBottom:18}}>
          <div onClick={()=>document.getElementById('picInput').click()} style={{width:72,height:72,borderRadius:'50%',background:T.bg,border:'3px solid '+T.border,cursor:'pointer',overflow:'hidden',display:'flex',alignItems:'center',justifyContent:'center',margin:'0 auto'}}>
            {form.profilePic?<img src={form.profilePic} style={{width:'100%',height:'100%',objectFit:'cover'}} alt="profile"/>:<UserCircle size={32} color={T.muted}/>}
          </div>
          <input id="picInput" type="file" accept="image/*" onChange={handlePic} style={{display:'none'}}/>
          <p style={{fontSize:11,color:T.muted,marginTop:6}}>Click to upload photo</p>
        </div>
        <FieldInput label="Email" type="email" placeholder="you@company.com" value={form.email} onChange={e=>set('email',e.target.value)}/>
        <FieldInput label="Display Name" placeholder="Jane Smith" value={form.username} onChange={e=>set('username',e.target.value)}/>
        <div style={{position:'relative'}}>
          <FieldInput label="Password" type={show?'text':'password'} placeholder="••••••••" value={form.password} onChange={e=>set('password',e.target.value)}/>
          <button onClick={()=>setShow(s=>!s)} style={{position:'absolute',right:12,top:28,background:'none',border:'none',color:T.muted,cursor:'pointer'}}>{show?<EyeOff size={15}/>:<Eye size={15}/>}</button>
        </div>
        <FieldInput label="Confirm Password" type="password" placeholder="••••••••" value={form.confirm} onChange={e=>set('confirm',e.target.value)}/>
        <div style={{background:'#fafafa',border:'1px solid '+T.border,borderRadius:6,padding:'12px 14px',marginBottom:14}}>
          <label style={{display:'flex',alignItems:'flex-start',gap:10,cursor:'pointer'}}>
            <input type="checkbox" checked={agreed} onChange={e=>setAgreed(e.target.checked)} style={{width:16,height:16,marginTop:2,accentColor:T.goldD,flexShrink:0}}/>
            <span style={{fontSize:12,color:T.sub,lineHeight:1.6}}>I agree to the Terms & Conditions</span>
          </label>
          <p style={{margin:'8px 0 0 26px',fontSize:10,color:T.muted,lineHeight:1.6}}>
            By checking this box you agree to all terms governing use of Screening Solutions.{' '}
            <span onClick={()=>setShowTC(true)} style={{color:T.goldD,cursor:'pointer',textDecoration:'underline',fontWeight:700}}>Read full Terms & Conditions →</span>
          </p>
        </div>
        {err&&<p style={{color:T.warn,fontSize:12,margin:'0 0 12px',fontWeight:700}}>{err}</p>}
        <Btn onClick={submit} full size="lg" v="dark" style={{marginBottom:10}}>Create Account</Btn>
        <Btn onClick={onBack} v="ghost" full>Back to Login</Btn>
      </Card>
    </div>
  </div>;
}


// ─── NAV ──────────────────────────────────────────────────────────────────
const NAV=[
  {v:'dashboard',icon:LayoutDashboard,label:'Dashboard'},
  {v:'employees',icon:Users,label:'Employees'},
  {v:'picker',icon:Shuffle,label:'Picker'},
  {v:'drugtests',icon:FlaskConical,label:'Drug Tests'},
  {v:'screenings',icon:ClipboardList,label:'Screenings'},
  {v:'history',icon:Archive,label:'History'},
  {v:'calendar',icon:CalendarDays,label:'Calendar'},
  {v:'reports',icon:BarChart2,label:'Reports'},
  {v:'settings',icon:Settings,label:'Settings'},
  {v:'profile',icon:UserCircle,label:'Profile'},
];
const BOTTOM_NAV=['dashboard','picker','drugtests','screenings'];

function Sidebar({view,setView,user,onLogout,onExit,schedulerOn,companyLogo,companyName}){
  return <div style={{width:215,background:T.nav,display:'flex',flexDirection:'column',padding:'18px 0',flexShrink:0}}>
    <div style={{padding:'0 14px 16px',borderBottom:'1px solid rgba(0,0,0,.08)'}}>
      {onExit&&<div onClick={onExit} style={{cursor:'pointer',display:'inline-flex',alignItems:'center',gap:6,fontFamily:FONT_BODY,fontSize:11,letterSpacing:'2px',textTransform:'uppercase',color:'#F97316',marginBottom:12,transition:'opacity .2s'}} onMouseEnter={e=>e.currentTarget.style.opacity='.7'} onMouseLeave={e=>e.currentTarget.style.opacity='1'}>← Dashboard</div>}
      {companyLogo?<div style={{display:'flex',alignItems:'center',gap:10,marginBottom:10}}>
        <img src={companyLogo} style={{width:36,height:36,borderRadius:6,objectFit:'contain',background:'#fff',padding:2}} alt="logo"/>
        <span style={{fontFamily:FONT_HEAD,fontSize:12,color:T.gold,letterSpacing:'0.05em'}}>{companyName||'YOUR COMPANY'}</span>
      </div>:<div style={{display:'flex',alignItems:'center',gap:10,marginBottom:10}}>
        <div style={{width:36,height:36,borderRadius:6,background:'transparent',border:'2px solid '+T.gold,display:'flex',alignItems:'center',justifyContent:'center',fontSize:16}}>⚖</div>
        <div><div style={{fontFamily:FONT_HEAD,fontSize:13,color:T.gold,letterSpacing:'0.05em'}}>SCREENING</div><div style={{fontSize:9,color:T.navMuted}}>HR COMPLIANCE</div></div>
      </div>}
      {schedulerOn&&<div style={{display:'flex',alignItems:'center',gap:5,background:'rgba(249,115,22,0.1)',border:'1px solid rgba(249,115,22,0.3)',borderRadius:4,padding:'3px 7px'}}>
        <div style={{width:6,height:6,borderRadius:'50%',background:T.gold,animation:'pulse 2s infinite'}}/><span style={{fontSize:9,color:T.gold,fontWeight:700,fontFamily:FONT_BODY,letterSpacing:'0.08em'}}>SCHEDULER ACTIVE</span>
      </div>}
    </div>
    <nav style={{flex:1,padding:'10px 6px',overflow:'auto'}}>
      {NAV.map(({v,icon:Icon,label})=>{const active=view===v;return <div key={v} onClick={()=>setView(v)} style={{display:'flex',alignItems:'center',gap:9,padding:'8px 10px',borderRadius:6,cursor:'pointer',marginBottom:1,background:active?T.gold:'transparent',color:active?'#000':T.navMuted,transition:'all 0.15s'}} onMouseEnter={e=>{if(!active){e.currentTarget.style.background='rgba(249,115,22,0.12)';e.currentTarget.style.color=T.gold;}}} onMouseLeave={e=>{if(!active){e.currentTarget.style.background='transparent';e.currentTarget.style.color=T.navMuted;}}}>
        <Icon size={14}/><span style={{fontSize:12,fontWeight:700,fontFamily:FONT_BODY,letterSpacing:'0.05em',textTransform:'uppercase'}}>{label}</span>
        {v==='settings'&&schedulerOn&&!active&&<div style={{width:5,height:5,borderRadius:'50%',background:T.gold,marginLeft:'auto'}}/>}
      </div>;})}
    </nav>
    <div style={{padding:'10px 6px',borderTop:'1px solid rgba(0,0,0,.08)'}}>
      <div style={{display:'flex',alignItems:'center',gap:8,padding:'6px 10px',marginBottom:2}}>
        {user.profilePic?<img src={user.profilePic} style={{width:26,height:26,borderRadius:'50%',objectFit:'cover',border:'2px solid '+T.gold}} alt="user"/>:<UserCircle size={26} color={T.navMuted}/>}
        <div style={{overflow:'hidden',flex:1}}><div style={{fontSize:11,fontWeight:700,color:T.navText,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',fontFamily:FONT_BODY}}>{user.username}</div><div style={{fontSize:9,color:T.navMuted,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',fontFamily:FONT_BODY}}>{user.email}</div></div>
      </div>
      <div onClick={onLogout} style={{display:'flex',alignItems:'center',gap:7,padding:'6px 10px',borderRadius:6,cursor:'pointer',color:T.navMuted,fontFamily:FONT_BODY,fontSize:11,fontWeight:700,letterSpacing:'0.05em',textTransform:'uppercase'}} onMouseEnter={e=>e.currentTarget.style.color='#f87171'} onMouseLeave={e=>e.currentTarget.style.color=T.navMuted}>
        <LogOut size={13}/>Sign Out
      </div>
    </div>
  </div>;
}

function MobileTopBar({view,user,onMenu,schedulerOn,companyLogo}){
  return <div style={{background:T.nav,borderBottom:'2px solid '+T.gold,padding:'10px 14px',display:'flex',alignItems:'center',justifyContent:'space-between',flexShrink:0,position:'sticky',top:0,zIndex:100}}>
    <div style={{display:'flex',alignItems:'center',gap:10}}>
      {companyLogo?<img src={companyLogo} style={{width:28,height:28,borderRadius:4,objectFit:'contain',background:'#fff',padding:2}} alt="logo"/>:<div style={{width:28,height:28,borderRadius:4,border:'2px solid '+T.gold,display:'flex',alignItems:'center',justifyContent:'center',fontSize:12}}>⚖</div>}
      <h2 style={{margin:0,fontFamily:FONT_HEAD,fontSize:15,color:T.gold,letterSpacing:'0.08em'}}>{NAV.find(n=>n.v===view)?.label?.toUpperCase()||'DASHBOARD'}</h2>
      {schedulerOn&&<div style={{width:6,height:6,borderRadius:'50%',background:T.gold,animation:'pulse 2s infinite'}}/>}
    </div>
    <div style={{display:'flex',alignItems:'center',gap:8}}>
      {user.profilePic?<img src={user.profilePic} style={{width:26,height:26,borderRadius:'50%',objectFit:'cover',border:'2px solid '+T.gold}} alt="user"/>:<UserCircle size={26} color={T.navMuted}/>}
      <button onClick={onMenu} style={{background:'none',border:'none',color:T.gold,cursor:'pointer',display:'flex',padding:4}}><Menu size={22}/></button>
    </div>
  </div>;
}

function MobileBottomNav({view,setView,onMore}){
  const items=BOTTOM_NAV.map(v=>NAV.find(n=>n.v===v));
  return <div style={{background:T.nav,borderTop:'2px solid '+T.gold,display:'flex',alignItems:'stretch',flexShrink:0,position:'sticky',bottom:0,zIndex:100}}>
    {items.map(({v,icon:Icon,label})=>{const active=view===v;return <div key={v} onClick={()=>setView(v)} style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',padding:'8px 4px',cursor:'pointer',color:active?T.gold:T.navMuted,borderTop:active?'3px solid '+T.gold:'3px solid transparent',background:active?'rgba(249,115,22,0.08)':'transparent'}}>
      <Icon size={18}/><span style={{fontSize:8,marginTop:2,fontWeight:800,fontFamily:FONT_BODY,letterSpacing:'0.08em',textTransform:'uppercase'}}>{label}</span>
    </div>;})}
    <div onClick={onMore} style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',padding:'8px 4px',cursor:'pointer',color:T.navMuted,borderTop:'3px solid transparent'}}>
      <Menu size={18}/><span style={{fontSize:8,marginTop:2,fontWeight:800,fontFamily:FONT_BODY,letterSpacing:'0.08em'}}>MORE</span>
    </div>
  </div>;
}

function MobileDrawer({view,setView,user,onLogout,onExit,onClose,schedulerOn,companyLogo,companyName}){
  return <div onClick={e=>e.target===e.currentTarget&&onClose()} style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.7)',zIndex:500,display:'flex',alignItems:'flex-end'}}>
    <div style={{background:T.nav,borderTop:'3px solid '+T.gold,width:'100%',padding:20,maxHeight:'85vh',overflow:'auto',borderRadius:'16px 16px 0 0'}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
        <div style={{display:'flex',alignItems:'center',gap:10}}>
          {user.profilePic?<img src={user.profilePic} style={{width:34,height:34,borderRadius:'50%',objectFit:'cover',border:'2px solid '+T.gold}} alt="user"/>:<UserCircle size={34} color={T.navMuted}/>}
          <div><div style={{fontSize:13,fontWeight:700,color:T.navText,fontFamily:FONT_BODY}}>{user.username}</div><div style={{fontSize:10,color:T.navMuted,fontFamily:FONT_BODY}}>{user.email}</div></div>
        </div>
        <button onClick={onClose} style={{background:'none',border:'none',color:T.navMuted,cursor:'pointer'}}><X size={20}/></button>
      </div>
      {onExit&&<div onClick={()=>{onClose();onExit();}} style={{cursor:'pointer',display:'flex',alignItems:'center',gap:6,fontFamily:FONT_BODY,fontSize:12,letterSpacing:'2px',textTransform:'uppercase',color:'#F97316',marginBottom:14,padding:'8px 12px',background:'rgba(249,115,22,.06)',borderRadius:8,border:'1px solid rgba(249,115,22,.15)'}}>← Back to Dashboard</div>}
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginBottom:16}}>
        {NAV.map(({v,icon:Icon,label})=>{const active=view===v;return <div key={v} onClick={()=>{setView(v);onClose();}} style={{display:'flex',alignItems:'center',gap:8,padding:'10px 12px',borderRadius:8,cursor:'pointer',background:active?T.gold:'rgba(0,0,0,0.03)',color:active?'#000':T.navMuted,border:'1px solid '+(active?T.gold:'rgba(0,0,0,.1)')}}>
          <Icon size={14}/><span style={{fontSize:12,fontWeight:700,fontFamily:FONT_BODY,textTransform:'uppercase'}}>{label}</span>
        </div>;})}
      </div>
      {onLogout&&<Btn onClick={()=>{onLogout();onClose();}} v="danger" full><LogOut size={13}/>Sign Out</Btn>}
    </div>
  </div>;
}


// ─── EMPLOYEE DETAIL MODAL ────────────────────────────────────────────────
function EmployeeDetailModal({employee,screenings,onClose,onSave,isMobile}){
  const[form,setForm]=useState({notes:employee.notes||'',prescriptions:employee.prescriptions||''});
  const empScreenings=screenings.filter(s=>s.employeeId===employee.id).sort((a,b)=>new Date(b.pickedAt)-new Date(a.pickedAt));
  const save=()=>{onSave({...employee,notes:form.notes,prescriptions:form.prescriptions});onClose();};
  return <Modal title={'EMPLOYEE: '+employee.name} onClose={onClose} isMobile={isMobile} width={640}>
    <div style={{display:'grid',gridTemplateColumns:isMobile?'1fr':'1fr 1fr',gap:10,marginBottom:16}}>
      {[['Name',employee.name],['Employee ID',employee.id],['Position',employee.position||'—'],['Title',employee.title||'—'],['Department',employee.department||'—'],['Classification',employee.isManagement?'Management':'Staff']].map(([l,v])=><MobileRow key={l} label={l} value={v}/>)}
    </div>
    {employee.isExempt&&<div style={{background:'#f5f3ff',border:'2px solid #7c3aed',borderRadius:6,padding:'8px 12px',marginBottom:14,display:'flex',gap:8,alignItems:'center'}}>
      <Ban size={14} color="#7c3aed"/><span style={{fontSize:12,fontWeight:700,color:'#7c3aed',fontFamily:FONT_BODY}}>EXEMPT FROM RANDOM SCREENINGS</span>
    </div>}
    <div style={{borderTop:'2px solid '+T.gold,paddingTop:14,marginBottom:14}}>
      <h4 style={{margin:'0 0 10px',fontFamily:FONT_HEAD,fontSize:14,color:T.text,letterSpacing:'0.05em',display:'flex',alignItems:'center',gap:6}}><Pill size={14} color={T.goldD}/>PRESCRIPTIONS & MEDICAL EXEMPTIONS</h4>
      <FieldTextarea label="Prescriptions / Medical Notes (confidential)" placeholder="Enter any relevant prescription medications, medical exemptions, or MRO notes..." value={form.prescriptions} onChange={e=>setForm(f=>({...f,prescriptions:e.target.value}))} style={{minHeight:90}}/>
    </div>
    <div style={{marginBottom:14}}>
      <h4 style={{margin:'0 0 10px',fontFamily:FONT_HEAD,fontSize:14,color:T.text,letterSpacing:'0.05em',display:'flex',alignItems:'center',gap:6}}><FileText size={14} color={T.goldD}/>GENERAL NOTES</h4>
      <FieldTextarea label="Employee Notes" placeholder="Enter general HR notes for this employee..." value={form.notes} onChange={e=>setForm(f=>({...f,notes:e.target.value}))} style={{minHeight:70}}/>
    </div>
    <div style={{borderTop:'1px solid '+T.border,paddingTop:14}}>
      <h4 style={{margin:'0 0 10px',fontFamily:FONT_HEAD,fontSize:14,color:T.text,letterSpacing:'0.05em'}}>SCREENING HISTORY ({empScreenings.length})</h4>
      {empScreenings.length===0?<p style={{color:T.muted,fontSize:13,fontFamily:FONT_BODY}}>No screenings on record.</p>:
        <div style={{maxHeight:180,overflow:'auto'}}>
          {empScreenings.map(s=><div key={s.id} style={{display:'flex',alignItems:'center',gap:8,padding:'7px 0',borderBottom:'1px solid '+T.border}}>
            <div style={{flex:1}}><div style={{fontSize:12,fontWeight:700,color:T.text,fontFamily:FONT_BODY}}>{(s.type||'random').replace(/-/g,' ').toUpperCase()}</div><div style={{fontSize:11,color:T.muted,fontFamily:FONT_BODY}}>{fmtDT(s.pickedAt)}</div></div>
            {s.result&&<Badge status={s.result}/>}
            <Badge status={s.status}/>
          </div>)}
        </div>}
    </div>
    <div style={{display:'flex',gap:8,marginTop:16}}>
      <Btn onClick={save} v="dark" style={{flex:1}}>Save Notes</Btn>
      <Btn onClick={onClose} v="secondary">Cancel</Btn>
    </div>
  </Modal>;
}

// ─── ADD EMPLOYEE MODAL ───────────────────────────────────────────────────
function AddEmployeeModal({onSave,onClose,isMobile,existing}){
  const[form,setForm]=useState({id:'',name:'',position:'Staff',title:'',department:'',isManagement:false,isExempt:false,notes:'',prescriptions:''});
  const[err,setErr]=useState('');
  const set=(k,v)=>setForm(f=>({...f,[k]:v}));
  const submit=()=>{
    if(!form.id.trim()||!form.name.trim()){setErr('Employee ID and Name are required.');return;}
    if(existing.find(e=>e.id===form.id.trim())){setErr('Employee ID already exists.');return;}
    onSave({...form,id:form.id.trim(),name:form.name.trim()});
    onClose();
  };
  return <Modal title="ADD EMPLOYEE" onClose={onClose} isMobile={isMobile} width={560}>
    <div style={{display:'grid',gridTemplateColumns:isMobile?'1fr':'1fr 1fr',gap:'0 16px'}}>
      <FieldInput label="Employee ID *" placeholder="EMP001" value={form.id} onChange={e=>set('id',e.target.value)}/>
      <FieldInput label="Full Name *" placeholder="Jane Smith" value={form.name} onChange={e=>set('name',e.target.value)}/>
      <FieldInput label="Job Title" placeholder="Senior Technician" value={form.title} onChange={e=>set('title',e.target.value)}/>
      <FieldInput label="Department" placeholder="Operations" value={form.department} onChange={e=>set('department',e.target.value)}/>
      <FieldSelect label="Position / Level" value={form.position} onChange={e=>set('position',e.target.value)}>
        {POSITIONS.map(p=><option key={p} value={p}>{p}</option>)}
      </FieldSelect>
    </div>
    <div style={{background:'#fafafa',border:'1px solid '+T.border,borderRadius:6,padding:'12px 14px',marginBottom:14}}>
      <div style={{marginBottom:10}}><Toggle checked={form.isManagement} onChange={()=>set('isManagement',!form.isManagement)} label="Management Classification"/></div>
      <Toggle checked={form.isExempt} onChange={()=>set('isExempt',!form.isExempt)} label="Exempt from Random Screening"/>
      {form.isExempt&&<p style={{fontSize:11,color:'#7c3aed',margin:'8px 0 0',fontFamily:FONT_BODY,fontWeight:700}}>⚠ Exempt employees are excluded from all random picks. Verify compliance with applicable regulations.</p>}
    </div>
    <FieldTextarea label="Notes (optional)" placeholder="HR notes..." value={form.notes} onChange={e=>set('notes',e.target.value)} style={{minHeight:60}}/>
    <FieldTextarea label="Prescriptions / Medical (optional)" placeholder="Prescription medications or medical exemptions..." value={form.prescriptions} onChange={e=>set('prescriptions',e.target.value)} style={{minHeight:60}}/>
    {err&&<p style={{color:T.warn,fontSize:12,fontWeight:700,margin:'0 0 12px'}}>{err}</p>}
    <div style={{display:'flex',gap:8}}>
      <Btn onClick={submit} v="dark" style={{flex:1}}><Plus size={14}/>Add Employee</Btn>
      <Btn onClick={onClose} v="secondary">Cancel</Btn>
    </div>
  </Modal>;
}

// ─── EDIT EMPLOYEE MODAL ──────────────────────────────────────────────────
function EditEmployeeModal({employee,onSave,onClose,isMobile,existing}){
  const[form,setForm]=useState({...employee});
  const[err,setErr]=useState('');
  const set=(k,v)=>setForm(f=>({...f,[k]:v}));
  const submit=()=>{
    if(!form.id.trim()||!form.name.trim()){setErr('ID and Name required.');return;}
    const conflict=existing.find(e=>e.id===form.id.trim()&&e.id!==employee.id);
    if(conflict){setErr('Employee ID already in use.');return;}
    onSave({...form,id:form.id.trim(),name:form.name.trim()});
    onClose();
  };
  return <Modal title={'EDIT: '+employee.name} onClose={onClose} isMobile={isMobile} width={560}>
    <div style={{display:'grid',gridTemplateColumns:isMobile?'1fr':'1fr 1fr',gap:'0 16px'}}>
      <FieldInput label="Employee ID *" value={form.id} onChange={e=>set('id',e.target.value)}/>
      <FieldInput label="Full Name *" value={form.name} onChange={e=>set('name',e.target.value)}/>
      <FieldInput label="Job Title" value={form.title||''} onChange={e=>set('title',e.target.value)}/>
      <FieldInput label="Department" value={form.department||''} onChange={e=>set('department',e.target.value)}/>
      <FieldSelect label="Position / Level" value={form.position||'Staff'} onChange={e=>set('position',e.target.value)}>
        {POSITIONS.map(p=><option key={p} value={p}>{p}</option>)}
      </FieldSelect>
    </div>
    <div style={{background:'#fafafa',border:'1px solid '+T.border,borderRadius:6,padding:'12px 14px',marginBottom:14}}>
      <div style={{marginBottom:10}}><Toggle checked={!!form.isManagement} onChange={()=>set('isManagement',!form.isManagement)} label="Management Classification"/></div>
      <Toggle checked={!!form.isExempt} onChange={()=>set('isExempt',!form.isExempt)} label="Exempt from Random Screening"/>
      {form.isExempt&&<p style={{fontSize:11,color:'#7c3aed',margin:'8px 0 0',fontFamily:FONT_BODY,fontWeight:700}}>⚠ Exempt employees are excluded from all random picks.</p>}
    </div>
    <FieldTextarea label="Notes" value={form.notes||''} onChange={e=>set('notes',e.target.value)} style={{minHeight:60}}/>
    <FieldTextarea label="Prescriptions / Medical" value={form.prescriptions||''} onChange={e=>set('prescriptions',e.target.value)} style={{minHeight:60}}/>
    {err&&<p style={{color:T.warn,fontSize:12,fontWeight:700,margin:'0 0 12px'}}>{err}</p>}
    <div style={{display:'flex',gap:8}}>
      <Btn onClick={submit} v="dark" style={{flex:1}}>Save Changes</Btn>
      <Btn onClick={onClose} v="secondary">Cancel</Btn>
    </div>
  </Modal>;
}

// ─── EMPLOYEES VIEW ───────────────────────────────────────────────────────
// ─── COLUMN MAPPER MODAL ──────────────────────────────────────────────────────
function ColMapModal({data,onImport,onClose,isMobile}){
  const{rows,cols,fk:detectedFk,lk:detectedLk,ik:detectedIk}=data;
  const[nameMode,setNameMode]=useState((detectedFk&&detectedLk)?'split':'single');
  const[nameCol,setNameCol]=useState('');
  const[firstCol,setFirstCol]=useState(detectedFk||'');
  const[lastCol,setLastCol]=useState(detectedLk||'');
  const[idCol,setIdCol]=useState(detectedIk||'');
  const[posCol,setPosCol]=useState('');
  const[titleCol,setTitleCol]=useState('');
  const[deptCol,setDeptCol]=useState('');
  const[err,setErr]=useState('');
  const preview=rows.slice(0,3);
  const submit=()=>{if(!idCol){setErr('ID column is required.');return;}if(nameMode==='single'&&!nameCol){setErr('Name column is required.');return;}if(nameMode==='split'&&!firstCol&&!lastCol){setErr('Select at least one name column.');return;}if(nameMode==='single')onImport(rows,nameCol,idCol,posCol||null,titleCol||null,deptCol||null,null,null);else onImport(rows,null,idCol,posCol||null,titleCol||null,deptCol||null,firstCol||null,lastCol||null);};
  const starCols=nameMode==='single'?[nameCol,idCol]:[firstCol,lastCol,idCol];
  return <Modal title="MAP EXCEL COLUMNS" onClose={onClose} isMobile={isMobile} width={600}>
    <div style={{background:'#fffbeb',border:'1px solid '+T.gold,borderRadius:6,padding:'10px 14px',marginBottom:16}}><p style={{margin:0,fontSize:12,fontFamily:FONT_BODY,color:T.sub,fontWeight:700}}>{rows.length} rows · {cols.length} columns. Map your columns to Screening Solutions fields.</p></div>
    <div style={{marginBottom:14}}>
      <label style={{display:'block',fontSize:11,fontWeight:700,color:T.warn,letterSpacing:'0.08em',textTransform:'uppercase',marginBottom:8,fontFamily:FONT_BODY}}>Employee Name * (required)</label>
      <div style={{display:'flex',gap:8,marginBottom:8}}>
        <Btn onClick={()=>setNameMode('single')} v={nameMode==='single'?'dark':'ghost'} size="sm">Single Name Column</Btn>
        <Btn onClick={()=>setNameMode('split')} v={nameMode==='split'?'dark':'ghost'} size="sm">First + Last Name Columns</Btn>
      </div>
      {nameMode==='single'?<select value={nameCol} onChange={e=>setNameCol(e.target.value)} style={{width:'100%',boxSizing:'border-box',background:'#fafafa',border:'2px solid '+T.warn,borderRadius:6,padding:'10px 12px',color:T.text,fontSize:14,fontFamily:FONT_BODY,outline:'none'}}><option value="">— Select Name column —</option>{cols.map(c=><option key={c} value={c}>{c}</option>)}</select>:
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
        <select value={firstCol} onChange={e=>setFirstCol(e.target.value)} style={{width:'100%',boxSizing:'border-box',background:'#fafafa',border:'2px solid '+T.warn,borderRadius:6,padding:'10px 12px',color:T.text,fontSize:14,fontFamily:FONT_BODY,outline:'none'}}><option value="">— First Name column —</option>{cols.map(c=><option key={c} value={c}>{c}</option>)}</select>
        <select value={lastCol} onChange={e=>setLastCol(e.target.value)} style={{width:'100%',boxSizing:'border-box',background:'#fafafa',border:'2px solid '+T.warn,borderRadius:6,padding:'10px 12px',color:T.text,fontSize:14,fontFamily:FONT_BODY,outline:'none'}}><option value="">— Last Name column —</option>{cols.map(c=><option key={c} value={c}>{c}</option>)}</select>
      </div>}
    </div>
    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'0 16px'}}>
      <div style={{marginBottom:14}}><label style={{display:'block',fontSize:11,fontWeight:700,color:T.warn,letterSpacing:'0.08em',textTransform:'uppercase',marginBottom:5,fontFamily:FONT_BODY}}>Employee ID * (required)</label><select value={idCol} onChange={e=>setIdCol(e.target.value)} style={{width:'100%',boxSizing:'border-box',background:'#fafafa',border:'2px solid '+T.warn,borderRadius:6,padding:'10px 12px',color:T.text,fontSize:14,fontFamily:FONT_BODY,outline:'none'}}><option value="">— Select ID column —</option>{cols.map(c=><option key={c} value={c}>{c}</option>)}</select></div>
      <div style={{marginBottom:14}}><label style={{display:'block',fontSize:11,fontWeight:700,color:T.sub,letterSpacing:'0.08em',textTransform:'uppercase',marginBottom:5,fontFamily:FONT_BODY}}>Job Title (optional)</label><select value={titleCol} onChange={e=>setTitleCol(e.target.value)} style={{width:'100%',boxSizing:'border-box',background:'#fafafa',border:'2px solid '+T.border,borderRadius:6,padding:'10px 12px',color:T.text,fontSize:14,fontFamily:FONT_BODY,outline:'none'}}><option value="">— Skip —</option>{cols.map(c=><option key={c} value={c}>{c}</option>)}</select></div>
      <div style={{marginBottom:14}}><label style={{display:'block',fontSize:11,fontWeight:700,color:T.sub,letterSpacing:'0.08em',textTransform:'uppercase',marginBottom:5,fontFamily:FONT_BODY}}>Department (optional)</label><select value={deptCol} onChange={e=>setDeptCol(e.target.value)} style={{width:'100%',boxSizing:'border-box',background:'#fafafa',border:'2px solid '+T.border,borderRadius:6,padding:'10px 12px',color:T.text,fontSize:14,fontFamily:FONT_BODY,outline:'none'}}><option value="">— Skip —</option>{cols.map(c=><option key={c} value={c}>{c}</option>)}</select></div>
      <div style={{marginBottom:14}}><label style={{display:'block',fontSize:11,fontWeight:700,color:T.sub,letterSpacing:'0.08em',textTransform:'uppercase',marginBottom:5,fontFamily:FONT_BODY}}>Position / Level (optional)</label><select value={posCol} onChange={e=>setPosCol(e.target.value)} style={{width:'100%',boxSizing:'border-box',background:'#fafafa',border:'2px solid '+T.border,borderRadius:6,padding:'10px 12px',color:T.text,fontSize:14,fontFamily:FONT_BODY,outline:'none'}}><option value="">— Skip —</option>{cols.map(c=><option key={c} value={c}>{c}</option>)}</select></div>
    </div>
    {preview.length>0&&<div style={{marginBottom:14}}><div style={{fontSize:11,fontWeight:700,color:T.sub,textTransform:'uppercase',letterSpacing:'0.07em',marginBottom:6,fontFamily:FONT_BODY}}>Preview (first {preview.length} rows)</div><div style={{overflowX:'auto',border:'1px solid '+T.border,borderRadius:6}}><table style={{width:'100%',borderCollapse:'collapse',fontSize:11,fontFamily:FONT_BODY}}><thead><tr style={{background:'#fafafa'}}>{cols.slice(0,6).map(c=><th key={c} style={{padding:'6px 10px',textAlign:'left',color:T.muted,fontWeight:700,borderBottom:'1px solid '+T.border,whiteSpace:'nowrap'}}>{c}{starCols.includes(c)&&<span style={{color:T.goldD,marginLeft:4}}>★</span>}</th>)}</tr></thead><tbody>{preview.map((r,i)=><tr key={i} style={{borderBottom:'1px solid '+T.border}}>{cols.slice(0,6).map(c=><td key={c} style={{padding:'5px 10px',color:T.text,whiteSpace:'nowrap',maxWidth:120,overflow:'hidden',textOverflow:'ellipsis'}}>{String(r[c]||'')}</td>)}</tr>)}</tbody></table></div></div>}
    {err&&<p style={{color:T.warn,fontSize:12,fontWeight:700,margin:'0 0 12px',fontFamily:FONT_BODY}}>{err}</p>}
    <div style={{display:'flex',gap:8}}><Btn onClick={submit} v="dark" style={{flex:1}}><Upload size={14}/>Import {rows.length} Rows</Btn><Btn onClick={onClose} v="secondary">Cancel</Btn></div>
  </Modal>;
}


function EmployeesView({employees,saveEmployees,screenings,notify}){
  const[search,setSearch]=useState('');const[showAdd,setShowAdd]=useState(false);const[editEmp,setEditEmp]=useState(null);const[detailEmp,setDetailEmp]=useState(null);const[filterExempt,setFilterExempt]=useState('all');
  const isMobile=useIsMobile();const fileRef=useRef();
  const filtered=employees.filter(e=>{
    const matchSearch=e.name.toLowerCase().includes(search.toLowerCase())||e.id.toLowerCase().includes(search.toLowerCase())||(e.title||'').toLowerCase().includes(search.toLowerCase())||(e.department||'').toLowerCase().includes(search.toLowerCase());
    const matchExempt=filterExempt==='all'||(filterExempt==='exempt'&&e.isExempt)||(filterExempt==='active'&&!e.isExempt)||(filterExempt==='management'&&e.isManagement);
    return matchSearch&&matchExempt;
  });
  const[colMapData,setColMapData]=useState(null);
  const handleUpload=(e)=>{const file=e.target.files[0];if(!file)return;const reader=new FileReader();reader.onload=(evt)=>{try{
    const wb=XLSX.read(evt.target.result,{type:'binary',cellDates:true,raw:false});
    const ws=wb.Sheets[wb.SheetNames[0]];
    const rows=XLSX.utils.sheet_to_json(ws,{defval:'',blankrows:false,raw:false});
    if(!rows.length){notify('File is empty or has no readable rows.','error');return;}
    const cols=Object.keys(rows[0]);

    // Recognized single-column name keys
    const nameKeys=['Name','Employee Name','Full Name','name','employee_name','FullName','full_name','NAME','EMPLOYEE NAME','Employee_Name','Full_Name'];
    // Recognized ID keys
    const idKeys=['ID','Employee ID','EmpID','id','employee_id','Id','EmployeeID','EMP_ID','EMPID','Emp ID','Emp_ID','EMPLOYEE ID','Employee_ID','Emp#','EMP#','ID Number','Id Number','id number','ID_Number','EmpId','Emp Id','Badge','Badge Number','Badge#'];

    // Check for split first/last name columns
    const firstKeys=['First Name','FirstName','first_name','First','FIRST NAME','first name','Given Name'];
    const lastKeys=['Last Name','LastName','last_name','Last','LAST NAME','last name','Surname','Family Name'];
    const fk=firstKeys.find(k=>cols.includes(k));
    const lk=lastKeys.find(k=>cols.includes(k));
    const ik=idKeys.find(k=>cols.includes(k));
    const nk=nameKeys.find(k=>cols.includes(k));

    if(ik&&(nk||(fk&&lk))){
      // Auto-detected — combine first+last if needed
      doImport(rows,nk||null,ik,null,null,null,fk||null,lk||null);
    } else {
      setColMapData({rows,cols,fk,lk,ik});
    }
  }catch(err){notify('Failed to parse file: '+err.message,'error');}};
  reader.readAsBinaryString(file);e.target.value='';};

  const doImport=(rows,nk,ik,posK,titleK,deptK,fk,lk)=>{
    // Parse all valid rows — coerce IDs to string to handle numeric Excel cells
    const parsed=rows
      .filter(r=>{
        const hasId=r[ik]!==undefined&&r[ik]!==null&&r[ik]!=='';
        const hasName=nk?!!r[nk]:(fk&&r[fk])||(lk&&r[lk]);
        return hasId&&hasName;
      })
      .map(r=>({
        id:String(r[ik]).trim(),
        name:nk?String(r[nk]).trim():([fk&&r[fk]?String(r[fk]).trim():'',lk&&r[lk]?String(r[lk]).trim():''].filter(Boolean).join(' ')),
        position:(posK&&r[posK])||r['Position']||r['position']||r['POSITION']||'Staff',
        title:(titleK&&r[titleK])||r['Title']||r['title']||r['Job Title']||r['TITLE']||'',
        department:(deptK&&r[deptK])||r['Department']||r['department']||r['DEPARTMENT']||'',
        isManagement:false,isExempt:false,notes:'',prescriptions:'',
      }))
      .filter(e=>e.id&&e.name); // final guard

    // Deduplicate within the file itself — last row wins for same ID
    const byId={};
    parsed.forEach(e=>{byId[e.id]=e;});
    const incoming=Object.values(byId);

    // Merge with existing: overwrite if ID matches, add if new
    const existing=[...employees];
    let added=0,updated=0;
    incoming.forEach(emp=>{
      const idx=existing.findIndex(x=>x.id===emp.id);
      if(idx>=0){
        // Overwrite name/position/title/dept but keep notes & prescriptions
        existing[idx]={...existing[idx],...emp,notes:existing[idx].notes||'',prescriptions:existing[idx].prescriptions||''};
        updated++;
      } else {
        existing.push(emp);
        added++;
      }
    });

    saveEmployees(existing);
    const parts=[];
    if(added>0)parts.push(added+' new');
    if(updated>0)parts.push(updated+' updated');
    const skipped=rows.length-parsed.length;
    if(skipped>0)parts.push(skipped+' rows skipped (missing name or ID)');
    notify('Import complete: '+parts.join(', ')+'.');
    setColMapData(null);
  };
  const dlTemplate=()=>{const ws=XLSX.utils.aoa_to_sheet([['Employee ID','Name','Title','Department','Position'],['EMP001','Jane Smith','Senior Tech','Operations','Staff'],['EMP002','John Doe','Director','Management','Director']]);const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'Employees');XLSX.writeFile(wb,'employee_template.xlsx');};
  const toggleExempt=(id)=>{saveEmployees(employees.map(e=>e.id===id?{...e,isExempt:!e.isExempt}:e));};
  const removeEmp=(id)=>{if(window.confirm('Remove this employee?')){saveEmployees(employees.filter(e=>e.id!==id));}};
  const saveDetail=(updated)=>{saveEmployees(employees.map(e=>e.id===updated.id?updated:e));notify('Employee notes saved.');};
  const addEmployee=(emp)=>{saveEmployees([...employees,emp]);notify('Employee added.');};
  const saveEdit=(updated)=>{saveEmployees(employees.map(e=>e.id===updated.id?updated:e));notify('Employee updated.');};

  return <div>
    <SectionTitle icon={Users}>Employee Roster</SectionTitle>
    {showAdd&&<AddEmployeeModal onSave={addEmployee} onClose={()=>setShowAdd(false)} isMobile={isMobile} existing={employees}/>}
    {editEmp&&<EditEmployeeModal employee={editEmp} onSave={saveEdit} onClose={()=>setEditEmp(null)} isMobile={isMobile} existing={employees}/>}
    {detailEmp&&<EmployeeDetailModal employee={detailEmp} screenings={screenings} onClose={()=>setDetailEmp(null)} onSave={saveDetail} isMobile={isMobile}/>}
    {colMapData&&<ColMapModal data={colMapData} onImport={doImport} onClose={()=>setColMapData(null)} isMobile={isMobile}/>}
    <div style={{display:'flex',gap:8,marginBottom:14,flexWrap:'wrap',alignItems:'center'}}>
      <Btn onClick={()=>setShowAdd(true)} v="dark" size="sm"><Plus size={13}/>Add Employee</Btn>
      <Btn onClick={()=>fileRef.current.click()} v="secondary" size="sm"><Upload size={13}/>Import Excel</Btn>
      <Btn onClick={dlTemplate} v="ghost" size="sm"><Download size={13}/>Template</Btn>
      <select value={filterExempt} onChange={e=>setFilterExempt(e.target.value)} style={{background:'#fafafa',border:'2px solid '+T.border,borderRadius:6,padding:'5px 10px',fontSize:11,fontFamily:FONT_BODY,fontWeight:700,color:T.text,textTransform:'uppercase',letterSpacing:'0.05em'}}>
        <option value="all">All ({employees.length})</option>
        <option value="active">Active Pool ({employees.filter(e=>!e.isExempt).length})</option>
        <option value="exempt">Exempt ({employees.filter(e=>e.isExempt).length})</option>
        <option value="management">Management ({employees.filter(e=>e.isManagement).length})</option>
      </select>
      <Btn onClick={()=>{if(window.confirm('Clear all?')){saveEmployees([]);notify('Cleared.');}}} v="danger" size="sm" style={{marginLeft:'auto'}}>Clear All</Btn>
      <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" onChange={handleUpload} style={{display:'none'}}/>
    </div>
    <Card style={{padding:'10px 14px',marginBottom:12}}><div style={{display:'flex',alignItems:'center',gap:8}}><Search size={14} color={T.muted}/><input placeholder="Search name, ID, title, department…" value={search} onChange={e=>setSearch(e.target.value)} style={{flex:1,background:'none',border:'none',outline:'none',color:T.text,fontSize:14,fontFamily:FONT_BODY}}/></div></Card>
    {isMobile?(
      <div>
        {filtered.length===0?<Card><p style={{color:T.muted,fontSize:13,textAlign:'center',margin:0,fontFamily:FONT_BODY}}>{employees.length===0?'No employees yet. Add manually or upload an Excel file.':'No results.'}</p></Card>:
          filtered.map(e=><Card key={e.id} style={{marginBottom:8,padding:'12px 14px'}}>
            <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',marginBottom:8}}>
              <div onClick={()=>setDetailEmp(e)} style={{cursor:'pointer',flex:1}}>
                <div style={{fontSize:14,fontWeight:800,color:T.open,fontFamily:FONT_BODY,textDecoration:'underline'}}>{e.name}</div>
                <div style={{fontSize:11,fontFamily:'monospace',color:T.goldD,fontWeight:700,marginTop:1}}>{e.id}</div>
                {e.title&&<div style={{fontSize:11,color:T.muted,fontFamily:FONT_BODY}}>{e.title}{e.department?' · '+e.department:''}</div>}
              </div>
              <div style={{display:'flex',flexDirection:'column',gap:4,alignItems:'flex-end'}}>
                {e.isManagement&&<Badge status="open" />}
                {e.isExempt&&<Badge status="exempt"/>}
              </div>
            </div>
            <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
              <Btn onClick={()=>setDetailEmp(e)} v="secondary" size="sm"><FileText size={11}/>Notes</Btn>
              <Btn onClick={()=>setEditEmp(e)} v="ghost" size="sm"><Edit2 size={11}/>Edit</Btn>
              {e.isManagement&&<Btn onClick={()=>toggleExempt(e.id)} v={e.isExempt?'success':'exempt'} size="sm"><Ban size={11}/>{e.isExempt?'Un-Exempt':'Exempt'}</Btn>}
              <Btn onClick={()=>removeEmp(e.id)} v="danger" size="sm"><Trash2 size={11}/></Btn>
            </div>
          </Card>)
        }
        <div style={{fontSize:11,color:T.muted,marginTop:8,fontFamily:FONT_BODY}}>{filtered.length} of {employees.length} employees</div>
      </div>
    ):(
      <Card style={{padding:0,overflow:'hidden'}}>
        <table style={{width:'100%',borderCollapse:'collapse'}}>
          <thead><tr style={{background:T.nav}}>{['ID','Name','Title','Dept','Level','Status','Actions'].map(h=><th key={h} style={{padding:'10px 12px',textAlign:'left',fontSize:10,fontWeight:800,color:T.gold,letterSpacing:'0.08em',textTransform:'uppercase',fontFamily:FONT_BODY,whiteSpace:'nowrap'}}>{h}</th>)}</tr></thead>
          <tbody>
            {filtered.length===0?<tr><td colSpan={7} style={{padding:'36px',textAlign:'center',color:T.muted,fontSize:13,fontFamily:FONT_BODY}}>{employees.length===0?'Add employees manually or upload an Excel file.':'No results.'}</td></tr>:
              filtered.map(e=><tr key={e.id} style={{borderBottom:'1px solid '+T.border}} onMouseEnter={ev=>ev.currentTarget.style.background='#fffbeb'} onMouseLeave={ev=>ev.currentTarget.style.background='transparent'}>
                <td style={{padding:'9px 12px',fontFamily:'monospace',fontSize:11,color:T.goldD,fontWeight:700}}>{e.id}</td>
                <td style={{padding:'9px 12px'}}><span onClick={()=>setDetailEmp(e)} style={{fontSize:13,fontWeight:800,color:T.open,fontFamily:FONT_BODY,cursor:'pointer',textDecoration:'underline'}}>{e.name}</span>{(e.notes||e.prescriptions)&&<span style={{marginLeft:6,fontSize:10,color:T.prog}} title="Has notes/prescriptions">📝</span>}</td>
                <td style={{padding:'9px 12px',fontSize:12,color:T.muted,fontFamily:FONT_BODY}}>{e.title||'—'}</td>
                <td style={{padding:'9px 12px',fontSize:12,color:T.muted,fontFamily:FONT_BODY}}>{e.department||'—'}</td>
                <td style={{padding:'9px 12px',fontSize:12,color:T.text,fontFamily:FONT_BODY,fontWeight:700}}>{e.position||'Staff'}</td>
                <td style={{padding:'9px 12px'}}>
                  <div style={{display:'flex',gap:4,flexWrap:'wrap'}}>
                    {e.isManagement&&<Badge status="open"/>}
                    {e.isExempt&&<Badge status="exempt"/>}
                    {!e.isManagement&&!e.isExempt&&<span style={{fontSize:10,color:T.muted,fontFamily:FONT_BODY}}>Active Pool</span>}
                  </div>
                </td>
                <td style={{padding:'9px 12px'}}>
                  <div style={{display:'flex',gap:5,whiteSpace:'nowrap'}}>
                    <Btn onClick={()=>setDetailEmp(e)} v="ghost" size="sm" title="View notes & history"><FileText size={11}/></Btn>
                    <Btn onClick={()=>setEditEmp(e)} v="secondary" size="sm"><Edit2 size={11}/>Edit</Btn>
                    {e.isManagement&&<Btn onClick={()=>toggleExempt(e.id)} v={e.isExempt?'success':'exempt'} size="sm"><Ban size={11}/>{e.isExempt?'Un-Exempt':'Exempt'}</Btn>}
                    <Btn onClick={()=>removeEmp(e.id)} v="danger" size="sm"><Trash2 size={11}/></Btn>
                  </div>
                </td>
              </tr>)}
          </tbody>
        </table>
        <div style={{padding:'8px 14px',borderTop:'1px solid '+T.border,fontSize:11,color:T.muted,fontFamily:FONT_BODY,background:'#fafafa',display:'flex',gap:16}}>
          <span>{filtered.length} of {employees.length} employees</span>
          <span>· Active pool: {employees.filter(e=>!e.isExempt).length}</span>
          <span>· Exempt: {employees.filter(e=>e.isExempt).length}</span>
          <span>· Management: {employees.filter(e=>e.isManagement).length}</span>
        </div>
      </Card>
    )}
  </div>;
}


// ─── PICKER VIEW ──────────────────────────────────────────────────────────
function PickerView({employees,screenings,saveScreenings,notify,emailConfig,schedulerConfig}){
  const[result,setResult]=useState(null);const[warning,setWarning]=useState('');const[picking,setPicking]=useState(false);const[count,setCount]=useState(1);
  const pool=employees.filter(e=>!e.isExempt);
  const pick=()=>{
    if(pool.length===0){notify(employees.length===0?'Upload employees first.':'All employees are marked exempt — no eligible pool.','error');return;}
    setPicking(true);setResult(null);setWarning('');
    setTimeout(()=>{
      const p=[...pool],picks=[],newScs=[...screenings];const n=Math.min(count,p.length);
      for(let i=0;i<n;i++){const idx=secureRand(p.length);const emp=p.splice(idx,1)[0];const warn=wasRecentPick(emp.id,newScs);const sc={id:uid(),employeeId:emp.id,employeeName:emp.name,pickedAt:new Date().toISOString(),status:'open',type:'random',result:'pending',resultNotes:'',recentWarn:warn,autoScheduled:false};newScs.push(sc);picks.push({...emp,warn});}
      setResult(picks);
      if(picks.some(p=>p.warn))setWarning('One or more selected employees were screened within the past 3 months. Per DOT/SAMHSA, notify your SAP and document accordingly.');
      saveScreenings(newScs);
      if(schedulerConfig.emailEnabled&&schedulerConfig.emailTo&&picks.length>0)sendEmail(emailConfig,schedulerConfig.emailTo,picks[0],new Date().toISOString(),false).then(ok=>{if(!ok)notify('Email failed. Check Settings.','warning');});
      setPicking(false);
    },700);
  };
  const recent=[...screenings].filter(s=>s.type==='random').sort((a,b)=>new Date(b.pickedAt)-new Date(a.pickedAt)).slice(0,6);
  return <div>
    <SectionTitle icon={Shuffle}>Random Picker</SectionTitle>
    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:20}}>
      <div>
        <Card style={{textAlign:'center',padding:'28px 20px',marginBottom:16}}>
          <div style={{width:72,height:72,borderRadius:'50%',background:T.nav,display:'flex',alignItems:'center',justifyContent:'center',margin:'0 auto 16px',border:'3px solid '+T.gold}}><Shuffle size={32} color={T.gold}/></div>
          <h3 style={{fontFamily:FONT_HEAD,fontSize:20,color:T.text,margin:'0 0 8px',letterSpacing:'0.05em'}}>CRYPTOGRAPHIC RANDOM SELECTION</h3>
          <p style={{color:T.muted,fontSize:13,marginBottom:18,lineHeight:1.6,fontFamily:FONT_BODY}}>Uses <code style={{background:'#f0f0f0',padding:'1px 5px',borderRadius:3,color:T.goldD}}>crypto.getRandomValues()</code> — ID-only, exempt employees excluded.</p>
          <div style={{display:'flex',alignItems:'center',gap:10,justifyContent:'center',marginBottom:18}}>
            <label style={{fontSize:13,color:T.sub,fontFamily:FONT_BODY,fontWeight:700}}>Pick</label>
            <input type="number" min={1} max={pool.length||1} value={count} onChange={e=>setCount(Math.max(1,parseInt(e.target.value)||1))} style={{width:60,background:'#fafafa',border:'2px solid '+T.border,borderRadius:6,padding:'7px 10px',color:T.text,fontSize:14,textAlign:'center',fontFamily:FONT_BODY}}/>
            <label style={{fontSize:13,color:T.sub,fontFamily:FONT_BODY,fontWeight:700}}>employee(s)</label>
          </div>
          <Btn onClick={pick} size="lg" v="dark" disabled={picking||pool.length===0} style={{minWidth:200}}>
            {picking?<><RefreshCw size={15} style={{animation:'spin 0.8s linear infinite'}}/>Selecting…</>:<><Shuffle size={15}/>Run Random Pick</>}
          </Btn>
          <p style={{fontSize:11,color:T.muted,marginTop:8,fontFamily:FONT_BODY}}>Eligible pool: <strong>{pool.length}</strong> of {employees.length} employees · {employees.filter(e=>e.isExempt).length} exempt</p>
        </Card>
        {warning&&<Card style={{background:'#fffbeb',border:'2px solid '+T.gold,marginBottom:16,padding:'12px 14px'}}><div style={{display:'flex',gap:8}}><AlertTriangle size={16} color={T.goldD} style={{flexShrink:0,marginTop:1}}/><p style={{margin:0,fontSize:13,color:T.sub,lineHeight:1.6,fontFamily:FONT_BODY,fontWeight:600}}>{warning}</p></div></Card>}
        {result&&<Card style={{padding:0,overflow:'hidden',marginBottom:16,border:'2px solid '+T.done}}>
          <div style={{padding:'10px 14px',borderBottom:'1px solid '+T.border,background:'#f0fdf4',display:'flex',alignItems:'center',gap:7}}><CheckCircle2 size={14} color={T.done}/><span style={{fontSize:13,fontWeight:800,color:T.done,fontFamily:FONT_HEAD,letterSpacing:'0.05em'}}>SELECTION RESULT</span></div>
          {result.map((p,i)=><div key={i} style={{padding:'12px 14px',borderBottom:'1px solid '+T.border,display:'flex',alignItems:'center',gap:8}}>
            <div style={{flex:1}}><div style={{fontSize:14,fontWeight:800,color:T.text,fontFamily:FONT_BODY}}>{p.name}</div><div style={{fontSize:11,color:T.muted}}>{p.title&&p.title+' · '} ID: <span style={{color:T.goldD,fontFamily:'monospace',fontWeight:700}}>{p.id}</span></div><div style={{fontSize:10,color:T.done,marginTop:3,fontFamily:FONT_BODY,fontWeight:700}}>✓ Pending drug test auto-created in Drug Tests tab</div></div>
            {p.warn&&<span style={{background:'#fffbeb',color:T.prog,border:'1px solid '+T.gold,borderRadius:4,padding:'2px 7px',fontSize:10,fontWeight:800,fontFamily:FONT_BODY}}>⚠ RECENT</span>}
            <Badge status="open"/>
          </div>)}
        </Card>}
      </div>
      <div>
        <Card style={{marginBottom:14}}>
          <h3 style={{margin:'0 0 14px',fontSize:14,fontWeight:800,color:T.text,fontFamily:FONT_HEAD,letterSpacing:'0.05em'}}>RECENT RANDOM LOG</h3>
          {recent.length===0?<p style={{color:T.muted,fontSize:13,fontFamily:FONT_BODY}}>No random picks yet.</p>:recent.map(s=><div key={s.id} style={{padding:'8px 0',borderBottom:'1px solid '+T.border,display:'flex',alignItems:'center',gap:8}}>
            <div style={{flex:1,minWidth:0}}><div style={{fontSize:13,fontWeight:700,color:T.text,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',fontFamily:FONT_BODY}}>{s.employeeName}</div><div style={{fontSize:11,color:T.muted,fontFamily:FONT_BODY}}>{s.employeeId} · {fmtDT(s.pickedAt)}</div></div>
            {s.recentWarn&&<AlertTriangle size={12} color={T.prog}/>}
            {s.result&&s.result!=='pending'&&<Badge status={s.result}/>}
            <Badge status={s.status}/>
          </div>)}
        </Card>
        <Card style={{background:'#f0fdf4',border:'1px solid #bbf7d0'}}>
          <h4 style={{margin:'0 0 10px',fontSize:13,fontWeight:800,color:T.done,fontFamily:FONT_HEAD,letterSpacing:'0.05em',display:'flex',alignItems:'center',gap:6}}><Shield size={14}/>COMPLIANCE</h4>
          {['Cryptographic randomness — NIST-compliant','ID-only — no name or demographic factors','Exempt employees automatically excluded','3-month recency alerts per DOT/SAMHSA','Full auditable log with timestamps'].map(t=><div key={t} style={{fontSize:12,color:T.sub,padding:'4px 0',display:'flex',gap:8,fontFamily:FONT_BODY}}><span style={{color:T.done}}>✓</span>{t}</div>)}
        </Card>
      </div>
    </div>
  </div>;
}


// ─── DRUG TESTS VIEW ──────────────────────────────────────────────────────
function ResultModal({screening,employees,onSave,onClose,isMobile}){
  const emp=employees.find(e=>e.id===screening.employeeId)||{name:screening.employeeName,id:screening.employeeId};
  const[result,setResult]=useState(screening.result==='pending'?'pass':screening.result||'pass');
  const[notes,setNotes]=useState(screening.resultNotes||'');
  const[date,setDate]=useState(screening.resultDate?new Date(screening.resultDate).toISOString().split('T')[0]:new Date().toISOString().split('T')[0]);
  return <Modal title="ENTER TEST RESULT" onClose={onClose} isMobile={isMobile} width={500}>
    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:16}}>
      {[['Employee',emp.name],['Employee ID',emp.id],['Test Type',(screening.type||'random').replace(/-/g,' ').toUpperCase()],['Picked',fmtDate(screening.pickedAt)]].map(([l,v])=><MobileRow key={l} label={l} value={v}/>)}
    </div>
    {emp.prescriptions&&<div style={{background:'#fffbeb',border:'1px solid '+T.gold,borderRadius:6,padding:'10px 12px',marginBottom:14}}>
      <div style={{fontSize:10,color:T.goldD,fontWeight:800,fontFamily:FONT_BODY,textTransform:'uppercase',letterSpacing:'0.07em',marginBottom:4}}>⚕ Prescriptions on File</div>
      <p style={{margin:0,fontSize:12,color:T.sub,fontFamily:FONT_BODY}}>{emp.prescriptions}</p>
    </div>}
    <div style={{marginBottom:16}}>
      <label style={{display:'block',fontSize:11,fontWeight:700,color:T.sub,letterSpacing:'0.08em',textTransform:'uppercase',marginBottom:8,fontFamily:FONT_BODY}}>Test Result</label>
      <div style={{display:'flex',gap:10}}>
        <div onClick={()=>setResult('pass')} style={{flex:1,padding:'14px',borderRadius:8,border:'3px solid '+(result==='pass'?T.done:T.border),background:result==='pass'?'#f0fdf4':'#fafafa',cursor:'pointer',textAlign:'center',transition:'all 0.15s'}}>
          <CheckCircle2 size={24} color={result==='pass'?T.done:T.muted} style={{margin:'0 auto 6px',display:'block'}}/>
          <div style={{fontFamily:FONT_HEAD,fontSize:18,color:result==='pass'?T.done:T.muted,letterSpacing:'0.08em'}}>PASS</div>
        </div>
        <div onClick={()=>setResult('fail')} style={{flex:1,padding:'14px',borderRadius:8,border:'3px solid '+(result==='fail'?T.warn:T.border),background:result==='fail'?'#fef2f2':'#fafafa',cursor:'pointer',textAlign:'center',transition:'all 0.15s'}}>
          <X size={24} color={result==='fail'?T.warn:T.muted} style={{margin:'0 auto 6px',display:'block'}}/>
          <div style={{fontFamily:FONT_HEAD,fontSize:18,color:result==='fail'?T.warn:T.muted,letterSpacing:'0.08em'}}>FAIL</div>
        </div>
      </div>
    </div>
    <FieldInput label="Result Date" type="date" value={date} onChange={e=>setDate(e.target.value)}/>
    <FieldTextarea label="Result Notes / MRO Comments" placeholder="Enter result details, MRO notes, prescriptions considered, or any relevant information..." value={notes} onChange={e=>setNotes(e.target.value)} style={{minHeight:80}}/>
    <div style={{display:'flex',gap:8,marginTop:4}}>
      <Btn onClick={()=>onSave({...screening,result,resultNotes:notes,resultDate:new Date(date).toISOString()})} v={result==='pass'?'success':'danger'} style={{flex:1}} size="lg">
        {result==='pass'?<><CheckCircle2 size={15}/>Record PASS</>:<><X size={15}/>Record FAIL</>}
      </Btn>
      <Btn onClick={onClose} v="secondary">Cancel</Btn>
    </div>
  </Modal>;
}

function AddTestModal({employees,onSave,onClose,isMobile}){
  const[form,setForm]=useState({employeeId:'',type:'pre-employment',scheduledFor:'',pickedAt:new Date().toISOString().split('T')[0],result:'pending',resultNotes:'',notes:''});
  const[err,setErr]=useState('');
  const set=(k,v)=>setForm(f=>({...f,[k]:v}));
  const submit=()=>{
    if(!form.employeeId){setErr('Select an employee.');return;}
    const emp=employees.find(e=>e.id===form.employeeId);
    if(!emp){setErr('Employee not found.');return;}
    const isFuture=form.type==='scheduled'&&form.scheduledFor&&new Date(form.scheduledFor)>new Date();
    onSave({id:uid(),employeeId:emp.id,employeeName:emp.name,pickedAt:new Date(form.pickedAt).toISOString(),type:form.type,status:isFuture?'scheduled':'open',result:form.result==='pending'?'pending':form.result,resultNotes:form.resultNotes||'',scheduledFor:form.scheduledFor?new Date(form.scheduledFor).toISOString():'',autoScheduled:false,recentWarn:false,notes:form.notes});
    onClose();
  };
  return <Modal title="ADD DRUG TEST" onClose={onClose} isMobile={isMobile} width={540}>
    <FieldSelect label="Employee" value={form.employeeId} onChange={e=>set('employeeId',e.target.value)}>
      <option value="">— Select Employee —</option>
      {employees.map(e=><option key={e.id} value={e.id}>{e.name} ({e.id}){e.title?' — '+e.title:''}</option>)}
    </FieldSelect>
    <FieldSelect label="Test Type" value={form.type} onChange={e=>set('type',e.target.value)}>
      {SCREEN_TYPES.map(t=><option key={t} value={t}>{t.replace(/-/g,' ').replace(/\b\\w/g,c=>c.toUpperCase())}</option>)}
    </FieldSelect>
    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'0 16px'}}>
      <FieldInput label={form.type==='scheduled'?'Scheduled Date':'Test Date'} type="date" value={form.type==='scheduled'?form.scheduledFor:form.pickedAt} onChange={e=>set(form.type==='scheduled'?'scheduledFor':'pickedAt',e.target.value)}/>
      <FieldSelect label="Result" value={form.result} onChange={e=>set('result',e.target.value)}>
        <option value="pending">Pending</option>
        <option value="pass">Pass</option>
        <option value="fail">Fail</option>
      </FieldSelect>
    </div>
    <FieldTextarea label="Result Notes / Details" placeholder="MRO notes, prescription considerations, chain of custody info..." value={form.resultNotes} onChange={e=>set('resultNotes',e.target.value)} style={{minHeight:70}}/>
    <FieldTextarea label="Internal Notes" placeholder="Any additional HR notes..." value={form.notes} onChange={e=>set('notes',e.target.value)} style={{minHeight:50}}/>
    {err&&<p style={{color:T.warn,fontSize:12,fontWeight:700,margin:'0 0 12px'}}>{err}</p>}
    <div style={{display:'flex',gap:8}}>
      <Btn onClick={submit} v="dark" style={{flex:1}}><Plus size={14}/>Add Test Record</Btn>
      <Btn onClick={onClose} v="secondary">Cancel</Btn>
    </div>
  </Modal>;
}

function DrugTestsView({screenings,employees,saveScreenings,notify}){
  const isMobile=useIsMobile();
  const[typeFilter,setTypeFilter]=useState('all');
  const[resultFilter,setResultFilter]=useState('all');
  const[search,setSearch]=useState('');
  const[showAdd,setShowAdd]=useState(false);
  const[resultModal,setResultModal]=useState(null);
  const[detail,setDetail]=useState(null);

  const allTests=screenings; // includes random picks - they auto-appear as pending drug tests
  const filtered=allTests.filter(s=>{
    const matchType=typeFilter==='all'||s.type===typeFilter;
    const matchResult=resultFilter==='all'||s.result===resultFilter;
    const matchSearch=!search||s.employeeName.toLowerCase().includes(search.toLowerCase())||s.employeeId.toLowerCase().includes(search.toLowerCase());
    return matchType&&matchResult&&matchSearch;
  }).sort((a,b)=>new Date(b.pickedAt)-new Date(a.pickedAt));

  const addTest=(test)=>{saveScreenings([...screenings,test]);notify('Test record added.');};
  const saveResult=(updated)=>{saveScreenings(screenings.map(s=>s.id===updated.id?updated:s));setResultModal(null);notify('Result recorded.');};
  const removeTest=(id)=>{if(window.confirm('Remove this test record?')){saveScreenings(screenings.filter(s=>s.id!==id));notify('Removed.');}};

  const typeCounts={};
  allTests.forEach(s=>{typeCounts[s.type]=(typeCounts[s.type]||0)+1;});
  const passCount=allTests.filter(s=>s.result==='pass').length;
  const failCount=allTests.filter(s=>s.result==='fail').length;
  const pendingCount=allTests.filter(s=>s.result==='pending'||!s.result).length;
  const scheduledCount=allTests.filter(s=>s.status==='scheduled').length;

  return <div>
    <SectionTitle icon={FlaskConical}>Drug Tests</SectionTitle>
    {screenings.some(s=>s.type==='random'&&(s.result==='pending'||!s.result))&&
    <Card style={{marginBottom:14,background:'#fffbeb',border:'2px solid '+T.gold,padding:'10px 16px'}}>
      <div style={{display:'flex',alignItems:'center',gap:8}}><Shuffle size={14} color={T.goldD}/><p style={{margin:0,fontSize:12,fontFamily:FONT_BODY,color:T.goldD,fontWeight:700}}>Random picks auto-create pending drug tests here. Enter results when the lab reports are ready.</p></div>
    </Card>}
    {showAdd&&<AddTestModal employees={employees} onSave={addTest} onClose={()=>setShowAdd(false)} isMobile={isMobile}/>}
    {resultModal&&<ResultModal screening={resultModal} employees={employees} onSave={saveResult} onClose={()=>setResultModal(null)} isMobile={isMobile}/>}

    <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:10,marginBottom:18}}>
      {[{l:'Pass',v:passCount,c:T.done},{l:'Fail',v:failCount,c:T.warn},{l:'Pending',v:pendingCount,c:T.prog},{l:'Scheduled',v:scheduledCount,c:T.open}].map(s=><Card key={s.l} style={{textAlign:'center',padding:'12px 8px'}}>
        <div style={{fontSize:26,fontWeight:900,color:s.c,fontFamily:FONT_HEAD}}>{s.v}</div>
        <div style={{fontSize:10,color:T.muted,marginTop:3,textTransform:'uppercase',letterSpacing:'0.08em',fontFamily:FONT_BODY}}>{s.l}</div>
      </Card>)}
    </div>

    <div style={{display:'flex',gap:8,marginBottom:14,flexWrap:'wrap',alignItems:'center'}}>
      <Btn onClick={()=>setShowAdd(true)} v="dark" size="sm"><Plus size={13}/>Add Test</Btn>
      <select value={typeFilter} onChange={e=>setTypeFilter(e.target.value)} style={{background:'#fafafa',border:'2px solid '+T.border,borderRadius:6,padding:'5px 10px',fontSize:11,fontFamily:FONT_BODY,fontWeight:700,color:T.text,textTransform:'uppercase',letterSpacing:'0.04em'}}>
        <option value="all">All Types</option>
        {SCREEN_TYPES.map(t=><option key={t} value={t}>{t==='random'?'Random Pick':t.replace(/-/g,' ').replace(/\b\\w/g,c=>c.toUpperCase())}</option>)}
      </select>
      <select value={resultFilter} onChange={e=>setResultFilter(e.target.value)} style={{background:'#fafafa',border:'2px solid '+T.border,borderRadius:6,padding:'5px 10px',fontSize:11,fontFamily:FONT_BODY,fontWeight:700,color:T.text,textTransform:'uppercase',letterSpacing:'0.04em'}}>
        <option value="all">All Results</option>
        <option value="pass">Pass</option>
        <option value="fail">Fail</option>
        <option value="pending">Pending</option>
      </select>
    </div>
    <Card style={{padding:'10px 14px',marginBottom:12}}><div style={{display:'flex',alignItems:'center',gap:8}}><Search size={14} color={T.muted}/><input placeholder="Search employee name or ID…" value={search} onChange={e=>setSearch(e.target.value)} style={{flex:1,background:'none',border:'none',outline:'none',color:T.text,fontSize:14,fontFamily:FONT_BODY}}/></div></Card>

    {isMobile?(
      <div>
        {filtered.length===0?<Card><p style={{color:T.muted,fontSize:13,textAlign:'center',margin:0,fontFamily:FONT_BODY}}>No test records. Click Add Test to create one.</p></Card>:
          filtered.map(s=>{
            const emp=employees.find(e=>e.id===s.employeeId);
            return <Card key={s.id} style={{marginBottom:8,padding:'12px 14px'}}>
              <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',marginBottom:8}}>
                <div><div style={{fontSize:14,fontWeight:800,color:T.text,fontFamily:FONT_BODY}}>{s.employeeName}</div><div style={{fontSize:11,fontFamily:'monospace',color:T.goldD,fontWeight:700}}>{s.employeeId}</div><div style={{display:'flex',alignItems:'center',gap:5,marginTop:2}}><span style={{fontSize:11,color:T.muted,fontFamily:FONT_BODY}}>{s.type==='random'?'Random Pick':(s.type||'').replace(/-/g,' ').replace(/\b\\w/g,c=>c.toUpperCase())}</span>{s.type==='random'&&<span style={{fontSize:9,background:'#fffbeb',color:T.goldD,border:'1px solid '+T.gold,borderRadius:3,padding:'1px 5px',fontFamily:FONT_BODY,fontWeight:800}}>AUTO-PICKED</span>}</div></div>
                <div style={{display:'flex',flexDirection:'column',gap:4,alignItems:'flex-end'}}>{s.result&&<Badge status={s.result}/>}<Badge status={s.status}/></div>
              </div>
              {s.scheduledFor&&s.status==='scheduled'&&<div style={{fontSize:11,color:T.open,fontFamily:FONT_BODY,fontWeight:700,marginBottom:6}}>📅 Scheduled: {fmtDate(s.scheduledFor)}</div>}
              {s.resultNotes&&<div style={{fontSize:11,color:T.sub,fontFamily:FONT_BODY,marginBottom:8,fontStyle:'italic'}}>"{s.resultNotes.slice(0,80)}{s.resultNotes.length>80?'…':''}"</div>}
              {emp?.prescriptions&&<div style={{fontSize:10,color:T.goldD,fontFamily:FONT_BODY,fontWeight:700,marginBottom:6}}>⚕ Rx on file</div>}
              <div style={{display:'flex',gap:6}}>
                {(s.result==='pending'||!s.result)&&<Btn onClick={()=>setResultModal(s)} v="dark" size="sm"><TestTube size={11}/>Enter Result</Btn>}
                {s.result&&s.result!=='pending'&&<Btn onClick={()=>setResultModal(s)} v="secondary" size="sm"><Edit2 size={11}/>Edit Result</Btn>}
                <Btn onClick={()=>removeTest(s.id)} v="danger" size="sm"><Trash2 size={11}/></Btn>
              </div>
            </Card>;
          })}
      </div>
    ):(
      <Card style={{padding:0,overflow:'hidden'}}>
        <table style={{width:'100%',borderCollapse:'collapse'}}>
          <thead><tr style={{background:T.nav}}>{['Employee','ID','Type','Date','Scheduled','Result','Notes','Actions'].map(h=><th key={h} style={{padding:'10px 12px',textAlign:'left',fontSize:10,fontWeight:800,color:T.gold,letterSpacing:'0.07em',textTransform:'uppercase',fontFamily:FONT_BODY,whiteSpace:'nowrap'}}>{h}</th>)}</tr></thead>
          <tbody>
            {filtered.length===0?<tr><td colSpan={8} style={{padding:'36px',textAlign:'center',color:T.muted,fontSize:13,fontFamily:FONT_BODY}}>No test records. Click Add Test to create one.</td></tr>:
              filtered.map(s=>{
                const emp=employees.find(e=>e.id===s.employeeId);
                return <tr key={s.id} style={{borderBottom:'1px solid '+T.border}} onMouseEnter={ev=>ev.currentTarget.style.background='#fffbeb'} onMouseLeave={ev=>ev.currentTarget.style.background='transparent'}>
                  <td style={{padding:'9px 12px'}}>
                    <div style={{fontSize:13,fontWeight:800,color:T.text,fontFamily:FONT_BODY}}>{s.employeeName}</div>
                    {emp?.prescriptions&&<div style={{fontSize:10,color:T.goldD,fontWeight:700}}>⚕ Rx on file</div>}
                  </td>
                  <td style={{padding:'9px 12px',fontFamily:'monospace',fontSize:11,color:T.goldD,fontWeight:700,whiteSpace:'nowrap'}}>{s.employeeId}</td>
                  <td style={{padding:'9px 12px',fontSize:11,fontFamily:FONT_BODY,fontWeight:700,color:T.text,whiteSpace:'nowrap'}}>{s.type==='random'?<span style={{display:'flex',alignItems:'center',gap:4}}><span>Random Pick</span><span style={{fontSize:9,background:'#fffbeb',color:T.goldD,border:'1px solid '+T.gold,borderRadius:3,padding:'1px 4px',fontFamily:FONT_BODY,fontWeight:800}}>AUTO</span></span>:(s.type||'').replace(/-/g,' ').replace(/\b\\w/g,c=>c.toUpperCase())}</td>
                  <td style={{padding:'9px 12px',fontSize:11,color:T.muted,fontFamily:FONT_BODY,whiteSpace:'nowrap'}}>{fmtDate(s.pickedAt)}</td>
                  <td style={{padding:'9px 12px',fontSize:11,color:T.open,fontFamily:FONT_BODY,whiteSpace:'nowrap'}}>{s.scheduledFor?fmtDate(s.scheduledFor):'—'}</td>
                  <td style={{padding:'9px 12px'}}>{s.result?<Badge status={s.result}/>:'—'}</td>
                  <td style={{padding:'9px 12px',maxWidth:160}}><div style={{fontSize:11,color:T.muted,fontFamily:FONT_BODY,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{s.resultNotes||'—'}</div></td>
                  <td style={{padding:'9px 12px'}}>
                    <div style={{display:'flex',gap:5,whiteSpace:'nowrap'}}>
                      {(s.result==='pending'||!s.result)?<Btn onClick={()=>setResultModal(s)} v="dark" size="sm"><TestTube size={11}/>Result</Btn>:<Btn onClick={()=>setResultModal(s)} v="secondary" size="sm"><Edit2 size={11}/>Edit</Btn>}
                      <Btn onClick={()=>removeTest(s.id)} v="danger" size="sm"><Trash2 size={11}/></Btn>
                    </div>
                  </td>
                </tr>;
              })}
          </tbody>
        </table>
        <div style={{padding:'8px 14px',borderTop:'1px solid '+T.border,fontSize:11,color:T.muted,fontFamily:FONT_BODY,background:'#fafafa'}}>{filtered.length} of {allTests.length} records · Pass: {passCount} · Fail: {failCount} · Pending: {pendingCount}</div>
      </Card>
    )}
  </div>;
}


// ─── SCREENINGS VIEW ──────────────────────────────────────────────────────
function ScreeningsView({screenings,saveScreenings,user,notify,employees}){
  const[filter,setFilter]=useState('all');const[sigModal,setSigModal]=useState(null);const[sigName,setSigName]=useState('');const[sigDate,setSigDate]=useState('');const[resultModal,setResultModal]=useState(null);
  const isMobile=useIsMobile();
  const active=screenings.filter(s=>s.status!=='completed'&&(s.type==='random'||!s.type));
  const filtered=filter==='all'?active:active.filter(s=>s.status===filter);
  const updStatus=(id,status)=>{saveScreenings(screenings.map(s=>s.id===id?{...s,status}:s));notify('Status updated.');};
  const openSig=(sc)=>{setSigModal(sc);setSigName(user.username||'');setSigDate(new Date().toLocaleString('en-US',{dateStyle:'long',timeStyle:'short'}));};
  const saveSig=(sig)=>{saveScreenings(screenings.map(s=>s.id===sigModal.id?{...s,status:'completed',completedAt:new Date().toISOString(),completedBy:sigName,eSignature:sig,eSignDate:new Date().toISOString()}:s));setSigModal(null);notify('Archived as completed.');};
  const saveResult=(updated)=>{saveScreenings(screenings.map(s=>s.id===updated.id?updated:s));setResultModal(null);notify('Result recorded.');};

  return <div>
    <SectionTitle icon={ClipboardList}>Active Screenings (Random)</SectionTitle>
    <div style={{display:'flex',gap:6,marginBottom:14,flexWrap:'wrap'}}>
      {['all','open','in_progress'].map(f=><Btn key={f} onClick={()=>setFilter(f)} v={filter===f?'dark':'ghost'} size="sm">{f==='all'?'All ('+active.length+')':f==='open'?'Open ('+active.filter(s=>s.status==='open').length+')':'In Progress ('+active.filter(s=>s.status==='in_progress').length+')'}</Btn>)}
    </div>
    {resultModal&&<ResultModal screening={resultModal} employees={employees} onSave={saveResult} onClose={()=>setResultModal(null)} isMobile={isMobile}/>}
    {isMobile?(
      <div>{filtered.length===0?<Card><p style={{color:T.muted,fontSize:13,textAlign:'center',margin:0,fontFamily:FONT_BODY}}>No active screenings.</p></Card>:
        filtered.map(s=><Card key={s.id} style={{marginBottom:10}}>
          <div style={{display:'flex',justifyContent:'space-between',marginBottom:8}}>
            <div><div style={{fontSize:14,fontWeight:800,fontFamily:FONT_BODY,color:T.text}}>{s.employeeName}</div><div style={{fontSize:11,fontFamily:'monospace',color:T.goldD,fontWeight:700}}>{s.employeeId}</div>{s.recentWarn&&<div style={{fontSize:10,color:T.prog,fontWeight:700}}>⚠ Screened recently</div>}</div>
            <div style={{display:'flex',flexDirection:'column',gap:4,alignItems:'flex-end'}}>{s.autoScheduled?<span style={{fontSize:9,fontWeight:800,color:T.goldD,fontFamily:FONT_BODY,border:'1px solid '+T.gold,background:'#fffbeb',borderRadius:3,padding:'1px 6px'}}>AUTO</span>:<span style={{fontSize:9,fontWeight:800,color:T.muted,fontFamily:FONT_BODY,border:'1px solid '+T.border,background:'#fafafa',borderRadius:3,padding:'1px 6px'}}>MANUAL</span>}<Badge status={s.status}/></div>
          </div>
          <div style={{fontSize:11,color:T.muted,marginBottom:10,fontFamily:FONT_BODY}}>{fmtDT(s.pickedAt)}</div>
          <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
            {s.status==='open'&&<Btn onClick={()=>updStatus(s.id,'in_progress')} v="warn" size="sm"><Clock size={11}/>Start</Btn>}
            {(s.status==='open'||s.status==='in_progress')&&<><Btn onClick={()=>setResultModal(s)} v="secondary" size="sm"><TestTube size={11}/>Result</Btn><Btn onClick={()=>openSig(s)} v="success" size="sm"><PenLine size={11}/>Complete</Btn></>}
          </div>
        </Card>)}
      </div>
    ):(
      <Card style={{padding:0,overflow:'hidden'}}>
        <table style={{width:'100%',borderCollapse:'collapse'}}>
          <thead><tr style={{background:T.nav}}>{['Employee','ID','Picked','Type','Result','Status','Actions'].map(h=><th key={h} style={{padding:'10px 12px',textAlign:'left',fontSize:10,color:T.gold,fontWeight:800,letterSpacing:'0.07em',textTransform:'uppercase',fontFamily:FONT_BODY,whiteSpace:'nowrap'}}>{h}</th>)}</tr></thead>
          <tbody>{filtered.length===0?<tr><td colSpan={7} style={{padding:'36px',textAlign:'center',color:T.muted,fontSize:13,fontFamily:FONT_BODY}}>No active screenings.</td></tr>:
            filtered.map(s=><tr key={s.id} style={{borderBottom:'1px solid '+T.border}} onMouseEnter={e=>e.currentTarget.style.background='#fffbeb'} onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
              <td style={{padding:'11px 12px'}}><div style={{fontSize:13,fontWeight:700,color:T.text,fontFamily:FONT_BODY}}>{s.employeeName}</div>{s.recentWarn&&<div style={{fontSize:10,color:T.prog,fontWeight:700}}>⚠ Recent (3mo)</div>}</td>
              <td style={{padding:'11px 12px',fontFamily:'monospace',fontSize:11,color:T.goldD,fontWeight:700}}>{s.employeeId}</td>
              <td style={{padding:'11px 12px',fontSize:11,color:T.muted,fontFamily:FONT_BODY,whiteSpace:'nowrap'}}>{fmtDT(s.pickedAt)}</td>
              <td style={{padding:'11px 12px'}}>{s.autoScheduled?<span style={{fontSize:10,fontWeight:800,color:T.goldD,fontFamily:FONT_BODY}}>AUTO</span>:<span style={{fontSize:10,fontWeight:700,color:T.muted,fontFamily:FONT_BODY}}>MANUAL</span>}</td>
              <td style={{padding:'11px 12px'}}>{s.result&&s.result!=='pending'?<Badge status={s.result}/>:<span style={{fontSize:10,color:T.muted,fontFamily:FONT_BODY}}>Pending</span>}</td>
              <td style={{padding:'11px 12px'}}><Badge status={s.status}/></td>
              <td style={{padding:'11px 12px'}}><div style={{display:'flex',gap:5,whiteSpace:'nowrap'}}>
                {s.status==='open'&&<Btn onClick={()=>updStatus(s.id,'in_progress')} v="warn" size="sm"><Clock size={11}/>Start</Btn>}
                {(s.status==='open'||s.status==='in_progress')&&<><Btn onClick={()=>setResultModal(s)} v="secondary" size="sm"><TestTube size={11}/>Result</Btn><Btn onClick={()=>openSig(s)} v="success" size="sm"><PenLine size={11}/>Complete</Btn></>}
              </div></td>
            </tr>)}
          </tbody>
        </table>
      </Card>
    )}
    {sigModal&&<Modal title="E-SIGNATURE REQUIRED" onClose={()=>setSigModal(null)} isMobile={isMobile}>
      <div style={{display:'grid',gridTemplateColumns:isMobile?'1fr':'1fr 1fr',gap:12,marginBottom:16}}>
        {[['Employee',sigModal.employeeName],['Employee ID',sigModal.employeeId],['Date',sigDate]].map(([l,v])=><div key={l}><div style={{fontSize:10,color:T.muted,textTransform:'uppercase',letterSpacing:'0.07em',marginBottom:3,fontFamily:FONT_BODY,fontWeight:700}}>{l}</div><div style={{fontSize:13,color:T.text,fontWeight:700,fontFamily:FONT_BODY}}>{v}</div></div>)}
        <div><div style={{fontSize:10,color:T.muted,textTransform:'uppercase',letterSpacing:'0.07em',marginBottom:3,fontFamily:FONT_BODY,fontWeight:700}}>Completed By</div><input value={sigName} onChange={e=>setSigName(e.target.value)} style={{width:'100%',boxSizing:'border-box',background:'#fafafa',border:'2px solid '+T.border,borderRadius:6,padding:'6px 10px',color:T.text,fontSize:13,fontFamily:FONT_BODY,outline:'none'}}/></div>
      </div>
      <SignaturePad onSave={saveSig} onCancel={()=>setSigModal(null)}/>
    </Modal>}
  </div>;
}

// ─── HISTORY VIEW ─────────────────────────────────────────────────────────
function HistoryView({screenings,employees}){
  const[search,setSearch]=useState('');const[detail,setDetail]=useState(null);const isMobile=useIsMobile();
  const completed=screenings.filter(s=>s.status==='completed');
  const filtered=completed.filter(s=>s.employeeName.toLowerCase().includes(search.toLowerCase())||s.employeeId.toLowerCase().includes(search.toLowerCase())).sort((a,b)=>new Date(b.completedAt)-new Date(a.completedAt));
  return <div>
    <SectionTitle icon={Archive}>History</SectionTitle>
    <Card style={{padding:'10px 14px',marginBottom:12}}><div style={{display:'flex',alignItems:'center',gap:8}}><Search size={14} color={T.muted}/><input placeholder="Search completed screenings…" value={search} onChange={e=>setSearch(e.target.value)} style={{flex:1,background:'none',border:'none',outline:'none',color:T.text,fontSize:14,fontFamily:FONT_BODY}}/></div></Card>
    {isMobile?(
      <div>{filtered.length===0?<Card><p style={{color:T.muted,fontSize:13,textAlign:'center',margin:0,fontFamily:FONT_BODY}}>No completed screenings yet.</p></Card>:
        filtered.map(s=><Card key={s.id} style={{marginBottom:8,padding:'12px 14px'}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:6}}>
            <div><div style={{fontSize:13,fontWeight:800,color:T.text,fontFamily:FONT_BODY}}>{s.employeeName}</div><div style={{fontSize:11,fontFamily:'monospace',color:T.goldD,fontWeight:700}}>{s.employeeId}</div></div>
            <div style={{display:'flex',gap:4,flexDirection:'column',alignItems:'flex-end'}}>{s.result&&s.result!=='pending'&&<Badge status={s.result}/>}<Badge status="completed"/></div>
          </div>
          <div style={{fontSize:11,color:T.muted,marginBottom:8,fontFamily:FONT_BODY}}>{(s.type||'random').replace(/-/g,' ').toUpperCase()} · Picked {fmtDate(s.pickedAt)} · Done {fmtDate(s.completedAt)}</div>
          <Btn onClick={()=>setDetail(s)} v="secondary" size="sm" full>View Record</Btn>
        </Card>)}
        <div style={{fontSize:11,color:T.muted,marginTop:8,fontFamily:FONT_BODY}}>{filtered.length} completed</div>
      </div>
    ):(
      <Card style={{padding:0,overflow:'hidden'}}>
        <table style={{width:'100%',borderCollapse:'collapse'}}>
          <thead><tr style={{background:T.nav}}>{['Employee','ID','Type','Picked','Completed','Result','By',''].map(h=><th key={h} style={{padding:'10px 12px',textAlign:'left',fontSize:10,color:T.gold,fontWeight:800,letterSpacing:'0.07em',textTransform:'uppercase',fontFamily:FONT_BODY}}>{h}</th>)}</tr></thead>
          <tbody>{filtered.length===0?<tr><td colSpan={8} style={{padding:'36px',textAlign:'center',color:T.muted,fontSize:13,fontFamily:FONT_BODY}}>No completed screenings yet.</td></tr>:
            filtered.map(s=><tr key={s.id} style={{borderBottom:'1px solid '+T.border}} onMouseEnter={e=>e.currentTarget.style.background='#fffbeb'} onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
              <td style={{padding:'10px 12px',fontSize:13,fontWeight:700,color:T.text,fontFamily:FONT_BODY}}>{s.employeeName}</td>
              <td style={{padding:'10px 12px',fontFamily:'monospace',fontSize:11,color:T.goldD,fontWeight:700}}>{s.employeeId}</td>
              <td style={{padding:'10px 12px',fontSize:11,fontFamily:FONT_BODY,fontWeight:700,color:T.text}}>{(s.type||'random').replace(/-/g,' ').replace(/\b\\w/g,c=>c.toUpperCase())}</td>
              <td style={{padding:'10px 12px',fontSize:11,color:T.muted,fontFamily:FONT_BODY,whiteSpace:'nowrap'}}>{fmtDate(s.pickedAt)}</td>
              <td style={{padding:'10px 12px',fontSize:11,color:T.muted,fontFamily:FONT_BODY,whiteSpace:'nowrap'}}>{fmtDate(s.completedAt)}</td>
              <td style={{padding:'10px 12px'}}>{s.result&&s.result!=='pending'?<Badge status={s.result}/>:<span style={{fontSize:10,color:T.muted}}>—</span>}</td>
              <td style={{padding:'10px 12px',fontSize:11,color:T.muted,fontFamily:FONT_BODY}}>{s.completedBy||'—'}</td>
              <td style={{padding:'10px 12px'}}><Btn onClick={()=>setDetail(s)} v="ghost" size="sm">View</Btn></td>
            </tr>)}
          </tbody>
        </table>
        <div style={{padding:'8px 14px',borderTop:'1px solid '+T.border,fontSize:11,color:T.muted,fontFamily:FONT_BODY,background:'#fafafa'}}>{filtered.length} completed · Pass: {completed.filter(s=>s.result==='pass').length} · Fail: {completed.filter(s=>s.result==='fail').length}</div>
      </Card>
    )}
    {detail&&<Modal title="SCREENING RECORD" onClose={()=>setDetail(null)} isMobile={isMobile}>
      {[['Employee',detail.employeeName],['Employee ID',detail.employeeId],['Type',(detail.type||'random').replace(/-/g,' ').toUpperCase()],['Picked',fmtDT(detail.pickedAt)],['Completed',fmtDT(detail.completedAt)],['Result',detail.result||'—'],['Completed By',detail.completedBy||'—'],['E-Sign Date',fmtDT(detail.eSignDate)]].map(([l,v])=><MobileRow key={l} label={l} value={v}/>)}
      {detail.resultNotes&&<div style={{marginTop:10,padding:'10px',background:'#fafafa',borderRadius:6,border:'1px solid '+T.border}}><div style={{fontSize:10,color:T.muted,textTransform:'uppercase',letterSpacing:'0.07em',marginBottom:4,fontFamily:FONT_BODY,fontWeight:700}}>Result Notes</div><p style={{margin:0,fontSize:13,color:T.sub,fontFamily:FONT_BODY}}>{detail.resultNotes}</p></div>}
      {detail.eSignature&&<div style={{marginTop:12}}><div style={{fontSize:10,color:T.muted,textTransform:'uppercase',letterSpacing:'0.07em',marginBottom:6,fontFamily:FONT_BODY,fontWeight:700}}>E-Signature on File</div><div style={{background:'#fafafa',border:'1px solid '+T.border,borderRadius:6,padding:8,display:'inline-block'}}><img src={detail.eSignature} style={{height:70,display:'block'}} alt="sig"/></div></div>}
      <div style={{marginTop:14,padding:10,background:'#f0fdf4',border:'2px solid '+T.done,borderRadius:6,display:'flex',gap:8,alignItems:'center'}}><CheckCircle2 size={14} color={T.done}/><span style={{fontSize:12,color:T.done,fontFamily:FONT_BODY,fontWeight:700}}>Completed. Read-only record.</span></div>
    </Modal>}
  </div>;
}


// ─── DASHBOARD ────────────────────────────────────────────────────────────
function DashboardView({employees,screenings,setView,schedulerConfig,tick,lastBackup}){
  const isMobile=useIsMobile();const now=new Date();
  const open=screenings.filter(s=>s.status==='open').length;
  const prog=screenings.filter(s=>s.status==='in_progress').length;
  const done=screenings.filter(s=>s.status==='completed').length;
  const passCount=screenings.filter(s=>s.result==='pass').length;
  const failCount=screenings.filter(s=>s.result==='fail').length;
  const exemptCount=employees.filter(e=>e.isExempt).length;
  const recent=[...screenings].sort((a,b)=>new Date(b.pickedAt)-new Date(a.pickedAt)).slice(0,5);
  const countdown=schedulerConfig.enabled&&schedulerConfig.nextPickAt?getCountdown(schedulerConfig.nextPickAt):null;
  const stats=[{label:'Active Pool',v:employees.filter(e=>!e.isExempt).length,c:'#000'},{label:'Exempt',v:exemptCount,c:'#7c3aed'},{label:'Open',v:open,c:T.open},{label:'In Progress',v:prog,c:T.prog},{label:'Pass',v:passCount,c:T.done},{label:'Fail',v:failCount,c:T.warn}];
  return <div>
    <SectionTitle icon={LayoutDashboard}>Dashboard</SectionTitle>
    {schedulerConfig.enabled&&<Card style={{marginBottom:16,background:'#fffbeb',border:'2px solid '+T.gold,padding:'12px 16px'}}>
      <div style={{display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'}}>
        <div style={{width:8,height:8,borderRadius:'50%',background:T.goldD,animation:'pulse 2s infinite',flexShrink:0}}/>
        <div style={{flex:1}}><span style={{fontSize:13,color:T.goldD,fontWeight:800,fontFamily:FONT_BODY,textTransform:'uppercase'}}>Scheduler Active</span>{countdown&&<span style={{fontSize:12,color:T.muted,marginLeft:8,fontFamily:FONT_BODY}}>Next: <strong style={{color:T.goldD}}>{countdown}</strong></span>}</div>
        <Btn onClick={()=>setView('settings')} v="dark" size="sm">Configure</Btn>
      </div>
    </Card>}
    {lastBackup&&<Card style={{marginBottom:16,background:'#f0fdf4',border:'1px solid #bbf7d0',padding:'10px 16px'}}>
      <div style={{display:'flex',alignItems:'center',gap:8}}><HardDrive size={14} color={T.done}/><span style={{fontSize:12,color:T.done,fontFamily:FONT_BODY,fontWeight:700}}>Last Drive backup: {fmtDT(lastBackup)}</span></div>
    </Card>}
    <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:10,marginBottom:20}}>
      {stats.map(s=><div key={s.label} style={{background:'#fff',border:'1px solid '+T.border,borderRadius:8,padding:'12px 10px',textAlign:'center',boxShadow:'0 1px 4px '+T.shadow}}>
        <div style={{fontSize:28,fontWeight:900,color:s.c,lineHeight:1,fontFamily:FONT_HEAD}}>{s.v}</div>
        <div style={{fontSize:10,color:T.muted,marginTop:4,textTransform:'uppercase',letterSpacing:'0.08em',fontFamily:FONT_BODY,fontWeight:700}}>{s.label}</div>
      </div>)}
    </div>
    <div style={{display:'grid',gridTemplateColumns:isMobile?'1fr':'1fr 1fr',gap:16}}>
      <Card>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:14}}>
          <h3 style={{margin:0,fontSize:14,fontWeight:800,color:T.text,fontFamily:FONT_HEAD,letterSpacing:'0.05em'}}>RECENT ACTIVITY</h3>
          <Btn onClick={()=>setView('screenings')} v="ghost" size="sm">View All</Btn>
        </div>
        {recent.length===0?<p style={{color:T.muted,fontSize:13,textAlign:'center',padding:'16px 0',fontFamily:FONT_BODY}}>No screenings yet</p>:recent.map(s=><div key={s.id} style={{display:'flex',alignItems:'center',gap:8,padding:'8px 0',borderBottom:'1px solid '+T.border}}>
          <div style={{flex:1,minWidth:0}}><div style={{fontSize:13,fontWeight:700,color:T.text,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',fontFamily:FONT_BODY}}>{s.employeeName}</div><div style={{fontSize:11,color:T.muted,fontFamily:FONT_BODY}}>{(s.type||'random').toUpperCase()} · {fmtDate(s.pickedAt)}{s.autoScheduled&&<span style={{marginLeft:5,color:T.goldD,fontWeight:800}}>[AUTO]</span>}</div></div>
          {s.result&&s.result!=='pending'&&<Badge status={s.result}/>}
          <Badge status={s.status}/>
        </div>)}
      </Card>
      <Card>
        <h3 style={{margin:'0 0 14px',fontSize:14,fontWeight:800,color:T.text,fontFamily:FONT_HEAD,letterSpacing:'0.05em'}}>QUICK ACTIONS</h3>
        {[{label:'Run Random Pick',icon:Shuffle,v:'picker'},{label:'Add Drug Test',icon:FlaskConical,v:'drugtests'},{label:'Manage Employees',icon:Users,v:'employees'},{label:'Export Reports',icon:BarChart2,v:'reports'}].map(a=><div key={a.v} onClick={()=>setView(a.v)} style={{display:'flex',alignItems:'center',gap:10,padding:'10px 12px',borderRadius:6,cursor:'pointer',marginBottom:6,border:'2px solid '+T.border,background:'#fafafa',transition:'all 0.15s'}} onMouseEnter={e=>{e.currentTarget.style.borderColor=T.gold;e.currentTarget.style.background='#fffbeb';}} onMouseLeave={e=>{e.currentTarget.style.borderColor=T.border;e.currentTarget.style.background='#fafafa';}}>
          <a.icon size={16} color={T.goldD}/><div style={{fontSize:13,fontWeight:700,color:T.text,fontFamily:FONT_BODY}}>{a.label}</div>
        </div>)}
      </Card>
    </div>
  </div>;
}

// ─── CALENDAR ─────────────────────────────────────────────────────────────
function CalendarView({screenings}){
  const today=new Date();const isMobile=useIsMobile();
  const[curY,setCurY]=useState(today.getFullYear());const[curM,setCurM]=useState(today.getMonth());const[sel,setSel]=useState([]);const[dayD,setDayD]=useState(null);
  const nav=(dir)=>{let m=curM+dir,y=curY;if(m<0){m=11;y--;}if(m>11){m=0;y++;}setCurM(m);setCurY(y);};
  const fd=new Date(curY,curM,1).getDay();const dim=new Date(curY,curM+1,0).getDate();
  const onDay=(y,m,d)=>screenings.filter(s=>{const dt=new Date(s.pickedAt);return dt.getFullYear()===y&&dt.getMonth()===m&&dt.getDate()===d;});
  const toggleSel=(k)=>setSel(s=>s.includes(k)?s.filter(x=>x!==k):[...s,k]);
  const allKeys=useMemo(()=>{const k=new Set();screenings.forEach(s=>{const d=new Date(s.pickedAt);k.add(d.getFullYear()+'-'+d.getMonth());});return[...k].sort();},[screenings]);
  const exportPDF=()=>{const months=(sel.length>0?sel:[curY+'-'+curM]).map(k=>{const[y,m]=k.split('-');return{y:parseInt(y),m:parseInt(m)};});months.sort((a,b)=>a.y!==b.y?a.y-b.y:a.m-b.m);const html='<!DOCTYPE html><html><head><title>Calendar</title><style>body{font-family:Georgia,serif;background:#fff;margin:0;padding:20px;color:#111}.mo{margin-bottom:36px;page-break-inside:avoid}h1{font-size:11px;text-align:center;text-transform:uppercase;color:#888;margin-bottom:4px}h2{font-size:20px;text-align:center;margin:0 0 14px}.gr{display:grid;grid-template-columns:repeat(7,1fr);gap:2px}.dh{text-align:center;font-size:10px;font-weight:700;color:#888;padding:5px;text-transform:uppercase}.dy{border:1px solid #e5e7eb;min-height:60px;padding:5px;font-size:12px}.em{background:#f9fafb}.hs{background:#fffbeb;border-color:#d97706}.dn{font-weight:700;margin-bottom:2px}.pk{background:#c9a000;color:#fff;border-radius:2px;padding:1px 3px;font-size:10px;margin-bottom:1px}.ft{margin-top:20px;font-size:10px;color:#aaa;text-align:center;border-top:1px solid #eee;padding-top:10px}@media print{button{display:none}}</style></head><body><button onclick="window.print()" style="margin-bottom:16px;padding:7px 14px;background:#c9a000;color:#fff;border:none;border-radius:4px;cursor:pointer;font-weight:bold">Print / Save as PDF</button>'+months.map(({y,m})=>{const fd=new Date(y,m,1).getDay();const dim=new Date(y,m+1,0).getDate();let c=Array(fd).fill('<div class="dy em"></div>').join('');for(let d=1;d<=dim;d++){const ps=onDay(y,m,d);c+='<div class="dy '+(ps.length?'hs':'')+'"><div class="dn">'+d+'</div>'+ps.map(p=>'<div class="pk">'+p.employeeId+'</div>').join('')+'</div>';}return'<div class="mo"><h1>Screening Solutions — Screening Calendar</h1><h2>'+MONTHS[m]+' '+y+'</h2><div class="gr">'+DAYS.map(d=>'<div class="dh">'+d+'</div>').join('')+c+'</div></div>';}).join('')+'<div class="ft">Generated '+new Date().toLocaleString()+' · Screening Solutions · BETA SOFTWARE</div></body></html>';const w=window.open('','_blank');w.document.write(html);w.document.close();};
  const thisMonthPicks=screenings.filter(s=>{const d=new Date(s.pickedAt);return d.getMonth()===curM&&d.getFullYear()===curY;});
  return <div>
    <SectionTitle icon={CalendarDays}>Calendar</SectionTitle>
    <div style={{display:'grid',gridTemplateColumns:isMobile?'1fr':'1fr 300px',gap:16}}>
      <Card style={{padding:0,overflow:'hidden'}}>
        <div style={{padding:'12px 16px',borderBottom:'2px solid '+T.border,display:'flex',alignItems:'center',justifyContent:'space-between',background:T.nav}}>
          <button onClick={()=>nav(-1)} style={{background:'none',border:'none',color:T.gold,cursor:'pointer',display:'flex',padding:6}}><ChevronLeft size={18}/></button>
          <h3 style={{margin:0,fontFamily:FONT_HEAD,fontSize:isMobile?16:18,color:T.gold,letterSpacing:'0.1em'}}>{MONTHS[curM].toUpperCase()} {curY}</h3>
          <button onClick={()=>nav(1)} style={{background:'none',border:'none',color:T.gold,cursor:'pointer',display:'flex',padding:6}}><ChevronRight size={18}/></button>
        </div>
        <div style={{display:'grid',gridTemplateColumns:'repeat(7,1fr)',padding:'8px 8px 0'}}>{DAYS.map(d=><div key={d} style={{textAlign:'center',fontSize:9,fontWeight:800,color:T.muted,padding:'4px 0',textTransform:'uppercase',fontFamily:FONT_BODY,letterSpacing:'0.1em'}}>{isMobile?d[0]:d}</div>)}</div>
        <div style={{display:'grid',gridTemplateColumns:'repeat(7,1fr)',gap:2,padding:'0 8px 8px'}}>
          {Array(fd).fill(null).map((_,i)=><div key={'e'+i} style={{minHeight:isMobile?36:52}}/>)}
          {Array.from({length:dim},(_,i)=>i+1).map(d=>{const picks=onDay(curY,curM,d);const isToday=d===today.getDate()&&curM===today.getMonth()&&curY===today.getFullYear();return <div key={d} onClick={()=>picks.length>0&&setDayD({d,picks})} style={{minHeight:isMobile?36:52,borderRadius:4,border:'1px solid '+(picks.length?T.gold:T.border),padding:isMobile?3:4,background:picks.length?'#fffbeb':isToday?'#eff6ff':'#fafafa',cursor:picks.length?'pointer':'default',transition:'all 0.15s'}} onMouseEnter={e=>{if(picks.length)e.currentTarget.style.background='#fef3c7';}} onMouseLeave={e=>{if(picks.length)e.currentTarget.style.background='#fffbeb';}}>
            <div style={{fontSize:isMobile?10:11,fontWeight:isToday?900:600,color:isToday?T.open:T.text,fontFamily:FONT_BODY}}>{d}</div>
            {!isMobile&&picks.slice(0,1).map(p=><div key={p.id} style={{background:T.goldD,borderRadius:2,padding:'1px 3px',fontSize:8,color:'#fff',fontWeight:800,marginTop:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',fontFamily:FONT_BODY}}>{p.employeeId}</div>)}
            {picks.length>0&&isMobile&&<div style={{width:5,height:5,borderRadius:'50%',background:T.gold,margin:'2px auto 0'}}/>}
            {!isMobile&&picks.length>1&&<div style={{fontSize:8,color:T.goldD,fontFamily:FONT_BODY,fontWeight:700}}>+{picks.length-1}</div>}
          </div>;})}
        </div>
      </Card>
      <div>
        <Card style={{marginBottom:14}}>
          <h4 style={{margin:'0 0 10px',fontSize:13,fontWeight:800,color:T.text,fontFamily:FONT_HEAD,letterSpacing:'0.05em'}}>EXPORT PDF</h4>
          <div style={{maxHeight:160,overflow:'auto',marginBottom:12}}>
            {allKeys.length===0?<p style={{fontSize:12,color:T.muted,fontFamily:FONT_BODY}}>No screenings on record.</p>:allKeys.map(k=>{const[y,m]=k.split('-');return <div key={k} onClick={()=>toggleSel(k)} style={{display:'flex',alignItems:'center',gap:8,padding:'5px 8px',borderRadius:4,cursor:'pointer',background:sel.includes(k)?'#fffbeb':'transparent',border:'1px solid '+(sel.includes(k)?T.gold:'transparent'),marginBottom:2}}>
              <div style={{width:14,height:14,borderRadius:2,border:'2px solid '+(sel.includes(k)?T.goldD:T.border),background:sel.includes(k)?T.gold:'transparent',display:'flex',alignItems:'center',justifyContent:'center',fontSize:9,color:'#000',flexShrink:0}}>{sel.includes(k)?'✓':''}</div>
              <span style={{fontSize:13,color:T.text,fontFamily:FONT_BODY,fontWeight:600}}>{MONTHS[parseInt(m)]} {y}</span>
            </div>;})}
          </div>
          <Btn onClick={exportPDF} full size="sm" v="dark"><Printer size={13}/>Export {sel.length>0?sel.length+' Month(s)':'Current Month'}</Btn>
        </Card>
        <Card>
          <h4 style={{margin:'0 0 10px',fontSize:13,fontWeight:800,color:T.text,fontFamily:FONT_HEAD}}>{MONTHS[curM].toUpperCase()} {curY}</h4>
          {thisMonthPicks.length===0?<p style={{fontSize:12,color:T.muted,fontFamily:FONT_BODY}}>No screenings this month.</p>:thisMonthPicks.map(s=><div key={s.id} style={{padding:'6px 0',borderBottom:'1px solid '+T.border,display:'flex',alignItems:'center',gap:6}}>
            <div style={{flex:1,minWidth:0}}><div style={{color:T.text,fontWeight:700,fontSize:13,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',fontFamily:FONT_BODY}}>{s.employeeName}</div><div style={{color:T.muted,fontSize:10,fontFamily:FONT_BODY}}>{(s.type||'random').toUpperCase()} · {fmtDate(s.pickedAt)}</div></div>
            {s.result&&s.result!=='pending'&&<Badge status={s.result}/>}
            <Badge status={s.status}/>
          </div>)}
        </Card>
      </div>
    </div>
    {dayD&&<Modal title={MONTHS[curM]+' '+dayD.d+', '+curY} onClose={()=>setDayD(null)} isMobile={isMobile}>
      {dayD.picks.map(p=><div key={p.id} style={{padding:12,background:'#fafafa',borderRadius:6,marginBottom:8,border:'1px solid '+T.border}}>
        <div style={{fontWeight:800,color:T.text,marginBottom:4,fontFamily:FONT_BODY}}>{p.employeeName}</div>
        <div style={{fontSize:12,color:T.muted,fontFamily:FONT_BODY,marginBottom:6}}>ID: {p.employeeId} · {(p.type||'random').toUpperCase()} · {fmtDT(p.pickedAt)}</div>
        <div style={{display:'flex',gap:4}}>{p.result&&p.result!=='pending'&&<Badge status={p.result}/>}<Badge status={p.status}/></div>
      </div>)}
    </Modal>}
  </div>;
}


// ─── REPORTS ──────────────────────────────────────────────────────────────
function ReportsView({screenings,employees}){
  const[period,setPeriod]=useState('monthly');const isMobile=useIsMobile();const now=new Date();
  const getPD=(p)=>{const s=new Date(now);if(p==='weekly')s.setDate(s.getDate()-7);else if(p==='monthly')s.setMonth(s.getMonth()-1);else if(p==='quarterly')s.setMonth(s.getMonth()-3);else s.setFullYear(s.getFullYear()-1);return screenings.filter(sc=>new Date(sc.pickedAt)>=s);};
  const data=getPD(period);const open=data.filter(s=>s.status==='open').length;const prog=data.filter(s=>s.status==='in_progress').length;const done=data.filter(s=>s.status==='completed').length;const passC=data.filter(s=>s.result==='pass').length;const failC=data.filter(s=>s.result==='fail').length;const rate=data.length?Math.round((done/data.length)*100):0;
  const exportXLS=(p)=>{const d=getPD(p);const lbl={weekly:'Weekly',monthly:'Monthly',quarterly:'Quarterly',annual:'Annual'}[p];const log=d.map(s=>({'Name':s.employeeName,'ID':s.employeeId,'Type':(s.type||'random').replace(/-/g,' '),'Picked':fmtDT(s.pickedAt),'Result':s.result||'Pending','Result Notes':s.resultNotes||'','Status':s.status,'Completed':fmtDT(s.completedAt),'By':s.completedBy||'','Auto':s.autoScheduled?'Yes':'No'}));const summ=[['Screening Solutions — Executive Report',''],['BETA SOFTWARE — NOT FOR SOLE COMPLIANCE USE',''],['Metric','Value'],['Period',lbl],['Generated',fmtDT(new Date().toISOString())],['Total Employees',employees.length],['Active Pool',employees.filter(e=>!e.isExempt).length],['Exempt',employees.filter(e=>e.isExempt).length],['Screenings',d.length],['Pass',passC],['Fail',failC],['Open',open],['In Progress',prog],['Completed',done],['Rate',rate+'%']];const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(log.length?log:[{Note:'No data'}]),'Screening Log');XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(summ),'Executive Summary');const empLog=employees.map(e=>({Name:e.name,ID:e.id,Title:e.title||'',Department:e.department||'',Position:e.position||'',Management:e.isManagement?'Yes':'No',Exempt:e.isExempt?'Yes':'No'}));XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(empLog),'Employee Roster');XLSX.writeFile(wb,'ScreeningSolutions_'+lbl+'_'+now.toISOString().split('T')[0]+'.xlsx');};
  const exportAll=()=>{const wb=XLSX.utils.book_new();['weekly','monthly','quarterly','annual'].forEach(p=>{const d=getPD(p);const rows=d.map(s=>({Name:s.employeeName,ID:s.employeeId,Type:(s.type||'random'),Picked:fmtDT(s.pickedAt),Result:s.result||'Pending',Status:s.status,Completed:fmtDT(s.completedAt),By:s.completedBy||''}));XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(rows.length?rows:[{Note:'No data'}]),p.charAt(0).toUpperCase()+p.slice(1));});XLSX.writeFile(wb,'ScreeningSolutions_AllReports_'+now.toISOString().split('T')[0]+'.xlsx');};
  return <div>
    <SectionTitle icon={BarChart2}>Reports</SectionTitle>
    <div style={{display:'flex',gap:6,marginBottom:10,flexWrap:'wrap'}}>
      {['weekly','monthly','quarterly','annual'].map(p=><Btn key={p} onClick={()=>setPeriod(p)} v={period===p?'dark':'ghost'} size="sm">{p.toUpperCase()}</Btn>)}
    </div>
    <div style={{display:'flex',gap:8,marginBottom:16,flexWrap:'wrap'}}>
      <Btn onClick={()=>exportXLS(period)} v="secondary" size="sm"><FileDown size={13}/>Export {period}</Btn>
      <Btn onClick={exportAll} v="secondary" size="sm"><FileDown size={13}/>Export All</Btn>
    </div>
    <div style={{display:'grid',gridTemplateColumns:'repeat(2,1fr)',gap:10,marginBottom:16}}>
      {[{l:'Total',v:data.length,c:'#000'},{l:'Pass',v:passC,c:T.done},{l:'Fail',v:failC,c:T.warn},{l:'Completed',v:done,c:T.open}].map(s=><Card key={s.l} style={{textAlign:'center',padding:'14px 10px'}}>
        <div style={{fontSize:32,fontWeight:900,color:s.c,fontFamily:FONT_HEAD}}>{s.v}</div>
        <div style={{fontSize:10,color:T.muted,marginTop:4,textTransform:'uppercase',letterSpacing:'0.08em',fontFamily:FONT_BODY,fontWeight:700}}>{s.l}</div>
      </Card>)}
    </div>
    <Card style={{marginBottom:16}}>
      <h4 style={{margin:'0 0 12px',fontSize:14,fontWeight:800,color:T.text,fontFamily:FONT_HEAD,letterSpacing:'0.05em'}}>PERIOD SUMMARY</h4>
      {[['Period',{weekly:'Last 7 Days',monthly:'Last 30 Days',quarterly:'Last 90 Days',annual:'Last 365 Days'}[period]],['Total Employees',employees.length],['Active Pool',employees.filter(e=>!e.isExempt).length],['Screenings',data.length],['Pass',passC],['Fail',failC],['Completion Rate',rate+'%']].map(([l,v])=><MobileRow key={l} label={l} value={String(v)}/>)}
      <div style={{marginTop:12}}>
        <div style={{display:'flex',justifyContent:'space-between',fontSize:12,color:T.muted,marginBottom:5,fontFamily:FONT_BODY,fontWeight:700}}><span>Completion Rate</span><span>{rate}%</span></div>
        <div style={{height:8,background:T.bg,borderRadius:4,overflow:'hidden',border:'1px solid '+T.border}}><div style={{height:'100%',background:T.gold,borderRadius:4,width:rate+'%',transition:'width 0.5s'}}/></div>
      </div>
    </Card>
    <Card style={{padding:0,overflow:'hidden'}}>
      <div style={{padding:'10px 14px',borderBottom:'2px solid '+T.border,background:T.nav}}><span style={{fontSize:13,fontWeight:800,color:T.gold,fontFamily:FONT_HEAD,letterSpacing:'0.05em'}}>SCREENING LOG</span></div>
      {isMobile?(
        <div style={{padding:12}}>{data.length===0?<p style={{color:T.muted,fontSize:13,textAlign:'center',fontFamily:FONT_BODY}}>No screenings in this period.</p>:data.map(s=><div key={s.id} style={{padding:'10px 0',borderBottom:'1px solid '+T.border}}>
          <div style={{display:'flex',justifyContent:'space-between',marginBottom:4}}><div style={{fontSize:13,fontWeight:700,color:T.text,fontFamily:FONT_BODY}}>{s.employeeName}</div><div style={{display:'flex',gap:4}}>{s.result&&s.result!=='pending'&&<Badge status={s.result}/>}<Badge status={s.status}/></div></div>
          <div style={{fontSize:11,color:T.muted,fontFamily:FONT_BODY}}>{s.employeeId} · {(s.type||'random').toUpperCase()} · {fmtDate(s.pickedAt)}</div>
        </div>)}</div>
      ):(
        <div style={{overflowX:'auto'}}>
          <table style={{width:'100%',borderCollapse:'collapse'}}>
            <thead><tr style={{borderBottom:'1px solid '+T.border,background:'#fafafa'}}>{['Employee','ID','Type','Picked','Result','Status','By'].map(h=><th key={h} style={{padding:'9px 12px',textAlign:'left',fontSize:10,color:T.muted,fontWeight:800,letterSpacing:'0.07em',textTransform:'uppercase',fontFamily:FONT_BODY}}>{h}</th>)}</tr></thead>
            <tbody>{data.length===0?<tr><td colSpan={7} style={{padding:'28px',textAlign:'center',color:T.muted,fontSize:13,fontFamily:FONT_BODY}}>No screenings in this period.</td></tr>:data.map(s=><tr key={s.id} style={{borderBottom:'1px solid '+T.border}} onMouseEnter={e=>e.currentTarget.style.background='#fffbeb'} onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
              <td style={{padding:'9px 12px',fontSize:13,color:T.text,fontFamily:FONT_BODY,fontWeight:600}}>{s.employeeName}</td>
              <td style={{padding:'9px 12px',fontFamily:'monospace',fontSize:11,color:T.goldD,fontWeight:700}}>{s.employeeId}</td>
              <td style={{padding:'9px 12px',fontSize:11,fontFamily:FONT_BODY,fontWeight:700,color:T.text,whiteSpace:'nowrap'}}>{(s.type||'random').replace(/-/g,' ').replace(/\b\\w/g,c=>c.toUpperCase())}</td>
              <td style={{padding:'9px 12px',fontSize:11,color:T.muted,fontFamily:FONT_BODY,whiteSpace:'nowrap'}}>{fmtDate(s.pickedAt)}</td>
              <td style={{padding:'9px 12px'}}>{s.result&&s.result!=='pending'?<Badge status={s.result}/>:<span style={{fontSize:10,color:T.muted,fontFamily:FONT_BODY}}>Pending</span>}</td>
              <td style={{padding:'9px 12px'}}><Badge status={s.status}/></td>
              <td style={{padding:'9px 12px',fontSize:11,color:T.muted,fontFamily:FONT_BODY}}>{s.completedBy||'—'}</td>
            </tr>)}</tbody>
          </table>
        </div>
      )}
    </Card>
  </div>;
}

// ─── SETTINGS ─────────────────────────────────────────────────────────────
function SettingsView({schedulerConfig,saveScheduler,emailConfig,saveEmailConfig,employees,screenings,saveScreenings,companySettings,saveCompanySettings,notify,tick,handleExportProfile,handleExportProfileExcel,handleImportProfile}){
  const[sc,setSc]=useState(schedulerConfig);const[em,setEm]=useState(emailConfig);const[cs,setCs]=useState(companySettings);
  const[testing,setTesting]=useState(false);const[backupFiles,setBackupFiles]=useState([]);
  const isMobile=useIsMobile();
  const setS=(k,v)=>setSc(s=>({...s,[k]:v}));const setE=(k,v)=>setEm(e=>({...e,[k]:v}));const setCo=(k,v)=>setCs(c=>({...c,[k]:v}));
  const handleLogo=(e)=>{const f=e.target.files[0];if(!f)return;const r=new FileReader();r.onload=()=>setCo('logo',r.result);r.readAsDataURL(f);};
  const saveAll=async()=>{let cfg={...sc};if(sc.enabled&&!schedulerConfig.enabled)cfg.nextPickAt=new Date(Date.now()+sc.intervalValue*INTERVAL_MS[sc.intervalUnit]).toISOString();if(!sc.enabled)cfg.nextPickAt=null;await saveScheduler(cfg);await saveEmailConfig(em);await saveCompanySettings(cs);notify('Settings saved.');};
  const runNow=()=>{const pool=employees.filter(e=>!e.isExempt);if(pool.length===0){notify('No eligible employees.','error');return;}const idx=secureRand(pool.length);const emp=pool[idx];const warn=wasRecentPick(emp.id,screenings);const s={id:uid(),employeeId:emp.id,employeeName:emp.name,pickedAt:new Date().toISOString(),status:'open',type:'random',result:'pending',recentWarn:warn,autoScheduled:true};const next=new Date(Date.now()+sc.intervalValue*INTERVAL_MS[sc.intervalUnit]).toISOString();const nc={...sc,nextPickAt:next,lastPickAt:new Date().toISOString()};saveScreenings([...screenings,s]);saveScheduler(nc);setSc(nc);notify('Auto-pick: '+emp.name+' selected.');};
  const testEmail=async()=>{if(!em.serviceId||!em.templateId||!em.publicKey){notify('Fill in all EmailJS fields.','error');return;}if(!sc.emailTo){notify('Enter recipient email.','error');return;}setTesting(true);const ok=await sendEmail(em,sc.emailTo,{name:'Test Employee',id:'TEST-001'},new Date().toISOString(),false);setTesting(false);notify(ok?'Test email sent!':'Email failed.',ok?'info':'error');};
  const countdown=sc.enabled&&sc.nextPickAt?getCountdown(sc.nextPickAt):null;
  const logoRef=useRef();

  const loadBackups=async()=>{
    if(window.electronAPI){const files=await window.electronAPI.backup.list();setBackupFiles(files);}
  };
  useEffect(()=>{loadBackups();},[]);

  const handleRestoreBackup=async(filePath,name)=>{
    if(!window.confirm('Restore from backup "'+name+'"? This will overwrite all current data.'))return;
    if(window.electronAPI){
      const r=await window.electronAPI.backup.restore(filePath);
      if(r.ok){
        const d=r.data;
        if(d.hr_employees)saveEmployees(d.hr_employees);
        if(d.hr_screenings)saveScreenings(d.hr_screenings);
        notify('Restored from backup. Restart the app to fully reload all data.','info');
      }else notify('Restore failed: '+(r.error||'unknown error'),'error');
    }
  };

  return <div>
    <SectionTitle icon={Settings}>Settings</SectionTitle>
    <div style={{display:'grid',gridTemplateColumns:isMobile?'1fr':'1fr 1fr',gap:16}}>
      <div>
        {/* Branding */}
        <Card style={{marginBottom:14}}>
          <h3 style={{margin:'0 0 14px',fontFamily:FONT_HEAD,fontSize:16,color:T.text,letterSpacing:'0.05em',display:'flex',alignItems:'center',gap:8}}><Building2 size={16} color={T.goldD}/>Company Branding</h3>
          <div style={{display:'flex',alignItems:'center',gap:14,marginBottom:14}}>
            <div onClick={()=>logoRef.current.click()} style={{width:64,height:64,borderRadius:8,border:'2px dashed '+T.border,background:'#fafafa',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',overflow:'hidden',flexShrink:0}}>
              {cs.logo?<img src={cs.logo} style={{width:'100%',height:'100%',objectFit:'contain'}} alt="logo"/>:<Upload size={20} color={T.muted}/>}
            </div>
            <div><p style={{margin:'0 0 6px',fontSize:12,color:T.muted,fontFamily:FONT_BODY}}>Upload company logo for the sidebar.</p><Btn onClick={()=>logoRef.current.click()} v="secondary" size="sm"><Upload size={12}/>Upload</Btn>{cs.logo&&<Btn onClick={()=>setCo('logo','')} v="danger" size="sm" style={{marginLeft:6}}>Remove</Btn>}</div>
          </div>
          <input ref={logoRef} type="file" accept="image/*" onChange={handleLogo} style={{display:'none'}}/>
          <FieldInput label="Company Name" placeholder="Acme Corp." value={cs.name||''} onChange={e=>setCo('name',e.target.value)}/>
          <Btn onClick={saveAll} v="dark" size="sm">Save Branding</Btn>
        </Card>
        {/* Auto-Scheduler */}
        <Card>
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:14}}>
            <h3 style={{margin:0,fontFamily:FONT_HEAD,fontSize:16,color:T.text,display:'flex',alignItems:'center',gap:8}}><Timer size={16} color={T.goldD}/>Auto-Scheduler</h3>
            <Toggle checked={sc.enabled} onChange={()=>setS('enabled',!sc.enabled)}/>
          </div>
          {sc.enabled&&countdown&&<div style={{background:'#fffbeb',border:'2px solid '+T.gold,borderRadius:6,padding:'10px 12px',marginBottom:12}}>
            <div style={{fontSize:10,color:T.muted,textTransform:'uppercase',letterSpacing:'0.07em',marginBottom:3,fontFamily:FONT_BODY,fontWeight:700}}>Next Pick In</div>
            <div style={{fontSize:24,fontWeight:900,color:T.goldD,fontFamily:FONT_HEAD}}>{countdown}</div>
            <div style={{fontSize:11,color:T.muted,marginTop:2,fontFamily:FONT_BODY}}>{fmtDT(sc.nextPickAt)}</div>
          </div>}
          {sc.lastPickAt&&<div style={{fontSize:11,color:T.muted,marginBottom:10,fontFamily:FONT_BODY}}>Last: {fmtDT(sc.lastPickAt)}</div>}
          <div style={{marginBottom:12}}>
            <label style={{display:'block',fontSize:11,fontWeight:700,color:T.sub,letterSpacing:'0.08em',textTransform:'uppercase',marginBottom:6,fontFamily:FONT_BODY}}>Pick Interval</label>
            <div style={{display:'flex',gap:8}}>
              <input type="number" min={1} value={sc.intervalValue} onChange={e=>setS('intervalValue',Math.max(1,parseInt(e.target.value)||1))} style={{width:70,background:'#fafafa',border:'2px solid '+T.border,borderRadius:6,padding:'8px 10px',color:T.text,fontSize:13,fontFamily:FONT_BODY,outline:'none',fontWeight:700}}/>
              <select value={sc.intervalUnit} onChange={e=>setS('intervalUnit',e.target.value)} style={{flex:1,background:'#fafafa',border:'2px solid '+T.border,borderRadius:6,padding:'8px 10px',color:T.text,fontSize:13,fontFamily:FONT_BODY,outline:'none',fontWeight:700}}>
                <option value="minutes">Minutes</option><option value="hours">Hours</option><option value="days">Days</option><option value="weeks">Weeks</option>
              </select>
            </div>
          </div>
          <div style={{marginBottom:12}}><Toggle checked={sc.emailEnabled} onChange={()=>setS('emailEnabled',!sc.emailEnabled)} label="Email alert on each pick"/></div>
          {sc.emailEnabled&&<FieldInput label="Notify Email" type="email" placeholder="hr@company.com" value={sc.emailTo} onChange={e=>setS('emailTo',e.target.value)}/>}
          <div style={{display:'flex',gap:8,marginTop:12}}>
            <Btn onClick={saveAll} v="dark" style={{flex:1}}>Save</Btn>
            <Btn onClick={runNow} v="secondary" disabled={employees.filter(e=>!e.isExempt).length===0}><Zap size={13}/>Pick Now</Btn>
          </div>
        </Card>
      </div>
      <div>
        {/* Local Backup & Export/Import */}
        <Card style={{marginBottom:14}}>
          <h3 style={{margin:'0 0 14px',fontFamily:FONT_HEAD,fontSize:16,color:T.text,display:'flex',alignItems:'center',gap:8}}><HardDrive size={16} color={T.goldD}/>Data & Backup</h3>
          <div style={{background:'#f0fdf4',border:'2px solid '+T.done,borderRadius:8,padding:'12px 14px',marginBottom:14}}>
            <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:4}}><CheckCircle2 size={14} color={T.done}/><span style={{fontSize:12,fontWeight:800,color:T.done,fontFamily:FONT_BODY}}>AUTO-SAVE ACTIVE — Every change saved instantly</span></div>
            <p style={{margin:0,fontSize:11,color:T.sub,fontFamily:FONT_BODY,lineHeight:1.6}}>Rolling backups are written automatically to your AppData folder. Your data is never lost unless you uninstall the app.</p>
          </div>
          <div style={{display:'flex',gap:8,marginBottom:12,flexWrap:'wrap'}}>
            <Btn onClick={handleExportProfile} v="dark"><Download size={13}/>Export JSON</Btn>
            <Btn onClick={handleExportProfileExcel} v="secondary"><FileDown size={13}/>Export Excel</Btn>
            <Btn onClick={handleImportProfile} v="secondary"><Upload size={13}/>Import Profile</Btn>
          </div>
          <p style={{fontSize:11,color:T.muted,marginBottom:14,fontFamily:FONT_BODY,lineHeight:1.7}}>
            <strong>Export JSON</strong> saves a portable file for backup or migrating to another computer.<br/><strong>Export Excel</strong> saves all employees, screenings, random picks, drug tests, and a summary across multiple sheets.<br/>
            <strong>Import Profile</strong> restores all data from a previously exported file.
          </p>
          <div style={{borderTop:'1px solid '+T.border,paddingTop:12}}>
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:8}}>
              <h4 style={{margin:0,fontFamily:FONT_HEAD,fontSize:13,color:T.text,letterSpacing:'0.05em'}}>AUTO-BACKUPS ({backupFiles.length})</h4>
              <div style={{display:'flex',gap:6}}>
                <Btn onClick={loadBackups} v="ghost" size="sm"><RefreshCw size={11}/>Refresh</Btn>
                <Btn onClick={()=>window.electronAPI?.backup.openFolder()} v="ghost" size="sm"><FolderOpen size={11}/>Open Folder</Btn>
              </div>
            </div>
            {backupFiles.length===0?<p style={{fontSize:12,color:T.muted,fontFamily:FONT_BODY}}>Backups appear here automatically as you use the app.</p>:
              <div style={{maxHeight:200,overflow:'auto'}}>
                {backupFiles.map((f,i)=><div key={f.name} style={{display:'flex',alignItems:'center',gap:8,padding:'7px 0',borderBottom:'1px solid '+T.border}}>
                  <div style={{flex:1}}><div style={{fontSize:12,fontWeight:700,color:T.text,fontFamily:FONT_BODY}}>{i===0?'⭐ ':''}{fmtDT(f.date)}</div><div style={{fontSize:10,color:T.muted,fontFamily:FONT_BODY}}>{(f.size/1024).toFixed(1)} KB</div></div>
                  <Btn onClick={()=>handleRestoreBackup(f.path,f.name)} v={i===0?'success':'secondary'} size="sm">Restore</Btn>
                </div>)}
              </div>}
          </div>
        </Card>
        {/* Email Config */}
        <Card>
          <h3 style={{margin:'0 0 14px',fontFamily:FONT_HEAD,fontSize:16,color:T.text,letterSpacing:'0.05em',display:'flex',alignItems:'center',gap:8}}><Mail size={16} color={T.goldD}/>Email Notifications (EmailJS)</h3>
          <FieldInput label="Service ID" placeholder="service_xxxxxxx" value={em.serviceId} onChange={e=>setE('serviceId',e.target.value)}/>
          <FieldInput label="Template ID" placeholder="template_xxxxxxx" value={em.templateId} onChange={e=>setE('templateId',e.target.value)}/>
          <FieldInput label="Public Key" placeholder="xxxxxxxxxxxxxxxx" value={em.publicKey} onChange={e=>setE('publicKey',e.target.value)}/>
          <div style={{display:'flex',gap:8}}>
            <Btn onClick={saveAll} v="dark" style={{flex:1}}>Save</Btn>
            <Btn onClick={testEmail} v="secondary" disabled={testing}>{testing?<><RefreshCw size={13} style={{animation:'spin 0.8s linear infinite'}}/>Sending…</>:<><Send size={13}/>Test</>}</Btn>
          </div>
        </Card>
      </div>
    </div>
  </div>;
}

function ProfileView({user,companySettings,saveCompanySettings,notify}){
  const[name,setName]=useState(companySettings?.name||'');
  const save=()=>{saveCompanySettings({...companySettings,name});notify('Saved.');};
  return <div style={{maxWidth:440}}>
    <SectionTitle icon={UserCircle}>Profile</SectionTitle>
    <Card>
      <div style={{textAlign:'center',marginBottom:20}}>
        <div style={{width:88,height:88,borderRadius:'50%',background:T.nav,border:'3px solid '+T.goldD,display:'flex',alignItems:'center',justifyContent:'center',margin:'0 auto 8px',fontSize:30}}>👤</div>
        <div style={{fontSize:16,fontWeight:800,fontFamily:FONT_HEAD,color:T.text,letterSpacing:'0.05em'}}>{user.displayName||user.username||'Admin'}</div>
        <div style={{fontSize:13,color:T.muted,fontFamily:FONT_BODY}}>{user.email}</div>
        <div style={{marginTop:8,display:'inline-flex',alignItems:'center',gap:6,background:'#f0fdf4',border:'1px solid #bbf7d0',borderRadius:6,padding:'4px 10px'}}>
          <span style={{fontSize:11,color:T.done,fontFamily:FONT_BODY,fontWeight:700}}>✓ Signed in via Google (Preview)</span>
        </div>
      </div>
      <FieldInput label="Organization Name" value={name} onChange={e=>setName(e.target.value)} placeholder="Your Company Name"/>
      <Btn onClick={save} full size="lg" v="dark">Save</Btn>
    </Card>
  </div>;
}


// ─── HELP BUBBLE ──────────────────────────────────────────────────────────
function HelpBubble({isMobile}){
  const[open,setOpen]=useState(false);const[msgs,setMsgs]=useState([]);const[input,setInput]=useState('');const[loading,setLoading]=useState(false);const endRef=useRef();
  useEffect(()=>{if(open&&endRef.current)endRef.current.scrollIntoView({behavior:'smooth'});},[msgs,open]);
  const send=async()=>{const text=input.trim();if(!text||loading)return;const um={role:'user',content:text};setMsgs(m=>[...m,um]);setInput('');setLoading(true);
    try{const res=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:'claude-sonnet-4-20250514',max_tokens:1000,system:'You are an experienced HR compliance specialist with deep expertise in workplace drug screening. You specialize in DOT regulations (49 CFR Part 40), SAMHSA guidelines, random selection protocols, SAP programs, MRO processes, chain of custody, and return-to-duty procedures. Be concise and professional.',messages:[...msgs,um]})});const d=await res.json();const txt=d.content?.map(c=>c.text||'').join('')||'Sorry, no response.';setMsgs(m=>[...m,{role:'assistant',content:txt}]);}catch{setMsgs(m=>[...m,{role:'assistant',content:'Connection error.'}]);}setLoading(false);};
  const panelW=isMobile?'calc(100vw - 32px)':340;
  return <>
    {open&&<div style={{position:'fixed',bottom:isMobile?88:88,right:16,width:panelW,height:isMobile?360:460,background:'#fff',border:'2px solid '+T.goldD,borderRadius:12,display:'flex',flexDirection:'column',boxShadow:'0 20px 60px rgba(0,0,0,0.15)',zIndex:3000,overflow:'hidden'}}>
      <div style={{padding:'12px 14px',background:T.nav,display:'flex',alignItems:'center',justifyContent:'space-between'}}>
        <div><div style={{fontSize:13,fontWeight:800,color:T.gold,fontFamily:FONT_HEAD,letterSpacing:'0.05em'}}>HR COMPLIANCE ASSISTANT</div><div style={{fontSize:10,color:T.navMuted,fontFamily:FONT_BODY}}>Powered by Claude AI</div></div>
        <button onClick={()=>setOpen(false)} style={{background:'none',border:'none',cursor:'pointer',color:T.navMuted,display:'flex'}}><X size={16}/></button>
      </div>
      <div style={{flex:1,overflow:'auto',padding:12,display:'flex',flexDirection:'column',gap:8,background:'#fafafa'}}>
        {msgs.length===0&&<div style={{textAlign:'center',padding:'16px 8px'}}><div style={{fontSize:24,marginBottom:8}}>⚖</div><div style={{fontSize:13,color:T.muted,lineHeight:1.6,fontFamily:FONT_BODY}}>Ask about DOT regulations, SAMHSA guidelines, or drug screening compliance.</div></div>}
        {msgs.map((m,i)=><div key={i} style={{display:'flex',justifyContent:m.role==='user'?'flex-end':'flex-start'}}>
          <div style={{maxWidth:'88%',padding:'8px 12px',borderRadius:m.role==='user'?'12px 12px 2px 12px':'12px 12px 12px 2px',background:m.role==='user'?T.nav:'#fff',color:m.role==='user'?T.gold:T.text,fontSize:13,lineHeight:1.6,fontFamily:FONT_BODY,border:m.role==='user'?'none':'1px solid '+T.border,fontWeight:m.role==='user'?700:400}}>{m.content}</div>
        </div>)}
        {loading&&<div style={{display:'flex'}}><div style={{padding:'8px 12px',borderRadius:'12px 12px 12px 2px',background:'#fff',border:'1px solid '+T.border,fontSize:13,color:T.muted,fontFamily:FONT_BODY}}>Thinking…</div></div>}
        <div ref={endRef}/>
      </div>
      <div style={{padding:'8px 10px',borderTop:'1px solid '+T.border,display:'flex',gap:7,background:'#fff'}}>
        <input value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>e.key==='Enter'&&send()} placeholder="Ask a compliance question…" style={{flex:1,background:'#fafafa',border:'2px solid '+T.border,borderRadius:6,padding:'8px 10px',color:T.text,fontSize:13,fontFamily:FONT_BODY,outline:'none',fontWeight:600}}/>
        <button onClick={send} disabled={!input.trim()||loading} style={{background:input.trim()&&!loading?T.gold:'#fafafa',border:'2px solid '+(input.trim()&&!loading?T.goldD:T.border),borderRadius:6,width:36,height:36,cursor:input.trim()&&!loading?'pointer':'default',color:input.trim()&&!loading?'#000':T.muted,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}><Send size={14}/></button>
      </div>
    </div>}
    <button onClick={()=>setOpen(o=>!o)} style={{position:'fixed',bottom:isMobile?72:24,right:16,width:52,height:52,borderRadius:'50%',background:T.nav,border:'3px solid '+T.gold,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',boxShadow:'0 4px 16px rgba(0,0,0,0.2)',zIndex:3001,transition:'transform 0.2s'}} onMouseEnter={e=>e.currentTarget.style.transform='scale(1.1)'} onMouseLeave={e=>e.currentTarget.style.transform='scale(1)'}>
      {open?<X size={20} color={T.gold}/>:<HelpCircle size={20} color={T.gold}/>}
    </button>
  </>;
}

function Notif({n}){
  if(!n)return null;
  const c={info:{bg:'#eff6ff',color:'#1d4ed8',b:'#bfdbfe'},error:{bg:'#fef2f2',color:'#dc2626',b:'#fecaca'},warning:{bg:'#fffbeb',color:'#92400e',b:'#fde68a'}}[n.type]||{bg:'#eff6ff',color:'#1d4ed8',b:'#bfdbfe'};
  return <div style={{position:'fixed',top:16,right:16,left:16,zIndex:9999,background:c.bg,color:c.color,padding:'11px 16px',borderRadius:8,border:'2px solid '+c.b,boxShadow:'0 4px 16px rgba(0,0,0,0.1)',fontSize:13,lineHeight:1.5,animation:'slideIn 0.25s ease',fontFamily:FONT_BODY,fontWeight:700}}>{n.msg}</div>;
}

function FinePrint({onShowTC}){
  return <div style={{padding:'6px 16px',borderTop:'1px solid '+T.border,background:'#fafafa',flexShrink:0}}>
    <p style={{margin:0,fontSize:9,color:T.muted,textAlign:'center',lineHeight:1.6,fontFamily:FONT_BODY}}>
      Screening Solutions · <strong style={{color:T.warn}}>BETA SOFTWARE</strong> · Not all features may be functional · Errors likely · Not a final product · Not for use as sole compliance mechanism · Not legal advice ·{' '}
      <span onClick={onShowTC} style={{color:T.goldD,cursor:'pointer',textDecoration:'underline',fontWeight:700}}>Terms &amp; Conditions</span>
    </p>
  </div>;
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────

// ─── LOCAL AUTH VIEWS ────────────────────────────────────────────────────────
function LocalSignInView({onSignIn,onSetup,users}){
  const[email,setEmail]=useState('');const[pass,setPass]=useState('');const[show,setShow]=useState(false);const[err,setErr]=useState('');
  const submit=()=>{const u=users.find(u=>u.email.toLowerCase()===email.toLowerCase()&&u.password===pass);if(!u){setErr('Invalid email or password.');return;}onSignIn(u);};
  return <div style={{minHeight:'100vh',background:T.bg,display:'flex',alignItems:'center',justifyContent:'center',fontFamily:FONT_BODY,padding:16}}>
    <div style={{width:'100%',maxWidth:420}}>
      <div style={{textAlign:'center',marginBottom:36}}>
        <div style={{width:72,height:72,borderRadius:14,background:T.nav,display:'flex',alignItems:'center',justifyContent:'center',margin:'0 auto 16px',border:'3px solid '+T.gold}}><span style={{fontSize:30}}>⚖</span></div>
        <h1 style={{fontFamily:FONT_HEAD,fontSize:30,color:T.text,margin:'0 0 6px',letterSpacing:'0.08em'}}>SCREENING SOLUTIONS</h1>
        <p style={{color:T.muted,fontSize:14,margin:'0 0 8px',fontFamily:FONT_BODY}}>Drug Screening Management Platform</p>
        <div style={{display:'inline-flex',alignItems:'center',gap:6,background:'#f0fdf4',border:'1px solid #bbf7d0',borderRadius:4,padding:'3px 12px'}}><span style={{fontSize:10,fontWeight:700,color:T.done,letterSpacing:'0.08em'}}>💾 OFFLINE — DATA SAVED LOCALLY</span></div>
      </div>
      <Card style={{padding:32}}>
        <h3 style={{margin:'0 0 18px',fontFamily:FONT_HEAD,fontSize:18,color:T.text,letterSpacing:'0.05em'}}>SIGN IN</h3>
        <FieldInput label="Email" type="email" placeholder="you@company.com" value={email} onChange={e=>setEmail(e.target.value)}/>
        <div style={{position:'relative'}}>
          <FieldInput label="Password" type={show?'text':'password'} placeholder="••••••••" value={pass} onChange={e=>setPass(e.target.value)} onKeyDown={e=>e.key==='Enter'&&submit()}/>
          <button onClick={()=>setShow(s=>!s)} style={{position:'absolute',right:12,top:28,background:'none',border:'none',color:T.muted,cursor:'pointer'}}>{show?<EyeOff size={15}/>:<Eye size={15}/>}</button>
        </div>
        {err&&<p style={{color:T.warn,fontSize:12,margin:'0 0 12px',fontWeight:700}}>{err}</p>}
        <Btn onClick={submit} full size="lg" v="dark" style={{marginBottom:10}}>Sign In</Btn>
        <Btn onClick={onSetup} full v="ghost">Create New Account</Btn>
      </Card>
    </div>
  </div>;
}

function LocalSetupView({onSave,onBack,agreed,setAgreed,showTC,setShowTC,isMobile}){
  const[form,setForm]=useState({email:'',username:'',password:'',confirm:''});
  const[show,setShow]=useState(false);const[err,setErr]=useState('');
  const set=(k,v)=>setForm(f=>({...f,[k]:v}));
  const submit=()=>{if(!form.email||!form.username||!form.password){setErr('All fields required.');return;}if(form.password!==form.confirm){setErr('Passwords do not match.');return;}if(!agreed){setErr('You must agree to the Terms & Conditions.');return;}onSave({...form,id:uid(),confirm:undefined});};
  return <div style={{minHeight:'100vh',background:T.bg,display:'flex',alignItems:'center',justifyContent:'center',fontFamily:FONT_BODY,padding:16}}>
    {showTC&&<TCModal onClose={()=>setShowTC(false)} isMobile={isMobile}/>}
    <div style={{width:'100%',maxWidth:460}}>
      <div style={{textAlign:'center',marginBottom:20}}><h1 style={{fontFamily:FONT_HEAD,fontSize:24,color:T.text,margin:'0 0 4px',letterSpacing:'0.08em'}}>CREATE PROFILE</h1><p style={{color:T.muted,fontSize:13,margin:0}}>Set up your local HR administrator account</p></div>
      <Card style={{padding:24}}>
        <FieldInput label="Email" type="email" placeholder="you@company.com" value={form.email} onChange={e=>set('email',e.target.value)}/>
        <FieldInput label="Display Name" placeholder="Jane Smith" value={form.username} onChange={e=>set('username',e.target.value)}/>
        <div style={{position:'relative'}}>
          <FieldInput label="Password" type={show?'text':'password'} placeholder="••••••••" value={form.password} onChange={e=>set('password',e.target.value)}/>
          <button onClick={()=>setShow(s=>!s)} style={{position:'absolute',right:12,top:28,background:'none',border:'none',color:T.muted,cursor:'pointer'}}>{show?<EyeOff size={15}/>:<Eye size={15}/>}</button>
        </div>
        <FieldInput label="Confirm Password" type="password" placeholder="••••••••" value={form.confirm} onChange={e=>set('confirm',e.target.value)}/>
        <div style={{background:'#fafafa',border:'1px solid '+T.border,borderRadius:6,padding:'12px 14px',marginBottom:14}}>
          <label style={{display:'flex',alignItems:'flex-start',gap:10,cursor:'pointer'}}>
            <input type="checkbox" checked={agreed} onChange={e=>setAgreed(e.target.checked)} style={{width:16,height:16,marginTop:2,accentColor:T.goldD,flexShrink:0}}/>
            <span style={{fontSize:12,color:T.sub,lineHeight:1.6,fontFamily:FONT_BODY}}>I agree to the Terms & Conditions governing use of Screening Solutions.</span>
          </label>
          <p style={{margin:'6px 0 0 26px',fontSize:10,color:T.muted,fontFamily:FONT_BODY}}><span onClick={()=>setShowTC(true)} style={{color:T.goldD,cursor:'pointer',textDecoration:'underline',fontWeight:700}}>Read full Terms & Conditions</span></p>
        </div>
        {err&&<p style={{color:T.warn,fontSize:12,margin:'0 0 12px',fontWeight:700}}>{err}</p>}
        <Btn onClick={submit} full size="lg" v="dark" style={{marginBottom:10}}>Create Account</Btn>
        <Btn onClick={onBack} v="ghost" full>Back to Sign In</Btn>
      </Card>
    </div>
  </div>;
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
const DEMO_USER_TEMPLATE = {
  id:'local-user-001',
  displayName:'HR Admin',
  email:'admin@screeningsolutions.com',
  photoURL:null,
};

// ─── ANIMATED SPLASH SCREEN ───────────────────────────────────────────────────
function SplashScreen(){
  const[phase,setPhase]=useState(0);
  useEffect(()=>{
    const timers=[
      setTimeout(()=>setPhase(1),  800),
      setTimeout(()=>setPhase(2), 1700),
      setTimeout(()=>setPhase(3), 2600),
      setTimeout(()=>setPhase(4), 3400),
      setTimeout(()=>setPhase(5), 4200),
    ];
    return()=>timers.forEach(clearTimeout);
  },[]);
  return <div style={{position:'fixed',inset:0,background:'#f5f2ee',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',overflow:'hidden',fontFamily:FONT_HEAD,userSelect:'none'}}>
    {[...Array(18)].map((_,i)=>(
      <div key={i} style={{position:'absolute',width:2+Math.sin(i*137)*2+'px',height:2+Math.sin(i*137)*2+'px',borderRadius:'50%',background:T.gold,opacity:phase>=2?0.08+Math.abs(Math.sin(i*0.7))*0.12:0,left:(15+(i*53)%72)+'%',top:(10+(i*37)%80)+'%',transition:`opacity ${0.8+i*0.05}s ease ${i*0.06}s`,animation:phase>=3?`floatDot ${3+i*0.4}s ease-in-out ${i*0.2}s infinite alternate`:undefined}}/>
    ))}
    <div style={{position:'absolute',width:500,height:500,borderRadius:'50%',border:'1px solid rgba(249,115,22,0.06)',opacity:phase>=1?1:0,transition:'opacity 1s',animation:phase>=3?'spinSlow 12s linear infinite':undefined}}/>
    <div style={{position:'absolute',width:360,height:360,borderRadius:'50%',border:'1px solid rgba(249,115,22,0.1)',opacity:phase>=1?1:0,transition:'opacity 1s 0.3s',animation:phase>=3?'spinSlow 8s linear infinite reverse':undefined}}/>
    <div style={{position:'absolute',width:420,height:420,borderRadius:'50%',background:'radial-gradient(circle, rgba(249,115,22,0.1) 0%, transparent 65%)',opacity:phase>=1?1:0,transition:'opacity 1s'}}/>
    <div style={{width:120,height:120,borderRadius:24,background:'linear-gradient(145deg,#ffffff,#f0ede8)',border:'2px solid '+T.gold,display:'flex',alignItems:'center',justifyContent:'center',marginBottom:32,boxShadow:'0 0 60px rgba(249,115,22,0.25)',transform:phase>=0?'scale(1) rotate(0deg)':'scale(0.2) rotate(-15deg)',opacity:phase>=0?1:0,transition:'transform 0.7s cubic-bezier(0.34,1.56,0.64,1), opacity 0.5s',animation:phase>=5?'iconPulse 3s ease-in-out infinite':undefined}}>
      <span style={{fontSize:58,lineHeight:1,filter:'drop-shadow(0 0 8px rgba(249,115,22,0.5))'}}>⚖</span>
    </div>
    <div style={{overflow:'hidden',marginBottom:8,height:60}}>
      <h1 style={{margin:0,fontFamily:FONT_HEAD,fontSize:46,letterSpacing:'0.14em',textTransform:'uppercase',whiteSpace:'nowrap',transform:phase>=1?'translateY(0)':'translateY(110%)',opacity:phase>=1?1:0,transition:'transform 0.65s cubic-bezier(0.22,1,0.36,1), opacity 0.5s'}}>
        <span style={{color:'#1a1a2e'}}>Screening</span><span style={{color:T.gold,textShadow:'0 0 20px rgba(249,115,22,0.4)'}}> Solutions</span>
      </h1>
    </div>
    <p style={{margin:'0 0 8px',fontFamily:FONT_BODY,fontSize:13,letterSpacing:'0.26em',color:'rgba(26,26,46,0.4)',textTransform:'uppercase',opacity:phase>=2?1:0,transform:phase>=2?'translateY(0)':'translateY(10px)',transition:'opacity 0.7s, transform 0.7s'}}>Drug Screening Management Platform</p>
    <div style={{width:300,height:2,background:'rgba(249,115,22,0.12)',borderRadius:1,overflow:'hidden',margin:'24px 0'}}>
      <div style={{height:'100%',borderRadius:1,width:phase>=3?'100%':'0%',transition:'width 1.1s cubic-bezier(0.4,0,0.2,1)',background:'linear-gradient(90deg,transparent,'+T.gold+','+T.goldD+','+T.gold+',transparent)',backgroundSize:'300% 100%',animation:phase>=4?'shimmer 2s linear infinite':undefined}}/>
    </div>
    <div style={{marginBottom:20,background:'rgba(249,115,22,0.08)',border:'1px solid rgba(249,115,22,0.2)',borderRadius:4,padding:'3px 14px',opacity:phase>=4?1:0,transition:'opacity 0.7s'}}>
      <span style={{fontSize:9,letterSpacing:'0.2em',color:'rgba(249,115,22,0.7)',textTransform:'uppercase',fontFamily:FONT_BODY,fontWeight:700}}>Beta — Development Build</span>
    </div>
    <p style={{margin:0,fontFamily:FONT_BODY,fontSize:12,letterSpacing:'0.2em',textTransform:'uppercase',color:'rgba(26,26,46,0.45)',opacity:phase>=4?1:0,transition:'opacity 0.8s 0.2s'}}>Made by Dustin Hanson</p>
    <style>{`
      @keyframes shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}
      @keyframes spinSlow{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
      @keyframes iconPulse{0%,100%{box-shadow:0 0 60px rgba(249,115,22,0.25)}50%{box-shadow:0 0 90px rgba(249,115,22,0.45)}}
      @keyframes floatDot{from{transform:translateY(0px)}to{transform:translateY(-12px)}}
    `}</style>
  </div>;
}


// ─── LOGIN SCREEN ─────────────────────────────────────────────────────────────
function LoginScreen({onLogin,onGoRegister}){
  const[email,setEmail]=useState('');const[pass,setPass]=useState('');const[show,setShow]=useState(false);const[err,setErr]=useState('');const[loading,setLoading]=useState(false);
  const submit=async()=>{if(!email||!pass){setErr('Email and password are required.');return;}setLoading(true);setErr('');try{const cred=await loginUser(email,pass);onLogin(cred.user);}catch(e){setErr(e.code==='auth/invalid-credential'||e.code==='auth/wrong-password'||e.code==='auth/user-not-found'?'Invalid email or password.':e.code==='auth/too-many-requests'?'Too many attempts. Try again later.':e.message||'Sign-in failed.');}setLoading(false);};
  return <div style={{minHeight:'100vh',background:'#f5f2ee',display:'flex',alignItems:'center',justifyContent:'center',padding:20,fontFamily:FONT_BODY}}>
    <div style={{width:'100%',maxWidth:420}}>
      <div style={{textAlign:'center',marginBottom:36}}>
        <div style={{width:80,height:80,borderRadius:18,background:'#ffffff',border:'2px solid '+T.gold,display:'flex',alignItems:'center',justifyContent:'center',margin:'0 auto 16px',boxShadow:'0 0 40px rgba(249,115,22,0.2)'}}><span style={{fontSize:40}}>⚖</span></div>
        <h1 style={{fontFamily:FONT_HEAD,fontSize:30,color:'#1a1a2e',margin:'0 0 4px',letterSpacing:'0.08em'}}>SCREENING SOLUTIONS</h1>
        <p style={{color:'rgba(26,26,46,0.4)',fontSize:12,margin:'0 0 8px',letterSpacing:'0.1em',textTransform:'uppercase'}}>Drug Screening Management Platform</p>
        <div style={{display:'inline-flex',alignItems:'center',gap:6,background:'rgba(249,115,22,0.08)',border:'1px solid rgba(249,115,22,0.2)',borderRadius:4,padding:'3px 12px'}}><div style={{width:6,height:6,borderRadius:'50%',background:T.done}}/><span style={{fontSize:10,fontWeight:700,color:T.done,letterSpacing:'0.08em'}}>CLOUD-SYNCED — MULTI-PC</span></div>
      </div>
      <div style={{background:'#ffffff',border:'1px solid rgba(0,0,0,.08)',borderRadius:12,padding:28}}>
        <h3 style={{margin:'0 0 20px',fontFamily:FONT_HEAD,fontSize:18,color:'#1a1a2e',letterSpacing:'0.05em'}}>SIGN IN</h3>
        <div style={{marginBottom:14}}><label style={{display:'block',fontSize:11,fontWeight:700,color:'rgba(26,26,46,0.5)',letterSpacing:'0.08em',textTransform:'uppercase',marginBottom:5,fontFamily:FONT_BODY}}>Email</label><input type="email" placeholder="you@company.com" value={email} onChange={e=>setEmail(e.target.value)} onKeyDown={e=>e.key==='Enter'&&submit()} style={{width:'100%',boxSizing:'border-box',background:'#f9f7f5',border:'2px solid rgba(0,0,0,.1)',borderRadius:8,padding:'10px 14px',color:'#1a1a2e',fontSize:14,fontFamily:FONT_BODY,outline:'none'}}/></div>
        <div style={{marginBottom:20,position:'relative'}}><label style={{display:'block',fontSize:11,fontWeight:700,color:'rgba(26,26,46,0.5)',letterSpacing:'0.08em',textTransform:'uppercase',marginBottom:5,fontFamily:FONT_BODY}}>Password</label><input type={show?'text':'password'} placeholder="••••••••" value={pass} onChange={e=>setPass(e.target.value)} onKeyDown={e=>e.key==='Enter'&&submit()} style={{width:'100%',boxSizing:'border-box',background:'#f9f7f5',border:'2px solid rgba(0,0,0,.1)',borderRadius:8,padding:'10px 14px',color:'#1a1a2e',fontSize:14,fontFamily:FONT_BODY,outline:'none'}}/><button onClick={()=>setShow(s=>!s)} style={{position:'absolute',right:12,top:32,background:'none',border:'none',color:'rgba(26,26,46,0.4)',cursor:'pointer'}}>{show?<EyeOff size={15}/>:<Eye size={15}/>}</button></div>
        {err&&<div style={{background:'rgba(220,38,38,0.1)',border:'1px solid rgba(220,38,38,0.3)',borderRadius:6,padding:'8px 12px',marginBottom:14,fontSize:12,color:'#f87171',fontFamily:FONT_BODY,fontWeight:700}}>{err}</div>}
        <button onClick={submit} disabled={loading} style={{width:'100%',padding:'12px',borderRadius:8,border:'2px solid '+T.gold,background:T.nav,color:T.gold,cursor:loading?'wait':'pointer',fontFamily:FONT_HEAD,fontSize:14,fontWeight:700,letterSpacing:'0.08em',marginBottom:12,opacity:loading?0.7:1}}>{loading?'SIGNING IN…':'SIGN IN'}</button>
        <p style={{textAlign:'center',fontSize:12,color:'rgba(26,26,46,0.35)',fontFamily:FONT_BODY,margin:0}}>No account? <span onClick={onGoRegister} style={{color:T.gold,cursor:'pointer',fontWeight:700}}>Create one →</span></p>
      </div>
    </div>
  </div>;
}

// ─── REGISTER SCREEN ──────────────────────────────────────────────────────────
function RegisterScreen({onLogin,onGoLogin}){
  const[form,setForm]=useState({name:'',email:'',pass:'',confirm:''});const[show,setShow]=useState(false);const[err,setErr]=useState('');const[loading,setLoading]=useState(false);const[agreed,setAgreed]=useState(false);const[showTC,setShowTC]=useState(false);const isMobile=useIsMobile();const set=(k,v)=>setForm(f=>({...f,[k]:v}));
  const submit=async()=>{if(!form.name||!form.email||!form.pass){setErr('All fields are required.');return;}if(form.pass!==form.confirm){setErr('Passwords do not match.');return;}if(form.pass.length<6){setErr('Password must be at least 6 characters.');return;}if(!agreed){setErr('You must agree to the Terms & Conditions.');return;}setLoading(true);setErr('');try{const user=await registerUser(form.email,form.pass,form.name);onLogin(user);}catch(e){setErr(e.code==='auth/email-already-in-use'?'That email is already registered.':e.code==='auth/invalid-email'?'Invalid email address.':e.message||'Registration failed.');}setLoading(false);};
  return <div style={{minHeight:'100vh',background:'#f5f2ee',display:'flex',alignItems:'center',justifyContent:'center',padding:20,fontFamily:FONT_BODY}}>
    {showTC&&<TCModal onClose={()=>setShowTC(false)} isMobile={isMobile}/>}
    <div style={{width:'100%',maxWidth:460}}>
      <div style={{textAlign:'center',marginBottom:28}}><div style={{width:60,height:60,borderRadius:14,background:'#ffffff',border:'2px solid '+T.gold,display:'flex',alignItems:'center',justifyContent:'center',margin:'0 auto 12px',fontSize:26}}>⚖</div><h1 style={{fontFamily:FONT_HEAD,fontSize:24,color:'#1a1a2e',margin:'0 0 4px',letterSpacing:'0.08em'}}>CREATE ACCOUNT</h1><p style={{color:'rgba(26,26,46,0.35)',fontSize:12,margin:0}}>Create profiles and share them with your team</p></div>
      <div style={{background:'#ffffff',border:'1px solid rgba(0,0,0,.08)',borderRadius:12,padding:28}}>
        {[['name','Display Name','Jane Smith','text'],['email','Email','you@company.com','email']].map(([k,label,ph,type])=>(
          <div key={k} style={{marginBottom:14}}><label style={{display:'block',fontSize:11,fontWeight:700,color:'rgba(26,26,46,0.5)',letterSpacing:'0.08em',textTransform:'uppercase',marginBottom:5,fontFamily:FONT_BODY}}>{label}</label><input type={type} placeholder={ph} value={form[k]} onChange={e=>set(k,e.target.value)} style={{width:'100%',boxSizing:'border-box',background:'#f9f7f5',border:'2px solid rgba(0,0,0,.1)',borderRadius:8,padding:'10px 14px',color:'#1a1a2e',fontSize:14,fontFamily:FONT_BODY,outline:'none'}}/></div>
        ))}
        <div style={{marginBottom:14,position:'relative'}}><label style={{display:'block',fontSize:11,fontWeight:700,color:'rgba(26,26,46,0.5)',letterSpacing:'0.08em',textTransform:'uppercase',marginBottom:5,fontFamily:FONT_BODY}}>Password</label><input type={show?'text':'password'} placeholder="Min 6 characters" value={form.pass} onChange={e=>set('pass',e.target.value)} style={{width:'100%',boxSizing:'border-box',background:'#f9f7f5',border:'2px solid rgba(0,0,0,.1)',borderRadius:8,padding:'10px 14px',color:'#1a1a2e',fontSize:14,fontFamily:FONT_BODY,outline:'none'}}/><button onClick={()=>setShow(s=>!s)} style={{position:'absolute',right:12,top:32,background:'none',border:'none',color:'rgba(26,26,46,0.4)',cursor:'pointer'}}>{show?<EyeOff size={15}/>:<Eye size={15}/>}</button></div>
        <div style={{marginBottom:18}}><label style={{display:'block',fontSize:11,fontWeight:700,color:'rgba(26,26,46,0.5)',letterSpacing:'0.08em',textTransform:'uppercase',marginBottom:5,fontFamily:FONT_BODY}}>Confirm Password</label><input type="password" placeholder="Re-enter password" value={form.confirm} onChange={e=>set('confirm',e.target.value)} onKeyDown={e=>e.key==='Enter'&&submit()} style={{width:'100%',boxSizing:'border-box',background:'#f9f7f5',border:'2px solid rgba(0,0,0,.1)',borderRadius:8,padding:'10px 14px',color:'#1a1a2e',fontSize:14,fontFamily:FONT_BODY,outline:'none'}}/></div>
        <div style={{background:'rgba(0,0,0,0.02)',border:'1px solid rgba(0,0,0,.08)',borderRadius:8,padding:'12px 14px',marginBottom:16}}>
          <label style={{display:'flex',alignItems:'flex-start',gap:10,cursor:'pointer'}}><input type="checkbox" checked={agreed} onChange={e=>setAgreed(e.target.checked)} style={{width:16,height:16,marginTop:2,accentColor:T.gold,flexShrink:0}}/><span style={{fontSize:12,color:'rgba(26,26,46,0.5)',lineHeight:1.6,fontFamily:FONT_BODY}}>I agree to the Terms & Conditions</span></label>
          <p style={{margin:'6px 0 0 26px',fontSize:10,color:'rgba(26,26,46,0.3)',fontFamily:FONT_BODY}}><span onClick={()=>setShowTC(true)} style={{color:T.gold,cursor:'pointer',textDecoration:'underline',fontWeight:700}}>Read Terms & Conditions →</span></p>
        </div>
        {err&&<div style={{background:'rgba(220,38,38,0.1)',border:'1px solid rgba(220,38,38,0.3)',borderRadius:6,padding:'8px 12px',marginBottom:14,fontSize:12,color:'#f87171',fontFamily:FONT_BODY,fontWeight:700}}>{err}</div>}
        <button onClick={submit} disabled={loading} style={{width:'100%',padding:'12px',borderRadius:8,border:'2px solid '+T.gold,background:T.nav,color:T.gold,cursor:loading?'wait':'pointer',fontFamily:FONT_HEAD,fontSize:14,fontWeight:700,letterSpacing:'0.08em',marginBottom:12,opacity:loading?0.7:1}}>{loading?'CREATING ACCOUNT…':'CREATE ACCOUNT'}</button>
        <p style={{textAlign:'center',fontSize:12,color:'rgba(26,26,46,0.35)',fontFamily:FONT_BODY,margin:0}}>Already have an account? <span onClick={onGoLogin} style={{color:T.gold,cursor:'pointer',fontWeight:700}}>Sign in →</span></p>
      </div>
    </div>
  </div>;
}

// ─── INVITE MODAL ─────────────────────────────────────────────────────────────
function InviteModal({profile,currentUser,onClose,isMobile}){
  const[email,setEmail]=useState('');const[err,setErr]=useState('');const[success,setSuccess]=useState('');const[loading,setLoading]=useState(false);
  const[members,setMembers]=useState(profile.members||[]);
  const send=async()=>{
    const e=email.trim().toLowerCase();if(!e){setErr('Enter an email address.');return;}
    if(e===currentUser.email.toLowerCase()){setErr("That's your own email.");return;}
    if(members.find(m=>m.email.toLowerCase()===e)){setErr('That person is already a member.');return;}
    setLoading(true);setErr('');
    try{
      await sendInvite(profile.id,profile.name,profile.color,e,currentUser.uid,currentUser.displayName||currentUser.email);
      setSuccess('Invite sent to '+e+'. They will see it when they log in.');setEmail('');
    }catch(ex){setErr(ex.message||'Failed to send invite.');}
    setLoading(false);
  };
  const remove=async(m)=>{
    if(m.role==='owner'){setErr("Can't remove the owner.");return;}
    if(!window.confirm('Remove '+m.displayName+' from this profile?'))return;
    try{
      await removeProfileMember(profile.id,m.uid,m.email);
      setMembers(prev=>prev.filter(x=>x.uid!==m.uid));
    }catch(ex){setErr(ex.message||'Failed to remove member.');}
  };
  return <Modal title={'SHARE: '+profile.name} onClose={onClose} isMobile={isMobile} width={520}>
    <div style={{marginBottom:18}}>
      <h4 style={{margin:'0 0 10px',fontFamily:FONT_HEAD,fontSize:14,color:T.text,letterSpacing:'0.05em'}}>INVITE BY EMAIL</h4>
      <p style={{fontSize:12,color:T.muted,marginBottom:12,fontFamily:FONT_BODY,lineHeight:1.6}}>The invited person will see the invite when they log in. They must already have a Screening Solutions account, or create one first.</p>
      <div style={{display:'flex',gap:8}}>
        <input value={email} onChange={e=>setEmail(e.target.value)} onKeyDown={e=>e.key==='Enter'&&send()} placeholder="colleague@company.com" style={{flex:1,background:'#fafafa',border:'2px solid '+T.border,borderRadius:6,padding:'10px 12px',color:T.text,fontSize:14,fontFamily:FONT_BODY,outline:'none'}}/>
        <Btn onClick={send} v="dark" disabled={loading}>{loading?<RefreshCw size={13} style={{animation:'spin 0.8s linear infinite'}}/>:<Send size={13}/>} Send Invite</Btn>
      </div>
      {err&&<p style={{color:T.warn,fontSize:12,fontWeight:700,margin:'8px 0 0',fontFamily:FONT_BODY}}>{err}</p>}
      {success&&<p style={{color:T.done,fontSize:12,fontWeight:700,margin:'8px 0 0',fontFamily:FONT_BODY}}>{success}</p>}
    </div>
    <div style={{borderTop:'2px solid '+T.gold,paddingTop:16}}>
      <h4 style={{margin:'0 0 10px',fontFamily:FONT_HEAD,fontSize:14,color:T.text,letterSpacing:'0.05em'}}>CURRENT MEMBERS ({members.length})</h4>
      {members.map(m=><div key={m.uid} style={{display:'flex',alignItems:'center',gap:10,padding:'9px 0',borderBottom:'1px solid '+T.border}}>
        <div style={{width:34,height:34,borderRadius:'50%',background:T.nav,display:'flex',alignItems:'center',justifyContent:'center',fontSize:12,color:T.gold,fontWeight:800,fontFamily:FONT_HEAD,flexShrink:0}}>{(m.displayName||m.email)[0].toUpperCase()}</div>
        <div style={{flex:1,minWidth:0}}><div style={{fontSize:13,fontWeight:700,color:T.text,fontFamily:FONT_BODY,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{m.displayName||m.email}</div><div style={{fontSize:11,color:T.muted,fontFamily:FONT_BODY}}>{m.email} · {m.role}</div></div>
        {m.role==='owner'?<span style={{fontSize:10,background:'#fffbeb',color:T.goldD,border:'1px solid '+T.gold,borderRadius:4,padding:'2px 8px',fontFamily:FONT_BODY,fontWeight:800}}>OWNER</span>:m.uid!==currentUser.uid&&profile.members?.find(x=>x.uid===currentUser.uid)?.role==='owner'?<Btn onClick={()=>remove(m)} v="danger" size="sm">Remove</Btn>:<span style={{fontSize:10,color:T.muted,fontFamily:FONT_BODY}}>Member</span>}
      </div>)}
    </div>
  </Modal>;
}

// ─── PROFILE PICKER ───────────────────────────────────────────────────────────
const PROFILE_COLORS=['#f5c518','#3b82f6','#10b981','#f97316','#8b5cf6','#ec4899','#06b6d4','#ef4444'];

function ProfilePicker({firebaseUser,onSelect,onLogout}){
  const[profiles,setProfiles]=useState([]);const[invites,setInvites]=useState([]);const[loading,setLoading]=useState(true);const[adding,setAdding]=useState(false);const[newName,setNewName]=useState('');const[err,setErr]=useState('');const[confirmDel,setConfirmDel]=useState(null);const[shareModal,setShareModal]=useState(null);const isMobile=useIsMobile();

  const load=useCallback(async()=>{
    setLoading(true);
    try{
      const[profs,invs]=await Promise.all([getMyProfiles(firebaseUser.uid),getMyInvites(firebaseUser.email)]);
      setProfiles(profs);setInvites(invs);
    }catch(e){console.error('load profiles error',e);}
    setLoading(false);
  },[firebaseUser]);

  useEffect(()=>{load();},[load]);

  const addProfile=async()=>{
    const name=newName.trim();if(!name){setErr('Enter a profile name.');return;}
    const color=PROFILE_COLORS[profiles.length%PROFILE_COLORS.length];
    try{const id=await createProfile(name,color,firebaseUser);await load();setNewName('');setAdding(false);setErr('');}
    catch(e){setErr(e.message||'Failed to create profile.');}
  };

  const delProfile=async(p)=>{
    try{await deleteProfile(p.id);await load();}
    catch(e){setErr(e.message||'Failed to delete.');}
    setConfirmDel(null);
  };

  const acceptInv=async(inv)=>{
    try{await acceptInvite(inv.id,inv,firebaseUser);await load();}
    catch(e){setErr(e.message||'Failed to accept invite.');}
  };

  const declineInv=async(inv)=>{
    try{await declineInvite(inv.id);setInvites(prev=>prev.filter(i=>i.id!==inv.id));}
    catch(e){setErr(e.message||'Failed to decline.');}
  };

  const initials=name=>name.split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2);
  const isOwner=p=>p.ownerId===firebaseUser.uid;

  return <div style={{minHeight:'100vh',background:'#f5f2ee',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',padding:24,fontFamily:FONT_BODY}}>
    {confirmDel&&<div onClick={()=>setConfirmDel(null)} style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.5)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:9999}}>
      <div onClick={e=>e.stopPropagation()} style={{background:'#ffffff',border:'2px solid '+T.warn,borderRadius:12,padding:28,maxWidth:380,width:'100%',textAlign:'center'}}>
        <AlertTriangle size={32} color={T.warn} style={{marginBottom:12}}/>
        <h3 style={{color:'#1a1a2e',fontFamily:FONT_HEAD,fontSize:18,margin:'0 0 8px'}}>DELETE PROFILE?</h3>
        <p style={{color:'rgba(26,26,46,0.55)',fontSize:13,lineHeight:1.6,margin:'0 0 20px',fontFamily:FONT_BODY}}>This permanently deletes <strong style={{color:T.gold}}>"{confirmDel.name}"</strong> and all its data. Cannot be undone.</p>
        <div style={{display:'flex',gap:10,justifyContent:'center'}}>
          <Btn onClick={()=>delProfile(confirmDel)} v="danger">Delete</Btn>
          <Btn onClick={()=>setConfirmDel(null)} v="secondary">Cancel</Btn>
        </div>
      </div>
    </div>}

    {shareModal&&<InviteModal profile={shareModal} currentUser={firebaseUser} onClose={()=>{setShareModal(null);load();}} isMobile={isMobile}/>}

    <div style={{width:'100%',maxWidth:580}}>
      <div style={{textAlign:'center',marginBottom:32}}>
        <div style={{width:72,height:72,borderRadius:16,background:'#ffffff',border:'2px solid '+T.gold,display:'flex',alignItems:'center',justifyContent:'center',margin:'0 auto 14px',boxShadow:'0 0 40px rgba(249,115,22,0.2)'}}><span style={{fontSize:36}}>⚖</span></div>
        <h1 style={{fontFamily:FONT_HEAD,fontSize:28,color:'#1a1a2e',margin:'0 0 4px',letterSpacing:'0.08em'}}>SCREENING SOLUTIONS</h1>
        <p style={{color:'rgba(26,26,46,0.4)',fontSize:12,margin:'0 0 6px',letterSpacing:'0.08em',textTransform:'uppercase'}}>Welcome, {firebaseUser.displayName||firebaseUser.email}</p>
        <p style={{color:'rgba(26,26,46,0.25)',fontSize:11,margin:0,fontFamily:FONT_BODY}}>Select a profile or create a new one</p>
      </div>

      {/* Pending invites */}
      {invites.length>0&&<div style={{marginBottom:20}}>
        <h3 style={{color:T.gold,fontFamily:FONT_HEAD,fontSize:13,letterSpacing:'0.1em',margin:'0 0 10px',textTransform:'uppercase'}}>⏳ Pending Invites ({invites.length})</h3>
        {invites.map(inv=><div key={inv.id} style={{background:'rgba(249,115,22,0.06)',border:'2px solid rgba(249,115,22,0.25)',borderRadius:10,padding:'12px 16px',marginBottom:8,display:'flex',alignItems:'center',gap:12}}>
          <div style={{width:38,height:38,borderRadius:10,background:inv.profileColor||T.gold,display:'flex',alignItems:'center',justifyContent:'center',fontSize:13,fontWeight:900,color:'#000',fontFamily:FONT_HEAD,flexShrink:0}}>{initials(inv.profileName)}</div>
          <div style={{flex:1,minWidth:0}}><div style={{fontSize:14,fontWeight:800,color:'#1a1a2e',fontFamily:FONT_BODY}}>{inv.profileName}</div><div style={{fontSize:11,color:'rgba(26,26,46,0.4)',fontFamily:FONT_BODY}}>Invited by {inv.invitedByName}</div></div>
          <div style={{display:'flex',gap:6}}><Btn onClick={()=>acceptInv(inv)} v="success" size="sm"><CheckCircle2 size={12}/>Accept</Btn><Btn onClick={()=>declineInv(inv)} v="danger" size="sm">Decline</Btn></div>
        </div>)}
      </div>}

      {/* Profiles */}
      {loading?<div style={{textAlign:'center',color:'rgba(26,26,46,0.3)',padding:'32px 0',fontSize:13,fontFamily:FONT_BODY}}>Loading profiles…</div>:
        <div>
          {profiles.length===0&&!adding&&<div style={{textAlign:'center',padding:'32px 0',color:'rgba(26,26,46,0.3)',fontSize:13,fontFamily:FONT_BODY,lineHeight:1.8}}>No profiles yet.<br/>Create your first profile below.</div>}
          <div style={{display:'grid',gridTemplateColumns:isMobile?'1fr':'1fr 1fr',gap:10,marginBottom:14}}>
            {profiles.map(p=><div key={p.id} style={{position:'relative',borderRadius:12,border:'2px solid rgba(0,0,0,.07)',background:'#ffffff',transition:'all 0.15s'}} onMouseEnter={e=>{e.currentTarget.style.borderColor=p.color;e.currentTarget.style.background='#f9f7f5';}} onMouseLeave={e=>{e.currentTarget.style.borderColor='rgba(0,0,0,.07)';e.currentTarget.style.background='#ffffff';}}>
              <div onClick={()=>onSelect(p)} style={{padding:'16px 14px',display:'flex',alignItems:'center',gap:12,cursor:'pointer'}}>
                <div style={{width:46,height:46,borderRadius:11,background:p.color,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0,fontSize:14,fontWeight:900,color:'#000',fontFamily:FONT_HEAD}}>{initials(p.name)}</div>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:14,fontWeight:800,color:'#1a1a2e',fontFamily:FONT_HEAD,letterSpacing:'0.04em',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{p.name}</div>
                  <div style={{fontSize:10,color:'rgba(26,26,46,0.35)',fontFamily:FONT_BODY,marginTop:2,letterSpacing:'0.06em',textTransform:'uppercase'}}>{p.members?.length||1} member{(p.members?.length||1)>1?'s':''} · {isOwner(p)?'Owner':'Member'}</div>
                </div>
                <ChevronRight size={15} color="rgba(26,26,46,0.2)"/>
              </div>
              {/* Action buttons */}
              <div style={{padding:'0 14px 12px',display:'flex',gap:6}}>
                <Btn onClick={()=>setShareModal(p)} v="secondary" size="sm"><Send size={11}/>Share</Btn>
                {isOwner(p)&&<Btn onClick={()=>setConfirmDel(p)} v="danger" size="sm"><Trash2 size={11}/>Delete</Btn>}
              </div>
            </div>)}
          </div>
          {adding?(
            <div style={{background:'#ffffff',border:'2px solid '+T.gold,borderRadius:12,padding:18}}>
              <h4 style={{color:T.gold,fontFamily:FONT_HEAD,fontSize:13,margin:'0 0 12px',letterSpacing:'0.08em'}}>NEW PROFILE</h4>
              <input autoFocus placeholder="Profile name (e.g. Main Site, Warehouse, HR)" value={newName} onChange={e=>{setNewName(e.target.value);setErr('');}} onKeyDown={e=>e.key==='Enter'&&addProfile()} style={{width:'100%',boxSizing:'border-box',background:'#f9f7f5',border:'2px solid rgba(0,0,0,.12)',borderRadius:8,padding:'11px 14px',color:'#1a1a2e',fontSize:14,fontFamily:FONT_BODY,outline:'none',marginBottom:err?8:12}}/>
              {err&&<p style={{color:T.warn,fontSize:12,margin:'0 0 10px',fontFamily:FONT_BODY,fontWeight:700}}>{err}</p>}
              <div style={{display:'flex',gap:8}}><Btn onClick={addProfile} v="dark" style={{flex:1}}><Plus size={14}/>Create Profile</Btn><Btn onClick={()=>{setAdding(false);setNewName('');setErr('');}} v="ghost">Cancel</Btn></div>
            </div>
          ):(
            <Btn onClick={()=>setAdding(true)} v="dark" full size="lg"><Plus size={16}/>Create New Profile</Btn>
          )}
        </div>}
      <p style={{textAlign:'center',marginTop:20,fontSize:10,color:'rgba(26,26,46,0.15)',letterSpacing:'0.1em',textTransform:'uppercase',fontFamily:FONT_BODY}}>Each profile has independent data · Invite teammates via the Share button</p>
      <div style={{textAlign:'center',marginTop:14}}><span onClick={onLogout} style={{fontSize:11,color:'rgba(26,26,46,0.25)',cursor:'pointer',fontFamily:FONT_BODY,letterSpacing:'0.08em'}}>Sign out ({firebaseUser.email})</span></div>
    </div>
  </div>;
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
export default function ScreeningSolutionsApp({portalUser,onExit}={}){
  const[authPhase,setAuthPhase]=useState('splash'); // splash|login|register|picker|app
  const[firebaseUser,setFirebaseUser]=useState(null);
  const[activeProfile,setActiveProfile]=useState(null);
  const[splashDone,setSplashDone]=useState(false);
  const[dataReady,setDataReady]=useState(false);

  const[view,setView]=useState('dashboard');
  const[employees,setEmployees]=useState([]);
  const[screenings,setScreenings]=useState([]);
  const[schedulerConfig,setSchedulerConfig]=useState(DEFAULT_SCHED);
  const[emailConfig,setEmailConfig]=useState(DEFAULT_EMAIL);
  const[companySettings,setCompanySettings]=useState({logo:'',name:''});
  const[notif,setNotif]=useState(null);
  const[showTutorial,setShowTutorial]=useState(false);
  const[showDrawer,setShowDrawer]=useState(false);
  const[showDisclaimer,setShowDisclaimer]=useState(false);
  const[showTC,setShowTC]=useState(false);
  const[tick,setTick]=useState(0);
  const isMobile=useIsMobile();

  useEffect(()=>{const ms=portalUser?600:5000;const t=setTimeout(()=>setSplashDone(true),ms);return()=>clearTimeout(t);},[portalUser]);
  useEffect(()=>{const t=setInterval(()=>setTick(n=>n+1),1000);return()=>clearInterval(t);},[]);
  const notify=useCallback((msg,type='info')=>{setNotif({msg,type});setTimeout(()=>setNotif(null),5000);},[]);

  // Firebase auth listener (skipped in portal mode)
  useEffect(()=>{
    if(portalUser)return;
    return onAuthStateChanged(auth,(user)=>{
      if(user){setFirebaseUser(user);if(splashDone)setAuthPhase('picker');}
      else{setFirebaseUser(null);if(splashDone)setAuthPhase('login');}
    });
  },[splashDone,portalUser]);

  useEffect(()=>{
    if(!splashDone||portalUser)return;
    if(firebaseUser)setAuthPhase('picker');
    else setAuthPhase('login');
  },[splashDone,portalUser,firebaseUser]);

  const loadProfileData=useCallback(async(profile)=>{
    store.setProfile(profile.id);
    setDataReady(false);
    setActiveProfile(profile);
    try{
      const all = await ssLoadProfileDataDirect(profile.id);
      setEmployees(all.hr_employees||[]);
      setScreenings(all.hr_screenings||[]);
      setSchedulerConfig(all.hr_scheduler||DEFAULT_SCHED);
      setEmailConfig(all.hr_email_cfg||DEFAULT_EMAIL);
      setCompanySettings(all.hr_company||{logo:'',name:profile.name});
      if(firebaseUser&&firebaseUser.uid){
        const up=await getUserProfile(firebaseUser.uid);
        if(!up?.disclaimerSeen)setShowDisclaimer(true);
        if(!up?.tutorialSeen)setShowTutorial(true);
      }
    }catch(e){console.error('loadProfileData error',e);notify('Could not load profile data. Check connection.','error');}
    setDataReady(true);
    setView('dashboard');
    setAuthPhase('app');
  },[firebaseUser,notify]);

  const handleSelectProfile=useCallback((profile)=>{loadProfileData(profile);},[loadProfileData]);

  const handleSwitchProfile=useCallback(()=>{
    setAuthPhase('picker');setActiveProfile(null);setDataReady(false);
    setEmployees([]);setScreenings([]);setSchedulerConfig(DEFAULT_SCHED);
    setEmailConfig(DEFAULT_EMAIL);setCompanySettings({logo:'',name:''});
    setShowTutorial(false);setShowDisclaimer(false);setView('dashboard');
  },[]);

  const handleLogin=useCallback((user)=>{setFirebaseUser(user);if(splashDone)setAuthPhase('picker');},[splashDone]);
  const handleLogout=useCallback(async()=>{
    if(portalUser&&onExit){onExit();return;}
    await logoutUser();setFirebaseUser(null);setActiveProfile(null);setAuthPhase('login');
  },[portalUser,onExit]);

  // Portal-mode: auto-auth from portalUser + auto-load (or create) a single workspace
  useEffect(()=>{
    if(!portalUser||!splashDone)return;
    const email=(typeof portalUser==='string')?portalUser:(portalUser.email||portalUser.name||'portal@local');
    const name=(typeof portalUser==='string')?portalUser:(portalUser.name||portalUser.displayName||email);
    const uid='portal_'+String(email||'anon').replace(/[^a-z0-9]/gi,'_').toLowerCase();
    if(firebaseUser&&firebaseUser.uid===uid)return;
    const synth={uid,email,displayName:name};
    setFirebaseUser(synth);
    _ss_setUser(synth);
    (async()=>{
      let profs=await getMyProfiles(uid);
      if(profs.length===0){await createProfile(name||'Workspace','#f5c518',synth);profs=await getMyProfiles(uid);}
      const prof=profs[0];
      if(prof)loadProfileData(prof);
    })();
  },[portalUser,splashDone,firebaseUser,loadProfileData]);

  const acceptDisclaimer=async()=>{setShowDisclaimer(false);if(firebaseUser)await saveUserProfile(firebaseUser.uid,{disclaimerSeen:true});};
  const finishTutorial=async()=>{setShowTutorial(false);if(firebaseUser)await saveUserProfile(firebaseUser.uid,{tutorialSeen:true});};

  const saveEmployees=useCallback(async(d)=>{setEmployees(d);await store.set('hr_employees',d);},[]);
  const saveScreenings=useCallback(async(d)=>{setScreenings(d);await store.set('hr_screenings',d);},[]);
  const saveScheduler=useCallback(async(d)=>{setSchedulerConfig(d);await store.set('hr_scheduler',d);},[]);
  const saveEmailConfig=useCallback(async(d)=>{setEmailConfig(d);await store.set('hr_email_cfg',d);},[]);
  const saveCompanySettings=useCallback(async(d)=>{setCompanySettings(d);await store.set('hr_company',d);},[]);

  const handleExportProfile=useCallback(async()=>{
    if(!activeProfile)return;
    if(IS_ELECTRON&&window.electronAPI){
      const r=await window.electronAPI.profile.export(activeProfile.id,activeProfile.name);
      if(r.ok)notify('Exported: '+r.path);else if(r.error)notify('Export failed: '+r.error,'error');
    } else {
      // Browser download
      const data=await loadProfileData(activeProfile.id);
      const json=JSON.stringify({...data,_profileName:activeProfile.name,_exportDate:new Date().toISOString()},null,2);
      const a=document.createElement('a');a.href='data:application/json,'+encodeURIComponent(json);
      a.download='ScreeningSolutions_'+activeProfile.name+'_'+new Date().toISOString().split('T')[0]+'.json';a.click();
      notify('Profile exported.');
    }
  },[activeProfile,notify]);

  const handleExportProfileExcel=useCallback(async()=>{
    if(!activeProfile)return;
    const now=new Date();const wb=XLSX.utils.book_new();
    const empRows=employees.map(e=>({'Name':e.name,'Employee ID':e.id,'Job Title':e.title||'','Department':e.department||'','Position':e.position||'Staff','Management':e.isManagement?'Yes':'No','Exempt':e.isExempt?'Yes':'No','Notes':e.notes||'','Prescriptions':e.prescriptions||''}));
    XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(empRows.length?empRows:[{Note:'No employees'}]),'Employee Roster');
    const scRows=screenings.map(s=>({'Employee Name':s.employeeName,'Employee ID':s.employeeId,'Type':s.type==='random'?'Random Pick':(s.type||'').replace(/-/g,' '),'Date':fmtDT(s.pickedAt),'Result':s.result==='pass'?'PASS':s.result==='fail'?'FAIL':'Pending','Notes':s.resultNotes||'','Status':s.status,'Completed':fmtDT(s.completedAt),'By':s.completedBy||''}));
    XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(scRows.length?scRows:[{Note:'No screenings'}]),'All Screenings');
    const summ=[['Screening Solutions — '+activeProfile.name,''],['Generated',fmtDT(now.toISOString())],['Employees',employees.length],['Screenings',screenings.length],['Pass',screenings.filter(s=>s.result==='pass').length],['Fail',screenings.filter(s=>s.result==='fail').length]];
    XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(summ),'Summary');
    const filename='ScreeningSolutions_'+activeProfile.name+'_'+now.toISOString().split('T')[0]+'.xlsx';
    if(IS_ELECTRON&&window.electronAPI){
      const buf=XLSX.write(wb,{type:'base64',bookType:'xlsx'});
      const r=await window.electronAPI.profile.exportExcel(buf,filename);
      if(r.ok)notify('Excel exported: '+r.path);else if(r.error)notify('Export failed: '+r.error,'error');
    } else {
      XLSX.writeFile(wb,filename);notify('Excel exported.');
    }
  },[activeProfile,employees,screenings,notify]);

  const handleImportProfile=useCallback(async()=>{
    if(!activeProfile)return;
    if(IS_ELECTRON&&window.electronAPI){
      const r=await window.electronAPI.profile.import(activeProfile.id);
      if(r.ok){const d=r.data;if(d.hr_employees)await saveEmployees(d.hr_employees);if(d.hr_screenings)await saveScreenings(d.hr_screenings);if(d.hr_scheduler)await saveScheduler(d.hr_scheduler);if(d.hr_email_cfg)await saveEmailConfig(d.hr_email_cfg);if(d.hr_company)await saveCompanySettings(d.hr_company);notify('Profile imported and synced to cloud.');}
      else if(r.error)notify('Import failed: '+r.error,'error');
    } else {
      // Browser file picker
      const input=document.createElement('input');input.type='file';input.accept='.json';
      input.onchange=async(e)=>{const file=e.target.files[0];if(!file)return;const text=await file.text();try{const d=JSON.parse(text);if(d.hr_employees)await saveEmployees(d.hr_employees);if(d.hr_screenings)await saveScreenings(d.hr_screenings);if(d.hr_scheduler)await saveScheduler(d.hr_scheduler);if(d.hr_email_cfg)await saveEmailConfig(d.hr_email_cfg);if(d.hr_company)await saveCompanySettings(d.hr_company);notify('Profile imported.');}catch{notify('Invalid file.','error');}};
      input.click();
    }
  },[activeProfile,saveEmployees,saveScreenings,saveScheduler,saveEmailConfig,saveCompanySettings,notify]);

  const empRef=useRef(employees);empRef.current=employees;
  const scnRef=useRef(screenings);scnRef.current=screenings;
  const emRef=useRef(emailConfig);emRef.current=emailConfig;

  useEffect(()=>{
    if(!schedulerConfig.enabled||!schedulerConfig.nextPickAt||authPhase!=='app')return;
    const check=async()=>{const now=new Date();if(new Date(schedulerConfig.nextPickAt)>now)return;const pool=empRef.current.filter(e=>!e.isExempt);const scs=scnRef.current;if(pool.length===0)return;const idx=secureRand(pool.length);const emp=pool[idx];const warn=wasRecentPick(emp.id,scs);const s={id:uid(),employeeId:emp.id,employeeName:emp.name,pickedAt:now.toISOString(),status:'open',type:'random',result:'pending',recentWarn:warn,autoScheduled:true};const ns=[...scs,s];await saveScreenings(ns);const ms=schedulerConfig.intervalValue*INTERVAL_MS[schedulerConfig.intervalUnit];const nc={...schedulerConfig,nextPickAt:new Date(now.getTime()+ms).toISOString(),lastPickAt:now.toISOString()};await saveScheduler(nc);notify('Auto-pick: '+emp.name+' selected.');if(schedulerConfig.emailEnabled&&schedulerConfig.emailTo)sendEmail(emRef.current,schedulerConfig.emailTo,emp,now.toISOString(),true).then(ok=>{if(!ok)notify('Email failed.','warning');});};
    check();const t=setInterval(check,30000);return()=>clearInterval(t);
  },[schedulerConfig.enabled,schedulerConfig.nextPickAt,tick,authPhase]);

  if(authPhase==='splash') return <SplashScreen/>;
  if(authPhase==='login')    return <LoginScreen onLogin={handleLogin} onGoRegister={()=>setAuthPhase('register')}/>;
  if(authPhase==='register') return <RegisterScreen onLogin={handleLogin} onGoLogin={()=>setAuthPhase('login')}/>;
  if(authPhase==='picker')   return <ProfilePicker firebaseUser={firebaseUser} onSelect={handleSelectProfile} onLogout={handleLogout}/>;
  if(!dataReady) return <div style={{minHeight:'100vh',background:'#f5f2ee',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',fontFamily:FONT_HEAD,color:T.gold,gap:16}}><RefreshCw size={32} style={{animation:'spin 1s linear infinite'}}/><div style={{fontSize:16,letterSpacing:'0.1em'}}>SYNCING DATA…</div></div>;

  const user={id:firebaseUser.uid,username:firebaseUser.displayName||firebaseUser.email,displayName:firebaseUser.displayName||firebaseUser.email,email:firebaseUser.email,photoURL:firebaseUser.photoURL};
  const vp={employees,screenings,saveEmployees,saveScreenings,notify,emailConfig,schedulerConfig,saveScheduler,saveEmailConfig,companySettings,saveCompanySettings,setView,tick,handleExportProfile,handleExportProfileExcel,handleImportProfile,activeProfile};

  return <div style={{display:'flex',flexDirection:'column',height:'100vh',background:T.bg,fontFamily:FONT_BODY,color:T.text,overflow:'hidden'}}>
    <Notif n={notif}/>
    {showDisclaimer&&<DisclaimerModal onAccept={acceptDisclaimer}/>}
    {showTC&&<TCModal onClose={()=>setShowTC(false)} isMobile={isMobile}/>}
    {showTutorial&&!showDisclaimer&&<TutorialOverlay onFinish={finishTutorial} setView={(v)=>{setView(v);finishTutorial();}}/>}
    {showDrawer&&<MobileDrawer view={view} setView={setView} user={user} onLogout={handleSwitchProfile} onExit={onExit} onClose={()=>setShowDrawer(false)} schedulerOn={schedulerConfig.enabled} companyLogo={companySettings.logo} companyName={activeProfile?.name||companySettings.name}/>}
    <div style={{display:'flex',flex:1,overflow:'hidden'}}>
      {!isMobile&&<Sidebar view={view} setView={setView} user={user} onLogout={handleSwitchProfile} onExit={onExit} schedulerOn={schedulerConfig.enabled} companyLogo={companySettings.logo} companyName={activeProfile?.name||companySettings.name}/>}
      <div style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden'}}>
        {isMobile&&<MobileTopBar view={view} user={user} onMenu={()=>setShowDrawer(true)} schedulerOn={schedulerConfig.enabled} companyLogo={companySettings.logo}/>}
        {!isMobile&&<div style={{padding:'12px 24px',borderBottom:'2px solid '+T.border,background:'#fff',display:'flex',alignItems:'center',justifyContent:'space-between',flexShrink:0}}>
          <div style={{display:'flex',alignItems:'center',gap:10}}>
            {activeProfile&&<div style={{width:10,height:10,borderRadius:'50%',background:activeProfile.color,flexShrink:0}}/>}
            <div><h2 style={{margin:0,fontFamily:FONT_HEAD,fontSize:20,color:T.text,letterSpacing:'0.05em'}}>{NAV.find(n=>n.v===view)?.label?.toUpperCase()||'DASHBOARD'}</h2><p style={{margin:'1px 0 0',fontSize:11,color:T.muted,fontFamily:FONT_BODY}}>{activeProfile?.name} · {firebaseUser.displayName||firebaseUser.email} · {new Date().toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric',year:'numeric'})}</p></div>
          </div>
          <div style={{display:'flex',alignItems:'center',gap:8}}>
            <Btn onClick={handleExportProfile} v="secondary" size="sm"><Download size={12}/>Export JSON</Btn>
            <Btn onClick={handleExportProfileExcel} v="secondary" size="sm"><FileDown size={12}/>Export Excel</Btn>
            {schedulerConfig.enabled&&<div style={{display:'flex',alignItems:'center',gap:6,background:'#fffbeb',border:'2px solid '+T.gold,borderRadius:4,padding:'4px 10px'}}><div style={{width:6,height:6,borderRadius:'50%',background:T.goldD,animation:'pulse 2s infinite'}}/><span style={{fontSize:10,color:T.goldD,fontWeight:800,letterSpacing:'0.08em'}}>SCHEDULER ON</span></div>}
            <div style={{display:'flex',alignItems:'center',gap:4,background:'#f0fdf4',border:'1px solid #bbf7d0',borderRadius:4,padding:'4px 8px'}}><div style={{width:5,height:5,borderRadius:'50%',background:T.done}}/><span style={{fontSize:9,color:T.done,fontWeight:800,fontFamily:FONT_BODY,letterSpacing:'0.06em'}}>CLOUD SYNC</span></div>
            <Btn onClick={handleSwitchProfile} v="ghost" size="sm"><Users size={12}/>Profiles</Btn>
          </div>
        </div>}
        <div style={{flex:1,overflow:'auto',padding:isMobile?'14px 12px 80px':'20px 24px'}}>
          {view==='dashboard'&&<DashboardView {...vp}/>}
          {view==='employees'&&<EmployeesView {...vp}/>}
          {view==='picker'&&<PickerView {...vp}/>}
          {view==='drugtests'&&<DrugTestsView {...vp}/>}
          {view==='screenings'&&<ScreeningsView {...vp} user={user}/>}
          {view==='history'&&<HistoryView {...vp}/>}
          {view==='calendar'&&<CalendarView {...vp}/>}
          {view==='reports'&&<ReportsView {...vp}/>}
          {view==='settings'&&<SettingsView {...vp}/>}
          {view==='profile'&&<ProfileView user={user} companySettings={companySettings} saveCompanySettings={saveCompanySettings} notify={notify}/>}
        </div>
        {!isMobile&&<FinePrint onShowTC={()=>setShowTC(true)}/>}
        {isMobile&&<MobileBottomNav view={view} setView={setView} onMore={()=>setShowDrawer(true)}/>}
      </div>
    </div>
    <HelpBubble isMobile={isMobile}/>
    <style>{`
      @keyframes slideIn{from{transform:translateY(-8px);opacity:0}to{transform:none;opacity:1}}
      @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}
      @keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
      *{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
      ::-webkit-scrollbar{width:5px;height:5px}
      ::-webkit-scrollbar-track{background:#f0f0ec}
      ::-webkit-scrollbar-thumb{background:#ccc;border-radius:3px}
      select option{background:#fff;color:#111}
    `}</style>
  </div>;
}
