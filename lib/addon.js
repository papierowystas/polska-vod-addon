'use strict';

/**
 * addon.js — cały dodatek Stremio jako jedna funkcja (req, res).
 * Działa identycznie lokalnie (server.js) i na Vercelu (api/index.js).
 * Tylko katalogi — strumienie dostarcza Torrentio + TorBox.
 */

const { handleVodCatalog, buildVodManifestCatalogs } = require('./vod');
const { handleAiCatalog, buildAiManifestCatalogs } = require('./ai');

const MANIFEST = {
  id: 'pl.polska.vod.katalogi',
  version: '2.0.0',
  name: '🇵🇱 Polska VOD + Gemini AI',
  description: 'Katalogi polskich platform (Netflix, Max, CANAL+, Disney+, Prime, SkyShowtime, Apple TV+, Player, Polsat Box Go, TVP VOD, CDA) w układzie jak na Netflixie: Top 10, nowości, gatunki. Plus rekomendacje Gemini AI z całego świata. Odtwarzanie przez Torrentio/TorBox.',
  logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/1/12/Flag_of_Poland.svg/320px-Flag_of_Poland.svg.png',
  resources: ['catalog'],
  types: ['movie', 'series'],
  idPrefixes: ['tt'],
  catalogs: [...buildVodManifestCatalogs(), ...buildAiManifestCatalogs()],
  behaviorHints: { configurable: false }
};

// Pamięć podręczna w obrębie ciepłej instancji (CDN Vercela cache'uje i tak całe odpowiedzi)
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

function send(res, status, body, { contentType = 'application/json; charset=utf-8', maxAge = 0 } = {}) {
  res.statusCode = status;
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Content-Type', contentType);
  if (maxAge > 0) {
    res.setHeader('Cache-Control', `public, max-age=${maxAge}, s-maxage=${maxAge * 2}, stale-while-revalidate=86400`);
  } else {
    res.setHeader('Cache-Control', 'no-cache');
  }
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

function landingPage(host) {
  const base = `https://${host}`;
  return `<!doctype html><html lang="pl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${MANIFEST.name}</title>
<style>body{font-family:system-ui,sans-serif;background:#111;color:#eee;max-width:640px;margin:40px auto;padding:0 16px}
a.btn{display:inline-block;background:#7b5bf5;color:#fff;padding:14px 22px;border-radius:10px;text-decoration:none;font-weight:600;margin:8px 0}
code{background:#222;padding:8px;border-radius:6px;display:block;word-break:break-all}</style></head>
<body><h1>${MANIFEST.name}</h1><p>${MANIFEST.description}</p>
<a class="btn" href="stremio://${host}/manifest.json">📥 Zainstaluj w aplikacji Stremio</a><br>
<a class="btn" href="https://web.stremio.com/#/addons?addon=${encodeURIComponent(base + '/manifest.json')}">🌐 Zainstaluj w Stremio Web</a>
<p>Albo wklej ręcznie w Stremio → Dodatki:</p><code>${base}/manifest.json</code></body></html>`;
}

async function handler(req, res) {
  if (req.method === 'OPTIONS') return send(res, 204, '');
  const url = new URL(req.url, 'http://localhost');
  const path = url.pathname.replace(/\/+$/, '') || '/';

  try {
    if (path === '/' || path === '/configure') {
      const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost';
      return send(res, 200, landingPage(host), { contentType: 'text/html; charset=utf-8' });
    }

    if (path === '/manifest.json') return send(res, 200, MANIFEST, { maxAge: 3600 });

    const m = path.match(/^\/catalog\/(movie|series)\/([^/]+?)(?:\/([^/]+))?\.json$/);
    if (m) {
      const [, type, id, extraStr] = m;
      const extra = parseExtra(extraStr ? decodeURIComponent(extraStr) : '');
      const key = `${type}|${id}|${JSON.stringify(extra)}`;
      const hit = cache.get(key);
      if (hit && Date.now() < hit.exp) return send(res, 200, hit.data, { maxAge: 1800 });

      let data;
      if (id.startsWith('vod_pl_')) data = await handleVodCatalog(type, id, extra);
      else if (id.startsWith('ai_')) data = await handleAiCatalog(type, id, extra);
      else return send(res, 404, { metas: [] });

      if (data.metas && data.metas.length) {
        if (cache.size > 300) cache.delete(cache.keys().next().value);
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

module.exports = { handler, MANIFEST };
