import { useEffect, useMemo, useState } from "react";
import { ChevronDown, FileText, Package, SendHorizontal } from "lucide-react";
import { routeNeighbors } from "../runtime";
import type {
  DepartureStatus,
  LocalMovementState,
  RuntimeSnapshot,
  TrainRow,
} from "../types";

interface TrainCardProps {
  snapshot: RuntimeSnapshot;
  train: TrainRow;
  movement: LocalMovementState;
  availableTracks: string[];
  defaultExpanded?: boolean;
  freightMode: boolean;
  selected: boolean;
  onSelect: (trainNumber: string) => void;
  onMovementChange: (next: LocalMovementState) => void;
}

function DirectionIcon({ train }: { train: TrainRow }) {
  const flip = Number.parseInt(train.train_number, 10) % 2 !== 0;
  const className = `direction-icon ${flip ? "is-flipped" : ""}`;
  if (train.no_stop) {
    return (
      <svg className={className} viewBox="0 0 20 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <line x1="2" y1="6" x2="14" y2="6" />
        <polyline points="11,2.5 15,6 11,9.5" />
        <line x1="0" y1="3" x2="4" y2="3" opacity=".4" />
        <line x1="0" y1="9" x2="4" y2="9" opacity=".4" />
      </svg>
    );
  }
  if (!train.arrival_time && train.departure_time) {
    return (
      <svg className={className} viewBox="0 0 20 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <line x1="3" y1="1" x2="3" y2="11" />
        <line x1="6" y1="6" x2="16" y2="6" />
        <polyline points="13,2.5 17,6 13,9.5" />
      </svg>
    );
  }
  if (train.arrival_time && !train.departure_time) {
    return (
      <svg className={className} viewBox="0 0 20 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <line x1="2" y1="6" x2="13" y2="6" />
        <polyline points="10,2.5 14,6 10,9.5" />
        <line x1="17" y1="1" x2="17" y2="11" />
      </svg>
    );
  }
  return (
    <svg className={className} viewBox="0 0 20 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="2" y1="6" x2="15" y2="6" />
      <circle cx="9" cy="6" r="2" fill="currentColor" stroke="none" />
      <polyline points="12,2.5 16,6 12,9.5" />
    </svg>
  );
}

function nextAction(train: TrainRow, movement: LocalMovementState): {
  label: string;
  arrival?: LocalMovementState["arrival"];
  departure?: DepartureStatus;
} | null {
  if (train.no_stop) {
    if (movement.arrival === "none") return { label: "På väg in", arrival: "approaching" };
    if (movement.arrival === "approaching") return { label: "Passerat", arrival: "arrived" };
    return null;
  }

  if (train.arrival_time && movement.arrival === "none") {
    return { label: "På väg in", arrival: "approaching" };
  }
  if (train.arrival_time && movement.arrival === "approaching") {
    return { label: "Ankommit", arrival: "arrived" };
  }
  const arrivalComplete = !train.arrival_time || movement.arrival === "arrived";
  if (!train.departure_time || !arrivalComplete) return null;
  if (!train.arrival_time && movement.departure === "none") {
    return { label: "Ställ upp tåg", departure: "positioned" };
  }
  if (movement.departure === "none" || movement.departure === "positioned") {
    return { label: "Klart för avgång", departure: "ready" };
  }
  if (movement.departure === "ready") {
    return { label: "Tåg ut", departure: "departed" };
  }
  return null;
}

function statusLabel(train: TrainRow, movement: LocalMovementState, from: string | null, to: string | null): string {
  if (movement.departure === "departed") return "Avgått";
  if (movement.departure === "ready") return to ? `Klart → ${to}` : "Klart för avgång";
  if (movement.departure === "positioned") return to ? `Uppställt → ${to}` : "Uppställt";
  if (movement.arrival === "approaching") return "På väg in";
  if (movement.arrival === "arrived") return from ? `Ankommet ← ${from}` : "Ankommet";
  if (train.arrival_time && from) return `Ank från ${from}`;
  if (train.departure_time && to) return `Avg till ${to}`;
  return "";
}

function statusClass(movement: LocalMovementState): string {
  if (movement.departure === "ready" || movement.arrival === "approaching") return "is-warning";
  if (movement.departure === "positioned" || movement.arrival === "arrived") return "is-ready";
  if (movement.departure === "departed") return "is-complete";
  return "";
}

function renderNote(note: string) {
  return note.replace(/\\n/g, "\n").split("\n").map((line, index) => (
    <span key={`${line}-${index}`}>
      {line}
      {index < note.replace(/\\n/g, "\n").split("\n").length - 1 && <br />}
    </span>
  ));
}

export function TrainCard({
  snapshot,
  train,
  movement,
  availableTracks,
  defaultExpanded = false,
  freightMode,
  selected,
  onSelect,
  onMovementChange,
}: TrainCardProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const neighbors = useMemo(() => routeNeighbors(snapshot, train), [snapshot, train]);
  const from = neighbors.from?.name ?? train.arrival_from;
  const to = neighbors.to?.name ?? train.departure_to;
  const summary = statusLabel(train, movement, from, to);
  const action = nextAction(train, movement);
  const dispatchMode = snapshot.meet.default_dispatch_mode ?? "clearance";
  const departureBlocked = action?.departure === "departed"
    && dispatchMode === "clearance"
    && movement.lineRequest !== "confirmed";

  useEffect(() => {
    if (selected) setExpanded(true);
  }, [selected]);

  const runAction = () => {
    if (!action || departureBlocked) return;
    const next: LocalMovementState = {
      ...movement,
      arrival: action.arrival ?? movement.arrival,
      departure: action.departure ?? movement.departure,
    };
    if (dispatchMode === "direct" && action.departure === "ready") {
      next.lineRequest = "confirmed";
    }
    onMovementChange(next);
    setExpanded(false);
  };

  const requestLine = () => {
    onMovementChange({ ...movement, lineRequest: "pending" });
    window.setTimeout(() => {
      onMovementChange({ ...movement, lineRequest: "confirmed" });
    }, 700);
    setExpanded(false);
  };

  const primaryTime = train.arrival_time || train.departure_time || train.sort_time;
  return (
    <article
      id={`train-${train.id}`}
      className={`train-card ${statusClass(movement)} ${expanded ? "is-expanded" : ""} ${selected ? "is-selected" : ""}`}
    >
      <button
        type="button"
        className="train-card-summary"
        onClick={() => {
          setExpanded((value) => !value);
          onSelect(train.train_number);
        }}
        aria-expanded={expanded}
      >
        <time className={train.arrival_time ? "arrival-time" : "departure-time"}>{primaryTime}</time>
        <strong className="train-number">{train.train_number}</strong>
        <span className="train-direction-track">
          <DirectionIcon train={train} />
          <span>{movement.actualTrack || train.track}</span>
        </span>
        {train.note && !expanded && <FileText className="note-icon" aria-label="Tåget har en anteckning" />}
        <span className="train-summary-text">{summary}</span>
        <ChevronDown className={`train-chevron ${expanded ? "is-open" : ""}`} aria-hidden="true" />
      </button>

      {expanded && (
        <div className="train-card-detail">
          <div className="track-control">
            <label htmlFor={`track-${train.id}`}>Spår</label>
            <select
              id={`track-${train.id}`}
              value={movement.actualTrack || train.track}
              onChange={(event) => onMovementChange({ ...movement, actualTrack: event.target.value })}
            >
              {availableTracks.map((track) => <option key={track}>{track}</option>)}
            </select>
          </div>

          <div className="movement-details">
            {train.arrival_time && (
              <div className="movement-detail-row">
                <span className={`movement-dot ${movement.arrival !== "none" ? "is-active" : ""}`} />
                <time>{train.arrival_time}</time>
                <span>Ank från {from ?? "?"}</span>
              </div>
            )}
            {train.departure_time && (
              <div className="movement-detail-row">
                <span className={`movement-dot ${movement.departure !== "none" ? "is-active" : ""}`} />
                <time>{train.departure_time}</time>
                <span>Avg till {to ?? "?"}</span>
              </div>
            )}
          </div>

          {train.note && <div className="train-note">{renderNote(train.note)}</div>}

          {action && (
            <div className="train-actions">
              <button
                type="button"
                className="primary-action"
                disabled={departureBlocked || (freightMode && action.departure === "departed")}
                onClick={runAction}
              >
                {action.label}
              </button>
              {departureBlocked && <span className="action-help">Klarering krävs före avgång</span>}
            </div>
          )}

          {dispatchMode === "clearance" && movement.departure === "ready" && (
            <button
              type="button"
              className={`line-request-action is-${movement.lineRequest}`}
              onClick={requestLine}
              disabled={movement.lineRequest === "pending" || movement.lineRequest === "confirmed"}
            >
              <SendHorizontal size={16} />
              {movement.lineRequest === "pending" && "Väntar på klarering"}
              {movement.lineRequest === "confirmed" && "Klarering beviljad"}
              {movement.lineRequest === "denied" && "Nekad – begär igen"}
              {movement.lineRequest === "none" && "Begär klarering"}
            </button>
          )}

          {freightMode && movement.departure === "ready" && (
            <button type="button" className="freight-action">
              <Package size={16} /> Avisera TKL
            </button>
          )}
        </div>
      )}
    </article>
  );
}

