import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Check,
  CircleCheckBig,
  Clock3,
  Gamepad2,
  LogIn,
  MapPin,
  Menu,
  MessageCircle,
  Package,
  RefreshCw,
  Server,
  ShieldCheck,
  TrainFront,
  UserRound,
  Wifi,
  X,
} from "lucide-react";
import {
  inspectServer,
  checkTerminalUpdate,
  connectWifi,
  discoverServers,
  finishTklShift,
  loadAuthStatus,
  loadRuntime,
  loadTerminalConfig,
  loadTklContext,
  loadWifiNetworks,
  loginAdmin,
  pairTerminal,
  performTklLineAction,
  resetTerminalConfig,
  saveTerminalConfig,
  startTklShift,
  startTerminalUpdate,
  updateTklMovement,
  type AuthStatus,
  type RuntimeResult,
  type TerminalConfig,
  type TklContext,
  type TklShift,
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
  routeNeighbors,
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

function SetupView({ onComplete }: { onComplete: (config: TerminalConfig, snapshot: RuntimeSnapshot, auth: AuthStatus) => void }) {
  const [serverUrl, setServerUrl] = useState(() => (
    window.location.port === "8790" ? "http://trainmeet.local:8787" : window.location.origin
  ));
  const [terminalName, setTerminalName] = useState("");
  const [orientation, setOrientation] = useState<TerminalConfig["orientation"]>("portrait");
  const [snapshot, setSnapshot] = useState<RuntimeSnapshot | null>(null);
  const [stationId, setStationId] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("Ange adressen till TrainMeet Server på det lokala nätverket.");
  const [messageKind, setMessageKind] = useState<"notice" | "success" | "error">("notice");
  const [discoveredServers, setDiscoveredServers] = useState<Array<{ name: string; url: string }>>([]);
  const [wifiNetworks, setWifiNetworks] = useState<Array<{ ssid: string; connected: boolean; signal: number; secured: boolean }>>([]);
  const [wifiSsid, setWifiSsid] = useState("");
  const [wifiPassword, setWifiPassword] = useState("");
  const [wifiMessage, setWifiMessage] = useState("");
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [pairingCode, setPairingCode] = useState("");

  const scanWifi = async () => {
    setWifiMessage("Söker efter Wi-Fi …");
    const networks = await loadWifiNetworks();
    setWifiNetworks(networks);
    const connected = networks.find((network) => network.connected);
    if (connected) {
      setWifiSsid(connected.ssid);
      setWifiMessage(`Ansluten till ${connected.ssid}.`);
    } else {
      setWifiMessage(networks.length ? "Välj nätverk och ange lösenord." : "Inga Wi-Fi-nätverk hittades. Ethernet kan fortfarande användas.");
    }
  };

  const joinWifi = async () => {
    if (!wifiSsid) return;
    setBusy(true);
    setWifiMessage(`Ansluter till ${wifiSsid} …`);
    try {
      await connectWifi(wifiSsid, wifiPassword);
      setWifiPassword("");
      setWifiMessage(`Ansluten till ${wifiSsid}.`);
      window.setTimeout(() => { void scanWifi(); }, 1500);
    } catch {
      setWifiMessage("Wi-Fi-anslutningen misslyckades. Kontrollera lösenordet.");
    } finally {
      setBusy(false);
    }
  };

  const discover = async () => {
    setBusy(true);
    setMessage("Söker efter TrainMeet Server på det lokala nätverket …");
    setMessageKind("notice");
    const servers = await discoverServers();
    setDiscoveredServers(servers);
    if (servers.length === 1) {
      setServerUrl(servers[0].url);
      setMessage(`Hittade ${servers[0].name}. Tryck Anslut för att läsa träffen.`);
      setMessageKind("success");
    } else if (servers.length > 1) {
      setMessage(`Hittade ${servers.length} TrainMeet-servrar. Välj en och anslut.`);
      setMessageKind("success");
    } else {
      setMessage("Ingen server hittades automatiskt. Ange adressen eller kontrollera nätverket.");
      setMessageKind("error");
    }
    setBusy(false);
  };

  const connect = async () => {
    setBusy(true);
    setMessage("Kontaktar TrainMeet Server …");
    setMessageKind("notice");
    try {
      const next = await inspectServer(serverUrl);
      setSnapshot(next);
      const preferred = defaultStation(next);
      setStationId(preferred.id);
      setTerminalName((current) => current || `${preferred.code} TKL 1`);
      setMessage(`Hittade ${next.meet.name} med ${next.stations.length} stationer.`);
      setMessageKind("success");
      try {
        const status = await loadAuthStatus();
        setAuth(status);
        setUsername(status.username || "admin");
      } catch {
        setAuth({ authenticated: false, access_mode: "external", username: "admin", password_configured: true, must_change_password: false });
      }
    } catch {
      setSnapshot(null);
      setMessage("Servern kunde inte nås. Kontrollera adress, nätverk och att TrainMeet Server är igång.");
      setMessageKind("error");
    } finally {
      setBusy(false);
    }
  };

  const authenticate = async () => {
    if (!auth) return;
    setBusy(true);
    setMessage(auth.access_mode === "terminal" ? "Parkopplar terminalen …" : "Loggar in …");
    setMessageKind("notice");
    try {
      const next = auth.access_mode === "terminal"
        ? await pairTerminal(serverUrl, pairingCode, terminalName || "TrainMeet TKL Terminal")
        : await loginAdmin(username, password);
      setAuth(next);
      setPassword("");
      setPairingCode("");
      setMessage("Terminalen har behörighet till TrainMeet Server.");
      setMessageKind("success");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Inloggningen misslyckades.");
      setMessageKind("error");
    } finally {
      setBusy(false);
    }
  };

  const finish = async () => {
    if (!snapshot || !stationId || !terminalName.trim() || !auth?.authenticated) return;
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
      onComplete(saved, snapshot, auth);
    } catch {
      setMessage("Terminalprofilen kunde inte sparas.");
      setMessageKind("error");
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

        <div className="setup-progress" aria-label="Installationens steg">
          <span className="is-complete"><b>1</b>Anslut</span>
          <span className={snapshot ? "is-complete" : ""}><b>2</b>Logga in</span>
          <span className={auth?.authenticated ? "is-complete" : ""}><b>3</b>Träff</span>
          <span className={stationId && auth?.authenticated ? "is-complete" : ""}><b>4</b>Station</span>
        </div>

        <div className="setup-fields">
          <details className="wifi-setup">
            <summary>Wi-Fi och nätverk</summary>
            <div className="wifi-setup-content">
              <button type="button" className="discover-button" onClick={() => { void scanWifi(); }} disabled={busy}><RefreshCw /> Sök Wi-Fi</button>
              {wifiNetworks.length > 0 && (
                <label>
                  <span>Nätverk</span>
                  <select value={wifiSsid} onChange={(event) => setWifiSsid(event.target.value)}>
                    <option value="">Välj Wi-Fi …</option>
                    {wifiNetworks.map((network) => <option key={network.ssid} value={network.ssid}>{network.connected ? "✓ " : ""}{network.ssid} · {network.signal}%{network.secured ? " · låst" : ""}</option>)}
                  </select>
                </label>
              )}
              {wifiSsid && !wifiNetworks.find((network) => network.ssid === wifiSsid)?.connected && (
                <div className="wifi-password-row">
                  <input type="password" value={wifiPassword} onChange={(event) => setWifiPassword(event.target.value)} placeholder="Wi-Fi-lösenord" autoComplete="new-password" />
                  <button type="button" onClick={() => { void joinWifi(); }} disabled={busy}>Anslut</button>
                </div>
              )}
              {wifiMessage && <p>{wifiMessage}</p>}
            </div>
          </details>
          <label>
            <span>TrainMeet Server</span>
            <div className="server-field">
              <input value={serverUrl} onChange={(event) => setServerUrl(event.target.value)} placeholder="http://trainmeet.local:8787" />
              <button type="button" onClick={connect} disabled={busy || !serverUrl.trim()}><Server /> Anslut</button>
            </div>
          </label>
          <button type="button" className="discover-button" onClick={discover} disabled={busy}><RefreshCw /> Sök automatiskt på nätverket</button>
          {discoveredServers.length > 1 && (
            <div className="discovered-servers">
              {discoveredServers.map((server) => (
                <button type="button" key={server.url} onClick={() => setServerUrl(server.url)} className={serverUrl === server.url ? "is-selected" : ""}>
                  <strong>{server.name}</strong><span>{server.url}</span>
                </button>
              ))}
            </div>
          )}

          {snapshot && (
            <>
              {!auth?.authenticated && (
                <section className="setup-step-card">
                  <div className="setup-step-heading"><LogIn /><span><strong>{auth?.access_mode === "terminal" ? "Parkoppla terminalen" : "Logga in"}</strong><small>{auth?.access_mode === "terminal" ? "Använd anslutningskoden från TrainMeet Server." : "Extern anslutning kräver serverns administratörskonto."}</small></span></div>
                  {auth?.access_mode === "terminal" ? (
                    <input value={pairingCode} onChange={(event) => setPairingCode(event.target.value)} placeholder="Anslutningskod, exempelvis 123-456" inputMode="numeric" />
                  ) : (
                    <div className="login-fields">
                      <input value={username} onChange={(event) => setUsername(event.target.value)} placeholder="Användarnamn" autoComplete="username" />
                      <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Lösenord" autoComplete="current-password" />
                    </div>
                  )}
                  <button type="button" className="setup-auth-button" onClick={() => { void authenticate(); }} disabled={busy || (auth?.access_mode === "terminal" ? !pairingCode.trim() : !username.trim() || !password)}>Fortsätt</button>
                </section>
              )}
              {auth?.authenticated && (
                <>
                  <section className="setup-step-card is-success">
                    <div className="setup-step-heading"><ShieldCheck /><span><strong>Ansluten</strong><small>{auth.access_mode === "terminal" ? "Terminalen är parkopplad och känns igen automatiskt." : `Inloggad som ${auth.username}.`}</small></span></div>
                  </section>
                  <section className="meet-selection">
                    <span className="micro-heading">Aktiv träff</span>
                    <div className="meet-found"><Check /><span><strong>{snapshot.meet.name}</strong><small>{snapshot.active_day} · {snapshot.stations.length} stationer</small></span></div>
                  </section>
                  <section className="station-selection">
                    <span className="micro-heading">Välj station</span>
                    <div className="station-choice-grid">
                      {snapshot.stations.map((station) => {
                        const movements = snapshot.trains.filter((train) => train.station_id === station.id).length;
                        const connections = snapshot.connections.filter((connection) => connection.station_a_id === station.id || connection.station_b_id === station.id).length;
                        return (
                          <button type="button" key={station.id} className={stationId === station.id ? "is-selected" : ""} onClick={() => { setStationId(station.id); setTerminalName(`${station.code} TKL 1`); }}>
                            <b>{station.code}</b><span><strong>{station.name}</strong><small>{movements} tågrörelser · {connections} anslutningar</small></span>{stationId === station.id && <Check />}
                          </button>
                        );
                      })}
                    </div>
                  </section>
                </>
              )}
              {auth?.authenticated && (
              <label>
                <span>Terminalens namn</span>
                <input value={terminalName} onChange={(event) => setTerminalName(event.target.value)} placeholder="CDA TKL 1" />
              </label>
              )}
              {auth?.authenticated && (
              <fieldset>
                <legend>Skärm</legend>
                <div className="orientation-options">
                  <button type="button" className={orientation === "portrait" ? "is-selected" : ""} onClick={() => setOrientation("portrait")}>Stående</button>
                  <button type="button" className={orientation === "landscape" ? "is-selected" : ""} onClick={() => setOrientation("landscape")}>Liggande</button>
                </div>
              </fieldset>
              )}
            </>
          )}
        </div>

        <p className={`setup-message is-${messageKind}`}>{message}</p>
        {snapshot && auth?.authenticated && <button type="button" className="setup-finish" onClick={finish} disabled={busy || !stationId || !terminalName.trim()}><MapPin /> Bekräfta station och fortsätt</button>}
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

function AuthenticationView({
  status,
  terminalConfig,
  onAuthenticated,
  onReconfigure,
}: {
  status: AuthStatus;
  terminalConfig: TerminalConfig;
  onAuthenticated: (status: AuthStatus) => void;
  onReconfigure: () => void;
}) {
  const [username, setUsername] = useState(status.username || "admin");
  const [password, setPassword] = useState("");
  const [pairingCode, setPairingCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const submit = async () => {
    setBusy(true);
    setMessage("");
    try {
      const authenticated = status.access_mode === "terminal"
        ? await pairTerminal(terminalConfig.server_url, pairingCode, terminalConfig.terminal_name)
        : await loginAdmin(username, password);
      onAuthenticated(authenticated);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Inloggningen misslyckades.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="setup-view auth-view">
      <div className="setup-card auth-card">
        <div className="setup-brand"><TrainFront /><span>TrainMeet TKL</span></div>
        <span className="micro-heading">{terminalConfig.station_name || terminalConfig.terminal_name}</span>
        <h1>{status.access_mode === "terminal" ? "Parkoppla terminalen igen" : "Logga in för att fortsätta"}</h1>
        <p className="setup-intro">{status.access_mode === "terminal" ? "Terminalens tidigare behörighet gäller inte längre. Ange anslutningskoden från TrainMeet Server." : "Din station och terminalprofil finns kvar efter inloggningen."}</p>
        <div className="login-fields">
          {status.access_mode === "terminal" ? (
            <input value={pairingCode} onChange={(event) => setPairingCode(event.target.value)} placeholder="Anslutningskod" inputMode="numeric" />
          ) : (
            <>
              <input value={username} onChange={(event) => setUsername(event.target.value)} placeholder="Användarnamn" autoComplete="username" />
              <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Lösenord" autoComplete="current-password" />
            </>
          )}
        </div>
        {message && <p className="setup-message is-error">{message}</p>}
        <button type="button" className="setup-finish" onClick={() => { void submit(); }} disabled={busy || (status.access_mode === "terminal" ? !pairingCode.trim() : !username.trim() || !password)}><LogIn /> {busy ? "Ansluter …" : "Fortsätt"}</button>
        <button type="button" className="text-action" onClick={onReconfigure}>Byt server eller station</button>
      </div>
    </main>
  );
}

function ShiftStartView({
  context,
  terminalName,
  onStart,
}: {
  context: TklContext;
  terminalName: string;
  onStart: (operatorName: string, takeOver: boolean) => Promise<void>;
}) {
  const [operatorName, setOperatorName] = useState(() => window.localStorage.getItem("trainmeet-tkl.operator-name") || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const active = context.shift;
  const checks = [
    { label: "TrainMeet Server", ok: context.preflight.server_online, detail: "Ansluten" },
    { label: "Träffklocka", ok: context.preflight.clock_configured, detail: context.preflight.clock_running ? "Går" : "Står still" },
    { label: "Stationsspår", ok: context.preflight.track_count > 0, detail: `${context.preflight.track_count} spår` },
    { label: "Anslutningar", ok: context.preflight.connection_count > 0, detail: `${context.preflight.connection_count} sträckor` },
    { label: "Tidtabell", ok: context.preflight.train_count > 0, detail: `${context.preflight.train_count} tågrörelser` },
  ];
  const start = async () => {
    setBusy(true);
    setError("");
    try {
      window.localStorage.setItem("trainmeet-tkl.operator-name", operatorName.trim());
      await onStart(operatorName.trim(), Boolean(active));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Trafikpasset kunde inte startas.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="shift-start-view">
      <div className="shift-start-card">
        <div className="setup-brand"><TrainFront /><span>TrainMeet TKL</span></div>
        <span className="micro-heading">{context.meet.name} · {context.active_day}</span>
        <h1>Ta {context.station.name} i tjänst</h1>
        <p className="setup-intro">Kontrollera sammanhanget och starta ett trafikpass innan några tågrörelser hanteras.</p>
        {active && (
          <div className="active-shift-notice">
            <UserRound /><span><strong>Pågående trafikpass</strong><small>{active.operator_name} · startat {new Date(active.started_at).toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" })}</small></span>
          </div>
        )}
        {!active && context.previous_shift?.status === "handover" && context.previous_shift.handover_note && (
          <div className="active-shift-notice is-handover">
            <MessageCircle /><span><strong>Från föregående operatör</strong><small>{context.previous_shift.handover_note}</small></span>
          </div>
        )}
        <div className="preflight-list">
          {checks.map((check) => <div key={check.label}><span className={check.ok ? "is-ok" : "is-warning"}>{check.ok ? <Check /> : <Clock3 />}</span><strong>{check.label}</strong><small>{check.detail}</small></div>)}
        </div>
        <label className="operator-field"><span>Operatör</span><input value={operatorName} onChange={(event) => setOperatorName(event.target.value)} placeholder="Ditt namn" autoFocus /></label>
        <div className="shift-summary"><MapPin /><span><strong>{context.station.code} · {context.station.name}</strong><small>{terminalName} · {context.preflight.open_connection_count ? `${context.preflight.open_connection_count} pågående sträckor att ta över` : "Alla sträckor fria"}</small></span></div>
        {error && <p className="setup-message is-error">{error}</p>}
        <button type="button" className="setup-finish" disabled={busy || !operatorName.trim() || checks.some((check) => !check.ok && check.label !== "Träffklocka")} onClick={() => { void start(); }}><ShieldCheck /> {busy ? "Startar …" : active ? "Ta över trafikpasset" : "Starta trafikpass"}</button>
      </div>
    </main>
  );
}

function ShiftFinishedView({
  station,
  shift,
  status,
  completedCount,
  onContinue,
}: {
  station: Station;
  shift: TklShift;
  status: "handover" | "closed";
  completedCount: number;
  onContinue: () => void;
}) {
  return (
    <main className="shift-start-view">
      <div className="shift-start-card shift-finished-card">
        <div className="completion-symbol"><CircleCheckBig /></div>
        <span className="micro-heading">{station.code} · {station.name}</span>
        <h1>{status === "handover" ? "Stationen är överlämnad" : "Trafikpasset är avslutat"}</h1>
        <p className="setup-intro">{shift.operator_name} hanterade {completedCount} avslutade tågrörelser under det här terminalpasset.</p>
        <div className="shift-summary"><Clock3 /><span><strong>{new Date(shift.started_at).toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" })}–{new Date().toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" })}</strong><small>{status === "handover" ? "Nästa operatör kan nu ta över." : "Stationen är inte längre bemannad i TKL."}</small></span></div>
        <button type="button" className="setup-finish" onClick={onContinue}>Till startsidan</button>
      </div>
    </main>
  );
}

function AttentionQueue({
  snapshot,
  station,
  context,
  busyId,
  onAction,
}: {
  snapshot: RuntimeSnapshot;
  station: Station;
  context: TklContext;
  busyId: string | null;
  onAction: (state: RuntimeSnapshot["connection_states"][number], action: "accept" | "reject" | "cancel" | "arrive") => Promise<void>;
}) {
  const cases = context.connection_states.filter((state) => state.state !== "free");
  if (!cases.length) return null;
  return (
    <section className="attention-queue" aria-label="Kräver uppmärksamhet">
      <div className="attention-heading"><span><strong>Kräver uppmärksamhet</strong><small>{cases.length} aktiva trafikärenden</small></span></div>
      <div className="attention-list">
        {cases.map((state) => {
          const connection = snapshot.connections.find((candidate) => candidate.id === state.id);
          const outgoing = state.from_station_id === station.id;
          const neighborId = connection ? (connection.station_a_id === station.id ? connection.station_b_id : connection.station_a_id) : null;
          const neighbor = snapshot.stations.find((candidate) => candidate.id === neighborId);
          const label = state.state === "requested"
            ? outgoing ? "Väntar på klarering" : "Begäran om klarering"
            : state.state === "reserved"
              ? outgoing ? "Klarering beviljad" : "Tåg väntar på avgång"
              : outgoing ? "Tåg på linjen" : "Tåg på väg in";
          return (
            <article key={state.id} className={`attention-case is-${state.state}`}>
              <span className="attention-state-dot" />
              <div><span className="micro-heading">{neighbor?.code || "STRÄCKA"}</span><strong>{label}</strong><small>Tåg {state.train_number || "?"} · {neighbor?.name || state.id}</small></div>
              <div className="attention-actions">
                {state.state === "requested" && !outgoing && <><button type="button" disabled={busyId === state.id} onClick={() => { void onAction(state, "accept"); }}>Godkänn</button><button type="button" className="secondary" disabled={busyId === state.id} onClick={() => { void onAction(state, "reject"); }}>Neka</button></>}
                {state.state === "requested" && outgoing && <button type="button" className="secondary" disabled={busyId === state.id} onClick={() => { void onAction(state, "cancel"); }}>Återkalla</button>}
                {state.state === "occupied" && !outgoing && <button type="button" disabled={busyId === state.id} onClick={() => { void onAction(state, "arrive"); }}>Bekräfta ankomst</button>}
              </div>
            </article>
          );
        })}
      </div>
    </section>
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
  const adminTimer = useRef<number | null>(null);
  const beginAdminHold = () => {
    adminTimer.current = window.setTimeout(() => onOverlay("settings"), 5000);
  };
  const endAdminHold = () => {
    if (adminTimer.current !== null) window.clearTimeout(adminTimer.current);
    adminTimer.current = null;
  };
  return (
    <>
      <header className="app-header">
        <button type="button" className="icon-button is-outlined" aria-label="Tillbaka" onClick={() => { window.location.href = "/"; }}>
          <ArrowLeft />
        </button>
        <h1
          onPointerDown={beginAdminHold}
          onPointerUp={endAdminHold}
          onPointerCancel={endAdminHold}
          onPointerLeave={endAdminHold}
          title="Håll in stationsnamnet i fem sekunder för terminaladministration"
        >
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
  onReconfigure,
  shift,
  onFinishShift,
}: {
  overlay: Exclude<Overlay, null>;
  onClose: () => void;
  snapshot: RuntimeSnapshot;
  station: Station;
  source: RuntimeResult["source"];
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
  onStationChange: (stationId: string) => void;
  onReconfigure: () => void;
  shift: TklShift;
  onFinishShift: (status: "handover" | "closed", note: string) => Promise<void>;
}) {
  const [updateStatus, setUpdateStatus] = useState<string>("");
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [handoverNote, setHandoverNote] = useState("");
  const [finishingShift, setFinishingShift] = useState(false);
  const [shiftError, setShiftError] = useState("");
  useEffect(() => {
    if (overlay !== "settings") return;
    void checkTerminalUpdate().then((status) => {
      setUpdateAvailable(Boolean(status.supported && status.update_available));
      setUpdateStatus(status.check_error || (status.update_available
        ? `Ny version ${status.latest_version} finns. Installerad: ${status.installed_version}.`
        : `Installerad version ${status.installed_version} är aktuell.`));
    }).catch(() => setUpdateStatus("Uppdatering hanteras av TrainMeet Server i det här körläget."));
  }, [overlay]);

  const installUpdate = async () => {
    if (!window.confirm("Installera senaste TrainMeet TKL och starta om terminalvyn?")) return;
    setUpdating(true);
    setUpdateStatus("Uppdaterar från GitHub …");
    try {
      await startTerminalUpdate();
      for (let attempt = 0; attempt < 180; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 2000));
        try {
          const status = await checkTerminalUpdate();
          setUpdateStatus(status.message);
          if (status.status === "complete") {
            window.location.reload();
            return;
          }
          if (status.status === "failed") {
            setUpdateStatus(status.message);
            setUpdating(false);
            return;
          }
        } catch {
          // The local terminal service is briefly unavailable while files are replaced.
        }
      }
      setUpdateStatus("Uppdateringen tar längre tid än väntat. Terminalen försöker ansluta igen automatiskt.");
      setUpdating(false);
    } catch {
      setUpdating(false);
      setUpdateStatus("Uppdateringen kunde inte startas.");
    }
  };
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
            <button type="button" className="reconfigure-button" onClick={onReconfigure}>Kör första installationen igen</button>
            <div className="terminal-update-card">
              <span className="micro-heading">Programvara</span>
              <p>{updateStatus || "Kontrollerar version …"}</p>
              {updateAvailable && <button type="button" onClick={() => { void installUpdate(); }} disabled={updating}>{updating ? "Installerar …" : "Installera uppdatering"}</button>}
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
            <div className="active-operator-card"><UserRound /><span><strong>{shift.operator_name}</strong><small>Trafikpass startat {new Date(shift.started_at).toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" })}</small></span></div>
            <label className="handover-note"><span>Överlämningsanteckning</span><textarea value={handoverNote} onChange={(event) => setHandoverNote(event.target.value)} placeholder="Valfri information till nästa operatör" rows={3} /></label>
            {shiftError && <p className="setup-message is-error">{shiftError}</p>}
            <button type="button" disabled={finishingShift} onClick={() => { setFinishingShift(true); setShiftError(""); void onFinishShift("handover", handoverNote).catch((error) => { setShiftError(error instanceof Error ? error.message : "Överlämningen misslyckades."); setFinishingShift(false); }); }}>Lämna över stationen</button>
            <button type="button" className="danger-menu-action" disabled={finishingShift} onClick={() => { setFinishingShift(true); setShiftError(""); void onFinishShift("closed", handoverNote).catch((error) => { setShiftError(error instanceof Error ? error.message : "Trafikpasset kunde inte avslutas."); setFinishingShift(false); }); }}>Avsluta trafikpasset</button>
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
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null);
  const [tklContext, setTklContext] = useState<TklContext | null>(null);
  const [runtimeError, setRuntimeError] = useState(false);
  const [stationId, setStationId] = useState<string | null>(null);
  const [movementState, setMovementState] = useState<Record<string, LocalMovementState>>({});
  const [selectedTrain, setSelectedTrain] = useState<string | null>(null);
  const [freightMode, setFreightMode] = useState(false);
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [receipt, setReceipt] = useState<string | null>(null);
  const [finishedShift, setFinishedShift] = useState<{ shift: TklShift; status: "handover" | "closed" } | null>(null);
  const [busyLineId, setBusyLineId] = useState<string | null>(null);
  const [theme, setTheme] = useState<Theme>(() => (window.localStorage.getItem("trainmeet-tkl.theme") as Theme) || "light");
  const firstLoad = useRef(true);

  useEffect(() => {
    void loadTerminalConfig().then(setTerminalConfig);
  }, []);

  useEffect(() => {
    if (!terminalConfig?.configured) return;
    if (new URLSearchParams(window.location.search).get("demo") === "1") {
      setAuthStatus({ authenticated: true, access_mode: "local", username: "Demooperatör", password_configured: true, must_change_password: false });
      return;
    }
    void loadAuthStatus().then(setAuthStatus).catch(() => {
      setAuthStatus({ authenticated: false, access_mode: window.location.port === "8790" ? "terminal" : "external", username: "admin", password_configured: true, must_change_password: false });
    });
  }, [terminalConfig]);

  useEffect(() => {
    if (!terminalConfig?.configured || !authStatus?.authenticated) return undefined;
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
  }, [terminalConfig, authStatus]);

  useEffect(() => {
    if (!runtime || !stationId || !authStatus?.authenticated) return undefined;
    let active = true;
    const refreshContext = async () => {
      if (runtime.source === "demo") {
        if (!active) return;
        setTklContext((current) => current ?? {
          protocol_version: 1,
          publication_id: runtime.snapshot.publication_id,
          meet: runtime.snapshot.meet,
          active_day: runtime.snapshot.active_day,
          station: runtime.snapshot.stations.find((station) => station.id === stationId) ?? runtime.snapshot.stations[0],
          terminal: { client_id: "demo", display_name: terminalConfig?.terminal_name || "Demo", kind: "demo" },
          preflight: {
            server_online: true,
            clock_configured: true,
            clock_running: true,
            track_count: stationTracks(runtime.snapshot, stationId).length,
            connection_count: runtime.snapshot.connections.filter((connection) => connection.station_a_id === stationId || connection.station_b_id === stationId).length,
            train_count: runtime.snapshot.trains.filter((train) => train.station_id === stationId).length,
            open_connection_count: runtime.snapshot.connection_states.filter((state) => state.state !== "free").length,
          },
          shift: null,
          previous_shift: null,
          movements: {},
          connection_states: runtime.snapshot.connection_states,
        });
        return;
      }
      try {
        const context = await loadTklContext(stationId);
        if (!active) return;
        setTklContext(context);
        setMovementState(Object.fromEntries(Object.entries(context.movements).map(([key, value]) => [key, {
          arrival: value.arrival,
          departure: value.departure,
          actualTrack: value.actualTrack || undefined,
          lineRequest: "none",
        }])));
      } catch (error) {
        if (active && error instanceof Error && /401|inloggning|authentication|behörighet/i.test(error.message)) {
          setAuthStatus((current) => current ? { ...current, authenticated: false } : current);
        }
      }
    };
    void refreshContext();
    const timer = window.setInterval(refreshContext, 3000);
    return () => { active = false; window.clearInterval(timer); };
  }, [runtime?.snapshot.publication_id, runtime?.source, stationId, authStatus?.authenticated, terminalConfig?.terminal_name]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem("trainmeet-tkl.theme", theme);
  }, [theme]);

  if (!terminalConfig) return <LoadingView />;
  if (!terminalConfig.configured) return <SetupView onComplete={(config, snapshot, auth) => {
    setTerminalConfig(config);
    setAuthStatus(auth);
    setRuntime({ snapshot, source: "server", connected: true });
    setStationId(config.station_id);
  }} />;
  if (!authStatus) return <LoadingView />;
  if (!authStatus.authenticated) return <AuthenticationView status={authStatus} terminalConfig={terminalConfig} onAuthenticated={setAuthStatus} onReconfigure={() => { void resetTerminalConfig().then(() => window.location.reload()); }} />;
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

  const connectionForTrain = (train: TrainRow, direction: "arrival" | "departure") => {
    const neighbors = routeNeighbors(snapshot, train);
    const neighbor = direction === "departure" ? neighbors.to : neighbors.from;
    if (!neighbor) return undefined;
    return snapshot.connections.find((connection) => (
      (connection.station_a_id === station.id && connection.station_b_id === neighbor.id)
      || (connection.station_b_id === station.id && connection.station_a_id === neighbor.id)
    ));
  };
  const stateFor = (train: TrainRow) => {
    const saved = movementState[movementKey(train)] ?? emptyMovement();
    const connection = connectionForTrain(train, "departure");
    const line = connection ? tklContext?.connection_states.find((state) => state.id === connection.id) : undefined;
    if (!line || line.train_number !== train.train_number || line.from_station_id !== station.id) return saved;
    if (line.state === "requested") return { ...saved, lineRequest: "pending" as const };
    if (line.state === "reserved" || line.state === "occupied") return { ...saved, lineRequest: "confirmed" as const };
    return saved;
  };
  const activeTrains = trains.filter((train) => stateFor(train).departure !== "departed");
  const archivedTrains = trains.filter((train) => stateFor(train).departure === "departed");
  const now = formatClock(snapshot.clock.time);

  if (!tklContext) return <LoadingView />;

  const startShift = async (operatorName: string, takeOver: boolean) => {
    if (runtime.source === "demo") {
      const now = new Date().toISOString();
      setTklContext((current) => current ? { ...current, shift: { shift_id: `demo-${Date.now()}`, operator_name: operatorName, terminal_name: terminalConfig.terminal_name, status: "active", started_at: now, updated_at: now } } : current);
      return;
    }
    const shift = await startTklShift({ station_id: stationId, operator_name: operatorName, terminal_name: terminalConfig.terminal_name, take_over: takeOver });
    setTklContext((current) => current ? { ...current, shift } : current);
  };

  if (finishedShift) return <ShiftFinishedView station={station} shift={finishedShift.shift} status={finishedShift.status} completedCount={archivedTrains.length} onContinue={() => { setFinishedShift(null); setTklContext((current) => current ? { ...current, shift: null } : current); }} />;
  if (!tklContext.shift) return <ShiftStartView context={tklContext} terminalName={terminalConfig.terminal_name} onStart={startShift} />;

  const selectStation = (nextStationId: string) => {
    setStationId(nextStationId);
    setSelectedTrain(null);
    window.localStorage.setItem("trainmeet-tkl.station-id", nextStationId);
    setOverlay(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const assignStation = async (nextStationId: string) => {
    const nextStation = snapshot.stations.find((candidate) => candidate.id === nextStationId);
    if (!nextStation) return;
    const { configured: _configured, ...current } = terminalConfig;
    const saved = await saveTerminalConfig({
      ...current,
      station_id: nextStation.id,
      station_name: nextStation.name,
    });
    setTerminalConfig(saved);
    selectStation(nextStationId);
  };

  const selectTrain = (trainNumber: string) => {
    setSelectedTrain(trainNumber);
    const row = allStationTrains.find((train) => train.train_number === trainNumber);
    if (!row) return;
    window.requestAnimationFrame(() => {
      document.getElementById(`train-${row.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  };

  const applyMovement = async (train: TrainRow, key: string, next: LocalMovementState) => {
    const previous = movementState[key] ?? emptyMovement();
    setMovementState((current) => ({ ...current, [key]: next }));
    const eventType = next.departure !== previous.departure
      ? `departure_${next.departure}`
      : next.arrival !== previous.arrival
        ? `arrival_${next.arrival}`
        : "track_changed";
    try {
      if (runtime.source !== "demo") {
        const departureConnection = connectionForTrain(train, "departure");
        const arrivalConnection = connectionForTrain(train, "arrival");
        if (next.departure === "ready" && previous.departure !== "ready" && snapshot.meet.default_dispatch_mode === "direct" && departureConnection) {
          const line = await performTklLineAction({ station_id: station.id, connection_id: departureConnection.id, train_number: train.train_number, action: "request" });
          setTklContext((current) => current ? { ...current, connection_states: current.connection_states.map((state) => state.id === line.id ? line : state) } : current);
        }
        if (next.departure === "departed" && previous.departure !== "departed" && departureConnection) {
          const line = await performTklLineAction({ station_id: station.id, connection_id: departureConnection.id, train_number: train.train_number, action: "depart" });
          setTklContext((current) => current ? { ...current, connection_states: current.connection_states.map((state) => state.id === line.id ? line : state) } : current);
        }
        if (next.arrival === "arrived" && previous.arrival !== "arrived" && arrivalConnection) {
          const currentLine = tklContext?.connection_states.find((state) => state.id === arrivalConnection.id);
          if (currentLine?.state === "occupied" && currentLine.train_number === train.train_number) {
            const line = await performTklLineAction({ station_id: station.id, connection_id: arrivalConnection.id, train_number: train.train_number, action: "arrive" });
            setTklContext((current) => current ? { ...current, connection_states: current.connection_states.map((state) => state.id === line.id ? line : state) } : current);
          }
        }
        await updateTklMovement({
          station_id: station.id,
          movement_id: train.id,
          arrival: next.arrival,
          departure: next.departure,
          actual_track: next.actualTrack || train.track,
          event_type: eventType,
        });
      }
      if (next.departure === "departed" && previous.departure !== "departed") {
        setReceipt(`Tåg ${train.train_number} har avgått mot ${train.departure_to || "nästa station"}.`);
        window.setTimeout(() => setReceipt(null), 6000);
      } else if (next.arrival === "arrived" && previous.arrival !== "arrived" && !train.departure_time) {
        setReceipt(`Tåg ${train.train_number} har ankommit till ${station.name}.`);
        window.setTimeout(() => setReceipt(null), 6000);
      }
    } catch (error) {
      setMovementState((current) => ({ ...current, [key]: previous }));
      setReceipt(error instanceof Error ? error.message : "Tågrörelsen kunde inte sparas.");
      throw error;
    }
  };

  const requestLineForTrain = async (train: TrainRow): Promise<"pending" | "confirmed"> => {
    const connection = connectionForTrain(train, "departure");
    if (!connection) throw new Error("Tågets nästa sträcka kunde inte bestämmas.");
    if (runtime.source === "demo") return snapshot.meet.default_dispatch_mode === "direct" ? "confirmed" : "pending";
    const line = await performTklLineAction({ station_id: station.id, connection_id: connection.id, train_number: train.train_number, action: "request" });
    setTklContext((current) => current ? { ...current, connection_states: current.connection_states.map((state) => state.id === line.id ? line : state) } : current);
    return line.state === "reserved" ? "confirmed" : "pending";
  };

  const handleLineCase = async (lineState: RuntimeSnapshot["connection_states"][number], action: "accept" | "reject" | "cancel" | "arrive") => {
    setBusyLineId(lineState.id);
    try {
      if (runtime.source === "demo") {
        setTklContext((current) => current ? { ...current, connection_states: current.connection_states.map((state) => state.id === lineState.id ? { ...state, state: action === "accept" ? "reserved" : "free" } : state) } : current);
        return;
      }
      const line = await performTklLineAction({ station_id: station.id, connection_id: lineState.id, train_number: lineState.train_number || "", action });
      setTklContext((current) => current ? { ...current, connection_states: current.connection_states.map((state) => state.id === line.id ? line : state) } : current);
      if (action === "arrive" && lineState.train_number) {
        const movement = activeTrains.find((train) => train.train_number === lineState.train_number && train.arrival_time);
        if (movement) {
          const key = movementKey(movement);
          const next = { ...stateFor(movement), arrival: "arrived" as const };
          await updateTklMovement({ station_id: station.id, movement_id: movement.id, arrival: next.arrival, departure: next.departure, actual_track: next.actualTrack || movement.track, event_type: "arrival_arrived" });
          setMovementState((current) => ({ ...current, [key]: next }));
        }
        setReceipt(`Tåg ${lineState.train_number} har ankommit till ${station.name}. Sträckan är fri.`);
      } else if (action === "accept") {
        setReceipt(`Klarering beviljad för tåg ${lineState.train_number || ""}.`);
      } else if (action === "reject") {
        setReceipt(`Klareringen för tåg ${lineState.train_number || ""} nekades.`);
      }
      window.setTimeout(() => setReceipt(null), 6000);
    } finally {
      setBusyLineId(null);
    }
  };

  const hasStartedMovement = (train: TrainRow) => {
    const state = stateFor(train);
    return state.arrival !== "none" || state.departure !== "none" || state.lineRequest !== "none";
  };
  const untouchedTrains = activeTrains.filter((train) => !hasStartedMovement(train));
  const recentlyDue = untouchedTrains.filter((train) => train.sort_time <= now).slice(-3);
  const nextScheduled = untouchedTrains.filter((train) => train.sort_time > now).slice(0, 8);
  const focusIds = new Set([
    ...activeTrains.filter(hasStartedMovement).map((train) => train.id),
    ...recentlyDue.map((train) => train.id),
    ...nextScheduled.map((train) => train.id),
  ]);
  const selectedMovement = activeTrains.find((train) => train.train_number === selectedTrain);
  if (selectedMovement) focusIds.add(selectedMovement.id);
  const focusTrains = activeTrains.filter((train) => focusIds.has(train.id));
  const focusBeforeNow = focusTrains.filter((train) => train.sort_time <= now);
  const focusAfterNow = focusTrains.filter((train) => train.sort_time > now);
  const laterTrains = activeTrains.filter((train) => !focusIds.has(train.id));

  const renderTrainCard = (train: TrainRow, defaultExpanded = false) => {
    const key = movementKey(train);
    return (
      <TrainCard
        key={train.id}
        snapshot={snapshot}
        train={train}
        movement={movementState[key] ?? emptyMovement()}
        availableTracks={tracks}
        defaultExpanded={defaultExpanded}
        freightMode={freightMode}
        selected={selectedTrain === train.train_number}
        actionsDisabled={!runtime.connected && source !== "demo"}
        onSelect={setSelectedTrain}
        onMovementChange={(next) => applyMovement(train, key, next)}
        onLineRequest={() => requestLineForTrain(train)}
      />
    );
  };

  return (
    <div className="app-background">
      <main className="app-shell">
        {receipt && <div className="operation-receipt" role="status"><CircleCheckBig /><span>{receipt}</span><button type="button" onClick={() => setReceipt(null)} aria-label="Stäng"><X /></button></div>}
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
            onStationSelect={() => undefined}
          />
        </div>

        <AttentionQueue snapshot={snapshot} station={station} context={tklContext} busyId={busyLineId} onAction={handleLineCase} />

        <section className="train-list" aria-label="Tågrörelser">
          {activeTrains.length === 0 && (
            <div className="empty-state">
              <TrainFront />
              <strong>Inga tågrörelser</strong>
              <span>{freightMode ? "Det finns inga godståg på stationen." : "Stationen saknar tågrörelser för aktiv dag."}</span>
            </div>
          )}

          {focusTrains.length > 0 && (
            <div className="movement-section" aria-label="Aktuella tågrörelser">
              <div className="movement-section-heading">
                <div>
                  <strong>Aktuellt på stationen</strong>
                  <span>Pågående ärenden och de närmaste tågen</span>
                </div>
                <span>{focusTrains.length}</span>
              </div>
              {focusBeforeNow.map((train, index) => renderTrainCard(train, index === 0 && source === "demo"))}
              <NowMarker />
              {focusAfterNow.map((train, index) => renderTrainCard(train, focusBeforeNow.length === 0 && index === 0 && source === "demo"))}
            </div>
          )}

          {laterTrains.length > 0 && (
            <details className="schedule-section">
              <summary>
                <span>
                  <strong>Hela dagens tidtabell</strong>
                  <small>Övriga tågrörelser i tidsordning</small>
                </span>
                <span>{laterTrains.length}</span>
              </summary>
              <div className="schedule-content">
                {laterTrains.map((train) => renderTrainCard(train))}
              </div>
            </details>
          )}

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
          onStationChange={(nextStationId) => { void assignStation(nextStationId); }}
          onReconfigure={() => { void resetTerminalConfig().then(() => window.location.reload()); }}
          shift={tklContext.shift}
          onFinishShift={async (status, note) => {
            const activeShift = tklContext.shift;
            if (!activeShift) return;
            if (runtime.source !== "demo") {
              await finishTklShift({ station_id: station.id, shift_id: activeShift.shift_id, status, note });
            }
            setOverlay(null);
            setFinishedShift({ shift: activeShift, status });
          }}
        />
      )}
    </div>
  );
}
