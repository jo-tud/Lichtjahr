/* ---------- Bilder verbessern ----------
   Je Foto ein Rezept (S.doc.adjust[id]); die Originale bleiben unverändert. Aus dem Rezept wird genau EINE
   kompilierte Form berechnet, und nur diese wenden alle an:
     m:   3×3-Farbmatrix (Weißabgleich, Sättigung) auf sRGB-Werte 0–1, danach
     lut: Tonkurve mit 65 Stützstellen (Belichtung, Kontrast, Tiefen, Lichter), linear dazwischen.
   Die Vorschau im Editor als SVG-Filter (feColorMatrix + feComponentTransfer, rechnet genauso), der PDF-Entwurf
   und das Druck-PDF in der Oberfläche auf den Pixeln, der Dienst mit numpy (Fotos aus dem Original, Druckansicht).
   So sieht der Druck aus wie die Vorschau. Die Druckanpassung (Ausgleich für Papier, Schärfung) kommt vom
   Dienst, weil sie vom Druckprofil abhängt.
   Dazu kommt die Detailbearbeitung (DETAIL_KEYS): Gegenlicht ausgleichen und Rauschen mindern wirken örtlich und
   laufen deshalb im Dienst (detail.py), vor dem Rezept. Die Oberfläche hängt dafür „fx=f0.40n0.30“ an die Adresse
   von Vorschau, Druckansicht und Original; das Druck-PDF gibt es dem Dienst im Bildobjekt mit. */
const ADJ_KEYS = ['exposure', 'contrast', 'highlights', 'shadows', 'warmth', 'tint', 'saturation'];
// Looks: Rezeptanteile, mit eigener Stärke dazugerechnet. mono = Schwarzweiß-Anteil, fade = angehobenes Schwarz (Film)
const LOOKS = {
  vivid: { contrast: .2, saturation: .35, shadows: .05 },
  warm: { warmth: .35, saturation: .1, exposure: .05 },
  soft: { contrast: -.3, highlights: -.25, shadows: .2, saturation: -.15 },
  film: { contrast: .12, saturation: -.3, warmth: .12, fade: .05 },
  bw: { mono: 1, contrast: .1 },
  bwstrong: { mono: 1, contrast: .4, shadows: -.1 },
};
const LOOK_KEYS = [...ADJ_KEYS, 'mono', 'fade'];
const DETAIL_KEYS = ['fusion', 'denoise'];
const ADJ_NODES = 65;
// Wirksames Rezept: Automatik (aufgelöste Werte × Stärke), Angleichung der Monate, Look × Stärke, Regler als Versatz
function adjOf(id, { noMatch = false, look } = {}) {
  const r = S.doc.adjust && S.doc.adjust[id]; if (!r && !look) return null;
  const rr = r || {}, a = rr.auto && rr.autoV, s = rr.strength ?? .7, out = {};
  const lk = LOOKS[look !== undefined ? look : rr.look], la = look !== undefined ? 1 : (rr.lookAmt ?? 1), m = !noMatch && rr.match;
  for (const k of LOOK_KEYS) {
    const v = (rr[k] || 0) + (a ? (a[k] || 0) * s : 0) + (m ? m[k] || 0 : 0) + (lk ? (lk[k] || 0) * la : 0);
    if (v) out[k] = k === 'mono' || k === 'fade' ? clamp01(v) : Math.max(-1, Math.min(1, v));
  }
  for (const k of DETAIL_KEYS) {                      // eigener Wert ersetzt den Vorschlag der Automatik (0 = bewusst aus)
    const v = rr[k] != null ? rr[k] : a && a[k] ? a[k] * Math.min(1.4, s / .7) : 0;
    if (v >= .01) out[k] = Math.min(1, +v.toFixed(2));
  }
  if (a) {                                            // Tonwertumfang und Weißabgleich nur aus der Automatik
    if (a.lvlB || a.lvlW !== undefined && a.lvlW !== 1) { out.lvlB = (a.lvlB || 0) * s; out.lvlW = 1 - (1 - (a.lvlW ?? 1)) * s; }
    if (a.wbR && a.wbR !== 1) out.wbR = 1 + (a.wbR - 1) * s;
    if (a.wbB && a.wbB !== 1) out.wbB = 1 + (a.wbB - 1) * s;
  }
  return Object.keys(out).length ? out : null;
}
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// Tonkurve als Funktion; alle Regler −1 … +1
function toneCurve(r) {
  const e = r.exposure || 0, c = r.contrast || 0, sh = r.shadows || 0, hl = r.highlights || 0, g = Math.pow(2, -.75 * e);
  const b = r.lvlB || 0, w = r.lvlW ?? 1, fade = r.fade || 0;
  return (v) => {
    let x = Math.pow(clamp01((v - b) / Math.max(.05, w - b)), g);
    x = c >= 0 ? x + c * .7 * (x * x * (3 - 2 * x) - x) : .5 + (x - .5) * (1 + .45 * c);
    x = clamp01(x);
    x += sh * .9 * x * (1 - x) * (1 - x);                    // Tiefen: wirkt vor allem im unteren Drittel
    x += hl * .9 * x * x * (1 - x);                          // Lichter: vor allem im oberen Drittel
    return clamp01(fade + clamp01(x) * (1 - fade));
  };
}
function compileAdjust(r) {
  if (!r || !Object.keys(r).some(k => !DETAIL_KEYS.includes(k))) return null;   // nur Detailbearbeitung: kein Filter
  const w = r.warmth || 0, t = r.tint || 0, k = (1 + .5 * (r.saturation || 0)) * (1 - (r.mono || 0)), L = [.2126, .7152, .0722];
  const gain = [(1 + .07 * w + .02 * t) * (r.wbR || 1), 1 - .045 * t, (1 - .07 * w + .02 * t) * (r.wbB || 1)];
  const m = [];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) m.push(((1 - k) * L[j] + (i === j ? k : 0)) * gain[j]);
  const f = toneCurve(r), lut = [];
  for (let i = 0; i < ADJ_NODES; i++) lut.push(f(i / (ADJ_NODES - 1)));
  return { m, lut };
}
// Zwei Kurven hintereinander (erst a, dann b) als eine Kurve mit gleichen Stützstellen
function lutAt(lut, v) {
  const n = lut.length - 1, x = clamp01(v) * n, i = Math.min(n - 1, Math.floor(x));
  return lut[i] + (x - i) * (lut[i + 1] - lut[i]);
}
const composeLut = (a, b) => a.map(v => lutAt(b, v));
const adjKey = (c) => c ? c.m.map(v => v.toFixed(4)).join(',') + ';' + c.lut.map(v => v.toFixed(4)).join(',') : '';

// SVG-Filter für die Vorschau; gleiche Rezepte teilen sich einen Filter
const ADJ_FILTERS = new Map();
function adjFilterId(c) {
  const key = adjKey(c);
  if (!ADJ_FILTERS.has(key)) ADJ_FILTERS.set(key, 'adj' + ADJ_FILTERS.size);
  return ADJ_FILTERS.get(key);
}
function adjFilterDef(c, id) {
  const m = c.m.map(v => +v.toFixed(5)), lut = c.lut.map(v => +v.toFixed(5)).join(' ');
  return `<filter id="${id}" color-interpolation-filters="sRGB" x="0" y="0" width="1" height="1"><feColorMatrix type="matrix" values="${m[0]} ${m[1]} ${m[2]} 0 0 ${m[3]} ${m[4]} ${m[5]} 0 0 ${m[6]} ${m[7]} ${m[8]} 0 0 0 0 0 1 0"/>` +
    `<feComponentTransfer><feFuncR type="table" tableValues="${lut}"/><feFuncG type="table" tableValues="${lut}"/><feFuncB type="table" tableValues="${lut}"/></feComponentTransfer></filter>`;
}

// Auf Pixel anwenden (ImageData.data, RGBA 0–255); Alpha bleibt
function applyAdjustPixels(data, c) {
  const m = c.m, N = 4096, T = new Uint8ClampedArray(N + 1);
  for (let i = 0; i <= N; i++) T[i] = Math.round(lutAt(c.lut, i / N) * 255);
  const s = N / 255;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    data[i] = T[Math.round(clamp01((m[0] * r + m[1] * g + m[2] * b) / 255) * N)];
    data[i + 1] = T[Math.round(clamp01((m[3] * r + m[4] * g + m[5] * b) / 255) * N)];
    data[i + 2] = T[Math.round(clamp01((m[6] * r + m[7] * g + m[8] * b) / 255) * N)];
  }
  return data;
}
// Ein Wert pro Kanal für die Vorschau-Kacheln und Tests
const adjustRGB = (rgb, c) => [0, 1, 2].map(i => Math.round(lutAt(c.lut, clamp01((c.m[i * 3] * rgb[0] + c.m[i * 3 + 1] * rgb[1] + c.m[i * 3 + 2] * rgb[2]) / 255)) * 255));

function setAdjust(id, patch) {
  S.doc.adjust ||= {};
  const r = { ...(S.doc.adjust[id] || {}), ...patch };
  for (const k of ADJ_KEYS) if (!r[k]) delete r[k];
  for (const k of DETAIL_KEYS) if (r[k] == null) delete r[k];
  if (!r.auto) { delete r.autoV; delete r.strength; delete r.auto; }
  if (!r.look) { delete r.look; delete r.lookAmt; }
  if (!r.match || !Object.keys(r.match).length) delete r.match;
  if (Object.keys(r).length) S.doc.adjust[id] = r; else delete S.doc.adjust[id];
}

/* ----- Automatik ----- 
   Analyse auf dem Vorschaubild (256 px), ohne große Modelle:
   - Tonwertumfang über Perzentile (0,3 % / 99,7 %), nur ein Stück weit gespreizt (Nebel und Abendstimmung bleiben)
   - Belichtung: Median der Helligkeit Richtung Mitte. Gesichter geben keinen Hautton vor (sonst würde dunkle Haut
     aufgehellt); sie verhindern nur, dass ein Foto mit deutlich unterbelichteten Gesichtern dunkel bleibt
   - Weißabgleich: Shades of Gray (p = 6) ohne beschnittene, sehr dunkle und stark gesättigte Pixel, nur zur Hälfte und
     gekappt; bei warmer, satter Stimmung weniger, bei großen warmen Flächen (Sonnenuntergang) gar nicht
   - Farbe: blasse Fotos etwas kräftiger, bunte nicht; dunkle Tiefen etwas öffnen
   Die Werte werden gespeichert (autoV), damit das Foto in einem Jahr gleich gedruckt wird, auch wenn sich das Verfahren ändert. */
const AUTO_VERSION = 'auto-2';                    // auto-2: mit Vorschlag für Gegenlicht und Rauschen
// Belichtungsregler, der den Wert cur auf target bringt (Gamma-Modell der Tonkurve)
const adjEv = (cur, target) => (cur > .03 && cur < .97 ? -Math.log2(Math.log(target) / Math.log(cur)) / .75 : 0);
async function photoPixels(id, size = 256, fx = '') {
  const ph = S.photos[id], src = withFx(ph && (RT.prev[id] || RT.thumb[id]), fx); if (!src) return null;
  const im = await loadImg(src); if (!im) return null;
  const k = size / Math.max(im.naturalWidth || im.width, im.naturalHeight || im.height);
  const w = Math.max(1, Math.round((im.naturalWidth || im.width) * k)), h = Math.max(1, Math.round((im.naturalHeight || im.height) * k));
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(im, 0, 0, w, h);
  return { w, h, data: x.getImageData(0, 0, w, h).data };
}
function photoStats(px, faces = []) {
  const { w, h, data } = px, n = w * h, hist = new Uint32Array(256), sum = [0, 0, 0];
  let chroma = 0, cnt = 0, warm = 0, faceL = 0, faceN = 0;
  const inFace = (x, y) => faces.some(f => f.score >= .8 && x >= f.x * w && x < (f.x + f.w) * w && y >= f.y * h && y < (f.y + f.h) * h);
  for (let i = 0, p = 0; p < n; p++, i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2], L = .2126 * r + .7152 * g + .0722 * b, mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    hist[Math.round(L)]++;
    const sat = mx ? (mx - mn) / mx : 0; chroma += (mx - mn) / 255;
    const face = faces.length && inFace(p % w, Math.floor(p / w));
    if (face) { faceL += L; faceN++; }
    else if (r > g * 1.15 && g > b * 1.05 && sat > .35) warm++;          // Haut zählt nicht als warme Stimmung
    if (mx < 245 && mx > 15 && sat < .6) { sum[0] += Math.pow(r / 255, 6); sum[1] += Math.pow(g / 255, 6); sum[2] += Math.pow(b / 255, 6); cnt++; }
  }
  const pct = (q) => { let a = 0, t = q * n; for (let i = 0; i < 256; i++) { a += hist[i]; if (a >= t) return i / 255; } return 1; };
  const gray = cnt > n * .05 ? sum.map(v => Math.pow(v / cnt, 1 / 6)) : null;
  return { lo: pct(.003), p25: pct(.25), med: pct(.5), hi: pct(.997), chroma: chroma / n, warm: warm / n, gray, face: faceN > 20 ? faceL / faceN / 255 : null };
}
function autoRecipe(st, { backlit = false } = {}) {
  const a = { v: AUTO_VERSION };
  // Tonwertumfang: halb so weit spreizen wie möglich, Grenzen gekappt
  if (st.lo > .02) a.lvlB = Math.min(.08, st.lo * .5);
  if (st.hi < .97) a.lvlW = Math.max(.88, 1 - (1 - st.hi) * .5);
  const stretch = (v) => clamp01((v - (a.lvlB || 0)) / ((a.lvlW ?? 1) - (a.lvlB || 0)));
  // Belichtung über Gamma: Median Richtung Mitte, gedämpft (Low-Key und helle Szenen behalten ihre Stimmung)
  const evFor = adjEv;
  let ev = evFor(stretch(st.med), .46) * .6;
  // Hat das Foto schon helle Lichter, ist es meist richtig belichtet (etwa vor dunklem Hintergrund): kaum aufhellen
  if (ev > 0) ev *= .35 + .65 * clamp01((.97 - st.hi) / .25);
  // Gesichter: sichtbar belichtet heißt, das Motiv stimmt, also wenig aufhellen; nur sehr dunkle Gesichter (unter 15 %)
  // gelten als unterbelichtet. Beides gilt für jeden Hautton, ein Ziel-Hautton wird nie angesteuert.
  if (st.face != null) ev = stretch(st.face) < .15 ? Math.max(ev, evFor(stretch(st.face), .22)) : st.hi > .85 ? Math.min(ev, .2) : ev;
  // Gegenlicht: das Helle ist der Hintergrund; abdunkeln würde das Motiv wieder versenken und den Himmel grau machen
  if (backlit) ev = Math.max(0, ev);
  ev = Math.max(-.45, Math.min(.45, ev)); if (Math.abs(ev) > .04) a.exposure = +ev.toFixed(3);
  // Weißabgleich: Richtung neutral, zur Hälfte, höchstens ±10 %; warme Stimmung kaum anfassen
  if (st.gray && st.warm < .35) {                          // weite warme, satte Flächen (Sonnenuntergang): nicht anfassen
    const [r, g, b] = st.gray, k = st.warm > .08 ? .25 : .5;
    const cap = (v) => Math.max(.9, Math.min(1.1, v));
    const wr = cap(1 + (g / r - 1) * k), wb = cap(1 + (g / b - 1) * k);
    if (Math.abs(wr - 1) > .01) a.wbR = +wr.toFixed(4);
    if (Math.abs(wb - 1) > .01) a.wbB = +wb.toFixed(4);
  }
  // Farbe und Tiefen
  if (st.chroma < .12) a.saturation = +(Math.min(.3, (.12 - st.chroma) * 3 + .08)).toFixed(3);
  if (st.p25 < .16) a.shadows = +(Math.min(.4, (.16 - st.p25) * 3)).toFixed(3);
  if (st.hi - st.lo < .7) a.contrast = +(Math.min(.3, (.7 - (st.hi - st.lo)) * .8)).toFixed(3);
  return a;
}
async function computeAuto(id) {
  // Mit dem Dienst: erst Gegenlicht und Rauschen messen, dann Belichtung und Farbe auf dem bearbeiteten Bild
  if (SVC.pid) { try { await loadQuality([id]); } catch (e) { /* ohne Analyse weiter */ } }
  const q = qualityOf(id), fx = q ? fxText(q.fusion, q.denoise) : '';
  const px = await photoPixels(id, 256, fx); if (!px) return null;
  const a = autoRecipe(photoStats(px, facesOf(id) || []), { backlit: !!(q && q.fusion) });
  if (q && q.fusion) a.fusion = q.fusion;
  if (q && q.denoise) a.denoise = q.denoise;
  return a;
}
// Automatik für ein Foto ein- oder ausschalten; die Werte werden beim Einschalten einmal berechnet
async function setAuto(id, on) {
  if (!on) { setAdjust(id, { auto: false }); return true; }
  const r = S.doc.adjust && S.doc.adjust[id];
  const autoV = (r && r.autoV) || await computeAuto(id);
  if (!autoV) return false;
  setAdjust(id, { auto: true, autoV, strength: (r && r.strength) ?? .7 });
  return true;
}


/* ----- Detailbearbeitung im Dienst: Gegenlicht und Rauschen -----
   Der Dienst misst je Foto Rauschen und Gegenlicht und schlägt eine Stärke vor (zwischengespeichert). Die
   Prüfliste nennt Fotos, bei denen es sich lohnt; die Automatik übernimmt die Vorschläge. Ohne Dienst oder ohne
   OpenCV im Dienst gibt es beides nicht, alles andere funktioniert wie zuvor. */
const QUALITY = { available: null, q: {}, busy: false };
const fxText = (f, n) => (f >= .01 || n >= .01 ? `f${(f || 0).toFixed(2)}n${(n || 0).toFixed(2)}` : '');
const detailOn = () => !!SVC.pid && QUALITY.available !== false;
// live: im Editor zeigt „Original“ (gedrückt halten) auch das Foto ohne Detailbearbeitung
function fxOf(id, live = true) {
  if (!detailOn() || (live && ui.adjCompare)) return '';
  const r = adjOf(id); return r ? fxText(r.fusion, r.denoise) : '';
}
const withFx = (url, fx) => (url && fx ? url + (url.includes('?') ? '&' : '?') + 'fx=' + fx : url);
const qualityOf = (id) => { const ph = S.photos[id], a = ph && faceAsset(ph); return (a && QUALITY.q[a]) || null; };
// onChunk: nach jedem Paket (die Analyse dauert je Foto etwa eine halbe Sekunde)
async function loadQuality(ids, onChunk) {
  if (!detailOn()) return false;
  const want = [...new Set(ids.map(id => S.photos[id] && faceAsset(S.photos[id])).filter(a => a && SVC.assets[a] && !(a in QUALITY.q)))];
  for (let i = 0; i < want.length; i += 4) {
    const chunk = want.slice(i, i + 4), r = await api(PP('/quality'), { method: 'POST', body: { ids: chunk } });
    QUALITY.available = !!r.available; if (!r.available) return false;
    for (const a of chunk) QUALITY.q[a] = r.quality[a] || null;     // null: nicht messbar, nicht erneut fragen
    if (onChunk && chunk.some(a => QUALITY.q[a] && (QUALITY.q[a].fusion || QUALITY.q[a].denoise))) onChunk();
  }
  return want.length > 0;
}
// Im Hintergrund nachladen; after(), sobald Messungen mit einem Vorschlag dazukommen
function refreshQuality(ids, after) {
  if (!detailOn() || QUALITY.busy) return;
  QUALITY.busy = true;
  loadQuality(ids, after).catch(() => {}).finally(() => { QUALITY.busy = false; });
}
// Fotos im Kalender, bei denen Gegenlicht oder Rauschen deutlich ausgeglichen werden sollte, es aber noch nicht ist
function detailNeeds(ids) {
  const back = [], noisy = [];
  for (const id of ids) {
    const q = qualityOf(id); if (!q) continue;
    const r = adjOf(id) || {};
    if (q.fusion && (r.fusion || 0) < q.fusion * .5) back.push(id);
    if (q.denoise && (r.denoise || 0) < q.denoise * .5) noisy.push(id);
  }
  return { back, noisy };
}
function detailChecks() {
  if (!detailOn()) return [];
  const u = usage(), ids = Object.keys(u).filter(id => S.photos[id] && !S.photos[id].demo);
  refreshQuality(ids, () => { if (ui.view === 'print') renderPrint(); });
  const { back, noisy } = detailNeeds(ids), out = [];
  const page = (id) => (u[id] || [])[0];
  if (back.length) out.push(['warn', back.length === 1 ? _t('1 Foto im Gegenlicht: das Motiv ist zu dunkel') : _t('{n} Fotos im Gegenlicht: das Motiv ist zu dunkel', { n: back.length }), page(back[0]), { act: 'fixbacklight', label: _t('Aufhellen') }]);
  if (noisy.length) out.push(['warn', noisy.length === 1 ? _t('1 Foto ist stark verrauscht') : _t('{n} Fotos sind stark verrauscht', { n: noisy.length }), page(noisy[0]), { act: 'fixnoise', label: _t('Rauschen mindern') }]);
  return out;
}
// Vorschlag des Dienstes als eigenen Wert übernehmen
function applyDetail(kind) {
  const ids = Object.keys(usage()).filter(id => S.photos[id]), key = kind === 'back' ? 'fusion' : 'denoise';
  const list = detailNeeds(ids)[kind];
  for (const id of list) setAdjust(id, { [key]: qualityOf(id)[key] });
  return list.length;
}


/* ----- Alle Monate angleichen -----
   Belichtung und Farbstimmung der Monatsseiten zum Mittel des Kalenders ziehen, zu einem einstellbaren Teil:
   Der Kalender wirkt wie aus einem Guss, die Jahreszeiten bleiben erkennbar. Gemessen wird nach den bisherigen
   Anpassungen (ohne eine frühere Angleichung); das Ergebnis steht je Foto in r.match und lässt sich neu berechnen. */
async function photoTone(id, withMatch = false) {
  const px = await photoPixels(id, 128, fxOf(id, false)); if (!px) return null;
  const c = compileAdjust(adjOf(id, { noMatch: !withMatch })); if (c) applyAdjustPixels(px.data, c);
  const d = px.data, Ls = []; let lr = 0, n = 0;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2], mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    Ls.push(.2126 * r + .7152 * g + .0722 * b);
    if (mx > 25 && mx < 240 && (mx - mn) / mx < .55) { lr += Math.log((b + 1) / (r + 1)); n++; }
  }
  Ls.sort((a, b) => a - b);
  return { med: Ls[Ls.length >> 1] / 255, cast: n ? lr / n : 0 };
}
// Je Monatsseite: Helligkeit und Farbstich (Mittel ihrer Fotos, nach Fläche gewichtet)
async function monthTones(withMatch = false) {
  const out = {};
  for (const k of pageKeys().filter(k => pageMonth(k) != null && S.pages[k] && S.pages[k].layout !== 'index')) {
    let med = 0, cast = 0, wsum = 0;
    for (const it of pageItems(S.pages[k], { noBlocks: true })) {
      if (it.t !== 'img' || !S.photos[it.photo]) continue;
      const t = await photoTone(it.photo, withMatch); if (!t) continue;
      const w = it.clip.w * it.clip.h; med += t.med * w; cast += t.cast * w; wsum += w;
    }
    if (wsum) out[k] = { med: med / wsum, cast: cast / wsum };
  }
  return out;
}
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? (s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : 0; };
// Angleichung berechnen (amount 0–1) und je Foto als r.match setzen; gibt die Zahl der Seiten zurück
function applyMatch(tones, amount) {
  const keys = Object.keys(tones); if (keys.length < 2) return 0;
  const tMed = median(keys.map(k => tones[k].med)), tCast = median(keys.map(k => tones[k].cast));
  const cap = (v, m) => Math.max(-m, Math.min(m, v));
  for (const k of keys) {
    const ev = cap(adjEv(tones[k].med, tMed) * amount, .6), warm = cap((tones[k].cast - tCast) / .14 * amount, .35);   // mehr Wärme senkt ln(b/r) um etwa 0,14 je Einheit
    for (const it of pageItems(S.pages[k], { noBlocks: true })) {
      if (it.t !== 'img' || !S.photos[it.photo]) continue;
      const match = {}; if (Math.abs(ev) > .02) match.exposure = +ev.toFixed(3); if (Math.abs(warm) > .02) match.warmth = +warm.toFixed(3);
      setAdjust(it.photo, { match });
    }
  }
  return keys.length;
}
// Für die Prüfliste: Monate, die deutlich aus der Reihe fallen (dunkler oder heller), im Hintergrund berechnet
const MONTH_TONE = { key: '', tones: null, busy: false };
function monthToneKey() { return JSON.stringify([pageKeys().map(k => S.pages[k] && visibleSlots(S.pages[k]).map(s => s.photo)), S.doc.adjust || {}]); }
function refreshMonthTones(after) {
  const key = monthToneKey();
  if (MONTH_TONE.busy || MONTH_TONE.key === key) return;
  MONTH_TONE.busy = true;
  monthTones(true).then(t => { MONTH_TONE.tones = t; MONTH_TONE.key = key; }).catch(() => {}).finally(() => { MONTH_TONE.busy = false; if (after) after(); });
}
function outlierMonths() {
  const t = MONTH_TONE.tones; if (!t || MONTH_TONE.key !== monthToneKey()) return [];
  const keys = Object.keys(t); if (keys.length < 4) return [];
  const m = median(keys.map(k => t[k].med));
  return keys.filter(k => Math.abs(t[k].med - m) > .14).map(k => ({ key: k, darker: t[k].med < m }));
}

// Dialog „Alle Monate angleichen“: zwölf Monate auf einen Blick, Regler für den Anteil, gedrückt halten für vorher
async function openMatchDialog() {
  const bar = busy(_t('Monate werden verglichen'), '');
  if (facesReady()) await loadFaces(Object.keys(usage()));
  const before = JSON.stringify(S.doc.adjust || {});
  let tones;
  try { tones = await monthTones(); } finally { bar.close(); }
  if (Object.keys(tones).length < 2) { toast(_t('Dafür braucht es Fotos auf mindestens zwei Monatsseiten.')); return; }
  const keys = Object.keys(tones);
  let amount = .5;
  const el = document.createElement('div'); el.className = 'busy'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true');
  const grid = () => keys.map(k => `<figure><div class="mt">${svgPage(S.pages[k], { mode: 'thumb' })}</div><figcaption>${esc(pageLabel(k))}</figcaption></figure>`).join('');
  el.innerHTML = `<div class="card match-card"><h2>${_t('Alle Monate angleichen')}</h2>
    <p class="hint">${_t('Belichtung und Farbstimmung der Monate werden einander angenähert. Die Jahreszeiten bleiben erkennbar, der Kalender wirkt wie aus einem Guss.')}</p>
    <div class="match-grid">${grid()}</div>
    <div class="row match-ctl"><label class="adj strength" style="flex:1"><span>${_t('Angleichen')}<output>50 %</output></span><input type="range" min="0" max="1" step="0.05" value=".5" id="matchAmt"></label>
      <button class="btn" data-hold-match>${_t('Vorher')}</button></div>
    <div class="row"><button class="btn primary" data-ok>${_t('Übernehmen')}</button><button class="btn" data-cancel>${_t('Abbrechen')}</button></div></div>`;
  const redraw = () => { el.querySelector('.match-grid').innerHTML = grid(); };
  const apply = () => { S.doc.adjust = JSON.parse(before); if (amount > 0) applyMatch(tones, amount); redraw(); };
  const done = (ok) => {
    document.removeEventListener('keydown', key, true); el.remove();
    if (ok) { commit(); renderAll(); toast(_t('Monate angeglichen. Jedes Foto lässt sich weiter einzeln nachregeln.'), 5000, { label: _t('Rückgängig'), fn: undo }); }
    else { S.doc.adjust = JSON.parse(before); renderAll(); }
  };
  const key = (e) => { if (e.key === 'Escape') { e.stopPropagation(); done(false); } };
  el.addEventListener('input', (e) => { if (e.target.id === 'matchAmt') { amount = +e.target.value; e.target.parentElement.querySelector('output').textContent = Math.round(amount * 100) + ' %'; clearTimeout(apply._t); apply._t = setTimeout(apply, 120); } });
  el.addEventListener('click', (e) => { if (e.target.closest('[data-ok]')) done(true); if (e.target.closest('[data-cancel]')) done(false); });
  const hold = (on) => { const cur = JSON.stringify(S.doc.adjust || {}); if (on) { el._cur = cur; S.doc.adjust = JSON.parse(before); redraw(); } else if (el._cur) { S.doc.adjust = JSON.parse(el._cur); el._cur = null; redraw(); } };
  el.addEventListener('pointerdown', (e) => { if (e.target.closest('[data-hold-match]')) hold(true); });
  el.addEventListener('pointerup', () => hold(false)); el.addEventListener('pointerleave', () => hold(false));
  document.addEventListener('keydown', key, true);
  document.body.appendChild(el);
  apply();
  el.querySelector('[data-ok]').focus();
}
