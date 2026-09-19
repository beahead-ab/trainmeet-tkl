// Browser-only training model. No fetch, server credentials or real meet IDs.
// This is deliberately not a replacement for the server's traffic engine.
import type { TerminalConfig, TklContext, TklShift } from "./api";
import type { RuntimeSnapshot, TrainRow } from "./types";

const key = "trainmeet-tkl.demo.v1";
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const stations = [{id: "demo-a", code: "ALP", name: "Alpby"}, {id: "demo-b", code: "BJO", name: "Björkstad"}];
const trains: TrainRow[] = [
  {id: "demo-101-a", train_number: "101", station_id: "demo-a", station: "Alpby", track: "1", days: "Demo", arrival_time: null, departure_time: "06:05", arrival_from: null, departure_to: "Björkstad", sort_time: "06:05", train_type: "person", no_stop: false, note: null},
  {id: "demo-101-b", train_number: "101", station_id: "demo-b", station: "Björkstad", track: "1", days: "Demo", arrival_time: "06:15", departure_time: null, arrival_from: "Alpby", departure_to: null, sort_time: "06:15", train_type: "person", no_stop: false, note: null},
  {id: "demo-402-b", train_number: "402", station_id: "demo-b", station: "Björkstad", track: "2", days: "Demo", arrival_time: null, departure_time: "06:25", arrival_from: null, departure_to: "Alpby", sort_time: "06:25", train_type: "gods", no_stop: false, note: null},
  {id: "demo-402-a", train_number: "402", station_id: "demo-a", station: "Alpby", track: "2", days: "Demo", arrival_time: "06:35", departure_time: null, arrival_from: "Björkstad", departure_to: null, sort_time: "06:35", train_type: "gods", no_stop: false, note: null},
];
type DemoState = {
  config: TerminalConfig;
  runtime: RuntimeSnapshot;
  shifts: Record<string, TklShift>;
  previous: Record<string, TklShift>;
  movements: Record<string, TklContext["movements"]>;
};
function fresh(): DemoState {
  return {
    config: {configured: false, terminal_name: "TKL Demo", server_url: "", station_id: "", orientation: "portrait"},
    shifts: {}, previous: {}, movements: {},
    runtime: {
      publication_id: "demo-only-v1", protocol_version: 2, revision: 0,
      meet: {id: "demo-only", name: "TKL Demo", default_dispatch_mode: "direct"}, active_day: "Demo",
      stations: copy(stations), trains: copy(trains),
      tracks: stations.flatMap(station => [1, 2].map(n => ({id: `${station.id}-${n}`, station_id: station.id, display_label: String(n), sort_order: n, active: true}))),
      connections: [{id: "demo-line", station_a_id: "demo-a", station_b_id: "demo-b", track_type: "single", display_side_a: "right", display_side_b: "left"}],
      connection_states: [{id: "demo-line", state: "free"}],
      routes: trains.map(train => ({train_number: train.train_number, station_id: train.station_id, stop_order: train.departure_time ? 0 : 1, arrival_time: train.arrival_time, departure_time: train.departure_time})),
      train_positions: [], clock: {configured: true, time: "06:00:00", running: false, speed: 1},
    },
  };
}
let state: DemoState | undefined;
function current(): DemoState {
  if (!state) {
    try {
      const saved = JSON.parse(window.sessionStorage.getItem(key) || "null") as DemoState | null;
      if (saved?.runtime?.publication_id === "demo-only-v1" && saved.config && saved.shifts && saved.previous && saved.movements) state = saved;
    } catch { /* A malformed demo is safe to start again. */ }
    state ||= fresh();
  }
  return state;
}
function persist() {
  try { window.sessionStorage.setItem(key, JSON.stringify(current())); } catch { /* In-memory demo still works. */ }
}
export function resetDemo() { state = fresh(); persist(); }
export function demoSnapshot() { return copy(current().runtime); }
export function loadDemoConfig() { return copy(current().config); }
export function saveDemoConfig(config: Omit<TerminalConfig, "configured">) {
  if (!stations.some(station => station.id === config.station_id)) throw new Error("Okänd demostation");
  current().config = {configured: true, terminal_name: config.terminal_name, orientation: config.orientation, station_id: config.station_id, station_name: stations.find(s => s.id === config.station_id)?.name, server_url: ""};
  persist();
  return loadDemoConfig();
}
export function demoRequest(path: string, init?: RequestInit): unknown {
  const data = current();
  const url = new URL(path, "http://demo.invalid");
  const payload = typeof init?.body === "string" ? JSON.parse(init.body) as Record<string, string | boolean | number> : {};
  const stationId = String(payload.station_id || url.searchParams.get("station_id") || "");
  const station = data.runtime.stations.find(s => s.id === stationId);
  if (!station || stationId !== data.config.station_id) throw new Error("Välj en demostation först");
  const now = new Date().toISOString();
  let result: unknown;
  if (url.pathname === "/v1/tkl/context" && !init?.method) {
    const lines = data.runtime.connection_states;
    const context: TklContext = {
      protocol_version: 2, publication_id: data.runtime.publication_id, meet_generation: 1,
      meet: data.runtime.meet, active_day: "Demo", station,
      terminal: {client_id: "demo-local", display_name: data.config.terminal_name, kind: "tkl_terminal"},
      preflight: {server_online: true, clock_configured: true, clock_running: false, track_count: 2, connection_count: 1, train_count: 2, open_connection_count: lines.filter(l => l.state !== "free").length},
      shift: data.shifts[stationId] || null, previous_shift: data.previous[stationId] || null,
      movements: data.movements[stationId] || {}, connection_states: lines,
    };
    return copy(context);
  }
  if (init?.method !== "POST" || payload.meet_generation !== 1) throw new Error("Ogiltigt demokommando");
  if (url.pathname === "/v1/tkl/shift/start") {
    const shift: TklShift = {shift_id: `demo-${Date.now()}`, operator_name: String(payload.operator_name), terminal_name: String(payload.terminal_name), status: "active", started_at: now, updated_at: now};
    data.shifts[stationId] = shift;
    result = {shift};
  } else if (!data.shifts[stationId]) throw new Error("Starta ett demopass först");
  else if (url.pathname === "/v1/tkl/shift/finish") {
    const shift = data.shifts[stationId];
    if (shift.shift_id !== payload.shift_id || !["handover", "closed"].includes(String(payload.status))) throw new Error("Ogiltigt demopass");
    shift.status = payload.status as "handover" | "closed";
    shift.ended_at = now; shift.updated_at = now; shift.handover_note = String(payload.note || "");
    data.previous[stationId] = shift; delete data.shifts[stationId];
    result = {shift};
  } else if (url.pathname === "/v1/tkl/movement") {
    const train = data.runtime.trains.find(t => t.id === payload.movement_id && t.station_id === stationId);
    if (!train || !["none", "approaching", "arrived"].includes(String(payload.arrival)) || !["none", "positioned", "ready", "departed"].includes(String(payload.departure))) throw new Error("Ogiltig demotågrörelse");
    const track = String(payload.actual_track || train.track);
    if (!data.runtime.tracks?.some(t => t.station_id === stationId && (t.id === track || t.display_label === track))) throw new Error("Okänt demospår");
    const movement: TklContext["movements"][string] = {arrival: payload.arrival as "none" | "approaching" | "arrived", departure: payload.departure as "none" | "positioned" | "ready" | "departed", actualTrack: track, updated_at: now};
    (data.movements[stationId] ||= {})[train.id] = movement;
    result = {movement};
  } else if (url.pathname === "/v1/tkl/line") {
    const line = data.runtime.connection_states.find(l => l.id === payload.connection_id);
    const train = String(payload.train_number || "");
    if (!line || !train) throw new Error("Okänd demosträcka");
    const action = payload.action;
    if (action === "request" && line.state === "free") {
      // The demo uses direct dispatch; no simulated neighbour confirmation.
      Object.assign(line, {state: "reserved", train_number: train, from_station_id: stationId, to_station_id: stationId === "demo-a" ? "demo-b" : "demo-a"});
    } else if (action === "depart" && line.state === "reserved" && line.from_station_id === stationId && line.train_number === train) {
      line.state = "occupied";
      data.runtime.train_positions = data.runtime.train_positions.filter(p => p.train_number !== train);
      data.runtime.train_positions.push({train_number: train, status: "connection", connection_id: line.id, from_station_id: line.from_station_id, to_station_id: line.to_station_id});
    } else if ((action === "cancel" && line.state === "reserved" && line.from_station_id === stationId || action === "arrive" && line.state === "occupied" && line.to_station_id === stationId) && line.train_number === train) {
      if (action === "arrive") {
        data.runtime.train_positions = data.runtime.train_positions.filter(p => p.train_number !== train);
        data.runtime.train_positions.push({train_number: train, status: "station", station_id: stationId});
      }
      Object.assign(line, {state: "free", train_number: null, from_station_id: null, to_station_id: null});
    } else throw new Error("Åtgärden är inte möjlig i det aktuella demoläget");
    result = {connection: line};
  } else throw new Error("Den här åtgärden finns inte i fristående demo");
  persist();
  return copy(result);
}
