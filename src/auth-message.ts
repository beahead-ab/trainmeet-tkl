import type { AuthStatus } from "./api";

// Hosted Server deliberately omits administrator names from auth/status.
// Do not invent an identity, but retain the actual name when a terminal
// backend supplies it. Pairing is a separate state, not an admin sign-in.
export function authenticatedMessage(status: Pick<AuthStatus, "access_mode" | "username">) {
  if (status.access_mode === "terminal") return "Terminalen är parkopplad och känns igen automatiskt.";
  const name = typeof status.username === "string" ? status.username.trim() : "";
  return name ? { source: "Inloggad som {name}.", values: { name } } : "Inloggad.";
}
