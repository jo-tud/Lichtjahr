/* ---------- Druck-PDF über den lokalen Dienst ----------
   Druckprofil wählen (mitgeliefert oder ICC-Datei der Druckerei), Druck-PDF erzeugen lassen und den
   Prüfbericht zeigen. Die Oberfläche setzt die Seiten, der Dienst rechnet die Fotos mit LittleCMS um,
   schreibt PDF/X-1a oder PDF/X-4 und prüft das Ergebnis. Dazu die Druckansicht (Softproof): Editor,
   Leuchttisch und Wand zeigen Fotos und Farben so, wie sie mit dem Druckprofil gedruckt aussehen.
   Nur verfügbar, wenn die App vom Dienst kommt. */
const PRN = { list: [], loaded: false, result: null, tune: {} };
// Druckausgleich (Papier leuchtet nicht, weniger Kontrast): Kurve und Schärfung je Profil vom Dienst
const tuneOn = () => S.doc.printTune !== false;
async function loadTune(pr) {
  if (!pr || PRN.tune[pr.id]) return PRN.tune[pr && pr.id];
  try { PRN.tune[pr.id] = await api(`printers/${encodeURIComponent(pr.id)}/tune`); } catch (e) { PRN.tune[pr.id] = null; }
  return PRN.tune[pr.id];
}
const printTuneLut = () => { const pr = printerOf(), t = pr && tuneOn() && PRN.tune[pr.id]; return t ? t.lut : null; };

async function loadPrinters() {
  try { PRN.list = await api('printers'); } catch (e) { PRN.list = []; }
  PRN.loaded = true;
}
const usablePrinters = () => PRN.list.filter(p => p.available);
const printerOf = () => usablePrinters().find(p => p.id === S.doc.printer) || usablePrinters()[0] || null;
// PDF/X-Standard des Druck-PDFs; ICC-v4-Profile gehen nur mit PDF/X-4
const pdfxOf = (pr = printerOf()) => (pr && pr.iccVersion >= 4) ? 'x4' : (S.doc.pdfx === 'x4' ? 'x4' : 'x1a');

/* ----- Druckansicht (Softproof) ----- */
const PROOF = { colors: null, key: '' };
const proofAvailable = () => !!(SVC.pid && PRN.loaded && printerOf());
const proofOn = () => !!(ui.proof && proofAvailable());
const proofLabel = () => { const pr = printerOf(); return pr ? _t('Druckansicht: {profile}', { profile: pr.condition || pr.name }) + (ui.proofPaper !== false ? ' · ' + _t('Papierweiß') : '') : ''; };
// Bild-Adresse für die Druckansicht; Kopien teilen die Datei mit dem Original
function proofUrl(id, small) {
  const pr = printerOf(), ph = S.photos[id];
  const a = SVC.assets[id] || (ph && ph.copyOf && SVC.assets[ph.copyOf]);
  if (!pr || !a) return null;
  const adj = compileAdjust(adjOf(id)), aq = adj ? '&adj=' + encodeURIComponent(adj.m.map(v => +v.toFixed(4)).join(',') + ';' + adj.lut.map(v => +v.toFixed(4)).join(',')) : '';
  const fx = fxOf(id, false);
  return `api/${PP(`/assets/${a.id}/proof`)}?printer=${encodeURIComponent(pr.id)}&size=${small ? 360 : 1600}&paper=${ui.proofPaper !== false ? 1 : 0}&gamut=${ui.proofGamut ? 1 : 0}${tuneOn() ? '&tune=1' : ''}${aq}${fx ? '&fx=' + fx : ''}&v=${a.contentHash.slice(0, 12)}${SVC.token ? '&token=' + encodeURIComponent(SVC.token) : ''}`;
}
// Vektorfarben (Kalendarium, Flächen, Hintergrund) über das Profil; „white“ wird zu Papierweiß
async function loadProofColors() {
  const pr = printerOf(); if (!pr) return;
  const key = pr.id + (ui.proofPaper !== false ? ':paper' : '');
  if (PROOF.key === key && PROOF.colors) return;
  const colors = Object.fromEntries(Object.keys(COLORS).map(k => [k, inkOf(k)]));
  try { PROOF.colors = await api(`printers/${encodeURIComponent(pr.id)}/proof-colors`, { method: 'POST', body: { colors, paper: ui.proofPaper !== false } }); PROOF.key = key; }
  catch (e) { PROOF.colors = null; PROOF.key = ''; }
}
async function setProof(patch) {
  Object.assign(ui, patch);
  if (proofOn()) await loadProofColors();
  renderAll();
  if (typeof wall !== 'undefined' && wall.el && typeof renderWall === 'function') renderWall();
  if (patch.proof === true) toast(_t('Druckansicht an: Fotos und Farben so, wie sie mit „{profile}“ gedruckt aussehen.', { profile: printerOf().name }), 5000);
}

const intentLabel = (i) => i === 'perceptual' ? _t('Wahrnehmungsorientiert') : _t('Relativ farbmetrisch mit Tiefenkompensierung');

function printCard() {
  if (!PRN.loaded) { loadPrinters().then(() => { if (ui.view === 'print') renderPrint(); }); return `<section class="card"><header><h2>${_t('Druck-PDF')}</h2><p>${_t('Druckprofile werden geladen …')}</p></header></section>`; }
  const pr = printerOf(), list = usablePrinters(), d = S.doc;
  const exportDir = `<code>${esc((typeof svcFolders === 'function' ? svcFolders().export : 'Export') + '/')}</code>`;
  const head = `<header><h2>${_t('Druck-PDF')}</h2><p>${_t('Für die Druckerei: Fotos mit deren Farbprofil nach CMYK umgerechnet, als PDF/X geprüft und in {folder} abgelegt.', { folder: exportDir })}</p></header>`;
  if (!pr) return `<section class="card print-card">${head}
    <p class="hint">${_t('Dafür braucht Lichtjahr das ICC-Farbprofil deiner Druckerei. Du findest es meist auf deren Website unter „Druckdaten“ oder „Farbprofile“, oft heißt es {pso} (FOGRA51) oder {iso} (FOGRA39).', { pso: '<i>PSO Coated v3</i>', iso: '<i>ISO Coated v2</i>' })}</p>
    <div class="row"><button class="btn primary" data-act="printeradd">${_t('ICC-Profil hinzufügen')}</button></div></section>`;
  const res = PRN.result;
  return `<section class="card print-card">${head}
    <div class="field"><label for="prn">${_t('Druckprofil')}</label><select id="prn" data-act-change="printer">
      ${list.map(p => `<option value="${esc(p.id)}" ${p.id === pr.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
      <option value="__add">${_t('Eigenes ICC-Profil hinzufügen …')}</option></select></div>
    <dl class="specs">
      <dt>${_t('Druckbedingung')}</dt><dd>${esc(pr.condition)}${pr.info && pr.info !== pr.name ? ` <span class="muted">· ${esc(pr.info.length > 70 ? pr.info.slice(0, 70) + '…' : pr.info)}</span>` : ''}</dd>
      <dt>${_t('Umrechnung')}</dt><dd>${intentLabel(pr.intent)}</dd>
      <dt>${_t('Farbauftrag')}</dt><dd>${_t('höchstens {tac} %', { tac: pr.tac })}</dd>
      ${pr.richBlack ? `<dt>${_t('Tiefschwarz')}</dt><dd>${cmykText(pr.richBlack.cmyk)} <span class="muted">· ${_t('L* {l} statt {k} bei reinem Schwarz', { l: fmt1(pr.richBlack.L), k: fmt1(pr.richBlack.kOnlyL) })}</span></dd>` : ''}
      <dt>${_t('Beschnitt')}</dt><dd>${pr.bleed} mm ${d.bleed + 1e-6 < pr.bleed ? `<span class="bad-text">${_t('(eingestellt: {bleed} mm)', { bleed: fmt1(d.bleed) })}</span>` : '✓'}</dd>
    </dl>
    ${pr.note ? `<p class="hint">${esc(pr.note)}</p>` : ''}
    <div class="field"><label for="pdfx">${_t('Standard')}</label><select id="pdfx" data-act-change="pdfx">
      <option value="x1a" ${pdfxOf(pr) === 'x1a' ? 'selected' : ''} ${pr.iccVersion >= 4 ? 'disabled' : ''}>PDF/X-1a:2001</option>
      <option value="x4" ${pdfxOf(pr) === 'x4' ? 'selected' : ''}>PDF/X-4</option></select>
      <span class="hint">${pr.iccVersion >= 4 ? _t('Das Profil hat ICC-Version 4, dafür ist PDF/X-4 nötig.') : pdfxOf(pr) === 'x4' ? _t('Neuerer Standard mit XMP-Metadaten, nimmt auch Profile der ICC-Version 4. Am besten vorher fragen, ob die Druckerei ihn annimmt.') : _t('Wird von fast allen Druckereien angenommen.')}</span></div>
    <div class="field proof-opts"><span class="lbl">${_t('Für den Druck')}</span>
      <label class="check"><input type="checkbox" data-act-change="printtune" ${tuneOn() ? 'checked' : ''}><span>${_t('Fotos an Papier und Druck anpassen')}<span class="hint">${tuneText(pr)}</span></span></label></div>
    <div class="field proof-opts"><span class="lbl">${_t('Am Bildschirm prüfen')}</span>
      <label class="check"><input type="checkbox" data-act-change="proof" ${ui.proof ? 'checked' : ''}><span>${_t('Druckansicht (Softproof)')}<span class="hint">${_t('Editor, Leuchttisch und Wand zeigen Fotos und Farben so, wie sie mit diesem Profil gedruckt aussehen.')}</span></span></label>
      <label class="check"><input type="checkbox" data-act-change="proofpaper" ${ui.proofPaper !== false ? 'checked' : ''}><span>${_t('Papierweiß simulieren')}<span class="hint">${_t('Weiß erscheint im Ton des Papiers, Kontraste etwas flacher, wie auf dem fertigen Blatt.')}</span></span></label>
      <label class="check"><input type="checkbox" data-act-change="proofgamut" ${ui.proofGamut ? 'checked' : ''}><span>${_t('Farben außerhalb des Druckfarbraums markieren')}<span class="hint">${_t('Eine graue Schraffur markiert Stellen, die im Druck deutlich anders aussehen, etwa leuchtendes Blau oder Neonfarben.')}</span></span></label>
    </div>
    <div class="row"><button class="btn primary" data-act="printexport">${_t('Druck-PDF erstellen')}</button>${pr.builtin ? '' : `<button class="btn small" data-act="printerdel" data-v="${esc(pr.id)}">${_t('Profil entfernen')}</button>`}</div>
    <div id="printOut">${res ? reportHtml(res) : ''}</div>
  </section>`;
}

// Erklärung zum Druckausgleich, mit den Werten des Profils, sobald sie da sind
function tuneText(pr) {
  const t = pr && PRN.tune[pr.id];
  if (pr && t === undefined) loadTune(pr).then(() => { if (ui.view === 'print') renderPrint(); });
  const base = _t('Papier leuchtet nicht wie ein Bildschirm. Darum werden Mitteltöne etwas heller, Tiefen geöffnet und die Fotos für den Druck geschärft, passend zum Profil. Die Druckansicht zeigt das Ergebnis; eine automatische Bildkorrektur der Druckerei dann besser ausschalten.');
  return t ? `${base} ${_t('Für dieses Profil: Mitteltöne {mid} % heller.', { mid: t.midtones })}` : base;
}
function reportHtml(res) {
  const r = res.report, mb = fmt1(res.size / 1048576);
  const href = `api/${PP(`/export/${encodeURIComponent(res.name)}`)}${SVC.token ? '?token=' + encodeURIComponent(SVC.token) : ''}`;
  const lvl = (l) => l === 'ok' ? '' : l === 'warn' ? 'warn' : l === 'info' ? 'info' : 'bad';
  const details = r.items.filter(i => i.level !== 'info');
  return `<div class="report ${r.ok ? 'ok' : 'bad'}">
    <b>${r.ok ? _t('Prüfung bestanden: {pdfx}', { pdfx: esc(r.pdfx || 'PDF/X-1a') }) : _t('Prüfung nicht bestanden')}</b>
    <span class="muted small">${esc(res.path)} · ${mb} MB · ${r.pages === 1 ? _t('1 Seite') : _t('{n} Seiten', { n: r.pages })}</span>
    <ul class="checks">${r.summary.map(s => `<li><span class="dot ${lvl(s.level)}"></span><span>${esc(s.text)}</span></li>`).join('')}</ul>
    ${details.length ? `<details><summary>${details.length === 1 ? _t('1 Einzelheit') : _t('{n} Einzelheiten', { n: details.length })}</summary><ul class="checks">${details.slice(0, 60).map(i => `<li><span class="dot ${lvl(i.level)}"></span><span>${i.page ? esc(_t('Seite {n}: {text}', { n: i.page, text: i.text })) : esc(i.text)}</span></li>`).join('')}</ul></details>` : ''}
    ${r.ok ? `<p class="hint">${_t('Format, Seitenzahl und Bindung bitte noch mit den Vorgaben der Druckerei abgleichen.')}</p>` : ''}
    <div class="row"><a class="btn small" href="${href}" download="${esc(res.name)}">${_t('Herunterladen')}</a><button class="btn small primary" data-act="wall">${_t('An der Wand ansehen')}</button></div>
  </div>`;
}

async function printExport(blob, name, bar) {
  const pr = printerOf();
  bar.update(1, _t('Farben werden mit dem Profil umgerechnet und geprüft …'));
  try {
    const fd = new FormData();
    fd.append('file', blob, name); fd.append('printer', pr.id); fd.append('title', _tc('Familienkalender {year}', { year: S.doc.year }));
    fd.append('standard', pdfxOf(pr));
    fd.append('tune', tuneOn() ? 'true' : 'false');
    const r = await serial(() => api(PP('/export/print'), { method: 'POST', form: fd }));
    PRN.result = { ...r, name };
    bar.close();
    if (ui.view === 'print') renderPrint();
    if (r.report.ok) celebrate();
    toast(r.report.ok ? _t('Druck-PDF fertig, Prüfung bestanden: {path}', { path: r.path }) : _t('Druck-PDF erstellt, der Prüfbericht nennt noch Probleme.'), 7000);
  } catch (e) {
    bar.close();
    if (e.status === 423) { lockLost(); return; }
    toast(_t('Druck-PDF fehlgeschlagen: {error}', { error: e.message }), 9000);
  }
}

// Eigenes Profil: ICC-Datei wählen, dann Name und Vorgaben der Druckerei
function askPrinter(file) {
  return new Promise((resolve) => {
    const el = document.createElement('div'); el.className = 'busy'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true');
    el.innerHTML = `<form class="card prn-form"><h2>${_t('Druckprofil anlegen')}</h2>
      <p class="hint">${_t('Aus {file}. Die Werte stehen im Datenblatt der Druckerei; ohne Angabe passen die Voreinstellungen meist.', { file: `<code>${esc(file.name)}</code>` })}</p>
      <div class="field"><label for="pa-name">${_t('Name')} <span class="muted">${_t('(optional)')}</span></label><input type="text" id="pa-name" name="name" placeholder="${esc(_t('z. B. Druckerei, Papier – sonst aus dem Profil'))}"></div>
      <div class="row"><div class="field" style="flex:1"><label for="pa-tac">${_t('Max. Farbauftrag %')}</label><input type="number" id="pa-tac" name="tac" min="200" max="400" step="10" value="300"></div>
      <div class="field" style="flex:1"><label for="pa-bleed">${_t('Beschnitt mm')}</label><input type="number" id="pa-bleed" name="bleed" min="0" max="10" step=".5" value="3"></div></div>
      <div class="field"><label for="pa-intent">${_t('Umrechnung')}</label><select id="pa-intent" name="intent"><option value="perceptual">${_t('Wahrnehmungsorientiert (für Fotos üblich)')}</option><option value="relative">${_t('Relativ farbmetrisch')}</option></select></div>
      <div class="row"><button class="btn primary" type="submit">${_t('Anlegen')}</button><button class="btn" type="button" data-cancel>${_t('Abbrechen')}</button></div></form>`;
    const done = (v) => { document.removeEventListener('keydown', key, true); el.remove(); resolve(v); };
    const key = (e) => { if (e.key === 'Escape') { e.stopPropagation(); done(null); } };
    el.addEventListener('click', (e) => { if (e.target.closest('[data-cancel]')) done(null); });
    el.addEventListener('submit', (e) => { e.preventDefault(); done(Object.fromEntries(new FormData(e.target))); });
    document.addEventListener('keydown', key, true);
    document.body.appendChild(el); el.querySelector('input').focus();
  });
}
document.addEventListener('change', async (e) => {
  if (e.target.id !== 'iccIn') return;
  const f = e.target.files[0]; e.target.value = '';
  if (!f) return;
  const v = await askPrinter(f);
  if (!v) return;
  const fd = new FormData(); fd.append('file', f, f.name);
  for (const k of ['name', 'tac', 'bleed', 'intent']) if (v[k] !== '') fd.append(k, v[k]);
  try {
    const p = await api('printers', { method: 'POST', form: fd });
    await loadPrinters(); S.doc.printer = p.id; commit(); renderPrint();
    toast(_t('Druckprofil „{name}“ angelegt ({condition}).', { name: p.name, condition: p.condition }), 5000);
  } catch (err) { toast(_t('Profil nicht übernommen: {error}', { error: err.message }), 9000); }
});

CHANGE_ACTIONS.printer = (el) => {
  if (el.value === '__add') { el.value = (printerOf() || {}).id || ''; $('#iccIn').click(); return; }
  S.doc.printer = el.value; PRN.result = null; PROOF.key = ''; commit();
  if (proofOn()) setProof({}); else renderPrint();
};
CHANGE_ACTIONS.pdfx = (el) => { S.doc.pdfx = el.value; PRN.result = null; commit(); renderPrint(); };
CHANGE_ACTIONS.printtune = (el) => { S.doc.printTune = el.checked; PRN.result = null; commit(); renderPrint(); };
CHANGE_ACTIONS.proof = (el) => setProof({ proof: el.checked });
CHANGE_ACTIONS.proofpaper = (el) => setProof({ proofPaper: el.checked });
CHANGE_ACTIONS.proofgamut = (el) => setProof({ proofGamut: el.checked });
Object.assign(ACTIONS, {
  proof: () => setProof({ proof: !ui.proof }),
  printeradd: () => $('#iccIn').click(),
  printerdel: async (el) => {
    const p = PRN.list.find(x => x.id === el.dataset.v); if (!p) return;
    const ok = await ask({ title: _t('Druckprofil „{name}“ entfernen?', { name: p.name }), text: _t('Die ICC-Datei wird aus Lichtjahr entfernt. Das Projekt und erzeugte PDFs bleiben unberührt.'), buttons: [{ label: _t('Entfernen'), value: true, primary: true }, { label: _t('Abbrechen'), value: false }] });
    if (!ok) return;
    try { await api(`printers/${encodeURIComponent(p.id)}`, { method: 'DELETE' }); } catch (e) { toast(e.message); return; }
    await loadPrinters(); if (S.doc.printer === p.id) { S.doc.printer = (printerOf() || {}).id || null; commit(); }
    renderPrint();
  },
  fixbleed: () => { const pr = printerOf(); if (pr) { S.doc.bleed = pr.bleed; commit(); renderAll(); toast(_t('Beschnitt auf {mm} mm gesetzt.', { mm: pr.bleed })); } },
  printexport: async () => {
    if (SVC.readOnly) { toast(_t('Nur ansehen: Exportieren geht erst, wenn das Projekt frei ist.')); return; }
    const bad = checks().filter(c => c[0] === 'bad');
    if (bad.length) {
      const pages = [...new Set(bad.map(c => c[2]).filter(Boolean))];
      const r = await ask({ title: bad.length === 1 ? _t('1 Problem vor dem Druck') : _t('{n} Probleme vor dem Druck', { n: bad.length }),
        text: `${bad.slice(0, 3).map(c => c[1]).join(' · ')}${bad.length > 3 ? ' …' : ''}`,
        buttons: [...(pages.length ? [{ label: _t('Zu {page}', { page: pageLabel(pages[0]) }), value: 'go', primary: true }] : []), { label: _t('Trotzdem erstellen'), value: 'export' }, { label: _t('Abbrechen'), value: null }] });
      if (r === 'go') { ui.page = pages[0]; setView('design'); return; }
      if (r !== 'export') return;
    }
    await flushSave();
    exportPDF('print');
  },
});
