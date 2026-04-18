// =============================================================
//  ShitalGenAI — File Attachment Handler  (fileattach.js)
//  Supports: Images · PDF · Excel/CSV · ZIP · Folder
//  Depends on: CONFIG, AUTH, dom, escHtml, showToast, isLoading
// =============================================================

const FileAttach = {
  attachments: [],
  MAX_FILES:   10,
  MAX_SIZE_MB: 400,

  ACCEPTED: {
    image: ['image/jpeg','image/png','image/webp','image/gif','image/bmp','image/svg+xml'],
    pdf:   ['application/pdf'],
    excel: [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel', 'text/csv', 'application/csv',
    ],
    zip: [
      'application/zip','application/x-zip-compressed',
      'application/x-zip','application/octet-stream',
    ],
  },

  getFileType(file) {
    if (this.ACCEPTED.image.includes(file.type))  return 'image';
    if (this.ACCEPTED.pdf.includes(file.type))    return 'pdf';
    if (this.ACCEPTED.excel.includes(file.type) ||
        /\.(xlsx|xls|csv)$/i.test(file.name))     return 'excel';
    if (this.ACCEPTED.zip.includes(file.type) ||
        /\.(zip|gz|tar\.gz)$/i.test(file.name))   return 'zip';
    if (/\.(js|ts|py|java|c|cpp|cs|go|rs|php|rb|swift|kt|html|css|json|xml|yaml|yml|md|txt|sh|sql)$/i.test(file.name))
      return 'code';
    return null;
  },

  readAsDataURL(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload  = e => resolve(e.target.result);
      r.onerror = () => reject('Failed to read: ' + file.name);
      r.readAsDataURL(file);
    });
  },

  readAsText(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload  = e => resolve(e.target.result);
      r.onerror = () => reject('Failed to read: ' + file.name);
      r.readAsText(file);
    });
  },

  readAsArrayBuffer(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload  = e => resolve(e.target.result);
      r.onerror = () => reject('Failed to read: ' + file.name);
      r.readAsArrayBuffer(file);
    });
  },

  async processFile(file, folderPrefix) {
    if (this.attachments.length >= this.MAX_FILES) {
      showToast(`⚠️ Max ${this.MAX_FILES} attachments at once.`, '#f59e0b');
      return false;
    }
    if (file.size > this.MAX_SIZE_MB * 1024 * 1024) {
      showToast(`⚠️ ${file.name} too large (max ${this.MAX_SIZE_MB} MB).`, '#f59e0b');
      return false;
    }
    const type = this.getFileType(file);
    if (!type) {
      showToast(`⚠️ Unsupported type: ${file.name}`, '#f59e0b');
      return false;
    }

    const displayName = folderPrefix ? `${folderPrefix}/${file.name}` : file.name;

    try {
      if (type === 'image') {
        const dataUrl = await this.readAsDataURL(file);
        this.attachments.push({ type: 'image', name: displayName, dataUrl, mimeType: file.type });
      } else if (type === 'pdf') {
        const dataUrl = await this.readAsDataURL(file);
        this.attachments.push({ type: 'pdf', name: displayName, dataUrl, mimeType: file.type });
      } else if (type === 'excel') {
        if (/\.(csv)$/i.test(file.name) || file.type === 'text/csv') {
          const text = await this.readAsText(file);
          this.attachments.push({ type: 'excel', name: displayName, text: text.substring(0, 8000), mimeType: file.type });
        } else {
          const dataUrl = await this.readAsDataURL(file);
          this.attachments.push({ type: 'excel', name: displayName, dataUrl, mimeType: file.type });
        }
      } else if (type === 'code') {
        const text = await this.readAsText(file);
        this.attachments.push({ type: 'code', name: displayName, text: text.substring(0, 10000), mimeType: file.type || 'text/plain' });
      } else if (type === 'zip') {
        await this.processZip(file);
        return true;
      }
      return true;
    } catch (err) {
      showToast('⚠️ Could not read ' + file.name, '#ef4444');
      return false;
    }
  },

  async processZip(file) {
    if (typeof JSZip === 'undefined') {
      showToast('⚠️ JSZip not loaded. Cannot read ZIP.', '#ef4444');
      return;
    }
    showToast('📦 Reading ZIP…', '#6366f1');
    try {
      const buf = await this.readAsArrayBuffer(file);
      const zip = await JSZip.loadAsync(buf);

      const TEXT_EXT = /\.(js|ts|py|java|c|cpp|cs|go|rs|php|rb|swift|kt|html|css|json|xml|yaml|yml|md|txt|sh|sql|csv|env|toml|ini|cfg)$/i;
      const entries = [];
      zip.forEach((relPath, zipEntry) => {
        if (!zipEntry.dir && TEXT_EXT.test(relPath) && entries.length < 20)
          entries.push({ relPath, zipEntry });
      });

      if (entries.length === 0) {
        showToast('⚠️ No readable text/code files found in ZIP.', '#f59e0b');
        return;
      }

      let combinedText = `ZIP: ${file.name} (${entries.length} files)\n${'─'.repeat(50)}\n`;
      let totalChars   = 0;

      for (const { relPath, zipEntry } of entries) {
        if (totalChars > 25000) { combinedText += `\n[…truncated — too many files]\n`; break; }
        const content = await zipEntry.async('string');
        const snippet = content.substring(0, 3000);
        combinedText += `\n── ${relPath} ──\n${snippet}${content.length > 3000 ? '\n[…truncated]' : ''}\n`;
        totalChars   += snippet.length;
      }

      this.attachments.push({ type: 'zip', name: file.name, text: combinedText, fileCount: entries.length, mimeType: file.type });
      renderAttachmentPreviews();
      showToast(`📦 ZIP: ${entries.length} files extracted.`, '#00d4aa');
    } catch (err) {
      showToast('⚠️ Failed to read ZIP: ' + (err.message || err), '#ef4444');
    }
  },

  // ── Process a folder — attaches as ONE chip, counts all files ──
  async processFolder(fileList) {
    const files      = Array.from(fileList);
    const folderName = files[0]?.webkitRelativePath?.split('/')[0] || 'folder';
    const totalFiles = files.length;

    // Categorise
    const IMAGE_EXT = /\.(jpe?g|png|webp|gif|bmp|svg|tiff?)$/i;
    const TEXT_EXT  = /\.(js|ts|py|java|c|cpp|cs|go|rs|php|rb|swift|kt|html|css|json|xml|yaml|yml|md|txt|sh|sql|csv|env|toml|ini|cfg)$/i;

    const imageFiles   = files.filter(f => IMAGE_EXT.test(f.name));
    const textFiles    = files.filter(f => TEXT_EXT.test(f.name));
    const otherFiles   = files.filter(f => !IMAGE_EXT.test(f.name) && !TEXT_EXT.test(f.name));

    if (totalFiles === 0) {
      showToast('⚠️ Folder appears to be empty.', '#f59e0b');
      return;
    }

    showToast(`📁 Reading folder "${folderName}" (${totalFiles} files)…`, '#6366f1');

    // Build a summary text (no binary reading for images — just list them)
    let summaryText = `FOLDER: ${folderName}\n`;
    summaryText    += `Total: ${totalFiles} files`;
    if (imageFiles.length) summaryText += ` · ${imageFiles.length} images`;
    if (textFiles.length)  summaryText += ` · ${textFiles.length} code/text`;
    if (otherFiles.length) summaryText += ` · ${otherFiles.length} other`;
    summaryText += `\n${'─'.repeat(50)}\n`;

    // List image filenames
    if (imageFiles.length > 0) {
      summaryText += `\n📷 Images (${imageFiles.length}):\n`;
      imageFiles.slice(0, 100).forEach(f => {
        summaryText += `  ${f.webkitRelativePath || f.name}\n`;
      });
      if (imageFiles.length > 100) summaryText += `  …and ${imageFiles.length - 100} more\n`;
    }

    // Read and include code/text file contents (up to 25k chars total)
    if (textFiles.length > 0) {
      summaryText += `\n📝 Code/Text files:\n${'─'.repeat(30)}\n`;
      let totalChars = 0;
      for (const file of textFiles.slice(0, 30)) {
        if (totalChars > 25000) { summaryText += `\n[…truncated — too many files]\n`; break; }
        try {
          const text    = await this.readAsText(file);
          const rel     = file.webkitRelativePath || file.name;
          const snippet = text.substring(0, 3000);
          summaryText += `\n── ${rel} ──\n${snippet}${text.length > 3000 ? '\n[…truncated]' : ''}\n`;
          totalChars  += snippet.length;
        } catch (_) { /* skip unreadable */ }
      }
    }

    // Push ONE folder attachment
    this.attachments.push({
      type:       'folder',
      name:       folderName,
      text:       summaryText,
      fileCount:  totalFiles,
      imageCount: imageFiles.length,
      mimeType:   'text/plain',
    });

    renderAttachmentPreviews();
    showToast(`📁 Folder: ${totalFiles} files attached.`, '#00d4aa');
  },

  async addFiles(fileList) {
    let added = 0;
    for (const file of Array.from(fileList)) {
      const ok = await this.processFile(file);
      if (ok) added++;
    }
    if (added > 0) {
      renderAttachmentPreviews();
      showToast(`📎 ${added} file${added > 1 ? 's' : ''} attached.`, '#00d4aa');
    }
  },

  remove(index) {
    this.attachments.splice(index, 1);
    renderAttachmentPreviews();
  },

  clear() {
    this.attachments = [];
    renderAttachmentPreviews();
  },

  buildContentBlocks(userText) {
    const blocks = [];

    this.attachments.forEach(att => {
      if (att.type === 'image')
        blocks.push({ type: 'image_url', image_url: { url: att.dataUrl } });
    });

    let textPart  = userText || '';
    const nonImgs = this.attachments.filter(a => a.type !== 'image');

    if (nonImgs.length > 0) {
      textPart += '\n\n--- Attached Files ---';
      nonImgs.forEach(att => {
        if (att.type === 'pdf') {
          textPart += `\n\n[PDF: ${att.name}]\nPlease analyze this PDF document.`;
        } else if (att.type === 'excel' && att.text) {
          textPart += `\n\n[Spreadsheet: ${att.name}]\n\`\`\`csv\n${att.text}\n\`\`\``;
        } else if (att.type === 'excel' && att.dataUrl) {
          textPart += `\n\n[Excel: ${att.name}] — Excel file attached.`;
        } else if (att.type === 'code') {
          const ext = att.name.split('.').pop() || 'code';
          textPart += `\n\n[File: ${att.name}]\n\`\`\`${ext}\n${att.text}\n\`\`\``;
        } else if (att.type === 'zip') {
          textPart += `\n\n[ZIP: ${att.name} — ${att.fileCount} files]\n${att.text}`;
        } else if (att.type === 'folder') {
          textPart += `\n\n[Folder: ${att.name} — ${att.fileCount} files]\n${att.text}`;
        }
      });
    }

    if (textPart) blocks.push({ type: 'text', text: textPart });
    return blocks;
  },

  hasFiles()    { return this.attachments.length > 0; },
  hasImages()   { return this.attachments.some(a => a.type === 'image'); },
  hasNonImage() { return this.attachments.some(a => a.type !== 'image'); },
};

// =============================================================
//  ATTACHMENT PREVIEW CHIPS
// =============================================================
function renderAttachmentPreviews() {
  let wrap = document.getElementById('attachPreviewBar');

  if (FileAttach.attachments.length === 0) {
    if (wrap) wrap.remove();
    const btn = document.getElementById('fileAttachBtn');
    if (btn) btn.classList.remove('has-files');
    return;
  }

  if (!wrap) {
    wrap = document.createElement('div');
    wrap.id        = 'attachPreviewBar';
    wrap.className = 'attach-preview-bar';
    const inputBar = document.querySelector('.input-bar');
    if (inputBar) inputBar.parentNode.insertBefore(wrap, inputBar);
  }

  const ICONS = { image:'🖼️', pdf:'📄', excel:'📊', code:'📝', zip:'📦', folder:'📁' };

  wrap.innerHTML = FileAttach.attachments.map((att, i) => {
    const icon  = ICONS[att.type] || '📎';
    const thumb = att.type === 'image' && att.dataUrl
      ? `<img src="${escHtml(att.dataUrl)}" class="attach-thumb-img" alt="${escHtml(att.name)}"/>`
      : `<span class="attach-thumb-icon">${icon}</span>`;

    // For folders, show total file count + image count if any
    let badge = '';
    if (att.type === 'folder') {
      badge = `<span class="attach-chip-badge">${att.fileCount} files${att.imageCount ? ` · ${att.imageCount} imgs` : ''}</span>`;
    } else if (att.fileCount != null) {
      badge = `<span class="attach-chip-badge">${att.fileCount} files</span>`;
    }

    return `<div class="attach-chip" data-idx="${i}">
      ${thumb}
      <span class="attach-chip-name">${escHtml(att.name)}</span>
      ${badge}
      <button class="attach-chip-remove" data-idx="${i}" title="Remove">✕</button>
    </div>`;
  }).join('');

  wrap.querySelectorAll('.attach-chip-remove').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      FileAttach.remove(parseInt(btn.dataset.idx, 10));
    });
  });

  const btn = document.getElementById('fileAttachBtn');
  if (btn) btn.classList.add('has-files');
}

// =============================================================
//  USER MESSAGE RENDER WITH FILES
// =============================================================
function renderUserMessageWithFiles(text, codeSnippet, attachments) {
  const row = document.createElement('div');
  row.className = 'msg-row';
  const ICONS = { image:'🖼️', pdf:'📄', excel:'📊', code:'📝', zip:'📦', folder:'📁' };

  const attHtml = attachments.map(att => {
    if (att.type === 'image') {
      return `<div class="user-img-thumb-wrap">
        <img class="user-img-thumb" src="${escHtml(att.dataUrl)}" alt="${escHtml(att.name)}"/>
        <span class="user-img-fname">${escHtml(att.name)}</span>
      </div>`;
    }
    const icon  = ICONS[att.type] || '📎';
    let badge = '';
    if (att.type === 'folder') {
      badge = ` · ${att.fileCount} files${att.imageCount ? ` (${att.imageCount} imgs)` : ''}`;
    } else if (att.fileCount != null) {
      badge = ` · ${att.fileCount} files`;
    }
    return `<div class="user-file-chip">${icon} <span>${escHtml(att.name)}${badge}</span></div>`;
  }).join('');

  row.innerHTML = `
    <div class="msg-avatar user">YOU</div>
    <div class="msg-body">
      <div class="msg-meta"><span class="msg-who">You</span><span class="msg-time">${now()}</span></div>
      ${codeSnippet ? `<div class="attached-code"><div class="attached-label">Attached code</div><pre>${escHtml(codeSnippet.substring(0,300))}${codeSnippet.length>300?'\n...':''}</pre></div>` : ''}
      ${attHtml}
      ${text ? `<div class="msg-text"><p>${escHtml(text).replace(/\n/g,'<br>')}</p></div>` : ''}
    </div>`;
  return row;
}

// =============================================================
//  GROQ API CALL WITH FILES
// =============================================================
async function callGroqWithFiles(messages) {
  const res = await fetch(CONFIG.GROQ_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${CONFIG.GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model:       'meta-llama/llama-4-scout-17b-16e-instruct',
      max_tokens:  CONFIG.MAX_TOKENS,
      temperature: 0.6,
      stream:      false,
      messages,
    }),
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

// =============================================================
//  ATTACH MENU  (dropdown with 3 options)
// =============================================================
function showAttachMenu(anchorBtn) {
  document.getElementById('attachMenuDropdown')?.remove();

  const menu = document.createElement('div');
  menu.id        = 'attachMenuDropdown';
  menu.className = 'attach-menu-dropdown';
  menu.innerHTML = `
    <button class="attach-menu-item" id="amFiles">
      <span class="am-icon">📎</span>
      <span class="am-label">Files</span>
      <span class="am-sub">Images · PDF · Excel · Code · ZIP</span>
    </button>
    <button class="attach-menu-item" id="amZip">
      <span class="am-icon">📦</span>
      <span class="am-label">ZIP / Archive</span>
      <span class="am-sub">.zip file — extracts code files</span>
    </button>
    <button class="attach-menu-item" id="amFolder">
      <span class="am-icon">📁</span>
      <span class="am-label">Folder</span>
      <span class="am-sub">Upload entire project folder</span>
    </button>`;
  document.body.appendChild(menu);

  const rect = anchorBtn.getBoundingClientRect();
  menu.style.left   = rect.left + 'px';
  menu.style.bottom = (window.innerHeight - rect.top + 6) + 'px';

  document.getElementById('amFiles').addEventListener('click', () => {
    menu.remove();
    document.getElementById('fileAttachInput').click();
  });
  document.getElementById('amZip').addEventListener('click', () => {
    menu.remove();
    document.getElementById('zipAttachInput').click();
  });
  document.getElementById('amFolder').addEventListener('click', () => {
    menu.remove();
    document.getElementById('folderAttachInput').click();
  });

  setTimeout(() => {
    document.addEventListener('click', function close(e) {
      if (!menu.contains(e.target) && e.target !== anchorBtn) {
        menu.remove();
        document.removeEventListener('click', close);
      }
    });
  }, 10);
}

// =============================================================
//  INIT — inject button + hidden inputs
// =============================================================
function initFileAttach() {
  const inputBar = document.querySelector('.input-bar');
  if (!inputBar) return;

  function makeInput(id, accept, multiple, folder) {
    const inp      = document.createElement('input');
    inp.type       = 'file';
    inp.id         = id;
    inp.style.display = 'none';
    if (accept)   inp.accept   = accept;
    if (multiple) inp.multiple = true;
    if (folder)   inp.setAttribute('webkitdirectory', '');
    document.body.appendChild(inp);
    return inp;
  }

  const fileInput   = makeInput('fileAttachInput',   'image/*,.pdf,.xlsx,.xls,.csv,.js,.ts,.py,.java,.c,.cpp,.cs,.go,.rs,.php,.rb,.swift,.kt,.html,.css,.json,.xml,.yaml,.yml,.md,.txt,.sh,.sql', true,  false);
  const zipInput    = makeInput('zipAttachInput',    '.zip,.gz',  false, false);
  const folderInput = makeInput('folderAttachInput', '',          true,  true);

  const btn = document.createElement('button');
  btn.className = 'file-attach-btn';
  btn.id        = 'fileAttachBtn';
  btn.title     = 'Attach files, ZIP or folder';
  btn.innerHTML = `
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
      <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
    </svg>
    <svg class="attach-caret" width="9" height="9" viewBox="0 0 10 6" fill="currentColor">
      <path d="M0 0l5 6 5-6z"/>
    </svg>`;

  const textarea = inputBar.querySelector('textarea');
  if (textarea) inputBar.insertBefore(btn, textarea);

  btn.addEventListener('click', e => {
    e.stopPropagation();
    if (activeBot === 'image') return;
    showAttachMenu(btn);
  });

  fileInput.addEventListener('change', e => {
    if (e.target.files.length) FileAttach.addFiles(e.target.files);
    fileInput.value = '';
  });
  zipInput.addEventListener('change', e => {
    if (e.target.files.length) FileAttach.addFiles(e.target.files);
    zipInput.value = '';
  });
  folderInput.addEventListener('change', e => {
    if (e.target.files.length) FileAttach.processFolder(e.target.files);
    folderInput.value = '';
  });

  const inputSection = document.querySelector('.input-section');
  if (inputSection) {
    inputSection.addEventListener('dragover', e => {
      if (activeBot === 'image') return;
      e.preventDefault();
      inputSection.classList.add('drag-over-files');
    });
    inputSection.addEventListener('dragleave', () => inputSection.classList.remove('drag-over-files'));
    inputSection.addEventListener('drop', e => {
      e.preventDefault();
      inputSection.classList.remove('drag-over-files');
      if (activeBot === 'image') return;
      if (e.dataTransfer.files.length) FileAttach.addFiles(e.dataTransfer.files);
    });
  }
}