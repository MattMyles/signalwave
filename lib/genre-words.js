// Genre and style names in other languages, by language code. Used two ways:
//  1. Matching (lib/translate.js): a station tagged ヘヴィメタル counts as heavy metal.
//  2. Searching (lib/vet.js): when searching a country, the server also searches
//     the directory in that country's language (COUNTRY_LANG), so stations
//     tagged only in their own language are found at all.
// Keys are the English genre/style tags the app uses (GENRES / STYLES in
// lib/config.js). Words match anywhere inside a tag, so short words are
// padded with spaces (' ダブ ') to match only a whole tag. When several words
// match one tag, the longest wins (クラシックロック is classic rock, not
// classical), so specific styles can safely contain general words.
const W = {
  // ---------- Electronic ----------
  electronic: {
    ja: ['エレクトロニカ', '電子音楽'], ko: ['일렉트로닉', '전자음악'], zh: ['电子音乐', '電子音樂'],
    ru: ['электронн'], uk: ['електронн'], bg: ['електронн'], sr: ['електронск', 'elektronsk'], el: ['ηλεκτρονικ'],
    he: ['אלקטרונ'], ar: ['إلكترون', 'الكترون'], fa: ['الکترونیک'], hi: ['इलेक्ट्रॉनिक'], th: ['อิเล็กทรอนิกส์'],
    tr: ['elektronik'], pl: ['elektroniczn'], cs: ['elektronick'], hu: ['elektronikus'],
    es: ['electrónica', 'electronica'], pt: ['eletrônica', 'eletronica', 'electrónica'], fr: ['électronique', 'electronique'],
    de: ['elektronisch'], it: ['elettronica'], nl: ['elektronisch'], sv: ['elektronisk'], fi: ['elektroninen'],
    id: ['musik elektronik'], vi: ['nhạc điện tử'],
  },
  dance: {
    ja: ['ダンスミュージック', 'ダンス'], ko: ['댄스'], zh: ['舞曲'], ru: ['танцевальн'], uk: ['танцювальн'],
    el: ['χορευτικ'], he: ['דאנס'], tr: ['dans müzi'], pl: ['taneczn'], cs: ['taneční'], hu: ['tánczene'],
    es: ['bailable', 'música de baile', 'musica de baile'], pt: ['dançante', 'música de dança'], fr: ['dansante'],
    de: ['tanzmusik'], it: ['musica da ballo'], nl: ['dansmuziek'],
  },
  house: { ja: ['ハウス'], ko: ['하우스'], zh: ['浩室'], ru: ['хаус'], uk: ['хаус'], he: ['האוס'], th: ['เฮาส์'] },
  'deep house': { ja: ['ディープハウス'], ko: ['딥하우스'], ru: ['дип-хаус', 'дип хаус'] },
  'tech house': { ja: ['テックハウス'], ru: ['тек-хаус'] },
  techno: { ja: ['テクノ'], ko: ['테크노'], zh: ['铁克诺', '科技舞曲'], ru: ['техно'], uk: ['техно'], bg: ['техно'], el: ['τέκνο'], he: ['טכנו'], ar: ['تكنو'], th: ['เทคโน'] },
  minimal: { ja: ['ミニマル'], ko: ['미니멀'], ru: ['минимал'] },
  trance: { ja: ['トランス'], ko: ['트랜스'], zh: ['出神音乐'], ru: ['транс '], uk: ['транс '], he: ['טראנס'] },
  psytrance: { ja: ['サイケデリックトランス', 'ゴアトランス', 'サイトランス'], ru: ['пситранс', 'психоделический транс', ' гоа '], he: ['פסיכדלי'] },
  'drum and bass': { ja: ['ドラムンベース'], ko: ['드럼앤베이스'], zh: ['鼓打贝斯', '鼓打貝斯'], ru: ['драм-н-бейс', 'драмэндбейс', 'драм н бейс'] },
  jungle: { ja: ['ジャングル'], ru: ['джангл'] },
  dubstep: { ja: ['ダブステップ'], ko: ['덥스텝'], ru: ['дабстеп'] },
  'uk garage': { ja: ['ukガラージ', 'ukガレージ'], ru: ['uk гэридж', 'гэридж'] },
  breakbeat: { ja: ['ブレイクビーツ'], ru: ['брейкбит'] },
  synthwave: { ja: ['シンセウェイブ'], ko: ['신스웨이브'], ru: ['синтвейв'] },
  hardstyle: { ja: ['ハードスタイル'], ru: ['хардстайл'] },

  // ---------- Rock ----------
  rock: {
    el: ['ροκ'], he: ['רוק'], ar: ['روك'], fa: ['راک'], th: ['ร็อก', 'ร็อค'], hi: ['रॉक'], uk: ['рок '], bg: ['рок '], sr: ['рок '],
  },
  alternative: {
    ja: ['オルタナティヴ', 'オルタナティブ', 'オルタナ'], ko: ['얼터너티브'], zh: ['另类', '另類'], ru: ['альтернатив'], uk: ['альтернатив'],
    el: ['εναλλακτικ'], he: ['אלטרנטיב'], tr: ['alternatif'], pl: ['alternatywn'],
    es: ['alternativo', 'alternativa'], pt: ['alternativo'], fr: ['alternatif'], it: ['alternativo'], de: ['alternativ '],
  },
  indie: { ja: ['インディーズ', 'インディー'], ko: ['인디'], zh: ['独立音乐', '獨立音樂'], ru: ['инди'], uk: ['інді'], he: ['אינדי'], th: ['อินดี้'] },
  'indie rock': { ja: ['インディーロック'], ru: ['инди-рок'], ko: ['인디 록', '인디록'] },
  'classic rock': {
    ja: ['クラシックロック'], ko: ['클래식 록', '클래식록'], ru: ['классический рок', 'классика рока'], uk: ['класичний рок'],
    tr: ['klasik rock'], pl: ['klasyczny rock', 'klasyka rocka'], es: ['rock clásico', 'rock clasico'], pt: ['rock clássico', 'rock classico'],
    fr: ['rock classique'], de: ['klassischer rock', 'oldie rock'], it: ['rock classico'], nl: ['klassieke rock'],
  },
  'hard rock': { ja: ['ハードロック'], ko: ['하드록', '하드 록'], zh: ['硬摇滚', '硬搖滾'], ru: ['хард-рок', 'хард рок'], es: ['rock duro'], pt: ['rock pesado'], tr: ['sert rock'] },
  grunge: { ja: ['グランジ'], ko: ['그런지'], ru: ['гранж'] },
  'progressive rock': {
    ja: ['プログレッシブロック', 'プログレッシヴロック', 'プログレ'], ko: ['프로그레시브 록'], zh: ['前卫摇滚', '前衛搖滾'],
    ru: ['прогрессив-рок', 'прогрессивный рок', 'прог-рок'], es: ['rock progresivo'], pt: ['rock progressivo'], fr: ['rock progressif'],
    it: ['rock progressivo'], pl: ['rock progresywny'], tr: ['progresif rock'], de: ['progrock'],
  },
  'psychedelic rock': {
    ja: ['サイケ', 'サイケデリックロック'], ko: ['사이키델릭'], zh: ['迷幻摇滚', '迷幻搖滾', '迷幻'], ru: ['психоделический рок', 'психодел'],
    es: ['psicodélic', 'psicodelic', 'psicodelia'], pt: ['psicodéli', 'psicodeli'], fr: ['psychédéli', 'psychedeli'], de: ['psychedelisch'],
    tr: ['psikedelik'], pl: ['psychodeliczn'], it: ['psichedelic'], sv: ['psykedeli'],
  },
  'garage rock': { ja: ['ガレージロック'], ru: ['гаражный рок', 'гараж-рок'], es: ['rock de garaje'], pt: ['rock de garagem'] },
  britpop: { ja: ['ブリットポップ'], ru: ['брит-поп', 'бритпоп'] },
  'post-rock': { ja: ['ポストロック'], ko: ['포스트 록', '포스트록'], zh: ['后摇', '後搖'], ru: ['пост-рок'] },
  shoegaze: { ja: ['シューゲイザー', 'シューゲイズ'], ko: ['슈게이징', '슈게이즈'], zh: ['自赏', '自賞'], ru: ['шугейз'] },
  'stoner rock': { ja: ['ストーナー'], ru: ['стоунер'] },

  // ---------- Metal ----------
  metal: { el: ['μέταλ'], he: ['מטאל'], ar: ['ميتال'], fa: ['متال'], th: ['เมทัล'], uk: ['метал'], bg: ['метъл'] },
  'heavy metal': {
    ja: ['ヘヴィメタル', 'ヘビーメタル', 'ヘヴィ・メタル'], ko: ['헤비메탈', '헤비 메탈'], ru: ['хэви-метал', 'хеви-метал', 'хэви метал'],
    uk: ['хеві-метал'], es: ['metal pesado'], pt: ['metal pesado'], tr: ['ağır metal'],
  },
  'thrash metal': { ja: ['スラッシュメタル'], ko: ['스래시 메탈'], ru: ['трэш-метал', 'трэш метал'] },
  'death metal': { ja: ['デスメタル'], ko: ['데스 메탈', '데스메탈'], ru: ['дэт-метал', 'дэт метал'] },
  'black metal': { ja: ['ブラックメタル'], ko: ['블랙 메탈', '블랙메탈'], ru: ['блэк-метал', 'блэк метал'] },
  'doom metal': { ja: ['ドゥームメタル', 'ドゥーム'], ru: ['дум-метал', 'дум метал'] },
  'power metal': { ja: ['パワーメタル'], ru: ['пауэр-метал'] },
  'progressive metal': { ja: ['プログレッシブメタル', 'プログレメタル'], ru: ['прогрессив-метал'] },
  'symphonic metal': { ja: ['シンフォニックメタル'], ru: ['симфо-метал', 'симфоник-метал'] },
  metalcore: { ja: ['メタルコア'], ko: ['메탈코어'], ru: ['металкор'] },
  'nu metal': { ja: ['ニューメタル', 'ニュー・メタル'], ru: ['ню-метал'] },
  'industrial metal': { ja: ['インダストリアル'], ru: ['индастриал'] },
  'folk metal': { ja: ['フォークメタル'], ru: ['фолк-метал'] },

  // ---------- Punk ----------
  'punk rock': { ja: ['パンクロック'], ru: ['панк-рок'], ko: ['펑크 록'] },
  'pop punk': { ja: ['ポップパンク'], ru: ['поп-панк'] },
  hardcore: { ja: ['ハードコア'], ko: ['하드코어'], ru: ['хардкор'] },
  'post-punk': { ja: ['ポストパンク'], ru: ['пост-панк'] },
  'ska punk': { ja: ['スカパンク'], ru: ['ска-панк'] },
  emo: { ja: [' エモ '], ru: [' эмо ', 'эмо-кор', 'эмокор'] },

  // ---------- Pop ----------
  pop: { uk: ['поп '], ru: ['поп '], bg: ['поп '], el: ['ποπ'], he: ['פופ'], ar: ['بوب'], fa: ['پاپ'], th: ['ป๊อป', 'ป็อป'], hi: ['पॉप'] },
  'top 40': { ja: ['ヒットチャート'], es: ['los 40'] },
  'dance pop': { ja: ['ダンスポップ'], ru: ['данс-поп'] },
  synthpop: { ja: ['シンセポップ'], ko: ['신스팝'], ru: ['синти-поп', 'синтипоп'] },
  'indie pop': { ja: ['インディーポップ'], ru: ['инди-поп'] },
  'dream pop': { ja: ['ドリームポップ'], ru: ['дрим-поп'] },
  'k-pop': { zh: ['韩流', '韓流', '韩国流行'], ru: ['кей-поп', 'k-поп'], ja: ['韓国ポップ'] },
  'j-pop': { zh: ['日本流行'], ko: ['제이팝'] },
  'city pop': { ja: ['シティポップ', 'シティ・ポップ'], ko: ['시티팝'] },
  '80s': {
    ja: ['80年代'], zh: ['80年代'], ru: ['80-х', '80-е'], uk: ['80-х'], es: ['años 80', 'anos 80', 'ochenta'], pt: ['anos 80'],
    fr: ['années 80', 'annees 80'], de: ['80er'], it: ['anni 80'], pl: ['lata 80'], nl: ['jaren 80'], tr: ['80ler'], cs: ['80. léta'],
  },
  '90s': {
    ja: ['90年代'], zh: ['90年代'], ru: ['90-х', '90-е'], uk: ['90-х'], es: ['años 90', 'noventa'], pt: ['anos 90'],
    fr: ['années 90', 'annees 90'], de: ['90er'], it: ['anni 90'], pl: ['lata 90'], nl: ['jaren 90'], tr: ['90lar'], cs: ['90. léta'],
  },
  '00s': { ja: ['00年代', '2000年代'], ru: ['нулевые', '2000-х'], es: ['años 2000'], pt: ['anos 2000'], fr: ['années 2000'], de: ['2000er'], it: ['anni 2000'] },

  // ---------- Hip-hop ----------
  'hip-hop': { uk: ['хіп-хоп'], el: ['χιπ χοπ'], he: ['היפ הופ'], ar: ['هيب هوب'], fa: ['هیپ هاپ'], th: ['ฮิปฮอป'], hi: ['हिप हॉप'] },
  rap: { ja: ['ラップ'], ko: [' 랩 '], zh: ['说唱', '說唱'], ru: ['рэп'], uk: [' реп '], ar: ['راب'], he: ['ראפ'], fa: [' رپ '], th: ['แร็พ'] },
  trap: { ja: ['トラップ'], ko: ['트랩'], ru: ['трэп'] },
  'boom bap': { ja: ['ブーンバップ'], ru: ['бум-бэп'] },
  'old school hip-hop': { ru: ['олдскул'], ja: ['オールドスクール'] },
  drill: { ja: ['ドリル'], ru: ['дрилл'] },
  grime: { ja: ['グライム'], ru: ['грайм'] },
  'lofi hip hop': { ja: ['ローファイヒップホップ'], ko: ['로파이 힙합'] },

  // ---------- R&B & Soul ----------
  rnb: { zh: ['节奏布鲁斯', '節奏藍調'], ru: ['ритм-н-блюз', 'ар-н-би'], ja: ['リズム・アンド・ブルース'] },
  'neo soul': { ja: ['ネオソウル'], ru: ['нео-соул'] },
  funk: { ja: ['ファンク'], zh: ['放克'], ru: ['фанк'] },
  disco: { ja: ['ディスコ'], ko: ['디스코'], zh: ['迪斯科', '的士高'], ru: ['диско'], el: ['ντίσκο'], he: ['דיסקו'] },
  gospel: { ja: ['ゴスペル'], ru: ['госпел'] },

  // ---------- Jazz ----------
  jazz: { el: ['τζαζ'], he: ["ג'אז", 'גאז'], ar: ['جاز'], fa: ['جاز'], th: ['แจ๊ส'], hi: ['जैज़'], uk: ['джаз'] },
  'smooth jazz': { ja: ['スムースジャズ', 'スムーズジャズ'], ru: ['смус-джаз', 'смуф-джаз'] },
  bebop: { ja: ['ビバップ'], ru: ['бибоп'] },
  swing: { ja: ['スウィング', 'スイング'], ru: ['свинг'] },
  'big band': { ja: ['ビッグバンド'], ru: ['биг-бэнд'], de: ['bigband'] },
  'cool jazz': { ja: ['クールジャズ'], ru: ['кул-джаз'] },
  'jazz fusion': { ja: ['フュージョン'], zh: ['融合爵士'], ru: ['фьюжн'] },
  'acid jazz': { ja: ['アシッドジャズ'], ru: ['эйсид-джаз'] },
  'latin jazz': { ja: ['ラテンジャズ'], es: ['jazz latino'], pt: ['jazz latino'] },
  'bossa nova': { ja: ['ボサノヴァ', 'ボサノバ'], zh: ['巴萨诺瓦'], ru: ['босса-нова'] },
  'nu jazz': { ja: ['ニュージャズ'] },

  // ---------- Blues ----------
  blues: { el: ['μπλουζ'], he: ['בלוז'], ar: ['بلوز'], th: ['บลูส์'], uk: ['блюз'] },
  'delta blues': { ja: ['デルタブルース'] },
  'chicago blues': { ja: ['シカゴブルース'] },
  'electric blues': { ja: ['エレクトリックブルース'] },
  'blues rock': { ja: ['ブルースロック'], ru: ['блюз-рок'] },

  // ---------- Classical ----------
  classical: { he: ['קלאסית', 'קלאסי'], fa: ['کلاسیک'], th: ['คลาสสิก'], hi: ['शास्त्रीय'], ar: ['موسيقى كلاسيكية'], uk: ['класичн'], tr: ['klasik müzik'] },
  baroque: { ja: ['バロック'], ru: ['барокко'], es: ['barroco'], pt: ['barroco'], de: ['barock'], it: ['barocco'], pl: [' barok '] },
  romantic: { ja: ['ロマン派'] },
  opera: {
    ja: ['オペラ'], ko: ['오페라'], zh: ['歌剧', '歌劇'], ru: ['опера'], el: ['όπερα'], he: ['אופרה'],
    es: ['ópera'], pt: ['ópera'], it: ['lirica'], de: [' oper '],
  },
  orchestral: { ja: ['オーケストラ'], ru: ['оркестр'], es: ['orquesta'], pt: ['orquestra'], fr: ['orchestre'], de: ['orchester'], en: ['orchestra'] },
  'chamber music': { ja: ['室内楽'], ru: ['камерная музыка'], es: ['música de cámara'], pt: ['música de câmara'], fr: ['musique de chambre'], de: ['kammermusik'], it: ['musica da camera'] },
  piano: { ja: ['ピアノ'], ko: ['피아노'], zh: ['钢琴', '鋼琴'], ru: ['фортепиан'], de: ['klavier'], pl: ['fortepian'] },
  choral: { ja: ['合唱'], ru: ['хоров'], fr: ['chorale'], de: ['chormusik'], it: ['corale'] },
  'contemporary classical': { ja: ['現代音楽'] },
  soundtrack: { es: ['banda sonora'], fr: ['bande originale'], de: ['filmmusik'], it: ['colonna sonora'], ja: ['映画音楽', 'ゲーム音楽'] },

  // ---------- Ambient & Chill ----------
  ambient: { uk: ['ембієнт'], zh: ['氛围音乐', '氛圍音樂'] },
  chillout: { fr: ['détente'], it: ['rilassante'], pt: ['relaxante'], tr: ['dinlendirici'], en: ['chill out'] },
  lounge: { ru: ['лаунж'] },
  downtempo: { ja: ['ダウンテンポ'], ru: ['даунтемпо'] },
  'trip-hop': { ja: ['トリップホップ'], ru: ['трип-хоп'] },
  chillwave: { ja: ['チルウェイブ'] },
  lofi: { ja: ['ローファイ'], ko: ['로파이'], ru: ['лоу-фай', 'лофай'] },
  'new age': { ja: ['ニューエイジ'], zh: ['新世纪音乐', '新世紀音樂'], ru: ['нью-эйдж'], es: ['nueva era'], pt: ['nova era'] },
  meditation: {
    ja: ['瞑想'], ko: ['명상'], zh: ['冥想'], ru: ['медитац'], hi: ['ध्यान'], th: ['สมาธิ'],
    es: ['meditación', 'meditacion'], pt: ['meditação', 'meditacao'], fr: ['méditation'], it: ['meditazione'],
  },
  'space music': { ja: ['スペースミュージック'] },
  'dark ambient': { ja: ['ダークアンビエント'], ru: ['дарк-эмбиент'] },
  drone: { ru: ['дроун'] },

  // ---------- Latin ----------
  salsa: { ja: ['サルサ'], ko: ['살사'], ru: ['сальса'] },
  reggaeton: { ja: ['レゲトン'], ko: ['레게톤'], ru: ['реггетон'] },
  cumbia: { ja: ['クンビア'], ru: ['кумбия'] },
  bachata: { ja: ['バチャータ'], ru: ['бачата'] },
  merengue: { ja: ['メレンゲ'], ru: ['меренге'] },
  tango: { ja: ['タンゴ'], ko: ['탱고'], zh: ['探戈'], ru: ['танго'], el: ['ταγκό'] },
  samba: { ja: ['サンバ'], zh: ['桑巴'], ru: ['самба'] },
  'latin pop': { es: ['pop latino'], pt: ['pop latino'], ja: ['ラテンポップ'] },
  'regional mexicano': { es: ['música mexicana', 'musica mexicana', 'grupera', 'grupero', 'corridos', 'ranchera', 'duranguense', 'norteña'] },
  mariachi: { ja: ['マリアッチ'] },

  // ---------- Reggae & Ska ----------
  reggae: { he: ['רגאיי'], ar: ['ريغي'], uk: ['реггі'] },
  'roots reggae': { ja: ['ルーツレゲエ', 'ルーツ・レゲエ'] },
  dub: { ja: [' ダブ '], ru: [' даб '] },
  dancehall: { ja: ['ダンスホール'], ru: ['дэнсхолл'] },
  ska: { ja: [' スカ '], ru: [' ска '] },
  'lovers rock': { ja: ['ラヴァーズロック', 'ラバーズロック'] },

  // ---------- World ----------
  'world music': {
    ja: ['ワールドミュージック'], ko: ['월드뮤직'], ru: ['этническ', 'world music'], uk: ['етнічн'],
    pt: ['músicas do mundo', 'world music'], it: ['musica dal mondo'], pl: ['muzyka świata'], es: ['música étnica', 'musica etnica'],
  },
  afrobeat: { ja: ['アフロビート'], ru: ['афробит'] },
  bollywood: { hi: ['बॉलीवुड', 'फिल्मी'], ur: ['بالی وڈ'], ja: ['ボリウッド'], en: ['filmi', 'hindi film'] },
  celtic: { ja: ['ケルト'], ru: ['кельтск'], es: ['celta'], pt: ['celta'], fr: ['celtique'], de: ['keltisch'], it: ['celtica'] },
  flamenco: { ja: ['フラメンコ'], ru: ['фламенко'] },
  fado: { ja: ['ファド'] },
  arabic: { ar: ['عربي', 'عربية'], fr: ['arabe'], es: ['árabe'], de: ['arabisch'], it: ['araba'], ja: ['アラブ音楽'], he: ['ערבית'] },
  balkan: { ru: ['балкан'], sr: ['балкан', 'balkansk'], bg: ['балкан'], hr: ['balkansk'], it: ['balcanica'] },
  turkish: { tr: ['türk müzi', 'türk halk', 'türk sanat'], ru: ['турецк'], de: ['türkisch'] },
  chanson: { ru: ['шансон'], ja: ['シャンソン'] },

  // ---------- Country & Folk ----------
  country: { he: ['קאנטרי'], ar: ['كانتري'], pt: ['sertanejo'] },
  'classic country': { es: ['country clásico'] },
  bluegrass: { ja: ['ブルーグラス'], ru: ['блюграсс'] },
  folk: { he: ['פולק'] },
  'indie folk': { ja: ['インディーフォーク'], ru: ['инди-фолк'] },
  'singer-songwriter': {
    ja: ['シンガーソングライター'], ko: ['싱어송라이터'], es: ['cantautor'], pt: ['cantautor', 'cantor e compositor'],
    fr: ['auteur-compositeur', 'chanson à texte'], de: ['liedermacher'], it: ['cantautor'], ru: ['авторская песня', ' бард '],
    pl: ['piosenka autorska'],
  },
};

// Main genres in each script, mostly so country searches can use them
// (matching already knows most of these from lib/translate.js).
const MAIN = {
  rock: { ja: ['ロック'], ko: ['록'], zh: ['摇滚', '搖滾'], ru: ['рок '] },
  metal: { ja: ['メタル'], ko: ['메탈'], zh: ['重金属', '重金屬'], ru: ['метал'] },
  punk: { ja: ['パンク'], ko: ['펑크'], zh: ['朋克'], ru: ['панк'] },
  pop: { ja: ['ポップス', 'ポップ'], ko: ['가요', '팝'], zh: ['流行'] },
  'hip-hop': { ja: ['ヒップホップ'], ko: ['힙합'], zh: ['嘻哈'], ru: ['хип-хоп'] },
  rnb: { ja: ['ソウル'], ko: ['알앤비', '소울'] },
  jazz: { ja: ['ジャズ', 'ボサノヴァ', 'ボサノバ'], ko: ['재즈'], zh: ['爵士'], ru: ['джаз'], pt: ['bossa nova'], en: ['bossa nova'] },
  blues: { ja: ['ブルース'], ko: ['블루스'], zh: ['蓝调', '藍調'], ru: ['блюз'] },
  classical: {
    ja: ['クラシック'], ko: ['클래식'], zh: ['古典音乐', '古典音樂'], ru: ['классическ'], es: ['clásica', 'clasica'],
    pt: ['clássica', 'classica'], fr: ['classique'], de: ['klassik'], it: ['classica'], pl: ['klasyczn'], el: ['κλασική'],
  },
  ambient: { ja: ['アンビエント'], ko: ['앰비언트'], ru: ['эмбиент'] },
  latin: { ja: ['ラテン'], ko: ['라틴'], es: ['música mexicana', 'musica mexicana', 'grupera', 'ranchera', 'corridos', 'música tropical', 'musica tropical'] },
  reggae: { ja: ['レゲエ'], ko: ['레게'], zh: ['雷鬼'], ru: ['регги'] },
  country: { ja: ['カントリー'], ko: ['컨트리'], ru: ['кантри'] },
  folk: { ja: ['フォーク'], ko: ['포크'], zh: ['民谣', '民謠'], ru: ['фолк'], es: ['folclore', 'folklore'], pt: ['folclore'], de: ['volksmusik'], pl: ['ludowa'] },
};
for (const [tag, langs] of Object.entries(MAIN)) {
  W[tag] = W[tag] || {};
  for (const [lang, words] of Object.entries(langs)) W[tag][lang] = [...words, ...(W[tag][lang] || [])];
}

// The main language for each country the app searches (REGIONS in lib/config.js).
// English-speaking countries are left out: English names are searched anyway.
const COUNTRY_LANG = {
  JP: 'ja', KR: 'ko', CN: 'zh', TW: 'zh', HK: 'zh',
  RU: 'ru', BY: 'ru', KZ: 'ru', UA: 'uk', BG: 'bg', RS: 'sr', HR: 'hr', GR: 'el', CY: 'el',
  IL: 'he', EG: 'ar', SA: 'ar', AE: 'ar', IQ: 'ar', LB: 'ar', JO: 'ar', QA: 'ar', KW: 'ar', OM: 'ar', MA: 'ar', DZ: 'ar', TN: 'ar',
  IR: 'fa', IN: 'hi', PK: 'ur', TH: 'th', TR: 'tr', PL: 'pl', CZ: 'cs', SK: 'cs', HU: 'hu', RO: 'ro',
  ES: 'es', MX: 'es', AR: 'es', CO: 'es', CL: 'es', PE: 'es', VE: 'es', EC: 'es', UY: 'es', CU: 'es', DO: 'es', PR: 'es',
  GT: 'es', CR: 'es', PA: 'es', BO: 'es', PY: 'es', HN: 'es', SV: 'es',
  PT: 'pt', BR: 'pt', AO: 'pt', MZ: 'pt',
  FR: 'fr', BE: 'fr', SN: 'fr', CI: 'fr', CM: 'fr',
  DE: 'de', AT: 'de', CH: 'de', IT: 'it', NL: 'nl', SE: 'sv', FI: 'fi', ID: 'id', MY: 'id', VN: 'vi',
};

/** All words for one English tag, every language: [[word, tag], …]. */
function pairs() {
  return Object.entries(W).flatMap(([tag, langs]) => Object.values(langs).flat().map((w) => [w, tag]));
}

/** Search words for a tag in a country's language (trimmed, best first). */
function nativeWords(tag, countryCode) {
  const lang = COUNTRY_LANG[String(countryCode || '').toUpperCase()];
  const words = lang && W[tag] && W[tag][lang];
  return words ? words.map((w) => w.trim()).filter(Boolean) : [];
}

module.exports = { GENRE_WORDS: W, COUNTRY_LANG, pairs, nativeWords };
