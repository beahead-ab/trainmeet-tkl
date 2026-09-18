import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import ts from 'typescript';

// Exercise the production helpers without a browser or a running traffic server.
const source = await readFile(new URL('../src/runtime.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
});
const { movementKey, movementTrackLabel, stationTracks, stationTrackOccupants } = await import(
  `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`
);

const train = {
  id: 'movement-93-cda', station_id: 'cda', train_number: '93',
  arrival_time: null, departure_time: '06:00', sort_time: '06:00', track: '3',
};
const snapshot = {
  trains: [train], routes: [], stations: [{ id: 'cda', name: 'Charlottendal', code: 'CDA' }],
  tracks: [
    { id: 'track-cda-3', station_id: 'cda', display_label: '3', sort_order: 1 },
    { id: 'track-cda-4', station_id: 'cda', display_label: '4', sort_order: 2 },
    { id: 'track-lek-4', station_id: 'lek', display_label: '4', sort_order: 1 },
  ],
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

    // The server keys by movement_id AND canonicalizes actualTrack to a track ID.
    const context = { movements: { [train.id]: { arrival: 'none', departure, actualTrack: 'track-cda-4' } } };
    for (let refresh = 0; refresh < 3; refresh += 1) {
      const fromServer = Object.fromEntries(Object.entries(context.movements).map(([key, value]) => [
        key, { ...value, actualTrack: value.actualTrack || undefined, lineRequest: 'none' },
      ]));
      assert.equal(fromServer[movementKey(train)].actualTrack, 'track-cda-4');
      assert.equal(movementTrackLabel(snapshot, train, fromServer[train.id]), '4');
      assert.deepEqual(stationTrackOccupants(snapshot, 'cda', fromServer), before);
    }
  });
}

test('only explicit departure clears an originating train from its station track', () => {
  assert.deepEqual(stationTrackOccupants(snapshot, 'cda', {
    [train.id]: { arrival: 'none', departure: 'departed', actualTrack: '3', lineRequest: 'none' },
  }), []);
});

test('station diagram and track selector include configured tracks without scheduled trains', () => {
  assert.deepEqual(stationTracks(snapshot, 'cda'), ['3', '4']);
  assert.deepEqual(stationTracks(snapshot, 'lek'), ['4']);
  assert.deepEqual(stationTracks(snapshot, 'missing'), []);
});

test('catalogue order and active flags determine selectable tracks', () => {
  assert.deepEqual(stationTracks({ ...snapshot, tracks: [
    ...snapshot.tracks,
    { id: 'track-cda-11', station_id: 'cda', display_label: '11', sort_order: 0 },
    { id: 'track-cda-12', station_id: 'cda', display_label: '12', sort_order: 3, active: false },
  ] }, 'cda'), ['11', '3', '4']);
});

test('labels and canonical IDs resolve identically without changing server state', () => {
  for (const actualTrack of ['4', 'track-cda-4']) {
    const movement = { arrival: 'none', departure: 'ready', actualTrack, lineRequest: 'none' };
    assert.equal(movementTrackLabel(snapshot, train, movement), '4');
    assert.equal(movement.actualTrack, actualTrack);
  }
  assert.equal(movementTrackLabel(snapshot, train, {}), '3');
});

test('unknown or foreign track IDs are never guessed or painted on the scheduled track', () => {
  for (const actualTrack of ['track-lek-4', 'nonexistent-track']) {
    const movement = { arrival: 'none', departure: 'ready', actualTrack, lineRequest: 'none' };
    assert.equal(movementTrackLabel(snapshot, train, movement), null);
    assert.deepEqual(stationTrackOccupants(snapshot, 'cda', { [train.id]: movement }), []);
  }
});

test('older servers without a catalogue still render their track labels', () => {
  const { tracks, ...legacy } = snapshot;
  assert.equal(movementTrackLabel(legacy, train, { actualTrack: '4' }), '4');
  assert.deepEqual(stationTracks(legacy, 'cda'), ['3']);
});

test('position fallback also respects a server-assigned actual track', () => {
  const positionedSnapshot = { ...snapshot, train_positions: [
    { train_number: '93', status: 'station', station_id: 'cda' },
  ] };
  const movement = { arrival: 'none', departure: 'none', actualTrack: 'track-cda-4', lineRequest: 'none' };
  assert.equal(stationTrackOccupants(positionedSnapshot, 'cda', { [train.id]: movement })[0].track, '4');
  assert.deepEqual(stationTrackOccupants(positionedSnapshot, 'cda', {
    [train.id]: { ...movement, actualTrack: 'track-lek-4' },
  }), []);
});
