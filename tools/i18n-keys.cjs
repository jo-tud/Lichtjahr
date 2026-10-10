// Prüft ohne Browser, dass jeder Text in _t('…') bzw. _tc('…') eine englische Übersetzung hat
// (Wörterbücher in prototyp/src/i18n/en_*.js). Läuft in der CI. Aufruf:  node tools/i18n-keys.cjs
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = path.resolve(__dirname, '../prototyp/src');
const ctx = { EN: {}, Object };
for (const f of fs.readdirSync(path.join(SRC, 'i18n'))) vm.runInNewContext(fs.readFileSync(path.join(SRC, 'i18n', f), 'utf8'), ctx);
const missing = [];
for (const f of fs.readdirSync(SRC).filter(f => f.endsWith('.js'))) {
  const src = fs.readFileSync(path.join(SRC, f), 'utf8');
  for (const m of src.matchAll(/_tc?\(\s*'((?:[^'\\]|\\.)*)'/g)) {
    const key = m[1].replace(/\\'/g, "'").replace(/\\\\/g, '\\');
    if (!(key in ctx.EN)) missing.push(`${f}: ${key}`);
  }
}
if (missing.length) {
  console.error(`Ohne englische Übersetzung (${missing.length}):\n  ` + missing.join('\n  '));
  process.exit(1);
}
console.log(`Alle Texte übersetzt (${Object.keys(ctx.EN).length} Einträge).`);
