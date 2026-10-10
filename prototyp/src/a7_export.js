/* ---------- PDF-Entwurf ---------- */
const MAXPX = /iPhone|iPad|Android/i.test(navigator.userAgent) ? 16e6 : 36e6;
const srcCache = { id: null, bmp: null };
async function sourceFor(ph) {
  if (ph.demo) return null;
  const fx = fxOf(ph.id, false), key = ph.id + '|' + fx;          // mit Gegenlicht/Rauschen: Original vom Dienst bearbeitet
  if (srcCache.id === key) return srcCache.bmp;
  if (srcCache.bmp && srcCache.bmp.close) srcCache.bmp.close();
  let blob = fx ? null : RT.file[ph.id];
  if (!blob && SVC.pid) blob = await serviceOriginal(ph, fx);
  if (!blob) { const rec = await DB.get('blobs', blobId(ph)); blob = rec && (rec.file || rec.prev); }
  srcCache.id = key; srcCache.bmp = blob ? await decodeImage(blob) : null;
  return srcCache.bmp;
}
// Rahmeninhalt in Druckauflösung rendern: Foto mit Zoom, Verschiebung und Drehung wie im Editor.
// panels: halbtransparente Flächen, die ins Bild eingerechnet werden (keine PDF-Transparenz)
// rgb: sRGB-JPEG zurückgeben; die Umrechnung nach CMYK übernimmt dann der Dienst mit dem Farbprofil
async function renderCrop(it, dpi, panels = [], rgb = false) {
  const ph = S.photos[it.photo], { clip, place: pl } = it;
  // Pixel pro mm: Zielauflösung, aber nie feiner als das Foto selbst (kein Hochrechnen)
  let k = Math.min(dpi / 25.4, ph.w / pl.w);
  if (clip.w * clip.h * k * k > MAXPX) k = Math.sqrt(MAXPX / (clip.w * clip.h));
  const ow = Math.max(1, Math.round(clip.w * k)), oh = Math.max(1, Math.round(clip.h * k));
  const c = document.createElement('canvas'); c.width = ow; c.height = oh;
  const x = c.getContext('2d', { willReadFrequently: true });
  x.fillStyle = cRGBraw(S.doc.bg); x.fillRect(0, 0, ow, oh); x.imageSmoothingQuality = 'high';
  // Seiten-mm → Canvas-Pixel, dann in Fotokoordinaten (Pixel des Originals)
  x.setTransform(ow / clip.w, 0, 0, oh / clip.h, -clip.x * ow / clip.w, -clip.y * oh / clip.h);
  x.translate(pl.fx, pl.fy); x.rotate((pl.rot || 0) * Math.PI / 180);
  x.scale(pl.w / ph.w, pl.h / ph.h); x.translate(-pl.cx * ph.w, -pl.cy * ph.h);
  // Für den Dienst: welches Foto, welcher Ausschnitt (Zielpixel → Fotopixel). Hat das Original einen größeren
  // Farbraum als sRGB (Display P3 …), rendert der Dienst den Ausschnitt selbst daraus.
  const src = rgb && SVC.pid && !ph.demo ? { asset: SVC.assets[ph.id] ? ph.id : ph.copyOf, m: x.getTransform().inverse(), photo: [ph.w, ph.h], fx: fxOf(ph.id, false) } : null;
  // Bildanpassung des Fotos und (nur Druck-PDF) der Druckausgleich des Profils: auf eigener Ebene, damit
  // Hintergrund und Flächen unverändert bleiben
  const adj = compileAdjust(adjOf(ph.id)), tl = rgb ? printTuneLut() : null;
  const full = adj || tl ? { m: adj ? adj.m : [1, 0, 0, 0, 1, 0, 0, 0, 1], lut: adj ? (tl ? composeLut(adj.lut, tl) : adj.lut) : tl } : null;
  let tx = x, pc = null;
  if (full) { pc = document.createElement('canvas'); pc.width = ow; pc.height = oh; tx = pc.getContext('2d', { willReadFrequently: true }); tx.imageSmoothingQuality = 'high'; tx.setTransform(x.getTransform()); }
  if (ph.demo) drawScene(tx, ph.w, ph.h, ph.demo.seed, ph.demo.m);
  else {
    const bmp = await sourceFor(ph);
    if (bmp) tx.drawImage(srcOf(bmp), 0, 0, ph.w, ph.h);   // auch die Vorschau als Notlösung landet so richtig
  }
  x.setTransform(1, 0, 0, 1, 0, 0);
  if (pc) {
    const id = tx.getImageData(0, 0, ow, oh); applyAdjustPixels(id.data, full); tx.putImageData(id, 0, 0);
    x.drawImage(pc, 0, 0); pc.width = pc.height = 0;
  }
  const pans = [];
  for (const pn of panels) {
    const r = intersect(pn, clip); if (!r) continue;
    const box = [(r.x - clip.x) / clip.w * ow, (r.y - clip.y) / clip.h * oh, r.w / clip.w * ow, r.h / clip.h * oh];
    x.globalAlpha = pn.opacity; x.fillStyle = cRGBraw(pn.fill); x.fillRect(...box); x.globalAlpha = 1;
    pans.push(...box, ...hexRGB(cRGBraw(pn.fill)), pn.opacity);
  }
  if (rgb) {
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', .95));
    c.width = c.height = 0;
    const out = { w: ow, h: oh, jpeg: new Uint8Array(await blob.arrayBuffer()) };
    if (src && src.asset) {
      const m = src.m, n = (v) => String(+v.toFixed(6));   // genauer als pdfNum: Fehler wächst mit der Fotobreite
      out.dict = `/LJSource << /Asset (${src.asset}) /M [${[m.a, m.c, m.e, m.b, m.d, m.f].map(n).join(' ')}] /Photo [${src.photo.join(' ')}] /BG [${hexRGB(cRGBraw(S.doc.bg)).join(' ')}] /Panels [${pans.map(n).join(' ')}]${adj ? ` /AdjM [${adj.m.map(n).join(' ')}] /AdjL [${adj.lut.map(n).join(' ')}]` : ''}${src.fx ? ` /FX (${src.fx})` : ''} >>`;
    }
    return out;
  }
  const rgba = x.getImageData(0, 0, ow, oh).data, cmyk = new Uint8Array(ow * oh * 4);
  for (let i = 0; i < rgba.length; i += 4) {
    const r = rgba[i], g = rgba[i + 1], b = rgba[i + 2], mx = Math.max(r, g, b);
    if (mx === 0) { cmyk[i + 3] = 255; continue; }
    const kk = 255 - mx;
    cmyk[i] = Math.round((mx - r) * 255 / mx); cmyk[i + 1] = Math.round((mx - g) * 255 / mx); cmyk[i + 2] = Math.round((mx - b) * 255 / mx); cmyk[i + 3] = kk;
  }
  c.width = c.height = 0;
  return { w: ow, h: oh, cmyk };
}
const hexRGB = (hex) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
const pdfNum = (v) => (Math.round(v * 1000) / 1000).toString();
const pdfStr = (t) => [...t].map(ch => { const s = String.fromCharCode(winAnsi(ch)); return s === '(' || s === ')' || s === '\\' ? '\\' + s : s; }).join('');
const kop = (id) => (COLORS[id] || COLORS.black).cmyk.map(pdfNum).join(' ');
// Fläche mit Deckkraft a über einer Vektorfläche: Farben vorab mischen
const kmix = (top, a, under) => { const t = (COLORS[top] || COLORS.black).cmyk, u = (COLORS[under] || COLORS.white).cmyk; return t.map((v, i) => pdfNum(a * v + (1 - a) * u[i])).join(' '); };
let lastPdf = null;

// mode 'draft': CMYK mit einfacher Formel, ganz im Browser. 'print': Fotos als sRGB an den lokalen Dienst,
// der sie mit dem Farbprofil der Druckerei umrechnet, ein PDF/X-1a schreibt und es prüft.
async function exportPDF(mode = 'draft') {
  const d = S.doc, keys = pageKeys(), print = mode === 'print';
  if (print && tuneOn()) await loadTune(printerOf());
  const nImg = keys.reduce((n, k) => n + pageItems(S.pages[k]).filter(i => i.t === 'img').length, 0) + (d.index ? 20 : 0);
  const bar = busy(print ? _t('Druck-PDF wird erstellt') : _t('PDF-Entwurf wird erstellt'), _t('Vorbereitung …'));
  let done = 0;
  try {
    const pdf = new PDFWriter(); pdf.begin(); await pdf.addFonts();
    const cm = d.cropMarks ? 10 : 0, off = d.bleed + cm;
    const MW = (d.w + 2 * off) * MM, MH = (d.h + 2 * off) * MM;
    const X = (x) => pdfNum((x + off) * MM), Y = (y) => pdfNum(MH - (y + off) * MM);
    for (let pi = 0; pi < keys.length; pi++) {
      const k = keys[pi], p = S.pages[k], ops = [], images = {};
      if (isBack(k) && d.backRotate) ops.push(`-1 0 0 -1 ${pdfNum(MW)} ${pdfNum(MH)} cm`);
      const flat = [];
      for (const it of pageItems(p, { export: true })) { if (it.t === 'block') flat.push(...it.items); else flat.push(it); }
      const panels = flat.filter(it => it.role === 'panel' && it.opacity < 1);
      const rectOp = (r, color) => `q ${color} k ${X(r.x)} ${Y(r.y + r.h)} ${pdfNum(r.w * MM)} ${pdfNum(r.h * MM)} re f Q`;
      for (const it of flat) {
        if (it.t === 'rect') {
          if (it.role === 'panel' && it.opacity < 1) continue;          // schon eingerechnet
          if (!(it.role === 'bg' && it.fill === 'white')) ops.push(rectOp(it, kop(it.fill)));
          for (const pn of panels) { const r = intersect(pn, it); if (r) ops.push(rectOp(r, kmix(pn.fill, pn.opacity, it.fill))); }
        } else if (it.t === 'circle') {
          const a = '';
          const cx = (it.x + off) * MM, cy = MH - (it.y + off) * MM, r = it.r * MM, c = r * .5523;
          ops.push(`q ${a}${kop(it.fill)} k ${pdfNum(cx + r)} ${pdfNum(cy)} m ${pdfNum(cx + r)} ${pdfNum(cy + c)} ${pdfNum(cx + c)} ${pdfNum(cy + r)} ${pdfNum(cx)} ${pdfNum(cy + r)} c ${pdfNum(cx - c)} ${pdfNum(cy + r)} ${pdfNum(cx - r)} ${pdfNum(cy + c)} ${pdfNum(cx - r)} ${pdfNum(cy)} c ${pdfNum(cx - r)} ${pdfNum(cy - c)} ${pdfNum(cx - c)} ${pdfNum(cy - r)} ${pdfNum(cx)} ${pdfNum(cy - r)} c ${pdfNum(cx + c)} ${pdfNum(cy - r)} ${pdfNum(cx + r)} ${pdfNum(cy - c)} ${pdfNum(cx + r)} ${pdfNum(cy)} c f Q`);
        } else if (it.t === 'frame') {
          ops.push(`q 0 0 0 .4 K .3 w ${X(it.x)} ${Y(it.y + it.h)} ${pdfNum(it.w * MM)} ${pdfNum(it.h * MM)} re S Q`);
        } else if (it.t === 'text') {
          const w = it.ls ? trackedWidth(it.text, it.font, it.size, it.ls) : textWidth(it.text, it.font, it.size);
          const x = it.anchor === 'middle' ? it.x - w / 2 : it.anchor === 'end' ? it.x - w : it.x;
          const bt = `BT /${it.font === 'bold' ? 'F2' : 'F1'} ${pdfNum(it.size * MM)} Tf ${kop(it.fill)} k ${X(x)} ${Y(it.y)} Td (${pdfStr(it.text)}) Tj ET`;
          ops.push(it.ls ? `q ${pdfNum(it.ls * MM)} Tc ${bt} Q` : bt);   // Laufweite gehört zum Grafikzustand: mit q/Q begrenzen
        } else if (it.t === 'img') {
          bar.update(done / nImg, _t('Seite {n} von {total} · {page} · Bild wird umgerechnet', { n: pi + 1, total: keys.length, page: pageLabel(k) }));
          await sleep0();
          const dpi = print ? (it.mini ? 200 : 300) : it.mini ? Math.min(d.dpi, 200) : d.dpi;
          const r = await renderCrop(it, dpi, panels, print);
          const name = 'Im' + Object.keys(images).length;
          if (print) images[name] = pdf.addJpeg(r.jpeg, r.w, r.h, 'DeviceRGB', r.dict);
          else {
            const jpg = await JPEG.encodeCMYK(r.cmyk, r.w, r.h, d.quality, async (f) => { bar.update((done + f) / nImg); await sleep0(); });
            images[name] = pdf.addJpeg(jpg, r.w, r.h);
          }
          const c = it.clip;
          ops.push(`q ${pdfNum(c.w * MM)} 0 0 ${pdfNum(c.h * MM)} ${X(c.x)} ${Y(c.y + c.h)} cm /${name} Do Q`);
          done++;
        }
      }
      if (cm) {
        const t0 = cm * MM, tw = d.w * MM, th = d.h * MM, gap = (d.bleed + 1) * MM, len = 5 * MM, L = [];
        const xs = [t0 + d.bleed * MM, t0 + d.bleed * MM + tw], ys = [t0 + d.bleed * MM, t0 + d.bleed * MM + th];
        for (const x of xs) for (const [y, dir] of [[ys[0], -1], [ys[1], 1]]) L.push(`${pdfNum(x)} ${pdfNum(y + dir * gap)} m ${pdfNum(x)} ${pdfNum(y + dir * (gap + len))} l`);
        for (const y of ys) for (const [x, dir] of [[xs[0], -1], [xs[1], 1]]) L.push(`${pdfNum(x + dir * gap)} ${pdfNum(y)} m ${pdfNum(x + dir * (gap + len))} ${pdfNum(y)} l`);
        ops.push(`q 1 1 1 1 K .25 w ${L.join(' ')} S Q`);
      }
      const bl = cm * MM;
      await pdf.addPage({ media: [0, 0, MW, MH], bleed: [bl, bl, MW - bl, MH - bl], trim: [off * MM, off * MM, MW - off * MM, MH - off * MM], content: ops.join('\n'), images, alphas: [] });
    }
    if (srcCache.bmp && srcCache.bmp.close) srcCache.bmp.close(); srcCache.id = null; srcCache.bmp = null;
    // Titel und Dateiname in der Sprache des Kalenders
    const name = print ? _tc('Familienkalender-{year}-Druck.pdf', { year: d.year }) : _tc('Familienkalender-{year}-Entwurf.pdf', { year: d.year });
    const blob = pdf.finish(_tc('Familienkalender {year}', { year: d.year }));
    if (print) { await printExport(blob, name, bar); return; }
    lastPdf = { blob, name, path: null };
    if (SVC.pid) { bar.update(1, _t('Wird im Projektordner abgelegt …')); lastPdf.path = await serviceExport(blob, name); }
    bar.close();
    showPdfResult();
    if (!lastPdf.path) await savePdf();
  } catch (err) {
    bar.close(); console.error(err);
    toast(_t('Das PDF konnte nicht erstellt werden: {error}', { error: err && err.message || err }), 8000);
  }
}
function showPdfResult() {
  const o = $('#exportOut'); if (!o || !lastPdf) return;
  const where = lastPdf.path ? _t('Im Projektordner: {path}', { path: lastPdf.path }) : lastPdf.name;
  o.innerHTML = `<div class="done-box"><b>${esc(_t('Geschafft: dein Kalender {year} ist fertig.', { year: S.doc.year }))}</b><span class="muted small">${esc(where)} · ${fmt1(lastPdf.blob.size / 1048576)} MB</span>
    <div class="row"><button class="btn small" data-act="savepdf">${lastPdf.path ? _t('Zusätzlich herunterladen') : _t('Erneut speichern')}</button><button class="btn small primary" data-act="wall">${_t('An der Wand ansehen')}</button></div></div>`;
  celebrate();
}
// Kleiner Moment der Freude nach dem Export: Papierschnipsel in den Druckfarben
function celebrate() {
  if (reduceMotion()) return;
  const c = document.createElement('canvas'); c.className = 'confetti'; c.width = innerWidth; c.height = innerHeight;
  document.body.appendChild(c);
  const x = c.getContext('2d'), cols = ['#00a0e3', '#e5007e', '#ffd500', '#1d1d1b'];
  const bits = Array.from({ length: 140 }, () => ({ x: innerWidth / 2 + (Math.random() - .5) * 200, y: innerHeight * .35, vx: (Math.random() - .5) * 12, vy: -Math.random() * 12 - 4, r: Math.random() * 6, vr: (Math.random() - .5) * .3, w: 6 + Math.random() * 6, c: cols[Math.floor(Math.random() * 4)] }));
  const t0 = performance.now();
  const step = (t) => {
    x.clearRect(0, 0, c.width, c.height);
    for (const b of bits) { b.vy += .35; b.vx *= .99; b.x += b.vx; b.y += b.vy; b.r += b.vr; x.save(); x.translate(b.x, b.y); x.rotate(b.r); x.fillStyle = b.c; x.fillRect(-b.w / 2, -2, b.w, 4); x.restore(); }
    if (t - t0 < 2200) requestAnimationFrame(step); else c.remove();
  };
  requestAnimationFrame(step);
}
let downloadsCap = null;
async function savePdf() {
  if (!lastPdf) return;
  const dl = await downloadsCap;
  if (dl) {
    try { await dl.save({ filename: lastPdf.name, data: lastPdf.blob }); toast(_t('PDF gespeichert.')); }
    catch (e) {
      const c = e && e.code;
      if (c === 'declined') toast(_t('Speichern abgebrochen. „Erneut speichern“ öffnet den Dialog wieder.'));
      else if (c === 'rate_limited') toast(_t('Bitte einen Moment warten und erneut speichern.'));
      else fallbackSave();
    }
    return;
  }
  fallbackSave();
}
function fallbackSave() {
  const a = document.createElement('a'); a.href = URL.createObjectURL(lastPdf.blob); a.download = lastPdf.name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
}

/* ---------- Start ---------- */
function injectFonts() {
  const st = document.createElement('style');
  st.textContent = `@font-face{font-family:CalJost;font-weight:400;src:url(data:font/ttf;base64,${FONTS.regular.b64}) format("truetype")}
@font-face{font-family:CalJost;font-weight:600;src:url(data:font/ttf;base64,${FONTS.bold.b64}) format("truetype")}`;
  document.head.appendChild(st);
}
async function loadSaved() {
  const json = await DB.get('kv', 'state');
  if (!json) return false;
  try {
    const o = JSON.parse(json);
    S = { doc: { ...defaultDoc(), ...o.doc }, pages: o.pages || {}, photos: o.photos || {}, demo: !!o.demo };
    // Älterer Stand: „Rückseiten mit Fotos“ entspricht beidseitig mit freien Rückseiten
    if (o.doc && o.doc.backs && o.doc.duplex == null) { S.doc.duplex = true; S.doc.viewMode = 'free'; }
    delete S.doc.backs;
    // Stand aus der Zeit, als es nur Deutsch gab: Kalender bleibt deutsch
    if (o.doc && !o.doc.calLang) S.doc.calLang = 'de';
    for (const [k, p] of Object.entries(S.pages)) if (isBack(k) && p.cal && p.cal.style === 'off' && Object.keys(p.cal).length === 1) p.cal = {};
  } catch (e) { return false; }
  // Gespeicherter Verlauf: Fotos, die er noch kennt, bleiben erhalten (Rückgängig nach dem Neuladen)
  let past = []; try { past = JSON.parse(await DB.get('kv', 'hist') || '[]'); } catch (e) { past = []; }
  const keep = new Set();
  for (const sj of past) { try { const o = JSON.parse(sj); for (const [id, p] of Object.entries(o.photos || {})) { keep.add(id); if (p.copyOf) keep.add(p.copyOf); } } catch (e) { /* egal */ } }
  hist.past = past;
  const ids = await DB.keys('blobs') || [];
  for (const id of ids) {
    const rec = await DB.get('blobs', id);
    if (!S.photos[id] && !keep.has(id) && !Object.values(S.photos).some(p => p.copyOf === id)) { DB.del('blobs', id); continue; }
    if (rec) { setUrls(id, rec.prev, rec.thumb); if (rec.file) RT.file[id] = rec.file; }
  }
  for (const ph of Object.values(S.photos)) if (ph.copyOf && RT.thumb[ph.copyOf]) {
    RT.prev[ph.id] = RT.prev[ph.copyOf]; RT.thumb[ph.id] = RT.thumb[ph.copyOf]; if (RT.file[ph.copyOf]) RT.file[ph.id] = RT.file[ph.copyOf];
  }
  for (const id of Object.keys(S.photos)) if (!RT.thumb[id]) delete S.photos[id];
  return true;
}
async function init() {
  injectFonts();
  applyStaticTexts();
  $('#undo').innerHTML = ICON.undo; $('#redo').innerHTML = ICON.redo;
  try { downloadsCap = window.claude && window.claude.use ? window.claude.use('downloads').catch(() => null) : Promise.resolve(null); } catch (e) { downloadsCap = Promise.resolve(null); }
  $('#vcfIn').addEventListener('change', async (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) importContacts(await f.text()); });
  window.addEventListener('popstate', () => { const v = Object.keys(VIEW_HASH).find(k => '#' + VIEW_HASH[k] === location.hash); if (v && v !== ui.view && !wall.el) setView(v, true); else if (wall.el) closeWall(); });
  $('#fileIn').addEventListener('change', (e) => { const f = [...e.target.files]; e.target.value = ''; if (f.length) { setView('photos'); importFiles(f); } });
  $('#dirIn').addEventListener('change', (e) => { const f = [...e.target.files]; e.target.value = ''; if (f.length) { setView('photos'); importFiles(f); } });
  document.addEventListener('dragover', (e) => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { e.preventDefault(); const z = $('#dropzone'); if (z) z.classList.add('over'); } });
  document.addEventListener('dragleave', (e) => { if (!e.relatedTarget) { const z = $('#dropzone'); if (z) z.classList.remove('over'); } });
  document.addEventListener('drop', async (e) => {
    if (!e.dataTransfer || !e.dataTransfer.files.length) return;
    e.preventDefault(); const z = $('#dropzone'); if (z) z.classList.remove('over');
    const files = await filesFromDrop(e.dataTransfer);
    setView('photos'); importFiles(files);
  });
  await DB.open();
  // Vom lokalen Dienst ausgeliefert? Dann im Projektordner arbeiten (außer ausdrücklich ?browser=1)
  let svc = null;
  if (!new URLSearchParams(location.search).has('browser') && await detectService()) {
    SVC.on = true; serviceEvents();
    svc = await serviceStart();
    if (svc === 'stop') return;
    if (svc === 'browser') SVC.on = false;
  }
  const had = SVC.on ? true : await loadSaved();
  ensurePages();
  if (SVC.on) { try { const v = localStorage.getItem('kw-view'); if (v) ui.view = v; } catch (e) { /* egal */ } if (!Object.keys(S.photos).length) ui.view = 'photos'; }
  else if (!had) { await setupDemo(); if (!S.doc.calLang) S.doc.calLang = LANG; ui.view = 'design'; }
  else { try { const v = localStorage.getItem('kw-view'); if (v) ui.view = v; } catch (e) { /* egal */ } }
  if (!SVC.on) { hist.last = snap(); scheduleSave(); }
  updateUndo();
  if (had) { try { const pg = localStorage.getItem('kw-page'); if (pg && pageKeys().includes(pg)) { ui.page = pg; if (ui.view === 'design') setTimeout(() => toast(_t('Willkommen zurück. Weiter bei {page}.', { page: pageLabel(pg) })), 600); } } catch (e) { /* egal */ } }
  if (document.fonts && document.fonts.load) { try { await Promise.all([document.fonts.load('16px CalJost'), document.fonts.load('600 16px CalJost')]); } catch (e) { /* egal */ } }
  const hv = Object.keys(VIEW_HASH).find(k => '#' + VIEW_HASH[k] === location.hash); if (hv) ui.view = hv;   // Direktlink auf einen Schritt
  try { history.replaceState({ view: ui.view }, '', '#' + VIEW_HASH[ui.view]); } catch (e) { /* egal */ }
  renderAll();
  window.addEventListener('resize', () => { if (ui.view === 'design') renderEditor(); });
}

// Geburtstage aus Kontakten (vCard) oder Kalenderdateien (iCalendar) übernehmen
function importContacts(text) {
  const found = [], un = text.replace(/\r?\n[ \t]/g, '');
  for (const card of un.split(/BEGIN:VCARD/i).slice(1)) {
    const fn = (/^FN[^:]*:(.+)$/im.exec(card) || [])[1], bd = (/^BDAY[^:]*:(.+)$/im.exec(card) || [])[1];
    const m = bd && /(\d{4}|--)-?(\d{2})-?(\d{2})/.exec(bd.trim());
    if (fn && m) found.push({ name: fn.trim().replace(/\\,/g, ','), y: m[1] === '--' || m[1] === '1604' ? '' : m[1], m: +m[2], d: +m[3] });
  }
  for (const ev of un.split(/BEGIN:VEVENT/i).slice(1)) {
    const sum = (/^SUMMARY[^:]*:(.+)$/im.exec(ev) || [])[1], dt = (/^DTSTART[^:]*:(\d{4})(\d{2})(\d{2})/im.exec(ev) || []);
    if (sum && dt[2] && /RRULE:FREQ=YEARLY/i.test(ev)) found.push({ name: birthdayName(sum), y: '', m: +dt[2], d: +dt[3] });
  }
  const have = new Set((S.doc.birthdays || []).map(b => b.name + '|' + b.d + '|' + b.m));
  const add = found.filter(b => !have.has(b.name + '|' + b.d + '|' + b.m));
  for (const b of add) (S.doc.birthdays ||= []).push({ id: uid(), ...b });
  commit(); renderAll();
  toast(add.length ? (add.length === 1 ? _t('1 Geburtstag übernommen.') : _t('{n} Geburtstage übernommen.', { n: add.length })) : _t('In der Datei wurden keine neuen Geburtstage gefunden.'), 5000, add.length ? { label: _t('Rückgängig'), fn: undo } : null);
}
// „Geburtstag von Anna“, „Geburtstag: Anna“, „Birthday of Anna“, „Anna's birthday“ → „Anna“
const birthdayName = (s) => {
  const t = s.trim().replace(/\\,/g, ',');
  const n = t.replace(/^(Geburtstag|Birthday)\b(\s+(von|of)\b)?\s*[:\-–]?\s*/i, '').replace(/['’]s\s+birthday$/i, '').replace(/\s*[-–:]?\s*(Geburtstag|Birthday)$/i, '').trim();
  return n || t;
};
