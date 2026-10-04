import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

// Samma typsnittsregel som i TrainMeet Server (#122): tider och nummer står i
// Inter med tabellsiffror, inte i monospace. En monospace-nolla med prick går
// på håll ihop med en åtta. Koder att skriva in behåller monospace.
const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
const rule = selector => {
  const start = css.indexOf(`${selector} {`);
  assert.notEqual(start, -1, `${selector} saknas`);
  return css.slice(start, css.indexOf('}', start));
};

test('the clock, times, train numbers and tracks are Inter with tabular digits', () => {
  for (const selector of ['.clock-pill', '.train-card-summary > time,\n.movement-detail-row time', '.train-number', '.train-direction-track']) {
    const body = rule(selector);
    assert.doesNotMatch(body, /monospace/, selector);
    assert.match(body, /font-variant-numeric: tabular-nums/, selector);
  }
});

test('a code to type in keeps monospace', () => {
  assert.match(rule('.code-boxes input'), /monospace/);
});
