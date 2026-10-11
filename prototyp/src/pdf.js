/* ---------- Minimaler PDF-Writer (PDF 1.6, DeviceCMYK, eingebettete TrueType-Schrift) ---------- */
const CP1252 = { 0x20AC:0x80,0x201A:0x82,0x0192:0x83,0x201E:0x84,0x2026:0x85,0x2020:0x86,0x2021:0x87,0x02C6:0x88,0x2030:0x89,0x0160:0x8A,0x2039:0x8B,0x0152:0x8C,0x017D:0x8E,0x2018:0x91,0x2019:0x92,0x201C:0x93,0x201D:0x94,0x2022:0x95,0x2013:0x96,0x2014:0x97,0x02DC:0x98,0x2122:0x99,0x0161:0x9A,0x203A:0x9B,0x0153:0x9C,0x017E:0x9E,0x0178:0x9F };
function winAnsi(ch) {
  const u = ch.codePointAt(0);
  if (u >= 32 && u < 127) return u;
  if (u >= 0xA0 && u <= 0xFF) return u;
  return CP1252[u] || 63; // '?'
}
function textWidth(text, font, size) {
  const W = FONTS[font].widths; let s = 0;
  for (const ch of text) { const c = winAnsi(ch); s += W[c - 32] || 500; }
  return s * size / 1000;
}
async function deflate(bytes) {
  if (typeof CompressionStream === 'undefined') return null;
  const cs = new CompressionStream('deflate');
  const buf = await new Response(new Blob([bytes]).stream().pipeThrough(cs)).arrayBuffer();
  return new Uint8Array(buf);
}
function latin1(str) {
  const b = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) b[i] = str.charCodeAt(i) & 255;
  return b;
}
function b64bytes(b64) {
  const s = atob(b64), b = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
  return b;
}

class PDFWriter {
  constructor() { this.parts = []; this.size = 0; this.offsets = []; this.n = 0; this.pages = []; }
  alloc() { return ++this.n; }
  push(b) { if (typeof b === 'string') b = latin1(b); this.parts.push(b); this.size += b.length; }
  begin() { this.push('%PDF-1.6\n%\xE2\xE3\xCF\xD3\n'); this.pagesId = this.alloc(); this.catalogId = this.alloc(); }
  obj(id, dict, stream) {
    this.offsets[id] = this.size;
    if (stream) {
      this.push(`${id} 0 obj\n<< ${dict} /Length ${stream.length} >>\nstream\n`);
      this.push(stream); this.push('\nendstream\nendobj\n');
    } else this.push(`${id} 0 obj\n${dict}\nendobj\n`);
  }
  async streamObj(id, dict, bytes) {
    const z = await deflate(bytes);
    if (z) this.obj(id, dict + ' /Filter /FlateDecode', z); else this.obj(id, dict, bytes);
  }
  async addFonts() {
    this.fontIds = {};
    const done = new Map();                       // gleiche Schrift für Text und Überschriften nur einmal einbetten
    for (const key of ['regular', 'bold', 'hregular', 'hbold']) {
      const f = FONTS[key];
      if (done.has(f)) { this.fontIds[key] = done.get(f); continue; }
      const ff = this.alloc(), fd = this.alloc(), fo = this.alloc();
      const raw = b64bytes(f.b64);
      await this.streamObj(ff, `/Length1 ${raw.length}`, raw);
      this.obj(fd, `<< /Type /FontDescriptor /FontName /${f.ps} /Flags 32 /FontBBox [${f.bbox.join(' ')}] /ItalicAngle 0 /Ascent ${f.ascent} /Descent ${f.descent} /CapHeight ${f.cap} /StemV ${key.endsWith('bold') ? 120 : 80} /FontFile2 ${ff} 0 R >>`);
      this.obj(fo, `<< /Type /Font /Subtype /TrueType /BaseFont /${f.ps} /FirstChar 32 /LastChar 255 /Widths [${f.widths.join(' ')}] /Encoding /WinAnsiEncoding /FontDescriptor ${fd} 0 R >>`);
      this.fontIds[key] = fo; done.set(f, fo);
    }
  }
  addJpeg(bytes, w, h, cs = 'DeviceCMYK', extra = '') {
    const id = this.alloc();
    this.obj(id, `/Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /${cs} /BitsPerComponent 8 /Filter /DCTDecode${extra ? ' ' + extra : ''}`, bytes);
    return id;
  }
  async addPage({ media, trim, bleed, content, images, alphas }) {
    const cid = this.alloc(), pid = this.alloc();
    await this.streamObj(cid, '', latin1(content));
    const xo = Object.entries(images).map(([n, id]) => `/${n} ${id} 0 R`).join(' ');
    const gs = alphas.map(a => `/GA${Math.round(a * 100)} << /Type /ExtGState /ca ${a} /CA ${a} >>`).join(' ');
    const box = (b) => `[${b.map(v => v.toFixed(3)).join(' ')}]`;
    this.obj(pid, `<< /Type /Page /Parent ${this.pagesId} 0 R /MediaBox ${box(media)} /BleedBox ${box(bleed)} /TrimBox ${box(trim)} /CropBox ${box(media)} /Resources << /Font << /F1 ${this.fontIds.regular} 0 R /F2 ${this.fontIds.bold} 0 R /F3 ${this.fontIds.hregular} 0 R /F4 ${this.fontIds.hbold} 0 R >> /XObject << ${xo} >> /ExtGState << ${gs} >> >> /Contents ${cid} 0 R >>`);
    this.pages.push(pid);
  }
  finish(title) {
    this.obj(this.pagesId, `<< /Type /Pages /Kids [${this.pages.map(p => p + ' 0 R').join(' ')}] /Count ${this.pages.length} >>`);
    const info = this.alloc();
    const esc = (s) => s.replace(/[\\()]/g, '\\$&');
    const d = new Date(), pad = (n) => String(n).padStart(2, '0');
    const date = `D:${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
    this.obj(info, `<< /Title (${esc(title)}) /Creator (Lichtjahr) /Producer (Lichtjahr) /CreationDate (${date}) /Trapped /False >>`);
    this.obj(this.catalogId, `<< /Type /Catalog /Pages ${this.pagesId} 0 R >>`);
    const xref = this.size;
    let s = `xref\n0 ${this.n + 1}\n0000000000 65535 f \n`;
    for (let i = 1; i <= this.n; i++) s += String(this.offsets[i] || 0).padStart(10, '0') + ' 00000 n \n';
    s += `trailer\n<< /Size ${this.n + 1} /Root ${this.catalogId} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    this.push(s);
    return new Blob(this.parts, { type: 'application/pdf' });
  }
}
