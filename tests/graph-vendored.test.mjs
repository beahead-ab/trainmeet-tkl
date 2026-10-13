// src/graph/drift-model.js och train-graph.js är serverns filer, oförändrade.
// Finns serverns utcheckning bredvid jämförs byte för byte (som serverns
// tests/js/i18n.test.cjs gör åt andra hållet). Kör: npm test
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = new URL('../../trainmeet-server/src/tmbox_gateway/web/', import.meta.url);
const here = new URL('../src/graph/', import.meta.url);

test('the vendored graph modules are byte-identical to the server copies', {skip: !fs.existsSync(server) && 'no sibling server checkout'}, () => {
  for (const file of ['drift-model.js', 'train-graph.js']) {
    assert.equal(fs.readFileSync(new URL(file, here), 'utf8'), fs.readFileSync(new URL(file, server), 'utf8'), `${file} differs from the server: run node tools/sync-i18n.mjs --siblings in the server`);
  }
});

test('the vendored modules are pure: no DOM at load time, no i18n, no storage', () => {
  for (const file of ['drift-model.js', 'train-graph.js']) {
    const source = fs.readFileSync(new URL(file, here), 'utf8');
    assert.doesNotMatch(source, /localStorage|TrainMeetI18n|fetch\(/, file);
  }
});
