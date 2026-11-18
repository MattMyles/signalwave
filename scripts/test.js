// Offline tests: filters, title checks, and ICY parsing against local mock streams.
//   npm test
process.env.SW_ALLOW_PRIVATE = '1';
const assert = require('assert');
const http = require('http');
const net = require('net');
const { probeStream, isPrivateIp } = require('../lib/icy');
const { isMusicStation, looksLikeSong, splitTags, matchesGenre, resolveGenre, resolveGenres } = require('../lib/vet');

let failures = 0;
async function t(name, fn) {
  try { await fn(); console.log(`  pass  ${name}`); } catch (e) { failures++; console.log(`  FAIL  ${name}\n        ${e.message}`); }
}

// Builds an ICY body: metaint bytes of "audio", then a metadata block.
function icyBody(metaint, title) {
  const meta = Buffer.from(`StreamTitle='${title}';StreamUrl='';`, 'utf8');
  const len = Math.ceil(meta.length / 16);
  const block = Buffer.alloc(len * 16); meta.copy(block);
  return Buffer.concat([Buffer.alloc(metaint, 0xff), Buffer.from([len]), block, Buffer.alloc(metaint, 0xff)]);
}

(async () => {
  console.log('NESE IDs');
  const { formatNeseId, parseNeseId } = require('../lib/nese');
  await t('formats IDs with four digits', () => { assert.strictEqual(formatNeseId(0), 'NESE-0000'); assert.strictEqual(formatNeseId(42), 'NESE-0042'); assert.strictEqual(formatNeseId(12345), 'NESE-12345'); });
  await t('reads IDs the way people type them', () => {
    for (const [input, n] of [['NESE-0007', 7], ['nese 7', 7], ['#7', 7], ['0007', 7], ['  NESE-0000 ', 0], ['nese:12', 12]]) assert.strictEqual(parseNeseId(input), n, input);
  });
  await t('rejects things that are not IDs', () => { for (const bad of ['', 'abc', 'NESE-', '7a', 'NESE-12-3', null]) assert.strictEqual(parseNeseId(bad), null, String(bad)); });

  console.log('Filters');
  const { cityFromText } = require('../lib/geo');
  const where = (st, n, cc) => (cityFromText(st, n, cc) || {}).city || null;
  await t('places a station by its listed region', () => { assert.strictEqual(where('Hamburg', 'Synth FM', 'DE'), 'Hamburg'); assert.strictEqual(where('Seattle', 'KEXP', 'US'), 'Seattle'); });
  await t('a state or province name is not a city (Indiana, New York, São Paulo as regions)', () => {
    for (const [st, cc] of [['Indiana', 'US'], ['Kansas', 'US'], ['New York', 'US'], ['Washington', 'US'], ['São Paulo', 'BR'], ['Quebec', 'CA'], ['Victoria', 'AU']]) assert.strictEqual(where(st, 'Radio', cc), null, st);
    assert.strictEqual(where('New York', 'WNYC New York City Jazz', 'US'), 'New York City'); // the name still places it
  });
  await t('places a station by a big city in its name', () => { assert.strictEqual(where('', 'Radio Kraków Muzyka', 'PL'), 'Kraków'); assert.strictEqual(where('', 'Mexico City Synth', 'MX'), 'Mexico City'); });
  await t('does not place stations from ordinary words or other countries', () => {
    for (const [st, n, cc] of [['', 'Paradise FM', 'US'], ['', 'Love Radio', 'PH'], ['Bavaria', 'Radio Bob', 'DE'], ['', 'Radio Lyon', 'DE'], ['', 'Radio Lyon', '']]) assert.strictEqual(where(st, n, cc), null, n);
  });
  // Placing stations without coordinates from every field they have (placeFromFields).
  const { placeFromFields } = require('../lib/geo');
  const CITIES = require('../lib/cities.json');
  const ALIASES = require('../lib/city-aliases');
  const at = (o) => { const r = placeFromFields(o); return r ? `${r.city}|${r.countryCode}|${r.how}` : null; };
  await t('region field: administrative words, "City, Region" forms and exact names', () => {
    assert.strictEqual(at({ state: 'Tokyo Prefecture', countryCode: 'JP' }), 'Tokyo|JP|state');
    assert.strictEqual(at({ state: 'Tokyo-to', countryCode: 'JP' }), 'Tokyo|JP|state');
    assert.strictEqual(at({ state: 'Osaka-fu', countryCode: 'JP' }), 'Osaka|JP|state');
    assert.strictEqual(at({ state: 'Seoul Special City', countryCode: 'KR' }), 'Seoul|KR|state');
    assert.strictEqual(at({ state: 'City of Vienna', countryCode: 'AT' }), 'Vienna|AT|state');
    assert.strictEqual(at({ state: 'Greater London', countryCode: 'GB' }), 'London|GB|state');
    assert.strictEqual(at({ state: 'Metro Manila', countryCode: 'PH' }), 'Manila|PH|state');
    assert.strictEqual(at({ state: 'Comunidad de Madrid', countryCode: 'ES' }), 'Madrid|ES|state');
    assert.strictEqual(at({ state: 'Ciudad de México', countryCode: 'MX' }), 'Mexico City|MX|state');
    assert.strictEqual(at({ state: 'Hamburg, Germany', countryCode: 'DE' }), 'Hamburg|DE|state');
    assert.strictEqual(at({ state: 'Munich, Bavaria', countryCode: 'DE' }), 'Munich|DE|state');
    assert.strictEqual(at({ state: 'ÉSTADO DE SÃO PAULO', countryCode: 'BR' }), 'São Paulo|BR|state'); // accents and capitals don't matter
    assert.strictEqual(at({ state: '東京都', countryCode: 'JP' }), 'Tokyo|JP|state');
    assert.strictEqual(at({ state: '大阪府', countryCode: 'JP' }), 'Osaka|JP|state');
  });
  await t('region field: a region sharing a small town\'s name is not that town', () => {
    assert.strictEqual(at({ state: 'Texas State', countryCode: 'US' }), null); // not Texas City
    assert.strictEqual(at({ state: 'Texas', countryCode: 'US' }), null);
    assert.strictEqual(at({ state: 'Washington State', countryCode: 'US' }), null);
    assert.strictEqual(at({ state: 'Orange County', countryCode: 'US' }), null); // "orange" is an ordinary word
    assert.strictEqual(at({ state: 'Bavaria', countryCode: 'DE' }), null);
    assert.strictEqual(at({ state: 'Japan', countryCode: 'JP' }), null);
  });
  await t('name: aliases and other languages', () => {
    assert.strictEqual(at({ name: 'Radio München Pop', countryCode: 'DE' }), 'Munich|DE|name');
    assert.strictEqual(at({ name: 'Cologne Beats', countryCode: 'DE' }), 'Köln|DE|name');
    assert.strictEqual(at({ name: 'NYC Hot Mix', countryCode: 'US' }), 'New York City|US|name');
    assert.strictEqual(at({ name: 'Joburg Jams', countryCode: 'ZA' }), 'Johannesburg|ZA|name');
    assert.strictEqual(at({ name: 'Radio Bombay Nights', countryCode: 'IN' }), 'Mumbai|IN|name');
    assert.strictEqual(at({ name: 'Радио Москва', countryCode: 'RU' }), 'Moscow|RU|name');
    assert.strictEqual(at({ name: 'Radio Wrocław', countryCode: 'PL' }), 'Wrocław|PL|name'); // ł folds to l on both sides
    assert.strictEqual(at({ name: 'Łódź FM', countryCode: 'PL' }), 'Łódź|PL|name');
  });
  await t('name: Chinese, Japanese and Korean names are found without spaces, and a longer name hides a shorter one', () => {
    assert.strictEqual(at({ name: '東京FM', countryCode: 'JP' }), 'Tokyo|JP|name');
    assert.strictEqual(at({ name: '大阪ジャズ', countryCode: 'JP' }), 'Osaka|JP|name');
    assert.strictEqual(at({ name: '京都ジャズ', countryCode: 'JP' }), 'Kyoto|JP|name');
    assert.strictEqual(at({ name: '東京都ラジオ', countryCode: 'JP' }), 'Tokyo|JP|name'); // 東京都 contains 京都, but it's Tokyo
    assert.strictEqual(at({ name: '서울방송', countryCode: 'KR' }), 'Seoul|KR|name');
    assert.strictEqual(at({ name: '北京音乐台', countryCode: 'CN' }), 'Beijing|CN|name');
    assert.strictEqual(at({ name: '東京FM', countryCode: 'CN' }), null); // 東京 is only an alias in Japan
  });
  await t('tags: a whole tag naming a city of 50,000+', () => {
    assert.strictEqual(at({ tags: 'jazz,hamburg,smooth', countryCode: 'DE' }), 'Hamburg|DE|tags');
    assert.strictEqual(at({ tags: 'rock, São Paulo', countryCode: 'BR' }), 'São Paulo|BR|tags');
    assert.strictEqual(at({ tags: 'Cebu', countryCode: 'PH' }), 'Cebu City|PH|tags');
    assert.strictEqual(at({ tags: ['pop', 'Venezia'], countryCode: 'IT' }), 'Venice|IT|tags'); // Venice is 51,000: fine for a tag
    assert.strictEqual(at({ tags: 'hamburg radio,rock', countryCode: 'DE' }), null); // whole tags only
    assert.strictEqual(at({ tags: 'hamburg', countryCode: 'FR' }), null); // other country
    assert.strictEqual(at({ tags: 'americana,rock', countryCode: 'BR' }), null); // a genre, though also a Brazilian city
    assert.strictEqual(at({ tags: 'jazz,soul,pop', countryCode: 'KR' }), null);
  });
  await t('homepage and stream addresses: city words, joined names, and generic words peeled off', () => {
    assert.strictEqual(at({ homepage: 'https://www.radio-buenosaires.com.ar/', countryCode: 'AR' }), 'Buenos Aires|AR|homepage');
    assert.strictEqual(at({ homepage: 'http://saopaulofm.com.br', countryCode: 'BR' }), 'São Paulo|BR|homepage');
    assert.strictEqual(at({ homepage: 'https://www.rio-de-janeiro-fm.com.br/ao-vivo', countryCode: 'BR' }), 'Rio de Janeiro|BR|homepage');
    assert.strictEqual(at({ homepage: 'https://losangelesfm.com', countryCode: 'US' }), 'Los Angeles|US|homepage');
    assert.strictEqual(at({ homepage: 'https://sanfranciscoradio.net/live', countryCode: 'US' }), 'San Francisco|US|homepage');
    assert.strictEqual(at({ homepage: 'https://radiohamburg.de', countryCode: 'DE' }), 'Hamburg|DE|homepage');
    assert.strictEqual(at({ homepage: 'https://www.hamburgfm.de', countryCode: 'DE' }), 'Hamburg|DE|homepage');
    assert.strictEqual(at({ homepage: 'https://www.dublin-radio.ie', countryCode: 'IE' }), 'Dublin|IE|homepage');
    assert.strictEqual(at({ homepage: 'https://www.muenchen.example.de', countryCode: 'DE' }), 'Munich|DE|homepage');
    assert.strictEqual(at({ homepage: 'https://nyc-radio.example.com', countryCode: 'US' }), 'New York City|US|homepage');
    assert.strictEqual(at({ homepage: 'https://www.radio.example.com/stations/DÜSSELDORF/live', countryCode: 'DE' }), 'Düsseldorf|DE|homepage'); // path words, accents and capitals
    assert.strictEqual(at({ homepage: 'https://www.bonn-radio.example.de', url: 'https://oslo.example.com/rome/lima', countryCode: 'DE' }), null); // words under 5 letters are too short to trust
    assert.strictEqual(at({ url: 'https://stream.hamburg.example.de:8000/live', countryCode: 'DE' }), 'Hamburg|DE|stream');
    assert.strictEqual(at({ url: 'https://s3.radio.co/berlin128/listen', countryCode: 'DE' }), 'Berlin|DE|stream'); // digits split words
    assert.strictEqual(at({ homepage: 'not a url at all', url: '', countryCode: 'DE' }), null);
  });
  await t('priority: state, then name, tags, homepage, stream; the biggest city wins inside one source', () => {
    const all = { state: 'Cologne', name: 'Radio Hamburg', tags: 'munich', homepage: 'https://berlin.de', url: 'https://x.example.com/dresden', countryCode: 'DE' };
    assert.strictEqual(at(all), 'Köln|DE|state');
    assert.strictEqual(at({ ...all, state: '' }), 'Hamburg|DE|name');
    assert.strictEqual(at({ ...all, state: '', name: 'Synth FM' }), 'Munich|DE|tags');
    assert.strictEqual(at({ ...all, state: '', name: 'Synth FM', tags: 'pop' }), 'Berlin|DE|homepage');
    assert.strictEqual(at({ ...all, state: '', name: 'Synth FM', tags: 'pop', homepage: '' }), 'Dresden|DE|stream');
    assert.strictEqual(at({ name: 'Dresden Hamburg Munich Mix', countryCode: 'DE' }), 'Hamburg|DE|name'); // Hamburg is the biggest of the three
  });
  await t('same-country rule: a city in the wrong country, or a small town of that name, never counts', () => {
    assert.strictEqual(at({ homepage: 'https://paris-music.com', countryCode: 'DE' }), null); // Paris is in France
    assert.strictEqual(at({ homepage: 'https://www.paris.fr', countryCode: 'FR' }), 'Paris|FR|homepage');
    assert.strictEqual(at({ homepage: 'https://paris-radio.com', url: 'https://paris.example.com/live', name: 'Radio Paris', tags: 'paris', state: 'Paris', countryCode: 'US' }), 'Paris|US|state'); // only the exact region field may name a small town (Paris, Texas is 25,000)
    assert.strictEqual(at({ homepage: 'https://paris-radio.com', url: 'https://paris.example.com/live', name: 'Radio Paris', tags: 'paris', countryCode: 'US' }), null);
    assert.strictEqual(at({ name: 'Radio Lyon', countryCode: 'DE' }), null);
    assert.strictEqual(at({ name: 'Radio Lyon', countryCode: '' }), null);
    assert.strictEqual(at({ name: 'Radio Lyon' }), null);
    assert.strictEqual(at(), null);
  });
  await t('generic words and everyday words never place a station', () => {
    assert.strictEqual(at({ homepage: 'https://radio-paradise.com', countryCode: 'US' }), null);
    assert.strictEqual(at({ homepage: 'https://nice-fm.fr', url: 'https://nice.example.fr/stream', countryCode: 'FR' }), null); // "nice" is under 5 letters and an everyday word
    assert.strictEqual(at({ homepage: 'https://www.liveradio.ie', countryCode: 'IE' }), null);
    assert.strictEqual(at({ homepage: 'https://live-stream-online.example.com/listen/player', countryCode: 'US' }), null);
    assert.strictEqual(at({ homepage: 'https://www.mobile.example.com', countryCode: 'US' }), null); // Mobile, Alabama
    assert.strictEqual(at({ homepage: 'https://phoenix.example.com', name: 'Phoenix FM', tags: 'phoenix', countryCode: 'US' }), null);
    assert.strictEqual(at({ homepage: 'https://latina.example.es', name: 'Latina FM', tags: 'latina', countryCode: 'ES' }), null);
    assert.strictEqual(at({ homepage: 'https://orange.example.com', name: 'Orange Radio', countryCode: 'US' }), null);
    assert.strictEqual(at({ name: 'Radio Salem Network', countryCode: 'US' }), null);
    assert.strictEqual(at({ name: 'Rádio Natal', countryCode: 'BR' }), null); // Christmas, not Natal
    assert.strictEqual(at({ name: 'Rádio Serra FM', homepage: 'https://radioserra.com.br', countryCode: 'BR' }), null); // mountains
    assert.strictEqual(at({ name: 'Radio Gracia', countryCode: 'ES' }), null); // grace
    assert.strictEqual(at({ name: 'Rádio Vitória', countryCode: 'BR' }), null); // victory
  });
  await t('aliases: every entry points at a real city in its country, and none is useless or an everyday word', () => {
    const seen = new Set();
    for (const [cc, canonical, names] of ALIASES) {
      const real = CITIES.filter((c) => c[0] === canonical && c[3] === cc);
      assert(real.length, `${cc} ${canonical} is not in cities.json`);
      assert(Array.isArray(names) && names.length, `${canonical} has no aliases`);
      const top = real.reduce((a, b) => (b[4] > a[4] ? b : a));
      for (const alias of names) {
        const key = `${cc}|${alias.toLowerCase()}`;
        assert(!seen.has(key), `${alias} is listed twice for ${cc}`); seen.add(key);
        // The alias, written as the region field, finds that city (this also catches aliases that are NOT_PLACES words).
        // (State and province names in federal countries are skipped on purpose: "New York" as a region isn't the city.)
        const got = placeFromFields({ state: alias, countryCode: cc });
        if (got || !require('../lib/geo').isRegionName(alias, cc)) assert(got && got.city === canonical && got.countryCode === cc, `${alias} (${cc}) -> ${got && got.city}, wanted ${canonical}`);
        // A city of 100,000+ is also found by its alias inside a name.
        if (top[4] >= 100000 && alias.replace(/\W/gu, '').length >= 4 || (top[4] >= 100000 && /[぀-ヿ㐀-鿿가-힯฀-๿]/.test(alias))) {
          const byName = placeFromFields({ name: `Radio ${alias} FM`, countryCode: cc });
          assert(byName && byName.city === canonical, `${alias} (${cc}) in a name -> ${byName && byName.city}, wanted ${canonical}`);
        }
      }
    }
    assert(ALIASES.length >= 200, `only ${ALIASES.length} entries`);
  });
  const { translateTags } = require('../lib/translate');
  const tr = (x) => translateTags(splitTags(x));
  await t('foreign tags count as music and match genres', () => {
    assert(isMusicStation(tr('ロック,邦楽'))); assert(matchesGenre(tr('ロック'), resolveGenre('rock')));
    assert(matchesGenre(tr('música electrónica'), resolveGenre('electronic')));
    assert(matchesGenre(tr('アニソン'), resolveGenre(null, 'j-pop')));
    assert(matchesGenre(tr('메탈'), resolveGenre('metal')));
  });
  await t('foreign talk, news, sport and religious stations stay blocked', () => {
    for (const x of ['noticias,música', 'ニュース,音楽', 'новости', 'deportes,futbol', 'música cristiana', '교회,음악']) assert(!isMusicStation(tr(x)), x);
  });
  await t('translation leaves unrelated tags alone', () => { assert(!tr('host,ghost').includes('soundtrack')); assert.deepStrictEqual(tr('house,techno'), ['house', 'techno']); });
  const { isFocused } = require('../lib/vet');
  await t('genre focus: real classic rock stations pass', () => {
    const cr = resolveGenre(null, 'classic rock');
    assert(isFocused(['classic rock', '70s', '80s'], 'Rock Radio', cr));
    assert(isFocused(['70s', '80s', 'hard rock', 'classic rock', 'blues rock'], 'KZ', cr));
    assert(isFocused(['pop', 'classic rock'], 'X', cr));
    assert(isFocused(['hits', 'pop', 'oldies', 'classic rock'], 'Classic Rock 101', cr));
  });
  await t('genre focus: hits and variety stations tagged classic rock are skipped', () => {
    const cr = resolveGenre(null, 'classic rock');
    assert(!isFocused(['pop', '80s', '90s', 'hits', 'top 40', 'dance', 'classic rock', 'oldies'], 'Hit FM', cr));
    assert(!isFocused(['classic rock', 'pop', 'hip-hop', 'jazz', 'country'], 'Mix', cr));
    assert(!isFocused(['hits', 'pop', 'classic rock'], 'Antenne', cr));
    assert(isFocused(['pop', 'hits', 'dance'], 'Anything', null)); // Any genre stays broad
  });
  {
    const { songFits } = require('../lib/songcheck');
    const realFetch = global.fetch;
    const catalog = {
      'Led Zeppelin Kashmir': [{ artistName: 'Led Zeppelin', trackName: 'Kashmir (Remaster)', primaryGenreName: 'Rock', releaseDate: '2014-02-01' }, { artistName: 'Led Zeppelin', trackName: 'Kashmir', primaryGenreName: 'Rock', releaseDate: '1975-02-24' }],
      'Dua Lipa Levitating': [{ artistName: 'Dua Lipa', trackName: 'Levitating', primaryGenreName: 'Pop', releaseDate: '2020-03-27' }],
      'Arctic Monkeys Do I Wanna Know?': [{ artistName: 'Arctic Monkeys', trackName: 'Do I Wanna Know?', primaryGenreName: 'Alternative', releaseDate: '2013-06-19' }],
      'Burna Boy Last Last': [{ artistName: 'Burna Boy', trackName: 'Last Last', primaryGenreName: 'Afrobeats', releaseDate: '2022-05-13' }],
    };
    global.fetch = async (u) => {
      const term = new URL(u).searchParams.get('term');
      if (term.startsWith('Down')) throw new Error('offline');
      return { ok: true, json: async () => ({ results: catalog[term] || [] }) };
    };
    const cr = resolveGenre(null, 'classic rock'), rock = resolveGenre('rock'), pop = resolveGenre('pop');
    await t('song check: classic rock song fits classic rock (original year, not the remaster)', async () => assert.strictEqual(await songFits('Led Zeppelin - Kashmir', cr), true));
    await t('song check: pop song on a classic rock pick is rejected', async () => assert.strictEqual(await songFits('Dua Lipa - Levitating', cr), false));
    await t('song check: 2013 rock fits Rock but not Classic Rock', async () => {
      assert.strictEqual(await songFits('Arctic Monkeys - Do I Wanna Know?', rock), true);
      assert.strictEqual(await songFits('Arctic Monkeys - Do I Wanna Know?', cr), false);
    });
    await t('song check: several genres picked, fitting one is enough', async () => assert.strictEqual(await songFits('Dua Lipa - Levitating', resolveGenres('rock,pop')), true));
    await t('song check: unknown songs, failed lookups and broad genres never reject', async () => {
      assert.strictEqual(await songFits('Nobody Known - Nothing', cr), null);
      assert.strictEqual(await songFits('Down Service - Song', cr), null);
      assert.strictEqual(await songFits('Burna Boy - Last Last', resolveGenre('world')), null);
      assert.strictEqual(await songFits('Station jingle', pop), null);
    });
    global.fetch = realFetch;
  }
  {
    const { noteSong, localWeight, pickLocal } = require('../lib/artistcheck');
    const realFetch = global.fetch;
    const mb = { 'the pillows': 'JP', 'led zeppelin': 'GB', 'blankey jet city': 'JP' };
    global.fetch = async (u) => {
      const name = /artist:"([^"]+)"/.exec(decodeURIComponent(new URL(u).searchParams.get('query')))[1];
      return { ok: true, json: async () => ({ artists: mb[name] ? [{ name, score: 100, country: mb[name] }] : [] }) };
    };
    await t('local artists: a Japanese band on a Tokyo station counts as local, a British one doesn\'t', async () => {
      assert.strictEqual(await noteSong('st-local', 'JP', 'the pillows - Funny Bunny'), true);
      assert.strictEqual(await noteSong('st-mixed', 'JP', 'Led Zeppelin - Kashmir'), false);
      assert.strictEqual(await noteSong('st-mixed', 'JP', 'Blankey Jet City - Akai Tambourine'), true);
      assert.strictEqual(await noteSong('st-x', 'JP', 'Unknown Band - Song'), null);
    });
    await t('local artists: picks lean local but mixed and unknown stations still come up', () => {
      assert(localWeight('st-local') > localWeight('st-mixed'));
      assert(localWeight('st-mixed') > 1);
      const n = { 'st-local': 0, 'st-mixed': 0, 'st-new': 0 };
      for (let i = 0; i < 3000; i++) n[pickLocal([{ uuid: 'st-local' }, { uuid: 'st-mixed' }, { uuid: 'st-new' }]).uuid]++;
      assert(n['st-local'] > n['st-mixed'] && n['st-mixed'] > 300 && n['st-new'] > 300, JSON.stringify(n));
    });
    global.fetch = realFetch;
  }
  await t('genre words: styles in many languages match, and the longest word wins', () => {
    const { translateTags } = require('../lib/translate');
    const m = (tag, main, style) => matchesGenre(translateTags(splitTags(tag)), resolveGenre(main || null, style));
    assert(m('クラシックロック', null, 'classic rock')); assert(!m('クラシックロック', 'classical'));
    assert(m('классический рок', null, 'classic rock')); assert(!m('классический рок', 'classical'));
    assert(m('ヘヴィメタル', null, 'heavy metal')); assert(m('rock progresivo', null, 'progressive rock'));
    assert(m('anos 80', null, '80s')); assert(m('liedermacher', null, 'singer-songwriter'));
    assert(!m('サイケデリックトランス', null, 'psychedelic rock')); assert(m('サイケデリックトランス', null, 'psytrance'));
    assert(m('música mexicana', 'latin')); assert(m('ボサノヴァ', 'jazz')); assert(m('sertanejo', 'country'));
    assert(!m('スカイ', null, 'ska')); assert(!m('dansk', 'electronic'));
  });
  await t('genre words: country searches use the local language', () => {
    const { nativeWords } = require('../lib/genre-words');
    assert.strictEqual(nativeWords('psychedelic rock', 'JP')[0], 'サイケ');
    assert.strictEqual(nativeWords('heavy metal', 'RU')[0], 'хэви-метал');
    assert.strictEqual(nativeWords('rock', 'JP')[0], 'ロック');
    assert.deepStrictEqual(nativeWords('jazz', 'GB'), []);
  });
  await t('review alert emails once when reports waiting go over 3', () => {
    const { crossedLine } = require('../lib/notify');
    assert(!crossedLine(2, 3)); assert(crossedLine(3, 4)); assert(crossedLine(2, 5));
    assert(!crossedLine(4, 5)); assert(!crossedLine(9, 10));
  });
  await t('music station passes', () => assert(isMusicStation(splitTags('house,techno,dance'))));
  await t('talk station rejected', () => assert(!isMusicStation(splitTags('news,talk,pop'))));
  await t('sports rejected', () => assert(!isMusicStation(splitTags('sports,rock'))));
  await t('untagged rejected', () => assert(!isMusicStation(splitTags(''))));
  await t('no music tag rejected', () => assert(!isMusicStation(splitTags('community,local'))));
  await t('styles match their other names', () => {
    const sw = resolveGenre(null, 'synthwave');
    assert(matchesGenre(splitTags('retrowave,80s'), sw) && matchesGenre(splitTags('outrun'), sw));
    assert(matchesGenre(splitTags('dnb'), resolveGenre(null, 'drum and bass')));
    assert(!matchesGenre(splitTags('classic rock'), sw));
  });
  await t('station-count styles match the app genre list', () => {
    const fs = require('fs');
    const app = fs.readFileSync(require('path').join(__dirname, '../public/app.js'), 'utf8');
    const api = fs.readFileSync(require('path').join(__dirname, '../lib/config.js'), 'utf8');
    const appList = Object.fromEntries([...app.matchAll(/\{ id: '(\w+)', label: '[^']*', subs: \[([^\]]*)\] \}/g)].map((m) => [m[1], m[2]]));
    const apiList = Object.fromEntries([...api.split('const STYLES = {')[1].split('};')[0].matchAll(/ {2}(\w+): \[([^\]]*)\],/g)].map((m) => [m[1], m[2]]));
    assert.deepStrictEqual(Object.keys(apiList).sort(), Object.keys(appList).sort());
    for (const k of Object.keys(appList)) assert.strictEqual(apiList[k], appList[k], k);
  });
  await t('metal is its own genre', () => { const m = resolveGenre('metal'); assert(m && matchesGenre(splitTags('doom metal,stoner'), m)); assert(!matchesGenre(splitTags('classic rock'), m)); });
  await t('sub-genre tags pass the music check', () => assert(isMusicStation(splitTags('black metal'))));
  await t('genre match', () => assert(matchesGenre(splitTags('deep house,lounge'), resolveGenre('electronic'))));
  await t('genre mismatch', () => assert(!matchesGenre(splitTags('jazz'), resolveGenre('rock'))));
  await t('sub-genre tag resolves', () => assert.deepStrictEqual(resolveGenre(null, 'Deep  House').tags, ['deep house', 'deephouse']));
  await t('bad tag ignored', () => assert.strictEqual(resolveGenre(null, '<script>'), null));
  await t('sub-genre match', () => assert(matchesGenre(splitTags('shoegaze,dream pop'), resolveGenre(null, 'shoegaze'))));
  await t('niche tag counts as music when requested', () => {
    assert(!isMusicStation(splitTags('shoegaze')));
    assert(isMusicStation(splitTags('shoegaze'), ['shoegaze']));
  });
  await t('several genres combine', () => {
    const s = resolveGenres('jazz,tag:deep house,jazz,nonsense');
    assert.strictEqual(s.parts.length, 2);
    assert(matchesGenre(splitTags('deep house'), s) && matchesGenre(splitTags('bebop,jazz'), s));
    assert(!matchesGenre(splitTags('metal'), s));
  });
  await t('one genre in the list stays simple', () => assert.strictEqual(resolveGenres('rock').key, 'rock'));
  await t('empty list means any', () => assert.strictEqual(resolveGenres(''), null));
  await t('at most five genres', () => assert.strictEqual(resolveGenres('rock,pop,jazz,latin,world,classical').parts.length, 5));
  await t('same genres, same pool key', () => assert.strictEqual(resolveGenres('rock,jazz').key, resolveGenres('jazz,rock').key));
  await t('talk still blocked with a requested tag', () => assert(!isMusicStation(splitTags('shoegaze,talk'), ['shoegaze'])));

  console.log('Song titles');
  await t('artist - title ok', () => assert(looksLikeSong('Daft Punk - Around the World', 'Radio X')));
  await t('Japanese title formats ok', () => {
    for (const x of ['夜に駆ける / YOASOBI', '米津玄師「Lemon」', 'あいみょん／マリーゴールド', 'Perfume - ポリリズム']) assert(looksLikeSong(x, 'FM'), x);
  });
  await t('slogans still rejected', () => { assert(!looksLikeSong('Rock / Pop / Dance', 'FM')); assert(!looksLikeSong('東京ラジオ', 'FM')); });
  await t('Shift-JIS titles decode as Japanese', () => {
    const { decodeMeta } = require('../lib/icy');
    const sj = Buffer.from([0x83,0x8c,0x83,0x82,0x83,0x93,0x20,0x2f,0x20,0x95,0xc4,0x92,0xc3,0x8c,0xba,0x8e,0x74]); // レモン / 米津玄師
    assert.strictEqual(decodeMeta(sj), 'レモン / 米津玄師');
    assert.strictEqual(decodeMeta(Buffer.from('Björk - Jóga', 'latin1')), 'Björk - Jóga');
  });
  await t('en dash ok', () => assert(looksLikeSong('Björk – Hyperballad', 'FM')));
  await t('station name rejected', () => assert(!looksLikeSong('Radio X', 'Radio X')));
  await t('slogan without separator rejected', () => assert(!looksLikeSong('The best hits all day', 'Hits FM')));
  await t('ad marker rejected', () => assert(!looksLikeSong('Advert - Break', 'Hits FM')));
  await t('empty rejected', () => assert(!looksLikeSong('', 'Hits FM')));

  console.log('Safety');
  await t('private IPs blocked', () => ['10.0.0.1', '127.0.0.1', '192.168.1.5', '172.20.0.1', '169.254.1.1', '::1', 'fd00::1'].forEach((ip) => assert(isPrivateIp(ip), ip)));
  await t('public IP allowed', () => assert(!isPrivateIp('8.8.8.8')));

  console.log('Stream probes');
  const server = http.createServer((req, res) => {
    const want = req.headers['icy-metadata'] === '1';
    if (req.url === '/song') {
      res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'icy-metaint': want ? '8192' : undefined, 'icy-br': '128', 'Access-Control-Allow-Origin': '*' });
      return res.end(want ? icyBody(8192, "Daft Punk - Around the World") : Buffer.alloc(9000));
    }
    if (req.url === '/latin1') {
      res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'icy-metaint': '1000' });
      const meta = Buffer.from("StreamTitle='Sigur Rós - Hoppípolla';", 'latin1');
      const len = Math.ceil(meta.length / 16); const block = Buffer.alloc(len * 16); meta.copy(block);
      return res.end(Buffer.concat([Buffer.alloc(1000), Buffer.from([len]), block]));
    }
    if (req.url === '/nometa') { res.writeHead(200, { 'Content-Type': 'audio/aac' }); return res.end(Buffer.alloc(5000)); }
    if (req.url === '/redirect') { res.writeHead(302, { Location: '/song' }); return res.end(); }
    if (req.url === '/html') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end('<html>'); }
    if (req.url === '/slow') { setTimeout(() => { res.writeHead(200, { 'Content-Type': 'audio/mpeg' }); res.end(Buffer.alloc(10)); }, 6000); return; }
    res.writeHead(404); res.end();
  }).listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;

  // Old SHOUTcast servers answer with "ICY 200 OK" instead of an HTTP status line.
  const icy = net.createServer((sock) => {
    sock.once('data', () => {
      sock.write('ICY 200 OK\r\ncontent-type: audio/mpeg\r\nicy-metaint: 4096\r\nicy-br: 96\r\n\r\n');
      sock.end(icyBody(4096, 'Massive Attack - Teardrop'));
    });
  }).listen(0);
  const icyBase = `http://127.0.0.1:${icy.address().port}`;

  await t('reads StreamTitle', async () => {
    const p = await probeStream(`${base}/song`);
    assert.strictEqual(p.ok, true); assert.strictEqual(p.title, 'Daft Punk - Around the World');
    assert.strictEqual(p.cors, true); assert.strictEqual(p.bitrate, 128);
  });
  await t('decodes Latin-1 titles', async () => assert.strictEqual((await probeStream(`${base}/latin1`)).title, 'Sigur Rós - Hoppípolla'));
  await t('no metadata gives null title', async () => { const p = await probeStream(`${base}/nometa`); assert(p.ok); assert.strictEqual(p.title, null); });
  await t('follows redirects', async () => assert.strictEqual((await probeStream(`${base}/redirect`)).title, 'Daft Punk - Around the World'));
  await t('rejects HTML pages', async () => assert(!(await probeStream(`${base}/html`)).ok));
  await t('rejects slow streams (4s)', async () => { const p = await probeStream(`${base}/slow`); assert(!p.ok); assert.strictEqual(p.reason, 'slow'); });
  await t('handles "ICY 200 OK" servers', async () => {
    const p = await probeStream(icyBase);
    assert(p.ok, p.reason); assert.strictEqual(p.title, 'Massive Attack - Teardrop');
  });
  await t('blocks private hosts in production mode', async () => {
    process.env.SW_ALLOW_PRIVATE = '0';
    const p = await probeStream(`${base}/song`);
    process.env.SW_ALLOW_PRIVATE = '1';
    assert(!p.ok);
  });

  server.close(); icy.close();
  console.log(failures ? `\n${failures} failed` : '\nAll tests passed');
  process.exit(failures ? 1 : 0);
})();
