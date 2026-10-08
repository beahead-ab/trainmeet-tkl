import { t } from "../i18n";
import { legProgress } from "../trainLive";
import type {
  Connection,
  ConnectionState,
  RuntimeSnapshot,
  Station,
  StationTrackOccupant,
} from "../types";

type DiagramRow = "top" | "middle" | "bottom";

interface StationDiagramProps {
  /** Träffklockans sekunder på dygnet nu: tåg på linjen rör sig efter den. */
  nowSeconds?: number;
  snapshot: RuntimeSnapshot;
  station: Station;
  tracks: string[];
  trackOccupants: StationTrackOccupant[];
  selectedTrain?: string | null;
  onTrainSelect: (trainNumber: string) => void;
  onStationSelect: (stationId: string) => void;
}

interface NeighborSegment {
  connection: Connection;
  station: Station;
  side: "left" | "right";
  row: DiagramRow;
  order: number;
}

function placement(connection: Connection, stationId: string): { side: "left" | "right"; row: DiagramRow; order: number } {
  const atA = connection.station_a_id === stationId;
  const raw = (atA ? connection.display_side_a : connection.display_side_b) ?? "left";
  const [sideRaw, rowRaw] = raw.split("-");
  return {
    side: sideRaw === "right" ? "right" : "left",
    row: rowRaw === "top" || rowRaw === "bottom" ? rowRaw : "middle",
    order: Number(atA ? connection.display_order_a : connection.display_order_b) || 0,
  };
}

function effectiveConnectionState(snapshot: RuntimeSnapshot, connection: Connection): ConnectionState {
  const state = snapshot.connection_states.find((candidate) => candidate.id === connection.id);
  const position = snapshot.train_positions.find(
    (candidate) => candidate.status === "connection" && candidate.connection_id === connection.id,
  );
  if (position) {
    return {
      id: connection.id,
      state: "occupied",
      train_number: position.train_number,
      from_station_id: position.from_station_id,
      to_station_id: position.to_station_id,
    };
  }
  return state ?? { id: connection.id, state: "free" };
}

function TrainOnLine({
  number,
  outward,
  selected,
  onClick,
  at,
}: {
  number: string;
  outward: boolean;
  selected: boolean;
  onClick: () => void;
  /** Var på sträckan tåget är, 0 vänster – 1 höger; utan tidtabell mitt på. */
  at?: number | null;
}) {
  return (
    <button
      type="button"
      // Satt med CSSOM (React style), inte ett style-attribut i HTML: tillåtet med serverns CSP.
      style={at === null || at === undefined ? undefined : { left: `${Math.round(Math.min(0.9, Math.max(0.1, at)) * 1000) / 10}%` }}
      className={`line-train ${outward ? "is-outward" : "is-inward"} ${selected ? "is-selected" : ""}`}
      onClick={onClick}
      aria-label={t("Tåg {number} på linjen", { number })}
    >
      {!outward && <span aria-hidden="true">▶</span>}
      {outward && <span aria-hidden="true">◀</span>}
      <span>{number}</span>
    </button>
  );
}

function TrackRail({
  active,
  train,
  outward,
  selected,
  onTrainSelect,
  occupant,
  connectionState,
  at,
}: {
  at?: number | null;
  active: boolean;
  train?: string | null;
  outward: boolean;
  selected: boolean;
  onTrainSelect: (number: string) => void;
  occupant?: StationTrackOccupant;
  connectionState?: ConnectionState["state"];
}) {
  return (
    <div className={`track-rail ${active ? "is-active" : ""} ${connectionState ? `is-${connectionState}` : ""}`}>
      {train && (
        <TrainOnLine
          number={train}
          outward={outward}
          selected={selected}
          at={at}
          onClick={() => onTrainSelect(train)}
        />
      )}
      {occupant && (
        <button
          type="button"
          className={`station-track-train is-${occupant.status} ${occupant.freight ? "is-freight" : ""}`}
          onClick={() => onTrainSelect(occupant.trainNumber)}
          aria-label={t("Tåg {number} på spår {track}", { number: occupant.trainNumber, track: occupant.track })}
        >
          {occupant.arrow && <span aria-hidden="true">{occupant.arrow}</span>}
          {occupant.neighborCode && <small>{occupant.neighborCode.slice(0, 3)}</small>}
          <strong>{occupant.trainNumber}</strong>
        </button>
      )}
    </div>
  );
}

function ConnectionTracks({
  segment,
  snapshot,
  currentStationId,
  selectedTrain,
  onTrainSelect,
  nowSeconds,
}: {
  segment: NeighborSegment;
  snapshot: RuntimeSnapshot;
  currentStationId: string;
  selectedTrain?: string | null;
  onTrainSelect: (number: string) => void;
  nowSeconds?: number;
}) {
  const state = effectiveConnectionState(snapshot, segment.connection);
  const train = state.state === "occupied" ? state.train_number : null;
  const caseTrain = state.train_number;
  const outward = state.from_station_id === currentStationId;
  // Ett avgånget tåg glider mot nästa station i takt med träffklockan, som på
  // serverns kartor: från den verkliga avgången, annars den planerade.
  const position = snapshot.train_positions.find((candidate) => candidate.status === "connection" && candidate.connection_id === segment.connection.id);
  const progress = train && nowSeconds !== undefined && state.from_station_id && state.to_station_id
    ? legProgress(snapshot, train, state.from_station_id, state.to_station_id, position?.departed_seconds, nowSeconds) : null;
  const towardRight = (segment.side === "right") === outward;
  const at = progress === null ? null : towardRight ? progress : 1 - progress;
  if (segment.connection.track_type === "single") {
    return (
      <TrackRail
        active={state.state === "occupied"}
        train={train}
        at={at}
        outward={outward}
        selected={selectedTrain === train}
        connectionState={state.state}
        onTrainSelect={onTrainSelect}
      />
    );
  }

  const outwardOnTop = segment.side === "right";
  const activeOnTop = caseTrain ? (outward ? outwardOnTop : !outwardOnTop) : false;
  return (
    <div className="double-track">
      <TrackRail
        active={Boolean(train && activeOnTop)}
        train={activeOnTop ? train : null}
        at={at}
        outward={outward}
        selected={selectedTrain === train}
        connectionState={activeOnTop ? state.state : "free"}
        onTrainSelect={onTrainSelect}
      />
      <TrackRail
        active={Boolean(train && !activeOnTop)}
        train={!activeOnTop ? train : null}
        at={at}
        outward={outward}
        selected={selectedTrain === train}
        connectionState={!activeOnTop ? state.state : "free"}
        onTrainSelect={onTrainSelect}
      />
    </div>
  );
}

function Segment({
  segment,
  snapshot,
  currentStationId,
  selectedTrain,
  onTrainSelect,
  onStationSelect,
  nowSeconds,
}: {
  nowSeconds?: number;
  segment: NeighborSegment;
  snapshot: RuntimeSnapshot;
  currentStationId: string;
  selectedTrain?: string | null;
  onTrainSelect: (number: string) => void;
  onStationSelect: (stationId: string) => void;
}) {
  const badge = (
    <button
      type="button"
      className="station-badge"
      onClick={() => onStationSelect(segment.station.id)}
      title={segment.station.name}
    >
      {segment.station.code.slice(0, 4)}
    </button>
  );
  return (
    <div className={`neighbor-segment is-${segment.side}`}>
      {segment.side === "left" && badge}
      <div className="connection-tracks">
        <ConnectionTracks
          segment={segment}
          snapshot={snapshot}
          currentStationId={currentStationId}
          selectedTrain={selectedTrain}
          onTrainSelect={onTrainSelect}
          nowSeconds={nowSeconds}
        />
      </div>
      {segment.side === "right" && badge}
    </div>
  );
}

export function StationDiagram({
  nowSeconds,
  snapshot,
  station,
  tracks,
  trackOccupants,
  selectedTrain,
  onTrainSelect,
  onStationSelect,
}: StationDiagramProps) {
  const stationById = new Map(snapshot.stations.map((candidate) => [candidate.id, candidate]));
  const segments: NeighborSegment[] = snapshot.connections
    .filter((connection) => connection.station_a_id === station.id || connection.station_b_id === station.id)
    .map((connection) => {
      const neighborId = connection.station_a_id === station.id
        ? connection.station_b_id
        : connection.station_a_id;
      const position = placement(connection, station.id);
      return {
        connection,
        station: stationById.get(neighborId)!,
        ...position,
      };
    })
    .filter((segment) => Boolean(segment.station))
    .sort((a, b) => a.order - b.order);

  const rows: DiagramRow[] = ["top", "middle", "bottom"];
  const renderSide = (side: "left" | "right") => (
    <div className={`diagram-side is-${side}`}>
      {rows.map((row) => (
        <div className="diagram-row" key={`${side}-${row}`}>
          {segments
            .filter((segment) => segment.side === side && segment.row === row)
            .map((segment) => (
              <Segment
                key={segment.connection.id}
                nowSeconds={nowSeconds}
                segment={segment}
                snapshot={snapshot}
                currentStationId={station.id}
                selectedTrain={selectedTrain}
                onTrainSelect={onTrainSelect}
                onStationSelect={onStationSelect}
              />
            ))}
        </div>
      ))}
    </div>
  );

  return (
    <section className="station-diagram" aria-label={t("Banöversikt för {station}", { station: station.name })}>
      {renderSide("left")}
      <div className="station-center">
        <div className="station-center-title">
          <span className="station-dot" />
          <strong>{station.code.slice(0, 4)}</strong>
          <span className="station-dot" />
        </div>
        <div className="station-tracks">
          {tracks.map((track) => (
            <div className="station-track" key={track}>
              <span>{track}</span>
              <TrackRail
                active={false}
                outward={false}
                selected={false}
                occupant={trackOccupants.find((candidate) => candidate.track === track)}
                onTrainSelect={onTrainSelect}
              />
            </div>
          ))}
        </div>
      </div>
      {renderSide("right")}
    </section>
  );
}
