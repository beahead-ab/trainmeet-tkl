import type { RuntimeSnapshot } from "./types";

export type RuntimeSource = "server" | "cache" | "demo";

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
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json() as T;
  } finally {
    window.clearTimeout(timeout);
  }
}

export async function loadTerminalConfig(): Promise<TerminalConfig> {
  if (new URLSearchParams(window.location.search).get("demo") === "1") {
    return {
      configured: true,
      terminal_name: "Charlottendal TKL 1",
      server_url: "demo",
      station_id: "4d1e3bfe-0db9-4490-8ef0-3eb85f01230c",
      station_name: "Charlottendal",
      orientation: "portrait",
    };
  }
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
  const forceDemo = new URLSearchParams(window.location.search).get("demo") === "1";
  if (forceDemo) {
    return {
      snapshot: await readJSON<RuntimeSnapshot>(`${import.meta.env.BASE_URL}demo-runtime.json`),
      source: "demo",
      connected: false,
    };
  }

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
