'use strict';

/**
 * addon.js — cały dodatek Stremio jako jedna funkcja (req, res).
 * Działa identycznie lokalnie (server.js) i na Vercelu (api/index.js).
 * Tylko katalogi filmów i seriali — strumienie dostarcza Torrentio + TorBox.
 */

const { handleVodCatalog, buildVodManifestCatalogs, PLATFORMS } = require('./vod');
const { handleAiCatalog, buildAiManifestCatalogs } = require('./ai');

const BASE_MANIFEST = {
  id: 'pl.polska.vod.katalogi',
  version: '2.1.0',
  name: '🍿 Polska VOD + 🤖 Gemini AI',
  description: 'Katalogi polskich platform (Netflix, Max, CANAL+, Disney+, Prime, SkyShowtime, Apple TV+, Player, Polsat Box Go, TVP VOD, CDA) w układzie jak na Netflixie: Top 10, premiery, gatunki. Oraz rekomendacje Gemini AI z całego świata. Odtwarzanie przez Torrentio / TorBox.',
  logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/1/12/Flag_of_Poland.svg/320px-Flag_of_Poland.svg.png',
  resources: ['catalog'],
  types: ['movie', 'series'],
  idPrefixes: ['tt'],
  catalogs: [...buildVodManifestCatalogs(), ...buildAiManifestCatalogs()],
  behaviorHints: { configurable: true }
};

const cache = new Map();
const CACHE_TTL_MS = 30 * 60 * 1000;

function parseExtra(str) {
  const extra = {};
  if (!str) return extra;
  for (const part of str.split('&')) {
    const i = part.indexOf('=');
    if (i > 0) {
      try { extra[decodeURIComponent(part.slice(0, i))] = decodeURIComponent(part.slice(i + 1)); } catch (_) {}
    }
  }
  return extra;
}

function decodeConfig(segment) {
  if (!segment) return {};
  try {
    if (segment.startsWith('%7B') || segment.startsWith('{')) {
      return JSON.parse(decodeURIComponent(segment));
    }
    let b64 = segment.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    return JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
  } catch (_) {
    return {};
  }
}

function encodeConfig(obj) {
  try {
    return Buffer.from(JSON.stringify(obj), 'utf8')
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  } catch (_) {
    return '';
  }
}

function send(res, status, body, { contentType = 'application/json; charset=utf-8', maxAge = 0 } = {}) {
  res.statusCode = status;
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
  res.setHeader('Content-Type', contentType);
  if (maxAge > 0) {
    res.setHeader('Cache-Control', `public, max-age=${maxAge}, s-maxage=${maxAge * 2}, stale-while-revalidate=86400`);
  } else {
    res.setHeader('Cache-Control', 'no-cache');
  }
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

function configurePage(host) {
  const proto = host.includes('localhost') || host.includes('127.0.0.1') ? 'http' : 'https';
  const base = `${proto}://${host}`;
  return `<!doctype html>
<html lang="pl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Konfiguracja — Polska VOD + Gemini AI</title>
  <style>
    :root {
      --bg: #0f1117;
      --card: #181b24;
      --accent: #7b5bf5;
      --accent-hover: #6a49e9;
      --text: #f0f3f8;
      --muted: #8b92a5;
      --border: #262a36;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.5;
      padding: 32px 16px;
    }
    .container {
      max-width: 620px;
      margin: 0 auto;
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 28px;
      box-shadow: 0 10px 30px rgba(0,0,0,0.5);
    }
    h1 { font-size: 24px; margin-bottom: 6px; display: flex; align-items: center; gap: 10px; }
    p.desc { color: var(--muted); font-size: 14px; margin-bottom: 24px; }
    .section { margin-bottom: 22px; }
    label { font-size: 14px; font-weight: 600; margin-bottom: 6px; display: block; }
    input[type="text"], input[type="password"] {
      width: 100%;
      background: #11131a;
      border: 1px solid var(--border);
      color: var(--text);
      padding: 12px 14px;
      border-radius: 10px;
      font-size: 14px;
      outline: none;
      transition: border 0.2s;
    }
    input:focus { border-color: var(--accent); }
    .hint { font-size: 12px; color: var(--muted); margin-top: 5px; }
    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 100%;
      background: var(--accent);
      color: #fff;
      padding: 14px 20px;
      border-radius: 10px;
      font-size: 15px;
      font-weight: 600;
      text-decoration: none;
      border: none;
      cursor: pointer;
      margin-top: 10px;
      transition: background 0.2s;
    }
    .btn:hover { background: var(--accent-hover); }
    .btn.secondary {
      background: #232733;
      color: var(--text);
      margin-top: 8px;
    }
    .btn.secondary:hover { background: #2c3140; }
    .box {
      background: #11131a;
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 12px;
      font-family: monospace;
      font-size: 12px;
      word-break: break-all;
      margin-top: 12px;
      user-select: all;
    }
    .badge {
      display: inline-block;
      background: rgba(123, 91, 245, 0.15);
      color: #a38cf8;
      padding: 2px 8px;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 500;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>🍿 Polska VOD + 🤖 Gemini AI</h1>
    <p class="desc">Katalogi wszystkich platform w Polsce (styl Netflix: Top 10, Nowości Kinowe, gatunki) oraz rekomendacje Gemini AI z całego świata. Działa 24/7 w chmurze bez potrzeby włączania komputera.</p>

    <div class="section">
      <label>Klucz Google Gemini API <span class="badge">Opcjonalny</span></label>
      <input type="password" id="geminiKey" placeholder="Wklej klucz AIzaSy... (lub zostaw puste)" oninput="updateUrls()">
      <p class="hint">Pozwala Gemini analizować zapytania w języku naturalnym i dobierać filmy z całego świata. Jeśli nie podasz klucza, zadziała wbudowany silnik semantyczny.</p>
    </div>

    <a id="btnApp" class="btn" href="#">📥 Zainstaluj w aplikacji Stremio</a>
    <a id="btnWeb" class="btn secondary" href="#" target="_blank">🌐 Zainstaluj w Stremio Web</a>

    <div class="section" style="margin-top: 20px;">
      <label>Lub skopiuj link ręcznie do Stremio:</label>
      <div id="manifestUrl" class="box">${base}/manifest.json</div>
    </div>
  </div>

  <script>
    const baseUrl = "${base}";
    const input = document.getElementById('geminiKey');
    const saved = localStorage.getItem('gemini_api_key');
    if (saved) input.value = saved;

    function updateUrls() {
      const key = input.value.trim();
      if (key) {
        localStorage.setItem('gemini_api_key', key);
      } else {
        localStorage.removeItem('gemini_api_key');
      }

      let manifestLink = baseUrl + '/manifest.json';
      if (key) {
        const configStr = btoa(JSON.stringify({ geminiKey: key }))
          .replace(/\\+/g, '-')
          .replace(/\\//g, '_')
          .replace(/=+$/, '');
        manifestLink = baseUrl + '/' + configStr + '/manifest.json';
      }

      const cleanHost = baseUrl.replace(/^https?:\\/\\//, '');
      const appLink = key
        ? 'stremio://' + cleanHost + '/' + btoa(JSON.stringify({ geminiKey: key })).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '') + '/manifest.json'
        : 'stremio://' + cleanHost + '/manifest.json';

      document.getElementById('manifestUrl').innerText = manifestLink;
      document.getElementById('btnApp').href = appLink;
      document.getElementById('btnWeb').href = 'https://web.stremio.com/#/addons?addon=' + encodeURIComponent(manifestLink);
    }

    updateUrls();
  </script>
</body>
</html>`;
}

async function handler(req, res) {
  if (req.method === 'OPTIONS') return send(res, 204, '');
  const url = new URL(req.url, 'http://localhost');
  const rawPath = url.pathname.replace(/\/+$/, '') || '/';

  try {
    const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost';

    if (rawPath === '/' || rawPath === '/configure') {
      return send(res, 200, configurePage(host), { contentType: 'text/html; charset=utf-8' });
    }

    // Dopasowanie ze wsparciem dla opcjonalnego segmentu :config
    // 1. /manifest.json LUB /:config/manifest.json
    const manifestMatch = rawPath.match(/^(?:\/([A-Za-z0-9_-]+))?\/manifest\.json$/);
    if (manifestMatch) {
      return send(res, 200, BASE_MANIFEST, { maxAge: 3600 });
    }

    // 2. /catalog/... LUB /:config/catalog/...
    const catalogMatch = rawPath.match(/^(?:\/([A-Za-z0-9_-]+))?\/catalog\/(movie|series)\/([^/]+?)(?:\/([^/]+))?\.json$/);
    if (catalogMatch) {
      const [, configSegment, type, id, extraStr] = catalogMatch;
      const config = decodeConfig(configSegment);
      const extra = parseExtra(extraStr ? decodeURIComponent(extraStr) : '');
      const key = `${type}|${id}|${JSON.stringify(extra)}|${config.geminiKey ? 'custom_key' : 'default'}`;

      const hit = cache.get(key);
      if (hit && Date.now() < hit.exp) return send(res, 200, hit.data, { maxAge: 1800 });

      let data;
      if (id.startsWith('vod_pl_')) data = await handleVodCatalog(type, id, extra);
      else if (id.startsWith('ai_')) data = await handleAiCatalog(type, id, extra, config);
      else return send(res, 404, { metas: [] });

      if (data.metas && data.metas.length) {
        if (cache.size > 400) cache.delete(cache.keys().next().value);
        cache.set(key, { data, exp: Date.now() + CACHE_TTL_MS });
        return send(res, 200, data, { maxAge: 1800 });
      }
      return send(res, 200, data, { maxAge: 60 });
    }

    return send(res, 404, { error: 'Not found' });
  } catch (err) {
    console.error('[addon] error:', err && err.message);
    return send(res, 200, { metas: [] }, { maxAge: 60 });
  }
}

module.exports = { handler, BASE_MANIFEST };
