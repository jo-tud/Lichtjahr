// Findet fehlende englische Übersetzungen: öffnet die gebaute App auf Englisch, geht durch alle Ansichten,
// Reiter und typische Dialoge und gibt aus, welche Texte _t()/_tc() nicht im Wörterbuch EN gefunden haben.
// Zusätzlich: sichtbarer Text, der nach Deutsch aussieht (Umlaute, typische Wörter), als Hinweis auf
// Stellen ohne _t(). Aufruf:  node tools/i18n-check.cjs   (nach prototyp/build.sh)
const path = require('path');
let pw;
try { pw = require('playwright'); } catch (e) { pw = require('/opt/node22/lib/node_modules/playwright'); }

const URL = 'file://' + path.resolve(__dirname, '../prototyp/dist/index.html');
const GERMAN = /[äöüßÄÖÜ]|\b(und|oder|nicht|der|die|das|mit|für|ein|eine|Seite|Fotos?|Monat|Kalendarium|Rahmen|hinzufügen|Druck)\b/;

(async () => {
  const browser = await pw.chromium.launch();
  const ctx = await browser.newContext({ locale: 'en-US', viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(URL);
  await page.waitForSelector('#editor', { timeout: 60000 });
  const suspicious = new Set();
  const collect = async (where) => {
    const texts = await page.evaluate(() => {
      const out = [];
      const walk = (n) => {
        if (n.nodeType === 3) { const t = n.textContent.trim(); if (t && n.parentElement && n.parentElement.offsetParent !== null && !n.parentElement.closest('svg')) out.push(t); }
        else if (n.nodeType === 1 && !['SCRIPT', 'STYLE'].includes(n.tagName)) { for (const c of n.childNodes) walk(c); for (const a of ['title', 'aria-label', 'placeholder']) if (n.getAttribute && n.getAttribute(a)) out.push(n.getAttribute(a)); }
      };
      walk(document.body);
      return out;
    });
    for (const t of texts) if (GERMAN.test(t)) suspicious.add(`[${where}] ${t.slice(0, 120)}`);
  };
  const steps = [
    ['design', async () => page.evaluate(() => setView('design'))],
    ...['layout', 'photos', 'cal'].map(tab => [`design/${tab}`, async () => page.evaluate((t) => { ui.tab = t; renderAll(); }, tab)]),
    ['design/frame', async () => page.evaluate(() => { ui.page = 'm2'; ui.sel = 0; renderAll(); })],
    ['design/cover', async () => page.evaluate(() => { ui.page = 'cover'; ui.sel = null; ui.tab = 'layout'; renderAll(); })],
    ['design/index', async () => page.evaluate(() => { ui.page = 'index'; renderAll(); })],
    ['project', async () => page.evaluate(() => setView('project'))],
    ['project/duplex', async () => page.evaluate(() => { S.doc.duplex = true; renderAll(); })],
    ['photos', async () => page.evaluate(() => setView('photos'))],
    ['photos/selection', async () => page.evaluate(() => { const id = Object.keys(S.photos)[0]; ui.photoSel = new Set([id]); ui.photoFocus = id; renderAll(); })],
    ['print', async () => page.evaluate(() => setView('print'))],
    ['print/sheets', async () => page.evaluate(() => { ui.ltMode = 'sheets'; renderAll(); })],
    ['wall', async () => page.evaluate(() => openWall())],
  ];
  for (const [name, fn] of steps) {
    try { await fn(); await page.waitForTimeout(400); await collect(name); } catch (e) { errors.push(`${name}: ${e.message}`); }
  }
  const missing = await page.evaluate(() => [...I18N_MISSING]);
  console.log(`Fehlende Übersetzungen (${missing.length}):`);
  for (const m of missing) console.log('  ' + JSON.stringify(m));
  console.log(`\nSichtbarer Text, der deutsch aussieht (${suspicious.size}):`);
  for (const s of suspicious) console.log('  ' + s);
  if (errors.length) console.log('\nFehler:', errors);
  await browser.close();
  process.exitCode = missing.length || errors.length ? 1 : 0;
})();
