// Tågdiagrammet i TKL sitter i verktygsraden och öppnas i helskärm. Kör: npm test
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const app = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const view = fs.readFileSync(new URL('../src/TrainGraphView.tsx', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

test('the toolbar offers Tågdiagram only when the server sends services (never in demo mode)', () => {
  const nav = app.slice(app.indexOf('<nav className="dispatcher-toolbar"'), app.indexOf('</nav>'));
  assert.match(nav, /\(snapshot\.services\?\.length \?\? 0\) > 0 && \(/);
  assert.match(nav, /onOverlay\("graph"\)/);
  assert.match(nav, /<span>\{t\("Tågdiagram"\)\}<\/span>/);
  // På telefonen döljs texten i verktygsraden; namnet står kvar för skärmläsaren.
  assert.match(nav, /aria-label=\{t\("Tågdiagram"\)\} onClick=\{\(\) => onOverlay\("graph"\)\}/);
  assert.match(app, /type Overlay = "settings" \| "tambox" \| "menu" \| "graph" \| null;/);
});

test('the graph is its own full-screen view, not the narrow side panel, and a tapped train opens its card', () => {
  assert.match(app, /\{overlay === "graph" && \(\s*<TrainGraphView/);
  assert.match(app, /onSelectTrain=\{\(trainNumber\) => \{ setOverlay\(null\); selectTrain\(trainNumber\); \}\}/);
  assert.match(app, /\{overlay && overlay !== "graph" && \(\s*<OverlayPanel/);
  assert.match(view, /className="graph-view" role="dialog" aria-modal="true"/);
  assert.match(css, /\.graph-view \{ position: fixed; inset: 0;/);
});

test('the view follows the meet clock, marks the own station, persists the window and closes on Escape', () => {
  assert.match(view, /now: nowSeconds \/ 60/);
  assert.match(view, /classList\.add\("is-own"\)/);
  assert.match(view, /localStorage\.setItem\(WINDOW_KEY, String\(value\)\)/);
  assert.match(view, /WINDOW_KEY = "trainmeet-tkl\.graph-window"/);
  assert.match(view, /event\.key === "Escape"\) onClose\(\)/);
  assert.match(view, /label: \(number\) => t\("Tåg \{number\}", \{ number \}\)/);
  assert.match(view, /defaultLine\(lines, stationId\)/);
  // Ryms diagrammet fyller det skärmen som storskärmen gör.
  assert.match(view, /if \(available > g\.height\) g = lib\.layout\(graph, \{ \.\.\.options, height: available \}\);/);
});

test('train types keep the server colours: red person, blue goods, green work', () => {
  assert.match(css, /--graph-person: 0 70% 50%; --graph-goods: 220 70% 45%; --graph-work: 142 60% 40%;/);
  assert.match(css, /\.tg-line\.is-person \{ stroke: hsl\(var\(--graph-person\)\); \}/);
});
