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
  if (path === 'doc.w' || path === 'doc.h') { if (!final) return; v = clamp(v, 100, 600); }
  if (path === 'doc.year') { if (!final) return; v = clamp(Math.round(v), 2000, 2100); const cv = S.pages.cover; if (cv && cv.title && cv.title.sub === String(S.doc.year)) cv.title.sub = String(v); }
  setPath(path, v);
  const out = el.parentElement.querySelector('output');
  if (out) out.textContent = fmt1(v) + (path.endsWith('size') ? '×' : ' mm');
  const structural = /doc\.(cover|index|backs|format|bind\.cut|backRotate)/.test(path);
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
  if (el.dataset.bind) { if (el.type === 'range' || el.type === 'text') onBind(el, false); return; }
  if (el.dataset.photoCap) {
    const ph = S.photos[el.dataset.photoCap]; if (ph) { ph.caption = el.value; clearTimeout(onBind._c); onBind._c = setTimeout(() => { commit(); if (curPage().layout === 'index') refresh(); }, 600); }
    return;
  }
  const act = el.dataset.actInput;
  if (act === 'zoom') {
    const p = curPage(), sl = p.slots[ui.sel], r = slotRects(p).find(r => r.i === ui.sel), ph = S.photos[sl.photo];
    const c = { x: r.x + r.w / 2, y: r.y + r.h / 2 };
    zoomAt(r, ph, sl, parseFloat(el.value), c);
    el.parentElement.querySelector('output').textContent = Math.round(sl.zoom * 100) + ' %';
    renderEditor(); clearTimeout(onBind._z); onBind._z = setTimeout(() => { commit(); updateThumb(); renderFrameBarMeta(); }, 400);
  }
  if (act === 'ovsize') {
    const p = curPage(), L = layoutById(p.layout), base = L.ov[ui.sel - L.slots.length];
    const o = p.ov[ui.sel] ||= { x: base[0], y: base[1] }; o.s = parseFloat(el.value);
    renderEditor(); clearTimeout(onBind._o); onBind._o = setTimeout(() => { commit(); updateThumb(); }, 400);
  }
});
function renderFrameBarMeta() { const fb = $('#frameBar'); if (fb && document.activeElement && fb.contains(document.activeElement)) return; renderFrameBar(); }
document.addEventListener('change', (e) => {
  const el = e.target;
  if (el.dataset.bind) { onBind(el, true); return; }
  const act = el.dataset.actChange;
  if (act === 'pool') { ui.pool = el.value; renderPanel(); }
  if (act === 'moveto' && el.value !== '') {
    for (const id of ui.photoSel) if (S.photos[id]) { S.photos[id].month = +el.value; S.photos[id].src = 'von Hand'; }
    toast(`${ui.photoSel.size} Fotos nach ${+el.value < 0 ? '„Ohne Monat“' : MONTHS[+el.value]} verschoben.`);
    ui.photoSel.clear(); commit(); renderPhotos();
  }
});

const ACTIONS = {
  go: (el) => setView(el.dataset.v),
  format: (el) => {
    const f = FORMATS.find(f => f.id === el.dataset.v); S.doc.format = f.id;
    if (f.w) { S.doc.w = f.w; S.doc.h = f.h; }
    commit(); renderAll();
  },
  bg: (el) => { S.doc.bg = el.dataset.v; commit(); renderAll(); },
  defstyle: (el) => { S.doc.cal.style = el.dataset.v; commit(); renderAll(); },
  defhi: (el) => { S.doc.cal.hi = el.dataset.v; commit(); renderAll(); },
  page: (el) => { ui.page = el.dataset.v; ui.sel = null; ui.swapFrom = null; ui.pool = null; renderDesign(); },
  prevpage: () => { const k = pageKeys(), i = k.indexOf(ui.page); if (i > 0) ACTIONS.page({ dataset: { v: k[i - 1] } }); },
  nextpage: () => { const k = pageKeys(), i = k.indexOf(ui.page); if (i < k.length - 1) ACTIONS.page({ dataset: { v: k[i + 1] } }); },
  jump: (el) => { ui.page = el.dataset.v; setView('design'); },
  tg: (el) => { ui[el.dataset.v] = !ui[el.dataset.v]; renderStage(); },
  tab: (el) => { ui.tab = el.dataset.v; renderPanel(); },
  layout: (el) => {
    const p = curPage(); p.layout = el.dataset.v;
    while (p.slots.length < slotCount(p.layout)) p.slots.push(newSlot());
    for (const s of p.slots) { s.zoom = 1; s.cx = .5; s.cy = .5; }
    ui.sel = null; commit(); renderStage(); renderPanel(); updateThumb();
  },
  autofill: () => { const n = autoFill(ui.page); commit(); renderDesign(); toast(n ? `${n} Fotos eingesetzt.` : 'Keine passenden freien Fotos für diesen Monat.'); },
  clearpage: () => { for (const s of curPage().slots) Object.assign(s, newSlot()); ui.sel = null; commit(); renderDesign(); },
  calstyle: (el) => { (curPage().cal ||= {}).style = el.dataset.v; commit(); refresh(); renderPanel(); },
  calcolor: (el) => { curPage().cal.color = el.dataset.v; commit(); refresh(); renderPanel(); },
  calpanel: (el) => { curPage().cal.panel = el.dataset.v; commit(); refresh(); renderPanel(); },
  calhi: (el) => { curPage().cal.hi = el.dataset.v; commit(); refresh(); renderPanel(); },
  calreset: () => { const p = curPage(), st = calSettings(p).style; if (p.cal.pos) delete p.cal.pos[st]; commit(); refresh(); renderPanel(); },
  caldefault: () => {
    const p = curPage(), st = calSettings(p).style, pos = p.cal.pos && p.cal.pos[st];
    if (pos) { S.doc.cal.def[st] = { ...pos }; delete p.cal.pos[st]; }
    commit(); renderDesign(); toast('Standardposition übernommen. Seiten mit eigener Position bleiben, wie sie sind.');
  },
  calall: () => {
    const p = curPage(), c = calSettings(p);
    const keep = { style: c.style, size: c.size, color: c.color, panel: c.panel, hi: c.hi };
    Object.assign(S.doc.cal, keep);
    for (const k of pageKeys()) if (pageMonth(k) != null && !isBack(k)) { const pc = S.pages[k].cal || {}; S.pages[k].cal = pc.pos ? { pos: pc.pos } : {}; }
    commit(); renderDesign(); toast('Für alle Monate übernommen.');
  },
  titlecolor: (el) => { curPage().title.color = el.dataset.v; commit(); refresh(); renderPanel(); },
  titlepanel: (el) => { curPage().title.panel = el.dataset.v; commit(); refresh(); renderPanel(); },
  fit: () => { const sl = curPage().slots[ui.sel]; Object.assign(sl, { zoom: 1, cx: .5, cy: .5 }); commit(); refresh(); },
  unslot: () => { Object.assign(curPage().slots[ui.sel], newSlot()); commit(); refresh(); renderPanelKeepScroll(); },
  swap: () => { ui.swapFrom = ui.sel; renderEditor(); renderFrameBar(); },
  swapcancel: () => { ui.swapFrom = null; renderEditor(); renderFrameBar(); },
  addfiles: () => $('#fileIn').click(),
  adddir: () => $('#dirIn').click(),
  cleardemo: async () => {
    for (const id of Object.keys(S.photos)) if (S.photos[id].demo) { delete S.photos[id]; DB.del('blobs', id); }
    for (const p of Object.values(S.pages)) for (const s of p.slots || []) if (s.photo && !S.photos[s.photo]) Object.assign(s, newSlot());
    S.demo = false; ui.photoSel.clear(); commit(); renderAll(); toast('Beispielbilder entfernt.');
  },
  fav: () => { const ids = [...ui.photoSel], on = !ids.every(id => S.photos[id].fav); ids.forEach(id => S.photos[id].fav = on); commit(); renderPhotos(); },
  delphotos: () => {
    if (!ui.confirmDel) { ui.confirmDel = true; renderPhotos(); setTimeout(() => { ui.confirmDel = false; if (ui.view === 'photos') renderPhotos(); }, 4000); return; }
    ui.confirmDel = false;
    for (const id of ui.photoSel) { delete S.photos[id]; DB.del('blobs', id); }
    for (const p of Object.values(S.pages)) for (const s of p.slots || []) if (s.photo && !S.photos[s.photo]) Object.assign(s, newSlot());
    ui.photoSel.clear(); commit(); renderPhotos();
  },
  clearsel: () => { ui.photoSel.clear(); renderPhotos(); },
  newdemo: async () => { await resetProject(true); },
  reset: async (el) => {
    if (el.dataset.sure !== '1') { el.dataset.sure = '1'; el.textContent = 'Wirklich alles löschen?'; setTimeout(() => { el.dataset.sure = ''; el.textContent = 'Leeres Projekt beginnen'; }, 4000); return; }
    await resetProject(false);
  },
  export: () => exportPDF(),
  savepdf: () => savePdf(),
  undo, redo,
  hidebanner: () => { ui.banner = false; renderAll(); },
  bannerphotos: () => { ui.banner = false; setView('photos'); },
};
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
  const rects = slotRects(p).filter(r => { const s = p.slots[r.i]; return !s.photo || !S.photos[s.photo]; }).sort((a, b) => b.w * b.h - a.w * a.h);
  let n = 0;
  for (const r of rects) {
    if (!cand.length) break;
    const want = r.w / r.h;
    cand.sort((a, b) => (b.fav - a.fav) * .6 + (Math.abs(Math.log(a.w / a.h / want)) - Math.abs(Math.log(b.w / b.h / want))));
    const ph = cand.shift(); used.add(ph.id);
    Object.assign(p.slots[r.i], { photo: ph.id, zoom: 1, cx: .5, cy: .5 }); n++;
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
