// Toasten vid dygnsskiftet i TKL, samma regler och fall som serverns
// tests/js/day-change.test.cjs (day-change.js). Kör: npm test
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const source = await readFile(new URL('../src/dayChange.ts', import.meta.url), 'utf8');
const output = ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022}}).outputText;
const {dayChangeNotice, SHOWN_SECONDS} = await import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`);

const at = '2026-10-09T03:00:00Z';
const snapshot = (calendar, serverTime = '2026-10-09T03:00:20Z') => ({calendar, server_time: serverTime});
const changed = {day_number: 2, weekday: 'Lör', waiting: false, last_change: {kind: 'day_change', day_number: 2, weekday: 'Lör', at}};

test('a day change just now is told once', () => {
  assert.deepEqual(dayChangeNotice(snapshot(changed)), {kind: 'changed', key: at, dayNumber: 2, weekday: 'Lör'});
  assert.equal(dayChangeNotice(snapshot(changed), at), null, 'already shown');
});

test('a page opened long after the change says nothing', () => {
  assert.equal(SHOWN_SECONDS, 90);
  assert.ok(dayChangeNotice(snapshot(changed, '2026-10-09T03:01:29Z')));
  assert.equal(dayChangeNotice(snapshot(changed, '2026-10-09T03:01:31Z')), null);
});

test('only the day change itself is told, and waiting is told while it lasts', () => {
  assert.equal(dayChangeNotice(snapshot({...changed, last_change: {...changed.last_change, kind: 'time_machine'}})), null);
  assert.deepEqual(dayChangeNotice(snapshot({...changed, last_change: null, waiting: true})), {kind: 'waiting', key: 'waiting'});
  assert.equal(dayChangeNotice({calendar: null}), null);
  assert.equal(dayChangeNotice(snapshot({...changed, last_change: {...changed.last_change, at: 'när som helst'}})), null);
});
