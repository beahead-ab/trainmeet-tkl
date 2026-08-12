# TrainMeet TKL

Fristående operatörsklient för TrainMeet Server. Projektet återskapar Charlottendals TKL-vy från TrainMeet/Lovable och läser den lokala serverns gemensamma driftstatus.

Projektet är öppet och publicerat under MIT-licensen. Koden kan användas, granskas, ändras och distribueras enligt villkoren i [LICENSE](LICENSE).

> **Projektstatus:** Terminalgränssnitt, installation, första start, serveranslutning, stationsval, offline-cache och uppdatering är implementerade. Operativa trafikkommandon är ännu inte anslutna till TrainMeet Servers skriv-API. Använd därför inte denna version som ensam säkerhetsfunktion i trafikdrift.

## Snabbaste installationen på Raspberry Pi

### Du behöver

- Raspberry Pi 5 rekommenderas; Pi 4 bör också fungera men är ännu inte verifierad.
- Raspberry Pi OS Desktop 64-bit (Trixie).
- En vanlig användare skapad i Raspberry Pi Imager.
- Internet under installation och uppdatering.
- Pekskärm eller vanlig skärm samt tillfälligt tangentbord.
- En nåbar TrainMeet Server på samma nätverk eller via en angiven URL.

Starta Raspberry Pi:n, öppna terminalen och kör:

```bash
curl -fsSL https://raw.githubusercontent.com/beahead-ab/trainmeet-tkl/main/install.sh | sudo sh
sudo reboot
```

Efter omstart öppnas första-start-guiden automatiskt. Välj Wi-Fi vid behov, TrainMeet Server, träff/station, terminalnamn och skärmorientering. Därefter startar terminalen alltid direkt på den valda stationen.

## Ladda ner koden

- [Ladda ner senaste koden som ZIP](https://github.com/beahead-ab/trainmeet-tkl/archive/refs/heads/main.zip)
- [Öppna projektet på GitHub](https://github.com/beahead-ab/trainmeet-tkl)

Eller klona projektet:

```bash
git clone https://github.com/beahead-ab/trainmeet-tkl.git
cd trainmeet-tkl
```

Ingen inloggning eller GitHub-nyckel krävs för att läsa eller ladda ner det publika projektet.

## Kör lokalt

```bash
npm install
npm run dev
```

Öppna `http://127.0.0.1:8790`.

Klienten försöker läsa `/v1/display` från TrainMeet Server. Vites utvecklingsserver skickar dessa anrop vidare till `http://127.0.0.1:8787`. Om servern inte kan nås används den inbyggda, verkliga demoträffen **Hela huset fullt med tåg** med Charlottendal som vald station.

## Produktion

```bash
npm run build
```

`dist/` är en helt statisk applikation. Samma byggda UI distribueras på två sätt:

- **TrainMeet Server:** publiceras under `/tkl/` för datorer, surfplattor och test.
- **TrainMeet TKL Terminal:** installeras tillsammans med det lokala apparatlagret på en separat Raspberry Pi och öppnas automatiskt i Chromium-kiosk.

Det är alltså inte två TKL-applikationer. Serverläget och den fysiska terminalen använder samma React-, CSS- och typsnittsfiler.

För att bygga och lägga samma UI i ett lokalt TrainMeet Server-repo:

```bash
npm run build:server
```

TrainMeet Server publicerar därefter vyn på `http://SERVER:8787/tkl/`. Första gången väljer webbläsaren station och sparar valet lokalt. Den inställningen påverkar inte en fysisk TKL-terminals permanenta profil.

## Raspberry Pi-terminal

Målplattformen är Raspberry Pi 5 med aktuell **Raspberry Pi OS Desktop 64-bit (Trixie)** och pekskärm. Lägg in Wi-Fi, land och en vanlig användare i Raspberry Pi Imager. Starta Pi:n och kör därefter hela installationen med ett kommando:

```bash
curl -fsSL https://raw.githubusercontent.com/beahead-ab/trainmeet-tkl/main/install.sh | sudo sh
```

Starta sedan om med `sudo reboot`. Installationen hämtar aktuell TKL-kod från GitHub, bygger UI:t och konfigurerar terminalen automatiskt.

Vid utveckling från ett lokalt repo kan samma installation köras så här:

```bash
npm ci
npm run build
sudo ./scripts/install-raspberry-pi.sh
```

Installationen lägger in:

- den statiska TKL-vyn i `/opt/trainmeet-tkl/web`,
- det lokala apparatlagret på `127.0.0.1:8790`,
- en systemd-tjänst med automatisk återstart,
- Chromium i kantlöst kioskläge via Raspberry Pi OS rekommenderade Wayland/labwc,
- avstängd skärmsläckare och omstart av Chromium om det stängs eller kraschar,
- stående skärmläge som standard.

Vid första starten kan operatören ansluta Wi-Fi direkt på pekskärmen och väljer därefter TrainMeet Server, aktiv träff/station, terminalnamn och skärmorientering. Profilen sparas i `/var/lib/trainmeet-tkl/terminal-config.json`. Därefter öppnar apparaten alltid sin tilldelade station direkt. Wi-Fi hanteras av Raspberry Pi OS NetworkManager och lösenordet skickas direkt till `nmcli`; TKL sparar ingen egen kopia.

TrainMeet Server hittas automatiskt via mDNS när servern och terminalen finns på samma lokala nätverk. Det går också att skriva serveradressen manuellt. Terminaladministrationen öppnas genom att hålla stationsnamnet i sidhuvudet intryckt i fem sekunder.

I terminaladministrationen kan man även kontrollera och installera senaste TKL-versionen från GitHub. Uppdateringen körs av en separat root-ägd systemtjänst; webbgränssnittet får endast rättighet att starta just TKL-uppdateringen.

### Uppdatera terminalen

Rekommenderad metod är knappen **Sök efter uppdatering** i det dolda administrationsläget. Det går även att uppdatera från terminalen:

```bash
sudo systemctl start trainmeet-tkl-update.service
```

Följ förloppet med:

```bash
sudo journalctl -u trainmeet-tkl-update.service -f
```

Konfigurationen i `/var/lib/trainmeet-tkl/terminal-config.json` ligger kvar vid en vanlig uppdatering.

### Tjänster, portar och filer

| Del | Plats |
|---|---|
| Lokalt terminalgränssnitt | `http://127.0.0.1:8790` |
| Program och byggt UI | `/opt/trainmeet-tkl` |
| Terminalprofil och cache | `/var/lib/trainmeet-tkl` |
| Terminaltjänst | `trainmeet-tkl.service` |
| Uppdateringstjänst | `trainmeet-tkl-update.service` |
| Kioskstart | `~/.config/labwc/autostart` |

### Felsökning

Kontrollera terminaltjänsten:

```bash
sudo systemctl status trainmeet-tkl.service
sudo journalctl -u trainmeet-tkl.service -n 100 --no-pager
```

Kontrollera att terminalens lokala gränssnitt svarar:

```bash
curl http://127.0.0.1:8790/terminal/config
```

Om servern inte hittas automatiskt, kontrollera att båda apparaterna ligger på samma lokala nätverk och skriv därefter TrainMeet Server-adressen manuellt i första-start-guiden, exempelvis `http://192.168.1.20:8787`.

Vid fel skärmorientering: öppna terminaladministrationen genom att hålla stationsnamnet i fem sekunder och byt mellan stående och liggande läge.

### Avinstallera

Avinstallationen är avsiktligt manuell så att terminalprofilen inte raderas av misstag:

```bash
sudo systemctl disable --now trainmeet-tkl.service
sudo rm /etc/systemd/system/trainmeet-tkl.service
sudo rm /etc/systemd/system/trainmeet-tkl-update.service
sudo rm /etc/polkit-1/rules.d/50-trainmeet-tkl-update.rules
sudo rm /usr/local/bin/trainmeet-tkl-kiosk
sudo rm /usr/local/sbin/trainmeet-tkl-update
sudo systemctl daemon-reload
```

Ta även bort raden med `trainmeet-tkl-kiosk` ur den vanliga användarens `~/.config/labwc/autostart`. Programmet finns kvar i `/opt/trainmeet-tkl` och profilen i `/var/lib/trainmeet-tkl` tills administratören uttryckligen väljer att radera dem.

## Drift och offline

TrainMeet Server är fortsatt ensam auktoritet. Terminalens lilla lokala tjänst hämtar `/v1/display`, sparar den senaste giltiga bilden och levererar den till UI:t. Om nätverket försvinner visas tydligt **Offline** och senaste kända läge, men alla trafikåtgärder spärras tills kontakten är tillbaka.

## Typografi – verifierad mot den körande Charlottendal-vyn

Beräknade stilar i den publicerade TrainMeet-sidan har jämförts med `TrainMeet-Design-Guide.md`:

| Element | Verklig stil |
|---|---|
| Brödtext | Inter 400, 16/24 px |
| Stationsnamn i navbar | Inter 600, 14/20 px, `tracking-tight` |
| TKL/Tambox/Inställningar | Inter 500, 12/16 px |
| Tid i tågrad | system-monospace 400, 14/20 px, tabular nums |
| Tågnummer | Inter 700, 18/28 px, `tracking-tight` |
| Sammanfattning | Inter 400, 14/20 px |
| Primär åtgärd | Inter 500, 14/20 px |

Designguidens princip är riktig: Inter är gränssnittets typsnitt och DM Sans är reserverat för TrainMeet-varumärket och särskilda navigeringsrubriker. Charlottendals operatörsvy använder inte DM Sans. Den tidigare webben deklarerade Inter men hämtade endast DM Sans från Google Fonts, vilket innebar att resultatet kunde bero på om Inter redan fanns installerat på enheten.

Detta projekt paketerar Inter 400/500/600/700 lokalt med `@fontsource/inter`. Därför blir typografin identisk på Mac, Raspberry Pi och en internetfrånkopplad mötesplats.

## Datagräns

- TrainMeet Server är ensam auktoritet för klocka, tidtabell, linjer och tågens positioner.
- TKL-klienten läser `/v1/display` och har ingen egen trafikdatabas.
- Den inbyggda demoträffen används endast när servern inte går att nå.
- Operativa skrivkommandon ska anslutas till TrainMeet Servers TKL-API. Previewlägets knapptryckningar stannar därför i webbläsaren och påverkar inte servern.

## Arkitektur

```text
TrainMeet TKL Terminal
  Chromium-kiosk
        │ 127.0.0.1:8790
        ▼
  Lokalt apparatlager
        │ HTTP på lokalt nätverk
        ▼
  TrainMeet Server
        │
        ├── träff och stationskonfiguration
        ├── tidtabell och gemensam klocka
        └── auktoritativ trafikstatus
```

TKL-terminalen har ingen egen trafikdatabas. Den lokala profilen beskriver endast vilken server och station apparaten tillhör samt dess namn och skärmorientering.

## Utveckling och tester

Krav: Node.js 22 och Python 3.12 eller senare rekommenderas.

```bash
npm ci
npm run build
python3 -m unittest discover -s tests -v
```

Varje publicering på `main` byggs och testas automatiskt med GitHub Actions.

Felrapporter och förbättringsförslag lämnas under [GitHub Issues](https://github.com/beahead-ab/trainmeet-tkl/issues).

## Licens

MIT © Beahead AB. Se [LICENSE](LICENSE).
