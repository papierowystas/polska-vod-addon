'use strict';

/**
 * ai.js — rekomendacje Gemini AI dla filmów i seriali z CAŁEGO ŚWIATA.
 *
 * - Z kluczem GEMINI_API_KEY: Gemini dobiera do 30 tytułów do nastroju / zapytania,
 *   a my błyskawicznie zamieniamy je na metadane Stremio z ID IMDb przez JustWatch PL + Cinemeta.
 * - Bez klucza lub w razie opóźnienia Gemini: wbudowany silnik semantyczny (odpowiedź w 200ms).
 */

const { queryJustWatch, nodeToMeta, fetchWithTimeout } = require('./vod');

const CURRENT_YEAR = new Date().getFullYear();

const AI_MOODS = [
  '🔥 Najlepsze z ostatnich lat (Światowe hity)',
  '💎 Ukryte perełki, o których mało kto słyszał',
  '🤯 Mindfuck i zaskakujące zakończenia',
  '🔪 Mroczne thrillery psychologiczne',
  '🕵️ Wciągające kryminały i zagadki detektywistyczne',
  '🐉 Epickie fantasy i magia',
  '🚀 Ambitne sci-fi i podróże w czasie',
  '💥 Kino akcji na maksa',
  '😂 Komedie na luźny wieczór',
  '👻 Horrory, które naprawdę straszą',
  '⚔️ Historyczne i wojenne widowiska',
  '🎌 Azjatyckie perełki (Korea, Japonia)',
  '🏆 Klasyki wszech czasów',
  '🇵🇱 Najlepsze polskie produkcje'
];

// Fallback bez klucza lub przy opóźnieniu API: nastrój / zapytanie -> filtry JustWatch
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
  const stripped = String(text || '')
    .replace(/\b(coś|cos|jak|w stylu|podobn\w*|do|film\w*|serial\w*|poleć|polec|szukam)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return {
    genres: [...genres],
    onlyPl,
    minYear,
    maxYear,
    searchQuery: isDescriptive ? '' : stripped
  };
}

/**
 * Odpytuje Gemini o 30 rekomendacji z limitem czasu 4 sekund, aby uniknąć timeoutów na Vercel.
 */
async function askGemini(query, stremioType, apiKey) {
  if (!apiKey) return null;
  const typeLabel = stremioType === 'series' ? 'seriale (TV series)' : 'filmy (movies)';
  const prompt = `Jesteś światowej klasy ekspertem od kina i seriali.
Użytkownik z Polski szuka: "${query}"
Typ: ${typeLabel}.

Poleć dokładnie 30 świetnych tytułów z CAŁEGO ŚWIATA (USA, Wielka Brytania, Europa, Korea, Japonia, Skandynawia, Ameryka Łacińska itd.).
Nie ograniczaj się do polskich produkcji — polskie tytuły polecaj tylko wtedy, gdy zapytanie wyraźnie o nie prosi.
Mieszaj znane hity z mniej oczywistymi perełkami. Podawaj tylko tytuły, które naprawdę istnieją.

Odpowiedz WYŁĄCZNIE poprawnym obiektem JSON:
{"recommendations":[{"originalTitle":"oryginalny tytuł","titlePl":"polski tytuł jeśli istnieje","year":2021,"reasonPl":"1 krótkie zdanie po polsku, dlaczego warto obejrzeć"}]}`;

  const models = [
    { name: 'gemini-2.5-flash', thinkingBudget: 0 },
    { name: 'gemini-flash-latest', thinkingBudget: null }
  ];

  for (const { name: model, thinkingBudget } of models) {
    try {
      const generationConfig = { temperature: 0.7, responseMimeType: 'application/json' };
      if (thinkingBudget !== null) {
        generationConfig.thinkingConfig = { thinkingBudget };
      }

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
        4500 // Limit 4.5 sekundy na odpowiedź Gemini
      );

      if (!res.ok) {
        console.warn(`[AI] ${model} HTTP ${res.status}`);
        continue;
      }

      const data = await res.json();
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) continue;

      const parsed = JSON.parse(text.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim());
      if (parsed && Array.isArray(parsed.recommendations) && parsed.recommendations.length) {
        return parsed.recommendations;
      }
    } catch (err) {
      console.warn(`[AI] ${model} error/timeout: ${err.message}`);
    }
  }
  return null;
}

// Błyskawiczne dopasowanie tytułu do polskiego ID IMDb i metadanych
async function resolveTitleToMeta(rec, stremioType) {
  const searchTitle = rec.titlePl || rec.originalTitle;
  if (!searchTitle) return null;

  try {
    // 1. Szybkie sprawdzenie w JustWatch PL (odpowiedź w ~150ms, polskie plakaty, opisy i IMDb ID)
    const { nodes } = await queryJustWatch({
      searchQuery: searchTitle,
      objectType: stremioType === 'series' ? 'SHOW' : 'MOVIE',
      count: 2
    });

    if (nodes && nodes.length > 0) {
      // Wybierz najlepsze dopasowanie
      let chosen = nodes[0];
      if (rec.year) {
        const byYear = nodes.find(n => n.content?.originalReleaseYear && Math.abs(n.content.originalReleaseYear - rec.year) <= 1);
        if (byYear) chosen = byYear;
      }
      const meta = nodeToMeta(chosen, stremioType, { label: '🤖 Gemini AI' });
      if (meta) {
        if (rec.reasonPl) {
          meta.description = `🤖 Gemini AI: "${rec.reasonPl}"\n\n${meta.description || ''}`;
        }
        return meta;
      }
    }

    // 2. Fallback do Cinemeta jeśli JustWatch nie miał tytułu w katalogu PL
    const cinemetaUrl = `https://v3-cinemeta.strem.io/catalog/${stremioType}/top/search=${encodeURIComponent(rec.originalTitle || searchTitle)}.json`;
    const cRes = await fetchWithTimeout(cinemetaUrl, {}, 3000);
    if (cRes.ok) {
      const cJson = await cRes.json();
      const metas = cJson.metas || [];
      if (metas.length > 0) {
        const cm = metas[0];
        if (cm && cm.id && cm.id.startsWith('tt')) {
          const reason = rec.reasonPl ? `🤖 Gemini AI: "${rec.reasonPl}"\n\n` : '';
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
            description: `${reason}${cm.description || ''}`
          };
        }
      }
    }
  } catch (_) {}

  return null;
}

async function handleAiCatalog(type, id, extra = {}, config = {}) {
  const stremioType = type === 'series' ? 'series' : 'movie';
  const query = extra.search || extra.genre || AI_MOODS[0];
  const apiKey = (config && config.geminiKey ? config.geminiKey : (process.env.GEMINI_API_KEY || '')).trim();

  let metas = [];

  // Jeśli użytkownik szuka konkretnego tytułu w wyszukiwarce (np. "Interstellar"):
  if (extra.search && extra.search.trim().length >= 2) {
    try {
      const { nodes } = await queryJustWatch({
        searchQuery: extra.search.trim(),
        objectType: stremioType === 'series' ? 'SHOW' : 'MOVIE',
        count: 20
      });
      for (const node of nodes) {
        const meta = nodeToMeta(node, stremioType, { label: '🔍 Wyszukiwanie PL' });
        if (meta) metas.push(meta);
      }
      if (metas.length >= 10) {
        return { metas, cacheMaxAge: 3600 };
      }
    } catch (_) {}
  }

  // 1. Rekomendacje Gemini AI z kluczem użytkownika
  if (apiKey) {
    const recs = await askGemini(query, stremioType, apiKey);
    if (recs && recs.length > 0) {
      // Rozwiązujemy rekomendacje równolegle w paczkach po 10
      const BATCH_SIZE = 10;
      for (let i = 0; i < Math.min(recs.length, 30); i += BATCH_SIZE) {
        const slice = recs.slice(i, i + BATCH_SIZE);
        const resolved = await Promise.all(slice.map(r => resolveTitleToMeta(r, stremioType)));
        const seen = new Set(metas.map(m => m.id));
        for (const m of resolved) {
          if (m && !seen.has(m.id)) {
            seen.add(m.id);
            metas.push(m);
          }
        }
      }
    }
  }

  // 2. Fallback / Uzupełnienie: wbudowany silnik semantyczny JustWatch PL (odpowiedź w 200ms)
  if (metas.length < 15) {
    const f = heuristicFilter(query);
    const { nodes } = await queryJustWatch({
      objectType: stremioType === 'series' ? 'SHOW' : 'MOVIE',
      genres: f.genres,
      onlyPl: f.onlyPl,
      minYear: f.minYear,
      maxYear: f.maxYear,
      searchQuery: f.searchQuery || undefined,
      count: 45
    });

    const seen = new Set(metas.map(m => m.id));
    for (const n of nodes) {
      const m = nodeToMeta(n, stremioType, { label: '🤖 Polecane przez AI' });
      if (m && !seen.has(m.id)) {
        seen.add(m.id);
        metas.push(m);
      }
    }
  }

  return { metas, cacheMaxAge: 3600 };
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
