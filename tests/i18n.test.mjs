import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
test('all five terminal languages are available offline', () => {
  const context = {navigator:{languages:['sv-SE']}};
  vm.createContext(context);
  for (const name of ['messages.js','core.js']) vm.runInContext(fs.readFileSync(new URL('../src/i18n/'+name,import.meta.url),'utf8'),context);
  for(const [id,expected] of [['sv','Spara'],['da','Gem'],['nb','Lagre'],['en','Save'],['de','Speichern']]) {
    context.TrainMeetI18n.setLanguage(id);
    assert.equal(context.TrainMeetI18n.t('Spara'),expected);
  }
});
test('preflight identity is never a translated value', () => {
  assert.match(source,/label: "Träffklocka", ok:/);
  assert.doesNotMatch(source,/label: t\("Träffklocka"\), ok:/);
  assert.match(source,/t\(check\.label\)/);
});
