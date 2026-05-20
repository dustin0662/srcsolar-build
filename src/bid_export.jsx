import React from "react";

// ═══════════════════════════════════════════════════════════════════════
//  BID EXPORT MODULE — Proposal & Execution Plan PDF generation
//  Sun Rise Construction and Development LLC
// ═══════════════════════════════════════════════════════════════════════

const BRAND = {
  company: "Sun Rise Construction and Development LLC",
  shortName: "Sun Rise Construction",
  tagline: "The Technical Powerhouse",
  orange: "#F97316",
  dark: "#1a1a2e",
  light: "#f5f2ee",
  contact: {
    name: "Kaleb LeBaron",
    title: "Business Development Manager",
    phone: "+1 (619) 870-4491",
    email: "Kaleb.LeBaron@sunriseconstructionco.com",
    address: "12856 N Hwy 183 Ste B PMB 2011, Austin TX 78750",
  },
  logoSvg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 40" width="120" height="40">
    <rect width="36" height="36" x="2" y="2" rx="4" fill="#F97316" stroke="#1a1a2e" stroke-width="1"/>
    <text x="20" y="28" font-family="Arial Black,sans-serif" font-size="22" fill="#fff" text-anchor="middle" font-weight="900">SRC</text>
    <text x="46" y="18" font-family="Arial Black,sans-serif" font-size="11" fill="#1a1a2e" font-weight="900">SUNRISE</text>
    <text x="46" y="30" font-family="Arial,sans-serif" font-size="7" fill="#666" letter-spacing="1">CONSTRUCTION &amp; DEVELOPMENT</text>
  </svg>`,
};

function fmt(n) { return "$" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 }); }
function fmtPct(n) { return (Number(n || 0) * 100).toFixed(1) + "%"; }
function fmtDec(n, d) { return Number(n || 0).toFixed(d || 2); }
function fmtDate(d) {
  if (!d) return new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  return new Date(d).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

// ─── Proposal PDF (14-page template) ─────────────────────────────────

function buildProposalHTML(params, computed) {
  const p = params;
  const r = computed;
  const c = BRAND.contact;
  const co = BRAND.company;

  const pageStyle = `
    @page { size: letter; margin: 0; }
    @media print { body { margin: 0; } .page-break { page-break-after: always; } }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Barlow Condensed', Arial, sans-serif; color: #1a1a2e; font-size: 11pt; line-height: 1.5; }
    .page { width: 8.5in; min-height: 11in; padding: 0.75in 0.85in; position: relative; }
    .page-break { page-break-after: always; }
    h1, h2, h3 { font-family: 'Black Ops One', 'Bebas Neue', Impact, sans-serif; color: #1a1a2e; letter-spacing: 2px; }
    h1 { font-size: 28pt; margin-bottom: 8px; }
    h2 { font-size: 18pt; margin: 20px 0 10px; border-bottom: 3px solid #F97316; padding-bottom: 6px; }
    h3 { font-size: 14pt; margin: 16px 0 8px; color: #F97316; }
    table { width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 10pt; }
    th { background: #1a1a2e; color: #fff; padding: 8px 10px; text-align: left; font-weight: 700; letter-spacing: 1px; }
    td { padding: 6px 10px; border-bottom: 1px solid #e5e5e5; }
    tr:nth-child(even) td { background: #fafaf8; }
    .accent { color: #F97316; font-weight: 700; }
    .right { text-align: right; }
    .total-row td { font-weight: 700; border-top: 2px solid #1a1a2e; background: #f5f2ee !important; }
    .header-bar { background: #1a1a2e; color: #fff; padding: 12px 20px; display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
    .header-bar .logo { font-family: 'Black Ops One', Impact, sans-serif; font-size: 14pt; letter-spacing: 3px; }
    .header-bar .date { font-size: 9pt; opacity: 0.7; }
    .orange-line { height: 4px; background: linear-gradient(90deg, #F97316, #F97316 60%, transparent); margin: 8px 0 16px; }
    .footer { position: absolute; bottom: 0.5in; left: 0.85in; right: 0.85in; font-size: 8pt; color: #999; display: flex; justify-content: space-between; border-top: 1px solid #e5e5e5; padding-top: 8px; }
    .kpi-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; margin: 16px 0; }
    .kpi-box { background: #f5f2ee; border-left: 4px solid #F97316; padding: 12px 16px; }
    .kpi-label { font-size: 9pt; color: #666; text-transform: uppercase; letter-spacing: 1px; }
    .kpi-value { font-size: 18pt; font-weight: 700; color: #1a1a2e; }
    .scope-row { display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid #eee; }
    .scope-row .label { font-weight: 600; }
    .scope-row .value { font-weight: 700; color: #1a1a2e; }
    .highlight-box { background: #F97316; color: #fff; padding: 20px 24px; margin: 16px 0; text-align: center; }
    .highlight-box .big { font-family: 'Black Ops One', Impact, sans-serif; font-size: 32pt; letter-spacing: 3px; }
    .highlight-box .sub { font-size: 11pt; opacity: 0.85; margin-top: 4px; }
  `;

  const headerBar = `<div class="header-bar"><div class="logo">${BRAND.shortName.toUpperCase()}</div><div class="date">${fmtDate(p.bidDate)}</div></div>`;
  const footer = (pg) => `<div class="footer"><span>${co} — Confidential</span><span>Page ${pg}</span></div>`;

  const pages = [];

  // PAGE 1 — Cover
  pages.push(`<div class="page" style="display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center;background:linear-gradient(180deg,#1a1a2e 0%,#1a1a2e 55%,#F97316 55%,#F97316 58%,#f5f2ee 58%);">
    <div style="flex:1;display:flex;flex-direction:column;justify-content:center;align-items:center">
      <div style="font-family:'Black Ops One',Impact,sans-serif;font-size:42pt;color:#fff;letter-spacing:6px;margin-bottom:8px">${BRAND.shortName.toUpperCase()}</div>
      <div style="font-size:11pt;color:rgba(255,255,255,.6);letter-spacing:4px;text-transform:uppercase;margin-bottom:40px">${BRAND.tagline}</div>
      <div style="width:120px;height:4px;background:#F97316;margin:24px auto"></div>
    </div>
    <div style="padding:40px 0">
      <div style="font-family:'Black Ops One',Impact,sans-serif;font-size:22pt;color:#1a1a2e;letter-spacing:3px;margin-bottom:8px">CONSTRUCTION PROPOSAL</div>
      <div style="font-size:16pt;color:#666;letter-spacing:2px">${p.projectName || "Solar Construction Project"}</div>
      <div style="font-size:12pt;color:#999;margin-top:8px">${p.projectLocation || ""}</div>
      <div style="font-size:11pt;color:#999;margin-top:16px">Prepared for: <strong style="color:#1a1a2e">${p.clientName || "Client"}</strong></div>
      <div style="font-size:10pt;color:#999;margin-top:4px">${fmtDate(p.bidDate)}</div>
    </div>
    ${footer(1)}
  </div>`);

  // PAGE 2 — Company Overview
  pages.push(`<div class="page">${headerBar}
    <h1>COMPANY OVERVIEW</h1><div class="orange-line"></div>
    <p>${co} is an elite solar subcontractor delivering dominance, precision, and efficiency for the nation's largest utility-scale solar projects. With 500+ MW of combined experience across 9 states and 1.2M+ modules placed, we bring unmatched technical capability to every project.</p>
    <h3>Core Capabilities</h3>
    <table><tr><th>Service</th><th>Description</th></tr>
      <tr><td>Pile Driving</td><td>High-volume steel pile installation with GPS-guided precision</td></tr>
      <tr><td>Racking & Torque Tube</td><td>Full tracker and fixed-tilt racking assembly and alignment</td></tr>
      <tr><td>Module Installation</td><td>PV module placement, clipping, and torquing at scale</td></tr>
      <tr><td>Material Handling</td><td>On-site logistics, staging, and equipment coordination</td></tr>
      <tr><td>QA/QC</td><td>Comprehensive quality assurance and inspection programs</td></tr>
    </table>
    <h3>Contact</h3>
    <p><strong>${c.name}</strong> — ${c.title}<br/>
    ${c.phone} · ${c.email}<br/>
    ${c.address}</p>
    ${footer(2)}
  </div>`);

  // PAGE 3 — Project Summary
  pages.push(`<div class="page">${headerBar}
    <h1>PROJECT SUMMARY</h1><div class="orange-line"></div>
    <div class="kpi-grid">
      <div class="kpi-box"><div class="kpi-label">System Size</div><div class="kpi-value">${p.systemSizeMW} MW DC</div></div>
      <div class="kpi-box"><div class="kpi-label">Total Modules</div><div class="kpi-value">${(r.moduleCount || 0).toLocaleString()}</div></div>
      <div class="kpi-box"><div class="kpi-label">Total Piles</div><div class="kpi-value">${(r.totalPiles || 0).toLocaleString()}</div></div>
      <div class="kpi-box"><div class="kpi-label">Linear Ft Racking</div><div class="kpi-value">${(r.linearFeetRacking || 0).toLocaleString()}</div></div>
      <div class="kpi-box"><div class="kpi-label">Total Man-Hours</div><div class="kpi-value">${(r.totalManHoursAll || 0).toLocaleString()}</div></div>
      <div class="kpi-box"><div class="kpi-label">MH per MW</div><div class="kpi-value">${fmtDec(r.manHoursPerMW, 0)}</div></div>
    </div>
    <table><tr><th>Parameter</th><th>Value</th></tr>
      <tr><td>Project Name</td><td class="accent">${p.projectName || "—"}</td></tr>
      <tr><td>Location</td><td>${p.projectLocation || "—"}</td></tr>
      <tr><td>Client</td><td>${p.clientName || "—"}</td></tr>
      <tr><td>Distance from HQ</td><td>${p.milesFromHQ} miles</td></tr>
      <tr><td>Work Schedule</td><td>${p.workdaysInWeek} days/week · ${p.workHoursPerDay} hrs/day</td></tr>
      <tr><td>Wage Type</td><td>${p.wageType}${p.wageType === "Prevailing Wage" ? " (" + fmtDec(p.pwMultiplier, 1) + "x)" : ""}</td></tr>
      <tr><td>Apprentice Requirement</td><td>${fmtPct(p.apprenticeReqPct)}</td></tr>
    </table>
    ${footer(3)}
  </div>`);

  // PAGE 4 — Total Bid Price
  pages.push(`<div class="page">${headerBar}
    <h1>BID PRICE</h1><div class="orange-line"></div>
    <div class="highlight-box">
      <div style="font-size:10pt;letter-spacing:3px;opacity:.7;margin-bottom:4px">TOTAL BID PRICE</div>
      <div class="big">${fmt(r.preBondTotal)}</div>
      <div class="sub">${fmtDec(r.dollarPerWatt * 100, 2)}¢/Wdc · ${p.systemSizeMW} MW DC</div>
    </div>
    <table><tr><th>Category</th><th class="right">Amount</th><th class="right">% of Total</th></tr>
      <tr><td>Pile Driving</td><td class="right">${fmt(r.pileScopeTotal)}</td><td class="right">${fmtPct(r.pileScopeTotal / r.subtotalCost)}</td></tr>
      <tr><td>Racking / Torque Tube</td><td class="right">${fmt(r.rackingScopeTotal)}</td><td class="right">${fmtPct(r.rackingScopeTotal / r.subtotalCost)}</td></tr>
      <tr><td>Module Installation</td><td class="right">${fmt(r.moduleScopeTotal)}</td><td class="right">${fmtPct(r.moduleScopeTotal / r.subtotalCost)}</td></tr>
      <tr><td>QA/QC</td><td class="right">${fmt(r.qcScopeTotal)}</td><td class="right">${fmtPct(r.qcScopeTotal / r.subtotalCost)}</td></tr>
      <tr><td>Material Handling</td><td class="right">${fmt(r.matHandlScopeTotal)}</td><td class="right">${fmtPct(r.matHandlScopeTotal / r.subtotalCost)}</td></tr>
      <tr><td>General Conditions</td><td class="right">${fmt(r.gcTotalCost)}</td><td class="right">${fmtPct(r.gcTotalCost / r.subtotalCost)}</td></tr>
      <tr><td>Management</td><td class="right">${fmt(r.mgmtTotalCost)}</td><td class="right">${fmtPct(r.mgmtTotalCost / r.subtotalCost)}</td></tr>
      <tr><td>Mobilization</td><td class="right">${fmt(r.mobTotalCost)}</td><td class="right">${fmtPct(r.mobTotalCost / r.subtotalCost)}</td></tr>
      <tr><td>Waste Management</td><td class="right">${fmt(r.wasteTotal)}</td><td class="right">${fmtPct(r.wasteTotal / r.subtotalCost)}</td></tr>
      <tr class="total-row"><td>Subtotal</td><td class="right">${fmt(r.subtotalCost)}</td><td class="right">100%</td></tr>
    </table>
    <table><tr><th>Financials</th><th class="right">Rate</th><th class="right">Amount</th></tr>
      <tr><td>Contingency</td><td class="right">${fmtPct(p.contingencyPct)}</td><td class="right">${fmt(r.contingencyAmt)}</td></tr>
      <tr><td>Subtotal + Contingency</td><td></td><td class="right">${fmt(r.subtotalWithContingency)}</td></tr>
      <tr><td>Markup</td><td class="right">${fmtPct(p.markupPct)}</td><td class="right">${fmt(r.markupAmt)}</td></tr>
      <tr class="total-row"><td>Pre-Bond Total</td><td></td><td class="right">${fmt(r.preBondTotal)}</td></tr>
      <tr><td>Bond</td><td class="right">${fmtPct(p.bondPct)}</td><td class="right">${fmt(r.bondAmt)}</td></tr>
      <tr class="total-row"><td>Post-Bond Total</td><td></td><td class="right">${fmt(r.postBondTotal)}</td></tr>
    </table>
    ${footer(4)}
  </div>`);

  // PAGE 5 — Pile Driving Scope
  pages.push(`<div class="page">${headerBar}
    <h1>PILE DRIVING</h1><div class="orange-line"></div>
    <div class="kpi-grid">
      <div class="kpi-box"><div class="kpi-label">Total Piles</div><div class="kpi-value">${(r.totalPiles || 0).toLocaleString()}</div></div>
      <div class="kpi-box"><div class="kpi-label">Work Days</div><div class="kpi-value">${r.pileDaysToComplete}</div></div>
      <div class="kpi-box"><div class="kpi-label">Man-Hours</div><div class="kpi-value">${(r.pileTotalManHours || 0).toLocaleString()}</div></div>
    </div>
    <table><tr><th>Pile Breakdown</th><th class="right">Quantity</th></tr>
      <tr><td>Racking Piles</td><td class="right">${(p.rackingPiles || 0).toLocaleString()}</td></tr>
      <tr><td>Inverter Piles</td><td class="right">${(p.inverterPiles || 0).toLocaleString()}</td></tr>
      <tr><td>CAB Piles</td><td class="right">${(p.cabPiles || 0).toLocaleString()}</td></tr>
      <tr><td>Combiner Box Piles</td><td class="right">${(p.combinerBoxPiles || 0).toLocaleString()}</td></tr>
      <tr><td>Load Break Piles</td><td class="right">${(p.loadBreakPiles || 0).toLocaleString()}</td></tr>
      <tr class="total-row"><td>Total</td><td class="right">${(r.totalPiles || 0).toLocaleString()}</td></tr>
    </table>
    <table><tr><th>Cost Component</th><th class="right">Amount</th></tr>
      <tr><td>Labor</td><td class="right">${fmt(r.pileLaborCost)}</td></tr>
      <tr><td>Per Diem</td><td class="right">${fmt(r.pilePerDiemCost)}</td></tr>
      <tr><td>Equipment Rental</td><td class="right">${fmt(r.pileEquipRental)}</td></tr>
      <tr><td>Fuel</td><td class="right">${fmt(r.pileFuelCost)}</td></tr>
      <tr class="total-row"><td>Pile Driving Total</td><td class="right">${fmt(r.pileScopeTotal)}</td></tr>
    </table>
    <p style="font-size:9pt;color:#999;margin-top:8px">Piles/day/machine: ${fmtDec(r.pilesPerDayPerMachine, 1)} · Excavators: ${p.numExcavators} · Calendar days: ${r.pileCalendarDays}</p>
    ${footer(5)}
  </div>`);

  // PAGE 6 — Racking Scope
  pages.push(`<div class="page">${headerBar}
    <h1>RACKING & TORQUE TUBE</h1><div class="orange-line"></div>
    <div class="kpi-grid">
      <div class="kpi-box"><div class="kpi-label">Linear Feet</div><div class="kpi-value">${(r.linearFeetRacking || 0).toLocaleString()}</div></div>
      <div class="kpi-box"><div class="kpi-label">Work Days</div><div class="kpi-value">${r.rackingDaysToComplete}</div></div>
      <div class="kpi-box"><div class="kpi-label">Man-Hours</div><div class="kpi-value">${(r.rackingManHours || 0).toLocaleString()}</div></div>
    </div>
    <table><tr><th>Cost Component</th><th class="right">Amount</th></tr>
      <tr><td>Labor</td><td class="right">${fmt(r.rackingLaborCost)}</td></tr>
      <tr><td>Per Diem</td><td class="right">${fmt(r.rackingPerDiemCost)}</td></tr>
      <tr><td>Equipment Rental</td><td class="right">${fmt(r.rackingEquipRental)}</td></tr>
      <tr><td>Fuel</td><td class="right">${fmt(r.rackingFuelCost)}</td></tr>
      <tr class="total-row"><td>Racking Total</td><td class="right">${fmt(r.rackingScopeTotal)}</td></tr>
    </table>
    <p style="font-size:9pt;color:#999;margin-top:8px">Workers: ${p.rackingTotalWorkers} (${p.rackingGeneralLabor} journeymen + ${p.rackingGeneralLaborApp} apprentice + ${p.rackingTelehandlerOps} telehandler + ${p.rackingSkidSteerOps} skid steer) · Calendar days: ${r.rackingCalendarDays}</p>
    ${footer(6)}
  </div>`);

  // PAGE 7 — Module Installation
  pages.push(`<div class="page">${headerBar}
    <h1>MODULE INSTALLATION</h1><div class="orange-line"></div>
    <div class="kpi-grid">
      <div class="kpi-box"><div class="kpi-label">Total Modules</div><div class="kpi-value">${(r.moduleCount || 0).toLocaleString()}</div></div>
      <div class="kpi-box"><div class="kpi-label">Work Days</div><div class="kpi-value">${r.moduleDaysToComplete}</div></div>
      <div class="kpi-box"><div class="kpi-label">Man-Hours</div><div class="kpi-value">${(r.moduleManHours || 0).toLocaleString()}</div></div>
    </div>
    <table><tr><th>Cost Component</th><th class="right">Amount</th></tr>
      <tr><td>Labor</td><td class="right">${fmt(r.moduleLaborCost)}</td></tr>
      <tr><td>Per Diem</td><td class="right">${fmt(r.modulePerDiemCost)}</td></tr>
      <tr><td>Equipment Rental</td><td class="right">${fmt(r.moduleEquipRental)}</td></tr>
      <tr><td>Fuel</td><td class="right">${fmt(r.moduleFuelCost)}</td></tr>
      <tr class="total-row"><td>Module Total</td><td class="right">${fmt(r.moduleScopeTotal)}</td></tr>
    </table>
    <p style="font-size:9pt;color:#999;margin-top:8px">Workers: ${p.moduleTotalWorkers} · Modules/hr/man: ${p.modulesPerHourPerMan} · Calendar days: ${r.moduleCalendarDays}</p>
    ${footer(7)}
  </div>`);

  // PAGE 8 — QA/QC
  pages.push(`<div class="page">${headerBar}
    <h1>QA/QC PROGRAM</h1><div class="orange-line"></div>
    <div class="kpi-grid">
      <div class="kpi-box"><div class="kpi-label">QC Hours</div><div class="kpi-value">${(r.qcTotalHours || 0).toLocaleString()}</div></div>
      <div class="kpi-box"><div class="kpi-label">Work Days</div><div class="kpi-value">${r.qcWorkdays}</div></div>
      <div class="kpi-box"><div class="kpi-label">Man-Hours</div><div class="kpi-value">${(r.qcManHours || 0).toLocaleString()}</div></div>
    </div>
    <table><tr><th>Inspection Area</th><th class="right">Hours</th></tr>
      <tr><td>Pile Inspection</td><td class="right">${r.qcPileHours}</td></tr>
      <tr><td>Racking Inspection</td><td class="right">${r.qcRackingHours}</td></tr>
      <tr><td>Module Inspection</td><td class="right">${r.qcModuleHours}</td></tr>
      <tr class="total-row"><td>Total QC Hours</td><td class="right">${r.qcTotalHours}</td></tr>
    </table>
    <table><tr><th>Cost Component</th><th class="right">Amount</th></tr>
      <tr><td>Labor (${p.qcNumMen} inspectors)</td><td class="right">${fmt(r.qcLaborCost)}</td></tr>
      <tr><td>Per Diem</td><td class="right">${fmt(r.qcPerDiemCost)}</td></tr>
      <tr class="total-row"><td>QA/QC Total</td><td class="right">${fmt(r.qcScopeTotal)}</td></tr>
    </table>
    ${footer(8)}
  </div>`);

  // PAGE 9 — Material Handling
  pages.push(`<div class="page">${headerBar}
    <h1>MATERIAL HANDLING</h1><div class="orange-line"></div>
    <div class="kpi-grid">
      <div class="kpi-box"><div class="kpi-label">Crew Size</div><div class="kpi-value">${p.matHandlCrewSize}</div></div>
      <div class="kpi-box"><div class="kpi-label">Work Days</div><div class="kpi-value">${r.matHandlWorkDays}</div></div>
      <div class="kpi-box"><div class="kpi-label">Man-Hours</div><div class="kpi-value">${(r.matHandlManHours || 0).toLocaleString()}</div></div>
    </div>
    <table><tr><th>Cost Component</th><th class="right">Amount</th></tr>
      <tr><td>Labor</td><td class="right">${fmt(r.matHandlLaborCost)}</td></tr>
      <tr><td>Per Diem</td><td class="right">${fmt(r.matHandlPerDiemCost)}</td></tr>
      <tr><td>Equipment Rental</td><td class="right">${fmt(r.matHandlEquipRental)}</td></tr>
      <tr><td>Fuel</td><td class="right">${fmt(r.matHandlFuelCost)}</td></tr>
      <tr class="total-row"><td>Material Handling Total</td><td class="right">${fmt(r.matHandlScopeTotal)}</td></tr>
    </table>
    ${footer(9)}
  </div>`);

  // PAGE 10 — General Conditions
  pages.push(`<div class="page">${headerBar}
    <h1>GENERAL CONDITIONS</h1><div class="orange-line"></div>
    <table><tr><th>Item</th><th class="right">Amount</th></tr>
      <tr><td>Carts / UTVs (${p.gcCartsQty} units)</td><td class="right">${fmt(r.cartsUtvCost)}</td></tr>
      <tr><td>Cart/UTV Fuel</td><td class="right">${fmt(r.cartsUtvFuelCost)}</td></tr>
      <tr><td>Maintenance</td><td class="right">${fmt(r.maintenanceCost)}</td></tr>
      <tr><td>Sanitary (${p.gcSanitaryQty} units)</td><td class="right">${fmt(r.sanitaryCost)}</td></tr>
      <tr><td>Safety</td><td class="right">${fmt(r.safetyCost)}</td></tr>
      <tr><td>Site Office</td><td class="right">${fmt(r.siteOfficeCost)}</td></tr>
      <tr><td>Small Tools</td><td class="right">${fmt(r.smallToolsCost)}</td></tr>
      <tr><td>Fuel Delivery</td><td class="right">${fmt(r.fuelDeliveryCost)}</td></tr>
      <tr><td>Pile Survey</td><td class="right">${fmt(r.pileSurveyCost)}</td></tr>
      <tr><td>Additional Mob/Survey</td><td class="right">${fmt(r.addlMobSurveyCost)}</td></tr>
      <tr><td>Twist Bars</td><td class="right">${fmt(r.twistBarsCost)}</td></tr>
      <tr><td>Payroll Processing</td><td class="right">${fmt(r.payrollCost)}</td></tr>
      <tr class="total-row"><td>General Conditions Total</td><td class="right">${fmt(r.gcTotalCost)}</td></tr>
    </table>
    ${footer(10)}
  </div>`);

  // PAGE 11 — Management & Mobilization
  pages.push(`<div class="page">${headerBar}
    <h1>MANAGEMENT & MOBILIZATION</h1><div class="orange-line"></div>
    <h2>Management</h2>
    <table><tr><th>Role</th><th class="right">Amount</th></tr>
      <tr><td>Superintendent (${p.mgmtSuperQty})</td><td class="right">${fmt(r.mgmtSuperCost)}</td></tr>
      <tr><td>Foreman (${p.mgmtForemanQty})</td><td class="right">${fmt(r.mgmtForemanCost)}</td></tr>
      <tr><td>Safety (${p.mgmtSafetyQty})</td><td class="right">${fmt(r.mgmtSafetyCost)}</td></tr>
      <tr class="total-row"><td>Management Total</td><td class="right">${fmt(r.mgmtTotalCost)}</td></tr>
    </table>
    <h2>Mobilization</h2>
    <table><tr><th>Item</th><th class="right">Amount</th></tr>
      <tr><td>Company Trucks</td><td class="right">${fmt(r.mobCompanyTruckCost)}</td></tr>
      <tr><td>Trailers</td><td class="right">${fmt(r.mobTrailerCost)}</td></tr>
      <tr><td>Rental Equipment</td><td class="right">${fmt(r.mobRentalEquipCost)}</td></tr>
      <tr><td>Labor</td><td class="right">${fmt(r.mobLaborCost)}</td></tr>
      <tr><td>Per Diem</td><td class="right">${fmt(r.mobPerDiemCost)}</td></tr>
      <tr class="total-row"><td>Mobilization Total</td><td class="right">${fmt(r.mobTotalCost)}</td></tr>
    </table>
    ${footer(11)}
  </div>`);

  // PAGE 12 — Schedule Overview
  pages.push(`<div class="page">${headerBar}
    <h1>PROJECT SCHEDULE</h1><div class="orange-line"></div>
    <div class="kpi-grid">
      <div class="kpi-box"><div class="kpi-label">Calendar Days</div><div class="kpi-value">${r.totalCalendarDays}</div></div>
      <div class="kpi-box"><div class="kpi-label">Work Days</div><div class="kpi-value">${r.totalWorkDays}</div></div>
      <div class="kpi-box"><div class="kpi-label">Est. Months</div><div class="kpi-value">${fmtDec(r.totalMonths, 1)}</div></div>
    </div>
    <table><tr><th>Phase</th><th class="right">Work Days</th><th class="right">Calendar Days</th><th class="right">Man-Hours</th></tr>
      <tr><td>Pile Driving</td><td class="right">${r.pileDaysToComplete}</td><td class="right">${r.pileCalendarDays}</td><td class="right">${(r.pileTotalManHours || 0).toLocaleString()}</td></tr>
      <tr><td>Racking</td><td class="right">${r.rackingDaysToComplete}</td><td class="right">${r.rackingCalendarDays}</td><td class="right">${(r.rackingManHours || 0).toLocaleString()}</td></tr>
      <tr><td>Module Installation</td><td class="right">${r.moduleDaysToComplete}</td><td class="right">${r.moduleCalendarDays}</td><td class="right">${(r.moduleManHours || 0).toLocaleString()}</td></tr>
      <tr><td>QA/QC</td><td class="right">${r.qcWorkdays}</td><td class="right">${r.qcCalendarDays}</td><td class="right">${(r.qcManHours || 0).toLocaleString()}</td></tr>
      <tr><td>Material Handling</td><td class="right">${r.matHandlWorkDays}</td><td class="right">${r.matHandlCalendarDays}</td><td class="right">${(r.matHandlManHours || 0).toLocaleString()}</td></tr>
      <tr class="total-row"><td>Total (w/ buffer)</td><td class="right">${r.totalWorkDays}</td><td class="right">${r.totalCalendarDays}</td><td class="right">${(r.totalManHoursAll || 0).toLocaleString()}</td></tr>
    </table>
    <h3>Apprentice Compliance</h3>
    <div style="display:flex;gap:16px;align-items:center;margin:8px 0">
      <div class="kpi-box" style="flex:1;border-left-color:${r.apprenticeMet ? "#16a34a" : "#dc2626"}">
        <div class="kpi-label">Apprentice Ratio</div>
        <div class="kpi-value" style="color:${r.apprenticeMet ? "#16a34a" : "#dc2626"}">${fmtPct(r.apprenticePct)}</div>
      </div>
      <div class="kpi-box" style="flex:1">
        <div class="kpi-label">Required</div>
        <div class="kpi-value">${fmtPct(p.apprenticeReqPct)}</div>
      </div>
      <div class="kpi-box" style="flex:1;border-left-color:${r.apprenticeMet ? "#16a34a" : "#dc2626"}">
        <div class="kpi-label">Status</div>
        <div class="kpi-value" style="font-size:14pt;color:${r.apprenticeMet ? "#16a34a" : "#dc2626"}">${r.apprenticeMet ? "COMPLIANT ✓" : "NON-COMPLIANT ✕"}</div>
      </div>
    </div>
    ${footer(12)}
  </div>`);

  // PAGE 13 — Labor Rate Summary
  pages.push(`<div class="page">${headerBar}
    <h1>LABOR RATES</h1><div class="orange-line"></div>
    <table><tr><th>Role</th><th class="right">Hourly</th><th class="right">Daily (${p.workHoursPerDay}hr)</th></tr>
      <tr><td>General Labor (Journeyman)</td><td class="right">${fmt(r.generalLaborHourlyRate)}/hr</td><td class="right">${fmt(r.generalLaborDayRate)}</td></tr>
      <tr><td>General Labor (Apprentice)</td><td class="right">${fmt(r.generalLaborAppHourlyRate)}/hr</td><td class="right">${fmt(r.generalLaborAppDayRate)}</td></tr>
      <tr><td>Telehandler Operator</td><td class="right">${fmt(r.telehandlerOpHourlyRate)}/hr</td><td class="right">${fmt(r.telehandlerOpDayRate)}</td></tr>
      <tr><td>Pile Driver Operator</td><td class="right">${fmt(r.pileDriverOpHourlyRate)}/hr</td><td class="right">${fmt(r.pileDriverOpDayRate)}</td></tr>
      <tr><td>Skid Steer Operator</td><td class="right">${fmt(r.skidSteerOpHourlyRate)}/hr</td><td class="right">${fmt(r.skidSteerOpDayRate)}</td></tr>
      <tr><td>Admin</td><td class="right">${fmt(r.adminHourlyRate)}/hr</td><td class="right">${fmt(r.adminDayRate)}</td></tr>
    </table>
    <h3>Payroll Burden</h3>
    <table><tr><th>Component</th><th class="right">Rate</th></tr>
      <tr><td>FICA/SS</td><td class="right">${fmtPct(p.ficaSS)}</td></tr>
      <tr><td>Medicare</td><td class="right">${fmtPct(p.medical)}</td></tr>
      <tr><td>FUTA</td><td class="right">${fmtPct(p.futa)}</td></tr>
      <tr><td>SUTA</td><td class="right">${fmtPct(p.suta)}</td></tr>
      <tr><td>Workers Comp</td><td class="right">${fmtPct(p.workersComp)}</td></tr>
      <tr><td>Umbrella</td><td class="right">${fmtPct(p.umbrella)}</td></tr>
      <tr><td>Gen Liability</td><td class="right">${fmtPct(p.genLiability)}</td></tr>
      <tr><td>Payroll Service</td><td class="right">${fmtPct(p.payrollService)}</td></tr>
      <tr class="total-row"><td>Total Burden</td><td class="right">${fmtPct(r.payrollTaxPct)}</td></tr>
    </table>
    ${footer(13)}
  </div>`);

  // PAGE 14 — Terms & Signature
  pages.push(`<div class="page">${headerBar}
    <h1>TERMS & CONDITIONS</h1><div class="orange-line"></div>
    <h3>Scope of Work</h3>
    <p>This proposal covers the mechanical installation scope for the ${p.projectName || "project"} (${p.systemSizeMW} MW DC) located in ${p.projectLocation || "TBD"}. Work includes pile driving, racking/torque tube installation, PV module placement, QA/QC, and associated material handling.</p>
    <h3>Assumptions & Exclusions</h3>
    <ul style="padding-left:20px;margin:8px 0;font-size:10pt;line-height:1.8">
      <li>Site access roads and laydown area provided by owner/GC</li>
      <li>Civil and grading work completed prior to mobilization</li>
      <li>Materials delivered to site by others unless specified</li>
      <li>Electrical scope (wiring, inverters, transformers) not included</li>
      <li>Price valid for 60 days from date of proposal</li>
      <li>Schedule assumes ${p.workdaysInWeek}-day work week, ${p.workHoursPerDay}-hour days</li>
    </ul>
    <h3>Payment Terms</h3>
    <p>Net 30 from date of invoice. Progress billing monthly based on installed quantities. Retainage per contract terms.</p>
    <div style="margin-top:32px;display:grid;grid-template-columns:1fr 1fr;gap:40px">
      <div>
        <p style="font-weight:700;margin-bottom:24px">${co}</p>
        <div style="border-bottom:1px solid #333;margin-bottom:4px;height:40px"></div>
        <p style="font-size:9pt;color:#666">${c.name}, ${c.title}</p>
        <div style="border-bottom:1px solid #333;margin-bottom:4px;height:30px;margin-top:16px"></div>
        <p style="font-size:9pt;color:#666">Date</p>
      </div>
      <div>
        <p style="font-weight:700;margin-bottom:24px">${p.clientName || "Client"}</p>
        <div style="border-bottom:1px solid #333;margin-bottom:4px;height:40px"></div>
        <p style="font-size:9pt;color:#666">Authorized Representative</p>
        <div style="border-bottom:1px solid #333;margin-bottom:4px;height:30px;margin-top:16px"></div>
        <p style="font-size:9pt;color:#666">Date</p>
      </div>
    </div>
    ${footer(14)}
  </div>`);

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${co} — Proposal — ${p.projectName || "Project"}</title>
    <link href="https://fonts.googleapis.com/css2?family=Black+Ops+One&family=Barlow+Condensed:wght@400;600;700&display=swap" rel="stylesheet">
    <style>${pageStyle}</style></head><body>${pages.join('<div class="page-break"></div>')}</body></html>`;
}

// ─── Execution Plan ──────────────────────────────────────────────────

function buildExecutionPlanHTML(params, computed) {
  const p = params;
  const r = computed;
  const c = BRAND.contact;
  const co = BRAND.company;

  const pageStyle = `
    @page { size: letter; margin: 0.6in 0.75in; }
    @media print { body { margin: 0; } }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Barlow Condensed', Arial, sans-serif; color: #1a1a2e; font-size: 11pt; line-height: 1.6; }
    h1 { font-family: 'Black Ops One', Impact, sans-serif; font-size: 24pt; letter-spacing: 3px; color: #1a1a2e; border-bottom: 3px solid #F97316; padding-bottom: 6px; margin-bottom: 16px; }
    h2 { font-family: 'Black Ops One', Impact, sans-serif; font-size: 16pt; color: #F97316; margin: 20px 0 10px; }
    table { width: 100%; border-collapse: collapse; margin: 10px 0; font-size: 10pt; }
    th { background: #1a1a2e; color: #fff; padding: 6px 10px; text-align: left; }
    td { padding: 5px 10px; border-bottom: 1px solid #e5e5e5; }
    .right { text-align: right; }
    .phase-box { background: #f5f2ee; border-left: 4px solid #F97316; padding: 12px 16px; margin: 8px 0; }
    .phase-title { font-family: 'Black Ops One', Impact, sans-serif; font-size: 13pt; letter-spacing: 2px; }
    .phase-detail { font-size: 10pt; color: #666; margin-top: 4px; }
    .header { display: flex; justify-content: space-between; align-items: center; padding-bottom: 12px; border-bottom: 2px solid #1a1a2e; margin-bottom: 20px; }
    .header .logo { font-family: 'Black Ops One', Impact, sans-serif; font-size: 14pt; letter-spacing: 3px; }
    .gantt-bar { height: 18px; border-radius: 3px; margin: 2px 0; }
  `;

  return `<!DOCTYPE html><html><head><meta charset="utf-8">
    <title>${co} — Execution Plan — ${p.projectName || "Project"}</title>
    <link href="https://fonts.googleapis.com/css2?family=Black+Ops+One&family=Barlow+Condensed:wght@400;600;700&display=swap" rel="stylesheet">
    <style>${pageStyle}</style></head><body>
    <div class="header"><div class="logo">${BRAND.shortName.toUpperCase()}</div><div>${fmtDate(p.bidDate)}</div></div>
    <h1>EXECUTION PLAN</h1>
    <p style="font-size:12pt;margin-bottom:16px"><strong>${p.projectName || "Solar Project"}</strong> — ${p.projectLocation || ""} — ${p.systemSizeMW} MW DC</p>

    <h2>PHASE TIMELINE</h2>
    <div class="phase-box"><div class="phase-title">1. MOBILIZATION</div><div class="phase-detail">Duration: 3-5 days · ${p.milesFromHQ} mi from HQ · ${p.mobRentalEquipQty} equipment units</div></div>
    <div class="phase-box"><div class="phase-title">2. PILE DRIVING</div><div class="phase-detail">${r.totalPiles.toLocaleString()} piles · ${r.pileDaysToComplete} work days · ${r.pileTotalStaff} crew · ${p.numExcavators} excavators</div></div>
    <div class="phase-box"><div class="phase-title">3. RACKING & TORQUE TUBE</div><div class="phase-detail">${(r.linearFeetRacking || 0).toLocaleString()} LF · ${r.rackingDaysToComplete} work days · ${p.rackingTotalWorkers} crew</div></div>
    <div class="phase-box"><div class="phase-title">4. MODULE INSTALLATION</div><div class="phase-detail">${r.moduleCount.toLocaleString()} modules · ${r.moduleDaysToComplete} work days · ${p.moduleTotalWorkers} crew</div></div>
    <div class="phase-box"><div class="phase-title">5. QA/QC & PUNCHLIST</div><div class="phase-detail">${r.qcTotalHours} inspection hours · ${r.qcWorkdays} work days · ${p.qcNumMen} inspectors</div></div>
    <div class="phase-box"><div class="phase-title">6. DEMOBILIZATION</div><div class="phase-detail">Equipment breakdown and site restoration · 2-3 days</div></div>

    <h2>STAFFING PLAN</h2>
    <table><tr><th>Phase</th><th class="right">Journeymen</th><th class="right">Apprentices</th><th class="right">Operators</th><th class="right">Total</th></tr>
      <tr><td>Pile Driving</td><td class="right">${p.pileGroundMan + p.pileAdditionalLaborers}</td><td class="right">${Math.ceil((p.pileAdditionalLaborers + p.pileGroundMan) * p.apprenticeReqPct)}</td><td class="right">${p.numExcavators + p.pileSkidSteerOps}</td><td class="right">${r.pileTotalStaff}</td></tr>
      <tr><td>Racking</td><td class="right">${p.rackingGeneralLabor}</td><td class="right">${p.rackingGeneralLaborApp}</td><td class="right">${p.rackingTelehandlerOps + p.rackingSkidSteerOps}</td><td class="right">${p.rackingTotalWorkers}</td></tr>
      <tr><td>Modules</td><td class="right">${p.moduleGeneralLabor}</td><td class="right">${p.moduleGeneralLaborApp}</td><td class="right">${p.moduleSkidSteerOps}</td><td class="right">${p.moduleTotalWorkers}</td></tr>
    </table>

    <h2>EQUIPMENT LIST</h2>
    <table><tr><th>Equipment</th><th class="right">Qty</th><th class="right">Daily Rate</th></tr>
      <tr><td>Pile Driver / Excavator</td><td class="right">${p.numExcavators}</td><td class="right">${fmt(p.pileDriverEquipDaily)}</td></tr>
      <tr><td>Skid Steer</td><td class="right">${p.pileSkidSteerOps + p.rackingSkidSteerOps + p.moduleSkidSteerOps}</td><td class="right">${fmt(p.skidSteerEquipDaily)}</td></tr>
      <tr><td>Telehandler</td><td class="right">${p.rackingTelehandlerOps}</td><td class="right">${fmt(p.telehandlerEquipDaily)}</td></tr>
      <tr><td>Company Trucks</td><td class="right">${p.mobCompanyTruckQty}</td><td class="right">${fmt(p.companyTruckEquipDaily)}</td></tr>
      <tr><td>UTVs / Carts</td><td class="right">${p.gcCartsQty}</td><td class="right">${fmt(p.gcCartsRate)}</td></tr>
    </table>

    <h2>SAFETY & QUALITY</h2>
    <ul style="padding-left:20px;line-height:2">
      <li>Dedicated Safety Coordinator (${p.mgmtSafetyQty}) on site ${fmtPct(p.mgmtPctOnSite)} of duration</li>
      <li>Daily toolbox talks and JHA reviews</li>
      <li>QA/QC inspectors embedded in each phase</li>
      <li>Apprentice ratio target: ${fmtPct(p.apprenticeReqPct)} — Current: ${fmtPct(r.apprenticePct)} ${r.apprenticeMet ? "✓" : "✕"}</li>
    </ul>

    <div style="margin-top:24px;padding:16px;background:#1a1a2e;color:#fff;text-align:center">
      <div style="font-family:'Black Ops One',Impact,sans-serif;font-size:14pt;letter-spacing:3px;margin-bottom:4px">${BRAND.shortName.toUpperCase()}</div>
      <div style="font-size:9pt;opacity:.7">${c.name} · ${c.phone} · ${c.email}</div>
    </div>
  </body></html>`;
}

// ─── Export Functions ─────────────────────────────────────────────────

function openInNewWindow(html, title) {
  const win = window.open("", "_blank", "width=900,height=700");
  if (!win) { alert("Pop-up blocked. Please allow pop-ups for this site."); return; }
  win.document.write(html);
  win.document.close();
  win.document.title = title;
}

export function exportBidProposal(params, computed) {
  const html = buildProposalHTML(params, computed);
  openInNewWindow(html, `${BRAND.shortName} — Proposal — ${params.projectName || "Project"}`);
}

export function exportExecutionPlan(params, computed) {
  const html = buildExecutionPlanHTML(params, computed);
  openInNewWindow(html, `${BRAND.shortName} — Execution Plan — ${params.projectName || "Project"}`);
}

// ─── React Button Component ──────────────────────────────────────────

export default function BidExportButtons({ bid, computed }) {
  const params = bid || {};
  const r = computed || {};

  const btnBase = {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "7px 14px",
    borderRadius: 6,
    border: "1.5px solid #F9731644",
    background: "#F973160a",
    color: "#F97316",
    fontSize: 11,
    fontWeight: 700,
    cursor: "pointer",
    fontFamily: "'Barlow Condensed', sans-serif",
    letterSpacing: "0.5px",
    transition: "all .15s",
    whiteSpace: "nowrap",
  };

  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      <button
        style={btnBase}
        onClick={() => exportBidProposal(params, r)}
        onMouseEnter={(e) => { e.currentTarget.style.background = "#F9731615"; e.currentTarget.style.borderColor = "#F97316"; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = "#F973160a"; e.currentTarget.style.borderColor = "#F9731644"; }}
        title="Generate 14-page Sun Rise proposal PDF"
      >
        📄 Proposal
      </button>
      <button
        style={{ ...btnBase, color: "#0F766E", borderColor: "#0F766E44", background: "#0F766E0a" }}
        onClick={() => exportExecutionPlan(params, r)}
        onMouseEnter={(e) => { e.currentTarget.style.background = "#0F766E15"; e.currentTarget.style.borderColor = "#0F766E"; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = "#0F766E0a"; e.currentTarget.style.borderColor = "#0F766E44"; }}
        title="Generate execution plan with staffing and timeline"
      >
        📋 Execution Plan
      </button>
    </div>
  );
}
