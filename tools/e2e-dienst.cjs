// Ende-zu-Ende-Test: Oberfläche + lokaler Dienst im echten Browser.
// Startet den Dienst mit einem frischen Datenordner, legt Testfotos in die Monatsordner und spielt die
// wichtigsten Abläufe durch: Projekt anlegen, Abgleich, Gestalten, Monat wechseln (Datei wandert, auch bei
// Rückgängig), Kopie, Aussortieren, zweites Fenster „Nur ansehen“, Hochladen mit Duplikat, Gegenlicht und
// Rauschen (Prüfliste, Ausgleich, Vorschau vom Dienst), Sperrverlust mit gesichertem Stand, PDF in Export/.
// Aufruf:  node tools/e2e-dienst.cjs   (braucht Playwright mit Chromium, Python 3.11+ mit Pillow und FastAPI)
const path = require('path');
const fs = require('fs');
const os = require('os');
const assert = require('assert/strict');
const { spawn, execFileSync } = require('child_process');
let pw;
try { pw = require('playwright'); } catch (e) { pw = require('/opt/node22/lib/node_modules/playwright'); }

const ROOT = path.resolve(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'lj-e2e-'));
const PORT = 8400 + Math.floor(Math.random() * 60);
const BASE = `http://localhost:${PORT}/`;
const K = path.join(TMP, 'Kalender 2027');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const step = (t) => console.log('•', t);

function makePhotos(dir) {
  execFileSync('python3', ['-c', `
import os, random, sys
from PIL import Image, ImageDraw
sys.path.insert(0, sys.argv[2])
from iccgen import rgb_profile
out = sys.argv[1]; os.makedirs(out, exist_ok=True); random.seed(4)
for m in range(12):
    for i in range(3):
        w, h = (2400, 1600) if i != 1 else (1600, 2400)
        im = Image.new("RGB", (w, h), (random.randint(40, 200), random.randint(40, 200), random.randint(40, 200)))
        d = ImageDraw.Draw(im)
        for _ in range(20):
            x, y, r = random.randint(0, w), random.randint(h // 2, h), random.randint(20, 140)
            d.ellipse([x - r, y - r, x + r, y + r], fill=(random.randint(0, 255), random.randint(0, 255), random.randint(0, 255)))
        ex = Image.Exif(); date = f"2026:{m + 1:02d}:{10 + i:02d} 12:00:00"; ex[0x0132] = date; ex.get_ifd(0x8769)[0x9003] = date
        icc = {"icc_profile": rgb_profile("Display P3")} if (m, i) == (2, 0) else {}   # ein iPhone-Foto mit großem Farbraum
        if (m, i) == (3, 0):                           # Gegenlicht: dunkles Motiv vor hellem Himmel
            im = Image.new("RGB", (w, h), (236, 240, 248)); d = ImageDraw.Draw(im)
            d.ellipse([w * .3, h * .25, w * .7, h * 1.1], fill=(42, 36, 32))
            for _ in range(60):
                x, y, r = random.randint(int(w * .35), int(w * .65)), random.randint(int(h * .35), h), random.randint(10, 50)
                c = random.randint(25, 70); d.ellipse([x - r, y - r, x + r, y + r], fill=(c + 10, c, c - 5))
        if (m, i) == (5, 0):                           # dunkles Handyfoto mit kräftigem Rauschen
            import numpy as np
            rng = np.random.default_rng(5)
            a = np.asarray(im, np.float32) * .45 + rng.normal(0, 14, (h, w, 3))
            a += np.asarray(Image.fromarray(rng.normal(128, 30, (h // 4, w // 4, 3)).clip(0, 255).astype("uint8")).resize((w, h)), np.float32) - 128
            im = Image.fromarray(a.clip(0, 255).astype("uint8"))
        im.save(os.path.join(out, f"m{m + 1:02d}_{i + 1}.jpg"), "JPEG", quality=85, exif=ex.tobytes(), **icc)
`, dir, path.join(__dirname, '..', 'backend', 'tests')]);
}
const pid = () => JSON.parse(fs.readFileSync(path.join(TMP, 'data/projects.json')))[0].id;
const manifest = async () => (await fetch(BASE + `api/projects/${pid()}/manifest`)).json();
async function waitFor(fn, ms = 15000) {
  const t0 = Date.now();
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) throw new Error('Zeitüberschreitung'); await sleep(200); }
}
async function page(browser) {
  // Abläufe auf Deutsch: die Prüfungen erwarten deutsche Ordnernamen (Fotos/03 März) und Knopftexte
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, locale: 'de-DE' });
  await ctx.addInitScript(() => { try { localStorage.setItem('lj-lang', 'de'); } catch (e) { /* egal */ } });
  const p = await ctx.newPage();
  p.errors = [];
  p.on('pageerror', e => p.errors.push(e.message));
  return p;
}
const ready = (p) => p.waitForFunction(() => typeof SVC !== 'undefined' && SVC.pid && document.body.dataset.view, null, { timeout: 20000 });
const confirmDialog = (p, text) => p.evaluate((t) => { const b = [...document.querySelectorAll('.busy .btn')].find(x => !t || x.textContent.includes(t)); if (b) b.click(); return !!b; }, text);

(async () => {
  makePhotos(path.join(TMP, 'fotos'));
  const server = spawn('python3', ['-m', 'lichtjahr', '--data-dir', path.join(TMP, 'data'), '--cache-dir', path.join(TMP, 'cache'), 'serve', '--no-browser', '--port', String(PORT)],
    { cwd: path.join(ROOT, 'backend'), env: { ...process.env, PYTHONPATH: path.join(ROOT, 'backend') }, stdio: 'inherit' });
  const browser = await pw.chromium.launch();
  try {
    await waitFor(async () => { try { return (await fetch(BASE + 'api/health')).ok; } catch (e) { return false; } });

    step('Projekt anlegen');
    const A = await page(browser);
    await A.goto(BASE);
    await A.waitForSelector('#pk-path');
    await A.fill('#pk-path', K);
    await A.click('.picker-form .btn.primary');
    await ready(A);
    assert.ok(fs.existsSync(path.join(K, 'Fotos', '03 März')));

    step('Fotos in die Monatsordner legen und abgleichen');
    const dirs = fs.readdirSync(path.join(K, 'Fotos')).sort();
    for (const f of fs.readdirSync(path.join(TMP, 'fotos'))) {
      const m = +f.slice(1, 3), dest = f === 'm12_3.jpg' ? 'Ohne Monat' : dirs[m - 1];
      fs.copyFileSync(path.join(TMP, 'fotos', f), path.join(K, 'Fotos', dest, f));
    }
    await A.click('[data-act="svcscan"]');
    await A.waitForFunction(() => Object.keys(S.photos).length === 36, null, { timeout: 30000 });
    await A.click('[data-act="svcsuggest"]');
    await waitFor(() => fs.existsSync(path.join(K, 'Fotos', '12 Dezember', 'm12_3.jpg')));

    step('Automatisch gestalten und speichern');
    await A.evaluate(async () => { setView('design'); await autoDesign(); });
    await waitFor(async () => { const M = await manifest(); return M.editor.pages && M.editor.pages.m3 && M.editor.pages.m3.slots[0].photo; });

    step('Monat wechseln: Datei wandert, Rückgängig holt sie zurück');
    const id = await A.evaluate(() => Object.values(S.photos).find(x => x.month === 0).id);
    const moving = A.evaluate((i) => moveToMonth([i], 5), id);
    await sleep(300); await confirmDialog(A, 'Verschieben'); await moving;
    await waitFor(async () => (await manifest()).assets.find(a => a.id === id).path.startsWith('Fotos/06 Juni/'));
    await A.evaluate(() => undo());
    await waitFor(async () => (await manifest()).assets.find(a => a.id === id).path.startsWith('Fotos/01 Januar/'));

    step('Kopie für einen anderen Monat');
    const used = await A.evaluate(() => { const u = usage(); return Object.keys(u).find(i => u[i].includes('m2')); });
    const placing = A.evaluate((i) => { ui.page = 'm7'; renderAll(); return placePhoto(0, i); }, used);
    await sleep(300); await confirmDialog(A, 'Kopie'); await placing;
    const copy = await waitFor(async () => (await manifest()).assets.find(a => a.copyOf === used));
    assert.ok(copy.path.startsWith('Fotos/08 August/'));
    assert.equal(await A.evaluate(() => S.pages.m7.slots[0].photo), copy.id);

    step('Aussortieren und zurückholen');
    const victims = await A.evaluate(() => Object.values(S.photos).filter(p => p.month === 10).map(p => p.id));
    await A.evaluate((ids) => { setView('photos'); ui.photoSel = new Set(ids); renderPhotos(); }, victims);
    await A.click('[data-act="delphotos"]'); await sleep(200); await confirmDialog(A, 'Entfernen');
    await waitFor(async () => (await manifest()).assets.filter(a => victims.includes(a.id)).every(a => a.excluded));
    assert.equal(fs.readdirSync(path.join(K, 'Fotos', '11 November')).length, 3);
    await A.click('[data-act="svcrestore"]');
    await waitFor(async () => (await manifest()).assets.filter(a => victims.includes(a.id)).every(a => !a.excluded));

    step('Zweites Fenster sieht nur zu und übernimmt, wenn das erste schließt');
    const B = await page(browser);
    await B.goto(BASE); await ready(B);
    assert.equal(await B.evaluate(() => SVC.readOnly), true);
    assert.ok(await B.isVisible('#svcBanner'));
    await A.evaluate(() => { S.doc.gap = 2; commit(); });
    await waitFor(async () => (await manifest()).editor.doc.gap === 2);
    await A.evaluate(() => api(PP('/lock'), { method: 'DELETE' }));
    await A.context().close();
    await B.click('[data-act="svcretry"]');
    await B.waitForFunction(() => !SVC.readOnly);
    assert.equal(await B.evaluate(() => S.doc.gap), 2);

    step('Hochladen landet im Monatsordner, Duplikat nicht');
    await B.setInputFiles('#fileIn', [path.join(TMP, 'fotos', 'm05_2.jpg')]);
    await B.waitForFunction(() => /schon da/.test(document.querySelector('#toast').textContent));
    assert.deepEqual(fs.readdirSync(path.join(K, 'Fotos', '05 Mai')).sort(), ['m05_1.jpg', 'm05_2.jpg', 'm05_3.jpg']);

    step('Gegenlicht und Rauschen: Prüfliste meldet beides, Ausgleich wirkt, Vorschau kommt bearbeitet vom Dienst');
    const backId = await B.evaluate(() => Object.values(S.photos).find(p => p.name === 'm04_1.jpg').id);
    const noisyId = await B.evaluate(() => Object.values(S.photos).find(p => p.name === 'm06_1.jpg').id);
    await B.evaluate(([a, b]) => { for (const [k, id] of [['m4', a], ['m6', b]]) { const sl = S.pages[k].slots[0]; if (sl.photo !== id) { sl.photo = id; } } commit(); setView('print'); }, [backId, noisyId]);
    await B.waitForFunction(() => /Gegenlicht/.test(document.querySelector('.checks').textContent) && /verrauscht/.test(document.querySelector('.checks').textContent), null, { timeout: 90000 });
    await B.click('[data-act="fixbacklight"]');
    await B.waitForFunction((id) => (S.doc.adjust[id] || {}).fusion > 0, backId);
    await B.click('[data-act="fixnoise"]');
    await B.waitForFunction((id) => (S.doc.adjust[id] || {}).denoise > 0, noisyId);
    await waitFor(async () => { const M = await manifest(); return ((M.editor.doc.adjust || {})[backId] || {}).fusion > 0; });
    const href = await B.evaluate(() => { ui.page = 'm4'; setView('design'); return [...document.querySelectorAll('#canvasWrap image')].map(i => i.getAttribute('href')).find(h => h.includes('fx=')); });
    assert.ok(href && /fx=f0\.\d\d/.test(href), 'Vorschau ohne Gegenlicht-Ausgleich: ' + href);
    const lifted = await fetch(BASE + href.replace(/^\/?/, '')); assert.equal(lifted.status, 200);
    assert.ok(!/Gegenlicht/.test(await B.evaluate(() => checks().map(c => c[1]).join(' '))));

    step('PDF-Entwurf landet in Export/');
    await B.evaluate(async () => { S.doc.dpi = 100; await exportPDF(); });
    await waitFor(() => fs.existsSync(path.join(K, 'Export', 'Familienkalender-2027-Entwurf.pdf')));

    step('Druck-PDF: Farbprofil, PDF/X-1a, Preflight, Display-P3-Foto aus dem Original');
    await B.evaluate(() => setView('print'));
    await B.waitForSelector('#prn');
    await B.evaluate(async () => { await exportPDF('print'); });
    await B.waitForSelector('.report', { timeout: 120000 });
    assert.ok(await B.$('.report.ok'), 'Prüfbericht nicht bestanden: ' + (await B.textContent('.report')));
    const printPdf = fs.readFileSync(path.join(K, 'Export', 'Familienkalender-2027-Druck.pdf'));
    assert.equal(printPdf.subarray(0, 8).toString(), '%PDF-1.3');
    assert.ok(printPdf.includes('GTS_PDFX') && printPdf.includes('PDF/X-1a:2001') && printPdf.includes('FOGRA39'));
    assert.ok((await B.textContent('.report')).includes('Display P3'), 'P3-Foto nicht aus dem Original umgerechnet');
    assert.ok(!printPdf.includes('LJSource'));

    step('Sperre verloren: Stand wird gesichert und beim nächsten Öffnen angeboten');
    const lockFile = path.join(K, '.lichtjahr', 'lock.json');
    const L = JSON.parse(fs.readFileSync(lockFile)); L.session = 'fremd'; fs.writeFileSync(lockFile, JSON.stringify(L));
    await B.evaluate(() => { S.doc.gap = 4.5; commit(); });
    await B.waitForFunction(() => SVC.readOnly, null, { timeout: 10000 });
    await confirmDialog(B);
    fs.unlinkSync(lockFile);
    const errorsB = B.errors;
    await B.context().close();
    const C = await page(browser);
    await C.goto(BASE); await ready(C);
    await C.waitForSelector('.busy h2', { timeout: 5000 });
    await confirmDialog(C, 'Übernehmen');
    await waitFor(async () => (await manifest()).editor.doc.gap === 4.5);

    assert.deepEqual([...A.errors, ...errorsB, ...C.errors], [], 'Fehler in der Seite');
    console.log('\nAlle Abläufe in Ordnung.');
  } finally {
    await browser.close();
    server.kill();
    fs.rmSync(TMP, { recursive: true, force: true });
  }
})().catch((e) => { console.error('\nFEHLGESCHLAGEN:', e); process.exitCode = 1; });
