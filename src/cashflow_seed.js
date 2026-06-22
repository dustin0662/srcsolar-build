// Seed cash-flow projection — every entry transcribed from
// "Sunrise Construction — Cash Flow Projection" (Business Plan Rev 1, May 3 2026).
// The summary rows (deposit amount, cumulative spent, remaining balance) are all
// DERIVED from these line items at render time, so editing a line keeps them in sync.

const N = 10; // months: May '26 … Feb '27

// helpers to build a 10-month value array
const zeros = () => new Array(N).fill(0);
const at = (i, v) => { const a = zeros(); a[i] = v; return a; };          // one month only
const all = (v) => new Array(N).fill(v);                                  // every month
const from = (start, v) => { const a = zeros(); for (let i = start; i < N; i++) a[i] = v; return a; }; // start month → Feb

let _id = 0;
const id = () => 'seed_' + (++_id);
const item = (name, notes, values, deferred = false) => ({ id: id(), name, notes, values, deferred });

export const MONTHS = ["May '26", "Jun '26", "Jul '26", "Aug '26", "Sep '26", "Oct '26", "Nov '26", "Dec '26", "Jan '27", "Feb '27"];
export const DEPOSIT_DATES = ['05/22/26', '06/22/26', '07/22/26', '08/22/26', '09/22/26', '10/22/26', '11/22/26', '12/22/26', '01/22/27', '02/22/27'];

export function seedDoc() {
  return {
    title: 'Sunrise Construction — Cash Flow Projection',
    subtitle: 'Budget Deposits — Preconstruction, Compliance, Startup Costs & ACP Houston',
    meta: "First Deposit: 5/22/2026 | Monthly on 22nd | $200K Starting Capital | Capital exhausted February 2027",
    confidential: 'CONFIDENTIAL — For Internal Use Only',
    source: 'All figures are estimates. Source: Sunrise Construction Business Plan Rev 1 — May 3, 2026. CONFIDENTIAL — Members Only',
    months: MONTHS.slice(),
    depositDates: DEPOSIT_DATES.slice(),
    startingCapital: 200000,
    rev: 0,
    savedAt: 0,
    sections: [
      {
        id: id(), name: 'PRECONSTRUCTION & ESTIMATING',
        subsections: [
          {
            id: id(), name: 'ONE-TIME SETUP',
            items: [
              item('Workstation, Monitors, Desk', 'Estimating setup', at(0, 1500)),
              item('Estimating Software', 'Bluebeam/PlanSwift', at(0, 500)),
              item('Takeoff & BIM', 'AutoCAD LT', at(0, 400)),
              item('PM Platform', 'Procore/Buildertrend', at(0, 300)),
              item('Reference Library', 'NEC, OSHA, NABCEP', at(0, 150)),
              item('Printer / Plotter', 'Large-format', at(0, 150)),
            ],
          },
          {
            id: id(), name: 'MONTHLY RECURRING',
            items: [
              item('Estimator Salary', '$80K/yr', all(6667)),
              item('Software Subscriptions', 'Bluebeam, PM, takeoff', all(400)),
              item('Plan Rooms & Bid Boards', 'Dodge, iSqFt, etc.', all(75)),
              item('Office Supplies & Printing', 'Paper, toner, plans', all(150)),
              item('Professional Development', 'Conferences, CE', all(300)),
            ],
          },
        ],
      },
      {
        id: id(), name: 'COMPLIANCE & ADMINISTRATION',
        subsections: [
          {
            id: id(), name: 'ONE-TIME SETUP',
            items: [
              item('Office Setup', 'Initial buildout', at(0, 3000)),
              item('Legal — Entity & Contracts', 'Operating agreements', at(0, 2000)),
              item('Insurance Setup', 'Broker fees, review', at(0, 500)),
              item('ISNetworld (Annual + Setup)', 'Deferred to Jun', at(1, 1500), true),
              item('RAPIDS Registration', 'Deferred to Jun', at(1, 500), true),
              item('Apprenticeship Program Dev', 'Deferred to Jun', at(1, 1500), true),
              item('State Contractor Licensing', 'Deferred to Jun', at(1, 1500), true),
              item('Safety Program Dev', 'Deferred to Jun', at(1, 1000), true),
              item('Federal Compliance (SAM)', 'Deferred to Jun', at(1, 250), true),
              item('Drug & Alcohol Testing', 'Deferred to Jun', at(1, 250), true),
            ],
          },
          {
            id: id(), name: 'MONTHLY RECURRING',
            items: [
              item('Compliance Officer Salary', '$100K/yr', all(8333)),
              item('Legal Retainer', 'Deferred to Jun', from(1, 1000), true),
              item('Accounting / Bookkeeping', 'QB, payroll, cert', all(300)),
              item('ISNetworld Maintenance', 'Doc updates, renewals', all(100)),
              item('Office Supplies & Admin', 'Printing, postage', all(500)),
            ],
          },
        ],
      },
      {
        id: id(), name: 'MARKETING & BIZ DEV',
        subsections: [
          {
            id: id(), name: 'ONE-TIME STARTUP',
            items: [
              item('Google Ads (Initial)', '$500/mo recurring', at(1, 500)),
              item('Website & Admin', 'Domain, hosting, SSL', at(1, 200)),
              item('Additional Networking', 'Regional event', at(1, 1000)),
              item('Business Cards', 'Team set', at(1, 300)),
              item('Social Media', 'LinkedIn, boosted posts', at(1, 150)),
              item('CRM Setup', 'Deferred to Jun', at(1, 1150), true),
            ],
          },
          {
            id: id(), name: 'MONTHLY RECURRING',
            items: [
              item('Google Ads', 'Paid search', from(1, 500)),
              item('Website & Admin', 'Maintenance, SEO', from(1, 200)),
              item('Social Media', 'Project photos', from(1, 100)),
              item('CRM & Email', 'Pipeline mgmt', from(1, 50)),
              item('Networking & Travel', 'Local events', from(1, 150)),
            ],
          },
        ],
      },
      {
        id: id(), name: 'ACP CLEANPOWER — HOUSTON (JUN 1–4, 2026)',
        subsections: [
          {
            id: id(), name: 'CONFERENCE COSTS',
            items: [
              item('Conference Tickets (2)', '$1,089/ea', at(0, 2178)),
              item('Travel', 'Joseph & Kaleb driving', at(0, 200)),
              item('Hotels (4 nights)', '$200/nt × 5 budgeted', at(0, 1000)),
              item('Food (4 days × 3 people)', '$70/person/day', at(0, 840)),
              item('Business Cards', 'Standard for team', at(0, 500)),
            ],
          },
        ],
      },
    ],
  };
}
