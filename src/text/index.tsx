/* Träffens texter: berättelsen, instruktionerna, programmet och stationernas
 * instruktioner, i samma lilla Markdown som servern och Cloud.
 *
 * markdown.js är en byte-identisk kopia av serverns web/markdown.js (serverns
 * tools/sync-i18n.mjs --siblings håller den lika). Den lägger sig på
 * globalThis; här får den typer och en React-komponent.
 */
import { useEffect, useRef } from "react";
import "./markdown.js";

type MarkdownApi = {
  render(container: HTMLElement, text: string, options?: { headingBase?: number }): HTMLElement;
  plain(text: string): string;
  pick(texts: Record<string, string> | null | undefined, preferred: string, fallback: string): { language: string; text: string } | null;
};
declare global {
  var TrainMeetMarkdown: MarkdownApi;
}
export const markdown = (): MarkdownApi => globalThis.TrainMeetMarkdown;

/** Texten ritad som rubriker, stycken och listor; aldrig som HTML. */
export function Markdown({ text, headingBase = 3, className = "" }: { text: string; headingBase?: number; className?: string }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => { if (host.current) markdown().render(host.current, text, { headingBase }); }, [text, headingBase]);
  return <div ref={host} className={`tm-md ${className}`.trim()} />;
}
