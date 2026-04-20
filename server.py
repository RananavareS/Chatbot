#!/usr/bin/env python3
# CodeBot Proxy Server — Groq API (Free)
# Run: python server.py
# Then open: http://localhost:8080

from http.server import HTTPServer, BaseHTTPRequestHandler
import urllib.request
import json
import os

GROQ_API_KEY = os.environ.get("GROQ_API_KEY")
PORT = 8080

# Map any old/decommissioned model names to current ones
MODEL_MAP = {
    'deepseek-r1-distill-llama-70b': 'llama-3.3-70b-versatile',
    'llama3-8b-8192':                'llama-3.1-8b-instant',
    'llama3-70b-8192':               'llama-3.3-70b-versatile',
    'mixtral-8x7b-32768':            'llama-3.3-70b-versatile',
    'gemma2-9b-it':                  'llama-3.1-8b-instant',
}

class ProxyHandler(BaseHTTPRequestHandler):

    def log_message(self, format, *args):
        print(f"[{self.address_string()}] {format % args}")

    def send_cors_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_cors_headers()
        self.end_headers()

    def do_GET(self):
        path = self.path.split('?')[0]
        if path == '/':
            path = '/index.html'

        # Build file path
        base_dir = os.path.dirname(os.path.abspath(__file__))
        file_path = os.path.join(base_dir, path.lstrip('/'))

        # Security check — prevent directory traversal
        if not os.path.abspath(file_path).startswith(base_dir):
            self.send_response(403)
            self.end_headers()
            self.wfile.write(b'Forbidden')
            return

        content_types = {
            '.html': 'text/html',
            '.css':  'text/css',
            '.js':   'application/javascript',
            '.ico':  'image/x-icon',
            '.png':  'image/png',
            '.jpg':  'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.gif':  'image/gif',
            '.svg':  'image/svg+xml',
            '.json': 'application/json',
            '.txt':  'text/plain',
            '.mp4':  'video/mp4',
            '.webm': 'video/webm',
            '.mp3':  'audio/mpeg',
            '.wav':  'audio/wav',
            '.pdf':  'application/pdf',
            '.woff': 'font/woff',
            '.woff2':'font/woff2',
        }

        ext = os.path.splitext(file_path)[1].lower()
        content_type = content_types.get(ext, 'text/plain')

        try:
            with open(file_path, 'rb') as f:
                content = f.read()
            self.send_response(200)
            self.send_header('Content-Type', content_type)
            self.send_header('Content-Length', str(len(content)))
            self.send_cors_headers()
            self.end_headers()
            self.wfile.write(content)
        except FileNotFoundError:
            self.send_response(404)
            self.send_header('Content-Type', 'text/plain')
            self.end_headers()
            self.wfile.write(f'File not found: {path}'.encode())
        except Exception as e:
            self.send_response(500)
            self.end_headers()
            self.wfile.write(f'Server error: {str(e)}'.encode())

    def do_POST(self):
        if self.path == '/api/chat':
            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length)

            try:
                incoming = json.loads(body)

                # Resolve model — fallback to versatile if unknown
                requested_model = incoming.get('model', 'llama-3.3-70b-versatile')
                model = MODEL_MAP.get(requested_model, requested_model)

                groq_payload = {
                    'model': model,
                    'max_tokens': incoming.get('max_tokens', 4096),
                    'messages': [],
                    'temperature': 0.6,
                    'stream': False,
                }

                if incoming.get('system'):
                    groq_payload['messages'].append({
                        'role': 'system',
                        'content': incoming['system']
                    })

                groq_payload['messages'].extend(incoming.get('messages', []))

                payload_bytes = json.dumps(groq_payload).encode('utf-8')

                req = urllib.request.Request(
                    'https://api.groq.com/openai/v1/chat/completions',
                    data=payload_bytes,
                    headers={
                        'Content-Type':  'application/json',
                        'Authorization': f'Bearer {GROQ_API_KEY}',
                        'User-Agent':    'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
                        'Accept':        'application/json',
                    },
                    method='POST'
                )

                with urllib.request.urlopen(req) as response:
                    groq_result = json.loads(response.read())

                reply_text = groq_result['choices'][0]['message']['content']
                anthropic_style = {
                    'content': [{'type': 'text', 'text': reply_text}]
                }

                result_bytes = json.dumps(anthropic_style).encode('utf-8')
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_cors_headers()
                self.end_headers()
                self.wfile.write(result_bytes)

            except urllib.error.HTTPError as e:
                error_body = e.read()
                print(f"Groq API error {e.code}: {error_body}")
                self.send_response(e.code)
                self.send_header('Content-Type', 'application/json')
                self.send_cors_headers()
                self.end_headers()
                try:
                    err_json = json.loads(error_body)
                    msg = err_json.get('error', {}).get('message', str(e))
                except Exception:
                    msg = str(e)
                self.wfile.write(json.dumps(
                    {'error': {'message': msg}}
                ).encode())

            except Exception as e:
                print(f"Server error: {e}")
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self.send_cors_headers()
                self.end_headers()
                self.wfile.write(json.dumps(
                    {'error': {'message': str(e)}}
                ).encode())

        else:
            self.send_response(404)
            self.send_header('Content-Type', 'text/plain')
            self.end_headers()
            self.wfile.write(b'Endpoint not found')


if __name__ == '__main__':
    PORT = int(os.environ.get('PORT', PORT))
    print(f"""
  ╔══════════════════════════════════════════╗
  ║   CodeBot — Groq Edition (Free)          ║
  ║   Models: Llama 3.3 70B / Qwen3 32B /   ║
  ║           Llama 3.1 8B / GPT-OSS 120B   ║
  ╠══════════════════════════════════════════╣
  ║   http://localhost:{PORT}                   ║
  ╚══════════════════════════════════════════╝
    """)
    server = HTTPServer(('0.0.0.0', PORT), ProxyHandler)
    server.serve_forever()