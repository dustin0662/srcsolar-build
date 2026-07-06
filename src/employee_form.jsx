import React, { useState } from 'react';
import { jsPDF } from 'jspdf';

/* ── design tokens (match the main site) ───────────────────────────── */
const A = '#F97316';           // brand orange
const BG = '#f5f2ee';          // warm off-white page bg
const CARD = '#ffffff';
const TEXT = '#1a1a2e';
const MID = '#666';
const DIM = '#999';
const BORDER = 'rgba(0,0,0,.1)';
const BB = { fontFamily: "'Bebas Neue',sans-serif" };
const NB = { fontFamily: "'Barlow Condensed',sans-serif" };
const BODY = { fontFamily: "'Barlow',sans-serif" };
const LOGO = '/logo.webp';
const ENDPOINT = '/.netlify/functions/employeeforms';
const LOCAL_KEY = 'employee_forms_local';

const IST = { width: '100%', background: '#f9f7f5', border: '1px solid rgba(0,0,0,.12)', color: TEXT, padding: '12px 14px', ...BODY, fontSize: 16, outline: 'none', borderRadius: 0, WebkitAppearance: 'none', boxSizing: 'border-box' };
const CLIP = 'polygon(12px 0%,100% 0%,calc(100% - 12px) 100%,0% 100%)';

function uid() { return 'ef_' + Math.abs(Date.now() * 1000 + Math.floor(performance.now())).toString(36) + Math.random().toString(36).slice(2, 8); }

/* ── translations (labels shown in the UI; the PDF always uses English) */
const TX = {
  // page chrome
  page_title: { en: 'Employee Information Form', es: 'Formulario de Información del Empleado' },
  page_sub: { en: 'Sunrise Construction & Development Co. · Human Resources · HR-003', es: 'Sunrise Construction & Development Co. · Recursos Humanos · HR-003' },
  intro: { en: 'Please complete every required field. Your information is submitted securely to Human Resources.', es: 'Complete todos los campos obligatorios. Su información se envía de forma segura a Recursos Humanos.' },
  required_note: { en: 'Fields marked * are required.', es: 'Los campos marcados con * son obligatorios.' },
  submit: { en: 'Submit Form', es: 'Enviar Formulario' },
  submitting: { en: 'Submitting…', es: 'Enviando…' },
  back: { en: '← Back', es: '← Regresar' },
  err_required: { en: 'Please fill in all required fields (marked *).', es: 'Complete todos los campos obligatorios (marcados con *).' },
  // success
  success_title: { en: 'Form Submitted', es: 'Formulario Enviado' },
  success_msg: { en: 'Thank you. Your information has been sent to Human Resources.', es: 'Gracias. Su información ha sido enviada a Recursos Humanos.' },
  download_copy: { en: 'Download My Copy (PDF)', es: 'Descargar Mi Copia (PDF)' },
  submit_another: { en: 'Submit Another Form', es: 'Enviar Otro Formulario' },
  // sections
  sec_personal: { en: 'Personal Information', es: 'Información Personal' },
  sec_emergency: { en: 'Emergency Contact', es: 'Contacto de Emergencia' },
  sec_employment: { en: 'Employment Information', es: 'Información de Empleo' },
  sec_deposit: { en: 'Direct Deposit', es: 'Depósito Directo' },
  sec_resources: { en: 'Company Resources', es: 'Recursos de la Empresa' },
  sec_ack: { en: 'Acknowledgment', es: 'Reconocimiento' },
  // personal
  fullLegalName: { en: 'Full Legal Name', es: 'Nombre Legal Completo' },
  preferredName: { en: 'Preferred Name', es: 'Nombre Preferido' },
  dob: { en: 'Date of Birth', es: 'Fecha de Nacimiento' },
  ssn: { en: 'Social Security Number', es: 'Número de Seguro Social' },
  govIdType: { en: 'Government-Issued Photo ID Type', es: 'Tipo de Identificación con Foto del Gobierno' },
  govIdNumber: { en: 'USA Government-Issued Photo ID Number', es: 'Número de Identificación con Foto Emitida por el Gobierno de EE. UU.' },
  ssnPhoto: { en: 'Photo of Social Security Card', es: 'Foto de la Tarjeta de Seguro Social' },
  govIdPhoto: { en: 'Photo of USA Government-Issued Photo ID', es: 'Foto de la Identificación con Foto Emitida por el Gobierno de EE. UU.' },
  photo_hint: { en: 'Upload a clear photo (JPG or PNG). Required.', es: 'Suba una foto clara (JPG o PNG). Obligatorio.' },
  photo_choose: { en: 'Upload Photo', es: 'Subir Foto' },
  photo_replace: { en: 'Replace Photo', es: 'Reemplazar Foto' },
  photo_download: { en: 'Download photo', es: 'Descargar foto' },
  personalEmail: { en: 'Personal Email', es: 'Correo Electrónico Personal' },
  primaryPhone: { en: 'Primary Phone', es: 'Teléfono Principal' },
  secondaryPhone: { en: 'Secondary Phone', es: 'Teléfono Secundario' },
  homeAddress: { en: 'Home Address', es: 'Dirección de Domicilio' },
  city: { en: 'City', es: 'Ciudad' },
  state: { en: 'State', es: 'Estado' },
  zip: { en: 'ZIP Code', es: 'Código Postal' },
  // emergency
  emName: { en: 'Primary Emergency Contact', es: 'Contacto de Emergencia Principal' },
  emRelationship: { en: 'Relationship', es: 'Parentesco' },
  emPrimaryPhone: { en: 'Primary Phone', es: 'Teléfono Principal' },
  emSecondaryPhone: { en: 'Secondary Phone', es: 'Teléfono Secundario' },
  // employment
  employeeId: { en: 'Employee ID', es: 'ID de Empleado' },
  department: { en: 'Department', es: 'Departamento' },
  jobTitle: { en: 'Job Title', es: 'Puesto' },
  supervisor: { en: 'Supervisor', es: 'Supervisor' },
  hireDate: { en: 'Hire Date', es: 'Fecha de Contratación' },
  employmentStatus: { en: 'Employment Status', es: 'Estado de Empleo' },
  workLocation: { en: 'Work Location', es: 'Lugar de Trabajo' },
  payType: { en: 'Pay Type', es: 'Tipo de Pago' },
  payAmount: { en: 'Hourly Rate / Annual Salary', es: 'Tarifa por Hora / Salario Anual' },
  // deposit
  bankName: { en: 'Bank Name', es: 'Nombre del Banco' },
  routingNumber: { en: 'Routing Number', es: 'Número de Ruta' },
  accountNumber: { en: 'Account Number', es: 'Número de Cuenta' },
  accountType: { en: 'Account Type', es: 'Tipo de Cuenta' },
  // resources
  companyEmailRequired: { en: 'Company Email Required', es: '¿Requiere Correo de la Empresa?' },
  companyEmailAddress: { en: 'Company Email Address', es: 'Dirección de Correo de la Empresa' },
  equipment: { en: 'Equipment Issued', es: 'Equipo Asignado' },
  // acknowledgment
  ack_text: { en: 'I certify that the information provided on this form is accurate and complete. I understand that I must notify Human Resources promptly of any changes to my personal information.', es: 'Certifico que la información proporcionada en este formulario es exacta y completa. Entiendo que debo notificar de inmediato a Recursos Humanos cualquier cambio en mi información personal.' },
  signature: { en: 'Employee Signature (type full name)', es: 'Firma del Empleado (escriba su nombre completo)' },
  ack_agree: { en: 'I agree to the certification above.', es: 'Acepto la certificación anterior.' },
  // options
  opt_hourly: { en: 'Hourly', es: 'Por Hora' },
  opt_salary: { en: 'Salary', es: 'Salario' },
  opt_checking: { en: 'Checking', es: 'Cheques' },
  opt_savings: { en: 'Savings', es: 'Ahorros' },
  opt_yes: { en: 'Yes', es: 'Sí' },
  opt_no: { en: 'No', es: 'No' },
  eq_laptop: { en: 'Laptop', es: 'Portátil' },
  eq_desktop: { en: 'Desktop', es: 'Computadora de Escritorio' },
  eq_phone: { en: 'Phone', es: 'Teléfono' },
  eq_vehicle: { en: 'Vehicle', es: 'Vehículo' },
  eq_tablet: { en: 'Tablet', es: 'Tableta' },
  eq_other: { en: 'Other', es: 'Otro' },
  // admin
  admin_title: { en: 'Employee Form Submissions', es: 'Formularios Enviados' },
  admin_locked: { en: 'Administrator Access', es: 'Acceso de Administrador' },
  admin_pin: { en: 'Enter Admin PIN', es: 'Ingrese el PIN de Administrador' },
  admin_unlock: { en: 'Unlock', es: 'Desbloquear' },
  admin_wrong: { en: 'Incorrect PIN.', es: 'PIN incorrecto.' },
  admin_none: { en: 'No submissions yet.', es: 'Aún no hay envíos.' },
  admin_count: { en: 'submission(s)', es: 'envío(s)' },
  admin_dl: { en: 'Download PDF', es: 'Descargar PDF' },
  admin_view: { en: 'View details', es: 'Ver detalles' },
  admin_hide: { en: 'Hide details', es: 'Ocultar detalles' },
  admin_lock: { en: 'Lock', es: 'Bloquear' },
  admin_refresh: { en: 'Refresh', es: 'Actualizar' },
  col_name: { en: 'Name', es: 'Nombre' },
  col_dept: { en: 'Department', es: 'Departamento' },
  col_title: { en: 'Job Title', es: 'Puesto' },
  col_date: { en: 'Submitted', es: 'Enviado' },
};
function tr(k, lang) { var e = TX[k]; if (!e) return k; return e[lang] != null ? e[lang] : e.en; }

/* ── field schema — drives both the form UI and the PDF ────────────── */
const OPT = {
  payType: [['Hourly', 'opt_hourly'], ['Salary', 'opt_salary']],
  accountType: [['Checking', 'opt_checking'], ['Savings', 'opt_savings']],
  companyEmailRequired: [['Yes', 'opt_yes'], ['No', 'opt_no']],
};
const EQUIP = [['Laptop', 'eq_laptop'], ['Desktop', 'eq_desktop'], ['Phone', 'eq_phone'], ['Vehicle', 'eq_vehicle'], ['Tablet', 'eq_tablet'], ['Other', 'eq_other']];

const SECTIONS = [
  { title: 'sec_personal', fields: [
    { k: 'fullLegalName', type: 'text', req: true },
    { k: 'preferredName', type: 'text' },
    { k: 'dob', type: 'date', req: true },
    { k: 'ssn', type: 'text', req: true },
    { k: 'ssnPhoto', type: 'photo', req: true, wide: true },
    { k: 'govIdType', type: 'text' },
    { k: 'govIdNumber', type: 'text' },
    { k: 'govIdPhoto', type: 'photo', req: true, wide: true },
    { k: 'personalEmail', type: 'email', req: true },
    { k: 'primaryPhone', type: 'tel', req: true },
    { k: 'secondaryPhone', type: 'tel' },
    { k: 'homeAddress', type: 'text', req: true, wide: true },
    { k: 'city', type: 'text', req: true },
    { k: 'state', type: 'text', req: true },
    { k: 'zip', type: 'text', req: true },
  ] },
  { title: 'sec_emergency', fields: [
    { k: 'emName', type: 'text', req: true },
    { k: 'emRelationship', type: 'text' },
    { k: 'emPrimaryPhone', type: 'tel', req: true },
    { k: 'emSecondaryPhone', type: 'tel' },
  ] },
  { title: 'sec_deposit', fields: [
    { k: 'bankName', type: 'text' },
    { k: 'routingNumber', type: 'text' },
    { k: 'accountNumber', type: 'text' },
    { k: 'accountType', type: 'radio' },
  ] },
];

// every free-text / select field key, used for the PDF and details view
const ALL_FIELDS = SECTIONS.reduce(function (acc, s) { return acc.concat(s.fields.map(function (f) { return f; })); }, []);

function emptyForm() {
  var o = {};
  ALL_FIELDS.forEach(function (f) { o[f.k] = f.type === 'checkboxes' ? [] : (f.type === 'photo' ? null : ''); });
  o.signature = '';
  o.ackAgree = false;
  return o;
}

// Read an image file, downscale it (keeps stored/emailed size reasonable), and
// return a JPEG data URL plus its pixel dimensions (used to lay it out in the PDF).
function resizePhoto(file, maxDim, quality) {
  maxDim = maxDim || 1600; quality = quality || 0.82;
  return new Promise(function (resolve, reject) {
    var reader = new FileReader();
    reader.onerror = function () { reject(new Error('read failed')); };
    reader.onload = function () {
      var img = new Image();
      img.onerror = function () { reject(new Error('not an image')); };
      img.onload = function () {
        var w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
        if (w > h && w > maxDim) { h = Math.round(h * maxDim / w); w = maxDim; }
        else if (h >= w && h > maxDim) { w = Math.round(w * maxDim / h); h = maxDim; }
        try {
          var canvas = document.createElement('canvas');
          canvas.width = w; canvas.height = h;
          canvas.getContext('2d').drawImage(img, 0, 0, w, h);
          resolve({ name: file.name || 'photo.jpg', url: canvas.toDataURL('image/jpeg', quality), w: w, h: h });
        } catch (e) { reject(e); }
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function fmtDate(v) {
  try { var d = v ? new Date(v) : new Date(); return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch (e) { return String(v || ''); }
}

/* ── build the branded PDF (always English so HR gets a consistent doc) */
function buildPDF(form, submittedISO) {
  var doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'letter' });
  var M = 44;
  var pw = doc.internal.pageSize.getWidth();
  var ph = doc.internal.pageSize.getHeight();
  var y = M;

  doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.setTextColor(20, 20, 30);
  doc.text('SUNRISE CONSTRUCTION & DEVELOPMENT CO.', M, y);
  doc.setDrawColor(249, 115, 22); doc.setLineWidth(2.5); doc.line(M, y + 8, M + 300, y + 8);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(120, 120, 120);
  doc.text('Employee Information Form  ·  HR-003  ·  Submitted ' + fmtDate(submittedISO), M, y + 24);
  y += 46;

  function ensure(h) { if (y + h > ph - M) { doc.addPage(); y = M; } }

  function sectionHeader(label) {
    ensure(30);
    doc.setFillColor(249, 115, 22); doc.rect(M, y - 10, pw - M * 2, 20, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(255, 255, 255);
    doc.text(label.toUpperCase(), M + 8, y + 4);
    y += 26;
  }

  var LABEL_X = M + 4;
  var VALUE_X = M + 208;         // value column start
  var LABEL_W = VALUE_X - LABEL_X - 12;
  var VALUE_W = pw - VALUE_X - M;
  function row(label, value) {
    var v = value == null || value === '' ? '—' : String(value);
    // Wrap the label within its own column so long labels never collide with the value.
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
    var lwrap = doc.splitTextToSize(label.toUpperCase(), LABEL_W);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
    var vwrap = doc.splitTextToSize(v, VALUE_W);
    var h = Math.max(14, lwrap.length * 12, vwrap.length * 13);
    ensure(h + 4);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(120, 120, 120);
    doc.text(lwrap, LABEL_X, y + 2);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(30, 30, 40);
    doc.text(vwrap, VALUE_X, y + 2);
    y += h + 4;
  }

  function imageRow(label, ph) {
    ensure(20);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(120, 120, 120);
    doc.text(label.toUpperCase(), M + 4, y + 2); y += 14;
    if (ph && ph.url) {
      var maxW = pw - M * 2, maxH = 240;
      var iw = ph.w || maxW, ih = ph.h || maxH;
      var scale = Math.min(maxW / iw, maxH / ih, 1);
      var w = iw * scale, h = ih * scale;
      ensure(h + 12);
      try { doc.addImage(ph.url, 'JPEG', M + 4, y, w, h); y += h + 14; }
      catch (e) { doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(30, 30, 40); doc.text('(image could not be embedded)', M + 4, y + 4); y += 18; }
    } else {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(30, 30, 40);
      doc.text('—', M + 4, y + 2); y += 16;
    }
  }

  SECTIONS.forEach(function (s) {
    sectionHeader(tr(s.title, 'en'));
    s.fields.forEach(function (f) {
      if (f.type === 'photo') { imageRow(tr(f.k, 'en'), form[f.k]); return; }
      var val = form[f.k];
      if (f.type === 'checkboxes') val = Array.isArray(val) ? val.join(', ') : '';
      row(tr(f.k, 'en'), val);
    });
  });

  // acknowledgment
  sectionHeader(tr('sec_ack', 'en'));
  doc.setFont('helvetica', 'italic'); doc.setFontSize(9); doc.setTextColor(80, 80, 90);
  var ack = doc.splitTextToSize(tr('ack_text', 'en'), pw - M * 2 - 8);
  ensure(ack.length * 12 + 10);
  doc.text(ack, M + 4, y + 2); y += ack.length * 12 + 8;
  doc.setFont('helvetica', 'normal');
  row('Employee Signature', form.signature);
  row('Date', fmtDate(submittedISO));

  return doc;
}

function pdfToBase64(doc) {
  var uri = doc.output('datauristring');
  var i = uri.indexOf('base64,');
  return i >= 0 ? uri.slice(i + 7) : '';
}
function base64ToBlob(b64, mime) {
  var bin = atob(b64 || '');
  var u = new Uint8Array(bin.length);
  for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return new Blob([u], { type: mime || 'application/pdf' });
}
function triggerDownload(blob, name) {
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
}
function pdfFileName(form) {
  var nm = (form.fullLegalName || 'Employee').replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '');
  return 'EmployeeInfo_' + nm + '.pdf';
}

/* ── shared bits ───────────────────────────────────────────────────── */
function Label({ children, req }) {
  return <div style={{ ...NB, fontSize: 10, letterSpacing: '2px', textTransform: 'uppercase', color: A, marginBottom: 6 }}>{children}{req && <span style={{ color: '#dc2626' }}> *</span>}</div>;
}
function BrandHeader({ lang, onExit }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 22, flexWrap: 'wrap', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <img src={LOGO} alt="SRC" style={{ width: 46, height: 46, objectFit: 'contain' }} />
        <div>
          <div style={{ ...BB, fontSize: 26, letterSpacing: 2, color: TEXT, lineHeight: 1 }}>{tr('page_title', lang)}</div>
          <div style={{ ...NB, fontSize: 12, letterSpacing: '1.5px', textTransform: 'uppercase', color: MID, marginTop: 4 }}>{tr('page_sub', lang)}</div>
        </div>
      </div>
      {onExit && <div onClick={onExit} style={{ cursor: 'pointer', ...NB, fontSize: 12, letterSpacing: '2px', textTransform: 'uppercase', color: A }}>{tr('back', lang)}</div>}
    </div>
  );
}

/* ═══════════════════ EMPLOYEE FORM ═══════════════════ */
export function EmployeeForm({ lang, onExit }) {
  var L = lang === 'es' ? 'es' : 'en';
  const [form, setForm] = useState(emptyForm);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState('');
  const [lastDoc, setLastDoc] = useState(null);

  function set(k, v) { setForm(function (p) { var n = Object.assign({}, p); n[k] = v; return n; }); }
  function toggleEquip(v) {
    setForm(function (p) {
      var arr = Array.isArray(p.equipment) ? p.equipment.slice() : [];
      var i = arr.indexOf(v);
      if (i >= 0) arr.splice(i, 1); else arr.push(v);
      return Object.assign({}, p, { equipment: arr });
    });
  }

  function validate() {
    for (var i = 0; i < ALL_FIELDS.length; i++) {
      var f = ALL_FIELDS[i];
      if (!f.req) continue;
      if (f.type === 'photo') { if (!form[f.k] || !form[f.k].url) return false; }
      else if (!String(form[f.k] || '').trim()) return false;
    }
    if (!String(form.signature || '').trim()) return false;
    if (!form.ackAgree) return false;
    return true;
  }

  async function setPhoto(k, file) {
    if (!file) return;
    try { var p = await resizePhoto(file); setForm(function (prev) { var n = Object.assign({}, prev); n[k] = p; return n; }); }
    catch (e) { window.alert('Could not read that image. Please choose a JPG or PNG photo.'); }
  }

  async function submit() {
    setErr('');
    if (!validate()) { setErr(tr('err_required', L)); try { window.scrollTo(0, 0); } catch (e) {} return; }
    setSubmitting(true);
    var submittedISO = new Date().toISOString();
    var id = uid();
    var doc = buildPDF(form, submittedISO);
    setLastDoc(doc);
    var pdf = pdfToBase64(doc);
    var item = Object.assign({}, form, { id: id, submittedAt: submittedISO, lang: L, pdf: pdf });
    try {
      var res = await fetch(ENDPOINT, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ item: item }), keepalive: true });
      if (!res.ok) throw new Error('bad status');
    } catch (e) {
      // Offline / function unavailable (e.g. plain vite dev): keep it locally so
      // the admin view still works. Mirrors the CRM's local fallback.
      try {
        var raw = localStorage.getItem(LOCAL_KEY);
        var list = raw ? JSON.parse(raw) : [];
        list.push(item);
        localStorage.setItem(LOCAL_KEY, JSON.stringify(list));
      } catch (e2) {}
    }
    setSubmitting(false);
    setDone(true);
    try { window.scrollTo(0, 0); } catch (e3) {}
  }

  if (done) {
    return (
      <div style={{ position: 'fixed', inset: 0, zIndex: 2000, background: BG, overflow: 'auto', ...BODY }}>
        <div style={{ maxWidth: 640, margin: '0 auto', padding: '80px 20px', textAlign: 'center' }}>
          <div style={{ width: 72, height: 72, borderRadius: '50%', background: '#16a34a', margin: '0 auto 24px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 40 }}>✓</div>
          <div style={{ ...BB, fontSize: 40, letterSpacing: 2, color: TEXT }}>{tr('success_title', L)}</div>
          <div style={{ ...NB, fontSize: 17, color: MID, marginTop: 12, lineHeight: 1.5 }}>{tr('success_msg', L)}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 340, margin: '32px auto 0' }}>
            <button onClick={function () { if (lastDoc) lastDoc.save(pdfFileName(form)); }} style={{ background: A, color: '#1a1206', border: 'none', padding: '15px 0', ...NB, fontWeight: 700, fontSize: 15, letterSpacing: '2px', textTransform: 'uppercase', cursor: 'pointer', clipPath: CLIP }}>{tr('download_copy', L)}</button>
            <button onClick={function () { setForm(emptyForm()); setDone(false); setLastDoc(null); }} style={{ background: 'transparent', color: MID, border: '1px solid ' + BORDER, padding: '13px 0', ...NB, fontSize: 14, letterSpacing: '2px', textTransform: 'uppercase', cursor: 'pointer' }}>{tr('submit_another', L)}</button>
            {onExit && <div onClick={onExit} style={{ cursor: 'pointer', ...NB, fontSize: 12, letterSpacing: '2px', textTransform: 'uppercase', color: DIM, marginTop: 4 }}>{tr('back', L)}</div>}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 2000, background: BG, overflow: 'auto', ...BODY }}>
      <div style={{ maxWidth: 900, margin: '0 auto', padding: '40px 20px 80px' }}>
        <BrandHeader lang={L} onExit={onExit} />
        <div style={{ ...NB, fontSize: 15, color: MID, marginBottom: 6, lineHeight: 1.5 }}>{tr('intro', L)}</div>
        <div style={{ ...NB, fontSize: 12, color: DIM, marginBottom: 24 }}>{tr('required_note', L)}</div>

        {err && <div style={{ background: '#fdecea', border: '1px solid #dc2626', color: '#991b1b', padding: '12px 16px', ...NB, fontSize: 14, marginBottom: 22 }}>{err}</div>}

        {SECTIONS.map(function (s) {
          return (
            <div key={s.title} style={{ background: CARD, border: '1px solid ' + BORDER, padding: '22px 22px 24px', marginBottom: 20 }}>
              <div style={{ ...BB, fontSize: 22, letterSpacing: 1.5, color: TEXT, marginBottom: 18, borderBottom: '2px solid ' + A, paddingBottom: 8, display: 'inline-block' }}>{tr(s.title, L)}</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: 16 }}>
                {s.fields.map(function (f) {
                  if (f.type === 'photo') {
                    var ph = form[f.k];
                    return (
                      <div key={f.k} style={{ gridColumn: '1 / -1' }}>
                        <Label req={f.req}>{tr(f.k, L)}</Label>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
                          <label style={{ ...NB, fontSize: 14, letterSpacing: '1px', textTransform: 'uppercase', padding: '11px 20px', background: ph ? '#f9f7f5' : A, color: ph ? MID : '#1a1206', fontWeight: 700, border: '1px solid ' + (ph ? BORDER : A), cursor: 'pointer', display: 'inline-block' }}>
                            {ph ? tr('photo_replace', L) : tr('photo_choose', L)}
                            <input type="file" accept="image/*" style={{ display: 'none' }} onChange={function (e) { var file = e.target.files && e.target.files[0]; e.target.value = ''; setPhoto(f.k, file); }} />
                          </label>
                          <span style={{ ...NB, fontSize: 12, color: DIM }}>{ph ? (ph.name || '') : tr('photo_hint', L)}</span>
                        </div>
                        {ph && ph.url && <img src={ph.url} alt="" style={{ maxHeight: 170, maxWidth: '100%', marginTop: 12, border: '1px solid ' + BORDER, borderRadius: 4, display: 'block' }} />}
                      </div>
                    );
                  }
                  if (f.type === 'radio') {
                    return (
                      <div key={f.k} style={{ gridColumn: '1 / -1' }}>
                        <Label req={f.req}>{tr(f.k, L)}</Label>
                        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                          {OPT[f.k].map(function (o) {
                            var on = form[f.k] === o[0];
                            return <button key={o[0]} type="button" onClick={function () { set(f.k, o[0]); }} style={{ ...NB, fontSize: 14, padding: '10px 20px', border: '1px solid ' + (on ? A : BORDER), background: on ? A : '#f9f7f5', color: on ? '#1a1206' : MID, fontWeight: on ? 700 : 400, cursor: 'pointer' }}>{tr(o[1], L)}</button>;
                          })}
                        </div>
                      </div>
                    );
                  }
                  if (f.type === 'checkboxes') {
                    return (
                      <div key={f.k} style={{ gridColumn: '1 / -1' }}>
                        <Label req={f.req}>{tr(f.k, L)}</Label>
                        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                          {EQUIP.map(function (o) {
                            var on = (form.equipment || []).indexOf(o[0]) >= 0;
                            return <button key={o[0]} type="button" onClick={function () { toggleEquip(o[0]); }} style={{ ...NB, fontSize: 14, padding: '10px 18px', border: '1px solid ' + (on ? A : BORDER), background: on ? A : '#f9f7f5', color: on ? '#1a1206' : MID, fontWeight: on ? 700 : 400, cursor: 'pointer' }}>{on ? '✓ ' : ''}{tr(o[1], L)}</button>;
                          })}
                        </div>
                      </div>
                    );
                  }
                  return (
                    <div key={f.k} style={f.wide ? { gridColumn: '1 / -1' } : null}>
                      <Label req={f.req}>{tr(f.k, L)}</Label>
                      <input type={f.type === 'date' ? 'date' : f.type === 'email' ? 'email' : f.type === 'tel' ? 'tel' : 'text'} value={form[f.k]} onChange={function (e) { set(f.k, e.target.value); }} style={IST} />
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}

        {/* Acknowledgment */}
        <div style={{ background: CARD, border: '1px solid ' + BORDER, padding: '22px', marginBottom: 24 }}>
          <div style={{ ...BB, fontSize: 22, letterSpacing: 1.5, color: TEXT, marginBottom: 16, borderBottom: '2px solid ' + A, paddingBottom: 8, display: 'inline-block' }}>{tr('sec_ack', L)}</div>
          <div style={{ ...NB, fontSize: 14, color: MID, lineHeight: 1.6, marginBottom: 18, fontStyle: 'italic' }}>{tr('ack_text', L)}</div>
          <div style={{ marginBottom: 16 }}>
            <Label req>{tr('signature', L)}</Label>
            <input value={form.signature} onChange={function (e) { set('signature', e.target.value); }} style={{ ...IST, fontFamily: "'Barlow',cursive", fontSize: 20, fontStyle: 'italic' }} />
          </div>
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer', ...NB, fontSize: 15, color: TEXT }}>
            <input type="checkbox" checked={form.ackAgree} onChange={function (e) { set('ackAgree', e.target.checked); }} style={{ width: 20, height: 20, marginTop: 1, accentColor: A }} />
            <span>{tr('ack_agree', L)} <span style={{ color: '#dc2626' }}>*</span></span>
          </label>
        </div>

        <button onClick={submit} disabled={submitting} style={{ width: '100%', background: submitting ? DIM : A, color: '#1a1206', border: 'none', padding: '17px 0', ...NB, fontWeight: 700, fontSize: 17, letterSpacing: '3px', textTransform: 'uppercase', cursor: submitting ? 'default' : 'pointer', clipPath: CLIP, boxShadow: '0 6px 24px rgba(249,115,22,.28)' }}>{submitting ? tr('submitting', L) : tr('submit', L)}</button>
      </div>
    </div>
  );
}

/* ═══════════════════ ADMIN (PIN-gated) ═══════════════════ */
export function EmployeeFormAdmin({ lang, onExit }) {
  var L = lang === 'es' ? 'es' : 'en';
  const [pin, setPin] = useState('');
  const [authPin, setAuthPin] = useState(null); // the verified PIN we keep for API calls
  const [items, setItems] = useState([]);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [openId, setOpenId] = useState(null);
  const [detail, setDetail] = useState({}); // id -> full record

  function localItems() {
    try { var raw = localStorage.getItem(LOCAL_KEY); return raw ? JSON.parse(raw) : []; } catch (e) { return []; }
  }

  async function load(p) {
    setBusy(true); setErr('');
    var merged = [];
    var serverAuthoritative = false;
    try {
      var res = await fetch(ENDPOINT + '?list=1', { headers: { 'x-admin-pin': p }, cache: 'no-store' });
      if (res.status === 401) { setErr(tr('admin_wrong', L)); setBusy(false); return false; }
      if (res.ok) { var j = await res.json(); merged = (j.items || []).slice(); serverAuthoritative = true; }
      // Any other status (404/500, e.g. plain vite dev) — fall through to local gate.
    } catch (e) { /* function unreachable — fall back to local */ }
    // When the server didn't authoritatively accept the PIN, validate it against
    // the known value locally so the offline fallback stays gated.
    if (!serverAuthoritative && p !== '08241998') { setErr(tr('admin_wrong', L)); setBusy(false); return false; }
    // merge local fallback records (dev / offline)
    var locals = localItems().map(function (r) { return { id: r.id, name: r.fullLegalName || r.preferredName || '', department: r.department || '', jobTitle: r.jobTitle || '', submittedAt: r.submittedAt, _local: true }; });
    locals.forEach(function (l) { if (!merged.some(function (m) { return m.id === l.id; })) merged.push(l); });
    merged.sort(function (a, b) { return (b.submittedAt || '').localeCompare(a.submittedAt || ''); });
    setItems(merged);
    setAuthPin(p);
    setBusy(false);
    return true;
  }

  async function unlock() {
    if (!pin.trim()) return;
    await load(pin.trim());
  }

  async function fetchFull(id, isLocal) {
    if (detail[id]) return detail[id];
    if (isLocal) {
      var rec = localItems().find(function (r) { return r.id === id; }) || null;
      if (rec) setDetail(function (d) { return Object.assign({}, d, { [id]: rec }); });
      return rec;
    }
    try {
      var res = await fetch(ENDPOINT + '?item=' + encodeURIComponent(id), { headers: { 'x-admin-pin': authPin }, cache: 'no-store' });
      if (!res.ok) throw new Error('status ' + res.status);
      var j = await res.json();
      setDetail(function (d) { return Object.assign({}, d, { [id]: j.item }); });
      return j.item;
    } catch (e) { window.alert('Could not load submission: ' + e.message); return null; }
  }

  async function download(row) {
    var rec = await fetchFull(row.id, row._local);
    if (!rec || !rec.pdf) { window.alert('No PDF available for this submission.'); return; }
    triggerDownload(base64ToBlob(rec.pdf, 'application/pdf'), pdfFileName(rec));
  }

  async function toggleDetail(row) {
    if (openId === row.id) { setOpenId(null); return; }
    await fetchFull(row.id, row._local);
    setOpenId(row.id);
  }

  if (authPin == null) {
    return (
      <div style={{ position: 'fixed', inset: 0, zIndex: 2000, background: 'radial-gradient(120% 80% at 50% -10%, #14182a 0%, #0a0a14 55%, #06060f 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, ...BODY }}>
        <div style={{ maxWidth: 400, width: '100%', textAlign: 'center' }}>
          <img src={LOGO} alt="SRC" style={{ width: 64, height: 64, objectFit: 'contain', marginBottom: 18 }} />
          <div style={{ ...NB, fontSize: 12, letterSpacing: '3px', textTransform: 'uppercase', color: A, marginBottom: 8 }}>{tr('admin_locked', L)}</div>
          <div style={{ ...BB, fontSize: 30, letterSpacing: 2, color: '#F5F0EB', marginBottom: 24 }}>{tr('admin_title', L)}</div>
          <input type="password" inputMode="numeric" value={pin} placeholder={tr('admin_pin', L)} autoFocus onChange={function (e) { setPin(e.target.value); setErr(''); }} onKeyDown={function (e) { if (e.key === 'Enter') unlock(); }} style={{ width: '100%', background: 'rgba(255,255,255,.06)', border: '1px solid rgba(245,240,235,.25)', color: '#F5F0EB', padding: '14px 16px', ...NB, fontSize: 18, letterSpacing: '4px', textAlign: 'center', outline: 'none', boxSizing: 'border-box', marginBottom: 12 }} />
          {err && <div style={{ ...NB, fontSize: 13, color: '#f87171', marginBottom: 12 }}>{err}</div>}
          <button onClick={unlock} disabled={busy} style={{ width: '100%', background: A, color: '#1a1206', border: 'none', padding: '15px 0', ...NB, fontWeight: 700, fontSize: 15, letterSpacing: '3px', textTransform: 'uppercase', cursor: 'pointer', clipPath: CLIP }}>{busy ? '…' : tr('admin_unlock', L)}</button>
          {onExit && <div onClick={onExit} style={{ cursor: 'pointer', ...NB, fontSize: 12, letterSpacing: '2px', textTransform: 'uppercase', color: 'rgba(245,240,235,.5)', marginTop: 18 }}>{tr('back', L)}</div>}
        </div>
      </div>
    );
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 2000, background: BG, overflow: 'auto', ...BODY }}>
      <div style={{ maxWidth: 1000, margin: '0 auto', padding: '40px 20px 80px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, flexWrap: 'wrap', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <img src={LOGO} alt="SRC" style={{ width: 40, height: 40, objectFit: 'contain' }} />
            <div style={{ ...BB, fontSize: 28, letterSpacing: 2, color: TEXT }}>{tr('admin_title', L)}</div>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <button onClick={function () { load(authPin); }} style={{ ...NB, fontSize: 12, letterSpacing: '2px', textTransform: 'uppercase', padding: '8px 16px', background: 'transparent', border: '1px solid ' + BORDER, color: MID, cursor: 'pointer' }}>{tr('admin_refresh', L)}</button>
            <button onClick={function () { setAuthPin(null); setPin(''); setItems([]); setDetail({}); }} style={{ ...NB, fontSize: 12, letterSpacing: '2px', textTransform: 'uppercase', padding: '8px 16px', background: 'transparent', border: '1px solid ' + BORDER, color: MID, cursor: 'pointer' }}>{tr('admin_lock', L)}</button>
          </div>
        </div>
        <div style={{ ...NB, fontSize: 13, color: DIM, marginBottom: 24 }}>{items.length} {tr('admin_count', L)}</div>

        {items.length === 0 && <div style={{ ...NB, fontSize: 16, color: MID, textAlign: 'center', padding: '60px 0' }}>{tr('admin_none', L)}</div>}

        {items.map(function (row) {
          var rec = detail[row.id];
          return (
            <div key={row.id} style={{ background: CARD, border: '1px solid ' + BORDER, marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '16px 18px', flexWrap: 'wrap' }}>
                <div style={{ minWidth: 200 }}>
                  <div style={{ ...NB, fontSize: 18, fontWeight: 700, color: TEXT }}>{row.name || '—'}</div>
                  {(row.jobTitle || row.department) && <div style={{ ...NB, fontSize: 13, color: MID, marginTop: 2 }}>
                    {(row.jobTitle || '') + (row.jobTitle && row.department ? '  ·  ' : '') + (row.department || '')}
                  </div>}
                  <div style={{ ...NB, fontSize: 12, color: DIM, marginTop: 2 }}>{fmtDate(row.submittedAt)}{row._local ? '  ·  (local)' : ''}</div>
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button onClick={function () { toggleDetail(row); }} style={{ ...NB, fontSize: 12, letterSpacing: '1px', textTransform: 'uppercase', padding: '9px 16px', background: 'transparent', border: '1px solid ' + BORDER, color: MID, cursor: 'pointer' }}>{openId === row.id ? tr('admin_hide', L) : tr('admin_view', L)}</button>
                  <button onClick={function () { download(row); }} style={{ ...NB, fontSize: 12, letterSpacing: '1px', textTransform: 'uppercase', padding: '9px 18px', background: A, border: 'none', color: '#1a1206', fontWeight: 700, cursor: 'pointer' }}>{tr('admin_dl', L)}</button>
                </div>
              </div>
              {openId === row.id && rec && (
                <div style={{ borderTop: '1px solid ' + BORDER, padding: '18px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 14 }}>
                  {ALL_FIELDS.map(function (f) {
                    if (f.type === 'photo') {
                      var ph = rec[f.k];
                      return (
                        <div key={f.k} style={{ gridColumn: '1 / -1' }}>
                          <div style={{ ...NB, fontSize: 10, letterSpacing: '1.5px', textTransform: 'uppercase', color: DIM, marginBottom: 4 }}>{tr(f.k, 'en')}</div>
                          {ph && ph.url ? (
                            <div>
                              <img src={ph.url} alt="" style={{ maxHeight: 220, maxWidth: '100%', border: '1px solid ' + BORDER, borderRadius: 4, display: 'block' }} />
                              <a href={ph.url} download={ph.name || 'photo.jpg'} style={{ ...NB, fontSize: 12, letterSpacing: '1px', textTransform: 'uppercase', color: A, textDecoration: 'underline', display: 'inline-block', marginTop: 6 }}>{tr('photo_download', L)}</a>
                            </div>
                          ) : <div style={{ ...NB, fontSize: 14, color: TEXT }}>—</div>}
                        </div>
                      );
                    }
                    var v = rec[f.k];
                    if (f.type === 'checkboxes') v = Array.isArray(v) ? v.join(', ') : '';
                    return (
                      <div key={f.k}>
                        <div style={{ ...NB, fontSize: 10, letterSpacing: '1.5px', textTransform: 'uppercase', color: DIM, marginBottom: 2 }}>{tr(f.k, 'en')}</div>
                        <div style={{ ...NB, fontSize: 14, color: TEXT, wordBreak: 'break-word' }}>{v ? String(v) : '—'}</div>
                      </div>
                    );
                  })}
                  <div>
                    <div style={{ ...NB, fontSize: 10, letterSpacing: '1.5px', textTransform: 'uppercase', color: DIM, marginBottom: 2 }}>Employee Signature</div>
                    <div style={{ ...NB, fontSize: 14, color: TEXT }}>{rec.signature || '—'}</div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
