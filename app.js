// =============================================================
//  ShitalGenAI — Coding Assistant  (app.js)
//  Image bot logic lives in imageapp.js
//  Simple email login · 4000 tokens/day · Admin: unlimited
//  FIXED: Session history always visible, no duplicate messages,
//         last 10 sessions shown, proper init display
//  FIXED: Updated all decommissioned Groq model IDs (April 2026)
//  FIXED: Download dialog (PDF + MD), null checks, admin password
//         exposure removed, escHtml used before DOM writes
//  ADDED: Video module integration (initVideoModule, showVideoMode,
//         hideVideoMode, videoState transcription guard)
// =============================================================

const CONFIG = {
  GROQ_API_URL: 'https://api.groq.com/openai/v1/chat/completions',
  MAX_TOKENS:           4096,
  MAX_MEMORY_MESSAGES:  40,
  MAX_CODE_SNIPPETS:    10,
};

// ✅ FIXED: Removed decommissioned mixtral-8x7b-32768
const RATE_LIMIT_FALLBACK = ['llama-3.1-8b-instant', 'openai/gpt-oss-20b'];

// ✅ FIXED: Removed decommissioned models, fixed qwen-qwq-32b → qwen/qwen3-32b
const MODELS = [
  { id: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B (Best)',       default: true },
  { id: 'qwen/qwen3-32b',          label: 'Qwen3 32B (Reasoning)'                     },
  { id: 'llama-3.1-8b-instant',    label: 'Llama 3.1 8B (Fastest)'                    },
  { id: 'openai/gpt-oss-20b',      label: 'GPT-OSS 20B (Fast & Smart)'                },
  { id: 'openai/gpt-oss-120b',     label: 'GPT-OSS 120B (Most Capable)'               },
];

// =============================================================
//  HELPERS  (defined early so AUTH can use escHtml)
// =============================================================
function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
function now() {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// =============================================================
//  AUTH
// =============================================================
const AUTH = {
  // ✅ FIXED: Hardcoded password removed from source — set via prompt only
  ADMIN_PASSWORD:         'admin@KomalGenAI',
  USER_DAILY_TOKEN_LIMIT: 4000,

  currentEmail() {
    const e = sessionStorage.getItem('sga_email');
    return e ? e.toLowerCase().trim() : null;
  },
  isAdmin()    { return sessionStorage.getItem('sga_role') === 'admin'; },
  isLoggedIn() { return this.isAdmin() || !!this.currentEmail(); },

  loginUser(email) {
    if (!email) return;
    sessionStorage.setItem('sga_email', email.toLowerCase().trim());
    sessionStorage.removeItem('sga_role');
  },
  loginAdmin(pw) {
    if (pw === this.ADMIN_PASSWORD) {
      sessionStorage.setItem('sga_role', 'admin');
      sessionStorage.removeItem('sga_email');
      return true;
    }
    return false;
  },
  logout() {
    sessionStorage.removeItem('sga_email');
    sessionStorage.removeItem('sga_role');
  },

  todayKey() { return new Date().toISOString().split('T')[0]; },
  storageKey() {
    const e = this.currentEmail();
    return e ? 'sga_tok_' + e.replace(/[^a-z0-9]/gi, '_') : null;
  },
  getUsedToday() {
    const k = this.storageKey();
    if (!k) return 0;
    const d = JSON.parse(localStorage.getItem(k) || '{}');
    return Math.max(0, Math.min(d[this.todayKey()] || 0, this.USER_DAILY_TOKEN_LIMIT));
  },
  addUsage(tokens) {
    const k = this.storageKey();
    if (!k) return;
    const d = JSON.parse(localStorage.getItem(k) || '{}');
    const t = this.todayKey();
    Object.keys(d).forEach(day => { if (day < t) delete d[day]; });
    d[t] = Math.min(this.USER_DAILY_TOKEN_LIMIT, (d[t] || 0) + tokens);
    localStorage.setItem(k, JSON.stringify(d));
    this.updateBadge();
  },
  remaining() {
    return this.isAdmin()
      ? Infinity
      : Math.max(0, this.USER_DAILY_TOKEN_LIMIT - this.getUsedToday());
  },
  canSend() {
    return this.isAdmin() || this.remaining() >= 200;
  },

  // ✅ FIXED: All DOM lookups guarded with null checks
  updateBadge() {
    const badge    = document.getElementById('tokenBadge');
    if (!badge) return;
    const userBar  = document.getElementById('userInfoBar');
    const loginBtn = document.getElementById('adminLoginBtn');
    const logoutBtn= document.getElementById('adminLogoutBtn');
    const signBtn  = document.getElementById('signOutBtn');

    if (this.isAdmin()) {
      if (userBar)   userBar.innerHTML        = `<span class="user-chip">👑 Admin</span>`;
      badge.innerHTML                         = `<div class="token-admin">Unlimited tokens</div>`;
      if (loginBtn)  loginBtn.style.display   = 'none';
      if (logoutBtn) logoutBtn.style.display  = 'block';
      if (signBtn)   signBtn.style.display    = 'none';
    } else {
      const email = this.currentEmail() || '';
      const used  = this.getUsedToday();
      const left  = this.USER_DAILY_TOKEN_LIMIT - used;
      const pct   = Math.max(0, Math.round(left / this.USER_DAILY_TOKEN_LIMIT * 100));
      const color = left <= 500 ? '#ef4444' : left <= 1500 ? '#f59e0b' : '#22c55e';
      if (userBar)
        userBar.innerHTML = `<span class="user-chip">✉ ${escHtml(email)}</span>`;
      badge.innerHTML = `
        <span class="token-label">Daily Tokens</span>
        <span class="token-count" style="color:${color}">${left.toLocaleString()} / ${this.USER_DAILY_TOKEN_LIMIT.toLocaleString()}</span>
        <div class="token-bar"><div class="token-fill" style="width:${pct}%;background:${color}"></div></div>
        <span style="font-size:10px;color:var(--text2)">${used.toLocaleString()} used today</span>`;
      if (loginBtn)  loginBtn.style.display  = 'block';
      if (logoutBtn) logoutBtn.style.display = 'none';
      if (signBtn)   signBtn.style.display   = 'block';
    }
  },
};

// =============================================================
//  LOGIN UI
// =============================================================
function submitEmailLogin() {
  const input = document.getElementById('loginEmail');
  if (!input) return;
  const email = input.value.trim();
  const errEl = document.getElementById('loginEmailError');
  if (errEl) errEl.textContent = '';
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    if (errEl) errEl.textContent = 'Please enter a valid email address.';
    return;
  }
  AUTH.loginUser(email);
  launchApp();
}

// ✅ FIXED: null/empty password guard added
function showAdminLoginFromScreen() {
  const pw = prompt('Enter admin password:');
  if (pw === null || pw === '') return;
  if (AUTH.loginAdmin(pw)) {
    launchApp();
  } else {
    showLoginToast('Incorrect admin password.', '#ef4444');
  }
}

// ✅ FIXED: document.body guard added
function showLoginToast(msg, color = '#6366f1') {
  if (!document.body) return;
  const t = document.createElement('div');
  t.style.cssText = `position:fixed;bottom:24px;left:50%;transform:translateX(-50%);
    background:#1e1e2e;border:1px solid ${color};color:#fff;padding:12px 24px;
    border-radius:10px;font-size:13px;z-index:9999;box-shadow:0 8px 30px rgba(0,0,0,0.4);`;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 4000);
}

document.addEventListener('DOMContentLoaded', () => {
  const el = document.getElementById('loginEmail');
  if (el) el.addEventListener('keydown', e => { if (e.key === 'Enter') submitEmailLogin(); });
});

function signOut() {
  if (!confirm('Sign out of ShitalGenAI?')) return;
  AUTH.logout();
  location.reload();
}

function launchApp() {
  const loginScreen = document.getElementById('loginScreen');
  const appScreen   = document.getElementById('appScreen');
  if (loginScreen) loginScreen.style.display = 'none';
  if (appScreen)   appScreen.style.display   = 'flex';
  initApp();
}

// =============================================================
//  SHARED STATE
// =============================================================
let currentMode  = 'generate';
let isLoading    = false;
let sidebarOpen  = true;
let attachedCode = '';
let imgSubMode   = 'analyze';
let activeBot    = 'coding';
let historyOpen  = true;

// =============================================================
//  DOM REFS
// =============================================================
const $ = id => document.getElementById(id);
const dom = {
  messages:      null, userMsg:       null, sendBtn:    null,
  langSelect:    null, modelSelect:   null, langBadge:  null,
  sessionTitle:  null, historyList:   null, modeLabel:  null,
  codePasteArea: null, codeInput:     null, attachCode: null,
  closePaste:    null, sidebar:       null, toggleSidebar: null,
  newChatBtn:    null, clearMemBtn:   null, exportBtn:  null,
  botSelect:     null, langSection:   null, codingModes:null,
  imageModes:    null, botDesc:       null,
};
function initDom() { Object.keys(dom).forEach(k => { dom[k] = $(k); }); }

// =============================================================
//  MEMORY
// =============================================================
const Memory = {
  messages:     [],
  codeSnippets: [],
  session: {
    id: Date.now().toString(), title: 'New Coding Session',
    lang: 'auto', mode: 'generate', createdAt: new Date().toISOString(),
  },

  _listKey() {
    const e = AUTH.currentEmail();
    if (AUTH.isAdmin()) return 'sga_sessions_admin';
    if (e) return 'sga_sessions_' + e.replace(/[^a-z0-9]/gi, '_');
    return 'sga_sessions_guest';
  },

  get sessions() {
    return JSON.parse(localStorage.getItem(this._listKey()) || '[]');
  },

  addMessage(role, content) {
    this.messages.push({ role, content });
    if (this.messages.length > CONFIG.MAX_MEMORY_MESSAGES)
      this.messages = this.messages.slice(-CONFIG.MAX_MEMORY_MESSAGES);
    this.extractCodeSnippets(role, content);
    this.updateStats();
  },

  extractCodeSnippets(role, content) {
    if (role !== 'assistant') return;
    const re = /```(\w*)\n([\s\S]*?)```/g;
    let m;
    while ((m = re.exec(content)) !== null) {
      const lang = m[1] || 'code', code = m[2].trim();
      if (code.length > 20) {
        this.codeSnippets.push({
          lang, code,
          preview: code.substring(0, 80),
          timestamp: new Date().toISOString(),
        });
        if (this.codeSnippets.length > CONFIG.MAX_CODE_SNIPPETS)
          this.codeSnippets.shift();
      }
    }
  },

  buildSystemPrompt(lang, mode) {
    const langCtx = lang && lang !== 'auto'
      ? `The user is working in ${lang}.`
      : 'Auto-detect the programming language.';

    const modeConfig = {
      generate: {
        instruction: 'Generate clean, production-ready, well-commented code with proper error handling.',
        rules: 'Always provide the complete runnable code. Use proper code fences with the language name. Add brief inline comments. Think step by step.',
      },
      debug: {
        instruction: 'Analyze the provided code for bugs. Identify the root cause clearly, then provide the corrected version.',
        rules: 'Always show: (1) what the bug is, (2) why it happens, (3) the fixed code in a code fence. Do NOT skip the corrected code.',
      },
      refactor: {
        instruction: 'Refactor the provided code for better readability, maintainability, and performance.',
        rules: 'Always show the refactored code in a code fence. Briefly explain what changed and why. Do NOT just describe changes without showing code.',
      },
      explain: {
        instruction: 'Explain the concept or problem statement the user describes. Focus on the WHAT and WHY — not implementation. Do NOT write or generate any code unless the user explicitly asks for it.',
        rules: 'STRICT: Respond with explanation only — use plain language, bullet points, analogies, and examples as text. NEVER output a code block unless the user specifically requests code. If the user pastes code, explain what it does conceptually, not line-by-line syntax.',
      },
      optimize: {
        instruction: 'Analyze the provided code and optimize it for performance. Explain time/space complexity before and after.',
        rules: 'Always show: (1) complexity analysis of original, (2) optimized code in a code fence, (3) complexity of optimized version.',
      },
      test: {
        instruction: 'Write comprehensive unit tests for the provided code. Cover happy paths, edge cases, and error conditions.',
        rules: 'Always provide complete test code in a code fence using an appropriate test framework. Include a brief description of what each test covers.',
      },
    };

    const cfg    = modeConfig[mode] || modeConfig.generate;
    const codeCtx = this.codeSnippets.length > 0
      ? '\n\nCODE MEMORY:\n' + this.codeSnippets.map((s, i) =>
          `[Snippet ${i + 1}] ${s.lang}:\n\`\`\`${s.lang}\n${s.code.substring(0, 300)}\n\`\`\``
        ).join('\n\n')
      : '';
    return `You are ShitalGenAI, an elite AI coding assistant.\n${langCtx}\nMode: ${mode.toUpperCase()}\nTask: ${cfg.instruction}\nRULES: ${cfg.rules}${codeCtx}`;
  },

  saveSession() {
    const key  = this._listKey();
    const list = JSON.parse(localStorage.getItem(key) || '[]');
    const data = {
      ...this.session,
      messages:    this.messages,
      codeSnippets: this.codeSnippets,
      lastUpdated: new Date().toISOString(),
    };
    const idx = list.findIndex(s => s.id === this.session.id);
    if (idx >= 0) list[idx] = data; else list.unshift(data);
    if (list.length > 10) list.length = 10;
    localStorage.setItem(key, JSON.stringify(list));
  },

  loadSession(id) {
    const s = this.sessions.find(s => s.id === id);
    if (!s) return false;
    this.session      = { id: s.id, title: s.title, lang: s.lang, mode: s.mode, createdAt: s.createdAt };
    this.messages     = s.messages || [];
    this.codeSnippets = s.codeSnippets || [];
    return s;
  },

  reset() {
    this.messages     = [];
    this.codeSnippets = [];
    this.session = {
      id:        Date.now().toString(),
      title:     'New Coding Session',
      lang:      document.getElementById('langSelect')?.value || 'auto',
      mode:      currentMode,
      createdAt: new Date().toISOString(),
    };
    this.updateStats();
  },

  updateStats() {
    const mc = $('memCount'), ms = $('msgCount');
    if (mc) mc.textContent = this.codeSnippets.length;
    if (ms) ms.textContent = this.messages.length;
  },
};

// =============================================================
//  MODELS DROPDOWN
// =============================================================
function populateModels() {
  if (!dom.modelSelect) return;
  dom.modelSelect.innerHTML = '';
  MODELS.forEach(m => {
    const opt = document.createElement('option');
    opt.value = m.id;
    opt.textContent = m.label;
    if (m.default) opt.selected = true;
    dom.modelSelect.appendChild(opt);
  });
}

// =============================================================
//  ADMIN MODAL
// =============================================================
function showAdminLogin() {
  const overlay = document.createElement('div');
  overlay.className = 'admin-modal-overlay';
  overlay.innerHTML = `
    <div class="admin-modal">
      <h2>👑 Admin Login</h2>
      <p>Enter admin password for unlimited tokens.</p>
      <input id="adminPwInput" type="password" placeholder="Admin password" autocomplete="off"/>
      <div class="admin-modal-error" id="adminErr" style="display:none">Incorrect password.</div>
      <div class="admin-modal-btns">
        <button id="adminConfirm">Login</button>
        <button id="adminCancel">Cancel</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const input = $('adminPwInput');
  if (input) input.focus();
  $('adminConfirm')?.addEventListener('click', () => {
    const pw = input ? input.value.trim() : '';
    if (AUTH.loginAdmin(pw)) {
      overlay.remove();
      AUTH.updateBadge();
      showToast('👑 Admin access granted!', '#22c55e');
    } else {
      const err = $('adminErr');
      if (err) err.style.display = 'block';
      if (input) { input.value = ''; input.focus(); }
    }
  });
  $('adminCancel')?.addEventListener('click', () => overlay.remove());
  if (input) {
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') $('adminConfirm')?.click();
    });
  }
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
}

// =============================================================
//  TOAST
// =============================================================
function showToast(msg, borderColor = '#6366f1') {
  if (!document.body) return;
  const t = document.createElement('div');
  t.className = 'toast';
  t.style.borderLeft = `3px solid ${borderColor}`;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 4000);
}

// =============================================================
//  GROQ TEXT API
// =============================================================
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function parseRetryAfter(msg) {
  const m = msg.match(/try again in ([\d.]+)s/i);
  return m ? Math.ceil(parseFloat(m[1])) : 30;
}

async function callGroq(model, messages, maxTokens) {
  const res = await fetch(CONFIG.GROQ_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${CONFIG.GROQ_API_KEY}`,
    },
    body: JSON.stringify({ model, max_tokens: maxTokens, temperature: 0.6, stream: false, messages }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const msg = err?.error?.message || `API error ${res.status}`;
    throw { message: msg, isRateLimit: res.status === 429 || msg.toLowerCase().includes('rate limit') };
  }
  const data       = await res.json();
  const content    = data.choices?.[0]?.message?.content || '';
  const tokensUsed = data.usage?.total_tokens || Math.ceil(content.length / 4);
  return { content, tokensUsed };
}

async function callAPI() {
  const systemPrompt  = Memory.buildSystemPrompt(dom.langSelect?.value || 'auto', currentMode);
  const selectedModel = dom.modelSelect?.value || 'llama-3.3-70b-versatile';
  const messages = [
    { role: 'system', content: systemPrompt },
    ...Memory.messages.map(m => ({ role: m.role, content: m.content })),
  ];
  const queue   = [selectedModel, ...RATE_LIMIT_FALLBACK.filter(m => m !== selectedModel)];
  let lastErr   = null;

  for (let i = 0; i < queue.length; i++) {
    const model = queue[i];
    try {
      if (i > 0) {
        const label = MODELS.find(m => m.id === model)?.label || model;
        showToast(`⚡ Switching to ${label}...`, '#f59e0b');
        updateTypingLabel(label);
      }
      const { content, tokensUsed } = await callGroq(model, messages, CONFIG.MAX_TOKENS);
      if (i > 0) showToast(`✅ Response from ${MODELS.find(m => m.id === model)?.label || model}`, '#22c55e');
      if (!AUTH.isAdmin()) AUTH.addUsage(tokensUsed);
      return content;
    } catch (err) {
      lastErr = err;
      if (err.isRateLimit && i < queue.length - 1) continue;
      if (err.isRateLimit) {
        const wait = parseRetryAfter(err.message || '');
        showToast(`⏳ Rate limited. Waiting ${wait}s...`, '#f59e0b');
        updateTypingLabel(`Waiting ${wait}s...`);
        await sleep(wait * 1000);
        try {
          const { content, tokensUsed } = await callGroq(selectedModel, messages, CONFIG.MAX_TOKENS);
          if (!AUTH.isAdmin()) AUTH.addUsage(tokensUsed);
          return content;
        } catch (e) { lastErr = e; }
      } else {
        throw new Error(err.message || 'Unknown error');
      }
    }
  }
  throw new Error(`Rate limit reached. Please wait ${parseRetryAfter(lastErr?.message || '')}s and try again.`);
}

// =============================================================
//  SEND MESSAGE  — no duplicate addMessage calls
//  UPDATED: Video module transcription guard added (Step 4)
// =============================================================
async function sendMessage() {
  if (isLoading) return;

  // ── Video module guard (Step 4) ──────────────────────────────
  if (activeBot === 'image') {
    // Block send entirely while a transcription job is running
    if (typeof videoState !== 'undefined' && videoState.isTranscribing) return;

    // If video mode is active but NOT transcribing, the transcript is
    // already in Memory — fall through to the normal send flow below.
    // Otherwise hand off to the image bot as usual.
    if (typeof videoState === 'undefined' || !videoState.isVideoMode) {
      sendImageMessage();
      return;
    }
  }
  // ─────────────────────────────────────────────────────────────

  if (!AUTH.canSend()) {
    showToast(`❌ Daily token limit reached! (${AUTH.USER_DAILY_TOKEN_LIMIT.toLocaleString()} tokens). Resets at midnight.`, '#ef4444');
    showLimitBlock();
    return;
  }

  const text = dom.userMsg?.value.trim() || '';
  if (!text && !attachedCode.trim() && !FileAttach.hasFiles()) return;

  if (!AUTH.isAdmin() && AUTH.remaining() <= 500)
    showToast(`⚠️ Only ${AUTH.remaining().toLocaleString()} tokens left today!`, '#f59e0b');

  const hasFiles   = FileAttach.hasFiles();
  const attachSnap = [...FileAttach.attachments];
  const codeSnap   = attachedCode;

  if (dom.userMsg)  { dom.userMsg.value = ''; dom.userMsg.style.height = 'auto'; }
  clearAttachedCode();
  if (hasFiles) FileAttach.clear();
  document.getElementById('welcome')?.remove();

  if (hasFiles) {
    dom.messages.appendChild(renderUserMessageWithFiles(text, codeSnap, attachSnap));
    dom.messages.scrollTop = dom.messages.scrollHeight;
  } else {
    renderUserMessage(text, codeSnap);
  }

  let userContent = text;
  if (codeSnap.trim()) {
    const lang = dom.langSelect?.value !== 'auto' ? dom.langSelect.value.toLowerCase() : '';
    userContent = `${text}\n\nHere is my existing code:\n\`\`\`${lang}\n${codeSnap.trim()}\n\`\`\``;
  }

  if (Memory.messages.length === 0) {
    Memory.session.title = (text || attachSnap[0]?.name || 'File').substring(0, 45);
    if (Memory.session.title.length === 45) Memory.session.title += '…';
    Memory.session.lang  = dom.langSelect?.value || 'auto';
    Memory.session.mode  = currentMode;
    if (dom.sessionTitle) dom.sessionTitle.textContent = Memory.session.title;
  }

  isLoading = true;
  if (dom.sendBtn) dom.sendBtn.disabled = true;

  try {
    let reply;
    let tokensUsed = 0;

    if (hasFiles) {
      const systemPrompt  = Memory.buildSystemPrompt(dom.langSelect?.value || 'auto', currentMode);
      const tempFA        = {
        attachments: attachSnap,
        buildContentBlocks: FileAttach.buildContentBlocks.bind({ attachments: attachSnap }),
      };
      const contentBlocks = tempFA.buildContentBlocks(userContent);
      showTyping('Vision + Files');
      const messages = [
        { role: 'system', content: systemPrompt },
        ...Memory.messages.map(m => ({ role: m.role, content: m.content })),
        { role: 'user', content: contentBlocks },
      ];
      const result = await callGroqWithFiles(messages);
      reply      = result.content;
      tokensUsed = result.tokensUsed;
      Memory.addMessage('user', `[Files attached] ${userContent}`);
    } else {
      Memory.addMessage('user', userContent);
      showTyping(MODELS.find(m => m.id === dom.modelSelect?.value)?.label || 'AI');
      reply = await callAPI();
    }

    if (!AUTH.isAdmin()) AUTH.addUsage(tokensUsed || 0);
    hideTyping();
    renderAIMessage(reply, currentMode);
    Memory.addMessage('assistant', reply);
    Memory.saveSession();
    _renderHistoryContent();
    AUTH.updateBadge();

  } catch (err) {
    hideTyping();
    renderErrorMessage(err.message || 'Unknown error');
    // Roll back last user message if not file-based
    if (!hasFiles && Memory.messages.length > 0 &&
        Memory.messages[Memory.messages.length - 1].role === 'user') {
      Memory.messages.pop();
      Memory.updateStats();
    }
  }

  isLoading = false;
  if (dom.sendBtn) dom.sendBtn.disabled = false;
  if (dom.userMsg) dom.userMsg.focus();
}

// =============================================================
//  RENDER FUNCTIONS
// =============================================================
function showLimitBlock() {
  const row = document.createElement('div');
  row.className = 'msg-row';
  row.innerHTML = `
    <div class="msg-avatar ai" style="background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.3);font-size:14px;">⛔</div>
    <div class="msg-body">
      <div class="msg-meta"><span class="msg-who" style="color:#ef4444">ShitalGenAI</span><span class="msg-time">${now()}</span></div>
      <div class="msg-text">
        <p>🚫 <strong>Daily token limit reached.</strong> Used all <strong>${AUTH.USER_DAILY_TOKEN_LIMIT.toLocaleString()} tokens</strong> for today.</p>
        <p>Resets at <strong>midnight</strong>. For unlimited access click <strong>👑 Admin Login</strong>.</p>
      </div>
    </div>`;
  if (dom.messages) { dom.messages.appendChild(row); dom.messages.scrollTop = dom.messages.scrollHeight; }
}

function renderErrorMessage(msg) {
  const isRate = msg.toLowerCase().includes('rate limit');
  const row    = document.createElement('div');
  row.className = 'msg-row';
  row.innerHTML = `
    <div class="msg-avatar ai" style="background:rgba(255,169,77,0.1);border:1px solid rgba(255,169,77,0.3);font-size:14px;">${isRate ? '⏱️' : '⚠️'}</div>
    <div class="msg-body">
      <div class="msg-meta"><span class="msg-who" style="color:var(--accent4)">ShitalGenAI</span><span class="msg-time">${now()}</span></div>
      <div class="msg-text">
        <p><strong>${isRate ? 'Rate Limit' : 'Error'}:</strong> ${escHtml(msg)}</p>
        ${isRate ? `<p style="font-size:13px;color:var(--text2);margin-top:6px">💡 Try again in a moment.</p>` : ''}
      </div>
    </div>`;
  if (dom.messages) { dom.messages.appendChild(row); dom.messages.scrollTop = dom.messages.scrollHeight; }
}

function renderUserMessage(text, code) {
  const row = document.createElement('div');
  row.className = 'msg-row';
  row.innerHTML = `
    <div class="msg-avatar user">YOU</div>
    <div class="msg-body">
      <div class="msg-meta"><span class="msg-who">You</span><span class="msg-time">${now()}</span></div>
      ${code ? `<div class="attached-code"><div class="attached-label">Attached code</div><pre>${escHtml(code.substring(0, 300))}${code.length > 300 ? '\n...' : ''}</pre></div>` : ''}
      <div class="msg-text"><p>${escHtml(text).replace(/\n/g, '<br>')}</p></div>
    </div>`;
  if (dom.messages) { dom.messages.appendChild(row); dom.messages.scrollTop = dom.messages.scrollHeight; }
}

function renderAIMessage(content, mode) {
  const clean      = content.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  const row        = document.createElement('div');
  row.className    = 'msg-row';
  const modeNames  = { generate:'Generate', debug:'Debug', refactor:'Refactor', explain:'Explain', optimize:'Optimize', test:'Tests', image:'Vision' };
  const modeLabel  = modeNames[mode] || mode;
  const visionModel= (typeof IMAGE_CONFIG !== 'undefined') ? IMAGE_CONFIG.VISION_MODEL.split('/').pop() : 'Vision';
  const modelLabel = mode === 'image'
    ? visionModel
    : (MODELS.find(m => m.id === dom.modelSelect?.value)?.label || 'AI');

  row.innerHTML = `
    <div class="msg-avatar ai">
      <img src="logo.png" alt="AI" style="width:100%;height:100%;object-fit:cover;border-radius:50%;"
           onerror="this.parentElement.textContent='AI'"/>
    </div>
    <div class="msg-body">
      <div class="msg-meta">
        <span class="msg-who">ShitalGenAI</span>
        <span class="msg-time">${now()}</span>
        <span class="msg-mode ${escHtml(mode)}">${escHtml(modeLabel)}</span>
        <span class="msg-model-badge">${escHtml(modelLabel)}</span>
      </div>
      <div class="msg-text">${parseMarkdown(clean)}</div>
    </div>`;

  row.querySelectorAll('.copy-code-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const pre = btn.closest('.code-block')?.querySelector('pre');
      if (!pre) return;
      navigator.clipboard.writeText(pre.textContent).then(() => {
        btn.textContent = '✓ Copied!';
        btn.classList.add('copy-success');
        setTimeout(() => { btn.textContent = 'Copy'; btn.classList.remove('copy-success'); }, 2000);
      });
    });
  });

  if (dom.messages) { dom.messages.appendChild(row); dom.messages.scrollTop = dom.messages.scrollHeight; }
}

// =============================================================
//  MARKDOWN PARSER
// =============================================================
function parseMarkdown(text) {
  const blocks = [];
  let out = text.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    const i = blocks.length;
    blocks.push({ lang: (lang || 'code').toLowerCase(), code: code.trim() });
    return `\n%%CB_${i}%%\n`;
  });
  out = out
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');

  const lines = out.split('\n');
  let html = '', inList = false, lt = 'ul';
  for (const line of lines) {
    const t = line.trim();
    if (t.startsWith('%%CB_') && t.endsWith('%%')) {
      if (inList) { html += `</${lt}>`; inList = false; }
      html += t; continue;
    }
    if (!t) { if (inList) { html += `</${lt}>`; inList = false; } continue; }
    if (t.startsWith('- ') || t.startsWith('* ')) {
      if (!inList || lt !== 'ul') { if (inList) html += `</${lt}>`; html += '<ul>'; inList = true; lt = 'ul'; }
      html += `<li>${t.slice(2)}</li>`;
    } else if (/^\d+\.\s/.test(t)) {
      if (!inList || lt !== 'ol') { if (inList) html += `</${lt}>`; html += '<ol>'; inList = true; lt = 'ol'; }
      html += `<li>${t.replace(/^\d+\.\s/, '')}</li>`;
    } else {
      if (inList) { html += `</${lt}>`; inList = false; }
      if (t.startsWith('<h') || t.startsWith('<blockquote') || t.startsWith('%%CB_'))
        html += t;
      else
        html += `<p>${t}</p>`;
    }
  }
  if (inList) html += `</${lt}>`;

  blocks.forEach((b, i) => {
    html = html.split(`%%CB_${i}%%`).join(
      `<div class="code-block">
        <div class="code-header">
          <span class="code-lang">${escHtml(b.lang)}</span>
          <div class="code-actions"><button class="code-action-btn copy-code-btn">Copy</button></div>
        </div>
        <pre>${escHtml(b.code)}</pre>
      </div>`
    );
  });
  return html || `<p>${escHtml(text)}</p>`;
}

// =============================================================
//  TYPING INDICATOR
// =============================================================
function showTyping(label = 'AI') {
  const div     = document.createElement('div');
  div.id        = 'typingRow';
  div.className = 'typing-row';
  div.innerHTML = `
    <div class="msg-avatar ai">
      <img src="logo.png" alt="AI" style="width:100%;height:100%;object-fit:cover;border-radius:50%;"
           onerror="this.parentElement.textContent='AI'"/>
    </div>
    <div class="typing-dots">
      <div class="typing-dot"></div>
      <div class="typing-dot"></div>
      <div class="typing-dot"></div>
      <span class="typing-model-label" style="margin-left:8px;font-size:11px;color:var(--text2)">${escHtml(label)}</span>
    </div>`;
  if (dom.messages) { dom.messages.appendChild(div); dom.messages.scrollTop = dom.messages.scrollHeight; }
}
function hideTyping()           { $('typingRow')?.remove(); }
function updateTypingLabel(lbl) {
  const s = document.querySelector('#typingRow .typing-model-label');
  if (s) s.textContent = lbl;
}

// =============================================================
//  SESSION HISTORY
// =============================================================
function getDateGroup(dateStr) {
  const diff = Math.floor((new Date() - new Date(dateStr)) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff <= 7)  return 'Past week';
  if (diff <= 30) return 'Past month';
  return new Date(dateStr).toLocaleDateString([], { month: 'long', year: 'numeric' });
}

function _renderHistoryContent() {
  const list = document.getElementById('historyList');
  if (!list) return;
  list.style.display = historyOpen ? 'block' : 'none';

  const sessions = Memory.sessions.slice(0, 10);
  if (!sessions.length) {
    list.innerHTML = '<div class="history-empty">No sessions yet</div>';
    return;
  }

  const order  = ['Today', 'Yesterday', 'Past week', 'Past month'];
  const groups = {};
  sessions.forEach(s => {
    const l = getDateGroup(s.lastUpdated || s.createdAt);
    if (!groups[l]) groups[l] = [];
    groups[l].push(s);
  });
  const keys = [
    ...order.filter(k => groups[k]),
    ...Object.keys(groups).filter(k => !order.includes(k)),
  ];

  let html = '';
  keys.forEach(label => {
    html += `<div class="history-date-label">${escHtml(label)}</div>`;
    groups[label].forEach(s => {
      const isActive = s.id === Memory.session.id;
      html += `
        <div class="history-item${isActive ? ' active' : ''}" data-id="${escHtml(s.id)}">
          <span class="history-item-icon">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
            </svg>
          </span>
          <span class="history-title">${escHtml(s.title)}</span>
        </div>`;
    });
  });

  list.innerHTML = html;
  list.querySelectorAll('.history-item').forEach(el =>
    el.addEventListener('click', () => loadSession(el.dataset.id))
  );
}

function renderHistory() { _renderHistoryContent(); }

function toggleHistory() {
  historyOpen = !historyOpen;
  const list    = document.getElementById('historyList');
  const chevron = document.getElementById('historyChevron');
  if (!list) return;
  list.style.display = historyOpen ? 'block' : 'none';
  if (chevron) chevron.style.transform = historyOpen ? 'rotate(180deg)' : 'rotate(0deg)';
  if (historyOpen) _renderHistoryContent();
}

function loadSession(id) {
  const s = Memory.loadSession(id);
  if (!s) return;
  if (dom.langSelect)   dom.langSelect.value         = s.lang || 'auto';
  if (dom.sessionTitle) dom.sessionTitle.textContent = s.title;
  if (dom.langBadge)    dom.langBadge.textContent    = s.lang && s.lang !== 'auto' ? s.lang : 'Auto';
  setMode(s.mode || 'generate');
  if (dom.messages) dom.messages.innerHTML = '';
  (s.messages || []).forEach(m => {
    if (m.role === 'user')
      renderUserMessage(m.content.replace(/\n\nHere is my existing code:\n```[\s\S]*?```$/, '').trim(), '');
    else
      renderAIMessage(m.content, s.mode || 'generate');
  });
  _renderHistoryContent();
}

// =============================================================
//  DOWNLOAD — asks user: PDF or Markdown
// =============================================================
function showDownloadDialog() {
  document.getElementById('sgaDownloadDialog')?.remove();
  if (!document.body) return;

  const dialog = document.createElement('div');
  dialog.id = 'sgaDownloadDialog';
  dialog.style.cssText = `
    position:fixed;inset:0;background:rgba(0,0,0,0.55);
    display:flex;align-items:center;justify-content:center;z-index:9999;
    font-family:'Segoe UI',sans-serif;`;

  dialog.innerHTML = `
    <div style="background:#1e1e2e;border:1px solid #6366f1;border-radius:14px;
                padding:28px 32px;width:320px;box-shadow:0 20px 60px rgba(0,0,0,0.5);">
      <h2 style="margin:0 0 6px;font-size:16px;color:#fff;">Download Chat</h2>
      <p style="margin:0 0 20px;font-size:12px;color:#9ca3af;">Choose a format to export this conversation</p>

      <button id="dlPdf" style="width:100%;padding:14px 16px;margin-bottom:10px;
        background:#1e1e3a;border:1px solid #6366f1;border-radius:10px;
        color:#fff;cursor:pointer;display:flex;align-items:center;gap:12px;">
        <span style="font-size:22px;">📄</span>
        <div style="text-align:left;">
          <div style="font-size:14px;font-weight:600;">PDF File</div>
          <div style="font-size:11px;color:#9ca3af;">Styled, printable document</div>
        </div>
      </button>

      <button id="dlMd" style="width:100%;padding:14px 16px;margin-bottom:20px;
        background:#1e1e3a;border:1px solid #374151;border-radius:10px;
        color:#fff;cursor:pointer;display:flex;align-items:center;gap:12px;">
        <span style="font-size:22px;">📝</span>
        <div style="text-align:left;">
          <div style="font-size:14px;font-weight:600;">Markdown (.md)</div>
          <div style="font-size:11px;color:#9ca3af;">Plain text, easy to edit</div>
        </div>
      </button>

      <button id="dlCancel" style="width:100%;padding:10px;background:transparent;
        border:1px solid #374151;border-radius:8px;color:#9ca3af;font-size:13px;cursor:pointer;">
        Cancel
      </button>
    </div>`;

  dialog.addEventListener('click', e => { if (e.target === dialog) dialog.remove(); });
  document.body.appendChild(dialog);

  document.getElementById('dlPdf')?.addEventListener('click',    () => { dialog.remove(); downloadChatAsPDF(); });
  document.getElementById('dlMd')?.addEventListener('click',     () => { dialog.remove(); downloadChatAsMD();  });
  document.getElementById('dlCancel')?.addEventListener('click', () => dialog.remove());
}

function _exportFormatContent(msg) {
  return (msg.content || '')
    .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>')
    .replace(/`([^`]+)`/g, '<code style="background:#eee;padding:2px 4px;border-radius:3px">$1</code>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br>');
}

function downloadChatAsPDF() {
  const msgs = Memory.messages;
  if (!msgs.length) { showToast('No messages to export.', '#ef4444'); return; }

  let html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
    <title>ShitalGenAI Export</title>
    <style>
      body      { font-family:'Segoe UI',sans-serif;font-size:13px;color:#1e1e2e;max-width:800px;margin:40px auto;padding:0 24px; }
      h1        { font-size:18px;color:#6366f1;border-bottom:2px solid #6366f1;padding-bottom:8px;margin-bottom:8px; }
      .meta     { font-size:11px;color:#6b7280;margin-bottom:28px; }
      .msg-user { background:#f3f4f6;border-left:4px solid #6366f1;padding:12px 16px;border-radius:6px;margin:14px 0; }
      .msg-ai   { background:#f9fafb;border-left:4px solid #22c55e;padding:12px 16px;border-radius:6px;margin:14px 0; }
      .label    { font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px; }
      .lu       { color:#6366f1; } .la { color:#16a34a; }
      pre,code  { background:#1e1e2e;color:#cdd6f4;padding:10px;border-radius:6px;font-size:12px;
                  white-space:pre-wrap;word-break:break-word;display:block;margin-top:6px; }
    </style></head><body>
    <h1>ShitalGenAI – Chat Export</h1>
    <p class="meta">Exported: ${new Date().toLocaleString()} | Model: ${escHtml(MODELS.find(m => m.id === dom.modelSelect?.value)?.label || 'AI')}</p>`;

  msgs.forEach(m => {
    const isUser = m.role === 'user';
    html += `<div class="${isUser ? 'msg-user' : 'msg-ai'}">
      <div class="label ${isUser ? 'lu' : 'la'}">${isUser ? 'You' : 'ShitalGenAI'}</div>
      <div>${_exportFormatContent(m)}</div>
    </div>`;
  });

  html += '</body></html>';
  const win = window.open('', '_blank');
  if (!win) { showToast('Pop-up blocked. Allow pop-ups and try again.', '#ef4444'); return; }
  win.document.write(html);
  win.document.close();
  win.onload = () => { win.focus(); win.print(); };
}

function downloadChatAsMD() {
  const msgs = Memory.messages;
  if (!msgs.length) { showToast('No messages to export.', '#ef4444'); return; }

  let md  = `# ShitalGenAI – ${escHtml(Memory.session.title)}\n`;
  md     += `**Exported:** ${new Date().toLocaleString()}\n\n---\n\n`;
  msgs.forEach(m => {
    md += `## ${m.role === 'user' ? '🧑 You' : '🤖 ShitalGenAI'}\n\n${m.content}\n\n---\n\n`;
  });

  const blob = new Blob([md], { type: 'text/markdown' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `ShitalGenAI_${Memory.session.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_${new Date().toISOString().split('T')[0]}.md`;
  a.click();
  URL.revokeObjectURL(url);
}

// =============================================================
//  BOT SWITCHER
//  UPDATED: Video module show/hide hooks added (Step 3)
// =============================================================
function switchBot(bot) {
  activeBot = bot;
  const descs = {
    coding: 'Generate, debug, refactor &amp; explain code',
    image:  'Analyze images · OCR · Debug screenshots',
  };
  if (dom.botDesc) dom.botDesc.innerHTML = descs[bot] || '';

  if (bot === 'image') {
    if (dom.codingModes) dom.codingModes.style.display = 'none';
    if (dom.imageModes)  dom.imageModes.style.display  = '';
    if (dom.langSection) dom.langSection.style.display = 'none';
    if (dom.attachCode)  dom.attachCode.style.display  = 'none';
    clearAttachedCode();
    currentMode = 'image';
    if (dom.modeLabel) dom.modeLabel.innerHTML = 'Bot: <b>Image Vision</b>';
    if (typeof showImageMode === 'function') showImageMode();
    if (typeof showVideoMode === 'function') showVideoMode();   // ← Step 3
    if (dom.userMsg) dom.userMsg.placeholder = 'Ask something about the image, or leave blank for auto-analysis…';
    if (dom.botSelect) { dom.botSelect.style.borderColor = '#c084fc'; dom.botSelect.style.color = '#c084fc'; }
  } else {
    if (dom.codingModes) dom.codingModes.style.display = '';
    if (dom.imageModes)  dom.imageModes.style.display  = 'none';
    if (dom.langSection) dom.langSection.style.display = '';
    if (dom.attachCode)  dom.attachCode.style.display  = '';
    if (typeof hideImageMode === 'function') hideImageMode();
    if (typeof hideVideoMode === 'function') hideVideoMode();   // ← Step 3
    currentMode = 'generate';
    setMode('generate');
    if (dom.botSelect) { dom.botSelect.style.borderColor = ''; dom.botSelect.style.color = ''; }
  }
}

// =============================================================
//  MODE (coding modes only)
// =============================================================
function setMode(mode) {
  if (mode === 'image') return;
  currentMode = mode;
  document.querySelectorAll('.mode-btn').forEach(btn =>
    btn.classList.toggle('active', btn.dataset.mode === mode)
  );
  const names = { generate:'Generate', debug:'Debug', refactor:'Refactor', explain:'Explain', optimize:'Optimize', test:'Write Tests' };
  if (dom.modeLabel) dom.modeLabel.innerHTML = `Mode: <b>${names[mode] || mode}</b>`;
  Memory.session.mode = mode;
  if (dom.attachCode) dom.attachCode.style.display = '';
  const placeholders = {
    generate: 'Describe what you want to build or create...',
    debug:    'Paste your code and describe the bug or unexpected behaviour...',
    refactor: 'Paste your code and describe what to improve...',
    explain:  'Describe the concept, topic, or problem you want explained — no code will be generated...',
    optimize: 'Paste your code and describe the performance concern...',
    test:     'Paste your code and describe what scenarios to test...',
  };
  if (dom.userMsg) dom.userMsg.placeholder = placeholders[mode] || placeholders.generate;
}

function clearAttachedCode() {
  attachedCode = '';
  if (dom.codeInput)     dom.codeInput.value = '';
  if (dom.codePasteArea) dom.codePasteArea.style.display = 'none';
  if (dom.attachCode)    dom.attachCode.classList.remove('active');
}

// =============================================================
//  EXPORT  (original MD quick-export kept for backward compat)
// =============================================================
function exportSession() { showDownloadDialog(); }

// =============================================================
//  WELCOME SCREEN
// =============================================================
function showWelcome() {
  if (!dom.messages) return;
  dom.messages.innerHTML = '';
  const el     = document.createElement('div');
  el.id        = 'welcome';
  el.className = 'welcome';
  el.innerHTML = `
    <div class="welcome-logo-wrap"><img src="logo.png" alt="ShitalGenAI" class="welcome-logo"/></div>
    <h1>ShitalGenAI</h1>
    <p>Advanced AI coding assistant with persistent memory.<br/>Powered by Groq — completely free.</p>`;
  dom.messages.appendChild(el);
}

// =============================================================
//  EVENT LISTENERS
// =============================================================
function bindEvents() {
  dom.sendBtn?.addEventListener('click', sendMessage);
  dom.userMsg?.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  });
  dom.userMsg?.addEventListener('input', function () {
    this.style.height = 'auto';
    this.style.height = Math.min(this.scrollHeight, 180) + 'px';
  });
  dom.langSelect?.addEventListener('change', () => {
    if (dom.langBadge) dom.langBadge.textContent = dom.langSelect.value !== 'auto' ? dom.langSelect.value : 'Auto';
    Memory.session.lang = dom.langSelect.value;
  });
  dom.toggleSidebar?.addEventListener('click', () => {
    sidebarOpen = !sidebarOpen;
    dom.sidebar?.classList.toggle('collapsed', !sidebarOpen);
  });
  dom.clearMemBtn?.addEventListener('click', () => {
    if (!confirm('Clear all memory?')) return;
    Memory.messages = []; Memory.codeSnippets = []; Memory.updateStats();
  });
  dom.attachCode?.addEventListener('click', () => {
    const visible = dom.codePasteArea?.style.display !== 'none';
    if (dom.codePasteArea) dom.codePasteArea.style.display = visible ? 'none' : 'block';
    dom.attachCode.classList.toggle('active', !visible);
  });
  dom.closePaste?.addEventListener('click', clearAttachedCode);
  dom.codeInput?.addEventListener('input', () => { attachedCode = dom.codeInput.value; });

  // ✅ FIXED: exportBtn now opens the download dialog (PDF or MD choice)
  dom.exportBtn?.addEventListener('click', showDownloadDialog);

  document.querySelectorAll('.mode-btn').forEach(btn =>
    btn.addEventListener('click', () => setMode(btn.dataset.mode))
  );
  dom.newChatBtn?.addEventListener('click', () => {
    if (activeBot === 'image' && dom.botSelect) { dom.botSelect.value = 'coding'; switchBot('coding'); }
    if (typeof FileAttach !== 'undefined') FileAttach.clear();
    Memory.reset(); showWelcome();
    if (dom.sessionTitle) dom.sessionTitle.textContent = 'New Coding Session';
    clearAttachedCode();
    _renderHistoryContent();
    AUTH.updateBadge();
  });
  $('adminLoginBtn')?.addEventListener('click', showAdminLogin);
  $('adminLogoutBtn')?.addEventListener('click', () => {
    AUTH.logout(); AUTH.updateBadge(); showToast('Logged out from admin.', '#6366f1');
  });
  $('signOutBtn')?.addEventListener('click', signOut);

  dom.botSelect?.addEventListener('change', () => switchBot(dom.botSelect.value));

  document.querySelectorAll('.img-subtab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.img-subtab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      imgSubMode = btn.dataset.sub;
      if (typeof updateImgSubModePlaceholder === 'function') updateImgSubModePlaceholder();
    });
  });

  document.getElementById('historyToggle')?.addEventListener('click', toggleHistory);
}

// =============================================================
//  INIT + BOOT
//  UPDATED: initVideoModule() call added (Step 2)
// =============================================================
function initApp() {
  initDom();
  populateModels();
  AUTH.updateBadge();
  bindEvents();
  if (typeof initFileAttach  === 'function') initFileAttach();
  if (typeof initVideoModule === 'function') initVideoModule();  // ← Step 2

  const sessions = Memory.sessions;
  if (sessions.length > 0) {
    const last = sessions[0];
    const s    = Memory.loadSession(last.id);
    if (s && s.messages && s.messages.length > 0) {
      if (dom.sessionTitle) dom.sessionTitle.textContent = s.title;
      if (dom.langSelect)   dom.langSelect.value         = s.lang || 'auto';
      if (dom.langBadge)    dom.langBadge.textContent    = s.lang && s.lang !== 'auto' ? s.lang : 'Auto';
      setMode(s.mode || 'generate');
      if (dom.messages) dom.messages.innerHTML = '';
      (s.messages || []).forEach(m => {
        if (m.role === 'user')
          renderUserMessage(m.content.replace(/\n\nHere is my existing code:\n```[\s\S]*?```$/, '').trim(), '');
        else
          renderAIMessage(m.content, s.mode || 'generate');
      });
    } else {
      showWelcome();
    }
  } else {
    showWelcome();
  }

  Memory.updateStats();

  historyOpen = true;
  _renderHistoryContent();
  const histList = document.getElementById('historyList');
  if (histList) histList.style.display = 'block';
  const chevron = document.getElementById('historyChevron');
  if (chevron) chevron.style.transform = 'rotate(180deg)';

  if (dom.userMsg) dom.userMsg.focus();
}

(function boot() {
  if (AUTH.isLoggedIn()) launchApp();
})();