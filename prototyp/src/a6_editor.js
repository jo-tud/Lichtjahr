/* ---------- Bedienung im Seiteneditor ---------- */
function svgPoint(svg, e) {
  const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
  const m = svg.getScreenCTM(); return m ? pt.matrixTransform(m.inverse()) : { x: 0, y: 0 };
}
// Vektor von Seiten- in Fotokoordinaten drehen (Foto ist um rot gedreht)
function unrotate(dx, dy, rot) {
  const t = -(rot || 0) * Math.PI / 180, c = Math.cos(t), s = Math.sin(t);
  return { x: dx * c - dy * s, y: dx * s + dy * c };
}
// Zoomen um einen Punkt: der Bildpunkt unter dem Finger/Mauszeiger bleibt stehen
function zoomAt(r, ph, sl, z, at) {
  const old = placeImage(r, ph, sl), d = unrotate(at.x - old.fx, at.y - old.fy, old.rot);
  const u = old.cx + d.x / old.w, v = old.cy + d.y / old.h;
  sl.zoom = clamp(z, 1, 6);
  const nw = placeImage(r, ph, { ...sl, cx: .5, cy: .5 });
  sl.cx = u - d.x / nw.w; sl.cy = v - d.y / nw.h;
  const pl = placeImage(r, ph, sl); sl.cx = pl.cx; sl.cy = pl.cy;
}
function liveImage(svg, key) {
  const p = curPage(), r = rectOf(p, key), sl = slotOf(p, key), ph = S.photos[sl.photo];
  const pl = placeImage(r, ph, sl);
  for (const img of svg.querySelectorAll(`g[data-slot="${key}"] image`)) {
    img.setAttribute('x', pl.x); img.setAttribute('y', pl.y); img.setAttribute('width', pl.w); img.setAttribute('height', pl.h);
    if (pl.rot) img.setAttribute('transform', `rotate(${pl.rot} ${pl.fx} ${pl.fy})`); else img.removeAttribute('transform');
  }
}
function selectSlot(i) {
  ui.sel = i; ui.selBlock = null; if (ui.crop !== i) ui.crop = null;
  renderEditor(); renderFrameBar();
}
function setCrop(i) {
  const sl = i != null && slotOf(curPage(), i);
  ui.crop = sl && sl.photo && S.photos[sl.photo] ? i : null;
  if (ui.crop != null) { ui.sel = i; ui.selBlock = null; }
  renderEditor(); renderFrameBar();
}
const fitReset = { zoom: 1, cx: .5, cy: .5, rot: 0, fit: 'cover' };
function assignPhoto(slot, id) {
  const p = curPage();
  Object.assign(slotOf(p, slot), { photo: id, ...fitReset });
  ui.sel = slot; ui.armed = null;
  $('#toast').classList.remove('on');
  commit(); renderEditor(); renderFrameBar(); updateThumb(); renderPanelKeepScroll();
}
// Fotos zweier Rahmen tauschen; der Ausschnitt wird neu eingepasst (Rückgängig stellt ihn wieder her)
function swapSlots(a, b) {
  const p = curPage(), A = slotOf(p, a), B = slotOf(p, b);
  [A.photo, B.photo] = [B.photo, A.photo];
  Object.assign(A, fitReset); Object.assign(B, fitReset);
  ui.sel = b; ui.swapFrom = null; ui.crop = null;
  commit(); renderEditor(); renderFrameBar(); updateThumb();
}
// Rahmen bekommt eine eigene Lage; ab jetzt gilt für ihn die Vorlage nicht mehr
function setBox(p, key, box) { slotOf(p, key).box = { x: box.x, y: box.y, w: box.w, h: box.h }; }

/* Einrasten an Seitenrändern, Beschnitt, Außenrand, Mitte und an anderen Rahmen (auch mit Bildabstand) */
function snapTargets(p, key) {
  const d = S.doc, W = d.w, H = d.h, b = d.bleed, m = d.margin, gap = p.gap ?? d.gap;
  const xs = [-b, 0, W / 2, W, W + b], ys = [-b, 0, H / 2, H, H + b];
  if (m > 0) { xs.push(m, W - m); ys.push(m, H - m); }
  for (const r of slotRects(p)) if (r.i !== key) {
    xs.push(r.x, r.x + r.w, r.x - gap, r.x + r.w + gap, r.x + r.w / 2);
    ys.push(r.y, r.y + r.h, r.y - gap, r.y + r.h + gap, r.y + r.h / 2);
  }
  return { xs, ys };
}
function nearest(vals, list, tol) {
  let best = null;
  vals.forEach((v, k) => { for (const t of list) { const d = t - v; if (Math.abs(d) < tol && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, t, k }; } });
  return best;
}
function showGuides(svg, xs, ys) {
  let g = svg.querySelector('#snapguide');
  if (!g) { g = document.createElementNS('http://www.w3.org/2000/svg', 'path'); g.id = 'snapguide'; g.setAttribute('stroke', '#00a0e3'); g.setAttribute('stroke-width', '.4'); g.setAttribute('pointer-events', 'none'); svg.appendChild(g); }
  const W = S.doc.w, H = S.doc.h, b = S.doc.bleed + 6;
  g.setAttribute('d', xs.map(x => `M${x} ${-b}V${H + b}`).join('') + ys.map(y => `M${-b} ${y}H${W + b}`).join(''));
}
const MIN_FRAME = 8;

// Bedienung:
// - Rahmen antippen wählt ihn aus (Eckpunkte erscheinen). Ausgewählten Rahmen ziehen verschiebt ihn.
// - Zweites Antippen oder Doppelklick: Ausschnitt-Modus. Dort Foto ziehen, Mausrad und zwei Finger zoomen.
// - Mit der Maus einen nicht ausgewählten Rahmen mit Foto auf einen anderen ziehen: Fotos tauschen.
function bindEditor(svg) {
  if (!svg) return;
  svg.classList.toggle('locked', ui.crop != null || ui.selBlock != null || ui.sel != null);
  const pointers = new Map();
  let g = null; // laufende Geste
  const tol = () => 7 / (svg.getScreenCTM() ? svg.getScreenCTM().a : 2);

  svg.addEventListener('pointerdown', (e) => {
    if (e.button > 0) return;
    const pt = svgPoint(svg, e);
    pointers.set(e.pointerId, pt);
    const p = curPage();
    if (pointers.size === 2 && g && g.type === 'pan') {
      const [a, b] = [...pointers.values()];
      g.type = 'pinch'; g.d0 = Math.max(15, Math.hypot(a.x - b.x, a.y - b.y)); g.z0 = slotOf(p, g.slot).zoom || 1;
      return;
    }
    const handle = e.target.closest('[data-handle]');
    const block = e.target.closest('[data-block]');
    const slotEl = e.target.closest('[data-slot]');
    const key = slotEl ? keyOf(slotEl.dataset.slot) : null;
    svg.setPointerCapture(e.pointerId);
    if (handle) {
      const k = keyOf(handle.dataset.slotH);
      g = { type: 'resize', corner: handle.dataset.handle, slot: k, start: pt, r0: { ...rectOf(p, k) }, nb: e.altKey ? [] : neighbours(p, k, handle.dataset.handle) };
    } else if (slotEl && ui.crop != null && key === ui.crop) {
      const sl = slotOf(p, key);
      g = { type: 'pan', slot: key, start: pt, cx: sl.cx, cy: sl.cy, moved: false, ghost: !!e.target.closest('.cropghost') };
    } else if (block) {
      // Mit der Maus direkt ziehen; mit dem Finger erst antippen, dann ziehen
      const kind = block.dataset.block;
      const it = pageItems(p).find(x => x.t === 'block' && x.kind === kind);
      g = e.pointerType === 'mouse' || ui.selBlock === kind ? { type: 'block', kind, start: pt, it, el: block, moved: false } : { type: 'selblock', kind, start: pt };
    } else if (slotEl && key === ui.sel && ui.swapFrom == null) {
      // Maus: ausgewählten Rahmen direkt ziehen. Finger: erst lange drücken, damit nichts versehentlich wandert.
      g = { type: e.pointerType === 'mouse' ? 'move' : 'pendmove', slot: key, start: pt, r0: { ...rectOf(p, key) }, moved: false };
    } else if (slotEl) {
      const sl = slotOf(p, key), filled = sl && sl.photo && S.photos[sl.photo], free = filled && ui.swapFrom == null && !ui.armed;
      g = { type: free ? (e.pointerType === 'mouse' ? 'swapdrag' : 'pendswap') : 'tap', slot: key, start: pt, client: { x: e.clientX, y: e.clientY }, moved: false };
    } else { g = { type: 'none', start: pt }; }
    if (g.type === 'pendmove' || g.type === 'pendswap') {
      const gg = g;
      setTimeout(() => {
        if (g !== gg || gg.moved) return;
        gg.type = gg.type === 'pendmove' ? 'move' : 'swapdrag'; gg.lifted = true;
        drag.block = true; svg.classList.add('dragging');
        if (navigator.vibrate) try { navigator.vibrate(12); } catch (err) { /* egal */ }
        if (gg.type === 'move') { const el = svg.querySelector(`g[data-slot="${gg.slot}"]`); if (el) el.style.opacity = '.75'; }
      }, 380);
    }
  });

  svg.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId) || !g) return;
    const pt = svgPoint(svg, e); pointers.set(e.pointerId, pt);
    const p = curPage(), dx = pt.x - g.start.x, dy = pt.y - g.start.y;
    if (!g.moved && Math.hypot(dx, dy) > tol() * .5) {
      g.moved = true;
      if (g.type === 'pendmove' || g.type === 'pendswap') { g.type = 'cancel'; return; }   // vor dem langen Drücken bewegt: scrollen statt ziehen
      if (!['tap', 'none', 'selblock', 'cancel'].includes(g.type)) svg.classList.add('dragging');
    }
    if (g.type === 'cancel') return;
    if (!g.moved && g.type !== 'resize') return;
    if (g.type === 'pan') {
      const r = rectOf(p, g.slot), sl = slotOf(p, g.slot), ph = S.photos[sl.photo], pl = placeImage(r, ph, sl);
      const d = unrotate(dx, dy, pl.rot);
      sl.cx = g.cx - d.x / pl.w; sl.cy = g.cy - d.y / pl.h;
      const c = placeImage(r, ph, sl); sl.cx = c.cx; sl.cy = c.cy;
      liveImage(svg, g.slot);
    } else if (g.type === 'pinch' && pointers.size >= 2) {
      const [a, b] = [...pointers.values()], d = Math.max(15, Math.hypot(a.x - b.x, a.y - b.y));
      const r = rectOf(p, g.slot), sl = slotOf(p, g.slot), ph = S.photos[sl.photo];
      zoomAt(r, ph, sl, g.z0 * d / g.d0, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
      liveImage(svg, g.slot);
    } else if (g.type === 'move') {
      const r0 = g.r0, T = snapTargets(p, g.slot), t = tol();
      let x = r0.x + dx, y = r0.y + dy;
      const sx = nearest([x, x + r0.w / 2, x + r0.w], T.xs, t), sy = nearest([y, y + r0.h / 2, y + r0.h], T.ys, t);
      if (sx) x += sx.d; if (sy) y += sy.d;
      setBox(p, g.slot, { x, y, w: r0.w, h: r0.h });
      renderEditorKeepGesture(svg);
      showGuides(svg, sx ? [sx.t] : [], sy ? [sy.t] : []);
    } else if (g.type === 'resize') {
      if (!g.moved) return;
      const r0 = g.r0, T = snapTargets(p, g.slot), t = tol(), c = g.corner;
      let x0 = r0.x, y0 = r0.y, x1 = r0.x + r0.w, y1 = r0.y + r0.h; const gx = [], gy = [];
      if (c.includes('w')) { x0 = Math.min(x1 - MIN_FRAME, x0 + dx); const s = nearest([x0], T.xs, t); if (s && x1 - s.t >= MIN_FRAME) { x0 = s.t; gx.push(s.t); } }
      if (c.includes('e')) { x1 = Math.max(x0 + MIN_FRAME, x1 + dx); const s = nearest([x1], T.xs, t); if (s && s.t - x0 >= MIN_FRAME) { x1 = s.t; gx.push(s.t); } }
      if (c.includes('n')) { y0 = Math.min(y1 - MIN_FRAME, y0 + dy); const s = nearest([y0], T.ys, t); if (s && y1 - s.t >= MIN_FRAME) { y0 = s.t; gy.push(s.t); } }
      if (c.includes('s')) { y1 = Math.max(y0 + MIN_FRAME, y1 + dy); const s = nearest([y1], T.ys, t); if (s && s.t - y0 >= MIN_FRAME) { y1 = s.t; gy.push(s.t); } }
      // Nachbarn an gemeinsamen Kanten gehen mit, der Bildabstand bleibt gleich (Alt: allein ändern)
      const gap = p.gap ?? S.doc.gap;
      for (const n of g.nb) {
        const b = { ...n.r };
        if (n.edge === 'e') { x1 = Math.min(x1, b.x + b.w - MIN_FRAME - gap); b.w = b.x + b.w - (x1 + gap); b.x = x1 + gap; }
        if (n.edge === 'w') { x0 = Math.max(x0, b.x + MIN_FRAME + gap); b.w = x0 - gap - b.x; }
        if (n.edge === 's') { y1 = Math.min(y1, b.y + b.h - MIN_FRAME - gap); b.h = b.y + b.h - (y1 + gap); b.y = y1 + gap; }
        if (n.edge === 'n') { y0 = Math.max(y0, b.y + MIN_FRAME + gap); b.h = y0 - gap - b.y; }
        setBox(p, n.key, b);
      }
      setBox(p, g.slot, { x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
      renderEditorKeepGesture(svg);
      showGuides(svg, gx, gy);
    } else if (g.type === 'swapdrag') {
      if (!drag.ghost) {
        const sl = slotOf(p, g.slot), gh = document.createElement('div'); gh.className = 'ghost';
        gh.innerHTML = `<img src="${RT.thumb[sl.photo]}" alt="">`; document.body.appendChild(gh); drag.ghost = gh;
      }
      drag.ghost.style.left = e.clientX + 'px'; drag.ghost.style.top = e.clientY + 'px';
      const el = document.elementFromPoint(e.clientX, e.clientY), tgt = el && el.closest('#editor [data-slot]');
      const tk = tgt ? keyOf(tgt.dataset.slot) : null;
      g.target = tk != null && tk !== g.slot ? tk : null;
      highlightSlot(g.target, slotOf(p, g.slot).photo, 'swap');
    } else if (g.type === 'block') {
      const W = S.doc.w, H = S.doc.h, it = g.it;
      let x = clamp(it.x + dx, 0, W - it.w), y = clamp(it.y + dy, 0, H - it.h);
      const gx = [], gy = [];
      if (Math.abs(x + it.w / 2 - W / 2) < 2.5) { x = W / 2 - it.w / 2; gx.push(W / 2); }
      for (const m of [10, 15]) {
        if (Math.abs(x - m) < 1.5) { x = m; gx.push(m); }
        if (Math.abs(x + it.w - (W - m)) < 1.5) { x = W - m - it.w; gx.push(W - m); }
        if (Math.abs(y + it.h - (H - m)) < 1.5) { y = H - m - it.h; gy.push(H - m); }
      }
      g.x = x; g.y = y;
      g.el.setAttribute('transform', `translate(${x - it.x} ${y - it.y})`);
      showGuides(svg, gx, gy);
    }
  });

  const end = (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    if (pointers.size > 0) { if (g && g.type === 'pinch') { const [rest] = [...pointers.values()]; const sl = slotOf(curPage(), g.slot); g = { type: 'pan', slot: g.slot, start: rest, cx: sl.cx, cy: sl.cy, moved: true }; } return; }
    svg.classList.remove('dragging'); drag.block = false;
    const p = curPage(), gg = g; g = null;
    if (!gg || gg.type === 'cancel') return;
    if (gg.type === 'pendmove') gg.type = 'move';
    if (gg.type === 'pendswap') gg.type = 'tap';
    const cancelled = e.type === 'pointercancel';
    if (gg.type === 'swapdrag' && gg.moved) {
      if (drag.ghost) { drag.ghost.remove(); drag.ghost = null; }
      highlightSlot(null);
      if (gg.target != null && !cancelled) swapSlots(gg.slot, gg.target);
      return;
    }
    if (gg.type === 'block' && gg.moved) {
      const it = gg.it, W = S.doc.w, H = S.doc.h;
      const a = { ax: W - it.w > 0 ? gg.x / (W - it.w) : 0, ay: H - it.h > 0 ? gg.y / (H - it.h) : 0 };
      if (gg.kind === 'cal') { const st = calSettings(p).style; p.cal ||= {}; p.cal.pos ||= {}; p.cal.pos[st] = a; }
      else Object.assign(p.title, a);
      commit(); renderEditor(); updateThumb(); if (ui.tab === 'cal') renderPanelKeepScroll();
      return;
    }
    if ((gg.type === 'block' || gg.type === 'selblock') && !gg.moved) {
      ui.selBlock = gg.kind; ui.sel = null; ui.crop = null; renderEditor(); renderFrameBar();
      if (ui.tab !== (gg.kind === 'cal' ? 'cal' : 'title')) { ui.tab = gg.kind === 'cal' ? 'cal' : 'title'; renderPanel(); }
      return;
    }
    if ((gg.type === 'pan' || gg.type === 'pinch') && gg.moved) { commit(); updateThumb(); renderFrameBarMeta(); return; }
    if ((gg.type === 'move' || gg.type === 'resize') && gg.moved) { commit(); renderEditor(); updateThumb(); renderFrameBar(); renderPanelKeepScroll(); return; }
    if (gg.moved) { if (gg.type === 'move' && gg.lifted) renderEditor(); return; }
    // Doppeltippen (Finger) öffnet den Ausschnitt; ein einfacher Klick auf den ausgewählten Rahmen ändert nichts
    const now = Date.now(), dbl = e.pointerType !== 'mouse' && bindEditor._last && bindEditor._last.key === gg.slot && now - bindEditor._last.t < 380;
    bindEditor._last = { key: gg.slot, t: now };
    if (dbl && gg.slot != null) { setCrop(gg.slot); return; }
    if (gg.type === 'move') { if (gg.lifted) renderEditor(); return; }
    if (gg.type === 'tap' || gg.type === 'pan' || gg.type === 'swapdrag') {
      if (ui.swapFrom != null && ui.swapFrom !== gg.slot) { swapSlots(ui.swapFrom, gg.slot); return; }
      if (ui.armed) { placePhoto(gg.slot, ui.armed); return; }
      if (gg.type === 'pan') { if (gg.ghost) setCrop(null); return; } // Antippen außerhalb beendet den Ausschnitt-Modus
      selectSlot(gg.slot);
      const sl = slotOf(p, gg.slot);
      if (!(sl && sl.photo && S.photos[sl.photo]) && ui.tab !== 'photos' && window.innerWidth > 980) { ui.tab = 'photos'; renderPanel(); }
      return;
    }
    if (gg.type === 'none' && (ui.sel != null || ui.selBlock != null || ui.crop != null)) { ui.sel = null; ui.crop = null; ui.selBlock = null; ui.swapFrom = null; renderEditor(); renderFrameBar(); }
  };
  svg.addEventListener('pointerup', end);
  svg.addEventListener('pointercancel', end);
  svg.addEventListener('dblclick', (e) => {
    // Wegen der Zeigerbindung ist das Ziel oft das SVG selbst; daher das Element unter dem Zeiger suchen
    const hit = document.elementFromPoint(e.clientX, e.clientY), slotEl = hit && hit.closest('#editor [data-slot]'); if (!slotEl) return;
    setCrop(keyOf(slotEl.dataset.slot));
  });
  svg.addEventListener('wheel', (e) => {
    if (ui.crop == null) return;                             // ohne Ausschnitt-Modus scrollt die Seite normal
    const slotEl = e.target.closest('[data-slot]'); if (!slotEl || keyOf(slotEl.dataset.slot) !== ui.crop) return;
    const p = curPage(), k = ui.crop, sl = slotOf(p, k), ph = sl && S.photos[sl.photo]; if (!ph) return;
    e.preventDefault();
    zoomAt(rectOf(p, k), ph, sl, (sl.zoom || 1) * Math.exp(-e.deltaY * .0015), svgPoint(svg, e));
    liveImage(svg, k);
    clearTimeout(bindEditor._w); bindEditor._w = setTimeout(() => { commit(); renderEditor(); renderFrameBar(); updateThumb(); }, 350);
  }, { passive: false });
}
// Während einer Geste neu zeichnen, ohne die Zeigerbindung am SVG zu verlieren
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
document.addEventListener('touchmove', (e) => { if (drag.active || drag.block) e.preventDefault(); }, { passive: false });
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
  if (tgt && tgt.dataset.slot != null) { if (drag.hl !== tgt.dataset.slot) { drag.hl = tgt.dataset.slot; highlightSlot(keyOf(tgt.dataset.slot), drag.ids[0]); } }
  else if (drag.hl != null) { drag.hl = null; highlightSlot(null); }
}
// Ziel beim Ziehen zeigen: das neue Foto erscheint als Vorschau im Rahmen
function highlightSlot(key, photoId, mode = 'place') {
  const svg = $('#editor'); if (!svg) return;
  const old = svg.querySelector('#drophl'); if (old) old.remove();
  if (key == null) return;
  const p = curPage(), r = rectOf(p, key); if (!r) return;
  const ph = photoId && S.photos[photoId], sl = slotOf(p, key), replaces = sl && sl.photo && S.photos[sl.photo] && sl.photo !== photoId;
  const NS = 'http://www.w3.org/2000/svg', gEl = document.createElementNS(NS, 'g');
  gEl.id = 'drophl'; gEl.setAttribute('pointer-events', 'none');
  let h = `<clipPath id="drophlc"><rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}"/></clipPath>`;
  if (ph) h += `<g clip-path="url(#drophlc)"><image href="${RT.prev[ph.id] || RT.thumb[ph.id]}" ${imgAttrs(placeImage(r, ph, newSlot()))} preserveAspectRatio="none" opacity=".9"/></g>`;
  h += `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" fill="none" stroke="#c2185b" stroke-width="1.4"/>`;
  const vis = intersect(r, { x: 0, y: 0, w: S.doc.w, h: S.doc.h }) || r, fs = Math.max(3.5, Math.min(7, vis.w / 14));
  const label = mode === 'swap' ? 'Fotos tauschen' : replaces ? 'Ersetzt das Foto' : 'Hier einsetzen';
  h += `<rect x="${vis.x + vis.w / 2 - fs * 4.6}" y="${vis.y + vis.h / 2 - fs * .95}" width="${fs * 9.2}" height="${fs * 1.6}" rx="${fs * .3}" fill="#c2185b"/><text x="${vis.x + vis.w / 2}" y="${vis.y + vis.h / 2 + fs * .2}" font-size="${fs}" fill="#fff" text-anchor="middle" font-weight="600">${label}</text>`;
  gEl.innerHTML = h; svg.appendChild(gEl);
}
document.addEventListener('pointerup', (e) => {
  clearTimeout(drag.lp);
  if (drag.active) {
    const tgt = drag.over;
    drag.ghost.remove(); drag.ghost = null; drag.active = false; drag.hl = null;
    if (tgt && tgt.classList) tgt.classList.remove('over');
    if (tgt && tgt.dataset.slot != null) { highlightSlot(null); placePhoto(keyOf(tgt.dataset.slot), drag.ids[0]); }
    else if (tgt && tgt.dataset.bucket != null) moveToMonth(drag.ids, +tgt.dataset.bucket);
    else highlightSlot(null);
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
    if (ui.sel != null && slotOf(curPage(), ui.sel) && !ui.armed) { placePhoto(ui.sel, id); return; }
    ui.armed = ui.armed === id ? null : id;
    renderPanelKeepScroll(); renderFrameBar();
    if (ui.armed) toast('Jetzt auf einen Rahmen tippen.');
  }
}

/* ---------- Tastatur ---------- */
document.addEventListener('keydown', (e) => {
  const ae = document.activeElement, inField = /INPUT|TEXTAREA|SELECT/.test(ae && ae.tagName) && !(ae.type === 'range' && e.key === 'Escape');
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !inField) { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y' && !inField) { e.preventDefault(); redo(); return; }
  if (inField || ui.view !== 'design') return;
  if (e.key === 'Escape') {
    if (ui.crop != null) ui.crop = null; else { ui.sel = null; ui.selBlock = null; ui.swapFrom = null; ui.armed = null; }
    renderEditor(); renderFrameBar();
  }
  if ((e.key === 'Delete' || e.key === 'Backspace') && ui.sel != null) { ACTIONS.unslot(); }
  // Pfeiltasten verschieben den ausgewählten Rahmen (mit Umschalt in 5-mm-Schritten)
  if (ui.sel != null && ui.crop == null && e.key.startsWith('Arrow') && !e.altKey) {
    e.preventDefault();
    const p = curPage(), r = rectOf(p, ui.sel), st = e.shiftKey ? 5 : .5;
    const dx = e.key === 'ArrowLeft' ? -st : e.key === 'ArrowRight' ? st : 0, dy = e.key === 'ArrowUp' ? -st : e.key === 'ArrowDown' ? st : 0;
    setBox(p, ui.sel, { x: r.x + dx, y: r.y + dy, w: r.w, h: r.h });
    renderEditor(); clearTimeout(bindEditor._k); bindEditor._k = setTimeout(() => { commit(); updateThumb(); renderFrameBar(); }, 400);
  }
  if (e.key === 'PageDown' || (e.key === 'ArrowRight' && e.altKey)) ACTIONS.nextpage();
  if (e.key === 'PageUp' || (e.key === 'ArrowLeft' && e.altKey)) ACTIONS.prevpage();
});

// Rahmen, die an der gezogenen Kante im Bildabstand anliegen (nur Rahmen, die nicht über anderen liegen)
function neighbours(p, key, corner) {
  const r0 = rectOf(p, key), gap = p.gap ?? S.doc.gap, out = [], tol = .8;
  if (r0.overlay) return out;
  for (const r of slotRects(p)) {
    if (r.i === key || r.overlay) continue;
    const vov = r.y < r0.y + r0.h - .5 && r.y + r.h > r0.y + .5, hov = r.x < r0.x + r0.w - .5 && r.x + r.w > r0.x + .5;
    if (corner.includes('e') && vov && Math.abs(r.x - (r0.x + r0.w) - gap) < tol) out.push({ key: r.i, r: { ...r }, edge: 'e' });
    if (corner.includes('w') && vov && Math.abs(r0.x - (r.x + r.w) - gap) < tol) out.push({ key: r.i, r: { ...r }, edge: 'w' });
    if (corner.includes('s') && hov && Math.abs(r.y - (r0.y + r0.h) - gap) < tol) out.push({ key: r.i, r: { ...r }, edge: 's' });
    if (corner.includes('n') && hov && Math.abs(r0.y - (r.y + r.h) - gap) < tol) out.push({ key: r.i, r: { ...r }, edge: 'n' });
  }
  return out;
}
