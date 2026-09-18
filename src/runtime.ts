import type {
  LocalMovementState,
  RouteStop,
  RuntimeSnapshot,
  Station,
  StationTrackOccupant,
  TrainRow,
} from "./types";

const CHARLOTTENDAL_ID = "4d1e3bfe-0db9-4490-8ef0-3eb85f01230c";

export const fallbackStationId = CHARLOTTENDAL_ID;

export function dedupeTrains(rows: TrainRow[]): TrainRow[] {
  const found = new Map<string, TrainRow>();
  for (const row of rows) {
    const key = [
      row.station_id,
      row.train_number,
      row.arrival_time ?? "",
      row.departure_time ?? "",
      row.track ?? "",
    ].join("|");
    if (!found.has(key)) found.set(key, row);
  }
  return [...found.values()].sort((a, b) => {
    const manual = (a.manual_sort_order ?? 0) - (b.manual_sort_order ?? 0);
    return manual || a.sort_time.localeCompare(b.sort_time) || a.train_number.localeCompare(b.train_number);
  });
}

export function routesForTrain(snapshot: RuntimeSnapshot, trainNumber: string): RouteStop[] {
  const unique = new Map<string, RouteStop>();
  snapshot.routes
    .filter((stop) => stop.train_number === trainNumber)
    .forEach((stop) => unique.set(`${stop.stop_order}|${stop.station_id}`, stop));
  return [...unique.values()].sort((a, b) => a.stop_order - b.stop_order);
}

export function routeNeighbors(
  snapshot: RuntimeSnapshot,
  train: TrainRow,
): { from: Station | null; to: Station | null } {
  const stops = routesForTrain(snapshot, train.train_number);
  const index = stops.findIndex((stop) => stop.station_id === train.station_id);
  const stationById = new Map(snapshot.stations.map((station) => [station.id, station]));
  const from = index > 0 ? stationById.get(stops[index - 1].station_id) ?? null : null;
  const to = index >= 0 && index < stops.length - 1
    ? stationById.get(stops[index + 1].station_id) ?? null
    : null;
  return { from, to };
}

export function stationTracks(snapshot: RuntimeSnapshot, stationId: string): string[] {
  if (snapshot.tracks !== undefined) {
    return [...new Set(snapshot.tracks
      .filter((track) => track.station_id === stationId && track.active !== false)
      .sort((a, b) => a.sort_order - b.sort_order || a.display_label.localeCompare(b.display_label, "sv", { numeric: true }))
      .map((track) => track.display_label))];
  }
  // Older servers did not include a track catalogue in the display snapshot.
  const tracks = new Set(
    snapshot.trains
      .filter((train) => train.station_id === stationId)
      .map((train) => train.track)
      .filter(Boolean),
  );
  if (stationId === CHARLOTTENDAL_ID) {
    return ["1a", "1b", "2a", "2b", "3", "4", "11", "12", "13"];
  }
  return [...tracks].sort((a, b) => a.localeCompare(b, "sv", { numeric: true }));
}

export function movementTrackLabel(
  snapshot: RuntimeSnapshot,
  train: TrainRow,
  movement: LocalMovementState,
): string | null {
  const value = movement.actualTrack || train.track;
  if (!value) return null;
  if (snapshot.tracks === undefined) return value;
  // Keep the authoritative ID in movement state; only translate for display.
  // Optimistic updates (and older servers) can still contain a visible label.
  const byId = snapshot.tracks.find((track) => track.id === value);
  if (byId) return byId.station_id === train.station_id ? byId.display_label : null;
  const matches = snapshot.tracks.filter((track) => (
    track.station_id === train.station_id && track.display_label.toLocaleLowerCase("sv") === value.toLocaleLowerCase("sv")
  ));
  return matches.length === 1 ? matches[0].display_label : null;
}

export function formatClock(value: string): string {
  const parts = value.split(":");
  return `${parts[0] ?? "00"}:${parts[1] ?? "00"}`;
}

export function movementKey(train: TrainRow): string {
  // The server saves and returns movement states by movement_id, not timetable
  // fields. Use the same identity before and after the next context refresh.
  return train.id;
}

export function isFreight(train: TrainRow): boolean {
  if (train.train_type === "gods") return true;
  return /^[459]/.test(train.train_number);
}

export function isOnLine(snapshot: RuntimeSnapshot, trainNumber: string): boolean {
  return snapshot.train_positions.some(
    (position) => position.train_number === trainNumber && position.status === "connection",
  );
}

export function defaultStation(snapshot: RuntimeSnapshot): Station {
  const stored = window.localStorage.getItem("trainmeet-tkl.station-id");
  return snapshot.stations.find((station) => station.id === stored)
    ?? snapshot.stations.find((station) => station.id === CHARLOTTENDAL_ID)
    ?? snapshot.stations[0];
}

function sideForNeighbor(snapshot: RuntimeSnapshot, stationId: string, neighborId?: string): "left" | "right" | null {
  if (!neighborId) return null;
  const connection = snapshot.connections.find((candidate) => (
    (candidate.station_a_id === stationId && candidate.station_b_id === neighborId)
    || (candidate.station_b_id === stationId && candidate.station_a_id === neighborId)
  ));
  if (!connection) return null;
  const raw = connection.station_a_id === stationId
    ? connection.display_side_a
    : connection.display_side_b;
  return raw?.startsWith("right") ? "right" : "left";
}

function occupantForTrain(
  snapshot: RuntimeSnapshot,
  train: TrainRow,
  movement: LocalMovementState,
): StationTrackOccupant | null {
  const departing = movement.departure === "positioned" || movement.departure === "ready";
  const arriving = movement.arrival === "approaching" || movement.arrival === "arrived";
  if (!departing && !arriving) return null;
  const track = movementTrackLabel(snapshot, train, movement);
  if (!track) return null;
  const neighbors = routeNeighbors(snapshot, train);
  const neighbor = departing ? neighbors.to : neighbors.from;
  const side = sideForNeighbor(snapshot, train.station_id, neighbor?.id);
  const arrow = departing
    ? (side === "right" ? "→" : side === "left" ? "←" : "")
    : (side === "left" ? "→" : side === "right" ? "←" : "");
  return {
    trainNumber: train.train_number,
    track,
    status: departing ? movement.departure as "positioned" | "ready" : movement.arrival as "approaching" | "arrived",
    arrow,
    neighborCode: neighbor?.code,
    freight: isFreight(train),
  };
}

export function stationTrackOccupants(
  snapshot: RuntimeSnapshot,
  stationId: string,
  movements: Record<string, LocalMovementState>,
): StationTrackOccupant[] {
  const stationTrains = dedupeTrains(snapshot.trains.filter((train) => train.station_id === stationId));
  const byTrack = new Map<string, StationTrackOccupant>();
  const occupiedTrainNumbers = new Set<string>();

  for (const train of stationTrains) {
    const movement = movements[movementKey(train)] ?? {
      arrival: "none",
      departure: "none",
      lineRequest: "none",
    };
    const occupant = occupantForTrain(snapshot, train, movement);
    if (!occupant) continue;
    byTrack.set(occupant.track, occupant);
    occupiedTrainNumbers.add(occupant.trainNumber);
  }

  for (const position of snapshot.train_positions) {
    if (position.status !== "station" || position.station_id !== stationId) continue;
    if (occupiedTrainNumbers.has(position.train_number)) continue;
    const reserved = snapshot.connection_states.find((state) => (
      state.train_number === position.train_number
      && state.from_station_id === stationId
      && (state.state === "requested" || state.state === "reserved")
    ));
    const candidates = stationTrains.filter((train) => train.train_number === position.train_number);
    const train = candidates.find((candidate) => routeNeighbors(snapshot, candidate).to?.id === reserved?.to_station_id)
      ?? candidates[0];
    if (!train) continue;
    const movement = movements[movementKey(train)] ?? { arrival: "none", departure: "none", lineRequest: "none" };
    const track = movementTrackLabel(snapshot, train, movement);
    if (!track) continue;
    const neighbor = snapshot.stations.find((candidate) => candidate.id === reserved?.to_station_id)
      ?? routeNeighbors(snapshot, train).to;
    const side = sideForNeighbor(snapshot, stationId, neighbor?.id);
    byTrack.set(track, {
      trainNumber: train.train_number,
      track,
      status: "reserved",
      arrow: side === "right" ? "→" : side === "left" ? "←" : "",
      neighborCode: neighbor?.code,
      freight: isFreight(train),
    });
  }

  return [...byTrack.values()];
}
