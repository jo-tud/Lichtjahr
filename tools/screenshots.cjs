// Erzeugt die Bilder für das README aus dem gebauten Prototyp (prototyp/dist/index.html), auf Englisch und Deutsch.
// Aufruf:  node tools/screenshots.cjs   (Playwright mit Chromium und Python mit Pillow werden vorausgesetzt)
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');
let pw;
try { pw = require('playwright'); } catch (e) { pw = require('/opt/node22/lib/node_modules/playwright'); }
const { chromium, devices } = pw;

const ROOT = path.resolve(__dirname, '..');
const URL = 'file://' + path.join(ROOT, 'prototyp/dist/index.html');
// Englisch nach docs/images, Deutsch nach docs/images/de (für README.de.md)
const LANG_OUT = { en: path.join(ROOT, 'docs/images'), de: path.join(ROOT, 'docs/images/de') };
let OUT = LANG_OUT.en;
let TMP = fs.mkdtempSync(path.join(require('os').tmpdir(), 'lj-shots-'));

async function ready(page) {
  await page.goto(URL);
  await page.waitForSelector('#editor', { timeout: 60000 });
  await page.evaluate(() => { ui.banner = false; renderAll(); });
  await page.waitForTimeout(500);
}
const png = (name) => path.join(TMP, name + '.png');
// PNG → WebP in sinnvoller Breite (Python/Pillow, damit keine weiteren Node-Pakete nötig sind)
function webp(name, width) {
  execFileSync('python3', ['-c', `
from PIL import Image
im = Image.open(${JSON.stringify(png(name))}).convert('RGB')
if im.width > ${width}: im = im.resize((${width}, round(im.height * ${width} / im.width)), Image.LANCZOS)
im.save(${JSON.stringify(path.join(OUT, name + '.webp'))}, 'WEBP', quality=84, method=6)
`]);
}

async function shoot(browser, lang) {
  OUT = LANG_OUT[lang]; fs.mkdirSync(OUT, { recursive: true });
  TMP = fs.mkdtempSync(path.join(require('os').tmpdir(), `lj-shots-${lang}-`));
  const setLang = (l) => { try { localStorage.setItem('lj-lang', l); } catch (e) { /* egal */ } };
  const desk = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, locale: lang === 'de' ? 'de-DE' : 'en-US' });
  await desk.addInitScript(setLang, lang);
  const page = await desk.newPage();
  await ready(page);

  // 1. Gestalten (Titelbild)
  await page.evaluate(() => { ui.page = 'm1'; ui.tab = 'layout'; renderAll(); });
  await page.waitForTimeout(400);
  await page.screenshot({ path: png('gestalten') }); webp('gestalten', 1600);

  // 2. Rahmen bearbeiten mit Werkzeugleiste
  await page.evaluate(() => { ui.page = 'm4'; ui.sel = 0; ui.tab = 'photos'; renderAll(); });
  await page.waitForTimeout(400);
  await page.screenshot({ path: png('rahmen') }); webp('rahmen', 1600);

  // 3. Kalendarium findet seinen Platz (Analyse-Moment)
  await page.evaluate(() => { ui.page = 'm2'; ui.sel = null; ui.tab = 'cal'; renderAll(); });
  await page.waitForTimeout(300);
  await page.click('[data-act="placehere"]');
  await page.waitForTimeout(700);
  await page.screenshot({ path: png('platz') }); webp('platz', 1600);
  await page.waitForTimeout(1600);

  // 4. Fotos nach Monaten
  await page.evaluate(() => setView('photos'));
  await page.waitForTimeout(500);
  await page.screenshot({ path: png('fotos') }); webp('fotos', 1600);

  // 5. Leuchttisch und PDF
  await page.evaluate(() => setView('print'));
  await page.waitForTimeout(600);
  await page.screenshot({ path: png('druck') }); webp('druck', 1600);

  // 6. An der Wand + Animation des Umblätterns (verlangsamt aufgenommen)
  await page.evaluate(() => { setView('design'); ui.page = 'm4'; openWall(); });
  await page.waitForTimeout(1800);
  await page.screenshot({ path: png('wand') }); webp('wand', 1600);
  const box = await page.locator('.wall-stage').boundingBox();
  const frames = [];
  await page.evaluate(() => flip(1));
  await page.evaluate(() => document.getAnimations().forEach(a => a.playbackRate = .25));
  for (let i = 0; i < 26; i++) {
    const f = path.join(TMP, `flip${String(i).padStart(2, '0')}.png`);
    await page.screenshot({ path: f, clip: box, scale: 'css' }); frames.push(f);
    await page.waitForTimeout(120);
  }
  execFileSync('python3', ['-c', `
from PIL import Image
fs = ${JSON.stringify(frames)}
ims = [Image.open(f).convert('RGB') for f in fs]
w = 560; ims = [im.resize((w, round(im.height * w / im.width)), Image.LANCZOS) for im in ims]
ims = ims + [ims[-1]] * 8
pal = [im.quantize(colors=128, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE) for im in ims]
pal[0].save(${JSON.stringify(path.join(OUT, 'wand.gif'))}, save_all=True, append_images=pal[1:], duration=70, loop=0, optimize=True)
`]);

  // 7. Handy: Gestalten und Wand nebeneinander
  const phone = await browser.newContext({ ...devices['iPhone 13'], deviceScaleFactor: 2, locale: lang === 'de' ? 'de-DE' : 'en-US' });
  await phone.addInitScript(setLang, lang);
  const mp = await phone.newPage();
  await ready(mp);
  await mp.evaluate(() => { ui.page = 'm1'; ui.tab = 'photos'; renderAll(); });
  await mp.waitForTimeout(400);
  await mp.screenshot({ path: png('handy-1') });
  await mp.evaluate(() => openWall()); await mp.waitForTimeout(1800);
  await mp.screenshot({ path: png('handy-2') });
  execFileSync('python3', ['-c', `
from PIL import Image
a, b = Image.open(${JSON.stringify(png('handy-1'))}), Image.open(${JSON.stringify(png('handy-2'))})
gap = 60; c = Image.new('RGB', (a.width + b.width + gap, max(a.height, b.height)), (232, 235, 238))
c.paste(a, (0, 0)); c.paste(b, (a.width + gap, 0)); c.save(${JSON.stringify(png('handy'))})
`]);
  webp('handy', 900);
  await desk.close(); await phone.close();
  console.log('Bilder geschrieben nach', OUT);
  for (const f of fs.readdirSync(OUT)) if (/\.(webp|gif)$/.test(f)) console.log(' ', f, Math.round(fs.statSync(path.join(OUT, f)).size / 1024), 'KB');
}

(async () => {
  const browser = await chromium.launch();
  for (const lang of ['en', 'de']) await shoot(browser, lang);
  await browser.close();
})();
