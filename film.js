// The film of the example: one chat on Claude Haiku 5.5 (the data and the scenes: haiku-run.js, made by src/make.py; the
// voice and the time of each sentence: voice.opus, voice.m4a and haiku-voice.js, made by src/voice.py).
// Every frame is a function of one number, the time of the film in seconds: where the picture looks (the camera), how
// many requests are drawn, which of the two pictures shows (the size of each request, or the measures), and the caption.
// So the bar, a drag on the picture and the voice all move the same clock. A drag that is thrown glides on at the speed
// of the hand and a spring stops it. It plays once, without sound, when it comes into view; the Sound button turns the
// voice on. prefers-reduced-motion: it does not start by itself, and shows its last frame.
(function () {
  "use strict";
  const D = window.HAIKU_RUN, host = document.getElementById("film");
  if (!D || !host || !D.scenes) return;
  const V = window.HAIKU_VOICE || null, R = D.req, N = R.length, A = D.ace, SC = D.scenes, M = D.sum, STEP = D.step, YMAX = 140000;
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const css = n => getComputedStyle(document.documentElement).getPropertyValue("--" + n).trim();
  const C = {hit: css("explorer"), write: css("halo"), agent: css("climb"), over: css("takedown"), lock: css("bottom"),
    text: css("text"), muted: css("muted"), edge: css("edge"), card: css("card"), ground: css("ground")};
  const FONT = "12px ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif", BOLD = "700 " + FONT;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v)), lerp = (a, b, u) => a + (b - a) * u;
  const ease = u => { u = clamp(u, 0, 1); return u * u * u * (u * (6 * u - 15) + 10); };  // no jerk at either end
  const n0 = x => Math.round(x).toLocaleString("en-US");
  const kfmt = x => x >= 1e6 ? (x / 1e6).toFixed(1) + "M" : Math.round(x / 1000) + "k";
  const money = x => "$" + (x >= 1 ? x.toFixed(2) : x >= 0.05 ? x.toFixed(3) : x.toFixed(4));
  const mmss = s => Math.floor(s / 60) + ":" + String(Math.floor(s % 60)).padStart(2, "0");
  const sentences = s => { const out = [], q = s.split(/([.!?])\s+/); for (let i = 0; i < q.length; i += 2) out.push(q[i] + (q[i + 1] || "")); return out.filter(Boolean); };

  // The times: of the voice when it is there, else 15 characters a second.
  const TM = (() => {
    if (V && V.scenes && V.scenes.length === SC.length) return {total: V.total, scenes: V.scenes, cues: V.cues};
    const scenes = [], cues = [];
    let at = 0.4;
    SC.forEach((s, n) => {
      const t0 = at;
      for (const part of sentences(s.say)) { const d = Math.max(1.2, part.length / 15); cues.push([at, at + d, n, part]); at += d; }
      at += 0.55; scenes.push([t0, at]);
    });
    return {total: at, scenes, cues};
  })();
  // the file of the voice: the first one that this browser says it can play
  const SRC = (() => {
    if (!V) return "";
    const a = document.createElement("audio");
    for (const [src, type] of V.srcs || []) if (a.canPlayType && a.canPlayType(type)) return src;
    return V.src || "";
  })();
  const T = TM.total, SS = SC.map((s, n) => TM.cues.filter(c => c[2] === n).map(c => c[0]));
  const said = (n, k) => SS[n].length ? SS[n][Math.min(k, SS[n].length - 1)] : TM.scenes[n][0];  // when sentence k of scene n starts
  // running sums: after k requests
  const S = [{paid: 0, unc: 0, cr: 0, tok: 0, over: 0, overUsd: 0}];
  for (const r of R) {
    const p = S[S.length - 1], tok = r[1] + r[2] + r[3], big = tok > STEP;
    S.push({paid: p.paid + r[6] / 1e6, unc: p.unc + r[7] / 1e6, cr: p.cr + r[1], tok: p.tok + tok, over: p.over + (big ? 1 : 0), overUsd: p.overUsd + (big ? r[6] / 1e6 : 0)});
  }
  // the top of the strip for each scene: the largest unfolded size that its camera shows
  const TOP = SC.map(s => Math.max(150000, 1.15 * Math.max.apply(null, A.filter(a => a[0] >= s.cam[0] - 1 && a[0] <= s.cam[1]).map(a => a[1]).concat([0]))));

  // -- the page: the picture, the bar, the numbers, the caption
  host.textContent = "";
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const cvs = el("canvas"), g = cvs.getContext("2d");
  cvs.setAttribute("role", "img");
  cvs.setAttribute("aria-label", "A film of the " + N + " requests of the chat: each request as a column of tokens read from the cache and tokens written to it, against the price step at 100,000 tokens; then the measures. Its words are under it, and the table below has the totals.");
  const cap = el("p", "film-cap", "");
  const bar = el("div", "film-bar"), btn = el("button", "film-play", "Play"), snd = el("button", "film-play film-snd", "Sound: off"), rng = el("input"), where = el("span", "film-where");
  btn.type = snd.type = "button"; snd.setAttribute("aria-pressed", "false"); snd.hidden = !(SRC && TM.cues === V.cues);
  rng.type = "range"; rng.min = 0; rng.max = T.toFixed(2); rng.step = 0.05; rng.value = 0; rng.setAttribute("aria-label", "Time of the film, in seconds");
  bar.append(btn, snd, rng, where);
  const nums = el("dl", "film-nums"), cell = {};
  for (const [k, label] of [["hit", "input tokens read from the cache"], ["paid", "paid so far"], ["unc", "the same tokens with no cache"], ["over", "requests over 100,000"]]) {
    const d = el("div"); cell[k] = el("dd", null, ""); d.append(cell[k], el("dt", null, label)); nums.append(d);
  }
  const key = el("p", "film-key");
  for (const [c, label] of [[C.hit, "read from the cache"], [C.write, "written to the cache"], [C.agent, "a second agent on the same session"], [C.over, "the price step: 5 times the price above it"]]) {
    const s = el("span"), i = el("i"); i.style.background = c; s.append(i, document.createTextNode(label)); key.append(s);
  }
  const words = el("details", "film-words"); words.append(el("summary", null, "The words of the film"));
  for (const s of SC) words.append(el("p", null, s.say));
  host.append(cvs, cap, bar, nums, key, words);

  let W = 0, H = 0, dpr = 1, t = still ? T : 0, playing = false, sound = false, audio = null, raf = 0, last = 0;
  let goal = null, vel = 0;  // a glide after a thrown drag: the time that the clock goes to (null: at rest) and its speed (film seconds a second)
  const G = {l: 44, r: 10, top: 8, strip: 54, gap: 26, bottom: 20};
  const plot = () => ({x0: G.l, x1: W - G.r, y0: G.top + G.strip + G.gap, y1: H - G.bottom});

  // -- the frame at a time
  function stateAt(at) {
    let n = 0;
    while (n + 1 < SC.length && TM.scenes[n + 1][0] <= at) n++;
    const s = SC[n], s0 = TM.scenes[n][0], s1 = TM.scenes[n][1], pre = SC[Math.max(0, n - 1)], move = Math.min(1.8, 0.45 * (s1 - s0));
    const u = ease((at - s0) / move), w0 = pre.cam[1] - pre.cam[0], w1 = s.cam[1] - s.cam[0];
    // the camera: the width changes by a ratio, and the middle moves with the width (the place it goes to stays in the picture)
    const w = Math.exp(lerp(Math.log(w0), Math.log(w1), u)), c0 = (pre.cam[0] + pre.cam[1]) / 2, c1 = (s.cam[0] + s.cam[1]) / 2;
    const c = Math.abs(w1 - w0) < 1e-6 ? lerp(c0, c1, u) : c1 + (c0 - c1) * (w - w1) / (w0 - w1);
    const p = lerp(s.p[0], s.p[1], ease((at - s0 - move * 0.5) / Math.max(0.5, s1 - s0 - move * 0.5 - 0.8)));
    const m = lerp(pre.k === "measures" ? 1 : 0, s.k === "measures" ? 1 : 0, ease((at - s0) / 0.9));
    const glow = s.k === "step" ? ease((at - s0) / 0.7) * (1 - ease((at - s1 + 0.7) / 0.7)) : 0;
    return {n, s0, s1, cam: [c - w / 2, c + w / 2], p, m, glow, top: Math.exp(lerp(Math.log(TOP[Math.max(0, n - 1)]), Math.log(TOP[n]), u))};
  }

  function drawSize(st, alpha) {
    const P = plot(), pw = P.x1 - P.x0, ph = P.y1 - P.y0, a = st.cam[0], b = st.cam[1], cw = pw / (b - a);
    const X = i => P.x0 + (i - a) * cw, Y = v => P.y1 - v / YMAX * ph, al = x => { g.globalAlpha = alpha * x; };
    g.textBaseline = "middle"; g.font = FONT;
    // above the step: where a request pays the high price
    al(0.09 + 0.17 * st.glow); g.fillStyle = C.over; g.fillRect(P.x0, P.y0, pw, Y(STEP) - P.y0);
    al(1); g.strokeStyle = C.edge; g.lineWidth = 1; g.fillStyle = C.muted; g.textAlign = "right";
    for (const v of [0, 50000]) { g.beginPath(); g.moveTo(P.x0, Math.round(Y(v)) + 0.5); g.lineTo(P.x1, Math.round(Y(v)) + 0.5); g.stroke(); g.fillText(v ? "50k" : "0", P.x0 - 6, Y(v)); }
    g.fillStyle = C.over; g.fillText("100k", P.x0 - 6, Y(STEP));
    g.save(); g.beginPath(); g.rect(P.x0, 0, pw, H); g.clip();
    // the requests so far; the newest one grows
    const wide = cw >= 3, bw = wide ? cw * 0.8 : Math.max(1, cw), xo = wide ? cw * 0.1 : 0;
    for (let i = Math.max(0, Math.floor(a) - 1), end = Math.min(N, Math.ceil(st.p), Math.ceil(b) + 1); i < end; i++) {
      const r = R[i], f = clamp(st.p - i, 0, 1), up = 1 - Math.pow(1 - f, 3), tok = r[1] + r[2] + r[3], x = X(i) + xo, yr = Y(r[1] * up), yt = Y(tok * up);
      if (r[5]) {
        al(wide ? 0.55 : 1); g.fillStyle = C.agent; g.fillRect(x - (wide ? 0 : 0.5), yr, bw + (wide ? 0 : 1), P.y1 - yr);
        al(1); g.fillRect(x - (wide ? 0 : 0.5), yt, bw + (wide ? 0 : 1), yr - yt);
        if (tok > STEP) { g.fillStyle = C.over; g.fillRect(x - 1.5, yt - 3, bw + 3, 3); }
      } else {
        al(1); g.fillStyle = C.hit; g.fillRect(x, yr, bw, P.y1 - yr);
        g.fillStyle = C.write; g.fillRect(x, yt, bw, yr - yt);
      }
      if (cw > 46 && f >= 1 && x >= P.x0 && x + bw <= P.x1) { al(clamp((cw - 46) / 12, 0, 1)); g.fillStyle = C.muted; g.textAlign = "center"; g.fillText(kfmt(tok), x + bw / 2, yt - 9 - (r[5] && tok > STEP ? 3 : 0)); }
    }
    // the ceiling that breadcrumbs holds, and the step of the price
    al(0.7); g.strokeStyle = C.lock; g.beginPath(); g.moveTo(P.x0, Y(D.ceiling)); g.lineTo(P.x1, Y(D.ceiling)); g.stroke();
    al(1); g.strokeStyle = C.over; g.setLineDash([6, 4]); g.lineWidth = 1.5; g.beginPath(); g.moveTo(P.x0, Y(STEP)); g.lineTo(P.x1, Y(STEP)); g.stroke(); g.setLineDash([]); g.lineWidth = 1;
    // the notes of the scene: each comes with its sentence. A note goes above its column; one that would cover another goes higher,
    // and one with no room above goes beside its column.
    const notes = [];
    g.font = BOLD;
    for (const [k, i, text] of SC[st.n].notes) {
      const on = ease((t - said(st.n, k)) / 0.45) * (1 - ease((t - st.s1 + 0.4) / 0.4));
      if (on < 0.01) continue;
      const r = R[i], top = Y(r[1] + r[2] + r[3]), x = X(i + 0.5), w = Math.round(g.measureText(text).width + 16), h = 22, half = Math.max(cw / 2, 3);
      const hits = (bx, by) => notes.some(q => bx < q.bx + q.w + 4 && q.bx < bx + w + 4 && by < q.by + q.h + 4 && q.by < by + h + 4);
      let bx = clamp(x - w / 2, P.x0 + 2, P.x1 - w - 2), by = top - 14 - h, side = false, tip = top - 3;
      if (cw > 46) {  // the columns carry their numbers here: the note clears the tallest column that it spans, and its number
        let high = top;
        for (let j = Math.max(0, Math.floor(a + (bx - P.x0) / cw)), e = Math.min(N - 1, Math.floor(a + (bx + w - P.x0) / cw)); j <= e; j++) if (j < st.p) high = Math.min(high, Y(R[j][1] + R[j][2] + R[j][3]));
        by = high - 22 - h; tip = top - 20;
      }
      while (by >= P.y0 && hits(bx, by)) by -= h + 4;
      if (by < P.y0) { side = true; bx = clamp(x + half + 10, P.x0 + 2, P.x1 - w - 2); by = top + 2; while (hits(bx, by)) by += h + 4; }
      notes.push({on, text, x, top: tip, bx, by, w, h, side, half});
    }
    g.font = FONT;
    const narrow = W < 700, stepText = narrow ? "over 100,000: 5x the price" : "over 100,000 tokens a request pays 5 times the price";
    const lw = g.measureText(stepText).width, ly = Y(STEP) - 11;
    const hid = Math.max(narrow ? st.glow : 0, ...notes.filter(q => q.bx + q.w > P.x1 - 8 - lw && q.by < ly + 10 && q.by + q.h > ly - 10).map(q => q.on));
    al(1 - hid); g.textAlign = "right"; g.fillStyle = C.over; g.fillText(stepText, P.x1 - 4, ly);
    if (st.glow > 0.01) {  // the two prices, while the film speaks of the step
      al(st.glow); g.textAlign = "left"; g.font = BOLD;
      g.fillStyle = C.over; g.fillText("$0.50 in, $2.50 out per million tokens", P.x0 + 8, Y(STEP) - 11);
      g.fillStyle = C.lock; g.fillText("$0.10 in, $0.50 out per million tokens", P.x0 + 8, Y(D.ceiling) + 12);  // under the line of the ceiling, not on it
      g.font = FONT;
    }
    g.font = BOLD;
    for (const q of notes) {
      const by = q.by + (q.side ? 0 : (1 - q.on) * 6);
      al(q.on * 0.8); g.strokeStyle = C.text; g.beginPath();
      if (q.side) { g.moveTo(q.x + q.half, by + q.h / 2); g.lineTo(q.bx, by + q.h / 2); } else { g.moveTo(q.x, q.top); g.lineTo(q.x, by + q.h); }
      g.stroke();
      al(q.on); g.fillStyle = C.ground; g.strokeStyle = C.edge; g.beginPath(); g.rect(Math.round(q.bx) + 0.5, Math.round(by) + 0.5, q.w, q.h); g.fill(); g.stroke();
      g.fillStyle = C.text; g.textAlign = "left"; g.fillText(q.text, q.bx + 8, by + q.h / 2 + 1);
    }
    g.font = FONT;
    // the strip on top: the chat with nothing folded (the engine's estimate) against what was sent
    const sy0 = G.top, sy1 = G.top + G.strip, SY = v => sy1 - Math.min(1, v / st.top) * (sy1 - sy0 - 16);
    let lastA = null;
    const title = W < 560 ? "the chat with nothing folded" : "the whole chat with nothing folded (the context engine's estimate)";
    for (const [color, col] of [[C.muted, 1], [C.lock, 2]]) {
      al(1); g.strokeStyle = color; g.lineWidth = 1.5; g.beginPath();
      let on = false;
      for (const q of A) { if (q[0] >= st.p) break; const x = X(q[0] + 0.5), y = SY(q[col]); if (on) g.lineTo(x, y); else { g.moveTo(x, y); on = true; } if (col === 1 && q[0] + 0.5 <= b) lastA = q; }
      g.stroke();
    }
    g.lineWidth = 1;
    if (lastA && lastA[1] > 110000) {
      const x = clamp(X(lastA[0] + 0.5), P.x0, P.x1), flip = x > P.x1 - 150;
      al(1); g.textAlign = flip ? "right" : "left";
      const ry = SY(lastA[1]), above = ry - 9 >= sy0 + (x < P.x0 + 60 + g.measureText(title).width ? 22 : 8);  // not on the title of the strip
      g.fillStyle = C.text; g.fillText(kfmt(lastA[1]), x + (flip ? -6 : 6), above ? ry - 9 : Math.min(ry + 10, sy1 - 8));
      g.fillStyle = C.lock; g.fillText("sent: " + kfmt(lastA[2]), x + (flip ? -6 : 6), sy1 + 11);
    }
    g.restore();
    al(1); g.strokeStyle = C.edge; g.beginPath(); g.moveTo(P.x0, sy1 + 0.5); g.lineTo(P.x1, sy1 + 0.5); g.stroke();
    g.textAlign = "left"; g.fillStyle = C.muted;
    g.fillText(title, P.x0 + 4, sy0 + 6);
    // the requests under the picture
    const span = b - a, step = [1, 2, 5, 10, 20, 50, 100, 200, 500].find(s => span / s <= (W < 560 ? 5 : 9)) || 500;
    g.textAlign = "center";
    for (let v = Math.ceil(Math.max(1, a + 0.5) / step) * step; v <= Math.min(N, b); v += step) { const x = X(v - 0.5); if (x > P.x0 + 30 && x < P.x1 - 12) g.fillText(String(v), x, H - 8); }
    g.textAlign = "left"; g.fillText("request", P.x0 - 40, H - 8);
    g.globalAlpha = 1;
  }

  function drawMeasures(st, alpha) {
    const n = SC.findIndex(s => s.k === "measures"), x0 = 18, x1 = W - 18, w = x1 - x0, rowH = (H - 20) / 3, bh = clamp(rowH * 0.17, 12, 24);
    const al = x => { g.globalAlpha = alpha * clamp(x, 0, 1); }, grow = (k, d) => ease((t - said(n, k)) / (d || 1.1));
    const head = (row, text) => { al(1); g.font = BOLD; g.fillStyle = C.muted; g.textAlign = "left"; g.fillText(text.toUpperCase(), x0, 14 + row * rowH + 8); g.font = FONT; };
    const track = y => { al(0.5); g.fillStyle = C.ground; g.fillRect(x0, y, w, bh); };
    const label = (y, color, text, on, right) => { al(on); g.fillStyle = color; g.textAlign = right ? "right" : "left"; g.font = BOLD; g.fillText(text, right ? x1 : x0, y); g.font = FONT; };
    g.textBaseline = "middle";
    // 1. where the input tokens came from
    let y = 14 + 26, a = grow(1, 1.3);
    head(0, "Input tokens of all " + n0(M.n) + " requests");
    track(y); al(1); g.fillStyle = C.hit; g.fillRect(x0, y, w * M.hit * a, bh);
    g.fillStyle = C.write; g.fillRect(x0 + w * M.hit * a, y, w * M.write * a, bh);
    label(y + bh + 13, C.hit, (100 * M.hit * a).toFixed(1) + "% read from the cache", a * 3);
    label(y + bh + 13, C.write, (W < 560 ? "" : (100 * M.write * a).toFixed(1) + "% ") + "written", a * 3, true);
    // 2. the bill, and the same tokens with no cache
    y = 14 + rowH + 26; a = grow(2); const u = grow(3), gapY = bh + 26;
    head(1, "The bill: input, cache and output");
    track(y); al(1); g.fillStyle = C.lock; g.fillRect(x0, y, w * M.paid / M.unc * a, bh);
    label(y + bh + 12, C.lock, "$" + (M.paid * a).toFixed(2) + " paid", a * 3);
    if (rowH >= 2 * bh + 78) { track(y + gapY); al(1); g.fillStyle = C.muted; g.fillRect(x0, y + gapY, w * u, bh); label(y + gapY + bh + 12, C.text, "$" + (M.unc * u).toFixed(2) + " for the same tokens with no cache", u * 3); }
    else { al(u); g.strokeStyle = C.muted; g.lineWidth = 2; g.strokeRect(x0 + 1, y + 1, (w - 2) * u, bh - 2); g.lineWidth = 1; label(y + bh + 12, C.text, "$" + (M.unc * u).toFixed(2) + " with no cache", u * 3, true); }
    // 3. the requests over the step: their share of the requests, and of the bill (both bars on one scale, 0 to 20%)
    y = 14 + 2 * rowH + 26; a = grow(4);
    head(2, "The " + M.over_n + " requests over 100,000 tokens");
    const sc = 0.2;
    track(y); al(1); g.fillStyle = C.over; g.fillRect(x0, y, w * M.over_bill / sc * a, bh);
    al(a); g.fillStyle = C.text; g.fillRect(x0, y, Math.max(2, w * M.over_req / sc * a), bh);
    label(y + bh + 12, C.text, (100 * M.over_req * a).toFixed(1) + "% of the requests", a * 3);
    label(y + bh + 12, C.over, (100 * M.over_bill * a).toFixed(1) + "% of the bill", a * 3, true);
    g.globalAlpha = 1;
  }

  function paint() {
    const st = stateAt(t), k = clamp(Math.floor(st.p + 1e-6), 0, N);
    g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
    if (st.m < 0.99) drawSize(st, 1 - st.m);
    if (st.m > 0.01) drawMeasures(st, st.m);
    const s = S[k];
    cell.hit.textContent = s.tok ? (100 * s.cr / s.tok).toFixed(1) + "%" : "0.0%";
    cell.paid.textContent = money(s.paid); cell.unc.textContent = money(s.unc);
    cell.over.textContent = s.over ? s.over + " (" + money(s.overUsd) + ")" : "0";
    cell.over.className = s.over ? "over" : "";
    where.textContent = mmss(t) + " / " + mmss(T) + " · request " + k + " of " + N;
    let line = TM.cues[0][3];
    for (const c of TM.cues) { if (c[0] > t + 0.05) break; line = c[3]; }
    if (cap.textContent !== line) cap.textContent = line;
    if (document.activeElement !== rng) rng.value = t.toFixed(2);
    btn.textContent = playing ? "Pause" : t >= T - 0.05 ? "Replay" : "Play";
    snd.textContent = sound ? "Sound: on" : "Sound: off"; snd.setAttribute("aria-pressed", String(sound));
  }

  function size() {
    W = host.clientWidth; H = W < 560 ? 320 : Math.round(clamp(W * 0.42, 400, 470)); dpr = window.devicePixelRatio || 1;
    cvs.style.width = W + "px"; cvs.style.height = H + "px"; cvs.width = Math.round(W * dpr); cvs.height = Math.round(H * dpr);
    paint();
  }

  // -- the clock
  const ask = () => { if (!raf) raf = requestAnimationFrame(tick); };
  // The voice goes to the time of the film. Before the file's header is read it cannot seek: then it goes there when the header comes.
  const voiceAt = () => {
    if (!audio) return;
    const go = () => { try { audio.currentTime = clamp(t, 0, Math.max(0, T - 0.05)); } catch (err) { /* a file that cannot seek: it plays from where it is, and the film follows it */ } };
    if (audio.readyState >= 1) go(); else audio.addEventListener("loadedmetadata", go, {once: true});
  };
  let resume = false;  // a drag took the film while it played: it plays on when the hand and the glide are done
  function tick(now) {
    raf = 0;
    const dt = clamp((now - last) / 1000, 0, 0.1); last = now;
    if (goal != null) {  // a critically damped spring to the goal: it starts at the speed of the hand and does not pass the goal
      const om = 7, d = t - goal;
      if (d * vel < 0 && Math.abs(vel) > om * Math.abs(d)) vel = -om * d;
      const e = Math.exp(-om * dt), c = vel + om * d;
      t = clamp(goal + (d + c * dt) * e, 0, T); vel = (vel - om * c * dt) * e;
      if (Math.abs(t - goal) < 0.05 && Math.abs(vel) < 0.3) { t = goal; goal = null; vel = 0; if (resume) { resume = false; play(true); } else if (sound && audio) voiceAt(); }
    } else if (playing) {
      const voiced = sound && audio && !audio.paused, ready = voiced && audio.readyState >= 3 && !audio.seeking;
      if (!voiced || ready) t += dt;                                               // the voice waits for data, or seeks: so does the film
      if (ready && Math.abs(audio.currentTime - t) > 0.15) t = audio.currentTime;  // the voice is the clock
      if (t >= T) { t = T; playing = false; if (audio) audio.pause(); }
    }
    paint();
    if (playing || goal != null) ask();
  }
  function play(on) {
    playing = on; goal = null; vel = 0;
    if (!on) { if (audio) audio.pause(); return paint(); }
    if (t >= T - 0.05) t = 0;
    last = performance.now();
    if (sound && audio) { voiceAt(); audio.play().catch(() => { sound = false; paint(); }); }
    ask();
  }
  function setSound(on) {
    sound = on;
    if (on && !audio) { audio = new Audio(SRC); audio.preload = "auto"; }
    if (!on) { if (audio) audio.pause(); return paint(); }
    if (playing) { voiceAt(); audio.play().catch(() => { sound = false; paint(); }); paint(); } else play(true);  // Sound on a film that stands: it plays
  }
  const seek = v => { t = clamp(v, 0, T); goal = null; vel = 0; if (sound && audio) voiceAt(); if (playing) last = performance.now(); paint(); };
  btn.onclick = () => play(!playing);
  snd.onclick = () => setSound(!sound);
  rng.oninput = () => seek(+rng.value);

  // -- a drag on the picture moves the clock with the hand (the whole width is the whole film); thrown, it glides on
  let drag = null;
  cvs.addEventListener("pointerdown", e => {
    if (e.button) return;
    drag = {id: e.pointerId, x: e.clientX, t0: t, moved: false, was: playing || resume, pts: [[t, performance.now()]]};
    resume = false; goal = null; vel = 0;
    try { cvs.setPointerCapture(e.pointerId); } catch (err) { /* a pointer that is gone */ }
  });
  cvs.addEventListener("pointermove", e => {
    if (!drag || e.pointerId !== drag.id) return;
    if (!drag.moved && Math.abs(e.clientX - drag.x) > 4) { drag.moved = true; if (playing) play(false); cvs.classList.add("drag"); }
    if (!drag.moved) return;
    const now = performance.now();
    t = clamp(drag.t0 + (e.clientX - drag.x) / W * T, 0, T); drag.pts.push([t, now]);
    while (drag.pts[0][1] < now - 80) drag.pts.shift();
    ask();  // one frame: with no glide and no play, tick() only paints
  });
  const lift = e => {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag, now = performance.now();
    drag = null; cvs.classList.remove("drag");
    if (!d.moved) { if (e.type === "pointerup") play(!playing); return; }  // a tap or a click: play or pause
    const back = () => { if (d.was && t < T - 0.05) play(true); else { if (sound && audio) voiceAt(); paint(); } };
    const q = d.pts.filter(s => s[1] >= now - 80);
    if (still || e.type !== "pointerup" || q.length < 2) return back();
    const a = q[0], b = q[q.length - 1], dt = (b[1] - a[1]) / 1000;
    if (dt < 0.008 || now - b[1] > 40) return back();  // the hand had stopped before it let go
    const v = (b[0] - a[0]) / dt, px = Math.abs(v) / T * W;  // film seconds a second, and the hand in pixels a second
    if (px < 120) return back();
    vel = v * Math.min(1, 4000 / px); goal = clamp(t + vel * 0.35, 0, T);
    if (goal === t) { goal = null; vel = 0; return back(); }
    resume = d.was; last = now; ask();
  };
  cvs.addEventListener("pointerup", lift); cvs.addEventListener("pointercancel", lift);

  size();
  let fit = 0;  // the new size is taken in the next frame, not inside the observer (a resize there makes the observer loop)
  const refit = () => { if (!fit) fit = requestAnimationFrame(() => { fit = 0; if (host.clientWidth !== W) size(); }); };
  if (window.ResizeObserver) new ResizeObserver(refit).observe(host); else addEventListener("resize", refit);
  if (!still && window.IntersectionObserver) {
    const io = new IntersectionObserver(es => { if (es.some(x => x.isIntersecting)) { io.disconnect(); if (t === 0 && !drag && !playing) play(true); } }, {threshold: 0.4});
    io.observe(cvs);
  }
  document.addEventListener("visibilitychange", () => { if (document.hidden && playing) play(false); });
  window.HAIKU_FILM = {total: T, voice: SRC, state: () => Object.assign({t, playing, sound, goal, vel, W, H}, stateAt(t)), seek, play, setSound};
})();
