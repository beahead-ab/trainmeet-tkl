import type { RuntimeSnapshot } from "./types";

export interface RuntimeResult {
  snapshot: RuntimeSnapshot;
  source: "server" | "demo";
}

const requestTimeout = 1800;

async function readJSON(url: string): Promise<RuntimeSnapshot> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), requestTimeout);
  try {
    const response = await fetch(url, {
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json() as RuntimeSnapshot;
  } finally {
    window.clearTimeout(timeout);
  }
}

export async function loadRuntime(): Promise<RuntimeResult> {
  const forceDemo = new URLSearchParams(window.location.search).get("demo") === "1";
  if (forceDemo) {
    return {
      snapshot: await readJSON(`${import.meta.env.BASE_URL}demo-runtime.json`),
      source: "demo",
    };
  }
  try {
    return { snapshot: await readJSON("/v1/display"), source: "server" };
  } catch {
    return {
      snapshot: await readJSON(`${import.meta.env.BASE_URL}demo-runtime.json`),
      source: "demo",
    };
  }
}
