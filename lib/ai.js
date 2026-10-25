'use strict';

/**
 * ai.js — rekomendacje Gemini AI dla filmów i seriali z CAŁEGO ŚWIATA.
 *
 * - Z kluczem GEMINI_API_KEY: Gemini dobiera tytuły do nastroju / zapytania,
 *   a my zamieniamy je na prawdziwe ID IMDb przez Cinemeta (+ polskie opisy z JustWatch).
 * - Bez klucza: wbudowany silnik gatunków na bazie JustWatch (wszystkie kraje produkcji).
 */

const { queryJustWatch, nodeToMeta, fetchWithTimeout } = require('./vod');

const CURRENT_YEAR = new Date().getFullYear();

const AI_MOODS = [
  '🔥 Najlepsze z ostatnich lat',
  '💎 Ukryte perełki, o których mało kto słyszał',
  '🤯 Mindfuck i zaskakujące zakończenia',
  '🔪 Mroczne thrillery psychologiczne',
  '🕵️ Wciągające kryminały i zagadki',
  '🐉 Epickie fantasy',
  '🚀 Ambitne sci-fi',
  '💥 Kino akcji na maksa',
  '😂 Komedie na luźny wieczór',
  '👻 Horrory, które naprawdę straszą',
  '⚔️ Historyczne i wojenne',
  '🎌 Azjatyckie perełki (Korea, Japonia)',
  '🏆 Klasyki wszech czasów',
  '🇵🇱 Najlepsze polskie produkcje'
];

// Fallback bez klucza: nastrój / zapytanie -> filtry JustWatch
function heuristicFilter(text) {
  const q = String(text || '').toLowerCase();
  const genres = new Set();
  let onlyPl = false;
  let minYear = null;
  let maxYear = null;
  const add = (...g) => g.forEach(x => genres.add(x));

  if (/polsk|polska|po polsku/.test(q)) onlyPl = true;
  if (/krymina|detektyw|zagadk|morderst|śledztw|sledztw/.test(q)) add('crm');
  if (/thriller|mindfuck|zaskakuj|psycholog|mroczn/.test(q)) add('trl');
  if (/fantasy|magi|smok/.test(q)) add('fnt');
  if (/sci-?fi|kosmos|przyszło|przyszlo|cyberpunk/.test(q)) add('scf');
  if (/komedi|śmieszn|smieszn|luźn|luzn/.test(q)) add('cmy');
  if (/horror|strasz|grozy/.test(q)) add('hrr');
  if (/akcj|pościg|poscig|sensacj/.test(q)) add('act');
  if (/histor|wojen|wojn/.test(q)) add('war', 'hst');
  if (/romans|miłoś|milos/.test(q)) add('rma');
  if (/dokument/.test(q)) add('doc');
  if (/animac|bajk|dzieci|familij/.test(q)) add('ani', 'fml');
  if (/ostatnich lat|nowoś|nowosc|nowe/.test(q)) minYear = CURRENT_YEAR - 3;
  if (/klasyk/.test(q)) maxYear = 2005;

  const isDescriptive = genres.size > 0 || onlyPl || minYear || maxYear || /perełk|perelk|azjat/.test(q);
  // "coś jak Dark" / "podobne do Breaking Bad" -> szukaj samego tytułu
  const stripped = String(text || '')
    .replace(/\b(coś|cos|jak|w stylu|podobn\w*|do|film\w*|serial\w*|poleć|polec|szukam)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return { genres: [...genres], onlyPl, minYear, maxYear, searchQuery: isDescriptive ? '' : stripped };
}

async function askGemini(query, stremioType, apiKey) {
  if (!apiKey) return null;
  const typeLabel = stremioType === 'series' ? 'seriale (TV series)' : 'filmy (movies)';
  const prompt = `Jesteś światowej klasy ekspertem od kina i seriali.
Użytkownik z Polski szuka: "${query}"
Typ: ${typeLabel}.

Poleć dokładnie 15 tytułów z CAŁEGO ŚWIATA (USA, Wielka Brytania, Europa, Korea, Japonia, Skandynawia, Ameryka Łacińska itd.).
Nie ograniczaj się do polskich produkcji — polskie tytuły polecaj tylko wtedy, gdy zapytanie wyraźnie o nie prosi.
Mieszaj znane hity z mniej oczywistymi perełkami. Podawaj tylko tytuły, które naprawdę istnieją.

Odpowiedz WYŁĄCZNIE obiektem JSON:
{"recommendations":[{"originalTitle":"oryginalny tytuł (lub angielski)","titlePl":"polski tytuł jeśli istnieje","year":2019,"reasonPl":"1 krótkie zdanie po polsku, dlaczego pasuje"}]}`;

  // 2.5-flash z wyłączonym "myśleniem" odpowiada w kilka sekund; reszta to zapas
  const models = [
    { name: 'gemini-2.5-flash', thinking: true },
    { name: 'gemini-flash-latest', thinking: false },
    { name: 'gemini-2.0-flash', thinking: false }
  ];
  for (const { name: model, thinking } of models) {
    try {
      const generationConfig = { temperature: 0.7, responseMimeType: 'application/json' };
      if (thinking) generationConfig.thinkingConfig = { thinkingBudget: 0 };
      const res = await fetchWithTimeout(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig
          })
        },
        20000
      );
      if (!res.ok) {
        console.warn(`[AI] ${model} HTTP ${res.status}`);
        continue;
      }
      const data = await res.json();
      const text = data && data.candidates && data.candidates[0] && data.candidates[0].content
        && data.candidates[0].content.parts && data.candidates[0].content.parts[0] && data.candidates[0].content.parts[0].text;
      if (!text) continue;
      const parsed = JSON.parse(text.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim());
      if (parsed && Array.isArray(parsed.recommendations) && parsed.recommendations.length) return parsed.recommendations;
    } catch (err) {
      console.warn(`[AI] ${model} error: ${err.message}`);
    }
  }
  return null;
}

// Tytuł -> prawdziwe ID IMDb przez Cinemeta (oficjalny katalog Stremio, cały świat)
async function cinemetaLookup(title, year, stremioType) {
  if (!title) return null;
  try {
    const url = `https://v3-cinemeta.strem.io/catalog/${stremioType}/top/search=${encodeURIComponent(title)}.json`;
    const res = await fetchWithTimeout(url, {}, 7000);
    if (!res.ok) return null;
    const json = await res.json();
    const metas = (json && json.metas) || [];
    if (!metas.length) return null;
    const y = Number(year);
    const byYear = y ? metas.find(m => {
      const my = parseInt(String(m.releaseInfo || m.year || ''), 10);
      return my && Math.abs(my - y) <= 1;
    }) : null;
    return byYear || metas[0];
  } catch (_) {
    return null;
  }
}

async function recToMeta(rec, stremioType) {
  const cm = (await cinemetaLookup(rec.originalTitle, rec.year, stremioType))
    || (rec.titlePl && rec.titlePl !== rec.originalTitle ? await cinemetaLookup(rec.titlePl, rec.year, stremioType) : null);
  if (!cm || !cm.id || !String(cm.id).startsWith('tt')) return null;
  const reason = rec.reasonPl ? `🤖 Gemini AI: ${rec.reasonPl}` : '🤖 Gemini AI';

  // Spróbuj dociągnąć polski tytuł i opis z JustWatch PL
  try {
    const nodes = await queryJustWatch({
      objectType: stremioType === 'series' ? 'SHOW' : 'MOVIE',
      searchQuery: rec.titlePl || rec.originalTitle,
      count: 5
    });
    const match = nodes.find(n => n.content && n.content.externalIds && n.content.externalIds.imdbId === cm.id);
    if (match) {
      const meta = nodeToMeta(match, stremioType);
      if (meta) {
        meta.description = `${reason}\n\n${meta.description || ''}`;
        return meta;
      }
    }
  } catch (_) { /* zostaje wersja z Cinemeta */ }

  return {
    id: cm.id,
    imdb_id: cm.id,
    type: stremioType,
    name: rec.titlePl || cm.name,
    poster: cm.poster || `https://images.metahub.space/poster/medium/${cm.id}/img`,
    posterShape: 'regular',
    background: `https://images.metahub.space/background/medium/${cm.id}/img`,
    logo: `https://images.metahub.space/logo/medium/${cm.id}/img`,
    releaseInfo: String(cm.releaseInfo || rec.year || ''),
    imdbRating: cm.imdbRating || undefined,
    genres: cm.genres || [],
    description: `${reason}\n\n${cm.description || ''}`
  };
}

async function handleAiCatalog(type, id, extra = {}, config = {}) {
  const stremioType = type === 'series' ? 'series' : 'movie';
  if (Number(extra.skip || 0) > 0) return { metas: [] };
  const query = extra.search || extra.genre || AI_MOODS[0];
  const apiKey = (config && config.geminiKey ? config.geminiKey : (process.env.GEMINI_API_KEY || '')).trim();

  let metas = [];
  if (apiKey) {
    const recs = await askGemini(query, stremioType, apiKey);
    if (recs) {
      const resolved = await Promise.all(recs.slice(0, 15).map(r => recToMeta(r, stremioType).catch(() => null)));
      const seen = new Set();
      for (const m of resolved) {
        if (m && !seen.has(m.id)) { seen.add(m.id); metas.push(m); }
      }
    }
  }

  // Fallback / uzupełnienie bez klucza
  if (metas.length < 6) {
    const f = heuristicFilter(query);
    const nodes = await queryJustWatch({ objectType: stremioType === 'series' ? 'SHOW' : 'MOVIE', ...f, count: 40 });
    const seen = new Set(metas.map(m => m.id));
    for (const n of nodes) {
      const m = nodeToMeta(n, stremioType, { label: '🤖 Rekomendacja' });
      if (m && !seen.has(m.id)) { seen.add(m.id); metas.push(m); }
    }
  }
  return { metas };
}

function buildAiManifestCatalogs() {
  return ['movie', 'series'].map(type => ({
    type,
    id: `ai_${type}`,
    name: `🤖 Gemini AI — ${type === 'movie' ? 'Filmy' : 'Seriale'} z całego świata`,
    extra: [
      { name: 'genre', options: AI_MOODS, isRequired: false },
      { name: 'search', isRequired: false },
      { name: 'skip', isRequired: false }
    ]
  }));
}

module.exports = { AI_MOODS, handleAiCatalog, buildAiManifestCatalogs, heuristicFilter };
