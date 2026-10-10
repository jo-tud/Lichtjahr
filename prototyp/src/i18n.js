/* ---------- Sprache: Englisch (Standard) und Deutsch ----------
   Die Texte stehen auf Deutsch im Quelltext und sind zugleich der Schlüssel: _t('Fotos hinzufügen').
   Für Englisch schlägt _t sie im Wörterbuch EN nach (gefüllt von src/i18n/en_*.js). Platzhalter in
   geschweiften Klammern: _t('{n} Fotos eingelesen.', { n }). Fehlt eine Übersetzung, bleibt der deutsche
   Text stehen und landet in I18N_MISSING (zum Prüfen mit tools/i18n-check.cjs).

   Zwei Sprachen werden unterschieden:
   - LANG: Sprache der Oberfläche. Automatisch aus dem Browser (Deutsch, wenn bevorzugt, sonst Englisch),
     umschaltbar; die Wahl merkt sich der Browser.
   - calLang(): Sprache des gedruckten Kalenders (Monatsnamen, Wochentage, Feiertage, Register). Eigene
     Einstellung im Projekt (S.doc.calLang), Standard ist die Sprache der Oberfläche. */
const EN = {};
const LANGS = { en: 'English', de: 'Deutsch' };
const I18N_MISSING = new Set();

function detectLang() {
  try { const saved = localStorage.getItem('lj-lang'); if (saved && LANGS[saved]) return saved; } catch (e) { /* egal */ }
  const prefs = (navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || 'en']).map(l => String(l).toLowerCase());
  const first = prefs.find(l => /^(de|en)\b/.test(l));
  return first && first.startsWith('de') ? 'de' : 'en';
}
let LANG = detectLang();
document.documentElement.lang = LANG;

function translate(lang, s, vars) {
  let r = s;
  if (lang === 'en') {
    if (Object.prototype.hasOwnProperty.call(EN, s)) r = EN[s];
    else I18N_MISSING.add(s);
  }
  return vars ? r.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m)) : r;
}
const _t = (s, vars) => translate(LANG, s, vars);                 // Oberfläche
const calLang = () => (typeof S !== 'undefined' && S.doc && LANGS[S.doc.calLang]) ? S.doc.calLang : LANG;
const _tc = (s, vars) => translate(calLang(), s, vars);           // gedruckter Kalender
const locale = (lang = LANG) => (lang === 'de' ? 'de-DE' : 'en-GB');

const MONTH_NAMES = {
  de: ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'],
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
};
const MONTH_NAMES_SHORT = {
  de: ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'],
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
};
const WEEKDAYS2 = { de: ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'], en: ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'] };

// Texte im statischen HTML (body.html): data-i18n (Inhalt), data-i18n-label (aria-label), data-i18n-title (title)
function applyStaticTexts(root = document) {
  for (const el of root.querySelectorAll('[data-i18n]')) el.textContent = _t(el.dataset.i18n);
  for (const el of root.querySelectorAll('[data-i18n-label]')) el.setAttribute('aria-label', _t(el.dataset.i18nLabel));
  for (const el of root.querySelectorAll('[data-i18n-title]')) el.title = _t(el.dataset.i18nTitle);
}
function setLang(lang) {
  if (!LANGS[lang] || lang === LANG) return;
  LANG = lang;
  try { localStorage.setItem('lj-lang', lang); } catch (e) { /* egal */ }
  document.documentElement.lang = lang;
  applyStaticTexts();
  if (typeof renderAll === 'function') renderAll();
}
// Knopf zum Umschalten: zeigt die jeweils andere Sprache
const langButton = (cls = 'btn small') => {
  const other = LANG === 'de' ? 'en' : 'de';
  return `<button class="${cls} langbtn" data-act="lang" data-v="${other}" lang="${other}" title="${other === 'en' ? 'Switch to English' : 'Auf Deutsch umstellen'}">${other === 'en' ? 'English' : 'Deutsch'}</button>`;
};
