/* Signal Wave — vibe mode effects.
   A full-screen canvas over the globe with drifting stars, passing ships,
   asteroids and the occasional alien encounter. Everything reacts to the
   music: app.js hands over a levels() function that reports how loud the
   bass is and whether a beat just landed. Purely visual; nothing here
   touches playback. */
(() => {
  'use strict';
  const TAU = Math.PI * 2;
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[(Math.random() * arr.length) | 0];
  const NEON = ['#00f0ff', '#ff3ec8', '#fcee0a', '#39ff14', '#b84dff'];

  let canvas, ctx, w = 0, h = 0, dpr = 1;
  let running = false, raf = 0, last = 0;
  let levels = () => ({ bass: 0, energy: 0, beat: false });
  let stars = [], ships = [], rocks = [], bolts = [], rings = [], ufo = null, texts = [];
  let nextShip = 0, nextRock = 0, nextUfo = 0, pulse = 0;

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = canvas.clientWidth; h = canvas.clientHeight;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    if (!stars.length) stars = Array.from({ length: Math.round(Math.min(140, (w * h) / 7000)) }, () => newStar(true));
  }
  function newStar(anywhere) {
    // Stars stream outward from the centre, like a slow warp.
    const a = rand(0, TAU);
    const d = anywhere ? rand(0, Math.hypot(w, h) / 2) : rand(4, 40);
    return { a, d, s: rand(0.4, 1.4), c: Math.random() < 0.15 ? pick(NEON) : '#ffffff' };
  }

  /* ---------- Spawners ---------- */
  // An entry point on one edge and an exit on the opposite one.
  function crossing(margin) {
    const fromLeft = Math.random() < 0.5;
    const y0 = rand(h * 0.08, h * 0.92), y1 = rand(h * 0.08, h * 0.92);
    return fromLeft
      ? { x: -margin, y: y0, tx: w + margin, ty: y1 }
      : { x: w + margin, y: y0, tx: -margin, ty: y1 };
  }
  function spawnShips(now) {
    const c = crossing(60);
    const ang = Math.atan2(c.ty - c.y, c.tx - c.x);
    const speed = rand(170, 300);
    const color = pick(NEON);
    const size = rand(9, 15);
    const count = Math.random() < 0.3 ? 3 : 1; // sometimes a squadron
    for (let i = 0; i < count; i++) {
      // Formation: a V trailing the leader.
      const back = i === 0 ? 0 : 34, side = i === 0 ? 0 : (i === 1 ? -26 : 26);
      ships.push({
        x: c.x - Math.cos(ang) * back - Math.sin(ang) * side,
        y: c.y - Math.sin(ang) * back + Math.cos(ang) * side,
        vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed,
        ang, size: i ? size * 0.8 : size, color, trail: [], born: now,
      });
    }
  }
  function spawnRock() {
    const c = crossing(80);
    const ang = Math.atan2(c.ty - c.y, c.tx - c.x);
    const speed = rand(25, 70);
    const r = rand(10, 34);
    const n = 9 + ((Math.random() * 4) | 0);
    rocks.push({
      x: c.x, y: c.y, vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed,
      r, rot: rand(0, TAU), spin: rand(-0.8, 0.8),
      shape: Array.from({ length: n }, (_, i) => ({ a: (i / n) * TAU, d: rand(0.68, 1.05) })),
      color: Math.random() < 0.5 ? '#00f0ff' : '#b84dff', hit: 0,
    });
  }
  const UFO_LINES = ['> CONTACT // XENO SIGNAL', '> UNIDENTIFIED LISTENER', '> THEY LIKE THIS SONG', '> ABDUCTING BASSLINE…', '> GREETINGS, EARTH DJ', '> TRANSMISSION INTERCEPTED'];
  function spawnUfo(now) {
    const fromLeft = Math.random() < 0.5;
    const hoverX = w / 2 + rand(-w * 0.18, w * 0.18);
    const hoverY = h * rand(0.16, 0.3);
    ufo = {
      x: fromLeft ? -80 : w + 80, y: hoverY - 60,
      hx: hoverX, hy: hoverY, exitX: fromLeft ? w + 120 : -120, exitY: -80,
      phase: 'in', t: 0, born: now, beam: 0, wob: rand(0, TAU), lights: 0,
    };
  }
  function say(text, x, y, color) { texts.push({ text, x, y, color, t: 0 }); }

  /* ---------- Frame ---------- */
  function frame(now) {
    if (!running) return;
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - (last || now)) / 1000);
    last = now;
    const lv = levels();
    if (lv.beat) {
      pulse = 1;
      if (rings.length < 4) rings.push({ r: Math.min(w, h) * 0.28, a: 0.55 });
      if (ufo) ufo.lights = 1;
      // Ships on screen fire on the beat.
      ships.forEach((s) => {
        if (s.x > 0 && s.x < w && Math.random() < 0.5) {
          bolts.push({ x: s.x, y: s.y, vx: Math.cos(s.ang) * 720, vy: Math.sin(s.ang) * 720, c: s.color, life: 0.9 });
        }
      });
      // A loud beat can call in ships early.
      if (lv.bass > 0.55 && now > nextShip - 2500) nextShip = now;
    }
    pulse = Math.max(0, pulse - dt * 3.5);

    if (now > nextShip) { spawnShips(now); nextShip = now + rand(3500, 8000) * (1.2 - lv.energy * 0.6); }
    if (now > nextRock && rocks.length < 4) { spawnRock(); nextRock = now + rand(5000, 11000); }
    if (!ufo && now > nextUfo) { spawnUfo(now); nextUfo = now + rand(26000, 48000); }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'lighter';
    const cx = w / 2, cy = h / 2;

    // Stars: warp speed rises with the music.
    const warp = 18 + lv.energy * 90 + pulse * 140;
    for (let i = 0; i < stars.length; i++) {
      const s = stars[i];
      const prevD = s.d;
      s.d += warp * s.s * dt * (0.4 + s.d / 300);
      const x = cx + Math.cos(s.a) * s.d, y = cy + Math.sin(s.a) * s.d;
      if (x < -20 || x > w + 20 || y < -20 || y > h + 20) { stars[i] = newStar(false); continue; }
      const px = cx + Math.cos(s.a) * prevD, py = cy + Math.sin(s.a) * prevD;
      ctx.strokeStyle = s.c;
      ctx.globalAlpha = Math.min(1, 0.2 + s.d / 400);
      ctx.lineWidth = s.s;
      ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(x + (x - px) * 0.5, y + (y - py) * 0.5); ctx.stroke();
    }

    // Beat rings around the globe.
    for (let i = rings.length - 1; i >= 0; i--) {
      const r = rings[i];
      r.r += dt * 260; r.a -= dt * 0.7;
      if (r.a <= 0) { rings.splice(i, 1); continue; }
      ctx.globalAlpha = r.a;
      ctx.strokeStyle = '#ff3ec8'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(cx, cy, r.r, 0, TAU); ctx.stroke();
    }

    // Asteroids.
    for (let i = rocks.length - 1; i >= 0; i--) {
      const r = rocks[i];
      r.x += r.vx * dt; r.y += r.vy * dt; r.rot += r.spin * dt; r.hit = Math.max(0, r.hit - dt * 3);
      if (r.x < -120 || r.x > w + 120) { rocks.splice(i, 1); continue; }
      const swell = 1 + pulse * 0.06;
      ctx.globalAlpha = 0.55 + r.hit * 0.45;
      ctx.strokeStyle = r.hit ? '#fcee0a' : r.color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      r.shape.forEach((p, k) => {
        const x = r.x + Math.cos(p.a + r.rot) * p.d * r.r * swell, y = r.y + Math.sin(p.a + r.rot) * p.d * r.r * swell;
        k ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      });
      ctx.closePath(); ctx.stroke();
      ctx.globalAlpha = 0.08 + r.hit * 0.2; ctx.fillStyle = r.color; ctx.fill();
    }

    // Laser bolts; they light up any asteroid they pass through.
    for (let i = bolts.length - 1; i >= 0; i--) {
      const b = bolts[i];
      b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt;
      if (b.life <= 0) { bolts.splice(i, 1); continue; }
      rocks.forEach((r) => { if (Math.hypot(r.x - b.x, r.y - b.y) < r.r) { r.hit = 1; b.life = 0; } });
      ctx.globalAlpha = Math.min(1, b.life * 2);
      ctx.strokeStyle = b.c; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(b.x - b.vx * 0.03, b.y - b.vy * 0.03); ctx.stroke();
    }

    // Ships with glowing engine trails.
    for (let i = ships.length - 1; i >= 0; i--) {
      const s = ships[i];
      s.x += s.vx * dt; s.y += s.vy * dt;
      s.trail.push({ x: s.x, y: s.y }); if (s.trail.length > 18) s.trail.shift();
      if (s.x < -200 || s.x > w + 200) { ships.splice(i, 1); continue; }
      for (let k = 1; k < s.trail.length; k++) {
        ctx.globalAlpha = (k / s.trail.length) * (0.35 + pulse * 0.4);
        ctx.strokeStyle = s.color; ctx.lineWidth = (k / s.trail.length) * 3;
        ctx.beginPath(); ctx.moveTo(s.trail[k - 1].x, s.trail[k - 1].y); ctx.lineTo(s.trail[k].x, s.trail[k].y); ctx.stroke();
      }
      ctx.save();
      ctx.translate(s.x, s.y); ctx.rotate(s.ang);
      const z = s.size;
      ctx.globalAlpha = 1; ctx.strokeStyle = s.color; ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(z, 0); ctx.lineTo(-z * 0.8, -z * 0.6); ctx.lineTo(-z * 0.4, 0); ctx.lineTo(-z * 0.8, z * 0.6);
      ctx.closePath(); ctx.stroke();
      ctx.globalAlpha = 0.25; ctx.fillStyle = s.color; ctx.fill();
      // Thruster flicker that kicks with the bass.
      ctx.globalAlpha = 0.9; ctx.fillStyle = '#fcee0a';
      const flame = z * (0.35 + lv.bass * 0.9 + Math.random() * 0.2);
      ctx.beginPath(); ctx.moveTo(-z * 0.45, -z * 0.18); ctx.lineTo(-z * 0.45 - flame, 0); ctx.lineTo(-z * 0.45, z * 0.18); ctx.fill();
      ctx.restore();
    }

    // The alien encounter: flies in, hovers and beams the globe in time with the music, then leaves.
    if (ufo) {
      const u = ufo;
      u.t += dt; u.wob += dt * 2.2; u.lights = Math.max(0, u.lights - dt * 3);
      if (u.phase === 'in') {
        u.x += (u.hx - u.x) * Math.min(1, dt * 1.6); u.y += (u.hy - u.y) * Math.min(1, dt * 1.6);
        if (Math.hypot(u.hx - u.x, u.hy - u.y) < 4) { u.phase = 'hover'; u.t = 0; say(pick(UFO_LINES), u.hx, u.hy - 40, '#39ff14'); }
      } else if (u.phase === 'hover') {
        u.beam = Math.min(1, u.beam + dt * 2);
        if (u.t > 7) { u.phase = 'out'; u.t = 0; }
      } else {
        u.beam = Math.max(0, u.beam - dt * 4);
        const k = Math.min(1, u.t / 1.2);
        u.x += (u.exitX - u.x) * k * dt * 4; u.y += (u.exitY - u.y) * k * dt * 4;
        if (u.t > 2.5) ufo = null;
      }
      const ux = u.x + Math.sin(u.wob) * 6, uy = u.y + Math.cos(u.wob * 1.3) * 4;
      if (u.beam > 0) {
        const len = Math.max(40, cy - uy);
        const spread = 60 + lv.bass * 50;
        const g = ctx.createLinearGradient(ux, uy, ux, uy + len);
        g.addColorStop(0, 'rgba(57,255,20,0.5)'); g.addColorStop(1, 'rgba(57,255,20,0)');
        ctx.globalAlpha = u.beam * (0.45 + lv.bass * 0.55);
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.moveTo(ux - 10, uy + 6); ctx.lineTo(ux + 10, uy + 6); ctx.lineTo(ux + spread, uy + len); ctx.lineTo(ux - spread, uy + len); ctx.closePath(); ctx.fill();
      }
      ctx.globalAlpha = 1;
      // Dome with a little alien inside.
      ctx.strokeStyle = '#00f0ff'; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.arc(ux, uy - 4, 12, Math.PI, 0); ctx.stroke();
      ctx.fillStyle = '#39ff14'; ctx.globalAlpha = 0.9;
      ctx.beginPath(); ctx.ellipse(ux, uy - 8, 4.5, 5.5, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#000'; ctx.globalCompositeOperation = 'source-over';
      ctx.beginPath(); ctx.ellipse(ux - 1.8, uy - 9, 1.4, 2, -0.4, 0, TAU); ctx.ellipse(ux + 1.8, uy - 9, 1.4, 2, 0.4, 0, TAU); ctx.fill();
      ctx.globalCompositeOperation = 'lighter';
      // Saucer body.
      ctx.globalAlpha = 1; ctx.strokeStyle = '#ff3ec8'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(ux, uy + 2, 30, 8, 0, 0, TAU); ctx.stroke();
      ctx.globalAlpha = 0.2; ctx.fillStyle = '#ff3ec8'; ctx.fill();
      // Rim lights chase around and flash on the beat.
      for (let k = 0; k < 7; k++) {
        const a = (k / 7) * TAU + u.t * 3;
        const on = (Math.sin(a * 2 + u.t * 6) > 0.3) || u.lights > 0.4;
        ctx.globalAlpha = on ? 1 : 0.25;
        ctx.fillStyle = k % 2 ? '#fcee0a' : '#00f0ff';
        ctx.beginPath(); ctx.arc(ux + Math.cos(a) * 24, uy + 2 + Math.sin(a) * 5, 2 + u.lights * 1.5, 0, TAU); ctx.fill();
      }
    }

    // Floating messages from the visitors.
    ctx.globalCompositeOperation = 'source-over';
    ctx.font = '600 12px "Share Tech Mono", ui-monospace, Menlo, monospace';
    ctx.textAlign = 'center';
    for (let i = texts.length - 1; i >= 0; i--) {
      const t = texts[i];
      t.t += dt;
      if (t.t > 4) { texts.splice(i, 1); continue; }
      const shown = t.text.slice(0, Math.ceil(t.text.length * Math.min(1, t.t * 2.5)));
      ctx.globalAlpha = t.t > 3.2 ? (4 - t.t) / 0.8 : (Math.random() < 0.06 ? 0.4 : 1);
      ctx.fillStyle = t.color;
      ctx.fillText(shown, Math.min(w - 90, Math.max(90, t.x)), t.y);
    }
    ctx.globalAlpha = 1;
  }

  window.SignalVibes = {
    start(canvasEl, levelsFn) {
      canvas = canvasEl; ctx = canvas.getContext('2d');
      if (levelsFn) levels = levelsFn;
      resize();
      if (running) return;
      running = true; last = 0;
      const now = performance.now();
      nextShip = now + 1200; nextRock = now + 600; nextUfo = now + rand(9000, 16000);
      window.addEventListener('resize', resize);
      raf = requestAnimationFrame(frame);
    },
    stop() {
      running = false;
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      ships = []; rocks = []; bolts = []; rings = []; texts = []; ufo = null;
      if (ctx) { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height); }
    },
  };
})();
