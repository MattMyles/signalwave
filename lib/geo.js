// Finds the city a station is in from its coordinates, using a bundled list
// of ~49,000 places with 5,000+ people (lib/cities.json, from GeoNames,
// CC BY 4.0, via the all-the-cities package). It runs locally: instant, no
// outside service, no rate limits.
const CITIES = require('./cities.json'); // [name, lat, lng, countryCode, population]

const MAX_KM = 40; // farther than this from any town = "no city"
const METRO_KM = 20; // a big city this close wins over a nearby small town
const METRO_POP = 500000;

// 1° x 1° grid so a lookup only checks nearby places.
const grid = new Map();
for (const c of CITIES) {
  const k = `${Math.floor(c[1])},${Math.floor(c[2])}`;
  if (!grid.has(k)) grid.set(k, []);
  grid.get(k).push(c);
}

function km(lat1, lng1, lat2, lng2) {
  const r = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * r) / 2) ** 2 +
    Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lng2 - lng1) * r) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(a));
}

function nearby(lat, lng) {
  const out = [];
  const la = Math.floor(lat);
  const lo = Math.floor(lng);
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      let x = lo + dx;
      if (x < -180) x += 360;
      if (x >= 180) x -= 360;
      const cell = grid.get(`${la + dy},${x}`);
      if (cell) for (const c of cell) out.push([c, km(lat, lng, c[1], c[2])]);
    }
  }
  return out;
}

/**
 * reverseGeocode(lat, lng, countryCode?) → { city, countryCode } or null.
 * Prefers places in the station's own country, and a big city close by over
 * a small town next door (a station in Brooklyn shows as New York City).
 */
async function reverseGeocode(lat, lng, countryCode) {
  lat = Number(lat);
  lng = Number(lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) return null;
  let found = nearby(lat, lng).filter(([, d]) => d <= MAX_KM);
  const cc = String(countryCode || '').toUpperCase();
  if (cc) {
    const same = found.filter(([c]) => c[3] === cc);
    if (same.length) found = same;
  }
  if (!found.length) return null;
  found.sort((a, b) => a[1] - b[1]);
  const metro = found.filter(([c, d]) => d <= METRO_KM && c[4] >= METRO_POP).sort((a, b) => b[0][4] - a[0][4])[0];
  const best = metro || found[0];
  return { city: best[0][0], countryCode: best[0][3] };
}

// The biggest place in a country, for stations with no map location.
const biggest = new Map();
for (const c of CITIES) { const b = biggest.get(c[3]); if (!b || c[4] > b[4]) biggest.set(c[3], c); }
function largestCity(countryCode) {
  const c = biggest.get(String(countryCode || '').toUpperCase());
  return c ? { city: c[0], lat: c[1], lng: c[2] } : null;
}

// Country-level placement, for stations whose city can't be determined.
// citiesOf: every place of a country (cities.json), built once.
const citiesByCountry = new Map();
for (const c of CITIES) {
  if (!citiesByCountry.has(c[3])) citiesByCountry.set(c[3], []);
  citiesByCountry.get(c[3]).push(c);
}
const RAD = Math.PI / 180;
const CENTER_MAX_KM = 400; // a country's centre farther than this from all its cities is at sea: use a city's spot instead
const hasCities = (cc) => citiesByCountry.has(String(cc || '').toUpperCase());
function nearestCity(cc, lat, lng) {
  let best = null;
  let bestKm = Infinity;
  for (const c of citiesByCountry.get(String(cc || '').toUpperCase()) || []) {
    const d = km(lat, lng, c[1], c[2]);
    if (d < bestKm) { bestKm = d; best = c; }
  }
  return best ? { city: best, km: bestKm } : null;
}
const centers = new Map();
/**
 * countryCenter(cc) -> { lat, lng } or null (a country with no cities on file).
 * Where a country-level station goes on the globe: the population-weighted
 * mean of the country's cities, found by averaging unit vectors on the sphere
 * (so countries across the 180 degree line, like Russia and Fiji, come out
 * right). When that point is more than 400 km from every city (an archipelago's
 * sea), the nearest city's coordinates are used instead. Position only: the
 * city's name is never shown for it.
 */
function countryCenter(countryCode) {
  const cc = String(countryCode || '').toUpperCase();
  if (centers.has(cc)) return centers.get(cc);
  const list = citiesByCountry.get(cc);
  let out = null;
  if (list && list.length) {
    let x = 0, y = 0, z = 0;
    for (const c of list) {
      const w = Math.max(1, c[4] || 1);
      const la = c[1] * RAD, lo = c[2] * RAD;
      x += w * Math.cos(la) * Math.cos(lo);
      y += w * Math.cos(la) * Math.sin(lo);
      z += w * Math.sin(la);
    }
    const len = Math.hypot(x, y, z);
    const biggestCity = list.reduce((a, b) => (b[4] > a[4] ? b : a));
    if (len > 1e-9 * list.length) {
      const lat = Math.atan2(z, Math.hypot(x, y)) / RAD;
      const lng = Math.atan2(y, x) / RAD;
      const near = nearestCity(cc, lat, lng);
      out = near && near.km <= CENTER_MAX_KM ? { lat, lng } : { lat: near.city[1], lng: near.city[2] };
    } else out = { lat: biggestCity[1], lng: biggestCity[2] }; // cities all around the globe: no meaningful mean
  }
  centers.set(cc, out);
  return out;
}

// Stations with no map location often still say where they are: the
// directory's region field ("state", e.g. "Hamburg"), a city in their own
// name ("Radio Kraków"), their tags, or their web and stream addresses
// ("radio-buenosaires.com.ar"). byName indexes each country's places by plain
// name so those can be looked up; only real places in the station's own
// country count.
const CITY_ALIASES = require('./city-aliases');
const { domainToUnicode } = require('url');
const { GENRES, STYLES, TAG_ALIASES, MUSIC_TAGS } = require('./config');

// Lowercase, no accents, letters and numbers only, one space between words.
// Letters that don't split into base + accent are folded by hand (Łódź = lodz),
// and other scripts (Cyrillic, Chinese, Arabic...) are kept as they are.
const FOLD = { 'ı': 'i', 'ł': 'l', 'ß': 'ss', 'ø': 'o', 'æ': 'ae', 'đ': 'd', 'œ': 'oe', 'ð': 'd', 'ħ': 'h', 'þ': 'th' };
const plain = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').normalize('NFC').toLowerCase()
  .replace(/[ıłßøæđœðħþ]/g, (ch) => FOLD[ch]).replace(/[^\p{L}\p{N}\p{M}]+/gu, ' ').trim();
const byName = new Map(); // "DE|hamburg" -> biggest place with that name
for (const c of CITIES) {
  const k = `${c[3]}|${plain(c[0])}`;
  const b = byName.get(k);
  if (!b || c[4] > b[4]) byName.set(k, c);
}
const NAME_MIN_POP = 100000; // a city spotted inside a station name must be this big,
// so ordinary words that happen to be small-town names ("Paradise") don't count
const TAG_MIN_POP = 50000; // a whole tag naming a city can be a bit smaller
const NOT_PLACES = new Set(['radio', 'music', 'love', 'city', 'central', 'power', 'star', 'victoria', 'hit', 'hits', 'mix', 'gold', 'nova', 'energy', 'classic', 'jazz', 'rock',
  'paradise', 'hollywood', 'surprise', 'independence', 'orange', 'sunrise', 'aurora', 'phoenix', 'eden', 'victory', 'olympia', 'mercury', 'harmony', 'spring', 'ocean', 'temple',
  // more everyday words that are also real places of 50,000+ (found by checking radio vocabulary against the city list)
  'delta', 'latina', 'libertad', 'providence', 'pueblo', 'turbo', 'jupiter', 'plantation', 'mission', 'union', 'bethlehem', 'salem', 'metro', 'banda', 'americana',
  // places of 100,000+ whose names are also common station words (Natal = Christmas, Serra = mountains, Gracia = grace, Paulista = from São Paulo...)
  'natal', 'vitoria', 'serra', 'cabo', 'paulista', 'gracia', 'miramar', 'guadalupe', 'corona', 'soledad', 'enterprise', 'vista', 'centennial', 'jamaica', 'wola', 'artem', 'resistencia']);
// Big-ish places that are also everyday words; the looser sources below
// (tags, web and stream addresses) never use them.
const LOOSE_NOT = new Set(['nice', 'mesa', 'mobile', 'reading', 'bath', 'split', 'salem', 'orange']);
// Music words (genre names and their other names) are never places in tags or addresses.
const MUSIC_WORDS = new Set();
(function addMusicWords(x) {
  if (typeof x === 'string') { const k = plain(x); if (k) MUSIC_WORDS.add(k); } else if (Array.isArray(x)) x.forEach(addMusicWords);
  else if (x && typeof x === 'object') for (const v of Object.values(x)) addMusicWords(v);
})([GENRES, STYLES, TAG_ALIASES, MUSIC_TAGS, Object.keys(STYLES), Object.keys(TAG_ALIASES)]);
// Words that say what an address is, not where: they're ignored in addresses
// and peeled off the front and back of a word ("radiohamburgfm" = hamburg).
const GENERIC = new Set(['www', 'radio', 'radios', 'stream', 'streams', 'streaming', 'live', 'fm', 'am', 'online', 'web', 'play', 'player', 'listen', 'icecast', 'shoutcast',
  'server', 'cast', 'media', 'music', 'com', 'net', 'org', 'info', 'http', 'https', 'html', 'htm', 'php', 'mp3', 'aac', 'ogg', 'pls', 'm3u', 'm3u8', 'audio', 'hd', 'tv', 'hits', 'radyo']);
const AFFIXES = ['radios', 'radio', 'radyo', 'streaming', 'stream', 'online', 'music', 'live', 'web', 'fm', 'am'];

// Other names for cities (lib/city-aliases.js) are looked up like real names,
// but only in the country they list. When an alias is also a real place's name
// the bigger place wins. Names in scripts without spaces (Chinese, Japanese,
// Korean, Thai) are also kept in a list to be found anywhere inside a text.
const UNSPACED = /[฀-๿぀-ヿ㐀-鿿가-힯]/;
const lookup = new Map(byName);
const SHORT_OK = new Set(); // aliases under 4 letters that may match as whole words ("nyc")
const unspacedByCountry = new Map(); // "JP" -> [{ key, city }], longest names first
for (const [cc, canonical, names] of CITY_ALIASES) {
  const target = byName.get(`${cc}|${plain(canonical)}`);
  if (!target) continue;
  for (const alias of names) {
    const k = plain(alias);
    if (!k) continue;
    const have = lookup.get(`${cc}|${k}`);
    if (!have || target[4] > have[4]) lookup.set(`${cc}|${k}`, target);
    if (UNSPACED.test(k)) {
      if (!unspacedByCountry.has(cc)) unspacedByCountry.set(cc, []);
      unspacedByCountry.get(cc).push({ key: k, city: target });
    } else if (k.length < 4) SHORT_OK.add(k);
  }
}
for (const list of unspacedByCountry.values()) list.sort((a, b) => b.key.length - a.key.length);
// Many-word cities written as one word in addresses: "buenosaires", "saopaulo".
const joinedByName = new Map(); // "AR|buenosaires" -> biggest place with that name
for (const [key, c] of lookup) {
  const bar = key.indexOf('|');
  const k = key.slice(bar + 1);
  if (!k.includes(' ') || UNSPACED.test(k)) continue;
  const j = k.replace(/ /g, '');
  if (j.length < 8) continue;
  const jk = `${key.slice(0, bar)}|${j}`;
  const have = joinedByName.get(jk);
  if (!have || c[4] > have[4]) joinedByName.set(jk, c);
}

function place(c, how) { return { city: c[0], region: null, countryCode: c[3], lat: c[1], lng: c[2], how }; }
const better = (a, b) => (!a || b[4] > a[4] ? b : a);
const lengthOk = (k) => k.length >= 4 || SHORT_OK.has(k) || UNSPACED.test(k);

// Names in scripts without spaces, found anywhere in the text. Longest first,
// and a found name is blanked out so a shorter one can't match inside it
// (東京都 is Tokyo, not Kyoto).
function scanUnspaced(text, cc, minPop) {
  const list = unspacedByCountry.get(cc);
  if (!list || !UNSPACED.test(text)) return null;
  let left = text;
  let best = null;
  for (const { key, city } of list) {
    if (!left.includes(key)) continue;
    left = left.split(key).join(' ');
    if (city[4] >= minPop) best = better(best, city);
  }
  return best;
}

// Ways a region field can be written, with its administrative words peeled
// off: "Tokyo Prefecture", "Province of Quebec", "Metro Manila", "Osaka-fu"
// (Japanese endings only for Japan, "-si" only for Korea).
const LEAD_WORDS = ['city and county of', 'metropolitan area of', 'metropolitan city of', 'municipality of', 'prefecture of', 'province of', 'provincia de', 'provincia di', 'departamento de',
  'comunidade de', 'comunidad de', 'prefeitura de', 'county of', 'region of', 'state of', 'canton of', 'district of', 'ciudad de', 'cidade de', 'ville de', 'city of', 'estado de',
  'capital district', 'metropolitan area', 'provincia', 'regione', 'region', 'estado', 'oblast', 'kraj', 'county', 'greater', 'metro'];
const TRAIL_WORDS = ['metropolitan area', 'metropolitan city', 'capital district', 'capital territory', 'special city', 'voivodeship', 'municipality', 'governorate', 'prefecture', 'metropolis',
  'province', 'provincia', 'district', 'regione', 'region', 'regio', 'estado', 'oblast', 'county', 'state', 'metro', 'kraj', 'city'];
function stateForms(raw, cc) {
  const out = new Set();
  for (const part of String(raw || '').split(',')) {
    const base = plain(part);
    if (!base) continue;
    const trail = cc === 'JP' ? [...TRAIL_WORDS, 'to', 'fu', 'ken', 'shi'] : cc === 'KR' ? [...TRAIL_WORDS, 'si'] : TRAIL_WORDS;
    let frontier = [base];
    out.add(base);
    for (let round = 0; round < 3 && frontier.length; round++) {
      const next = [];
      for (const f of frontier) {
        for (const w of LEAD_WORDS) if (f.startsWith(`${w} `)) { const r = f.slice(w.length + 1); if (r && !out.has(r)) { out.add(r); next.push(r); } }
        for (const w of trail) if (f.endsWith(` ${w}`)) { const r = f.slice(0, -(w.length + 1)); if (r && !out.has(r)) { out.add(r); next.push(r); } }
      }
      frontier = next;
    }
  }
  return out;
}

// First-level regions (states, provinces) in federal countries whose names
// are also towns or cities: "Indiana" is a state, not Indiana, PA, and "New
// York" or "São Paulo" as a region doesn't say the station is in that city.
// A region field naming one of these places nothing.
const REGION_NAMES = {
  US: 'alabama,alaska,arizona,arkansas,california,colorado,connecticut,delaware,florida,georgia,hawaii,idaho,illinois,indiana,iowa,kansas,kentucky,louisiana,maine,maryland,massachusetts,michigan,minnesota,mississippi,missouri,montana,nebraska,nevada,new hampshire,new jersey,new mexico,new york,north carolina,north dakota,ohio,oklahoma,oregon,pennsylvania,rhode island,south carolina,south dakota,tennessee,texas,utah,vermont,virginia,washington,west virginia,wisconsin,wyoming,district of columbia,puerto rico',
  CA: 'alberta,british columbia,manitoba,new brunswick,newfoundland and labrador,nova scotia,ontario,prince edward island,quebec,saskatchewan,yukon,nunavut,northwest territories',
  AU: 'new south wales,queensland,south australia,tasmania,victoria,western australia,northern territory,australian capital territory',
  BR: 'acre,alagoas,amapa,amazonas,bahia,ceara,espirito santo,goias,maranhao,mato grosso,mato grosso do sul,minas gerais,para,paraiba,parana,pernambuco,piaui,rio de janeiro,rio grande do norte,rio grande do sul,rondonia,roraima,santa catarina,sao paulo,sergipe,tocantins,distrito federal',
  MX: 'aguascalientes,baja california,baja california sur,campeche,chiapas,chihuahua,coahuila,colima,durango,guanajuato,guerrero,hidalgo,jalisco,mexico,estado de mexico,michoacan,morelos,nayarit,nuevo leon,oaxaca,puebla,queretaro,quintana roo,san luis potosi,sinaloa,sonora,tabasco,tamaulipas,tlaxcala,veracruz,yucatan,zacatecas',
  IN: 'andhra pradesh,arunachal pradesh,assam,bihar,chhattisgarh,goa,gujarat,haryana,himachal pradesh,jharkhand,karnataka,kerala,madhya pradesh,maharashtra,manipur,meghalaya,mizoram,nagaland,odisha,punjab,rajasthan,sikkim,tamil nadu,telangana,tripura,uttar pradesh,uttarakhand,west bengal',
};
const regionNames = new Map(Object.entries(REGION_NAMES).map(([cc, list]) => [cc, new Set(list.split(',').map((x) => plain(x)).filter(Boolean))]));

const isRegionName = (text, cc) => Boolean(regionNames.get(String(cc || '').toUpperCase()) && regionNames.get(String(cc || '').toUpperCase()).has(plain(text)));

function fromState(state, cc) {
  if (!state) return null;
  const regions = regionNames.get(cc);
  if (regions && regions.has(plain(state))) return null;
  let best = null;
  const asWritten = new Set(String(state).split(',').map(plain)); // the whole text or one piece of it
  asWritten.add(plain(state));
  for (const k of stateForms(state, cc)) {
    if (!k || NOT_PLACES.has(k)) continue;
    // The text as written (or one comma-separated piece of it) may name any place;
    // a form made by peeling words off ("Texas State") must name a big city, since
    // a region sharing its name with a small town says nothing about the town.
    const exact = asWritten.has(k);
    let c = lookup.get(`${cc}|${k}`);
    if (c && !exact && c[4] < NAME_MIN_POP) c = null;
    if (!c) { const cityToo = lookup.get(`${cc}|${k} city`); if (cityToo && cityToo[4] >= NAME_MIN_POP) c = cityToo; }
    if (c) best = better(best, c);
  }
  return best || scanUnspaced(plain(state), cc, 0);
}

function fromName(name, cc) {
  const text = plain(name);
  const words = text.split(' ').filter(Boolean);
  let best = null;
  for (let n = Math.min(4, words.length); n >= 1 && !best; n--) {
    for (let i = 0; i + n <= words.length; i++) {
      const phrase = words.slice(i, i + n).join(' ');
      if (!lengthOk(phrase) || UNSPACED.test(phrase) || NOT_PLACES.has(phrase)) continue;
      const c = lookup.get(`${cc}|${phrase}`);
      if (c && c[4] >= NAME_MIN_POP) best = better(best, c);
    }
  }
  return best || scanUnspaced(text, cc, NAME_MIN_POP);
}

// A whole tag that is a city ("hamburg", "são paulo").
function fromTags(tags, cc) {
  const list = Array.isArray(tags) ? tags : String(tags || '').split(',');
  let best = null;
  for (const t of list) {
    const k = plain(t);
    if (!k || !lengthOk(k) || NOT_PLACES.has(k) || LOOSE_NOT.has(k) || MUSIC_WORDS.has(k)) continue;
    const c = lookup.get(`${cc}|${k}`);
    if (c && c[4] >= TAG_MIN_POP) best = better(best, c);
  }
  return best;
}

// Words made of letters only, from the host name and the path of an address,
// one list per host label and per path segment (so "radio-buenos-aires" stays together).
function addressGroups(address) {
  let host = '';
  let path = '';
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(address) ? address : `https://${address}`);
    host = domainToUnicode(u.hostname) || u.hostname;
    try { path = decodeURIComponent(u.pathname); } catch (_) { path = u.pathname; }
  } catch (_) { return []; }
  const groups = [];
  for (const part of [...host.split('.'), ...path.split('/')]) {
    const words = plain(part).replace(/[0-9]+/g, ' ').split(' ').filter(Boolean);
    if (words.length) groups.push(words);
  }
  return groups;
}

// "radiohamburgfm" -> ["radiohamburgfm", "hamburgfm", "radiohamburg", "hamburg"]
function peeled(word) {
  const out = new Set([word]);
  let fronts = [word];
  for (let round = 0; round < 2; round++) {
    const next = [];
    for (const w of fronts) for (const a of AFFIXES) if (w.startsWith(a) && w.length - a.length >= 5) { const r = w.slice(a.length); if (!out.has(r)) { out.add(r); next.push(r); } }
    fronts = next;
  }
  for (const w of [...out]) {
    let cur = w;
    for (let round = 0; round < 2; round++) {
      const a = AFFIXES.find((x) => cur.endsWith(x) && cur.length - x.length >= 5);
      if (!a) break;
      cur = cur.slice(0, -a.length);
      out.add(cur);
    }
  }
  return out;
}

// A city named in a web address or stream address: a word of 5+ letters (or
// a longer many-word name run together) that is a city of 100,000+ in the
// station's country. Everyday words and generic address words never count.
function fromAddress(address, cc) {
  let best = null;
  for (const words of addressGroups(address)) {
    for (let i = 0; i < words.length; i++) {
      for (const w of peeled(words[i])) {
        if (GENERIC.has(w) || NOT_PLACES.has(w) || LOOSE_NOT.has(w) || MUSIC_WORDS.has(w)) continue;
        if (w.length < 5 && !SHORT_OK.has(w)) continue;
        const c = lookup.get(`${cc}|${w}`) || joinedByName.get(`${cc}|${w}`);
        if (c && c[4] >= NAME_MIN_POP) best = better(best, c);
      }
      let run = words[i];
      for (let n = 2; n <= 4 && i + n <= words.length; n++) {
        run += words[i + n - 1];
        if (run.length < 8) continue;
        const c = joinedByName.get(`${cc}|${run}`);
        if (c && c[4] >= NAME_MIN_POP && !NOT_PLACES.has(run)) best = better(best, c);
      }
    }
  }
  return best;
}

// The directory's region field as something fit to show next to a country:
// "Indiana", "Ontario", "Île-de-France", "東京都". Letters, spaces, hyphens,
// apostrophes and periods only (any script), at most 40 characters; never a web
// address, the country's own name or an ordinary word that isn't a place
// (NOT_PLACES); all-lower or all-upper case is title-cased. null when unusable.
const regionNamesEn = typeof Intl.DisplayNames === 'function' ? new Intl.DisplayNames(['en'], { type: 'region' }) : null;
const countryNameOf = (cc) => { try { return (regionNamesEn && regionNamesEn.of(cc)) || ''; } catch (_) { return ''; } };
const REGION_SHAPE = /^[\p{L}\p{M}][\p{L}\p{M} .'’-]*$/u;
function cleanRegion(raw, countryCode, countryName) {
  let r = String(raw == null ? '' : raw).replace(/\s+/g, ' ').trim();
  if (!r || r.length > 40 || !REGION_SHAPE.test(r)) return null;
  if (/^(https?|ftp):|^www\./i.test(r) || /\p{L}\.\p{L}{2,}/u.test(r)) return null; // web addresses ("radio.example.com")
  const key = plain(r);
  const cc = String(countryCode || '').toLowerCase();
  if (!key || key === cc || NOT_PLACES.has(key)) return null;
  if (key === plain(countryName) || key === plain(countryNameOf(cc.toUpperCase()))) return null;
  const lower = r === r.toLowerCase() && r !== r.toUpperCase();
  const upper = r === r.toUpperCase() && r !== r.toLowerCase();
  if (lower || upper) r = r.toLowerCase().replace(/(^|[ -])(\p{L})|(?<=(?:^|[ -])\p{L}['’])(\p{L})/gu, (m, a, b, c) => (a !== undefined ? a + b.toUpperCase() : c.toUpperCase()));
  return r;
}

// No city could be found, but the country is known: put the station at its
// country's centre, with the region field (when it's a usable one) to show.
// `at` keeps a station's own coordinates when they're plausibly in the country.
function countryLevel(cc, state, countryName, at) {
  if (!hasCities(cc)) return null;
  let pos = null;
  if (at && Number.isFinite(at.lat) && Number.isFinite(at.lng) && !(at.lat === 0 && at.lng === 0)) {
    const near = nearestCity(cc, at.lat, at.lng);
    if (near && near.km <= CENTER_MAX_KM) pos = { lat: at.lat, lng: at.lng };
  }
  pos = pos || countryCenter(cc);
  if (!pos) return null;
  return { city: null, region: cleanRegion(state, cc, countryName), countryCode: cc, lat: pos.lat, lng: pos.lng, how: 'country' };
}

/**
 * placeFromFields({ state, name, homepage, url, tags, countryCode, country })
 *   -> { city, region, countryCode, lat, lng, how } or null.
 * For stations with no coordinates. Needs the station's country. Sources,
 * strongest first (the first that finds anything wins; inside one source the
 * biggest city wins):
 *   state     the region field names a place (tolerating "Tokyo Prefecture", "Osaka, Japan")
 *   name      a city of 100,000+ inside the station's name (aliases count: München)
 *   tags      a whole tag that is a city of 50,000+
 *   homepage  a city of 100,000+ in the web address
 *   stream    the same in the stream address
 * Ordinary words that are also place names never count (NOT_PLACES).
 * When none of them finds a city but the country is a real one, the fallback is
 * the country itself: { city: null, region (the cleaned region field or null),
 * lat/lng of the country's centre, how: 'country' }. A real city always wins.
 * With no usable country code the answer is null.
 */
function placeFromFields({ state, name, homepage, url, tags, countryCode, country } = {}) {
  const cc = String(countryCode || '').toUpperCase();
  if (!/^[A-Z]{2}$/.test(cc)) return null;
  const tiers = [
    ['state', () => fromState(state, cc)],
    ['name', () => fromName(name, cc)],
    ['tags', () => fromTags(tags, cc)],
    ['homepage', () => (homepage ? fromAddress(String(homepage), cc) : null)],
    ['stream', () => (url ? fromAddress(String(url), cc) : null)],
  ];
  for (const [how, find] of tiers) {
    const c = find();
    if (c) return place(c, how);
  }
  return countryLevel(cc, state, country);
}

/**
 * cityFromText(state, name, countryCode) → { city, region, countryCode, lat, lng, how } or null.
 * The region field and the station's name only (see placeFromFields). city is
 * null when only the country could be told.
 */
function cityFromText(state, name, countryCode) {
  return placeFromFields({ state, name, countryCode });
}

/** placeFromStation(s): placeFromFields for a Radio Browser station record (no coordinates needed). */
function placeFromStation(s) {
  return placeFromFields({ state: s.state, name: s.name, homepage: s.homepage, url: s.url_resolved || s.url, tags: s.tags, countryCode: s.countrycode, country: s.country });
}

// Stations with no country at all (the Icecast directory) can only be placed
// by a city named in their name or genre text. That's only safe for big cities
// whose name belongs to one city worldwide, so "Radio Lagos" lands in Nigeria
// but "San José", "Valencia" and "Birmingham" are left alone.
const ANYWHERE_MIN_POP = 300000;
const ANYWHERE_NOT = new Set(['nice', 'mesa', 'mobile', 'reading', 'bath', 'split', 'salem', 'orange']); // big-ish places that are also everyday words
const bigByName = new Map(); // plain name -> big places with that name
for (const c of CITIES) {
  if (c[4] < ANYWHERE_MIN_POP) continue;
  const k = plain(c[0]);
  if (!k) continue;
  if (!bigByName.has(k)) bigByName.set(k, []);
  bigByName.get(k).push(c);
}

/**
 * cityAnywhere(text) -> { city, countryCode, lat, lng, how: 'name' } or null.
 * Finds a whole-word city name (up to 4 words, longest first) in the text.
 * Only cities of 300,000+ whose name is unique among such cities count;
 * ordinary words (NOT_PLACES and a few more) never do.
 */
function cityAnywhere(text) {
  const words = plain(text).split(' ').filter(Boolean);
  for (let n = Math.min(4, words.length); n >= 1; n--) {
    for (let i = 0; i + n <= words.length; i++) {
      const phrase = words.slice(i, i + n).join(' ');
      if (phrase.length < 4 || NOT_PLACES.has(phrase) || ANYWHERE_NOT.has(phrase)) continue;
      const hits = bigByName.get(phrase);
      if (hits && hits.length === 1) return place(hits[0], 'name');
    }
  }
  return null;
}

/**
 * Where a directory station is: its coordinates, else its region, name, tags or
 * addresses; failing a real city, the country (city: null, see placeFromFields).
 * A station with coordinates that are far from any town keeps its own spot at
 * country level (when it is plausibly inside its country, else the country's
 * centre). null only when the station has no usable country at all.
 */
async function locateStation(s) {
  if (s.geo_lat != null && s.geo_long != null) {
    const p = await reverseGeocode(s.geo_lat, s.geo_long, s.countrycode);
    if (p) return { ...p, region: null, lat: Number(s.geo_lat), lng: Number(s.geo_long), how: 'coords' };
    const text = placeFromStation(s);
    if (!text || text.city) return text;
    const cc = text.countryCode;
    return countryLevel(cc, s.state, s.country, { lat: Number(s.geo_lat), lng: Number(s.geo_long) }) || text;
  }
  return placeFromStation(s);
}

module.exports = { reverseGeocode, largestCity, cityFromText, placeFromFields, placeFromStation, cityAnywhere, locateStation, isRegionName, countryCenter, cleanRegion };
