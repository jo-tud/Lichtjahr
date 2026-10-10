/* ---------- Bedienung im Seiteneditor ---------- */
function svgPoint(svg, e) {
  const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
  const m = svg.getScreenCTM(); return m ? pt.matrixTransform(m.inverse()) : { x: 0, y: 0 };
}
function zoomAt(r, ph, sl, z, at) {
  const old = placeImage(r, ph, sl);
  const u = (at.x - old.x) / old.w, v = (at.y - old.y) / old.h;
  sl.zoom = clamp(z, 1, 6);
  const s = Math.max(r.w / ph.w, r.h / ph.h) * sl.zoom, dw = ph.w * s, dh = ph.h * s;
  const nx = at.x - u * dw, ny = at.y - v * dh;
  sl.cx = (r.x + r.w / 2 - nx) / dw; sl.cy = (r.y + r.h / 2 - ny) / dh;
  const pl = placeImage(r, ph, sl); sl.cx = pl.cx; sl.cy = pl.cy;
}
function liveImage(svg, slot) {
  const p = curPage(), r = slotRects(p).find(r => r.i === slot), sl = p.slots[slot], ph = S.photos[sl.photo];
  const img = svg.querySelector(`g[data-slot="${slot}"] image`); if (!img) return;
  const pl = placeImage(r, ph, sl);
  img.setAttribute('x', pl.x); img.setAttribute('y', pl.y); img.setAttribute('width', pl.w); img.setAttribute('height', pl.h);
}
function selectSlot(i) {
  ui.sel = i; renderEditor(); renderFrameBar();
}
function assignPhoto(slot, id) {
  const p = curPage();
  Object.assign(p.slots[slot], { photo: id, zoom: 1, cx: .5, cy: .5 });
  ui.sel = slot; ui.armed = null;
  $('#toast').classList.remove('on');
  commit(); renderEditor(); renderFrameBar(); updateThumb(); renderPanelKeepScroll();
}
function bindEditor(svg) {
  if (!svg) return;
  const pointers = new Map();
  let g = null; // laufende Geste

  svg.addEventListener('pointerdown', (e) => {
    if (e.button > 0) return;
    const pt = svgPoint(svg, e);
    pointers.set(e.pointerId, pt);
    const p = curPage();
    if (pointers.size === 2 && g && g.type === 'pan') {
      const [a, b] = [...pointers.values()];
      g.type = 'pinch'; g.d0 = Math.hypot(a.x - b.x, a.y - b.y); g.z0 = p.slots[g.slot].zoom || 1;
      return;
    }
    const handle = e.target.closest('[data-handle]');
    const block = e.target.closest('[data-block]');
    const slotEl = e.target.closest('[data-slot]');
    svg.setPointerCapture(e.pointerId);
    if (handle) {
      const i = +handle.dataset.slotH, r = slotRects(p).find(r => r.i === i), L = layoutById(p.layout), base = L.ov[i - L.slots.length];
      const o = p.ov[i] ||= { x: base[0], y: base[1], s: 1 };
      g = { type: handle.dataset.handle, slot: i, start: pt, o0: { ...o }, r0: r };
    } else if (block) {
      const it = pageItems(p).find(x => x.t === 'block' && x.kind === block.dataset.block);
      g = { type: 'block', kind: block.dataset.block, start: pt, it, el: block, moved: false };
    } else if (slotEl) {
      const i = +slotEl.dataset.slot, sl = p.slots[i];
      g = { type: sl && sl.photo && S.photos[sl.photo] ? 'pan' : 'tap', slot: i, start: pt, cx: sl.cx, cy: sl.cy, moved: false };
    } else { g = { type: 'none', start: pt }; }
  });
  svg.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId) || !g) return;
    const pt = svgPoint(svg, e); pointers.set(e.pointerId, pt);
    const p = curPage(), dx = pt.x - g.start.x, dy = pt.y - g.start.y;
    if (!g.moved && Math.hypot(dx, dy) > 1.2) { g.moved = true; svg.classList.add('dragging'); }
    if (!g.moved) return;
    if (g.type === 'pan') {
      const r = slotRects(p).find(r => r.i === g.slot), sl = p.slots[g.slot], ph = S.photos[sl.photo];
      const pl = placeImage(r, ph, sl);
      sl.cx = g.cx - dx / pl.w; sl.cy = g.cy - dy / pl.h;
      const c = placeImage(r, ph, sl); sl.cx = c.cx; sl.cy = c.cy;
      liveImage(svg, g.slot);
    } else if (g.type === 'pinch' && pointers.size >= 2) {
      const [a, b] = [...pointers.values()], d = Math.hypot(a.x - b.x, a.y - b.y);
      const r = slotRects(p).find(r => r.i === g.slot), sl = p.slots[g.slot], ph = S.photos[sl.photo];
      zoomAt(r, ph, sl, g.z0 * d / g.d0, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
      liveImage(svg, g.slot);
    } else if (g.type === 'block') {
      const W = S.doc.w, H = S.doc.h, it = g.it;
      let x = clamp(it.x + dx, 0, W - it.w), y = clamp(it.y + dy, 0, H - it.h);
      const snaps = [];
      if (Math.abs(x + it.w / 2 - W / 2) < 2.5) { x = W / 2 - it.w / 2; snaps.push(`M${W / 2} 0V${H}`); }
      for (const m of [10, 15]) {
        if (Math.abs(x - m) < 1.5) { x = m; snaps.push(`M${m} 0V${H}`); }
        if (Math.abs(x + it.w - (W - m)) < 1.5) { x = W - m - it.w; snaps.push(`M${W - m} 0V${H}`); }
        if (Math.abs(y + it.h - (H - m)) < 1.5) { y = H - m - it.h; snaps.push(`M0 ${H - m}H${W}`); }
      }
      g.x = x; g.y = y;
      g.el.setAttribute('transform', `translate(${x - it.x} ${y - it.y})`);
      let guide = svg.querySelector('#snapguide');
      if (!guide) { guide = document.createElementNS('http://www.w3.org/2000/svg', 'path'); guide.id = 'snapguide'; guide.setAttribute('stroke', '#00a0e3'); guide.setAttribute('stroke-width', '.4'); guide.setAttribute('pointer-events', 'none'); svg.appendChild(guide); }
      guide.setAttribute('d', snaps.join(''));
    } else if (g.type === 'ov') {
      const W = S.doc.w, H = S.doc.h, m = S.doc.margin, cw = W - 2 * m, ch = H - 2 * m, o = p.ov[g.slot];
      o.x = clamp(g.o0.x + dx / cw, -.2, 1); o.y = clamp(g.o0.y + dy / ch, -.2, 1);
      renderEditorKeepGesture(svg);
    } else if (g.type === 'ovs') {
      const o = p.ov[g.slot], r0 = g.r0, s0 = g.o0.s ?? 1;
      o.s = clamp(s0 * Math.max((r0.w + dx) / r0.w, (r0.h + dy) / r0.h), .4, 2);
      renderEditorKeepGesture(svg);
    }
  });
  const end = (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    if (pointers.size > 0) { if (g && g.type === 'pinch') { const [rest] = [...pointers.values()]; const sl = curPage().slots[g.slot]; g = { type: 'pan', slot: g.slot, start: rest, cx: sl.cx, cy: sl.cy, moved: true }; } return; }
    svg.classList.remove('dragging');
    const p = curPage(), gg = g; g = null;
    if (!gg) return;
    if (gg.type === 'block' && gg.moved) {
      const it = gg.it, W = S.doc.w, H = S.doc.h;
      const a = { ax: W - it.w > 0 ? gg.x / (W - it.w) : 0, ay: H - it.h > 0 ? gg.y / (H - it.h) : 0 };
      if (gg.kind === 'cal') { const st = calSettings(p).style; p.cal ||= {}; p.cal.pos ||= {}; p.cal.pos[st] = a; }
      else Object.assign(p.title, a);
      commit(); renderEditor(); updateThumb(); if (ui.tab === 'cal') renderPanelKeepScroll();
      return;
    }
    if ((gg.type === 'pan' || gg.type === 'pinch') && gg.moved) { commit(); updateThumb(); renderFrameBarMeta(); return; }
    if (gg.type === 'ov' || gg.type === 'ovs') { commit(); renderEditor(); updateThumb(); renderFrameBar(); return; }
    if (!gg.moved && (gg.type === 'pan' || gg.type === 'tap')) {
      if (ui.swapFrom != null && ui.swapFrom !== gg.slot) {
        const a = p.slots[ui.swapFrom], b = p.slots[gg.slot];
        [a.photo, b.photo] = [b.photo, a.photo]; Object.assign(a, { zoom: 1, cx: .5, cy: .5 }); Object.assign(b, { zoom: 1, cx: .5, cy: .5 });
        ui.swapFrom = null; ui.sel = gg.slot; commit(); renderEditor(); renderFrameBar(); updateThumb(); return;
      }
      if (ui.armed) { assignPhoto(gg.slot, ui.armed); return; }
      selectSlot(ui.sel === gg.slot && gg.type === 'pan' ? gg.slot : gg.slot);
      if (gg.type === 'tap' && ui.tab !== 'photos' && window.innerWidth > 980) { ui.tab = 'photos'; renderPanel(); }
      return;
    }
    if (gg.type === 'none' && !gg.moved && ui.sel != null) { ui.sel = null; ui.swapFrom = null; renderEditor(); renderFrameBar(); }
  };
  svg.addEventListener('pointerup', end);
  svg.addEventListener('pointercancel', end);
  svg.addEventListener('wheel', (e) => {
    const slotEl = e.target.closest('[data-slot]'); if (!slotEl) return;
    const p = curPage(), i = +slotEl.dataset.slot, sl = p.slots[i], ph = sl && S.photos[sl.photo]; if (!ph) return;
    e.preventDefault();
    const r = slotRects(p).find(r => r.i === i);
    zoomAt(r, ph, sl, (sl.zoom || 1) * Math.exp(-e.deltaY * .0015), svgPoint(svg, e));
    liveImage(svg, i);
    if (ui.sel !== i) { ui.sel = i; }
    clearTimeout(bindEditor._w); bindEditor._w = setTimeout(() => { commit(); renderEditor(); renderFrameBar(); updateThumb(); }, 350);
  }, { passive: false });
}
// Einleger verschieben: neu zeichnen, ohne die Geste zu verlieren
function renderEditorKeepGesture(svg) {
  const fresh = new DOMParser().parseFromString(svgPage(curPage(), { mode: 'editor', showBleed: ui.showBleed, showBind: ui.showBind, showGuides: ui.showGuides }), 'image/svg+xml').documentElement;
  svg.innerHTML = fresh.innerHTML;
}

/* ---------- Fotos ziehen (Leiste rechts und Monatsübersicht) ---------- */
const drag = { pend: null, active: false, ghost: null, ids: [], over: null };
document.addEventListener('pointerdown', (e) => {
  const t = e.target.closest('.thumb[data-photo]'); if (!t || e.button > 0) return;
  const id = t.dataset.photo;
  drag.pend = { x: e.clientX, y: e.clientY, id, el: t, type: e.pointerType, t0: Date.now(), pid: e.pointerId };
  if (e.pointerType !== 'mouse') {
    clearTimeout(drag.lp);
    drag.lp = setTimeout(() => { if (drag.pend && drag.pend.id === id) startDrag(e.clientX, e.clientY); }, 380);
  }
});
document.addEventListener('pointermove', (e) => {
  if (drag.active) { moveDrag(e.clientX, e.clientY); return; }
  const p = drag.pend; if (!p) return;
  const d = Math.hypot(e.clientX - p.x, e.clientY - p.y);
  if (p.type === 'mouse' && d > 6) startDrag(e.clientX, e.clientY);
  else if (p.type !== 'mouse' && d > 10) { clearTimeout(drag.lp); drag.pend = null; }
});
document.addEventListener('touchmove', (e) => { if (drag.active) e.preventDefault(); }, { passive: false });
document.addEventListener('contextmenu', (e) => { if (e.target.closest('.thumb')) e.preventDefault(); });
function startDrag(x, y) {
  const p = drag.pend; if (!p) return;
  drag.active = true; drag.suppressClick = true;
  drag.ids = ui.view === 'photos' && ui.photoSel.has(p.id) ? [...ui.photoSel] : [p.id];
  const g = document.createElement('div'); g.className = 'ghost';
  g.innerHTML = `<img src="${RT.thumb[p.id]}" alt="">${drag.ids.length > 1 ? `<span>${drag.ids.length}</span>` : ''}`;
  document.body.appendChild(g); drag.ghost = g;
  if (navigator.vibrate) try { navigator.vibrate(15); } catch (e) { /* egal */ }
  moveDrag(x, y);
}
function moveDrag(x, y) {
  drag.ghost.style.left = x + 'px'; drag.ghost.style.top = y + 'px';
  const el = document.elementFromPoint(x, y);
  const tgt = el && (el.closest('#editor [data-slot]') || el.closest('[data-bucket]'));
  if (drag.over && drag.over !== tgt) drag.over.classList && drag.over.classList.remove('over');
  drag.over = tgt;
  if (tgt && tgt.dataset.bucket != null) tgt.classList.add('over');
  if (tgt && tgt.dataset.slot != null) { if (drag.hl !== tgt.dataset.slot) { drag.hl = tgt.dataset.slot; highlightSlot(+tgt.dataset.slot); } }
  else if (drag.hl != null) { drag.hl = null; highlightSlot(null); }
}
function highlightSlot(i) {
  const svg = $('#editor'); if (!svg) return;
  let h = svg.querySelector('#drophl');
  if (i == null) { if (h) h.remove(); return; }
  const r = slotRects(curPage()).find(r => r.i === i); if (!r) return;
  if (!h) { h = document.createElementNS('http://www.w3.org/2000/svg', 'rect'); h.id = 'drophl'; h.setAttribute('fill', '#c2185b'); h.setAttribute('fill-opacity', '.25'); h.setAttribute('stroke', '#c2185b'); h.setAttribute('stroke-width', '1.2'); h.setAttribute('pointer-events', 'none'); svg.appendChild(h); }
  h.setAttribute('x', r.x); h.setAttribute('y', r.y); h.setAttribute('width', r.w); h.setAttribute('height', r.h);
}
document.addEventListener('pointerup', (e) => {
  clearTimeout(drag.lp);
  if (drag.active) {
    const tgt = drag.over;
    drag.ghost.remove(); drag.ghost = null; drag.active = false; drag.hl = null;
    if (tgt && tgt.classList) tgt.classList.remove('over');
    if (tgt && tgt.dataset.slot != null) assignPhoto(+tgt.dataset.slot, drag.ids[0]);
    else if (tgt && tgt.dataset.bucket != null) {
      const m = +tgt.dataset.bucket;
      for (const id of drag.ids) { S.photos[id].month = m; S.photos[id].src = 'von Hand'; }
      commit(); renderPhotos();
    } else highlightSlot(null);
    drag.pend = null; drag.over = null;
    setTimeout(() => drag.suppressClick = false, 50);
    return;
  }
  const p = drag.pend; drag.pend = null;
  if (p && e.target.closest('.thumb[data-photo]') === p.el) photoTap(p.id, e);
});
document.addEventListener('pointercancel', () => { clearTimeout(drag.lp); if (drag.active) { drag.ghost.remove(); drag.active = false; highlightSlot(null); } drag.pend = null; });
function photoTap(id, e) {
  if (ui.view === 'photos') {
    if (ui.photoSel.has(id)) { ui.photoSel.delete(id); if (ui.photoFocus === id) ui.photoFocus = [...ui.photoSel].pop() || null; }
    else { ui.photoSel.add(id); ui.photoFocus = id; }
    renderPhotos();
  } else if (ui.view === 'design') {
    if (ui.sel != null && curPage().slots[ui.sel] && !ui.armed) { assignPhoto(ui.sel, id); return; }
    ui.armed = ui.armed === id ? null : id;
    renderPanelKeepScroll(); renderFrameBar();
    if (ui.armed) toast('Jetzt auf einen Rahmen tippen.');
  }
}

/* ---------- Tastatur ---------- */
document.addEventListener('keydown', (e) => {
  const inField = /INPUT|TEXTAREA|SELECT/.test(document.activeElement && document.activeElement.tagName);
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !inField) { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y' && !inField) { e.preventDefault(); redo(); return; }
  if (inField || ui.view !== 'design') return;
  if (e.key === 'Escape') { ui.sel = null; ui.swapFrom = null; ui.armed = null; renderEditor(); renderFrameBar(); }
  if ((e.key === 'Delete' || e.key === 'Backspace') && ui.sel != null) { ACTIONS.unslot(); }
  if (e.key === 'PageDown' || (e.key === 'ArrowRight' && e.altKey)) ACTIONS.nextpage();
  if (e.key === 'PageUp' || (e.key === 'ArrowLeft' && e.altKey)) ACTIONS.prevpage();
});
