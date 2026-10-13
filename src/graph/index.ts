/* Tågdiagrammet som grafisk tidtabell: samma ritare som servern.
 *
 * drift-model.js och train-graph.js är byte-identiska kopior av serverns
 * web/drift-model.js och web/train-graph.js (serverns tools/sync-i18n.mjs
 * --siblings håller dem lika). De registrerar sig på globalThis; den här
 * modulen ger dem typer och TKL:s klassnamn.
 */
import './drift-model.js';
import './train-graph.js';

export type GraphStation = { id: string; name: string; code?: string };
export type GraphLine = { id: string; name: string; stations: GraphStation[] };
export type GraphStop = { station_id: string; stop_order: number; arrival_time?: string | null; departure_time?: string | null; service_day_offset?: number; service_minute: number };
export type GraphService = { id: string; train_number: string; train_type?: string; days?: string; stops: GraphStop[] };
export type GraphSnapshot = {
  stations: GraphStation[];
  connections: { id?: string; station_a_id: string; station_b_id: string; track_type?: string }[];
  tracks?: { station_id: string; display_label: string; sort_order?: number; active?: boolean; operating_point_id?: string | null }[];
  trains?: { id?: string; service_id?: string | null; station_id: string; track?: string }[];
  services?: GraphService[];
  display?: { graph_station_order?: string[]; topology_mainline_station_ids?: string[]; topology_branch_station_ids?: string[] };
  clock?: { time?: string };
};
type ClassRole = 'past' | 'grid' | 'gridMajor' | 'gridMinor' | 'track' | 'axis' | 'label' | 'code' | 'trackLabel' | 'title' | 'train' | 'line' | 'hit' | 'lit' | 'litLine'
  | 'dwell' | 'name' | 'minute' | 'tag' | 'tagBox' | 'tagText' | 'tagBoxCleared' | 'tagTextCleared' | 'now' | 'nowBox' | 'nowText';
export type GraphClasses = Record<ClassRole, string> & { tagHeight: number; labelDy: number };
export type GraphOptions = {
  width?: number; height?: number | null; windowMinutes?: number; now?: number | null; train?: string | null; line?: string | null;
  tracks?: 'none' | 'all' | Set<string>; minutes?: boolean; gap?: number; maxGap?: number; pxPerMinute?: number; trackStep?: number;
  left?: number; right?: number; top?: number; bottom?: number; title?: number; panelGap?: number; start?: number | null; end?: number | null;
};
export type GraphLayout = {
  width: number; height: number; left: number; right: number; top: number; bottom: number; start: number; end: number; now: number | null; nowX: number | null;
  lines: GraphLine[]; panels: { title: string | null; y0: number; stations: { station: GraphStation; y: number; tracks: { label: string; y: number }[] }[] }[];
  trains: { number: string; type: string; selected: boolean; lit: boolean }[]; hours: { x: number; minute: number; major: boolean; label: string }[];
};
export type RenderOptions = {
  cls?: GraphClasses; codes?: boolean; onSelect?: ((number: string) => void) | null; onStation?: ((stationId: string) => void) | null;
  label?: (number: string) => string; marks?: ((number: string) => { text: string; tone: string } | null) | null; clip?: string | null;
};
export type TrainGraphApi = {
  lines(snapshot: GraphSnapshot): GraphLine[];
  layout(snapshot: GraphSnapshot, options?: GraphOptions): GraphLayout;
  render(svg: SVGSVGElement, g: GraphLayout, options?: RenderOptions): SVGSVGElement;
  clockLabel(minute: number): string;
  DRIFT: GraphClasses;
  SCREEN: GraphClasses;
};
declare global {
  var TrainMeetTrainGraph: TrainGraphApi;
}
export const trainGraph = (): TrainGraphApi => globalThis.TrainMeetTrainGraph;

/** TKL:s klassnamn: samma roller som serverns DRIFT, med tg- före så att de inte krockar med TKL:s egna. */
export const TKL: GraphClasses = {
  past: 'tg-past', grid: 'tg-grid', gridMajor: 'tg-grid tg-hour', gridMinor: 'tg-grid tg-half', track: 'tg-grid tg-track', axis: 'tg-axis',
  label: 'tg-label', code: 'tg-code', trackLabel: 'tg-track-label', title: 'tg-title', train: 'tg-train', line: 'tg-line', hit: 'tg-hit',
  lit: 'tg-train is-lit', litLine: 'tg-line is-lit', dwell: 'tg-dwell', name: 'tg-name', minute: 'tg-minute', tag: 'tg-tag', tagBox: 'tg-tag-box',
  tagText: 'tg-tag-text', tagBoxCleared: 'tg-tag-box is-cleared', tagTextCleared: 'tg-tag-text is-cleared', now: 'tg-now', nowBox: 'tg-now-box',
  nowText: 'tg-now-text', tagHeight: 22, labelDy: 4.5,
};

/** Linjen som visas först: huvudlinjen om stationen ligger på den, annars den första linjen genom stationen, annars den första. */
export function defaultLine(lines: GraphLine[], stationId: string | null): string | null {
  const through = lines.filter((line) => line.stations.some((station) => station.id === stationId));
  return (through[0] || lines[0])?.id ?? null;
}
