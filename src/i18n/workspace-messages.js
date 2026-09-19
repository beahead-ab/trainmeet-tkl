(() => {
  const rows = [
    {sv:'Hem',en:'Home',da:'Hjem',nb:'Hjem',de:'Startseite'},
    {sv:'Inloggad.',en:'Signed in.',da:'Logget ind.',nb:'Logget inn.',de:'Angemeldet.'},
    {sv:'Byt arbetsyta',en:'Change workspace',da:'Skift arbejdsområde',nb:'Bytt arbeidsområde',de:'Arbeitsbereich wechseln'},
    {sv:'Utloggningen misslyckades.',en:'Sign-out failed.',da:'Det lykkedes ikke at logge ud.',nb:'Utlogging mislyktes.',de:'Abmeldung fehlgeschlagen.'}
  ];
  globalThis.TrainMeetMessages ||= {};
  for(const row of rows) globalThis.TrainMeetMessages[row.sv]=row;
})();
