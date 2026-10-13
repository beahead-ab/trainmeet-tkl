// Tågdiagrammet i TKL: serverns ritare (src/graph/) laddad som i webbläsaren,
// och TKL:s egen regel för vilken linje som visas först. Kör: npm test
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const read = (file) => fs.readFileSync(new URL(file, import.meta.url), 'utf8');
// Som i webbläsaren: inget `module`, filerna lägger sig på globalThis i laddningsordning.
const context = vm.createContext({});
for (const file of ['../src/graph/drift-model.js', '../src/graph/train-graph.js']) vm.runInContext(read(file), context, {filename: file});
const lib = context.TrainMeetTrainGraph;
const own = await import(`data:text/javascript;base64,${Buffer.from(ts.transpileModule(read('../src/graph/index.ts').replace(/^import '.*';$/gm, ''),
  {compilerOptions: {module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022}}).outputText).toString('base64')}`);

const stop = (station_id, minute, arrival_time, departure_time, stop_order) => ({station_id, stop_order, arrival_time, departure_time, service_day_offset: 0, service_minute: minute});
// Alvesta – Borgholm – Charlottendal på huvudlinjen, Borgholm – Dalby som gren; Borgholm har två spår.
const snapshot = {
  stations: [{id: 'alv', name: 'Alvesta', code: 'ALV'}, {id: 'bor', name: 'Borgholm', code: 'BOR'}, {id: 'cda', name: 'Charlottendal', code: 'CDA'}, {id: 'dal', name: 'Dalby', code: 'DAL'}],
  connections: [{id: 'ab', station_a_id: 'alv', station_b_id: 'bor', track_type: 'single'}, {id: 'bc', station_a_id: 'bor', station_b_id: 'cda', track_type: 'single'}, {id: 'bd', station_a_id: 'bor', station_b_id: 'dal', track_type: 'single'}],
  tracks: [{station_id: 'bor', display_label: '1', sort_order: 1, active: true}, {station_id: 'bor', display_label: '2', sort_order: 2, active: true}],
  trains: [{id: 'r1', service_id: 's-t1', station_id: 'bor', track: '2'}],
  services: [
    {id: 's-t1', train_number: 'T1', train_type: 'person', stops: [stop('alv', 600, null, '10:00', 0), stop('bor', 615, '10:12', '10:15', 1), stop('cda', 630, '10:30', null, 2)]},
    {id: 's-t2', train_number: 'T2', train_type: 'goods', stops: [stop('cda', 660, null, '11:00', 0), stop('bor', 675, '11:15', '11:15', 1), stop('alv', 690, '11:30', null, 2)]},
    {id: 's-t3', train_number: 'T3', train_type: 'person', stops: [stop('bor', 900, null, '15:00', 0), stop('dal', 910, '15:10', null, 1)]},
  ],
  display: {graph_station_order: ['alv', 'bor', 'cda', 'dal'], topology_mainline_station_ids: ['alv', 'bor', 'cda'], topology_branch_station_ids: ['dal']},
  clock: {time: '10:05:00'},
  connection_states: [], train_positions: [],
};

test('the vendored modules register on globalThis when loaded like the browser does', () => {
  assert.equal(typeof context.TrainMeetDriftModel?.stationMap, 'function');
  assert.equal(typeof lib.layout, 'function');
  assert.equal(typeof lib.render, 'function');
  assert.match(read('../src/graph/train-graph.js'), /root\.TrainMeetTrainGraph = api;/);
  assert.match(read('../src/graph/drift-model.js'), /root\.TrainMeetDriftModel = api;/);
});

test('the lines: the main line first, every branch after it', () => {
  const lines = lib.lines(snapshot);
  assert.deepEqual([...lines.map((line) => line.name)], ['Alvesta–Charlottendal', 'Borgholm–Dalby']);
  assert.deepEqual([...lines[1].stations.map((station) => station.id)], ['bor', 'dal']);
});

test("the station's line is shown first: the main line when the station is on it, else the branch", () => {
  const lines = lib.lines(snapshot);
  assert.equal(own.defaultLine(lines, 'bor'), lines[0].id);
  assert.equal(own.defaultLine(lines, 'cda'), lines[0].id);
  assert.equal(own.defaultLine(lines, 'dal'), lines[1].id);
  assert.equal(own.defaultLine(lines, 'nowhere'), lines[0].id);
  assert.equal(own.defaultLine([], 'bor'), null);
});

test('a three-hour window around the meet clock, the now line inside it, and the tracks of one station', () => {
  // Mängden skapas i samma värld som ritaren, som i webbläsaren (instanceof Set).
  const g = lib.layout(snapshot, {width: 1000, windowMinutes: 180, now: 605, line: lib.lines(snapshot)[0].id, tracks: vm.runInContext('new Set(["bor"])', context)});
  assert.equal(g.now, 605);
  assert.ok(g.nowX > g.left && g.nowX < 1000);
  assert.equal(g.end - g.start, 180);
  assert.ok(g.start <= 605 && 605 <= g.end);
  assert.deepEqual([...g.trains.map((train) => train.number)].sort(), ['T1', 'T2']);
  const borgholm = g.panels[0].stations.find((entry) => entry.station.id === 'bor');
  assert.deepEqual([...borgholm.tracks.map((track) => track.label)], ['1', '2']);
  // En infälld station har ingen spårrad alls.
  assert.equal(g.panels[0].stations.find((entry) => entry.station.id === 'alv').tracks.length, 0);
});

test('TKL class names carry the tg- prefix so they never collide with the app', () => {
  for (const [role, value] of Object.entries(own.TKL)) {
    if (typeof value !== 'string') continue;
    for (const name of value.split(' ')) assert.ok(name.startsWith('tg-') || name.startsWith('is-'), `${role}: ${name}`);
  }
});
