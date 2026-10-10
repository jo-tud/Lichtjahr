/* ---------- Aktionen ---------- */
function setPath(path, val) {
  const parts = path.split('.');
  let o = parts[0] === 'doc' ? S.doc : parts[0] === 'page' ? curPage() : null;
  for (let i = 1; i < parts.length - 1; i++) { o[parts[i]] ||= {}; o = o[parts[i]]; }
  o[parts[parts.length - 1]] = val;
}
function getPath(path) {
  const parts = path.split('.');
  if (parts[0] === 'page' && parts[1] === 'cal') return calSettings(curPage())[parts[2]];
  let o = parts[0] === 'doc' ? S.doc : curPage();
  for (let i = 1; i < parts.length; i++) o = o == null ? o : o[parts[i]];
  return o;
}
// Was nach einer Änderung neu gezeichnet werden muss
function refresh(scope = 'page') {
  if (ui.view === 'design') {
    if (scope === 'all') renderDesign(); else { renderEditor(); renderFrameBar(); updateThumb(); }
  } else if (ui.view === 'project') {
    const pv = $('.prev-svg'); if (pv) pv.innerHTML = svgPage(curPage(), { mode: 'proof', showBind: true });
  }
}
function onBind(el, final) {
  const path = el.dataset.bind;
  let v = el.type === 'checkbox' ? el.checked : el.type === 'range' || el.type === 'number' || /dpi|quality/.test(path) ? parseFloat(el.value) : el.value;
  if (typeof v === 'number' && isNaN(v)) return;
  if (path === 'doc.w' || path === 'doc.h') { if (!final) return; v = clamp(v, 100, 600); scaleBoxes(path === 'doc.w' ? v / S.doc.w : 1, path === 'doc.h' ? v / S.doc.h : 1); }
  if (path === 'doc.year') { if (!final) return; v = clamp(Math.round(v), 2000, 2100); const cv = S.pages.cover; if (cv && cv.title && cv.title.sub === String(S.doc.year)) cv.title.sub = String(v); }
  setPath(path, v);
  if (path === 'doc.region') { try { localStorage.setItem('kw-region', v); } catch (e) { /* egal */ } }
  const out = el.parentElement.querySelector('output');
  if (out) out.textContent = fmt1(v * (+el.dataset.scale || 1)) + (el.dataset.unit ?? ' mm');
  const structural = /doc\.(cover|index|format|bind\.cut|bind\.type|backRotate)/.test(path);
  if (structural) ensurePages();
  if (final) {
    commit();
    if (structural || ui.view === 'print' || path === 'doc.year' || path === 'doc.region' || path === 'doc.w' || path === 'doc.h') { renderAll(); return; }
  }
  if (path.startsWith('doc.')) {
    if (ui.view === 'design') { renderEditor(); renderFrameBar(); if (final) renderStrip(); }
    else refresh();
  } else refresh();
}
document.addEventListener('input', (e) => {
  const el = e.target;
  if (el.dataset.bind) { if (el.type === 'range' || el.type === 'text' || el.tagName === 'TEXTAREA') onBind(el, false); return; }
  if (el.dataset.bd) { birthdayInput(el); return; }
  if (el.dataset.pageCap) {
    const pg = S.pages[el.dataset.pageCap]; if (pg) { pg.caption = el.value; clearTimeout(onBind._pc); onBind._pc = setTimeout(() => { commit(); if (isIndex(ui.page)) { refresh(); renderStrip(); } }, 600); }
    return;
  }
  if (el.dataset.photoCap) {
    const ph = S.photos[el.dataset.photoCap]; if (ph) { ph.caption = el.value; clearTimeout(onBind._c); onBind._c = setTimeout(() => { commit(); if (curPage().layout === 'index') refresh(); }, 600); }
    return;
  }
  const act = el.dataset.actInput;
  if (act === 'zoom') {
    const p = curPage(), sl = slotOf(p, ui.sel), r = rectOf(p, ui.sel), ph = S.photos[sl.photo];
    const c = { x: r.x + r.w / 2, y: r.y + r.h / 2 };
    zoomAt(r, ph, sl, parseFloat(el.value), c);
    el.parentElement.querySelector('output').textContent = Math.round(sl.zoom * 100) + ' %';
    const pill = $('#dpiPill'); if (pill) pill.outerHTML = dpiPill(ph, r, sl);
    renderEditor(); clearTimeout(onBind._z); onBind._z = setTimeout(() => { commit(); updateThumb(); renderFrameBarMeta(); }, 400);
  }
  if (act === 'rot') {
    const sl = slotOf(curPage(), ui.sel); sl.rot = parseFloat(el.value);
    el.parentElement.querySelector('output').textContent = fmt1(sl.rot) + '°';
    renderEditor(); clearTimeout(onBind._r); onBind._r = setTimeout(() => { commit(); updateThumb(); }, 400);
  }
  if (act === 'border') {
    const sl = slotOf(curPage(), ui.sel); sl.border = parseFloat(el.value);
    el.parentElement.querySelector('output').textContent = fmt1(sl.border) + ' mm';
    renderEditor(); clearTimeout(onBind._b); onBind._b = setTimeout(() => { commit(); updateThumb(); }, 400);
  }
  if (act === 'adj') {
    setAdjust(el.dataset.photo, { [el.dataset.k]: parseFloat(el.value) });
    el.parentElement.querySelector('output').textContent = adjFmt(parseFloat(el.value));
    renderEditor(); clearTimeout(onBind._a); onBind._a = setTimeout(() => { commit(); updateThumb(); const b = $('[data-act="adjreset"]'); if (b) b.disabled = !adjOf(el.dataset.photo); }, 400);
  }
  if (act === 'adjstrength') {
    setAdjust(el.dataset.photo, { strength: parseFloat(el.value) });
    el.parentElement.querySelector('output').textContent = Math.round(parseFloat(el.value) * 100) + ' %';
    renderEditor(); clearTimeout(onBind._s); onBind._s = setTimeout(() => { commit(); updateThumb(); }, 400);
  }
  if (act === 'pagegap') {
    curPage().gap = parseFloat(el.value);
    el.parentElement.querySelector('output').textContent = fmt1(curPage().gap) + ' mm';
    renderEditor(); clearTimeout(onBind._g); onBind._g = setTimeout(() => { commit(); updateThumb(); }, 400);
  }
});
function renderFrameBarMeta() { const fb = $('#frameBar'); if (fb && document.activeElement && fb.contains(document.activeElement)) return; renderFrameBar(); }
document.addEventListener('change', (e) => {
  const el = e.target;
  if (el.dataset.bind) { onBind(el, true); return; }
  const act = el.dataset.actChange;
  if (act === 'pool') { ui.pool = el.value; renderPanel(); }
  if (CHANGE_ACTIONS[act]) CHANGE_ACTIONS[act](el);
  if (act === 'moveto' && el.value !== '') moveToMonth([...ui.photoSel], +el.value).then(ok => { if (ok) ui.photoSel.clear(); renderPhotos(); });
});

const CHANGE_ACTIONS = {};   // weitere Auswahlfelder (z. B. Druckprofil), von anderen Teilen ergänzt
const ACTIONS = {
  go: (el) => setView(el.dataset.v),
  lang: (el) => setLang(el.dataset.v),
  format: async (el) => {
    const f = FORMATS.find(f => f.id === el.dataset.v);
    if (f.id === S.doc.format) return;
    const used = Object.keys(usage()).length;
    if (used && f.w && (f.w !== S.doc.w || f.h !== S.doc.h)) {
      const ok = await ask({ title: _t('Auf {format} wechseln?', { format: `${f.name} ${f.sub}` }),
        text: (used === 1 ? _t('Auf den Seiten steht 1 Foto.') : _t('Auf den Seiten stehen {n} Fotos.', { n: used })) + ' ' + _t('Rahmen und Kalendarium passen sich dem neuen Format an, Bildausschnitte bleiben so weit wie möglich erhalten. Danach die Seiten bitte einmal durchsehen. Rückgängig ist jederzeit möglich.'),
        buttons: [{ label: _t('Format wechseln'), value: true, primary: true }, { label: _t('Abbrechen'), value: false }] });
      if (!ok) return;
    }
    S.doc.format = f.id;
    if (f.w) { scaleBoxes(f.w / S.doc.w, f.h / S.doc.h); S.doc.w = f.w; S.doc.h = f.h; }
    ensurePages(); commit(); renderAll();
  },
  bg: (el) => { S.doc.bg = el.dataset.v; commit(); renderAll(); },
  defstyle: (el) => { S.doc.cal.style = el.dataset.v; commit(); renderAll(); },
  defhi: (el) => { S.doc.cal.hi = el.dataset.v; commit(); renderAll(); },
  page: (el) => { ui.page = el.dataset.v; ui.sel = null; ui.crop = null; ui.selBlock = null; ui.swapFrom = null; ui.pool = null; renderDesign(); },
  prevpage: () => { const k = pageKeys(), i = k.indexOf(ui.page); if (i > 0) ACTIONS.page({ dataset: { v: k[i - 1] } }); },
  nextpage: () => { const k = pageKeys(), i = k.indexOf(ui.page); if (i < k.length - 1) ACTIONS.page({ dataset: { v: k[i + 1] } }); },
  jump: (el) => { ui.page = el.dataset.v; setView('design'); },
  tg: (el) => { ui[el.dataset.v] = !ui[el.dataset.v]; renderStage(); },
  tab: (el) => { ui.tab = el.dataset.v; renderPanel(); },
  layout: (el) => {
    // neue leere Rahmen gleich mit freien Fotos des Monats füllen (siehe autoFill unten)
    // Neue Vorlage: eigene Lagen der Vorlagenrahmen entfallen, Fotos und Ausschnitte bleiben in ihrer Reihenfolge
    const p = curPage(), before = visibleSlots(p).filter(s => s.photo && S.photos[s.photo]).length;
    p.layout = el.dataset.v; delete p.ov;
    while (p.slots.length < slotCount(p.layout)) p.slots.push(newSlot());
    for (const s of p.slots) { delete s.box; delete s.hidden; delete s.z; delete s.border; }
    const after = visibleSlots(p).filter(s => s.photo && S.photos[s.photo]).length;
    const filled = autoFill(p.key);
    ui.sel = null; ui.crop = null; commit(); renderStage(); renderPanel(); updateThumb();
    if (filled) toast(filled > 1 ? _t('{n} freie Fotos des Monats eingesetzt.', { n: filled }) : _t('1 freies Foto des Monats eingesetzt.'));
    const lost = before - after;
    if (lost > 0) toast(lost > 1 ? _t('{n} Fotos haben im neuen Layout keinen Rahmen. Ein Wechsel zurück holt sie wieder.', { n: lost }) : _t('1 Foto hat im neuen Layout keinen Rahmen. Ein Wechsel zurück holt es wieder.'), 5000);
  },
  resetframes: () => {
    const p = curPage(); delete p.ov; p.extra = [];
    for (const s of p.slots) { delete s.box; delete s.hidden; delete s.z; delete s.border; }
    ui.sel = null; commit(); renderStage(); renderPanel(); updateThumb(); toast(_t('Rahmen stehen wieder wie in der Vorlage.'));
  },
  addframe: () => {
    const p = curPage(), W = S.doc.w, H = S.doc.h, w = Math.round(W * .32), h = Math.round(H * .32);
    const sl = { ...newSlot(), id: 'f' + uid(), box: { x: (W - w) / 2, y: (H - h) / 2, w, h } };
    (p.extra ||= []).push(sl);
    ui.sel = sl.id; ui.crop = null; commit(); renderStage(); updateThumb();
  },
  dupframe: () => {
    const p = curPage(), r = rectOf(p, ui.sel), src = slotOf(p, ui.sel);
    const sl = { ...newSlot(), id: 'f' + uid(), box: { x: r.x + 8, y: r.y + 8, w: r.w, h: r.h }, border: r.border };
    if (src.fit === 'contain') sl.fit = 'contain';
    (p.extra ||= []).push(sl);
    ui.sel = sl.id; commit(); renderStage(); updateThumb(); toast(_t('Leere Kopie des Rahmens angelegt.'));
  },
  front: () => { const p = curPage(), zs = slotRects(p).map(r => r.z); slotOf(p, ui.sel).z = Math.max(...zs) + 1; commit(); renderEditor(); updateThumb(); },
  back: () => { const p = curPage(), zs = slotRects(p).map(r => r.z); slotOf(p, ui.sel).z = Math.min(...zs) - 1; commit(); renderEditor(); updateThumb(); },
  delframe: () => {
    const p = curPage(), k = ui.sel;
    if (typeof k === 'number') Object.assign(p.slots[k], newSlot(), { hidden: true });
    else p.extra = p.extra.filter(s => s.id !== k);
    ui.sel = null; ui.crop = null; commit(); renderStage(); updateThumb(); renderPanelKeepScroll();
  },
  rot90: () => { const sl = slotOf(curPage(), ui.sel); sl.rot = (((sl.rot || 0) + 90 + 180) % 360) - 180; commit(); refresh(); },
  fitmode: (el) => { const sl = slotOf(curPage(), ui.sel); sl.fit = el.dataset.v; sl.zoom = 1; sl.cx = .5; sl.cy = .5; commit(); refresh(); },
  pagegapon: () => { const p = curPage(); if (p.gap == null) p.gap = S.doc.gap; else delete p.gap; commit(); refresh(); renderPanelKeepScroll(); },
  autofill: () => { const n = autoFill(ui.page); commit(); renderDesign(); toast(n > 1 ? _t('{n} Fotos eingesetzt.', { n }) : n ? _t('1 Foto eingesetzt.') : _t('Keine passenden freien Fotos für diesen Monat.')); },
  clearpage: () => { for (const s of visibleSlots(curPage())) Object.assign(s, newSlot()); ui.sel = null; ui.crop = null; commit(); renderDesign(); },
  calstyle: (el) => { (curPage().cal ||= {}).style = el.dataset.v; commit(); refresh(); renderPanel(); },
  calcolor: (el) => { curPage().cal.color = el.dataset.v; commit(); refresh(); renderPanel(); },
  calpanel: (el) => { curPage().cal.panel = el.dataset.v; commit(); refresh(); renderPanel(); },
  calhi: (el) => { curPage().cal.hi = el.dataset.v; commit(); refresh(); renderPanel(); },
  caldesign: (el) => { Object.assign(S.doc.cal, CAL_DESIGNS[el.dataset.v], { design: el.dataset.v }); calDesignChanged(); },
  caltitle: (el) => { S.doc.cal.title = el.dataset.v; calDesignChanged(); },
  calwd: (el) => { S.doc.cal.wd = +el.dataset.v; calDesignChanged(); },
  calweeks: (el) => { S.doc.cal.weeks = el.dataset.v; calDesignChanged(); },
  calnum: (el) => { S.doc.cal.num = el.dataset.v; calDesignChanged(); },
  calwidth: (el) => { S.doc.cal.width = el.dataset.v; calDesignChanged(); },
  calreset: () => { const p = curPage(), st = calSettings(p).style; if (p.cal.pos) delete p.cal.pos[st]; commit(); refresh(); renderPanel(); },
  caldefault: () => {
    const p = curPage(), st = calSettings(p).style, pos = p.cal.pos && p.cal.pos[st];
    if (pos) { S.doc.cal.def[st] = { ...pos }; delete p.cal.pos[st]; }
    commit(); renderDesign(); toast(_t('Standardposition übernommen. Seiten mit eigener Position bleiben, wie sie sind.'));
  },
  calall: () => {
    const p = curPage(), c = calSettings(p);
    const keep = { style: c.style, size: c.size, color: c.color, panel: c.panel, hi: c.hi };
    Object.assign(S.doc.cal, keep);
    for (const k of pageKeys()) if (viewOf(k).cal) { const pc = S.pages[k].cal || {}; S.pages[k].cal = pc.pos ? { pos: pc.pos } : {}; }
    commit(); renderDesign(); toast(_t('Für alle Monate übernommen.'));
  },
  titlecolor: (el) => { curPage().title.color = el.dataset.v; commit(); refresh(); renderPanel(); },
  titlepanel: (el) => { curPage().title.panel = el.dataset.v; commit(); refresh(); renderPanel(); },
  fit: () => { const sl = slotOf(curPage(), ui.sel); Object.assign(sl, { zoom: 1, cx: .5, cy: .5, rot: 0 }); commit(); refresh(); },
  unslot: () => { Object.assign(slotOf(curPage(), ui.sel), newSlot()); ui.crop = null; commit(); refresh(); renderPanelKeepScroll(); },
  swap: () => { ui.swapFrom = ui.sel; renderEditor(); renderFrameBar(); },
  swapcancel: () => { ui.swapFrom = null; renderEditor(); renderFrameBar(); },
  addfiles: () => $('#fileIn').click(),
  adddir: () => $('#dirIn').click(),
  cleardemo: async () => {
    // Bilddaten bleiben bis zum nächsten Laden erhalten, damit Rückgängig funktioniert.
    // Die Seiten des Beispiels werden zurückgesetzt, sonst blieben dessen Layouts mit leeren Rahmen stehen.
    for (const id of Object.keys(S.photos)) if (S.photos[id].demo) delete S.photos[id];
    S.pages = {}; S.doc.extraSheets = []; ensurePages();
    S.demo = false; ui.photoSel.clear(); ui.banner = false; commit(); renderAll();
    toast(Object.keys(S.photos).length ? _t('Beispiel entfernt. Mit „Kalender automatisch gestalten“ kommen deine Fotos auf die Seiten.') : _t('Beispiel entfernt. Jetzt eigene Fotos hinzufügen.'), 6000);
  },
  fav: () => { const ids = [...ui.photoSel], on = !ids.every(id => S.photos[id].fav); ids.forEach(id => S.photos[id].fav = on); commit(); renderPhotos(); },
  delphotos: async () => {
    const ids = [...ui.photoSel], u = usage(), used = ids.filter(id => u[id]);
    const pages = [...new Set(used.flatMap(id => u[id]))].map(pageLabel).join(', ');
    const onPages = !used.length ? ''
      : ids.length === 1 ? _t('Es steht auf Kalenderseiten ({pages}) und wird dort herausgenommen.', { pages })
      : used.length > 1 ? _t('{n} davon stehen auf Kalenderseiten ({pages}) und werden dort herausgenommen.', { n: used.length, pages })
      : _t('1 davon steht auf Kalenderseiten ({pages}) und wird dort herausgenommen.', { pages });
    const files = SVC.pid ? _t('Die Dateien auf deinem Rechner bleiben unberührt und lassen sich unter „Fotos“ wieder zurückholen.') : _t('Die Dateien auf deinem Rechner bleiben unberührt. Rückgängig ist möglich.');
    const ok = await ask({ title: ids.length > 1 ? _t('{n} Fotos aus dem Projekt entfernen?', { n: ids.length }) : _t('1 Foto aus dem Projekt entfernen?'),
      text: (onPages ? onPages + ' ' : '') + files,
      buttons: [{ label: _t('Entfernen'), value: true, primary: true }, { label: _t('Abbrechen'), value: false }] });
    if (!ok) return;
    for (const id of ids) delete S.photos[id];
    for (const p of Object.values(S.pages)) for (const s of [...(p.slots || []), ...(p.extra || [])]) if (s.photo && !S.photos[s.photo]) Object.assign(s, newSlot());
    ui.photoSel.clear(); commit(); renderPhotos();
  },
  clearsel: () => { ui.photoSel.clear(); renderPhotos(); },
  newdemo: async () => { await resetProject(true); },
  reset: async () => {
    const ok = await ask({ title: _t('Leeres Projekt beginnen?'), text: _t('Alle Seiten, Fotos und Einstellungen dieses Projekts werden aus dem Browser gelöscht. Das lässt sich nicht rückgängig machen. Deine Fotodateien auf dem Rechner bleiben unberührt.'),
      buttons: [{ label: _t('Alles löschen und neu beginnen'), value: true }, { label: _t('Abbrechen'), value: false, primary: true }] });
    if (ok) await resetProject(false);
  },
  export: async () => {
    const bad = checks().filter(c => c[0] === 'bad');
    if (bad.length) {
      const pages = [...new Set(bad.map(c => c[2]).filter(Boolean))];
      const r = await ask({ title: bad.length > 1 ? _t('{n} Probleme vor dem Export', { n: bad.length }) : _t('1 Problem vor dem Export'),
        text: _t('Betroffen: {pages}. Leere Rahmen bleiben im PDF weiß, zu kleine Fotos werden unscharf.', { pages: pages.map(pageLabel).join(', ') }),
        buttons: [...(pages.length ? [{ label: _t('Zu {page}', { page: pageLabel(pages[0]) }), value: 'go', primary: true }] : []), { label: _t('Trotzdem als Entwurf exportieren'), value: 'export' }, { label: _t('Abbrechen'), value: null }] });
      if (r === 'go') { ui.page = pages[0]; setView('design'); return; }
      if (r !== 'export') return;
    }
    exportPDF();
  },
  crop: () => { ui.tune = null; setCrop(ui.crop == null ? ui.sel : null); },
  tune: () => { ui.crop = null; ui.tune = ui.tune == null ? ui.sel : null; renderEditor(); renderFrameBar(); },
  adjauto: async (el) => {
    const id = el.dataset.v, on = !(S.doc.adjust && S.doc.adjust[id] && S.doc.adjust[id].auto);
    if (on && facesReady()) await loadFaces([id]);
    if (!(await setAuto(id, on))) { toast(_t('Das Foto lässt sich gerade nicht analysieren.')); return; }
    commit(); renderEditor(); renderFrameBar(); updateThumb();
  },
  adjall: async () => {
    const ids = Object.keys(usage()).filter(id => S.photos[id]);
    if (!ids.length) return;
    const bar = busy(_t('Fotos werden verbessert'), _t('Gesichter werden gesucht …'));
    if (facesReady()) await loadFaces(ids, bar);
    let n = 0;
    for (const id of ids) { bar.update(n / ids.length, _t('{n} von {total}', { n: n + 1, total: ids.length })); if (await setAuto(id, true)) n++; await sleep0(); }
    bar.close(); commit(); renderDesign();
    toast(n === 1 ? _t('1 Foto automatisch verbessert. Jedes lässt sich einzeln nachregeln.') : _t('{n} Fotos automatisch verbessert. Jedes lässt sich einzeln nachregeln.', { n }), 6000, { label: _t('Rückgängig'), fn: undo });
  },
  adjreset: (el) => { setAdjust(el.dataset.v, { ...Object.fromEntries(ADJ_KEYS.map(k => [k, 0])), auto: false }); commit(); renderEditor(); renderFrameBar(); updateThumb(); },
  vzoom: (el) => { ui.viewZoom = el.dataset.v === 'fit' ? 1 : clamp(ui.viewZoom * (el.dataset.v === 'in' ? 1.5 : 1 / 1.5), 1, 6); renderStage(); },
  savepdf: () => savePdf(),
  ixmode: (el) => { S.doc.indexMode = el.dataset.v; commit(); renderDesign(); },
  duplex: (el) => { S.doc.duplex = el.dataset.v === 'double'; ensurePages(); commit(); renderAll(); },
  viewmode: (el) => { S.doc.viewMode = el.dataset.v; ensurePages(); commit(); renderAll(); },
  addsheet: (el) => {
    // weiteres Motiv für den Monat dieser Seite oder freies Blatt, direkt nach dem aktuellen Blatt
    const sh = sheetOf(ui.page); if (!sh || sh.role === 'index') return;
    const m = el.dataset.v === 'month' ? pageMonth(ui.page) : null, id = 'x' + uid();
    (S.doc.extraSheets ||= []).push({ id, after: sh.id, month: m });
    ensurePages(); ui.page = id; ui.sel = null; commit(); renderAll();
    toast(m != null ? _t('Weiteres Motiv für {month} eingefügt.', { month: MONTHS[m] }) : _t('Freies Blatt eingefügt.'));
  },
  delsheet: async (el) => {
    const id = el.dataset.v || (sheetOf(ui.page) || {}).id, sh = sheetList().find(s => s.id === id);
    if (!sh || !sh.extra) return;
    const used = [sh.front, sh.back].filter(Boolean).flatMap(k => visibleSlots(S.pages[k] || { layout: 'index' })).filter(s => s.photo).length;
    if (used) {
      const ok = await ask({ title: _t('Blatt entfernen?'),
        text: used === 1 ? _t('Auf dem Blatt steht 1 Foto. Es bleibt im Fotopool erhalten. Rückgängig ist möglich.') : _t('Auf dem Blatt stehen {n} Fotos. Sie bleiben im Fotopool erhalten. Rückgängig ist möglich.', { n: used }),
        buttons: [{ label: _t('Entfernen'), value: true, primary: true }, { label: _t('Abbrechen'), value: false }] });
      if (!ok) return;
    }
    // Blätter, die nach diesem eingefügt waren, rücken an seine Stelle
    for (const x of S.doc.extraSheets) if (x.after === id) x.after = (S.doc.extraSheets.find(y => y.id === id) || {}).after;
    S.doc.extraSheets = S.doc.extraSheets.filter(x => x.id !== id);
    ensurePages(); commit(); renderAll();
  },
  viewcal: (el) => { const v = viewOf(ui.page), lower = v.part === 'upper' ? v.lower : ui.page; (S.doc.viewCal ||= {})[(sheetOf(lower) || {}).id] = el.dataset.v; commit(); renderDesign(); },
  ltmode: (el) => { ui.ltMode = el.dataset.v; renderPrint(); },
  wall: () => openWall(),
  addbd: () => { (S.doc.birthdays ||= []).push({ id: uid(), name: '', d: '', m: 1, y: '' }); commit(); renderProject(); const ins = $$('.bdrow input[data-f="name"]'); if (ins.length) ins[ins.length - 1].focus(); },
  delbd: (el) => { S.doc.birthdays = S.doc.birthdays.filter(b => b.id !== el.dataset.v); commit(); renderProject(); },
  bdmode: (el) => { S.doc.cal.bd = el.dataset.v; commit(); renderProject(); },
  placehere: () => placeHere(),
  placepage: (el) => placePage(el.dataset.v),
  placeall: () => placeAll(),
  undo, redo,
  hidebanner: () => { ui.banner = false; renderAll(); },
  bannerphotos: () => { $('#fileIn').click(); },                 // öffnet direkt die Dateiauswahl
  autodesign: () => autoDesign(),
  clearerr: () => { ui.importErrors = []; renderPhotos(); },
  bdquick: (el) => {
    const n = $('#bdqn').value.trim(), d = +$('#bdqd').value;
    if (!n || !(d >= 1 && d <= 31)) { toast(_t('Bitte Name und Tag eintragen.')); return; }
    (S.doc.birthdays ||= []).push({ id: uid(), name: n, d, m: +el.dataset.v, y: '' });
    commit(); refresh(); renderPanelKeepScroll(); toast(_t('Geburtstag von {name} eingetragen.', { name: n }));
  },
  fixpage: (el) => {
    const n = autoFill(el.dataset.v), page = pageLabel(el.dataset.v); commit(); renderAll();
    toast(n > 1 ? _t('{n} Fotos auf {page} eingesetzt.', { n, page }) : n ? _t('1 Foto auf {page} eingesetzt.', { page }) : _t('Für {page} gibt es keine freien Fotos mehr.', { page }));
  },
  vcf: () => $('#vcfIn').click(),
};
// Gestaltung gilt für alle Monate: Seitenleiste mit allen Vorschauen neu, Bedienfeld an derselben Stelle
function calDesignChanged() { commit(); renderStrip(); renderEditor(); renderFrameBar(); renderPanelKeepScroll(); }
document.addEventListener('toggle', (e) => { if (e.target.id === 'calDetails') ui.calDetails = e.target.open; }, true);
function renderPanelKeepScroll() { const b = $('#tabBody'), s = b ? b.scrollTop : 0; renderPanel(); if (b) $('#tabBody').scrollTop = s; }
document.addEventListener('click', (e) => {
  const a = e.target.closest('[data-act]');
  if (a && !a.disabled) { const f = ACTIONS[a.dataset.act]; if (f) f(a, e); return; }
  const t = e.target.closest('.thumb[data-photo]');
  if (t && e.detail === 0) photoTap(t.dataset.photo, e); // Tastatur
});

async function resetProject(demo) {
  for (const id of Object.keys(S.photos)) DB.del('blobs', id);
  for (const id in RT.prev) { URL.revokeObjectURL(RT.prev[id]); URL.revokeObjectURL(RT.thumb[id]); }
  RT.prev = {}; RT.thumb = {}; RT.file = {};
  S = { doc: defaultDoc(), pages: {}, photos: {}, demo: false };
  ui.page = 'm0'; ui.sel = null; ui.photoSel.clear(); ui.banner = true;
  hist.past = []; hist.future = []; hist.last = null;
  ensurePages();
  if (demo) await setupDemo();
  commit(); setView(demo ? 'design' : 'photos');
}

/* ---------- Fotos auf Seiten verteilen ---------- */
function autoFill(key, used = null) {
  const p = S.pages[key]; if (!p || p.layout === 'index') return 0;
  used ||= new Set(Object.keys(usage()));
  const m = pageMonth(key);
  let cand = Object.values(S.photos).filter(ph => !used.has(ph.id) && (m == null ? true : ph.month === m));
  if (m == null) cand.sort((a, b) => b.fav - a.fav);
  const rects = slotRects(p).filter(r => { const s = slotOf(p, r.i); return !s.photo || !S.photos[s.photo]; }).sort((a, b) => b.w * b.h - a.w * a.h);
  let n = 0;
  // Bewertung: Favorit, passendes Seitenverhältnis und vor allem genug Auflösung für den Rahmen
  const score = (ph, r) => {
    const d = dpiOf(ph, placeImage(r, ph, newSlot())), want = r.w / r.h;
    return (ph.fav ? .6 : 0) - Math.abs(Math.log(ph.w / ph.h / want)) - (d < DPI_BAD ? 3 : d < DPI_WARN ? 1 : 0);
  };
  for (const r of rects) {
    if (!cand.length) break;
    cand.sort((a, b) => score(b, r) - score(a, r));
    const ph = cand.shift(); used.add(ph.id);
    Object.assign(slotOf(p, r.i), { photo: ph.id, zoom: 1, cx: .5, cy: .5, rot: 0, fit: 'cover' }); n++;
    applyFaces(p, r.i);                                              // Gesichter im Ausschnitt halten (wenn schon bekannt)
  }
  return n;
}
async function setupDemo() {
  await makeDemoPhotos();
  S.demo = true;
  const plan = { cover: 'full', m0: 'full', m1: 'cols2in', m2: 'bigL', m3: 'band', m4: 'top2', m5: 'fullin', m6: 'side', m7: 'asym2', m8: 'top3', m9: 'full', m10: 'rows2', m11: 'bigR' };
  for (const k in plan) if (S.pages[k]) { S.pages[k].layout = plan[k]; while (S.pages[k].slots.length < slotCount(plan[k])) S.pages[k].slots.push(newSlot()); }
  S.pages.m6.cal = { style: 'v' };
  S.pages.m4.cal = { style: 'g', panel: 'light', pos: { g: { ax: .95, ay: .06 } } };
  S.pages.m9.cal = { color: 'white', panel: 'dark' };
  S.pages.m7.cal = { color: 'white', pos: { h: { ax: .5, ay: .05 } } };
  if (S.pages.cover) Object.assign(S.pages.cover.title, { color: 'navy', panel: 'light', ax: .5, ay: .12 });
  const used = new Set();
  for (let m = 0; m < 12; m++) autoFill('m' + m, used);
  autoFill('cover', used);
}

/* ---------- Rückfragen (statt confirm(), das im Artefakt nicht erscheint) ---------- */
function ask({ title, text, buttons }) {
  return new Promise((resolve) => {
    const el = document.createElement('div'); el.className = 'busy'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true');
    el.innerHTML = `<div class="card"><h2>${esc(title)}</h2><p class="hint">${esc(text)}</p><div class="row">${buttons.map((b, i) => `<button class="btn ${b.primary ? 'primary' : ''}" data-i="${i}">${esc(b.label)}</button>`).join('')}</div></div>`;
    const done = (v) => { document.removeEventListener('keydown', key, true); el.remove(); resolve(v); };
    const key = (e) => { if (e.key === 'Escape') { e.stopPropagation(); done(buttons[buttons.length - 1].value); } };
    el.addEventListener('click', (e) => { const b = e.target.closest('[data-i]'); if (b) done(buttons[+b.dataset.i].value); });
    document.addEventListener('keydown', key, true);
    document.body.appendChild(el);
    (el.querySelector('.btn.primary') || el.querySelector('.btn')).focus();
  });
}

/* ---------- Jedes Foto gehört genau einem Monat ---------- */
// Seiten anderer Monate, auf denen das Foto steht (Titel und Register zählen nicht)
const usedInOtherMonths = (id, m) => (usage()[id] || []).filter(k => pageMonth(k) != null && pageMonth(k) !== m);
function clearPhotoFrom(id, keys) {
  for (const k of keys) for (const s of visibleSlots(S.pages[k])) if (s.photo === id) Object.assign(s, newSlot());
}
function copyPhoto(id, m) {
  const ph = S.photos[id], nid = uid();
  S.photos[nid] = { ...ph, id: nid, copyOf: blobId(ph), month: m, src: 'Kopie', fav: false };
  RT.prev[nid] = RT.prev[id]; RT.thumb[nid] = RT.thumb[id]; if (RT.file[id]) RT.file[nid] = RT.file[id];
  return S.photos[nid];
}
async function placePhoto(slot, id) {
  const p = curPage(), m = pageMonth(p.key), ph = S.photos[id];
  if (m == null || ph.month === m) { assignPhoto(slot, id); return; }
  const other = usedInOtherMonths(id, m), noMonth = ph.month < 0, from = noMonth ? '' : MONTHS[ph.month], to = MONTHS[m];
  if (!other.length) {
    ph.month = m; ph.src = 'von Hand';
    assignPhoto(slot, id);
    toast(noMonth ? _t('Foto nach {to} verschoben.', { to }) : _t('Foto von {from} nach {to} verschoben.', { from, to }));
    return;
  }
  const pages = other.map(pageLabel).join(', ');
  const r = await ask({ title: _t('Foto wird schon verwendet'),
    text: noMonth ? _t('Das Foto gehört zu keinem Monat und steht auf: {pages}. Jedes Foto gehört zu genau einem Monat.', { pages })
      : _t('Das Foto gehört zu {from} und steht auf: {pages}. Jedes Foto gehört zu genau einem Monat.', { from, pages }),
    buttons: [{ label: _t('Nach {month} verschieben, dort entfernen', { month: to }), value: 'move', primary: true }, { label: _t('Kopie für {month} anlegen', { month: to }), value: 'copy' }, { label: _t('Abbrechen'), value: null }] });
  if (r === 'move') { clearPhotoFrom(id, other); ph.month = m; ph.src = 'von Hand'; assignPhoto(slot, id); renderStrip(); }
  else if (r === 'copy') { const c = copyPhoto(id, m); assignPhoto(slot, c.id); }
}
async function moveToMonth(ids, m) {
  ids = ids.filter(id => S.photos[id] && S.photos[id].month !== m);
  if (!ids.length) return true;
  const conflicts = ids.filter(id => usedInOtherMonths(id, m).length);
  if (conflicts.length) {
    const pages = [...new Set(conflicts.flatMap(id => usedInOtherMonths(id, m)))];
    const many = conflicts.length > 1, list = pages.map(pageLabel).join(', ');
    const ok = await ask({ title: many ? _t('{n} Fotos stehen schon auf Seiten', { n: conflicts.length }) : _t('1 Foto steht schon auf Seiten'),
      text: many ? _t('Betroffen: {pages}. Beim Verschieben werden sie dort aus den Rahmen genommen.', { pages: list }) : _t('Betroffen: {pages}. Beim Verschieben wird es dort aus dem Rahmen genommen.', { pages: list }),
      buttons: [{ label: _t('Verschieben und dort entfernen'), value: true, primary: true }, { label: _t('Abbrechen'), value: false }] });
    if (!ok) return false;
    for (const id of conflicts) clearPhotoFrom(id, usedInOtherMonths(id, m));
  }
  for (const id of ids) { S.photos[id].month = m; S.photos[id].src = 'von Hand'; }
  commit(); if (ui.view === 'photos') renderPhotos();
  const to = m < 0 ? _t('„Ohne Monat“') : MONTHS[m];
  toast(ids.length > 1 ? _t('{n} Fotos nach {to} verschoben.', { n: ids.length, to }) : _t('1 Foto nach {to} verschoben.', { to }));
  return true;
}

// Beim Formatwechsel wandern frei gesetzte Rahmen anteilig mit
function scaleBoxes(fx, fy) {
  if (fx === 1 && fy === 1) return;
  for (const p of Object.values(S.pages)) for (const sl of [...(p.slots || []), ...(p.extra || [])]) if (sl.box) {
    const b = sl.box; sl.box = { x: b.x * fx, y: b.y * fy, w: b.w * fx, h: b.h * fy };
  }
}

function birthdayInput(el) {
  const b = (S.doc.birthdays || []).find(x => x.id === el.dataset.bd); if (!b) return;
  b[el.dataset.f] = el.value;
  clearTimeout(birthdayInput._t); birthdayInput._t = setTimeout(() => { commit(); refresh(); }, 500);
}

/* ---------- Kalender automatisch gestalten ----------
   Für jede Monatsseite ohne Fotos ein Layout passend zu den freien Fotos des Monats wählen, Rahmen füllen,
   leere Rahmen anderer Seiten füllen und die Kalendarien an ruhige Stellen setzen. Seiten mit Fotos bleiben. */
function layoutFor(photos, m) {
  const n = photos.length, land = photos.filter(p => p.w >= p.h).length;
  if (n >= 4) return ['bigL', 'top3', 'bigR', 'top2'][m % 4];
  if (n === 3) return ['bigL', 'top2', 'bigR'][m % 3];
  if (n === 2) return land === 2 ? 'rows2' : land === 0 ? 'cols2' : 'asym2';
  return 'full';
}
async function autoDesign() {
  const keys = pageKeys().filter(k => S.pages[k] && S.pages[k].layout !== 'index' && S.pages[k].layout !== 'blank');
  if (!Object.keys(S.photos).length) { toast(_t('Zuerst Fotos hinzufügen, dann gestaltet die App den Kalender.')); setView('photos'); return; }
  if (facesReady()) {                                               // Gesichter vorher kennen, dann sitzen die Ausschnitte gleich
    const fb = busy(_t('Kalender wird gestaltet'), _t('Gesichter werden gesucht …'));
    if (FACES.loading) await FACES.loading;
    await loadFaces(Object.keys(S.photos), fb); fb.close();
  }
  const used = new Set(Object.keys(usage()));
  let pages = 0, photos = 0;
  for (const k of keys) {
    const p = S.pages[k], m = pageMonth(k), has = visibleSlots(p).some(s => s.photo && S.photos[s.photo]);
    if (!has && m != null) {
      const free = Object.values(S.photos).filter(ph => ph.month === m && !used.has(ph.id) && ph.w * ph.h > 1.5e6);
      if (!free.length) continue;
      p.layout = layoutFor(free.slice(0, 4), m); delete p.ov; p.extra = [];
      p.slots = []; fillSlots(p); pages++;
    }
    photos += autoFill(k, used);
  }
  if (!photos && !pages) { toast(_t('Alle Rahmen sind schon gefüllt oder es gibt keine freien Fotos mehr.')); return; }
  const bar = busy(_t('Kalender wird gestaltet'), _t('Kalendarien suchen ruhige Stellen …'));
  const calKeys = keys.filter(k => pageMonth(k) != null && calSettings(S.pages[k]).style !== 'off');
  let i = 0;
  for (const k of calKeys) { const s = await suggestPlacement(k, { tryStyles: false }); if (s) applyPlacement(S.pages[k], s); bar.update(++i / calKeys.length); }
  bar.close();
  commit(); setView('design');
  const msg = pages
    ? (photos === 1 ? _t('1 Foto auf {pages} neu gestaltete und weitere Seiten verteilt, Kalendarien an ruhige Stellen gesetzt.', { pages })
      : _t('{n} Fotos auf {pages} neu gestaltete und weitere Seiten verteilt, Kalendarien an ruhige Stellen gesetzt.', { n: photos, pages }))
    : (photos === 1 ? _t('1 Foto auf Seiten verteilt, Kalendarien an ruhige Stellen gesetzt.')
      : _t('{n} Fotos auf Seiten verteilt, Kalendarien an ruhige Stellen gesetzt.', { n: photos }));
  toast(msg, 6000, { label: _t('Rückgängig'), fn: undo });
}

// Vergleichen: solange gedrückt, das Bild ohne Anpassung zeigen
const compareOff = () => { if (ui.adjCompare) { ui.adjCompare = false; renderEditor(); } };
document.addEventListener('pointerdown', (e) => { if (e.target.closest('[data-hold="compare"]')) { ui.adjCompare = true; renderEditor(); } });
document.addEventListener('pointerup', compareOff);
document.addEventListener('pointercancel', compareOff);
document.addEventListener('keydown', (e) => { if ((e.key === ' ' || e.key === 'Enter') && e.target.closest && e.target.closest('[data-hold="compare"]') && !ui.adjCompare) { ui.adjCompare = true; renderEditor(); } });
document.addEventListener('keyup', (e) => { if (e.key === ' ' || e.key === 'Enter') compareOff(); });
