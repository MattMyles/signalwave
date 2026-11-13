// Translation layer for station tags. The directory's tags are written by
// stations in their own language (ロック, música electrónica, новости), but
// genre matching, the music check and the talk blocklist all use English.
// translateTags() keeps every original tag and adds the English words for any
// foreign ones it recognises. Offline and instant: just a word list.
//
// Keys are lower case and match anywhere inside a tag, so keep Latin-script
// keys long enough not to hide inside unrelated words.
const DICT = {
  // "music": lets stations tagged only in their own language pass the music check
  music: ['música', 'musica', 'musique', 'musik', 'muziek', 'muzyka', 'muzika', 'музыка', 'музика', 'müzik', 'zene', 'hudba', 'glazba', 'μουσική',
    '音楽', '音樂', '音乐', '음악', 'موسيقى', 'מוזיקה', 'संगीत', 'เพลง', 'nhạc', 'lagu'],
  hits: ['éxitos', 'exitos', 'sucessos', 'succès', 'successi', 'przeboje', 'хиты', 'ヒット', '热门', '히트'],
  oldies: ['clásicos', 'antigos', 'oldies', 'ретро', '懐メロ', '老歌', '추억'],

  // blocklist words: talk, news and sport stations stay out in every language
  news: ['noticias', 'notícias', 'nachrichten', 'actualités', 'nieuws', 'notizie', 'wiadomości', 'новости', 'новини', 'haberler', 'haber ', 'zprávy',
    'ニュース', '新闻', '新聞', '뉴스', 'أخبار', 'חדשות', 'समाचार', 'ข่าว', 'tin tức', 'berita', 'periodismo', 'jornalismo', 'informativ'],
  talk: ['hablada', 'entrevista', 'tertulia', 'gesprek', 'разговор', 'トーク', '谈话', '談話', '토크'],
  sport: ['deportes', 'deportiva', 'esportes', 'esportiva', 'sportif', 'sportowe', 'спорт', 'spor ', 'スポーツ', '体育', '體育', '스포츠', 'رياضة', 'futbol', 'fútbol', 'futebol'],
  religion: ['religios', 'religiös', 'religieu', 'religij', 'cristiana', 'cristã', 'chrétien', 'christlich', 'katolick', 'evangélic', 'evangelic', 'iglesia', 'igreja', 'église', 'kirche',
    'православ', 'церков', 'キリスト', '宗教', '佛教', '基督', '교회', '기독', '불교', 'دين', 'قرآن', 'إسلام', 'भजन'],

  // genres
  pop: ['ポップ', '流行', '팝', 'поп-музыка', 'попса'],
  jpop: ['邦楽', 'ジェイポップ', 'jポップ', 'j-ポップ'],
  anison: ['アニソン', 'アニメ', '動漫', '动漫'],
  enka: ['演歌'],
  kpop: ['케이팝', '가요'],
  rock: ['ロック', '摇滚', '搖滾', '록', 'рок-музыка', 'рок ', 'rock nacional'],
  metal: ['メタル', '重金属', '重金屬', '메탈', 'метал'],
  punk: ['パンク', '朋克', '펑크', 'панк'],
  jazz: ['ジャズ', '爵士', '재즈', 'джаз', 'jazzowe'],
  blues: ['ブルース', '蓝调', '藍調', '블루스', 'блюз'],
  classical: ['クラシック', '古典音乐', '古典音樂', '클래식', 'классическ', 'классика', 'clásica', 'clasica', 'clássica', 'classica', 'classique', 'klassik', 'klassiek', 'klasyczn', 'klasik', 'klasszikus', 'κλασική'],
  electronic: ['electrónica', 'electronica', 'eletrônica', 'eletronica', 'électronique', 'elettronica', 'elektronisch', 'elektronik', 'elektroniczn', 'электрон', 'エレクトロ', '电子', '電子', '일렉트로닉', 'إلكترون'],
  dance: ['ダンス', '舞曲', '댄스', 'танцев', 'bailable', 'tanzmusik', 'taneczn'],
  'hip-hop': ['ヒップホップ', '嘻哈', '힙합', 'хип-хоп', 'хипхоп', 'rap nacional'],
  soul: ['ソウル', '灵魂乐', '소울', 'соул'],
  rnb: ['알앤비', 'アールアンドビー'],
  reggae: ['レゲエ', '雷鬼', '레게', 'регги'],
  country: ['カントリー', '乡村音乐', '鄉村音樂', '컨트리', 'кантри'],
  folk: ['フォーク', '民谣', '民謠', '포크', 'фолк', 'folclore', 'folklore', 'volksmusik', 'volksmuziek', 'ludow', 'народн', 'halk müzi'],
  ambient: ['アンビエント', '环境音乐', '앰비언트', 'эмбиент'],
  chillout: ['チル', 'relajante', 'entspannung', 'relaksac', 'релакс', '轻音乐', '輕音樂'],
  lounge: ['ラウンジ', '라운지'],
  soundtrack: ['サウンドトラック', 'サントラ', '原声', '原聲', ' ost ', '사운드트랙', 'саундтрек', 'bandas sonoras', 'trilha sonora'],
  'world music': ['民族音楽', '世界音乐', 'músicas del mundo', 'musiques du monde', 'weltmusik'],
  'psychedelic rock': ['サイケ', '迷幻', '사이키델릭', 'психодел', 'psicodéli', 'psicodeli', 'psychédéli', 'psychedelisch', 'psykedeli'],
  techno: ['テクノ', '테크노', 'техно'],
  house: ['ハウス', '하우스'],
  trance: ['トランス', '트랜스', 'транс '],
  latin: ['ラテン', '拉丁', '라틴', 'латин'],
  chanson: ['шансон', 'シャンソン'],
  instrumental: ['インスト', '纯音乐', '純音樂', '연주곡', 'инструментал'],
};

const LOOKUP = Object.entries(DICT).flatMap(([en, words]) => words.map((w) => [w, en]));

/** tags (already lower case) → the same tags plus English equivalents. */
function translateTags(tags) {
  const out = [...tags];
  for (const t of tags) {
    const padded = ` ${t} `;
    for (const [w, en] of LOOKUP) if (padded.includes(w) && !out.includes(en)) out.push(en);
  }
  return out;
}

module.exports = { translateTags, DICT };
