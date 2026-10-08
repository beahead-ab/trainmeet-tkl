// Var tågen är och hur sent eller för tidigt, som serverns drift-model.js
// (trainLive, deviationView, deviationLevel). Samma regler och samma provfall:
// en försening räknas ur den senaste händelsen med en verklig tid, ett tåg som
// står kvar efter sin avgångstid blir allt senare ("beräknad"), och en för tidig
// avgång gäller bara persontåg – godståg och arbetståg får gå tidigare.
import type { RuntimeSnapshot } from "./types";

export const LATE_MINUTES = 3;
export const DEVIATION_LEVELS = [1, 2, 3, 4, 5] as const;
export const DEFAULT_DEVIATION_LEVEL = 2;
export const DEVIATION_LEVEL_KEY = "trainmeet-tkl.deviationLevel";

export interface ServiceStop {
  station_id: string;
  arrival_time?: string | null;
  departure_time?: string | null;
  stop_order: number;
  service_day_offset?: number;
}

export interface Service {
  id: string;
  train_number: string;
  train_type?: string;
  stops: ServiceStop[];
}

export interface MovementLive {
  arrival?: string;
  departure?: string;
  by_timetable?: boolean;
  arrived_seconds?: number;
  departed_seconds?: number;
}

export interface TrainLive {
  number: string;
  state: "not_departed" | "waiting" | "on_line" | "at_station" | "arrived";
  delayMinutes: number;
  late: boolean;
  estimated: boolean;
  earlyMinutes: number;
  earlyKind: "dep" | "arr" | null;
  trainType: string;
}

export interface DeviationMark {
  tone: "late" | "early";
  style: "text" | "pill";
  minutes: number;
  text: string;
}

export interface DeviationView {
  flash: boolean;
  mark: DeviationMark | null;
  strike: boolean;
  estimated: boolean;
}

const minutes = (value?: string | null): number | null => {
  if (!value) return null;
  const [hours, mins] = String(value).split(":").map(Number);
  return Number.isFinite(hours) && Number.isFinite(mins) ? hours * 60 + mins : null;
};
const hhmm = (value?: string | null) => (value ? String(value).slice(0, 5) : "");
/** Minuter från a till b på ett dygn, alltid mellan −12 och +12 timmar. */
export const minutesBetween = (a: number, b: number) => ((b - a + 720) % 1440 + 1440) % 1440 - 720;

/** En tjänst per tågnummer: den med flest stopp. */
export function services(snapshot: RuntimeSnapshot): Service[] {
  const byNumber = new Map<string, Service>();
  for (const raw of (snapshot.services || []) as Service[]) {
    const number = String(raw?.train_number || "").trim();
    if (!number) continue;
    const existing = byNumber.get(number);
    if (!existing || (raw.stops?.length || 0) > (existing.stops?.length || 0)) byNumber.set(number, raw);
  }
  return [...byNumber.values()];
}

export const orderedStops = (service: Service) => [...(service.stops || [])].sort((a, b) => Number(a.stop_order) - Number(b.stop_order));

/** Rörelsen bakom ett stopp: raden i snapshot.trains med samma tjänst, station och tider. Tvetydigt ger ingen. */
export function movementOf(snapshot: RuntimeSnapshot, service: Service, stop: ServiceStop): string | null {
  let found: string | null = null;
  for (const row of snapshot.trains || []) {
    const candidate = row as unknown as { id: string; service_id?: string; station_id: string; arrival_time?: string | null; departure_time?: string | null };
    if (candidate.service_id !== service.id || candidate.station_id !== stop.station_id) continue;
    if (hhmm(candidate.arrival_time) !== hhmm(stop.arrival_time) || hhmm(candidate.departure_time) !== hhmm(stop.departure_time)) continue;
    if (found) return null;
    found = String(candidate.id);
  }
  return found;
}

/** Tågnummer → var tåget är och hur sent, ur serverns movement_live och klockan (sekunder på dygnet). */
export function trainLive(snapshot: RuntimeSnapshot, nowSeconds: number): Map<string, TrainLive> {
  const live = (snapshot.movement_live || {}) as Record<string, MovementLive>;
  const now = nowSeconds / 60;
  const result = new Map<string, TrainLive>();
  for (const service of services(snapshot)) {
    const number = String(service.train_number);
    const stops = orderedStops(service).map((stop) => {
      const offset = Number(stop.service_day_offset || 0) * 1440;
      const state = live[movementOf(snapshot, service, stop) || ""] || null;
      const arrival = minutes(stop.arrival_time), departure = minutes(stop.departure_time);
      return {
        plannedArrival: arrival === null ? null : arrival + offset,
        plannedDeparture: departure === null ? null : departure + offset,
        arrived: state?.arrival === "arrived",
        departed: state?.departure === "departed",
        actualArrival: Number.isFinite(state?.arrived_seconds) ? (state!.arrived_seconds as number) / 60 : null,
        actualDeparture: Number.isFinite(state?.departed_seconds) ? (state!.departed_seconds as number) / 60 : null,
      };
    });
    if (!stops.length) continue;
    let delay = 0, estimated = false, lastIndex = -1;
    let measuredAt: "dep" | "arr" | null = null;
    stops.forEach((stop, index) => { if (stop.arrived || stop.departed) lastIndex = index; });
    for (let index = stops.length - 1; index >= 0; index -= 1) {
      const stop = stops[index];
      if (stop.departed && stop.actualDeparture !== null && stop.plannedDeparture !== null) { delay = minutesBetween(stop.plannedDeparture, stop.actualDeparture); measuredAt = "dep"; break; }
      if (stop.arrived && stop.actualArrival !== null && stop.plannedArrival !== null) { delay = minutesBetween(stop.plannedArrival, stop.actualArrival); measuredAt = "arr"; break; }
    }
    const last = stops[stops.length - 1];
    let state: TrainLive["state"];
    if (lastIndex >= 0 && stops[lastIndex].departed && lastIndex < stops.length - 1) state = "on_line";
    else if (last.arrived) state = "arrived";
    else {
      const here = stops[Math.max(0, lastIndex)];
      const overdue = here.plannedDeparture !== null ? minutesBetween(here.plannedDeparture, now) : -1;
      state = lastIndex < 0 && overdue < 0 ? "not_departed" : lastIndex >= 0 && overdue < 0 ? "at_station" : "waiting";
      if (state === "waiting" && Math.floor(overdue) > delay) { delay = Math.floor(overdue); estimated = true; measuredAt = null; }
    }
    delay = Math.round(delay);
    const earlyMinutes = delay < 0 ? -delay : 0;
    result.set(number, {
      number, state, delayMinutes: Math.max(0, delay), late: delay >= LATE_MINUTES, estimated,
      earlyMinutes, earlyKind: earlyMinutes ? measuredAt : null,
      trainType: String(service.train_type || "person").toLowerCase(),
    });
  }
  return result;
}

const validLevel = (value: unknown): number | null => {
  const level = Number(value);
  return (DEVIATION_LEVELS as readonly number[]).includes(level) ? level : null;
};

/** Enhetens eget val går före träffens förval; annars nivå 2. */
export function deviationLevel(snapshot: RuntimeSnapshot | null | undefined, own: unknown = null): number {
  return validLevel(own) ?? validLevel(snapshot?.display?.deviation_level) ?? DEFAULT_DEVIATION_LEVEL;
}

/** Vad ett tåg visar på en nivå (1 ingen markering … 5 allt), som serverns deviationView. */
export function deviationView(level: number, train: TrainLive | null | undefined): DeviationView {
  const view: DeviationView = { flash: level >= 2, mark: null, strike: false, estimated: false };
  if (!train) return view;
  const delay = Math.max(0, Math.round(train.delayMinutes || 0));
  if (level === 3 && delay >= 5) view.mark = { tone: "late", style: "text", minutes: delay, text: `+${delay}` };
  if (level >= 4 && delay >= (level >= 5 ? 1 : LATE_MINUTES)) {
    view.mark = { tone: "late", style: "pill", minutes: delay, text: `+${delay}` };
    view.strike = true;
    view.estimated = Boolean(train.estimated);
  }
  const early = Math.max(0, Math.round(train.earlyMinutes || 0));
  if (!view.mark && level >= 4 && early >= 1) {
    const passenger = String(train.trainType || "person").toLowerCase() === "person";
    if ((train.earlyKind === "dep" && passenger) || (train.earlyKind === "arr" && level >= 5)) {
      view.mark = { tone: "early", style: "pill", minutes: early, text: `−${early}` };
      view.strike = true;
    }
  }
  return view;
}

/**
 * Hur långt ett tåg på linjen har kommit, 0–1: tiden sedan avgången (den
 * verkliga om den finns, annars den planerade) delat med tidtabellens gångtid.
 * Utan tidtabell för sträckan: null (tåget står mitt på linjen som förut).
 */
export function legProgress(snapshot: RuntimeSnapshot, trainNumber: string, from: string, to: string,
  departedSeconds: number | null | undefined, nowSeconds: number): number | null {
  for (const service of services(snapshot)) {
    if (String(service.train_number) !== String(trainNumber)) continue;
    const stops = orderedStops(service);
    const start = stops.findIndex((stop) => stop.station_id === from);
    if (start < 0) continue;
    const next = stops.findIndex((stop, index) => index > start && stop.station_id === to);
    if (next < 0) continue;
    const departure = minutes(stops[start].departure_time || stops[start].arrival_time);
    const arrival = minutes(stops[next].arrival_time || stops[next].departure_time);
    if (departure === null || arrival === null) continue;
    const duration = ((((arrival - departure) % 1440) + 1440) % 1440 || 1) * 60;
    const left = Number.isFinite(departedSeconds) ? (((departedSeconds as number) % 86400) + 86400) % 86400 : departure * 60;
    let elapsed = (((nowSeconds - left) % 86400) + 86400) % 86400;
    if (elapsed > 43200) elapsed = 0;
    return Math.min(1, Math.max(0, elapsed / duration));
  }
  return null;
}

/** Träffklockans sekunder på dygnet nu: bildens tid plus det som gått sedan den kom, om klockan går. */
export function clockSeconds(snapshot: RuntimeSnapshot, receivedAt: number, now = Date.now()): number {
  const [h, m, s] = String(snapshot.clock?.time || "00:00:00").split(":").map(Number);
  const base = (h || 0) * 3600 + (m || 0) * 60 + (s || 0);
  const running = snapshot.clock?.running;
  const speed = Number(snapshot.clock?.speed || 1);
  return running ? (base + ((now - receivedAt) / 1000) * speed) % 86400 : base;
}

/**
 * Vad som ändrats sedan förra ritningen. note(key, signatur, nu) ger tiden för
 * den senaste ändringen, eller null. Första gången en nyckel ses är ingen ändring.
 */
export function changeTracker() {
  const seen = new Map<string, { sig: string; changedAt: number | null }>();
  return {
    note(key: string, signature: unknown, now: number): number | null {
      const sig = JSON.stringify(signature);
      const previous = seen.get(key);
      if (!previous) { seen.set(key, { sig, changedAt: null }); return null; }
      if (previous.sig !== sig) { previous.sig = sig; previous.changedAt = now; }
      return previous.changedAt;
    },
  };
}
