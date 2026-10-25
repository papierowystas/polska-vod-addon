'use strict';
// Lokalny serwer do testów: node server.js -> http://127.0.0.1:7010/manifest.json
const http = require('http');
const fs = require('fs');
const path = require('path');

// Ciche wczytanie GEMINI_API_KEY jeśli istnieje plik .env
try {
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
    for (const l of lines) {
      if (l.startsWith('GEMINI_API_KEY=')) {
        process.env.GEMINI_API_KEY = l.slice('GEMINI_API_KEY='.length).trim().replace(/^["']|["']$/g, '');
      }
    }
  }
} catch (_) {}

const { handler } = require('./lib/addon');

const PORT = Number(process.env.PORT) || 7000;
http.createServer((req, res) => handler(req, res)).listen(PORT, () => {
  console.log(`Polska VOD + Gemini AI: http://127.0.0.1:${PORT}/manifest.json`);
});
