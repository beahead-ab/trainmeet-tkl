// Förseningar och för tidiga tåg i TKL, med samma regler och fall som serverns
// tests/js/train-live.test.cjs (drift-model.js). Kör: npm test
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const source = await readFile(new URL('../src/trainLive.ts', import.meta.url), 'utf8');
const output = ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022}}).outputText;
const model = await import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`);

const at = (hhmm) => { const [h, m, s = 0] = hhmm.split(':').map(Number); return h * 3600 + m * 60 + s; };
// 101: A 09:20 → B 09:35/09:37 → C 09:50
const stops = [['a', null, '09:20'], ['b', '09:35', '09:37'], ['c', '09:50', null]];
const snapshot = (live = {}, type = 'person') => ({
  clock: {time: '09:00:00'},
  services: [{id: 's101', train_number: '101', train_type: type, stops: stops.map(([station_id, arrival_time, departure_time], stop_order) => ({station_id, arrival_time, departure_time, stop_order}))}],
  trains: stops.map(([station_id, arrival_time, departure_time], i) => ({id: `m${i}`, service_id: 's101', train_number: '101', station_id, arrival_time, departure_time})),
  movement_live: live, display: {},
});
const live101 = (snap, now) => model.trainLive(snap, at(now)).get('101');

test('a late departure is late from three minutes; two is on time', () => {
  assert.deepEqual([live101(snapshot({m0: {departure: 'departed', departed_seconds: at('09:22')}}), '09:25').late], [false]);
  const seven = live101(snapshot({m0: {departure: 'departed', departed_seconds: at('09:27')}}), '09:30');
  assert.deepEqual([seven.state, seven.delayMinutes, seven.late], ['on_line', 7, true]);
});

test('a train still standing after its departure time counts up, estimated', () => {
  const train = live101(snapshot(), '09:26');
  assert.deepEqual([train.state, train.delayMinutes, train.estimated], ['waiting', 6, true]);
});

test('an early departure is early for a passenger train, never for goods or work', () => {
  const left = {m0: {departure: 'departed', departed_seconds: at('09:18')}};
  assert.equal(model.deviationView(4, live101(snapshot(left), '09:19')).mark?.text, '−2');
  for (const type of ['goods', 'work']) {
    for (const level of [1, 2, 3, 4, 5]) assert.equal(model.deviationView(level, live101(snapshot(left, type), '09:19')).mark, null, `${type} ${level}`);
  }
});

test('each level shows its own amount, and the device choice goes first', () => {
  const late = (minutes, estimated = false) => ({delayMinutes: minutes, estimated, earlyMinutes: 0});
  const view = (level, train) => { const v = model.deviationView(level, train); return [v.flash, v.mark?.style ?? null, v.mark?.text ?? null]; };
  assert.deepEqual(view(1, late(9)), [false, null, null]);
  assert.deepEqual(view(2, late(9)), [true, null, null]);
  assert.deepEqual(view(3, late(4)), [true, null, null]);
  assert.deepEqual(view(3, late(5)), [true, 'text', '+5']);
  assert.deepEqual(view(4, late(3)), [true, 'pill', '+3']);
  assert.deepEqual(view(5, late(1)), [true, 'pill', '+1']);
  assert.equal(model.deviationLevel({display: {deviation_level: 4}}), 4);
  assert.equal(model.deviationLevel({display: {deviation_level: 4}}, '1'), 1);
  assert.equal(model.deviationLevel({}), 2);
});

test('a train on the line has come as far as the clock says', () => {
  const snap = snapshot();
  assert.equal(model.legProgress(snap, '101', 'a', 'b', at('09:20'), at('09:27:30')), 0.5, 'half of 15 minutes');
  assert.equal(model.legProgress(snap, '101', 'a', 'b', at('09:25'), at('09:27:30')), 2.5 / 15, 'from the real departure');
  assert.equal(model.legProgress(snap, '101', 'a', 'b', null, at('09:35')), 1);
  assert.equal(model.legProgress(snap, '101', 'x', 'b', null, at('09:30')), null, 'no timetable for the leg');
});

test('the clock runs on between pictures', () => {
  const snap = {clock: {time: '09:00:00', running: true, speed: 4}};
  assert.equal(model.clockSeconds(snap, 1000, 1000 + 15000), at('09:01'));
  assert.equal(model.clockSeconds({clock: {time: '09:00:00', running: false}}, 1000, 61000), at('09:00'));
});
