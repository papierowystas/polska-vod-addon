'use strict';
// Lokalny serwer do testów: node server.js -> http://127.0.0.1:7010/manifest.json
const http = require('http');
const { handler } = require('./lib/addon');

const PORT = Number(process.env.PORT) || 7010;
http.createServer((req, res) => handler(req, res)).listen(PORT, () => {
  console.log(`Polska VOD + Gemini AI: http://127.0.0.1:${PORT}/manifest.json`);
});
