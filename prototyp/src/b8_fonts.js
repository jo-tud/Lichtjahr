/* ---------- Schriften: Überschriften und Kalendarium/Texte ----------
   Zwei Plätze (S.doc.fonts.head und .text), jeweils null = Jost oder { id, family, files: { regular, bold } }.
   Der Kalender setzt Text selbst: Breiten kommen aus der Schrift (FONTS[…].widths), eingebettet wird sie als
   TrueType mit WinAnsi-Kodierung. Schlüssel der Textstücke: 'regular'/'bold' für Kalendarium und Texte,
   'hregular'/'hbold' für Überschriften (Monatsname, Titel). Im Editor heißen die Familien CalText und CalHead.

   Woher die Dateien kommen: mit dem Dienst aus dem Projektordner (.lichtjahr/fonts, auch Google Fonts landen
   dort), ohne Dienst aus dem Browser-Speicher (nur eigene TrueType-Dateien). */
const JOST = { regular: FONTS.regular, bold: FONTS.bold };
FONTS.hregular = FONTS.regular; FONTS.hbold = FONTS.bold;
const FONTSTATE = { sig: 'null', loading: null, bytes: {}, faces: [], warned: {}, loaded: { text: null, head: null } };
const FONT_SLOTS = { head: ['hregular', 'hbold'], text: ['regular', 'bold'] };
const fontSig = () => JSON.stringify(S.doc.fonts || null);
const fontFamilyOf = (slot) => { const f = (S.doc.fonts || {})[slot]; return f ? f.family : 'Jost'; };
const isHeadFont = (key) => key === 'hregular' || key === 'hbold';
const isBoldFont = (key) => key === 'bold' || key === 'hbold';
// SVG-Attribute eines Textstücks: Familie und Strichstärke
const fontAttrs = (key) => `font-family="${isHeadFont(key) ? 'CalHead' : 'CalText'},sans-serif" font-weight="${isBoldFont(key) ? 600 : 400}"`;

/* ----- TrueType lesen: Breiten für WinAnsi, Kennzahlen fürs PDF, fehlende Zeichen, Einbett-Recht ----- */
const WINANSI_UNI = (() => {
  const back = Object.fromEntries(Object.entries(CP1252).map(([u, c]) => [c, +u]));
  return Array.from({ length: 224 }, (_, i) => { const c = i + 32; return c >= 0x80 && c <= 0x9F ? back[c] || 0 : c; });
})();
const FONT_NEEDED = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789ÄÖÜäöüß.,:;-–()/';
function parseTTF(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const tag = (o) => String.fromCharCode(u8[o], u8[o + 1], u8[o + 2], u8[o + 3]);
  const u16 = (o) => dv.getUint16(o), s16 = (o) => dv.getInt16(o), u32 = (o) => dv.getUint32(o);
  if (u8.length < 12) throw new Error('format');
  const ver = u32(0);
  if (tag(0) === 'OTTO') throw new Error('cff');
  if (tag(0) === 'wOFF' || tag(0) === 'wOF2') throw new Error('woff');
  if (ver !== 0x00010000 && tag(0) !== 'true') throw new Error('format');
  const T = {};
  for (let i = 0, n = u16(4); i < n; i++) { const o = 12 + i * 16; T[tag(o)] = u32(o + 8); }
  if (T.glyf == null || T.head == null || T.hhea == null || T.hmtx == null || T.cmap == null) throw new Error('format');
  const upm = u16(T.head + 18), k = 1000 / upm, sc = (v) => Math.round(v * k);
  const nHM = u16(T.hhea + 34), adv = (g) => u16(T.hmtx + 4 * Math.min(g, nHM - 1));
  // Zeichenzuordnung: Unicode-Tabelle (Format 12 oder 4)
  let sub = null, best = -1;
  for (let i = 0, n = u16(T.cmap + 2); i < n; i++) {
    const p = u16(T.cmap + 4 + i * 8), e = u16(T.cmap + 6 + i * 8), o = T.cmap + u32(T.cmap + 8 + i * 8), f = u16(o);
    const score = p === 3 && e === 10 && f === 12 ? 4 : p === 0 && f === 12 ? 3 : p === 3 && e === 1 && f === 4 ? 2 : p === 0 && f === 4 ? 1 : -1;
    if (score > best) { best = score; sub = o; }
  }
  if (sub == null || best < 0) throw new Error('format');
  const glyph = u16(sub) === 12 ? (u) => {
    for (let i = 0, n = u32(sub + 12); i < n; i++) { const o = sub + 16 + i * 12, a = u32(o), b = u32(o + 4); if (u >= a && u <= b) return u32(o + 8) + (u - a); }
    return 0;
  } : (u) => {
    const seg = u16(sub + 6) / 2, ends = sub + 14, starts = ends + seg * 2 + 2, deltas = starts + seg * 2, ranges = deltas + seg * 2;
    for (let i = 0; i < seg; i++) {
      if (u > u16(ends + 2 * i)) continue;
      const start = u16(starts + 2 * i); if (u < start) return 0;
      const delta = u16(deltas + 2 * i), ro = u16(ranges + 2 * i);
      if (!ro) return (u + delta) & 0xFFFF;
      const g = u16(ranges + 2 * i + ro + 2 * (u - start));
      return g ? (g + delta) & 0xFFFF : 0;
    }
    return 0;
  };
  const widths = WINANSI_UNI.map(u => sc(adv(u ? glyph(u) : 0)));
  // Namen (PostScript-Name fürs PDF, Familie für die Anzeige)
  const names = {};
  if (T.name != null) {
    const strs = T.name + u16(T.name + 4);
    for (let i = 0, n = u16(T.name + 2); i < n; i++) {
      const o = T.name + 6 + i * 12, p = u16(o), id = u16(o + 6), len = u16(o + 8), off = strs + u16(o + 10);
      if (names[id] && p !== 3) continue;
      let s = '';
      if (p === 3 || p === 0) for (let j = 0; j + 1 < len; j += 2) s += String.fromCharCode(u16(off + j));
      else for (let j = 0; j < len; j++) s += String.fromCharCode(u8[off + j]);
      names[id] = s;
    }
  }
  let fsType = 0, cap = null, ascent = s16(T.hhea + 4), descent = s16(T.hhea + 6);
  if (T['OS/2'] != null) {
    const o = T['OS/2'], v = u16(o);
    fsType = u16(o + 8);
    if (v >= 2) cap = s16(o + 88);
  }
  const ps = (names[6] || names[4] || names[1] || 'Schrift').replace(/[^A-Za-z0-9-]/g, '') || 'Schrift';
  return { ps, family: (names[16] || names[1] || '').trim(), widths, fsType,
    bbox: [s16(T.head + 36), s16(T.head + 38), s16(T.head + 40), s16(T.head + 42)].map(sc),
    ascent: sc(ascent), descent: sc(descent), cap: sc(cap ?? ascent * .7),
    missing: [...FONT_NEEDED].filter(ch => !glyph(ch.codePointAt(0))), bytes: u8 };
}
function b64of(u8) {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}
function fontMetrics(bytes) {
  const m = parseTTF(bytes);
  if ((m.fsType & 0x000F) === 0x0002) throw new Error('license');
  return { ...m, b64: b64of(m.bytes) };
}
function fontErrorText(e) {
  return e.message === 'cff' ? _t('Diese Datei hat PostScript-Umrisse (OpenType/CFF). Ohne den lokalen Dienst gehen nur TrueType-Dateien (.ttf); mit dem Dienst wird sie umgewandelt.')
    : e.message === 'woff' ? _t('Webschriften (WOFF) gehen ohne den lokalen Dienst nicht. Bitte die TTF-Datei nehmen.')
    : e.message === 'license' ? _t('Die Lizenz dieser Schrift erlaubt nicht, sie in ein PDF einzubetten.')
    : e.message && !/^(format)$/.test(e.message) ? e.message : _t('Keine lesbare Schriftdatei (TrueType, OpenType oder WOFF erwartet).');
}

/* ----- Laden und anwenden ----- */
async function fontBytes(name) {
  if (FONTSTATE.bytes[name]) return FONTSTATE.bytes[name];
  let buf;
  if (SVC.pid) {
    const r = await fetch(`api/${PP(`/fonts/${encodeURIComponent(name)}`)}`, { headers: SVC.token ? { Authorization: 'Bearer ' + SVC.token } : {} });
    if (!r.ok) throw new Error(_t('Die Schriftdatei fehlt im Projektordner.'));
    buf = await r.arrayBuffer();
  } else {
    const blob = await DB.get('blobs', 'font:' + name);
    if (!blob) throw new Error(_t('Die Schriftdatei fehlt in diesem Browser.'));
    buf = await blob.arrayBuffer();
  }
  return (FONTSTATE.bytes[name] = new Uint8Array(buf));
}
async function loadSlot(ref) {
  if (!ref) return null;
  const reg = fontMetrics(await fontBytes(ref.files.regular));
  const bold = ref.files.bold ? fontMetrics(await fontBytes(ref.files.bold)) : reg;
  return { family: ref.family, regular: reg, bold };
}
// Schriften des Projekts laden, wenn sie sich geändert haben (Öffnen, Rückgängig, Stand der anderen Person …)
function ensureFonts() {
  const sig = fontSig();
  if (sig === FONTSTATE.sig || FONTSTATE.loading) return FONTSTATE.loading || Promise.resolve();
  FONTSTATE.loading = (async () => {
    const fonts = S.doc.fonts || {}, got = {};
    for (const slot of ['text', 'head']) {
      try { got[slot] = await loadSlot(fonts[slot]); }
      catch (e) {
        got[slot] = null;
        const key = slot + ':' + (fonts[slot] && fonts[slot].family);
        if (!FONTSTATE.warned[key]) { FONTSTATE.warned[key] = true; toast(_t('Schrift „{family}“ konnte nicht geladen werden, ersatzweise Jost: {error}', { family: fonts[slot].family, error: fontErrorText(e) }), 8000); }
      }
    }
    FONTSTATE.loaded = got; FONTSTATE.sig = sig;
    applyFonts();
  })().finally(() => { FONTSTATE.loading = null; if (fontSig() !== FONTSTATE.sig) ensureFonts(); else if (document.body.dataset.view) renderAll(); });
  return FONTSTATE.loading;
}
// Geladene (oder zur Vorschau gewählte) Schriften in FONTS eintragen und für den Editor registrieren
function applyFonts(preview = null) {
  for (const slot of ['text', 'head']) {
    const f = (preview && preview.slot === slot ? preview.font : FONTSTATE.loaded[slot]) || JOST;
    const [r, b] = FONT_SLOTS[slot];
    FONTS[r] = f.regular; FONTS[b] = f.bold;
  }
  DIGIT_ADV = {};
  for (const face of FONTSTATE.faces) document.fonts.delete(face);
  FONTSTATE.faces = [];
  for (const [fam, r, b] of [['CalText', 'regular', 'bold'], ['CalHead', 'hregular', 'hbold']]) {
    for (const [key, w] of [[r, '400'], [b, '600']]) {
      const bin = FONTS[key].bytes || (FONTS[key].bytes = b64bytes(FONTS[key].b64));
      try { const face = new FontFace(fam, bin, { weight: w }); document.fonts.add(face); FONTSTATE.faces.push(face); face.load().catch(() => {}); } catch (e) { /* ältere Browser */ }
    }
  }
}
// Für Prüfung und Export: welche Schriften eingebettet werden
function fontNames() {
  const t = fontFamilyOf('text'), h = fontFamilyOf('head');
  return t === h ? t : `${h} / ${t}`;
}

/* ----- Auswahl ----- */
const FONTPICK = { slot: 'head', tab: 'project', q: '', cat: '', list: null, pick: null, busy: false, project: null };
async function projectFontList() {
  if (SVC.pid) { try { return (await api(PP('/fonts'))).fonts; } catch (e) { return []; } }
  try { return JSON.parse(await DB.get('kv', 'fonts') || '[]'); } catch (e) { return []; }
}
async function openFontPicker(slot) {
  Object.assign(FONTPICK, { slot, tab: 'project', q: '', cat: '', pick: null, busy: false, project: await projectFontList() });
  const el = document.createElement('div'); el.className = 'busy'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true');
  el.innerHTML = `<div class="card font-card"></div>`;
  document.body.appendChild(el); FONTPICK.el = el;
  el.addEventListener('click', fontPickClick);
  el.addEventListener('input', (e) => { if (e.target.id === 'fontq') { FONTPICK.q = e.target.value; drawFontList(); } });
  el.addEventListener('change', (e) => { if (e.target.id === 'fontfile') fontUpload(e.target); });
  document.addEventListener('keydown', fontPickKey, true);
  drawFontPicker();
}
function fontPickKey(e) { if (e.key === 'Escape' && FONTPICK.el) { e.stopPropagation(); closeFontPicker(false); } }
function closeFontPicker(apply) {
  if (!FONTPICK.el) return;
  document.removeEventListener('keydown', fontPickKey, true);
  FONTPICK.el.remove(); FONTPICK.el = null;
  if (!apply) { applyFonts(); renderAll(); }
}
const FONT_CATS = () => [['', _t('Alle')], ['Serif', _t('Serifen')], ['Sans Serif', _t('Serifenlos')], ['Display', _t('Auffällig')], ['Handwriting', _t('Handschrift')], ['Monospace', _t('Schreibmaschine')]];
function drawFontPicker() {
  const P = FONTPICK, card = P.el.querySelector('.font-card');
  const tabs = [['project', _t('Im Projekt')], ['google', 'Google Fonts'], ['upload', _t('Eigene Datei')]];
  card.innerHTML = `<header><h2>${P.slot === 'head' ? _t('Schrift für Überschriften') : _t('Schrift für Kalendarium und Texte')}</h2>
      <p>${P.slot === 'head' ? _t('Titel, Monatsnamen und Überschriften im Register.') : _t('Tageszahlen, Wochentage, Feiertage, Bildtexte.')}</p></header>
    <div class="seg font-tabs" role="tablist">${tabs.map(([v, l]) => `<button role="tab" aria-pressed="${P.tab === v}" data-fp="tab" data-v="${v}">${l}</button>`).join('')}</div>
    <div class="font-body"><div class="font-left">${fontTab()}</div>
      <div class="font-right"><div class="font-prev" aria-hidden="true">${svgPage(curPage(), { mode: 'thumb' })}</div>
        <p class="font-sample" style="font-family:${P.slot === 'head' ? 'CalHead' : 'CalText'},sans-serif"><b>${esc(MONTH_NAMES[calLang()][pageMonth(ui.page) ?? 0])} ${S.doc.year}</b><br>1 2 3 4 5 6 7 · ÄÖÜ äöü ß</p>
        <p class="hint" id="fontinfo">${fontPickInfo()}</p></div></div>
    <div class="row"><button class="btn primary" data-fp="apply" ${P.pick && !P.busy ? '' : 'disabled'}>${_t('Übernehmen')}</button><button class="btn" data-fp="cancel">${_t('Abbrechen')}</button></div>`;
  if (P.tab === 'google') drawFontList();
}
function fontPickInfo() {
  const P = FONTPICK, p = P.pick;
  if (P.busy) return _t('Schrift wird geladen …');
  if (P.error) return `<span class="bad-text">${esc(P.error)}</span>`;
  if (!p) return _t('Eine Schrift wählen: Die Vorschau zeigt sie gleich auf dieser Seite.');
  const miss = p.font && [...new Set([...(p.font.regular.missing || []), ...(p.font.bold.missing || [])])];
  return esc(p.family) + (p.font && p.font.bold === p.font.regular ? ' · ' + _t('ohne fetten Schnitt') : '')
    + (miss && miss.length ? ` · <span class="bad-text">${esc(_t('Es fehlen Zeichen: {chars}', { chars: miss.join(' ') }))}</span>` : '');
}
function fontTab() {
  const P = FONTPICK, cur = (S.doc.fonts || {})[P.slot];
  if (P.tab === 'project') {
    const items = [{ id: '', family: 'Jost', note: _t('mitgeliefert') }, ...(P.project || []).map(f => ({ ...f, note: f.source === 'google' ? 'Google Fonts' : _t('eigene Datei') }))];
    return `<div class="font-list">${items.map(f => `<button class="font-item" data-fp="proj" data-v="${esc(f.id)}" aria-pressed="${P.pick ? P.pick.id === f.id : (cur ? cur.id : '') === f.id}"><b>${esc(f.family)}</b><span class="muted">${esc(f.note)}</span></button>`).join('')}</div>
      <p class="hint">${_t('Schriften im Projekt liegen im Projektordner und sind bei allen da, die mitarbeiten.')}</p>`;
  }
  if (P.tab === 'google') {
    if (!SVC.pid) return `<p class="hint">${_t('Google Fonts gibt es mit dem lokalen Dienst: Er lädt die Schrift und bereitet sie für den Druck auf. Ohne Dienst kannst du eigene TrueType-Dateien hochladen.')}</p>`;
    return `<input type="search" id="fontq" placeholder="${esc(_t('Schrift suchen'))}" value="${esc(P.q)}" aria-label="${esc(_t('Schrift suchen'))}">
      <div class="seg font-cats">${FONT_CATS().map(([v, l]) => `<button data-fp="cat" data-v="${v}" aria-pressed="${P.cat === v}">${l}</button>`).join('')}</div>
      <div class="font-list" id="fontlist"><p class="hint">${_t('Verzeichnis wird geladen …')}</p></div>
      <p class="hint">${_t('Freie Schriften von Google Fonts (meist SIL Open Font License). Der Dienst lädt nur die gewählte Schrift; ins Projekt kommt sie erst beim Übernehmen.')}</p>`;
  }
  return `<div class="field"><label for="fontfile">${_t('Schriftdatei')}</label><input type="file" id="fontfile" accept=".ttf,.otf,.woff,font/ttf,font/otf" multiple>
      <p class="hint">${SVC.pid ? _t('TTF, OTF oder WOFF. Eine Datei für den normalen Schnitt, optional eine zweite für den fetten; variable Schriften liefern beide. Nur Schriften, deren Lizenz das Einbetten erlaubt.') : _t('TrueType-Datei (.ttf). Eine Datei für den normalen Schnitt, optional eine zweite für den fetten. Nur Schriften, deren Lizenz das Einbetten erlaubt.')}</p></div>`;
}
async function drawFontList() {
  const P = FONTPICK, box = P.el && P.el.querySelector('#fontlist'); if (!box) return;
  if (!P.list) {
    try { P.list = (await api('fonts/google')).families; }
    catch (e) { box.innerHTML = `<p class="bad-text">${esc(e.message)}</p>`; return; }
  }
  const q = P.q.trim().toLowerCase(), hits = P.list.filter(f => (!P.cat || f.category === P.cat) && (!q || f.family.toLowerCase().includes(q)));
  box.innerHTML = hits.slice(0, 80).map(f => `<button class="font-item" data-fp="google" data-v="${esc(f.family)}" aria-pressed="${!!(P.pick && P.pick.google === f.family)}"><b>${esc(f.family)}</b><span class="muted">${esc((FONT_CATS().find(c => c[0] === f.category) || [0, f.category])[1])}</span></button>`).join('')
    + (hits.length > 80 ? `<p class="hint">${_t('{n} weitere – Suche eingrenzen.', { n: hits.length - 80 })}</p>` : !hits.length ? `<p class="hint">${_t('Keine Schrift gefunden.')}</p>` : '');
}
function showFontPreview() {
  const P = FONTPICK; if (!P.el) return;
  applyFonts(P.pick && P.pick.font ? { slot: P.slot, font: P.pick.font } : null);
  const pv = P.el.querySelector('.font-prev'); if (pv) pv.innerHTML = svgPage(curPage(), { mode: 'thumb' });
  P.el.querySelector('#fontinfo').innerHTML = fontPickInfo();
  P.el.querySelector('[data-fp="apply"]').disabled = !P.pick || P.busy;
  P.el.querySelectorAll('[data-fp="proj"],[data-fp="google"]').forEach(b => b.setAttribute('aria-pressed', !!(P.pick && (b.dataset.fp === 'google' ? P.pick.google === b.dataset.v : P.pick.id === b.dataset.v))));
}
async function fontPickClick(e) {
  const P = FONTPICK, b = e.target.closest('[data-fp]'); if (!b) return;
  const a = b.dataset.fp;
  if (a === 'cancel') return closeFontPicker(false);
  if (a === 'tab') { P.tab = b.dataset.v; drawFontPicker(); return; }
  if (a === 'cat') { P.cat = b.dataset.v; P.el.querySelectorAll('[data-fp="cat"]').forEach(x => x.setAttribute('aria-pressed', x.dataset.v === P.cat)); drawFontList(); return; }
  if (a === 'apply') return applyFontPick();
  const token = (P.token = (P.token || 0) + 1);
  P.error = null;
  if (a === 'proj') {
    const ref = (P.project || []).find(f => f.id === b.dataset.v);
    P.pick = { id: b.dataset.v, family: ref ? ref.family : 'Jost', ref: ref || null, font: null };
    if (ref) { P.busy = true; showFontPreview(); try { P.pick.font = await loadSlot(ref); } catch (err) { P.error = fontErrorText(err); } }
    else P.pick.font = JOST;
  } else if (a === 'google') {
    P.pick = { google: b.dataset.v, family: b.dataset.v, font: null }; P.busy = true; showFontPreview();
    try {
      const info = await api(`fonts/google/${encodeURIComponent(b.dataset.v)}`), get = async (u) => new Uint8Array(await (await fetch(u + (SVC.token ? '?token=' + encodeURIComponent(SVC.token) : ''))).arrayBuffer());
      const reg = fontMetrics(await get(info.urls.regular));
      P.pick.font = { family: info.family, regular: reg, bold: info.urls.bold ? fontMetrics(await get(info.urls.bold)) : reg };
    } catch (err) { P.error = fontErrorText(err); P.pick.font = null; }
  }
  if (token !== P.token) return;                 // inzwischen eine andere Schrift gewählt
  P.busy = false; showFontPreview();
}
// Eigene Datei: mit dem Dienst gleich aufbereiten und ins Projekt; ohne Dienst im Browser prüfen und merken
async function fontUpload(input) {
  const P = FONTPICK, files = [...input.files]; if (!files.length) return;
  P.error = null; P.busy = true; P.pick = { family: files[0].name, font: null }; showFontPreview();
  try {
    if (SVC.pid) {
      const fd = new FormData(); fd.append('regular', files[0], files[0].name); if (files[1]) fd.append('bold', files[1], files[1].name);
      const ref = await serial(() => api(PP('/fonts'), { method: 'POST', form: fd }));
      FONTPICK.project = await projectFontList();
      P.pick = { id: ref.id, family: ref.family, ref, font: await loadSlot(ref) };
    } else {
      const bufs = await Promise.all(files.slice(0, 2).map(f => f.arrayBuffer()));
      const reg = fontMetrics(bufs[0]), bold = bufs[1] ? fontMetrics(bufs[1]) : reg;
      const id = 'local-' + (reg.family || files[0].name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50);
      P.pick = { id, family: reg.family || files[0].name.replace(/\.[^.]+$/, ''), font: { family: reg.family, regular: reg, bold }, local: bufs };
    }
  } catch (err) { P.error = fontErrorText(err); P.pick = null; }
  P.busy = false; showFontPreview();
}
async function applyFontPick() {
  const P = FONTPICK, p = P.pick; if (!p || P.busy) return;
  let ref = p.ref || null;
  try {
    if (p.google) {
      P.busy = true; showFontPreview();
      const fd = new FormData(); fd.append('google', p.google);
      ref = await serial(() => api(PP('/fonts'), { method: 'POST', form: fd }));
    } else if (p.local) {
      const files = { regular: `${p.id}-regular.ttf` };
      if (p.local[1]) files.bold = `${p.id}-bold.ttf`;
      await DB.put('blobs', 'font:' + files.regular, new Blob([p.local[0]]));
      if (p.local[1]) await DB.put('blobs', 'font:' + files.bold, new Blob([p.local[1]]));
      ref = { id: p.id, family: p.family, source: 'local', files };
      const list = (await projectFontList()).filter(f => f.id !== p.id).concat([ref]);
      await DB.put('kv', 'fonts', JSON.stringify(list));
    }
  } catch (err) { P.busy = false; P.error = fontErrorText(err); showFontPreview(); return; }
  S.doc.fonts = { ...(S.doc.fonts || {}), [P.slot]: ref ? { id: ref.id, family: ref.family, files: ref.files } : null };
  if (ref) for (const [cut, name] of Object.entries(ref.files)) if (p.font) FONTSTATE.bytes[name] = p.font[cut === 'bold' ? 'bold' : 'regular'].bytes;
  closeFontPicker(true);
  commit(); await ensureFonts(); renderAll();
  toast(_t('Schrift für {slot}: {family}', { slot: P.slot === 'head' ? _t('Überschriften') : _t('Kalendarium und Texte'), family: ref ? ref.family : 'Jost' }));
}
// Zeile im Bedienfeld: aktuelle Schrift, in ihr selbst gesetzt, mit „Ändern“
const fontRow = (slot) => `<div class="field font-row"><span class="lbl">${slot === 'head' ? _t('Überschriften') : _t('Kalendarium und Texte')}</span>
  <button class="btn font-btn" data-act="fontpick" data-v="${slot}"><span style="font-family:${slot === 'head' ? 'CalHead' : 'CalText'},sans-serif;font-weight:${slot === 'head' ? 600 : 400}">${esc(fontFamilyOf(slot))}</span><span class="muted">${_t('Ändern …')}</span></button></div>`;
ACTIONS.fontpick = (el) => openFontPicker(el.dataset.v);

// Vorschläge: Überschrift und Text, die gut zusammenpassen (alle von Google Fonts, frei lizenziert)
const FONT_PAIRS = [['Playfair Display', 'Lato'], ['Montserrat', 'Inter'], ['Lora', 'Source Sans 3'], ['Caveat', 'Nunito'], ['DM Serif Display', 'DM Sans']];
const fontPairs = () => !SVC.pid ? '' : `<div class="field"><span class="lbl">${_t('Passende Paare')}</span><div class="font-pairs">
  ${FONT_PAIRS.map(([h, t]) => `<button class="btn small" data-act="fontpair" data-v="${esc(h)}|${esc(t)}" aria-pressed="${fontFamilyOf('head') === h && fontFamilyOf('text') === t}">${esc(h)} · ${esc(t)}</button>`).join('')}
  <button class="btn small" data-act="fontpair" data-v="" aria-pressed="${!(S.doc.fonts || {}).head && !(S.doc.fonts || {}).text}">Jost</button></div>
  <p class="hint">${_t('Überschrift · Text. Ein Klick lädt beide Schriften und setzt sie im ganzen Kalender.')}</p></div>`;
ACTIONS.fontpair = async (el) => {
  const [h, t] = el.dataset.v ? el.dataset.v.split('|') : [null, null], bar = h ? busy(_t('Schriften werden geladen'), `${h} · ${t}`) : null;
  try {
    const add = async (family) => { const fd = new FormData(); fd.append('google', family); const r = await serial(() => api(PP('/fonts'), { method: 'POST', form: fd })); return { id: r.id, family: r.family, files: r.files }; };
    S.doc.fonts = h ? { head: await add(h), text: await add(t) } : { head: null, text: null };
  } catch (e) { if (bar) bar.close(); toast(e.message, 7000); return; }
  if (bar) bar.close();
  commit(); await ensureFonts(); renderAll();
  toast(h ? _t('Schriften: {head} für Überschriften, {text} für Kalendarium und Texte.', { head: h, text: t }) : _t('Wieder Jost für alles.'));
};
