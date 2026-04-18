// =============================================================
//  ShitalGenAI — Video / YouTube Transcription Module (videoapp.js)
//  Features:
//    • YouTube URL → audio extract → Whisper transcription via Groq
//    • Detects audio language automatically (or user can pick)
//    • Transcription shown in chat with timestamps
//    • Ask AI questions about the transcript after extraction
//  Requires: app.js (CONFIG, AUTH, Memory, showToast, escHtml, now)
// =============================================================

const VIDEO_CONFIG = {
  // Groq Whisper endpoint
  WHISPER_URL:   'https://api.groq.com/openai/v1/audio/transcriptions',
  WHISPER_MODEL: 'whisper-large-v3',        // best multilingual model on Groq

  // YouTube audio proxy — uses a CORS-friendly public API
  // We use the yt-dlp-web / cobalt.tools API which returns a direct audio URL
  COBALT_API:    'https://api.cobalt.tools/api/json',

  MAX_AUDIO_MB:  25,   // Groq Whisper limit
};

// Supported languages for the language picker
const WHISPER_LANGUAGES = [
  { code: 'auto',  label: '🌐 Auto Detect'   },
  { code: 'en',    label: '🇺🇸 English'        },
  { code: 'hi',    label: '🇮🇳 Hindi'          },
  { code: 'mr',    label: '🇮🇳 Marathi'        },
  { code: 'gu',    label: '🇮🇳 Gujarati'       },
  { code: 'ta',    label: '🇮🇳 Tamil'          },
  { code: 'te',    label: '🇮🇳 Telugu'         },
  { code: 'kn',    label: '🇮🇳 Kannada'        },
  { code: 'bn',    label: '🇧🇩 Bengali'        },
  { code: 'ur',    label: '🇵🇰 Urdu'           },
  { code: 'ar',    label: '🇸🇦 Arabic'         },
  { code: 'zh',    label: '🇨🇳 Chinese'        },
  { code: 'ja',    label: '🇯🇵 Japanese'       },
  { code: 'ko',    label: '🇰🇷 Korean'         },
  { code: 'fr',    label: '🇫🇷 French'         },
  { code: 'de',    label: '🇩🇪 German'         },
  { code: 'es',    label: '🇪🇸 Spanish'        },
  { code: 'pt',    label: '🇧🇷 Portuguese'     },
  { code: 'ru',    label: '🇷🇺 Russian'        },
  { code: 'tr',    label: '🇹🇷 Turkish'        },
  { code: 'it',    label: '🇮🇹 Italian'        },
  { code: 'nl',    label: '🇳🇱 Dutch'          },
  { code: 'pl',    label: '🇵🇱 Polish'         },
  { code: 'id',    label: '🇮🇩 Indonesian'     },
  { code: 'ms',    label: '🇲🇾 Malay'          },
  { code: 'th',    label: '🇹🇭 Thai'           },
  { code: 'vi',    label: '🇻🇳 Vietnamese'     },
  { code: 'uk',    label: '🇺🇦 Ukrainian'      },
  { code: 'fa',    label: '🇮🇷 Persian/Farsi'  },
  { code: 'sw',    label: '🇰🇪 Swahili'        },
];

// =============================================================
//  STATE
// =============================================================
let videoState = {
  youtubeUrl:       '',
  audioBlob:        null,
  audioFileName:    '',
  transcript:       '',
  detectedLanguage: '',
  videoTitle:       '',
  isExtracting:     false,
  isTranscribing:   false,
};

// =============================================================
//  UI INJECTION  — call once after DOM ready
// =============================================================
function initVideoModule() {
  _injectVideoTab();
  _injectVideoPanel();
  _bindVideoEvents();
}

function _injectVideoTab() {
  // Add "Video" subtab next to Image Vision subtabs
  const imageModes = document.getElementById('imageModes');
  if (!imageModes) return;
  if (document.getElementById('videoSubtab')) return; // already added

  const btn = document.createElement('button');
  btn.id            = 'videoSubtab';
  btn.className     = 'img-subtab';
  btn.dataset.sub   = 'video';
  btn.textContent   = '🎬 Video / YouTube';
  btn.style.cssText = 'white-space:nowrap;';
  imageModes.appendChild(btn);
}

function _injectVideoPanel() {
  const appScreen = document.getElementById('appScreen');
  if (!appScreen || document.getElementById('videoPanel')) return;

  const panel = document.createElement('div');
  panel.id          = 'videoPanel';
  panel.style.cssText = `
    display:none; flex-direction:column; gap:12px;
    padding:14px 16px; background:var(--bg2,#16162a);
    border-top:1px solid rgba(255,255,255,0.07);
    font-family:'Segoe UI',sans-serif;`;

  panel.innerHTML = `
    <!-- Header -->
    <div style="display:flex;align-items:center;justify-content:space-between;">
      <span style="font-size:13px;font-weight:600;color:var(--text1,#e2e8f0);">🎬 YouTube → Transcription</span>
      <button id="videoPanelClose" title="Close" style="background:none;border:none;color:var(--text2,#94a3b8);font-size:18px;cursor:pointer;line-height:1;">✕</button>
    </div>

    <!-- URL Input Row -->
    <div style="display:flex;gap:8px;">
      <input id="ytUrlInput" type="url" placeholder="Paste YouTube URL…  e.g. https://youtube.com/watch?v=…"
        style="flex:1;padding:9px 12px;border-radius:8px;border:1px solid rgba(255,255,255,0.12);
               background:rgba(255,255,255,0.05);color:var(--text1,#e2e8f0);font-size:13px;outline:none;"/>
      <button id="ytExtractBtn"
        style="padding:9px 16px;border-radius:8px;border:none;background:#6366f1;color:#fff;
               font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap;">
        Extract Audio
      </button>
    </div>

    <!-- OR: upload audio/video file directly -->
    <div style="display:flex;align-items:center;gap:10px;">
      <div style="flex:1;height:1px;background:rgba(255,255,255,0.08);"></div>
      <span style="font-size:11px;color:var(--text2,#94a3b8);">OR upload audio/video file</span>
      <div style="flex:1;height:1px;background:rgba(255,255,255,0.08);"></div>
    </div>
    <label id="audioFileLabel" style="display:flex;align-items:center;gap:10px;padding:10px 14px;
      border:1px dashed rgba(255,255,255,0.15);border-radius:8px;cursor:pointer;
      color:var(--text2,#94a3b8);font-size:13px;transition:border-color 0.2s;">
      <span style="font-size:18px;">📁</span>
      <span id="audioFileLabelText">Click to upload mp3 / mp4 / wav / m4a / webm (max 25 MB)</span>
      <input id="audioFileInput" type="file"
             accept="audio/*,video/mp4,video/webm,video/ogg,.mp3,.mp4,.wav,.m4a,.webm,.ogg,.flac"
             style="display:none;"/>
    </label>

    <!-- Language Picker -->
    <div style="display:flex;align-items:center;gap:10px;">
      <label style="font-size:12px;color:var(--text2,#94a3b8);white-space:nowrap;">Audio Language:</label>
      <select id="whisperLangSelect"
        style="flex:1;padding:7px 10px;border-radius:8px;border:1px solid rgba(255,255,255,0.12);
               background:rgba(255,255,255,0.05);color:var(--text1,#e2e8f0);font-size:13px;outline:none;">
      </select>
      <button id="ytTranscribeBtn" disabled
        style="padding:9px 16px;border-radius:8px;border:none;background:#22c55e;color:#fff;
               font-size:13px;font-weight:600;cursor:pointer;opacity:0.4;white-space:nowrap;">
        Transcribe ✨
      </button>
    </div>

    <!-- Progress / Status -->
    <div id="videoStatus" style="display:none;font-size:12px;color:#f59e0b;
      padding:8px 12px;background:rgba(245,158,11,0.08);border-radius:6px;border-left:3px solid #f59e0b;">
    </div>

    <!-- Preview bar (shows after audio ready) -->
    <div id="audioPreviewBar" style="display:none;align-items:center;gap:10px;">
      <span style="font-size:18px;">🎵</span>
      <div style="flex:1;">
        <div id="audioPreviewTitle" style="font-size:12px;font-weight:600;color:var(--text1,#e2e8f0);margin-bottom:3px;"></div>
        <audio id="audioPreviewPlayer" controls style="width:100%;height:32px;"></audio>
      </div>
    </div>`;

  // Insert before the message input area
  const inputArea = document.querySelector('.input-area, #inputArea, .chat-input-wrap');
  if (inputArea) {
    inputArea.parentNode.insertBefore(panel, inputArea);
  } else {
    appScreen.appendChild(panel);
  }

  // Populate language dropdown
  const sel = document.getElementById('whisperLangSelect');
  if (sel) {
    WHISPER_LANGUAGES.forEach(l => {
      const opt = document.createElement('option');
      opt.value = l.code; opt.textContent = l.label;
      sel.appendChild(opt);
    });
  }
}

// =============================================================
//  EVENT BINDING
// =============================================================
function _bindVideoEvents() {
  // Subtab click — show/hide video panel
  document.getElementById('videoSubtab')?.addEventListener('click', () => {
    _activateVideoSubtab();
  });

  document.getElementById('videoPanelClose')?.addEventListener('click', () => {
    _deactivateVideoSubtab();
  });

  // YouTube extract button
  document.getElementById('ytExtractBtn')?.addEventListener('click', _handleYouTubeExtract);

  // URL input — enter key
  document.getElementById('ytUrlInput')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') _handleYouTubeExtract();
  });

  // File upload
  document.getElementById('audioFileInput')?.addEventListener('change', _handleAudioFileUpload);

  // Transcribe button
  document.getElementById('ytTranscribeBtn')?.addEventListener('click', _handleTranscribe);
}

function _activateVideoSubtab() {
  // Deactivate other image subtabs
  document.querySelectorAll('.img-subtab').forEach(b => b.classList.remove('active'));
  document.getElementById('videoSubtab')?.classList.add('active');
  document.getElementById('videoPanel').style.display = 'flex';

  // Update placeholder
  const msg = document.getElementById('userMsg');
  if (msg) msg.placeholder = 'Ask a question about the transcript after extracting…';

  videoState.isVideoMode = true;
}

function _deactivateVideoSubtab() {
  document.getElementById('videoPanel').style.display = 'none';
  document.getElementById('videoSubtab')?.classList.remove('active');
  videoState.isVideoMode = false;
  const msg = document.getElementById('userMsg');
  if (msg) msg.placeholder = 'Ask something about the image, or leave blank for auto-analysis…';
}

// =============================================================
//  YOUTUBE AUDIO EXTRACTION  via cobalt.tools API
// =============================================================
async function _handleYouTubeExtract() {
  const urlInput = document.getElementById('ytUrlInput');
  const url      = urlInput?.value.trim();

  if (!url || !_isValidYouTubeUrl(url)) {
    _setVideoStatus('⚠️ Please enter a valid YouTube URL.', 'warn');
    return;
  }

  if (videoState.isExtracting) return;
  videoState.isExtracting = true;
  videoState.youtubeUrl   = url;

  const btn = document.getElementById('ytExtractBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Extracting…'; }
  _setVideoStatus('🔄 Fetching audio stream from YouTube…', 'info');
  _hideAudioPreview();

  try {
    // Step 1: call cobalt.tools to get a direct audio URL
    const cobaltRes = await fetch(VIDEO_CONFIG.COBALT_API, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Accept':        'application/json',
      },
      body: JSON.stringify({
        url:          url,
        vCodec:       'h264',
        aFormat:      'mp3',
        isAudioOnly:  true,
        disableMetadata: false,
      }),
    });

    if (!cobaltRes.ok) throw new Error(`Cobalt API error: ${cobaltRes.status}`);
    const cobaltData = await cobaltRes.json();

    // cobalt returns { status: 'stream'|'redirect'|'error', url, audio, ... }
    if (cobaltData.status === 'error') {
      throw new Error(cobaltData.text || 'Could not extract audio from this video.');
    }

    const audioUrl = cobaltData.url || cobaltData.audio;
    if (!audioUrl) throw new Error('No audio URL returned. Try a different video.');

    // Step 2: download the audio blob
    _setVideoStatus('⬇️ Downloading audio…', 'info');
    const audioRes = await fetch(audioUrl);
    if (!audioRes.ok) throw new Error('Failed to download audio stream.');

    const blob = await audioRes.blob();
    const sizeMB = blob.size / (1024 * 1024);
    if (sizeMB > VIDEO_CONFIG.MAX_AUDIO_MB) {
      throw new Error(`Audio is ${sizeMB.toFixed(1)} MB — exceeds Whisper's 25 MB limit. Try a shorter video.`);
    }

    videoState.audioBlob     = blob;
    videoState.audioFileName = `youtube_audio_${Date.now()}.mp3`;
    videoState.videoTitle    = cobaltData.filename || _extractVideoId(url) || 'YouTube Video';

    _setVideoStatus(`✅ Audio ready — ${sizeMB.toFixed(1)} MB. Choose language and click Transcribe.`, 'success');
    _showAudioPreview(blob, videoState.videoTitle);
    _enableTranscribeBtn();

  } catch (err) {
    _setVideoStatus(`❌ ${err.message}`, 'error');
    // Fallback: if cobalt fails, guide user to upload audio manually
    _setVideoStatus(
      `❌ ${err.message} — You can also download the audio manually and upload it using the file picker above.`,
      'error'
    );
  } finally {
    videoState.isExtracting = false;
    if (btn) { btn.disabled = false; btn.textContent = 'Extract Audio'; }
  }
}

function _isValidYouTubeUrl(url) {
  return /^https?:\/\/(www\.)?(youtube\.com\/(watch\?v=|shorts\/)|youtu\.be\/)/.test(url);
}

function _extractVideoId(url) {
  const m = url.match(/(?:v=|youtu\.be\/)([^&?/]+)/);
  return m ? m[1] : '';
}

// =============================================================
//  AUDIO FILE UPLOAD (local mp3/mp4/wav etc.)
// =============================================================
async function _handleAudioFileUpload(e) {
  const file = e.target.files?.[0];
  if (!file) return;

  const sizeMB = file.size / (1024 * 1024);
  if (sizeMB > VIDEO_CONFIG.MAX_AUDIO_MB) {
    _setVideoStatus(`❌ File is ${sizeMB.toFixed(1)} MB — exceeds Whisper's 25 MB limit.`, 'error');
    return;
  }

  videoState.audioBlob     = file;
  videoState.audioFileName = file.name;
  videoState.videoTitle    = file.name;

  const label = document.getElementById('audioFileLabelText');
  if (label) label.textContent = `✅ ${file.name} (${sizeMB.toFixed(1)} MB)`;

  _setVideoStatus(`✅ File loaded — ${sizeMB.toFixed(1)} MB. Choose language and click Transcribe.`, 'success');
  _showAudioPreview(file, file.name);
  _enableTranscribeBtn();
}

// =============================================================
//  TRANSCRIPTION  via Groq Whisper
// =============================================================
async function _handleTranscribe() {
  if (!videoState.audioBlob) {
    _setVideoStatus('⚠️ No audio loaded yet.', 'warn'); return;
  }
  if (videoState.isTranscribing) return;
  videoState.isTranscribing = true;

  const langSelect = document.getElementById('whisperLangSelect');
  const language   = langSelect?.value || 'auto';
  const btn        = document.getElementById('ytTranscribeBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Transcribing…'; }

  _setVideoStatus('🎙️ Sending audio to Whisper… this may take 10–60 seconds for long videos.', 'info');

  try {
    const formData = new FormData();
    formData.append('file',  videoState.audioBlob, videoState.audioFileName);
    formData.append('model', VIDEO_CONFIG.WHISPER_MODEL);
    if (language !== 'auto') formData.append('language', language);
    formData.append('response_format', 'verbose_json');  // gives us segments + detected language
    formData.append('timestamp_granularities[]', 'segment');

    const res = await fetch(VIDEO_CONFIG.WHISPER_URL, {
      method:  'POST',
      headers: { 'Authorization': `Bearer ${CONFIG.GROQ_API_KEY}` },
      body:    formData,
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.error?.message || `Whisper API error ${res.status}`);
    }

    const data = await res.json();
    const transcript       = data.text || '';
    const detectedLang     = data.language || language;
    const segments         = data.segments || [];
    const durationSec      = data.duration || 0;

    videoState.transcript       = transcript;
    videoState.detectedLanguage = detectedLang;

    _setVideoStatus(`✅ Transcription complete! Language: ${_langLabel(detectedLang)} | Duration: ${_formatTime(durationSec)}`, 'success');

    // Render full transcript in chat
    _renderTranscriptMessage(transcript, segments, detectedLang, durationSec);

    // Store transcript in Memory so user can ask AI questions about it
    Memory.addMessage('user', `[YouTube/Audio Transcription Request]\nFile: ${videoState.videoTitle}\nLanguage: ${detectedLang}`);
    Memory.addMessage('assistant', `## Transcription: ${videoState.videoTitle}\n\n**Detected Language:** ${_langLabel(detectedLang)}\n**Duration:** ${_formatTime(durationSec)}\n\n---\n\n${transcript}`);
    Memory.saveSession();

    if (!AUTH.isAdmin()) AUTH.addUsage(Math.ceil(transcript.length / 4));
    AUTH.updateBadge();

  } catch (err) {
    _setVideoStatus(`❌ ${err.message}`, 'error');
    if (typeof showToast === 'function') showToast(`Transcription failed: ${err.message}`, '#ef4444');
  } finally {
    videoState.isTranscribing = false;
    if (btn) { btn.disabled = false; btn.textContent = 'Transcribe ✨'; }
    _enableTranscribeBtn();
  }
}

// =============================================================
//  RENDER TRANSCRIPT IN CHAT
// =============================================================
function _renderTranscriptMessage(transcript, segments, detectedLang, durationSec) {
  const messages = document.getElementById('messages');
  if (!messages) return;

  // Build timestamped segments HTML if available
  let segHtml = '';
  if (segments.length > 0) {
    segHtml = `
      <div style="margin-top:14px;">
        <div style="font-size:12px;font-weight:600;color:var(--text2,#94a3b8);margin-bottom:8px;text-transform:uppercase;letter-spacing:.05em;">
          Timestamped Segments
        </div>
        <div style="max-height:260px;overflow-y:auto;display:flex;flex-direction:column;gap:4px;">
          ${segments.map(seg => `
            <div style="display:flex;gap:10px;font-size:12px;padding:5px 0;border-bottom:1px solid rgba(255,255,255,0.05);">
              <span style="color:#6366f1;font-weight:600;white-space:nowrap;min-width:90px;">
                ${_formatTime(seg.start)} → ${_formatTime(seg.end)}
              </span>
              <span style="color:var(--text1,#e2e8f0);">${escHtml(seg.text.trim())}</span>
            </div>`).join('')}
        </div>
      </div>`;
  }

  const row = document.createElement('div');
  row.className = 'msg-row';
  row.innerHTML = `
    <div class="msg-avatar ai">
      <img src="logo.png" alt="AI" style="width:100%;height:100%;object-fit:cover;border-radius:50%;"
           onerror="this.parentElement.textContent='AI'"/>
    </div>
    <div class="msg-body" style="width:100%;">
      <div class="msg-meta">
        <span class="msg-who">ShitalGenAI</span>
        <span class="msg-time">${now()}</span>
        <span class="msg-mode" style="background:rgba(139,92,246,0.15);color:#a78bfa;border-radius:4px;padding:2px 8px;font-size:11px;">🎬 Transcript</span>
        <span class="msg-model-badge">${escHtml(VIDEO_CONFIG.WHISPER_MODEL)}</span>
      </div>
      <div class="msg-text">
        <!-- Info bar -->
        <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px;">
          <span style="background:rgba(99,102,241,0.12);color:#818cf8;padding:4px 10px;border-radius:20px;font-size:12px;">
            📄 ${escHtml(videoState.videoTitle)}
          </span>
          <span style="background:rgba(34,197,94,0.12);color:#4ade80;padding:4px 10px;border-radius:20px;font-size:12px;">
            🌐 ${escHtml(_langLabel(detectedLang))}
          </span>
          <span style="background:rgba(245,158,11,0.12);color:#fbbf24;padding:4px 10px;border-radius:20px;font-size:12px;">
            ⏱ ${_formatTime(durationSec)}
          </span>
          <span style="background:rgba(255,255,255,0.05);color:var(--text2,#94a3b8);padding:4px 10px;border-radius:20px;font-size:12px;">
            📝 ${transcript.split(' ').length.toLocaleString()} words
          </span>
        </div>

        <!-- Full transcript box -->
        <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);
                    border-radius:8px;padding:14px;max-height:200px;overflow-y:auto;
                    font-size:13px;line-height:1.7;color:var(--text1,#e2e8f0);">
          ${escHtml(transcript)}
        </div>

        ${segHtml}

        <!-- Action buttons -->
        <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:12px;">
          <button class="transcript-action-btn" data-action="summarize"
            style="padding:7px 14px;border-radius:7px;border:1px solid rgba(99,102,241,0.4);
                   background:rgba(99,102,241,0.1);color:#818cf8;font-size:12px;cursor:pointer;">
            📋 Summarize
          </button>
          <button class="transcript-action-btn" data-action="keypoints"
            style="padding:7px 14px;border-radius:7px;border:1px solid rgba(34,197,94,0.4);
                   background:rgba(34,197,94,0.1);color:#4ade80;font-size:12px;cursor:pointer;">
            🔑 Key Points
          </button>
          <button class="transcript-action-btn" data-action="translate"
            style="padding:7px 14px;border-radius:7px;border:1px solid rgba(245,158,11,0.4);
                   background:rgba(245,158,11,0.1);color:#fbbf24;font-size:12px;cursor:pointer;">
            🌍 Translate to English
          </button>
          <button class="transcript-action-btn" data-action="copy"
            style="padding:7px 14px;border-radius:7px;border:1px solid rgba(255,255,255,0.15);
                   background:rgba(255,255,255,0.05);color:var(--text2,#94a3b8);font-size:12px;cursor:pointer;">
            📋 Copy Text
          </button>
          <button class="transcript-action-btn" data-action="download"
            style="padding:7px 14px;border-radius:7px;border:1px solid rgba(255,255,255,0.15);
                   background:rgba(255,255,255,0.05);color:var(--text2,#94a3b8);font-size:12px;cursor:pointer;">
            ⬇️ Download .txt
          </button>
        </div>
      </div>
    </div>`;

  // Wire action buttons
  row.querySelectorAll('.transcript-action-btn').forEach(btn => {
    btn.addEventListener('click', () => _handleTranscriptAction(btn.dataset.action, transcript, detectedLang));
  });

  messages.appendChild(row);
  messages.scrollTop = messages.scrollHeight;
}

// =============================================================
//  TRANSCRIPT ACTIONS
// =============================================================
function _handleTranscriptAction(action, transcript, lang) {
  const userMsg = document.getElementById('userMsg');

  if (action === 'copy') {
    navigator.clipboard.writeText(transcript).then(() => {
      if (typeof showToast === 'function') showToast('✅ Transcript copied!', '#22c55e');
    });
    return;
  }

  if (action === 'download') {
    const blob = new Blob([transcript], { type: 'text/plain' });
    const a    = document.createElement('a');
    a.href     = URL.createObjectURL(blob);
    a.download = `transcript_${videoState.videoTitle.replace(/[^a-z0-9]/gi,'_')}_${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(a.href);
    return;
  }

  // For AI actions — put a prompt in the input and fire sendMessage
  const prompts = {
    summarize:  `Please summarize the following transcript in clear bullet points:\n\n${transcript}`,
    keypoints:  `Extract the top 5–10 key points and insights from this transcript:\n\n${transcript}`,
    translate:  `Translate the following transcript from ${_langLabel(lang)} to English:\n\n${transcript}`,
  };

  const prompt = prompts[action];
  if (!prompt) return;

  if (userMsg) {
    userMsg.value = prompt;
    userMsg.style.height = 'auto';
    userMsg.style.height = Math.min(userMsg.scrollHeight, 180) + 'px';
    userMsg.focus();
  }

  // Auto-send
  if (typeof sendMessage === 'function') sendMessage();
}

// =============================================================
//  UI HELPERS
// =============================================================
function _setVideoStatus(msg, type = 'info') {
  const el = document.getElementById('videoStatus');
  if (!el) return;
  const styles = {
    info:    { color: '#f59e0b', bg: 'rgba(245,158,11,0.08)',  border: '#f59e0b' },
    success: { color: '#22c55e', bg: 'rgba(34,197,94,0.08)',   border: '#22c55e' },
    warn:    { color: '#f59e0b', bg: 'rgba(245,158,11,0.08)',  border: '#f59e0b' },
    error:   { color: '#ef4444', bg: 'rgba(239,68,68,0.08)',   border: '#ef4444' },
  };
  const s = styles[type] || styles.info;
  el.style.display    = 'block';
  el.style.color      = s.color;
  el.style.background = s.bg;
  el.style.borderLeft = `3px solid ${s.border}`;
  el.textContent      = msg;
}

function _showAudioPreview(blob, title) {
  const bar    = document.getElementById('audioPreviewBar');
  const player = document.getElementById('audioPreviewPlayer');
  const label  = document.getElementById('audioPreviewTitle');
  if (!bar || !player) return;
  const url        = URL.createObjectURL(blob);
  player.src       = url;
  if (label) label.textContent = `🎵 ${title}`;
  bar.style.display = 'flex';
}

function _hideAudioPreview() {
  const bar = document.getElementById('audioPreviewBar');
  if (bar) bar.style.display = 'none';
  const player = document.getElementById('audioPreviewPlayer');
  if (player) player.src = '';
}

function _enableTranscribeBtn() {
  const btn = document.getElementById('ytTranscribeBtn');
  if (btn) { btn.disabled = false; btn.style.opacity = '1'; }
}

function _formatTime(seconds) {
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
  return `${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
}

function _langLabel(code) {
  return WHISPER_LANGUAGES.find(l => l.code === code)?.label || code;
}

// =============================================================
//  HOOK INTO IMAGE BOT SWITCHER
//  Call this from switchBot() in app.js when bot === 'image'
// =============================================================
function showVideoMode() {
  // Called by switchBot when image mode is activated
  // The video tab is already inside imageModes, so just ensure panel syncs
  if (videoState.isVideoMode) {
    document.getElementById('videoPanel').style.display = 'flex';
  }
}

function hideVideoMode() {
  _deactivateVideoSubtab();
}

// =============================================================
//  AUTO INIT on DOMContentLoaded
// =============================================================
document.addEventListener('DOMContentLoaded', () => {
  // initVideoModule() is called from initApp() in app.js (see instructions below)
  // Or you can call it here directly:
  if (typeof AUTH !== 'undefined' && AUTH.isLoggedIn()) {
    setTimeout(initVideoModule, 300);
  }
});