/* Neo Earth Radio admin dashboard. Signs in with the same email code as the app,
   then asks /api/admin-stats, which only answers for emails in ADMIN_EMAILS. */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (n) => Number(n || 0).toLocaleString('en-US');
  const flag = (cc) => (cc && /^[A-Z]{2}$/i.test(cc) ? String.fromCodePoint(...[...cc.toUpperCase()].map((c) => 0x1f1a5 + c.charCodeAt(0))) : '');
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York';

  let sb = null;
  let email = '';

  function show(which) {
    for (const id of ['loading', 'signin', 'problem', 'dash']) $(id).hidden = id !== which;
    $('who').hidden = which !== 'dash';
  }
  function problem(title, text, canSwitch) {
    $('problemTitle').textContent = title;
    $('problemText').textContent = text;
    $('problemSignOut').hidden = !canSwitch;
    show('problem');
  }

  async function token() {
    const { data } = await sb.auth.getSession();
    return data.session ? data.session.access_token : null;
  }

  async function load() {
    const t = await token();
    if (!t) return show('signin');
    $('refresh').disabled = true;
    let r, j;
    try {
      r = await fetch(`/api/admin-stats?tz=${encodeURIComponent(tz)}`, { headers: { Authorization: `Bearer ${t}` }, cache: 'no-store' });
      j = await r.json();
    } catch (_) {
      $('refresh').disabled = false;
      return problem("Couldn't reach the server", 'Check your connection and try again.', false);
    }
    $('refresh').disabled = false;
    if (r.status === 401) return show('signin');
    if (r.status === 403) return problem('Not an admin account', j.error || 'This account is not allowed to view the dashboard.', true);
    if (!r.ok) return problem('Setup needed', j.error || `The server answered ${r.status}.`, false);
    $('whoEmail').textContent = j.email;
    render(j.stats);
    renderChecks(j.checks, j.directory);
    renderReports(j.reports);
    show('dash');
  }

  /* ---------- Rendering ---------- */
  function render(s) {
    $('updated').textContent = `updated ${new Date(s.generated_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
    const tiles = [
      { k: 'UNIQUE LISTENERS', v: s.visitors_total, s: `<b>${fmt(s.visitors_7d)}</b> this week · <b>${fmt(s.visitors_today)}</b> today`, hero: true },
      { k: 'PLAYS', v: s.plays_total, s: `<b>${fmt(s.plays_7d)}</b> this week · <b>${fmt(s.plays_today)}</b> today` },
      { k: 'STATIONS HEARD', v: s.stations_total, s: `across <b>${fmt(s.countries_total)}</b> countries` },
      { k: 'ACCOUNTS', v: s.accounts_total, s: `<b>${fmt(s.accounts_7d)}</b> new this week` },
      { k: 'SIGNED-IN LISTENERS', v: s.signed_in_listeners, s: 'accounts that have played a station' },
      { k: 'SYNCED ACCOUNTS', v: s.synced_accounts, s: `<b>${fmt(s.saved_stations_total)}</b> saved stations in total` },
    ];
    $('kpis').innerHTML = tiles.map((t) => `<div class="kpi${t.hero ? ' hero' : ''}"><span class="k">${t.k}</span><span class="v">${fmt(t.v)}</span><span class="s">${t.s}</span></div>`).join('');

    renderChart(s.daily || []);

    const stations = s.top_stations || [];
    const maxS = Math.max(1, ...stations.map((x) => x.plays));
    $('topStations').innerHTML = stations.length ? `<table>
      <thead><tr><th></th><th>STATION</th><th class="n">PLAYS</th><th class="n">LISTENERS</th></tr></thead>
      <tbody>${stations.map((x, i) => `<tr>
        <td class="rank">${i + 1}</td>
        <td>${esc(x.name || 'Unnamed station')}<span class="sub">${flag(x.country_code)} ${esc([x.city, x.country].filter(Boolean).join(', '))}${x.genre ? ` · ${esc(x.genre)}` : ''}</span>
          <span class="meter"><i style="width:${(100 * x.plays) / maxS}%"></i></span></td>
        <td class="n">${fmt(x.plays)}</td><td class="n">${fmt(x.listeners)}</td></tr>`).join('')}</tbody></table>`
      : '<p class="empty">No plays yet. A play counts after 30 seconds of listening.</p>';

    const countries = s.top_countries || [];
    const maxC = Math.max(1, ...countries.map((x) => x.plays));
    $('topCountries').innerHTML = countries.length ? `<table>
      <thead><tr><th>COUNTRY</th><th class="n">PLAYS</th><th class="n">STATIONS</th></tr></thead>
      <tbody>${countries.map((x) => `<tr><td>${flag(x.country_code)} ${esc(x.country || x.country_code)}<span class="meter"><i style="width:${(100 * x.plays) / maxC}%"></i></span></td>
        <td class="n">${fmt(x.plays)}</td><td class="n">${fmt(x.stations)}</td></tr>`).join('')}</tbody></table>`
      : '<p class="empty">No plays yet.</p>';

    const genres = s.top_genres || [];
    const maxG = Math.max(1, ...genres.map((x) => x.plays));
    $('topGenres').innerHTML = genres.length ? `<table>
      <thead><tr><th>GENRE</th><th class="n">PLAYS</th></tr></thead>
      <tbody>${genres.map((x) => `<tr><td>${esc(x.genre)}<span class="meter"><i style="width:${(100 * x.plays) / maxG}%"></i></span></td>
        <td class="n">${fmt(x.plays)}</td></tr>`).join('')}</tbody></table>`
      : '<p class="empty">No plays yet.</p>';

    const recent = s.recent || [];
    $('recent').innerHTML = recent.length ? `<table>
      <thead><tr><th>WHEN</th><th>STATION</th><th>WHERE</th></tr></thead>
      <tbody>${recent.map((x) => `<tr><td class="mono" style="white-space:nowrap;color:var(--dim)">${ago(x.played_at)}</td>
        <td>${esc(x.station_name || 'Unnamed station')}${x.signed_in ? '<span class="tag">SIGNED IN</span>' : ''}</td>
        <td>${flag(x.country_code)} ${esc([x.city, x.country].filter(Boolean).join(', '))}</td></tr>`).join('')}</tbody></table>`
      : '<p class="empty">No plays yet.</p>';
  }

  // WRONG GENRE? reports from listeners, for review. AGREE = the report is
  // right, so the station stops being served for that genre; DISMISS = the
  // station does fit, so nothing changes. To review first, newest first.
  function genreName(id) {
    const t = String(id || '').replace(/^tag:/, '');
    return t.replace(/(^|[\s-])([a-z])/g, (m, a, b) => a + b.toUpperCase());
  }
  const VERDICT = { pending: 'TO REVIEW', approved: 'AGREED · DROPPED', rejected: 'DISMISSED' };
  function renderReports(list) {
    const box = $('reports');
    if (!list) {
      $('reportsTitle').textContent = 'WRONG GENRE REPORTS';
      box.innerHTML = '<p class="note">Run <span class="mono">supabase/migrations/20261113070000_genre_reports.sql</span> in Supabase to start collecting wrong-genre reports.</p>';
      return;
    }
    const order = { pending: 0, approved: 1, rejected: 2 };
    const rows = [...list].sort((a, b) => (order[a.status] - order[b.status]) || (b.created_at > a.created_at ? 1 : -1));
    const waiting = list.filter((x) => x.status === 'pending').length;
    $('reportsTitle').textContent = `WRONG GENRE REPORTS${waiting ? ` · ${waiting} TO REVIEW` : ''}`;
    box.innerHTML = rows.length ? `<table>
      <thead><tr><th>WHEN</th><th>STATION</th><th>PICKED</th><th>SONG</th><th>VERDICT</th></tr></thead>
      <tbody>${rows.map((x) => `<tr${x.status === 'pending' ? '' : ' style="opacity:0.6"'}>
        <td class="mono" style="white-space:nowrap;color:var(--dim)">${ago(x.created_at)}</td>
        <td><a href="/?station=${encodeURIComponent(x.station_uuid)}" target="_blank" rel="noopener" title="Open in the app to listen">${esc(x.station_name || 'Unnamed station')}</a><br>
          <span style="color:var(--dim)">${flag(x.country_code)} ${esc(x.city || '')}${x.station_genre ? ` · tagged ${esc(x.station_genre)}` : ''}</span></td>
        <td>${esc(genreName(x.genre_key))}</td>
        <td>${esc(x.song || '—')}</td>
        <td style="white-space:nowrap">${x.status === 'pending'
          ? `<button class="btn go" type="button" data-review="approved" data-id="${x.id}" title="The station is the wrong genre: stop playing it for ${esc(genreName(x.genre_key))}">AGREE</button>
             <button class="btn" type="button" data-review="rejected" data-id="${x.id}" title="The station does fit: keep it">DISMISS</button>`
          : `<span class="mono" style="color:var(--dim)">${VERDICT[x.status] || x.status}</span>
             <button class="linkbtn" type="button" data-review="pending" data-id="${x.id}">undo</button>`}</td></tr>`).join('')}</tbody></table>
      <p class="note">AGREE stops that station being picked for that genre (it can still come up in others). DISMISS keeps it. Your own reports from the app count straight away. Tap a station name to listen.</p>
      ${list.some((x) => x.status === 'approved') ? `<p style="margin-top:10px"><button class="btn" type="button" id="copyReports">COPY AGREED REPORTS FOR CLAUDE</button>
        <span class="note" id="copyMsg">Paste into a chat with Claude to tune the genre rules, so similar stations are caught too.</span></p>` : ''}`
      : '<p class="empty">No reports yet.</p>';
    lastReports = list;
  }
  let lastReports = [];
  // Plain-text summary of agreed reports, to paste to Claude for tuning the
  // genre rules (aliases, translations, the focus and song checks).
  function reportsForClaude(list) {
    const agreed = list.filter((x) => x.status === 'approved');
    return [
      `NEO // EARTH: ${agreed.length} wrong-genre report${agreed.length === 1 ? '' : 's'} I agreed with. Please tune the genre rules so stations like these aren't picked for these genres.`,
      ...agreed.map((x) => `- Picked: ${genreName(x.genre_key)} (${x.genre_key}) | Station: ${x.station_name || 'Unnamed'} (${[x.city, x.country_code].filter(Boolean).join(', ')}) | matched tag: ${x.station_genre || '?'} | song: ${x.song || '?'} | uuid: ${x.station_uuid} | ${String(x.created_at).slice(0, 10)}`),
    ].join('\n');
  }
  $('reports').addEventListener('click', async (e) => {
    if (e.target.closest('#copyReports')) {
      const text = reportsForClaude(lastReports);
      try { await navigator.clipboard.writeText(text); $('copyMsg').textContent = 'Copied. Paste it into a chat with Claude.'; }
      catch (_) { window.prompt('Copy this for Claude:', text); }
      return;
    }
    const b = e.target.closest('[data-review]');
    if (!b) return;
    b.disabled = true;
    const t = await token();
    if (!t) return show('signin');
    try {
      const r = await fetch('/api/admin-stats', {
        method: 'POST',
        headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'review', ids: [Number(b.dataset.id)], status: b.dataset.review }),
      });
      if (!r.ok) throw new Error();
    } catch (_) {
      b.disabled = false;
      return;
    }
    load();
  });

  // Why stations were turned away, from each checked station's latest result.
  const REASONS = {
    passed: 'Passed every check',
    no_song_titles: 'No song titles in the stream',
    low_quality: 'Stream too weak (low bitrate)',
    slow_or_offline: 'Slow to respond or offline',
    not_audio: 'Not a playable audio stream',
    not_music: 'Talk, news or no music tags',
    no_city: 'No city or town nearby',
    no_coords: 'No map location',
    not_https: 'Not a secure (HTTPS) stream',
    playlist: 'Playlist or HLS stream',
  };
  function renderChecks(c, dir) {
    const box = $('checks');
    const dirFig = dir && dir.stations
      ? `<div class="fig"><span class="k">IN THE DIRECTORY</span><span class="v">${fmt(dir.stations)}</span><span class="s">Radio Browser total${dir.stationsBroken ? ` · <b>${fmt(dir.stationsBroken)}</b> marked broken` : ''}</span></div>`
      : '<div class="fig"><span class="k">IN THE DIRECTORY</span><span class="v">—</span><span class="s">Radio Browser didn\'t answer</span></div>';
    if (!c) {
      box.innerHTML = `<div class="figs">${dirFig}</div><p class="note">Run <span class="mono">supabase/migrations/20261107190000_station_checks.sql</span> in Supabase to start counting check results.</p>`;
      return;
    }
    const pct = c.checked ? Math.round((100 * c.passed) / c.checked) : 0;
    const by = c.by_result || {};
    const rows = Object.keys(REASONS).filter((k) => k !== 'passed' && by[k]).sort((a, b) => by[b] - by[a]);
    const line = (k) => `<div class="reason${k === 'passed' ? ' pass' : ''}"><span class="label">${REASONS[k]}</span>
      <span class="n">${fmt(by[k] || 0)}<small>${c.checked ? Math.round((100 * (by[k] || 0)) / c.checked) : 0}%</small></span>
      <span class="meter"><i style="width:${c.checked ? (100 * (by[k] || 0)) / c.checked : 0}%"></i></span></div>`;
    box.innerHTML = `<div class="figs">
        ${dirFig}
        <div class="fig"><span class="k">CHECKED BY NEO EARTH RADIO</span><span class="v">${fmt(c.checked)}</span><span class="s"><b>${fmt(c.checked_7d)}</b> checked this week</span></div>
        <div class="fig"><span class="k">PASSED EVERY CHECK</span><span class="v" style="color:var(--green)">${fmt(c.passed)}</span><span class="s"><b>${pct}%</b> of checked · in <b>${fmt(c.passed_countries)}</b> countries</span></div>
      </div>
      ${c.checked ? `<div class="reasons">${line('passed')}${rows.length ? '<div class="subhead" style="margin-top:8px">TURNED AWAY BECAUSE</div>' : ''}${rows.map(line).join('')}</div>`
        : '<p class="empty">No stations checked yet. Results appear after the next station search.</p>'}
      <p class="note" style="margin-top:14px">Each station counts once, with its latest result. Only stations Neo Earth Radio has looked at so far are counted, not the whole directory. Slow or offline stations are rechecked after 20 minutes; the rest after 6 hours.</p>`;
  }

  function ago(iso) {
    const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m} min ago`;
    const h = Math.round(m / 60);
    if (h < 24) return `${h} h ago`;
    return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' });
  }

  // Plays per day: one series, so no legend; today's bar in pink; hover for details.
  let chartDays = [];
  function renderChart(days) {
    chartDays = days;
    const box = $('chart');
    if (!days.length) { box.innerHTML = '<p class="empty">No data yet.</p>'; return; }
    // Drawn at the container's real width so text stays readable on phones.
    const W = Math.max(280, Math.round(box.clientWidth || 1000));
    const H = W < 560 ? 200 : 260, L = 34, R = 6, T = 12, B = 30;
    const max = Math.max(...days.map((d) => d.plays));
    const step = niceStep(max);
    const top = Math.max(step * Math.ceil(max / step), step);
    const y = (v) => T + (H - T - B) * (1 - v / top);
    const slot = (W - L - R) / days.length;
    const bw = Math.max(2, slot - 2); // 2px gap between bars
    const ticks = [];
    for (let v = 0; v <= top; v += step) ticks.push(v);
    const label = (iso) => { const d = new Date(`${iso}T12:00:00`); return d.toLocaleDateString([], { month: 'short', day: 'numeric' }); };
    const bars = days.map((d, i) => {
      const x = L + i * slot + 1;
      const h = Math.max(0, y(0) - y(d.plays));
      const r = Math.min(4, bw / 2, h);
      const path = h > 0
        ? `M${x},${y(0)}V${y(0) - h + r}Q${x},${y(0) - h} ${x + r},${y(0) - h}H${x + bw - r}Q${x + bw},${y(0) - h} ${x + bw},${y(0) - h + r}V${y(0)}Z`
        : '';
      return `<g><rect class="hit" x="${L + i * slot}" y="${T}" width="${slot}" height="${H - T - B}" data-i="${i}"></rect>${path ? `<path class="bar${i === days.length - 1 ? ' today' : ''}" d="${path}" data-i="${i}"></path>` : ''}</g>`;
    }).join('');
    // Weekly labels counted back from today, so the last two never collide.
    const xLabels = days.map((d, i) => ((days.length - 1 - i) % 7 === 0)
      ? `<text class="tick" x="${i === days.length - 1 ? W - R : L + i * slot + slot / 2}" y="${H - 8}" text-anchor="${i === days.length - 1 ? 'end' : 'middle'}">${i === days.length - 1 ? 'Today' : label(d.day)}</text>` : '').join('');
    box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Plays per day for the last 30 days">
      ${ticks.map((v) => `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"></line><text class="tick" x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${fmt(v)}</text>`).join('')}
      ${bars}${xLabels}</svg><div class="tip" id="tip" hidden></div>`;

    const tip = $('tip');
    box.querySelectorAll('.hit').forEach((el) => {
      const i = Number(el.dataset.i);
      const d = days[i];
      const on = () => {
        box.querySelectorAll('.bar').forEach((b) => b.classList.toggle('hover', Number(b.dataset.i) === i));
        const rect = box.getBoundingClientRect();
        const er = el.getBoundingClientRect();
        tip.innerHTML = `${label(d.day)}<br><b>${fmt(d.plays)}</b> plays · <b>${fmt(d.visitors)}</b> listeners`;
        tip.hidden = false;
        const x = Math.min(Math.max(er.left - rect.left + er.width / 2, 80), rect.width - 80);
        tip.style.left = `${x}px`;
        tip.style.top = `${Math.max(36, (y(d.plays) / H) * rect.height)}px`;
      };
      el.addEventListener('mouseenter', on);
      el.addEventListener('touchstart', on, { passive: true });
      el.addEventListener('mouseleave', () => { tip.hidden = true; box.querySelectorAll('.bar.hover').forEach((b) => b.classList.remove('hover')); });
    });
  }
  let lastWidth = 0;
  new ResizeObserver(() => {
    const w = Math.round($('chart').clientWidth);
    if (chartDays.length && w && Math.abs(w - lastWidth) > 4) { lastWidth = w; renderChart(chartDays); }
  }).observe($('chart'));

  function niceStep(max) {
    if (max <= 4) return 1;
    const raw = max / 4;
    const p = 10 ** Math.floor(Math.log10(raw));
    return [1, 2, 5, 10].map((m) => m * p).find((s) => s >= raw);
  }

  /* ---------- Sign-in ---------- */
  $('emailForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    email = $('email').value.trim();
    const { error } = await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
    if (error) { $('authMsg').textContent = /signups|not allowed|not found/i.test(error.message) ? 'No account with that email. Sign in once from the app first.' : `Couldn't send the code: ${error.message}`; return; }
    $('emailForm').hidden = true;
    $('codeForm').hidden = false;
    $('code').focus();
    $('authMsg').textContent = `Code sent to ${email}.`;
  });
  $('codeForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const { error } = await sb.auth.verifyOtp({ email, token: $('code').value.trim(), type: 'email' });
    if (error) { $('authMsg').textContent = "That code didn't work. Check it, or send a new one."; return; }
    $('codeForm').hidden = true;
    $('emailForm').hidden = false;
    $('authMsg').textContent = '';
    show('loading');
    load();
  });
  const signOut = async () => { await sb.auth.signOut(); show('signin'); };
  $('signOut').addEventListener('click', signOut);
  $('problemSignOut').addEventListener('click', signOut);
  $('refresh').addEventListener('click', load);

  /* ---------- Start ---------- */
  (async () => {
    let cfg = null;
    try { cfg = await (await fetch('/api/config', { cache: 'no-store' })).json(); } catch (_) { /* below */ }
    if (!cfg || !cfg.sync || !window.supabase) {
      return problem('Setup needed', (cfg && cfg.problem) || 'Sign-in is not set up yet. Add SUPABASE_URL and SUPABASE_ANON_KEY in Vercel.', false);
    }
    // Same storage key as the app, so being signed in there counts here too.
    sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'sw.auth' } });
    load();
  })();
})();
