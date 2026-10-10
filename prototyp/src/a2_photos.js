/* ---------- Fotos: Monat erkennen ---------- */
async function exifDate(file) {
  const buf = await file.slice(0, 256 * 1024).arrayBuffer();
  const v = new DataView(buf);
  if (v.byteLength < 4 || v.getUint16(0) !== 0xFFD8) return null;
  let off = 2;
  while (off + 4 <= v.byteLength) {
    const marker = v.getUint16(off); off += 2;
    if ((marker & 0xFF00) !== 0xFF00 || marker === 0xFFDA) break;
    const len = v.getUint16(off);
    if (marker === 0xFFE1 && off + 8 < v.byteLength && v.getUint32(off + 2) === 0x45786966) return parseTiff(v, off + 8);
    off += len;
  }
  return null;
}
function parseTiff(v, t) {
  const le = v.getUint16(t) === 0x4949;
  const u16 = (o) => v.getUint16(t + o, le), u32 = (o) => v.getUint32(t + o, le);
  const str = (e) => {
    const n = u32(e + 4), o = n > 4 ? u32(e + 8) : e + 8; let s = '';
    for (let i = 0; i < n - 1 && t + o + i < v.byteLength; i++) s += String.fromCharCode(v.getUint8(t + o + i));
    return s;
  };
  const scan = (ifd, tags) => {
    const out = {}; if (t + ifd + 2 > v.byteLength) return out;
    const n = u16(ifd);
    for (let i = 0; i < n; i++) {
      const e = ifd + 2 + i * 12; if (t + e + 12 > v.byteLength) break;
      const tag = u16(e); if (tags.includes(tag)) out[tag] = e;
    }
    return out;
  };
  const ifd0 = scan(u32(4), [0x8769, 0x0132]);
  let s = null;
  if (ifd0[0x8769] != null) {
    const ex = scan(u32(ifd0[0x8769] + 8), [0x9003, 0x9004]);
    if (ex[0x9003] != null) s = str(ex[0x9003]); else if (ex[0x9004] != null) s = str(ex[0x9004]);
  }
  if (!s && ifd0[0x0132] != null) s = str(ifd0[0x0132]);
  const m = s && /^(\d{4}):(\d{2}):(\d{2})/.exec(s);
  if (!m || +m[1] < 1900 || +m[2] < 1 || +m[2] > 12) return null;
  return new Date(+m[1], +m[2] - 1, +m[3]);
}
function dateFromName(name) {
  const m = /(?:^|\D)((?:19|20)\d{2})[-_.]?(0[1-9]|1[0-2])[-_.]?(0[1-9]|[12]\d|3[01])(?:\D|$)/.exec(name);
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
}
const MONTH_WORDS = [
  ['januar', 'jänner', 'jaenner', 'january', 'jan'], ['februar', 'feber', 'february', 'feb'], ['märz', 'maerz', 'march', 'mär', 'mrz', 'mar'],
  ['april', 'apr'], ['mai', 'may'], ['juni', 'june', 'jun'], ['juli', 'july', 'jul'], ['august', 'aug'],
  ['september', 'sept', 'sep'], ['oktober', 'october', 'okt', 'oct'], ['november', 'nov'], ['dezember', 'december', 'dez', 'dec'],
];
function monthFromPath(path) {
  const segs = path.split('/').slice(0, -1).reverse();
  for (const raw of segs) {
    const s = raw.toLowerCase();
    let m = /(?:^|\D)(?:19|20)\d{2}[-_ .](0[1-9]|1[0-2])(?:\D|$)/.exec(s);
    if (m) return +m[1] - 1;
    m = /^(0?[1-9]|1[0-2])(?:[ _.\-]|$)/.exec(s);
    if (m) return +m[1] - 1;
    const words = s.split(/[^a-zäöü]+/);
    for (let i = 0; i < 12; i++) if (MONTH_WORDS[i].some(w => words.includes(w))) return i;
  }
  return null;
}

/* ---------- Fotos einlesen ---------- */
async function decodeImage(blob) {
  try { return await createImageBitmap(blob, { imageOrientation: 'from-image' }); } catch (e) { /* weiter */ }
  try { return await createImageBitmap(blob); } catch (e) { /* weiter */ }
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image(); img.src = url; await img.decode();
    return { width: img.naturalWidth, height: img.naturalHeight, img, close() {} };
  } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
}
const srcOf = (b) => b.img || b;
function scaleToBlob(bmp, max, q) {
  const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(bmp.width * s)); c.height = Math.max(1, Math.round(bmp.height * s));
  const x = c.getContext('2d'); x.imageSmoothingQuality = 'high';
  x.drawImage(srcOf(bmp), 0, 0, c.width, c.height);
  return new Promise(r => c.toBlob(r, 'image/jpeg', q));
}
function setUrls(id, prev, thumb) {
  if (RT.prev[id]) URL.revokeObjectURL(RT.prev[id]);
  if (RT.thumb[id]) URL.revokeObjectURL(RT.thumb[id]);
  RT.prev[id] = URL.createObjectURL(prev); RT.thumb[id] = URL.createObjectURL(thumb);
}
const IMG_RE = /\.(jpe?g|png|webp|gif|avif|heic|heif|tiff?)$/i;

async function importFiles(list) {
  const files = list.filter(f => (f.type && f.type.startsWith('image/')) || IMG_RE.test(f.name));
  if (!files.length) { toast(_t('Keine Bilddateien gefunden.')); return; }
  if (SVC.pid && SVC.readOnly) { toast(_t('Nur ansehen: Fotos hinzufügen geht erst, wenn das Projekt frei ist.'), 6000); return; }
  const known = new Set(Object.values(S.photos).map(p => p.name + '|' + p.size));
  const todo = files.filter(f => !known.has(f.name + '|' + f.size));
  let skipped = files.length - todo.length, done = 0;
  const failed = [];
  const bar = busy(_t('Fotos werden eingelesen'), _t('{n} von {total}', { n: 0, total: todo.length }));
  const worker = async () => {
    while (todo.length) {
      const f = todo.shift();
      try { if (await importOne(f) === 'dup') { skipped++; done--; } } catch (e) { failed.push(f.name); }
      done++; bar.update(done / (done + todo.length), _t('{n} von {total}', { n: done, total: done + todo.length }));
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  bar.close();
  commit(); renderAll();
  const ok = done - failed.length;
  let msg = ok === 1 ? _t('1 Foto eingelesen.') : _t('{n} Fotos eingelesen.', { n: ok });
  if (skipped) msg += ' ' + (skipped === 1 ? _t('1 war schon da.') : _t('{n} waren schon da.', { n: skipped }));
  // Fehlgeschlagene Dateien mit Namen und Abhilfe im Fotobereich zeigen
  ui.importErrors = failed;
  if (failed.length) msg += ' ' + (failed.length === 1 ? _t('1 Datei ließ sich nicht öffnen, Details oben.') : _t('{n} Dateien ließen sich nicht öffnen, Details oben.', { n: failed.length }));
  const empty = pageKeys().some(k => pageMonth(k) != null && visibleSlots(S.pages[k]).some(s => !s.photo || !S.photos[s.photo]));
  renderAll();
  toast(msg, 7000, done - failed.length > 0 && empty ? { label: _t('Kalender automatisch gestalten'), fn: autoDesign } : null);
}
async function importOne(file) {
  const id = uid();
  const path = file._path || file.webkitRelativePath || file.name;
  const fm = monthFromPath(path);
  let ex = null; try { ex = await exifDate(file); } catch (e) { /* ohne EXIF */ }
  const nm = dateFromName(file.name);
  const date = ex || nm;
  let month = -1, src = 'keine Angabe';
  if (fm != null) { month = fm; src = 'Ordnername'; }
  else if (ex) { month = ex.getMonth(); src = 'Aufnahmedatum (EXIF)'; }
  else if (nm) { month = nm.getMonth(); src = 'Dateiname'; }
  if (SVC.pid) return serviceImportOne(file, month);   // Datei landet im Monatsordner des Projekts
  const bmp = await decodeImage(file);
  const w = bmp.width, h = bmp.height;
  const prev = await scaleToBlob(bmp, 1600, .85), thumb = await scaleToBlob(bmp, 360, .8);
  bmp.close && bmp.close();
  setUrls(id, prev, thumb); RT.file[id] = file;
  S.photos[id] = { id, name: file.name, size: file.size, path, w, h, month, src, date: date ? isoDate(date) : null, caption: '', fav: false, demo: null };
  await DB.put('blobs', id, { file, prev, thumb });
}
const isoDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// Ordner aus Drag & Drop rekursiv lesen
async function filesFromDrop(dt) {
  const items = [...(dt.items || [])].map(i => i.webkitGetAsEntry && i.webkitGetAsEntry()).filter(Boolean);
  if (!items.length) return [...dt.files];
  const out = [];
  const walk = async (entry, path) => {
    if (entry.isFile) {
      const f = await new Promise((res, rej) => entry.file(res, rej)).catch(() => null);
      if (f) { try { f._path = path + f.name; } catch (e) { /* schreibgeschützt */ } out.push(f); }
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      let batch;
      do {
        batch = await new Promise(res => reader.readEntries(res, () => res([])));
        for (const e of batch) await walk(e, path + entry.name + '/');
      } while (batch.length);
    }
  };
  for (const e of items) await walk(e, '');
  return out;
}

/* ---------- Beispielbilder (gezeichnet, auflösungsunabhängig) ---------- */
function rng(seed) {
  let a = seed >>> 0;
  return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
const SEASON = [0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3, 0];
const PAL = [
  { sky: ['#9fb8cf', '#e4ecf2'], hills: ['#c9d6e2', '#e9eef3', '#f7f9fb'], tree: '#2f4a44', sun: '#fff6e0' },
  { sky: ['#6fb1e0', '#d8ecf7'], hills: ['#8fbf73', '#6ea85a', '#9acd6e'], tree: '#3d7a3a', sun: '#fffbe8' },
  { sky: ['#2f86cf', '#a9d6f2'], hills: ['#5d8fa8', '#d9c59a', '#ecdcb4'], tree: '#2e6b3a', sun: '#fff3c4' },
  { sky: ['#e9a46b', '#f7dcb5'], hills: ['#b9683a', '#d08a3c', '#9b5a2c'], tree: '#7a2f1c', sun: '#fff0d0' },
];
const JACKETS = ['#d6453d', '#2d6cb5', '#f2b632', '#3c9b6b', '#8c4fa8', '#e2733a', '#1f2a36'];
function drawScene(ctx, W, H, seed, month) {
  const R = rng(seed), s = SEASON[month], P = PAL[s], u = Math.min(W, H) / 100;
  const sea = s === 2 && R() < .6;
  const horizon = H * (.45 + R() * .2);
  let g = ctx.createLinearGradient(0, 0, 0, horizon);
  g.addColorStop(0, P.sky[0]); g.addColorStop(1, P.sky[1]);
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  // Sonne
  const sx = W * (.15 + R() * .7), sy = horizon * (.25 + R() * .45), sr = u * (6 + R() * 5);
  g = ctx.createRadialGradient(sx, sy, 0, sx, sy, sr * 5);
  g.addColorStop(0, P.sun); g.addColorStop(.2, P.sun + 'cc'); g.addColorStop(1, P.sun + '00');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = P.sun; ctx.beginPath(); ctx.arc(sx, sy, sr, 0, 7); ctx.fill();
  // Wolken
  ctx.fillStyle = 'rgba(255,255,255,.55)';
  for (let i = 0, n = 2 + Math.floor(R() * 4); i < n; i++) {
    const cx = R() * W, cy = R() * horizon * .6, cw = u * (10 + R() * 18);
    for (let j = 0; j < 5; j++) { ctx.beginPath(); ctx.ellipse(cx + (j - 2) * cw * .35, cy + Math.sin(j * 2) * u, cw * .4, cw * .22, 0, 0, 7); ctx.fill(); }
  }
  // Hügel / Meer
  const ridge = (base, amp, col, f1, f2, ph) => {
    ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(0, H);
    for (let i = 0; i <= 60; i++) { const x = W * i / 60; ctx.lineTo(x, base + Math.sin(i * f1 + ph) * amp + Math.sin(i * f2 + ph * 2) * amp * .5); }
    ctx.lineTo(W, H); ctx.fill();
  };
  if (sea) {
    ctx.fillStyle = P.hills[0]; ctx.fillRect(0, horizon, W, H - horizon);
    g = ctx.createLinearGradient(0, horizon, 0, H); g.addColorStop(0, 'rgba(255,255,255,.25)'); g.addColorStop(1, 'rgba(0,40,70,.25)');
    ctx.fillStyle = g; ctx.fillRect(0, horizon, W, H - horizon);
    ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = u * .3;
    for (let i = 0; i < 14; i++) { const y = horizon + (H - horizon) * (i / 14) ** 1.5 * .6; ctx.beginPath(); ctx.moveTo(R() * W * .3, y); ctx.lineTo(W * (.5 + R() * .5), y); ctx.stroke(); }
    ridge(H * .78, u * 2, P.hills[1], .18, .5, R() * 6);
    ridge(H * .86, u * 1.5, P.hills[2], .12, .4, R() * 6);
  } else {
    ridge(horizon, u * (5 + R() * 6), P.hills[0], .15 + R() * .1, .4, R() * 6);
    ridge(horizon + (H - horizon) * .3, u * 4, P.hills[1], .1 + R() * .08, .33, R() * 6);
    ridge(horizon + (H - horizon) * .62, u * 3, P.hills[2], .08, .27, R() * 6);
  }
  // Bäume
  const trees = sea ? 0 : 3 + Math.floor(R() * 7);
  for (let i = 0; i < trees; i++) {
    const tx = R() * W, ty = horizon + (H - horizon) * (.25 + R() * .3), th = u * (8 + R() * 14);
    ctx.fillStyle = '#4a3527'; ctx.fillRect(tx - th * .04, ty - th * .3, th * .08, th * .3);
    if (s === 0) {
      ctx.fillStyle = P.tree;
      for (let j = 0; j < 3; j++) { ctx.beginPath(); ctx.moveTo(tx, ty - th * (1 - j * .22)); ctx.lineTo(tx - th * (.18 + j * .08), ty - th * (.35 - j * .05) + j * th * .05); ctx.lineTo(tx + th * (.18 + j * .08), ty - th * (.35 - j * .05) + j * th * .05); ctx.fill(); }
      ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.beginPath(); ctx.moveTo(tx, ty - th); ctx.lineTo(tx - th * .07, ty - th * .82); ctx.lineTo(tx + th * .07, ty - th * .82); ctx.fill();
    } else {
      const cols = s === 3 ? ['#c4462a', '#e08a2c', '#d9b02f', '#8f2f1f'] : s === 1 ? ['#5c9e45', '#f2c4d4', '#79b555'] : ['#357a3c', '#2c6a35', '#4b8f47'];
      ctx.fillStyle = cols[Math.floor(R() * cols.length)];
      ctx.beginPath(); ctx.ellipse(tx, ty - th * .62, th * .3, th * .38, 0, 0, 7); ctx.fill();
    }
  }
  // Blumen im Frühling
  if (s === 1) for (let i = 0; i < 120; i++) { ctx.fillStyle = ['#ffe14d', '#fff', '#f28cb1'][i % 3]; ctx.beginPath(); ctx.arc(R() * W, horizon + (H - horizon) * (.4 + R() * .6), u * .45, 0, 7); ctx.fill(); }
  // Menschen
  const people = Math.floor(R() * 5);
  const px0 = W * (.15 + R() * .55), ground = H * (.8 + R() * .12);
  for (let i = 0; i < people; i++) {
    const ph = u * (16 + R() * 14) * (i % 3 === 2 ? .62 : 1), px = px0 + i * u * (7 + R() * 5);
    ctx.fillStyle = JACKETS[Math.floor(R() * JACKETS.length)];
    roundRect(ctx, px - ph * .14, ground - ph * .78, ph * .28, ph * .5, ph * .1); ctx.fill();
    ctx.fillStyle = '#2a2f38'; ctx.fillRect(px - ph * .11, ground - ph * .32, ph * .09, ph * .32); ctx.fillRect(px + ph * .02, ground - ph * .32, ph * .09, ph * .32);
    ctx.fillStyle = ['#f1c7a5', '#d9a07a', '#a46b47'][Math.floor(R() * 3)];
    ctx.beginPath(); ctx.arc(px, ground - ph * .88, ph * .11, 0, 7); ctx.fill();
    if (s === 0) { ctx.fillStyle = JACKETS[(i + 2) % JACKETS.length]; ctx.beginPath(); ctx.arc(px, ground - ph * .93, ph * .1, Math.PI, 0); ctx.fill(); }
  }
  // Schnee
  if (s === 0) { ctx.fillStyle = 'rgba(255,255,255,.9)'; for (let i = 0; i < 160; i++) { ctx.beginPath(); ctx.arc(R() * W, R() * H, u * (.2 + R() * .45), 0, 7); ctx.fill(); } }
  // Vignette
  g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * .35, W / 2, H / 2, Math.max(W, H) * .75);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,.28)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
}
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
const DEMO_CAPTIONS = [
  ['Schneespaziergang am Waldrand', 'Rodeln am Kirchberg', 'Winterwald', 'Raureif am Morgen'],
  ['Fasching bei den Großeltern', 'Eisiger Morgen', 'Spuren im Schnee'],
  ['Erste Krokusse', 'Frühlingswiese', 'Radtour an die Mühle', 'Kirschblüte im Garten'],
  ['Ostern im Garten', 'Aprilwetter', 'Osterfeuer'],
  ['Maiwanderung', 'Löwenzahnwiese', 'Picknick am Bach', 'Geburtstag im Grünen'],
  ['Am Badesee', 'Sommerabend auf der Terrasse', 'Zelten'],
  ['Ostsee', 'Sandburg', 'Abendsonne am Strand', 'Leuchtturm'],
  ['Berghütte', 'Gipfelglück', 'Heuernte'],
  ['Schulanfang', 'Spätsommer', 'Apfelernte', 'Federweißer'],
  ['Herbstwald', 'Drachen steigen', 'Kastanien sammeln'],
  ['Nebelmorgen', 'Laternenumzug', 'Novemberlicht'],
  ['Plätzchen backen', 'Erster Schnee', 'Weihnachtsspaziergang', 'Bescherung'],
];
const DEMO_W = 6000, DEMO_H = 4000;
async function makeDemoPhotos() {
  const bar = busy(_t('Beispielprojekt wird vorbereitet'), _t('Bilder werden gezeichnet …'));
  let n = 0, total = DEMO_CAPTIONS.flat().length;
  for (let m = 0; m < 12; m++) {
    for (let i = 0; i < DEMO_CAPTIONS[m].length; i++) {
      const seed = 1000 + m * 37 + i * 11, portrait = (m + i) % 4 === 3;
      const w = portrait ? DEMO_H : DEMO_W, h = portrait ? DEMO_W : DEMO_H;
      const id = 'demo' + m + '_' + i;
      const c = document.createElement('canvas'), sc = 1200 / Math.max(w, h);
      c.width = Math.round(w * sc); c.height = Math.round(h * sc);
      const x = c.getContext('2d'); x.scale(sc, sc); drawScene(x, w, h, seed, m);
      const prev = await new Promise(r => c.toBlob(r, 'image/jpeg', .85));
      const t = document.createElement('canvas'); const ts = 360 / Math.max(c.width, c.height);
      t.width = Math.round(c.width * ts); t.height = Math.round(c.height * ts);
      t.getContext('2d').drawImage(c, 0, 0, t.width, t.height);
      const thumb = await new Promise(r => t.toBlob(r, 'image/jpeg', .8));
      setUrls(id, prev, thumb);
      const d = new Date(new Date().getFullYear(), m, 3 + i * 6);
      S.photos[id] = { id, name: `${_t('Beispiel')}_${MONTHS_SHORT[m]}_${i + 1}.jpg`, size: 0, path: '', w, h, month: m, src: 'Beispiel', date: isoDate(d), caption: _t(DEMO_CAPTIONS[m][i]), fav: i === 0, demo: { seed, m } };
      await DB.put('blobs', id, { prev, thumb });
      n++; bar.update(n / total, _t('{n} von {total}', { n, total }));
    }
  }
  bar.close();
}
