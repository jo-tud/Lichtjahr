'use strict';
/* ---------- Grundlagen ---------- */
const MM = 72 / 25.4;
const MONTHS = ['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember'];
const MONTHS_SHORT = ['Jan','Feb','Mär','Apr','Mai','Jun','Jul','Aug','Sep','Okt','Nov','Dez'];
const WD2 = ['So','Mo','Di','Mi','Do','Fr','Sa'];
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const uid = () => Math.random().toString(36).slice(2, 10);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt1 = (v) => (Math.round(v * 10) / 10).toLocaleString('de-DE');
const sleep0 = () => new Promise(r => setTimeout(r, 0));

const FORMATS = [
  { id: 'sq297', name: 'Quadratisch', sub: '29,7 × 29,7 cm', w: 297, h: 297 },
  { id: 'a3l', name: 'DIN A3 quer', sub: '42 × 29,7 cm', w: 420, h: 297 },
  { id: 'sq30', name: 'Quadratisch', sub: '30 × 30 cm', w: 300, h: 300 },
  { id: 'sq21', name: 'Quadratisch', sub: '21 × 21 cm', w: 210, h: 210 },
  { id: 'a4l', name: 'DIN A4 quer', sub: '29,7 × 21 cm', w: 297, h: 210 },
  { id: 'a3p', name: 'DIN A3 hoch', sub: '29,7 × 42 cm', w: 297, h: 420 },
  { id: 'custom', name: 'Eigenes', sub: 'Maße frei', w: 0, h: 0 },
];

// Druckfarben: CMYK für das PDF, RGB nur als Bildschirmannäherung
const COLORS = {
  white:  { name: 'Weiß',        cmyk: [0, 0, 0, 0],        rgb: '#ffffff' },
  black:  { name: 'Schwarz',     cmyk: [0, 0, 0, 1],        rgb: '#1d1d1b' },
  gray:   { name: 'Grau',        cmyk: [0, 0, 0, .6],       rgb: '#878787' },
  red:    { name: 'Rot',         cmyk: [0, .9, .85, 0],     rgb: '#e2312f' },
  navy:   { name: 'Nachtblau',   cmyk: [1, .7, 0, .45],     rgb: '#1b3a5e' },
  forest: { name: 'Tannengrün',  cmyk: [.8, .2, .9, .45],   rgb: '#2e5a2e' },
  ochre:  { name: 'Ocker',       cmyk: [0, .35, .9, .1],    rgb: '#e0a11b' },
  sand:   { name: 'Sand',        cmyk: [0, .06, .18, .06],  rgb: '#f0e6d2' },
  rich:   { name: 'Tiefschwarz', cmyk: [.5, .4, .4, 1],     rgb: '#0e0e0e' },
};
const TEXT_COLORS = ['black', 'white', 'gray', 'navy', 'forest', 'red', 'ochre'];
const BG_COLORS = ['white', 'sand', 'gray', 'navy', 'forest', 'rich'];

const REGIONS = [
  ['none', 'Keine Feiertage'], ['DE', 'Nur bundesweite'], ['BW', 'Baden-Württemberg'], ['BY', 'Bayern'], ['BE', 'Berlin'],
  ['BB', 'Brandenburg'], ['HB', 'Bremen'], ['HH', 'Hamburg'], ['HE', 'Hessen'], ['MV', 'Mecklenburg-Vorpommern'],
  ['NI', 'Niedersachsen'], ['NW', 'Nordrhein-Westfalen'], ['RP', 'Rheinland-Pfalz'], ['SL', 'Saarland'], ['SN', 'Sachsen'],
  ['ST', 'Sachsen-Anhalt'], ['SH', 'Schleswig-Holstein'], ['TH', 'Thüringen'],
];

function easter(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25),
    g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4,
    l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451),
    month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(y, month - 1, day);
}
const _holCache = {};
function holidays(year, region) {
  const key = year + region;
  if (_holCache[key]) return _holCache[key];
  const map = new Map();
  if (region !== 'none') {
    const E = easter(year);
    const add = (d, name, regions) => { if (!regions || regions.includes(region)) map.set(`${d.getMonth()}-${d.getDate()}`, name); };
    const D = (m, d) => new Date(year, m, d);
    const R = (n) => new Date(E.getFullYear(), E.getMonth(), E.getDate() + n);
    add(D(0, 1), 'Neujahr');
    add(D(0, 6), 'Heilige Drei Könige', ['BW', 'BY', 'ST']);
    add(D(2, 8), 'Frauentag', ['BE', 'MV']);
    add(R(-2), 'Karfreitag');
    add(R(1), 'Ostermontag');
    add(D(4, 1), 'Tag der Arbeit');
    add(R(39), 'Christi Himmelfahrt');
    add(R(50), 'Pfingstmontag');
    add(R(60), 'Fronleichnam', ['BW', 'BY', 'HE', 'NW', 'RP', 'SL']);
    add(D(7, 15), 'Mariä Himmelfahrt', ['SL']);
    add(D(8, 20), 'Weltkindertag', ['TH']);
    add(D(9, 3), 'Tag der Deutschen Einheit');
    add(D(9, 31), 'Reformationstag', ['BB', 'HB', 'HH', 'MV', 'NI', 'SN', 'ST', 'SH', 'TH']);
    add(D(10, 1), 'Allerheiligen', ['BW', 'BY', 'NW', 'RP', 'SL']);
    const n22 = D(10, 22); add(new Date(year, 10, 22 - ((n22.getDay() + 4) % 7)), 'Buß- und Bettag', ['SN']);
    add(D(11, 25), '1. Weihnachtstag');
    add(D(11, 26), '2. Weihnachtstag');
  }
  return (_holCache[key] = map);
}
const daysIn = (y, m) => new Date(y, m + 1, 0).getDate();

/* ---------- Seitenlayouts (normiert auf die Bildfläche, x y b h) ---------- */
const LAYOUTS = [
  { id: 'full',    name: 'Vollbild',                slots: [[0, 0, 1, 1]] },
  { id: 'band',    name: 'Bild + Leiste unten',     slots: [[0, 0, 1, .8]] },
  { id: 'side',    name: 'Bild + Spalte rechts',    slots: [[0, 0, .76, 1]] },
  { id: 'cols2',   name: 'Zwei nebeneinander',      slots: [[0, 0, .5, 1], [.5, 0, .5, 1]] },
  { id: 'rows2',   name: 'Zwei übereinander',       slots: [[0, 0, 1, .5], [0, .5, 1, .5]] },
  { id: 'asym2',   name: 'Ein Drittel, zwei Drittel', slots: [[0, 0, .36, 1], [.36, 0, .64, 1]] },
  { id: 'bigL',    name: 'Groß links, zwei rechts', slots: [[0, 0, .62, 1], [.62, 0, .38, .5], [.62, .5, .38, .5]] },
  { id: 'bigR',    name: 'Zwei links, groß rechts', slots: [[0, 0, .38, .5], [0, .5, .38, .5], [.38, 0, .62, 1]] },
  { id: 'top2',    name: 'Groß oben, zwei unten',   slots: [[0, 0, 1, .62], [0, .62, .5, .38], [.5, .62, .5, .38]] },
  { id: 'cols3',   name: 'Drei Spalten',            slots: [[0, 0, 1 / 3, 1], [1 / 3, 0, 1 / 3, 1], [2 / 3, 0, 1 / 3, 1]] },
  { id: 'top3',    name: 'Groß oben, drei unten',   slots: [[0, 0, 1, .64], [0, .64, 1 / 3, .36], [1 / 3, .64, 1 / 3, .36], [2 / 3, .64, 1 / 3, .36]] },
  { id: 'grid4',   name: 'Vier im Raster',          slots: [[0, 0, .5, .5], [.5, 0, .5, .5], [0, .5, .5, .5], [.5, .5, .5, .5]] },
  { id: 'fullin',  name: 'Vollbild + Einleger',     slots: [[0, 0, 1, 1]], ov: [[.06, .5, .34, .38]] },
  { id: 'cols2in', name: 'Zwei + Einleger',         slots: [[0, 0, .5, 1], [.5, 0, .5, 1]], ov: [[.34, .27, .32, .42]] },
  { id: 'rows2in', name: 'Übereinander + Einleger', slots: [[0, 0, 1, .5], [0, .5, 1, .5]], ov: [[.6, .28, .32, .44]] },
  { id: 'blank',   name: 'Leere Seite',             slots: [] },
];
const layoutById = (id) => LAYOUTS.find(l => l.id === id) || LAYOUTS[0];
const slotCount = (id) => { const l = layoutById(id); return l.slots.length + (l.ov ? l.ov.length : 0); };

/* ---------- Zustand ---------- */
function defaultDoc() {
  return {
    year: new Date().getFullYear() + 1, format: 'sq297', w: 297, h: 297,
    bleed: 3, gap: 3, margin: 0, ovBorder: 3, bg: 'white',
    cover: true, index: true, duplex: false, viewMode: 'opened', viewCal: {}, extraSheets: [], backRotate: false, region: lastRegion(), cropMarks: false,
    bind: { type: 'wire31', cut: true, cutW: 40, cutD: 8, p: 8.47, hw: 4, hh: 3.2, cy: 5.5 },
    cal: { style: 'h', color: 'black', hi: 'red', panel: 'none', opacity: .85, size: 1, names: true, school: false, kw: false, bd: 'dot',
           def: { h: { ax: .5, ay: .955 }, v: { ax: .965, ay: .5 }, g: { ax: .95, ay: .95 } } },
    birthdays: [], indexBirthdays: true,
    indexTitle: 'Die Fotos des Jahres', indexMode: 'photos', indexThumbs: true, indexNums: true, indexText: '',
    dpi: 300, quality: 90,
  };
}
// Das zuletzt gewählte Bundesland gilt auch für neue Projekte
function lastRegion() { try { return localStorage.getItem('kw-region') || 'DE'; } catch (e) { return 'DE'; } }
let S = { doc: defaultDoc(), pages: {}, photos: {}, demo: false };
const RT = { thumb: {}, prev: {}, file: {} };     // Laufzeit: Bild-URLs und Originaldateien
const ui = {
  view: 'design', page: 'm0', sel: null, crop: null, selBlock: null, viewZoom: 1, tab: 'layout', armed: null, swapFrom: null, pool: null,
  showBleed: true, showBind: true, showGuides: true, showPartner: true, ltMode: 'views', photoSel: new Set(), photoFocus: null, banner: true,
};

/* ---------- Blätter, Druckseiten und Monatsansichten ----------
   Ein Blatt (Sheet) ist ein physisches Blatt Papier: Vorderseite und bei beidseitigem Druck Rückseite.
   Eine Monatsansicht ist, was beim Aufhängen zu sehen ist. Wie Rückseiten genutzt werden (doc.viewMode):
     'opened'      – aufgeklappt: oben die Rückseite des vorigen Blatts, unten die Vorderseite des Monats;
                     ein Kalendarium für beide zusammen (doc.viewCal[m]: 'lower' oder 'upper')
     'alternative' – Vorder- und Rückseite sind zwei Motive desselben Monats, jedes mit Kalendarium
     'free'        – Rückseiten sind zusätzliche Fotoseiten ohne Kalendarium
   Zusätzliche Blätter (doc.extraSheets): weiteres Motiv für einen Monat oder freies Blatt, eingefügt nach einem Blatt. */
const viewModeOf = (doc = S.doc) => doc.duplex ? (doc.viewMode || 'opened') : 'single';
function sheetList(doc = S.doc) {
  const out = [], extras = doc.extraSheets || [];
  const push = (sh) => {
    out.push(sh);
    for (const x of extras.filter(x => x.after === sh.id)) push({ id: x.id, role: x.month != null ? 'month' : 'blank', month: x.month ?? null, front: x.id, extra: true });
  };
  if (doc.cover || viewModeOf(doc) === 'opened') push({ id: 'cover', role: 'cover', month: null, front: 'cover' });
  for (let m = 0; m < 12; m++) push({ id: 'm' + m, role: 'month', month: m, front: 'm' + m });
  if (doc.duplex) for (const sh of out) sh.back = sh.front + '-b';
  return out;
}
// Alle Blätter einschließlich Register (dessen Umfang hängt vom Inhalt ab)
function allSheets(doc = S.doc) {
  const sh = sheetList(doc);
  if (doc.index) {
    const n = indexLayout().length;
    for (let i = 1; i <= n; i++) { const k = i === 1 ? 'index' : 'index-' + i; sh.push({ id: k, role: 'index', month: null, front: k, back: doc.duplex ? k + '-b' : undefined }); }
  }
  return sh;
}
const sideKeys = (sheets) => sheets.flatMap(s => s.back ? [s.front, s.back] : [s.front]);
// Seiten ohne Register; das Register hängt davon ab, welche Seiten es gibt
function baseKeys(doc = S.doc) { return sideKeys(sheetList(doc)); }
function pageKeys(doc = S.doc) {
  const keys = sideKeys(allSheets(doc));
  for (const k of keys) if (!S.pages[k]) S.pages[k] = fillSlots(newPage(k));   // z. B. eine neu nötige Registerseite
  return keys;
}
const isIndex = (key) => /^index(-\d+)?$/.test(key);
const indexNo = (key) => key === 'index' ? 1 : +key.split('-')[1];
const isBack = (key) => key.endsWith('-b');
const sheetOf = (key) => allSheets().find(s => s.front === key || s.back === key);

// Rolle jeder Seite in ihrer Monatsansicht: month, part, cal (trägt standardmäßig das Kalendarium)
function viewMap(doc = S.doc) {
  const map = {}, sheets = sheetList(doc), mode = viewModeOf(doc);
  sheets.forEach((sh, i) => {
    if (sh.role !== 'month') map[sh.front] = { month: null, part: sh.role };
    else if (mode === 'opened') map[sh.front] = { month: sh.month, part: 'lower', cal: (doc.viewCal || {})[sh.id] !== 'upper' };
    else map[sh.front] = { month: sh.month, part: sh.extra ? 'more' : 'front', cal: true };
    if (!sh.back) return;
    const next = sheets[i + 1];
    if (mode === 'opened' && next && next.role === 'month') map[sh.back] = { month: next.month, part: 'upper', cal: (doc.viewCal || {})[next.id] === 'upper', lower: next.front };
    else if (mode === 'alternative' && sh.role === 'month') map[sh.back] = { month: sh.month, part: 'altB', cal: true };
    else map[sh.back] = { month: mode === 'free' ? sh.month : null, part: 'back' };
  });
  return map;
}
const viewOf = (key) => viewMap()[key] || { month: null, part: isIndex(key) ? 'index' : 'back' };
function pageMonth(key) { return viewOf(key).month ?? null; }
// Partnerseite in der aufgeklappten Ansicht (oben ↔ unten)
function partnerOf(key) {
  const v = viewOf(key);
  if (v.part === 'upper') return v.lower;
  if (v.part === 'lower') { const m = viewMap(); return Object.keys(m).find(k => m[k].part === 'upper' && m[k].lower === key) || null; }
  return null;
}
function pageLabel(key) {
  if (isIndex(key)) return 'Bildregister' + (indexNo(key) > 1 ? ' ' + indexNo(key) : '');
  if (isBack(key) && isIndex(key.slice(0, -2))) return 'Rückseite Register';
  const v = viewOf(key), mn = v.month != null ? MONTHS[v.month] : '';
  switch (v.part) {
    case 'cover': return 'Titelblatt';
    case 'blank': return 'Freies Blatt';
    case 'lower': return `${mn} unten`;
    case 'upper': return `${mn} oben`;
    case 'more': return `${mn}, weiteres Motiv`;
    case 'altB': return `${mn}, Motiv B`;
    case 'front': return viewModeOf() === 'alternative' ? `${mn}, Motiv A` : mn;
    default: return 'Rückseite ' + pageLabel(key.slice(0, -2));
  }
}
function pageShort(key) {
  if (isIndex(key)) return 'Reg.' + (indexNo(key) > 1 ? ' ' + indexNo(key) : '');
  if (isBack(key) && isIndex(key.slice(0, -2))) return 'Reg. R';
  const v = viewOf(key), mn = v.month != null ? MONTHS_SHORT[v.month] : '';
  switch (v.part) {
    case 'cover': return 'Titel';
    case 'blank': return 'Frei';
    case 'lower': return `${mn} ↓`;
    case 'upper': return `${mn} ↑`;
    case 'more': return `${mn} +`;
    case 'altB': return `${mn} B`;
    case 'front': return viewModeOf() === 'alternative' ? `${mn} A` : mn;
    default: return pageShort(key.slice(0, -2)) + ' R';
  }
}
// Ein Rahmen: Foto mit Ausschnitt (zoom, cx/cy = Bildpunkt in der Rahmenmitte, rot = Bilddrehung, fit).
// Optional: box (eigene Lage in mm, dann gilt die Vorlage nicht mehr), z (Ebene), border (Rand in mm), hidden.
function newSlot() { return { photo: null, zoom: 1, cx: .5, cy: .5, rot: 0, fit: 'cover' }; }
// Vorlagenrahmen haben Zahlen als Schlüssel, zusätzliche Rahmen eine feste ID
const keyOf = (v) => /^\d+$/.test(String(v)) ? +v : String(v);
function slotOf(p, key) { return typeof key === 'number' ? p.slots[key] : (p.extra || []).find(s => s.id === key); }
function fillSlots(p) { if (p.layout !== 'index') while (p.slots.length < slotCount(p.layout)) p.slots.push(newSlot()); return p; }
function newPage(key) {
  const p = { key, layout: 'full', slots: [], ov: {}, cal: {} };
  if (isIndex(key)) p.layout = 'index';
  if (isBack(key) && isIndex(key.slice(0, -2))) p.layout = 'blank';   // Rückseite des Registers bleibt zunächst leer
  // Titel mit heller Fläche: lesbar auf Foto und auf leerem Papier
  if (key === 'cover') p.title = { text: 'Familienkalender', sub: String(S.doc.year), color: 'navy', size: 1, panel: 'light', opacity: .85, ax: .08, ay: .9 };
  return p;
}
function ensurePages() {
  for (const k of baseKeys()) if (!S.pages[k]) S.pages[k] = newPage(k);
  for (const k of pageKeys()) if (!S.pages[k]) S.pages[k] = newPage(k);
  for (const k of Object.keys(S.pages)) {
    fillSlots(S.pages[k]);
  }
  if (!pageKeys().includes(ui.page)) ui.page = pageKeys()[0];
}
const curPage = () => S.pages[ui.page];
function visibleSlots(p) { return p.layout === 'index' ? [] : p.slots.slice(0, slotCount(p.layout)).filter(s => !s.hidden).concat(p.extra || []); }
function usage() {
  const u = {};
  for (const k of pageKeys()) visibleSlots(S.pages[k]).forEach(s => { if (s.photo) (u[s.photo] ||= []).push(k); });
  return u;
}
// Kalendarium: Voreinstellung des Projekts, aus, wenn die Seite in ihrer Ansicht keins trägt, dann Werte der Seite
function calSettings(p) {
  const base = { ...S.doc.cal };
  if (!viewOf(p.key).cal) base.style = 'off';
  return { ...base, ...(p.cal || {}) };
}
// Kopien teilen sich die Bilddaten mit dem Original
const blobId = (ph) => ph.copyOf || ph.id;

/* ---------- Verlauf (Rückgängig) ---------- */
const hist = { past: [], future: [], last: null };
const snap = () => JSON.stringify({ doc: S.doc, pages: S.pages, photos: S.photos, demo: S.demo });
function commit() {
  ensurePages();          // z. B. neue Registerseiten
  const now = snap();
  if (now === hist.last) return;
  if (hist.last) { hist.past.push(hist.last); if (hist.past.length > 80) hist.past.shift(); }
  hist.future = []; hist.last = now;
  scheduleSave(); updateUndo();
}
// Unter dieser Auflösung warnt die App (Wandkalender werden aus etwas Abstand betrachtet)
const DPI_WARN = 150, DPI_BAD = 100;
function restore(json) {
  const o = JSON.parse(json);
  S.doc = o.doc; S.pages = o.pages; S.demo = o.demo;
  for (const id in o.photos) if (RT.thumb[id] || o.photos[id].demo != null) S.photos[id] = o.photos[id];
  for (const id in S.photos) if (!o.photos[id]) delete S.photos[id];
  ensurePages(); ui.sel = null; ui.crop = null; ui.selBlock = null;
}
// Rückgängig sichtbar machen: zur betroffenen Seite springen und sagen, was passiert ist
function changedWhere(aJson, bJson) {
  const a = JSON.parse(aJson), b = JSON.parse(bJson);
  for (const k of pageKeys()) if (JSON.stringify(a.pages[k]) !== JSON.stringify(b.pages[k])) return { page: k };
  if (JSON.stringify(a.photos) !== JSON.stringify(b.photos)) return { photos: true };
  return { doc: true };
}
function travel(dir) {
  const from = dir < 0 ? hist.past : hist.future, to = dir < 0 ? hist.future : hist.past;
  if (!from.length) return;
  const before = hist.last; to.push(before); hist.last = from.pop();
  restore(hist.last);
  const w = changedWhere(before, hist.last), word = dir < 0 ? 'Rückgängig gemacht' : 'Wiederholt';
  if (w.page && pageKeys().includes(w.page)) {
    if (ui.view !== 'design' && ui.view !== 'photos') ui.view = 'design';
    if (ui.view === 'design') ui.page = w.page;
    toast(`${word}: ${pageLabel(w.page)}`);
  } else toast(`${word}${w.photos ? ': Fotos' : ': Einstellungen'}`);
  renderAll(); scheduleSave(); updateUndo();
}
function undo() { travel(-1); }
function redo() { travel(1); }
function updateUndo() {
  const u = $('#undo'), r = $('#redo');
  if (u) u.disabled = !hist.past.length;
  if (r) r.disabled = !hist.future.length;
}

/* ---------- Speichern im Browser (IndexedDB) ---------- */
const DB = {
  db: null,
  async open() {
    try {
      this.db = await new Promise((res, rej) => {
        const r = indexedDB.open('kalenderwerkstatt', 1);
        r.onupgradeneeded = () => { r.result.createObjectStore('kv'); r.result.createObjectStore('blobs'); };
        r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
      });
    } catch (e) { this.db = null; }
  },
  tx(store, mode, fn) {
    if (!this.db) return Promise.resolve(null);
    return new Promise((res) => {
      try {
        const t = this.db.transaction(store, mode), st = t.objectStore(store), r = fn(st);
        t.oncomplete = () => res(r && 'result' in r ? r.result : null);
        t.onerror = t.onabort = () => res(null);
      } catch (e) { res(null); }
    });
  },
  get(store, key) { return this.tx(store, 'readonly', st => st.get(key)); },
  put(store, key, val) { return this.tx(store, 'readwrite', st => st.put(val, key)); },
  del(store, key) { return this.tx(store, 'readwrite', st => st.delete(key)); },
  keys(store) { return this.tx(store, 'readonly', st => st.getAllKeys()); },
};
let saveTimer = null;
function scheduleSave() {
  if (SVC.on) { scheduleServiceSave(); return; }      // Projektordner über den lokalen Dienst
  clearTimeout(saveTimer);
  const s = $('#saveState'); if (s) s.textContent = 'Ungespeichert …';
  saveTimer = setTimeout(async () => {
    const ok = await DB.put('kv', 'state', snap());
    // Die letzten Schritte überdauern das Neuladen, damit Rückgängig auch danach noch geht
    await DB.put('kv', 'hist', JSON.stringify(hist.past.slice(-15)));
    try { localStorage.setItem('kw-page', ui.page); } catch (e) { /* egal */ }
    if (s) s.textContent = DB.db ? 'Im Browser gespeichert' : 'Speichern nicht möglich';
    return ok;
  }, 700);
}
