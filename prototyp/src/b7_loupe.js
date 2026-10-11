/* ---------- Drucklupe ----------
   Zeigt eine Stelle eines Fotos so, wie sie gedruckt wird: der Dienst rechnet sie aus dem Original in voller Größe,
   mit Detailbearbeitung (Rauschen, Struktur, Gegenlicht …), Rezept, Druckausgleich und Ausgabeschärfung, in der
   Auflösung des Druck-PDFs (höchstens 300 dpi) und in der Druckansicht als Softproof. Zwei Maßstäbe:
   „Papiergröße“ (1 cm auf dem Papier ≈ 1 cm am Bildschirm) und „100 %“ (ein Druckpixel je CSS-Pixel).
   Mit der Maus folgt sie dem Zeiger, auf dem Handy dem Finger. Solange das scharfe Bild lädt, zeigt sie die
   vergrößerte Vorschau. Nur mit dem Dienst. */
const LOUPE = { el: null, timer: 0, want: '', at: null, zoom: 'paper' };
const CSS_PX_MM = 96 / 25.4;                       // CSS-Pixel je Millimeter (1 in = 96 px)
const PRINT_PPMM = 300 / 25.4;                     // Druck-PDF: höchstens 300 dpi
const loupeAsset = (ph) => ph && !ph.demo && (SVC.assets[ph.id] || (ph.copyOf && SVC.assets[ph.copyOf])) || null;
const loupeAvailable = (ph) => !!(SVC.pid && loupeAsset(ph));

function loupeToggle(on = !ui.loupe) {
  ui.loupe = !!on;
  if (!ui.loupe) loupeHide();
  else toast(coarse() ? _t('Drucklupe: Foto antippen oder mit dem Finger darüberfahren.') : _t('Drucklupe: mit der Maus über ein Foto fahren. Esc beendet.'), 4000);
  renderFrameBar();
}
const loupeButton = () => `<button class="btn small" data-act="loupe" aria-pressed="${!!ui.loupe}" title="${esc(_t('Zeigt eine Stelle so, wie sie gedruckt wird: Druckauflösung, Schärfe, Rauschen'))}">🔍 ${_t('Drucklupe')}</button>`;

function loupeSize() {
  const vw = window.innerWidth;
  return vw < 600 ? { w: Math.min(vw - 32, 320), h: 190 } : { w: 340, h: 230 };
}
function loupeEl() {
  if (LOUPE.el) return LOUPE.el;
  const el = document.createElement('div');
  el.className = 'loupe'; el.hidden = true; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', _t('Drucklupe'));
  document.body.appendChild(el);
  LOUPE.el = el;
  return el;
}
function loupeRender() {
  const el = loupeEl(), z = LOUPE.zoom;
  el.innerHTML = `<div class="loupe-view"><div class="loupe-ph"></div><img alt=""></div>
    <div class="loupe-bar"><span class="loupe-info num"></span>
      ${seg([['paper', _t('Papiergröße')], ['px', '100 %']], z, 'loupezoom')}
      <button class="loupe-x" data-act="loupe" aria-label="${esc(_t('Drucklupe schließen'))}">×</button></div>`;
  const img = el.querySelector('img');
  img.addEventListener('load', () => { if (img.dataset.src === LOUPE.want) img.classList.add('on'); el.classList.remove('loading'); });
  img.addEventListener('error', () => el.classList.remove('loading'));
}
function loupeHide() {
  clearTimeout(LOUPE.timer); LOUPE.at = null; LOUPE.want = '';
  if (LOUPE.el) LOUPE.el.hidden = true;
}

// Welche Stelle welches Fotos liegt unter dem Punkt? Vorn liegende Rahmen zuerst, Drehung herausgerechnet
function loupeHit(x, y) {
  const svg = $('#editor'); if (!svg) return null;
  const g = document.elementsFromPoint(x, y).map(n => n.closest && n.closest('#editor g[data-slot]')).find(Boolean);
  if (!g) return null;
  const p = curPage(), key = keyOf(g.dataset.slot), r = rectOf(p, key), sl = slotOf(p, key), ph = sl && S.photos[sl.photo];
  if (!r || !loupeAvailable(ph)) return null;
  const m = svg.getScreenCTM(); if (!m) return null;
  const q = new DOMPoint(x, y).matrixTransform(m.inverse());
  if (q.x < r.x || q.y < r.y || q.x > r.x + r.w || q.y > r.y + r.h) return null;
  const pl = placeImage(r, ph, sl), th = -(pl.rot || 0) * Math.PI / 180, dx = q.x - pl.fx, dy = q.y - pl.fy;
  const u = (pl.fx + dx * Math.cos(th) - dy * Math.sin(th) - pl.x) / pl.w, v = (pl.fy + dx * Math.sin(th) + dy * Math.cos(th) - pl.y) / pl.h;
  if (u < 0 || v < 0 || u > 1 || v > 1) return null;
  const img = g.querySelector('image');
  return { ph, pl, u, v, x, y, href: img && img.getAttribute('href'), filter: img && img.getAttribute('filter') };
}

function loupeShow(hit) {
  LOUPE.at = hit;
  const el = loupeEl(); if (!el.firstChild) loupeRender();
  const { ph, pl, u, v } = hit, box = loupeSize();
  const photoPpmm = ph.w / pl.w, ppmm = Math.min(PRINT_PPMM, photoPpmm), scale = ppmm / photoPpmm;   // Druckpixel je Fotopixel
  const k = LOUPE.zoom === 'px' ? 1 : ppmm / CSS_PX_MM;                                               // Druckpixel je CSS-Pixel
  const w = Math.min(1600, Math.round(box.w * k)), h = Math.min(1600, Math.round(box.h * k));
  const bw = w / scale / ph.w;                                                                         // Ausschnitt als Teil der Fotobreite
  el.hidden = false;
  el.style.width = box.w + 'px';
  const view = el.querySelector('.loupe-view'), phEl = el.querySelector('.loupe-ph'), img = el.querySelector('img');
  view.style.height = box.h + 'px';
  // Platzhalter: die Vorschau des Editors, vergrößert (mit demselben Rezept-Filter)
  const bgW = box.w / bw, bgH = bgW * ph.h / ph.w;
  if (hit.href) {
    phEl.style.backgroundImage = `url("${hit.href.replace(/"/g, '%22')}")`;
    phEl.style.backgroundSize = `${bgW}px ${bgH}px`;
    phEl.style.backgroundPosition = `${box.w / 2 - u * bgW}px ${box.h / 2 - v * bgH}px`;
    phEl.style.filter = hit.filter || '';
  }
  const dpi = Math.round(ppmm * 25.4), mmW = w / ppmm, mmH = h / ppmm;
  el.querySelector('.loupe-info').textContent = _t('{dpi} dpi · zeigt {w} × {h} mm', { dpi, w: fmt1(mmW), h: fmt1(mmH) });
  // Lage: neben dem Zeiger, im Fenster
  const gap = 24, vw = window.innerWidth, vh = window.innerHeight, H = el.offsetHeight || box.h + 40;
  let left = hit.x + gap, top = hit.y - H - gap;
  if (left + box.w > vw - 8) left = hit.x - box.w - gap;
  if (coarse()) left = (vw - box.w) / 2;
  if (top < 8) top = Math.min(vh - H - 8, hit.y + gap);
  el.style.left = Math.max(8, left) + 'px'; el.style.top = Math.max(8, top) + 'px';
  // scharfes Bild vom Dienst, sobald der Zeiger kurz ruht
  const a = loupeAsset(ph), c = compileAdjust(adjOf(ph.id)), pr = typeof printerOf === 'function' && PRN.loaded ? printerOf() : null;
  const fx = fxOf(ph.id, false);
  const q = [`cx=${u.toFixed(4)}`, `cy=${v.toFixed(4)}`, `w=${w}`, `h=${h}`, `scale=${scale.toFixed(5)}`, `pw=${ph.w}`,
    fx && 'fx=' + fx, c && 'adj=' + encodeURIComponent(c.m.map(x => +x.toFixed(4)).join(',') + ';' + c.lut.map(x => +x.toFixed(4)).join(',')),
    pr && 'printer=' + encodeURIComponent(pr.id), pr && tuneOn() && 'tune=1', pr && proofOn() && 'proof=1', pr && proofOn() && ui.proofPaper === false && 'paper=0',
    `v=${a.contentHash.slice(0, 12)}`, SVC.token && 'token=' + encodeURIComponent(SVC.token)].filter(Boolean).join('&');
  const url = `api/${PP(`/assets/${a.id}/loupe`)}?${q}`;
  img.style.width = box.w + 'px'; img.style.height = box.h + 'px';
  if (url === LOUPE.want) return;
  LOUPE.want = url; img.classList.remove('on'); el.classList.add('loading');
  clearTimeout(LOUPE.timer);
  LOUPE.timer = setTimeout(() => { if (LOUPE.want === url) { img.dataset.src = url; img.src = url; } }, 140);
}
// Nach Änderungen am Foto (Regler, Druckansicht) dieselbe Stelle neu zeigen
function loupeRefresh() {
  if (!ui.loupe || !LOUPE.at) return;
  const hit = loupeHit(LOUPE.at.x, LOUPE.at.y);
  if (hit) loupeShow(hit); else loupeHide();
}

ACTIONS.loupe = () => loupeToggle();
ACTIONS.loupezoom = (el) => { LOUPE.zoom = el.dataset.v; loupeRender(); if (LOUPE.at) loupeShow(LOUPE.at); };

// Maus: der Zeiger führt; Finger: antippen oder darüberfahren (verschiebt dann keinen Rahmen)
document.addEventListener('pointermove', (e) => {
  if (!ui.loupe || ui.view !== 'design') return;
  if (e.pointerType !== 'mouse' && !LOUPE.touch) return;
  if (LOUPE.el && LOUPE.el.contains(e.target)) return;
  const hit = loupeHit(e.clientX, e.clientY);
  if (hit) { loupeShow(hit); if (LOUPE.touch) e.preventDefault(); } else if (e.pointerType === 'mouse') loupeHide();
}, { passive: false });
document.addEventListener('pointerdown', (e) => {
  if (!ui.loupe || ui.view !== 'design' || e.pointerType === 'mouse') return;
  const hit = loupeHit(e.clientX, e.clientY); if (!hit) return;
  LOUPE.touch = true; LOUPE.eat = true; e.preventDefault(); e.stopPropagation();
  loupeShow(hit);
}, true);
document.addEventListener('pointerup', () => { LOUPE.touch = false; }, true);
document.addEventListener('click', (e) => {          // der Tipp für die Lupe wählt keinen Rahmen aus
  if (LOUPE.eat && e.target.closest && e.target.closest('#editor')) { e.stopPropagation(); e.preventDefault(); }
  LOUPE.eat = false;
}, true);
document.addEventListener('pointercancel', () => { LOUPE.touch = false; }, true);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && ui.loupe) { e.stopImmediatePropagation(); loupeToggle(false); }
}, true);
