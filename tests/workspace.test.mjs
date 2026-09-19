import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../src/App.tsx',import.meta.url),'utf8');
test('TKL Home stays in current workspace without resetting station or credentials',()=>{
  assert.match(source,/aria-label=\{t\("Hem"\)\} onClick=\{onHome\}/);
  assert.match(source,/onHome=\{\(\) => \{ setOverlay\(null\); setSelectedTrain\(null\); setFreightMode\(false\); window.scrollTo\(\{top: 0\}\); \}\}/);
  assert.doesNotMatch(source,/aria-label=\{t\("Tillbaka"\)\} onClick=.*location.href/);
  assert.match(source,/sessionStorage.setItem\("trainmeet.workspace", "tkl"\)/);
});
test('server-hosted TKL uses explicit workspace navigation, separate from runtime commands',()=>{
  for(const route of ['/#settings','/#screens','/#workspaces'])assert.ok(source.includes(`href="${route}"`));
  assert.match(source,/window.location.pathname.startsWith\("\/tkl\/"\)/);
});
test('workspace labels have all five offline translations',()=>{
  const context={navigator:{languages:['sv-SE']}};vm.createContext(context);
  for(const file of ['messages.js','workspace-messages.js','core.js'])vm.runInContext(fs.readFileSync(new URL('../src/i18n/'+file,import.meta.url),'utf8'),context);
  for(const locale of ['sv','en','da','nb','de']){
    context.TrainMeetI18n.setLanguage(locale);
    for(const text of ['Hem','Byt arbetsyta','Utloggningen misslyckades.']){
      assert.ok(context.TrainMeetI18n.t(text));
      if(locale!=='sv')assert.notEqual(context.TrainMeetI18n.t(text),text);
    }
  }
});
