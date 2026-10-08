import { t, locale } from "./i18n";
import { authenticatedMessage } from "./auth-message";
import { accessLost } from "./access-lost";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  House,
  Check,
  CircleCheckBig,
  Clock3,
  Gamepad2,
  KeyRound,
  LogIn,
  LogOut,
  MapPin,
  Menu,
  MessageCircle,
  Package,
  RefreshCw,
  Server,
  ShieldCheck,
  TrainFront,
  UserRound,
  Users,
  Wifi,
  X,
} from "lucide-react";
import {
  APIError,
  canAdminister,
  changePassword,
  createOwner,
  deleteUser,
  inspectServer,
  inviteUser,
  isHostedBrowser,
  isDemoTerminal,
  isManagedBrowser,
  checkTerminalUpdate,
  connectWifi,
  discoverServers,
  finishTklShift,
  listUsers,
  loadAuthStatus,
  loadRuntime,
  loadSession,
  loadTerminalConfig,
  loadTklContext,
  loadWifiNetworks,
  loginAdmin,
  mayOperate,
  noAccounts,
  pairTerminal,
  performTklLineAction,
  redeemInvitation,
  reissueInvitation,
  resetTerminalConfig,
  saveTerminalConfig,
  signIn,
  signOut,
  startTklShift,
  startTerminalUpdate,
  updateTklMovement,
  updateUser,
  type AccountRole,
  type AccountUser,
  type AuthStatus,
  type RuntimeResult,
  type SessionStatus,
  type TerminalConfig,
  type TklContext,
  type TklShift,
} from "./api";
import { demoStations } from "./demo";
import { CodeBoxes } from "./components/CodeBoxes";
import { StationDiagram } from "./components/StationDiagram";
import { TrainCard } from "./components/TrainCard";
import { DEVIATION_LEVELS, DEVIATION_LEVEL_KEY, changeTracker, clockSeconds, deviationLevel, deviationView, trainLive } from "./trainLive";
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
type UiMessage = string | { source: string; values: Record<string, string | number> };
const messageText = (message: UiMessage) => typeof message === "string" ? t(message) : t(message.source, message.values);

function TrainMeetLogo() {
  return <img className="trainmeet-logo" src="./trainmeet-logo.png" alt={t("TrainMeet")} />;
}

const emptyMovement = (): LocalMovementState => ({
  arrival: "none",
  departure: "none",
  lineRequest: "none",
});

function LoadingView() {
  return (
    <main className="loading-view">
      <div className="loading-mark"><TrainMeetLogo /></div>
      <h1>{t("TrainMeet TKL")}</h1>
      <p>{t("Hämtar station och tidtabell…")}</p>
    </main>
  );
}

function SetupView({ onComplete }: { onComplete: (config: TerminalConfig, snapshot: RuntimeSnapshot, auth: AuthStatus) => void }) {
  const hosted = isDemoTerminal();
  const [serverUrl, setServerUrl] = useState(() => (
    window.location.port === "8790" ? "http://trainmeet.local:8787" : window.location.origin
  ));
  const [terminalName, setTerminalName] = useState("");
  const [orientation, setOrientation] = useState<TerminalConfig["orientation"]>("portrait");
  const [snapshot, setSnapshot] = useState<RuntimeSnapshot | null>(null);
  const [stationId, setStationId] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<UiMessage>("Ange adressen till TrainMeet Server på det lokala nätverket.");
  const [messageKind, setMessageKind] = useState<"notice" | "success" | "error">("notice");
  const [discoveredServers, setDiscoveredServers] = useState<Array<{ name: string; url: string }>>([]);
  const [wifiNetworks, setWifiNetworks] = useState<Array<{ ssid: string; connected: boolean; signal: number; secured: boolean }>>([]);
  const [wifiSsid, setWifiSsid] = useState("");
  const [wifiPassword, setWifiPassword] = useState("");
  const [wifiMessage, setWifiMessage] = useState<UiMessage>("");
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [pairingCode, setPairingCode] = useState("");

  const scanWifi = async () => {
    setWifiMessage("Söker efter Wi-Fi …");
    const networks = await loadWifiNetworks();
    setWifiNetworks(networks);
    const connected = networks.find((network) => network.connected);
    if (connected) {
      setWifiSsid(connected.ssid);
      setWifiMessage({source: "Ansluten till {name}.", values: {name: connected.ssid}});
    } else {
      setWifiMessage(networks.length ? "Välj nätverk och ange lösenord." : "Inga Wi-Fi-nätverk hittades. Ethernet kan fortfarande användas.");
    }
  };

  const joinWifi = async () => {
    if (!wifiSsid) return;
    setBusy(true);
    setWifiMessage({source: "Ansluter till {name} …", values: {name: wifiSsid}});
    try {
      await connectWifi(wifiSsid, wifiPassword);
      setWifiPassword("");
      setWifiMessage({source: "Ansluten till {name}.", values: {name: wifiSsid}});
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
      setMessage({source: "Hittade {name}. Tryck Anslut för att läsa träffen.", values: {name: servers[0].name}});
      setMessageKind("success");
    } else if (servers.length > 1) {
      setMessage({source: "Hittade {count} TrainMeet-servrar. Välj en och anslut.", values: {count: servers.length}});
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
      setMessage({source: "Hittade {name} med {count} stationer.", values: {name: next.meet.name, count: next.stations.length}});
      setMessageKind("success");
      try {
        const status = await loadAuthStatus();
        setAuth(status);
        setUsername("");
      } catch (error) {
        if (hosted) throw error;
        setAuth({ authenticated: false, access_mode: "external", username: "", password_configured: true, must_change_password: false });
      }
    } catch (error) {
      setSnapshot(null);
      setMessage(error instanceof Error ? error.message : "Servern kunde inte nås. Kontrollera adress, nätverk och att TrainMeet Server är igång.");
      setMessageKind("error");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => { if (hosted) void connect(); }, []);

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
      if (!isDemoTerminal()) window.localStorage.setItem("trainmeet-tkl.station-id", stationId);
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
        <div className="setup-brand"><TrainMeetLogo /><span>{t("TrainMeet TKL Terminal")}</span></div>
        {hosted && <a href="/#workspaces">{t("Byt arbetsyta")}</a>}
        <span className="micro-heading">{t("Första starten")}</span>
        <h1>{t("Koppla terminalen till stationen")}</h1>
        <p className="setup-intro">{t("Valet sparas i apparaten. Efter nästa omstart öppnas TKL-vyn direkt på den valda stationen.")}</p>

        {!hosted && <div className="setup-progress" aria-label={t("Installationens steg")}>
          <span className="is-complete"><b>1</b>{t("Anslut")}</span>
          <span className={snapshot ? "is-complete" : ""}><b>2</b>{t("Logga in")}</span>
          <span className={auth?.authenticated ? "is-complete" : ""}><b>3</b>{t("Träff")}</span>
          <span className={stationId && auth?.authenticated ? "is-complete" : ""}><b>4</b>{t("Station")}</span>
        </div>}
        {hosted && <p className="setup-intro">{t("Fristående demo med två övningsstationer. Inget skickas till trafikspelet.")}</p>}

        <div className="setup-fields">
          {!hosted && <>
          <details className="wifi-setup">
            <summary>{t("Wi-Fi och nätverk")}</summary>
            <div className="wifi-setup-content">
              <button type="button" className="discover-button" onClick={() => { void scanWifi(); }} disabled={busy}><RefreshCw /> {t("Sök Wi-Fi")}</button>
              {wifiNetworks.length > 0 && (
                <label>
                  <span>{t("Nätverk")}</span>
                  <select value={wifiSsid} onChange={(event) => setWifiSsid(event.target.value)}>
                    <option value="">{t("Välj Wi-Fi …")}</option>
                    {wifiNetworks.map((network) => <option key={network.ssid} value={network.ssid}>{network.connected ? "✓ " : ""}{network.ssid} · {network.signal}%{network.secured ? ` · ${t("låst")}` : ""}</option>)}
                  </select>
                </label>
              )}
              {wifiSsid && !wifiNetworks.find((network) => network.ssid === wifiSsid)?.connected && (
                <div className="wifi-password-row">
                  <input type="password" value={wifiPassword} onChange={(event) => setWifiPassword(event.target.value)} placeholder={t("Wi-Fi-lösenord")} autoComplete="new-password" />
                  <button type="button" onClick={() => { void joinWifi(); }} disabled={busy}>{t("Anslut")}</button>
                </div>
              )}
              {wifiMessage && <p>{messageText(wifiMessage)}</p>}
            </div>
          </details>
          <label>
            <span>{t("TrainMeet Server")}</span>
            <div className="server-field">
              <input value={serverUrl} onChange={(event) => setServerUrl(event.target.value)} placeholder="http://trainmeet.local:8787" />
              <button type="button" onClick={connect} disabled={busy || !serverUrl.trim()}><Server /> {t("Anslut")}</button>
            </div>
          </label>
          <button type="button" className="discover-button" onClick={discover} disabled={busy}><RefreshCw /> {t("Sök automatiskt på nätverket")}</button>
          {discoveredServers.length > 1 && (
            <div className="discovered-servers">
              {discoveredServers.map((server) => (
                <button type="button" key={server.url} onClick={() => setServerUrl(server.url)} className={serverUrl === server.url ? "is-selected" : ""}>
                  <strong>{server.name}</strong><span>{server.url}</span>
                </button>
              ))}
            </div>
          )}
          </>}
          {hosted && !snapshot && <button type="button" onClick={connect} disabled={busy}>{t("Försök igen")}</button>}

          {snapshot && (
            <>
              {!hosted && !auth?.authenticated && (
                <section className="setup-step-card">
                  <div className="setup-step-heading"><LogIn /><span><strong>{auth?.access_mode === "terminal" ? t("Parkoppla terminalen") : t("Logga in")}</strong><small>{auth?.access_mode === "terminal" ? t("Använd anslutningskoden från TrainMeet Server.") : t("Extern anslutning kräver serverns administratörskonto.")}</small></span></div>
                  {auth?.access_mode === "terminal" ? (
                    <CodeBoxes value={pairingCode} onChange={setPairingCode} label={t("Anslutningskod")} />
                  ) : (
                    <div className="login-fields">
                      <input value={username} onChange={(event) => setUsername(event.target.value)} placeholder={t("E-postadress")} type="email" autoComplete="username" />
                      <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder={t("Lösenord")} autoComplete="current-password" />
                    </div>
                  )}
                  <button type="button" className="setup-auth-button" onClick={() => { void authenticate(); }} disabled={busy || (auth?.access_mode === "terminal" ? !pairingCode.trim() : !username.trim() || !password)}>{t("Fortsätt")}</button>
                </section>
              )}
              {auth?.authenticated && (
                <>
                  <section className="setup-step-card is-success">
                    <div className="setup-step-heading"><ShieldCheck /><span><strong>{t(hosted ? "Demo" : "Ansluten")}</strong><small>{hosted ? t("Fristående demo med två övningsstationer. Inget skickas till trafikspelet.") : messageText(authenticatedMessage(auth))}</small></span></div>
                  </section>
                  <section className="meet-selection">
                    <span className="micro-heading">{t("Aktiv träff")}</span>
                    <div className="meet-found"><Check /><span><strong>{snapshot.meet.name}</strong><small>{snapshot.active_day} · {snapshot.stations.length} {t("stationer")}</small></span></div>
                  </section>
                  <section className="station-selection">
                    <span className="micro-heading">{t("Välj station")}</span>
                    <div className="station-choice-grid">
                      {snapshot.stations.map((station) => {
                        const movements = snapshot.trains.filter((train) => train.station_id === station.id).length;
                        const connections = snapshot.connections.filter((connection) => connection.station_a_id === station.id || connection.station_b_id === station.id).length;
                        return (
                          <button type="button" key={station.id} className={stationId === station.id ? "is-selected" : ""} onClick={() => { setStationId(station.id); setTerminalName(`${station.code} TKL 1`); }}>
                            <b>{station.code}</b><span><strong>{station.name}</strong><small>{movements} {t("tågrörelser ·")} {connections} {t("anslutningar")}</small></span>{stationId === station.id && <Check />}
                          </button>
                        );
                      })}
                    </div>
                  </section>
                </>
              )}
              {auth?.authenticated && (
              <label>
                <span>{t("Terminalens namn")}</span>
                <input value={terminalName} onChange={(event) => setTerminalName(event.target.value)} placeholder={t("CDA TKL 1")} />
              </label>
              )}
              {auth?.authenticated && (
              <fieldset>
                <legend>{t("Skärm")}</legend>
                <div className="orientation-options">
                  <button type="button" className={orientation === "portrait" ? "is-selected" : ""} onClick={() => setOrientation("portrait")}>{t("Stående")}</button>
                  <button type="button" className={orientation === "landscape" ? "is-selected" : ""} onClick={() => setOrientation("landscape")}>{t("Liggande")}</button>
                </div>
              </fieldset>
              )}
            </>
          )}
        </div>

        <p className={`setup-message is-${messageKind}`}>{messageText(message)}</p>
        {snapshot && auth?.authenticated && <button type="button" className="setup-finish" onClick={finish} disabled={busy || !stationId || !terminalName.trim()}><MapPin /> {t("Bekräfta station och fortsätt")}</button>}
      </div>
    </main>
  );
}

function UnavailableView({ onRetry }: { onRetry: () => void }) {
  return (
    <main className="loading-view">
      <div className="loading-mark is-offline"><Wifi /></div>
      <h1>{t("Ingen kontakt med TrainMeet Server")}</h1>
      <p>{t("Inga trafikåtgärder kan utföras innan servern svarar.")}</p>
      <button type="button" className="retry-button" onClick={onRetry}><RefreshCw /> {t("Försök igen")}</button>
    </main>
  );
}

const roleLabel = (role: AccountRole) => t(role === "owner" ? "Ägare" : role === "admin" ? "Administratör" : "Klarerare");

/** TKL's own sign-in: the address is the account. "Jag har en kod" is the
 *  invited person's first sign-in, and the way back for a forgotten password. */
function SignInForm({ onSignedIn }: { onSignedIn: (session: SessionStatus) => void }) {
  const [withCode, setWithCode] = useState(false);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<UiMessage>("");
  const ready = Boolean(email.trim() && password && (!withCode || (code.trim() && repeat)));
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!ready || busy) return;
    if (withCode && password !== repeat) { setMessage("Lösenorden är inte lika."); return; }
    setBusy(true);
    setMessage("");
    try {
      const next = withCode ? await redeemInvitation(email, code, password) : await signIn(email, password);
      // The form may stay on screen (a dispatcher signed in where an
      // administrator is needed): back to a plain sign-in, nothing kept.
      setWithCode(false);
      setCode("");
      setPassword("");
      setRepeat("");
      onSignedIn(next);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Inloggningen misslyckades.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="account-form" onSubmit={(event) => { void submit(event); }}>
      <div className="login-fields is-stacked">
        <input value={email} onChange={(event) => setEmail(event.target.value)} placeholder={t("E-postadress")} type="email" autoComplete="username" autoFocus />
        {withCode && <input className="account-code" value={code} onChange={(event) => setCode(event.target.value)} placeholder={t("Kod")} autoComplete="one-time-code" />}
        <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder={withCode ? t("Nytt lösenord") : t("Lösenord")} autoComplete={withCode ? "new-password" : "current-password"} />
        {withCode && <input type="password" value={repeat} onChange={(event) => setRepeat(event.target.value)} placeholder={t("Upprepa lösenordet")} autoComplete="new-password" />}
      </div>
      {message && <p className="setup-message is-error">{messageText(message)}</p>}
      <button type="submit" className="setup-finish" disabled={busy || !ready}><LogIn /> {busy ? t("Ansluter …") : withCode ? t("Välj ett nytt lösenord") : t("Logga in")}</button>
      <button type="button" className="text-action" onClick={() => { setWithCode(!withCode); setMessage(""); }}>{withCode ? t("Till inloggningen") : t("Jag har en kod")}</button>
    </form>
  );
}

function SignInView({ session, terminalConfig, admin, onSignedIn }: {
  session: SessionStatus;
  terminalConfig: TerminalConfig | null;
  admin?: boolean;
  onSignedIn: (session: SessionStatus) => void;
}) {
  return (
    <main className="setup-view auth-view">
      <div className="setup-card auth-card">
        <div className="setup-brand"><TrainMeetLogo /><span>{t("TrainMeet TKL")}</span></div>
        <span className="micro-heading">{terminalConfig?.station_name || terminalConfig?.terminal_name || t("TrainMeet TKL Terminal")}</span>
        <h1>{admin ? t("Logga in som administratör") : t("Logga in för att fortsätta")}</h1>
        <p className="setup-intro">{admin ? t("Inställningarna kräver administratörsinloggning.") : t("TKL via webben kräver inloggning. Logga in med ditt konto för att använda ställverket.")}</p>
        {session.user && <p className="setup-message">{messageText({ source: "Inloggad som {name}.", values: { name: session.user.display_name } })} {roleLabel(session.user.role)}</p>}
        <SignInForm onSignedIn={onSignedIn} />
      </div>
    </main>
  );
}

/** The first account. Only when nobody can sign in yet, and only from the
 *  computer running TKL or its network: the same window as on TrainMeet Server. */
function CreateOwnerForm({ onCreated }: { onCreated: (session: SessionStatus) => void }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<UiMessage>("");
  const ready = Boolean(name.trim() && email.trim() && password && repeat);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!ready || busy) return;
    if (password !== repeat) { setMessage("Lösenorden är inte lika."); return; }
    setBusy(true);
    setMessage("");
    try {
      onCreated(await createOwner({ display_name: name, email, password }));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Ägaren kunde inte skapas.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="account-form" onSubmit={(event) => { void submit(event); }}>
      <div className="login-fields is-stacked">
        <label><span>{t("Namn")}</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder={t("Ditt namn")} autoComplete="name" autoFocus /></label>
        <label><span>{t("E-postadress")}</span><input value={email} onChange={(event) => setEmail(event.target.value)} type="email" autoComplete="username" /></label>
        <label><span>{t("Lösenord")}</span><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" /></label>
        <label><span>{t("Upprepa lösenordet")}</span><input type="password" value={repeat} onChange={(event) => setRepeat(event.target.value)} autoComplete="new-password" /></label>
      </div>
      {message && <p className="setup-message is-error">{messageText(message)}</p>}
      <button type="submit" className="setup-finish" disabled={busy || !ready}><KeyRound /> {t("Skapa ägaren")}</button>
    </form>
  );
}

function CreateOwnerView({ session, terminalConfig, onCreated }: {
  session: SessionStatus;
  terminalConfig: TerminalConfig | null;
  onCreated: (session: SessionStatus) => void;
}) {
  return (
    <main className="setup-view auth-view">
      <div className="setup-card auth-card">
        <div className="setup-brand"><TrainMeetLogo /><span>{t("TrainMeet TKL")}</span></div>
        <span className="micro-heading">{terminalConfig?.terminal_name || t("Första starten")}</span>
        <h1>{t("Skapa ägaren")}</h1>
        <p className="setup-intro">{t("Ingen ägare finns än. Ägaren är den som lägger till och tar bort användare; en administratör sköter hela TKL men inte vilka som har tillgång.")}</p>
        {session.owner_setup_allowed
          ? <CreateOwnerForm onCreated={onCreated} />
          : <p className="setup-message is-error">{t("Ägaren skapas på datorn där TKL körs eller från dess lokala nätverk.")}</p>}
        <p className="setup-footnote">{t(session.at_the_machine
          ? "Ägaren bjuder sedan in fler under Inställningar → Användare. Operatören behöver inte logga in på den här datorn."
          : "Ägaren bjuder sedan in fler under Inställningar → Användare. När TKL körs via webben loggar alla in med sitt konto.")}</p>
      </div>
    </main>
  );
}

function PasswordForm() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [repeat, setRepeat] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<UiMessage>("");
  const [kind, setKind] = useState<"success" | "error">("error");
  const ready = Boolean(current && next && repeat);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!ready || busy) return;
    if (next !== repeat) { setKind("error"); setMessage("Lösenorden är inte lika."); return; }
    setBusy(true);
    try {
      await changePassword(current, next);
      setCurrent(""); setNext(""); setRepeat("");
      setKind("success"); setMessage("Lösenordet är bytt.");
    } catch (error) {
      setKind("error"); setMessage(error instanceof Error ? error.message : "Åtgärden gick inte att utföra");
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="account-form" onSubmit={(event) => { void submit(event); }}>
      <div className="login-fields is-stacked">
        <input type="password" value={current} onChange={(event) => setCurrent(event.target.value)} placeholder={t("Nuvarande lösenord")} autoComplete="current-password" />
        <input type="password" value={next} onChange={(event) => setNext(event.target.value)} placeholder={t("Nytt lösenord")} autoComplete="new-password" />
        <input type="password" value={repeat} onChange={(event) => setRepeat(event.target.value)} placeholder={t("Upprepa lösenordet")} autoComplete="new-password" />
      </div>
      {message && <p className={`setup-message is-${kind}`}>{messageText(message)}</p>}
      <button type="submit" className="secondary-action" disabled={busy || !ready}>{t("Spara lösenordet")}</button>
    </form>
  );
}

function AccountCard({ session, onSession }: { session: SessionStatus; onSession: (session: SessionStatus) => void }) {
  const [message, setMessage] = useState<UiMessage>("");
  if (!session.user) return null;
  const leave = async () => {
    try {
      onSession(await signOut());
    } catch {
      setMessage("Utloggningen misslyckades.");
    }
  };
  return (
    <div className="info-card account-card">
      <span className="micro-heading">{t("Mitt konto")}</span>
      <strong>{session.user.display_name}</strong>
      <p>{session.user.email} · {roleLabel(session.user.role)}</p>
      <details><summary>{t("Byt lösenord")}</summary><PasswordForm /></details>
      {message && <p className="setup-message is-error">{messageText(message)}</p>}
      <button type="button" className="reconfigure-button" onClick={() => { void leave(); }}><LogOut /> {t("Logga ut")}</button>
    </div>
  );
}

/** Inställningar → Användare. The owner invites with a one-time code and
 *  never sets anybody's password; an administrator can only look. */
function UsersPanel({ session }: { session: SessionStatus }) {
  const owner = session.user?.role === "owner";
  const [users, setUsers] = useState<AccountUser[]>([]);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<AccountRole>("operator");
  const [code, setCode] = useState<{ name: string; code: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<UiMessage>("");
  const [kind, setKind] = useState<"success" | "error">("success");
  const load = () => listUsers().then((result) => setUsers(result.users)).catch(() => { setKind("error"); setMessage("Användarna kunde inte läsas"); });
  useEffect(() => { void load(); }, []);
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setMessage("");
    try {
      await action();
      await load();
    } catch (error) {
      setKind("error");
      setMessage(error instanceof Error ? error.message : "Åtgärden gick inte att utföra");
    } finally {
      setBusy(false);
    }
  };
  const invite = (event: FormEvent) => {
    event.preventDefault();
    if (busy || !name.trim() || !email.trim()) return;
    void run(async () => {
      const result = await inviteUser({ display_name: name, email, role });
      setCode({ name: result.user.display_name, code: result.code });
      setName("");
      setEmail("");
      setKind("success");
      setMessage({ source: "{name} är inbjuden. Lämna över koden.", values: { name: result.user.display_name } });
    });
  };
  const reissue = (user: AccountUser) => run(async () => {
    const result = await reissueInvitation(user.user_id);
    setCode({ name: user.display_name, code: result.code });
  });
  const changeRole = (user: AccountUser, next: AccountRole) => run(async () => {
    await updateUser({ user_id: user.user_id, role: next });
    setKind("success");
    setMessage({ source: next === "owner" ? "{name} är nu ägare" : next === "admin" ? "{name} är nu administratör" : "{name} är nu klarerare", values: { name: user.display_name } });
  });
  const remove = (user: AccountUser) => {
    if (!window.confirm(t("Ta bort {name}?", { name: user.display_name }))) return;
    void run(async () => {
      await deleteUser(user.user_id);
      setKind("success");
      setMessage({ source: "{name} är borttagen", values: { name: user.display_name } });
    });
  };
  return (
    <section className="users-panel">
      <span className="micro-heading">{t("Användare")}</span>
      <ul className="user-list">
        {users.map((user) => (
          <li key={user.user_id} className="user-row">
            <div><strong>{user.display_name}</strong><small>{user.email}</small>{user.invitation_pending && <small className="is-pending">{t("Inbjuden — har inte valt lösenord")}</small>}</div>
            {owner && user.user_id !== session.user?.user_id ? (
              <div className="user-actions">
                <select aria-label={t("Roll")} value={user.role} disabled={busy} onChange={(event) => { void changeRole(user, event.target.value as AccountRole); }}>
                  <option value="owner">{t("Ägare")}</option>
                  <option value="admin">{t("Administratör")}</option>
                  <option value="operator">{t("Klarerare")}</option>
                </select>
                <button type="button" disabled={busy} onClick={() => { void reissue(user); }}>{t("Ny kod")}</button>
                <button type="button" className="is-danger" disabled={busy} onClick={() => remove(user)}>{t("Ta bort")}</button>
              </div>
            ) : <span className="role-chip">{roleLabel(user.role)}</span>}
          </li>
        ))}
      </ul>
      {code && (
        <div className="info-card account-code-card">
          <strong>{t("Ge koden till {name}", { name: code.name })}</strong>
          <p className="account-code-value">{code.code}</p>
          <p>{t("Koden gäller i sju dagar och kan bara användas en gång.")}</p>
        </div>
      )}
      {message && <p className={`setup-message is-${kind}`}>{messageText(message)}</p>}
      {owner && (
        <form className="account-form" onSubmit={invite}>
          <span className="micro-heading">{t("Lägg till en användare")}</span>
          <div className="login-fields is-stacked">
            <input value={name} onChange={(event) => setName(event.target.value)} placeholder={t("Namn")} autoComplete="off" />
            <input value={email} onChange={(event) => setEmail(event.target.value)} placeholder={t("E-postadress")} type="email" autoComplete="off" />
            <select aria-label={t("Roll")} value={role} onChange={(event) => setRole(event.target.value as AccountRole)}>
              <option value="operator">{t("Klarerare")}</option>
              <option value="admin">{t("Administratör")}</option>
              <option value="owner">{t("Ägare")}</option>
            </select>
          </div>
          <p className="setup-message">{t("Klarerare kan använda ställverket men inte ändra inställningarna. Administratörer sköter hela TKL men inte vilka som har tillgång.")}</p>
          <button type="submit" className="secondary-action" disabled={busy || !name.trim() || !email.trim()}><Users /> {t("Bjud in")}</button>
        </form>
      )}
    </section>
  );
}

function AuthenticationView({
  status,
  terminalConfig,
  session,
  onSession,
  onAuthenticated,
  onReconfigure,
}: {
  status: AuthStatus;
  terminalConfig: TerminalConfig;
  session: SessionStatus;
  onSession: (session: SessionStatus) => void;
  onAuthenticated: (status: AuthStatus) => void;
  onReconfigure: () => void;
}) {
  const [username, setUsername] = useState("");
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
        <div className="setup-brand"><TrainMeetLogo /><span>{t("TrainMeet TKL")}</span></div>
        {isHostedBrowser() && <a href="/#workspaces">{t("Byt arbetsyta")}</a>}
        <span className="micro-heading">{terminalConfig.station_name || terminalConfig.terminal_name}</span>
        <h1>{status.access_mode === "terminal" ? t("Parkoppla terminalen igen") : t("Logga in för att fortsätta")}</h1>
        <p className="setup-intro">{status.access_mode === "terminal" ? t("Terminalens tidigare behörighet gäller inte längre. Ange anslutningskoden från TrainMeet Server.") : t("Din station och terminalprofil finns kvar efter inloggningen.")}</p>
        {session.available && !session.configured ? (
          <>
            <p className="setup-message">{t("Ingen ägare finns än. Ägaren är den som lägger till och tar bort användare; en administratör sköter hela TKL men inte vilka som har tillgång.")}</p>
            <CreateOwnerForm onCreated={onSession} />
          </>
        ) : session.available && !canAdminister(session) ? (
          <>
            <p className="setup-message">{t("Parkoppling och terminalinställningar kräver administratörsinloggning.")}</p>
            <SignInForm onSignedIn={onSession} />
          </>
        ) : (
          <>
            <div className={status.access_mode === "terminal" ? "login-fields is-code" : "login-fields"}>
              {status.access_mode === "terminal" ? (
                <CodeBoxes value={pairingCode} onChange={setPairingCode} label={t("Anslutningskod")} />
              ) : (
                <>
                  <input value={username} onChange={(event) => setUsername(event.target.value)} placeholder={t("E-postadress")} type="email" autoComplete="username" />
                  <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder={t("Lösenord")} autoComplete="current-password" />
                </>
              )}
            </div>
            {message && <p className="setup-message is-error">{messageText(message)}</p>}
            <button type="button" className="setup-finish" onClick={() => { void submit(); }} disabled={busy || (status.access_mode === "terminal" ? !pairingCode.trim() : !username.trim() || !password)}><LogIn /> {busy ? t("Ansluter …") : t("Fortsätt")}</button>
            <button type="button" className="text-action" onClick={onReconfigure}>{t("Byt server eller station")}</button>
          </>
        )}
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
    { label: isDemoTerminal() ? "Fristående demo" : "TrainMeet Server", ok: context.preflight.server_online, detail: t(isDemoTerminal() ? "Demo" : "Ansluten") },
    { label: "Träffklocka", ok: context.preflight.clock_configured, detail: context.preflight.clock_running ? t("Går") : t("Står still") },
    { label: "Stationsspår", ok: context.preflight.track_count > 0, detail: t("{count} spår", {count: context.preflight.track_count}) },
    { label: "Anslutningar", ok: context.preflight.connection_count > 0, detail: t("{count} sträckor", {count: context.preflight.connection_count}) },
    { label: "Tidtabell", ok: context.preflight.train_count > 0, detail: t("{count} tågrörelser", {count: context.preflight.train_count}) },
  ];
  const start = async () => {
    setBusy(true);
    setError("");
    try {
      if (!isDemoTerminal()) window.localStorage.setItem("trainmeet-tkl.operator-name", operatorName.trim());
      await onStart(operatorName.trim(), Boolean(active));
    } catch (reason) {
      setError(t(reason instanceof Error ? reason.message : "Trafikpasset kunde inte startas."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="shift-start-view">
      <div className="shift-start-card">
        <div className="setup-brand"><TrainMeetLogo /><span>{t("TrainMeet TKL")}</span></div>
        <span className="micro-heading">{context.meet.name} · {context.active_day}</span>
        <h1>{t("Ta {station} i tjänst", {station: context.station.name})}</h1>
        <p className="setup-intro">{t("Kontrollera sammanhanget och starta ett trafikpass innan några tågrörelser hanteras.")}</p>
        {active && (
          <div className="active-shift-notice">
            <UserRound /><span><strong>{t("Pågående trafikpass")}</strong><small>{active.operator_name} {t("· startat")} {new Date(active.started_at).toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" })}</small></span>
          </div>
        )}
        {!active && context.previous_shift?.status === "handover" && context.previous_shift.handover_note && (
          <div className="active-shift-notice is-handover">
            <MessageCircle /><span><strong>{t("Från föregående operatör")}</strong><small>{context.previous_shift.handover_note}</small></span>
          </div>
        )}
        <div className="preflight-list">
          {checks.map((check) => <div key={check.label}><span className={check.ok ? "is-ok" : "is-warning"}>{check.ok ? <Check /> : <Clock3 />}</span><strong>{t(check.label)}</strong><small>{check.detail}</small></div>)}
        </div>
        <label className="operator-field"><span>{t("Operatör")}</span><input value={operatorName} onChange={(event) => setOperatorName(event.target.value)} placeholder={t("Ditt namn")} autoFocus /></label>
        <div className="shift-summary"><MapPin /><span><strong>{context.station.code} · {context.station.name}</strong><small>{terminalName} · {context.preflight.open_connection_count ? t("{count} pågående sträckor att ta över", {count: context.preflight.open_connection_count}) : t("Alla sträckor fria")}</small></span></div>
        {error && <p className="setup-message is-error">{error}</p>}
        <button type="button" className="setup-finish" disabled={busy || !operatorName.trim() || checks.some((check) => !check.ok && check.label !== "Träffklocka")} onClick={() => { void start(); }}><ShieldCheck /> {busy ? t("Startar …") : active ? t("Ta över trafikpasset") : t("Starta trafikpass")}</button>
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
        <h1>{status === "handover" ? t("Stationen är överlämnad") : t("Trafikpasset är avslutat")}</h1>
        <p className="setup-intro">{t("{name} hanterade {count} avslutade tågrörelser under det här terminalpasset.", {name: shift.operator_name, count: completedCount})}</p>
        <div className="shift-summary"><Clock3 /><span><strong>{new Date(shift.started_at).toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" })}–{new Date().toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" })}</strong><small>{status === "handover" ? t("Nästa operatör kan nu ta över.") : t("Stationen är inte längre bemannad i TKL.")}</small></span></div>
        <button type="button" className="setup-finish" onClick={onContinue}>{t("Till startsidan")}</button>
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
    <section className="attention-queue" aria-label={t("Kräver uppmärksamhet")}>
      <div className="attention-heading"><span><strong>{t("Kräver uppmärksamhet")}</strong><small>{cases.length} {t("aktiva trafikärenden")}</small></span></div>
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
              <div><span className="micro-heading">{neighbor?.code || t("STRÄCKA")}</span><strong>{t(label)}</strong><small>{t("Tåg")} {state.train_number || "?"} · {neighbor?.name || state.id}</small></div>
              <div className="attention-actions">
                {state.state === "requested" && !outgoing && <><button type="button" disabled={busyId === state.id} onClick={() => { void onAction(state, "accept"); }}>{t("Godkänn")}</button><button type="button" className="secondary" disabled={busyId === state.id} onClick={() => { void onAction(state, "reject"); }}>{t("Neka")}</button></>}
                {state.state === "requested" && outgoing && <button type="button" className="secondary" disabled={busyId === state.id} onClick={() => { void onAction(state, "cancel"); }}>{t("Återkalla")}</button>}
                {state.state === "occupied" && !outgoing && <button type="button" disabled={busyId === state.id} onClick={() => { void onAction(state, "arrive"); }}>{t("Bekräfta ankomst")}</button>}
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
  onHome,
}: {
  station: Station;
  snapshot: RuntimeSnapshot;
  source: RuntimeResult["source"];
  freightMode: boolean;
  onFreightToggle: () => void;
  onOverlay: (overlay: Overlay) => void;
  onHome: () => void;
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
        <button type="button" className="icon-button is-outlined" aria-label={t("Hem")} onClick={onHome}>
          <House />
        </button>
        <h1
          onPointerDown={beginAdminHold}
          onPointerUp={endAdminHold}
          onPointerCancel={endAdminHold}
          onPointerLeave={endAdminHold}
          title={t("Håll in stationsnamnet i fem sekunder för terminaladministration")}
        >
          <span className="station-name-long">{station.name}</span>
          <span className="station-name-short">{station.code}</span>
        </h1>
        <span className="clock-pill" title={t("Träffklocka, hastighet {speed}×", {speed: snapshot.clock.speed ?? 1})}>
          <Clock3 />
          {formatClock(snapshot.clock.time)}
        </span>
        <span className={`connection-indicator ${source !== "cache" ? "is-online" : "is-offline"}`} title={source === "demo" ? t("Fristående demo") : source === "server" ? t("Ansluten till TrainMeet Server") : t("Offline – senast kända läge")}>
          {source === "demo" ? <Gamepad2 /> : <Wifi />}
        </span>
        <button type="button" className="icon-button message-button" aria-label={t("Meddelanden")}>
          <MessageCircle />
          <span>1</span>
        </button>
        <button type="button" className="icon-button" aria-label={t("Meny")} onClick={() => onOverlay("menu")}>
          <Menu />
        </button>
      </header>
      <nav className="dispatcher-toolbar" aria-label={t("Verktyg")}>
        <button type="button" className={freightMode ? "is-freight" : ""} onClick={onFreightToggle}>
          {freightMode ? <Package /> : <TrainFront />}
          <span>{freightMode ? t("Gods") : "TKL"}</span>
        </button>
        <button type="button" onClick={() => onOverlay("tambox")}>
          <Gamepad2 />
          <span>{t("TMBox")}</span>
        </button>
      </nav>
    </>
  );
}

function NowMarker() {
  return <div className="now-marker" aria-label={t("Nu")}><span /></div>;
}

// Nivåernas namn och förklaringar, samma texter som serverns (textkatalogen synkas).
const LEVEL_NAMES: Record<number, string> = { 1: "Ingen markering", 2: "När det inträffar", 3: "Diskret", 4: "Fler", 5: "Allt" };
const LEVEL_HINTS: Record<number, string> = {
  1: "Bara tidtabellens tider, inget rött och ingen markering",
  2: "Raden lyser kort och får Nyss när något händer",
  3: "Dessutom förseningen i liten röd text från 5 min",
  4: "Röd bricka från 3 min, den nya tiden och för tidig avgång för persontåg",
  5: "Allt från 1 min, även för tidig ankomst och vid tågen på kartan",
};

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
  session,
  onSession,
  shift,
  onFinishShift,
  deviationOwn,
  onDeviationChange,
}: {
  deviationOwn: string;
  onDeviationChange: (level: string) => void;
  overlay: Exclude<Overlay, null>;
  onClose: () => void;
  snapshot: RuntimeSnapshot;
  station: Station;
  source: RuntimeResult["source"];
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
  onStationChange: (stationId: string) => void;
  onReconfigure: () => void;
  session: SessionStatus;
  onSession: (session: SessionStatus) => void;
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
    if (overlay !== "settings" || isManagedBrowser() || !canAdminister(session)) return;
    void checkTerminalUpdate().then((status) => {
      setUpdateAvailable(Boolean(status.supported && status.update_available));
      setUpdateStatus(status.check_error || (status.update_available
        ? t("Ny version {latest} finns. Installerad: {installed}.", { latest: status.latest_version ?? "", installed: status.installed_version ?? "" })
        : t("Installerad version {installed} är aktuell.", { installed: status.installed_version ?? "" })));
    }).catch(() => setUpdateStatus(t("Uppdatering hanteras av TrainMeet Server i det här körläget.")));
  }, [overlay, session]);

  const installUpdate = async () => {
    if (!window.confirm(t("Installera senaste TrainMeet TKL och starta om terminalvyn?"))) return;
    setUpdating(true);
    setUpdateStatus(t("Uppdaterar från GitHub …"));
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
      setUpdateStatus(t("Uppdateringen tar längre tid än väntat. Terminalen försöker ansluta igen automatiskt."));
      setUpdating(false);
    } catch {
      setUpdating(false);
      setUpdateStatus(t("Uppdateringen kunde inte startas."));
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
            <span className="micro-heading">{t("TrainMeet TKL")}</span>
            <h2>{overlay === "settings" ? t("Inställningar") : overlay === "tambox" ? "TMBox" : t("Meny")}</h2>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label={t("Stäng")}><X /></button>
        </div>

        {overlay === "settings" && session.available && !session.configured && (
          <div className="overlay-content form-stack">
            <p className="overlay-intro">{t("Ingen ägare finns än. Ägaren är den som lägger till och tar bort användare; en administratör sköter hela TKL men inte vilka som har tillgång.")}</p>
            <CreateOwnerForm onCreated={onSession} />
          </div>
        )}
        {overlay === "settings" && session.available && session.configured && !canAdminister(session) && (
          <div className="overlay-content form-stack">
            <p className="overlay-intro">{t("Inställningarna kräver administratörsinloggning.")}</p>
            {session.user && <p className="setup-message">{messageText({ source: "Inloggad som {name}.", values: { name: session.user.display_name } })} {roleLabel(session.user.role)}</p>}
            <SignInForm onSignedIn={onSession} />
          </div>
        )}
        {overlay === "settings" && canAdminister(session) && (
          <div className="overlay-content form-stack">
            <label>
              <span>{t("Station")}</span>
              <select disabled={isManagedBrowser()} value={station.id} onChange={(event) => onStationChange(event.target.value)}>
                {snapshot.stations.map((candidate) => <option value={candidate.id} key={candidate.id}>{candidate.name}</option>)}
              </select>
            </label>
            {isManagedBrowser() && <p>{t("Stationen tilldelas av administratören på servern.")}</p>}
            <fieldset>
              <legend>{t("Tema")}</legend>
              <div className="theme-grid">
                {(["light", "dark", "grey", "grey-dark"] as Theme[]).map((candidate) => (
                  <button type="button" key={candidate} className={theme === candidate ? "is-active" : ""} onClick={() => onThemeChange(candidate)}>
                    {theme === candidate && <Check />}
                    {t(candidate === "light" ? "Ljust" : candidate === "dark" ? "Mörkt" : candidate === "grey" ? "Grått" : "Grått mörkt")}
                  </button>
                ))}
              </div>
            </fieldset>
            <label>
              <span>{t("Förseningar och för tidiga tåg")}</span>
              {/* Den här terminalens eget val; tomt följer träffens förval från servern. */}
              <select value={deviationOwn} onChange={(event) => onDeviationChange(event.target.value)}>
                <option value="">{t("Som träffen: {level}", { level: `${deviationLevel(snapshot)} · ${t(LEVEL_NAMES[deviationLevel(snapshot)])}` })}</option>
                {DEVIATION_LEVELS.map((level) => <option value={String(level)} key={level}>{`${level} · ${t(LEVEL_NAMES[level])}`}</option>)}
              </select>
            </label>
            <p className="field-hint">{t(LEVEL_HINTS[deviationLevel(snapshot, deviationOwn)])}</p>
            <div className="info-card">
              <strong>{source === "demo" ? t("Fristående demo") : source === "server" ? "TrainMeet Server" : t("Offline")}</strong>
              <p>{source === "demo" ? t("Fristående demo med två övningsstationer. Inget skickas till trafikspelet.") : source === "server" ? t("Vyn uppdateras från serverns gemensamma driftstatus.") : t("Servern kan inte nås. Senast kända läge visas och trafikåtgärderna är spärrade.")}</p>
            </div>
            {session.available && <AccountCard session={session} onSession={onSession} />}
            {session.available && <UsersPanel session={session} />}
            <ReleaseNotes />
            {!isManagedBrowser() && <><button type="button" className="reconfigure-button" onClick={onReconfigure}>{t("Kör första installationen igen")}</button>
            <div className="terminal-update-card">
              <span className="micro-heading">{t("Programvara")}</span>
              <p>{updateStatus || t("Kontrollerar version …")}</p>
              {updateAvailable && <button type="button" onClick={() => { void installUpdate(); }} disabled={updating}>{updating ? t("Installerar …") : t("Installera uppdatering")}</button>}
            </div></>}
          </div>
        )}

        {overlay === "tambox" && (
          <div className="overlay-content">
            <p className="overlay-intro">{t("Samma A–D-anslutningar som den fysiska TMBoxen. Alla kommandon ska gå genom TrainMeet Server.")}</p>
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
                    <span>{neighbor?.name ?? t("Ej tilldelad")}</span>
                  </div>
                );
              })}
            </div>
            <a className="primary-link" href="/">{t("Öppna full TMBox-simulering")}</a>
          </div>
        )}

        {overlay === "menu" && (
          <div className="overlay-content menu-list">
            {session.available && session.user && session.login_required && (
              <button type="button" onClick={() => { void signOut().then((next) => { onSession(next); onClose(); }).catch(() => undefined); }}><LogOut /> {t("Logga ut")}</button>
            )}
            {window.location.pathname.startsWith("/tkl/") && <>
              <a href="/#settings">{t("Inställningar")}</a>
              <a href="/#screens">{t("Skärmar")}</a>
              <a href="/#workspaces">{t("Byt arbetsyta")}</a>
            </>}
            <div className="active-operator-card"><UserRound /><span><strong>{shift.operator_name}</strong><small>{t("Trafikpass startat")} {new Date(shift.started_at).toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" })}</small></span></div>
            <label className="handover-note"><span>{t("Överlämningsanteckning")}</span><textarea value={handoverNote} onChange={(event) => setHandoverNote(event.target.value)} placeholder={t("Valfri information till nästa operatör")} rows={3} /></label>
            {shiftError && <p className="setup-message is-error">{shiftError}</p>}
            <button type="button" disabled={finishingShift} onClick={() => { setFinishingShift(true); setShiftError(""); void onFinishShift("handover", handoverNote).catch((error) => { setShiftError(t(error instanceof Error ? error.message : "Överlämningen misslyckades.")); setFinishingShift(false); }); }}>{t("Lämna över stationen")}</button>
            <button type="button" className="danger-menu-action" disabled={finishingShift} onClick={() => { setFinishingShift(true); setShiftError(""); void onFinishShift("closed", handoverNote).catch((error) => { setShiftError(t(error instanceof Error ? error.message : "Trafikpasset kunde inte avslutas.")); setFinishingShift(false); }); }}>{t("Avsluta trafikpasset")}</button>
            <div className="info-card">
              <strong>{snapshot.meet.name}</strong>
              <p>{snapshot.active_day} {t("· revision")} {snapshot.revision ?? 0}</p>
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}

function ManagedTerminal() {
  const [config, setConfig] = useState<TerminalConfig | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try {
        const next = await loadTerminalConfig();
        if (!active) return;
        setError("");
        setConfig(current => JSON.stringify(current) === JSON.stringify(next) ? current : next);
      } catch (failure) {
        if (active) setError(t(failure instanceof Error ? failure.message : "Servern kan inte nås."));
      }
      if (active) timer = setTimeout(refresh, 2000);
    };
    void refresh();
    return () => { active = false; clearTimeout(timer); };
  }, []);
  if (config?.configured && !error) return <TerminalApp key={config.client_id + ":" + config.station_id} initialConfig={config} />;
  return <main className="setup-view"><section className="setup-card" aria-live="polite">
    <TrainFront size={48} /><h1>{t("TKL")}</h1>
    <h2>{t("Väntar på administratören")}</h2>
    {config?.device_code && <p><strong>{config.device_code}</strong></p>}
    <p>{t("Visa enhetskoden för administratören. Stationen tilldelas på TrainMeet Server.")}</p>
    <p>{t("Du kan inte påverka trafiken innan en station har tilldelats.")}</p>
    {error && <p role="alert">{error}</p>}
    <a href="/#workspaces">{t("Byt arbetsyta")}</a>
  </section></main>;
}

export default function App() {
  if (isManagedBrowser()) return <ManagedTerminal />;
  return <>
    {isDemoTerminal() && <aside className="demo-notice" role="note">
      <strong>{t("TKL Demo – påverkar inte träffen")}</strong>
      <span>{t("Klockan står på 06:00. Öva med direktklarering och byt demostation för att ta emot tåget.")}</span>
      <select aria-label={t("Byt demostation")} value="" onChange={(event) => {
        const station_id = event.target.value;
        if (!station_id) return;
        void loadTerminalConfig().then(config => saveTerminalConfig({...config, station_id})).then(() => window.location.reload());
      }}><option value="">{t("Byt demostation")}</option>{demoStations.map((demo) => <option value={demo.id} key={demo.id}>{demo.name}</option>)}</select>
      <div><a href="/#workspaces">{t("Byt arbetsyta")}</a><button type="button" onClick={() => { void resetTerminalConfig().then(() => window.location.reload()); }}>{t("Börja om demo")}</button></div>
    </aside>}
    <TerminalApp />
  </>;
}

function TerminalApp({ initialConfig }: { initialConfig?: TerminalConfig } = {}) {
  const [runtime, setRuntime] = useState<RuntimeResult | null>(null);
  const [terminalConfig, setTerminalConfig] = useState<TerminalConfig | null>(initialConfig || null);
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
  // TKL's own accounts. Nothing below runs against the terminal until the
  // session says the screen may operate: at the machine always, over the web
  // once somebody has signed in.
  const [session, setSession] = useState<SessionStatus | null>(null);
  const firstLoad = useRef(true);
  const refreshSession = () => loadSession().then(setSession, () => setSession(noAccounts));
  const operating = mayOperate(session);
  // Förseningar: terminalens eget val, när bilden kom (klockan går vidare
  // mellan hämtningarna) och en sekund i taget så att tågen rör sig på linjen.
  const [deviationOwn, setDeviationOwn] = useState<string>(() => { try { return window.localStorage.getItem(DEVIATION_LEVEL_KEY) || ""; } catch { return ""; } });
  const receivedAt = useRef(Date.now());
  const [tick, setTick] = useState(Date.now());
  const fresh = useRef(changeTracker());
  const trackedLevel = useRef<number | null>(null);
  useEffect(() => { const timer = window.setInterval(() => setTick(Date.now()), 1000); return () => window.clearInterval(timer); }, []);
  const changeDeviation = (value: string) => {
    setDeviationOwn(value);
    try { if (value) window.localStorage.setItem(DEVIATION_LEVEL_KEY, value); else window.localStorage.removeItem(DEVIATION_LEVEL_KEY); } catch { /* privat läge */ }
  };

  useEffect(() => {
    if (window.location.pathname.startsWith("/tkl/")) {
      try { sessionStorage.setItem("trainmeet.workspace", "tkl"); } catch { /* private browser */ }
    }
    void refreshSession();
    const expired = () => { void refreshSession(); };
    window.addEventListener("trainmeet:session-expired", expired);
    return () => window.removeEventListener("trainmeet:session-expired", expired);
  }, []);

  useEffect(() => {
    // The profile is the terminal's to give: over the web it comes only
    // after the sign-in, so it is read once the screen may operate.
    if (initialConfig || !operating) return;
    void loadTerminalConfig().then(setTerminalConfig);
  }, [operating]);

  useEffect(() => {
    if (!terminalConfig?.configured || !operating) return;
    void loadAuthStatus().then(setAuthStatus).catch(() => {
      setAuthStatus({ authenticated: false, access_mode: window.location.port === "8790" ? "terminal" : "external", username: "", password_configured: true, must_change_password: false });
    });
  }, [terminalConfig, operating]);

  useEffect(() => {
    if (!terminalConfig?.configured || !authStatus?.authenticated || !operating) return undefined;
    let active = true;
    const refresh = async () => {
      try {
        const result = await loadRuntime();
        if (!active) return;
        receivedAt.current = Date.now();
        setRuntime(result);
        setRuntimeError(false);
        if (firstLoad.current) {
          const configuredStation = result.snapshot.stations.find((station) => station.id === terminalConfig.station_id);
          setStationId(configuredStation?.id ?? (isManagedBrowser() ? null : defaultStation(result.snapshot).id));
          firstLoad.current = false;
        }
      } catch (error) {
        console.error("TrainMeet TKL kunde inte läsa driftdata", error);
        if (active) setRuntimeError(true);
      }
    };
    void refresh();
    window.addEventListener("trainmeet:context-stale", refresh);
    const timer = window.setInterval(refresh, 3000);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener("trainmeet:context-stale", refresh);
    };
  }, [terminalConfig, authStatus, operating]);

  useEffect(() => {
    if (!runtime || !stationId || !authStatus?.authenticated || !operating) return undefined;
    let active = true;
    const refreshContext = async () => {
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
        if (active && isManagedBrowser()) setTklContext(null);
        // The terminal's own sign-in ran out: the sign-in view takes over.
        // That is not the Server withdrawing the station.
        if (error instanceof APIError && error.code === "authentication_required") return;
        if (active && error instanceof Error && accessLost(error.message)) {
          setAuthStatus((current) => current ? { ...current, authenticated: false } : current);
        }
      }
    };
    void refreshContext();
    window.addEventListener("trainmeet:context-stale", refreshContext);
    const timer = window.setInterval(refreshContext, 3000);
    return () => { active = false; window.clearInterval(timer); window.removeEventListener("trainmeet:context-stale", refreshContext); };
  }, [runtime?.snapshot.publication_id, runtime?.source, stationId, authStatus?.authenticated, terminalConfig?.terminal_name, operating]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem("trainmeet-tkl.theme", theme);
  }, [theme]);

  if (!session || (operating && !terminalConfig)) return <LoadingView />;
  // No owner yet: the first start creates one. A terminal that was paired
  // before accounts existed keeps running at the machine, and asks for the
  // owner when the administration is opened.
  if (session.available && !session.configured && (!terminalConfig?.configured || !session.at_the_machine)) {
    return <CreateOwnerView session={session} terminalConfig={terminalConfig} onCreated={setSession} />;
  }
  if (session.available && session.login_required && !session.user) return <SignInView session={session} terminalConfig={terminalConfig} onSignedIn={setSession} />;
  if (!terminalConfig) return <LoadingView />;
  if (!terminalConfig.configured) {
    if (session.available && !canAdminister(session)) return <SignInView session={session} terminalConfig={terminalConfig} admin onSignedIn={setSession} />;
    return <SetupView onComplete={(config, snapshot, auth) => {
      setTerminalConfig(config);
      setAuthStatus(auth);
      setRuntime({ snapshot, source: isDemoTerminal() ? "demo" : "server", connected: true });
      setStationId(config.station_id);
    }} />;
  }
  if (!authStatus) return <LoadingView />;
  if (!authStatus.authenticated && isManagedBrowser()) return <UnavailableView onRetry={() => window.location.reload()} />;
  if (!authStatus.authenticated) return <AuthenticationView status={authStatus} terminalConfig={terminalConfig} session={session} onSession={setSession} onAuthenticated={setAuthStatus} onReconfigure={() => { void resetTerminalConfig().then(() => window.location.reload()); }} />;
  if (runtimeError && !runtime) return <UnavailableView onRetry={() => window.location.reload()} />;
  if (!runtime || !stationId) return <LoadingView />;

  const { snapshot, source } = runtime;
  const station = snapshot.stations.find((candidate) => candidate.id === stationId) ?? snapshot.stations[0];
  if (isManagedBrowser() && station.id !== terminalConfig.station_id) return <LoadingView />;
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
    const shift = await startTklShift({ meet_generation: tklContext.meet_generation, station_id: stationId, operator_name: operatorName, terminal_name: terminalConfig.terminal_name, take_over: takeOver });
    setTklContext((current) => current ? { ...current, shift } : current);
  };

  if (finishedShift) return <ShiftFinishedView station={station} shift={finishedShift.shift} status={finishedShift.status} completedCount={archivedTrains.length} onContinue={() => { setFinishedShift(null); setTklContext((current) => current ? { ...current, shift: null } : current); }} />;
  if (!tklContext.shift) return <ShiftStartView context={tklContext} terminalName={terminalConfig.terminal_name} onStart={startShift} />;

  const selectStation = (nextStationId: string) => {
    if (isManagedBrowser()) return;
    setStationId(nextStationId);
    setSelectedTrain(null);
    if (!isDemoTerminal()) window.localStorage.setItem("trainmeet-tkl.station-id", nextStationId);
    setOverlay(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const assignStation = async (nextStationId: string) => {
    if (isManagedBrowser()) return;
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
      const departureConnection = connectionForTrain(train, "departure");
      const arrivalConnection = connectionForTrain(train, "arrival");
        if (next.departure === "ready" && previous.departure !== "ready" && snapshot.meet.default_dispatch_mode === "direct" && departureConnection) {
          const line = await performTklLineAction({ meet_generation: tklContext.meet_generation, station_id: station.id, connection_id: departureConnection.id, train_number: train.train_number, action: "request" });
          setTklContext((current) => current ? { ...current, connection_states: current.connection_states.map((state) => state.id === line.id ? line : state) } : current);
        }
        if (next.departure === "departed" && previous.departure !== "departed" && departureConnection) {
          const line = await performTklLineAction({ meet_generation: tklContext.meet_generation, station_id: station.id, connection_id: departureConnection.id, train_number: train.train_number, action: "depart" });
          setTklContext((current) => current ? { ...current, connection_states: current.connection_states.map((state) => state.id === line.id ? line : state) } : current);
        }
        if (next.arrival === "arrived" && previous.arrival !== "arrived" && arrivalConnection) {
          const currentLine = tklContext?.connection_states.find((state) => state.id === arrivalConnection.id);
          if (currentLine?.state === "occupied" && currentLine.train_number === train.train_number) {
            const line = await performTklLineAction({ meet_generation: tklContext.meet_generation, station_id: station.id, connection_id: arrivalConnection.id, train_number: train.train_number, action: "arrive" });
            setTklContext((current) => current ? { ...current, connection_states: current.connection_states.map((state) => state.id === line.id ? line : state) } : current);
          }
        }
      await updateTklMovement({
          meet_generation: tklContext.meet_generation,
          station_id: station.id,
          movement_id: train.id,
          arrival: next.arrival,
          departure: next.departure,
          actual_track: next.actualTrack || train.track,
          event_type: eventType,
      });
      if (next.departure === "departed" && previous.departure !== "departed") {
        setReceipt(t("Tåg {number} har avgått mot {station}.", { number: train.train_number, station: train.departure_to || t("nästa station") }));
        window.setTimeout(() => setReceipt(null), 6000);
      } else if (next.arrival === "arrived" && previous.arrival !== "arrived" && !train.departure_time) {
        setReceipt(t("Tåg {number} har ankommit till {station}.", { number: train.train_number, station: station.name }));
        window.setTimeout(() => setReceipt(null), 6000);
      }
    } catch (error) {
      setMovementState((current) => ({ ...current, [key]: previous }));
      setReceipt(t(error instanceof Error ? error.message : "Tågrörelsen kunde inte sparas."));
      throw error;
    }
  };

  const requestLineForTrain = async (train: TrainRow): Promise<"pending" | "confirmed"> => {
    const connection = connectionForTrain(train, "departure");
    if (!connection) throw new Error("Tågets nästa sträcka kunde inte bestämmas.");
    const line = await performTklLineAction({ meet_generation: tklContext.meet_generation, station_id: station.id, connection_id: connection.id, train_number: train.train_number, action: "request" });
    setTklContext((current) => current ? { ...current, connection_states: current.connection_states.map((state) => state.id === line.id ? line : state) } : current);
    return line.state === "reserved" ? "confirmed" : "pending";
  };

  const handleLineCase = async (lineState: RuntimeSnapshot["connection_states"][number], action: "accept" | "reject" | "cancel" | "arrive") => {
    setBusyLineId(lineState.id);
    try {
      const line = await performTklLineAction({ meet_generation: tklContext.meet_generation, station_id: station.id, connection_id: lineState.id, train_number: lineState.train_number || "", action });
      setTklContext((current) => current ? { ...current, connection_states: current.connection_states.map((state) => state.id === line.id ? line : state) } : current);
      if (action === "arrive" && lineState.train_number) {
        const movement = activeTrains.find((train) => train.train_number === lineState.train_number && train.arrival_time);
        if (movement) {
          const key = movementKey(movement);
          const next = { ...stateFor(movement), arrival: "arrived" as const };
          await updateTklMovement({ meet_generation: tklContext.meet_generation, station_id: station.id, movement_id: movement.id, arrival: next.arrival, departure: next.departure, actual_track: next.actualTrack || movement.track, event_type: "arrival_arrived" });
          setMovementState((current) => ({ ...current, [key]: next }));
        }
        setReceipt(t("Tåg {number} har ankommit till {station}. Sträckan är fri.", { number: lineState.train_number, station: station.name }));
      } else if (action === "accept") {
        setReceipt(t("Klarering beviljad för tåg {number}.", { number: lineState.train_number || "" }));
      } else if (action === "reject") {
        setReceipt(t("Klareringen för tåg {number} nekades.", { number: lineState.train_number || "" }));
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

  const nowSeconds = clockSeconds(snapshot, receivedAt.current, tick);
  const lives = trainLive(snapshot, nowSeconds);
  const level = deviationLevel(snapshot, deviationOwn);
  // Att byta nivå är ingen ändring i trafiken: minnet börjar om, inget lyser upp.
  if (trackedLevel.current !== null && trackedLevel.current !== level) fresh.current = changeTracker();
  trackedLevel.current = level;
  const cardDeviation = (train: TrainRow, movement: LocalMovementState) => {
    const live = lives.get(String(train.train_number));
    const view = deviationView(level, live);
    const planned = train.arrival_time || train.departure_time || train.sort_time;
    const done = train.departure_time ? movement.departure === "departed" : movement.arrival === "arrived";
    const [h, m] = String(planned || "").split(":").map(Number);
    const expected = view.mark?.tone === "late" && !done && Number.isFinite(h) && Number.isFinite(m)
      ? (() => { const value = ((h * 60 + m + view.mark!.minutes) % 1440 + 1440) % 1440; return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`; })()
      : null;
    const label = !view.mark ? "" : view.mark.tone === "early" ? t("{minutes} min för tidigt", { minutes: view.mark.minutes })
      : t("{minutes} min sen", { minutes: view.mark.minutes }) + (view.estimated ? ` · ${t("beräknad")}` : "");
    const changedAt = fresh.current.note(train.id, [movement.arrival, movement.departure, view.mark?.text || ""], Date.now());
    return { view, expected, label, age: changedAt === null ? null : Date.now() - changedAt };
  };

  const renderTrainCard = (train: TrainRow, defaultExpanded = false) => {
    const key = movementKey(train);
    return (
      <TrainCard
        key={train.id}
        deviation={cardDeviation(train, movementState[key] ?? emptyMovement())}
        snapshot={snapshot}
        train={train}
        movement={movementState[key] ?? emptyMovement()}
        availableTracks={tracks}
        defaultExpanded={defaultExpanded}
        freightMode={freightMode}
        selected={selectedTrain === train.train_number}
        actionsDisabled={!runtime.connected}
        onSelect={setSelectedTrain}
        onMovementChange={(next) => applyMovement(train, key, next)}
        onLineRequest={() => requestLineForTrain(train)}
      />
    );
  };

  return (
    <div className="app-background">
      <main className="app-shell">
        {receipt && <div className="operation-receipt" role="status"><CircleCheckBig /><span>{receipt}</span><button type="button" onClick={() => setReceipt(null)} aria-label={t("Stäng")}><X /></button></div>}
        {!runtime.connected && (
          <div className="offline-banner" role="status">{t("Offline · visar senast kända läge · trafikåtgärder är spärrade")}</div>
        )}
        <Header
          station={station}
          snapshot={snapshot}
          source={source}
          freightMode={freightMode}
          onFreightToggle={() => setFreightMode((value) => !value)}
          onOverlay={(next) => { setOverlay(next); if (next === "settings") void refreshSession(); }}
          onHome={() => { setOverlay(null); setSelectedTrain(null); setFreightMode(false); window.scrollTo({top: 0}); }}
        />

        <div className="diagram-sticky">
          <StationDiagram
            nowSeconds={nowSeconds}
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

        <section className="train-list" aria-label={t("Tågrörelser")}>
          {activeTrains.length === 0 && (
            <div className="empty-state">
              <TrainFront />
              <strong>{t("Inga tågrörelser")}</strong>
              <span>{t(freightMode ? "Det finns inga godståg på stationen." : "Stationen saknar tågrörelser för aktiv dag.")}</span>
            </div>
          )}

          {focusTrains.length > 0 && (
            <div className="movement-section" aria-label={t("Aktuella tågrörelser")}>
              <div className="movement-section-heading">
                <div>
                  <strong>{t("Aktuellt på stationen")}</strong>
                  <span>{t("Pågående ärenden och de närmaste tågen")}</span>
                </div>
                <span>{focusTrains.length}</span>
              </div>
              {focusBeforeNow.map((train) => renderTrainCard(train))}
              <NowMarker />
              {focusAfterNow.map((train) => renderTrainCard(train))}
            </div>
          )}

          {laterTrains.length > 0 && (
            <details className="schedule-section">
              <summary>
                <span>
                  <strong>{t("Hela dagens tidtabell")}</strong>
                  <small>{t("Övriga tågrörelser i tidsordning")}</small>
                </span>
                <span>{laterTrains.length}</span>
              </summary>
              <div className="schedule-content">
                {laterTrains.map((train) => renderTrainCard(train))}
              </div>
            </details>
          )}

          <details className="archive-section">
            <summary>{t("Arkiverade tågrörelser (")}{archivedTrains.length + onLineNumbers.size})</summary>
            <div className="archive-content">
              {archivedTrains.length === 0 && onLineNumbers.size === 0 && <span>{t("Inga arkiverade tågrörelser.")}</span>}
              {[...onLineNumbers].map((number) => <span key={number}>{t("Tåg")} {number} {t("· på linjen")}</span>)}
              {archivedTrains.map((train) => <span key={train.id}>{t("Tåg")} {train.train_number} {t("· avgått")}</span>)}
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
          session={session}
          onSession={setSession}
          shift={tklContext.shift}
          deviationOwn={deviationOwn}
          onDeviationChange={changeDeviation}
          onFinishShift={async (status, note) => {
            const activeShift = tklContext.shift;
            if (!activeShift) return;
            await finishTklShift({ meet_generation: tklContext.meet_generation, station_id: station.id, shift_id: activeShift.shift_id, status, note });
            setOverlay(null);
            setFinishedShift({ shift: activeShift, status });
          }}
        />
      )}
    </div>
  );
}

type Release = { version: string; date: string; notes: string[] };

/** Vad är nytt: each version's headings, newest first (public/releases.json,
 *  written by scripts/version.py when the version is minted). */
function ReleaseNotes() {
  const [releases, setReleases] = useState<Release[]>([]);
  const [all, setAll] = useState(false);
  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}releases.json`, { cache: "no-cache" })
      .then((response) => (response.ok ? response.json() : []))
      .then((list) => setReleases(Array.isArray(list) ? list.filter((item) => item && typeof item.version === "string" && Array.isArray(item.notes)) : []))
      .catch(() => setReleases([]));
  }, []);
  if (!releases.length) return null;
  const shown = all ? releases : releases.slice(0, 5);
  return (
    <div className="release-notes">
      <span className="micro-heading">{t("Vad är nytt")}</span>
      {shown.map((release, index) => (
        <div key={release.version} className="release-note">
          <div className="release-note__head"><b>{release.version}</b>{index === 0 && <span>{t("Installerad")}</span>}<small>{release.date}</small></div>
          <ul>{release.notes.map((note) => <li key={note}>{note}</li>)}</ul>
        </div>
      ))}
      {releases.length > 5 && <button type="button" onClick={() => setAll(!all)}>{all ? t("Visa färre") : t("Visa alla versioner ({count})", { count: releases.length })}</button>}
    </div>
  );
}
