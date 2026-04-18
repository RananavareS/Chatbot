# CodeBot — Advanced AI Coding Assistant

A powerful ChatGPT-style coding assistant with **persistent memory** that remembers your code across messages.

---

## Key Features

- **Code Memory** — Remembers all code written in the session. Automatically references previous code when you ask follow-up questions.
- **6 Coding Modes** — Generate, Debug, Refactor, Explain, Optimize, Write Tests
- **19 Languages** — Python, JS, TS, Java, C++, C#, Go, Rust, PHP, Swift, Kotlin, Ruby, SQL, Bash, HTML/CSS, React, Vue, Dart/Flutter, and auto-detect
- **Code Attach** — Paste existing code to debug/refactor/explain
- **Session History** — Saves all conversations to localStorage with full memory
- **Export** — Download full session as Markdown
- **Production prompts** — System prompt is dynamically built with your code context injected

---

## Setup

### 1. Get API Key
- Go to https://console.anthropic.com
- API Keys → Create key (starts with `sk-ant-...`)

### 2. Add API Key
Open `app.js` line 8:
```javascript
API_KEY: 'YOUR_API_KEY_HERE',
```
Replace with your key:
```javascript
API_KEY: 'sk-ant-api03-xxxxxxx',
```

### 3. Run
Open `index.html` in your browser. No server needed.

Or use a local server:
```bash
npx serve .
# or
python -m http.server 8080
```

---

## File Structure

```
codebot/
├── index.html    # UI structure
├── style.css     # Dark IDE theme
├── app.js        # All logic + memory system
└── README.md
```

---

## How Memory Works

Every AI response is stored in full conversation history. When you send the next message, the **entire history is sent to the API**, so the AI always has full context of:
- What code was written before
- What bugs were fixed
- What architecture decisions were made

Additionally, code snippets are extracted and injected into the system prompt so the AI explicitly knows what code exists in the session.

**Memory limits** (configurable in `app.js`):
```javascript
MAX_MEMORY_MESSAGES: 40,   // Last 40 messages kept
MAX_CODE_SNIPPETS: 10,     // Last 10 code blocks remembered
MAX_TOKENS: 4096,          // Max response length
```

---

## Modes Explained

| Mode | What it does |
|---|---|
| Generate | Write new code from scratch |
| Debug | Find and fix bugs in your code |
| Refactor | Improve code quality and structure |
| Explain | Break down how code works |
| Optimize | Improve performance and complexity |
| Write Tests | Generate unit & integration tests |

---

## Security Note

Never expose your API key publicly. For production, proxy requests through your own backend.

---

## License
MIT