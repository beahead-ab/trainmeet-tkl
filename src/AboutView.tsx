/* Om trafikspelet i TKL: berättelsen, de allmänna instruktionerna, programmet
 * och stationernas instruktioner ur Cloud, i helskärm som tågdiagrammet.
 * Instruktionerna visas på läsarens språk, och annars på träffens; den egna
 * stationen står först under Stationerna. */
import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { t, useLanguage } from "./i18n";
import { loadAbout } from "./api";
import { Markdown, markdown } from "./text";
import type { AboutTexts, Station } from "./types";

type Tab = "story" | "instructions" | "program" | "stations";

export function AboutView({ station, onClose }: { station: Station; onClose: () => void }) {
  const [texts, setTexts] = useState<AboutTexts | null>(null);
  const [failed, setFailed] = useState(false);
  const [tab, setTab] = useState<Tab | null>(null);
  const language = useLanguage();

  useEffect(() => {
    let live = true;
    loadAbout().then((value) => { if (live) setTexts(value); }).catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const about = texts?.about;
  const instructions = about ? markdown().pick(about.instructions, language, texts?.meet.language || "sv") : null;
  const stations = [...(texts?.stations || [])].sort((a, b) => Number(b.id === station.id) - Number(a.id === station.id));
  const tabs = ([["story", t("Berättelsen"), about?.story || ""], ["instructions", t("Instruktioner"), instructions?.text || ""],
    ["program", t("Program"), about?.program || ""], ["stations", t("Stationerna"), stations.length ? "x" : ""]] as [Tab, string, string][])
    .filter(([, , text]) => text.trim());
  const current = tabs.find(([id]) => id === tab) || tabs[0];

  return (
    <div className="about-view" role="dialog" aria-modal="true" aria-label={t("Om trafikspelet")}>
      <div className="about-view__bar">
        <div className="about-view__title"><span className="micro-heading">{texts?.meet.name || ""}</span><h2>{t("Om trafikspelet")}</h2></div>
        <button type="button" className="icon-button" onClick={onClose} aria-label={t("Stäng")}><X /></button>
      </div>
      {tabs.length > 1 && (
        <div className="about-view__tabs" role="tablist">
          {tabs.map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={current?.[0] === id} className={current?.[0] === id ? "is-active" : ""} onClick={() => setTab(id)}>{label}</button>
          ))}
        </div>
      )}
      <div className="about-view__body">
        {failed ? <p className="about-view__empty">{t("Texterna gick inte att läsa. Försök igen.")}</p>
          : !texts ? <p className="about-view__empty">{t("Läser texterna …")}</p>
          : !current ? <p className="about-view__empty">{t("Trafikspelet har ingen berättelse ännu.")}</p>
          : current[0] === "stations"
            ? stations.map((item) => (
              <section key={item.id} className={`about-view__station${item.id === station.id ? " is-own" : ""}`}>
                <h3>{item.name}</h3>
                <Markdown text={item.instructions} headingBase={4} />
              </section>
            ))
            : <Markdown key={current[0]} text={current[2]} />}
      </div>
    </div>
  );
}

/** Den egna stationens instruktioner i huvudvyn, hopfällda tills man vill läsa. */
export function StationInstructions({ station }: { station: Station }) {
  const text = String(station.instructions || "").trim();
  if (!text) return null;
  return (
    <details className="station-instructions">
      <summary>{t("Instruktioner för {station}", { station: station.name })}</summary>
      <Markdown text={text} headingBase={4} className="station-instructions__text" />
    </details>
  );
}
