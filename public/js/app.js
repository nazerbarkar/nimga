const API_BASE = window.location.origin;
let currentUser = null;
let walletHub = null;
let hubCheckout = null;
let pendingChallenge = null;
let isGenerating = false;
let paymentInFlight = false;
let sessionToken = null;
let currentGalleryTab = 'top';
const SESSION_KEY = 'nimga_session';

const $ = (id) => document.getElementById(id);

const DOM = {
  connectBtn: $('connect-btn'),
  userArea: $('user-area'),
  walletShort: $('wallet-short'),
  creditCount: $('credit-count'),
  creditPill: $('credit-pill'),
  addCreditsBtn: $('add-credits-btn'),
  logoutBtn: $('logout-btn'),
  promptInput: $('prompt-input'),
  generateBtn: $('generate-btn'),
  createHint: $('create-hint'),
  genIndicator: $('generating-indicator'),
  resultArea: $('result-area'),
  resultImage: $('result-image'),
  downloadBtn: $('download-btn'),
  newBtn: $('new-btn'),
  galleryGrid: $('gallery-grid'),
  visibilityCheck: $('visibility-check'),
  visLabel: $('vis-label'),
  historyBtn: $('history-btn'),
  historyModal: $('history-modal'),
  closeHistory: $('close-history'),
  historyGrid: $('history-grid'),
  lightbox: $('lightbox'),
  lightboxClose: $('lightbox-close'),
  lightboxImg: $('lightbox-img'),
  lightboxPrompt: $('lightbox-prompt'),
  lightboxDownload: $('lightbox-download'),
  modal: $('buy-modal'),
  closeModal: $('close-modal'),
  packages: $('packages'),
  payProgress: $('payment-progress'),
  payStatusTitle: $('pay-status-title'),
  payStatusMsg: $('pay-status-msg'),
  modalBalance: $('modal-balance'),
};

function shortAddr(a) { return a ? a.slice(0, 6) + '...' + a.slice(-4) : ''; }
function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

function saveSession(token) { localStorage.setItem(SESSION_KEY, token); }
function getSession() { return localStorage.getItem(SESSION_KEY); }
function clearSession() { localStorage.removeItem(SESSION_KEY); }

async function api(ep, method = 'GET', body = null) {
  const o = { method, headers: { 'Content-Type': 'application/json' } };
  if (sessionToken) o.headers['Authorization'] = `Bearer ${sessionToken}`;
  if (body) o.body = JSON.stringify(body);
  const r = await fetch(`${API_BASE}${ep}`, o);
  return r.json();
}

// ===== TOAST =====
function toast(type, msg, duration = 4000) {
  const container = $('toast-container');
  const t = document.createElement('div');
  t.className = 'toast';
  const icons = {
    success: '<svg class="toast-icon success" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
    error: '<svg class="toast-icon error" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
    info: '<svg class="toast-icon info" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>'
  };
  t.innerHTML = `${icons[type] || icons.info}<span class="toast-msg">${esc(msg)}</span><button class="toast-close"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>`;
  t.querySelector('.toast-close').onclick = () => { t.classList.add('out'); setTimeout(() => t.remove(), 300); };
  container.appendChild(t);
  if (duration > 0) setTimeout(() => { if (t.parentNode) { t.classList.add('out'); setTimeout(() => t.remove(), 300); } }, duration);
}

// ===== WALLET =====
function initWalletHub() {
  if (window.HubApi && !walletHub) {
    try { walletHub = new window.HubApi('https://hub.nimiq.com'); } catch (e) { console.error(e); }
  }
  if (window.HubApi && !hubCheckout) {
    try { hubCheckout = new window.HubApi('https://hub.nimiq.com'); } catch (e) { console.error(e); }
  }
}

async function ensureChallenge(force = false) {
  if (pendingChallenge && !force) return pendingChallenge;
  const r = await fetch(`${API_BASE}/auth/nonce`);
  const d = await r.json();
  if (!r.ok || !d.success) throw new Error(d.message || 'Could not prepare login');
  pendingChallenge = d;
  return d;
}

async function restoreSession() {
  const saved = getSession();
  if (!saved) return false;
  sessionToken = saved;
  const d = await api('/api/user');
  if (d && !d.error) {
    currentUser = { walletAddress: d.walletAddress, freeRemaining: d.freeRemaining, credits: d.credits };
    return true;
  }
  sessionToken = null;
  clearSession();
  return false;
}

async function connectWallet() {
  DOM.connectBtn.disabled = true;
  DOM.connectBtn.innerHTML = '<span class="btn-spinner"></span> Connecting...';
  try {
    initWalletHub();
    if (!walletHub) throw new Error('Nimiq Hub could not be initialized.');
    const ch = await ensureChallenge();
    const signed = await walletHub.signMessage({ appName: 'NIMGA', message: ch.message });
    const addr = signed?.signer || '';
    if (!addr) throw new Error('No wallet address returned.');
    DOM.connectBtn.innerHTML = '<span class="btn-spinner"></span> Verifying...';
    const vr = await fetch(`${API_BASE}/auth/verify`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: addr, label: '', publicKey: Array.from(signed.signerPublicKey || []), signature: Array.from(signed.signature || []), nonce: ch.nonce })
    });
    const d = await vr.json();
    if (!vr.ok || !d.success) throw new Error(d.message || 'Verification failed');
    currentUser = { walletAddress: d.walletAddress, freeRemaining: d.freeRemaining, credits: d.credits };
    sessionToken = d.token;
    pendingChallenge = null;
    saveSession(d.token);
    updateUI();
    toast('success', 'Wallet connected!');
  } catch (err) {
    pendingChallenge = null;
    const msg = err?.message === 'Request was cancelled' ? 'Connection cancelled.' : (err?.message || 'Login failed');
    toast('error', msg);
    try { await ensureChallenge(true); } catch (_) {}
  } finally {
    DOM.connectBtn.disabled = false;
    DOM.connectBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg> Connect wallet';
  }
}

DOM.connectBtn.addEventListener('click', connectWallet);
DOM.logoutBtn.addEventListener('click', async () => {
  await api('/auth/logout', 'POST').catch(() => {});
  currentUser = null; pendingChallenge = null; sessionToken = null;
  clearSession();
  updateUI();
  toast('info', 'Logged out.');
});

// ===== UI =====
function updateUI() {
  const in_ = !!currentUser;
  DOM.connectBtn.classList.toggle('hidden', in_);
  DOM.userArea.classList.toggle('hidden', !in_);

  if (!in_) {
    DOM.generateBtn.disabled = true;
    DOM.createHint.style.display = 'none';
    return;
  }

  DOM.walletShort.textContent = shortAddr(currentUser.walletAddress);
  DOM.creditCount.textContent = currentUser.credits;

  const can = currentUser.freeRemaining > 0 || currentUser.credits > 0;
  DOM.generateBtn.disabled = !DOM.promptInput.value.trim() || !can;
  DOM.createHint.style.display = 'block';

  if (can) {
    DOM.createHint.textContent = currentUser.freeRemaining > 0
      ? `${currentUser.freeRemaining} free images left`
      : `${currentUser.credits} credits`;
  } else {
    DOM.createHint.innerHTML = 'No credits left. <a href="#" id="buy-link">Add credits</a>';
    requestAnimationFrame(() => {
      const l = document.getElementById('buy-link');
      if (l) l.onclick = e => { e.preventDefault(); showBuyModal(); };
    });
  }
}

// ===== GALLERY =====
async function loadGallery() {
  try {
    const items = await api(`/api/gallery?tab=${currentGalleryTab}&limit=${currentGalleryTab === 'top' ? 9 : 50}`);
    if (!items?.length) {
      DOM.galleryGrid.innerHTML = '<div class="gallery-empty">No images yet. Be the first to create!</div>';
      return;
    }
    DOM.galleryGrid.innerHTML = items.map(g => `
      <div class="gallery-card" data-id="${g.id}">
        <img class="gallery-card-image" src="${esc(g.image_url)}" alt="Generated image" loading="lazy">
        <div class="gallery-card-footer">
          <span class="gallery-card-wallet">${esc(shortAddr(g.wallet_address))}</span>
          <div class="gallery-card-votes">
            <button class="btn-vote vote-down ${g.userVote === -1 ? 'voted-down' : ''}" data-id="${g.id}" data-value="-1" title="Downvote">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
            </button>
            <span class="vote-count">${g.votes || 0}</span>
            <button class="btn-vote vote-up ${g.userVote === 1 ? 'voted-up' : ''}" data-id="${g.id}" data-value="1" title="Upvote">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="18 15 12 9 6 15"/></svg>
            </button>
          </div>
        </div>
      </div>
    `).join('');

    DOM.galleryGrid.querySelectorAll('.btn-vote').forEach(btn => {
      btn.addEventListener('click', () => vote(btn.dataset.id, parseInt(btn.dataset.value)));
    });
  } catch (e) {
    console.error(e);
    DOM.galleryGrid.innerHTML = '<div class="gallery-empty">Failed to load gallery.</div>';
  }
}

async function vote(generationId, value) {
  if (!currentUser) { connectWallet(); return; }
  try {
    const d = await api('/api/vote', 'POST', { generationId, value });
    if (d.error) { toast('error', d.error); return; }
    loadGallery();
  } catch (e) { toast('error', 'Vote failed.'); }
}

// Tab switching
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentGalleryTab = btn.dataset.tab;
    loadGallery();
  });
});

// ===== VISIBILITY TOGGLE =====
DOM.visibilityCheck.addEventListener('change', () => {
  const isPrivate = DOM.visibilityCheck.checked;
  DOM.visLabel.textContent = isPrivate ? 'Private' : 'Public';
  document.querySelector('.public-icon').style.display = isPrivate ? 'none' : 'flex';
  document.querySelector('.private-icon').style.display = isPrivate ? 'flex' : 'none';
});

// ===== NEW IMAGE BUTTON =====
DOM.newBtn.addEventListener('click', () => {
  DOM.resultArea.classList.add('hidden');
  DOM.promptInput.focus();
});

// ===== HISTORY =====
let allHistory = [];
let historyFilter = 'all';

async function loadHistory() {
  if (!currentUser) return;
  DOM.historyGrid.innerHTML = '<div class="history-loading">Loading...</div>';
  try {
    allHistory = await api('/api/history');
    renderHistory();
  } catch (e) {
    console.error(e);
    DOM.historyGrid.innerHTML = '<div class="gallery-empty">Failed to load history.</div>';
  }
}

function renderHistory() {
  const filtered = historyFilter === 'all' ? allHistory : allHistory.filter(g => (g.visibility || 'public') === historyFilter);

  if (!filtered.length) {
    DOM.historyGrid.innerHTML = `<div class="gallery-empty">${historyFilter === 'all' ? 'No images yet.' : 'No ' + historyFilter + ' images.'}</div>`;
    return;
  }

  DOM.historyGrid.innerHTML = filtered.map(g => `
    <div class="history-card" data-id="${g.id}" data-url="${esc(g.image_url)}" data-prompt="${esc(g.prompt)}">
      <img src="${esc(g.image_url)}" alt="Generated image" loading="lazy">
      <span class="history-card-badge ${g.visibility === 'private' ? 'badge-private' : 'badge-public'}">${g.visibility || 'public'}</span>
      <div class="history-card-actions">
        <button class="btn-card-dl" data-url="${esc(g.image_url)}" title="Download">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        </button>
        <button class="btn-card-del" data-id="${g.id}" title="Delete">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
        </button>
      </div>
      <div class="history-card-overlay">
        <div class="history-card-prompt">${esc(g.prompt)}</div>
      </div>
    </div>
  `).join('');

  DOM.historyGrid.querySelectorAll('.history-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('.btn-card-dl') || e.target.closest('.btn-card-del')) return;
      openLightbox(card.dataset.url, card.dataset.prompt);
    });
  });

  DOM.historyGrid.querySelectorAll('.btn-card-dl').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      downloadImage(btn.dataset.url);
    });
  });

  DOM.historyGrid.querySelectorAll('.btn-card-del').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm('Delete this image?')) return;
      const d = await api(`/api/history/${btn.dataset.id}`, 'DELETE');
      if (d.success) { toast('info', 'Image deleted.'); loadHistory(); }
      else toast('error', d.error || 'Delete failed.');
    });
  });
}

document.querySelectorAll('.hist-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.hist-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    historyFilter = tab.dataset.filter;
    renderHistory();
  });
});

function downloadImage(url) {
  const a = document.createElement('a');
  a.href = url;
  a.download = 'nimga-' + Date.now() + '.png';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// ===== HISTORY BUTTON =====
DOM.historyBtn.addEventListener('click', () => {
  loadHistory();
  DOM.historyModal.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
});
DOM.closeHistory.addEventListener('click', () => {
  DOM.historyModal.classList.add('hidden');
  document.body.style.overflow = '';
});
DOM.historyModal.querySelector('.modal-backdrop').addEventListener('click', () => {
  DOM.historyModal.classList.add('hidden');
  document.body.style.overflow = '';
});

// ===== LIGHTBOX =====
function openLightbox(url, prompt) {
  DOM.lightboxImg.src = url;
  DOM.lightboxPrompt.textContent = prompt || '';
  DOM.lightboxDownload.href = url;
  DOM.lightbox.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}
function closeLightbox() {
  DOM.lightbox.classList.add('hidden');
  document.body.style.overflow = '';
}
DOM.lightboxClose.addEventListener('click', closeLightbox);
DOM.lightbox.addEventListener('click', (e) => { if (e.target === DOM.lightbox) closeLightbox(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeLightbox(); });

// ===== GENERATE =====
async function generate() {
  const prompt = DOM.promptInput.value.trim();
  if (!prompt || isGenerating || !currentUser) return;
  if (currentUser.freeRemaining <= 0 && currentUser.credits <= 0) { showBuyModal(); return; }
  isGenerating = true; DOM.generateBtn.disabled = true;
  DOM.promptInput.value = ''; DOM.promptInput.style.height = 'auto';
  DOM.genIndicator.classList.remove('hidden');
  try {
    const d = await api('/api/generate', 'POST', { prompt, visibility: DOM.visibilityCheck.checked ? 'private' : 'public' });
    if (d.error) {
      toast('error', d.error);
    } else {
      currentUser.freeRemaining = d.freeRemaining;
      currentUser.credits = d.credits;
      DOM.resultImage.src = d.imageUrl;
      DOM.downloadBtn.href = d.imageUrl;
      DOM.resultArea.classList.remove('hidden');
      toast('success', 'Image generated!');
      loadGallery();
      loadHistory();
    }
    updateUI();
  } catch (e) { toast('error', 'Generation failed.'); }
  finally { isGenerating = false; DOM.genIndicator.classList.add('hidden'); updateUI(); }
}

// ===== INPUT =====
DOM.generateBtn.addEventListener('click', generate);
DOM.promptInput.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); generate(); } });
DOM.promptInput.addEventListener('input', () => {
  DOM.promptInput.style.height = 'auto'; DOM.promptInput.style.height = Math.min(DOM.promptInput.scrollHeight, 200) + 'px';
  if (currentUser) DOM.generateBtn.disabled = !(currentUser.freeRemaining > 0 || currentUser.credits > 0) || !DOM.promptInput.value.trim();
});
document.querySelectorAll('.prompt-chip').forEach(c => c.addEventListener('click', () => {
  if (!currentUser) { connectWallet(); return; }
  DOM.promptInput.value = c.dataset.prompt; DOM.promptInput.dispatchEvent(new Event('input')); DOM.promptInput.focus();
}));

// ===== BUY MODAL =====
function showPayProgress(title, msg) {
  DOM.payProgress.classList.remove('hidden');
  DOM.payStatusTitle.textContent = title;
  DOM.payStatusMsg.textContent = msg;
}
function hidePayProgress() { DOM.payProgress.classList.add('hidden'); }

async function showBuyModal() {
  DOM.modal.classList.remove('hidden');
  hidePayProgress();
  document.body.style.overflow = 'hidden';
  if (currentUser) DOM.modalBalance.textContent = currentUser.credits;
  const prices = await api('/api/prices'); DOM.packages.innerHTML = '';
  Object.entries(prices).forEach(([credits, info]) => {
    const c = document.createElement('div'); c.className = 'package-card';
    c.innerHTML = `<div class="package-credits">${credits}</div><div class="package-label">${info.label}</div><div class="package-price">${info.nimiq.toLocaleString()} NIM</div>`;
    c.addEventListener('click', () => startPayment(credits, info));
    DOM.packages.appendChild(c);
  });
}

function closeBuyModal() { DOM.modal.classList.add('hidden'); document.body.style.overflow = ''; }

async function startPayment(credits, info) {
  if (paymentInFlight) return;
  if (!hubCheckout) { initWalletHub(); if (!hubCheckout) { toast('error', 'Nimiq Hub not available.'); return; } }

  document.querySelectorAll('.package-card').forEach(c => c.classList.remove('selected'));
  event.currentTarget?.classList.add('selected');

  paymentInFlight = true;
  showPayProgress('Opening Nimiq Hub...', 'Complete the payment in the Nimiq checkout window.');

  try {
    const pkgData = await api('/api/buy-credits', 'POST', { package: credits });
    if (!pkgData.success) throw new Error(pkgData.error || 'Could not prepare payment');

    const result = await hubCheckout.checkout({
      appName: 'NIMGA',
      recipient: pkgData.recipientAddress,
      value: pkgData.amountLuna,
      extraData: `NIMGA ${credits} credits`,
    });

    if (!result?.hash) throw new Error('No transaction hash returned.');

    showPayProgress('Verifying payment...', 'Checking transaction on the Nimiq blockchain.');
    const d = await api('/api/confirm-payment', 'POST', { txHash: result.hash, package: credits });

    if (!d.success) throw new Error(d.error || 'Payment verification failed');

    currentUser.credits = d.totalCredits;
    updateUI();
    closeBuyModal();
    toast('success', `${d.creditsAdded} credits added!`);
  } catch (err) {
    const msg = err?.message === 'Request was cancelled' ? 'Payment cancelled.' : (err?.message || 'Payment failed');
    if (msg !== 'Payment cancelled.') toast('error', msg);
    hidePayProgress();
  } finally {
    paymentInFlight = false;
  }
}

DOM.addCreditsBtn.addEventListener('click', showBuyModal);
DOM.closeModal.addEventListener('click', closeBuyModal);
DOM.modal.querySelector('.modal-backdrop').addEventListener('click', closeBuyModal);

// ===== INIT =====
(async function init() {
  initWalletHub();
  const restored = await restoreSession();
  updateUI();
  loadGallery();
  if (restored) {
    loadHistory();
    toast('info', 'Welcome back!');
  }
})();
