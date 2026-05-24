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

export function buildExecutionPlanHTML(params, computed, photos = {}) {
  const p = params;
  const r = computed;
  const ph = photos || {};
  const bgPhoto = (key) => ph[key] ? `style="background:#fff url('${ph[key]}') center/cover no-repeat"` : "";
  const c = BRAND.contact;
  const origin = (typeof window !== "undefined" && window.location && window.location.origin) || "";
  const LOGO = origin + "/logo.webp";
  const NAVY = "#16466e";
  const PEPCO = "Sunrise Construction Co & Development";
  const projName = p.projectName || "Solar Project";
  const footName = (p.projectName || "Project").toUpperCase() + " PEP";
  const prepName = p.preparedBy || c.name;
  const prepTitle = p.preparedByTitle || c.title;
  const num = (n) => Number(n || 0).toLocaleString();

  // ── carried-over rules / computed values ──
  const pileJourney = (p.pileGroundMan || 0) + (p.pileAdditionalLaborers || 0);
  const pileApp = Math.ceil(((p.pileAdditionalLaborers || 0) + (p.pileGroundMan || 0)) * (p.apprenticeReqPct || 0));
  const pileOps = (p.numExcavators || 0) + (p.pileSkidSteerOps || 0);
  const rackOps = (p.rackingTelehandlerOps || 0) + (p.rackingSkidSteerOps || 0);
  const peakCrew = Math.max(r.pileTotalStaff || 0, p.rackingTotalWorkers || 0, p.moduleTotalWorkers || 0);
  const fieldDays = (r.pileDaysToComplete || 0) + (r.rackingDaysToComplete || 0) + (r.moduleDaysToComplete || 0) + (r.qcWorkdays || 0);
  const totalDays = fieldDays + 7; // + mobilization (~4) and demobilization (~3)
  const addr = (c.address || "").split(",");
  const addr1 = (addr[0] || "").trim();
  const addr2 = (addr.slice(1).join(",") || "").trim();

  const styles = `
    @page { size: letter; margin: 0; }
    @media print { body { margin: 0; } }
    * { box-sizing: border-box; margin: 0; padding: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    body { font-family: 'Barlow Condensed', Arial, sans-serif; color: #1a1a2e; font-size: 11pt; line-height: 1.55; }
    .hd { font-family: 'Montserrat', Arial, sans-serif; font-weight: 800; }
    .page { position: relative; width: 8.5in; height: 11in; overflow: hidden; page-break-after: always; }
    .page:last-child { page-break-after: auto; }
    .stripes { position: absolute; inset: 0; pointer-events: none; background: linear-gradient(122deg, transparent 21%, #F6B600 21%, #F6B600 26%, transparent 26%, transparent 29.5%, #EE7B1A 29.5%, #EE7B1A 35%, transparent 35%); }
    /* cover */
    .cover { background: #ced1d6; }
    .cover .photo { position: absolute; inset: 0; background: linear-gradient(135deg,#eef0f2 0%,#c2c6cb 55%,#9aa0a8 100%); }
    .cover .navy { position: absolute; left: 0; right: 0; bottom: 0; height: 62%; background: ${NAVY}; clip-path: polygon(0% 20%, 100% 0%, 100% 100%, 0% 100%); }
    .cover .clogo { position: absolute; top: .55in; right: .6in; width: 175px; z-index: 4; }
    .cover .ctitle { position: absolute; left: .85in; bottom: 2.15in; color: #fff; font-size: 34pt; line-height: 1.04; letter-spacing: 2px; z-index: 4; }
    .cover .csub { position: absolute; left: .87in; bottom: 1.78in; width: 4.4in; color: #e6edf5; font-size: 10.5pt; letter-spacing: 2px; text-transform: uppercase; border-top: 1px solid rgba(255,255,255,.4); padding-top: 9px; z-index: 4; }
    .cover .cprep { position: absolute; left: .87in; bottom: .65in; color: #d3deea; font-size: 10pt; line-height: 1.5; z-index: 4; }
    /* toc */
    .toc { background: ${NAVY}; color: #fff; padding: 1in .9in 1in; }
    .toc .th { font-size: 24pt; letter-spacing: 2px; text-align: right; border-bottom: 2px solid rgba(255,255,255,.5); padding-bottom: 10px; margin-bottom: 26px; }
    .toc .row { display: flex; align-items: flex-end; font-size: 13pt; margin: 16px 0; color: #eef3f8; }
    .toc .row .lead { flex: 1; border-bottom: 1px dotted rgba(255,255,255,.5); margin: 0 8px 4px; }
    /* divider */
    .divider { background: #fff; }
    .divider .dtop { position: absolute; top: 0; left: 0; right: 0; height: 58%; background: linear-gradient(135deg,#eef0f2,#c4c8cd); }
    .divider .dlogo { position: absolute; top: .5in; right: .6in; width: 170px; z-index: 4; }
    .divider .dbot { position: absolute; left: 0; right: 0; bottom: 0; height: 42%; background: ${NAVY}; }
    .divider .dtitle { position: absolute; left: .8in; bottom: 1.0in; color: #fff; font-size: 27pt; letter-spacing: 2px; border-bottom: 2px solid rgba(255,255,255,.4); padding-bottom: 10px; }
    .divider .dco { position: absolute; left: .82in; bottom: .62in; color: #cfe0f0; font-size: 10pt; letter-spacing: 3px; text-transform: uppercase; }
    /* content */
    .content { background: #fff; padding: .85in .85in 1.0in; }
    .content .ch { font-size: 19pt; color: #1a1a2e; letter-spacing: .5px; }
    .content .ch:after { content: ""; display: block; width: 1.6in; height: 3px; background: #1a1a2e; margin-top: 8px; margin-bottom: 18px; }
    .content p { margin: 0 0 12px; max-width: 6.6in; }
    .content h3 { font-family: 'Montserrat',Arial,sans-serif; font-weight: 800; font-size: 12pt; color: ${NAVY}; margin: 18px 0 8px; }
    table { width: 100%; border-collapse: collapse; margin: 8px 0 14px; font-size: 10pt; }
    th { background: ${NAVY}; color: #fff; padding: 7px 10px; text-align: left; }
    td { padding: 6px 10px; border-bottom: 1px solid #e5e5e5; }
    tr:nth-child(even) td { background: #f7f8fa; }
    .right { text-align: right; }
    ul { padding-left: 20px; line-height: 1.9; }
    .foot { position: absolute; left: 0; right: 0; bottom: 0; height: .8in; background: #d7d9dd; display: flex; align-items: center; padding: 0 .55in; }
    .foot img { width: 60px; }
    .foot .fname { margin-left: 14px; font-size: 9.5pt; letter-spacing: 1px; color: #444; }
    .foot .fnum { margin-left: auto; font-size: 10pt; color: #444; }
    /* back cover */
    .back { background: #ced1d6; }
    .back .acc { position: absolute; top: 0; right: 0; width: 3.4in; height: 1.7in; background: ${NAVY}; clip-path: polygon(45% 0, 100% 0, 100% 100%); }
    .back .acc2 { position: absolute; top: 0; right: 0; width: 3.4in; height: 1.2in; background: #2f6ea0; clip-path: polygon(62% 0, 100% 0, 100% 100%); }
    .back .blogo { position: absolute; top: 42%; left: 50%; transform: translate(-50%,-50%); width: 250px; }
    .back .info { position: absolute; left: 0; right: 0; bottom: 1.3in; display: flex; justify-content: center; gap: 26px; }
    .back .info .col { font-size: 10pt; color: #2a2a33; line-height: 1.55; }
    .back .info .bar { width: 1px; background: #9aa0a8; }
  `;

  const divider = (n, t, key) => `
    <div class="page divider">
      <div class="dtop" ${bgPhoto(key)}></div>
      <img class="dlogo" src="${LOGO}">
      <div class="dbot"><div class="dtitle hd">${n} ${t}</div><div class="dco">${PEPCO.toUpperCase()}</div></div>
      <div class="stripes"></div>
    </div>`;

  const content = (title, pageNo, inner) => `
    <div class="page content">
      <h2 class="ch hd">${title}</h2>
      ${inner}
      <div class="foot"><img src="${LOGO}"><span class="fname">${footName}</span><span class="fnum">${pageNo}</span></div>
    </div>`;

  const staffTable = (jLbl, j, a, oLbl, o, total) => `
    <h3>Staffing</h3>
    <table><tr><th>Role</th><th class="right">Count</th></tr>
      <tr><td>Journeymen (${jLbl})</td><td class="right">${num(j)}</td></tr>
      <tr><td>Apprentices</td><td class="right">${num(a)}</td></tr>
      <tr><td>Operators (${oLbl})</td><td class="right">${num(o)}</td></tr>
      <tr><td><strong>Total Crew</strong></td><td class="right"><strong>${num(total)}</strong></td></tr>
    </table>`;

  const execInner = `
    <p><strong>${projName}</strong> is a <strong>${p.systemSizeMW || 0} MW DC</strong> utility-scale solar installation${p.projectLocation ? " located in " + p.projectLocation : ""}. This Project Execution Plan defines ${PEPCO}'s approach across material handling, pile driving, racking &amp; torque tube, module installation, equipment &amp; site support, and the assumed schedule, with embedded QA/QC and safety programs.</p>
    <table><tr><th>Summary</th><th class="right">Quantity</th></tr>
      <tr><td>Total Piles</td><td class="right">${num(r.totalPiles)}</td></tr>
      <tr><td>Racking / Torque Tube</td><td class="right">${num(r.linearFeetRacking)} LF</td></tr>
      <tr><td>Modules</td><td class="right">${num(r.moduleCount)}</td></tr>
      <tr><td>Estimated Field Duration</td><td class="right">${num(fieldDays)} work days</td></tr>
      <tr><td>Estimated Total Duration (incl. mob/demob)</td><td class="right">~${num(totalDays)} work days</td></tr>
      <tr><td>Peak Crew</td><td class="right">${num(peakCrew)}</td></tr>
      <tr><td>Apprentice Ratio (target ${fmtPct(p.apprenticeReqPct)})</td><td class="right">${fmtPct(r.apprenticePct)} ${r.apprenticeMet ? "✓" : "✕"}</td></tr>
    </table>`;

  const mhInner = `
    <p>Mobilization, deliveries, and material logistics for ${projName}. Equipment and crews mobilize from headquarters; materials are received, inventoried, and staged at the laydown yard, then released to the field in phase sequence.</p>
    <table><tr><th>Item</th><th class="right">Detail</th></tr>
      <tr><td>Distance from HQ</td><td class="right">${num(p.milesFromHQ)} mi</td></tr>
      <tr><td>Mobilization Duration</td><td class="right">3–5 days</td></tr>
      <tr><td>Rental Equipment Units</td><td class="right">${num(p.mobRentalEquipQty)}</td></tr>
      <tr><td>Company Trucks</td><td class="right">${num(p.mobCompanyTruckQty)}</td></tr>
      <tr><td>UTVs / Carts</td><td class="right">${num(p.gcCartsQty)}</td></tr>
    </table>`;

  const pileInner = `
    <p>Installation of ${num(r.totalPiles)} foundation piles using ${num(p.numExcavators)} pile-driving rigs/excavators.</p>
    <table><tr><th>Metric</th><th class="right">Value</th></tr>
      <tr><td>Total Piles</td><td class="right">${num(r.totalPiles)}</td></tr>
      <tr><td>Work Days</td><td class="right">${num(r.pileDaysToComplete)}</td></tr>
      <tr><td>Pile Drivers / Excavators</td><td class="right">${num(p.numExcavators)}</td></tr>
      <tr><td>Crew Total</td><td class="right">${num(r.pileTotalStaff)}</td></tr>
    </table>
    ${staffTable("ground + laborers", pileJourney, pileApp, "excavators + skid steer", pileOps, r.pileTotalStaff)}`;

  const rackInner = `
    <p>Installation of ${num(r.linearFeetRacking)} linear feet of racking and torque tube.</p>
    <table><tr><th>Metric</th><th class="right">Value</th></tr>
      <tr><td>Linear Feet</td><td class="right">${num(r.linearFeetRacking)} LF</td></tr>
      <tr><td>Work Days</td><td class="right">${num(r.rackingDaysToComplete)}</td></tr>
      <tr><td>Crew Total</td><td class="right">${num(p.rackingTotalWorkers)}</td></tr>
    </table>
    ${staffTable("general labor", p.rackingGeneralLabor, p.rackingGeneralLaborApp, "telehandler + skid steer", rackOps, p.rackingTotalWorkers)}`;

  const modInner = `
    <p>Installation of ${num(r.moduleCount)} PV modules.</p>
    <table><tr><th>Metric</th><th class="right">Value</th></tr>
      <tr><td>Modules</td><td class="right">${num(r.moduleCount)}</td></tr>
      <tr><td>Work Days</td><td class="right">${num(r.moduleDaysToComplete)}</td></tr>
      <tr><td>Crew Total</td><td class="right">${num(p.moduleTotalWorkers)}</td></tr>
    </table>
    ${staffTable("general labor", p.moduleGeneralLabor, p.moduleGeneralLaborApp, "skid steer", p.moduleSkidSteerOps, p.moduleTotalWorkers)}`;

  const equipInner = `
    <p>Equipment fleet and site support resources for the duration of the project.</p>
    <table><tr><th>Equipment</th><th class="right">Qty</th><th class="right">Daily Rate</th></tr>
      <tr><td>Pile Driver / Excavator</td><td class="right">${num(p.numExcavators)}</td><td class="right">${fmt(p.pileDriverEquipDaily)}</td></tr>
      <tr><td>Skid Steer</td><td class="right">${num((p.pileSkidSteerOps || 0) + (p.rackingSkidSteerOps || 0) + (p.moduleSkidSteerOps || 0))}</td><td class="right">${fmt(p.skidSteerEquipDaily)}</td></tr>
      <tr><td>Telehandler</td><td class="right">${num(p.rackingTelehandlerOps)}</td><td class="right">${fmt(p.telehandlerEquipDaily)}</td></tr>
      <tr><td>Company Trucks</td><td class="right">${num(p.mobCompanyTruckQty)}</td><td class="right">${fmt(p.companyTruckEquipDaily)}</td></tr>
      <tr><td>UTVs / Carts</td><td class="right">${num(p.gcCartsQty)}</td><td class="right">${fmt(p.gcCartsRate)}</td></tr>
    </table>
    <h3>Site Support &amp; Management</h3>
    <table><tr><th>Resource</th><th class="right">Detail</th></tr>
      <tr><td>Safety Coordinator</td><td class="right">${num(p.mgmtSafetyQty)} · on site ${fmtPct(p.mgmtPctOnSite)} of duration</td></tr>
      <tr><td>Laydown / Material Staging</td><td class="right">Managed on site</td></tr>
    </table>`;

  const schedInner = `
    <p>Assumed schedule by phase (work days). Sequence runs civil/mobilization → pile driving → racking &amp; torque tube → module installation → QA/QC → demobilization.</p>
    <table><tr><th>Phase</th><th class="right">Duration (work days)</th><th class="right">Crew</th></tr>
      <tr><td>1. Mobilization</td><td class="right">3–5</td><td class="right">—</td></tr>
      <tr><td>2. Pile Driving</td><td class="right">${num(r.pileDaysToComplete)}</td><td class="right">${num(r.pileTotalStaff)}</td></tr>
      <tr><td>3. Racking &amp; Torque Tube</td><td class="right">${num(r.rackingDaysToComplete)}</td><td class="right">${num(p.rackingTotalWorkers)}</td></tr>
      <tr><td>4. Module Installation</td><td class="right">${num(r.moduleDaysToComplete)}</td><td class="right">${num(p.moduleTotalWorkers)}</td></tr>
      <tr><td>5. QA/QC &amp; Punchlist</td><td class="right">${num(r.qcWorkdays)}</td><td class="right">${num(p.qcNumMen)}</td></tr>
      <tr><td>6. Demobilization</td><td class="right">2–3</td><td class="right">—</td></tr>
      <tr><td><strong>Estimated Total</strong></td><td class="right"><strong>~${num(totalDays)}</strong></td><td class="right">—</td></tr>
    </table>`;

  const qcInner = `
    <p>Quality assurance and control is embedded in every phase, with a dedicated punchlist program to closeout.</p>
    <table><tr><th>Metric</th><th class="right">Value</th></tr>
      <tr><td>Inspection Hours</td><td class="right">${num(r.qcTotalHours)}</td></tr>
      <tr><td>Work Days</td><td class="right">${num(r.qcWorkdays)}</td></tr>
      <tr><td>Inspectors</td><td class="right">${num(p.qcNumMen)}</td></tr>
    </table>
    <ul>
      <li>QA/QC inspectors embedded in each phase (pile plumb/embedment, racking torque, module fastening &amp; wiring)</li>
      <li>Daily inspection logs and non-conformance tracking</li>
      <li>Punchlist generation, resolution, and verification prior to substantial completion</li>
    </ul>`;

  const safetyInner = `
    <p>Safety and quality are the foundation of every ${PEPCO} project.</p>
    <ul>
      <li>Dedicated Safety Coordinator (${num(p.mgmtSafetyQty)}) on site ${fmtPct(p.mgmtPctOnSite)} of duration</li>
      <li>Daily toolbox talks and JHA reviews before each shift</li>
      <li>QA/QC inspectors embedded in each phase</li>
      <li>Apprentice ratio target: ${fmtPct(p.apprenticeReqPct)} — Current: ${fmtPct(r.apprenticePct)} ${r.apprenticeMet ? "✓ (met)" : "✕ (below target)"}</li>
    </ul>`;

  return `<!DOCTYPE html><html><head><meta charset="utf-8">
    <title>${PEPCO} — Project Execution Plan — ${projName}</title>
    <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@700;800&family=Barlow+Condensed:wght@400;600;700&display=swap" rel="stylesheet">
    <style>${styles}</style></head><body>

    <div class="page cover">
      <div class="photo" ${bgPhoto("cover")}></div>
      <div class="navy"></div>
      <div class="stripes"></div>
      <img class="clogo" src="${LOGO}">
      <div class="ctitle hd">PROJECT<br>EXECUTION PLAN</div>
      <div class="csub">${PEPCO}</div>
      <div class="cprep">Report Prepared By:<br>${prepName}<br>${prepTitle}<br>${PEPCO}<br>${fmtDate(p.bidDate)}</div>
    </div>

    <div class="page toc">
      <div class="th hd">TABLE OF CONTENTS:</div>
      ${[["Executive Summary", 1], ["I. Material Handling", 2], ["II. Pile Driving", 3], ["III. Racking", 4], ["IV. Module Installation", 5], ["V. Equipment & Site Support", 6], ["VI. Assumed Schedule", 7], ["VII. QA/QC & Punchlist", 8], ["VIII. Safety & Quality", 9]].map((x) => `<div class="row"><span>${x[0]}</span><span class="lead"></span><span>${x[1]}</span></div>`).join("")}
    </div>

    ${content("EXECUTIVE SUMMARY", 1, execInner)}
    ${divider("I.", "MATERIAL HANDLING", "mh")}
    ${content("MATERIAL HANDLING", 2, mhInner)}
    ${divider("II.", "PILE DRIVING", "pile")}
    ${content("PILE DRIVING", 3, pileInner)}
    ${divider("III.", "RACKING", "rack")}
    ${content("RACKING", 4, rackInner)}
    ${divider("IV.", "MODULE INSTALLATION", "mod")}
    ${content("MODULE INSTALLATION", 5, modInner)}
    ${divider("V.", "EQUIPMENT & SITE SUPPORT", "equip")}
    ${content("EQUIPMENT & SITE SUPPORT", 6, equipInner)}
    ${divider("VI.", "ASSUMED SCHEDULE", "sched")}
    ${content("ASSUMED SCHEDULE", 7, schedInner)}
    ${divider("VII.", "QA/QC & PUNCHLIST", "qaqc")}
    ${content("QA/QC & PUNCHLIST", 8, qcInner)}
    ${divider("VIII.", "SAFETY & QUALITY", "safety")}
    ${content("SAFETY & QUALITY", 9, safetyInner)}

    <div class="page back">
      <div class="acc"></div><div class="acc2"></div>
      <img class="blogo" src="${LOGO}">
      <div class="info">
        <div class="col">${PEPCO}<br>${c.phone}<br>${c.email}</div>
        <div class="bar"></div>
        <div class="col">${addr1}<br>${addr2}</div>
      </div>
      <div class="foot"><span class="fname">${footName}</span><span class="fnum">10</span></div>
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

export function exportExecutionPlan(params, computed, photos) {
  const html = buildExecutionPlanHTML(params, computed, photos || {});
  openInNewWindow(html, `${BRAND.shortName} — Execution Plan — ${params.projectName || "Project"}`);
}

// ─── PEP photo helper ────────────────────────────────────────────────
function fileToScaledDataURL(file, maxW = 1600) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        const scale = Math.min(1, maxW / img.width);
        const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
        const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
        cv.getContext("2d").drawImage(img, 0, 0, w, h);
        resolve(cv.toDataURL("image/jpeg", 0.82));
      } catch (e) { reject(e); }
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

const PEP_SECTIONS = [
  { key: "cover", label: "Cover" },
  { key: "mh", label: "I. Material Handling" },
  { key: "pile", label: "II. Pile Driving" },
  { key: "rack", label: "III. Racking" },
  { key: "mod", label: "IV. Module Installation" },
  { key: "equip", label: "V. Equipment & Site Support" },
  { key: "sched", label: "VI. Assumed Schedule" },
  { key: "qaqc", label: "VII. QA/QC & Punchlist" },
  { key: "safety", label: "VIII. Safety & Quality" },
];
const PEP_PAGES = 20;

// ─── PEP Builder (preview + background photos + export) ───────────────
function PepBuilder({ params, computed, onClose }) {
  const [photos, setPhotos] = React.useState({});
  const [scale, setScale] = React.useState(0.7);
  const [busyKey, setBusyKey] = React.useState(null);
  const paneRef = React.useRef(null);

  const html = React.useMemo(() => buildExecutionPlanHTML(params, computed, photos), [params, computed, photos]);

  React.useEffect(() => {
    const fit = () => { if (paneRef.current) setScale(Math.max(0.2, Math.min(1, (paneRef.current.clientWidth - 24) / 816))); };
    fit(); window.addEventListener("resize", fit); return () => window.removeEventListener("resize", fit);
  }, []);

  const upload = async (key, file) => {
    if (!file) return;
    setBusyKey(key);
    try { const url = await fileToScaledDataURL(file); setPhotos((p) => ({ ...p, [key]: url })); } catch (e) {}
    setBusyKey(null);
  };
  const clear = (key) => setPhotos((p) => { const n = { ...p }; delete n[key]; return n; });

  const ORANGE = "#F97316", NAVY = "#16466e", FB = "'Barlow Condensed', sans-serif";
  const mob = typeof window !== "undefined" && window.innerWidth < 768;

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 4000, background: "rgba(0,0,0,.6)", display: "flex", alignItems: "stretch", justifyContent: "center", padding: mob ? 0 : 20 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#0f1320", color: "#e8eaf0", width: "100%", maxWidth: 1100, display: "flex", flexDirection: "column", borderRadius: mob ? 0 : 10, overflow: "hidden", fontFamily: FB }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", background: "#0a0d18", borderBottom: "1px solid " + NAVY }}>
          <div style={{ fontWeight: 700, fontSize: 18, letterSpacing: 1 }}>PEP BUILDER <span style={{ color: ORANGE }}>— {(params.projectName || "Project")}</span></div>
          <button onClick={() => exportExecutionPlan(params, computed, photos)} style={{ marginLeft: "auto", background: ORANGE, color: "#1a1206", border: "none", padding: "9px 16px", fontFamily: FB, fontWeight: 700, fontSize: 13, letterSpacing: 1, textTransform: "uppercase", cursor: "pointer", borderRadius: 5 }}>Export / Print</button>
          <button onClick={onClose} style={{ background: "transparent", border: "none", color: "#9aa0b0", fontSize: 26, lineHeight: 1, cursor: "pointer" }}>&times;</button>
        </div>
        <div style={{ flex: 1, display: "flex", flexDirection: mob ? "column" : "row", minHeight: 0 }}>
          {/* controls */}
          <div style={{ width: mob ? "auto" : 320, flexShrink: 0, overflowY: "auto", padding: 14, borderRight: mob ? "none" : "1px solid " + NAVY, borderBottom: mob ? "1px solid " + NAVY : "none", maxHeight: mob ? "38vh" : "none" }}>
            <div style={{ fontSize: 12, letterSpacing: 2, textTransform: "uppercase", color: ORANGE, fontWeight: 700, marginBottom: 4 }}>Section Backgrounds</div>
            <div style={{ fontSize: 12, color: "#8a90a0", marginBottom: 12 }}>Add a photo to any divider/cover, or leave blank for the branded default.</div>
            {PEP_SECTIONS.map((s) => (
              <div key={s.key} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: "1px solid #1c2233" }}>
                <div style={{ width: 46, height: 34, flexShrink: 0, border: "1px solid #2a3147", background: photos[s.key] ? `#000 url('${photos[s.key]}') center/cover` : "linear-gradient(135deg,#e8eaec,#9aa0a8)", borderRadius: 3 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, color: "#e8eaf0", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.label}</div>
                  <div style={{ fontSize: 11, color: photos[s.key] ? "#22c55e" : "#6b7280" }}>{busyKey === s.key ? "loading…" : photos[s.key] ? "custom photo" : "default"}</div>
                </div>
                <label style={{ background: "transparent", color: ORANGE, border: "1px solid " + ORANGE, borderRadius: 4, padding: "4px 9px", fontSize: 11, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}>
                  {photos[s.key] ? "Change" : "Upload"}
                  <input type="file" accept="image/*" hidden onChange={(e) => upload(s.key, e.target.files[0])} />
                </label>
                {photos[s.key] && <button onClick={() => clear(s.key)} title="Remove" style={{ background: "transparent", border: "none", color: "#8a90a0", fontSize: 18, cursor: "pointer" }}>&times;</button>}
              </div>
            ))}
          </div>
          {/* preview */}
          <div ref={paneRef} style={{ flex: 1, overflow: "auto", background: "#2b2f3a", padding: 12 }}>
            <div style={{ width: 816 * scale, height: 1056 * PEP_PAGES * scale, margin: "0 auto", boxShadow: "0 4px 24px rgba(0,0,0,.5)" }}>
              <iframe title="PEP preview" srcDoc={html} style={{ width: 816, height: 1056 * PEP_PAGES, border: "none", background: "#fff", transform: `scale(${scale})`, transformOrigin: "top left" }} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── React Button Component ──────────────────────────────────────────

export default function BidExportButtons({ bid, computed }) {
  const params = bid || {};
  const r = computed || {};
  const [showPep, setShowPep] = React.useState(false);

  const btnBase = {
    display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 14px", borderRadius: 6,
    border: "1.5px solid #F9731644", background: "#F973160a", color: "#F97316", fontSize: 11, fontWeight: 700,
    cursor: "pointer", fontFamily: "'Barlow Condensed', sans-serif", letterSpacing: "0.5px", transition: "all .15s", whiteSpace: "nowrap",
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
        onClick={() => setShowPep(true)}
        onMouseEnter={(e) => { e.currentTarget.style.background = "#0F766E15"; e.currentTarget.style.borderColor = "#0F766E"; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = "#0F766E0a"; e.currentTarget.style.borderColor = "#0F766E44"; }}
        title="Open the PEP Builder — preview, add background photos, then export"
      >
        📋 Build PEP
      </button>
      {showPep && <PepBuilder params={params} computed={r} onClose={() => setShowPep(false)} />}
    </div>
  );
}
