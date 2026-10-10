/* ---------- Lokaler Dienst: Projektordner statt Browser-Speicher ----------
   Wird die Oberfläche vom lokalen Dienst ausgeliefert (lichtjahr serve), arbeitet sie in einem Projektordner:
   Fotos kommen aus den Monatsordnern, der Gestaltungsstand landet in lichtjahr.json, das PDF in Export/.
   Ohne Dienst (Datei, GitHub Pages) bleibt alles wie bisher im Browser.

   Grundsätze:
   - Der Zugriffsschlüssel steht nur in der Adresse und im Arbeitsspeicher, nie im Browser-Speicher.
   - Schreiben nur mit Bearbeitungssperre; ohne Sperre „Nur ansehen“.
   - Monate sind Ordner: Verschiebt die Oberfläche ein Foto in einen anderen Monat (auch per Rückgängig),
     wandert beim Speichern die Datei. Entfernte Fotos werden nur aussortiert, Dateien bleiben liegen.
   - Alle schreibenden Aufrufe laufen nacheinander (Warteschlange), damit sie sich nicht überholen. */
const SVC = {
  on: false, token: null, pid: null, info: null, session: null, readOnly: false, lock: null,
  assets: {}, queue: Promise.resolve(), timer: null, pending: false, beat: null, retry: null,
  lastScan: 0, offline: false, warnedRO: false,
};
const SVC_BEAT = 30000, SVC_RETRY = 20000;

async function api(path, { method = 'GET', body, form, keepalive = false } = {}) {
  const headers = { 'Accept-Language': LANG };   // Fehlermeldungen und Prüfbericht des Dienstes in der Sprache der Oberfläche
  if (SVC.token) headers.Authorization = 'Bearer ' + SVC.token;
  if (SVC.session) headers['X-Lichtjahr-Session'] = SVC.session;
  let payload;
  if (form) payload = form;
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const r = await fetch('api/' + path, { method, headers, body: payload, keepalive, cache: 'no-store' });
  let data = null;
  try { data = await r.json(); } catch (e) { /* keine JSON-Antwort */ }
  if (!r.ok) {
    const err = new Error((data && data.detail) || _t('Der Dienst meldet Fehler {status}.', { status: r.status }));
    err.status = r.status; err.data = data; throw err;
  }
  return data;
}
const PP = (rest = '') => `projects/${SVC.pid}${rest}`;
// Nacheinander ausführen; ein Fehler hält die Warteschlange nicht an
function serial(fn) { const p = SVC.queue.then(fn); SVC.queue = p.catch(() => {}); return p; }

async function detectService() {
  if (location.protocol === 'file:') return false;
  try {
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 2000);
    const r = await fetch('api/health', { cache: 'no-store', signal: ctl.signal });
    clearTimeout(t);
    const j = r.ok ? await r.json() : null;
    return !!(j && j.ok && j.version);
  } catch (e) { return false; }
}
function deviceName() {
  const ua = navigator.userAgent;
  const dev = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : _t('Gerät');
  const br = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  return _t('{browser} auf {device}', { browser: br, device: dev });
}
const ago = (t) => { const s = Math.max(0, Math.round(Date.now() / 1000 - t)); return s < 60 ? _t('vor {n} s', { n: s }) : s < 3600 ? _t('vor {n} min', { n: Math.round(s / 60) }) : _t('vor {n} h', { n: Math.round(s / 3600) }); };
function setSaveState(text) { const s = $('#saveState'); if (s) s.textContent = text; }

/* ----- Fotos aus dem Projekt ----- */
const usable = (a) => a.widthPx > 0 && a.heightPx > 0;
const baseName = (p) => p.split('/').pop();
function assetUrls(a) {
  const q = (size) => `api/${PP(`/assets/${a.id}/thumb`)}?size=${size}&v=${a.contentHash.slice(0, 12)}c${SVC.token ? '&token=' + encodeURIComponent(SVC.token) : ''}`;
  RT.thumb[a.id] = q(360); RT.prev[a.id] = q(1600);
}
// Was die Datei vorgibt (Ordner, Größe, Datum); Bildtext und Favorit pflegt die Oberfläche
function fileFacts(a) {
  return { name: baseName(a.path), path: a.path, size: a.size, w: a.widthPx, h: a.heightPx, month: a.month ?? -1,
    src: a.month == null ? 'Ordner „Ohne Monat“' : 'Monatsordner', date: a.captureDate || null, missing: a.status === 'missing',
    suggested: a.suggestedMonth ?? null };
}
function photoFromAsset(a, old) {
  return { id: a.id, caption: old ? old.caption : a.caption || '', fav: old ? old.fav : !!a.favorite, demo: null,
    ...(a.copyOf ? { copyOf: a.copyOf } : {}), ...fileFacts(a) };
}
function gotAsset(a) { SVC.assets[a.id] = a; assetUrls(a); return a; }
// Verlauf (Rückgängig) an Änderungen anpassen, die nicht vom Nutzer stammen (Abgleich, neue IDs)
function rebaseHistory(fn) {
  const fix = (j) => { if (!j) return j; const o = JSON.parse(j); fn(o); return JSON.stringify(o); };
  hist.past = hist.past.map(fix); hist.future = hist.future.map(fix); hist.last = fix(hist.last);
}
function renamePhoto(oldId, newId) {
  const ph = S.photos[oldId]; if (!ph) return;
  S.photos[newId] = { ...ph, id: newId }; delete S.photos[oldId];
  for (const p of Object.values(S.pages)) for (const s of [...(p.slots || []), ...(p.extra || [])]) if (s.photo === oldId) s.photo = newId;
  if (ui.photoSel.delete(oldId)) ui.photoSel.add(newId);
  const q = (x) => `"${x}"`;
  hist.past = hist.past.map(j => j.replaceAll(q(oldId), q(newId)));
  hist.future = hist.future.map(j => j.replaceAll(q(oldId), q(newId)));
  if (hist.last) hist.last = hist.last.replaceAll(q(oldId), q(newId));
}

/* ----- Öffnen ----- */
async function serviceStart() {
  const params = new URLSearchParams(location.search);
  SVC.token = params.get('token');
  let list = [];
  try { list = await api('projects'); } catch (e) { if (e.status === 401) { showServiceError(_t('Zugriffsschlüssel fehlt oder ist falsch. Bitte die vollständige Adresse aus dem Terminal öffnen, in der „?token=…“ steht.')); return 'stop'; } }
  let want = params.get('projekt');
  if (!want) { try { want = localStorage.getItem('lj-project'); } catch (e) { /* egal */ } }
  if (!want && list.length === 1) want = list[0].id;     // nur ein Projekt: gleich öffnen (z. B. neues Gerät)
  if (want && list.some(p => p.id === want)) {
    try { await openProject(want); return 'open'; } catch (e) { return projectPicker(list, e.message); }
  }
  return projectPicker(list);
}
async function openProject(pid) {
  if (SVC.pid && SVC.pid !== pid) await leaveProject();
  SVC.pid = pid; SVC.readOnly = false; SVC.lock = null; SVC.assets = {}; SVC.warnedRO = false;
  try { SVC.session = sessionStorage.getItem('lj-session-' + pid); } catch (e) { SVC.session = null; }
  SVC.info = await api(PP());
  const notes = await acquireLock();
  const man = await api(PP('/manifest'));
  applyManifest(man);
  loadPrinters().then(() => { if (ui.view === 'design') renderStage(); });
  FACES.map = {}; FACES.on = null; prefetchFaces();
  try { localStorage.setItem('lj-project', pid); } catch (e) { /* egal */ }
  const u = new URL(location.href); u.searchParams.set('projekt', pid);
  try { history.replaceState(history.state, '', u.pathname + u.search + u.hash); } catch (e) { /* egal */ }
  clearInterval(SVC.beat); SVC.beat = setInterval(heartbeat, SVC_BEAT);
  renderServiceBanner();
  setSaveState(SVC.readOnly ? _t('Nur ansehen') : _t('Im Projektordner gespeichert'));
  if (notes && notes.length) setTimeout(() => toast(_t('Unterbrochene Dateiverschiebung aufgeräumt: {notes}', { notes: notes.join(' · ') }), 9000), 800);
  // Erst die Oberfläche zeigen, dann einen gesicherten Stand anbieten und neue Fotos aus den Ordnern holen
  if (!SVC.readOnly) setTimeout(async () => { await offerDraft(man); serviceScan(false); }, 400);
}
async function acquireLock() {
  try {
    const r = await api(PP('/lock'), { method: 'POST', body: { holder: deviceName() } });
    SVC.session = r.session; SVC.readOnly = false; SVC.lock = r.lock;
    try { sessionStorage.setItem('lj-session-' + SVC.pid, r.session); } catch (e) { /* egal */ }
    clearInterval(SVC.retry); SVC.retry = null;
    return r.recovered || [];
  } catch (e) {
    if (e.status !== 423) throw e;
    SVC.readOnly = true; SVC.lock = e.data && e.data.lock;
    clearInterval(SVC.retry); SVC.retry = setInterval(retryLock, SVC_RETRY);
    return [];
  }
}
function applyManifest(man) {
  const ed = man.editor || {}, fmt = FORMATS.find(f => f.id === man.format.id);
  const doc = { ...defaultDoc(), year: man.calendarYear };
  if (!ed.doc && fmt) Object.assign(doc, { format: fmt.id, w: fmt.w || man.format.widthMm, h: fmt.h || man.format.heightMm });
  // Kalendersprache: neues Projekt in der Sprache, in der es angelegt wurde (sonst der Oberfläche);
  // gespeicherte Stände ohne Angabe stammen aus der Zeit, als es nur Deutsch gab
  const projLang = man.language || (SVC.info && SVC.info.language);
  if (!ed.doc) doc.calLang = LANGS[projLang] ? projLang : LANG;
  S = { doc: { ...doc, ...(ed.doc || {}) }, pages: ed.pages || {}, photos: {}, demo: false };
  if (ed.doc && !ed.doc.calLang) S.doc.calLang = 'de';
  for (const a of man.assets) { gotAsset(a); if (!a.excluded && usable(a)) S.photos[a.id] = photoFromAsset(a); }
  for (const p of Object.values(S.pages)) for (const s of [...(p.slots || []), ...(p.extra || [])]) if (s.photo && !S.photos[s.photo]) s.photo = null;
  ui.photoSel.clear(); ui.sel = null; ui.crop = null; ui.banner = false;
  if (!pageKeys().includes(ui.page)) ui.page = 'm0';
  ensurePages();
  hist.past = []; hist.future = []; hist.last = snap(); updateUndo();
}
async function leaveProject() {
  await flushSave();
  clearInterval(SVC.beat); clearInterval(SVC.retry);
  if (SVC.session && !SVC.readOnly) { try { await api(PP('/lock'), { method: 'DELETE' }); } catch (e) { /* läuft ab */ } }
  try { sessionStorage.removeItem('lj-session-' + SVC.pid); } catch (e) { /* egal */ }
  SVC.pid = null; SVC.session = null;
}

/* ----- Sperre ----- */
async function heartbeat() {
  if (!SVC.pid || SVC.readOnly || !SVC.session) return;
  try { SVC.lock = (await api(PP('/lock/heartbeat'), { method: 'POST' })).lock; if (SVC.offline) { SVC.offline = false; scheduleServiceSave(); } }
  catch (e) { if (e.status === 423) lockLost(); else { SVC.offline = true; setSaveState(e.status === 503 ? _t('Nextcloud sperrt gerade kurz, nächster Versuch gleich …') : _t('Dienst nicht erreichbar')); } }
}
async function retryLock() {
  if (!SVC.readOnly || !SVC.pid) return;
  try {
    const r = await api(PP('/lock'), { method: 'POST', body: { holder: deviceName() } });
    SVC.session = r.session; SVC.lock = r.lock;
    try { sessionStorage.setItem('lj-session-' + SVC.pid, r.session); } catch (e) { /* egal */ }
    clearInterval(SVC.retry); SVC.retry = null;
    applyManifest(await api(PP('/manifest')));      // erst den Stand des anderen Fensters laden, dann bearbeiten
    SVC.readOnly = false; SVC.warnedRO = false;
    renderServiceBanner(); renderAll(); setSaveState(_t('Im Projektordner gespeichert'));
    toast(_t('Das Projekt ist jetzt frei. Du kannst weiterarbeiten.'), 6000);
    serviceScan(false);
  } catch (e) {
    if (e.status === 423) { SVC.lock = e.data && e.data.lock; renderServiceBanner(); }
  }
}
async function lockLost() {
  if (SVC.readOnly) return;
  SVC.readOnly = true; clearTimeout(SVC.timer); SVC.pending = false;
  // Letzten Stand auf diesem Rechner sichern; beim nächsten Öffnen wird er angeboten
  try { await api(PP('/draft'), { method: 'PUT', body: { savedAt: new Date().toISOString(), editor: editorState(), assets: photoMeta(true) } }); } catch (e) { /* egal */ }
  try { const r = await api(PP('/lock')); SVC.lock = r.lock; } catch (e) { /* egal */ }
  clearInterval(SVC.retry); SVC.retry = setInterval(retryLock, SVC_RETRY);
  renderServiceBanner(); setSaveState(_t('Nur ansehen'));
  await ask({ title: _t('Bearbeitung an anderer Stelle'),
    text: SVC.lock ? _t('Ein anderes Fenster ({holder}) bearbeitet das Projekt jetzt. Dein letzter Stand ist auf diesem Rechner gesichert und wird beim nächsten Öffnen angeboten.', { holder: SVC.lock.holder })
      : _t('Ein anderes Fenster bearbeitet das Projekt jetzt. Dein letzter Stand ist auf diesem Rechner gesichert und wird beim nächsten Öffnen angeboten.'),
    buttons: [{ label: _t('Verstanden'), value: true, primary: true }] });
}
async function offerDraft(man) {
  let d = null;
  try { d = await api(PP('/draft')); } catch (e) { return; }
  if (!d || !d.savedAt || !d.editor || Date.parse(d.savedAt) <= Date.parse(man.updated)) return;
  const when = new Date(d.savedAt).toLocaleString(locale(), { dateStyle: 'medium', timeStyle: 'short' });
  const r = await ask({ title: _t('Gesicherten Stand gefunden'),
    text: _t('Vom {when} gibt es einen Stand, der nicht mehr ins Projekt gespeichert werden konnte (die Bearbeitung lief zwischenzeitlich woanders). Übernehmen ersetzt die aktuelle Gestaltung.', { when }),
    buttons: [{ label: _t('Übernehmen'), value: true, primary: true }, { label: _t('Verwerfen'), value: false }] });
  if (r) {
    S.doc = { ...defaultDoc(), ...d.editor.doc }; S.pages = d.editor.pages || {};
    if (!(d.editor.doc || {}).calLang) S.doc.calLang = 'de';
    for (const [id, m] of Object.entries(d.assets || {})) if (S.photos[id]) { if ('caption' in m) S.photos[id].caption = m.caption; if ('favorite' in m) S.photos[id].fav = m.favorite; }
    ensurePages(); commit(); renderAll(); toast(_t('Gesicherter Stand übernommen.'), 5000, { label: _t('Rückgängig'), fn: undo });
  }
  try { await api(PP('/draft'), { method: 'DELETE' }); } catch (e) { /* egal */ }
}

/* ----- Speichern ----- */
const editorState = () => ({ v: 1, doc: S.doc, pages: S.pages });
// Bildtext, Favorit und Aussortieren je Foto; nur Abweichungen vom Stand des Dienstes (oder alles)
function photoMeta(all = false) {
  const out = {};
  for (const a of Object.values(SVC.assets)) {
    if (!usable(a)) continue;
    const ph = S.photos[a.id];
    const want = ph ? { caption: ph.caption || '', favorite: !!ph.fav, excluded: false } : { excluded: true };
    const diff = {};
    for (const k in want) if (all || want[k] !== (k === 'caption' ? a.caption || '' : !!a[k])) diff[k] = want[k];
    if (Object.keys(diff).length) out[a.id] = diff;
  }
  return out;
}
function scheduleServiceSave() {
  if (!SVC.pid) return;
  if (SVC.readOnly) {
    setSaveState(_t('Nur ansehen – nicht gespeichert'));
    if (!SVC.warnedRO) { SVC.warnedRO = true; toast(_t('Nur ansehen: Änderungen werden nicht gespeichert, solange das Projekt woanders bearbeitet wird.'), 7000); }
    return;
  }
  SVC.pending = true; setSaveState(_t('Ungespeichert …'));
  clearTimeout(SVC.timer); SVC.timer = setTimeout(() => serial(serviceSave), 800);
}
function flushSave() {
  if (!SVC.pending) return SVC.queue;
  clearTimeout(SVC.timer);
  return serial(serviceSave);
}
async function serviceSave() {
  if (!SVC.pending || SVC.readOnly || !SVC.pid) return;
  SVC.pending = false;
  try {
    const touched = await syncPhotoFiles();
    const meta = photoMeta();
    await api(PP('/save'), { method: 'POST', body: { editor: editorState(), calendarYear: S.doc.year,
      format: { id: S.doc.format, widthMm: S.doc.w, heightMm: S.doc.h, bleedMm: S.doc.bleed }, assets: meta, printerProfileId: S.doc.printer || '' } });
    for (const [id, m] of Object.entries(meta)) Object.assign(SVC.assets[id], m);
    if (SVC.offline) SVC.offline = false;
    setSaveState(SVC.pending ? _t('Ungespeichert …') : _t('Im Projektordner gespeichert'));
    if (touched && ui.view === 'photos') renderPhotos();
  } catch (e) {
    if (e.status === 423) { lockLost(); return; }
    SVC.pending = true;
    if (e instanceof TypeError) {               // Dienst nicht erreichbar: später noch einmal
      SVC.offline = true; setSaveState(_t('Dienst nicht erreichbar – wird nachgeholt'));
      clearTimeout(SVC.timer); SVC.timer = setTimeout(() => serial(serviceSave), 5000);
    } else { setSaveState(_t('Speichern fehlgeschlagen')); toast(_t('Speichern fehlgeschlagen: {error}', { error: e.message }), 8000, { label: _t('Noch einmal'), fn: () => serial(serviceSave) }); }
  }
}
// Monatswechsel und Kopien der Oberfläche als Dateioperationen nachziehen
async function syncPhotoFiles() {
  let touched = false;
  const facts = {};                             // neue Pfade, auch im aktuellen Verlaufsstand nachtragen
  for (const ph of Object.values(S.photos)) {
    const a = SVC.assets[ph.id], want = ph.month < 0 ? null : ph.month;
    if (!a) {
      // In der Oberfläche angelegte Kopie: jetzt als eigene Datei im Monatsordner anlegen
      const src = ph.copyOf && SVC.assets[ph.copyOf] ? ph.copyOf : null;
      if (!src) { delete S.photos[ph.id]; continue; }
      try {
        const c = gotAsset(await api(PP(`/assets/${src}/copy`), { method: 'POST', body: { month: want } }));
        renamePhoto(ph.id, c.id); Object.assign(S.photos[c.id], fileFacts(c)); facts[c.id] = fileFacts(c); touched = true;
      } catch (e) { if (e.status === 423) throw e; toast(_t('Kopie konnte nicht angelegt werden: {error}', { error: e.message }), 7000); }
      continue;
    }
    if ((a.month ?? null) === want || a.status === 'missing') continue;
    try {
      const m = gotAsset(await api(PP(`/assets/${ph.id}/move`), { method: 'POST', body: { month: want } }));
      Object.assign(ph, { path: m.path, name: baseName(m.path) }); facts[ph.id] = { path: m.path, name: baseName(m.path) }; touched = true;
    } catch (e) {
      if (e.status === 423) throw e;
      ph.month = a.month ?? -1;                 // Datei liegt weiter im alten Ordner
      toast(_t('„{name}“ konnte nicht verschoben werden: {error}', { name: ph.name, error: e.message }), 8000);
    }
  }
  // Nur die Dateiangaben nachtragen, nicht den ganzen Zustand: ein gerade laufendes Ziehen bleibt so ein eigener Schritt
  if (touched && hist.last) { const o = JSON.parse(hist.last); for (const [id, f] of Object.entries(facts)) if (o.photos[id]) Object.assign(o.photos[id], f); hist.last = JSON.stringify(o); }
  return touched;
}

/* ----- Abgleich mit den Monatsordnern ----- */
function serviceScan(manual) {
  if (!SVC.pid) return Promise.resolve();
  if (SVC.readOnly) { if (manual) toast(_t('Nur ansehen: Abgleichen geht erst, wenn das Projekt frei ist.')); return Promise.resolve(); }
  clearTimeout(SVC.timer);
  return serial(async () => {
    await serviceSave();
    setSaveState(_t('Ordner wird abgeglichen …'));
    SVC.lastScan = Date.now();
    try {
      const rep = await api(PP('/scan'), { method: 'POST' });
      const list = await api(PP('/assets'));
      const ids = new Set([...rep.added, ...rep.moved, ...rep.changed, ...rep.missing, ...rep.reassigned]);
      SVC.info = await api(PP());
      if (ids.size) {
        const byId = Object.fromEntries(list.map(a => [a.id, a]));
        for (const id of ids) {
          const a = byId[id]; if (!a) continue;
          gotAsset(a);
          if (a.excluded || !usable(a)) continue;
          S.photos[id] = photoFromAsset(a, S.photos[id]);
        }
        rebaseHistory(o => { for (const id of ids) { const a = byId[id]; if (!a || a.excluded || !usable(a)) continue; o.photos[id] = o.photos[id] ? { ...o.photos[id], ...fileFacts(a) } : photoFromAsset(a); } });
        for (const id of rep.changed) delete FACES.map[id];
        renderAll();
        prefetchFaces();
      }
      setSaveState(_t('Im Projektordner gespeichert'));
      const parts = [];
      if (rep.added.length) parts.push(plural(rep.added.length, _t('neues Foto'), _t('neue Fotos')));
      const resorted = new Set([...rep.moved, ...rep.reassigned]).size;
      if (resorted) parts.push(_t('{n} umsortiert', { n: resorted }));
      if (rep.changed.length) parts.push(_t('{n} geändert', { n: rep.changed.length }));
      if (rep.missing.length) parts.push(_t('{n} fehlen', { n: rep.missing.length }));
      if (parts.length) toast(_t('Projektordner: {changes}.', { changes: parts.join(', ') }), 7000, rep.added.length && ui.view !== 'photos' ? { label: _t('Ansehen'), fn: () => setView('photos') } : null);
      else if (manual) toast(_t('Alles aktuell: Die Monatsordner und das Projekt stimmen überein.'));
    } catch (e) {
      if (e.status === 423) { lockLost(); return; }
      setSaveState(_t('Abgleich fehlgeschlagen')); if (manual) toast(_t('Abgleich fehlgeschlagen: {error}', { error: e.message }), 7000);
    }
  });
}

/* ----- Hochladen und Export ----- */
async function serviceImportOne(file, month) {
  if (SVC.readOnly) throw new Error('Nur ansehen');
  const fd = new FormData();
  fd.append('file', file, file.name);
  fd.append('month', month < 0 ? 'none' : String(month));
  const a = gotAsset(await serial(() => api(PP('/assets'), { method: 'POST', form: fd })));
  if (!usable(a)) throw new Error('unlesbar');
  const dup = a.duplicate && S.photos[a.id];
  S.photos[a.id] = photoFromAsset(a, S.photos[a.id]);
  return dup ? 'dup' : 'ok';
}
async function serviceOriginal(ph, fx = '') {
  const id = SVC.assets[ph.id] ? ph.id : ph.copyOf;
  if (!id) return null;
  const r = await fetch(`api/${PP(`/assets/${id}/original`)}${fx ? '?fx=' + fx : ''}`, { headers: SVC.token ? { Authorization: 'Bearer ' + SVC.token } : {} });
  return r.ok ? r.blob() : null;
}
async function serviceExport(blob, name) {
  if (!SVC.pid || SVC.readOnly) return null;
  const fd = new FormData(); fd.append('file', blob, name);
  try { return (await serial(() => api(PP('/export'), { method: 'POST', form: fd }))).path; } catch (e) { return null; }
}
async function restoreExcluded() {
  for (const a of Object.values(SVC.assets)) if (usable(a) && !S.photos[a.id]) S.photos[a.id] = photoFromAsset(a);
  commit(); renderAll(); toast(_t('Aussortierte Fotos sind wieder da.'), 4000, { label: _t('Rückgängig'), fn: undo });
}
// Aussortiert = im Projekt vorhanden, aber nicht (mehr) in der Fotoübersicht
const excludedCount = () => Object.values(SVC.assets).filter(a => usable(a) && !S.photos[a.id]).length;

/* ----- Anzeige ----- */
function renderServiceBanner() {
  const b = $('#svcBanner'); if (!b) return;
  if (!SVC.on || !SVC.pid || !SVC.readOnly) { b.hidden = true; b.innerHTML = ''; }
  else {
    const l = SVC.lock;
    b.hidden = false;
    b.innerHTML = `<p><b>${_t('Nur ansehen.')}</b> ${l ? esc(_t('{holder} bearbeitet das Projekt in einem anderen Fenster (zuletzt aktiv {ago}).', { holder: l.holder, ago: ago(l.heartbeat) })) : _t('Das Projekt wird gerade woanders bearbeitet.')}
      ${_t('Sobald es frei ist, geht es hier automatisch weiter; nicht mehr genutzte Sperren laufen nach 2 Minuten ab.')}</p>
      <button class="btn small" data-act="svcretry">${_t('Jetzt prüfen')}</button>`;
  }
  if (typeof renderAll === 'function' && document.body.dataset.view) document.documentElement.style.setProperty('--top-h', ($('.bar').offsetHeight + ($('#banner').hidden ? 0 : $('#banner').offsetHeight) + (b.hidden ? 0 : b.offsetHeight)) + 'px');
}
// Ordnernamen des Projekts (der Dienst legt sie in der Sprache an, in der das Projekt entstand)
const SVC_FOLDERS_DE = { photos: 'Fotos', months: ['01 Januar', '02 Februar', '03 März', '04 April', '05 Mai', '06 Juni', '07 Juli', '08 August', '09 September', '10 Oktober', '11 November', '12 Dezember'], noMonth: 'Ohne Monat', export: 'Export' };
function svcFolders() {
  const f = (SVC.info && SVC.info.storage && SVC.info.storage.folders) || {};
  return { photos: f.photos || SVC_FOLDERS_DE.photos, months: Array.isArray(f.months) && f.months.length === 12 ? f.months : SVC_FOLDERS_DE.months,
    noMonth: f.noMonth || SVC_FOLDERS_DE.noMonth, export: f.export || SVC_FOLDERS_DE.export };
}
function serviceCard() {
  const i = SVC.info || {}, loc = i.storage ? i.storage.location : '', shown = shortPath(i.storage ? i.storage.display || loc : '');
  const ex = excludedCount(), fo = svcFolders(), code = (t) => `<code>${esc(t)}</code>`;
  const state = SVC.readOnly ? _t('<b>Nur ansehen</b>, das Projekt ist woanders geöffnet.') : _t('Du bearbeitest das Projekt ({device}). Andere Fenster können es so lange nur ansehen.', { device: esc(deviceName()) });
  const missing = !i.missing ? '' : ' ' + (i.missing === 1 ? _t('<b>1 Foto fehlt</b> im Ordner.') : _t('<b>{n} Fotos fehlen</b> im Ordner.', { n: i.missing }));
  return `<section class="card svc-card"><header><h2>${_t('Projektordner')}</h2><p>${esc(i.title || _t('Kalender'))} ${esc(String(S.doc.year))}</p></header>
    <div class="svc-path" title="${esc(loc)}">${i.storage && i.storage.kind === 'webdav' ? ICON_CLOUD : ICON_FOLDER}<code>${esc(shown)}</code></div>
    <p class="hint">${_t('Fotos liegen in {first} bis {last}. Neue Dateien in diesen Ordnern übernimmt der Abgleich; die Gestaltung steht in {json}, PDFs landen in {export}.',
      { first: code(`${fo.photos}/${fo.months[0]}`), last: code(`${fo.photos}/${fo.months[11]}`), json: code('lichtjahr.json'), export: code(fo.export + '/') })}</p>
    <p class="hint">${state}${missing}</p>
    <div class="row"><button class="btn" data-act="svcscan">${_t('Ordner abgleichen')}</button>${ex ? `<button class="btn" data-act="svcrestore">${ex === 1 ? _t('1 aussortiertes Foto zurückholen') : _t('{n} aussortierte Fotos zurückholen', { n: ex })}</button>` : ''}<button class="btn" data-act="svcswitch">${_t('Anderes Projekt …')}</button></div>
  </section>`;
}
// Lange Pfade in der Mitte kürzen: Anfang und der aussagekräftige Schluss bleiben sichtbar
const shortPath = (p, n = 44) => p.length <= n ? p : p.slice(0, 12) + '…' + p.slice(-(n - 13));
const ICON_CLOUD = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M7 18.5h10.5a4 4 0 0 0 .4-8 6 6 0 0 0-11.6-1.5A4.5 4.5 0 0 0 7 18.5z"/></svg>';
const ICON_FOLDER = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2.5h8.5A1.5 1.5 0 0 1 21 9v9.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z"/></svg>';
function showServiceError(msg) {
  const el = document.createElement('div'); el.className = 'picker';
  el.innerHTML = `<div class="picker-box"><div class="picker-brand"><span class="cmyk" aria-hidden="true"><i></i><i></i><i></i><i></i></span>Lichtjahr</div><h1>${_t('Kein Zugriff')}</h1><p class="hint">${esc(msg)}</p></div>`;
  document.body.appendChild(el);
}

/* ----- Projekt wählen ----- */
function projectPicker(list, error = '') {
  return new Promise((resolve) => {
    const el = document.createElement('div'); el.className = 'picker'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true');
    const year = new Date().getFullYear() + 1;
    let tab = list.length ? 'list' : 'new', msg = error, where = 'local';   // where: dieser Rechner oder WebDAV
    const vals = {};                          // Eingaben bleiben beim Wechsel von Reiter oder Sprache erhalten
    const val = (k, def) => esc(k in vals ? vals[k] : def);
    const draw = () => {
      el.setAttribute('aria-label', _t('Projekt wählen'));
      el.innerHTML = `<div class="picker-box">
        <div class="picker-brand"><span class="cmyk" aria-hidden="true"><i></i><i></i><i></i><i></i></span>Lichtjahr</div>
        <h1>${list.length ? _t('Welcher Kalender?') : _t('Dein erster Kalender')}</h1>
        <p class="hint">${_t('Ein Projekt ist ein Ordner auf diesem Rechner oder in deiner Nextcloud, mit einem Unterordner je Monat. Fotos kannst du dort hineinlegen, wann immer du willst.')}</p>
        ${list.length ? `<div class="seg picker-tabs">${[['list', _t('Zuletzt')], ['new', _t('Neu anlegen')], ['open', _t('Öffnen')]].map(([v, l]) => `<button aria-pressed="${tab === v}" data-tab="${v}">${l}</button>`).join('')}</div>` : ''}
        ${msg ? `<p class="picker-err" role="alert">${esc(msg)}</p>` : ''}
        ${tab === 'list' ? `<div class="picker-list">${list.map(p => `<button class="picker-item" data-pid="${esc(p.id)}"><b>${esc(p.title)} ${esc(String(p.calendarYear))}</b><span title="${esc(p.storage && p.storage.location || '')}">${esc(shortPath(p.storage && (p.storage.display || p.storage.location) || '', 60))}</span></button>`).join('')}</div>` : ''}
        ${tab !== 'list' ? `<div class="seg picker-where">${[['local', _t('Dieser Rechner')], ['dav', _t('Nextcloud / WebDAV')]].map(([v, l]) => `<button aria-pressed="${where === v}" data-where="${v}">${l}</button>`).join('')}</div>` : ''}
        ${tab === 'new' ? `<form class="picker-form" data-form="new">
          ${where === 'local' ? `<div class="field"><label for="pk-path">${_t('Ordner')}</label><input type="text" id="pk-path" name="path" required value="${val('new:path', _t('~/Bilder/Kalender-{year}', { year }))}" spellcheck="false" autocomplete="off"><span class="hint">${_t('Wird angelegt, falls es ihn noch nicht gibt. {tilde} ist dein Benutzerordner.', { tilde: '<code>~</code>' })}</span></div>` : davFields('new', val, year)}
          <div class="row"><div class="field" style="flex:1"><label for="pk-title">${_t('Titel')}</label><input type="text" id="pk-title" name="title" value="${val('new:title', _t('Familienkalender'))}"></div>
          <div class="field" style="width:110px"><label for="pk-year">${_t('Kalenderjahr')}</label><input id="pk-year" name="year" type="number" min="2000" max="2100" value="${val('new:year', year)}"></div></div>
          <button class="btn primary" type="submit">${_t('Projekt anlegen')}</button></form>` : ''}
        ${tab === 'open' ? `<form class="picker-form" data-form="open">
          ${where === 'local' ? `<div class="field"><label for="pk-open">${_t('Ordner mit {file}', { file: '<code>lichtjahr.json</code>' })}</label><input type="text" id="pk-open" name="path" required value="${val('open:path', '')}" placeholder="${esc(_t('~/Bilder/Kalender-{year}', { year }))}" spellcheck="false" autocomplete="off"><span class="hint">${_t('Auch ein Ordner, den ihr über Syncthing oder ein Netzlaufwerk teilt.')}</span></div>` : davFields('open', val, year)}
          <button class="btn primary" type="submit">${_t('Öffnen')}</button></form>` : ''}
        <div class="picker-foot">${SVC.pid ? `<button class="btn" data-cancel>${_t('Abbrechen')}</button>` : ''}<button class="linkish" data-browser>${_t('Ohne Projektordner im Browser ausprobieren')}</button>${langButton('linkish')}</div>
      </div>`;
      const f = el.querySelector('input'); if (f && !coarse()) f.focus();
    };
    const finish = (v) => { el.remove(); resolve(v); };
    const tryOpen = async (fn) => {
      el.classList.add('working');
      try { const s = await fn(); await openProject(s.id); finish('open'); }
      catch (e) { msg = e.message; el.classList.remove('working'); draw(); }
    };
    el.addEventListener('input', (e) => { const fm = e.target.closest('form'); if (fm && e.target.name && e.target.name !== 'password') vals[fm.dataset.form + ':' + e.target.name] = e.target.value; });
    el.addEventListener('click', (e) => {
      // Sprache hier selbst umschalten und neu zeichnen; der allgemeine Klick-Handler (data-act) soll nicht noch einmal laufen
      const lg = e.target.closest('[data-act="lang"]');
      if (lg) {
        e.stopPropagation();
        try { setLang(lg.dataset.v); } catch (err) { console.error(err); }
        draw(); const b = el.querySelector('[data-act="lang"]'); if (b) b.focus();
        return;
      }
      const t = e.target.closest('[data-tab]'); if (t) { tab = t.dataset.tab; msg = ''; draw(); return; }
      const w = e.target.closest('[data-where]'); if (w) { where = w.dataset.where; msg = ''; draw(); return; }
      const it = e.target.closest('[data-pid]'); if (it) { tryOpen(async () => ({ id: it.dataset.pid })); return; }
      if (e.target.closest('[data-browser]')) finish('browser');
      if (e.target.closest('[data-cancel]')) finish('cancel');
    });
    el.addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(e.target), kind = e.target.dataset.form, path = String(fd.get('path') || '').trim();
      // Ort: lokaler Ordner oder WebDAV-Ordner mit Zugangsdaten (die der Dienst nur auf diesem Rechner ablegt)
      const loc = where === 'dav'
        ? { url: String(fd.get('url') || '').trim(), username: String(fd.get('username') || '').trim(), password: String(fd.get('password') || '') }
        : { path };
      if (!(loc.url || loc.path)) return;
      // language: Sprache der Ordnernamen im neuen Projekt (Fotos/01 Januar oder Photos/01 January)
      if (kind === 'new') tryOpen(() => api('projects', { method: 'POST', body: { ...loc, title: String(fd.get('title') || '').trim() || _t('Familienkalender'), calendarYear: +fd.get('year') || year, language: LANG } }));
      else tryOpen(() => api('projects/open', { method: 'POST', body: loc }));
    });
    draw();
    document.body.appendChild(el);
  });
}

// Eingaben für einen Ordner in Nextcloud oder auf einem anderen WebDAV-Server
function davFields(form, val, year) {
  const ex = _t('https://cloud.example.org/remote.php/dav/files/NAME/Kalender-{year}', { year });
  return `<div class="field"><label for="pk-url-${form}">${_t('WebDAV-Adresse des Projektordners')}</label><input type="url" id="pk-url-${form}" name="url" required value="${val(form + ':url', '')}" placeholder="${esc(ex)}" spellcheck="false" autocomplete="off">
      <span class="hint">${_t('In Nextcloud steht die WebDAV-Adresse unter Dateien → Einstellungen (unten links). Den Ordnernamen hinten anhängen; ein neuer Ordner wird angelegt.')}</span></div>
    <div class="row"><div class="field" style="flex:1"><label for="pk-user-${form}">${_t('Benutzername')}</label><input type="text" id="pk-user-${form}" name="username" required value="${val(form + ':username', '')}" autocomplete="off" spellcheck="false"></div>
    <div class="field" style="flex:1"><label for="pk-pass-${form}">${_t('App-Passwort')}</label><input type="password" id="pk-pass-${form}" name="password" required autocomplete="off"></div></div>
    <p class="hint">${_t('Ein App-Passwort legst du in Nextcloud unter Einstellungen → Sicherheit an; du kannst es jederzeit widerrufen. Der Dienst speichert es nur auf diesem Rechner, nie im Projekt oder im Browser.')}</p>`;
}

/* ----- Ereignisse ----- */
function serviceEvents() {
  document.addEventListener('visibilitychange', () => {
    if (!SVC.pid) return;
    if (document.visibilityState === 'hidden') flushSave();
    else { heartbeat(); if (SVC.readOnly) retryLock(); else if (Date.now() - SVC.lastScan > 60000) serviceScan(false); }
  });
  window.addEventListener('pagehide', (e) => {
    if (!SVC.pid || SVC.readOnly || !SVC.session || e.persisted) return;
    // Beim Schließen die Sperre freigeben, damit andere Geräte nicht 2 Minuten warten.
    // Steht noch Ungespeichertes aus, bleibt sie; ein Neuladen setzt mit derselben Sitzung fort.
    if (!SVC.pending) api(PP('/lock'), { method: 'DELETE', keepalive: true }).catch(() => {});
  });
}
Object.assign(ACTIONS, {
  svcscan: () => serviceScan(true),
  svcretry: () => retryLock(),
  svcrestore: () => restoreExcluded(),
  svcsuggest: () => {
    const list = Object.values(S.photos).filter(p => p.month < 0 && p.suggested != null);
    for (const p of list) { p.month = p.suggested; p.src = 'Aufnahmedatum'; }
    commit(); renderPhotos();
    toast(list.length === 1 ? _t('1 Foto nach Aufnahmedatum einsortiert; die Datei wandert in den Monatsordner.') : _t('{n} Fotos nach Aufnahmedatum einsortiert; die Dateien wandern in die Monatsordner.', { n: list.length }), 6000, { label: _t('Rückgängig'), fn: undo });
  },
  svcswitch: async () => {
    await flushSave();
    let list = [];
    try { list = await api('projects'); } catch (e) { /* leer */ }
    const r = await projectPicker(list);
    if (r === 'cancel') return;
    if (r === 'browser') { await leaveProject(); try { localStorage.removeItem('lj-project'); } catch (e) { /* egal */ } location.href = location.pathname + (SVC.token ? '?token=' + encodeURIComponent(SVC.token) + '&browser=1' : '?browser=1'); return; }
    renderServiceBanner(); setView('design');
  },
});
