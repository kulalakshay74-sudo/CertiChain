const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Tiny .env loader so the project works without an extra runtime dependency.
function loadDotEnv() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const raw of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx < 1) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
loadDotEnv();

const express = require('express');
const cors = require('cors');
const QRCode = require('qrcode');
const PDFDocument = require('pdfkit');
const nodemailer = require('nodemailer');
const { ethers } = require('ethers');

const PORT = Number(process.env.PORT || 3000);
const RPC_URL = process.env.RPC_URL || 'http://127.0.0.1:8545';
const SESSION_SECRET = process.env.SESSION_SECRET;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const ISSUER_PRIVATE_KEY = process.env.ISSUER_PRIVATE_KEY;

if (!SESSION_SECRET || SESSION_SECRET.length < 32) throw new Error('SESSION_SECRET is missing or too short. Set a random value of at least 32 characters in .env.');
if (!ADMIN_EMAIL || !ADMIN_PASSWORD || ADMIN_PASSWORD.length < 8) throw new Error('ADMIN_EMAIL and ADMIN_PASSWORD are required in .env; ADMIN_PASSWORD must be at least 8 characters.');
if (!ISSUER_PRIVATE_KEY || !/^0x[0-9a-fA-F]{64}$/.test(ISSUER_PRIVATE_KEY)) throw new Error('ISSUER_PRIVATE_KEY is required in .env for the local issuer account.');

const app = express();
app.disable('x-powered-by');
app.use(cors());
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const DATA_PATH = path.join(__dirname, 'certichain-data.json');
const UPLOAD_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

function loadData() {
  if (!fs.existsSync(DATA_PATH)) return { certificates: [], auditLogs: [] };
  try {
    const d = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
    return { certificates: Array.isArray(d.certificates) ? d.certificates : [], auditLogs: Array.isArray(d.auditLogs) ? d.auditLogs : [] };
  } catch {
    return { certificates: [], auditLogs: [] };
  }
}
let data = loadData();
function saveData() {
  const tmp = `${DATA_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, DATA_PATH);
}
function findCertificate(id) { return data.certificates.find(c => c.id === id); }
function publicCertificate(c) {
  if (!c) return c;
  const { studentPasswordHash, filePath, ...safe } = c;
  return safe;
}
function safeError(e) { return e?.shortMessage || e?.reason || e?.message || 'Request failed'; }
function log(certificateId, action, result, req) {
  data.auditLogs.unshift({ id: crypto.randomUUID(), certificateId: certificateId || null, action, result: result || '', createdAt: new Date().toISOString(), ip: req.ip });
  data.auditLogs = data.auditLogs.slice(0, 1000);
  saveData();
}

const deploymentPath = path.join(__dirname, 'deployment.json');
if (!fs.existsSync(deploymentPath)) throw new Error('deployment.json not found. Run npm run dev first.');
const deployment = JSON.parse(fs.readFileSync(deploymentPath, 'utf8'));
const provider = new ethers.JsonRpcProvider(RPC_URL);
const wallet = new ethers.Wallet(ISSUER_PRIVATE_KEY, provider);
const registry = new ethers.Contract(deployment.address, deployment.abi, wallet);

function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function makeCertificateId() { return `CERT-${new Date().getFullYear()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`; }
function canonicalPayload(d) { return JSON.stringify({ studentName: d.studentName, studentEmail: d.studentEmail || '', course: d.course, institution: d.institution, issueDate: d.issueDate, grade: d.grade || '' }); }
function hashPassword(password) { return crypto.scryptSync(password, SESSION_SECRET, 64).toString('hex'); }
function passwordMatches(password, hash) {
  if (!password || !hash) return false;
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(hashPassword(password), 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function tokenFor(role, email) {
  const payload = Buffer.from(JSON.stringify({ role, email, exp: Date.now() + 8 * 60 * 60 * 1000 })).toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}
function auth(req) {
  const h = req.headers.authorization || '';
  if (!h.startsWith('Bearer ')) return null;
  const parts = h.slice(7).split('.');
  if (parts.length !== 2) return null;
  try {
    const expected = crypto.createHmac('sha256', SESSION_SECRET).update(parts[0]).digest('base64url');
    if (expected !== parts[1]) return null;
    const p = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
    if (!p.exp || p.exp < Date.now()) return null;
    return p;
  } catch { return null; }
}
function requireAdmin(req, res, next) {
  const u = auth(req);
  if (!u || u.role !== 'admin') return res.status(401).json({ error: 'Admin login required.' });
  req.user = u; next();
}
function requireUser(req, res, next) {
  const u = auth(req);
  if (!u) return res.status(401).json({ error: 'Login required.' });
  req.user = u; next();
}
function verificationUrl(req, id) {
  const base = (process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
  return `${base}/?verify=${encodeURIComponent(id)}`;
}
async function makeQr(req, id) { return QRCode.toDataURL(verificationUrl(req, id), { width: 360, margin: 2 }); }
function dataUrlToBuffer(dataUrl) {
  const match = /^data:[^;]+;base64,(.+)$/i.exec(dataUrl || '');
  if (!match) throw new Error('Invalid base64 file data.');
  return Buffer.from(match[1], 'base64');
}
function validateUpload(fileName, mime, bytes) {
  const allowedMime = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/webp']);
  const ext = path.extname(fileName || '').toLowerCase();
  const allowedExt = new Set(['.pdf', '.png', '.jpg', '.jpeg', '.webp']);
  if (!allowedExt.has(ext)) throw new Error('Only PDF, PNG, JPG/JPEG and WEBP certificates are allowed.');
  if (mime && !allowedMime.has(mime)) throw new Error('Unsupported certificate file type. Use PDF, PNG, JPG/JPEG or WEBP.');
  if (!bytes.length || bytes.length > 15 * 1024 * 1024) throw new Error('Certificate file must be between 1 byte and 15 MB.');
}
function pdfBuffer(row, qrDataUrl) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.fontSize(30).fillColor('#3328a8').text('CERTICHAIN', { align: 'center' });
    doc.fontSize(12).fillColor('#666').text('BLOCKCHAIN-VERIFIED DIGITAL CERTIFICATE', { align: 'center' });
    doc.moveDown(2).fontSize(18).fillColor('#111').text('Certificate of Achievement', { align: 'center' });
    doc.moveDown().fontSize(24).fillColor('#3328a8').text(row.studentName, { align: 'center' });
    doc.moveDown().fontSize(13).fillColor('#333').text(`has successfully completed ${row.course}`, { align: 'center' });
    doc.moveDown(.6).text(`Issued by ${row.institution} on ${row.issueDate}`, { align: 'center' });
    if (row.grade) doc.text(`Result / Grade: ${row.grade}`, { align: 'center' });
    doc.moveDown(2).fontSize(11).fillColor('#555').text(`Certificate ID: ${row.id}`, { align: 'center' });
    doc.text(`Blockchain transaction: ${row.txHash}`, { align: 'center' });
    doc.text(`SHA-256 fingerprint: ${row.documentHash}`, { align: 'center', width: 500 });
    try { doc.image(Buffer.from(qrDataUrl.split(',')[1], 'base64'), 225, 570, { width: 140 }); } catch {}
    doc.fontSize(9).fillColor('#777').text('Scan the QR code to verify this certificate against the blockchain.', 70, 720, { align: 'center', width: 460 });
    doc.end();
  });
}
async function sendEmail(row, pdf) {
  if (!row.studentEmail) throw new Error('Student email is required.');
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASSWORD) throw new Error('SMTP is not configured. Set SMTP_HOST, SMTP_USER and SMTP_PASSWORD in .env.');
  const transporter = nodemailer.createTransport({ host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT || 587), secure: String(process.env.SMTP_SECURE) === 'true', auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } });
  await transporter.sendMail({ from: process.env.SMTP_FROM || process.env.SMTP_USER, to: row.studentEmail, subject: `Your CertiChain certificate — ${row.id}`, text: `Your certificate ${row.id} is attached. Verify it at ${row.verificationUrl}.`, attachments: [{ filename: `${row.id}.pdf`, content: pdf }] });
}
async function anchorCertificate(row, req) {
  const tx = await registry.issueCertificate(row.id, row.blockchainHash);
  const receipt = await tx.wait();
  row.txHash = receipt.hash;
  row.issuerAddress = wallet.address;
  row.contractAddress = deployment.address;
  row.createdAt = new Date().toISOString();
  row.verificationUrl = verificationUrl(req, row.id);
  row.qrDataUrl = await makeQr(req, row.id);
  saveData();
  return row;
}

app.get('/api/health', async (req, res) => {
  try { const block = await provider.getBlockNumber(); res.json({ ok: true, blockchain: 'connected', block, contract: deployment.address, issuer: wallet.address }); }
  catch (e) { res.status(503).json({ ok: false, blockchain: 'offline', error: safeError(e) }); }
});
app.get('/api/stats', requireAdmin, (req, res) => {
  const total = data.certificates.length;
  res.json({ total, active: data.certificates.filter(c => c.status === 'ACTIVE').length, revoked: data.certificates.filter(c => c.status === 'REVOKED').length, verifications: data.auditLogs.filter(a => a.action === 'VERIFY').length, students: new Set(data.certificates.map(c => c.studentEmail).filter(Boolean)).size });
});
app.post('/api/auth/login', (req, res) => {
  const { email = '', password = '', role } = req.body || {};
  if (role === 'admin') {
    if (email.toLowerCase() === ADMIN_EMAIL.toLowerCase() && passwordMatches(password, hashPassword(ADMIN_PASSWORD))) return res.json({ token: tokenFor('admin', email.toLowerCase()), role: 'admin', email: email.toLowerCase() });
    return res.status(401).json({ error: 'Invalid admin credentials.' });
  }
  if (role === 'student') {
    const student = data.certificates.find(c => (c.studentEmail || '').toLowerCase() === email.toLowerCase() && c.studentPasswordHash);
    if (student && passwordMatches(password, student.studentPasswordHash)) return res.json({ token: tokenFor('student', email.toLowerCase()), role: 'student', email: email.toLowerCase() });
    return res.status(401).json({ error: 'Invalid student credentials. The student portal password is set by the issuer when the certificate is created.' });
  }
  return res.status(400).json({ error: 'Invalid login role.' });
});
app.get('/api/me', requireUser, (req, res) => res.json({ role: req.user.role, email: req.user.email }));
app.get('/api/certificates', requireAdmin, (req, res) => res.json(data.certificates.map(publicCertificate)));
app.get('/api/student/certificates', requireUser, (req, res) => {
  if (req.user.role !== 'student') return res.status(403).json({ error: 'Student access only.' });
  res.json(data.certificates.filter(c => (c.studentEmail || '').toLowerCase() === req.user.email.toLowerCase()).map(publicCertificate));
});
app.get('/api/certificates/search', requireAdmin, (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase();
  if (!q) return res.json([]);
  const rows = data.certificates.filter(c =>
    String(c.id || '').toLowerCase().includes(q) ||
    String(c.studentName || '').toLowerCase().includes(q)
  ).slice(0, 20);
  res.json(rows.map(publicCertificate));
});

app.get('/api/certificates/:id', (req, res) => {
  const row = findCertificate(req.params.id);
  if (!row) return res.status(404).json({ error: 'Certificate not found' });
  res.json(publicCertificate(row));
});
app.get('/api/certificates/:id/qr', async (req, res) => {
  try { const row = findCertificate(req.params.id); if (!row) return res.status(404).send('Certificate not found'); res.type('png'); res.send(await QRCode.toBuffer(verificationUrl(req, row.id), { width: 360, margin: 2 })); }
  catch (e) { res.status(500).send(safeError(e)); }
});

app.post('/api/certificates/issue', requireAdmin, async (req, res) => {
  try {
    const { studentName, studentEmail = '', studentPassword = '', course, institution, issueDate, grade = '' } = req.body || {};
    if (!studentName || !course || !institution || !issueDate) return res.status(400).json({ error: 'Student name, course, institution and issue date are required.' });
    if (!studentEmail || !studentPassword || studentPassword.length < 8) return res.status(400).json({ error: 'Student email and a student portal password of at least 8 characters are required.' });
    const payload = canonicalPayload({ studentName, studentEmail, course, institution, issueDate, grade });
    const documentHash = sha256(payload);
    const row = { id: makeCertificateId(), studentName, studentEmail, course, institution, issueDate, grade, status: 'ACTIVE', documentHash, blockchainHash: ethers.keccak256(ethers.toUtf8Bytes(documentHash)), sourceType: 'GENERATED', studentPasswordHash: hashPassword(studentPassword) };
    await anchorCertificate(row, req); data.certificates.push(row); row.studentPasswordSet = true; saveData();
    log(row.id, 'ISSUE', 'SUCCESS', req); res.status(201).json(publicCertificate(row));
  } catch (e) { console.error(e); res.status(500).json({ error: safeError(e) }); }
});

app.post('/api/certificates/upload', requireAdmin, async (req, res) => {
  try {
    const { fileName, fileMime, fileData, studentName, studentEmail = '', studentPassword = '', course, institution, issueDate, grade = '' } = req.body || {};
    if (!fileData || !studentName || !course || !institution || !issueDate) return res.status(400).json({ error: 'Certificate file, student name, course, institution and issue date are required.' });
    if (!studentEmail || !studentPassword || studentPassword.length < 8) return res.status(400).json({ error: 'Student email and a student portal password of at least 8 characters are required.' });
    const raw = dataUrlToBuffer(fileData);
    validateUpload(fileName, fileMime, raw);
    const id = makeCertificateId();
    const documentHash = sha256(raw);
    const safe = (fileName || `${id}.pdf`).replace(/[^a-zA-Z0-9._-]/g, '_');
    const saved = path.join(UPLOAD_DIR, `${id}-${safe}`);
    fs.writeFileSync(saved, raw);
    const row = { id, studentName, studentEmail, course, institution, issueDate, grade, status: 'ACTIVE', documentHash, blockchainHash: ethers.keccak256(ethers.toUtf8Bytes(documentHash)), sourceType: 'UPLOADED', fileName: safe, fileMime, filePath: path.relative(__dirname, saved), studentPasswordHash: hashPassword(studentPassword) };
    try { await anchorCertificate(row, req); } catch (e) { fs.rmSync(saved, { force: true }); throw e; }
    data.certificates.push(row);
    row.studentPasswordSet = true; saveData();
    log(row.id, 'UPLOAD', 'SUCCESS', req); res.status(201).json(publicCertificate(row));
  } catch (e) { console.error(e); res.status(500).json({ error: safeError(e) }); }
});

app.post('/api/certificates/:id/revoke', requireAdmin, async (req, res) => {
  try {
    const row = findCertificate(req.params.id); if (!row) return res.status(404).json({ error: 'Certificate not found' });
    if (row.status === 'REVOKED') return res.status(400).json({ error: 'Certificate already revoked.' });
    const tx = await registry.revokeCertificate(row.id); const receipt = await tx.wait();
    row.status = 'REVOKED'; row.revokedAt = new Date().toISOString(); row.revokeTxHash = receipt.hash; saveData();
    log(row.id, 'REVOKE', `SUCCESS:${receipt.hash}`, req); res.json({ ok: true, txHash: receipt.hash });
  } catch (e) { res.status(500).json({ error: safeError(e) }); }
});

app.post('/api/verify', async (req, res) => {
  try {
    const { certificateId, documentData } = req.body || {};
    if (!certificateId) return res.status(400).json({ error: 'Certificate ID is required.' });

    const local = findCertificate(certificateId);
    if (!local) {
      log(certificateId, 'VERIFY', 'NOT_FOUND', req);
      return res.json({ valid: false, status: 'NOT_FOUND', message: 'No certificate with this ID exists.' });
    }

    let chain;
    try {
      chain = await registry.getCertificate(certificateId);
    } catch {
      log(certificateId, 'VERIFY', 'BLOCKCHAIN_NOT_FOUND', req);
      return res.json({ valid: false, status: 'BLOCKCHAIN_NOT_FOUND', message: 'Certificate is not present on the blockchain.' });
    }

    const storedBlockchainHash = String(chain[0]).toLowerCase();
    const localBlockchainHash = String(local.blockchainHash).toLowerCase();
    const blockchainRecordMatches = storedBlockchainHash === localBlockchainHash;
    const revoked = Boolean(chain[3]);

    // ID-only verification checks the database record against the blockchain record.
    // If the original document is supplied, also verify its exact SHA-256 bytes.
    let documentChecked = false;
    let documentMatches = true;
    if (documentData) {
      documentChecked = true;
      const submittedHash = sha256(dataUrlToBuffer(documentData));
      documentMatches = submittedHash.toLowerCase() === String(local.documentHash).toLowerCase();
    }

    const valid = blockchainRecordMatches && documentMatches && !revoked;
    const status = valid ? 'AUTHENTIC' : (revoked ? 'REVOKED' : (documentChecked && !documentMatches ? 'TAMPERED' : 'BLOCKCHAIN_MISMATCH'));

    log(certificateId, 'VERIFY', status, req);

    res.json({
      valid,
      status,
      certificateId,
      message: valid
        ? (documentChecked ? 'Certificate ID and supplied document match the blockchain record.' : 'Certificate ID matches the blockchain record.')
        : 'Certificate verification failed.',
      certificate: {
        studentName: local.studentName,
        studentEmail: local.studentEmail,
        course: local.course,
        institution: local.institution,
        issueDate: local.issueDate,
        grade: local.grade,
        sourceType: local.sourceType
      },
      checks: {
        databaseHashMatch: documentChecked ? documentMatches : true,
        blockchainHashMatch: blockchainRecordMatches,
        blockchainRevoked: revoked,
        documentChecked,
        issuer: chain[1],
        issuedAt: Number(chain[2])
      }
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: safeError(e) });
  }
});
app.get('/api/certificates/:id/pdf', async (req, res) => {
  try {
    const row = findCertificate(req.params.id); if (!row) return res.status(404).send('Certificate not found');
    const qr = await makeQr(req, row.id); const pdf = await pdfBuffer(row, qr);
    res.setHeader('Content-Type', 'application/pdf'); res.setHeader('Content-Disposition', `attachment; filename="${row.id}.pdf"`); res.send(pdf);
  } catch (e) { res.status(500).send(safeError(e)); }
});
app.post('/api/certificates/:id/email', requireAdmin, async (req, res) => {
  try {
    const row = findCertificate(req.params.id); if (!row) return res.status(404).json({ error: 'Certificate not found' });
    row.verificationUrl = verificationUrl(req, row.id); const pdf = await pdfBuffer(row, await makeQr(req, row.id)); await sendEmail(row, pdf);
    log(row.id, 'EMAIL', 'SENT', req); res.json({ ok: true, message: `Certificate emailed to ${row.studentEmail}` });
  } catch (e) { res.status(500).json({ error: safeError(e) }); }
});
app.get('/api/audit', requireAdmin, (req, res) => res.json(data.auditLogs.slice(0, 100)));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => console.log(`CertiChain running at http://localhost:${PORT}`));
