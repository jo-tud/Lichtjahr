/* ---------- Gesichter ----------
   Der lokale Dienst findet Gesichter (wo, nicht wer). Damit
   - hält der automatische Ausschnitt Gesichter im Bild, mit etwas Luft über den Köpfen,
   - meidet das Kalendarium Gesichter, wenn es seinen Platz sucht,
   - meldet die Prüfliste angeschnittene oder verdeckte Gesichter.
   Ohne Dienst (oder ohne OpenCV im Dienst) bleibt alles wie bisher. */
const FACES = { on: null, map: {}, loading: null };       // on: null = noch unbekannt, false = nicht verfügbar
const faceAsset = (ph) => (SVC.assets[ph.id] ? ph.id : ph.copyOf);
const facesOf = (id) => { const ph = S.photos[id]; return ph ? FACES.map[faceAsset(ph)] || null : null; };
const facesReady = () => !!SVC.pid && FACES.on !== false;

async function loadFaces(ids, bar = null) {
  if (!facesReady()) return;
  const want = [...new Set(ids.map(id => S.photos[id] && faceAsset(S.photos[id])).filter(a => a && SVC.assets[a] && !(a in FACES.map)))];
  for (let i = 0; i < want.length; i += 24) {
    if (bar) bar.update(i / want.length, _t('Gesichter werden gesucht …'));
    try {
      const r = await api(PP('/faces'), { method: 'POST', body: { ids: want.slice(i, i + 24) } });
      FACES.on = !!r.available; if (!r.available) return;
      Object.assign(FACES.map, r.faces);
    } catch (e) { console.warn('Gesichter', e); return; }
  }
}
// Im Hintergrund für alle Fotos vorab holen; der Dienst merkt sich die Ergebnisse
function prefetchFaces() {
  if (!facesReady() || FACES.loading) return;
  FACES.loading = loadFaces(Object.keys(S.photos)).finally(() => { FACES.loading = null; refreshFaces(); });
}

// Nach dem Laden: Editor (Hinweise auf Gesichter) neu zeichnen, falls er gerade zu sehen ist
const refreshFaces = () => { if (ui.view === 'design' && $('#canvasWrap')) { renderEditor(); updateThumb(); } };

const weightOf = (f) => Math.pow(f.w * f.h, .75) * (f.score || 1);
const overlap = (a, b) => { const r = intersect(a, b); return r ? r.w * r.h : 0; };

// Bester Ausschnitt (cx, cy) für „Füllen“ ohne Drehung: alle wichtigen Gesichter ganz im sichtbaren Teil
// (Beschnitt und 3 mm Rand zählen nicht), lieber ein Gesicht ganz weglassen als es anschneiden; dazu Gesichter
// waagrecht mittig und auf etwa 40 % der Höhe.
function faceCrop(r, ph, sl) {
  const fs = facesOf(ph.id);
  if (!fs || !fs.length || sl.fit === 'contain' || (sl.rot || 0) !== 0) return null;
  const pl = placeImage(r, ph, sl), dw = pl.w, dh = pl.h;
  const V = intersect(r, { x: 3, y: 3, w: S.doc.w - 6, h: S.doc.h - 6 }); if (!V) return null;
  const ex = Math.min(.5, r.w / 2 / dw), ey = Math.min(.5, r.h / 2 / dh), steps = 40;
  let best = null;
  for (let a = 0; a <= steps; a++) for (let b = 0; b <= steps; b++) {
    const cx = ex + (1 - 2 * ex) * a / steps, cy = ey + (1 - 2 * ey) * b / steps;
    const win = { x: cx + (V.x - pl.fx) / dw, y: cy + (V.y - pl.fy) / dh, w: V.w / dw, h: V.h / dh };
    let s = 0, U = null;
    for (const f of fs) {
      const vis = overlap(f, win) / (f.w * f.h), w = weightOf(f);
      if (vis > .97) { s += w; U = U ? union(U, f) : { ...f }; } else if (vis > .03) s += w * (vis * .3 - .6);
    }
    if (U) s -= (Math.abs(U.x + U.w / 2 - (win.x + win.w / 2)) / win.w + Math.abs((U.y + U.h / 2 - win.y) / win.h - .4)) * .15 * weightOf(fs[0]);
    s -= .01 * Math.hypot(cx - .5, cy - .5) * weightOf(fs[0]);
    if (!best || s > best.s) best = { s, cx, cy };
  }
  return best && { cx: best.cx, cy: best.cy };
}
const union = (a, b) => { const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y); return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y }; };
const defaultCrop = (sl) => (sl.zoom || 1) === 1 && (sl.cx ?? .5) === .5 && (sl.cy ?? .5) === .5 && !(sl.rot || 0) && sl.fit !== 'contain';

// Ausschnitt eines Rahmens an Gesichtern ausrichten, wenn er noch unverändert ist. true, wenn sich etwas geändert hat.
function applyFaces(p, i) {
  const sl = slotOf(p, i), ph = sl && sl.photo && S.photos[sl.photo], r = ph && rectOf(p, i);
  if (!r || !defaultCrop(sl)) return false;
  const c = faceCrop(r, ph, sl); if (!c) return false;
  sl.cx = c.cx; sl.cy = c.cy; return true;
}
// Wie applyFaces, aber lädt fehlende Gesichter erst nach (dann eigener Schritt im Verlauf)
async function applyFacesLater(key, i) {
  const p = S.pages[key], sl = p && slotOf(p, i); if (!sl || !sl.photo || facesOf(sl.photo)) return;
  const photo = sl.photo;
  await loadFaces([photo]);
  if (S.pages[key] === p && slotOf(p, i).photo === photo && applyFaces(p, i)) { commit(); refreshFaces(); }
}

// Gesichter einer Seite in Seiten-mm, mit dem Anteil, der im Endformat sichtbar ist
function pageFaces(p) {
  const W = S.doc.w, H = S.doc.h, out = [];
  for (const it of pageItems(p, { noBlocks: true })) {
    if (it.t !== 'img') continue;
    const ph = S.photos[it.photo], fs = facesOf(it.photo); if (!fs) continue;
    const pl = it.place, th = (pl.rot || 0) * Math.PI / 180, cs = Math.cos(th), sn = Math.sin(th);
    const pt = (u, v) => { const dx = (u - pl.cx) * pl.w, dy = (v - pl.cy) * pl.h; return [pl.fx + dx * cs - dy * sn, pl.fy + dx * sn + dy * cs]; };
    const vis = intersect(it.clip, { x: 0, y: 0, w: W, h: H });
    for (const f of fs) {
      const P = [pt(f.x, f.y), pt(f.x + f.w, f.y), pt(f.x, f.y + f.h), pt(f.x + f.w, f.y + f.h)];
      const x = Math.min(...P.map(q => q[0])), y = Math.min(...P.map(q => q[1]));
      const box = { x, y, w: Math.max(...P.map(q => q[0])) - x, h: Math.max(...P.map(q => q[1])) - y };
      if (box.h < 4) continue;                                     // winzig im Hintergrund: egal
      // Kopf: Gesicht plus Haare darüber und etwas zur Seite; das Kalendarium soll auch die nicht verdecken
      const head = { x: box.x - box.w * .15, y: box.y - box.h * .45, w: box.w * 1.3, h: box.h * 1.45 };
      out.push({ ...box, head, vis, shown: vis ? overlap(box, vis) / (box.w * box.h) : 0, photo: ph.id });
    }
  }
  return out;
}
// Wie stark verdeckt ein Rechteck Gesichter? Summe der verdeckten Anteile (große Gesichter zählen voll)
function faceCover(faces, r) {
  let s = 0;
  for (const f of faces) if (f.shown > .5) s += overlap(f.head, r) / (f.head.w * f.head.h) * Math.min(1, f.h / 12);
  return s;
}
