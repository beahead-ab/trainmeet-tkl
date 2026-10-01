// The Server no longer lets this terminal in: its key was revoked (401
// "Parkopplingen gäller inte längre", e.g. removed under Klienter), or a new
// meet left it without the station (403 "Terminalen har inte tillgång till
// stationen"). Then the terminal asks for the code again instead of loading
// forever. A server that is merely unreachable is not this.
export function accessLost(message: string): boolean {
  return /\b40[13]\b|inloggning|authentication|behörighet|har inte tillgång|gäller inte längre/i.test(message);
}
