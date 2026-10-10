/* ---------- Wer ist wie oft auf den Fotos ----------
   Der lokale Dienst liefert je Gesicht 128 Merkmale (SFace); hier werden ähnliche Gesichter zu Personen gruppiert
   (Kosinus-Ähnlichkeit zum Mittel der Gruppe über 0,40). Gezählt wird, auf wie vielen Fotos jemand ist und wie oft
   im Kalender – damit niemand aus der Familie zu kurz kommt. Namen stehen im Projekt nur als Name plus Verweis auf
   ein Beispielgesicht (Prüfsumme des Fotos und Nummer des Gesichts); Gesichtsmerkmale kommen nie ins Projekt. */
const PEOPLE = { ready: null, faces: {}, groups: null, key: '', busy: false };
const PEOPLE_SIM = .40;

async function peopleStatus() {
  if (!SVC.pid) return false;
  if (PEOPLE.ready === null) { try { PEOPLE.ready = !!(await api('people/model')).ready; } catch (e) { PEOPLE.ready = false; } }
  return PEOPLE.ready;
}
async function loadPeopleFaces(ids, bar) {
  const want = [...new Set(ids.map(id => S.photos[id] && faceAsset(S.photos[id])).filter(a => a && SVC.assets[a] && !(a in PEOPLE.faces)))];
  for (let i = 0; i < want.length; i += 16) {
    if (bar) bar.update(i / want.length, _t('{n} von {total}', { n: i, total: want.length }));
    const r = await api(PP('/people'), { method: 'POST', body: { ids: want.slice(i, i + 16) } });
    if (!r.ready) return false;
    Object.assign(PEOPLE.faces, r.faces);
  }
  return true;
}
const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };
const unit = (v) => { const n = Math.hypot(...v) || 1; return v.map(x => x / n); };
const faceRef = (asset, i) => `${(SVC.assets[asset] || {}).contentHash || asset}:${i}`;

// Gesichter zu Personen gruppieren; je Person die Fotos (Original-IDs, Kopien zählen nicht doppelt)
function groupPeople() {
  const faces = [];
  for (const [asset, list] of Object.entries(PEOPLE.faces)) (list || []).forEach((f, i) => { if (f.emb) faces.push({ asset, i, f, area: f.w * f.h }); });
  faces.sort((a, b) => b.area - a.area);
  const groups = [];
  for (const x of faces) {
    let best = null, sim = PEOPLE_SIM;
    for (const g of groups) { const s = dot(g.c, x.f.emb); if (s > sim) { sim = s; best = g; } }
    if (!best) { best = { sum: x.f.emb.map(() => 0), c: x.f.emb, faces: [], assets: new Set() }; groups.push(best); }
    best.faces.push(x); best.assets.add(x.asset);
    best.sum = best.sum.map((v, k) => v + x.f.emb[k]); best.c = unit(best.sum);
  }
  const named = S.doc.people || [];
  return groups.filter(g => g.assets.size >= 2).map(g => {
    const refs = new Set(g.faces.map(x => faceRef(x.asset, x.i)));
    const person = named.find(p => refs.has(p.ref));
    return { faces: g.faces, assets: g.assets, rep: g.faces[0], name: person ? person.name : '', ref: person ? person.ref : faceRef(g.faces[0].asset, g.faces[0].i) };
  }).sort((a, b) => b.assets.size - a.assets.size);
}
// Fotos (IDs in S.photos) einer Person und wie oft sie im Kalender steht
function personPhotos(g) { return Object.values(S.photos).filter(ph => g.assets.has(faceAsset(ph))).map(ph => ph.id); }
function personInCalendar(g) { const u = usage(); return personPhotos(g).reduce((n, id) => n + (u[id] ? u[id].filter(k => pageMonth(k) != null || k === 'cover').length : 0), 0); }

function peopleKey() { return Object.keys(PEOPLE.faces).sort().join(',') + '|' + JSON.stringify(S.doc.people || []); }
const facesMissing = () => Object.values(S.photos).some(ph => { const a = faceAsset(ph); return a && SVC.assets[a] && !(a in PEOPLE.faces); });
// Nur rechnen, wenn Fotos oder Namen neu sind, und nur dann neu zeichnen (sonst stößt das Zeichnen das Rechnen wieder an)
function refreshPeople(after) {
  if (!SVC.pid || PEOPLE.busy || S.doc.peopleOff || PEOPLE.ready === false) return;
  if (PEOPLE.ready && PEOPLE.groups && !facesMissing() && PEOPLE.key === peopleKey()) return;
  PEOPLE.busy = true;
  const before = `${PEOPLE.ready}|${PEOPLE.key}`;
  (async () => {
    if (!(await peopleStatus())) return;
    await loadPeopleFaces(Object.keys(S.photos));
    const key = peopleKey();
    if (key !== PEOPLE.key || !PEOPLE.groups) { PEOPLE.groups = groupPeople(); PEOPLE.key = key; }
  })().catch(e => { console.warn('Personen', e); PEOPLE.ready = false; }).finally(() => { PEOPLE.busy = false; if (after && `${PEOPLE.ready}|${PEOPLE.key}` !== before) after(); });
}

// Gesichtsausschnitt als Hintergrund des Vorschaubilds (quadratisch, etwas Luft)
function faceAvatar(x, size = 64) {
  const ph = Object.values(S.photos).find(p => faceAsset(p) === x.asset); if (!ph) return '';
  const f = x.f, W = ph.w, H = ph.h, side = 1.9 * Math.max(f.w * W, f.h * H), sw = Math.min(1, side / W), sh = Math.min(1, side / H);
  const cx = f.x + f.w / 2, cy = f.y + f.h * .45;
  const x0 = Math.max(0, Math.min(1 - sw, cx - sw / 2)), y0 = Math.max(0, Math.min(1 - sh, cy - sh / 2));
  const px = sw < 1 ? x0 / (1 - sw) * 100 : 0, py = sh < 1 ? y0 / (1 - sh) * 100 : 0;
  return `<span class="avatar" style="width:${size}px;height:${size}px;background-image:url('${RT.thumb[ph.id]}');background-size:${100 / sw}% ${100 / sh}%;background-position:${px}% ${py}%"></span>`;
}

// Karte in der Fotoübersicht
function peopleCard() {
  if (!SVC.pid || S.doc.peopleOff || Object.keys(S.photos).length < 8) return '';
  refreshPeople(() => { if (ui.view === 'photos') renderPhotos(); });
  if (PEOPLE.ready === false) return `<section class="card cta"><div><h2>${_t('Wer ist wie oft auf den Fotos?')}</h2>
    <p class="hint">${_t('Lichtjahr kann Gesichter wiedererkennen und zählen, wer wie oft vorkommt – ganz auf diesem Rechner, nichts verlässt ihn. Dafür einmalig das Erkennungsmodell laden (10 MB).')}</p></div>
    <div class="row"><button class="btn primary" data-act="peopleload">${_t('Laden und zählen')}</button><button class="btn" data-act="peopleoff">${_t('Nicht jetzt')}</button></div></section>`;
  const g = PEOPLE.groups; if (!g || !g.length) return '';
  const missing = g.filter(x => personInCalendar(x) === 0).length;
  return `<section class="card cta people-cta"><div><h2>${g.length === 1 ? _t('1 Person mehrfach auf den Fotos') : _t('{n} Personen mehrfach auf den Fotos', { n: g.length })}</h2>
    <p class="hint">${g.slice(0, 8).map(x => faceAvatar(x.rep, 34)).join('')} ${missing ? (missing === 1 ? _t('1 davon kommt im Kalender noch nicht vor.') : _t('{n} davon kommen im Kalender noch nicht vor.', { n: missing })) : _t('Alle kommen im Kalender vor.')}</p></div>
    <button class="btn primary" data-act="people">${_t('Ansehen')}</button></section>`;
}
// Übersicht: wer, wie oft, wie oft im Kalender; Namen vergeben; Fotos einer Person zeigen
function openPeopleDialog() {
  const g = PEOPLE.groups || []; if (!g.length) return;
  const el = document.createElement('div'); el.className = 'busy'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true');
  el.innerHTML = `<div class="card people-card"><h2>${_t('Wer ist wie oft auf den Fotos')}</h2>
    <p class="hint">${_t('Gezählt auf diesem Rechner; im Projekt stehen nur die Namen. Wer im Kalender fehlt, steht oben.')}</p>
    <div class="people-grid">${[...g].sort((a, b) => (personInCalendar(a) > 0) - (personInCalendar(b) > 0) || b.assets.size - a.assets.size).map(x => {
      const cal = personInCalendar(x), n = personPhotos(x).length, i = g.indexOf(x);
      return `<div class="person">${faceAvatar(x.rep, 72)}<div><input type="text" value="${esc(x.name)}" placeholder="${esc(_t('Name'))}" data-person="${i}" aria-label="${esc(_t('Name'))}">
        <span class="small muted">${n === 1 ? _t('auf 1 Foto') : _t('auf {n} Fotos', { n })} · ${cal ? (cal === 1 ? _t('1× im Kalender') : _t('{n}× im Kalender', { n: cal })) : `<b class="bad-text">${_t('noch nicht im Kalender')}</b>`}</span>
        <button class="linkbtn" data-show="${i}">${_t('Fotos zeigen')}</button></div></div>`; }).join('')}</div>
    <div class="row"><button class="btn primary" data-ok>${_t('Fertig')}</button></div></div>`;
  const save = () => {
    const named = (S.doc.people || []).filter(p => !g.some(x => x.ref === p.ref));
    el.querySelectorAll('[data-person]').forEach(inp => { const x = g[+inp.dataset.person], name = inp.value.trim(); x.name = name; if (name) named.push({ name, ref: x.ref }); });
    S.doc.people = named; commit();
  };
  const done = (show) => { save(); document.removeEventListener('keydown', key, true); el.remove(); if (show != null) { ui.personFilter = new Set(personPhotos(g[show])); ui.personName = g[show].name || _t('dieser Person'); setView('photos'); } else renderAll(); };
  const key = (e) => { if (e.key === 'Escape') { e.stopPropagation(); done(); } };
  el.addEventListener('click', (e) => { const s = e.target.closest('[data-show]'); if (s) done(+s.dataset.show); else if (e.target.closest('[data-ok]')) done(); });
  document.addEventListener('keydown', key, true);
  document.body.appendChild(el); el.querySelector('[data-ok]').focus();
}
// Prüfliste: benannte Personen, die im Kalender fehlen
function peopleChecks() {
  if (!PEOPLE.groups) return [];
  return PEOPLE.groups.filter(x => x.name && personInCalendar(x) === 0).map(x => ['warn', _t('{name} kommt im Kalender noch nicht vor (auf {n} Fotos)', { name: x.name, n: personPhotos(x).length }), null]);
}
