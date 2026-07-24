require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const db = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;
const TOKEN_SECRET = process.env.TOKEN_SECRET || (() => {
  const fs = require('fs');
  const secretFile = path.join(__dirname, '.token_secret');
  try { return fs.readFileSync(secretFile, 'utf8'); } catch (_) {}
  const s = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(secretFile, s);
  return s;
})();
const TOKEN_EXPIRY = 24 * 60 * 60 * 1000;

const NIMIQ_RPC_URL = 'https://rpc.nimiqwatch.com';

const CLOUDFLARE_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID || '';
const CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN || '';

const IMAGES_DIR = path.join(__dirname, 'public', 'images');
if (!fs.existsSync(IMAGES_DIR)) fs.mkdirSync(IMAGES_DIR, { recursive: true });

// ===== RATE LIMITER =====
const rateLimits = new Map();
function rateLimit(ip, limit = 5, windowMs = 60000) {
  const now = Date.now();
  const entry = rateLimits.get(ip) || { count: 0, resetAt: now + windowMs };
  if (now > entry.resetAt) { entry.count = 0; entry.resetAt = now + windowMs; }
  entry.count++;
  rateLimits.set(ip, entry);
  return entry.count > limit;
}
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateLimits) { if (now > entry.resetAt) rateLimits.delete(ip); }
}, 60000);

// ===== SESSIONS =====
const sessions = new Map();
function createSession(walletAddress) {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = Date.now() + TOKEN_EXPIRY;
  const sig = crypto.createHmac('sha256', TOKEN_SECRET).update(`${token}:${walletAddress}:${expires}`).digest('hex');
  sessions.set(token, { walletAddress, expires, sig });
  return { token, expires };
}
function validateSession(token) {
  if (!token) return null;
  const s = sessions.get(token);
  if (!s || Date.now() > s.expires) { sessions.delete(token); return null; }
  const expectedSig = crypto.createHmac('sha256', TOKEN_SECRET).update(`${token}:${s.walletAddress}:${s.expires}`).digest('hex');
  if (s.sig !== expectedSig) { sessions.delete(token); return null; }
  return s.walletAddress;
}
setInterval(() => {
  const now = Date.now();
  for (const [token, s] of sessions) { if (now > s.expires) sessions.delete(token); }
}, 300000);

// ===== NONCES =====
const loginNonces = new Map();
function randomNonce() { return crypto.randomBytes(16).toString('hex'); }
function loginMessage(nonce) { return `Sign in to NIMGA\nNonce: ${nonce}`; }
setInterval(() => {
  const now = Date.now();
  for (const [nonce, entry] of loginNonces) { if (now - entry.createdAt > 120000) loginNonces.delete(nonce); }
}, 60000);

function normalizeAddress(addr) { return addr ? addr.replace(/\s/g, '') : ''; }

function toUserFriendlyAddress(raw) {
  const clean = normalizeAddress(raw);
  if (!clean || !clean.startsWith('NQ') || clean.length < 34 || clean.length > 40) return null;
  const parts = [clean.substring(0, 4)];
  for (let i = 4; i < clean.length; i += 4) {
    parts.push(clean.substring(i, i + 4));
  }
  return parts.join(' ');
}

const RECIPIENT_RAW = normalizeAddress(process.env.RECIPIENT_ADDRESS || '');
const RECIPIENT_FRIENDLY = toUserFriendlyAddress(RECIPIENT_RAW);
if (!RECIPIENT_FRIENDLY) {
  console.error('WARNING: RECIPIENT_ADDRESS in .env is not a valid Nimiq address. Payments will not work.');
  console.error('Set RECIPIENT_ADDRESS to your Nimiq wallet address (e.g. NQ27 9CG2 XP33 N5NH 29EP 2YUS LMKV 3EM0 R4DJ)');
} else {
  console.log(`Payment recipient: ${RECIPIENT_FRIENDLY}`);
}

function verifySignedLogin({ address, publicKey, signature, nonce }) {
  const wallet = normalizeAddress(address || '');
  if (!wallet || !nonce) return false;
  if (!loginNonces.has(nonce)) return false;
  try {
    return Array.isArray(signature) && signature.length > 0;
  } catch (err) {
    console.error('Wallet verification error:', err);
    return false;
  }
}

function requireAuth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  const wallet = validateSession(token);
  if (!wallet) return res.status(401).json({ error: 'Unauthorized' });
  req.walletAddress = wallet;
  next();
}

let serverReady = false;
const startServer = async () => {
  await db.initDb();
  serverReady = true;
  console.log('Database initialized');
};

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use((req, res, next) => {
  if (!serverReady) return res.status(503).json({ error: 'Server still initializing' });
  next();
});

// ===== AUTH =====
app.get('/auth/nonce', (req, res) => {
  try {
    const ip = req.ip;
    if (rateLimit(ip, 5, 60000)) return res.status(429).json({ success: false, message: 'Too many attempts. Wait a minute.' });
    const nonce = randomNonce();
    loginNonces.set(nonce, { createdAt: Date.now() });
    return res.json({ success: true, nonce, message: loginMessage(nonce) });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Could not generate login challenge' });
  }
});

app.post('/auth/verify', (req, res) => {
  try {
    const ip = req.ip;
    if (rateLimit(ip, 5, 60000)) return res.status(429).json({ success: false, message: 'Too many attempts. Wait a minute.' });
    const { address, label, publicKey, signature, nonce } = req.body || {};
    const wallet = normalizeAddress(address || '');
    if (!wallet || !nonce || !publicKey || !signature) {
      return res.status(400).json({ success: false, message: 'Missing wallet signature payload' });
    }
    const nonceEntry = loginNonces.get(nonce);
    if (!nonceEntry) return res.status(400).json({ success: false, message: 'Login challenge expired. Please try again.' });
    const valid = verifySignedLogin({ address: wallet, publicKey, signature, nonce });
    loginNonces.delete(nonce);
    if (!valid) return res.status(401).json({ success: false, message: 'Signature verification failed' });

    const user = db.getOrCreateUser(wallet);
    const session = createSession(wallet);
    return res.json({
      success: true,
      token: session.token,
      expires: session.expires,
      walletAddress: wallet,
      freeRemaining: db.getRemainingFree(wallet),
      credits: user.credits,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: err.message || 'Wallet verification failed' });
  }
});

app.post('/auth/logout', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (token) sessions.delete(token);
  res.json({ success: true });
});

// ===== NIMIQ RPC VERIFICATION =====
async function fetchNimiqTransaction(txHash) {
  const response = await fetch(NIMIQ_RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getTransactionByHash', params: [txHash] }),
  });
  if (!response.ok) throw new Error(`RPC request failed with ${response.status}`);
  const payload = await response.json();
  if (payload.error) throw new Error(payload.error.message || 'RPC error');
  return (payload.result && payload.result.data) || payload.result || null;
}

async function verifyNimiqPayment(txHash, expectedAmountLuna) {
  if (!txHash) return { ok: false, reason: 'Missing transaction hash' };
  try {
    const tx = await fetchNimiqTransaction(txHash);
    if (!tx) return { ok: false, reason: 'Transaction not found on-chain yet' };
    const txValue = Number(tx.value);
    if (!Number.isFinite(txValue) || txValue < expectedAmountLuna) {
      return { ok: false, reason: `Insufficient amount: got ${txValue}, need ${expectedAmountLuna} Luna` };
    }
    return { ok: true, tx };
  } catch (err) {
    return { ok: false, reason: 'Could not verify transaction: ' + err.message };
  }
}

// ===== PROTECTED ROUTES =====
app.get('/api/prices', (req, res) => {
  res.json({
    10: { nimiq: 1000, label: '10 Credits' },
    100: { nimiq: 10000, label: '100 Credits' },
    1000: { nimiq: 100000, label: '1000 Credits' },
  });
});

app.post('/api/generate', requireAuth, async (req, res) => {
  const walletAddress = req.walletAddress;
  const { prompt, visibility } = req.body;
  if (!prompt) return res.status(400).json({ error: 'Prompt required' });
  const vis = visibility === 'private' ? 'private' : 'public';

  const user = db.getUser(walletAddress);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const remainingFree = db.getRemainingFree(walletAddress);
  let usedFree = false;
  if (remainingFree > 0) { db.useFreeGeneration(walletAddress); usedFree = true; }
  else if (user.credits >= 1) { db.useCredit(walletAddress); }
  else return res.status(403).json({ error: 'No credits remaining.', freeRemaining: 0, credits: user.credits });

  try {
    if (!CLOUDFLARE_ACCOUNT_ID || CLOUDFLARE_ACCOUNT_ID === 'your_cloudflare_account_id_here') {
      throw new Error('Cloudflare credentials not configured. Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN in .env');
    }

    const cfRes = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/ai/run/@cf/stabilityai/stable-diffusion-xl-base-1.0`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${CLOUDFLARE_API_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ prompt }),
      }
    );

    const buffer = Buffer.from(await cfRes.arrayBuffer());

    if (!cfRes.ok) {
      let errMsg = 'Cloudflare AI request failed';
      try {
        const errJson = JSON.parse(buffer.toString());
        errMsg = errJson.errors?.[0]?.message || errMsg;
      } catch (_) {}
      console.error('Cloudflare AI error:', cfRes.status, errMsg);
      throw new Error(errMsg);
    }

    const base64 = buffer.toString('base64');
    const filename = `gen-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.png`;
    const filePath = path.join(IMAGES_DIR, filename);
    fs.writeFileSync(filePath, buffer);
    const imageUrl = `/images/${filename}`;

    const genId = db.saveGeneration(walletAddress, prompt, imageUrl, vis);
    galleryCache.new = null;
    galleryCache.top = null;
    const updatedUser = db.getUser(walletAddress);
    res.json({ id: genId, imageUrl, prompt, usedFree, freeRemaining: db.getRemainingFree(walletAddress), credits: updatedUser.credits });
  } catch (err) {
    console.error('Generation error:', err.message || err);
    if (usedFree) db.reverseFreeGeneration(walletAddress); else db.reverseCredit(walletAddress);
    res.status(500).json({ error: err.message || 'Generation failed. Please try again.' });
  }
});

app.get('/api/history', requireAuth, (req, res) => {
  const gens = db.getGenerations(req.walletAddress);
  res.json(gens.map(g => ({ id: g.id, prompt: g.prompt, image_url: g.image_url, visibility: g.visibility, votes: g.votes, created_at: g.created_at })));
});

app.delete('/api/history/:id', requireAuth, (req, res) => {
  const { id } = req.params;
  const gen = db.query('SELECT * FROM generations WHERE id = ? AND wallet_address = ?', [id, req.walletAddress]);
  if (!gen.length) return res.status(404).json({ error: 'Not found' });
  db.execute('DELETE FROM generations WHERE id = ? AND wallet_address = ?', [id, req.walletAddress]);
  res.json({ success: true });
});

app.get('/api/user', requireAuth, (req, res) => {
  const user = db.getUser(req.walletAddress);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({
    walletAddress: user.wallet_address,
    freeRemaining: db.getRemainingFree(req.walletAddress),
    credits: user.credits,
    createdAt: user.created_at,
  });
});

app.post('/api/buy-credits', requireAuth, (req, res) => {
  const { package: pkg } = req.body;
  const CREDIT_PRICES = { 10: 1000, 100: 10000, 1000: 100000 };
  if (!CREDIT_PRICES[pkg]) return res.status(400).json({ error: 'Invalid package' });
  if (!RECIPIENT_FRIENDLY) return res.status(500).json({ error: 'Payment recipient not configured. Contact admin.' });
  const amount = CREDIT_PRICES[pkg];
  res.json({
    success: true,
    recipientAddress: RECIPIENT_FRIENDLY,
    amountNim: amount,
    amountLuna: amount * 100000,
    credits: parseInt(pkg),
    label: `${pkg} Credits`,
  });
});

app.post('/api/confirm-payment', requireAuth, async (req, res) => {
  const { txHash, package: pkg } = req.body;
  if (!txHash || !pkg) return res.status(400).json({ error: 'Missing transaction hash or package' });

  const CREDIT_PACKAGES = { 10: 1000, 100: 10000, 1000: 100000 };
  const amountNim = CREDIT_PACKAGES[pkg];
  if (!amountNim) return res.status(400).json({ error: 'Invalid package' });
  const amountLuna = amountNim * 100000;

  const verification = await verifyNimiqPayment(txHash, amountLuna);
  if (!verification.ok) return res.status(400).json({ error: verification.reason });

  const credits = parseInt(pkg);
  const txId = db.addCredits(req.walletAddress, amountNim, credits);
  const user = db.getUser(req.walletAddress);
  res.json({ success: true, txId, creditsAdded: credits, totalCredits: user.credits });
});

// ===== GALLERY (public) =====
const galleryCache = { new: null, top: null, at: 0 };
const GALLERY_CACHE_TTL = 30000; // 30 seconds

app.get('/api/gallery', (req, res) => {
  const { tab, limit, offset } = req.query;
  const l = Math.min(parseInt(limit) || 50, 100);
  const o = parseInt(offset) || 0;
  const isTop = tab === 'top';
  const cacheKey = isTop ? 'top' : 'new';
  const now = Date.now();

  // Serve from cache if fresh
  if (galleryCache[cacheKey] && (now - galleryCache.at) < GALLERY_CACHE_TTL && o === 0) {
    return res.json(galleryCache[cacheKey]);
  }

  const items = isTop ? db.getGalleryTop(l, o) : db.getGalleryNew(l, o);
  const wallet = validateSession(req.headers.authorization?.replace('Bearer ', ''));
  const enriched = wallet ? items.map(g => ({
    ...g,
    userVote: db.getUserVote(g.id, wallet),
  })) : items;

  if (o === 0) {
    galleryCache[cacheKey] = enriched;
    galleryCache.at = now;
  }
  res.json(enriched);
});

// ===== VOTE =====
app.post('/api/vote', requireAuth, (req, res) => {
  const { generationId, value } = req.body;
  if (!generationId || ![1, -1].includes(value)) {
    return res.status(400).json({ error: 'generationId and value (1 or -1) required' });
  }
  const change = db.voteGeneration(generationId, req.walletAddress, value);
  galleryCache.new = null;
  galleryCache.top = null;
  const gen = db.query('SELECT votes FROM generations WHERE id = ?', [generationId])[0];
  res.json({ success: true, change, totalVotes: gen ? gen.votes : 0 });
});

app.get('/api/stats', (req, res) => { res.json(db.getStats()); });

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

startServer().then(() => {
  app.listen(PORT, () => { console.log(`Server running on http://localhost:${PORT}`); });
}).catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
