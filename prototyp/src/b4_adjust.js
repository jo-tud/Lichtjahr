/* ---------- Bilder verbessern ----------
   Je Foto ein Rezept (S.doc.adjust[id]); die Originale bleiben unverändert. Aus dem Rezept wird genau EINE
   kompilierte Form berechnet, und nur diese wenden alle an:
     m:   3×3-Farbmatrix (Weißabgleich, Sättigung) auf sRGB-Werte 0–1, danach
     lut: Tonkurve mit 65 Stützstellen (Belichtung, Kontrast, Tiefen, Lichter), linear dazwischen.
   Die Vorschau im Editor als SVG-Filter (feColorMatrix + feComponentTransfer, rechnet genauso), der PDF-Entwurf
   und das Druck-PDF in der Oberfläche auf den Pixeln, der Dienst mit numpy (Fotos aus dem Original, Druckansicht).
   So sieht der Druck aus wie die Vorschau. Die Druckanpassung (Ausgleich für Papier, Schärfung) kommt vom
   Dienst, weil sie vom Druckprofil abhängt. */
const ADJ_KEYS = ['exposure', 'contrast', 'highlights', 'shadows', 'warmth', 'tint', 'saturation'];
const ADJ_NODES = 65;
// Wirksames Rezept: Automatik (aufgelöste Werte × Stärke) plus Regler als Versatz dazu
function adjOf(id) {
  const r = S.doc.adjust && S.doc.adjust[id]; if (!r) return null;
  const a = r.auto && r.autoV, s = r.strength ?? .7, out = {};
  for (const k of ADJ_KEYS) { const v = (r[k] || 0) + (a ? (a[k] || 0) * s : 0); if (v) out[k] = Math.max(-1, Math.min(1, v)); }
  if (a) {                                                  // Tonwertumfang und Weißabgleich nur aus der Automatik
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
  const b = r.lvlB || 0, w = r.lvlW ?? 1;
  return (v) => {
    let x = Math.pow(clamp01((v - b) / Math.max(.05, w - b)), g);
    x = c >= 0 ? x + c * .7 * (x * x * (3 - 2 * x) - x) : .5 + (x - .5) * (1 + .45 * c);
    x = clamp01(x);
    x += sh * .9 * x * (1 - x) * (1 - x);                    // Tiefen: wirkt vor allem im unteren Drittel
    x += hl * .9 * x * x * (1 - x);                          // Lichter: vor allem im oberen Drittel
    return clamp01(x);
  };
}
function compileAdjust(r) {
  if (!r) return null;
  const w = r.warmth || 0, t = r.tint || 0, k = 1 + .5 * (r.saturation || 0), L = [.2126, .7152, .0722];
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
  if (!r.auto) { delete r.autoV; delete r.strength; delete r.auto; }
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
const AUTO_VERSION = 'auto-1';
async function photoPixels(id, size = 256) {
  const ph = S.photos[id], src = (ph && (RT.prev[id] || RT.thumb[id])); if (!src) return null;
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
function autoRecipe(st) {
  const a = { v: AUTO_VERSION };
  // Tonwertumfang: halb so weit spreizen wie möglich, Grenzen gekappt
  if (st.lo > .02) a.lvlB = Math.min(.08, st.lo * .5);
  if (st.hi < .97) a.lvlW = Math.max(.88, 1 - (1 - st.hi) * .5);
  const stretch = (v) => clamp01((v - (a.lvlB || 0)) / ((a.lvlW ?? 1) - (a.lvlB || 0)));
  // Belichtung über Gamma: Median Richtung Mitte, gedämpft (Low-Key und helle Szenen behalten ihre Stimmung)
  const evFor = (cur, target) => (cur > .03 && cur < .97 ? -Math.log2(Math.log(target) / Math.log(cur)) / .75 : 0);
  let ev = evFor(stretch(st.med), .46) * .6;
  // Hat das Foto schon helle Lichter, ist es meist richtig belichtet (etwa vor dunklem Hintergrund): kaum aufhellen
  if (ev > 0) ev *= .35 + .65 * clamp01((.97 - st.hi) / .25);
  // Gesichter: sichtbar belichtet heißt, das Motiv stimmt, also wenig aufhellen; nur sehr dunkle Gesichter (unter 15 %)
  // gelten als unterbelichtet. Beides gilt für jeden Hautton, ein Ziel-Hautton wird nie angesteuert.
  if (st.face != null) ev = stretch(st.face) < .15 ? Math.max(ev, evFor(stretch(st.face), .22)) : st.hi > .85 ? Math.min(ev, .2) : ev;
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
  const px = await photoPixels(id); if (!px) return null;
  return autoRecipe(photoStats(px, facesOf(id) || []));
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
