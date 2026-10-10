// README-Bilder, für die der lokale Dienst laufen muss (Projektwahl, Projektordner, Druck-PDF), auf Englisch
// (docs/images) und Deutsch (docs/images/de). Startet den Dienst je Sprache mit einem frischen Benutzerordner,
// damit die Pfade als ~/Pictures/Calendar-2027 bzw. ~/Bilder/Kalender-2027 erscheinen.
// Aufruf:  node tools/screenshots-dienst.cjs   (Playwright mit Chromium, Python mit Pillow und den Paketen des Dienstes)
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn, execFileSync } = require('child_process');
let pw;
try { pw = require('playwright'); } catch (e) { pw = require('/opt/node22/lib/node_modules/playwright'); }

const ROOT = path.resolve(__dirname, '..');
const OUT = { en: path.join(ROOT, 'docs/images'), de: path.join(ROOT, 'docs/images/de') };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function photos(dir) {
  execFileSync('python3', ['-c', `
import os, random, sys
from PIL import Image, ImageDraw
out = sys.argv[1]; os.makedirs(out, exist_ok=True); random.seed(7)
for m in range(12):
    for i in range(3):
        w, h = (2400, 1600) if i != 1 else (1600, 2400)
        top = (random.randint(60, 140), random.randint(120, 190), random.randint(190, 240))
        im = Image.new("RGB", (w, h), top); d = ImageDraw.Draw(im)
        for y in range(h // 2, h):
            t = (y - h / 2) / (h / 2); d.line([(0, y), (w, y)], fill=(int(70 + 60 * t), int(130 - 40 * t), int(70 + 30 * t)))
        for _ in range(14):
            x, y, r = random.randint(0, w), random.randint(h // 2, h), random.randint(30, 120)
            d.ellipse([x - r, y - r, x + r, y + r], fill=(random.randint(120, 255), random.randint(80, 220), random.randint(60, 200)))
        im.save(os.path.join(out, f"m{m + 1:02d}_{i + 1}.jpg"), "JPEG", quality=85)
`, dir]);
}

// Karte(n) auf neutralem Hintergrund nebeneinander, als WebP
function compose(pngs, out, maxW) {
  execFileSync('python3', ['-c', `
from PIL import Image
ims = [Image.open(p).convert('RGB') for p in ${JSON.stringify(pngs)}]
pad, gap = 60, 50
H = max(i.height for i in ims) + 2 * pad; W = sum(i.width for i in ims) + gap * (len(ims) - 1) + 2 * pad
bg = Image.new('RGB', (W, H), (232, 235, 238)); x = pad
for i in ims: bg.paste(i, (x, (H - i.height) // 2)); x += i.width + gap
bg.thumbnail((${maxW}, 2000), Image.LANCZOS); bg.save(${JSON.stringify(out)}, 'WEBP', quality=86, method=6)
`]);
}

async function shoot(browser, lang, port) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), `lj-home-${lang}-`));
  const srv = spawn('python3', ['-m', 'lichtjahr', '--data-dir', path.join(home, '.data'), '--cache-dir', path.join(home, '.cache'), 'serve', '--no-browser', '--port', String(port)],
    { cwd: path.join(ROOT, 'backend'), env: { ...process.env, PYTHONPATH: path.join(ROOT, 'backend'), HOME: home }, stdio: 'ignore' });
  try {
    for (let i = 0; i < 50; i++) { try { if ((await fetch(`http://localhost:${port}/api/health`)).ok) break; } catch (e) { /* startet noch */ } await sleep(200); }
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 }, deviceScaleFactor: 2, locale: lang === 'de' ? 'de-DE' : 'en-US' });
    await ctx.addInitScript((l) => { try { localStorage.setItem('lj-lang', l); } catch (e) { /* egal */ } }, lang);
    const page = await ctx.newPage();
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lj-shot-'));
    await page.goto(`http://localhost:${port}/`);
    await page.waitForSelector('#pk-path');
    await page.evaluate(() => document.activeElement && document.activeElement.blur());
    await (await page.$('.picker-box')).screenshot({ path: path.join(tmp, 'picker.png') });
    await page.click('.picker-form .btn.primary');
    await page.waitForFunction(() => typeof SVC !== 'undefined' && SVC.pid && document.body.dataset.view);
    // Fotos in die Monatsordner legen, abgleichen, gestalten
    const info = await page.evaluate(() => SVC.info.storage);
    const src = path.join(tmp, 'fotos'); photos(src);
    for (const f of fs.readdirSync(src)) {
      const m = +f.slice(1, 3);
      fs.copyFileSync(path.join(src, f), path.join(info.location, info.folders.photos, info.folders.months[m - 1], f));
    }
    await page.evaluate(() => serviceScan(true));
    await page.waitForFunction(() => Object.keys(S.photos).length === 36, null, { timeout: 30000 });
    await page.evaluate(async () => { for (const p of Object.values(S.photos)) p.caption = p.caption || '·'; await autoDesign(); setView('project'); });
    await sleep(800);
    await page.evaluate(() => { document.querySelector('#toast').classList.remove('on'); document.querySelector('.svc-card').style.alignSelf = 'start'; document.querySelector('.bar').style.position = 'static'; });
    await (await page.$('.svc-card')).screenshot({ path: path.join(tmp, 'card.png') });
    compose([path.join(tmp, 'picker.png'), path.join(tmp, 'card.png')], path.join(OUT[lang], 'projekt.webp'), 1600);
    // Druck-PDF mit Prüfbericht
    await page.evaluate(() => { S.doc.printer = 'fogra39'; commit(); setView('print'); });
    await page.waitForSelector('#prn');
    await page.evaluate(async () => { await exportPDF('print'); });
    await page.waitForSelector('.report', { timeout: 180000 });
    await sleep(2600);
    await page.evaluate(() => { document.querySelector('#toast').classList.remove('on'); document.querySelector('.bar').style.position = 'static'; });
    await (await page.$('.print-card')).screenshot({ path: path.join(tmp, 'print.png') });
    compose([path.join(tmp, 'print.png')], path.join(OUT[lang], 'druckpdf.webp'), 900);
    await ctx.close();
    console.log(lang, '→', OUT[lang], 'projekt.webp, druckpdf.webp');
  } finally {
    srv.kill();
    fs.rmSync(home, { recursive: true, force: true });
  }
}

(async () => {
  for (const d of Object.values(OUT)) fs.mkdirSync(d, { recursive: true });
  const browser = await pw.chromium.launch();
  await shoot(browser, 'en', 8461);
  await shoot(browser, 'de', 8462);
  await browser.close();
})().catch((e) => { console.error(e); process.exitCode = 1; });
