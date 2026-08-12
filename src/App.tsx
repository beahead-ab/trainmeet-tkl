import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Check,
  Clock3,
  Gamepad2,
  Menu,
  MessageCircle,
  Package,
  RefreshCw,
  Server,
  Settings,
  TrainFront,
  Wifi,
  X,
} from "lucide-react";
import {
  inspectServer,
  loadRuntime,
  loadTerminalConfig,
  saveTerminalConfig,
  type RuntimeResult,
  type TerminalConfig,
} from "./api";
import { StationDiagram } from "./components/StationDiagram";
import { TrainCard } from "./components/TrainCard";
import {
  dedupeTrains,
  defaultStation,
  formatClock,
  isFreight,
  isOnLine,
  movementKey,
  stationTrackOccupants,
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

function SetupView({ onComplete }: { onComplete: (config: TerminalConfig, snapshot: RuntimeSnapshot) => void }) {
  const [serverUrl, setServerUrl] = useState(() => (
    window.location.port === "8790" ? "http://trainmeet.local:8787" : window.location.origin
  ));
  const [terminalName, setTerminalName] = useState("");
  const [orientation, setOrientation] = useState<TerminalConfig["orientation"]>("portrait");
  const [snapshot, setSnapshot] = useState<RuntimeSnapshot | null>(null);
  const [stationId, setStationId] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("Ange adressen till TrainMeet Server på det lokala nätverket.");

  const connect = async () => {
    setBusy(true);
    setMessage("Kontaktar TrainMeet Server …");
    try {
      const next = await inspectServer(serverUrl);
      setSnapshot(next);
      const preferred = defaultStation(next);
      setStationId(preferred.id);
      setTerminalName((current) => current || `${preferred.code} TKL 1`);
      setMessage(`Hittade ${next.meet.name} med ${next.stations.length} stationer.`);
    } catch {
      setSnapshot(null);
      setMessage("Servern kunde inte nås. Kontrollera adress, nätverk och att TrainMeet Server är igång.");
    } finally {
      setBusy(false);
    }
  };

  const finish = async () => {
    if (!snapshot || !stationId || !terminalName.trim()) return;
    const station = snapshot.stations.find((candidate) => candidate.id === stationId);
    setBusy(true);
    try {
      const saved = await saveTerminalConfig({
        terminal_name: terminalName.trim(),
        server_url: serverUrl.trim(),
        station_id: stationId,
        station_name: station?.name,
        orientation,
      });
      window.localStorage.setItem("trainmeet-tkl.station-id", stationId);
      onComplete(saved, snapshot);
    } catch {
      setMessage("Terminalprofilen kunde inte sparas.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="setup-view">
      <div className="setup-card">
        <div className="setup-brand"><TrainFront /><span>TrainMeet TKL Terminal</span></div>
        <span className="micro-heading">Första starten</span>
        <h1>Koppla terminalen till stationen</h1>
        <p className="setup-intro">Valet sparas i apparaten. Efter nästa omstart öppnas TKL-vyn direkt på den valda stationen.</p>

        <div className="setup-fields">
          <label>
            <span>TrainMeet Server</span>
            <div className="server-field">
              <input value={serverUrl} onChange={(event) => setServerUrl(event.target.value)} placeholder="http://trainmeet.local:8787" />
              <button type="button" onClick={connect} disabled={busy || !serverUrl.trim()}><Server /> Anslut</button>
            </div>
          </label>

          {snapshot && (
            <>
              <div className="meet-found"><Check /><span><strong>{snapshot.meet.name}</strong><small>{snapshot.active_day}</small></span></div>
              <label>
                <span>Station</span>
                <select value={stationId} onChange={(event) => {
                  const value = event.target.value;
                  setStationId(value);
                  const station = snapshot.stations.find((candidate) => candidate.id === value);
                  if (station) setTerminalName(`${station.code} TKL 1`);
                }}>
                  {snapshot.stations.map((station) => <option key={station.id} value={station.id}>{station.name} · {station.code}</option>)}
                </select>
              </label>
              <label>
                <span>Terminalens namn</span>
                <input value={terminalName} onChange={(event) => setTerminalName(event.target.value)} placeholder="CDA TKL 1" />
              </label>
              <fieldset>
                <legend>Skärm</legend>
                <div className="orientation-options">
                  <button type="button" className={orientation === "portrait" ? "is-selected" : ""} onClick={() => setOrientation("portrait")}>Stående</button>
                  <button type="button" className={orientation === "landscape" ? "is-selected" : ""} onClick={() => setOrientation("landscape")}>Liggande</button>
                </div>
              </fieldset>
            </>
          )}
        </div>

        <p className={`setup-message ${snapshot ? "is-success" : ""}`}>{message}</p>
        {snapshot && <button type="button" className="setup-finish" onClick={finish} disabled={busy || !stationId || !terminalName.trim()}>Starta terminalen</button>}
      </div>
    </main>
  );
}

function UnavailableView({ onRetry }: { onRetry: () => void }) {
  return (
    <main className="loading-view">
      <div className="loading-mark is-offline"><Wifi /></div>
      <h1>Ingen kontakt med TrainMeet Server</h1>
      <p>Inga trafikåtgärder kan utföras innan servern svarar.</p>
      <button type="button" className="retry-button" onClick={onRetry}><RefreshCw /> Försök igen</button>
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
        <span className={`connection-indicator ${source === "server" ? "is-online" : "is-demo"}`} title={source === "server" ? "Ansluten till TrainMeet Server" : source === "cache" ? "Offline – senast kända läge" : "Inbyggd demoträff"}>
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
              <p>{source === "server" ? "Vyn uppdateras från serverns gemensamma driftstatus." : source === "cache" ? "Servern kan inte nås. Senast kända läge visas och trafikåtgärderna är spärrade." : "Den verkliga Charlottendal-konfigurationen visas lokalt i demoläge."}</p>
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
  const [terminalConfig, setTerminalConfig] = useState<TerminalConfig | null>(null);
  const [runtimeError, setRuntimeError] = useState(false);
  const [stationId, setStationId] = useState<string | null>(null);
  const [movementState, setMovementState] = useState<Record<string, LocalMovementState>>({});
  const [selectedTrain, setSelectedTrain] = useState<string | null>(null);
  const [freightMode, setFreightMode] = useState(false);
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [theme, setTheme] = useState<Theme>(() => (window.localStorage.getItem("trainmeet-tkl.theme") as Theme) || "light");
  const firstLoad = useRef(true);

  useEffect(() => {
    void loadTerminalConfig().then(setTerminalConfig);
  }, []);

  useEffect(() => {
    if (!terminalConfig?.configured) return undefined;
    let active = true;
    const refresh = async () => {
      try {
        const result = await loadRuntime();
        if (!active) return;
        setRuntime(result);
        setRuntimeError(false);
        if (firstLoad.current) {
          const configuredStation = result.snapshot.stations.find((station) => station.id === terminalConfig.station_id);
          setStationId(configuredStation?.id ?? defaultStation(result.snapshot).id);
          firstLoad.current = false;
        }
      } catch (error) {
        console.error("TrainMeet TKL kunde inte läsa driftdata", error);
        if (active) setRuntimeError(true);
      }
    };
    void refresh();
    const timer = window.setInterval(refresh, 3000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [terminalConfig]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem("trainmeet-tkl.theme", theme);
  }, [theme]);

  if (!terminalConfig) return <LoadingView />;
  if (!terminalConfig.configured) return <SetupView onComplete={(config, snapshot) => {
    setTerminalConfig(config);
    setRuntime({ snapshot, source: "server", connected: true });
    setStationId(config.station_id);
  }} />;
  if (runtimeError && !runtime) return <UnavailableView onRetry={() => window.location.reload()} />;
  if (!runtime || !stationId) return <LoadingView />;

  const { snapshot, source } = runtime;
  const station = snapshot.stations.find((candidate) => candidate.id === stationId) ?? snapshot.stations[0];
  const tracks = stationTracks(snapshot, station.id);
  const trackOccupants = stationTrackOccupants(snapshot, station.id, movementState);
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
        {!runtime.connected && source !== "demo" && (
          <div className="offline-banner" role="status">Offline · visar senast kända läge · trafikåtgärder är spärrade</div>
        )}
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
            trackOccupants={trackOccupants}
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
                actionsDisabled={!runtime.connected && source !== "demo"}
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
