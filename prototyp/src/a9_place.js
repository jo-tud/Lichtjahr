/* ---------- Kalendarium findet seinen Platz ----------
   Die Seite wird klein gerendert und auf Ruhe untersucht: wenig Kanten (Detail) und gleichmäßige Helligkeit.
   Personen und Motive bringen fast immer viel Detail mit und werden so gemieden. Für jede erlaubte Position
   (außerhalb von Bindung und Sicherheitsrand) und jede Kalendarium-Form wird die Unruhe unter dem Block
   gemessen; die ruhigste Stelle gewinnt. Die Schriftfarbe richtet sich nach der Helligkeit dort. */
const imgCache = {};
function loadImg(url) {
  if (!imgCache[url]) imgCache[url] = new Promise((res) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = url; });
  return imgCache[url];
}
// Seite ohne Kalendarium klein rendern (Vorschaubilder, gleiche Transformation wie im PDF)
async function renderSmall(p, px = 260) {
  const W = S.doc.w, H = S.doc.h, k = px / Math.max(W, H);
  const c = document.createElement('canvas'); c.width = Math.round(W * k); c.height = Math.round(H * k);
  const x = c.getContext('2d', { willReadFrequently: true });
  for (const it of pageItems(p, { noBlocks: true })) {
    x.setTransform(k, 0, 0, k, 0, 0);
    if (it.t === 'rect') { x.fillStyle = cRGBraw(it.fill); x.fillRect(it.x, it.y, it.w, it.h); }
    else if (it.t === 'empty') { x.fillStyle = '#d9dde1'; x.fillRect(it.clip.x, it.clip.y, it.clip.w, it.clip.h); }
    else if (it.t === 'img') {
      const ph = S.photos[it.photo], pl = it.place, im = await loadImg(RT.prev[ph.id] || RT.thumb[ph.id]); if (!im) continue;
      x.save(); x.beginPath(); x.rect(it.clip.x, it.clip.y, it.clip.w, it.clip.h); x.clip();
      x.translate(pl.fx, pl.fy); x.rotate((pl.rot || 0) * Math.PI / 180); x.scale(pl.w / ph.w, pl.h / ph.h); x.translate(-pl.cx * ph.w, -pl.cy * ph.h);
      x.drawImage(im, 0, 0, ph.w, ph.h); x.restore();
    }
  }
  return { k, w: c.width, h: c.height, data: x.getImageData(0, 0, c.width, c.height).data };
}
// Summenbilder für schnelle Mittelwerte über beliebige Rechtecke
function integral(arr, w, h) {
  const I = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) { let row = 0; for (let x = 0; x < w; x++) { row += arr[y * w + x]; I[(y + 1) * (w + 1) + x + 1] = I[y * (w + 1) + x + 1] + row; } }
  return (x0, y0, x1, y1) => I[y1 * (w + 1) + x1] - I[y0 * (w + 1) + x1] - I[y1 * (w + 1) + x0] + I[y0 * (w + 1) + x0];
}
function analyse(img) {
  const { w, h, data } = img, n = w * h, L = new Float32Array(n), L2 = new Float32Array(n), G = new Float32Array(n);
  for (let i = 0; i < n; i++) { const v = (.299 * data[i * 4] + .587 * data[i * 4 + 1] + .114 * data[i * 4 + 2]) / 255; L[i] = v; L2[i] = v * v; }
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x; G[i] = Math.abs(L[i + 1] - L[i - 1]) + Math.abs(L[i + w] - L[i - w]);
  }
  return { w, h, L, G, sL: integral(L, w, h), sL2: integral(L2, w, h), sG: integral(G, w, h) };
}
function blockSize(p, style) {
  const tmp = { ...p, cal: { ...(p.cal || {}), style, pos: {} } }, b = calBlock(tmp);
  return b ? { w: b.w, h: b.h } : null;
}
// Beste Stelle für eine Form; Ergebnis mit Kosten, Position (mm) und mittlerer Helligkeit
function bestSpot(p, A, k, style, faces = []) {
  const sz = blockSize(p, style); if (!sz) return null;
  const W = S.doc.w, H = S.doc.h, safe = 6, zone = bindZoneDepth() + 2, upper = viewOf(p.key).part === 'upper';
  const yMin = upper ? safe : Math.max(safe, zone), yMax = H - sz.h - (upper ? Math.max(safe, zone) : safe), xMin = safe, xMax = W - sz.w - safe;
  if (xMax < xMin || yMax < yMin) return null;
  const def = S.doc.cal.def[style] || { ax: .5, ay: .9 }, step = Math.min(W, H) * .012;
  let best = null;
  for (let ym = yMin; ym <= yMax + .01; ym += step) for (let xm = xMin; xm <= xMax + .01; xm += step) {
    const x0 = Math.floor(xm * k), y0 = Math.floor(ym * k), x1 = Math.min(A.w, Math.ceil((xm + sz.w) * k)), y1 = Math.min(A.h, Math.ceil((ym + sz.h) * k));
    const a = Math.max(1, (x1 - x0) * (y1 - y0)), mL = A.sL(x0, y0, x1, y1) / a, sd = Math.sqrt(Math.max(0, A.sL2(x0, y0, x1, y1) / a - mL * mL)), mG = A.sG(x0, y0, x1, y1) / a;
    const ax = (xm) / Math.max(1, W - sz.w), ay = (ym) / Math.max(1, H - sz.h);
    const cost = mG * 4 + sd * 1.2 + .04 * Math.hypot(ax - def.ax, ay - def.ay) + 1.5 * faceCover(faces, { x: xm, y: ym, w: sz.w, h: sz.h });
    if (!best || cost < best.cost) best = { cost, x: xm, y: ym, ax, ay, mL, sd, mG, style, ...sz };
  }
  return best;
}
async function suggestPlacement(key, { tryStyles = true } = {}) {
  const p = S.pages[key], c = calSettings(p);
  if (!p || c.style === 'off' || pageMonth(key) == null) return null;
  const img = await renderSmall(p), A = analyse(img);
  await loadFaces(visibleSlots(p).map(s => s.photo).filter(Boolean));
  const faces = pageFaces(p);                                         // Gesichter nie verdecken
  const styles = tryStyles ? ['h', 'v', 'g', 'w'] : [c.style];
  let best = null;
  for (const st of styles) {
    const s = bestSpot(p, A, img.k, st, faces); if (!s) continue;
    if (st !== c.style) s.cost += .03;                              // die gewählte Form leicht bevorzugen
    if (!best || s.cost < best.cost) best = s;
  }
  if (!best) return null;
  // Schrift nach Helligkeit; bei mittlerer Helligkeit oder Unruhe eine Fläche dahinter
  const busy = best.mG * 4 + best.sd * 1.2 > .28, mid = best.mL > .42 && best.mL < .6;
  const color = best.mL >= .5 ? 'black' : 'white';
  const panel = busy || mid ? (best.mL >= .5 ? 'light' : 'dark') : 'none';
  return { ...best, color, panel, A, img };
}
function applyPlacement(p, s) {
  p.cal ||= {};
  p.cal.style = s.style; p.cal.color = s.color; p.cal.panel = s.panel;
  if (s.panel !== 'none') p.cal.opacity = .75;
  (p.cal.pos ||= {})[s.style] = { ax: s.ax, ay: s.ay };
}
const spotWords = (s) => {
  const W = S.doc.w, H = S.doc.h, cx = (s.x + s.w / 2) / W, cy = (s.y + s.h / 2) / H;
  const v = cy < .34 ? 0 : cy > .66 ? 2 : 1, h = cx < .34 ? 0 : cx > .66 ? 2 : 1;
  return [
    [_t('oben links'), _t('oben'), _t('oben rechts')],
    [_t('in der Mitte links'), _t('in der Mitte'), _t('in der Mitte rechts')],
    [_t('unten links'), _t('unten'), _t('unten rechts')],
  ][v][h];
};
async function placeHere() {
  const p = curPage(), before = pageItems(p).find(i => i.t === 'block' && i.kind === 'cal');
  const s = await suggestPlacement(p.key, { tryStyles: false });   // die gewählte Form bleibt
  if (!s) { toast(_t('Für diese Seite gibt es keinen passenden Platz (Kalendarium aus oder zu groß).')); return; }
  applyPlacement(p, s); commit();
  ui.tab = 'cal'; renderEditor(); renderPanelKeepScroll(); updateThumb();
  showAnalysis(s, before);
  const where = spotWords(s), dark = s.color === 'black', panel = s.panel !== 'none';
  toast(panel
    ? (dark ? _t('Ruhige Stelle {where} gefunden, dunkle Schrift mit Fläche dahinter. Rückgängig ist möglich.', { where }) : _t('Ruhige Stelle {where} gefunden, helle Schrift mit Fläche dahinter. Rückgängig ist möglich.', { where }))
    : (dark ? _t('Ruhige Stelle {where} gefunden, dunkle Schrift. Rückgängig ist möglich.', { where }) : _t('Ruhige Stelle {where} gefunden, helle Schrift. Rückgängig ist möglich.', { where })), 5000);
}
async function placePage(key) {
  const p = S.pages[key], s = p && await suggestPlacement(key, { tryStyles: false }); if (!s) return;
  applyPlacement(p, s); commit(); renderAll();
  toast(_t('{page}: Kalendarium neu platziert.', { page: pageLabel(key) }), 4000, { label: _t('Rückgängig'), fn: undo });
}
async function placeAll() {
  const keys = pageKeys().filter(k => S.pages[k] && pageMonth(k) != null && calSettings(S.pages[k]).style !== 'off');
  const bar = busy(_t('Kalendarien werden platziert'), '');
  let n = 0;
  for (const k of keys) {
    const s = await suggestPlacement(k, { tryStyles: false }); if (s) { applyPlacement(S.pages[k], s); n++; }
    bar.update(n / keys.length, pageLabel(k)); await sleep0();
  }
  bar.close(); commit(); renderDesign();
  toast(n === 1 ? _t('1 Kalendarium auf eine ruhige Bildstelle gesetzt. Jede Seite lässt sich danach von Hand korrigieren.')
    : _t('{n} Kalendarien auf ruhige Bildstellen gesetzt. Jede Seite lässt sich danach von Hand korrigieren.', { n }), 5000);
}
// Kurz zeigen, wie die App „sieht“: unruhige Stellen dunkel, die gewählte Fläche hervorgehoben; das Kalendarium gleitet hin
function showAnalysis(s, before) {
  const svg = $('#editor'); if (!svg || reduceMotion()) return;
  const { w, h, G } = s.A, c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d'), id = x.createImageData(w, h);
  for (let i = 0; i < w * h; i++) { const v = Math.min(1, G[i] * 6); id.data[i * 4] = 20; id.data[i * 4 + 1] = 24; id.data[i * 4 + 2] = 40; id.data[i * 4 + 3] = Math.round(v * 200); }
  x.putImageData(id, 0, 0);
  const NS = 'http://www.w3.org/2000/svg', g = document.createElementNS(NS, 'g');
  g.setAttribute('pointer-events', 'none');
  g.innerHTML = `<image href="${c.toDataURL()}" x="0" y="0" width="${S.doc.w}" height="${S.doc.h}" preserveAspectRatio="none"/>` +
    `<rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" fill="none" stroke="#fff" stroke-width="1.2" stroke-dasharray="3 2"/>`;
  svg.appendChild(g);
  g.animate([{ opacity: 0 }, { opacity: 1, offset: .2 }, { opacity: 1, offset: .6 }, { opacity: 0 }], { duration: 1800, easing: 'ease-in-out' }).finished.then(() => g.remove());
  const blk = svg.querySelector('[data-block="cal"]');
  if (blk && before) blk.animate([{ transform: `translate(${before.x - s.x}px, ${before.y - s.y}px)`, opacity: .6 }, { transform: 'translate(0, 0)', opacity: 1 }], { duration: 900, delay: 350, easing: 'cubic-bezier(.3,.7,.2,1)', fill: 'backwards' });
}
