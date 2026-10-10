/* ---------- Druck-PDF über den lokalen Dienst ----------
   Druckprofil wählen (mitgeliefert oder ICC-Datei der Druckerei), Druck-PDF erzeugen lassen und den
   Prüfbericht zeigen. Die Oberfläche setzt die Seiten, der Dienst rechnet die Fotos mit LittleCMS um,
   schreibt PDF/X-1a und prüft das Ergebnis. Nur verfügbar, wenn die App vom Dienst kommt. */
const PRN = { list: [], loaded: false, result: null };

async function loadPrinters() {
  try { PRN.list = await api('printers'); } catch (e) { PRN.list = []; }
  PRN.loaded = true;
}
const usablePrinters = () => PRN.list.filter(p => p.available);
const printerOf = () => usablePrinters().find(p => p.id === S.doc.printer) || usablePrinters()[0] || null;
const intentLabel = (i) => i === 'perceptual' ? 'Wahrnehmungsorientiert' : 'Relativ farbmetrisch mit Tiefenkompensierung';

function printCard() {
  if (!PRN.loaded) { loadPrinters().then(() => { if (ui.view === 'print') renderPrint(); }); return '<section class="card"><header><h2>Druck-PDF</h2><p>Druckprofile werden geladen …</p></header></section>'; }
  const pr = printerOf(), list = usablePrinters(), d = S.doc;
  const head = `<header><h2>Druck-PDF</h2><p>Für die Druckerei: Fotos mit deren Farbprofil nach CMYK umgerechnet, als PDF/X-1a geprüft und in <code>Export/</code> abgelegt.</p></header>`;
  if (!pr) return `<section class="card print-card">${head}
    <p class="hint">Dafür braucht Lichtjahr das ICC-Farbprofil deiner Druckerei. Du findest es meist auf deren Website unter „Druckdaten“ oder „Farbprofile“, oft heißt es <i>PSO Coated v3</i> (FOGRA51) oder <i>ISO Coated v2</i> (FOGRA39).</p>
    <div class="row"><button class="btn primary" data-act="printeradd">ICC-Profil hinzufügen</button></div></section>`;
  const res = PRN.result;
  return `<section class="card print-card">${head}
    <div class="field"><label for="prn">Druckprofil</label><select id="prn" data-act-change="printer">
      ${list.map(p => `<option value="${esc(p.id)}" ${p.id === pr.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
      <option value="__add">Eigenes ICC-Profil hinzufügen …</option></select></div>
    <dl class="specs">
      <dt>Druckbedingung</dt><dd>${esc(pr.condition)}${pr.info && pr.info !== pr.name ? ` <span class="muted">· ${esc(pr.info.length > 70 ? pr.info.slice(0, 70) + '…' : pr.info)}</span>` : ''}</dd>
      <dt>Umrechnung</dt><dd>${intentLabel(pr.intent)}</dd>
      <dt>Farbauftrag</dt><dd>höchstens ${pr.tac} %</dd>
      <dt>Beschnitt</dt><dd>${pr.bleed} mm ${d.bleed + 1e-6 < pr.bleed ? `<span class="bad-text">(eingestellt: ${fmt1(d.bleed)} mm)</span>` : '✓'}</dd>
      <dt>Standard</dt><dd>PDF/X-1a:2001, Fotos mit 300 dpi</dd>
    </dl>
    ${pr.note ? `<p class="hint">${esc(pr.note)}</p>` : ''}
    <div class="row"><button class="btn primary" data-act="printexport">Druck-PDF erstellen</button>${pr.builtin ? '' : `<button class="btn small" data-act="printerdel" data-v="${esc(pr.id)}">Profil entfernen</button>`}</div>
    <div id="printOut">${res ? reportHtml(res) : ''}</div>
  </section>`;
}

function reportHtml(res) {
  const r = res.report, mb = fmt1(res.size / 1048576);
  const href = `api/${PP(`/export/${encodeURIComponent(res.name)}`)}${SVC.token ? '?token=' + encodeURIComponent(SVC.token) : ''}`;
  const lvl = (l) => l === 'ok' ? '' : l === 'warn' ? 'warn' : l === 'info' ? 'info' : 'bad';
  const details = r.items.filter(i => i.level !== 'info');
  return `<div class="report ${r.ok ? 'ok' : 'bad'}">
    <b>${r.ok ? 'Prüfung bestanden: PDF/X-1a' : 'Prüfung nicht bestanden'}</b>
    <span class="muted small">${esc(res.path)} · ${mb} MB · ${plural(r.pages, 'Seite', 'Seiten')}</span>
    <ul class="checks">${r.summary.map(s => `<li><span class="dot ${lvl(s.level)}"></span><span>${esc(s.text)}</span></li>`).join('')}</ul>
    ${details.length ? `<details><summary>${plural(details.length, 'Einzelheit', 'Einzelheiten')}</summary><ul class="checks">${details.slice(0, 60).map(i => `<li><span class="dot ${lvl(i.level)}"></span><span>${i.page ? `Seite ${i.page}: ` : ''}${esc(i.text)}</span></li>`).join('')}</ul></details>` : ''}
    ${r.ok ? '<p class="hint">Format, Seitenzahl und Bindung bitte noch mit den Vorgaben der Druckerei abgleichen.</p>' : ''}
    <div class="row"><a class="btn small" href="${href}" download="${esc(res.name)}">Herunterladen</a><button class="btn small primary" data-act="wall">An der Wand ansehen</button></div>
  </div>`;
}

async function printExport(blob, name, bar) {
  const pr = printerOf();
  bar.update(1, 'Farben werden mit dem Profil umgerechnet und geprüft …');
  try {
    const fd = new FormData();
    fd.append('file', blob, name); fd.append('printer', pr.id); fd.append('title', `Familienkalender ${S.doc.year}`);
    const r = await serial(() => api(PP('/export/print'), { method: 'POST', form: fd }));
    PRN.result = { ...r, name };
    bar.close();
    if (ui.view === 'print') renderPrint();
    if (r.report.ok) celebrate();
    toast(r.report.ok ? `Druck-PDF fertig, Prüfung bestanden: ${r.path}` : 'Druck-PDF erstellt, der Prüfbericht nennt noch Probleme.', 7000);
  } catch (e) {
    bar.close();
    if (e.status === 423) { lockLost(); return; }
    toast(`Druck-PDF fehlgeschlagen: ${e.message}`, 9000);
  }
}

// Eigenes Profil: ICC-Datei wählen, dann Name und Vorgaben der Druckerei
function askPrinter(file) {
  return new Promise((resolve) => {
    const el = document.createElement('div'); el.className = 'busy'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true');
    el.innerHTML = `<form class="card prn-form"><h2>Druckprofil anlegen</h2>
      <p class="hint">Aus <code>${esc(file.name)}</code>. Die Werte stehen im Datenblatt der Druckerei; ohne Angabe passen die Voreinstellungen meist.</p>
      <div class="field"><label for="pa-name">Name <span class="muted">(optional)</span></label><input type="text" id="pa-name" name="name" placeholder="z. B. Druckerei, Papier – sonst aus dem Profil"></div>
      <div class="row"><div class="field" style="flex:1"><label for="pa-tac">Max. Farbauftrag %</label><input type="number" id="pa-tac" name="tac" min="200" max="400" step="10" value="300"></div>
      <div class="field" style="flex:1"><label for="pa-bleed">Beschnitt mm</label><input type="number" id="pa-bleed" name="bleed" min="0" max="10" step=".5" value="3"></div></div>
      <div class="field"><label for="pa-intent">Umrechnung</label><select id="pa-intent" name="intent"><option value="perceptual">Wahrnehmungsorientiert (für Fotos üblich)</option><option value="relative">Relativ farbmetrisch</option></select></div>
      <div class="row"><button class="btn primary" type="submit">Anlegen</button><button class="btn" type="button" data-cancel>Abbrechen</button></div></form>`;
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
    toast(`Druckprofil „${p.name}“ angelegt (${p.condition}).`, 5000);
  } catch (err) { toast(`Profil nicht übernommen: ${err.message}`, 9000); }
});

CHANGE_ACTIONS.printer = (el) => {
  if (el.value === '__add') { el.value = (printerOf() || {}).id || ''; $('#iccIn').click(); return; }
  S.doc.printer = el.value; PRN.result = null; commit(); renderPrint();
};
Object.assign(ACTIONS, {
  printeradd: () => $('#iccIn').click(),
  printerdel: async (el) => {
    const p = PRN.list.find(x => x.id === el.dataset.v); if (!p) return;
    const ok = await ask({ title: `Druckprofil „${p.name}“ entfernen?`, text: 'Die ICC-Datei wird aus Lichtjahr entfernt. Das Projekt und erzeugte PDFs bleiben unberührt.', buttons: [{ label: 'Entfernen', value: true, primary: true }, { label: 'Abbrechen', value: false }] });
    if (!ok) return;
    try { await api(`printers/${encodeURIComponent(p.id)}`, { method: 'DELETE' }); } catch (e) { toast(e.message); return; }
    await loadPrinters(); if (S.doc.printer === p.id) { S.doc.printer = (printerOf() || {}).id || null; commit(); }
    renderPrint();
  },
  fixbleed: () => { const pr = printerOf(); if (pr) { S.doc.bleed = pr.bleed; commit(); renderAll(); toast(`Beschnitt auf ${pr.bleed} mm gesetzt.`); } },
  printexport: async () => {
    if (SVC.readOnly) { toast('Nur ansehen: Exportieren geht erst, wenn das Projekt frei ist.'); return; }
    const bad = checks().filter(c => c[0] === 'bad');
    if (bad.length) {
      const pages = [...new Set(bad.map(c => c[2]).filter(Boolean))];
      const r = await ask({ title: `${plural(bad.length, 'Problem', 'Probleme')} vor dem Druck`,
        text: `${bad.slice(0, 3).map(c => c[1]).join(' · ')}${bad.length > 3 ? ' …' : ''}`,
        buttons: [...(pages.length ? [{ label: `Zu ${pageLabel(pages[0])}`, value: 'go', primary: true }] : []), { label: 'Trotzdem erstellen', value: 'export' }, { label: 'Abbrechen', value: null }] });
      if (r === 'go') { ui.page = pages[0]; setView('design'); return; }
      if (r !== 'export') return;
    }
    await flushSave();
    exportPDF('print');
  },
});
