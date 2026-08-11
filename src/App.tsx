import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Check,
  Clock3,
  Gamepad2,
  Menu,
  MessageCircle,
  Package,
  Settings,
  TrainFront,
  Wifi,
  X,
} from "lucide-react";
import { loadRuntime, type RuntimeResult } from "./api";
import { StationDiagram } from "./components/StationDiagram";
import { TrainCard } from "./components/TrainCard";
import {
  dedupeTrains,
  defaultStation,
  formatClock,
  isFreight,
  isOnLine,
  movementKey,
  stationTracks,
} from "./runtime";
import type { LocalMovementState, RuntimeSnapshot, Station, TrainRow } from "./types";

type Theme = "light" | "dark" | "grey" | "grey-dark";
type Overlay = "settings" | "tambox" | "menu" | null;

const emptyMovement = (): LocalMovementState => ({
  arrival: "none",
  departure: "none",
  lineRequest: "none",
});

function LoadingView() {
  return (
    <main className="loading-view">
      <div className="loading-mark"><TrainFront /></div>
      <h1>TrainMeet TKL</h1>
      <p>Hämtar station och tidtabell…</p>
    </main>
  );
}

function Header({
  station,
  snapshot,
  source,
  freightMode,
  onFreightToggle,
  onOverlay,
}: {
  station: Station;
  snapshot: RuntimeSnapshot;
  source: RuntimeResult["source"];
  freightMode: boolean;
  onFreightToggle: () => void;
  onOverlay: (overlay: Overlay) => void;
}) {
  return (
    <>
      <header className="app-header">
        <button type="button" className="icon-button is-outlined" aria-label="Tillbaka" onClick={() => { window.location.href = "/"; }}>
          <ArrowLeft />
        </button>
        <h1>
          <span className="station-name-long">{station.name}</span>
          <span className="station-name-short">{station.code}</span>
        </h1>
        <span className="clock-pill" title={`Träffklocka, hastighet ${snapshot.clock.speed ?? 1}×`}>
          <Clock3 />
          {formatClock(snapshot.clock.time)}
        </span>
        <span className={`connection-indicator ${source === "server" ? "is-online" : "is-demo"}`} title={source === "server" ? "Ansluten till TrainMeet Server" : "Inbyggd demoträff"}>
          <Wifi />
        </span>
        <button type="button" className="icon-button message-button" aria-label="Meddelanden">
          <MessageCircle />
          <span>1</span>
        </button>
        <button type="button" className="icon-button" aria-label="Meny" onClick={() => onOverlay("menu")}>
          <Menu />
        </button>
      </header>
      <nav className="dispatcher-toolbar" aria-label="Verktyg">
        <button type="button" className={freightMode ? "is-freight" : ""} onClick={onFreightToggle}>
          {freightMode ? <Package /> : <TrainFront />}
          <span>{freightMode ? "Gods" : "TKL"}</span>
        </button>
        <button type="button" onClick={() => onOverlay("tambox")}>
          <Gamepad2 />
          <span>Tambox</span>
        </button>
        <button type="button" onClick={() => onOverlay("settings")}>
          <Settings />
          <span>Inställningar</span>
        </button>
      </nav>
    </>
  );
}

function NowMarker() {
  return <div className="now-marker" aria-label="Nu"><span /></div>;
}

function OverlayPanel({
  overlay,
  onClose,
  snapshot,
  station,
  source,
  theme,
  onThemeChange,
  onStationChange,
}: {
  overlay: Exclude<Overlay, null>;
  onClose: () => void;
  snapshot: RuntimeSnapshot;
  station: Station;
  source: RuntimeResult["source"];
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
  onStationChange: (stationId: string) => void;
}) {
  const panel = snapshot.connections.filter((connection) => (
    connection.station_a_id === station.id || connection.station_b_id === station.id
  ));
  return (
    <div className="overlay-backdrop" role="presentation" onMouseDown={onClose}>
      <aside className="overlay-panel" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
        <div className="overlay-heading">
          <div>
            <span className="micro-heading">TrainMeet TKL</span>
            <h2>{overlay === "settings" ? "Inställningar" : overlay === "tambox" ? "Tambox" : "Meny"}</h2>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Stäng"><X /></button>
        </div>

        {overlay === "settings" && (
          <div className="overlay-content form-stack">
            <label>
              <span>Station</span>
              <select value={station.id} onChange={(event) => onStationChange(event.target.value)}>
                {snapshot.stations.map((candidate) => <option value={candidate.id} key={candidate.id}>{candidate.name}</option>)}
              </select>
            </label>
            <fieldset>
              <legend>Tema</legend>
              <div className="theme-grid">
                {(["light", "dark", "grey", "grey-dark"] as Theme[]).map((candidate) => (
                  <button type="button" key={candidate} className={theme === candidate ? "is-active" : ""} onClick={() => onThemeChange(candidate)}>
                    {theme === candidate && <Check />}
                    {candidate === "light" ? "Ljust" : candidate === "dark" ? "Mörkt" : candidate === "grey" ? "Grått" : "Grått mörkt"}
                  </button>
                ))}
              </div>
            </fieldset>
            <div className="info-card">
              <strong>{source === "server" ? "TrainMeet Server" : "Demoläge"}</strong>
              <p>{source === "server" ? "Vyn uppdateras från serverns gemensamma driftstatus." : "Servern kunde inte nås. Den verkliga Charlottendal-konfigurationen visas lokalt."}</p>
            </div>
          </div>
        )}

        {overlay === "tambox" && (
          <div className="overlay-content">
            <p className="overlay-intro">Samma A–D-anslutningar som den fysiska Tamboxen. Alla kommandon ska gå genom TrainMeet Server.</p>
            <div className="tambox-slots">
              {(["A", "B", "C", "D"] as const).map((slot, index) => {
                const connection = panel[index];
                const neighborId = connection
                  ? (connection.station_a_id === station.id ? connection.station_b_id : connection.station_a_id)
                  : null;
                const neighbor = snapshot.stations.find((candidate) => candidate.id === neighborId);
                return (
                  <div key={slot} className="tambox-slot">
                    <strong>{slot}</strong>
                    <span>{neighbor?.name ?? "Ej tilldelad"}</span>
                  </div>
                );
              })}
            </div>
            <a className="primary-link" href="/">Öppna full Tambox-simulering</a>
          </div>
        )}

        {overlay === "menu" && (
          <div className="overlay-content menu-list">
            <button type="button" onClick={() => onStationChange(station.id)}>Dagens tågrörelser</button>
            <button type="button">Aktiva klareringar</button>
            <button type="button">Arkiverade rörelser</button>
            <div className="info-card">
              <strong>{snapshot.meet.name}</strong>
              <p>{snapshot.active_day} · revision {snapshot.revision ?? 0}</p>
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}

export default function App() {
  const [runtime, setRuntime] = useState<RuntimeResult | null>(null);
  const [stationId, setStationId] = useState<string | null>(null);
  const [movementState, setMovementState] = useState<Record<string, LocalMovementState>>({});
  const [selectedTrain, setSelectedTrain] = useState<string | null>(null);
  const [freightMode, setFreightMode] = useState(false);
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [theme, setTheme] = useState<Theme>(() => (window.localStorage.getItem("trainmeet-tkl.theme") as Theme) || "light");
  const firstLoad = useRef(true);

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const result = await loadRuntime();
        if (!active) return;
        setRuntime(result);
        if (firstLoad.current) {
          setStationId(defaultStation(result.snapshot).id);
          firstLoad.current = false;
        }
      } catch (error) {
        console.error("TrainMeet TKL kunde inte läsa driftdata", error);
      }
    };
    void refresh();
    const timer = window.setInterval(refresh, 3000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem("trainmeet-tkl.theme", theme);
  }, [theme]);

  if (!runtime || !stationId) return <LoadingView />;

  const { snapshot, source } = runtime;
  const station = snapshot.stations.find((candidate) => candidate.id === stationId) ?? snapshot.stations[0];
  const tracks = stationTracks(snapshot, station.id);
  const onLineNumbers = new Set(snapshot.train_positions.filter((position) => position.status === "connection").map((position) => position.train_number));
  const allStationTrains = dedupeTrains(snapshot.trains.filter((train) => train.station_id === station.id));
  const trains = allStationTrains.filter((train) => {
    if (isOnLine(snapshot, train.train_number)) return false;
    return freightMode ? isFreight(train) : true;
  });

  const stateFor = (train: TrainRow) => movementState[movementKey(train)] ?? emptyMovement();
  const activeTrains = trains.filter((train) => stateFor(train).departure !== "departed");
  const archivedTrains = trains.filter((train) => stateFor(train).departure === "departed");
  const now = formatClock(snapshot.clock.time);
  let markerAdded = false;

  const selectStation = (nextStationId: string) => {
    setStationId(nextStationId);
    setSelectedTrain(null);
    window.localStorage.setItem("trainmeet-tkl.station-id", nextStationId);
    setOverlay(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const selectTrain = (trainNumber: string) => {
    setSelectedTrain(trainNumber);
    const row = allStationTrains.find((train) => train.train_number === trainNumber);
    if (!row) return;
    window.requestAnimationFrame(() => {
      document.getElementById(`train-${row.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  };

  return (
    <div className="app-background">
      <main className="app-shell">
        <Header
          station={station}
          snapshot={snapshot}
          source={source}
          freightMode={freightMode}
          onFreightToggle={() => setFreightMode((value) => !value)}
          onOverlay={setOverlay}
        />

        <div className="diagram-sticky">
          <StationDiagram
            snapshot={snapshot}
            station={station}
            tracks={tracks}
            selectedTrain={selectedTrain}
            onTrainSelect={selectTrain}
            onStationSelect={selectStation}
          />
        </div>

        <section className="train-list" aria-label="Tågrörelser">
          {activeTrains.length === 0 && (
            <div className="empty-state">
              <TrainFront />
              <strong>Inga tågrörelser</strong>
              <span>{freightMode ? "Det finns inga godståg på stationen." : "Stationen saknar tågrörelser för aktiv dag."}</span>
            </div>
          )}
          {activeTrains.flatMap((train, index) => {
            const elements = [];
            if (!markerAdded && train.sort_time > now) {
              markerAdded = true;
              elements.push(<NowMarker key="now-marker" />);
            }
            const key = movementKey(train);
            elements.push(
              <TrainCard
                key={train.id}
                snapshot={snapshot}
                train={train}
                movement={movementState[key] ?? emptyMovement()}
                availableTracks={tracks}
                defaultExpanded={index === 0 && source === "demo"}
                freightMode={freightMode}
                selected={selectedTrain === train.train_number}
                onSelect={setSelectedTrain}
                onMovementChange={(next) => setMovementState((current) => ({ ...current, [key]: next }))}
              />,
            );
            return elements;
          })}
          {!markerAdded && activeTrains.length > 0 && <NowMarker />}

          <details className="archive-section">
            <summary>Arkiverade tågrörelser ({archivedTrains.length + onLineNumbers.size})</summary>
            <div className="archive-content">
              {archivedTrains.length === 0 && onLineNumbers.size === 0 && <span>Inga arkiverade tågrörelser.</span>}
              {[...onLineNumbers].map((number) => <span key={number}>Tåg {number} · på linjen</span>)}
              {archivedTrains.map((train) => <span key={train.id}>Tåg {train.train_number} · avgått</span>)}
            </div>
          </details>
        </section>
      </main>

      {overlay && (
        <OverlayPanel
          overlay={overlay}
          onClose={() => setOverlay(null)}
          snapshot={snapshot}
          station={station}
          source={source}
          theme={theme}
          onThemeChange={setTheme}
          onStationChange={selectStation}
        />
      )}
    </div>
  );
}

