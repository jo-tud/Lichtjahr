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
const adjOf = (id) => { const r = S.doc.adjust && S.doc.adjust[id]; return r && ADJ_KEYS.some(k => r[k]) ? r : null; };
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// Tonkurve als Funktion; alle Regler −1 … +1
function toneCurve(r) {
  const e = r.exposure || 0, c = r.contrast || 0, sh = r.shadows || 0, hl = r.highlights || 0, g = Math.pow(2, -.75 * e);
  return (v) => {
    let x = Math.pow(v, g);
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
  const gain = [1 + .07 * w + .02 * t, 1 - .045 * t, 1 - .07 * w + .02 * t];
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
  if (Object.keys(r).length) S.doc.adjust[id] = r; else delete S.doc.adjust[id];
}
