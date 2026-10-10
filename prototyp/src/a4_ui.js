/* ---------- Oberfläche ---------- */
// Meldung, optional mit einer Aktion (z. B. „Rückgängig“)
function toast(msg, ms = 3200, action = null) {
  const t = $('#toast'); t.innerHTML = '';
  const span = document.createElement('span'); span.textContent = msg; t.appendChild(span);
  if (action) {
    const b = document.createElement('button'); b.className = 'toast-act'; b.textContent = action.label;
    b.onclick = () => { t.classList.remove('on'); action.fn(); }; t.appendChild(b); ms = Math.max(ms, 6000);
  }
  t.classList.toggle('has-act', !!action); t.classList.add('on');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('on'), ms);
}
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const coarse = () => window.matchMedia && matchMedia('(pointer: coarse)').matches;
function busy(title, sub) {
  const el = document.createElement('div'); el.className = 'busy';
  el.innerHTML = `<div class="card"><h2>${esc(title)}</h2><div class="progress"><i></i></div><p class="hint" data-sub>${esc(sub || '')}</p></div>`;
  document.body.appendChild(el);
  return {
    update(f, s) { el.querySelector('i').style.width = Math.round(f * 100) + '%'; if (s != null) el.querySelector('[data-sub]').textContent = s; },
    close() { el.remove(); },
  };
}
// Die Zurück-Taste des Browsers wechselt zwischen den Schritten, statt die App zu verlassen
const VIEW_HASH = { project: 'projekt', photos: 'fotos', design: 'gestalten', print: 'pdf' };
function setView(v, fromHistory = false) {
  ui.view = v; ui.sel = null; ui.crop = null; ui.selBlock = null; ui.swapFrom = null;
  try { localStorage.setItem('kw-view', v); } catch (e) { /* egal */ }
  try { if (!fromHistory && location.hash !== '#' + VIEW_HASH[v]) history.pushState({ view: v }, '', '#' + VIEW_HASH[v]); } catch (e) { /* egal */ }
  renderAll();
  window.scrollTo(0, 0);
}
function renderAll() {
  ensurePages();
  document.body.dataset.view = ui.view;
  $$('.steps button').forEach(b => b.setAttribute('aria-selected', b.dataset.view === ui.view));
  $$('.view').forEach(v => v.classList.toggle('on', v.id === 'v-' + ui.view));
  $('#banner').hidden = !(S.demo && ui.banner);
  const ls = $('#langSlot'); if (ls) ls.innerHTML = langButton('btn small');
  // Höhe von Kopfleiste und Hinweis, damit der Editor genau in den Bildschirm passt
  const sb = $('#svcBanner');
  document.documentElement.style.setProperty('--top-h', ($('.bar').offsetHeight + ($('#banner').hidden ? 0 : $('#banner').offsetHeight) + (sb && !sb.hidden ? sb.offsetHeight : 0)) + 'px');
  if (ui.view === 'project') renderProject();
  if (ui.view === 'photos') renderPhotos();
  if (ui.view === 'design') renderDesign();
  if (ui.view === 'print') renderPrint();
  updateUndo();
}
const swatches = (ids, cur, act) => `<div class="swatches">${ids.map(c => `<button class="swatch" style="background:${COLORS[c].rgb}" title="${COLORS[c].name}" aria-label="${COLORS[c].name}" aria-pressed="${c === cur}" data-act="${act}" data-v="${c}"></button>`).join('')}</div>`;
const seg = (opts, cur, act) => `<div class="seg">${opts.map(([v, l]) => `<button aria-pressed="${v === cur}" data-act="${act}" data-v="${v}">${l}</button>`).join('')}</div>`;
const range = (id, bind, val, min, max, step, unit, label, scale = 1) =>
  `<div class="field"><label for="${id}">${label}</label><div class="range"><input type="range" id="${id}" data-bind="${bind}" data-unit="${unit}" data-scale="${scale}" min="${min}" max="${max}" step="${step}" value="${val}"><output>${fmt1(val * scale)}${unit}</output></div></div>`;

/* ----- Projekt ----- */
// Datum aus der Quellenangabe (TT.MM.JJJJ) in der Sprache der Oberfläche
const fmtSourceDate = (s) => { const [dd, mm, yy] = String(s).split('.').map(Number); return yy ? new Date(yy, mm - 1, dd).toLocaleDateString(locale()) : s; };
function renderProject() {
  const d = S.doc, sheets = allSheets(), n = pageKeys().length, mode = viewModeOf();
  const extras = (d.extraSheets || []).map(x => ({ ...x, label: x.month != null ? _t('{month}, weiteres Motiv', { month: MONTHS[x.month] }) : _t('Freies Blatt'), afterLabel: pageLabel(sheetList().find(s => s.id === x.after)?.front || x.after) }));
  $('#v-project').innerHTML = `<div class="project">
    <div class="cards">
      ${SVC.pid ? serviceCard() : ''}
      <section class="card"><header><h2>${_t('Format')}</h2><p>${_t('Endformat nach dem Schneiden. Ein Wechsel ist auch später möglich, die Seiten passen sich an.')}</p></header>
        <div class="formats">${FORMATS.map(f => {
          const w = f.w || d.w, h = f.h || d.h, s = 34 / Math.max(w, h);
          return `<button class="fmt" aria-pressed="${d.format === f.id}" data-act="format" data-v="${f.id}"><i style="width:${w * s}px;height:${h * s}px"></i><span><b>${f.name}</b><br><span class="muted">${f.sub}</span></span></button>`;
        }).join('')}</div>
        ${d.format === 'custom' ? `<div class="row"><div class="field"><label for="cw">${_t('Breite mm')}</label><input type="number" id="cw" data-bind="doc.w" min="100" max="600" value="${d.w}"></div><div class="field"><label for="ch">${_t('Höhe mm')}</label><input type="number" id="ch" data-bind="doc.h" min="100" max="600" value="${d.h}"></div></div>` : ''}
      </section>
      <section class="card"><header><h2>${_t('Blätter')}</h2><p>${_t('{sheets} Blätter, {pages} Druckseiten.', { sheets: sheets.length, pages: n })}</p></header>
        <div class="field"><label for="yr">${_t('Kalenderjahr')}</label><input type="number" id="yr" data-bind="doc.year" min="2000" max="2100" value="${d.year}"></div>
        <div class="field"><span class="lbl">${_t('Druck')}</span>${seg([['single', _t('Einseitig')], ['double', _t('Beidseitig')]], d.duplex ? 'double' : 'single', 'duplex')}</div>
        ${d.duplex ? `<div class="field"><span class="lbl">${_t('Rückseiten nutzen')}</span>${seg([['opened', _t('Aufgeklappt')], ['alternative', _t('Zweites Motiv')], ['free', _t('Freie Fotoseiten')]], mode, 'viewmode')}
          <p class="hint">${mode === 'opened' ? _t('Beim Aufhängen oben die Rückseite des vorigen Blatts, unten die Monatsseite. Ein Kalendarium für beide zusammen; die Bindung liegt in der Mitte. Das Titelblatt ist dafür nötig, seine Rückseite ist der obere Teil des Januars.') : mode === 'alternative' ? _t('Vorder- und Rückseite zeigen zwei Motive desselben Monats, beide mit Kalendarium. Beim Aufhängen wählt man das schönere.') : _t('Rückseiten sind zusätzliche Fotoseiten ohne Kalendarium.')}</p></div>
          <label class="check"><input type="checkbox" id="br" data-bind="doc.backRotate" ${d.backRotate ? 'checked' : ''}><span>${_t('Rückseiten im PDF Kopf an Fuß (um 180° gedreht)')}<span class="hint">${_t('Hängt davon ab, wie die Druckerei wendet. Nur nach deren Datenblatt einschalten.')}</span></span></label>` : ''}
        <label class="check"><input type="checkbox" id="cv" data-bind="doc.cover" ${d.cover || mode === 'opened' ? 'checked' : ''} ${mode === 'opened' ? 'disabled' : ''}><span>${_t('Eigenes Titelblatt')}<span class="hint">${_t('Vor dem Januar, mit Titel statt Kalendarium.')}</span></span></label>
        <label class="check"><input type="checkbox" id="ix" data-bind="doc.index" ${d.index ? 'checked' : ''}><span>${_t('Bildregister am Ende')}<span class="hint">${_t('Erklärt die Fotos, als Liste oder freier Text.')}</span></span></label>
        ${extras.length ? `<div class="field"><span class="lbl">${_t('Zusätzliche Blätter')}</span>${extras.map(x => `<div class="row"><span style="flex:1">${esc(x.label)} <span class="muted small">${_t('nach {page}', { page: esc(x.afterLabel) })}</span></span><button class="btn small danger" data-act="delsheet" data-v="${x.id}">${_t('Entfernen')}</button></div>`).join('')}</div>` : ''}
        <p class="hint">${_t('Weitere Blätter, etwa ein zweites Motiv für einen Monat, fügst du beim Gestalten im Reiter „Layout“ ein.')}</p>
      </section>
      <section class="card"><header><h2>${_t('Bilder und Abstände')}</h2><p>${_t('Gilt für alle Seiten.')}</p></header>
        ${range('gp', 'doc.gap', d.gap, 0, 5, .5, ' mm', _t('Abstand zwischen Bildern'))}
        ${range('mg', 'doc.margin', d.margin, 0, 20, 1, ' mm', _t('Außenrand (0 = randabfallend)'))}
        ${range('ob', 'doc.ovBorder', d.ovBorder, 0, 6, .5, ' mm', _t('Rahmen um Einleger-Bilder'))}
        <div class="field"><span class="lbl">${_t('Papier / Hintergrund')}</span>${swatches(BG_COLORS, d.bg, 'bg')}</div>
      </section>
      <section class="card"><header><h2>${_t('Kalendarium')}</h2><p>${_t('Voreinstellung für alle Monate. Jede Seite kann abweichen.')}</p></header>
        <div class="field"><span class="lbl">${_t('Form')}</span>${seg([['h', _t('Leiste')], ['v', _t('Spalte')], ['g', _t('Raster')]], d.cal.style, 'defstyle')}</div>
        <div class="field"><label for="cl">${_t('Sprache im Kalender')}</label><select id="cl" data-bind="doc.calLang">${Object.entries(LANGS).sort((a, b) => a[1].localeCompare(b[1])).map(([v, l]) => `<option value="${v}" lang="${v}" ${calLang() === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
          <p class="hint">${_t('Monatsnamen, Wochentage, Feiertage und Register im gedruckten Kalender.')}</p></div>
        <div class="field"><label for="rg">${_t('Feiertage (Deutschland)')}</label><select id="rg" data-bind="doc.region">${REGIONS.map(([v, l]) => `<option value="${v}" ${d.region === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        <label class="check"><input type="checkbox" id="hn" data-bind="doc.cal.names" ${d.cal.names ? 'checked' : ''}><span>${_t('Feiertage beim Namen nennen')}</span></label>
        <div class="field"><span class="lbl">${_t('Sonn- und Feiertage')}</span>${seg([['red', _t('Rot')], ['bold', _t('Fett')], ['none', _t('Normal')]], d.cal.hi, 'defhi')}</div>
        <label class="check"><input type="checkbox" id="sch" data-bind="doc.cal.school" ${d.cal.school ? 'checked' : ''} ${hasSchoolData() ? '' : 'disabled'}><span>${_t('Schulferien markieren')}<span class="hint">${hasSchoolData() ? _t('Feiner Strich unter den Ferientagen. Daten: {source} ({license}), Stand {date}, 2025–2028. Vor dem Druck mit dem Kultusministerium abgleichen.', { source: SCHOOL_SOURCE.name, license: SCHOOL_SOURCE.license, date: fmtSourceDate(SCHOOL_SOURCE.fetched) }) : _t('Dafür oben ein Bundesland wählen.')}</span></span></label>
        <label class="check"><input type="checkbox" id="kw" data-bind="doc.cal.kw" ${d.cal.kw ? 'checked' : ''}><span>${_t('Kalenderwochen')}</span></label>
      </section>
      <section class="card"><header><h2>${_t('Geburtstage')}</h2><p>${_t('Erscheinen dezent im Kalendarium und mit Namen im Register.')}</p></header>
        <div class="bdlist">${(d.birthdays || []).map(b => `<div class="bdrow">
          <input type="text" aria-label="${_t('Name')}" placeholder="${_t('Name')}" value="${esc(b.name)}" data-bd="${b.id}" data-f="name">
          <input type="number" aria-label="${_t('Tag')}" placeholder="${_t('Tag')}" min="1" max="31" value="${esc(b.d)}" data-bd="${b.id}" data-f="d">
          <select aria-label="${_t('Monat')}" data-bd="${b.id}" data-f="m">${MONTHS.map((mn, i) => `<option value="${i + 1}" ${+b.m === i + 1 ? 'selected' : ''}>${mn}</option>`).join('')}</select>
          <input type="number" aria-label="${_t('Geburtsjahr (optional)')}" placeholder="${_t('Jahr')}" min="1900" max="2100" value="${esc(b.y || '')}" data-bd="${b.id}" data-f="y">
          <button class="icon-btn" data-act="delbd" data-v="${b.id}" aria-label="${_t('Geburtstag von {name} entfernen', { name: esc(b.name || _t('ohne Namen')) })}">×</button></div>`).join('') || `<p class="empty-note">${_t('Noch keine Geburtstage.')}</p>`}</div>
        <div class="row"><button class="btn small" data-act="addbd">${_t('Geburtstag hinzufügen')}</button><button class="btn small" data-act="vcf">${_t('Aus Kontakten importieren (.vcf)')}</button></div>
        <div class="field"><span class="lbl">${_t('Im Kalendarium')}</span>${seg([['dot', _t('Punkt')], ['names', _t('Mit Namen')], ['off', _t('Nicht zeigen')]], d.cal.bd || 'dot', 'bdmode')}</div>
        <label class="check"><input type="checkbox" id="ixbd" data-bind="doc.indexBirthdays" ${d.indexBirthdays !== false ? 'checked' : ''}><span>${_t('Im Register aufführen')}<span class="hint">${_t('Mit Alter, wenn ein Geburtsjahr angegeben ist.')}</span></span></label>
      </section>
      <section class="card"><header><h2>${_t('Bindung und Beschnitt')}</h2><p>${_t('Wird nur angezeigt, nicht gedruckt. Die Vorgaben sind allgemeine Richtwerte, nicht aus einem Datenblatt einer Druckerei.')}</p></header>
        <div class="field"><label for="bt">${_t('Bindung oben')}</label><select id="bt" data-bind="doc.bind.type">
          ${[['wire31', _t('Wire-O 3:1, Richtwerte')], ['wire21', _t('Wire-O 2:1, Richtwerte')], ['spiral', _t('Spirale, Richtwerte')], ['custom', _t('Eigene Maße aus dem Datenblatt')], ['none', _t('Keine Lochung')]].map(([v, l]) => `<option value="${v}" ${d.bind.type === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        ${d.bind.type === 'custom' ? `<div class="row">${[['bp', 'p', _t('Lochabstand mm')], ['bhw', 'hw', _t('Lochbreite mm')], ['bhh', 'hh', _t('Lochhöhe mm')], ['bcy', 'cy', _t('Lochmitte ab Kante mm')]].map(([id, k, l]) => `<div class="field" style="flex:1;min-width:110px"><label for="${id}">${l}</label><input type="number" id="${id}" data-bind="doc.bind.${k}" min="1" max="30" step="0.1" value="${d.bind[k]}"></div>`).join('')}</div>` : ''}
        <label class="check"><input type="checkbox" id="bc" data-bind="doc.bind.cut" ${d.bind.cut ? 'checked' : ''}><span>${_t('Halbrunder Ausschnitt für den Aufhänger')}</span></label>
        ${d.bind.cut ? range('bw', 'doc.bind.cutW', d.bind.cutW, 20, 70, 1, ' mm', _t('Ausschnitt Breite')) + range('bd', 'doc.bind.cutD', d.bind.cutD, 3, 20, .5, ' mm', _t('Ausschnitt Tiefe')) : ''}
        ${range('bl', 'doc.bleed', d.bleed, 0, 5, .5, ' mm', _t('Beschnittzugabe'))}
        <p class="hint">${_t('Die meisten Druckereien verlangen 3 mm Beschnitt. Bilder am Rand laufen bis in den Beschnitt.')}</p>
      </section>
      ${SVC.pid ? '' : `<section class="card"><header><h2>${_t('Projekt')}</h2><p>${_t('Alles wird nur in diesem Browser gespeichert. Mit dem lokalen Dienst arbeitest du stattdessen in einem Ordner mit Monatsordnern (siehe README).')}</p></header>
        <div class="row"><button class="btn" data-act="newdemo">${_t('Beispielprojekt neu laden')}</button><button class="btn danger" data-act="reset">${_t('Leeres Projekt beginnen')}</button></div>
      </section>`}
      <section class="card"><header><h2>${_t('Sprache / Language')}</h2><p>${_t('Sprache der Oberfläche, wird in diesem Browser gemerkt. Die Sprache im gedruckten Kalender steht unter „Kalendarium“.')}</p></header>
        <div class="row"><span class="langcur" lang="${LANG}">${LANGS[LANG]}</span>${langButton('btn')}</div>
      </section>
    </div>
    <aside class="card preview"><header><h2>${_t('Vorschau')}</h2><p>${esc(pageLabel(ui.page))} · ${fmt1(d.w / 10)} × ${fmt1(d.h / 10)} cm</p></header>
      <div class="prev-svg">${svgPage(curPage(), { mode: 'proof', showBind: true })}</div>
      <button class="btn" data-act="go" data-v="design">${_t('Weiter zum Gestalten')}</button>
    </aside>
  </div>`;
}

/* ----- Fotos ----- */
function photoThumb(ph, u, extra = '') {
  const pages = u[ph.id];
  const lo = ph.w * ph.h < 4e6;
  return `<button class="thumb ${ui.photoSel.has(ph.id) ? 'sel' : ''} ${ui.armed === ph.id ? 'armed' : ''}" data-photo="${ph.id}" ${extra} title="${esc(ph.name)}${ph.caption ? ' – ' + esc(ph.caption) : ''}">
    <img src="${RT.thumb[ph.id] || ''}" alt="" loading="lazy">
    ${ph.fav ? '<span class="b fav">★</span>' : ''}${ph.missing ? `<span class="b lo" title="${_t('Die Datei fehlt im Projektordner')}">${_t('fehlt')}</span>` : lo ? `<span class="b lo" title="${_t('Geringe Auflösung')}">${_t('klein')}</span>` : ''}
    ${pages ? `<span class="b use">${pages.map(pageShort).join(', ')}</span>` : ''}</button>`;
}
function renderPhotos() {
  const u = usage(), all = Object.values(S.photos);
  const byM = Array.from({ length: 13 }, () => []);
  for (const ph of all) byM[ph.month < 0 ? 12 : ph.month].push(ph);
  byM.forEach(l => l.sort((a, b) => (a.date || '').localeCompare(b.date || '') || a.name.localeCompare(b.name)));
  const photosN = (k) => _t(k === 1 ? '{n} Foto' : '{n} Fotos', { n: k });
  const bucket = (m, list) => `<section class="bucket ${m === 12 ? 'unassigned' : ''}" data-bucket="${m === 12 ? -1 : m}">
      <h3>${m === 12 ? _t('Noch keinem Monat zugeordnet') : MONTHS[m]} <span class="muted">${photosN(list.length)}${m < 12 ? ' · ' + _t('{n} verwendet', { n: list.filter(p => u[p.id]).length }) : ''}</span>${m === 12 && list.some(p => p.suggested != null) ? ` <button class="btn small" data-act="svcsuggest">${_t('{photos} nach Aufnahmedatum einsortieren', { photos: photosN(list.filter(p => p.suggested != null).length) })}</button>` : ''}</h3>
      <div class="thumbs">${list.map(ph => photoThumb(ph, u)).join('') || `<p class="empty-note">${_t('Fotos hierher ziehen')}</p>`}</div></section>`;
  const sel = [...ui.photoSel].filter(id => S.photos[id]);
  const focus = S.photos[ui.photoFocus] && ui.photoSel.has(ui.photoFocus) ? S.photos[ui.photoFocus] : null;
  const exN = SVC.pid ? excludedCount() : 0;
  $('#v-photos').innerHTML = `<div class="photos">
    <div class="ph-tools">
      <button class="btn primary" data-act="addfiles">${_t('Fotos hinzufügen')}</button>
      <button class="btn" data-act="adddir">${_t('Ordner hinzufügen')}</button>
      ${S.demo ? `<button class="btn" data-act="cleardemo">${_t('Beispielbilder entfernen')}</button>` : ''}
      ${SVC.pid ? `<button class="btn" data-act="svcscan" title="${_t('Neue, verschobene und fehlende Dateien in den Monatsordnern übernehmen')}">${_t('Ordner abgleichen')}</button>${exN ? `<button class="btn" data-act="svcrestore">${_t(exN === 1 ? '{n} aussortiertes zurückholen' : '{n} aussortierte zurückholen', { n: exN })}</button>` : ''}` : ''}
      <span class="grow"></span>
      <span class="muted small">${_t('{photos} · {n} ohne Monat', { photos: photosN(all.length), n: byM[12].length })}</span>
    </div>
    ${(ui.importErrors || []).length ? `<section class="card notice"><header><h2>${_t('{files} nicht geöffnet', { files: _t(ui.importErrors.length === 1 ? '{n} Datei' : '{n} Dateien', { n: ui.importErrors.length }) })}</h2>
      <p>${ui.importErrors.slice(0, 6).map(esc).join(', ')}${ui.importErrors.length > 6 ? ' …' : ''}</p></header>
      <p class="hint">${ui.importErrors.some(n => /\.hei[cf]$/i.test(n)) ? _t('HEIC-Fotos vom iPhone kann dieser Browser nicht lesen. Am iPhone unter Einstellungen → Kamera → Formate „Maximale Kompatibilität“ wählen oder die Fotos als JPEG teilen. In Safari klappt der Import meist direkt.') + ' ' : ''}${_t('Andere Dateien sind vermutlich beschädigt oder keine Fotos.')}</p>
      <div class="row"><button class="btn small" data-act="clearerr">${_t('Verstanden')}</button></div></section>` : ''}
    ${all.length && pageKeys().some(k => pageMonth(k) != null && visibleSlots(S.pages[k]).some(s => !s.photo || !S.photos[s.photo])) ? `<section class="card cta"><div><h2>${_t('Fotos auf die Seiten bringen')}</h2><p class="hint">${_t('Die App wählt für leere Seiten ein Layout, setzt Fotos ihres Monats ein und platziert die Kalendarien an ruhigen Stellen. Alles bleibt danach frei änderbar.')}</p></div><button class="btn primary" data-act="autodesign">${_t('Kalender automatisch gestalten')}</button></section>` : ''}
    <div class="dropzone" id="dropzone"><span>${SVC.pid ? _t('Fotos oder ganze Ordner hierher ziehen, sie werden in die Monatsordner des Projekts kopiert.') : _t('Fotos oder ganze Ordner hierher ziehen.')} ${_t('Der Monat wird aus dem <b>Ordnernamen</b> (z. B. „03 März“ oder „2026-03“), dem <b>Aufnahmedatum</b> oder dem <b>Dateinamen</b> (z. B. IMG_20260314) gelesen.')}${SVC.pid ? ' ' + _t('Du kannst Dateien auch direkt in die Monatsordner legen und dann abgleichen.') : ''}</span></div>
    ${focus ? `<section class="card"><div class="detail"><img src="${RT.prev[focus.id] || RT.thumb[focus.id]}" alt="">
      <div style="display:grid;gap:10px;min-width:0">
        <dl><dt>${_t('Datei')}</dt><dd>${esc(focus.name)}</dd><dt>${_t('Aufnahme')}</dt><dd>${focus.date ? new Date(focus.date).toLocaleDateString(locale()) : _t('unbekannt')}</dd>
        <dt>${_t('Monat aus')}</dt><dd>${esc(_t(focus.src || 'keine Angabe'))}</dd><dt>${_t('Auflösung')}</dt><dd class="num">${focus.w} × ${focus.h} px (${fmt1(focus.w * focus.h / 1e6)} MP)</dd>
        <dt>${_t('Größter Druck')}</dt><dd>${_t('{w} × {h} cm bei 300 dpi', { w: fmt1(focus.w / 300 * 2.54), h: fmt1(focus.h / 300 * 2.54) })}</dd></dl>
        <div class="field"><label for="capf">${_t('Bildtext fürs Register')}</label><input type="text" id="capf" data-photo-cap="${focus.id}" value="${esc(focus.caption)}" placeholder="${_t('z. B. Rodeln am Kirchberg')}"></div>
      </div></div></section>` : ''}
    <div class="board">${byM[12].length ? bucket(12, byM[12]) : ''}${MONTHS.map((_, m) => bucket(m, byM[m])).join('')}</div>
  </div>
  ${sel.length ? `<div class="selbar"><b>${_t('{n} ausgewählt', { n: sel.length })}</b>
    <select id="moveTo" data-act-change="moveto" aria-label="${_t('Verschieben nach')}"><option value="">${_t('Verschieben nach …')}</option>${MONTHS.map((n, i) => `<option value="${i}">${n}</option>`).join('')}<option value="-1">${_t('Ohne Monat')}</option></select>
    <button class="btn small" data-act="fav">${_t('★ Favorit')}</button>
    <button class="btn small" data-act="delphotos">${ui.confirmDel ? _t('Wirklich entfernen?') : _t('Entfernen')}</button>
    <button class="btn small" data-act="clearsel">${_t('Fertig')}</button></div>` : ''}`;
}

/* ----- Gestalten ----- */
function renderDesign() {
  if (!$('#v-design .strip')) {
    $('#v-design').innerHTML = `<nav class="strip" id="strip" aria-label="${_t('Seiten')}"></nav>
      <div class="stage"><div class="stage-tools" id="stageTools"></div><div class="canvas-wrap" id="canvasWrap"></div><div class="framebar" id="frameBar"></div></div>
      <aside class="panel"><div class="tabs" id="tabs"></div><div class="tab-body" id="tabBody"></div></aside>`;
  }
  renderStrip(); renderStage(); renderPanel();
}
function pageWarn(k) {
  const p = S.pages[k];
  return visibleSlots(p).some(s => !s.photo || !S.photos[s.photo]) || pageItems(p, { noBlocks: true }).some(it => it.t === 'img' && dpiOf(S.photos[it.photo], it.place) < DPI_BAD);
}
function renderStrip() {
  $('#strip').innerHTML = pageKeys().map(k => `<button class="pg" data-act="page" data-v="${k}" aria-current="${k === ui.page}">
    ${svgPage(S.pages[k], { mode: 'thumb' })}<span>${esc(pageShort(k))} ${pageWarn(k) ? `<span class="warnmark" title="${_t('Leere Rahmen')}">•</span>` : ''}</span></button>`).join('');
  const cur = $('#strip [aria-current="true"]'); if (cur) cur.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}
function updateThumb(k = ui.page) {
  const b = $(`#strip [data-v="${k}"]`); if (!b) return;
  b.innerHTML = `${svgPage(S.pages[k], { mode: 'thumb' })}<span>${esc(pageShort(k))} ${pageWarn(k) ? '<span class="warnmark">•</span>' : ''}</span>`;
}
function renderStage() {
  const keys = pageKeys(), i = keys.indexOf(ui.page);
  $('#stageTools').innerHTML = `<h2>${esc(pageLabel(ui.page))} <span class="muted">${i + 1} / ${keys.length}</span></h2>
    <button class="icon-btn" data-act="prevpage" aria-label="${_t('Vorige Seite')}" ${i <= 0 ? 'disabled' : ''}>${ICON.left}</button>
    <button class="icon-btn" data-act="nextpage" aria-label="${_t('Nächste Seite')}" ${i >= keys.length - 1 ? 'disabled' : ''}>${ICON.right}</button>
    <span class="row vz" style="gap:4px"><button class="icon-btn" data-act="vzoom" data-v="out" aria-label="${_t('Ansicht verkleinern')}" ${ui.viewZoom <= 1 ? 'disabled' : ''}>−</button><button class="btn small" data-act="vzoom" data-v="fit" title="${_t('Ansicht einpassen')}">${Math.round(ui.viewZoom * 100)} %</button><button class="icon-btn" data-act="vzoom" data-v="in" aria-label="${_t('Ansicht vergrößern')}" ${ui.viewZoom >= 6 ? 'disabled' : ''}>+</button></span>
    <button class="btn small primary" data-act="autodesign" title="${_t('Leere Seiten mit Layouts und Fotos ihres Monats füllen, Kalendarien an ruhige Stellen setzen')}">${_t('Automatisch gestalten')}</button>
    <button class="btn small mobile-only" data-act="wall">${_t('An der Wand')}</button>
    <button class="toggle" data-act="tg" data-v="showBleed" aria-pressed="${ui.showBleed}">${_t('Beschnitt')}</button>
    <button class="toggle" data-act="tg" data-v="showBind" aria-pressed="${ui.showBind}">${_t('Bindung')}</button>
    <button class="toggle" data-act="tg" data-v="showGuides" aria-pressed="${ui.showGuides}">${_t('Hilfslinien')}</button>
    ${partnerOf(ui.page) ? `<button class="toggle" data-act="tg" data-v="showPartner" aria-pressed="${ui.showPartner}">${_t('Aufgeklappt')}</button>` : ''}
    ${proofAvailable() ? `<button class="toggle" data-act="proof" aria-pressed="${!!ui.proof}" title="${esc(_t('Farben so zeigen, wie sie mit dem Druckprofil gedruckt aussehen (Softproof)'))}">${_t('Druckansicht')}</button>` : ''}`;
  renderEditor(); renderFrameBar();
}
function renderEditor() {
  const wrap = $('#canvasWrap'), sx = wrap.scrollLeft, sy = wrap.scrollTop;
  wrap.dataset.proof = proofOn() ? proofLabel() : '';
  wrap.innerHTML = svgPage(curPage(), { mode: 'editor', showBleed: ui.showBleed, showBind: ui.showBind, showGuides: ui.showGuides, partner: ui.showPartner ? partnerOf(ui.page) : null, attrs: 'id="editor"' });
  const svg = $('#editor');
  // Ansichtszoom: unabhängig vom Bildzoom im Rahmen
  wrap.classList.toggle('zoomed', ui.viewZoom > 1);
  if (ui.viewZoom > 1) {
    const vb = svg.viewBox.baseVal, cs = getComputedStyle(wrap);
    const aw = wrap.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const ah = window.innerWidth > 980 ? wrap.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) : Infinity;
    const k = Math.min(aw / vb.width, ah / vb.height) * ui.viewZoom;
    svg.style.width = vb.width * k + 'px'; svg.style.height = vb.height * k + 'px'; svg.style.maxWidth = 'none'; svg.style.maxHeight = 'none';
    wrap.scrollLeft = sx; wrap.scrollTop = sy;
  }
  const m = svg.getScreenCTM(); if (m && m.a) ui.pxmm = m.a;     // Bildschirmpixel pro mm, z. B. für Trefferflächen
  bindEditor(svg);
}
const dpiPill = (ph, r, sl) => {
  const d = Math.round(dpiOf(ph, placeImage(r, ph, sl))), cls = d < DPI_BAD ? 'bad' : d < DPI_WARN ? 'warn' : 'ok';
  return `<span class="pill ${cls}" id="dpiPill">${d < DPI_BAD ? _t('{d} dpi · zu klein', { d }) : d < DPI_WARN ? _t('{d} dpi · knapp', { d }) : `${d} dpi`}</span>`;
};
// Bild verbessern: Regler direkt unter dem Bild, wie beim Ausschnitt; gedrückt halten zeigt das Original
const ADJ_SLIDERS = () => [['exposure', _t('Helligkeit')], ['contrast', _t('Kontrast')], ['warmth', _t('Wärme')], ['saturation', _t('Farbe')]];
const ADJ_MORE = () => [['highlights', _t('Lichter')], ['shadows', _t('Tiefen')], ['tint', _t('Tönung')]];
const LOOK_NAMES = () => [['', _t('Ohne Look')], ['vivid', _t('Lebendig')], ['warm', _t('Warm')], ['soft', _t('Sanft')], ['film', _t('Film')], ['bw', _t('Schwarzweiß')], ['bwstrong', _t('S/W kräftig')]];
// Kachel: das eigene Foto mit diesem Look (und allem anderen, was schon eingestellt ist)
function lookThumb(ph, look) {
  const c = compileAdjust(adjOf(ph.id, { look })), fid = c ? `lk${look || 'x'}${adjFilterId(c)}` : '';
  return `<svg viewBox="0 0 64 48" aria-hidden="true">${c ? `<defs>${adjFilterDef(c, fid)}</defs>` : ''}<image href="${RT.thumb[ph.id]}" width="64" height="48" preserveAspectRatio="xMidYMid slice"${c ? ` filter="url(#${fid})"` : ''}/></svg>`;
}
const adjSlider = (ph, r, [k, l]) => `<label class="adj"><span>${l}<output>${adjFmt(r[k] || 0)}</output></span><input type="range" min="-1" max="1" step="0.05" value="${r[k] || 0}" data-act-input="adj" data-k="${k}" data-photo="${ph.id}"></label>`;
function tuneBar(ph) {
  const r = (S.doc.adjust && S.doc.adjust[ph.id]) || {}, auto = !!r.auto;
  return `<div class="tune-head"><img src="${RT.thumb[ph.id]}" alt=""><b>${_t('Bild verbessern')}</b>
      <button class="btn small auto-btn" data-act="adjauto" data-v="${ph.id}" aria-pressed="${auto}" title="${esc(_t('Belichtung, Weißabgleich, Kontrast und Farbe automatisch, mit Vorrang für Gesichter'))}">✦ ${_t('Auto')}</button>
      <button class="linkbtn" data-act="adjall" data-v="${ph.id}">${_t('Alle Fotos automatisch')}</button>
      <button class="linkbtn" data-act="matchmonths">${_t('Monate angleichen')}</button><span class="sp"></span>
      <button class="btn small" data-hold="compare" title="${esc(_t('Gedrückt halten zeigt das Original'))}">${_t('Original')}</button>
      <button class="btn small" data-act="adjreset" data-v="${ph.id}" ${adjOf(ph.id) ? '' : 'disabled'}>${_t('Zurücksetzen')}</button>
      <button class="btn small primary" data-act="tune">${_t('Fertig')}</button></div>
    <div class="looks" role="group" aria-label="${esc(_t('Looks'))}">${LOOK_NAMES().map(([k, l]) => `<button class="look" data-act="adjlook" data-v="${k}" data-photo="${ph.id}" aria-pressed="${(r.look || '') === k}">${lookThumb(ph, k)}<span>${l}</span></button>`).join('')}</div>
    <div class="tune-sliders">${r.look ? `<label class="adj strength"><span>${_t('Stärke des Looks')}<output>${Math.round((r.lookAmt ?? 1) * 100)} %</output></span><input type="range" min="0" max="1" step="0.05" value="${r.lookAmt ?? 1}" data-act-input="adjlookamt" data-photo="${ph.id}"></label>` : ''}${auto ? `<label class="adj strength"><span>${_t('Stärke der Automatik')}<output>${Math.round((r.strength ?? .7) * 100)} %</output></span><input type="range" min="0" max="1" step="0.05" value="${r.strength ?? .7}" data-act-input="adjstrength" data-photo="${ph.id}"></label>` : ''}${ADJ_SLIDERS().map(x => adjSlider(ph, r, x)).join('')}${ui.adjMore ? ADJ_MORE().map(x => adjSlider(ph, r, x)).join('') : ''}
      <button class="linkbtn adj-more" data-act="adjmore">${ui.adjMore ? _t('Weniger Regler') : _t('Lichter, Tiefen, Tönung …')}</button></div>`;
}
const adjFmt = (v) => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.round(Math.abs(v) * 100);
function renderFrameBar() {
  const fb = $('#frameBar'), p = curPage();
  fb.classList.remove('tuning');
  if (ui.swapFrom != null) { fb.innerHTML = `<span>${_t('Tippe auf den Rahmen, mit dem getauscht werden soll.')}</span><button class="btn small" data-act="swapcancel">${_t('Abbrechen')}</button>`; return; }
  if (ui.sel == null || p.layout === 'index') {
    fb.innerHTML = `<span class="hint">${p.layout === 'index' ? _t('Das Register wird automatisch aus allen Seiten erstellt. Bildtexte rechts unter „Register“.') : ui.armed ? _t('Foto gewählt: Tippe auf einen Rahmen, um es einzusetzen.') : (coarse() ? _t('Rahmen antippen wählt ihn aus. Doppelt tippen bearbeitet den Bildausschnitt. Lange drücken und ziehen verschiebt einen ausgewählten Rahmen oder tauscht Fotos.') : _t('Foto in einen Rahmen ziehen. Rahmen anklicken wählt ihn aus, dann ziehen oder an den Ecken die Größe ändern. Doppelklick bearbeitet den Bildausschnitt. Ein Foto auf einen anderen Rahmen ziehen tauscht die beiden.'))}</span>`;
    return;
  }
  const r = rectOf(p, ui.sel), sl = slotOf(p, ui.sel), ph = sl && S.photos[sl.photo];
  if (!r) { fb.innerHTML = ''; return; }
  const crop = ui.crop === ui.sel && ph, tune = ui.tune === ui.sel && ph && !crop;
  let h = '';
  if (tune) { fb.classList.add('tuning'); fb.innerHTML = tuneBar(ph); return; }
  if (ph) {
    h += `<img src="${RT.thumb[ph.id]}" alt=""><div class="meta"><b>${esc(ph.caption || ph.name)}</b>${dpiPill(ph, r, sl)}</div>
      <button class="btn small ${crop ? 'primary' : ''}" data-act="crop" aria-pressed="${!!crop}">${crop ? _t('Ausschnitt fertig') : _t('Ausschnitt bearbeiten')}</button>
      ${crop ? '' : `<button class="btn small" data-act="tune">${adjOf(ph.id) ? _t('Bild verbessert ✓') : _t('Bild verbessern')}</button>`}`;
    if (crop) h += `<div class="range"><span class="small muted">${_t('Zoom')}</span><input type="range" id="zm" aria-label="${_t('Zoom')}" min="1" max="5" step="0.01" value="${sl.zoom || 1}" data-act-input="zoom"><output>${Math.round((sl.zoom || 1) * 100)} %</output></div>
      <div class="range"><span class="small muted">${_t('Drehen')}</span><input type="range" id="rt" aria-label="${_t('Foto drehen')}" min="-180" max="180" step="0.5" value="${sl.rot || 0}" data-act-input="rot"><output>${fmt1(sl.rot || 0)}°</output></div>
      <button class="btn small" data-act="rot90" title="${_t('Um 90° drehen')}">↻ 90°</button>
      ${seg([['cover', _t('Füllen')], ['contain', _t('Ganz zeigen')]], sl.fit || 'cover', 'fitmode')}
      <button class="btn small" data-act="fit">${_t('Einpassen')}</button>
      <span class="hint">${coarse() ? _t('Foto ziehen, mit zwei Fingern zoomen.') : _t('Foto ziehen, mit dem Mausrad zoomen. Esc beendet.')}</span>`;
    else h += `<input type="text" id="capi" data-photo-cap="${ph.id}" value="${esc(ph.caption)}" placeholder="${_t('Bildtext fürs Register')}">
      <button class="btn small" data-act="swap">${_t('Tauschen')}</button>
      <button class="btn small danger" data-act="unslot">${_t('Foto entfernen')}</button>`;
  } else h += `<span class="hint">${coarse() ? _t('Leerer Rahmen: Foto unten in der Liste antippen, dann landet es hier.') : _t('Leerer Rahmen: Foto aus der Liste rechts hineinziehen oder anklicken.')}</span>`;
  if (!crop) h += `<span class="fb-sep" aria-hidden="true"></span><span class="small muted num">${fmt1(r.w)} × ${fmt1(r.h)} mm${r.custom ? '' : ' · ' + _t('Vorlage')}</span>
    <button class="btn small" data-act="dupframe">${_t('Duplizieren')}</button>
    <button class="btn small" data-act="front" title="${_t('Nach vorn')}">${_t('Nach vorn')}</button><button class="btn small" data-act="back" title="${_t('Nach hinten')}">${_t('Nach hinten')}</button>
    <div class="range" style="max-width:190px"><span class="small muted">${_t('Rand')}</span><input type="range" id="bd" aria-label="${_t('Rand um den Rahmen')}" min="0" max="8" step="0.5" value="${r.border}" data-act-input="border"><output>${fmt1(r.border)} mm</output></div>
    <button class="btn small danger" data-act="delframe">${_t('Rahmen löschen')}</button>`;
  fb.innerHTML = h;
}
function renderPanel() {
  const p = curPage();
  const third = p.key === 'cover' ? ['title', _t('Titel')] : p.layout === 'index' ? ['index', _t('Register')] : ['cal', _t('Kalender')];
  const tabs = p.layout === 'index' ? [third] : [['layout', _t('Layout')], ['photos', _t('Fotos')], third];
  if (p.layout === 'index') ui.sel = null;
  if (!tabs.some(t => t[0] === ui.tab)) ui.tab = tabs[0][0];
  $('#tabs').innerHTML = tabs.map(([k, l]) => `<button data-act="tab" data-v="${k}" aria-selected="${ui.tab === k}">${l}</button>`).join('');
  const body = $('#tabBody');
  if (ui.tab === 'layout') body.innerHTML = panelLayout(p);
  else if (ui.tab === 'photos') body.innerHTML = panelPhotos(p);
  else if (ui.tab === 'cal') body.innerHTML = panelCal(p);
  else if (ui.tab === 'title') body.innerHTML = panelTitle(p);
  else body.innerHTML = panelIndex(p);
}
function layoutIcon(l) {
  const W = S.doc.w, H = S.doc.h, s = 60 / Math.max(W, H), w = W * s, h = H * s, g = Math.max(1, S.doc.gap * s * 1.5);
  let r = `<svg viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="var(--surface)" stroke="var(--line)" stroke-width="1"/>`;
  l.slots.forEach(([x, y, ww, hh]) => r += `<rect x="${x * w + (x > 0 ? g / 2 : 1)}" y="${y * h + (y > 0 ? g / 2 : 1)}" width="${ww * w - (x > 0 ? g / 2 : 1) - (x + ww < .999 ? g / 2 : 1)}" height="${hh * h - (y > 0 ? g / 2 : 1) - (y + hh < .999 ? g / 2 : 1)}" fill="var(--muted)" fill-opacity=".55"/>`);
  (l.ov || []).forEach(([x, y, ww, hh]) => r += `<rect x="${x * w}" y="${y * h}" width="${ww * w}" height="${hh * h}" fill="var(--accent)" stroke="var(--surface)" stroke-width="1.5"/>`);
  return r + '</svg>';
}
function panelLayout(p) {
  const changed = visibleSlots(p).filter(s => s.box).length + p.slots.slice(0, slotCount(p.layout)).filter(s => s.hidden).length;
  return `<div class="field"><span class="lbl">${_t('Seitenlayout')}</span><div class="layouts">${LAYOUTS.map(l => `<button class="lay" data-act="layout" data-v="${l.id}" aria-pressed="${p.layout === l.id}">${layoutIcon(l)}<span>${l.name}</span></button>`).join('')}</div>
    <p class="hint">${_t('Die Vorlage ist der Ausgangspunkt. Danach lassen sich Rahmen frei verschieben, skalieren, überlagern, duplizieren und löschen. Beim Wechsel bleiben die Fotos in ihrer Reihenfolge.')}</p></div>
    <div class="row"><button class="btn" data-act="addframe">${_t('Rahmen hinzufügen')}</button>${changed || (p.extra || []).length ? `<button class="btn" data-act="resetframes">${_t('Rahmen wie Vorlage')}</button>` : ''}</div>
    ${changed ? `<p class="hint">${_t(changed > 1 ? '{n} Rahmen sind von Hand verändert. Abstand und Außenrand ändern sie nicht mehr.' : '{n} Rahmen ist von Hand verändert. Abstand und Außenrand ändern ihn nicht mehr.', { n: changed })}</p>` : ''}
    ${range('gp2', 'doc.gap', S.doc.gap, 0, 5, .5, ' mm', _t('Abstand zwischen Bildern (alle Seiten)'))}
    <label class="check"><input type="checkbox" id="pgo" data-act="pagegapon" ${p.gap != null ? 'checked' : ''}><span>${_t('Eigener Abstand nur für diese Seite')}</span></label>
    ${p.gap != null ? `<div class="field"><label for="pg">${_t('Abstand auf dieser Seite')}</label><div class="range"><input type="range" id="pg" min="0" max="5" step="0.5" value="${p.gap}" data-act-input="pagegap"><output>${fmt1(p.gap)} mm</output></div></div>` : ''}
    ${range('mg2', 'doc.margin', S.doc.margin, 0, 20, 1, ' mm', _t('Außenrand (alle Seiten)'))}
    <div class="row"><button class="btn" data-act="autofill">${_t('Leere Rahmen füllen')}</button><button class="btn" data-act="clearpage">${_t('Seite leeren')}</button></div>
    ${sheetTools(p)}`;
}
// Blätter einfügen und entfernen
function sheetTools(p) {
  const sh = sheetOf(p.key); if (!sh || sh.role === 'index') return '';
  const m = pageMonth(p.key);
  return `<div class="field"><span class="lbl">${_t('Blatt')}</span>
    <div class="row">${m != null ? `<button class="btn small" data-act="addsheet" data-v="month">${_t('Weiteres Motiv für {month}', { month: MONTHS[m] })}</button>` : ''}
    <button class="btn small" data-act="addsheet" data-v="blank">${_t('Freies Blatt danach')}</button>
    ${sh.extra ? `<button class="btn small danger" data-act="delsheet">${_t('Dieses Blatt entfernen')}</button>` : ''}</div>
    <p class="hint">${_t('Ein weiteres Motiv ist ein zusätzliches Blatt mit demselben Kalendarium. So kann man beim Aufhängen das schönere wählen.')}</p></div>`;
}
function poolPhotos(p) {
  const m = pageMonth(p.key);
  const f = ui.pool ?? (m != null ? String(m) : Object.values(S.photos).some(x => x.fav) ? 'fav' : 'all');
  const all = Object.values(S.photos);
  const list = f === 'all' ? all : f === 'fav' ? all.filter(x => x.fav) : f === 'free' ? all.filter(x => !usage()[x.id]) : all.filter(x => x.month === +f);
  return { f, list: list.sort((a, b) => (b.fav - a.fav) || (a.date || '').localeCompare(b.date || '')) };
}
function panelPhotos(p) {
  const u = usage(), { f, list } = poolPhotos(p);
  return `<div class="field"><label for="poolf">${_t('Fotos aus')}</label><select id="poolf" data-act-change="pool">
      ${MONTHS.map((n, i) => `<option value="${i}" ${f === String(i) ? 'selected' : ''}>${n} (${Object.values(S.photos).filter(x => x.month === i).length})</option>`).join('')}
      <option value="fav" ${f === 'fav' ? 'selected' : ''}>${_t('Favoriten')}</option><option value="free" ${f === 'free' ? 'selected' : ''}>${_t('Noch nicht verwendet')}</option><option value="all" ${f === 'all' ? 'selected' : ''}>${_t('Alle Fotos')}</option></select></div>
    <div class="pool">${list.map(ph => photoThumb(ph, u)).join('') || `<p class="empty-note">${_t('Keine Fotos in dieser Auswahl. Unter „Fotos“ hinzufügen.')}</p>`}</div>
    <p class="hint">${coarse() ? _t('Foto antippen, dann den Rahmen antippen. Oder lange drücken und auf den Rahmen ziehen.') : _t('Foto in einen Rahmen ziehen oder anklicken und dann den Rahmen anklicken.')}${pageMonth(p.key) != null ? ' ' + _t('Ein Foto aus einem anderen Monat wird dabei {month} zugeordnet.', { month: MONTHS[pageMonth(p.key)] }) : ''}</p>`;
}
// Vorschau einer Gestaltungsvariante: das Kalendarium dieses Monats, klein und angeschnitten
function miniCal(style, design, m) {
  const c = { ...calSettings(curPage()), ...CAL_DESIGNS[design], style, color: 'black', names: false, kw: false, school: false, bd: 'off', width: 'auto', maxW: 0 };
  const lay = (style === 'v' ? calV : style === 'g' ? calG : calH)(S.doc.year, m, 1, c);
  const vw = Math.min(lay.w, style === 'h' ? 74 : 62), vh = Math.min(lay.h, style === 'v' ? 46 : 46);
  const el = lay.items.map(it => it.t === 'text'
    ? `<text x="${it.x}" y="${it.y}" font-size="${it.size}" font-weight="${it.font === 'bold' ? 600 : 400}" fill="${cRGBraw(it.fill)}" text-anchor="${it.anchor}"${it.ls ? ` letter-spacing="${it.ls}"` : ''}>${esc(it.text)}</text>`
    : it.t === 'rect' ? `<rect x="${it.x}" y="${it.y}" width="${it.w}" height="${it.h}" fill="${cRGBraw(it.fill)}"/>` : it.t === 'circle' ? `<circle cx="${it.x}" cy="${it.y}" r="${it.r}" fill="${cRGBraw(it.fill)}"/>` : '').join('');
  return `<svg viewBox="-2 -2 ${vw + 4} ${vh + 4}" xmlns="http://www.w3.org/2000/svg" style="font-family:CalJost,sans-serif;font-kerning:none" aria-hidden="true">${el}</svg>`;
}
const CAL_DESIGN_NAMES = () => ({ classic: _t('Klassisch'), modern: _t('Modern'), minimal: _t('Ruhig'), bold: _t('Kräftig') });
// Gestaltung des Kalendariums: vier Varianten als Vorschau, Feinheiten aufklappbar. Gilt für alle Monate.
function calDesignBox(p, c) {
  const o = calOpts(c), m = pageMonth(p.key) ?? 0, names = CAL_DESIGN_NAMES();
  const cur = Object.keys(CAL_DESIGNS).find(k => Object.entries(CAL_DESIGNS[k]).every(([x, v]) => o[x] === v));
  const tiles = Object.keys(CAL_DESIGNS).map(k => `<button class="caltile" data-act="caldesign" data-v="${k}" aria-pressed="${k === cur}">${miniCal(c.style, k, m)}<span>${names[k]}</span></button>`).join('');
  return `<div class="field"><span class="lbl">${_t('Gestaltung')}</span><div class="caltiles">${tiles}</div>
    <details class="caldetails" id="calDetails" ${ui.calDetails ? 'open' : ''}><summary>${_t('Feinheiten')}</summary>
      <div class="field"><span class="lbl">${_t('Monatsname')}</span>${seg([['classic', _t('Fett')], ['caps', _t('Versalien')], ['light', _t('Leicht')], ['number', _t('Mit Zahl')]], o.title, 'caltitle')}</div>
      <div class="field"><span class="lbl">${_t('Wochentage')}</span>${seg([['2', WEEKDAYS2[calLang()][1]], ['1', WEEKDAYS2[calLang()][1].slice(0, 1)], ['0', _t('Aus')]], String(o.wd), 'calwd')}</div>
      <div class="field"><span class="lbl">${_t('Wochen trennen')}</span>${seg([['gap', _t('Abstand')], ['line', _t('Linie')], ['none', _t('Nicht')]], o.weeks, 'calweeks')}</div>
      <div class="field"><span class="lbl">${_t('Tageszahlen')}</span>${seg([['regular', _t('Normal')], ['bold', _t('Kräftig')]], o.num, 'calnum')}</div>
      ${c.style === 'h' ? `<div class="field"><span class="lbl">${_t('Breite der Leiste')}</span>${seg([['auto', _t('Passend')], ['full', _t('Ganze Seitenbreite')]], o.width, 'calwidth')}</div>` : ''}
    </details>
    <p class="hint">${_t('Gilt für alle Monate. Abstände, Mindestgrößen und gleich breite Ziffern regelt die App, damit es immer ordentlich aussieht.')}</p></div>`;
}
function panelCal(p) {
  const c = calSettings(p);
  const custom = p.cal && p.cal.pos && p.cal.pos[c.style];
  const v = viewOf(p.key), opened = v.part === 'upper' || v.part === 'lower';
  const where = opened ? `<div class="field"><span class="lbl">${_t('Kalendarium der Ansicht {month}', { month: MONTHS[v.month] })}</span>${seg([['upper', _t('Oben')], ['lower', _t('Unten')]], (S.doc.viewCal || {})[(sheetOf(v.part === 'upper' ? v.lower : p.key) || {}).id] === 'upper' ? 'upper' : 'lower', 'viewcal')}
    <p class="hint">${_t('Oben und unten bilden zusammen eine Monatsansicht und bekommen ein gemeinsames Kalendarium.')}</p></div>` : '';
  if (opened && c.style === 'off' && !(p.cal && p.cal.style)) return where + `<p class="hint">${v.part === 'upper' ? _t('Auf dieser Seite steht kein Kalendarium, weil es auf der unteren Seite steht.') : _t('Auf dieser Seite steht kein Kalendarium, weil es auf der oberen Seite steht.')}</p>`;
  const m = pageMonth(p.key), bds = m != null ? (S.doc.birthdays || []).filter(b => +b.m === m + 1 && b.name) : [];
  const bdBox = m != null ? `<div class="field"><span class="lbl">${_t('Geburtstage im {month}', { month: MONTHS[m] })}</span>
    ${bds.length ? `<p class="hint">${bds.sort((a, b) => a.d - b.d).map(b => _t('{d}. {name}', { d: +b.d, name: esc(b.name) })).join(' · ')}</p>` : ''}
    <div class="row bdquick"><input type="text" id="bdqn" placeholder="${_t('Name')}" aria-label="${_t('Name')}"><input type="number" id="bdqd" min="1" max="31" placeholder="${_t('Tag')}" aria-label="${_t('Tag')}"><button class="btn small" data-act="bdquick" data-v="${m + 1}">${_t('Hinzufügen')}</button></div>
    <button class="linkbtn" data-act="go" data-v="project">${_t('Alle Geburtstage und Anzeige …')}</button></div>` : '';
  const auto = pageMonth(p.key) != null ? `<div class="autoplace"><b>${_t('Platz automatisch finden')}</b><p class="hint">${_t('Sucht im Foto eine ruhige Fläche, etwa Himmel, Wiese oder Wasser, und wählt die passende Schriftfarbe. Danach lässt sich alles von Hand ändern.')}</p>
    <div class="row"><button class="btn primary small" data-act="placehere">${_t('Für diese Seite')}</button><button class="btn small" data-act="placeall">${_t('Für alle Monate')}</button></div></div>` : '';
  return where + auto + bdBox + `<div class="field"><span class="lbl">${_t('Kalendarium auf dieser Seite')}</span>${seg([['h', _t('Leiste')], ['v', _t('Spalte')], ['g', _t('Raster')], ['off', _t('Aus')]], c.style, 'calstyle')}</div>
    ${c.style === 'off' ? '' : `
    ${calDesignBox(p, c)}
    ${range('cs', 'page.cal.size', c.size, .6, 1.8, .05, '×', _t('Größe'))}
    <div class="field"><span class="lbl">${_t('Schriftfarbe')}</span>${swatches(TEXT_COLORS, c.color, 'calcolor')}</div>
    <div class="field"><span class="lbl">${_t('Fläche dahinter')}</span>${seg([['none', _t('Keine')], ['light', _t('Hell')], ['dark', _t('Dunkel')], ['paper', _t('Papier')]], c.panel, 'calpanel')}</div>
    ${c.panel !== 'none' ? range('co', 'page.cal.opacity', c.opacity ?? .85, .2, 1, .05, ' %', _t('Deckkraft der Fläche'), 100) : ''}
    <div class="field"><span class="lbl">${_t('Sonn- und Feiertage')}</span>${seg([['red', _t('Rot')], ['bold', _t('Fett')], ['none', _t('Normal')]], c.hi, 'calhi')}</div>
    <div class="field"><span class="lbl">${_t('Position')}</span>
      <p class="hint">${custom ? _t('Auf dieser Seite verschoben.') : _t('Steht an der Standardposition.')} ${_t('Zum Verschieben im Bild ziehen.')}</p>
      <div class="row"><button class="btn small" data-act="calreset" ${custom ? '' : 'disabled'}>${_t('Zur Standardposition')}</button>
      <button class="btn small" data-act="caldefault">${_t('Als Standard für alle Seiten')}</button></div></div>
    <button class="btn small" data-act="calall">${_t('Diese Einstellungen auf alle Monate übertragen')}</button>`}`;
}
function panelTitle(p) {
  const t = p.title;
  return `<div class="field"><label for="tt">${_t('Titel')}</label><input type="text" id="tt" data-bind="page.title.text" value="${esc(t.text)}"></div>
    <div class="field"><label for="ts">${_t('Untertitel')}</label><input type="text" id="ts" data-bind="page.title.sub" value="${esc(t.sub)}"></div>
    ${range('tz', 'page.title.size', t.size, .5, 2, .05, '×', _t('Größe'))}
    <div class="field"><span class="lbl">${_t('Schriftfarbe')}</span>${swatches(TEXT_COLORS, t.color, 'titlecolor')}</div>
    <div class="field"><span class="lbl">${_t('Fläche dahinter')}</span>${seg([['none', _t('Keine')], ['light', _t('Hell')], ['dark', _t('Dunkel')], ['paper', _t('Papier')]], t.panel, 'titlepanel')}</div>
    ${t.panel !== 'none' ? range('to', 'page.title.opacity', t.opacity ?? .85, .2, 1, .05, ' %', _t('Deckkraft der Fläche'), 100) : ''}
    <p class="hint">${_t('Den Titel im Bild an die gewünschte Stelle ziehen.')}</p>`;
}
function panelIndex() {
  const d = S.doc, mode = indexMode();
  let body = '';
  if (mode === 'photos') {
    const rows = [];
    for (const k of baseKeys()) {
      const ps = visibleSlots(S.pages[k]).map(s => s.photo && S.photos[s.photo]).filter(Boolean);
      if (!ps.length) continue;
      rows.push(`<div class="cap-month">${esc(pageLabel(k))}</div>` + ps.map((ph, i) => `<div class="caprow"><img src="${RT.thumb[ph.id]}" alt=""><input type="text" id="cap-${ph.id}" aria-label="${_t('Bildtext {n}', { n: i + 1 })}" data-photo-cap="${ph.id}" value="${esc(ph.caption)}" placeholder="${_t('{n}. Bildtext', { n: i + 1 })}"></div>`).join(''));
    }
    body = `<div class="caplist">${rows.join('') || `<p class="empty-note">${_t('Noch keine Fotos auf den Seiten.')}</p>`}</div>`;
  } else if (mode === 'pages') {
    body = `<div class="caplist">${baseKeys().map(k => `<div class="field"><label for="pc-${k}">${esc(pageLabel(k))}</label><textarea id="pc-${k}" rows="2" data-page-cap="${k}" placeholder="${_t('Was auf dieser Seite zu sehen ist')}">${esc(S.pages[k].caption || '')}</textarea></div>`).join('')}</div>
      <p class="hint">${_t('Seiten ohne Foto und ohne Text erscheinen nicht im Register.')}</p>`;
  } else {
    body = `<div class="field"><label for="ixtx">${_t('Text')}</label><textarea id="ixtx" rows="16" data-bind="doc.indexText" placeholder="${_t('Hier frei schreiben.&#10;&#10;Eine Leerzeile beginnt einen neuen Absatz.&#10;## am Zeilenanfang macht eine Zwischenüberschrift.')}">${esc(d.indexText || '')}</textarea></div>
      <p class="hint">${_t('Der Text verteilt sich auf Spalten und, wenn nötig, auf weitere Registerseiten.')}</p>`;
  }
  return `<div class="field"><span class="lbl">${_t('Art des Registers')}</span>${seg([['photos', _t('Bilder je Seite')], ['pages', _t('Text je Seite')], ['text', _t('Freier Text')]], mode, 'ixmode')}</div>
    <div class="field"><label for="ixt">${_t('Überschrift')}</label><input type="text" id="ixt" data-bind="doc.indexTitle" value="${esc(d.indexTitle)}"></div>
    ${mode !== 'text' ? `<div class="row"><label class="check"><input type="checkbox" id="ixth" data-bind="doc.indexThumbs" ${d.indexThumbs !== false ? 'checked' : ''}><span>${_t('Miniaturen der Seiten')}</span></label>
      ${mode === 'photos' ? `<label class="check"><input type="checkbox" id="ixnu" data-bind="doc.indexNums" ${d.indexNums !== false ? 'checked' : ''}><span>${_t('Nummern')}</span></label>` : ''}</div>` : ''}
    ${body}`;
}
/* ----- Druck ----- */
function checks() {
  const out = [], d = S.doc, zone = bindZoneDepth();
  let empty = 0, low = 0, tiny = 0;
  for (const k of pageKeys()) {
    const p = S.pages[k];
    if (p.layout === 'index') continue;
    const items = pageItems(p);
    const e = items.filter(i => i.t === 'empty').length;
    if (e) { empty += e; out.push(['bad', e === 1 ? _t('{page}: ein leerer Rahmen (druckt weiß)', { page: pageLabel(k) }) : _t('{page}: {n} leere Rahmen (druckt weiß)', { page: pageLabel(k), n: e }), k, { act: 'fixpage', label: _t('Füllen') }]); }
    for (const it of items) if (it.t === 'img') {
      if (S.photos[it.photo].missing) { out.push(['bad', _t('{page}: Foto „{name}“ fehlt im Projektordner (verschoben oder gelöscht?)', { page: pageLabel(k), name: S.photos[it.photo].name }), k]); continue; }
      const dpi = dpiOf(S.photos[it.photo], it.place);
      if (dpi < DPI_BAD) { tiny++; out.push(['bad', _t('{page}: Foto mit nur {dpi} dpi wird unscharf', { page: pageLabel(k), dpi: Math.round(dpi) }), k]); }
      else if (dpi < DPI_WARN) { low++; out.push(['warn', _t('{page}: Foto mit {dpi} dpi ist knapp', { page: pageLabel(k), dpi: Math.round(dpi) }), k]); }
    }
    const faces = pageFaces(p);
    const cut = faces.filter(f => f.shown > .1 && f.shown < .9).length;
    if (cut) out.push(['warn', cut === 1 ? _t('{page}: Ein Gesicht ist am Rand angeschnitten', { page: pageLabel(k) }) : _t('{page}: {n} Gesichter sind am Rand angeschnitten', { page: pageLabel(k), n: cut }), k]);
    for (const it of items) if (it.t === 'block') {
      const cal = it.kind === 'cal', page = pageLabel(k);
      if (faceCover(faces, it) > .3) out.push(['warn', cal ? _t('{page}: Kalendarium verdeckt ein Gesicht', { page }) : _t('{page}: Titel verdeckt ein Gesicht', { page }), k, cal ? { act: 'placepage', label: _t('Neu platzieren') } : undefined]);
      if (unreadable(p, it, items)) out.push(['bad', cal ? _t('{page}: Kalendarium ist auf dem Papier kaum lesbar (Schrift wie Hintergrund)', { page }) : _t('{page}: Titel ist auf dem Papier kaum lesbar (Schrift wie Hintergrund)', { page }), k]);
      if (viewOf(k).part === 'upper' ? it.y + it.h > d.h - zone : it.y < zone) out.push(['warn', cal ? _t('{page}: Kalendarium ragt in die Bindung', { page }) : _t('{page}: Titel ragt in die Bindung', { page }), k]);
      else if (it.x < 4 || it.y < 4 || it.x + it.w > d.w - 4 || it.y + it.h > d.h - 4) out.push(['warn', cal ? _t('{page}: Kalendarium liegt sehr nah am Schnitt', { page }) : _t('{page}: Titel liegt sehr nah am Schnitt', { page }), k]);
    }
  }
  // Monate, die deutlich dunkler oder heller als die anderen sind (im Hintergrund gemessen)
  refreshMonthTones(() => { if (ui.view === 'print' && outlierMonths().length) renderPrint(); });
  for (const o of outlierMonths()) out.push(['warn', o.darker ? _t('{page} ist deutlich dunkler als die anderen Monate', { page: pageLabel(o.key) }) : _t('{page} ist deutlich heller als die anderen Monate', { page: pageLabel(o.key) }), o.key, { act: 'matchmonths', label: _t('Angleichen') }]);
  if (d.index) {
    const mode = indexMode();
    if (mode === 'photos') {
      const missing = baseKeys().flatMap(k => visibleSlots(S.pages[k])).filter(s => s.photo && S.photos[s.photo] && !S.photos[s.photo].caption).length;
      if (missing) out.push(['warn', _t('Bildregister: {n} Fotos ohne Bildtext', { n: missing }), 'index']);
    } else if (mode === 'pages') {
      const missing = indexEntries().filter(k => !(S.pages[k].caption || '').trim()).length;
      if (missing) out.push(['warn', _t('Bildregister: {n} Seiten ohne Text', { n: missing }), 'index']);
    } else if (!(d.indexText || '').trim()) out.push(['warn', _t('Bildregister: noch kein Text'), 'index']);
  }
  // Jedes Foto gehört zu genau einem Monat; Mehrfachnutzung sichtbar machen
  for (const [id, keys] of Object.entries(usage())) {
    const ph = S.photos[id]; if (!ph) continue;
    const wrong = keys.filter(k => pageMonth(k) != null && pageMonth(k) !== ph.month);
    if (wrong.length) out.push(['warn', ph.month < 0 ? _t('{pages}: Foto „{name}“ gehört zu keinem Monat', { pages: wrong.map(pageLabel).join(', '), name: ph.caption || ph.name }) : _t('{pages}: Foto „{name}“ gehört zu {month}', { pages: wrong.map(pageLabel).join(', '), name: ph.caption || ph.name, month: MONTHS[ph.month] }), wrong[0]]);
    if (keys.length > 1) out.push(['warn', _t('Foto „{name}“ steht mehrfach: {pages}', { name: ph.caption || ph.name, pages: keys.map(pageLabel).join(', ') }), keys[0]]);
  }
  if (d.bind.type !== 'none' && d.bind.type !== 'custom') out.push(['warn', _t('Lochung und Aufhänger nutzen Richtwerte. Für die Druckerei die Maße aus deren Datenblatt eintragen.'), null]);
  const pr = SVC.pid && PRN.loaded ? printerOf() : null;
  if (pr && d.bleed + 1e-6 < pr.bleed) out.push(['bad', _t('Beschnitt {b} mm, das Druckprofil verlangt {p} mm', { b: fmt1(d.bleed), p: fmt1(pr.bleed) }), null, { act: 'fixbleed', label: _t('Anpassen') }]);
  else if (!pr && d.bleed < 3) out.push(['warn', _t('Beschnitt nur {b} mm, üblich sind 3 mm', { b: fmt1(d.bleed) }), null]);
  return out;
}
// Schrift steht überwiegend auf Papier bzw. leerem Rahmen und hat fast dessen Farbe (z. B. weiß auf weiß)
function unreadable(p, blk, items) {
  const c = blk.kind === 'cal' ? calSettings(p) : p.title; if (!c || (c.panel && c.panel !== 'none')) return false;
  let photo = 0;
  for (const it of items) if (it.t === 'img') { const r = intersect(it.clip, blk); if (r) photo += r.w * r.h; }
  if (photo > blk.w * blk.h * .5) return false;
  const lum = (id) => { const h = cRGBraw(id).slice(1); return (parseInt(h.slice(0, 2), 16) * .299 + parseInt(h.slice(2, 4), 16) * .587 + parseInt(h.slice(4, 6), 16) * .114) / 255; };
  return Math.abs(lum(c.color) - lum(S.doc.bg)) < .35;
}
function renderPrint() {
  const d = S.doc, list = checks(), bad = list.filter(c => c[0] === 'bad').length, warn = list.length - bad;
  const keys = pageKeys();
  const errorsN = bad === 1 ? _t('1 Fehler') : _t('{n} Fehler', { n: bad }), notesN = warn === 1 ? _t('1 Hinweis') : _t('{n} Hinweise', { n: warn });
  $('#v-print').innerHTML = `<div class="print">
    <div style="display:grid;gap:16px;min-width:0">
      <section class="card"><header><h2>${_t('Prüfung')}</h2><p>${bad ? _t('{errors}, {notes}.', { errors: errorsN, notes: notesN }) : warn ? _t('Keine Fehler, {notes}.', { notes: notesN }) : _t('Keine Probleme gefunden.')} ${_t('Die Prüfung ersetzt nicht die Vorgaben der Druckerei.')}</p></header>
        ${list.some(c => c[3] && c[3].act === 'fixpage') ? `<div class="row"><button class="btn small primary" data-act="autodesign">${_t('Leere Rahmen überall füllen')}</button></div>` : ''}
        <ul class="checks">${list.length ? list.slice(0, 40).map(([lvl, msg, k, fix]) => `<li><span class="dot ${lvl}"></span><span>${k ? `<button data-act="jump" data-v="${k}">${esc(msg)}</button>` : esc(msg)}${fix ? ` <button class="btn small fixbtn" data-act="${fix.act}" data-v="${k}">${fix.label}</button>` : ''}</span></li>`).join('') : `<li><span class="dot"></span>${_t('Alle Rahmen gefüllt, Auflösung ausreichend, keine Fotos doppelt.')}</li>`}
        ${list.length > 40 ? `<li><span></span>${_t('… und {n} weitere', { n: list.length - 40 })}</li>` : ''}</ul></section>
      ${SVC.pid ? printCard() : ''}
      <section class="card"><header><h2>${_t('PDF-Entwurf')}</h2><p>${SVC.pid ? _t('Eine Datei mit allen Seiten in Druckreihenfolge. Zum Ansehen und Probedrucken; für die Druckerei das Druck-PDF oben nehmen.') : _t('Eine Datei mit allen Seiten in Druckreihenfolge. Zum Ansehen und Probedrucken, noch nicht nach den Vorgaben einer Druckerei geprüft.')}</p></header>
        <p>${_t(d.duplex ? '{sheets} Blätter, {pages} Seiten, {w} × {h} cm, beidseitig.' : '{sheets} Blätter, {pages} Seiten, {w} × {h} cm.', { sheets: allSheets().length, pages: keys.length, w: fmt1(d.w / 10), h: fmt1(d.h / 10) })}</p>
        <div class="field"><label for="dpi">${_t('Qualität')}</label><select id="dpi" data-bind="doc.dpi">
          ${[[300, _t('Für den Druck (300 dpi)')], [200, _t('Kleinere Datei (200 dpi)')], [100, _t('Schnelle Vorschau (100 dpi)')]].map(([v, l]) => `<option value="${v}" ${d.dpi == v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        <details class="specs-box"><summary>${_t('Technische Angaben für die Druckerei')}</summary>
        <dl class="specs"><dt>${_t('Endformat')}</dt><dd>${fmt1(d.w)} × ${fmt1(d.h)} mm</dd><dt>${_t('Mit Beschnitt')}</dt><dd>${_t('{w} × {h} mm ({b} mm Rand, der beim Schneiden wegfällt)', { w: fmt1(d.w + 2 * d.bleed), h: fmt1(d.h + 2 * d.bleed), b: fmt1(d.bleed) })}</dd>
          <dt>${_t('Farben')}</dt><dd>${_t('CMYK, einfache Umrechnung ohne ICC-Profil')}</dd><dt>${_t('Schrift')}</dt><dd>${_t('Jost, eingebettet, Text als Vektor')}</dd>
          <dt>${_t('Transparenz')}</dt><dd>${_t('keine (Flächen werden eingerechnet)')}</dd><dt>${_t('Fehlt noch')}</dt><dd>${_t('ICC-Ausgabeprofil, PDF/X, Druckerei-Profil')}</dd></dl>
        <div class="field"><label for="jq">${_t('JPEG-Qualität')}</label><select id="jq" data-bind="doc.quality">
          ${[[95, _t('Sehr hoch')], [90, _t('Hoch')], [80, _t('Mittel')]].map(([v, l]) => `<option value="${v}" ${d.quality == v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        <label class="check"><input type="checkbox" id="crm" data-bind="doc.cropMarks" ${d.cropMarks ? 'checked' : ''}><span>${_t('Schnittmarken')}<span class="hint">${_t('Nur wenn die Druckerei sie verlangt.')}</span></span></label>
        </details>
        <button class="btn ${SVC.pid ? '' : 'primary'}" data-act="export">${_t('PDF-Entwurf erstellen')}</button>
        <div id="exportOut"></div>
        <p class="hint">${_t('Die Farben werden ohne ICC-Profil nach CMYK umgerechnet, Schwarz wird reines K.')} ${SVC.pid ? _t('Farbverbindlich ist das Druck-PDF.') : _t('Farbverbindlich wird es erst mit dem Profil der Druckerei: Dafür Lichtjahr mit dem lokalen Dienst starten (siehe README), dann gibt es hier das Druck-PDF als PDF/X-1a.')}</p>
      </section>
    </div>
    <section class="card"><header class="lt-head"><div><h2>${_t('Leuchttisch')}</h2><p>${ui.ltMode === 'sheets' ? _t('Die Druckbogen in Druckreihenfolge, Vorder- und Rückseite nebeneinander.') : _t('So sieht der Kalender aufgehängt aus, mit Lochung und Aufhänger.')}</p></div><button class="btn small" data-act="wall">${_t('An der Wand ansehen')}</button></header>
      ${seg([['views', _t('Monatsansichten')], ['sheets', _t('Druckbogen')]], ui.ltMode || 'views', 'ltmode')}
      <div class="lighttable">${ui.ltMode === 'sheets' ? sheetCards() : viewCards()}</div></section>
  </div>`;
}

// Was beim Aufhängen zusammen zu sehen ist
function viewGroups() {
  const mode = viewModeOf(), groups = [];
  for (const k of pageKeys()) {
    const v = viewOf(k);
    if (v.part === 'upper' || v.part === 'altB') continue;
    if (v.part === 'back' && mode !== 'free') continue;            // nur im Druckbogen
    if (v.part === 'lower') { const up = partnerOf(k); groups.push({ label: MONTHS[v.month], keys: up ? [up, k] : [k], dir: 'col' }); continue; }
    if (mode === 'alternative' && v.part === 'front') { groups.push({ label: _t('{month}, Motiv A und B', { month: MONTHS[v.month] }), keys: [k, k + '-b'], dir: 'row' }); continue; }
    groups.push({ label: pageLabel(k), keys: [k], dir: 'col' });
  }
  return groups;
}
const ltSvg = (k) => `<button class="lt-page" data-act="jump" data-v="${k}" aria-label="${esc(pageLabel(k))}">${svgPage(S.pages[k], { mode: 'thumb', showBind: true })}</button>`;
function viewCards() {
  return viewGroups().map(g => `<div class="lt-group ${g.dir}"><div class="lt-pages">${g.keys.map(ltSvg).join('')}</div><span>${esc(g.label)}</span></div>`).join('');
}
function sheetCards() {
  let n = 0;
  return allSheets().map((sh, i) => `<div class="lt-group row"><div class="lt-pages">${[sh.front, sh.back].filter(Boolean).map(ltSvg).join('')}</div>
    <span>${_t('Blatt {n}: {pages}', { n: i + 1, pages: [sh.front, sh.back].filter(Boolean).map(k => _t('S. {n} {page}', { n: ++n, page: esc(pageShort(k)) })).join(' · ') })}</span></div>`).join('');
}

const ICON = {
  undo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg>',
  redo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/></svg>',
  left: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>',
  right: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>',
};
