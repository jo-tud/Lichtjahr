/* ---------- Druck-PDF ---------- */
const MAXPX = /iPhone|iPad|Android/i.test(navigator.userAgent) ? 16e6 : 36e6;
const srcCache = { id: null, bmp: null };
async function sourceFor(ph) {
  if (ph.demo) return null;
  if (srcCache.id === ph.id) return srcCache.bmp;
  if (srcCache.bmp && srcCache.bmp.close) srcCache.bmp.close();
  let blob = RT.file[ph.id];
  if (!blob) { const rec = await DB.get('blobs', ph.id); blob = rec && (rec.file || rec.prev); }
  srcCache.id = ph.id; srcCache.bmp = blob ? await decodeImage(blob) : null;
  return srcCache.bmp;
}
async function renderCrop(it, dpi) {
  const ph = S.photos[it.photo], { clip, place } = it;
  const sx = (clip.x - place.x) / place.w * ph.w, sy = (clip.y - place.y) / place.h * ph.h;
  const sw = clip.w / place.w * ph.w, sh = clip.h / place.h * ph.h;
  let ow = clip.w / 25.4 * dpi, oh = clip.h / 25.4 * dpi;
  const k = Math.min(1, sw / ow); ow *= k; oh *= k;              // nie hochrechnen
  if (ow * oh > MAXPX) { const f = Math.sqrt(MAXPX / (ow * oh)); ow *= f; oh *= f; }
  ow = Math.max(1, Math.round(ow)); oh = Math.max(1, Math.round(oh));
  const c = document.createElement('canvas'); c.width = ow; c.height = oh;
  const x = c.getContext('2d', { willReadFrequently: true });
  x.fillStyle = '#fff'; x.fillRect(0, 0, ow, oh); x.imageSmoothingQuality = 'high';
  if (ph.demo) {
    x.setTransform(ow / sw, 0, 0, oh / sh, -sx * ow / sw, -sy * oh / sh);
    drawScene(x, ph.w, ph.h, ph.demo.seed, ph.demo.m);
  } else {
    const bmp = await sourceFor(ph);
    if (bmp) {
      const sc = bmp.width / ph.w; // Vorschau als Notlösung, falls das Original fehlt
      x.drawImage(srcOf(bmp), sx * sc, sy * sc, sw * sc, sh * sc, 0, 0, ow, oh);
    }
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
const pdfNum = (v) => (Math.round(v * 1000) / 1000).toString();
const pdfStr = (t) => [...t].map(ch => { const s = String.fromCharCode(winAnsi(ch)); return s === '(' || s === ')' || s === '\\' ? '\\' + s : s; }).join('');
const kop = (id) => (COLORS[id] || COLORS.black).cmyk.map(pdfNum).join(' ');
let lastPdf = null;

async function exportPDF() {
  const d = S.doc, keys = pageKeys();
  const nImg = keys.reduce((n, k) => n + pageItems(S.pages[k]).filter(i => i.t === 'img').length, 0) + (d.index ? 20 : 0);
  const bar = busy('Druck-PDF wird erstellt', 'Vorbereitung …');
  let done = 0;
  try {
    const pdf = new PDFWriter(); pdf.begin(); await pdf.addFonts();
    const cm = d.cropMarks ? 10 : 0, off = d.bleed + cm;
    const MW = (d.w + 2 * off) * MM, MH = (d.h + 2 * off) * MM;
    const X = (x) => pdfNum((x + off) * MM), Y = (y) => pdfNum(MH - (y + off) * MM);
    for (let pi = 0; pi < keys.length; pi++) {
      const k = keys[pi], p = S.pages[k], ops = [], images = {}, alphas = new Set();
      if (isBack(k) && d.backRotate) ops.push(`-1 0 0 -1 ${pdfNum(MW)} ${pdfNum(MH)} cm`);
      const flat = [];
      for (const it of pageItems(p, { export: true })) { if (it.t === 'block') flat.push(...it.items); else flat.push(it); }
      for (const it of flat) {
        if (it.t === 'rect') {
          if (it.role === 'bg' && it.fill === 'white') continue;
          let a = ''; if (it.opacity != null && it.opacity < 1) { const n = Math.round(it.opacity * 100); alphas.add(n / 100); a = `/GA${n} gs `; }
          ops.push(`q ${a}${kop(it.fill)} k ${X(it.x)} ${Y(it.y + it.h)} ${pdfNum(it.w * MM)} ${pdfNum(it.h * MM)} re f Q`);
        } else if (it.t === 'circle') {
          const n = Math.round((it.opacity ?? 1) * 100); let a = ''; if (n < 100) { alphas.add(n / 100); a = `/GA${n} gs `; }
          const cx = (it.x + off) * MM, cy = MH - (it.y + off) * MM, r = it.r * MM, c = r * .5523;
          ops.push(`q ${a}${kop(it.fill)} k ${pdfNum(cx + r)} ${pdfNum(cy)} m ${pdfNum(cx + r)} ${pdfNum(cy + c)} ${pdfNum(cx + c)} ${pdfNum(cy + r)} ${pdfNum(cx)} ${pdfNum(cy + r)} c ${pdfNum(cx - c)} ${pdfNum(cy + r)} ${pdfNum(cx - r)} ${pdfNum(cy + c)} ${pdfNum(cx - r)} ${pdfNum(cy)} c ${pdfNum(cx - r)} ${pdfNum(cy - c)} ${pdfNum(cx - c)} ${pdfNum(cy - r)} ${pdfNum(cx)} ${pdfNum(cy - r)} c ${pdfNum(cx + c)} ${pdfNum(cy - r)} ${pdfNum(cx + r)} ${pdfNum(cy - c)} ${pdfNum(cx + r)} ${pdfNum(cy)} c f Q`);
        } else if (it.t === 'frame') {
          ops.push(`q 0 0 0 .4 K .3 w ${X(it.x)} ${Y(it.y + it.h)} ${pdfNum(it.w * MM)} ${pdfNum(it.h * MM)} re S Q`);
        } else if (it.t === 'text') {
          const w = textWidth(it.text, it.font, it.size);
          const x = it.anchor === 'middle' ? it.x - w / 2 : it.anchor === 'end' ? it.x - w : it.x;
          ops.push(`BT /${it.font === 'bold' ? 'F2' : 'F1'} ${pdfNum(it.size * MM)} Tf ${kop(it.fill)} k ${X(x)} ${Y(it.y)} Td (${pdfStr(it.text)}) Tj ET`);
        } else if (it.t === 'img') {
          bar.update(done / nImg, `Seite ${pi + 1} von ${keys.length} · ${pageLabel(k)} · Bild wird umgerechnet`);
          await sleep0();
          const dpi = it.mini ? Math.min(d.dpi, 200) : d.dpi;
          const r = await renderCrop(it, dpi);
          const jpg = await JPEG.encodeCMYK(r.cmyk, r.w, r.h, d.quality, async (f) => { bar.update((done + f) / nImg); await sleep0(); });
          const name = 'Im' + Object.keys(images).length;
          images[name] = pdf.addJpeg(jpg, r.w, r.h);
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
      await pdf.addPage({ media: [0, 0, MW, MH], bleed: [bl, bl, MW - bl, MH - bl], trim: [off * MM, off * MM, MW - off * MM, MH - off * MM], content: ops.join('\n'), images, alphas: [...alphas] });
    }
    if (srcCache.bmp && srcCache.bmp.close) srcCache.bmp.close(); srcCache.id = null; srcCache.bmp = null;
    const name = `Familienkalender-${d.year}-CMYK.pdf`;
    const blob = pdf.finish(`Familienkalender ${d.year}`);
    lastPdf = { blob, name };
    bar.close();
    showPdfResult();
    await savePdf();
  } catch (err) {
    bar.close(); console.error(err);
    toast('Das PDF konnte nicht erstellt werden: ' + (err && err.message || err), 8000);
  }
}
function showPdfResult() {
  const o = $('#exportOut'); if (!o || !lastPdf) return;
  o.innerHTML = `<div class="row"><span class="pill ok">Fertig · ${fmt1(lastPdf.blob.size / 1048576)} MB</span><button class="btn small" data-act="savepdf">Erneut speichern</button></div>`;
}
let downloadsCap = null;
async function savePdf() {
  if (!lastPdf) return;
  const dl = await downloadsCap;
  if (dl) {
    try { await dl.save({ filename: lastPdf.name, data: lastPdf.blob }); toast('PDF gespeichert.'); }
    catch (e) {
      const c = e && e.code;
      if (c === 'declined') toast('Speichern abgebrochen. „Erneut speichern“ öffnet den Dialog wieder.');
      else if (c === 'rate_limited') toast('Bitte einen Moment warten und erneut speichern.');
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
  } catch (e) { return false; }
  const ids = await DB.keys('blobs') || [];
  for (const id of ids) {
    const rec = await DB.get('blobs', id);
    if (!S.photos[id]) { DB.del('blobs', id); continue; }
    if (rec) { setUrls(id, rec.prev, rec.thumb); if (rec.file) RT.file[id] = rec.file; }
  }
  for (const id of Object.keys(S.photos)) if (!RT.thumb[id]) delete S.photos[id];
  return true;
}
async function init() {
  injectFonts();
  $('#undo').innerHTML = ICON.undo; $('#redo').innerHTML = ICON.redo;
  try { downloadsCap = window.claude && window.claude.use ? window.claude.use('downloads').catch(() => null) : Promise.resolve(null); } catch (e) { downloadsCap = Promise.resolve(null); }
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
  const had = await loadSaved();
  ensurePages();
  if (!had) { await setupDemo(); ui.view = 'design'; }
  else { try { const v = localStorage.getItem('kw-view'); if (v) ui.view = v; } catch (e) { /* egal */ } }
  hist.last = snap(); scheduleSave();
  if (document.fonts && document.fonts.load) { try { await Promise.all([document.fonts.load('16px CalJost'), document.fonts.load('600 16px CalJost')]); } catch (e) { /* egal */ } }
  renderAll();
  window.addEventListener('resize', () => { if (ui.view === 'design') renderEditor(); });
}
init();
