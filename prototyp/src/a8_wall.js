/* ---------- An der Wand: den fertigen Kalender aufgehängt durchblättern ---------- */
// Eine Ansicht ist, was beim Aufhängen zu sehen ist: unten die Hauptseite, bei „aufgeklappt“ oben die Rückseite des vorigen Blatts.
function wallViews() {
  const mode = viewModeOf(), out = [];
  for (const k of pageKeys()) {
    const v = viewOf(k);
    if (mode === 'opened') {
      if (v.part === 'lower') out.push({ main: k, upper: partnerOf(k), label: `${MONTHS[v.month]} ${S.doc.year}` });
      else if (v.part === 'cover' || v.part === 'blank' || isIndex(k)) out.push({ main: k, upper: null, label: pageLabel(k) });
      continue;
    }
    if (isBack(k)) continue;                                    // Rückseiten zeigt die Ansicht bei „Zweites Motiv“ per Umschalter
    out.push({ main: k, upper: null, alt: mode === 'alternative' && v.part === 'front' ? k + '-b' : null,
      label: v.month != null ? `${MONTHS[v.month]} ${S.doc.year}${v.part === 'more' ? ', weiteres Motiv' : ''}` : pageLabel(k) });
  }
  return out;
}
const wall = { el: null, i: 0, busy: false, showAlt: false };
const reduceMotion = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
function pageSvg(key) { return S.pages[key] ? svgPage(S.pages[key], { mode: 'proof', showBind: true }) : ''; }

function openWall() {
  const views = wallViews(); if (!views.length) return;
  const i = views.findIndex(v => v.main === ui.page || v.upper === ui.page || v.alt === ui.page);
  wall.i = i >= 0 ? i : Math.max(0, views.findIndex(v => pageMonth(v.main) != null));
  wall.showAlt = false;
  const el = document.createElement('div'); el.className = 'wall'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', 'Kalender an der Wand');
  el.innerHTML = `<div class="wall-light" aria-hidden="true"></div>
    <button class="wall-close" data-wall="close" aria-label="Schließen">×</button>
    <div class="wall-stage"><div class="wall-cal" id="wallCal"></div></div>
    <div class="wall-nav">
      <button class="wall-btn" data-wall="prev" aria-label="Vorheriger Monat">‹</button>
      <div class="wall-label"><b id="wallLabel"></b><span id="wallCount"></span></div>
      <button class="wall-btn" data-wall="next" aria-label="Nächster Monat">›</button>
    </div>
    <div class="wall-hint">${matchMedia('(pointer: coarse)').matches ? 'Wischen oder aufs Blatt tippen zum Umblättern' : 'Aufs Blatt klicken, wischen oder Pfeiltasten zum Umblättern · Esc schließt'}</div>`;
  document.body.appendChild(el); wall.el = el;
  document.documentElement.classList.add('wall-open');
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-wall]');
    if (b) { const a = b.dataset.wall; if (a === 'close') closeWall(); else if (a === 'alt') toggleAlt(); else flip(a === 'next' ? 1 : -1); return; }
    if (e.target.closest('.wall-cal') && !wall.swiped) flip(1);
  });
  // Wischen: nach oben oder links blättert weiter, nach unten oder rechts zurück
  let sx = 0, sy = 0;
  el.addEventListener('pointerdown', (e) => { sx = e.clientX; sy = e.clientY; wall.swiped = false; });
  el.addEventListener('pointerup', (e) => {
    const dx = e.clientX - sx, dy = e.clientY - sy;
    if (Math.max(Math.abs(dx), Math.abs(dy)) > 40) { wall.swiped = true; flip((Math.abs(dy) > Math.abs(dx) ? dy : dx) < 0 ? 1 : -1); setTimeout(() => wall.swiped = false, 50); }
  });
  document.addEventListener('keydown', wallKey, true);
  window.addEventListener('resize', renderWall);
  renderWall();
  if (!reduceMotion()) $('#wallCal').animate([{ transform: 'rotate(-1.4deg)' }, { transform: 'rotate(.7deg)' }, { transform: 'rotate(-.25deg)' }, { transform: 'rotate(0)' }], { duration: 1600, easing: 'ease-out' });
  el.querySelector('[data-wall="next"]').focus();
}
function closeWall() {
  if (!wall.el) return;
  wall.el.remove(); wall.el = null;
  document.documentElement.classList.remove('wall-open');
  document.removeEventListener('keydown', wallKey, true);
  window.removeEventListener('resize', renderWall);
}
function wallKey(e) {
  if (!wall.el) return;
  if (e.key === 'Escape') { e.stopPropagation(); closeWall(); }
  else if (['ArrowRight', 'ArrowDown', 'PageDown', ' '].includes(e.key)) { e.preventDefault(); e.stopPropagation(); flip(1); }
  else if (['ArrowLeft', 'ArrowUp', 'PageUp'].includes(e.key)) { e.preventDefault(); e.stopPropagation(); flip(-1); }
}
// Seitengröße so, dass die Ansicht (ein oder zwei Seiten hoch) in den Bildschirm passt
function wallSize(two) {
  const W = S.doc.w, H = S.doc.h, ah = innerHeight * (innerWidth < 600 ? .66 : .74), aw = innerWidth * .9;
  const ph = Math.min(two ? ah / 2 : ah, aw * H / W);
  return { pw: ph * W / H, ph };
}
function wallParts(v) {
  const two = viewModeOf() === 'opened' && v.upper != null;
  return { two, main: wall.showAlt && v.alt ? v.alt : v.main, upper: v.upper };
}
function renderWall() {
  if (!wall.el) return;
  const views = wallViews(); wall.i = clamp(wall.i, 0, views.length - 1);
  const v = views[wall.i], { two, main, upper } = wallParts(v), { pw, ph } = wallSize(viewModeOf() === 'opened');
  const cal = $('#wallCal');
  cal.style.width = pw + 'px';
  cal.innerHTML = (two ? `<div class="wall-sheet" style="height:${ph}px">${pageSvg(upper)}</div>` : viewModeOf() === 'opened' ? `<div class="wall-sheet ghost" style="height:${ph}px"></div>` : '')
    + `<div class="wall-sheet" id="wallMain" style="height:${ph}px">${pageSvg(main)}</div>`
    + wireSvg(pw, ph, viewModeOf() === 'opened' ? ph : 0);
  $('#wallLabel').textContent = v.label + (v.alt ? (wall.showAlt ? ' · Motiv B' : ' · Motiv A') : '');
  $('#wallCount').innerHTML = ` ${wall.i + 1} / ${views.length}${v.alt ? ` <button class="wall-alt" data-wall="alt">Anderes Motiv</button>` : ''}`;
  wall.el.querySelector('[data-wall="prev"]').disabled = wall.i === 0;
  wall.el.querySelector('[data-wall="next"]').disabled = wall.i === views.length - 1;
}
// Drahtbindung (Wire-O) über der Lochreihe; bei „aufgeklappt“ in der Mitte
function wireSvg(pw, ph, y0) {
  const B = S.doc.bind; if (B.type === 'none') return '';
  const k = pw / S.doc.w, c = bindingConf(B.type), loopH = (c.cy + c.hh / 2 + 3) * k * (y0 ? 2 : 1);
  const top = y0 ? y0 - loopH / 2 : -3 * k;
  let s = `<svg class="wall-wire" style="top:${top}px;height:${loopH}px" width="${pw}" height="${loopH}" aria-hidden="true"><defs><linearGradient id="wireg" x1="0" x2="1"><stop offset="0" stop-color="#5d646b"/><stop offset=".45" stop-color="#e9edf0"/><stop offset="1" stop-color="#6d747b"/></linearGradient></defs>`;
  for (const x of holePositions()) {
    for (const dx of [-.9, .9]) s += `<rect x="${(x + dx) * k - .55 * k}" y="${.5 * k}" width="${1.1 * k}" height="${loopH - 1 * k}" rx="${.55 * k}" fill="url(#wireg)"/>`;
  }
  return s + '</svg>';
}
function toggleAlt() {
  if (wall.busy) return;
  const main = $('#wallMain');
  wall.showAlt = !wall.showAlt;
  if (reduceMotion()) { renderWall(); return; }
  wall.busy = true;
  main.animate([{ transform: 'rotateY(0)' }, { transform: 'rotateY(90deg)' }], { duration: 260, easing: 'ease-in' }).finished.then(() => {
    renderWall(); const m2 = $('#wallMain');
    return m2.animate([{ transform: 'rotateY(-90deg)' }, { transform: 'rotateY(0)' }], { duration: 260, easing: 'ease-out' }).finished;
  }).finally(() => { wall.busy = false; });
}
// Umblättern: Das Blatt dreht sich um die Bindung nach oben.
// Aufgeklappt: Die Rückseite der bisherigen Monatsseite wird zum oberen Teil der nächsten Ansicht.
async function flip(dir) {
  const views = wallViews(), j = wall.i + dir;
  if (wall.busy) { wall.queued = dir; return; }                  // schnelle Klicks nicht verschlucken
  if (j < 0 || j >= views.length) return;
  const cur = views[wall.i], nxt = views[j], opened = viewModeOf() === 'opened';
  wall.showAlt = false;
  if (reduceMotion()) { wall.i = j; renderWall(); return; }
  wall.busy = true;
  const { pw, ph } = wallSize(opened), cal = $('#wallCal');
  const a = dir > 0 ? cur : nxt, b = dir > 0 ? nxt : cur;           // a liegt vor b
  // Das Blatt zwischen a und b: vorn die Hauptseite von a, hinten (aufgeklappt) der obere Teil von b.
  // Darunter liegen oben der obere Teil von a und unten die Hauptseite von b.
  const staticUpper = opened ? a.upper : null, leafFront = a.main, leafBack = opened ? b.upper : null;
  cal.innerHTML = (opened ? `<div class="wall-sheet${staticUpper ? '' : ' ghost'}" style="height:${ph}px">${staticUpper ? pageSvg(staticUpper) : ''}</div>` : '')
    + `<div class="wall-sheet" style="height:${ph}px">${pageSvg(b.main)}</div>`
    + wireSvg(pw, ph, opened ? ph : 0)
    + `<div class="wall-leaf" style="top:${opened ? ph : 0}px;height:${ph}px"><div class="face front">${pageSvg(leafFront)}<i class="shade"></i></div><div class="face back">${leafBack ? pageSvg(leafBack) : '<div class="paper-back"></div>'}<i class="shade"></i></div></div>`;
  const leaf = cal.querySelector('.wall-leaf'), shades = cal.querySelectorAll('.shade');
  const frames = dir > 0 ? [{ transform: 'rotateX(0deg)' }, { transform: 'rotateX(180deg)' }] : [{ transform: 'rotateX(180deg)' }, { transform: 'rotateX(0deg)' }];
  const opts = { duration: 950, easing: 'cubic-bezier(.45,.05,.25,1)' };
  const anim = [leaf.animate(frames, opts)];
  shades.forEach(sh => anim.push(sh.animate([{ opacity: 0 }, { opacity: .45 }, { opacity: 0 }], opts)));
  if (!opened) anim.push(leaf.animate(dir > 0 ? [{ opacity: 1 }, { opacity: 1, offset: .7 }, { opacity: 0 }] : [{ opacity: 0 }, { opacity: 1, offset: .3 }, { opacity: 1 }], opts));
  await Promise.all(anim.map(x => x.finished)).catch(() => {});
  wall.i = j; wall.busy = false; renderWall();
  if (wall.queued) { const q = wall.queued; wall.queued = 0; flip(q); }
}

init();
