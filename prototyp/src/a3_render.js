/* ---------- Geometrie (alles in mm, Ursprung = Endformat oben links) ---------- */
// Rahmen der Vorlage; Abstand der Seite (falls gesetzt) oder der globale
function templateRects(p, doc) {
  const L = layoutById(p.layout), W = doc.w, H = doc.h, b = doc.bleed, m = doc.margin, g = p.gap ?? doc.gap;
  const cw = W - 2 * m, ch = H - 2 * m, X = (u) => m + u * cw, Y = (v) => m + v * ch, e = 1e-6;
  const out = [];
  L.slots.forEach(([x, y, w, h], i) => {
    const x0 = x < e ? (m > 0 ? m : -b) : X(x) + g / 2;
    const x1 = x + w > 1 - e ? (m > 0 ? W - m : W + b) : X(x + w) - g / 2;
    const y0 = y < e ? (m > 0 ? m : -b) : Y(y) + g / 2;
    const y1 = y + h > 1 - e ? (m > 0 ? H - m : H + b) : Y(y + h) - g / 2;
    out.push({ i, x: x0, y: y0, w: x1 - x0, h: y1 - y0, overlay: false });
  });
  (L.ov || []).forEach(([x, y, w, h], j) => {
    const i = L.slots.length + j, o = (p.ov || {})[i] || {}, s = o.s ?? 1;
    out.push({ i, x: X(o.x ?? x), y: Y(o.y ?? y), w: w * cw * s, h: h * ch * s, overlay: true });
  });
  return out;
}
// Alle sichtbaren Rahmen einer Seite, nach Ebene sortiert (unten zuerst)
function slotRects(p, doc = S.doc) {
  if (p.layout === 'index') return [];
  const out = [];
  for (const r of templateRects(p, doc)) {
    const sl = p.slots[r.i] || {};
    if (sl.hidden) continue;
    out.push({ ...r, ...(sl.box || {}), custom: !!sl.box, border: sl.border ?? (r.overlay ? doc.ovBorder : 0), z: sl.z ?? (r.overlay ? 50 + r.i : r.i) });
  }
  (p.extra || []).forEach((sl, j) => out.push({ i: sl.id, ...sl.box, overlay: true, extra: true, custom: true, border: sl.border ?? doc.ovBorder, z: sl.z ?? 100 + j }));
  return out.sort((a, b) => a.z - b.z);
}
const rectOf = (p, key) => slotRects(p).find(r => r.i === key);
// Lage des Fotos im Rahmen. Füllen (cover): das gedrehte Foto deckt den Rahmen immer ganz ab.
// Ganz zeigen (contain): das Foto passt hinein, der Rest zeigt den Hintergrund.
function placeImage(r, ph, sl) {
  const rot = sl.rot || 0, th = rot * Math.PI / 180, c = Math.abs(Math.cos(th)), s = Math.abs(Math.sin(th));
  const bw = r.w * c + r.h * s, bh = r.w * s + r.h * c;   // Rahmen, gesehen im Koordinatensystem des Fotos
  const contain = sl.fit === 'contain';
  const k = (contain ? Math.min(r.w / ph.w, r.h / ph.h) : Math.max(bw / ph.w, bh / ph.h)) * (sl.zoom || 1);
  const dw = ph.w * k, dh = ph.h * k;
  let cx = sl.cx ?? .5, cy = sl.cy ?? .5;
  if (contain) { cx = clamp(cx, 0, 1); cy = clamp(cy, 0, 1); }
  else { const ex = Math.min(.5, bw / 2 / dw), ey = Math.min(.5, bh / 2 / dh); cx = clamp(cx, ex, 1 - ex); cy = clamp(cy, ey, 1 - ey); }
  const fx = r.x + r.w / 2, fy = r.y + r.h / 2;
  return { x: fx - cx * dw, y: fy - cy * dh, w: dw, h: dh, fx, fy, cx, cy, rot };
}
// effektive Auflösung eines Fotos im Rahmen
const dpiOf = (ph, place) => ph.w / (place.w / 25.4);

/* ---------- Text ---------- */
const T = (x, y, text, font, size, fill, anchor = 'start') => ({ t: 'text', x, y, text, font, size, fill, anchor });
function wrap(text, font, size, maxW) {
  const words = String(text).split(/\s+/).filter(Boolean), lines = []; let cur = '';
  for (const w of words) {
    const t = cur ? cur + ' ' + w : w;
    if (textWidth(t, font, size) <= maxW || !cur) cur = t; else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines;
}

/* ---------- Kalendarium ---------- */
/* Tagesinformationen für das Kalendarium: Feiertag, Schulferien, Geburtstage */
function isoWeek(y, m, d) {
  const t = new Date(Date.UTC(y, m, d)), day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  return Math.ceil(((t - Date.UTC(t.getUTCFullYear(), 0, 1)) / 864e5 + 1) / 7);
}
const ymd = (y, m, d) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
// Schulferien eines Monats: Tage und zusammenhängende Abschnitte (für die Namenszeile)
function schoolMonth(year, m) {
  const list = (typeof SCHOOL_HOLIDAYS !== 'undefined' && SCHOOL_HOLIDAYS[S.doc.region]) || [], days = new Map(), ranges = [];
  const first = ymd(year, m, 1), last = ymd(year, m, daysIn(year, m));
  for (const [a, b, name] of list) {
    if (b < first || a > last) continue;
    const from = a < first ? 1 : +a.slice(8), to = b > last ? daysIn(year, m) : +b.slice(8);
    for (let d = from; d <= to; d++) days.set(d, name);
    ranges.push(from === to ? `${from}. ${name}` : `${from}.–${to}. ${name}`);
  }
  return { days, ranges };
}
const hasSchoolData = () => typeof SCHOOL_HOLIDAYS !== 'undefined' && !!SCHOOL_HOLIDAYS[S.doc.region];
function birthdaysOf(year, m) {
  const map = new Map();
  for (const b of S.doc.birthdays || []) {
    if (!b.name || +b.m !== m + 1 || !(+b.d >= 1)) continue;
    let d = +b.d; if (d > daysIn(year, m)) d = daysIn(year, m);        // 29. Februar in Nicht-Schaltjahren am 28.
    const age = b.y ? year - +b.y : null;
    (map.get(d) || map.set(d, []).get(d)).push(b.name + (age > 0 ? ` (${age})` : ''));
  }
  return map;
}
function monthInfo(year, m, c) {
  const hol = holidays(year, S.doc.region), sch = c.school ? schoolMonth(year, m) : { days: new Map(), ranges: [] };
  const bd = c.bd === 'off' ? new Map() : birthdaysOf(year, m), names = [];
  for (let d = 1; d <= daysIn(year, m); d++) {
    const h = hol.get(`${m}-${d}`); if (h) names.push(`${d}. ${h}`);
    if (c.bd === 'names' && bd.has(d)) names.push(`${d}. ${bd.get(d).join(', ')}`);
  }
  if (c.school && sch.ranges.length) names.push(...sch.ranges);
  return { hol, sch, bd, names };
}
// Dezente Marken: Punkt rechts oben an der Tageszahl für Geburtstage, Strich für Schulferien
const bdDot = (x, y, ns, fill) => ({ t: 'circle', x: x + ns * .42, y: y - ns * .78, r: ns * .11, fill });
const bar = (x, y, w, h, fill) => ({ t: 'rect', x, y, w, h, fill });

function calH(year, m, f, c) {
  const n = daysIn(year, m), info = monthInfo(year, m, c), items = [];
  const ts = 9 * f, ws = 2.5 * f, ns = 4.6 * f, cw = 7.2 * f, wg = 2 * f, ks = 1.9 * f;
  const tb = ts * .74;
  items.push(T(0, tb, MONTHS[m], 'bold', ts, c.color));
  items.push(T(textWidth(MONTHS[m], 'bold', ts) + 2.2 * f, tb, String(year), 'regular', ts, c.color));
  const kwH = c.kw ? 2.6 * f : 0, y1 = tb + 6.6 * f + kwH, y2 = y1 + 6.2 * f;
  let x = 0;
  for (let d = 1; d <= n; d++) {
    const dow = new Date(year, m, d).getDay(), h = info.hol.get(`${m}-${d}`), sp = dow === 0 || !!h;
    const fill = sp && c.hi === 'red' ? 'red' : c.color, font = sp && c.hi !== 'none' ? 'bold' : 'regular';
    if (c.kw && (dow === 1 || d === 1)) items.push(T(x + cw / 2, y1 - ws - 1.2 * f, 'KW ' + isoWeek(year, m, d), 'regular', ks, c.color, 'middle'));
    items.push(T(x + cw / 2, y1, WD2[dow], sp && c.hi === 'bold' ? 'bold' : 'regular', ws, fill, 'middle'));
    items.push(T(x + cw / 2, y2, String(d), font, ns, fill, 'middle'));
    if (info.bd.has(d) && c.bd !== 'off') items.push(bdDot(x + cw / 2 + textWidth(String(d), font, ns) / 2 - ns * .2, y2, ns, c.color));
    if (info.sch.days.has(d)) items.push(bar(x + .4 * f, y2 + 1.3 * f, cw - .8 * f + (dow === 0 && info.sch.days.has(d + 1) ? wg : 0) + .8 * f * (info.sch.days.has(d + 1) ? 1 : 0), .45 * f, c.color));
    x += cw; if (dow === 0 && d < n) x += wg;
  }
  let w = Math.max(x, textWidth(MONTHS[m] + ' ' + year, 'bold', ts) + 2 * f), hgt = y2 + (info.sch.days.size ? 2.3 : 1.3) * f;
  if (c.names && info.names.length) {
    const ls = 2.3 * f;
    for (const l of wrap(info.names.join('  ·  '), 'regular', ls, w)) { hgt += 3.6 * f; items.push(T(0, hgt, l, 'regular', ls, c.color)); }
    hgt += .8 * f;
  }
  return { w, h: hgt, items };
}
function calV(year, m, f, c) {
  const n = daysIn(year, m), info = monthInfo(year, m, c), items = [];
  const ts = 7.6 * f, ys = 4.6 * f, ws = 2.6 * f, ns = 4 * f, ls = 2.3 * f, rh = 4.9 * f, gap = 1.6 * f, ks = 1.9 * f;
  const x0 = (c.kw ? 5.5 : 0) * f + (info.sch.days.size ? 1.6 * f : 0);   // Platz für KW und Ferienstrich
  items.push(T(0, ts * .74, MONTHS[m], 'bold', ts, c.color));
  items.push(T(0, ts * .74 + 5.6 * f, String(year), 'regular', ys, c.color));
  let y = ts * .74 + 5.6 * f + 7 * f, nameW = 0;
  const numX = x0 + 12.5 * f, extra = [];
  for (let d = 1; d <= n; d++) {
    const dow = new Date(year, m, d).getDay(), h = info.hol.get(`${m}-${d}`), sp = dow === 0 || !!h;
    const fill = sp && c.hi === 'red' ? 'red' : c.color, font = sp && c.hi !== 'none' ? 'bold' : 'regular';
    if (c.kw && (dow === 1 || d === 1)) items.push(T(0, y, String(isoWeek(year, m, d)), 'regular', ks, c.color));
    if (info.sch.days.has(d)) items.push(bar(x0 - 1.4 * f, y - ns * .8, .45 * f, rh + (dow === 0 && info.sch.days.has(d + 1) ? gap : 0) + (info.sch.days.has(d + 1) ? 0 : -rh + ns * .9), c.color));
    items.push(T(x0, y, WD2[dow], 'regular', ws, fill));
    items.push(T(numX, y, String(d), font, ns, fill, 'end'));
    if (info.bd.has(d) && c.bd !== 'off') items.push(bdDot(numX - ns * .2, y, ns, c.color));
    const label = [h, c.bd === 'names' && info.bd.has(d) ? info.bd.get(d).join(', ') : null].filter(Boolean).join(' · ');
    if (label && c.names) { items.push(T(numX + 2.2 * f, y, label, 'regular', ls, c.color)); nameW = Math.max(nameW, textWidth(label, 'regular', ls)); }
    y += rh; if (dow === 0 && d < n) y += gap;
  }
  let w = Math.max(textWidth(MONTHS[m], 'bold', ts), numX + (nameW ? 2.2 * f + nameW : 0)), hgt = y - rh + 1.2 * f;
  if (c.names && info.sch.ranges.length) {
    for (const l of wrap(info.sch.ranges.join(' · '), 'regular', ls, Math.max(w, 30 * f))) { hgt += 3.6 * f; extra.push(T(0, hgt, l, 'regular', ls, c.color)); }
    w = Math.max(w, ...extra.map(t => textWidth(t.text, 'regular', ls)));
  }
  return { w, h: hgt, items: items.concat(extra) };
}
function calG(year, m, f, c) {
  const n = daysIn(year, m), info = monthInfo(year, m, c), items = [];
  const ts = 6.4 * f, ws = 2.4 * f, ns = 3.8 * f, cw = 7.4 * f, rh = 6 * f, ks = 1.9 * f, kx = c.kw ? 5.5 * f : 0;
  const tb = ts * .74;
  items.push(T(0, tb, MONTHS[m], 'bold', ts, c.color));
  items.push(T(textWidth(MONTHS[m], 'bold', ts) + 1.8 * f, tb, String(year), 'regular', ts, c.color));
  const yh = tb + 6 * f;
  if (c.kw) items.push(T(0, yh, 'KW', 'regular', ks, c.color));
  ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].forEach((t, i) =>
    items.push(T(kx + i * cw + cw / 2, yh, t, 'regular', ws, i === 6 && c.hi === 'red' ? 'red' : c.color, 'middle')));
  const off = (new Date(year, m, 1).getDay() + 6) % 7;
  let rows = 0;
  for (let d = 1; d <= n; d++) {
    const k = off + d - 1, r = Math.floor(k / 7), col = k % 7, h = info.hol.get(`${m}-${d}`), sp = col === 6 || !!h;
    const fill = sp && c.hi === 'red' ? 'red' : c.color, font = sp && c.hi !== 'none' ? 'bold' : 'regular';
    const by = yh + 2 * f + r * rh + rh * .68, cx = kx + col * cw + cw / 2;
    if (c.kw && (col === 0 || d === 1)) items.push(T(0, by, String(isoWeek(year, m, d)), 'regular', ks, c.color));
    items.push(T(cx, by, String(d), font, ns, fill, 'middle'));
    if (info.bd.has(d) && c.bd !== 'off') items.push(bdDot(cx + textWidth(String(d), font, ns) / 2 - ns * .2, by, ns, c.color));
    if (info.sch.days.has(d)) items.push(bar(kx + col * cw + .6 * f, by + 1.2 * f, cw - 1.2 * f + (col < 6 && info.sch.days.has(d + 1) ? 1.2 * f : 0), .45 * f, c.color));
    rows = r + 1;
  }
  const w = kx + 7 * cw;
  let hgt = yh + 2 * f + rows * rh;
  if (c.names && info.names.length) {
    const ls = 2.2 * f;
    for (const l of wrap(info.names.join('  ·  '), 'regular', ls, w)) { hgt += 3.4 * f; items.push(T(0, hgt, l, 'regular', ls, c.color)); }
    hgt += .8 * f;
  }
  return { w, h: hgt, items };
}
function offsetItem(it, dx, dy) {
  const o = { ...it };
  if ('x' in o) o.x += dx; if ('y' in o) o.y += dy;
  return o;
}
const PANELS = { none: null, light: 'white', dark: 'black', paper: 'bg' };
function blockFrame(lay, anchor, f, panel, opacity = 1) {
  const pad = PANELS[panel] ? 3 * f : 0, bw = lay.w + 2 * pad, bh = lay.h + 2 * pad;
  const x = anchor.ax * (S.doc.w - bw), y = anchor.ay * (S.doc.h - bh), items = [];
  if (pad) { const col = PANELS[panel]; items.push({ t: 'rect', x, y, w: bw, h: bh, fill: col === 'bg' ? S.doc.bg : col, opacity, role: 'panel' }); }
  for (const it of lay.items) items.push(offsetItem(it, x + pad, y + pad));
  return { x, y, w: bw, h: bh, items };
}
function calBlock(p) {
  const m = pageMonth(p.key); if (m == null) return null;
  const c = calSettings(p); if (c.style === 'off') return null;
  const f = c.size * Math.min(S.doc.w, S.doc.h) / 300;
  const lay = (c.style === 'v' ? calV : c.style === 'g' ? calG : calH)(S.doc.year, m, f, c);
  const a = (p.cal && p.cal.pos && p.cal.pos[c.style]) || S.doc.cal.def[c.style];
  return { t: 'block', kind: 'cal', ...blockFrame(lay, a, f, c.panel, c.opacity ?? .85) };
}
function titleBlock(p) {
  if (!p.title) return null;
  const t = p.title, f = t.size * Math.min(S.doc.w, S.doc.h) / 300, items = [];
  const ts = 24 * f, ss = 11 * f;
  let y = ts * .74, w = 0;
  if (t.text) { items.push(T(0, y, t.text, 'bold', ts, t.color)); w = textWidth(t.text, 'bold', ts); }
  if (t.sub) { y += (t.text ? 3 * f : 0) + ss * .74 + (t.text ? 1.5 * f : 0); items.push(T(0, y, t.sub, 'regular', ss, t.color)); w = Math.max(w, textWidth(t.sub, 'regular', ss)); }
  if (!items.length) return null;
  return { t: 'block', kind: 'title', ...blockFrame({ w, h: y + 2.2 * f, items }, t, f, t.panel, t.opacity ?? .85) };
}

/* ---------- Anzeigeliste einer Seite ---------- */
function pageItems(p, opt = {}) {
  const doc = S.doc, b = doc.bleed, items = [];
  items.push({ t: 'rect', x: -b, y: -b, w: doc.w + 2 * b, h: doc.h + 2 * b, fill: doc.bg, role: 'bg' });
  if (p.layout === 'index') return items.concat(indexItems(p, opt));
  for (const r of slotRects(p)) {
    const sl = slotOf(p, r.i) || newSlot(), ph = sl.photo && S.photos[sl.photo];
    if (r.border > 0) items.push({ t: 'rect', x: r.x - r.border, y: r.y - r.border, w: r.w + 2 * r.border, h: r.h + 2 * r.border, fill: doc.bg, slot: r.i, role: 'ovb' });
    if (ph && sl.fit === 'contain') items.push({ t: 'rect', ...r, fill: doc.bg, slot: r.i, role: 'ovb' });
    if (ph) items.push({ t: 'img', slot: r.i, clip: r, place: placeImage(r, ph, sl), photo: ph.id, overlay: r.overlay });
    else items.push({ t: 'empty', slot: r.i, clip: r, overlay: r.overlay });
  }
  if (!opt.noBlocks) {
    const c = calBlock(p); if (c) items.push(c);
    const t = titleBlock(p); if (t) items.push(t);
  }
  return items;
}
function intersect(a, b) {
  const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y), x2 = Math.min(a.x + a.w, b.x + b.w), y2 = Math.min(a.y + a.h, b.y + b.h);
  return x2 > x && y2 > y ? { x, y, w: x2 - x, h: y2 - y } : null;
}
// Seite verkleinert einsetzen (für das Bildregister)
function miniPage(p, tx, ty, s) {
  const trim = { x: 0, y: 0, w: S.doc.w, h: S.doc.h }, out = [];
  const tr = (r) => ({ x: tx + r.x * s, y: ty + r.y * s, w: r.w * s, h: r.h * s });
  for (const it of pageItems(p, { noBlocks: true })) {
    if (it.t === 'rect') { const c = intersect(it, trim); if (c) out.push({ ...it, ...tr(c), role: 'mini' }); }
    else if (it.t === 'img') { const c = intersect(it.clip, trim); if (c) out.push({ ...it, clip: tr(c), place: { ...it.place, ...tr(it.place), fx: tx + it.place.fx * s, fy: ty + it.place.fy * s }, mini: true }); }
    else if (it.t === 'empty') { const c = intersect(it.clip, trim); if (c) out.push({ t: 'rect', ...tr(c), fill: 'sand', opacity: 1 }); }
  }
  out.push({ t: 'frame', x: tx, y: ty, w: S.doc.w * s, h: S.doc.h * s });
  return out;
}
// Geburtstage fürs Register, nach Monat und Tag sortiert
function birthdayLines() {
  if (!S.doc.indexBirthdays) return [];
  return (S.doc.birthdays || []).filter(b => b.name && +b.d >= 1 && +b.m >= 1 && +b.m <= 12)
    .sort((a, b) => (a.m - b.m) || (a.d - b.d))
    .map(b => { const age = b.y ? S.doc.year - +b.y : 0; return `${+b.d}. ${MONTHS[b.m - 1]}: ${b.name}${age > 0 ? ` (wird ${age})` : ''}`; });
}
// Register in drei Arten (doc.indexMode):
//   'photos' – je Seite die Fotos mit Bildtext (Nummern und Miniaturen optional)
//   'pages'  – je Seite ein freier Text (Miniatur optional)
//   'text'   – frei geschriebene Textseite(n)
// Alles fließt über so viele Seiten wie nötig, Text wird nicht abgeschnitten.
const indexMode = () => S.doc.indexMode || 'photos';
function indexEntries() {
  const mode = indexMode();
  return baseKeys().filter(k => {
    const p = S.pages[k]; if (!p) return false;
    const hasPhoto = visibleSlots(p).some(s => s.photo && S.photos[s.photo]);
    return mode === 'pages' ? hasPhoto || !!(p.caption || '').trim() : hasPhoto;
  });
}
function indexLayout() { return indexMode() === 'text' ? textLayout() : entryLayout(); }
function entryLayout() {
  const doc = S.doc, W = doc.w, H = doc.h, f = Math.min(W, H) / 300, mg = 16 * f, mode = indexMode();
  const thumbs = doc.indexThumbs !== false, nums = mode === 'photos' && doc.indexNums !== false;
  const cols = W / H > 1.15 ? (thumbs ? 4 : 3) : (thumbs ? 3 : 2), gx = 7 * f, gy = 6 * f;
  const cellW = (W - 2 * mg - (cols - 1) * gx) / cols, mw = thumbs ? cellW * .45 : 0, mh = mw * H / W, tw = cellW - (thumbs ? mw + 4 * f : 0);
  const ls = (thumbs ? 2.35 : 2.8) * f, lh = ls * 1.4, labelH = 3.1 * f * .74 + f, ind = nums ? 4 * f : 0;
  const entries = indexEntries().map(k => {
    const pg = S.pages[k], caps = []; let num = 0;
    for (const r of slotRects(pg)) {
      const sl = slotOf(pg, r.i); if (!sl || !sl.photo || !S.photos[sl.photo]) continue;
      caps.push([++num, S.photos[sl.photo].caption, r]);
    }
    let lines;
    if (mode === 'pages') lines = String(pg.caption || '').split(/\n/).flatMap(par => par.trim() ? wrap(par, 'regular', ls, tw) : []).map(l => [null, l]);
    else lines = caps.flatMap(([i, cap]) => cap ? wrap(cap, 'regular', ls, tw - ind).map((l, j) => [j === 0 && nums ? i : null, l]) : []);
    return { k, caps: nums ? caps : [], lines, h: Math.max(mh, labelH + lines.length * lh + f) };
  });
  const bl = birthdayLines();
  if (bl.length) { const lines = bl.flatMap(l => wrap(l, 'regular', ls, tw)).map(l => [null, l]); entries.push({ k: null, label: 'Geburtstage', caps: [], lines, h: labelH + lines.length * lh + f }); }
  const pages = []; let cur = [], y = mg + 20 * f;
  for (let i = 0; i < entries.length; i += cols) {
    const row = entries.slice(i, i + cols), rh = Math.max(...row.map(e => e.h));
    if (cur.length && y + rh > H - mg) { pages.push(cur); cur = []; y = mg + 12 * f; }
    row.forEach((e, j) => cur.push({ ...e, x: mg + j * (cellW + gx), y }));
    y += rh + gy;
  }
  pages.push(cur);
  pages.geom = { f, mg, mw, mh, ls, lh, ind, thumbs };
  return pages;
}
// Freier Text: Absätze durch Leerzeilen, „## “ am Zeilenanfang macht eine Zwischenüberschrift.
// Spalten mit gut lesbarer Zeilenlänge, dann weiter auf der nächsten Seite.
function textLayout() {
  const doc = S.doc, W = doc.w, H = doc.h, f = Math.min(W, H) / 300, mg = 16 * f;
  const cols = W / H > 1.15 ? 3 : 2, gx = 9 * f, colW = (W - 2 * mg - (cols - 1) * gx) / cols;
  const bs = 3.2 * f, hs = 4.2 * f, blh = bs * 1.45;
  const blocks = [];
  for (const raw of String(doc.indexText || '').split(/\n\s*\n/)) {
    const t = raw.trim(); if (!t) continue;
    for (const line of t.split('\n')) {
      if (/^##\s+/.test(line)) blocks.push({ head: true, lines: wrap(line.replace(/^##\s+/, ''), 'bold', hs, colW) });
      else if (line.trim()) blocks.push({ head: false, lines: wrap(line.trim(), 'regular', bs, colW) });
    }
    blocks.push({ gap: true });
  }
  const bl = birthdayLines();
  if (bl.length) { blocks.push({ head: true, lines: ['Geburtstage'] }); for (const l of bl) blocks.push({ head: false, lines: wrap(l, 'regular', bs, colW) }); }
  const pages = []; let cur = [], col = 0, top = mg + 20 * f, y = top;
  const nextCol = () => { col++; if (col >= cols) { pages.push(cur); cur = []; col = 0; top = mg + 12 * f; } y = top; };
  for (const b of blocks) {
    if (b.gap) { y += blh * .55; continue; }
    const lh = b.head ? hs * 1.35 : blh;
    if (b.head && y + lh * (b.lines.length + 1) > H - mg && y > top) nextCol();   // Überschrift nicht allein am Spaltenende
    if (b.head && y > top) y += blh * .3;
    for (const l of b.lines) {
      if (y + lh > H - mg) nextCol();
      y += lh;
      cur.push(T(mg + col * (colW + gx), y - lh * .28, l, b.head ? 'bold' : 'regular', b.head ? hs : bs, null));
    }
  }
  pages.push(cur);
  pages.geom = { f, mg, text: true };
  return pages;
}
function indexItems(p) {
  const doc = S.doc, W = doc.w, items = [], L = indexLayout(), g = L.geom, { f, mg } = g;
  const col = doc.bg === 'white' || doc.bg === 'sand' ? 'black' : 'white';
  const n = indexNo(p.key), list = L[n - 1] || [];
  if (n === 1) {
    items.push(T(mg, mg + 9 * f * .74, doc.indexTitle || 'Bildregister', 'bold', 9 * f, col));
    items.push(T(mg, mg + 9 * f * .74 + 6 * f, `Familienkalender ${doc.year}`, 'regular', 3.2 * f, col));
    if (!list.length) { items.push(T(mg, mg + 30 * f, g.text ? 'Noch kein Text. Rechts unter „Register“ schreiben.' : 'Noch keine Fotos auf den Seiten.', 'regular', 3.5 * f, col)); return items; }
  } else items.push(T(mg, mg + 6 * f * .74, `${doc.indexTitle || 'Bildregister'} (Fortsetzung)`, 'bold', 6 * f, col));
  // Quellenhinweis zu den Schulferien auf der letzten Registerseite
  if (n === L.length && S.doc.cal.school && hasSchoolData()) items.push(T(mg, doc.h - mg * .55, `Schulferien laut ${SCHOOL_SOURCE.name} (${SCHOOL_SOURCE.url.replace('https://', '')}), Stand ${SCHOOL_SOURCE.fetched}, ohne Gewähr.`, 'regular', 2 * f, col));
  if (g.text) { for (const it of list) items.push({ ...it, fill: col }); return items; }
  const { mw, ls, lh, ind, thumbs } = g;
  for (const e of list) {
    const s = mw / W, mini = thumbs && e.k;
    if (mini) {
      items.push(...miniPage(S.pages[e.k], e.x, e.y, s));
      for (const [num, , r] of e.caps) {
        const vis = intersect(r, { x: 0, y: 0, w: W, h: doc.h }) || r, bx = e.x + (vis.x + vis.w / 2) * s, by = e.y + (vis.y + vis.h / 2) * s, br = Math.max(1.6, 2.1 * f);
        items.push({ t: 'circle', x: bx, y: by, r: br, fill: 'white' });
        items.push(T(bx, by + br * .42, String(num), 'bold', br * 1.15, 'black', 'middle'));
      }
    }
    const tx = e.x + (mini ? mw + 4 * f : 0); let y = e.y + 3.1 * f * .74;
    items.push(T(tx, y, e.label || pageLabel(e.k), 'bold', 3.1 * f, col)); y += f;
    for (const [num, l] of e.lines) {
      y += lh;
      if (num != null) items.push(T(tx, y, String(num), 'bold', ls, col));
      items.push(T(tx + ind, y, l, 'regular', ls, col));
    }
  }
  return items;
}

/* ---------- SVG ---------- */
const cRGB = (id) => (COLORS[id] || COLORS.black).rgb;
const imgAttrs = (pl) => `x="${pl.x}" y="${pl.y}" width="${pl.w}" height="${pl.h}"${pl.rot ? ` transform="rotate(${pl.rot} ${pl.fx} ${pl.fy})"` : ''}`;
let svgN = 0;
function svgPage(p, o = {}) {
  // o.mode: 'editor' | 'thumb' | 'proof'
  const doc = S.doc, W = doc.w, H = doc.h, b = doc.bleed, ed = o.mode === 'editor';
  const id = 's' + (++svgN);
  const pad = ed ? Math.max(b + 2, 12) : 0;
  const vb = ed ? [-pad, -pad, W + 2 * pad, H + 2 * pad] : [0, 0, W, H];
  const defs = [], body = [];
  let cn = 0;
  const clipRect = (r) => { const cid = `${id}c${cn++}`; defs.push(`<clipPath id="${cid}"><rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}"/></clipPath>`); return cid; };
  const url = (pid, small) => (small ? RT.thumb[pid] : RT.prev[pid]) || RT.thumb[pid] || '';
  let live = ed;   // nur die bearbeitete Seite reagiert auf Zeiger, nicht die Partnerseite
  const emit = (it, small) => {
    switch (it.t) {
      case 'rect': return `<rect x="${it.x}" y="${it.y}" width="${it.w}" height="${it.h}" fill="${cRGB(it.fill)}"${it.opacity != null && it.opacity < 1 ? ` fill-opacity="${it.opacity}"` : ''}${it.role === 'ovb' && live ? ` data-slot="${it.slot}"` : ''}/>`;
      case 'circle': return `<circle cx="${it.x}" cy="${it.y}" r="${it.r}" fill="${cRGB(it.fill)}" fill-opacity="${it.opacity ?? 1}"/>`;
      case 'frame': return `<rect x="${it.x}" y="${it.y}" width="${it.w}" height="${it.h}" fill="none" stroke="#9aa3ad" stroke-width="0.25"/>`;
      case 'text': return `<text x="${it.x}" y="${it.y}" font-size="${it.size}" font-weight="${it.font === 'bold' ? 600 : 400}" fill="${cRGB(it.fill)}" text-anchor="${it.anchor}">${esc(it.text)}</text>`;
      case 'img': {
        const cid = clipRect(it.clip), pl = it.place;
        return `<g clip-path="url(#${cid})"${live && !it.mini ? ` data-slot="${it.slot}"${ui.crop === it.slot ? ' class="cropping"' : ui.sel === it.slot ? ' class="selframe"' : ''}` : ''}><image href="${url(it.photo, small || it.mini)}" ${imgAttrs(pl)} preserveAspectRatio="none"/></g>`;
      }
      case 'empty': {
        const r = it.clip;
        if (!live) return `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" fill="#dfe3e7"/>`;
        const vis = intersect(r, { x: 0, y: 0, w: W, h: H }) || r, cx = vis.x + vis.w / 2, cy = vis.y + vis.h / 2, s = Math.min(vis.w, vis.h) * .08;
        return `<g class="empty${ui.sel === it.slot ? ' selframe' : ''}" data-slot="${it.slot}"><rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" fill="#e3e7eb"/>` +
          `<rect x="${vis.x + 2}" y="${vis.y + 2}" width="${Math.max(0, vis.w - 4)}" height="${Math.max(0, vis.h - 4)}" fill="none" stroke="#a7b0ba" stroke-width="0.6" stroke-dasharray="3 2"/>` +
          `<path d="M${cx - s} ${cy}h${2 * s}M${cx} ${cy - s}v${2 * s}" stroke="#7d8793" stroke-width="${s * .18}" stroke-linecap="round"/>` +
          (vis.w > 60 ? `<text x="${cx}" y="${cy + s * 2.2}" font-size="${Math.min(5, s * .7)}" fill="#6b7580" text-anchor="middle">Foto hierher ziehen</text>` : '') + `</g>`;
      }
      case 'block': {
        const inner = it.items.map(x => emit(x, small)).join('');
        if (!live) return inner;
        return `<g data-block="${it.kind}"><rect x="${it.x - 1.5}" y="${it.y - 1.5}" width="${it.w + 3}" height="${it.h + 3}" fill="transparent"/>${inner}</g>`;
      }
    }
    return '';
  };
  const items = pageItems(p);
  // Aufgeklappte Ansicht: Partnerseite blass oben oder unten daneben zeigen
  const partner = ed && o.partner && S.pages[o.partner], pdy = partner ? (viewOf(p.key).part === 'upper' ? H : -H) : 0;
  if (partner) {
    live = false;
    const pc = `${id}p`; defs.push(`<clipPath id="${pc}"><rect x="0" y="0" width="${W}" height="${H}"/></clipPath>`);
    body.push(`<g transform="translate(0 ${pdy})" opacity=".5" pointer-events="none"><g clip-path="url(#${pc})">${pageItems(partner).map(x => emit(x, false)).join('')}</g>` +
      `<text x="${W / 2}" y="${pdy < 0 ? H - 8 : 12}" font-size="${Math.min(W, H) * .022}" text-anchor="middle" fill="#fff" stroke="#000" stroke-width=".3" paint-order="stroke">${esc(pageLabel(o.partner))}</text></g>`);
    live = ed;
    vb[1] = Math.min(vb[1], pdy - 4); vb[3] = H + Math.abs(pdy) + 2 * pad + 4;
  }
  for (const it of items) body.push(emit(it, o.mode === 'thumb'));

  // Oben hängende Rückseiten haben die Lochung an ihrer Unterkante
  const flipBind = viewOf(p.key).part === 'upper';
  let over = '';
  if (ed) {
    // Auflösungswarnungen
    for (const it of items) if (it.t === 'img') {
      const d = dpiOf(S.photos[it.photo], it.place);
      if (d < 200) {
        const vis = intersect(it.clip, { x: 0, y: 0, w: W, h: H }) || it.clip, r = 3.2;
        over += `<g pointer-events="none"><circle cx="${vis.x + vis.w - 6}" cy="${vis.y + 6}" r="${r}" fill="${d < 150 ? '#c0392b' : '#d68910'}"/><text x="${vis.x + vis.w - 6}" y="${vis.y + 7.4}" font-size="4" font-weight="600" fill="#fff" text-anchor="middle">!</text></g>`;
      }
    }
    if (o.showBleed) {
      over += `<path d="M${-b} ${-b}h${W + 2 * b}v${H + 2 * b}h${-(W + 2 * b)}zM0 0v${H}h${W}v${-H}z" fill-rule="evenodd" fill="#ffffff" fill-opacity="0.55" pointer-events="none"/>`;
      over += `<rect x="0" y="0" width="${W}" height="${H}" fill="none" stroke="#c2185b" stroke-width="0.35" stroke-dasharray="2 1.5" pointer-events="none"/>`;
    }
    if (o.showGuides) {
      const sm = 5;
      over += `<rect x="${sm}" y="${sm}" width="${W - 2 * sm}" height="${H - 2 * sm}" fill="none" stroke="#00a0e3" stroke-width="0.3" stroke-dasharray="1 1.5" pointer-events="none"/>`;
    }
    if (o.showBind) over += bindingSvg(true, flipBind);
    // Ausschnitt-Modus: das ganze Foto blass zeigen, auch außerhalb des Rahmens
    const ci = ui.crop != null && items.find(i => i.t === 'img' && i.slot === ui.crop);
    if (ci) {
      const c = ci.clip, pl = ci.place, gid = `${id}g`;
      defs.push(`<clipPath id="${gid}"><path clip-rule="evenodd" d="M${-pad} ${-pad}h${W + 2 * pad}v${H + 2 * pad}h${-(W + 2 * pad)}zM${c.x} ${c.y}v${c.h}h${c.w}v${-c.h}z"/></clipPath>`);
      over += `<g clip-path="url(#${gid})" data-slot="${ui.crop}" class="cropghost"><image href="${url(ci.photo)}" ${imgAttrs(pl)} opacity=".38" preserveAspectRatio="none"/></g>`;
    }
    if (ui.selBlock) {
      const bl = items.find(i => i.t === 'block' && i.kind === ui.selBlock);
      if (bl) over += `<rect x="${bl.x - 1.5}" y="${bl.y - 1.5}" width="${bl.w + 3}" height="${bl.h + 3}" fill="none" stroke="var(--accent)" stroke-width=".8" stroke-dasharray="2 1.5" pointer-events="none"/>`;
    }
    // Auswahl
    if (ui.sel != null) {
      const r = slotRects(p).find(r => r.i === ui.sel);
      if (r) {
        over += `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" fill="none" stroke="var(--accent)" stroke-width="1.1"${ui.crop === r.i ? ' stroke-dasharray="3 2"' : ''} pointer-events="none"/>`;
        if (ui.swapFrom != null) over += `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" fill="var(--accent)" fill-opacity=".18" pointer-events="none"/>`;
        if (ui.crop == null && ui.swapFrom == null) {
          // Eckpunkte zum Ändern der Größe; ziehen im Rahmen verschiebt ihn
          const hs = Math.max(2.4, Math.min(W, H) * .011);
          for (const [h, x, y] of [['nw', r.x, r.y], ['ne', r.x + r.w, r.y], ['sw', r.x, r.y + r.h], ['se', r.x + r.w, r.y + r.h]])
            over += `<rect data-handle="${h}" data-slot-h="${r.i}" x="${x - hs}" y="${y - hs}" width="${2 * hs}" height="${2 * hs}" rx="${hs * .3}" fill="#fff" stroke="var(--accent)" stroke-width="${hs * .35}" style="cursor:${h === 'nw' || h === 'se' ? 'nwse' : 'nesw'}-resize"/>`;
        }
      }
    }
  } else if (o.showBind) over += bindingSvg(false, flipBind);

  let content = body.join('');
  if (ed && !o.showBleed) { const cid = clipRect({ x: 0, y: 0, w: W, h: H }); content = `<g clip-path="url(#${cid})">${content}</g>`; }
  if (ed && !o.showBleed) content = `<rect x="0" y="0" width="${W}" height="${H}" fill="#fff"/>` + content;
  return `<svg ${o.attrs || ''} viewBox="${vb.join(' ')}" xmlns="http://www.w3.org/2000/svg" style="font-family:CalJost,sans-serif;font-kerning:none" role="img" aria-label="${esc(pageLabel(p.key))}"><defs>${defs.join('')}</defs>${content}<g data-over="1">${over}</g></svg>`;
}

// Ringbindung und Aufhänger-Ausschnitt
function bindingConf(type) {
  const B = S.doc.bind;
  if (type === 'custom') return { p: Math.max(3, B.p || 8.47), hw: B.hw || 4, hh: B.hh || 3.2, cy: B.cy || 5.5, round: false };
  return type === 'wire21' ? { p: 12.7, hw: 5.5, hh: 4.2, cy: 6.5, round: false }
    : type === 'spiral' ? { p: 8.47, hw: 4.5, hh: 4.5, cy: 6, round: true }
    : { p: 8.47, hw: 4, hh: 3.2, cy: 5.5, round: false };
}
function bindZoneDepth() {
  const B = S.doc.bind; if (B.type === 'none') return B.cut ? B.cutD : 0;
  const c = bindingConf(B.type); return Math.max(c.cy + c.hh / 2 + 2, B.cut ? B.cutD : 0);
}
function holePositions() {
  const B = S.doc.bind, W = S.doc.w; if (B.type === 'none') return [];
  const c = bindingConf(B.type), n = Math.floor((W - 16) / c.p), x0 = (W - n * c.p) / 2, out = [];
  for (let i = 0; i <= n; i++) {
    const x = x0 + i * c.p;
    if (B.cut && x > W / 2 - B.cutW / 2 - 3 && x < W / 2 + B.cutW / 2 + 3) continue;
    out.push(x);
  }
  return out;
}
function bindingSvg(ed, flip = false) {
  const B = S.doc.bind, W = S.doc.w, b = S.doc.bleed;
  let s = `<g pointer-events="none"${flip ? ` transform="translate(0 ${S.doc.h}) scale(1 -1)"` : ''}>`;
  if (ed && B.type !== 'none') s += `<rect x="0" y="0" width="${W}" height="${bindZoneDepth()}" fill="#c2185b" fill-opacity=".1"/>`;
  if (B.type !== 'none') {
    const c = bindingConf(B.type);
    for (const x of holePositions()) {
      s += c.round ? `<circle cx="${x}" cy="${c.cy}" r="${c.hw / 2}" fill="var(--desk)" stroke="#000" stroke-opacity=".25" stroke-width=".2"/>`
        : `<rect x="${x - c.hw / 2}" y="${c.cy - c.hh / 2}" width="${c.hw}" height="${c.hh}" rx=".7" fill="var(--desk)" stroke="#000" stroke-opacity=".25" stroke-width=".2"/>`;
      if (ed) s += `<rect x="${x - 1.5}" y="${-6}" width="3" height="${c.cy + 6 + c.hh / 2 - .8}" rx="1.5" fill="none" stroke="#8d969f" stroke-width=".7"/>`;
    }
  }
  if (B.cut) {
    const l = W / 2 - B.cutW / 2, r = W / 2 + B.cutW / 2, top = ed ? -b - 1 : -1;
    s += `<path d="M${l} ${top}L${l} 0A${B.cutW / 2} ${B.cutD} 0 0 0 ${r} 0L${r} ${top}Z" fill="var(--desk)"/>`;
    if (ed && B.type !== 'none') s += `<path d="M${l - 4} -1.2H${r + 4}M${W / 2 - 5} -1.2L${W / 2} ${B.cutD * .55}L${W / 2 + 5} -1.2" fill="none" stroke="#8d969f" stroke-width=".8" stroke-linejoin="round"/>`;
  }
  return s + '</g>';
}
