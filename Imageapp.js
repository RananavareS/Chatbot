// =============================================================
//  ShitalGenAI — Image Vision Bot  (imageapp.js)
//  Supports: Single image · Multiple images · ZIP · Folder
//  Depends on: CONFIG, AUTH, dom, isLoading, imgSubMode,
//              showToast, showLimitBlock, showTyping, hideTyping,
//              renderAIMessage, renderErrorMessage, Memory,
//              escHtml, now  ·  JSZip from CDN (for ZIP)
// =============================================================

const IMAGE_CONFIG = {
  VISION_MODEL: 'meta-llama/llama-4-scout-17b-16e-instruct',
  MAX_FILE_MB:  400,
  BATCH_SIZE:   10,
};

// =============================================================
//  IMAGE BOT — manages all attached items
// =============================================================
const ImageBot = {
  items: [],

  _readDataURL(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload  = e => resolve(e.target.result);
      r.onerror = () => reject('Failed to read: ' + file.name);
      r.readAsDataURL(file);
    });
  },
  _readText(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload  = e => resolve(e.target.result);
      r.onerror = () => reject('Failed to read: ' + file.name);
      r.readAsText(file);
    });
  },
  _readArrayBuffer(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload  = e => resolve(e.target.result);
      r.onerror = () => reject('Failed to read: ' + file.name);
      r.readAsArrayBuffer(file);
    });
  },

  async attachImage(file) {
    if (!file.type.startsWith('image/'))
      throw 'Not an image file.';
    if (file.size > IMAGE_CONFIG.MAX_FILE_MB * 1024 * 1024)
      throw `File too large (max ${IMAGE_CONFIG.MAX_FILE_MB} MB total).`;
    const dataUrl = await this._readDataURL(file);
    this.items.push({ kind: 'image', name: file.name, dataUrl, mimeType: file.type });
    return dataUrl;
  },

  async attachImages(fileList) {
    const files = Array.from(fileList).filter(f => f.type.startsWith('image/'));
    if (!files.length) { showToast('⚠️ No image files selected.', '#f59e0b'); return; }
    let added = 0;
    for (const file of files) {
      try { await this.attachImage(file); added++; } catch (e) { showToast('⚠️ ' + e, '#ef4444'); }
    }
    if (added > 0) {
      updateImgPanelUI();
      showToast(`[IMG] ${added} image${added > 1 ? 's' : ''} attached.`, '#22c55e');
    }
  },

  async attachZip(file) {
    if (typeof JSZip === 'undefined') {
      showToast('⚠️ JSZip not loaded. Cannot read ZIP.', '#ef4444'); return;
    }
    showToast('📦 Reading ZIP…', '#6366f1');
    try {
      const buf = await this._readArrayBuffer(file);
      const zip = await JSZip.loadAsync(buf);

      const IMG_EXT  = /\.(jpe?g|png|webp|gif|bmp)$/i;
      const TEXT_EXT = /\.(js|ts|py|java|c|cpp|cs|go|rs|php|rb|html|css|json|xml|yaml|yml|md|txt|sh|sql|csv)$/i;

      const imgEntries  = [];
      const textEntries = [];
      zip.forEach((relPath, entry) => {
        if (entry.dir) return;
        if (IMG_EXT.test(relPath)) imgEntries.push({ relPath, entry });
        if (TEXT_EXT.test(relPath) && textEntries.length < 15) textEntries.push({ relPath, entry });
      });

      for (const { relPath, entry } of imgEntries) {
        const blob     = await entry.async('blob');
        const mimeType = blob.type || 'image/png';
        const dataUrl  = await new Promise(res => {
          const r = new FileReader();
          r.onload = e => res(e.target.result);
          r.readAsDataURL(blob);
        });
        this.items.push({ kind: 'image', name: relPath, dataUrl, mimeType });
      }

      if (textEntries.length > 0) {
        let combined = `ZIP: ${file.name} (${textEntries.length} text files)\n${'─'.repeat(40)}\n`;
        let chars = 0;
        for (const { relPath, entry } of textEntries) {
          if (chars > 20000) { combined += '\n[…truncated]\n'; break; }
          const text    = await entry.async('string');
          const snippet = text.substring(0, 2500);
          combined += `\n── ${relPath} ──\n${snippet}${text.length > 2500 ? '\n[…]' : ''}\n`;
          chars    += snippet.length;
        }
        this.items.push({ kind: 'zip', name: file.name, text: combined, fileCount: textEntries.length });
      }

      const total = imgEntries.length + textEntries.length;
      updateImgPanelUI();
      showToast(`[ZIP] ${imgEntries.length} images + ${textEntries.length} text files.`, '#00d4aa');
      if (total === 0) showToast('⚠️ No readable files found in ZIP.', '#f59e0b');
    } catch (err) {
      showToast('⚠️ Failed to read ZIP: ' + (err.message || err), '#ef4444');
    }
  },

  // ── Attach folder — ONE chip, no individual image loading ─
  async attachFolder(fileList) {
    const files      = Array.from(fileList);
    const folderName = files[0]?.webkitRelativePath?.split('/')[0] || 'folder';
    const IMG_EXT    = /\.(jpe?g|png|webp|gif|bmp|svg|tiff?)$/i;
    const TEXT_EXT   = /\.(js|ts|py|java|c|cpp|cs|go|rs|php|rb|html|css|json|xml|yaml|yml|md|txt|sh|sql|csv)$/i;

    const imgFiles   = files.filter(f => IMG_EXT.test(f.name));
    const textFiles  = files.filter(f => TEXT_EXT.test(f.name)).slice(0, 20);
    const totalFiles = files.length;

    if (totalFiles === 0) {
      showToast('⚠️ Folder appears to be empty.', '#f59e0b'); return;
    }

    showToast(`📁 Reading folder "${folderName}"…`, '#6366f1');

    let summary  = `FOLDER: ${folderName}\n`;
    summary     += `Total: ${totalFiles} files`;
    if (imgFiles.length)  summary += ` · ${imgFiles.length} images`;
    if (textFiles.length) summary += ` · ${textFiles.length} code/text`;
    summary += `\n${'─'.repeat(50)}\n`;

    if (imgFiles.length > 0) {
      summary += `\n📷 Images (${imgFiles.length}):\n`;
      imgFiles.slice(0, 100).forEach(f => {
        summary += `  ${f.webkitRelativePath || f.name}\n`;
      });
      if (imgFiles.length > 100) summary += `  …and ${imgFiles.length - 100} more\n`;
    }

    if (textFiles.length > 0) {
      summary += `\n📝 Code/Text files:\n${'─'.repeat(30)}\n`;
      let chars = 0;
      for (const file of textFiles) {
        if (chars > 20000) { summary += '\n[…truncated]\n'; break; }
        try {
          const text    = await this._readText(file);
          const rel     = file.webkitRelativePath || file.name;
          const snippet = text.substring(0, 2500);
          summary += `\n── ${rel} ──\n${snippet}${text.length > 2500 ? '\n[…]' : ''}\n`;
          chars   += snippet.length;
        } catch (_) {}
      }
    }

    this.items.push({
      kind:       'folder',
      name:       folderName,
      text:       summary,
      fileCount:  totalFiles,
      imageCount: imgFiles.length,
      mimeType:   'text/plain',
    });

    updateImgPanelUI();
    showToast(`📁 Folder: ${totalFiles} files attached (${imgFiles.length} images).`, '#00d4aa');
  },

  remove(index) {
    this.items.splice(index, 1);
    updateImgPanelUI();
  },

  clear() {
    this.items = [];
    updateImgPanelUI();
  },

  imageCount()  { return this.items.filter(i => i.kind === 'image').length; },
  hasItems()    { return this.items.length > 0; },
  hasImages()   { return this.items.some(i => i.kind === 'image'); },

  systemPrompt(subMode) {
    return {
      analyze:  'You are ShitalGenAI Vision. Analyze all provided images and files thoroughly. You have memory of the full conversation — use it to answer follow-up questions without requiring re-attachment. Describe content, colors, layout, objects, text, context, and notable details. Be comprehensive and precise.',
      ocr:      'You are ShitalGenAI Vision. Extract ALL visible text from every image exactly as it appears. Preserve formatting and structure. Wrap code in code fences. You have memory of the full conversation — use it to answer follow-up questions without requiring re-attachment.',
      debug:    'You are ShitalGenAI Vision. Analyze code screenshots. Identify all bugs, errors, and improvements. Provide corrected code in fenced blocks. You have memory of the full conversation — use it to answer follow-up questions without requiring re-attachment.',
      question: 'You are ShitalGenAI Vision. Answer questions about the provided images and files accurately and helpfully. You have memory of the full conversation — use it to answer all follow-up questions without requiring the user to re-attach files.',
    }[subMode] || 'You are ShitalGenAI Vision. Analyze all provided images and files thoroughly. You have full conversation memory — use it to answer follow-up questions without requiring re-attachment.';
  },

  // ── Build messages for ONE batch of images — includes history ──
  buildBatchMessages(imageItems, batchIndex, totalBatches, userText, subMode) {
    const contentBlocks = [];
    const batchLabel    = totalBatches > 1
      ? `Batch ${batchIndex + 1} of ${totalBatches} - images ${batchIndex * IMAGE_CONFIG.BATCH_SIZE + 1} to ${batchIndex * IMAGE_CONFIG.BATCH_SIZE + imageItems.length}`
      : '';

    imageItems.forEach(item => {
      contentBlocks.push({ type: 'image_url', image_url: { url: item.dataUrl } });
    });

    let textPart = batchLabel ? `[${batchLabel}]\n${userText}` : userText;

    // Attach folder/zip text context only on first batch
    if (batchIndex === 0) {
      const textItems = this.items.filter(i => i.kind === 'zip' || i.kind === 'folder');
      if (textItems.length > 0) {
        textPart += '\n\n--- Attached Files ---';
        textItems.forEach(item => { textPart += `\n\n${item.text}`; });
      }
    }

    contentBlocks.push({ type: 'text', text: textPart });

    // Include full conversation history for memory
    return [
      { role: 'system', content: this.systemPrompt(subMode) },
      ...Memory.messages.map(m => ({ role: m.role, content: m.content })),
      { role: 'user',   content: contentBlocks },
    ];
  },

  get attachedImage()     { return this.items.find(i => i.kind === 'image')?.dataUrl || null; },
  get attachedImageName() { return this.items.find(i => i.kind === 'image')?.name || null; },
};

// =============================================================
//  GROQ VISION API CALL
// =============================================================
async function callGroqVision(messages) {
  const res = await fetch(CONFIG.GROQ_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${CONFIG.GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model:       IMAGE_CONFIG.VISION_MODEL,
      max_tokens:  CONFIG.MAX_TOKENS,
      temperature: 0.5,
      stream:      false,
      messages,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const msg = err?.error?.message || `Vision API error ${res.status}`;
    throw { message: msg, isRateLimit: res.status === 429 || msg.toLowerCase().includes('rate limit') };
  }
  const data       = await res.json();
  const content    = data.choices?.[0]?.message?.content || '';
  const tokensUsed = data.usage?.total_tokens || Math.ceil(content.length / 4);
  return { content, tokensUsed };
}

// =============================================================
//  SEND IMAGE MESSAGE
// =============================================================
async function sendImageMessage() {
  if (isLoading) return;
  if (!AUTH.canSend()) {
    showToast('❌ Daily token limit reached!', '#ef4444');
    showLimitBlock(); return;
  }

  // ── Allow follow-up if no attachment but conversation exists ──
  if (!ImageBot.hasItems() && Memory.messages.length === 0) {
    showToast('📷 Please attach an image, ZIP, or folder first.', '#f59e0b'); return;
  }

  // ── Text-only follow-up (no new attachment, memory exists) ──
  if (!ImageBot.hasItems() && Memory.messages.length > 0) {
    const text = dom.userMsg.value.trim() || getDefaultImagePrompt(imgSubMode);
    dom.userMsg.value = ''; dom.userMsg.style.height = 'auto';
    document.getElementById('welcome')?.remove();
    renderUserImageMessage(text, []);
    isLoading = true; dom.sendBtn.disabled = true;
    try {
      showTyping('Vision — Follow-up');
      const msgs = [
        { role: 'system', content: ImageBot.systemPrompt(imgSubMode) },
        ...Memory.messages.map(m => ({ role: m.role, content: m.content })),
        { role: 'user',   content: text },
      ];
      const { content, tokensUsed } = await callGroqVision(msgs);
      if (!AUTH.isAdmin()) AUTH.addUsage(tokensUsed);
      hideTyping();
      renderAIMessage(content, 'image');
      Memory.addMessage('user',      `[Vision follow-up] ${text}`);
      Memory.addMessage('assistant', content);
      Memory.saveSession(); renderHistory(); AUTH.updateBadge();
    } catch (err) {
      hideTyping();
      renderErrorMessage(err.message || 'Vision API error. Please try again.');
    }
    isLoading = false; dom.sendBtn.disabled = false; dom.userMsg.focus();
    return;
  }

  // ── Normal flow — has attachment ──────────────────────────
  const text       = dom.userMsg.value.trim() || getDefaultImagePrompt(imgSubMode);
  const itemSnap   = [...ImageBot.items];
  const imageItems = itemSnap.filter(i => i.kind === 'image');
  const totalImgs  = imageItems.length;
  const batchSize  = IMAGE_CONFIG.BATCH_SIZE;
  const batches    = Math.max(1, Math.ceil(totalImgs / batchSize));

  dom.userMsg.value = ''; dom.userMsg.style.height = 'auto';
  document.getElementById('welcome')?.remove();
  renderUserImageMessage(text, itemSnap);

  isLoading = true; dom.sendBtn.disabled = true;

  const allResponses = [];
  let   totalTokens  = 0;

  try {
    // ── Folder/ZIP only (no actual images) ───────────────────
    if (totalImgs === 0) {
      showTyping('Vision — Folder/Text');
      const textItems = itemSnap.filter(i => i.kind === 'zip' || i.kind === 'folder');
      let textPart = text;
      if (textItems.length > 0) {
        textPart += '\n\n--- Attached Files ---';
        textItems.forEach(item => { textPart += `\n\n${item.text}`; });
      }
      const msgs = [
        { role: 'system', content: ImageBot.systemPrompt(imgSubMode) },
        ...Memory.messages.map(m => ({ role: m.role, content: m.content })),
        { role: 'user',   content: textPart },
      ];
      const { content, tokensUsed } = await callGroqVision(msgs);
      allResponses.push(content);
      totalTokens += tokensUsed;

    } else {
      // ── Image batch processing ────────────────────────────
      for (let b = 0; b < batches; b++) {
        const batchImgs = imageItems.slice(b * batchSize, (b + 1) * batchSize);
        const label     = batches > 1
          ? `Vision   Batch ${b + 1}/${batches} (${batchImgs.length} images)`
          : `Vision   ${totalImgs} image${totalImgs > 1 ? 's' : ''}`;

        updateTypingLabel(label);
        if (b === 0) showTyping(label);

        const msgs = ImageBot.buildBatchMessages(batchImgs, b, batches, text, imgSubMode);
        const { content, tokensUsed } = await callGroqVision(msgs);

        allResponses.push(
          batches > 1
            ? `### Batch ${b + 1} (images ${b * batchSize + 1} to ${b * batchSize + batchImgs.length})\n\n${content}`
            : content
        );
        totalTokens += tokensUsed;

        if (b < batches - 1) await new Promise(r => setTimeout(r, 400));
      }
    }

    if (!AUTH.isAdmin()) AUTH.addUsage(totalTokens);
    hideTyping();

    const finalReply = allResponses.join('\n\n---\n\n');
    renderAIMessage(finalReply, 'image');

    const summary = totalImgs > 0
      ? `${totalImgs} image${totalImgs > 1 ? 's' : ''}`
      : itemSnap.find(i => i.kind === 'folder')?.name ||
        itemSnap.find(i => i.kind === 'zip')?.name    || 'folder';

    Memory.addMessage('user',      `[Vision: ${summary}] ${text}`);
    Memory.addMessage('assistant', finalReply);
    Memory.saveSession(); renderHistory(); AUTH.updateBadge();

    // ── Keep folder/zip persistent — only clear individual images ──
    ImageBot.items = ImageBot.items.filter(i => i.kind === 'folder' || i.kind === 'zip');
    updateImgPanelUI();

  } catch (err) {
    hideTyping();
    renderErrorMessage(err.message || 'Vision API error. Please try again.');
  }

  isLoading = false; dom.sendBtn.disabled = false; dom.userMsg.focus();
}

function getDefaultImagePrompt(subMode) {
  return {
    analyze:  'Analyze this in detail.',
    ocr:      'Extract all visible text.',
    debug:    'Analyze this code screenshot. Find bugs and issues.',
    question: 'What do you see?',
  }[subMode] || 'Analyze this in detail.';
}

// =============================================================
//  RENDER — user message with all attached items
// =============================================================
function renderUserImageMessage(text, items) {
  const subLabels = { analyze:'Analyze', ocr:'Extract Text', debug:'Debug Code', question:'Question' };
  const row = document.createElement('div');
  row.className = 'msg-row';

  const itemsHtml = items.map(item => {
    if (item.kind === 'image') {
      return `<div class="user-img-thumb-wrap">
        <img class="user-img-thumb" src="${escHtml(item.dataUrl)}" alt="${escHtml(item.name)}"/>
        <span class="user-img-fname">${escHtml(item.name)}</span>
      </div>`;
    }
    const icon  = item.kind === 'zip' ? '📦' : '📁';
    const badge = item.kind === 'folder'
      ? `${item.fileCount} files${item.imageCount ? ` · ${item.imageCount} imgs` : ''}`
      : item.fileCount ? `${item.fileCount} files` : '';
    return `<div class="user-file-chip">${icon} <span>${escHtml(item.name)}${badge ? ` (${badge})` : ''}</span></div>`;
  }).join('');

  row.innerHTML = `
    <div class="msg-avatar user">YOU</div>
    <div class="msg-body">
      <div class="msg-meta">
        <span class="msg-who">You</span>
        <span class="msg-time">${now()}</span>
        <span class="msg-mode image">📷 ${escHtml(subLabels[imgSubMode] || 'Vision')}</span>
      </div>
      ${itemsHtml}
      ${text ? `<div class="msg-text"><p>${escHtml(text).replace(/\n/g,'<br>')}</p></div>` : ''}
    </div>`;
  dom.messages.appendChild(row);
  dom.messages.scrollTop = dom.messages.scrollHeight;
}

// =============================================================
//  IMAGE MODE UI
// =============================================================
function showImageMode() {
  const inputBar = document.querySelector('.input-bar');
  if (!inputBar || document.getElementById('imgAttachBtn')) return;

  function makeInput(id, accept, multiple, folder) {
    const inp = document.createElement('input');
    inp.type  = 'file'; inp.id = id; inp.style.display = 'none';
    if (accept)   inp.accept   = accept;
    if (multiple) inp.multiple = true;
    if (folder)   inp.setAttribute('webkitdirectory', '');
    document.body.appendChild(inp);
    return inp;
  }
  const imgInput    = makeInput('imgFileInput',   'image/*', true,  false);
  const zipInput    = makeInput('imgZipInput',    '.zip,.gz',false, false);
  const folderInput = makeInput('imgFolderInput', '',        true,  true);

  const btn = document.createElement('button');
  btn.id        = 'imgAttachBtn';
  btn.className = 'file-attach-btn img-attach-btn';
  btn.title     = 'Attach image, ZIP or folder';
  btn.innerHTML = `
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
      <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
    </svg>
    <svg class="attach-caret" width="9" height="9" viewBox="0 0 10 6" fill="currentColor"><path d="M0 0l5 6 5-6z"/></svg>`;

  const textarea = inputBar.querySelector('textarea');
  if (textarea) inputBar.insertBefore(btn, textarea);

  btn.addEventListener('click', e => {
    e.stopPropagation();
    showImgAttachMenu(btn);
  });

  imgInput.addEventListener('change', e => {
    if (e.target.files.length) ImageBot.attachImages(e.target.files);
    e.target.value = '';
  });
  zipInput.addEventListener('change', e => {
    const file = e.target.files[0];
    if (file) ImageBot.attachZip(file);
    e.target.value = '';
  });
  folderInput.addEventListener('change', e => {
    if (e.target.files.length) ImageBot.attachFolder(e.target.files);
    e.target.value = '';
  });

  const inputSection = document.querySelector('.input-section');
  if (inputSection) {
    inputSection.addEventListener('dragover', e => { e.preventDefault(); inputSection.classList.add('drag-over-files'); });
    inputSection.addEventListener('dragleave', () => inputSection.classList.remove('drag-over-files'));
    inputSection.addEventListener('drop', e => {
      e.preventDefault(); inputSection.classList.remove('drag-over-files');
      const files = Array.from(e.dataTransfer.files);
      const imgs  = files.filter(f => f.type.startsWith('image/'));
      const zips  = files.filter(f => /\.zip$/i.test(f.name));
      if (imgs.length) ImageBot.attachImages(imgs);
      if (zips.length) ImageBot.attachZip(zips[0]);
    });
  }

  document.addEventListener('paste', handleClipboardPaste);
}

// ── Image attach dropdown menu ──────────────────────────────
function showImgAttachMenu(anchorBtn) {
  document.getElementById('imgAttachMenuDrop')?.remove();
  const menu = document.createElement('div');
  menu.id        = 'imgAttachMenuDrop';
  menu.className = 'attach-menu-dropdown';
  menu.innerHTML = `
    <button class="attach-menu-item" id="iamImages">
      <span class="am-icon">🖼️</span>
      <span class="am-label">Images</span>
      <span class="am-sub">PNG · JPG · WEBP · GIF · max 400 MB</span>
    </button>
    <button class="attach-menu-item" id="iamZip">
      <span class="am-icon">📦</span>
      <span class="am-label">ZIP / Archive</span>
      <span class="am-sub">Extracts images + code files inside</span>
    </button>
    <button class="attach-menu-item" id="iamFolder">
      <span class="am-icon">📁</span>
      <span class="am-label">Folder</span>
      <span class="am-sub">Upload entire project folder</span>
    </button>`;
  document.body.appendChild(menu);

  const rect = anchorBtn.getBoundingClientRect();
  menu.style.left   = rect.left + 'px';
  menu.style.bottom = (window.innerHeight - rect.top + 6) + 'px';

  document.getElementById('iamImages').addEventListener('click', () => { menu.remove(); document.getElementById('imgFileInput').click(); });
  document.getElementById('iamZip').addEventListener('click',    () => { menu.remove(); document.getElementById('imgZipInput').click(); });
  document.getElementById('iamFolder').addEventListener('click', () => { menu.remove(); document.getElementById('imgFolderInput').click(); });

  setTimeout(() => {
    document.addEventListener('click', function close(e) {
      if (!menu.contains(e.target) && e.target !== anchorBtn) { menu.remove(); document.removeEventListener('click', close); }
    });
  }, 10);
}

function hideImageMode() {
  document.getElementById('imgAttachBtn')?.remove();
  document.getElementById('imgFileInput')?.remove();
  document.getElementById('imgZipInput')?.remove();
  document.getElementById('imgFolderInput')?.remove();
  document.getElementById('imgAttachMenuDrop')?.remove();
  document.getElementById('imgPreviewBar')?.remove();
  ImageBot.clear();
  document.removeEventListener('paste', handleClipboardPaste);
}

// =============================================================
//  UPDATE PREVIEW BAR
// =============================================================
function updateImgPanelUI() {
  let bar = document.getElementById('imgPreviewBar');

  if (ImageBot.items.length === 0) {
    if (bar) bar.remove();
    const btn = document.getElementById('imgAttachBtn');
    if (btn) btn.classList.remove('has-files');
    return;
  }

  if (!bar) {
    bar = document.createElement('div');
    bar.id        = 'imgPreviewBar';
    bar.className = 'attach-preview-bar';
    const inputBar = document.querySelector('.input-bar');
    if (inputBar) inputBar.parentNode.insertBefore(bar, inputBar);
  }

  bar.innerHTML = ImageBot.items.map((item, i) => {
    if (item.kind === 'image') {
      return `<div class="attach-chip" data-idx="${i}">
        <img src="${escHtml(item.dataUrl)}" class="attach-thumb-img" alt="${escHtml(item.name)}"/>
        <span class="attach-chip-name">${escHtml(item.name)}</span>
        <button class="attach-chip-remove" data-idx="${i}">✕</button>
      </div>`;
    }
    const icon  = item.kind === 'zip' ? '📦' : '📁';
    let badge = '';
    if (item.kind === 'folder') {
      badge = `<span class="attach-chip-badge">${item.fileCount} files${item.imageCount ? ` · ${item.imageCount} imgs` : ''}</span>`;
    } else if (item.fileCount) {
      badge = `<span class="attach-chip-badge">${item.fileCount} files</span>`;
    }
    return `<div class="attach-chip" data-idx="${i}">
      <span class="attach-thumb-icon">${icon}</span>
      <span class="attach-chip-name">${escHtml(item.name)}</span>
      ${badge}
      <button class="attach-chip-remove" data-idx="${i}">✕</button>
    </div>`;
  }).join('');

  bar.querySelectorAll('.attach-chip-remove').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      ImageBot.remove(parseInt(btn.dataset.idx, 10));
    });
  });

  const attachBtn = document.getElementById('imgAttachBtn');
  if (attachBtn) attachBtn.classList.toggle('has-files', ImageBot.items.length > 0);
}

function updateImageUI() { updateImgPanelUI(); }

// =============================================================
//  HELPERS
// =============================================================
async function handleImageFile(file) {
  try {
    await ImageBot.attachImage(file);
    updateImgPanelUI();
    showToast('✅ Image ready!', '#22c55e');
  } catch (err) {
    showToast('⚠️ ' + err, '#ef4444');
  }
}

function handleClipboardPaste(e) {
  if (typeof activeBot !== 'undefined' && activeBot !== 'image') return;
  const items = e.clipboardData?.items;
  if (!items) return;
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      const file = item.getAsFile();
      if (file) { handleImageFile(file); break; }
    }
  }
}

function updateImgSubModePlaceholder() {
  const p = {
    analyze:  'Ask something about the attachment, or leave blank for full analysis…',
    ocr:      'Leave blank to extract all text, or specify what to look for…',
    debug:    'Describe the bug or leave blank to auto-detect issues…',
    question: 'Ask any question about the image or files…',
  };
  if (dom.userMsg) dom.userMsg.placeholder = p[imgSubMode] || p.analyze;
}