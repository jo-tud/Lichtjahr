/* ---------- Geometrie (alles in mm, Ursprung = Endformat oben links) ---------- */
function slotRects(p, doc = S.doc) {
  if (p.layout === 'index') return [];
  const L = layoutById(p.layout), W = doc.w, H = doc.h, b = doc.bleed, m = doc.margin, g = doc.gap;
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
    out.push({ i, x: X(o.x ?? x), y: Y(o.y ?? y), w: w * cw * s, h: h * ch * s, overlay: true, border: doc.ovBorder });
  });
  return out;
}
function placeImage(r, ph, sl) {
  const s = Math.max(r.w / ph.w, r.h / ph.h) * (sl.zoom || 1);
  const dw = ph.w * s, dh = ph.h * s;
  const cx = clamp(sl.cx ?? .5, r.w / 2 / dw, 1 - r.w / 2 / dw), cy = clamp(sl.cy ?? .5, r.h / 2 / dh, 1 - r.h / 2 / dh);
  return { x: r.x + r.w / 2 - cx * dw, y: r.y + r.h / 2 - cy * dh, w: dw, h: dh, cx, cy };
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
function calH(year, m, f, c) {
  const n = daysIn(year, m), hol = holidays(year, S.doc.region), items = [], names = [];
  const ts = 9 * f, ws = 2.5 * f, ns = 4.6 * f, cw = 7.2 * f, wg = 2 * f;
  const tb = ts * .74;
  items.push(T(0, tb, MONTHS[m], 'bold', ts, c.color));
  items.push(T(textWidth(MONTHS[m], 'bold', ts) + 2.2 * f, tb, String(year), 'regular', ts, c.color));
  const y1 = tb + 6.6 * f, y2 = y1 + 6.2 * f;
  let x = 0;
  for (let d = 1; d <= n; d++) {
    const dow = new Date(year, m, d).getDay(), h = hol.get(`${m}-${d}`), sp = dow === 0 || !!h;
    const fill = sp && c.hi === 'red' ? 'red' : c.color, font = sp && c.hi !== 'none' ? 'bold' : 'regular';
    items.push(T(x + cw / 2, y1, WD2[dow], sp && c.hi === 'bold' ? 'bold' : 'regular', ws, fill, 'middle'));
    items.push(T(x + cw / 2, y2, String(d), font, ns, fill, 'middle'));
    if (h) names.push(`${d}. ${h}`);
    x += cw; if (dow === 0 && d < n) x += wg;
  }
  let w = Math.max(x, textWidth(MONTHS[m] + ' ' + year, 'bold', ts) + 2 * f), hgt = y2 + 1.3 * f;
  if (c.names && names.length) {
    const ls = 2.3 * f; let line = names.join('  ·  ');
    for (const l of wrap(line, 'regular', ls, w)) { hgt += 3.6 * f; items.push(T(0, hgt, l, 'regular', ls, c.color)); }
    hgt += .8 * f;
  }
  return { w, h: hgt, items };
}
function calV(year, m, f, c) {
  const n = daysIn(year, m), hol = holidays(year, S.doc.region), items = [];
  const ts = 7.6 * f, ys = 4.6 * f, ws = 2.6 * f, ns = 4 * f, ls = 2.3 * f, rh = 4.9 * f, gap = 1.6 * f;
  items.push(T(0, ts * .74, MONTHS[m], 'bold', ts, c.color));
  items.push(T(0, ts * .74 + 5.6 * f, String(year), 'regular', ys, c.color));
  let y = ts * .74 + 5.6 * f + 7 * f, nameW = 0;
  const numX = 12.5 * f;
  for (let d = 1; d <= n; d++) {
    const dow = new Date(year, m, d).getDay(), h = hol.get(`${m}-${d}`), sp = dow === 0 || !!h;
    const fill = sp && c.hi === 'red' ? 'red' : c.color, font = sp && c.hi !== 'none' ? 'bold' : 'regular';
    items.push(T(0, y, WD2[dow], 'regular', ws, fill));
    items.push(T(numX, y, String(d), font, ns, fill, 'end'));
    if (h && c.names) { items.push(T(numX + 2.2 * f, y, h, 'regular', ls, c.color)); nameW = Math.max(nameW, textWidth(h, 'regular', ls)); }
    y += rh; if (dow === 0 && d < n) y += gap;
  }
  const w = Math.max(textWidth(MONTHS[m], 'bold', ts), numX + (nameW ? 2.2 * f + nameW : 0));
  return { w, h: y - rh + 1.2 * f, items };
}
function calG(year, m, f, c) {
  const n = daysIn(year, m), hol = holidays(year, S.doc.region), items = [], names = [];
  const ts = 6.4 * f, ws = 2.4 * f, ns = 3.8 * f, cw = 7.4 * f, rh = 6 * f;
  const tb = ts * .74;
  items.push(T(0, tb, MONTHS[m], 'bold', ts, c.color));
  items.push(T(textWidth(MONTHS[m], 'bold', ts) + 1.8 * f, tb, String(year), 'regular', ts, c.color));
  const yh = tb + 6 * f;
  ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].forEach((t, i) =>
    items.push(T(i * cw + cw / 2, yh, t, 'regular', ws, i === 6 && c.hi === 'red' ? 'red' : c.color, 'middle')));
  const off = (new Date(year, m, 1).getDay() + 6) % 7;
  let rows = 0;
  for (let d = 1; d <= n; d++) {
    const k = off + d - 1, r = Math.floor(k / 7), col = k % 7, h = hol.get(`${m}-${d}`), sp = col === 6 || !!h;
    const fill = sp && c.hi === 'red' ? 'red' : c.color, font = sp && c.hi !== 'none' ? 'bold' : 'regular';
    items.push(T(col * cw + cw / 2, yh + 2 * f + r * rh + rh * .68, String(d), font, ns, fill, 'middle'));
    if (h) names.push(`${d}. ${h}`);
    rows = r + 1;
  }
  const w = 7 * cw;
  let hgt = yh + 2 * f + rows * rh;
  if (c.names && names.length) {
    const ls = 2.2 * f;
    for (const l of wrap(names.join('  ·  '), 'regular', ls, w)) { hgt += 3.4 * f; items.push(T(0, hgt, l, 'regular', ls, c.color)); }
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
    const sl = p.slots[r.i] || newSlot(), ph = sl.photo && S.photos[sl.photo];
    if (r.overlay && r.border > 0) items.push({ t: 'rect', x: r.x - r.border, y: r.y - r.border, w: r.w + 2 * r.border, h: r.h + 2 * r.border, fill: doc.bg, slot: r.i, role: 'ovb' });
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
    else if (it.t === 'img') { const c = intersect(it.clip, trim); if (c) out.push({ ...it, clip: tr(c), place: tr(it.place), mini: true }); }
    else if (it.t === 'empty') { const c = intersect(it.clip, trim); if (c) out.push({ t: 'rect', ...tr(c), fill: 'sand', opacity: 1 }); }
  }
  out.push({ t: 'frame', x: tx, y: ty, w: S.doc.w * s, h: S.doc.h * s });
  return out;
}
// Register: Einträge fließen über so viele Seiten wie nötig, Text wird nicht abgeschnitten
function indexEntries() { return baseKeys().filter(k => S.pages[k] && visibleSlots(S.pages[k]).some(s => s.photo && S.photos[s.photo])); }
function indexLayout() {
  const doc = S.doc, W = doc.w, H = doc.h, f = Math.min(W, H) / 300, mg = 16 * f;
  const cols = W / H > 1.15 ? 4 : 3, gx = 7 * f, gy = 6 * f;
  const cellW = (W - 2 * mg - (cols - 1) * gx) / cols, mw = cellW * .45, mh = mw * H / W, tw = cellW - mw - 4 * f;
  const ls = 2.35 * f, lh = 3.25 * f, labelH = 3.1 * f * .74 + f;
  const entries = indexEntries().map(k => {
    const pg = S.pages[k], caps = []; let num = 0;
    for (const r of slotRects(pg)) {
      const sl = pg.slots[r.i]; if (!sl || !sl.photo || !S.photos[sl.photo]) continue;
      caps.push([++num, S.photos[sl.photo].caption, r]);
    }
    const lines = caps.flatMap(([i, cap]) => cap ? wrap(cap, 'regular', ls, tw - 4 * f).map((l, j) => [j === 0 ? i : null, l]) : []);
    return { k, caps, lines, h: Math.max(mh, labelH + lines.length * lh + f) };
  });
  const pages = []; let cur = [], y = mg + 20 * f;
  for (let i = 0; i < entries.length; i += cols) {
    const row = entries.slice(i, i + cols), rh = Math.max(...row.map(e => e.h));
    if (cur.length && y + rh > H - mg) { pages.push(cur); cur = []; y = mg + 12 * f; }
    row.forEach((e, j) => cur.push({ ...e, x: mg + j * (cellW + gx), y }));
    y += rh + gy;
  }
  pages.push(cur);
  pages.geom = { f, mg, mw, mh, ls, lh };
  return pages;
}
function indexItems(p) {
  const doc = S.doc, W = doc.w, items = [], L = indexLayout(), { f, mg, mw, ls, lh } = L.geom;
  const col = doc.bg === 'white' || doc.bg === 'sand' ? 'black' : 'white';
  const n = indexNo(p.key), list = L[n - 1] || [];
  if (n === 1) {
    items.push(T(mg, mg + 9 * f * .74, doc.indexTitle || 'Bildregister', 'bold', 9 * f, col));
    items.push(T(mg, mg + 9 * f * .74 + 6 * f, `Familienkalender ${doc.year}`, 'regular', 3.2 * f, col));
    if (!list.length) { items.push(T(mg, mg + 30 * f, 'Noch keine Fotos auf den Seiten.', 'regular', 3.5 * f, col)); return items; }
  } else items.push(T(mg, mg + 6 * f * .74, `${doc.indexTitle || 'Bildregister'} (Fortsetzung)`, 'bold', 6 * f, col));
  for (const e of list) {
    const s = mw / W;
    items.push(...miniPage(S.pages[e.k], e.x, e.y, s));
    for (const [num, , r] of e.caps) {
      const vis = intersect(r, { x: 0, y: 0, w: W, h: doc.h }) || r, bx = e.x + (vis.x + vis.w / 2) * s, by = e.y + (vis.y + vis.h / 2) * s, br = Math.max(1.6, 2.1 * f);
      items.push({ t: 'circle', x: bx, y: by, r: br, fill: 'white' });
      items.push(T(bx, by + br * .42, String(num), 'bold', br * 1.15, 'black', 'middle'));
    }
    const tx = e.x + mw + 4 * f; let y = e.y + 3.1 * f * .74;
    items.push(T(tx, y, pageLabel(e.k), 'bold', 3.1 * f, col)); y += f;
    for (const [num, l] of e.lines) {
      y += lh;
      if (num != null) items.push(T(tx, y, String(num), 'bold', ls, col));
      items.push(T(tx + 4 * f, y, l, 'regular', ls, col));
    }
  }
  return items;
}

/* ---------- SVG ---------- */
const cRGB = (id) => (COLORS[id] || COLORS.black).rgb;
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
  const emit = (it, small) => {
    switch (it.t) {
      case 'rect': return `<rect x="${it.x}" y="${it.y}" width="${it.w}" height="${it.h}" fill="${cRGB(it.fill)}"${it.opacity != null && it.opacity < 1 ? ` fill-opacity="${it.opacity}"` : ''}${it.role === 'ovb' && ed ? ` data-slot="${it.slot}"` : ''}/>`;
      case 'circle': return `<circle cx="${it.x}" cy="${it.y}" r="${it.r}" fill="${cRGB(it.fill)}" fill-opacity="${it.opacity ?? 1}"/>`;
      case 'frame': return `<rect x="${it.x}" y="${it.y}" width="${it.w}" height="${it.h}" fill="none" stroke="#9aa3ad" stroke-width="0.25"/>`;
      case 'text': return `<text x="${it.x}" y="${it.y}" font-size="${it.size}" font-weight="${it.font === 'bold' ? 600 : 400}" fill="${cRGB(it.fill)}" text-anchor="${it.anchor}">${esc(it.text)}</text>`;
      case 'img': {
        const cid = clipRect(it.clip), pl = it.place;
        return `<g clip-path="url(#${cid})"${ed && !it.mini ? ` data-slot="${it.slot}"${ui.crop === it.slot ? ' class="cropping"' : ''}` : ''}><image href="${url(it.photo, small || it.mini)}" x="${pl.x}" y="${pl.y}" width="${pl.w}" height="${pl.h}" preserveAspectRatio="none"/></g>`;
      }
      case 'empty': {
        const r = it.clip;
        if (!ed) return `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" fill="#dfe3e7"/>`;
        const vis = intersect(r, { x: 0, y: 0, w: W, h: H }) || r, cx = vis.x + vis.w / 2, cy = vis.y + vis.h / 2, s = Math.min(vis.w, vis.h) * .08;
        return `<g class="empty" data-slot="${it.slot}"><rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" fill="#e3e7eb"/>` +
          `<rect x="${vis.x + 2}" y="${vis.y + 2}" width="${Math.max(0, vis.w - 4)}" height="${Math.max(0, vis.h - 4)}" fill="none" stroke="#a7b0ba" stroke-width="0.6" stroke-dasharray="3 2"/>` +
          `<path d="M${cx - s} ${cy}h${2 * s}M${cx} ${cy - s}v${2 * s}" stroke="#7d8793" stroke-width="${s * .18}" stroke-linecap="round"/>` +
          (vis.w > 60 ? `<text x="${cx}" y="${cy + s * 2.2}" font-size="${Math.min(5, s * .7)}" fill="#6b7580" text-anchor="middle">Foto hierher ziehen</text>` : '') + `</g>`;
      }
      case 'block': {
        const inner = it.items.map(x => emit(x, small)).join('');
        if (!ed) return inner;
        return `<g data-block="${it.kind}"><rect x="${it.x - 1.5}" y="${it.y - 1.5}" width="${it.w + 3}" height="${it.h + 3}" fill="transparent"/>${inner}</g>`;
      }
    }
    return '';
  };
  const items = pageItems(p);
  for (const it of items) body.push(emit(it, o.mode === 'thumb'));

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
    if (o.showBind) over += bindingSvg(true);
    // Ausschnitt-Modus: das ganze Foto blass zeigen, auch außerhalb des Rahmens
    const ci = ui.crop != null && items.find(i => i.t === 'img' && i.slot === ui.crop);
    if (ci) {
      const c = ci.clip, pl = ci.place, gid = `${id}g`;
      defs.push(`<clipPath id="${gid}"><path clip-rule="evenodd" d="M${-pad} ${-pad}h${W + 2 * pad}v${H + 2 * pad}h${-(W + 2 * pad)}zM${c.x} ${c.y}v${c.h}h${c.w}v${-c.h}z"/></clipPath>`);
      over += `<g clip-path="url(#${gid})" data-slot="${ui.crop}" class="cropghost"><image href="${url(ci.photo)}" x="${pl.x}" y="${pl.y}" width="${pl.w}" height="${pl.h}" opacity=".38" preserveAspectRatio="none"/></g>`;
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
        if (r.overlay && ui.crop == null) {
          const hs = Math.max(5, Math.min(W, H) * .022);
          over += `<g data-handle="ov" data-slot-h="${r.i}" style="cursor:move"><circle cx="${r.x}" cy="${r.y}" r="${hs}" fill="var(--accent)"/><path d="M${r.x - hs * .6} ${r.y}h${hs * 1.2}M${r.x} ${r.y - hs * .6}v${hs * 1.2}M${r.x - hs * .38} ${r.y - hs * .22}l${-hs * .22} ${hs * .22}l${hs * .22} ${hs * .22}M${r.x + hs * .38} ${r.y - hs * .22}l${hs * .22} ${hs * .22}l${-hs * .22} ${hs * .22}M${r.x - hs * .22} ${r.y - hs * .38}l${hs * .22} ${-hs * .22}l${hs * .22} ${hs * .22}M${r.x - hs * .22} ${r.y + hs * .38}l${hs * .22} ${hs * .22}l${hs * .22} ${-hs * .22}" stroke="#fff" stroke-width="${hs * .13}" stroke-linecap="round" stroke-linejoin="round" fill="none"/></g>`;
          over += `<g data-handle="ovs" data-slot-h="${r.i}" style="cursor:nwse-resize"><rect x="${r.x + r.w - hs * .8}" y="${r.y + r.h - hs * .8}" width="${hs * 1.6}" height="${hs * 1.6}" rx="${hs * .3}" fill="var(--accent)"/></g>`;
        }
      }
    }
  } else if (o.showBind) over += bindingSvg(false);

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
function bindingSvg(ed) {
  const B = S.doc.bind, W = S.doc.w, b = S.doc.bleed;
  let s = '<g pointer-events="none">';
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
