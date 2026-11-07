/* Signal Wave front end: globe, player, now-playing HUD, genres, saved stations. */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (_) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) { /* storage blocked */ } },
  };
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  // Every iPhone/iPad browser runs on WebKit, whose Web Audio support for live
  // streams is unreliable (silent analyser, or audio muted when the audio
  // context starts outside a tap). On those devices, play streams directly.
  const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const narrow = matchMedia('(max-width: 899px)');

  // Main genres (matching lib/config.js on the server) and the sub-genres
  // listeners can add. A sub-genre is sent as a single Radio Browser tag.
  const CATALOG = [
    { id: 'electronic', label: 'Electronic', subs: ['house', 'deep house', 'techno', 'trance', 'drum and bass', 'dubstep', 'synthwave', 'electro', 'minimal', 'breakbeat', 'idm', 'edm'] },
    { id: 'rock', label: 'Rock', subs: ['classic rock', 'indie', 'alternative', 'metal', 'punk', 'hard rock', 'grunge', 'progressive rock', 'post-rock', 'shoegaze'] },
    { id: 'pop', label: 'Pop', subs: ['top 40', 'k-pop', 'j-pop', 'city pop', 'synthpop', 'indie pop', 'dance pop', '80s', '90s'] },
    { id: 'hiphop', label: 'Hip-hop & R&B', subs: ['hip-hop', 'rap', 'rnb', 'trap', 'lofi', 'boom bap'] },
    { id: 'jazz', label: 'Jazz & Blues', subs: ['smooth jazz', 'bebop', 'swing', 'blues', 'soul', 'funk', 'jazz fusion', 'bossa nova'] },
    { id: 'classical', label: 'Classical', subs: ['baroque', 'opera', 'piano', 'orchestral', 'chamber music', 'contemporary classical'] },
    { id: 'ambient', label: 'Ambient & Chill', subs: ['chillout', 'lounge', 'downtempo', 'chillwave', 'new age', 'meditation', 'space music'] },
    { id: 'latin', label: 'Latin', subs: ['salsa', 'reggaeton', 'cumbia', 'bachata', 'tango', 'samba', 'latin pop', 'merengue'] },
    { id: 'world', label: 'World', subs: ['afrobeat', 'reggae', 'dancehall', 'bollywood', 'celtic', 'flamenco', 'highlife', 'arabic'] },
    { id: 'country', label: 'Country & Folk', subs: ['country', 'folk', 'bluegrass', 'americana', 'singer-songwriter'] },
  ];
  const DEFAULT_GENRES = ['electronic', 'rock', 'pop', 'hiphop', 'jazz', 'classical', 'ambient', 'latin', 'world'];
  const SPECIAL_LABELS = { rnb: 'R&B', idm: 'IDM', edm: 'EDM', lofi: 'Lo-fi', 'k-pop': 'K-Pop', 'j-pop': 'J-Pop', 'top 40': 'Top 40', 'hip-hop': 'Hip-hop', 'drum and bass': 'Drum & Bass', 'post-rock': 'Post-rock' };
  function genreLabel(id) {
    if (id === 'any') return 'Any';
    if (!id.startsWith('tag:')) return (CATALOG.find((c) => c.id === id) || { label: id }).label;
    const t = id.slice(4);
    return SPECIAL_LABELS[t] || t.replace(/(^|[\s-])([a-z])/g, (m, a, b) => a + b.toUpperCase());
  }
  const POLL_MS = 25000;
  const STALL_MS = 8000;
  const MAX_TITLE_MISSES = 3;
  const FROZEN_TITLE_MS = 15 * 60 * 1000;

  const state = {
    genre: store.get('sw.genre', 'any'),
    genres: store.get('sw.genres', DEFAULT_GENRES), // chips on the main list, after "Any"
    favorites: store.get('sw.favorites', []),
    hidden: store.get('sw.hidden', []), // stations flagged "not music"
    showFavDots: store.get('sw.showFavDots', true),
    history: [],
    played: new Set(),
    queue: [],
    back: [], // stations heard before the current one, for the previous button
    inflight: 0,
    current: null,
    title: null,
    titleSince: 0,
    misses: 0,
    switching: false,
    started: false,
    paused: false,
    timers: {},
  };

  /* ---------- Audio ---------- */
  // Two elements: one plain, one CORS-enabled and wired to an analyser. Routing a
  // stream without CORS headers through Web Audio would make it silent.
  const plainAudio = $('audio');
  const corsAudio = new Audio();
  corsAudio.crossOrigin = 'anonymous';
  corsAudio.preload = 'none';
  corsAudio.setAttribute('playsinline', '');
  let audio = plainAudio;
  let audioCtx = null;
  let analyser = null;

  function ensureAnalyser() {
    if (analyser) return;
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const src = audioCtx.createMediaElementSource(corsAudio);
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 128;
      src.connect(analyser);
      analyser.connect(audioCtx.destination);
    } catch (_) { analyser = null; }
  }

  [plainAudio, corsAudio].forEach((el) => {
    el.addEventListener('playing', () => { if (el === audio) onPlaying(); });
    el.addEventListener('waiting', () => { if (el === audio) armStall(); });
    el.addEventListener('stalled', () => { if (el === audio) armStall(); });
    el.addEventListener('error', () => {
      if (el !== audio || !state.current || !el.src) return;
      next('> SIGNAL LOST — RETUNING…', true);
    });
  });

  function armStall() {
    clearTimeout(state.timers.stall);
    if (state.paused) return;
    state.timers.stall = setTimeout(() => next('> SIGNAL STALLED — RETUNING…', true), STALL_MS);
  }

  function onPlaying() {
    clearTimeout(state.timers.stall);
    setLive(true);
    const s = state.current;
    if (s) status(`> LINK ESTABLISHED // ${s.bitrate ? `${s.bitrate} kbps ` : ''}${(s.codec || 'stream').toUpperCase()}`);
  }

  // Starts playback without waiting for the stream to buffer, so a slow stream
  // can't freeze the controls; the stall timer and error events handle failures.
  function playUrl(station) {
    const useCors = Boolean(station.cors) && !isIOS && !!(window.AudioContext || window.webkitAudioContext);
    silentFrames = 0;
    const el = useCors ? corsAudio : plainAudio;
    [plainAudio, corsAudio].forEach((a) => { if (a !== el) { a.pause(); a.removeAttribute('src'); a.load(); } });
    audio = el;
    if (useCors) { ensureAnalyser(); if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume(); }
    el.src = station.url;
    state.paused = false;
    setPlayButton();
    armStall();
    const p = el.play();
    if (p && p.catch) {
      p.catch((e) => {
        if (station !== state.current || el !== audio) return;
        if (e && e.name === 'NotAllowedError') {
          clearTimeout(state.timers.stall);
          state.paused = true; setPlayButton(); setLive(false);
          status('> TAP PLAY TO START AUDIO', true);
        } else if (e && e.name !== 'AbortError') {
          next('> SIGNAL LOST — RETUNING…', true);
        }
      });
    }
  }

  /* ---------- Station fetching ---------- */
  async function fetchStation(genre) {
    const exclude = [...state.played, ...state.hidden, ...state.queue.map((s) => s.uuid)].slice(-250).join(',');
    // Countries just heard (and already queued) so the server picks a different part of the world.
    const recent = [...state.history.slice(-3).map((h) => h.cc), ...state.queue.map((s) => s.countryCode)].filter(Boolean).join(',');
    const which = genre.startsWith('tag:') ? `tag=${encodeURIComponent(genre.slice(4))}` : `genre=${encodeURIComponent(genre)}`;
    const r = await fetch(`/api/next?${which}&exclude=${encodeURIComponent(exclude)}&recent=${encodeURIComponent(recent)}`);
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.station) {
      const err = new Error(j.error || 'No signal found.');
      err.status = r.status;
      throw err;
    }
    return j.station;
  }

  // Keeps two vetted stations ready so NEXT is instant.
  function fillQueue() {
    while (state.queue.length + state.inflight < 2) {
      const g = state.genre;
      state.inflight++;
      fetchStation(g)
        .then((s) => {
          const dup = state.queue.some((q) => q.uuid === s.uuid) || state.played.has(s.uuid);
          if (g === state.genre && !dup) state.queue.push(s);
        })
        .catch(() => {})
        .finally(() => { state.inflight--; });
    }
  }

  async function next(message, isWarning = false) {
    if (state.switching) return;
    state.switching = true;
    setBusy(true);
    status(message || '> SCANNING FREQUENCIES…', isWarning);
    globeScan(true);
    const g = state.genre;
    let station = state.queue.shift();
    try {
      if (!station) station = await fetchStation(g);
    } catch (e) {
      if (e.status === 503 && g !== 'any') markGenreDead(g);
      status(`> ${e.message.toUpperCase()}`, true);
      globeScan(false);
      state.switching = false;
      setBusy(false);
      return;
    }
    fillQueue();
    await tune(station, { remember: !isWarning }).catch(() => {});
    state.switching = false;
    setBusy(false);
  }

  // opts.remember = false skips adding the outgoing station to the back list
  // (used when it failed, or when we're stepping back ourselves).
  async function tune(station, opts = {}) {
    clearTimers();
    if (state.current && state.current.uuid !== station.uuid && opts.remember !== false) {
      state.back = [...state.back.filter((b) => b.uuid !== state.current.uuid), state.current].slice(-30);
    }
    state.current = station;
    state.played.add(station.uuid);
    state.history.push({ uuid: station.uuid, lat: station.lat, lng: station.lng, cc: station.countryCode });
    state.title = station.title || null;
    state.titleSince = Date.now();
    state.misses = 0;

    renderStation(station);
    flyTo(station);
    updateMediaSession();
    renderFavorites();
    playUrl(station);
    state.timers.poll = setInterval(pollTitle, POLL_MS);
    setPrevButton();
  }

  // Steps back one station. The station you leave goes to the front of the
  // queue, so NEXT brings you forward to it again.
  async function prev() {
    if (state.switching || !state.back.length) return;
    const station = state.back.pop();
    if (state.current) state.queue.unshift(state.current);
    state.switching = true;
    setBusy(true);
    status('> RETUNING TO PREVIOUS SIGNAL…');
    await tune({ ...station, title: null }, { remember: false }).catch(() => {});
    state.switching = false;
    setBusy(false);
    pollTitle();
  }
  function setPrevButton() {
    const b = $('prevBtn');
    b.disabled = state.switching || !state.back.length;
  }

  function clearTimers() {
    clearTimeout(state.timers.stall);
    clearInterval(state.timers.poll);
  }

  async function pollTitle() {
    const s = state.current;
    if (!s || state.paused || document.hidden && !('mediaSession' in navigator)) return;
    let title = null;
    try {
      const r = await fetch(`/api/nowplaying?uuid=${encodeURIComponent(s.uuid)}`);
      title = (await r.json()).title || null;
    } catch (_) { return; } // network blip: don't count it against the station
    if (s !== state.current) return;
    if (!title) {
      state.misses++;
      if (state.misses >= MAX_TITLE_MISSES) next('> TRACK DATA LOST — RETUNING…', true);
      return;
    }
    state.misses = 0;
    if (title !== state.title) {
      state.title = title;
      state.titleSince = Date.now();
      setSong(title);
      updateMediaSession();
      rememberLastSong(s.uuid, title);
    } else if (Date.now() - state.titleSince > FROZEN_TITLE_MS) {
      next('> TRACK DATA FROZEN — RETUNING…', true);
    }
  }

  /* ---------- HUD ---------- */
  const GLYPHS = '!<>-_\\/[]{}—=+*^?#01ABCDEF';
  function decode(el, text) {
    if (reduced) { el.textContent = text; return; }
    const frames = 12;
    let f = 0;
    clearInterval(el._decode);
    el._decode = setInterval(() => {
      f++;
      const solved = Math.floor((text.length * f) / frames);
      el.textContent = text.slice(0, solved) +
        Array.from(text.slice(solved), (c) => (c === ' ' ? ' ' : GLYPHS[(Math.random() * GLYPHS.length) | 0])).join('');
      if (f >= frames) { clearInterval(el._decode); el.textContent = text; fitScroll(el); }
    }, 33);
  }

  // Text wider than its box scrolls to the end, pauses, scrolls back, pauses, and repeats.
  function fitScroll(span) {
    if (!span || !span.parentElement) return;
    if (span._anim) { span._anim.cancel(); span._anim = null; }
    const box = span.parentElement;
    const over = Math.ceil(span.scrollWidth - box.clientWidth);
    box.classList.toggle('overflowing', over > 2);
    if (over <= 2 || reduced || !span.animate || box.clientWidth === 0) return;
    const hold = 1800;
    const move = Math.max(1200, (over / 40) * 1000); // about 40px per second
    const total = 2 * hold + 2 * move;
    span._anim = span.animate([
      { transform: 'translateX(0)', offset: 0 },
      { transform: 'translateX(0)', offset: hold / total, easing: 'ease-in-out' },
      { transform: `translateX(${-over}px)`, offset: (hold + move) / total },
      { transform: `translateX(${-over}px)`, offset: (2 * hold + move) / total, easing: 'ease-in-out' },
      { transform: 'translateX(0)', offset: 1 },
    ], { duration: total, iterations: Infinity });
  }
  let refitQueued = false;
  function refitAll() {
    if (refitQueued) return;
    refitQueued = true;
    requestAnimationFrame(() => { refitQueued = false; document.querySelectorAll('.scroll').forEach(fitScroll); });
  }

  function flag(cc) {
    if (!cc || !/^[A-Z]{2}$/.test(cc)) return '';
    return String.fromCodePoint(...[...cc].map((c) => 0x1f1a5 + c.charCodeAt(0)));
  }

  function setSong(title) {
    const box = $('song');
    const span = $('songText');
    span.textContent = title || '// NO TRACK DATA';
    setSongLinks(title);
    box.classList.remove('glitch');
    void box.offsetWidth; // restart the animation
    box.classList.add('glitch');
    requestAnimationFrame(() => fitScroll(span));
  }

  // Turns "Artist - Title [Radio Edit] ★ www.station.fm" into a clean search query.
  function songQuery(title) {
    if (!title) return '';
    return title
      .replace(/\[[^\]]*\]/g, ' ')
      .replace(/\((?:[^)]*\b(?:edit|mix|version|remaster(?:ed)?|live|explicit|clean)\b[^)]*)\)/gi, ' ')
      .replace(/\b(?:https?:\/\/|www\.)\S+/gi, ' ')
      .replace(/^(?:now playing|on air|playing)\s*[:\-–]\s*/i, '')
      .replace(/[★*|•]+/g, ' ')
      .replace(/\s+[-–—]\s+/, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // Search links; on an iPhone with the apps installed these open Spotify or Apple Music directly.
  function setSongLinks(title) {
    const q = songQuery(title);
    const links = [
      [$('spotifyLink'), q && `https://open.spotify.com/search/${encodeURIComponent(q)}`],
      [$('appleLink'), q && `https://music.apple.com/us/search?term=${encodeURIComponent(q)}`],
    ];
    for (const [a, href] of links) {
      if (href) { a.href = href; a.removeAttribute('aria-disabled'); a.tabIndex = 0; }
      else { a.removeAttribute('href'); a.setAttribute('aria-disabled', 'true'); a.tabIndex = -1; }
    }
  }

  function renderStation(s) {
    setSong(s.title);
    decode($('station'), s.name);
    decode($('genre'), s.genre || '—');
    decode($('city'), s.city);
    $('country').textContent = `${flag(s.countryCode)} ${s.country}`.trim();
    fitScroll($('country'));
    const bars = s.bitrate >= 256 ? 4 : s.bitrate >= 128 ? 3 : s.bitrate >= 64 ? 2 : 1;
    $('sig').textContent = `SIG ${'▮'.repeat(bars)}${'▯'.repeat(4 - bars)}${s.bitrate ? ` ${s.bitrate}K` : ''}`;
    $('coords').textContent = `${Math.abs(s.lat).toFixed(2)}°${s.lat >= 0 ? 'N' : 'S'}  ${Math.abs(s.lng).toFixed(2)}°${s.lng >= 0 ? 'E' : 'W'}`;
    setFavButton();
  }

  function setLive(on) {
    $('live').classList.toggle('on', on);
    $('liveText').textContent = on ? 'LIVE' : state.paused ? 'PAUSED' : 'TUNING';
  }
  function status(text, warn = false) {
    const el = $('statusText');
    el.textContent = text;
    $('statusline').classList.toggle('warn', warn);
    fitScroll(el);
  }
  function setBusy(on) {
    $('nextBtn').classList.toggle('busy', on);
    $('nextBtn').disabled = on;
    $('prevBtn').disabled = on || !state.back.length;
    if (on) setLive(false);
  }
  function setPlayButton() {
    $('playBtn').textContent = state.paused ? '▶' : '❚❚';
    $('playBtn').setAttribute('aria-label', state.paused ? 'Play' : 'Pause');
  }

  let toastTimer;
  function toast(text, action) {
    const el = $('toast');
    el.textContent = text;
    if (action) {
      const b = document.createElement('button');
      b.textContent = action.label;
      b.onclick = () => { action.fn(); el.hidden = true; };
      el.appendChild(b);
    }
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, action ? 5000 : 2200);
  }

  /* ---------- Visualizer ---------- */
  const viz = $('viz');
  const vctx = viz.getContext('2d');
  let vizData = null;
  let silentFrames = 0; // frames in a row where the analyser returned nothing
  function drawViz(t) {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const w = viz.clientWidth, h = viz.clientHeight;
    if (viz.width !== w * dpr) { viz.width = w * dpr; viz.height = h * dpr; }
    vctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    vctx.clearRect(0, 0, w, h);
    const n = 40;
    const gap = 2;
    const bw = (w - gap * (n - 1)) / n;
    // Cyan at the base rising to pink at the peaks.
    const vizGrad = vctx.createLinearGradient(0, h, 0, 0);
    vizGrad.addColorStop(0, '#00f0ff');
    vizGrad.addColorStop(0.4, '#b84dff');
    vizGrad.addColorStop(0.75, '#ff3ec8');
    const live = state.current && !state.paused && !audio.paused;
    let real = live && analyser && audio === corsAudio;
    if (real) {
      if (!vizData) vizData = new Uint8Array(analyser.frequencyBinCount);
      analyser.getByteFrequencyData(vizData);
      // If the browser hands back silence for ~1.5 s, switch to the animated bars.
      silentFrames = vizData.some((v) => v > 0) ? 0 : silentFrames + 1;
      if (silentFrames > 90) real = false;
    }
    for (let i = 0; i < n; i++) {
      let v;
      if (real) v = vizData[Math.floor((i / n) * vizData.length * 0.8)] / 255;
      else if (live) v = 0.25 + 0.55 * Math.abs(Math.sin(t / 380 + i * 0.55) * Math.cos(t / 910 + i * 0.21));
      else v = 0.04;
      const bh = Math.max(2, v * h);
      vctx.fillStyle = vizGrad;
      vctx.globalAlpha = 0.35 + v * 0.65;
      vctx.fillRect(i * (bw + gap), h - bh, bw, bh);
    }
    vctx.globalAlpha = 1;
    requestAnimationFrame(drawViz);
  }

  /* ---------- Globe ---------- */
  const globeEl = $('globe');
  let globe = null;
  let idleTimer;

  function initGlobe() {
    if (typeof Globe !== 'function') { $('bootLog').textContent = '> GLOBE OFFLINE — AUDIO ONLY'; return Promise.resolve(); }
    globe = new Globe(globeEl, { rendererConfig: { antialias: !narrow.matches, alpha: true } })
      .backgroundColor('rgba(0,0,0,0)')
      .showAtmosphere(true)
      .atmosphereColor('#b84dff')
      .atmosphereAltitude(0.24)
      .showGraticules(true)
      .hexPolygonResolution(3)
      .hexPolygonMargin(0.4)
      .hexPolygonUseDots(true)
      .hexPolygonAltitude(0.004)
      .hexPolygonColor((f) => f.properties.color)
      .arcStartLat('a').arcStartLng('b').arcEndLat('c').arcEndLng('d')
      .arcColor('color').arcStroke('stroke').arcAltitudeAutoScale(0.38)
      .arcDashLength('dash').arcDashGap('gap').arcDashInitialGap('initial').arcDashAnimateTime('time')
      .particlesList('pts').particleLat('lat').particleLng('lng').particleAltitude('alt')
      .particlesColor('color').particlesSize('size').particlesSizeAttenuation(false)
      .pointLat('lat').pointLng('lng')
      .pointColor('color').pointAltitude('alt').pointRadius('r')
      .pointsMerge(false)
      .pointsTransitionDuration(reduced ? 0 : 600)
      .onPointClick((p) => { if (p.station) { closeDrawer(); tuneSaved(p.station); } })
      .pointLabel((p) => (p.station ? `<span class="city-label"><b>${esc(p.station.name)}</b>${esc(p.station.city)}</span>` : ''))
      .ringLat('lat').ringLng('lng')
      .ringColor((d) => (t) => `rgba(${d.rgb}, ${(1 - t) * d.alpha})`)
      .ringMaxRadius('max').ringPropagationSpeed('speed').ringRepeatPeriod((d) => (reduced ? 0 : d.period))
      .htmlLat('lat').htmlLng('lng').htmlAltitude(0.02)
      .htmlElement((d) => {
        const el = document.createElement('div');
        el.className = 'city-label';
        el.innerHTML = `<b>${esc(d.city.toUpperCase())}</b>${Math.abs(d.lat).toFixed(2)}°${d.lat >= 0 ? 'N' : 'S'} ${Math.abs(d.lng).toFixed(2)}°${d.lng >= 0 ? 'E' : 'W'}`;
        return el;
      });

    const mat = globe.globeMaterial();
    mat.color.set('#04020c');
    if (mat.emissive) mat.emissive.set('#14063a');
    if ('emissiveIntensity' in mat) mat.emissiveIntensity = 0.3;
    if ('shininess' in mat) mat.shininess = 6;

    globe.renderer().setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    const controls = globe.controls();
    controls.autoRotate = !reduced;
    controls.autoRotateSpeed = 0.4;
    controls.enableDamping = true;
    controls.addEventListener('start', () => { clearTimeout(idleTimer); controls.autoRotate = false; });
    controls.addEventListener('end', () => scheduleDrift());
    globe.pointOfView({ lat: 20, lng: -30, altitude: 2.4 });

    sizeGlobe();
    new ResizeObserver(sizeGlobe).observe(globeEl);
    document.addEventListener('visibilitychange', () => (document.hidden ? globe.pauseAnimation() : globe.resumeAnimation()));

    return fetch('vendor/countries.geojson')
      .then((r) => r.json())
      .then((geo) => {
        // Mostly magenta and violet land with scattered cyan, like a city-light map.
        const rnd = seeded(7);
        const palette = ['rgba(255, 62, 200, 0.95)', 'rgba(255, 62, 200, 0.8)', 'rgba(190, 90, 255, 0.85)',
          'rgba(150, 80, 255, 0.7)', 'rgba(255, 90, 220, 0.9)', 'rgba(170, 70, 255, 0.8)', 'rgba(0, 240, 255, 0.85)'];
        geo.features.forEach((f) => { f.properties.color = palette[Math.floor(rnd() * palette.length)]; });
        globe.hexPolygonsData(geo.features);
      })
      .catch(() => {})
      .then(() => { buildNetwork(); updatePoints(); updateRings(); });
  }

  /* World network dressing: hub cities as glowing towers, data arcs between
     them, pulsing nodes, and floating debris around the globe. */
  const HUBS = [
    [40.71, -74.0], [34.05, -118.24], [41.88, -87.63], [29.76, -95.37], [25.76, -80.19], [47.61, -122.33],
    [49.28, -123.12], [43.65, -79.38], [45.5, -73.57], [19.43, -99.13], [4.71, -74.07], [-12.05, -77.04],
    [-23.55, -46.63], [-22.91, -43.17], [-34.6, -58.38], [-33.45, -70.67], [51.51, -0.13], [48.86, 2.35],
    [52.52, 13.4], [40.42, -3.7], [41.9, 12.5], [59.33, 18.07], [55.76, 37.62], [41.01, 28.98],
    [30.04, 31.24], [6.52, 3.38], [-1.29, 36.82], [-26.2, 28.05], [25.2, 55.27], [24.71, 46.68],
    [19.08, 72.88], [28.61, 77.21], [12.97, 77.59], [13.76, 100.5], [1.35, 103.82], [-6.21, 106.85],
    [22.32, 114.17], [31.23, 121.47], [39.9, 116.41], [37.57, 126.98], [35.68, 139.69], [14.6, 120.98],
    [-33.87, 151.21], [-37.81, 144.96], [-36.85, 174.76], [21.31, -157.86], [64.15, -21.94], [61.22, -149.9],
  ];
  let network = { towers: [], arcs: [], pulses: [] };

  function seeded(n) {
    let x = n * 9301 + 49297;
    return () => { x = (x * 9301 + 49297) % 233280; return x / 233280; };
  }

  function buildNetwork() {
    if (!globe) return;
    const rnd = seeded(42);
    const small = narrow.matches;
    network.towers = HUBS.map(([lat, lng]) => ({
      lat, lng, alt: 0.02 + rnd() * (rnd() > 0.8 ? 0.16 : 0.07), r: 0.16,
      color: rnd() > 0.75 ? '#00f0ff' : '#ff3ec8',
    }));
    const arcs = [];
    const count = small ? 16 : 30;
    for (let i = 0; i < count; i++) {
      const [a, b] = HUBS[Math.floor(rnd() * HUBS.length)];
      const [c, d] = HUBS[Math.floor(rnd() * HUBS.length)];
      if (a === c && b === d) continue;
      const cyan = rnd() > 0.65;
      arcs.push({
        a, b, c, d, stroke: 0.25 + rnd() * 0.35,
        color: cyan ? ['rgba(0,240,255,0.05)', 'rgba(0,240,255,0.9)'] : ['rgba(255,62,200,0.05)', 'rgba(255,62,200,0.95)'],
        dash: 0.25 + rnd() * 0.35, gap: 0.6 + rnd(), initial: rnd() * 2, time: reduced ? 0 : 2500 + rnd() * 4500,
      });
    }
    network.arcs = arcs;
    network.pulses = HUBS.filter(() => rnd() > 0.7).map(([lat, lng]) => ({
      lat, lng, rgb: rnd() > 0.5 ? '255, 62, 200' : '0, 240, 255', alpha: 0.55, max: 2.2, speed: 1.2, period: 2200 + rnd() * 2000,
    }));
    globe.arcsData(arcs);

    // Floating debris: two particle clouds at varying heights.
    const cloud = (n, minAlt, maxAlt) => Array.from({ length: n }, () => ({
      lat: Math.asin(2 * rnd() - 1) * (180 / Math.PI), lng: rnd() * 360 - 180, alt: minAlt + rnd() * (maxAlt - minAlt),
    }));
    globe.particlesData([
      { pts: cloud(small ? 160 : 320, 0.03, 0.5), color: 'rgba(255, 62, 200, 0.9)', size: small ? 2 : 2.5 },
      { pts: cloud(small ? 90 : 180, 0.05, 0.7), color: 'rgba(0, 240, 255, 0.85)', size: small ? 1.5 : 2 },
      { pts: cloud(small ? 40 : 80, 0.2, 0.9), color: 'rgba(255, 255, 255, 0.7)', size: 1.2 },
    ]);
  }

  function updateRings() {
    if (!globe) return;
    const c = state.current;
    const rings = [...network.pulses];
    if (c) rings.push({ lat: c.lat, lng: c.lng, rgb: '252, 238, 10', alpha: 1, max: 4.5, speed: 2.4, period: 900 });
    globe.ringsData(rings);
  }

  function sizeGlobe() {
    if (!globe) return;
    globe.width(globeEl.clientWidth).height(globeEl.clientHeight);
  }

  function updatePoints() {
    if (!globe) return;
    const pts = [...network.towers];
    const favIds = new Set(state.favorites.map((f) => f.uuid));
    for (const h of state.history) {
      if (state.current && h.uuid === state.current.uuid) continue;
      if (favIds.has(h.uuid) && state.showFavDots) continue;
      pts.push({ lat: h.lat, lng: h.lng, color: '#ff2a6d', alt: 0.01, r: 0.32 });
    }
    if (state.showFavDots) {
      for (const f of state.favorites) {
        if (state.current && f.uuid === state.current.uuid) continue;
        pts.push({ lat: f.lat, lng: f.lng, color: '#fcee0a', alt: 0.015, r: 0.42, station: f });
      }
    }
    const c = state.current;
    if (c) pts.push({ lat: c.lat, lng: c.lng, color: '#fcee0a', alt: 0.2, r: 0.05 }); // the beam
    globe.pointsData(pts);
  }

  function flyTo(s) {
    updatePoints();
    if (!globe) return;
    const controls = globe.controls();
    controls.autoRotate = false;
    clearTimeout(idleTimer);
    updateRings();
    // A bright arc from the last station to this one.
    const prev = state.history.length > 1 ? state.history[state.history.length - 2] : null;
    const journey = prev && (prev.lat !== s.lat || prev.lng !== s.lng) ? [{
      a: prev.lat, b: prev.lng, c: s.lat, d: s.lng, stroke: 0.9,
      color: ['rgba(255,62,200,0.6)', 'rgba(252,238,10,1)'], dash: 1, gap: 0, initial: 0, time: 0,
    }] : [];
    globe.arcsData([...network.arcs, ...journey]);
    globe.htmlElementsData([{ lat: s.lat, lng: s.lng, city: s.city }]);
    const close = narrow.matches ? 0.9 : 0.8;
    if (reduced) { globe.pointOfView({ lat: s.lat, lng: s.lng, altitude: close }, 0); scheduleDrift(); return; }
    globe.pointOfView({ lat: s.lat, lng: s.lng, altitude: 2.2 }, 1500);
    setTimeout(() => {
      if (state.current === s) globe.pointOfView({ lat: s.lat, lng: s.lng, altitude: close }, 1000);
      scheduleDrift();
    }, 1550);
  }

  // After 8 seconds without touch, pull back and spin slowly with the city in view.
  function scheduleDrift() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (!globe || !state.current) return;
      const s = state.current;
      globe.pointOfView({ lat: s.lat, lng: s.lng, altitude: 1.8 }, reduced ? 0 : 2500);
      setTimeout(() => { globe.controls().autoRotate = !reduced; globe.controls().autoRotateSpeed = 0.25; }, 2600);
    }, 8000);
  }

  function globeScan(on) {
    if (!globe || reduced) return;
    const c = globe.controls();
    clearTimeout(idleTimer);
    c.autoRotate = on;
    c.autoRotateSpeed = on ? 6 : 0.4;
    if (on) globe.pointOfView({ altitude: 2.4 }, 700);
  }

  /* ---------- Favorites ---------- */
  const isFav = (uuid) => state.favorites.some((f) => f.uuid === uuid);
  function saveFavs() { store.set('sw.favorites', state.favorites); renderFavorites(); updatePoints(); markChanged(); }

  function toggleFavorite() {
    const s = state.current;
    if (!s) return;
    if (isFav(s.uuid)) {
      state.favorites = state.favorites.filter((f) => f.uuid !== s.uuid);
      toast('> SIGNAL REMOVED');
    } else {
      state.favorites.unshift({
        uuid: s.uuid, name: s.name, url: s.url, favicon: s.favicon, tags: s.tags, genre: s.genre,
        city: s.city, country: s.country, countryCode: s.countryCode, lat: s.lat, lng: s.lng,
        bitrate: s.bitrate, codec: s.codec, cors: s.cors, lastSong: state.title, addedAt: new Date().toISOString(),
      });
      const btn = $('favBtn');
      btn.classList.remove('burst'); void btn.offsetWidth; btn.classList.add('burst');
      toast('> SIGNAL SAVED');
    }
    saveFavs();
    setFavButton();
  }

  function rememberLastSong(uuid, title) {
    const f = state.favorites.find((x) => x.uuid === uuid);
    if (f) { f.lastSong = title; store.set('sw.favorites', state.favorites); renderFavorites(); }
  }

  function setFavButton() {
    const on = state.current && isFav(state.current.uuid);
    $('favBtn').setAttribute('aria-pressed', on ? 'true' : 'false');
    $('favBtn').setAttribute('aria-label', on ? 'Remove from saved' : 'Save station');
  }

  function esc(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  function renderFavorites() {
    $('favCount').textContent = state.favorites.length;
    $('favEmpty').hidden = state.favorites.length > 0;
    const list = $('favList');
    list.innerHTML = '';
    for (const f of state.favorites) {
      const li = document.createElement('li');
      if (state.current && state.current.uuid === f.uuid) li.className = 'playing';
      li.innerHTML = `
        ${f.favicon ? `<img src="${esc(f.favicon)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : '<span class="noicon">FM</span>'}
        <button class="info" data-play="${esc(f.uuid)}" aria-label="Play ${esc(f.name)}">
          <span class="name"><span class="scroll">${esc(f.name)}</span></span>
          <span class="where"><span class="scroll">${flag(f.countryCode)} ${esc(f.city)}, ${esc(f.country)}</span></span>
          ${f.lastSong ? `<span class="last"><span class="scroll">Last heard: ${esc(f.lastSong)}</span></span>` : ''}
        </button>
        <button class="del" data-del="${esc(f.uuid)}" aria-label="Remove ${esc(f.name)}">✕</button>`;
      const img = li.querySelector('img');
      if (img) img.onerror = () => img.replaceWith(Object.assign(document.createElement('span'), { className: 'noicon', textContent: 'FM' }));
      list.appendChild(li);
    }
    if (!$('drawer').hidden) refitAll();
  }

  $('favList').addEventListener('click', (e) => {
    const play = e.target.closest('[data-play]');
    const del = e.target.closest('[data-del]');
    if (play) {
      const f = state.favorites.find((x) => x.uuid === play.dataset.play);
      if (f) { if (narrow.matches) closeDrawer(); tuneSaved(f); }
    } else if (del) {
      const idx = state.favorites.findIndex((x) => x.uuid === del.dataset.del);
      if (idx < 0) return;
      const [removed] = state.favorites.splice(idx, 1);
      saveFavs(); setFavButton();
      toast(`> REMOVED ${removed.name.toUpperCase()}`, { label: 'UNDO', fn: () => { state.favorites.splice(idx, 0, removed); saveFavs(); setFavButton(); } });
    }
  });

  async function tuneSaved(f) {
    if (state.switching) return;
    start(false);
    state.switching = true;
    setBusy(true);
    status('> RETUNING TO SAVED SIGNAL…');
    await tune({ ...f, title: f.lastSong || null }).catch(() => {});
    state.switching = false;
    setBusy(false);
    pollTitle();
  }

  function openDrawer() { $('drawer').hidden = false; $('openFavs').setAttribute('aria-expanded', 'true'); refitAll(); }
  function closeDrawer() { $('drawer').hidden = true; $('openFavs').setAttribute('aria-expanded', 'false'); }

  $('exportFavs').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify({ app: 'signal-wave', version: 1, favorites: state.favorites }, null, 2)], { type: 'application/json' });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'signal-wave-favorites.json' });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  $('importFile').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const incoming = (Array.isArray(data) ? data : data.favorites || []).filter((f) => f && f.uuid && f.url && Number.isFinite(f.lat));
      let added = 0;
      for (const f of incoming) if (!isFav(f.uuid)) { state.favorites.push(f); added++; }
      saveFavs();
      toast(`> IMPORTED ${added} SIGNAL${added === 1 ? '' : 'S'}`);
    } catch (_) {
      toast('> IMPORT FAILED — NOT A SIGNAL WAVE FILE');
    }
  });

  /* ---------- Genres ---------- */
  function renderGenres() {
    const nav = $('genres');
    nav.innerHTML = '';
    for (const id of ['any', ...state.genres]) {
      const b = document.createElement('button');
      b.className = 'chip';
      b.textContent = genreLabel(id);
      b.dataset.genre = id;
      b.setAttribute('aria-pressed', String(id === state.genre));
      b.addEventListener('click', () => setGenre(id));
      nav.appendChild(b);
    }
    const edit = document.createElement('button');
    edit.className = 'chip edit';
    edit.textContent = '+ EDIT';
    edit.setAttribute('aria-label', 'Edit genres');
    edit.addEventListener('click', openGenreSheet);
    nav.appendChild(edit);
  }
  function setGenre(id) {
    if (id === state.genre) return;
    state.genre = id;
    store.set('sw.genre', id);
    state.queue = [];
    document.querySelectorAll('#genres .chip').forEach((c) => {
      c.setAttribute('aria-pressed', String(c.dataset.genre === id));
      if (c.dataset.genre === id) c.classList.remove('dead');
    });
    if (state.started) next(`> SCANNING ${id === 'any' ? 'ALL' : genreLabel(id).toUpperCase()} FREQUENCIES…`);
  }
  function markGenreDead(id) {
    const c = document.querySelector(`#genres .chip[data-genre="${CSS.escape(id)}"]`);
    if (c) c.classList.add('dead');
  }

  // Genre editor: your list (remove) above a catalog of main genres that expand to sub-genres (add).
  function saveGenres() {
    store.set('sw.genres', state.genres);
    if (state.genre !== 'any' && !state.genres.includes(state.genre)) {
      state.genre = 'any';
      store.set('sw.genre', 'any');
      state.queue = [];
    }
    renderGenres();
    renderMyGenres();
    syncCatalog();
    markChanged();
  }
  function toggleGenre(id) {
    state.genres = state.genres.includes(id) ? state.genres.filter((g) => g !== id) : [...state.genres, id];
    saveGenres();
  }
  function renderMyGenres() {
    const box = $('myGenres');
    box.innerHTML = '';
    $('myGenresEmpty').hidden = state.genres.length > 0;
    for (const id of state.genres) {
      const b = document.createElement('button');
      b.className = 'mychip';
      b.innerHTML = `${esc(genreLabel(id))} <span aria-hidden="true">✕</span>`;
      b.setAttribute('aria-label', `Remove ${genreLabel(id)}`);
      b.addEventListener('click', () => toggleGenre(id));
      box.appendChild(b);
    }
  }
  function buildCatalog() {
    const box = $('genreCatalog');
    box.innerHTML = '';
    for (const main of CATALOG) {
      const d = document.createElement('details');
      d.className = 'cat';
      d.innerHTML = `<summary><span class="cat-name">${esc(main.label)}</span><span class="cat-count mono" data-count="${esc(main.id)}"></span></summary>`;
      const subs = document.createElement('div');
      subs.className = 'subs';
      for (const id of [main.id, ...main.subs.map((t) => `tag:${t}`)]) {
        const b = document.createElement('button');
        b.className = 'sub';
        b.dataset.id = id;
        b.textContent = id === main.id ? `All ${main.label}` : genreLabel(id);
        b.addEventListener('click', () => toggleGenre(id));
        subs.appendChild(b);
      }
      d.appendChild(subs);
      box.appendChild(d);
    }
    syncCatalog();
  }
  function syncCatalog() {
    document.querySelectorAll('#genreCatalog .sub').forEach((b) => {
      const on = state.genres.includes(b.dataset.id);
      b.setAttribute('aria-pressed', String(on));
      b.setAttribute('aria-label', `${on ? 'Remove' : 'Add'} ${b.textContent}`);
    });
    for (const main of CATALOG) {
      const n = [main.id, ...main.subs.map((t) => `tag:${t}`)].filter((id) => state.genres.includes(id)).length;
      const el = document.querySelector(`[data-count="${main.id}"]`);
      if (el) el.textContent = n ? `${n} ON LIST` : '';
    }
  }
  function openGenreSheet() {
    renderMyGenres();
    syncCatalog();
    $('genreSheet').hidden = false;
    $('closeGenres').focus();
  }
  function closeGenreSheet() {
    if ($('genreSheet').hidden) return;
    $('genreSheet').hidden = true;
    const active = document.querySelector('#genres .chip[aria-pressed="true"]');
    if (active) active.scrollIntoView({ block: 'nearest', inline: 'center' });
  }
  $('closeGenres').addEventListener('click', closeGenreSheet);
  $('doneGenres').addEventListener('click', closeGenreSheet);
  $('genreSheet').addEventListener('click', (e) => { if (e.target === $('genreSheet')) closeGenreSheet(); });
  $('resetGenres').addEventListener('click', () => { state.genres = [...DEFAULT_GENRES]; saveGenres(); });

  /* ---------- Media Session (lock screen) ---------- */
  function updateMediaSession() {
    if (!('mediaSession' in navigator) || !state.current) return;
    const s = state.current;
    const [artist, ...rest] = (state.title || '').split(/\s+[-–—]\s+/);
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: rest.length ? rest.join(' - ') : (state.title || s.name),
        artist: rest.length ? artist : `${s.city}, ${s.country}`,
        album: `${s.name} · ${s.city}`,
        artwork: s.favicon ? [{ src: s.favicon, sizes: '512x512' }] : [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml' }],
      });
    } catch (_) { /* older browsers */ }
  }
  if ('mediaSession' in navigator) {
    try {
      navigator.mediaSession.setActionHandler('play', () => togglePlay(true));
      navigator.mediaSession.setActionHandler('pause', () => togglePlay(false));
      navigator.mediaSession.setActionHandler('nexttrack', () => next());
      navigator.mediaSession.setActionHandler('previoustrack', () => prev());
    } catch (_) { /* unsupported action */ }
  }

  /* ---------- Controls ---------- */
  function togglePlay(force) {
    if (!state.current) return next();
    const play = force ?? state.paused;
    if (play) {
      // Live radio: reload the stream so playback resumes at "now", not where it paused.
      state.paused = false;
      playUrl(state.current);
      clearInterval(state.timers.poll);
      state.timers.poll = setInterval(pollTitle, POLL_MS);
    } else {
      state.paused = true;
      audio.pause();
      clearTimeout(state.timers.stall);
      setLive(false);
      status('> LINK PAUSED');
    }
    setPlayButton();
  }

  function start(playFirst = true) {
    if (state.started) return;
    state.started = true;
    const boot = $('boot');
    boot.classList.add('gone');
    setTimeout(() => boot.remove(), 500);
    // Unlock audio on iOS inside this tap.
    [plainAudio, corsAudio].forEach((a) => { try { a.play().catch(() => {}); a.pause(); } catch (_) { /* ignore */ } });
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
    if (playFirst) next();
    fillQueue();
  }

  $('jackIn').addEventListener('click', () => start(true));
  $('nextBtn').addEventListener('click', () => (state.started ? next() : start(true)));
  $('prevBtn').addEventListener('click', prev);
  $('playBtn').addEventListener('click', () => togglePlay());
  $('favBtn').addEventListener('click', toggleFavorite);
  $('openFavs').addEventListener('click', () => ($('drawer').hidden ? openDrawer() : closeDrawer()));
  $('closeFavs').addEventListener('click', closeDrawer);
  $('recenter').addEventListener('click', () => { if (state.current) flyTo(state.current); });
  $('showFavDots').checked = state.showFavDots;
  $('showFavDots').addEventListener('change', (e) => { state.showFavDots = e.target.checked; store.set('sw.showFavDots', state.showFavDots); updatePoints(); });
  $('flagTalk').addEventListener('click', () => {
    const s = state.current;
    if (!s) return;
    state.hidden = [...new Set([...state.hidden, s.uuid])].slice(-250);
    store.set('sw.hidden', state.hidden);
    markChanged();
    next('> STATION HIDDEN — RETUNING…');
  });
  document.addEventListener('keydown', (e) => {
    if (e.target.closest('input, textarea')) return;
    if (e.key === 'n' || e.key === 'ArrowRight') next();
    if (e.key === 'p' || e.key === 'ArrowLeft') prev();
    if (e.key === ' ' && !e.target.closest('button')) { e.preventDefault(); togglePlay(); }
    if (e.key === 'f') toggleFavorite();
    if (e.key === 'Escape') { closeGenreSheet(); closeDrawer(); }
  });

  /* ---------- Account & sync ----------
     Sign-in is a one-time code sent by email (a code rather than a link, so it
     works inside the iPhone home-screen app). Saved stations, the genre list
     and hidden stations live in one Supabase row per user; row-level security
     keeps each row private to its owner. */
  let sb = null;
  let user = null;
  let pushTimer = null;
  let pendingEmail = '';

  function snapshot() {
    return { favorites: state.favorites, genres: state.genres, hidden: state.hidden };
  }
  function markChanged() {
    store.set('sw.changedAt', Date.now());
    if (!user) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(push, 1500);
    setSyncState('SAVING…');
  }
  function setSyncState(text) { const el = $('syncState'); if (el) el.textContent = text; }

  function applySettings(row) {
    state.favorites = Array.isArray(row.favorites) ? row.favorites : [];
    if (Array.isArray(row.genres)) state.genres = row.genres.filter((g) => typeof g === 'string');
    state.hidden = Array.isArray(row.hidden) ? row.hidden : [];
    store.set('sw.favorites', state.favorites);
    store.set('sw.genres', state.genres);
    store.set('sw.hidden', state.hidden);
    if (state.genre !== 'any' && !state.genres.includes(state.genre)) { state.genre = 'any'; store.set('sw.genre', 'any'); state.queue = []; }
    renderFavorites(); updatePoints(); setFavButton();
    renderGenres(); renderMyGenres(); syncCatalog();
  }

  // First sign-in on a device: keep everything from both sides.
  function mergeSettings(remote) {
    const byId = new Map();
    for (const f of [...(remote.favorites || []), ...state.favorites]) if (f && f.uuid && !byId.has(f.uuid)) byId.set(f.uuid, f);
    return {
      favorites: [...byId.values()],
      genres: Array.isArray(remote.genres) ? [...new Set([...remote.genres, ...state.genres])] : state.genres,
      hidden: [...new Set([...(remote.hidden || []), ...state.hidden])].slice(-250),
    };
  }

  async function push() {
    if (!sb || !user) return;
    clearTimeout(pushTimer);
    pushTimer = null;
    const { error } = await sb.from('user_settings').upsert({ user_id: user.id, ...snapshot(), updated_at: new Date().toISOString() });
    if (error) { setSyncState('NOT SAVED — WILL RETRY'); pushTimer = setTimeout(push, 15000); return; }
    store.set('sw.syncedAt', Date.now());
    setSyncState('SYNCED');
  }

  async function pull() {
    if (!sb || !user) return;
    setSyncState('SYNCING…');
    const { data, error } = await sb.from('user_settings').select('favorites, genres, hidden, updated_at').eq('user_id', user.id).maybeSingle();
    if (error) { setSyncState('OFFLINE — WILL RETRY'); return; }
    const firstOnDevice = store.get('sw.syncUser', null) !== user.id;
    const localEdits = store.get('sw.changedAt', 0) > store.get('sw.syncedAt', 0);
    if (!data) {
      await push();
    } else if (firstOnDevice) {
      applySettings(mergeSettings(data));
      await push();
      toast('> SIGNALS SYNCED');
    } else if (localEdits) {
      await push(); // changes made here while offline win
    } else {
      applySettings(data);
      store.set('sw.syncedAt', Date.now());
      setSyncState('SYNCED');
    }
    store.set('sw.syncUser', user.id);
  }

  function renderAccount() {
    $('signedIn').hidden = !user;
    $('signedOut').hidden = !!user;
    if (user) $('userEmail').textContent = user.email || 'your account';
  }

  function setUser(u) {
    const changed = (u && u.id) !== (user && user.id);
    user = u || null;
    renderAccount();
    if (user && changed) pull();
  }

  async function initSync() {
    let cfg;
    try { cfg = await (await fetch('/api/config')).json(); } catch (_) { return; }
    if (!cfg || !cfg.sync) return; // sync not set up on this deployment
    await new Promise((resolve, reject) => {
      const sc = document.createElement('script');
      sc.src = 'vendor/supabase.js';
      sc.onload = resolve; sc.onerror = reject;
      document.head.appendChild(sc);
    }).catch(() => null);
    if (!window.supabase || !window.supabase.createClient) return;
    sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'sw.auth' },
    });
    $('account').hidden = false;
    const { data } = await sb.auth.getSession();
    setUser(data.session && data.session.user);
    sb.auth.onAuthStateChange((_event, session) => setUser(session && session.user));
    // Pick up changes made on another device when the app comes back to the front.
    document.addEventListener('visibilitychange', () => { if (!document.hidden && user && !pushTimer) pull(); });
  }

  function authMsg(text, warn = false) {
    const el = $('authMsg');
    el.textContent = text;
    el.classList.toggle('warn', warn);
  }

  $('emailForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!sb) return;
    pendingEmail = $('email').value.trim();
    const btn = e.submitter || $('emailForm').querySelector('button');
    btn.disabled = true;
    const { error } = await sb.auth.signInWithOtp({ email: pendingEmail, options: { shouldCreateUser: true, emailRedirectTo: location.origin } });
    btn.disabled = false;
    if (error) return authMsg(/rate|seconds/i.test(error.message) ? 'Too many codes requested. Wait a minute and try again.' : `Couldn't send the code: ${error.message}`, true);
    $('emailForm').hidden = true;
    $('codeForm').hidden = false;
    $('code').value = '';
    $('code').focus();
    authMsg(`Code sent to ${pendingEmail}. Check your inbox (and spam) and enter it here.`);
  });

  $('codeForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!sb) return;
    const btn = e.submitter || $('codeForm').querySelector('button[type="submit"]');
    btn.disabled = true;
    const { error } = await sb.auth.verifyOtp({ email: pendingEmail, token: $('code').value.trim(), type: 'email' });
    btn.disabled = false;
    if (error) return authMsg('That code didn\'t work. Check it, or send a new one.', true);
    $('codeForm').hidden = true;
    $('emailForm').hidden = false;
    authMsg('Signed in.');
  });

  $('changeEmail').addEventListener('click', () => {
    $('codeForm').hidden = true;
    $('emailForm').hidden = false;
    authMsg('Enter the email to send a code to.');
  });

  $('signOut').addEventListener('click', async () => {
    if (pushTimer) await push();
    await sb.auth.signOut();
    store.set('sw.syncUser', null);
    authMsg('Signed out. Your saved stations stay on this device.');
  });

  // Two taps to delete, so a stray tap can't wipe anything.
  let deleteArmed = null;
  $('deleteData').addEventListener('click', async () => {
    const btn = $('deleteData');
    if (!deleteArmed) {
      btn.textContent = 'TAP AGAIN TO DELETE';
      btn.classList.add('armed');
      deleteArmed = setTimeout(() => { deleteArmed = null; btn.textContent = 'DELETE SYNCED DATA'; btn.classList.remove('armed'); }, 4000);
      return;
    }
    clearTimeout(deleteArmed); deleteArmed = null;
    btn.textContent = 'DELETE SYNCED DATA'; btn.classList.remove('armed');
    const { error } = await sb.from('user_settings').delete().eq('user_id', user.id);
    if (error) return toast('> DELETE FAILED — TRY AGAIN');
    clearTimeout(pushTimer); pushTimer = null;
    await sb.auth.signOut();
    store.set('sw.syncUser', null);
    authMsg('Your synced data was deleted and you are signed out. This device keeps its own copy.');
  });

  /* ---------- Boot ---------- */
  new ResizeObserver(refitAll).observe($('panel'));
  new ResizeObserver(refitAll).observe($('favList'));
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(refitAll);
  renderGenres();
  buildCatalog();
  renderFavorites();
  requestAnimationFrame(drawViz);
  const log = $('bootLog');
  initGlobe().then(() => {
    log.textContent = '> WORLD GRID ONLINE // READY';
    updatePoints();
  });
  fillQueue(); // start vetting while the boot screen is up
  initSync();
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
