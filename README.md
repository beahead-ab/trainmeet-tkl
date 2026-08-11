# TrainMeet TKL

Fristående operatörsklient för TrainMeet Server. Projektet återskapar Charlottendals TKL-vy från TrainMeet/Lovable och läser den lokala serverns gemensamma driftstatus.

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

`dist/` är en helt statisk applikation. Den är avsedd att distribueras från TrainMeet Server under `/tkl`, men kan också köras från en separat webbserver eller container.

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

