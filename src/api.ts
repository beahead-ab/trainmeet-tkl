import type { RuntimeSnapshot } from "./types";

export type RuntimeSource = "server" | "cache";

export interface RuntimeResult {
  snapshot: RuntimeSnapshot;
  source: RuntimeSource;
  connected: boolean;
  cachedAt?: string;
}

export interface TerminalConfig {
  configured: boolean;
  terminal_name: string;
  server_url: string;
  station_id: string;
  station_name?: string;
  orientation: "portrait" | "landscape";
  client_id?: string;
  access_token?: string;
}

export interface AuthStatus {
  authenticated: boolean;
  access_mode: "local" | "external" | "terminal";
  username: string;
  password_configured: boolean;
  must_change_password: boolean;
}

export interface TklShift {
  shift_id: string;
  operator_name: string;
  terminal_name: string;
  status: "active" | "handover" | "closed";
  started_at: string;
  ended_at?: string | null;
  handover_note?: string | null;
  updated_at: string;
}

export interface TklContext {
  protocol_version: number;
  publication_id: string;
  meet: RuntimeSnapshot["meet"];
  active_day: string;
  station: RuntimeSnapshot["stations"][number];
  terminal: { client_id: string; display_name: string; kind: string };
  preflight: {
    server_online: boolean;
    clock_configured: boolean;
    clock_running: boolean;
    track_count: number;
    connection_count: number;
    train_count: number;
    open_connection_count: number;
  };
  shift: TklShift | null;
  previous_shift: TklShift | null;
  movements: Record<string, {
    arrival: "none" | "approaching" | "arrived";
    departure: "none" | "positioned" | "ready" | "departed";
    actualTrack?: string | null;
    updated_by?: string;
    updated_at?: string;
  }>;
  connection_states: RuntimeSnapshot["connection_states"];
}

export interface DiscoveredServer {
  name: string;
  url: string;
  address?: string;
}

export interface TerminalUpdateStatus {
  supported: boolean;
  installed_version: string;
  latest_version?: string;
  update_available?: boolean;
  status: string;
  message: string;
  check_error?: string;
}

export interface WifiNetwork {
  ssid: string;
  connected: boolean;
  signal: number;
  secured: boolean;
  security: string;
}

const browserConfigKey = "trainmeet-tkl.browser-config";

const requestTimeout = 4000;
const runtimeCacheKey = "trainmeet-tkl.last-runtime";

class APIError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function readJSON<T>(url: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), requestTimeout);
  try {
    const response = await fetch(url, {
      cache: "no-store",
      credentials: "same-origin",
      ...init,
      signal: controller.signal,
    });
    if (!response.ok) {
      let message = `HTTP ${response.status}`;
      try {
        const payload = await response.json() as { message?: string };
        message = payload.message || message;
      } catch {
        // Keep the HTTP status when the server did not return JSON.
      }
      throw new APIError(response.status, message);
    }
    return await response.json() as T;
  } finally {
    window.clearTimeout(timeout);
  }
}

async function terminalOrServer<T>(terminalPath: string, serverPath: string, init?: RequestInit): Promise<T> {
  try {
    return await readJSON<T>(terminalPath, init);
  } catch (error) {
    if (!(error instanceof APIError) || error.status !== 404) throw error;
    return readJSON<T>(serverPath, init);
  }
}

export async function loadAuthStatus(): Promise<AuthStatus> {
  return terminalOrServer<AuthStatus>("/terminal/auth", "/v1/auth/status");
}

export async function loginAdmin(username: string, password: string): Promise<AuthStatus> {
  return readJSON<AuthStatus>("/v1/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
}

export async function pairTerminal(serverUrl: string, pairingCode: string, terminalName: string): Promise<AuthStatus> {
  return readJSON<AuthStatus>("/terminal/pair", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ server_url: serverUrl, pairing_code: pairingCode, terminal_name: terminalName }),
  });
}

export async function loadTklContext(stationId: string): Promise<TklContext> {
  const query = new URLSearchParams({ station_id: stationId }).toString();
  return terminalOrServer<TklContext>(`/terminal/tkl/context?${query}`, `/v1/tkl/context?${query}`);
}

export async function startTklShift(input: {
  station_id: string;
  operator_name: string;
  terminal_name: string;
  take_over?: boolean;
}): Promise<TklShift> {
  const response = await terminalOrServer<{ shift: TklShift }>("/terminal/tkl/shift/start", "/v1/tkl/shift/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return response.shift;
}

export async function finishTklShift(input: {
  station_id: string;
  shift_id: string;
  status: "handover" | "closed";
  note?: string;
}): Promise<TklShift> {
  const response = await terminalOrServer<{ shift: TklShift }>("/terminal/tkl/shift/finish", "/v1/tkl/shift/finish", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return response.shift;
}

export async function updateTklMovement(input: {
  station_id: string;
  movement_id: string;
  arrival: "none" | "approaching" | "arrived";
  departure: "none" | "positioned" | "ready" | "departed";
  actual_track?: string;
  event_type: string;
}): Promise<TklContext["movements"][string]> {
  const response = await terminalOrServer<{ movement: TklContext["movements"][string] }>("/terminal/tkl/movement", "/v1/tkl/movement", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return response.movement;
}

export async function performTklLineAction(input: {
  station_id: string;
  connection_id: string;
  train_number: string;
  action: "request" | "accept" | "reject" | "cancel" | "depart" | "arrive";
}): Promise<RuntimeSnapshot["connection_states"][number]> {
  const response = await terminalOrServer<{ connection: RuntimeSnapshot["connection_states"][number] }>("/terminal/tkl/line", "/v1/tkl/line", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return response.connection;
}

export async function loadTerminalConfig(): Promise<TerminalConfig> {
  try {
    return await readJSON<TerminalConfig>("/terminal/config");
  } catch {
    // When hosted by TrainMeet Server the browser keeps its own terminal profile.
    try {
      const stored = JSON.parse(window.localStorage.getItem(browserConfigKey) || "null") as TerminalConfig | null;
      if (stored?.station_id) return { ...stored, configured: true };
    } catch {
      // A malformed browser profile simply opens the first-start guide again.
    }
    return { ...DEFAULT_BROWSER_CONFIG, server_url: window.location.origin };
  }
}

const DEFAULT_BROWSER_CONFIG: TerminalConfig = {
  configured: false,
  terminal_name: "",
  server_url: "",
  station_id: "",
  orientation: "portrait",
};

export async function inspectServer(serverUrl: string): Promise<RuntimeSnapshot> {
  try {
    return await readJSON<RuntimeSnapshot>("/terminal/connect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ server_url: serverUrl }),
    });
  } catch {
    const base = serverUrl.trim().replace(/\/$/, "");
    return readJSON<RuntimeSnapshot>(`${base}/v1/display`);
  }
}

export async function discoverServers(): Promise<DiscoveredServer[]> {
  try {
    const result = await readJSON<{ servers: DiscoveredServer[] }>("/terminal/discover");
    return result.servers;
  } catch {
    return [];
  }
}

export async function loadWifiNetworks(): Promise<WifiNetwork[]> {
  try {
    const result = await readJSON<{ networks: WifiNetwork[] }>("/terminal/wifi");
    return result.networks;
  } catch {
    return [];
  }
}

export async function connectWifi(ssid: string, password: string): Promise<void> {
  await readJSON<{ connected: boolean }>("/terminal/wifi", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ssid, password }),
  });
}

export async function saveTerminalConfig(config: Omit<TerminalConfig, "configured">): Promise<TerminalConfig> {
  try {
    return await readJSON<TerminalConfig>("/terminal/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(config),
    });
  } catch {
    const browserConfig = { ...config, configured: true };
    window.localStorage.setItem(browserConfigKey, JSON.stringify(browserConfig));
    return browserConfig;
  }
}

export async function resetTerminalConfig(): Promise<void> {
  try {
    await readJSON<{ configured: boolean }>("/terminal/config", { method: "DELETE" });
  } catch {
    window.localStorage.removeItem(browserConfigKey);
  }
}

export async function checkTerminalUpdate(): Promise<TerminalUpdateStatus> {
  return readJSON<TerminalUpdateStatus>("/terminal/update");
}

export async function startTerminalUpdate(): Promise<void> {
  await readJSON<{ status: string }>("/terminal/update", { method: "POST" });
}

function readBrowserCache(): RuntimeResult | null {
  try {
    const cached = JSON.parse(window.localStorage.getItem(runtimeCacheKey) || "null") as {
      snapshot: RuntimeSnapshot;
      cachedAt: string;
    } | null;
    return cached ? { snapshot: cached.snapshot, source: "cache", connected: false, cachedAt: cached.cachedAt } : null;
  } catch {
    return null;
  }
}

function remember(snapshot: RuntimeSnapshot) {
  try {
    window.localStorage.setItem(runtimeCacheKey, JSON.stringify({ snapshot, cachedAt: new Date().toISOString() }));
  } catch {
    // The terminal gateway keeps a second on-disk cache if browser storage is full.
  }
}

export async function loadRuntime(): Promise<RuntimeResult> {
  try {
    const terminalResult = await readJSON<RuntimeResult>("/terminal/runtime");
    if (terminalResult.source === "server") remember(terminalResult.snapshot);
    return terminalResult;
  } catch {
    try {
      const snapshot = await readJSON<RuntimeSnapshot>("/v1/display");
      remember(snapshot);
      return { snapshot, source: "server", connected: true };
    } catch {
      const cached = readBrowserCache();
      if (cached) return cached;
      throw new Error("TrainMeet Server kan inte nås och terminalen saknar ett tidigare driftläge.");
    }
  }
}
