// Om trafikspelet i TKL (Casper 2026-10-14): berättelsen, instruktionerna och
// programmet ur Cloud i helskärm, och den egna stationens instruktioner i
// huvudvyn. Texterna ritas av serverns markdown.js (en byte-identisk kopia).
// Kör: npm test
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const app = read('../src/App.tsx');
const view = read('../src/AboutView.tsx');
const api = read('../src/api.ts');
const css = read('../src/styles.css');
const gateway = read('../terminal/trainmeet_tkl_terminal.py');

const vendored = () => {
  const context = vm.createContext({});
  vm.runInContext(read('../src/text/markdown.js'), context);
  return context.TrainMeetMarkdown;
};

test('the toolbar offers Om trafikspelet only when the meet has texts to read', () => {
  const nav = app.slice(app.indexOf('<nav className="dispatcher-toolbar"'), app.indexOf('</nav>'));
  assert.match(nav, /\{snapshot\.about\?\.available && \(/);
  assert.match(nav, /aria-label=\{t\("Om trafikspelet"\)\} onClick=\{\(\) => onOverlay\("about"\)\}/);
  assert.match(app, /\{overlay === "about" && <AboutView station=\{station\} onClose=\{\(\) => setOverlay\(null\)\} \/>\}/);
  assert.match(view, /className="about-view" role="dialog" aria-modal="true"/);
  assert.match(css, /\.about-view \{ position: fixed; inset: 0;/);
});

test('the view reads /v1/about through the terminal, which keeps the texts for offline', () => {
  assert.match(api, /terminalOrServer<AboutTexts>\("\/terminal\/about", "\/v1\/about"\)/);
  assert.match(gateway, /\("GET", "\/terminal\/about"\): "operate"/);
  assert.match(gateway, /self\.server_json\("\/v1\/about", authenticated=False\)/);
  assert.match(gateway, /atomic_json_write\(self\.about_cache_path, about\)/);
});

test('the reader gets the instructions in their language, else the meet\'s, and the own station first', () => {
  assert.match(view, /markdown\(\)\.pick\(about\.instructions, language, texts\?\.meet\.language \|\| "sv"\)/);
  assert.match(view, /sort\(\(a, b\) => Number\(b\.id === station\.id\) - Number\(a\.id === station\.id\)\)/);
  const md = vendored();
  const texts = {sv: 'Ring bara vid fel.', da: 'Ring kun ved fejl.'};
  assert.deepEqual({...md.pick(texts, 'da', 'sv')}, {language: 'da', text: 'Ring kun ved fejl.'});
  assert.deepEqual({...md.pick(texts, 'de', 'sv')}, {language: 'sv', text: 'Ring bara vid fel.'});
  assert.equal(md.pick({}, 'sv', 'sv'), null);
});

test('the own station\'s instructions sit in the main view, folded, and only when there are any', () => {
  assert.match(app, /<AttentionQueue [^\n]+\/>\s*<StationInstructions station=\{station\} \/>/);
  assert.match(view, /if \(!text\) return null;/);
  assert.match(view, /<details className="station-instructions">/);
  assert.match(view, /t\("Instruktioner för \{station\}", \{ station: station\.name \}\)/);
});

test('the texts are drawn as elements, never as markup', () => {
  assert.doesNotMatch(view, /dangerouslySetInnerHTML|innerHTML/);
  assert.match(read('../src/text/index.tsx'), /markdown\(\)\.render\(host\.current, text, \{ headingBase \}\)/);
});
