'use strict';

/**
 * vod.js — katalogi platform VOD dostępnych w Polsce (JustWatch PL GraphQL).
 * Zwraca identyfikatory IMDb (tt...), więc Torrentio + TorBox od razu znajdują strumienie.
 */

const JUSTWATCH_GRAPHQL_URL = 'https://apis.justwatch.com/graphql';
const CURRENT_YEAR = new Date().getFullYear();

// Kolejność = kolejność wierszy na ekranie głównym Stremio
const PLATFORMS = [
  { id: 'cinema_pl', packages: [], name: 'Nowości Kinowe & Premiery', icon: '🍿', isCinemaPremieres: true },
  { id: 'netflix_pl', packages: ['nfx'], name: 'Netflix', icon: '🔴' },
  { id: 'max_pl', packages: ['mxx'], name: 'Max (HBO)', icon: '🟣' },
  { id: 'canalplus_pl', packages: ['cpr', 'pmc'], name: 'CANAL+ Online', icon: '⚫' },
  { id: 'disney_pl', packages: ['dnp'], name: 'Disney+', icon: '🔵' },
  { id: 'prime_pl', packages: ['prv', 'amz'], name: 'Prime Video', icon: '💠' },
  { id: 'skyshowtime_pl', packages: ['sst'], name: 'SkyShowtime', icon: '🌌' },
  { id: 'apple_pl', packages: ['atp'], name: 'Apple TV+', icon: '🍎' },
  { id: 'player_pl', packages: ['plp'], name: 'Player.pl (TVN)', icon: '🟢' },
  { id: 'polsat_pl', packages: ['pbg'], name: 'Polsat Box Go', icon: '🟠' },
  { id: 'tvpvod_pl', packages: ['vtp'], name: 'TVP VOD', icon: '📺' },
  { id: 'cda_pl', packages: ['cda'], name: 'CDA Premium', icon: '🎞️' },
  {
    id: 'polskie_hity',
    packages: ['nfx', 'mxx', 'cpr', 'pmc', 'plp', 'pbg', 'vtp', 'cda', 'prv', 'sst', 'dnp'],
    name: 'Polskie Produkcje',
    icon: '🇵🇱',
    onlyPolishProductions: true
  }
];

const GENRE_OPTIONS = [
  '🏆 Top 10 w Polsce (Dzisiaj)',
  '🔥 Najpopularniejsze (Biblioteka)',
  '🇵🇱 Polskie Produkcje',
  `🆕 Nowości (${CURRENT_YEAR - 1}-${CURRENT_YEAR})`,
  '🐉 Fantasy',
  '🚀 Sci-Fi',
  '🕵️ Kryminał',
  '🔪 Thriller & Tajemnica',
  '💥 Akcja & Przygoda',
  '😂 Komedia',
  '👻 Horror',
  '🎭 Dramat',
  '📜 Dokumentalne',
  '👨‍👩‍👧 Familijne & Dla Dzieci',
  '🎨 Animacje',
  '⚔️ Wojenne & Historyczne',
  '💕 Romans'
];

const GENRE_CODE_TO_PL = {
  scf: 'Sci-Fi', fnt: 'Fantasy', crm: 'Kryminał', trl: 'Thriller', act: 'Akcja',
  cmy: 'Komedia', hrr: 'Horror', drm: 'Dramat', doc: 'Dokumentalny', fml: 'Familijny',
  ani: 'Animacja', war: 'Wojenny', hst: 'Historyczny', rma: 'Romans', spt: 'Sportowy',
  eur: 'Europejski', wsn: 'Western', msc: 'Muzyczny', rly: 'Reality TV'
};

function parseGenreOption(genreStr) {
  const g = String(genreStr || '').trim().toLowerCase();
  const base = { mode: 'genre', genres: [], onlyPl: false, minYear: null };
  if (!g || g.includes('top 10')) return { ...base, mode: 'top10' };
  if (g.includes('najpopularniejsze')) return { ...base, mode: 'popular' };
  if (g.includes('polskie')) return { ...base, mode: 'polish', onlyPl: true };
  if (g.includes('nowości') || g.includes('nowosci')) return { ...base, mode: 'new', minYear: CURRENT_YEAR - 1 };
  const map = [
    ['fantasy', ['fnt']], ['sci-fi', ['scf']], ['krymina', ['crm']], ['thriller', ['trl']],
    ['akcja', ['act']], ['komedia', ['cmy']], ['horror', ['hrr']], ['dramat', ['drm']],
    ['dokument', ['doc']], ['familij', ['fml']], ['animac', ['ani']], ['wojenne', ['war', 'hst']],
    ['romans', ['rma']]
  ];
  for (const [needle, genres] of map) {
    if (g.includes(needle)) return { ...base, genres };
  }
  return { ...base, mode: 'popular' };
}

const POPULAR_TITLES_QUERY = `
query GetPopularTitles($country: Country!, $language: Language!, $first: Int!, $after: String, $filter: TitleFilter) {
  popularTitles(country: $country, first: $first, after: $after, sortBy: POPULAR, filter: $filter) {
    pageInfo { endCursor hasNextPage }
    edges {
      node {
        id
        objectType
        content(country: $country, language: $language) {
          title
          originalTitle
          shortDescription
          originalReleaseYear
          productionCountries
          posterUrl
          backdrops { backdropUrl }
          externalIds { imdbId }
          scoring { imdbScore imdbVotes }
          genres { shortName }
        }
      }
    }
  }
}`;

async function fetchWithTimeout(url, options = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Pobiera tytuły z JustWatch PL (z paginacją po kursorze).
 */
async function queryJustWatch({ packages, objectType, genres, onlyPl, minYear, maxYear, searchQuery, count = 40 }) {
  const filter = {};
  if (packages && packages.length) filter.packages = packages;
  if (objectType) filter.objectTypes = [objectType];
  if (genres && genres.length) filter.genres = genres;
  if (onlyPl) filter.productionCountries = ['PL'];
  if (minYear || maxYear) {
    filter.releaseYear = {};
    if (minYear) filter.releaseYear.min = minYear;
    if (maxYear) filter.releaseYear.max = maxYear;
  }
  if (searchQuery && String(searchQuery).trim()) filter.searchQuery = String(searchQuery).trim();

  const nodes = [];
  let after = null;
  const target = Math.min(count, 200);
  while (nodes.length < target) {
    const first = Math.min(100, target - nodes.length);
    const res = await fetchWithTimeout(JUSTWATCH_GRAPHQL_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'
      },
      body: JSON.stringify({
        query: POPULAR_TITLES_QUERY,
        variables: { country: 'PL', language: 'pl', first, after, filter }
      })
    });
    if (!res.ok) throw new Error(`JustWatch HTTP ${res.status}`);
    const json = await res.json();
    const page = json && json.data && json.data.popularTitles;
    if (!page) break;
    for (const e of page.edges || []) if (e && e.node) nodes.push(e.node);
    if (!page.pageInfo || !page.pageInfo.hasNextPage) break;
    after = page.pageInfo.endCursor;
  }
  return nodes;
}

function jwImage(path, profile) {
  if (!path || typeof path !== 'string') return null;
  return `https://images.justwatch.com${path.replace('{profile}', profile).replace('{format}', 'jpg')}`;
}

/**
 * Węzeł JustWatch -> MetaPreview Stremio (polskie tytuły i opisy, ID IMDb).
 */
function nodeToMeta(node, stremioType, { rankIndex = null, label = '' } = {}) {
  const c = node && node.content;
  if (!c) return null;
  const imdbId = c.externalIds && c.externalIds.imdbId;
  if (!imdbId || !imdbId.startsWith('tt')) return null;

  const isPl = Array.isArray(c.productionCountries) && c.productionCountries.some(x => String(x).toUpperCase() === 'PL');
  const score = c.scoring && c.scoring.imdbScore ? Number(c.scoring.imdbScore).toFixed(1) : null;
  const title = c.title || c.originalTitle || 'Tytuł';
  const poster = jwImage(c.posterUrl, 's592') || `https://images.metahub.space/poster/medium/${imdbId}/img`;
  const background = (c.backdrops && c.backdrops[0] && jwImage(c.backdrops[0].backdropUrl, 's1440'))
    || `https://images.metahub.space/background/medium/${imdbId}/img`;

  const releaseParts = [];
  if (c.originalReleaseYear) releaseParts.push(String(c.originalReleaseYear));
  if (score) releaseParts.push(`⭐ ${score}`);

  const head = [];
  if (label) head.push(label);
  if (rankIndex !== null) head.push(`🔥 TOP #${rankIndex} w Polsce dzisiaj`);
  if (score) head.push(`⭐ IMDb ${score}/10`);
  if (isPl) head.push('🇵🇱 Polska produkcja');

  return {
    id: imdbId,
    imdb_id: imdbId,
    type: stremioType,
    name: `${rankIndex !== null ? `#${rankIndex} • ` : ''}${isPl ? '🇵🇱 ' : ''}${title}`,
    genres: (c.genres || []).map(g => GENRE_CODE_TO_PL[g && g.shortName] || (g && g.shortName)).filter(Boolean),
    poster,
    posterShape: 'regular',
    background,
    logo: `https://images.metahub.space/logo/medium/${imdbId}/img`,
    imdbRating: score || undefined,
    releaseInfo: releaseParts.join(' • '),
    description: [head.join(' • '), c.shortDescription || ''].filter(Boolean).join('\n\n')
  };
}

async function handleVodCatalog(type, id, extra = {}) {
  const stremioType = type === 'series' ? 'series' : 'movie';
  const platformId = id.replace(/^vod_pl_/, '').replace(/_(?:movie|series)$/, '');
  const platform = PLATFORMS.find(p => p.id === platformId);
  if (!platform) return { metas: [] };

  const skip = Math.max(0, parseInt(extra.skip || '0', 10) || 0);
  const f = parseGenreOption(extra.genre);
  const isTop10 = !platform.onlyPolishProductions && !platform.isCinemaPremieres && f.mode === 'top10';
  if (isTop10 && skip > 0) return { metas: [] };

  let nodes = await queryJustWatch({
    packages: platform.packages,
    objectType: stremioType === 'series' ? 'SHOW' : 'MOVIE',
    genres: f.genres,
    onlyPl: platform.onlyPolishProductions || f.onlyPl,
    minYear: platform.isCinemaPremieres ? (f.minYear || CURRENT_YEAR - 1) : f.minYear,
    count: isTop10 ? 30 : skip + 60
  });

  // Premiery: odrzuć tytuły jeszcze niewydane (bez oceny IMDb)
  if (platform.isCinemaPremieres) {
    nodes = nodes.filter(n => {
      const s = n.content && n.content.scoring;
      return s && Number(s.imdbScore) > 0 && (!s.imdbVotes || Number(s.imdbVotes) >= 50);
    });
  }

  const metas = [];
  const seen = new Set();
  for (const node of nodes) {
    const meta = nodeToMeta(node, stremioType, { rankIndex: isTop10 ? metas.length + 1 : null, label: `📺 ${platform.name}` });
    if (!meta || seen.has(meta.id)) continue;
    seen.add(meta.id);
    metas.push(meta);
    if (isTop10 && metas.length >= 10) break;
  }
  return { metas: metas.slice(skip, skip + 60) };
}

function buildVodManifestCatalogs() {
  const catalogs = [];
  for (const p of PLATFORMS) {
    const options = p.onlyPolishProductions ? GENRE_OPTIONS.filter(o => !o.includes('Polskie')) : GENRE_OPTIONS;
    for (const type of ['movie', 'series']) {
      catalogs.push({
        type,
        id: `vod_pl_${p.id}_${type}`,
        name: `${p.icon} ${p.name} — ${type === 'movie' ? 'Filmy' : 'Seriale'}`,
        // Bez "search": inaczej wyszukiwarka Stremio pokazywałaby 26 identycznych wierszy
        extra: [
          { name: 'genre', options, isRequired: false },
          { name: 'skip', isRequired: false }
        ]
      });
    }
  }
  return catalogs;
}

module.exports = { PLATFORMS, queryJustWatch, nodeToMeta, handleVodCatalog, buildVodManifestCatalogs, fetchWithTimeout };
