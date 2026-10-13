/* Tågdiagrammet i TKL: samma ritare som serverns Drift och storskärm
 * (src/graph/train-graph.js), i helskärm. Stationens linje visas först, den
 * egna stationen är markerad, nu-linjen följer träffklockan, spåren fälls ut
 * på begäran, och ett tryck på ett tåg öppnar dess kort. */
import { useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { t } from "./i18n";
import type { RuntimeSnapshot } from "./types";
import { TKL, defaultLine, trainGraph, type GraphOptions, type GraphSnapshot } from "./graph";

const WINDOWS = [120, 180, 360, 720];
export const WINDOW_KEY = "trainmeet-tkl.graph-window";
const readWindow = () => {
  try { const value = Number(localStorage.getItem(WINDOW_KEY)); return WINDOWS.includes(value) ? value : 180; } catch { return 180; }
};

export function TrainGraphView({ snapshot, stationId, nowSeconds, onClose, onSelectTrain }: {
  snapshot: RuntimeSnapshot;
  stationId: string;
  nowSeconds: number;
  onClose: () => void;
  onSelectTrain: (trainNumber: string) => void;
}) {
  const graph = snapshot as unknown as GraphSnapshot;
  const [line, setLine] = useState("");
  const [mode, setMode] = useState<"none" | "all" | "some">("none");
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [windowMinutes, setWindowMinutes] = useState(readWindow);
  const [width, setWidth] = useState(1200);
  const [available, setAvailable] = useState(0);
  const host = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const lines = useMemo(() => trainGraph().lines(graph), [graph]);
  const chosen = line === "all" ? null : lines.some((item) => item.id === line) ? line : defaultLine(lines, stationId);
  const tracks = mode === "all" ? "all" : mode === "some" ? expanded : "none";
  const hasTrains = (graph.services || []).some((service) => (service.stops || []).length >= 2);
  // Nu-linjen ritas om var 15:e sekund; bilden kommer var 3:e sekund ändå.
  const beat = Math.floor(nowSeconds / 15);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    const node = host.current; if (!node) return;
    const measure = () => { setWidth(Math.max(320, Math.round(node.clientWidth - 32) || 1200)); setAvailable(Math.max(0, Math.round(node.clientHeight - 24))); };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure); observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const target = svg.current; if (!target || !hasTrains) return;
    const lib = trainGraph();
    // Namnen när det finns plats, annars koderna: aldrig båda.
    const names = width >= 640;
    const longest = Math.max(0, ...graph.stations.map((station) => String(station.name || "").length));
    const left = names ? Math.min(210, Math.max(96, Math.round(longest * 7.2) + 24)) : 64;
    const options: GraphOptions = { width, windowMinutes, now: nowSeconds / 60, line: chosen, tracks, minutes: names, left, right: 18, gap: names ? 22 : 16, trackStep: names ? 14 : 11 };
    let g = lib.layout(graph, options);
    // Ryms diagrammet med luft över fyller det skärmen, som storskärmen; annars rullar man.
    if (available > g.height) g = lib.layout(graph, { ...options, height: available });
    lib.render(target, g, {
      cls: TKL, codes: !names, clip: "tkl-graph-clip", onSelect: onSelectTrain,
      onStation: (id) => { setMode("some"); setExpanded((previous) => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next; }); },
      label: (number) => t("Tåg {number}", { number }),
    });
    for (const own of target.querySelectorAll(`[data-station-id="${CSS.escape(stationId)}"]`)) own.classList.add("is-own");
    target.setAttribute("aria-label", t("Tågdiagram {from} till {to}", { from: lib.clockLabel(g.start), to: lib.clockLabel(g.end) }));
  }, [graph, chosen, tracks, windowMinutes, width, available, beat, stationId, hasTrains]); // eslint-disable-line react-hooks/exhaustive-deps

  const station = snapshot.stations.find((item) => item.id === stationId);
  return (
    <div className="graph-view" role="dialog" aria-modal="true" aria-label={t("Tågdiagram")}>
      <div className="graph-view__bar">
        <div className="graph-view__title"><span className="micro-heading">{station?.name || ""}</span><h2>{t("Tågdiagram")}</h2></div>
        {lines.length > 1 && (
          <label className="graph-view__field">{t("Linje")}
            <select value={chosen && line !== "all" ? chosen : "all"} onChange={(event) => setLine(event.target.value)}>
              {lines.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              <option value="all">{t("Alla linjer")}</option>
            </select>
          </label>
        )}
        <label className="graph-view__field">{t("Tidsfönster")}
          <select value={windowMinutes} onChange={(event) => {
            const value = Number(event.target.value); setWindowMinutes(value);
            try { localStorage.setItem(WINDOW_KEY, String(value)); } catch { /* utan lagring gäller valet tills vyn stängs */ }
          }}>
            <option value={120}>{t("2 timmar")}</option>
            <option value={180}>{t("3 timmar")}</option>
            <option value={360}>{t("6 timmar")}</option>
            <option value={720}>{t("12 timmar")}</option>
          </select>
        </label>
        <button type="button" className="graph-view__toggle" aria-pressed={mode === "all"} title={t(mode === "all" ? "Dölj spåren" : "Visa spåren")} onClick={() => setMode(mode === "all" ? "none" : "all")}>{t("Spår")}</button>
        <button type="button" className="icon-button" onClick={onClose} aria-label={t("Stäng")}><X /></button>
      </div>
      <div className="graph-view__body" ref={host}>
        {hasTrains ? <svg id="tkl-train-graph" ref={svg} role="img" /> : <p className="graph-view__empty">{t("Tågdiagrammet behöver tidtabellen från servern.")}</p>}
      </div>
      <p className="graph-view__foot">{t("Stationens linje visas först. Tryck på ett tåg för att öppna dess kort, och på ett stationsnamn för att se dess spår.")}</p>
    </div>
  );
}
