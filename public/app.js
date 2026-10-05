const $ = (s, root=document) => root.querySelector(s);
const $$ = (s, root=document) => Array.from(root.querySelectorAll(s));

let token = localStorage.getItem('certichain_token') || '';
let role = localStorage.getItem('certichain_role') || '';
let certificates = [];
let loginRole = 'admin';

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'
  }[ch]));
}

function toast(message) {
  const el = $('#toast');
  if (!el) return;
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(() => el.classList.remove('show'), 2800);
}

async function api(url, options = {}) {
  const headers = { ...(options.body instanceof FormData ? {} : {'Content-Type':'application/json'}), ...(options.headers || {}) };
  if (token) headers.Authorization = 'Bearer ' + token;
  const response = await fetch(url, { ...options, headers });
  let data;
  try { data = await response.json(); } catch { data = { error: await response.text() }; }
  if (response.status === 401 && url !== '/api/auth/login') {
    token = '';
    role = '';
    localStorage.removeItem('certichain_token');
    localStorage.removeItem('certichain_role');
    if ($('#app')) $('#app').classList.add('hidden');
    if ($('#loginScreen')) $('#loginScreen').classList.remove('hidden');
    throw new Error(data.error || 'Your session has expired. Please sign in again.');
  }
  if (!response.ok) throw new Error(data.error || 'Request failed.');
  return data;
}

function showPage(page) {
  const target = document.getElementById(page);
  if (!target) return;
  $$('.page').forEach(p => p.classList.toggle('active', p.id === page));
  $$('.nav').forEach(n => n.classList.toggle('active', n.dataset.page === page));
  const titles = {
    dashboard:'Dashboard', issue:'Issue Certificate', upload:'Upload Certificate',
    verify:'Verify Certificate', certificates:'Certificates', student:'My Certificates',
    audit:'Audit Trail'
  };
  const title = $('#pageTitle');
  if (title) title.textContent = titles[page] || 'CertiChain';

  if (page === 'dashboard') { refreshDashboard(); }
  if (page === 'certificates') loadCertificates();
  if (page === 'audit') loadAudit();
  if (page === 'student') loadStudent();
}

function bindNavigation() {
  $$('.nav').forEach(button => {
    button.addEventListener('click', event => {
      event.preventDefault();
      showPage(button.dataset.page);
    });
  });
  document.addEventListener('click', event => {
    const button = event.target.closest('[data-go]');
    if (!button) return;
    event.preventDefault();
    showPage(button.dataset.go);
  });
}

function setLoggedInUI() {
  const login = $('#loginScreen');
  const app = $('#app');
  if (!token) {
    login?.classList.remove('hidden');
    app?.classList.add('hidden');
    return;
  }
  login?.classList.add('hidden');
  app?.classList.remove('hidden');
  $('#adminNav')?.classList.toggle('hidden', role !== 'admin');
  $('#studentNav')?.classList.toggle('hidden', role !== 'student');
  $('#who').textContent = (role || 'user').toUpperCase();
  const profile = $('.profile small');
  if (profile) profile.textContent = role === 'student' ? 'Student' : 'Administrator';
}

async function boot() {
  setLoggedInUI();
  if (!token) return;
  try {
    const me = await api('/api/me');
    role = me.role;
    localStorage.setItem('certichain_role', role);
    setLoggedInUI();
    showPage(role === 'student' ? 'student' : 'dashboard');
    const verifyId = new URLSearchParams(location.search).get('verify');
    if (verifyId) {
      showPage('verify');
      await selectVerifyCertificate(verifyId);
    }
  } catch (error) {
    if (token) toast(error.message);
  }
}

async function login(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const values = Object.fromEntries(new FormData(form));
  const button = form.querySelector('button[type="submit"],button.primary');
  if (button) { button.disabled = true; button.textContent = 'Signing in…'; }
  try {
    const result = await api('/api/auth/login', {
      method:'POST',
      body:JSON.stringify({ ...values, role:loginRole })
    });
    token = result.token;
    role = result.role;
    localStorage.setItem('certichain_token', token);
    localStorage.setItem('certichain_role', role);
    form.reset();
    setLoggedInUI();
    showPage(role === 'student' ? 'student' : 'dashboard');
    toast('Login successful');
  } catch (error) {
    toast(error.message);
  } finally {
    if (button) { button.disabled = false; button.textContent = 'Sign in'; }
  }
}

async function logout() {
  token = '';
  role = '';
  localStorage.removeItem('certichain_token');
  localStorage.removeItem('certichain_role');
  location.reload();
}

async function loadHealth() {
  try {
    const h = await api('/api/health');
    $('#chainStatus') && ($('#chainStatus').textContent = '● Blockchain connected');
    if ($('#sideContract')) $('#sideContract').textContent = h.contract ? h.contract.slice(0,12)+'…'+h.contract.slice(-4) : 'Unavailable';
    if ($('#healthBox')) $('#healthBox').innerHTML = '<b>Connected</b><br>Contract: <code>'+esc(h.contract)+'</code><br>Block: '+esc(h.block)+'<br>Issuer: <code>'+esc(h.issuer)+'</code>';
  } catch (error) {
    if ($('#chainStatus')) $('#chainStatus').textContent = '● Blockchain offline';
    if ($('#healthBox')) $('#healthBox').textContent = error.message;
  }
}

async function loadStats() {
  if (role !== 'admin') return;
  try {
    const stats = await api('/api/stats');
    $('#sTotal').textContent = stats.total ?? 0;
    $('#sActive').textContent = stats.active ?? 0;
    $('#sRevoked').textContent = stats.revoked ?? 0;
    $('#sVerifications').textContent = stats.verifications ?? 0;
    $('#sStudents').textContent = stats.students ?? 0;
    return stats;
  } catch (error) {
    toast('Dashboard statistics: '+error.message);
    return null;
  }
}

async function refreshDashboard() {
  if (role !== 'admin') return;
  const [healthResult, statsResult, certResult, auditResult] = await Promise.allSettled([
    loadHealth(),
    loadStats(),
    api('/api/certificates'),
    api('/api/audit')
  ]);
  if (certResult.status === 'fulfilled') {
    const rows = Array.isArray(certResult.value) ? certResult.value : [];
    certificates = rows;
    renderRecentDashboard(rows);
    renderFeaturedDashboard(rows);
  } else {
    renderRecentDashboard([]);
    toast('Could not load dashboard certificates: '+(certResult.reason?.message || 'Request failed.'));
  }
  if (auditResult.status === 'fulfilled') renderActivityRows(auditResult.value);
}

function renderActivityRows(rows) {
  const box = $('#recentActivity');
  if (!box) return;
  box.innerHTML = (Array.isArray(rows) ? rows : []).slice(0,5).map(r =>
    '<div class="activity-item"><span class="activity-dot"></span><div><b>'+esc(r.action)+'</b><span>'+esc(r.certificateId || 'System event')+'</span><small>'+esc(new Date(r.createdAt).toLocaleString())+'</small></div></div>'
  ).join('') || '<div class="muted">No recent activity.</div>';
}

function renderRecentDashboard(rows) {
  const box = $('#recentRows');
  if (!box) return;
  box.innerHTML = rows.slice(0,5).map(r => '<tr>'+
    '<td><b>'+esc(r.id)+'</b></td><td>'+esc(r.studentName)+'</td><td>'+esc(r.course)+'</td>'+
    '<td>'+esc(r.issueDate)+'</td><td><span class="badge '+(r.status==='ACTIVE'?'ok':'bad')+'">'+esc(r.status)+'</span></td>'+
    '<td><button type="button" class="mini" data-open-cert="'+esc(r.id)+'">Verify</button> '+
    '<a class="mini linkmini" href="/api/certificates/'+encodeURIComponent(r.id)+'/pdf" target="_blank">PDF</a></td></tr>'
  ).join('') || '<tr><td colspan="6">No certificates yet.</td></tr>';
}

function renderFeaturedDashboard(rows) {
  const row = rows[0];
  if (!row) {
    ['featuredName','featuredCourse','featuredId','featuredDate','featuredGrade'].forEach(id => { if ($('#'+id)) $('#'+id).textContent = id === 'featuredName' ? 'No certificates yet' : '—'; });
    return;
  }
  $('#featuredName').textContent = row.studentName || '—';
  $('#featuredCourse').textContent = row.course || '—';
  $('#featuredId').textContent = row.id || '—';
  $('#featuredDate').textContent = row.issueDate || '—';
  $('#featuredGrade').textContent = row.grade || '—';
  const featuredQr = $('#featuredQr');
  if (featuredQr) featuredQr.src = '/api/certificates/'+encodeURIComponent(row.id)+'/qr';
  const pdf = $('#featuredPdf');
  if (pdf) { pdf.href = '/api/certificates/'+encodeURIComponent(row.id)+'/pdf'; pdf.classList.remove('disabled-link'); }
  const print = $('#featuredPrint');
  const email = $('#featuredEmail');
  if (print) print.onclick = () => printCert(row.id);
  if (email) email.onclick = () => emailCert(row.id);
}

async function renderActivityDashboard() {
  if (role !== 'admin') return;
  try { renderActivityRows(await api('/api/audit')); }
  catch (error) { const box=$('#recentActivity'); if(box) box.innerHTML='<div class="muted">'+esc(error.message)+'</div>'; }
}

function setButtonBusy(button, busy, label) {
  if (!button) return;
  if (busy) {
    button.dataset.oldText = button.textContent;
    button.disabled = true;
    button.textContent = label || 'Working…';
  } else {
    button.disabled = false;
    button.textContent = button.dataset.oldText || button.textContent;
  }
}

async function fileData(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Could not read the selected file.'));
    reader.readAsDataURL(file);
  });
}
// Certificate document extraction + encrypted QR helpers
function setFormValue(form,name,value){const el=form?.querySelector('[name="'+name+'"]');if(el&&value!==undefined&&value!==null&&String(value).trim())el.value=String(value).trim();}
function normalizeExtractedDate(v){const s=String(v||'').trim();let m=s.match(/\b(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})\b/);if(m)return m[3]+'-'+String(m[2]).padStart(2,'0')+'-'+String(m[1]).padStart(2,'0');m=s.match(/\b(\d{4})[\/.-](\d{1,2})[\/.-](\d{1,2})\b/);return m?m[1]+'-'+String(m[2]).padStart(2,'0')+'-'+String(m[3]).padStart(2,'0'):'';}
function parseCertificateText(text){const joined=String(text||'').replace(/\r/g,'').replace(/[ \t]+/g,' ').split('\n').map(x=>x.trim()).filter(Boolean).join('\n');const out={};const email=joined.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);if(email)out.studentEmail=email[0];const pick=ps=>{for(const p of ps){const m=joined.match(p);if(m?.[1])return m[1].replace(/\s+/g,' ').trim().replace(/[|,:;]+$/,'');}return '';};out.studentName=pick([/(?:student\s*name|recipient\s*name|candidate\s*name)\s*[:\-]\s*([^\n]+)/i,/this\s+is\s+to\s+certify\s+that\s*\n\s*([^\n]+)/i]);out.course=pick([/(?:course|qualification|program|programme|degree)\s*[:\-]\s*([^\n]+)/i,/completed\s+(?:the\s+requirements\s+for|requirements\s+for)\s*\n\s*([^\n]+)/i]);out.grade=pick([/(?:grade|result|score|percentage|cgpa)\s*[:\-]\s*([^\n]+)/i]);out.institution=pick([/(?:institution|college|university|institute)\s*[:\-]\s*([^\n]+)/i,/at\s*\n\s*([^\n]+)/i])||'Srinivas Institute of Technology';const date=pick([/(?:issue\s*date|issued\s*date|date\s*of\s*issue|date)\s*[:\-]\s*([^\n]+)/i]);out.issueDate=normalizeExtractedDate(date);if(!out.issueDate){const dm=joined.match(/\b(?:\d{1,2}[\/.-]\d{1,2}[\/.-]\d{4}|\d{4}[\/.-]\d{1,2}[\/.-]\d{1,2})\b/);out.issueDate=normalizeExtractedDate(dm?.[0]);}return out;}
async function renderPdfFirstPage(file){if(!window.pdfjsLib)throw new Error('PDF extraction library is not loaded. Refresh the page.');const data=new Uint8Array(await file.arrayBuffer());const pdf=await window.pdfjsLib.getDocument({data}).promise;const page=await pdf.getPage(1);const viewport=page.getViewport({scale:2});const canvas=document.createElement('canvas');canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);await page.render({canvasContext:canvas.getContext('2d'),viewport}).promise;let text='';for(let n=1;n<=Math.min(pdf.numPages,3);n++){const p=await pdf.getPage(n),tc=await p.getTextContent();text+='\n'+tc.items.map(i=>i.str).join(' ');}return{canvas,text};}
async function imageToCanvas(file){const url=URL.createObjectURL(file);try{const img=await new Promise((resolve,reject)=>{const i=new Image();i.onload=()=>resolve(i);i.onerror=reject;i.src=url;});const scale=Math.min(2,1800/Math.max(img.naturalWidth,img.naturalHeight));const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(img.naturalWidth*scale));canvas.height=Math.max(1,Math.round(img.naturalHeight*scale));canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);return canvas;}finally{URL.revokeObjectURL(url);}}
function scanQrCanvas(canvas){if(!window.jsQR)return null;const ctx=canvas.getContext('2d',{willReadFrequently:true}),image=ctx.getImageData(0,0,canvas.width,canvas.height);return window.jsQR(image.data,image.width,image.height,{inversionAttempts:'attemptBoth'})?.data||null;}
async function ocrCanvas(canvas,status){if(!window.Tesseract)throw new Error('OCR library is not loaded. Refresh the page.');if(status)status.textContent='Reading certificate text…';const result=await window.Tesseract.recognize(canvas,'eng',{logger:m=>{if(status&&m.status==='recognizing text')status.textContent='OCR '+Math.round((m.progress||0)*100)+'%…';}});return result.data.text||'';}
async function extractCertificateFromFile(file,form,status){if(status)status.textContent='Analyzing certificate…';let canvas,text='';if(file.type==='application/pdf'||file.name.toLowerCase().endsWith('.pdf')){const r=await renderPdfFirstPage(file);canvas=r.canvas;text=r.text;}else canvas=await imageToCanvas(file);const qr=scanQrCanvas(canvas);if(qr?.startsWith('CCQR1.')){try{const decoded=await api('/api/qr/decode',{method:'POST',body:JSON.stringify({qrData:qr})});const c=decoded.certificate;[['studentName',c.studentName],['studentEmail',c.studentEmail],['course',c.course],['institution',c.institution],['issueDate',c.issueDate],['grade',c.grade]].forEach(([k,v])=>setFormValue(form,k,v));if(status)status.textContent='✓ Encrypted CertiChain QR verified — fields filled automatically.';return decoded;}catch(e){if(status)status.textContent='QR detected; using document text extraction…';}}if(!text.trim())text=await ocrCanvas(canvas,status);const fields=parseCertificateText(text);Object.entries(fields).forEach(([k,v])=>setFormValue(form,k,v));if(status)status.textContent='✓ Certificate content extracted. Review the fields before uploading.';return{fields};}
async function scanQrFile(file){const canvas=file.type==='application/pdf'||file.name.toLowerCase().endsWith('.pdf')?(await renderPdfFirstPage(file)).canvas:await imageToCanvas(file);const qr=scanQrCanvas(canvas);if(!qr)throw new Error('No QR code was detected.');if(!qr.startsWith('CCQR1.'))throw new Error('This QR code is not an encrypted CertiChain QR.');return api('/api/qr/decode',{method:'POST',body:JSON.stringify({qrData:qr})});}


function resultCard(r) {
  return '<div class="result success"><div class="result-head"><div><span class="badge ok">'+esc(r.sourceType || 'CERTIFICATE')+'</span><h3>'+esc(r.id)+'</h3></div><img class="qr" src="'+esc(r.qrDataUrl || '/api/certificates/'+encodeURIComponent(r.id)+'/qr')+'" alt="QR"></div>'+
    '<div class="kv"><b>Student</b><span>'+esc(r.studentName)+'</span><b>Course</b><span>'+esc(r.course)+'</span><b>Hash</b><span><code>'+esc(r.documentHash)+'</code></span><b>Transaction</b><span><code>'+esc(r.txHash)+'</code></span></div>'+
    '<div class="actions"><a class="primary linkbtn" href="/api/certificates/'+encodeURIComponent(r.id)+'/pdf" target="_blank">Download PDF</a><button type="button" class="ghost" data-print="'+esc(r.id)+'">Print</button><button type="button" class="ghost" data-email="'+esc(r.id)+'">Email</button></div></div>';
}

async function submitIssue(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button.primary');
  const result = $('#issueResult');
  setButtonBusy(button,true,'Issuing…');
  try {
    const values = Object.fromEntries(new FormData(form));
    if (!values.studentName.trim() || !values.studentEmail.trim() || !values.studentPassword || values.studentPassword.length < 8 || !values.course.trim() || !values.institution.trim() || !values.issueDate) {
      throw new Error('Fill all required fields. Student portal password must be at least 8 characters.');
    }
    const data = await api('/api/certificates/issue',{method:'POST',body:JSON.stringify(values)});
    result.innerHTML = resultCard(data);
    form.reset();
    if (form.institution) form.institution.value = 'Srinivas Institute of Technology';
    setToday(form);
    toast('Certificate issued and anchored to blockchain.');
    await loadCertificates();
    await refreshDashboard();
    showPage('dashboard');
  } catch (error) {
    result.innerHTML = '<div class="result failure">'+esc(error.message)+'</div>';
  } finally { setButtonBusy(button,false); }
}

async function submitUpload(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button.primary');
  const result = $('#uploadResult');
  setButtonBusy(button,true,'Uploading…');
  try {
    const fd = new FormData(form);
    const file = fd.get('file');
    if (!(file instanceof File) || !file.size) throw new Error('Select a PDF or image certificate.');
    if (file.size > 15*1024*1024) throw new Error('Maximum certificate file size is 15 MB.');
    if (!fd.get('studentName')?.trim() || !fd.get('studentEmail')?.trim() || !fd.get('studentPassword') || fd.get('studentPassword').length < 8 || !fd.get('course')?.trim() || !fd.get('institution')?.trim() || !fd.get('issueDate')) {
      throw new Error('Fill all required fields. Student portal password must be at least 8 characters.');
    }
    const data = await api('/api/certificates/upload',{method:'POST',body:JSON.stringify({
      fileName:file.name,fileMime:file.type,fileData:await fileData(file),
      studentName:fd.get('studentName'),studentEmail:fd.get('studentEmail'),studentPassword:fd.get('studentPassword'),
      course:fd.get('course'),institution:fd.get('institution'),issueDate:fd.get('issueDate'),grade:fd.get('grade') || ''
    })});
    result.innerHTML = resultCard(data);
    toast('Certificate uploaded and anchored to blockchain.');
    form.reset();
    if (form.institution) form.institution.value = 'Srinivas Institute of Technology';
    setToday(form);
    await loadCertificates();
    await refreshDashboard();
    showPage('dashboard');
  } catch (error) {
    result.innerHTML = '<div class="result failure">'+esc(error.message)+'</div>';
  } finally { setButtonBusy(button,false); }
}

async function searchVerifyCertificates() {
  const input = $('#verifySearch');
  const q = input?.value.trim() || '';
  const box = $('#verifySuggestions');
  if (!q) { toast('Enter a Certificate ID or Student Name.'); return; }
  try {
    const rows = await api('/api/certificates/search?q='+encodeURIComponent(q));
    if (!rows.length) { box.innerHTML = '<div class="verify-empty">No matching certificate found.</div>'; return; }
    box.innerHTML = rows.map(r =>
      '<button type="button" class="verify-option" data-select-cert="'+esc(r.id)+'"><b>'+esc(r.id)+'</b><span>'+esc(r.studentName)+' · '+esc(r.course)+'</span><small>'+esc(r.status)+'</small></button>'
    ).join('');
  } catch (error) { toast(error.message); }
}

async function selectVerifyCertificate(id) {
  const form = $('#verifyForm');
  if (!form) return;
  try {
    const cert = await api('/api/certificates/'+encodeURIComponent(id));
    form.style.display = 'block';
    form.certificateId.value = cert.id;
    if ($('#verifySelected')) $('#verifySelected').textContent = cert.studentName+' — '+cert.course;
    $('#verifySuggestions').innerHTML = '';
    toast('Certificate selected.');
  } catch (error) { toast(error.message); }
}

async function submitVerify(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button.primary');
  const result = $('#verifyResult');
  setButtonBusy(button,true,'Verifying…');
  try {
    const fd = new FormData(form);
    const payload = { certificateId:fd.get('certificateId') };
    const file = fd.get('file');
    if (file instanceof File && file.size) payload.documentData = await fileData(file);
    if (!payload.certificateId) throw new Error('Select or enter a Certificate ID first.');
    const data = await api('/api/verify',{method:'POST',body:JSON.stringify(payload)});
    const ok = !!data.valid;
    result.innerHTML = '<div class="result '+(ok?'success':'failure')+'"><div class="result-head"><div><span class="badge '+(ok?'ok':'bad')+'">'+esc(data.status)+'</span><h3>'+esc(data.message || (ok?'Certificate verified.':'Verification failed.'))+'</h3></div></div>'+
      (data.certificate ? '<div class="kv"><b>Certificate</b><span>'+esc(data.certificateId)+'</span><b>Student</b><span>'+esc(data.certificate.studentName)+'</span><b>Course</b><span>'+esc(data.certificate.course)+'</span><b>Institution</b><span>'+esc(data.certificate.institution)+'</span><b>Issue Date</b><span>'+esc(data.certificate.issueDate)+'</span><b>Blockchain hash</b><span>'+((data.checks?.blockchainHashMatch)?'MATCH':'MISMATCH')+'</span><b>Document check</b><span>'+(!data.checks?.documentChecked?'ID only — not uploaded':(data.checks?.databaseHashMatch?'MATCH':'MISMATCH'))+'</span><b>Revoked</b><span>'+((data.checks?.blockchainRevoked)?'YES':'NO')+'</span></div>' : '')+'</div>';
    await loadStats();
  } catch (error) {
    result.innerHTML = '<div class="result failure">'+esc(error.message)+'</div>';
  } finally { setButtonBusy(button,false); }
}

async function loadCertificates() {
  if (role !== 'admin') return;
  try {
    certificates = await api('/api/certificates');
    renderCertificates(certificates);
  } catch (error) { toast(error.message); }
}

function renderCertificates(rows) {
  const box = $('#certRows');
  if (!box) return;
  box.innerHTML = rows.map(r =>
    '<tr><td><b>'+esc(r.id)+'</b></td><td>'+esc(r.studentName)+'</td><td>'+esc(r.course)+'</td><td>'+esc(r.issueDate)+'</td><td><span class="badge '+(r.status==='ACTIVE'?'ok':'bad')+'">'+esc(r.status)+'</span></td><td>'+
    '<button type="button" class="mini" data-open-cert="'+esc(r.id)+'">Verify</button> '+
    '<a class="mini linkmini" href="/api/certificates/'+encodeURIComponent(r.id)+'/pdf" target="_blank">PDF</a> '+
    (r.status==='ACTIVE'?'<button type="button" class="mini" data-email="'+esc(r.id)+'">Email</button><button type="button" class="mini danger" data-revoke="'+esc(r.id)+'">Revoke</button>':'')+
    '</td></tr>'
  ).join('') || '<tr><td colspan="6">No certificates yet.</td></tr>';
}

async function revokeCert(id) {
  if (!confirm('Revoke certificate '+id+'? This action is permanent on the blockchain.')) return;
  try {
    await api('/api/certificates/'+encodeURIComponent(id)+'/revoke',{method:'POST'});
    toast('Certificate revoked.');
    await loadCertificates();
    await loadStats();
  } catch (error) { toast(error.message); }
}

async function emailCert(id) {
  try {
    const data = await api('/api/certificates/'+encodeURIComponent(id)+'/email',{method:'POST'});
    toast(data.message || 'Certificate emailed.');
  } catch (error) { toast(error.message); }
}

function printCert(id) {
  const win = window.open('/api/certificates/'+encodeURIComponent(id)+'/pdf','_blank');
  if (win) setTimeout(() => { try { win.print(); } catch {} }, 1400);
}

async function loadStudent() {
  try {
    const rows = await api('/api/student/certificates');
    $('#studentCards').innerHTML = rows.map(r =>
      '<div class="student-card"><span class="badge '+(r.status==='ACTIVE'?'ok':'bad')+'">'+esc(r.status)+'</span><h3>'+esc(r.course)+'</h3><p>'+esc(r.institution)+'</p><p><b>'+esc(r.id)+'</b> · '+esc(r.issueDate)+'</p><div class="actions"><a class="primary linkbtn" href="/api/certificates/'+encodeURIComponent(r.id)+'/pdf" target="_blank">Download PDF</a><button type="button" class="ghost" data-print="'+esc(r.id)+'">Print</button><button type="button" class="ghost" data-share="'+esc(r.id)+'">Copy Verify Link</button></div></div>'
    ).join('') || '<div class="card">No certificates found for this account.</div>';
  } catch (error) { toast(error.message); }
}

async function loadAudit() {
  if (role !== 'admin') return;
  try {
    const rows = await api('/api/audit');
    $('#auditRows').innerHTML = rows.map(r =>
      '<tr><td>'+esc(new Date(r.createdAt).toLocaleString())+'</td><td>'+esc(r.certificateId || '-')+'</td><td>'+esc(r.action)+'</td><td>'+esc(r.result)+'</td></tr>'
    ).join('') || '<tr><td colspan="4">No audit events.</td></tr>';
  } catch (error) { toast(error.message); }
}

function setToday(form) {
  const input = form?.querySelector('[name="issueDate"]');
  if (input && !input.value) input.value = new Date().toISOString().slice(0,10);
}

function bindForms() {
  $('#loginForm')?.addEventListener('submit', login);
  $('#logout')?.addEventListener('click', logout);
  $('#dashboardRefresh')?.addEventListener('click', refreshDashboard);
  $('#issueForm')?.addEventListener('submit', submitIssue);
  $('#uploadForm')?.addEventListener('submit', submitUpload);
  $('#uploadFile')?.addEventListener('change', async e=>{const file=e.target.files?.[0];if(!file)return;try{await extractCertificateFromFile(file,$('#uploadForm'),$('#uploadExtractStatus'));}catch(err){$('#uploadExtractStatus').textContent='Extraction failed: '+err.message;toast(err.message);}});
  $('#qrVerifyFile')?.addEventListener('change',async e=>{const file=e.target.files?.[0];if(!file)return;const s=$('#qrScanStatus');if(s)s.textContent='Scanning encrypted QR…';try{const d=await scanQrFile(file),c=d.certificate;$('#verifyResult').innerHTML='<div class="result success"><div class="result-head"><div><span class="badge ok">QR VERIFIED</span><h3>'+esc(d.message)+'</h3></div></div><div class="kv"><b>Certificate</b><span>'+esc(c.id)+'</span><b>Student</b><span>'+esc(c.studentName)+'</span><b>Email</b><span>'+esc(c.studentEmail)+'</span><b>Course</b><span>'+esc(c.course)+'</span><b>Institution</b><span>'+esc(c.institution)+'</span><b>Issued Date</b><span>'+esc(c.issueDate)+'</span><b>Grade / Result</b><span>'+esc(c.grade||'—')+'</span></div></div>';if(s)s.textContent='✓ Encrypted QR verified by CertiChain.';}catch(err){if(s)s.textContent='QR scan failed: '+err.message;toast(err.message);}});
  $('#verifyForm')?.addEventListener('submit', submitVerify);
  $('#verifySearchBtn')?.addEventListener('click', searchVerifyCertificates);
  $('#verifyClearBtn')?.addEventListener('click', () => {
    $('#verifySearch').value = '';
    $('#verifySuggestions').innerHTML = '';
    $('#verifyResult').innerHTML = '';
    $('#verifyForm').style.display = 'none';
  });
  $('#search')?.addEventListener('input', event => {
    const q = event.target.value.trim().toLowerCase();
    renderCertificates(certificates.filter(r => Object.values(r).some(v => String(v ?? '').toLowerCase().includes(q))));
  });
  $$('.login-tab').forEach(button => button.addEventListener('click', () => {
    $$('.login-tab').forEach(b => b.classList.remove('active'));
    button.classList.add('active');
    loginRole = button.dataset.role || 'admin';
    const hint = $('#loginHint');
    if (hint) hint.textContent = loginRole === 'admin' ? 'Use the admin credentials configured in your local .env file.' : 'Use the student email and portal password set by the certificate issuer.';
  }));

  document.addEventListener('click', async event => {
    const nav = event.target.closest('.nav');
    const go = event.target.closest('[data-go]');
    const select = event.target.closest('[data-select-cert]');
    const open = event.target.closest('[data-open-cert]');
    const revoke = event.target.closest('[data-revoke]');
    const email = event.target.closest('[data-email]');
    const print = event.target.closest('[data-print]');
    const share = event.target.closest('[data-share]');

    if (nav) { event.preventDefault(); showPage(nav.dataset.page); return; }
    if (go) { event.preventDefault(); showPage(go.dataset.go); return; }
    if (select) { event.preventDefault(); await selectVerifyCertificate(select.dataset.selectCert); return; }
    if (open) { event.preventDefault(); showPage('verify'); await selectVerifyCertificate(open.dataset.openCert); return; }
    if (revoke) { event.preventDefault(); await revokeCert(revoke.dataset.revoke); return; }
    if (email) { event.preventDefault(); await emailCert(email.dataset.email); return; }
    if (print) { event.preventDefault(); printCert(print.dataset.print); return; }
    if (share) {
      event.preventDefault();
      const id = share.dataset.share;
      const url = location.origin+'/?verify='+encodeURIComponent(id);
      try {
        await navigator.clipboard.writeText(url);
        toast('Verification link copied.');
      } catch { toast(url); }
    }
  });
}

function init() {
  setToday($('#issueForm'));
  setToday($('#uploadForm'));
  bindNavigation();
  bindForms();
  boot();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once:true });
else init();