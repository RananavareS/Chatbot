import urllib.request, json, urllib.error
import os

GROQ_API_KEY = os.environ.get("GROQ_API_KEY")

req = urllib.request.Request(
    'https://api.groq.com/openai/v1/chat/completions',
    data=json.dumps({
        'model': 'llama3-8b-8192',
        'messages': [{'role': 'user', 'content': 'hi'}],
        'max_tokens': 10
    }).encode(),
    headers={
        'Authorization': f'Bearer {GROQ_API_KEY}',
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
    },
    method='POST'
)

try:
    response = urllib.request.urlopen(req)
    print("SUCCESS:", response.read())
except urllib.error.HTTPError as e:
    print("Error code:", e.code)
    print("Error details:", e.read().decode())