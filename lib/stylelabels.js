// Apple's genre names (the primaryGenreName values iTunes Search returns, such
// as "Techno", "Hard Rock", "Roots Reggae", "Salsa y Tropical") sorted by what
// they say about a style. The song check (lib/songcheck.js) uses this to tell
// a Synthwave pick from a Techno one: both are Electronic to Apple.
//
// Matching a pattern against an Apple label (both lower case):
//   'x'    the label has a word that starts with x   ('house' matches "Deep House")
//   'x$'   the label has x as a whole word           ('reggae$' matches "Roots Reggae", not "Reggaeton")
//   '=x'   the label is exactly x                    ('=dance' matches "Dance", not "Dancehall")
//
// For a style pick, each Apple label of the song is one of
//   named    the label names this style (STYLE_LABELS, or the style's own name or a
//            simple alias as the whole label)
//   generic  a label that covers the whole family (GENERIC): Apple has no Synthwave
//            label, so a Synthwave song is just "Electronic"; this never rules a style out
//   other    anything else: a specific label for a different style, or outside the family
// The song fits when any label is named or generic. See songcheck.js for the MusicBrainz
// second opinion and the era styles.
//
// Judgment calls are marked (adjacent). Keep them modest: the point is "close, not rogue
// and not overly tight".
const { STYLES, TAG_ALIASES } = require('./config');
const { plainNames } = require('./tagmatch');

const cache = new Map();
function regexFor(pat) {
  let re = cache.get(pat);
  if (!re) {
    const whole = pat.endsWith('$');
    const word = (whole ? pat.slice(0, -1) : pat).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    re = new RegExp(`(^|[^\\p{L}\\p{N}])${word}${whole ? '($|[^\\p{L}\\p{N}])' : ''}`, 'u');
    cache.set(pat, re);
  }
  return re;
}

/** Does this (lower-case) Apple label or tag match any of the patterns? */
function has(label, pats) {
  const l = String(label || '').toLowerCase().trim();
  return pats.some((p) => (p[0] === '=' ? l === p.slice(1) : regexFor(p).test(l)));
}

// Labels that cover a whole family. For a style pick these always fit.
const GENERIC = {
  electronic: ['=electronic', '=dance', 'electronica', '=edm'],
  rock: ['=rock', 'pop/rock', 'rock & roll', 'alternative'], // Apple files most indie, grunge and shoegaze under Alternative
  metal: ['=metal', 'heavy metal', '=rock', '=hard rock'], // Apple files a lot of metal under Rock (adjacent)
  punk: ['=punk', '=rock', 'alternative'],
  pop: ['=pop', 'teen pop', 'pop/rock', '=singer/songwriter', 'adult contemporary'],
  hiphop: ['=hip-hop/rap', '=hip-hop', '=rap', '=hip hop'],
  soul: ['=r&b/soul', '=r&b', 'r&b/soul'],
  jazz: ['=jazz', 'vocal jazz', 'jazz vocal', '=vocal', 'instrumental jazz', 'jazz standard'],
  blues: ['=blues', 'contemporary blues', 'traditional blues'],
  classical: ['=classical', 'classical crossover'],
  ambient: ['=ambient', '=electronic', 'electronica', '=chill', '=instrumental'],
  latin: ['=latin', '=latino', 'latin music', 'música latina'],
  reggae: ['=reggae'],
  country: ['=country', 'contemporary country', 'traditional country'],
};

// Styles that mean "the whole family, in a period or by chart position": the song
// check treats them like the main genre (any label of the family) and, for the
// eras, adds the release-year rule (ERAS in songcheck.js).
const BROAD = new Set(['classic rock', 'classic country', 'motown', 'old school hip-hop', '80s', '90s', '00s', 'top 40']);

// Per style: the Apple labels that name it. A parent label names its children when
// Apple has nothing finer (Trance for psytrance); a neighbour is listed only when
// the two are routinely confused (adjacent).
const STYLE_LABELS = {
  /* electronic */
  house: ['house', 'electro house'],
  'deep house': ['deep house', 'house'],
  'tech house': ['tech house', 'house', 'techno'],
  techno: ['techno', 'minimal techno', 'detroit techno'],
  minimal: ['minimal', 'microhouse', 'techno'],
  trance: ['trance', 'psy-trance', 'psytrance', 'goa'],
  psytrance: ['psytrance', 'psy-trance', 'psychedelic trance', 'goa', 'trance'],
  'drum and bass': ['drum & bass', 'drum and bass', "drum'n'bass", 'drum n bass', 'neurofunk', 'jungle'],
  jungle: ['jungle', 'ragga jungle', "drum'n'bass"],
  dubstep: ['dubstep', 'brostep', 'riddim'],
  'uk garage': ['uk garage', 'garage house', 'speed garage', '2-step', '2 step', 'bassline'],
  breakbeat: ['breakbeat', 'breaks$', 'big beat'],
  electro: ['electro$', 'electroclash', 'electro house'],
  synthwave: ['synthwave', 'retrowave', 'outrun', '=electro'], // (adjacent) Apple's plain Electro is where retro synth lands
  idm: ['idm', 'intelligent dance', 'glitch', 'braindance'],
  hardstyle: ['hardstyle', 'hard dance', 'hardcore techno', 'gabber', 'rawstyle'],
  edm: ['electro house', 'progressive house', 'big room', 'future bass', 'house', 'trance', 'dubstep', 'hardstyle'], // EDM is the festival mix

  /* rock */
  'hard rock': ['hard rock', 'heavy metal', 'hair metal', 'glam', 'metal$', 'blues rock'], // (adjacent) hard rock and metal share a shelf at Apple
  alternative: ['alternative', 'indie', 'grunge', 'britpop', 'shoegaze', 'post-grunge'],
  'indie rock': ['indie', 'lo-fi', 'jangle'],
  grunge: ['grunge', 'post-grunge'],
  'progressive rock': ['prog', 'progressive', 'art rock', 'symphonic rock'],
  'psychedelic rock': ['psychedelic', 'psych', 'acid rock', 'krautrock', 'space rock'],
  'garage rock': ['garage rock', 'garage$', 'proto-punk', 'surf'],
  britpop: ['britpop', 'brit pop', 'indie', 'madchester'],
  'post-rock': ['post-rock', 'post rock', 'math rock', 'instrumental rock'],
  shoegaze: ['shoegaze', 'dream pop', 'noise pop', 'slowcore'],
  'stoner rock': ['stoner', 'desert rock', 'hard rock', 'psychedelic', 'doom'],

  /* metal */
  'heavy metal': ['heavy metal', 'hair metal', 'glam metal', 'nwobhm', 'classic metal'],
  'thrash metal': ['thrash', 'speed metal'],
  'death metal': ['death metal', 'grindcore', 'deathcore'],
  'black metal': ['black metal', 'death metal/black metal', 'pagan', 'viking'],
  'doom metal': ['doom', 'stoner', 'sludge', 'funeral'],
  'power metal': ['power metal', 'speed metal', 'melodic metal', 'epic metal'],
  'progressive metal': ['progressive metal', 'prog metal', 'djent', 'math metal', 'avant-garde metal'],
  'symphonic metal': ['symphonic', 'gothic metal', 'orchestral metal'],
  metalcore: ['metalcore', 'deathcore', 'post-hardcore', '=hardcore', 'screamo'],
  'nu metal': ['nu metal', 'nu-metal', 'rap metal', 'rap rock', 'alternative metal'],
  'industrial metal': ['industrial', 'groove metal'],
  'folk metal': ['folk metal', 'viking', 'pagan', 'celtic metal'],

  /* punk */
  'punk rock': ['=punk', 'punk rock', 'street punk', 'oi$', 'proto-punk', 'garage punk', 'anarcho'],
  'pop punk': ['pop punk', 'pop-punk', 'skate punk', 'easycore'],
  hardcore: ['hardcore punk', '=hardcore', 'post-hardcore', 'straight edge'],
  'post-punk': ['post-punk', 'post punk', 'new wave', 'goth', 'darkwave', 'coldwave'],
  'ska punk': ['ska punk', 'ska-punk', 'ska$', 'third wave'],
  emo: ['emo', 'screamo', 'post-hardcore'],

  /* pop */
  'dance pop': ['dance pop', '=dance', 'electropop', 'eurodance', 'europop'],
  synthpop: ['synthpop', 'synth-pop', 'electropop', 'new wave', '=electronic', 'electronica'],
  'indie pop': ['indie', 'alternative', 'chamber pop', 'art pop', 'bedroom pop'],
  'dream pop': ['dream pop', 'shoegaze', 'ethereal', 'indie pop'],
  'k-pop': ['k-pop', 'kpop', 'korean'],
  'j-pop': ['j-pop', 'jpop', 'japanese', 'anime', 'kayokyoku'],
  'city pop': ['city pop', 'j-pop', 'jpop', 'japanese'],

  /* hip-hop */
  rap: ['rap', 'gangsta', 'underground rap'],
  trap: ['trap', 'phonk', 'cloud rap'],
  'boom bap': ['boom bap', 'east coast', 'golden age', 'conscious', 'underground'],
  drill: ['drill', 'road rap'],
  grime: ['grime', 'uk hip', 'british hip'],
  'lofi hip hop': ['lo-fi', 'lofi', 'chillhop', 'jazz hop', 'jazzhop', 'instrumental hip'],

  /* soul */
  rnb: ['r&b', 'contemporary r&b', 'urban$', 'new jack swing', 'quiet storm'],
  'neo soul': ['neo-soul', 'neo soul', 'nu soul', '=soul'],
  soul: ['soul', 'southern soul', 'northern soul', 'motown'],
  funk: ['funk', 'p-funk', 'boogie'],
  disco: ['disco', 'nu-disco', 'italo', 'hi-nrg'],
  gospel: ['gospel', 'christian', '=ccm', 'worship', 'spiritual'],

  /* jazz */
  'smooth jazz': ['smooth jazz', 'contemporary jazz', 'soft jazz'],
  bebop: ['bebop', 'bop$', 'hard bop', 'post-bop', 'straight-ahead', 'modern jazz', 'mainstream jazz'],
  swing: ['swing', 'big band', 'dixieland', 'traditional jazz', 'trad jazz', 'hot jazz'],
  'big band': ['big band', 'swing', 'jazz orchestra'],
  'cool jazz': ['cool jazz', 'west coast jazz', 'modal', 'third stream'],
  'jazz fusion': ['fusion', 'jazz-rock', 'jazz rock', 'contemporary jazz', 'jazz-funk', 'jazz funk', 'electric jazz'],
  'acid jazz': ['acid jazz', 'jazz-funk', 'jazz funk', 'nu jazz'],
  'latin jazz': ['latin jazz', 'afro-cuban', 'afro cuban', 'bossa', 'brazilian jazz', 'samba jazz'],
  'bossa nova': ['bossa', 'mpb', 'brazilian', 'samba', 'latin jazz'],
  'nu jazz': ['nu jazz', 'nu-jazz', 'acid jazz', 'future jazz', 'jazztronica'],

  /* blues */
  'delta blues': ['delta', 'acoustic blues', 'country blues', 'piedmont', 'folk blues'],
  'chicago blues': ['chicago', 'electric blues', 'urban blues', 'harmonica blues'],
  'electric blues': ['electric blues', 'chicago', 'texas blues', 'blues rock', 'blues-rock', 'urban blues'],
  'blues rock': ['blues rock', 'blues-rock', 'electric blues', 'southern rock', 'texas blues'],

  /* classical */
  baroque: ['baroque', 'early music', 'renaissance', 'harpsichord'],
  romantic: ['romantic', 'impressionist', 'late romantic'],
  opera: ['opera', 'operetta', 'art song', 'lieder'],
  orchestral: ['orchestral', 'symphon', 'concerto', '=score', 'orchestra'],
  'chamber music': ['chamber', 'string quartet', 'quartet', 'sonata'],
  piano: ['piano', 'solo piano'],
  choral: ['choral', 'choir', 'sacred', 'gregorian', 'chant', '=a cappella'],
  'contemporary classical': ['contemporary classical', 'modern classical', 'minimalism', 'neoclassical', 'neo-classical', 'avant-garde'],
  soundtrack: ['soundtrack', 'score', 'film', 'movie', 'video game', '=ost', '=musicals', 'tv'],

  /* ambient & chill */
  chillout: ['chill', 'downtempo', 'lounge', 'balearic'],
  lounge: ['lounge', 'easy listening', 'exotica', 'chill'],
  downtempo: ['downtempo', 'trip hop', 'trip-hop', 'chill'],
  'trip-hop': ['trip hop', 'trip-hop', 'downtempo'],
  chillwave: ['chillwave', 'chill', 'glo-fi', 'vaporwave'],
  lofi: ['lo-fi', 'lofi', 'chill', 'chillhop'],
  'new age': ['new age', 'meditation', 'relaxation', 'healing', 'spiritual'],
  meditation: ['meditation', 'relaxation', 'new age', 'spiritual', 'healing', 'yoga', 'sleep'],
  'space music': ['space', 'new age', 'cosmic', 'kosmische'],
  'dark ambient': ['dark ambient', 'drone', 'industrial', 'soundscape', 'noise'],
  drone: ['drone', 'dark ambient', 'noise', 'experimental'],

  /* latin */
  salsa: ['salsa', 'tropical', 'guaracha', 'son cubano', 'timba'],
  reggaeton: ['reggaeton', 'reggaetón', 'urbano', 'latin urban', 'trap latino', 'dembow'],
  cumbia: ['cumbia', 'tropical', 'vallenato', 'champeta'],
  bachata: ['bachata', 'tropical', 'dominican'],
  merengue: ['merengue', 'tropical'],
  tango: ['tango', 'nuevo tango', 'milonga', 'argentin'],
  samba: ['samba', 'pagode', 'brazil', 'mpb', 'axé', 'choro', 'bossa'],
  'latin pop': ['pop latino', 'latin pop', 'pop en español', 'balada', 'romántica'],
  'regional mexicano': ['regional', 'mexican', 'banda', 'norte', 'corrido', 'grupera', 'ranchera', 'mariachi'],
  mariachi: ['mariachi', 'ranchera', 'mexican', 'regional'],
  forro: ['forró', 'forro', 'pé de serra', 'xote', 'baião', 'brazil'],

  /* reggae & ska */
  'roots reggae': ['roots reggae', '=roots', 'one drop', 'rastafari', 'rasta'],
  dub: ['=dub', 'dub reggae', 'dub poetry', 'dubwise'],
  dancehall: ['dancehall', 'ragga', 'raggamuffin', 'bashment'],
  ska: ['ska$', 'rocksteady', 'two tone', '2 tone', 'third wave'],
  'lovers rock': ['lovers rock', "lover's rock", 'soul reggae'],
  'reggae fusion': ['reggae fusion', 'reggae pop', 'reggae-pop', 'reggae rock', 'reggae-rock', 'fusion'],

  /* country & folk */
  country: ['country', 'honky tonk', 'nashville', 'western'],
  'outlaw country': ['outlaw', 'red dirt', 'texas country', 'honky tonk', 'western'],
  'alt-country': ['alt-country', 'alt country', 'alternative country', 'americana', 'roots rock', 'cowpunk'],
  bluegrass: ['bluegrass', 'newgrass', 'old-time', 'old time', 'appalachian', 'string band'],
  americana: ['americana', 'roots rock', 'alt-country', 'alt country', '=roots'],
  folk: ['folk', 'acoustic', 'traditional'],
  'indie folk': ['indie folk', 'alternative folk', 'freak folk', 'folk', 'indie'],
  'singer-songwriter': ['singer/songwriter', 'singer-songwriter', 'singer songwriter', 'songwriter', 'acoustic', 'folk'],
};

/** The patterns that name a style: its table, its own name and its simple aliases as a whole label. */
const namesCache = new Map();
function namesOf(style) {
  let n = namesCache.get(style);
  if (!n) {
    n = [...(STYLE_LABELS[style] || []), `=${style}`, ...plainNames(TAG_ALIASES[style] || []).map((a) => `=${a}`)];
    namesCache.set(style, n);
  }
  return n;
}

/** Does this style have a table (so it's judged by named/generic labels, not just its family)? */
const isTabled = (style) => Boolean(STYLE_LABELS[style]) && !BROAD.has(style);

/** The styles of a family (main genre id), from the app's style list. */
const stylesOf = (family) => STYLES[family] || [];

/** 'named' | 'generic' | 'other': what an Apple label (or a MusicBrainz tag) says about this style. */
function labelVerdict(label, family, style) {
  if (has(label, namesOf(style))) return 'named';
  if (has(label, GENERIC[family] || [])) return 'generic';
  return 'other';
}

/** Does this label name a different style of the family, and not this one? (for the MusicBrainz opinion) */
function namesAnother(label, family, style) {
  if (has(label, namesOf(style))) return false;
  return stylesOf(family).some((t) => t !== style && !BROAD.has(t) && has(label, namesOf(t)));
}

module.exports = { has, GENERIC, BROAD, STYLE_LABELS, namesOf, isTabled, labelVerdict, namesAnother, stylesOf };
