// Dygnsskiftet (Casper 2026-10-08), som serverns day-change.js: vid skiftet
// (förval 05:00) står alla tåg på sin utgångspunkt och statusarna är
// nollställda. TKL säger det i en toast, en gång, också strax efter att
// sidan öppnats. Medan skiftet väntar på ett tåg ute på linjen säger den det.
import type { RuntimeSnapshot } from "./types";

/** Så länge efter skiftet en sida som öppnas visar toasten, i sekunder. */
export const SHOWN_SECONDS = 90;
export const DAY_CHANGE_SEEN_KEY = "trainmeet-tkl.dayChangeSeen";

export type DayNotice =
  | { kind: "changed"; key: string; dayNumber: number; weekday: string }
  | { kind: "waiting"; key: "waiting" };

/** Vad TKL ska säga om dygnsskiftet ur /v1/display, eller null. `seen` är skiftet som redan visats. */
export function dayChangeNotice(snapshot: RuntimeSnapshot | null | undefined, seen: string | null = null): DayNotice | null {
  const calendar = snapshot?.calendar;
  if (!calendar) return null;
  const last = calendar.last_change;
  if (last?.kind === "day_change" && last.at && last.at !== seen) {
    const age = (Date.parse(snapshot?.server_time || "") - Date.parse(last.at)) / 1000;
    if (Number.isFinite(age) && age >= -5 && age <= SHOWN_SECONDS) {
      return { kind: "changed", key: last.at, dayNumber: last.day_number, weekday: last.weekday };
    }
  }
  if (calendar.waiting) return { kind: "waiting", key: "waiting" };
  return null;
}
