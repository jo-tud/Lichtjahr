/* ---------- Serienbilder: das beste Foto vorschlagen ----------
   Wer im Urlaub fünfmal hintereinander abdrückt, hat fünf fast gleiche Fotos. Lichtjahr findet solche Serien
   (gleicher Monat, gleicher Tag, sehr ähnliches Bild) und schlägt je Serie das beste vor: am schärfsten, gut
   belichtet, Gesichter gut sichtbar, Favorit zählt mit. Die übrigen lassen sich mit einem Klick aussortieren;
   steht eines davon im Kalender, rückt das gewählte an seine Stelle. Alles rechnet die Oberfläche selbst. */
const SERIES = { key: '', groups: null, busy: false, info: {} };

// Fingerabdruck und Güte eines Fotos (auf der Vorschau, zwischengespeichert)
async function seriesInfo(id) {
  const ph = S.photos[id]; if (!ph) return null;
  const ck = id + '|' + (RT.prev[id] || RT.thumb[id] || '');
  if (SERIES.info[ck]) return SERIES.info[ck];
  const px = await photoPixels(id, 320); if (!px) return null;
  const { w, h, data } = px, g = new Float32Array(w * h);
  let mean = [0, 0, 0], clip = 0;
  for (let i = 0, p = 0; p < w * h; p++, i += 4) {
    g[p] = .299 * data[i] + .587 * data[i + 1] + .114 * data[i + 2];
    mean[0] += data[i]; mean[1] += data[i + 1]; mean[2] += data[i + 2];
    if (g[p] > 250 || g[p] < 4) clip++;
  }
  mean = mean.map(v => v / (w * h));
  // Schärfe: Varianz des Laplace-Filters
  let s = 0, s2 = 0, n = 0;
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x, l = 4 * g[i] - g[i - 1] - g[i + 1] - g[i - w] - g[i + w];
    s += l; s2 += l * l; n++;
  }
  const sharp = n ? s2 / n - (s / n) ** 2 : 0;
  // dHash 8×8: Helligkeitsverlauf auf einem 9×8-Raster
  const cell = (cx, cy) => { let a = 0, c = 0; const x0 = Math.floor(cx * w / 9), x1 = Math.floor((cx + 1) * w / 9), y0 = Math.floor(cy * h / 8), y1 = Math.floor((cy + 1) * h / 8);
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { a += g[y * w + x]; c++; } return c ? a / c : 0; };
  const bits = [];
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits.push(cell(x, y) < cell(x + 1, y) ? 1 : 0);
  const faces = facesOf(id) || [], faceArea = faces.reduce((a, f) => a + f.w * f.h * (f.score || 1), 0);
  return (SERIES.info[ck] = { bits, mean, sharp, clip: clip / (w * h), faces: faces.length, faceArea, aspect: ph.w / ph.h });
}
const hamming = (a, b) => a.reduce((d, v, i) => d + (v !== b[i]), 0);

// Serien finden: Paare mit ähnlichem Bild verbinden (Union-Find), nur innerhalb eines Monats und Tages
async function findSeries() {
  const byBucket = {};
  for (const ph of Object.values(S.photos)) (byBucket[`${ph.month}|${ph.date || ''}`] ||= []).push(ph.id);
  const groups = [];
  for (const ids of Object.values(byBucket)) {
    if (ids.length < 2) continue;
    const info = {};
    for (const id of ids) { const i = await seriesInfo(id); if (i) info[id] = i; }
    const list = ids.filter(id => info[id]), parent = Object.fromEntries(list.map(id => [id, id]));
    const find = (x) => (parent[x] === x ? x : (parent[x] = find(parent[x])));
    for (let a = 0; a < list.length; a++) for (let b = a + 1; b < list.length; b++) {
      const A = info[list[a]], B = info[list[b]];
      if (Math.abs(Math.log(A.aspect / B.aspect)) > .05) continue;
      const col = Math.hypot(A.mean[0] - B.mean[0], A.mean[1] - B.mean[1], A.mean[2] - B.mean[2]);
      if (hamming(A.bits, B.bits) <= 10 && col < 28) parent[find(list[a])] = find(list[b]);
    }
    const sets = {};
    for (const id of list) (sets[find(id)] ||= []).push(id);
    for (const set of Object.values(sets)) if (set.length > 1) groups.push(rankSeries(set, info));
  }
  return groups;
}
// Bestes Foto einer Serie: Schärfe (relativ zur Serie), wenig Beschnittenes, Gesichter, Favorit
function rankSeries(ids, info) {
  const maxSharp = Math.max(...ids.map(id => info[id].sharp)) || 1, maxFace = Math.max(...ids.map(id => info[id].faceArea)) || 1;
  const score = {};
  for (const id of ids) {
    const i = info[id];
    score[id] = .55 * (i.sharp / maxSharp) + .2 * (1 - Math.min(1, i.clip * 5)) + .15 * (i.faceArea / maxFace) + (S.photos[id].fav ? .15 : 0);
  }
  const sorted = [...ids].sort((a, b) => score[b] - score[a]);
  return { ids: sorted, best: sorted[0], score };
}
function seriesKey() { return Object.values(S.photos).map(p => p.id + (p.month ?? '') + (p.date || '')).sort().join(','); }
function refreshSeries(after) {
  const key = seriesKey();
  if (SERIES.busy || SERIES.key === key) return;
  SERIES.busy = true;
  findSeries().then(g => { SERIES.groups = g; SERIES.key = key; }).catch(e => console.warn('Serien', e)).finally(() => { SERIES.busy = false; if (after) after(); });
}
const seriesReady = () => SERIES.key === seriesKey() && SERIES.groups;

// Dialog: je Serie die Fotos, das vorgeschlagene markiert; antippen wählt, welches bleibt
async function openSeriesDialog() {
  if (!seriesReady()) { const bar = busy(_t('Ähnliche Fotos werden gesucht'), ''); if (facesReady()) await loadFaces(Object.keys(S.photos), bar); SERIES.key = ''; await new Promise(r => refreshSeries(r)); bar.close(); }
  const groups = SERIES.groups || [];
  if (!groups.length) { toast(_t('Keine Serien mit fast gleichen Fotos gefunden.')); return; }
  const keep = groups.map(g => new Set([g.best]));
  const el = document.createElement('div'); el.className = 'busy'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true');
  const removedN = () => groups.reduce((n, g, i) => n + g.ids.length - keep[i].size, 0);
  const render = () => {
    el.innerHTML = `<div class="card series-card"><h2>${_t('Ähnliche Fotos')}</h2>
      <p class="hint">${groups.length === 1 ? _t('1 Serie mit fast gleichen Fotos.') : _t('{n} Serien mit fast gleichen Fotos.', { n: groups.length })} ${_t('Lichtjahr schlägt jeweils das schärfste, gut belichtete Foto vor. Antippen wählt, welche bleiben.')}</p>
      <div class="series-list">${groups.map((g, i) => `<div class="series-row"><span class="small muted">${esc(MONTHS[S.photos[g.best].month] || _t('Ohne Monat'))}</span><div class="series-thumbs">${g.ids.map(id => `<button class="series-ph${keep[i].has(id) ? ' keep' : ''}" data-g="${i}" data-id="${id}" aria-pressed="${keep[i].has(id)}"><img src="${RT.thumb[id]}" alt="">${id === g.best ? `<span class="badge">★ ${_t('Vorschlag')}</span>` : ''}</button>`).join('')}</div></div>`).join('')}</div>
      <div class="row"><button class="btn primary" data-ok ${removedN() ? '' : 'disabled'}>${_t('Übrige aussortieren ({n})', { n: removedN() })}</button><button class="btn" data-cancel>${_t('Abbrechen')}</button></div></div>`;
  };
  const done = (ok) => {
    document.removeEventListener('keydown', key, true); el.remove();
    if (!ok) return;
    const u = usage();
    let n = 0;
    groups.forEach((g, i) => {
      const gone = g.ids.filter(id => !keep[i].has(id)), stay = g.ids.filter(id => keep[i].has(id)), heir = stay.find(id => !u[id]);
      for (const id of gone) {
        // steht ein aussortiertes Foto im Kalender, rückt ein behaltenes (noch nicht verwendetes) an seine Stelle
        for (const p of Object.values(S.pages)) for (const s of [...(p.slots || []), ...(p.extra || [])]) if (s.photo === id) { if (heir) s.photo = heir; else Object.assign(s, newSlot()); }
        delete S.photos[id]; n++;
      }
    });
    commit(); renderAll();
    toast(n === 1 ? _t('1 Foto aussortiert. Rückgängig ist möglich.') : _t('{n} Fotos aussortiert. Rückgängig ist möglich.', { n }), 6000, { label: _t('Rückgängig'), fn: undo });
  };
  const key = (e) => { if (e.key === 'Escape') { e.stopPropagation(); done(false); } };
  el.addEventListener('click', (e) => {
    const b = e.target.closest('.series-ph');
    if (b) { const s = keep[+b.dataset.g]; if (s.has(b.dataset.id)) { if (s.size > 1) s.delete(b.dataset.id); } else s.add(b.dataset.id); render(); return; }
    if (e.target.closest('[data-ok]')) done(true); else if (e.target.closest('[data-cancel]')) done(false);
  });
  document.addEventListener('keydown', key, true);
  render(); document.body.appendChild(el);
  (el.querySelector('[data-ok]:not([disabled])') || el.querySelector('[data-cancel]')).focus();
}
