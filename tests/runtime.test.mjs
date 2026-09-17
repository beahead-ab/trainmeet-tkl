import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import ts from 'typescript';

// Exercise the production helpers without a browser or a running traffic server.
const source = await readFile(new URL('../src/runtime.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
});
const { movementKey, stationTrackOccupants } = await import(
  `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`
);

const train = {
  id: 'movement-93-cda', station_id: 'cda', train_number: '93',
  arrival_time: null, departure_time: '06:00', sort_time: '06:00', track: '3',
};
const snapshot = {
  trains: [train], routes: [], stations: [{ id: 'cda', name: 'Charlottendal', code: 'CDA' }],
  connections: [], connection_states: [], train_positions: [],
};

test('UI movement identity is the movement_id used by the server', () => {
  assert.equal(movementKey(train), train.id);
  assert.equal(movementKey({ ...train, track: '4', departure_time: '06:05' }), train.id);
});

test('different movement IDs do not share local state even with identical timetable fields', () => {
  assert.notEqual(movementKey(train), movementKey({ ...train, id: 'movement-93-other' }));
});

for (const departure of ['positioned', 'ready']) {
  test(`${departure} train stays on its actual track after repeated server refreshes`, () => {
    const saved = { arrival: 'none', departure, actualTrack: '4', lineRequest: 'none' };
    const optimistic = { [movementKey(train)]: saved };
    const before = stationTrackOccupants(snapshot, 'cda', optimistic);
    assert.equal(before.length, 1);
    assert.equal(before[0].track, '4');

    // Same shape as GET /v1/tkl/context: the object is keyed by movement_id.
    const context = { movements: { [train.id]: { arrival: 'none', departure, actualTrack: '4' } } };
    for (let refresh = 0; refresh < 3; refresh += 1) {
      const fromServer = Object.fromEntries(Object.entries(context.movements).map(([key, value]) => [
        key, { ...value, actualTrack: value.actualTrack || undefined, lineRequest: 'none' },
      ]));
      assert.deepEqual(fromServer[movementKey(train)], saved);
      assert.deepEqual(stationTrackOccupants(snapshot, 'cda', fromServer), before);
    }
  });
}

test('only explicit departure clears an originating train from its station track', () => {
  assert.deepEqual(stationTrackOccupants(snapshot, 'cda', {
    [train.id]: { arrival: 'none', departure: 'departed', actualTrack: '3', lineRequest: 'none' },
  }), []);
});
