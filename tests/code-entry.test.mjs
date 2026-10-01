import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const boxes = fs.readFileSync(new URL('../src/components/CodeBoxes.tsx', import.meta.url), 'utf8');
const styles = fs.readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

// Ett vanligt textfält säger ingenting om hur lång koden är eller om strecket
// ska skrivas. Båda ställena där en kod matas in ska visa formen.
test('båda kodfälten är rutor med förtryckt streck', () => {
  assert.equal(app.match(/<CodeBoxes /g)?.length, 2);
  assert.doesNotMatch(app, /placeholder=\{t\("Anslutningskod/);
  assert.match(boxes, /code-boxes-dash/);
  assert.match(styles, /\.code-boxes input \{/);
});

test('rutorna tar sex siffror och bara siffror', () => {
  assert.match(boxes, /slice\(0, 6\)/);
  assert.match(boxes, /replace\(\/\\D\/g, ""\)/);
  assert.match(boxes, /inputMode="numeric"/);
  assert.match(boxes, /maxLength=\{1\}/);
});

// Den som kopierar koden tar med sig skrivningen den hade. Inklistring ska
// därför rensas, inte avvisas.
test('inklistrad kod med streck eller mellanslag fylls i rutorna', () => {
  assert.match(boxes, /onPaste=\{\(event\) => \{ event.preventDefault\(\); spread\(event.clipboardData.getData\("text"\), 0\); \}\}/);
});

test('varje ruta säger vilken av sex den är', () => {
  assert.match(boxes, /aria-label=\{`\$\{label\}: \$\{index \+ 1\}\/6`\}/);
});
