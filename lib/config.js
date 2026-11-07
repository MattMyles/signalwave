// Shared settings for the station-vetting functions.
// Edit the genre map and talk blocklist here to tune what plays.

const USER_AGENT = 'SignalWave/1.0 (random world radio; +https://github.com/)';

// Each chip in the UI maps to Radio Browser tags. A random tag from the list
// is used for each directory query, so a genre pulls from all of them.
const GENRES = {
  electronic: { label: 'Electronic', tags: ['electronic', 'house', 'techno', 'trance', 'dance', 'edm', 'drum and bass', 'synthwave'] },
  rock: { label: 'Rock', tags: ['rock', 'alternative', 'indie', 'metal', 'punk', 'classic rock'] },
  pop: { label: 'Pop', tags: ['pop', 'top 40', 'hits', '80s', '90s'] },
  hiphop: { label: 'Hip-hop', tags: ['hip-hop', 'hiphop', 'rap', 'rnb', 'r&b'] },
  jazz: { label: 'Jazz', tags: ['jazz', 'blues', 'soul', 'funk'] },
  classical: { label: 'Classical', tags: ['classical', 'opera', 'baroque'] },
  ambient: { label: 'Ambient', tags: ['ambient', 'chillout', 'lounge', 'downtempo', 'chill'] },
  latin: { label: 'Latin', tags: ['latin', 'salsa', 'reggaeton', 'cumbia', 'bachata'] },
  world: { label: 'World', tags: ['world music', 'reggae', 'afrobeat', 'world', 'bollywood', 'celtic'] },
  country: { label: 'Country & Folk', tags: ['country', 'folk', 'bluegrass', 'americana'] },
};

// Sub-genres people can add from the app arrive as a single Radio Browser tag
// (?tag=deep%20house). Only letters, digits, spaces, & and - are accepted.
const TAG_PATTERN = /^[a-z0-9 &'\-]{2,32}$/;

// Every music tag across all genres, plus a few generic ones. A station must
// carry at least one of these (substring match) to count as a music station.
const MUSIC_TAGS = [
  ...new Set([
    ...Object.values(GENRES).flatMap((g) => g.tags),
    'music', 'oldies', 'country', 'disco', 'electro', 'hits', 'retro', 'instrumental',
    'deep house', 'lofi', 'lo-fi', 'variety', 'adult contemporary', 'charts',
  ]),
];

// Any tag containing one of these words marks the station as talk radio.
const TALK_BLOCKLIST = [
  'news', 'talk', 'sport', 'podcast', 'comedy', 'politic', 'religio', 'sermon',
  'bible', 'church', 'gospel preaching', 'quran', 'islam', 'catholic', 'spoken',
  'information', 'public radio', 'npr', 'call-in', 'debate', 'weather', 'traffic',
  'education', 'audiobook', 'drama', 'kids talk',
];

// Radio Browser is dominated by European and US stations. To spread picks
// around the world, each search first picks a region (all regions equally
// likely), then a few countries inside it.
const REGIONS = {
  europe: ['GB', 'DE', 'FR', 'NL', 'ES', 'IT', 'PL', 'SE', 'NO', 'FI', 'DK', 'BE', 'CH', 'AT', 'PT', 'GR', 'CZ', 'HU', 'RO', 'IE', 'UA', 'RS', 'HR', 'BG', 'SK', 'LT', 'LV', 'EE', 'IS', 'SI'],
  northamerica: ['US', 'CA'],
  latinamerica: ['MX', 'BR', 'AR', 'CO', 'CL', 'PE', 'VE', 'EC', 'UY', 'CU', 'DO', 'PR', 'GT', 'CR', 'PA', 'BO', 'PY', 'JM', 'TT', 'HN', 'SV'],
  africa: ['ZA', 'NG', 'KE', 'GH', 'MA', 'EG', 'TN', 'DZ', 'SN', 'CI', 'ET', 'TZ', 'UG', 'CM', 'AO', 'MZ', 'ZW', 'MU'],
  middleeast: ['TR', 'IL', 'AE', 'SA', 'IR', 'IQ', 'LB', 'JO', 'QA', 'KW', 'OM', 'CY'],
  southasia: ['IN', 'PK', 'BD', 'LK', 'NP'],
  eastasia: ['JP', 'KR', 'CN', 'TW', 'HK', 'MN'],
  southeastasia: ['ID', 'PH', 'TH', 'VN', 'MY', 'SG', 'KH'],
  oceania: ['AU', 'NZ', 'FJ', 'PG'],
};

const LIMITS = {
  firstByteMs: 4000, // stream must start sending audio within this
  probeTotalMs: 6000, // max time spent reading one stream for metadata
  maxProbeBytes: 256 * 1024,
  candidatesPerRound: 24,
  probeConcurrency: 12,
  vetDeadlineMs: 30000,
  poolTtlMs: 24 * 60 * 60 * 1000,
  failedTtlMs: 6 * 60 * 60 * 1000, // definite failures (no song titles, not audio)
  retryTtlMs: 20 * 60 * 1000, // slow or flaky streams get another chance sooner
};

module.exports = { USER_AGENT, GENRES, TAG_PATTERN, MUSIC_TAGS, TALK_BLOCKLIST, REGIONS, LIMITS };
