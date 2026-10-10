/* ---------- CMYK-JPEG-Encoder (Baseline, 4 Kanäle, ohne Unterabtastung) ---------- */
const JPEG = (() => {
  const ZZ = [0,1,8,16,9,2,3,10,17,24,32,25,18,11,4,5,12,19,26,33,40,48,41,34,27,20,13,6,7,14,21,28,35,42,49,56,57,50,43,36,29,22,15,23,30,37,44,51,58,59,52,45,38,31,39,46,53,60,61,54,47,55,62,63];
  const STD_Q = [16,11,10,16,24,40,51,61,12,12,14,19,26,58,60,55,14,13,16,24,40,57,69,56,14,17,22,29,51,87,80,62,18,22,37,56,68,109,103,77,24,35,55,64,81,104,113,92,49,64,78,87,103,121,120,101,72,92,95,98,112,100,103,99];
  const DC_BITS = [0,1,5,1,1,1,1,1,1,0,0,0,0,0,0,0];
  const DC_VALS = [0,1,2,3,4,5,6,7,8,9,10,11];
  const AC_BITS = [0,2,1,3,3,2,4,3,5,5,4,4,0,0,1,0x7d];
  const AC_VALS = [0x01,0x02,0x03,0x00,0x04,0x11,0x05,0x12,0x21,0x31,0x41,0x06,0x13,0x51,0x61,0x07,0x22,0x71,0x14,0x32,0x81,0x91,0xa1,0x08,0x23,0x42,0xb1,0xc1,0x15,0x52,0xd1,0xf0,0x24,0x33,0x62,0x72,0x82,0x09,0x0a,0x16,0x17,0x18,0x19,0x1a,0x25,0x26,0x27,0x28,0x29,0x2a,0x34,0x35,0x36,0x37,0x38,0x39,0x3a,0x43,0x44,0x45,0x46,0x47,0x48,0x49,0x4a,0x53,0x54,0x55,0x56,0x57,0x58,0x59,0x5a,0x63,0x64,0x65,0x66,0x67,0x68,0x69,0x6a,0x73,0x74,0x75,0x76,0x77,0x78,0x79,0x7a,0x83,0x84,0x85,0x86,0x87,0x88,0x89,0x8a,0x92,0x93,0x94,0x95,0x96,0x97,0x98,0x99,0x9a,0xa2,0xa3,0xa4,0xa5,0xa6,0xa7,0xa8,0xa9,0xaa,0xb2,0xb3,0xb4,0xb5,0xb6,0xb7,0xb8,0xb9,0xba,0xc2,0xc3,0xc4,0xc5,0xc6,0xc7,0xc8,0xc9,0xca,0xd2,0xd3,0xd4,0xd5,0xd6,0xd7,0xd8,0xd9,0xda,0xe1,0xe2,0xe3,0xe4,0xe5,0xe6,0xe7,0xe8,0xe9,0xea,0xf1,0xf2,0xf3,0xf4,0xf5,0xf6,0xf7,0xf8,0xf9,0xfa];
  const AASF = [1.0,1.387039845,1.306562965,1.175875602,1.0,0.785694958,0.541196100,0.275899379];

  function huff(bits, vals) {
    const codes = new Int32Array(256), lens = new Uint8Array(256);
    let code = 0, k = 0;
    for (let l = 1; l <= 16; l++) {
      for (let i = 0; i < bits[l - 1]; i++) { codes[vals[k]] = code; lens[vals[k]] = l; code++; k++; }
      code <<= 1;
    }
    return { codes, lens };
  }
  const DCH = huff(DC_BITS, DC_VALS), ACH = huff(AC_BITS, AC_VALS);

  function qtable(quality) {
    quality = Math.max(1, Math.min(100, quality));
    const s = quality < 50 ? 5000 / quality : 200 - quality * 2;
    const q = new Uint8Array(64);
    for (let i = 0; i < 64; i++) q[i] = Math.max(1, Math.min(255, Math.floor((STD_Q[i] * s + 50) / 100)));
    return q;
  }

  // quality: 1..100, data: Uint8Array CMYK interleaved (0 = keine Farbe, 255 = 100 %)
  async function encodeCMYK(data, w, h, quality, onRow) {
    const q = qtable(quality);
    const fd = new Float32Array(64);
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) fd[r * 8 + c] = 1 / (q[r * 8 + c] * AASF[r] * AASF[c] * 8);

    let out = new Uint8Array(Math.max(1 << 16, (w * h * 4) >> 3)), pos = 0;
    const ensure = (n) => { if (pos + n > out.length) { const o = new Uint8Array(Math.max(out.length * 2, pos + n)); o.set(out); out = o; } };
    const byte = (b) => { ensure(1); out[pos++] = b; };
    const word = (v) => { byte(v >> 8 & 255); byte(v & 255); };
    let bitBuf = 0, bitCnt = 0;
    const bits = (code, len) => {
      bitBuf = (bitBuf << len) | (code & ((1 << len) - 1)); bitCnt += len;
      while (bitCnt >= 8) {
        const b = (bitBuf >> (bitCnt - 8)) & 255; ensure(2); out[pos++] = b; if (b === 255) out[pos++] = 0;
        bitCnt -= 8;
      }
      bitBuf &= (1 << bitCnt) - 1;
    };

    // Header
    word(0xFFD8);
    word(0xFFDB); word(67); byte(0); for (let i = 0; i < 64; i++) byte(q[ZZ[i]]);
    word(0xFFC0); word(8 + 3 * 4); byte(8); word(h); word(w); byte(4);
    for (let c = 1; c <= 4; c++) { byte(c); byte(0x11); byte(0); }
    word(0xFFC4); word(2 + 17 + 12 + 17 + 162);
    byte(0x00); DC_BITS.forEach(byte); DC_VALS.forEach(byte);
    byte(0x10); AC_BITS.forEach(byte); AC_VALS.forEach(byte);
    word(0xFFDA); word(6 + 2 * 4); byte(4);
    for (let c = 1; c <= 4; c++) { byte(c); byte(0x00); }
    byte(0); byte(63); byte(0);

    const blk = new Float32Array(64), coef = new Int32Array(64);
    const prev = [0, 0, 0, 0];
    const bw = Math.ceil(w / 8), bh = Math.ceil(h / 8);
    for (let by = 0; by < bh; by++) {
      for (let bx = 0; bx < bw; bx++) {
        for (let comp = 0; comp < 4; comp++) {
          // Block laden (Randpixel wiederholen)
          for (let y = 0; y < 8; y++) {
            const yy = Math.min(h - 1, by * 8 + y), row = yy * w;
            for (let x = 0; x < 8; x++) {
              const xx = Math.min(w - 1, bx * 8 + x);
              blk[y * 8 + x] = data[(row + xx) * 4 + comp] - 128;
            }
          }
          fdct(blk);
          for (let i = 0; i < 64; i++) coef[i] = Math.round(blk[i] * fd[i]);
          // DC
          const dc = coef[0], diff = dc - prev[comp]; prev[comp] = dc;
          if (diff === 0) bits(DCH.codes[0], DCH.lens[0]);
          else {
            const a = Math.abs(diff), cat = 32 - Math.clz32(a);
            bits(DCH.codes[cat], DCH.lens[cat]);
            bits(diff < 0 ? diff + (1 << cat) - 1 : diff, cat);
          }
          // AC
          let run = 0;
          for (let i = 1; i < 64; i++) {
            const v = coef[ZZ[i]];
            if (v === 0) { run++; continue; }
            while (run >= 16) { bits(ACH.codes[0xF0], ACH.lens[0xF0]); run -= 16; }
            const a = Math.abs(v), cat = 32 - Math.clz32(a), sym = (run << 4) | cat;
            bits(ACH.codes[sym], ACH.lens[sym]);
            bits(v < 0 ? v + (1 << cat) - 1 : v, cat);
            run = 0;
          }
          if (run > 0) bits(ACH.codes[0], ACH.lens[0]);
        }
      }
      if (onRow && (by & 7) === 7) await onRow(by / bh);
    }
    if (bitCnt > 0) bits(0x7F, 8 - bitCnt);
    word(0xFFD9);
    return out.subarray(0, pos);
  }

  function fdct(d) {
    for (let i = 0; i < 64; i += 8) step(d, i, 1);
    for (let i = 0; i < 8; i++) step(d, i, 8);
  }
  function step(d, o, s) {
    const d0 = d[o], d1 = d[o + s], d2 = d[o + 2 * s], d3 = d[o + 3 * s], d4 = d[o + 4 * s], d5 = d[o + 5 * s], d6 = d[o + 6 * s], d7 = d[o + 7 * s];
    const t0 = d0 + d7, t7 = d0 - d7, t1 = d1 + d6, t6 = d1 - d6, t2 = d2 + d5, t5 = d2 - d5, t3 = d3 + d4, t4 = d3 - d4;
    let t10 = t0 + t3, t13 = t0 - t3, t11 = t1 + t2, t12 = t1 - t2;
    d[o] = t10 + t11; d[o + 4 * s] = t10 - t11;
    const z1 = (t12 + t13) * 0.707106781;
    d[o + 2 * s] = t13 + z1; d[o + 6 * s] = t13 - z1;
    t10 = t4 + t5; t11 = t5 + t6; t12 = t6 + t7;
    const z5 = (t10 - t12) * 0.382683433, z2 = 0.541196100 * t10 + z5, z4 = 1.306562965 * t12 + z5, z3 = t11 * 0.707106781;
    const z11 = t7 + z3, z13 = t7 - z3;
    d[o + 5 * s] = z13 + z2; d[o + 3 * s] = z13 - z2; d[o + s] = z11 + z4; d[o + 7 * s] = z11 - z4;
  }

  return { encodeCMYK };
})();
