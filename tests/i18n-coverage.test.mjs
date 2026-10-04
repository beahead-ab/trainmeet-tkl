// Every user-visible text in TKL exists in en, sv, da, nb and de
// (scripts/i18n-audit.mjs, the same rules as TrainMeet Server's audit).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {auditTkl, tsxStrings, isLanguage} from '../scripts/i18n-audit.mjs';

const show = (entries) => entries.slice(0, 25).map((entry) => `${entry.missing ? entry.missing.join(',') + ' ' : ''}${JSON.stringify(entry.source)}\n    ${entry.places[0]}`).join('\n');

test('every visible TKL text has all five languages and goes through t()', () => {
  const {strings, missing, unwrapped} = auditTkl();
  assert.ok(strings > 150, `the audit found only ${strings} texts`);
  assert.equal(missing.length, 0, `add these to src/i18n/workspace-messages.js (or Server's translations/ui.txt):\n${show(missing)}`);
  assert.equal(unwrapped.length, 0, `these reach the page without t():\n${show(unwrapped)}`);
});

test('the rules see what React would show untranslated', () => {
  const kinds = Object.fromEntries(tsxStrings(`
    const say = (text: string) => t(text);
    export function View({busy}: {busy: boolean}) {
      console.error("Bara i konsolen", busy);
      if (busy) throw new Error("Det gick inte att spara.");
      return <section aria-label="Rakt in">
        <h1>{t("Översatt rubrik")}</h1>
        <p>Text utan t()</p>
        <p>{busy && "Väntar på svar"}</p>
        <p>{say("Via hjälpare")}</p>
        <p>{t(\`Byggd \${busy}\`)}</p>
      </section>;
    }`, 'View.tsx').map((item) => [item.source, item.kind]));
  assert.equal(kinds['Översatt rubrik'], 't()');
  assert.equal(kinds['Via hjälpare'], 'say()');
  assert.equal(kinds['Det gick inte att spara.'], 'Error()');
  for (const text of ['Rakt in', 'Text utan t()', 'Väntar på svar']) assert.equal(kinds[text], 'unwrapped', text);
  assert.equal(kinds['Bara i konsolen'], undefined);
  assert.ok(Object.keys(kinds).some((text) => text.startsWith('`Byggd')), 'a key built at run time is reported');
  for (const neutral of ['TrainMeet TKL', '06:00', '{count}', 'http://trainmeet.local:8787']) assert.equal(isLanguage(neutral), false, neutral);
});
