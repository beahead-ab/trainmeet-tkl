import type { RouteStop, RuntimeSnapshot, Station, TrainRow } from "./types";

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

export function formatClock(value: string): string {
  const parts = value.split(":");
  return `${parts[0] ?? "00"}:${parts[1] ?? "00"}`;
}

export function movementKey(train: TrainRow): string {
  return [train.train_number, train.arrival_time ?? "", train.departure_time ?? "", train.track].join("|");
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
