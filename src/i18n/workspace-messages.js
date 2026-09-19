(() => {
  const rows = [
    {"sv":"Stationen tilldelas av administratören på servern.","en":"The server administrator assigns the station.","da":"Stationen tildeles af administratoren på serveren.","nb":"Stasjonen tildeles av administratoren på serveren.","de":"Der Serveradministrator weist den Bahnhof zu."},
    {"sv":"Väntar på administratören","en":"Waiting for the administrator","da":"Venter på administratoren","nb":"Venter på administratoren","de":"Warten auf den Administrator"},
    {"sv":"Visa enhetskoden för administratören. Stationen tilldelas på TrainMeet Server.","en":"Show the device code to the administrator. The station is assigned on TrainMeet Server.","da":"Vis enhedskoden til administratoren. Stationen tildeles på TrainMeet Server.","nb":"Vis enhetskoden til administratoren. Stasjonen tildeles på TrainMeet Server.","de":"Zeige dem Administrator den Gerätecode. Der Bahnhof wird auf TrainMeet Server zugewiesen."},
    {"sv":"Du kan inte påverka trafiken innan en station har tilldelats.","en":"You cannot control traffic until a station has been assigned.","da":"Du kan ikke styre trafikken, før en station er tildelt.","nb":"Du kan ikke styre trafikken før en stasjon er tildelt.","de":"Ohne zugewiesenen Bahnhof kannst du den Betrieb nicht steuern."},
    {sv:'Byt demostation',en:'Change demo station',da:'Skift demostation',nb:'Bytt demostasjon',de:'Demobahnhof wechseln'},
    {sv:'Fristående demo med två övningsstationer. Inget skickas till trafikspelet.',en:'Standalone demo with two practice stations. Nothing is sent to the live operating session.',da:'Selvstændig demo med to øvelsesstationer. Intet sendes til trafikspillet.',nb:'Frittstående demo med to øvingsstasjoner. Ingenting sendes til trafikkspillet.',de:'Eigenständige Demo mit zwei Übungsbahnhöfen. Es wird nichts an den laufenden Betrieb gesendet.'},
    {sv:'Fristående demo',en:'Standalone demo',da:'Selvstændig demo',nb:'Frittstående demo',de:'Eigenständige Demo'},
    {sv:'TKL Demo – påverkar inte träffen',en:'TKL Demo – does not affect the meet',da:'TKL Demo – påvirker ikke træffet',nb:'TKL Demo – påvirker ikke treffet',de:'TKL Demo – ohne Auswirkung auf das Treffen'},
    {sv:'Börja om demo',en:'Restart demo',da:'Start demo forfra',nb:'Start demo på nytt',de:'Demo neu starten'},
    {sv:'Klockan står på 06:00. Öva med direktklarering och byt demostation för att ta emot tåget.',en:'The clock stays at 06:00. Practise direct dispatch and switch demo stations to receive the train.',da:'Uret står på 06:00. Øv direkte afsendelse, og skift demostation for at modtage toget.',nb:'Klokken står på 06:00. Øv direkte avgang, og bytt demostasjon for å ta imot toget.',de:'Die Uhr steht auf 06:00. Üben Sie direkte Abfahrten und wechseln Sie den Demobahnhof, um den Zug anzunehmen.'},
    {sv:'Hem',en:'Home',da:'Hjem',nb:'Hjem',de:'Startseite'},
    {sv:'Inloggad.',en:'Signed in.',da:'Logget ind.',nb:'Logget inn.',de:'Angemeldet.'},
    {sv:'Byt arbetsyta',en:'Change workspace',da:'Skift arbejdsområde',nb:'Bytt arbeidsområde',de:'Arbeitsbereich wechseln'},
    {sv:'Utloggningen misslyckades.',en:'Sign-out failed.',da:'Det lykkedes ikke at logge ud.',nb:'Utlogging mislyktes.',de:'Abmeldung fehlgeschlagen.'}
  ];
  globalThis.TrainMeetMessages ||= {};
  for(const row of rows) globalThis.TrainMeetMessages[row.sv]=row;
})();
