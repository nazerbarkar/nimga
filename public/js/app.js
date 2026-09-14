const API_BASE = window.location.origin;
let currentUser = null;
let walletHub = null;
let hubCheckout = null;
let miniAppProvider = null;
let connectionMethod = null;
let pendingChallenge = null;
let isGenerating = false;
let paymentInFlight = false;
let sessionToken = null;
let currentAgentType = 'text-to-image';
let uploadedImageBase64 = null;
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
  genStatusText: $('gen-status-text'),
  resultArea: $('result-area'),
  resultImage: $('result-image'),
  resultVideo: $('result-video'),
  downloadBtn: $('download-btn'),
  newBtn: $('new-btn'),
  uploadArea: $('upload-area'),
  imageInput: $('image-input'),
  uploadPlaceholder: $('upload-placeholder'),
  uploadPreview: $('upload-preview'),
  previewImg: $('preview-img'),
  uploadRemove: $('upload-remove'),
  historyBtn: $('history-btn'),
  historyModal: $('history-modal'),
  closeHistory: $('close-history'),
  historyGrid: $('history-grid'),
  lightbox: $('lightbox'),
  lightboxClose: $('lightbox-close'),
  lightboxImg: $('lightbox-img'),
  lightboxVideo: $('lightbox-video'),
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

async function initWalletHub() {
  // Try Mini App SDK first (Nimiq Pay native)
  if (!miniAppProvider && !connectionMethod) {
    try {
      const { init } = await import('/node_modules/@nimiq/mini-app-sdk/dist/index.js');
      const provider = await init({ timeout: 5000 });
      miniAppProvider = provider;
      connectionMethod = 'miniapp';
      console.log('Nimiq Pay Mini App detected');
      return;
    } catch (e) {
      console.log('Mini App SDK not available, trying Hub API');
    }
  }

  // Fallback to Hub API (desktop with extension)
  if (!walletHub && !connectionMethod) {
    if (window.HubApi) {
      try {
        walletHub = new window.HubApi('https://hub.nimiq.com');
        hubCheckout = walletHub;
        connectionMethod = 'hub';
        console.log('Hub API available');
      } catch (e) { console.error(e); }
    }
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
    await initWalletHub();
    const ch = await ensureChallenge();

    let addr, signature;

    if (connectionMethod === 'miniapp' && miniAppProvider) {
      // Use Nimiq Pay Mini App SDK (bil project pattern)
      const accounts = await miniAppProvider.listAccounts();

      // Handle error response
      if (accounts && typeof accounts === 'object' && 'error' in accounts) {
        throw new Error(accounts.error.message || 'User rejected connection');
      }

      // Handle multiple response formats
      if (typeof accounts === 'string') {
        addr = accounts;
      } else if (Array.isArray(accounts) && accounts.length > 0) {
        addr = accounts[0];
      } else if (accounts && typeof accounts === 'object') {
        addr = accounts.address || accounts[0];
      }

      if (!addr) throw new Error('No accounts found');

      // Sign the challenge message
      const sigResult = await miniAppProvider.sign(ch.message);
      if (sigResult && typeof sigResult === 'object' && 'error' in sigResult) {
        throw new Error('User rejected signing');
      }

      // Handle multiple signature formats
      if (typeof sigResult === 'string') {
        signature = sigResult;
      } else if (sigResult && typeof sigResult === 'object' && typeof sigResult.signature === 'string') {
        signature = sigResult.signature;
      } else if (sigResult instanceof Uint8Array) {
        signature = Array.from(sigResult).map(b => b.toString(16).padStart(2, '0')).join('');
      } else {
        throw new Error('Unexpected signature format');
      }
    } else if (connectionMethod === 'hub' && walletHub) {
      // Fallback to Hub API popup
      const signed = await walletHub.signMessage({ appName: 'NIMGA', message: ch.message });
      if (!signed?.signer || !signed?.signature) {
        throw new Error('Connection cancelled');
      }
      addr = signed.signer;
      const sigBytes = signed.signature;
      signature = Array.from(
        sigBytes instanceof Uint8Array ? sigBytes : new Uint8Array(sigBytes)
      ).map(b => b.toString(16).padStart(2, '0')).join('');
    } else {
      throw new Error('No wallet provider available. Please install Nimiq Pay or enable Hub API.');
    }

    if (!addr) throw new Error('No wallet address returned.');
    DOM.connectBtn.innerHTML = '<span class="btn-spinner"></span> Verifying...';
    const vr = await fetch(`${API_BASE}/auth/verify`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: addr, label: '', signature, nonce: ch.nonce })
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
    // Classify error (bil project pattern)
    const msg = (err?.message || '').toLowerCase();
    const isCancelled = err?.type === 'USER_REJECTED'
      || msg.includes('cancel')
      || msg.includes('reject')
      || msg.includes('abort')
      || msg.includes('user rejected');
    if (!isCancelled) toast('error', err?.message || 'Login failed');
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

function canGenerate() {
  if (!currentUser) return false;
  if (currentAgentType === 'text-to-image') {
    return currentUser.freeRemaining > 0 || currentUser.credits >= 1;
  }
  return currentUser.credits >= 10;
}

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

  const hasPrompt = DOM.promptInput.value.trim().length > 0;
  const can = canGenerate();
  DOM.generateBtn.disabled = !hasPrompt || !can;
  DOM.createHint.style.display = 'block';

  if (currentAgentType === 'text-to-image') {
    if (currentUser.freeRemaining > 0) {
      DOM.createHint.textContent = `${currentUser.freeRemaining} free images left`;
    } else if (currentUser.credits >= 1) {
      DOM.createHint.textContent = `${currentUser.credits} credits (1 per image)`;
    } else {
      DOM.createHint.innerHTML = 'No credits left. <a href="#" id="buy-link">Add credits</a>';
      requestAnimationFrame(() => {
        const l = document.getElementById('buy-link');
        if (l) l.onclick = e => { e.preventDefault(); showBuyModal(); };
      });
    }
  } else {
    if (currentUser.credits >= 10) {
      DOM.createHint.textContent = `${currentUser.credits} credits (10 per video)`;
    } else {
      DOM.createHint.innerHTML = 'Not enough credits. <a href="#" id="buy-link">Add credits</a>';
      requestAnimationFrame(() => {
        const l = document.getElementById('buy-link');
        if (l) l.onclick = e => { e.preventDefault(); showBuyModal(); };
      });
    }
  }
}

document.querySelectorAll('.agent-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    if (isGenerating) return;
    document.querySelectorAll('.agent-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentAgentType = btn.dataset.type;

    const isImageToVideo = currentAgentType === 'image-to-video';
    DOM.uploadArea.classList.toggle('hidden', !isImageToVideo);

    const placeholders = {
      'text-to-image': 'Describe the image you want to create...',
      'text-to-video': 'Describe the video you want to create...',
      'image-to-video': 'Describe how the image should animate...',
    };
    DOM.promptInput.placeholder = placeholders[currentAgentType];

    if (!isImageToVideo) {
      uploadedImageBase64 = null;
      DOM.uploadPreview.classList.add('hidden');
      DOM.uploadPlaceholder.classList.remove('hidden');
    }

    updateUI();
  });
});

DOM.uploadArea.addEventListener('click', () => DOM.imageInput.click());
DOM.imageInput.addEventListener('change', (e) => {
  if (e.target.files.length > 0) handleImageUpload(e.target.files[0]);
});

DOM.uploadArea.addEventListener('dragover', (e) => { e.preventDefault(); DOM.uploadArea.classList.add('dragover'); });
DOM.uploadArea.addEventListener('dragleave', () => DOM.uploadArea.classList.remove('dragover'));
DOM.uploadArea.addEventListener('drop', (e) => {
  e.preventDefault();
  DOM.uploadArea.classList.remove('dragover');
  if (e.dataTransfer.files.length > 0) handleImageUpload(e.dataTransfer.files[0]);
});

function handleImageUpload(file) {
  if (!file.type.startsWith('image/')) { toast('error', 'Please upload an image file.'); return; }
  const reader = new FileReader();
  reader.onload = (e) => {
    uploadedImageBase64 = e.target.result;
    DOM.previewImg.src = uploadedImageBase64;
    DOM.uploadPlaceholder.classList.add('hidden');
    DOM.uploadPreview.classList.remove('hidden');
    updateUI();
  };
  reader.readAsDataURL(file);
}

DOM.uploadRemove.addEventListener('click', (e) => {
  e.stopPropagation();
  uploadedImageBase64 = null;
  DOM.imageInput.value = '';
  DOM.uploadPreview.classList.add('hidden');
  DOM.uploadPlaceholder.classList.remove('hidden');
  updateUI();
});

DOM.newBtn.addEventListener('click', () => {
  DOM.resultArea.classList.add('hidden');
  DOM.promptInput.focus();
});

let allHistory = [];

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
  if (!allHistory.length) {
    DOM.historyGrid.innerHTML = '<div class="gallery-empty">No creations yet.</div>';
    return;
  }
  DOM.historyGrid.innerHTML = allHistory.map(g => {
    const isVideo = g.type === 'text-to-video' || g.type === 'image-to-video';
    const typeLabel = g.type === 'text-to-video' ? 'Video' : g.type === 'image-to-video' ? 'Img2Vid' : 'Image';
    return `
    <div class="history-card" data-id="${g.id}" data-url="${esc(isVideo ? g.video_url : g.image_url)}" data-prompt="${esc(g.prompt)}" data-type="${g.type}">
      ${isVideo
        ? `<video src="${esc(g.video_url)}" muted loop preload="metadata"></video>`
        : `<img src="${esc(g.image_url)}" alt="Generated" loading="lazy">`
      }
      <span class="history-card-type">${typeLabel}</span>
      <span class="history-card-badge ${g.visibility === 'private' ? 'badge-private' : 'badge-public'}">${g.visibility || 'public'}</span>
      <div class="history-card-actions">
        <button class="btn-card-dl" data-url="${esc(isVideo ? g.video_url : g.image_url)}" title="Download">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        </button>
        <button class="btn-card-del" data-id="${g.id}" title="Delete">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
        </button>
      </div>
      <div class="history-card-overlay">
        <div class="history-card-prompt">${esc(g.prompt)}</div>
      </div>
    </div>`;
  }).join('');

  DOM.historyGrid.querySelectorAll('.history-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('.btn-card-dl') || e.target.closest('.btn-card-del')) return;
      const isVideo = card.dataset.type === 'text-to-video' || card.dataset.type === 'image-to-video';
      openLightbox(card.dataset.url, card.dataset.prompt, isVideo);
    });
  });

  DOM.historyGrid.querySelectorAll('.btn-card-dl').forEach(btn => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); downloadFile(btn.dataset.url); });
  });

  DOM.historyGrid.querySelectorAll('.btn-card-del').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm('Delete this creation?')) return;
      const d = await api(`/api/history/${btn.dataset.id}`, 'DELETE');
      if (d.success) { toast('info', 'Deleted.'); loadHistory(); }
      else toast('error', d.error || 'Delete failed.');
    });
  });

  DOM.historyGrid.querySelectorAll('.history-card video').forEach(vid => {
    const card = vid.closest('.history-card');
    card.addEventListener('mouseenter', () => { vid.play().catch(() => {}); });
    card.addEventListener('mouseleave', () => { vid.pause(); vid.currentTime = 0; });
  });
}

function downloadFile(url) {
  const a = document.createElement('a');
  a.href = url;
  a.download = 'nimga-' + Date.now() + (url.endsWith('.mp4') ? '.mp4' : '.png');
  document.body.appendChild(a);
  a.click();
  a.remove();
}

DOM.historyBtn.addEventListener('click', () => { loadHistory(); DOM.historyModal.classList.remove('hidden'); document.body.style.overflow = 'hidden'; });
DOM.closeHistory.addEventListener('click', () => { DOM.historyModal.classList.add('hidden'); document.body.style.overflow = ''; });
DOM.historyModal.querySelector('.modal-backdrop').addEventListener('click', () => { DOM.historyModal.classList.add('hidden'); document.body.style.overflow = ''; });

function openLightbox(url, prompt, isVideo = false) {
  if (isVideo) {
    DOM.lightboxImg.classList.add('hidden');
    DOM.lightboxVideo.classList.remove('hidden');
    DOM.lightboxVideo.src = url;
    DOM.lightboxVideo.play().catch(() => {});
    DOM.lightboxDownload.href = url;
    DOM.lightboxDownload.download = 'nimga-video.mp4';
  } else {
    DOM.lightboxVideo.classList.add('hidden');
    DOM.lightboxVideo.pause();
    DOM.lightboxImg.classList.remove('hidden');
    DOM.lightboxImg.src = url;
    DOM.lightboxDownload.href = url;
    DOM.lightboxDownload.download = 'nimga-image.png';
  }
  DOM.lightboxPrompt.textContent = prompt || '';
  DOM.lightbox.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeLightbox() {
  DOM.lightbox.classList.add('hidden');
  DOM.lightboxVideo.pause();
  DOM.lightboxVideo.src = '';
  document.body.style.overflow = '';
}
DOM.lightboxClose.addEventListener('click', closeLightbox);
DOM.lightbox.addEventListener('click', (e) => { if (e.target === DOM.lightbox) closeLightbox(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeLightbox(); });

async function generate() {
  const prompt = DOM.promptInput.value.trim();
  if (!prompt) { toast('error', 'Please enter a prompt.'); return; }
  if (isGenerating) return;
  if (!currentUser) { connectWallet(); return; }
  if (!canGenerate()) { showBuyModal(); return; }

  isGenerating = true;
  DOM.generateBtn.disabled = true;
  DOM.promptInput.value = '';
  DOM.promptInput.style.height = 'auto';
  DOM.genIndicator.classList.remove('hidden');
  DOM.resultArea.classList.add('hidden');

  const visibility = 'public';

  try {
    let d;

    if (currentAgentType === 'text-to-image') {
      DOM.genStatusText.textContent = 'Creating your image';
      d = await api('/api/generate', 'POST', { prompt, visibility });
    } else if (currentAgentType === 'text-to-video') {
      DOM.genStatusText.textContent = 'Creating your video...';
      d = await api('/api/generate-video', 'POST', { prompt, visibility });
    } else if (currentAgentType === 'image-to-video') {
      if (!uploadedImageBase64) {
        toast('error', 'Please upload an image first.');
        isGenerating = false;
        DOM.genIndicator.classList.add('hidden');
        updateUI();
        return;
      }
      DOM.genStatusText.textContent = 'Creating your video from image...';
      d = await api('/api/generate-image-to-video', 'POST', { prompt, imageBase64: uploadedImageBase64, visibility });
    }

    if (d.error) {
      toast('error', d.error);
    } else {
      currentUser.freeRemaining = d.freeRemaining ?? currentUser.freeRemaining;
      currentUser.credits = d.credits;

      if (d.videoUrl) {
        DOM.resultImage.classList.add('hidden');
        DOM.resultVideo.classList.remove('hidden');
        DOM.resultVideo.src = d.videoUrl;
        DOM.downloadBtn.href = d.videoUrl;
        DOM.downloadBtn.download = 'nimga-video.mp4';
      } else {
        DOM.resultVideo.classList.add('hidden');
        DOM.resultImage.classList.remove('hidden');
        DOM.resultImage.src = d.imageUrl;
        DOM.downloadBtn.href = d.imageUrl;
        DOM.downloadBtn.download = 'nimga-image.png';
      }

      DOM.resultArea.classList.remove('hidden');
      toast('success', d.videoUrl ? 'Video generated!' : 'Image generated!');
    }
  } catch (e) {
    console.error('Generation error:', e);
    toast('error', 'Generation failed. Please try again.');
  } finally {
    isGenerating = false;
    DOM.genIndicator.classList.add('hidden');
    updateUI();
  }
}

DOM.generateBtn.addEventListener('click', generate);
DOM.promptInput.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); generate(); } });
DOM.promptInput.addEventListener('input', () => {
  DOM.promptInput.style.height = 'auto';
  DOM.promptInput.style.height = Math.min(DOM.promptInput.scrollHeight, 200) + 'px';
  updateUI();
});

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
  await initWalletHub();

  document.querySelectorAll('.package-card').forEach(c => c.classList.remove('selected'));
  event.currentTarget?.classList.add('selected');

  paymentInFlight = true;
  showPayProgress('Preparing payment...', 'Please confirm in your wallet.');

  try {
    const pkgData = await api('/api/buy-credits', 'POST', { package: credits });
    if (!pkgData.success) throw new Error(pkgData.error || 'Could not prepare payment');

    let txHash;

    if (connectionMethod === 'miniapp' && miniAppProvider) {
      // Use Nimiq Pay Mini App SDK (bil project pattern)
      showPayProgress('Confirm in Nimiq Pay...', 'Approve the transaction in your wallet.');
      const txData = {
        recipient: pkgData.recipientAddress,
        value: pkgData.amountLuna,
        fee: 0,
      };

      const extraData = `NIMGA ${credits} credits`;
      if (extraData) {
        txData.extraData = Array.from(new TextEncoder().encode(extraData));
      }

      const result = await miniAppProvider.sendBasicTransaction(txData);
      if (result && typeof result === 'object' && 'error' in result) {
        throw new Error(result.error?.message || 'Transaction failed');
      }
      txHash = result.hash;
    } else if (connectionMethod === 'hub' && hubCheckout) {
      // Fallback to Hub API popup
      showPayProgress('Opening Nimiq Hub...', 'Complete the payment in the Nimiq checkout window.');
      const result = await hubCheckout.checkout({
        appName: 'NIMGA',
        recipient: pkgData.recipientAddress,
        value: pkgData.amountLuna,
        extraData: `NIMGA ${credits} credits`,
      });
      if (!result?.hash) throw new Error('Transaction was cancelled or failed');
      txHash = result.hash;
    } else {
      throw new Error('No wallet provider available.');
    }

    if (!txHash) throw new Error('No transaction hash returned.');

    showPayProgress('Verifying payment...', 'Checking transaction on the Nimiq blockchain.');
    const d = await api('/api/confirm-payment', 'POST', { txHash, package: credits });

    if (!d.success) throw new Error(d.error || 'Payment verification failed');

    currentUser.credits = d.totalCredits;
    updateUI();
    closeBuyModal();
    toast('success', `${d.creditsAdded} credits added!`);
  } catch (err) {
    // Classify error (bil project pattern)
    const msg = (err?.message || '').toLowerCase();
    const isCancelled = err?.type === 'USER_REJECTED'
      || msg.includes('cancel')
      || msg.includes('reject')
      || msg.includes('abort')
      || msg.includes('user rejected')
      || msg.includes('transaction was cancelled');
    if (!isCancelled) toast('error', err?.message || 'Payment failed');
    hidePayProgress();
  } finally {
    paymentInFlight = false;
  }
}

DOM.addCreditsBtn.addEventListener('click', showBuyModal);
DOM.closeModal.addEventListener('click', closeBuyModal);
DOM.modal.querySelector('.modal-backdrop').addEventListener('click', closeBuyModal);

(async function init() {
  await initWalletHub();
  const restored = await restoreSession();
  updateUI();
  if (restored) {
    loadHistory();
    toast('info', 'Welcome back!');
  }
})();
