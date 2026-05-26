import { chromium } from 'playwright';
const items = [
  {id:'c1',kind:'career',name:'Alice Diaz',email:'alice@x.com',phone:'(555) 111-2222',position:'Pile Crew Lead',experience:'5-9',status:'New',submittedAt:new Date('2026-05-22T10:00:00').toISOString(),message:'5 years pile driving'},
  {id:'c2',kind:'career',name:'Bob Khan',email:'bob@y.com',phone:'(555) 333-4444',position:'Electrician',experience:'10+',status:'Contacted',submittedAt:new Date('2026-05-24T09:00:00').toISOString(),message:'10+ years',log:[{ts:Date.now()-3600000,action:'submitted'},{ts:Date.now(),action:'status → Contacted',by:'Admin'}]},
  {id:'c3',kind:'career',name:'Carla Mendez',email:'carla@z.com',phone:'(555) 555-6666',position:'Pile Crew Lead',experience:'2-4',status:'New',submittedAt:new Date('2026-05-25T11:00:00').toISOString(),message:''},
  {id:'p1',kind:'partner',firstName:'Dana',lastName:'Lee',company:'BigEPC',email:'dana@bigepc.com',status:'New',submittedAt:new Date('2026-05-25T08:00:00').toISOString(),details:'50MW solar in TX'},
];
let store = items.slice();
const browser=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',args:['--use-gl=swiftshader','--no-sandbox']});
const page=await browser.newPage(); const errs=[];
page.on('pageerror',e=>errs.push('PAGE: '+e.message));
page.on('console',m=>{if(m.type()==='error')errs.push('CON: '+m.text())});
page.on('download',d=>{console.log('download:',d.suggestedFilename())});
await page.route('**/.netlify/functions/submissions*',(route)=>{ const req=route.request(); if(req.method()==='POST'){let b={};try{b=JSON.parse(req.postData()||'{}')}catch(e){} const u=new URL(req.url()); if(u.searchParams.get('update')){store=store.map(x=>x.id===b.id?Object.assign({},x,b.patch,{log:(x.log||[]).concat([{ts:Date.now(),action:b.patch.status?'status → '+b.patch.status:'updated',by:b.by||''}])}):x);} return route.fulfill({json:{ok:true,rev:1}})} return route.fulfill({json:{items:store,rev:1}}); });
await page.route('**/.netlify/functions/activity*',(route)=>route.fulfill({json:{events:[],days:[]}}));
await page.addInitScript(()=>{ function pHash(s){var h=5381;for(var i=0;i<s.length;i++){h=((h<<5)+h)+s.charCodeAt(i);h=h&h}return Math.abs(h).toString(36)} const admin={id:'a1',name:'Admin',email:'dustin.hanson@sunriseconstructionco.com',role:'admin',tools:['crm','admin'],passwordHash:pHash('admin123'),createdAt:new Date().toISOString()}; const mem={portal_users:[admin]}; window.storage={get:async(k)=>{const v=localStorage.getItem('st_'+k);if(v!=null)return{value:v};if(mem[k]!=null)return{value:JSON.stringify(mem[k])};return null;},set:async(k,v)=>localStorage.setItem('st_'+k,v),delete:async(k)=>localStorage.removeItem('st_'+k),list:async()=>({keys:[]})}; });
await page.goto('http://localhost:4178/',{waitUntil:'networkidle'});
await page.waitForTimeout(500);
// language gate visible?
const txt0=await page.evaluate(()=>document.body.innerText);
console.log('lang gate visible:', /Choose Your Language/i.test(txt0) && /Elija Su Idioma/i.test(txt0));
// pick Spanish
await page.evaluate(()=>{ const e=[...document.querySelectorAll('button')].find(b=>/Español/i.test(b.textContent||'')); if(e) e.click(); });
await page.waitForTimeout(5000);
const txt1=await page.evaluate(()=>document.body.innerText);
console.log('Spanish hero:', /DOMINAMOS/.test(txt1) && /Subcontratista Solar de Élite/i.test(txt1));
console.log('Spanish nav:', /SEGURIDAD/i.test(txt1) && /PORTAFOLIO/i.test(txt1));
console.log('Spanish portfolio:', /PORTAFOLIO DE PROYECTOS DEL EQUIPO/i.test(txt1));
console.log('Spanish careers:', /CONSTRUYE CON NOSOTROS/i.test(txt1));
await page.screenshot({path:'/tmp/lang-es.png',fullPage:false});
// switch back to English via toggle
await page.evaluate(()=>{ const e=[...document.querySelectorAll('div')].find(b=>(b.textContent||'').trim()==='ES · EN'); if(e) e.click(); });
await page.waitForTimeout(800);
const txt2=await page.evaluate(()=>document.body.innerText);
console.log('English nav after toggle:', /SAFETY/i.test(txt2) && /CAPABILITIES/i.test(txt2));
console.log('English hero:', /DOMINATE/.test(txt2));
// now login + CRM
await page.evaluate(()=>{ const e=[...document.querySelectorAll('*')].find(x=>x.children.length===0&&/login/i.test(x.textContent||'')); if(e) e.click(); });
await page.waitForTimeout(500);
await (await page.$('input')).fill('dustin.hanson@sunriseconstructionco.com');
await (await page.$('input[type="password"]')).fill('admin123');
await page.evaluate(()=>{ const e=[...document.querySelectorAll('*')].find(x=>x.children.length===0&&/^sign in$/i.test((x.textContent||'').trim())); if(e) e.click(); });
await page.waitForTimeout(1200);
await page.evaluate(()=>{ const e=[...document.querySelectorAll('*')].find(x=>x.children.length===0&&/^CRM$/i.test((x.textContent||'').trim())); if(e){ const launch=[...e.closest('div').parentElement.querySelectorAll('*')].find(z=>/launch/i.test(z.textContent||'')&&z.children.length===0); (launch||e).click(); } });
await page.waitForTimeout(1500);
const ctxt=await page.evaluate(()=>document.body.innerText);
console.log('CRM loaded:', /CRM/.test(ctxt));
console.log('Applicants count visible:', /Applicants Looking For Work \(3\)/.test(ctxt) && /Clients Reaching Out \(1\)/.test(ctxt));
console.log('First applicant (most recent):', /Carla Mendez/.test(ctxt));
// sort by name A→Z
await page.selectOption('select', {value:'name_asc'}).catch(()=>{});
await page.waitForTimeout(400);
// filter by status "Contacted"
const selects = await page.$$('select');
if (selects[1]) await selects[1].selectOption('Contacted').catch(()=>{});
await page.waitForTimeout(400);
const ctxt2=await page.evaluate(()=>document.body.innerText);
console.log('filter by Contacted (only Bob):', /Bob Khan/.test(ctxt2) && !/Alice Diaz/.test(ctxt2) && !/Carla Mendez/.test(ctxt2));
// clear filters
await page.evaluate(()=>{ const e=[...document.querySelectorAll('*')].find(x=>x.children.length===0&&/clear filters/i.test(x.textContent||'')); if(e) e.click(); });
await page.waitForTimeout(400);
// click export PDF
const pdfDl = page.waitForEvent('download', {timeout: 5000}).catch(()=>null);
await page.evaluate(()=>{ const e=[...document.querySelectorAll('button')].find(b=>/export pdf/i.test(b.textContent||'')); if(e) e.click(); });
const dl1 = await pdfDl;
console.log('PDF download:', dl1 ? dl1.suggestedFilename() : 'none');
// click export Excel
const xlsDl = page.waitForEvent('download', {timeout: 5000}).catch(()=>null);
await page.evaluate(()=>{ const e=[...document.querySelectorAll('button')].find(b=>/export excel/i.test(b.textContent||'')); if(e) e.click(); });
const dl2 = await xlsDl;
console.log('Excel download:', dl2 ? dl2.suggestedFilename() : 'none');
// view log
await page.evaluate(()=>{ const e=[...document.querySelectorAll('button')].find(b=>/view log/i.test(b.textContent||'')); if(e) e.click(); });
await page.waitForTimeout(400);
const ltxt=await page.evaluate(()=>document.body.innerText);
console.log('activity log visible:', /Activity Log/i.test(ltxt));
await page.screenshot({path:'/tmp/crm.png',fullPage:true});
// switch tab to partners
await page.evaluate(()=>{ const e=[...document.querySelectorAll('button')].find(b=>/Clients Reaching Out/i.test(b.textContent||'')); if(e) e.click(); });
await page.waitForTimeout(400);
const ptxt=await page.evaluate(()=>document.body.innerText);
console.log('partners tab shows Dana Lee:', /Dana Lee/.test(ptxt) && /BigEPC/.test(ptxt));
console.log('ERRORS:', errs.length?errs.slice(0,3).join('|'):'none');
await browser.close();
