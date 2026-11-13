// Shared settings for the station-vetting functions.
// Edit the genre map and talk blocklist here to tune what plays.

const USER_AGENT = 'NeoEarthRadio/1.0 (random world radio; +https://neoearthradio.com)';

// Each chip in the UI maps to Radio Browser tags. A random tag from the list
// is used for each directory query, so a genre pulls from all of them.
const GENRES = {
  electronic: { label: 'Electronic', tags: ['electronic', 'house', 'techno', 'trance', 'dance', 'edm', 'drum and bass', 'synthwave'] },
  rock: { label: 'Rock', tags: ['rock', 'alternative', 'indie', 'classic rock', 'hard rock'] },
  metal: { label: 'Metal', tags: ['metal', 'heavy metal', 'thrash metal', 'death metal', 'black metal', 'doom metal'] },
  punk: { label: 'Punk', tags: ['punk', 'punk rock', 'hardcore', 'post-punk'] },
  pop: { label: 'Pop', tags: ['pop', 'top 40', 'hits', '80s', '90s'] },
  hiphop: { label: 'Hip-hop', tags: ['hip-hop', 'hiphop', 'rap'] },
  soul: { label: 'R&B & Soul', tags: ['rnb', 'r&b', 'soul', 'funk', 'motown'] },
  jazz: { label: 'Jazz', tags: ['jazz', 'smooth jazz', 'bebop', 'swing'] },
  blues: { label: 'Blues', tags: ['blues', 'blues rock'] },
  classical: { label: 'Classical', tags: ['classical', 'opera', 'baroque'] },
  ambient: { label: 'Ambient & Chill', tags: ['ambient', 'chillout', 'lounge', 'downtempo', 'chill'] },
  latin: { label: 'Latin', tags: ['latin', 'salsa', 'reggaeton', 'cumbia', 'bachata'] },
  reggae: { label: 'Reggae & Ska', tags: ['reggae', 'roots reggae', 'dancehall', 'ska'] },
  world: { label: 'World', tags: ['world music', 'afrobeat', 'world', 'bollywood', 'celtic'] },
  country: { label: 'Country & Folk', tags: ['country', 'folk', 'bluegrass', 'americana'] },
};

// Other names stations use for the same style. Radio Browser tags are typed
// by whoever listed the station, so a local station might say "retrowave" or
// "dnb" rather than "synthwave" or "drum and bass". A style searches and
// matches all of its names. Keep aliases specific: matching is by substring.
const TAG_ALIASES = {
  'psychedelic rock': ['psychedelic', 'psych rock', 'acid rock', 'space rock', 'krautrock'],
  synthwave: ['retrowave', 'outrun', 'darksynth', 'synth wave', 'chillsynth', 'synthpop 80s'],
  'drum and bass': ['dnb', 'drum & bass', 'drum n bass', 'drumandbass', 'liquid funk'],
  'deep house': ['deephouse'],
  'tech house': ['techhouse'],
  psytrance: ['psy trance', 'psychedelic trance', 'goa trance', 'goa'],
  'uk garage': ['ukg', '2-step', '2step'],
  edm: ['electronic dance'],
  idm: ['intelligent dance'],
  'heavy metal': ['heavy-metal'],
  'thrash metal': ['thrash'],
  'death metal': ['death-metal', 'deathmetal'],
  'black metal': ['black-metal', 'blackmetal'],
  'doom metal': ['doom', 'stoner doom', 'sludge'],
  'power metal': ['power-metal'],
  'progressive metal': ['prog metal', 'djent'],
  'symphonic metal': ['gothic metal'],
  'nu metal': ['nu-metal', 'numetal'],
  'industrial metal': ['industrial'],
  'folk metal': ['viking metal', 'pagan metal'],
  'punk rock': ['punk'],
  'pop punk': ['pop-punk', 'poppunk'],
  hardcore: ['hardcore punk', 'hxc'],
  'post-punk': ['post punk', 'postpunk', 'coldwave', 'darkwave'],
  'ska punk': ['ska-punk'],
  emo: ['emocore', 'screamo'],
  'k-pop': ['kpop', 'korean pop'],
  'j-pop': ['jpop', 'japanese pop', 'anison'],
  'city pop': ['citypop'],
  'dream pop': ['dreampop'],
  'hip-hop': ['hiphop', 'hip hop'],
  'old school hip-hop': ['old school hip hop', 'oldschool hip hop', 'golden age hip hop'],
  'lofi hip hop': ['lofi hiphop', 'lo-fi hip hop', 'chillhop'],
  lofi: ['lo-fi', 'lo fi', 'chillhop'],
  rnb: ['r&b', "r'n'b", 'rhythm and blues'],
  'neo soul': ['neo-soul', 'neosoul'],
  'smooth jazz': ['smoothjazz'],
  'jazz fusion': ['fusion'],
  'bossa nova': ['bossanova'],
  'nu jazz': ['nu-jazz'],
  'contemporary classical': ['modern classical', 'neoclassical', 'neo-classical'],
  soundtrack: ['film score', 'soundtracks', 'movie music', 'video game music'],
  'trip-hop': ['trip hop', 'triphop'],
  'dark ambient': ['darkambient'],
  'space music': ['spacemusic', 'space ambient'],
  reggaeton: ['reggaetón', 'urbano latino'],
  'regional mexicano': ['regional mexican', 'banda', 'norteño', 'norteno'],
  forro: ['forró'],
  dancehall: ['ragga'],
  'roots reggae': ['roots'],
  afrobeats: ['afropop', 'afro pop', 'naija'],
  'alt-country': ['alternative country', 'alt country'],
  'singer-songwriter': ['singer songwriter', 'acoustic'],
  'classic country': ['country classics', 'old country'],
  'indie folk': ['folk indie'],
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
  // Weakest stream allowed (when the station reports its bitrate). AAC sounds
  // fine at lower rates than MP3.
  minKbps: 64,
  minKbpsAac: 40,
};

// Styles shown under each main genre in the app (must match CATALOG in
// public/app.js; a test checks). Also tells the song check each style's parent.
const STYLES = {
  electronic: ['house', 'deep house', 'tech house', 'techno', 'minimal', 'trance', 'psytrance', 'drum and bass', 'jungle', 'dubstep', 'uk garage', 'breakbeat', 'electro', 'synthwave', 'idm', 'hardstyle', 'edm'],
  rock: ['classic rock', 'hard rock', 'alternative', 'indie rock', 'grunge', 'progressive rock', 'psychedelic rock', 'garage rock', 'britpop', 'post-rock', 'shoegaze', 'stoner rock'],
  metal: ['heavy metal', 'thrash metal', 'death metal', 'black metal', 'doom metal', 'power metal', 'progressive metal', 'symphonic metal', 'metalcore', 'nu metal', 'industrial metal', 'folk metal'],
  punk: ['punk rock', 'pop punk', 'hardcore', 'post-punk', 'ska punk', 'emo'],
  pop: ['top 40', 'dance pop', 'synthpop', 'indie pop', 'dream pop', 'k-pop', 'j-pop', 'city pop', '80s', '90s', '00s'],
  hiphop: ['rap', 'trap', 'boom bap', 'old school hip-hop', 'drill', 'grime', 'lofi hip hop'],
  soul: ['rnb', 'neo soul', 'soul', 'funk', 'motown', 'disco', 'gospel'],
  jazz: ['smooth jazz', 'bebop', 'swing', 'big band', 'cool jazz', 'jazz fusion', 'acid jazz', 'latin jazz', 'bossa nova', 'nu jazz'],
  blues: ['delta blues', 'chicago blues', 'electric blues', 'blues rock'],
  classical: ['baroque', 'romantic', 'opera', 'orchestral', 'chamber music', 'piano', 'choral', 'contemporary classical', 'soundtrack'],
  ambient: ['chillout', 'lounge', 'downtempo', 'trip-hop', 'chillwave', 'lofi', 'new age', 'meditation', 'space music', 'dark ambient', 'drone'],
  latin: ['salsa', 'reggaeton', 'cumbia', 'bachata', 'merengue', 'tango', 'samba', 'latin pop', 'regional mexicano', 'mariachi', 'forro'],
  reggae: ['roots reggae', 'dub', 'dancehall', 'ska', 'lovers rock', 'reggae fusion'],
  world: ['afrobeat', 'afrobeats', 'highlife', 'bollywood', 'celtic', 'flamenco', 'fado', 'arabic', 'balkan', 'turkish', 'chanson'],
  country: ['country', 'classic country', 'outlaw country', 'alt-country', 'bluegrass', 'americana', 'folk', 'indie folk', 'singer-songwriter'],
};

module.exports = { USER_AGENT, GENRES, STYLES, TAG_ALIASES, TAG_PATTERN, MUSIC_TAGS, TALK_BLOCKLIST, REGIONS, LIMITS };
