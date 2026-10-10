// Every user-visible text in TKL exists in en, sv, da, nb and de
// (scripts/i18n-audit.mjs, the same rules as TrainMeet Server's audit).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {auditTkl, tsxStrings, isLanguage} from '../scripts/i18n-audit.mjs';

const show = (entries) => entries.slice(0, 25).map((entry) => `${entry.missing ? entry.missing.join(',') + ' ' : ''}${JSON.stringify(entry.source)}\n    ${entry.places[0]}`).join('\n');

test('every visible TKL text has all five languages and goes through t()', () => {
  const {strings, missing, unwrapped} = auditTkl();
  assert.ok(strings > 150, `the audit found only ${strings} texts`);
  assert.equal(missing.length, 0, `add these to src/i18n/workspace-messages.js (or Server's translations/ui.txt):\n${show(missing)}`);
  assert.equal(unwrapped.length, 0, `these reach the page without t():\n${show(unwrapped)}`);
});

test('a row Server drops is missed before the copy reaches TKL', () => {
  // Server 4.0 nearly dropped "Öppna full TMBox-simulering" with the
  // simulation rows; TKL still shows it. Server's audit hands over the
  // catalogue it just built, and that must be what is checked.
  const vendored = fs.readFileSync(new URL('../src/i18n/messages.js', import.meta.url), 'utf8');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tkl-i18n-'));
  const messages = path.join(dir, 'messages.js');
  fs.writeFileSync(messages, vendored + '\nfor (const key of Object.keys(globalThis.TrainMeetMessages)) if (globalThis.TrainMeetMessages[key].sv === "Öppna full TMBox-simulering") delete globalThis.TrainMeetMessages[key];\n');
  try {
    const {missing} = auditTkl({messages});
    assert.deepEqual(missing.map((entry) => entry.source), ['Öppna full TMBox-simulering']);
  } finally {
    fs.rmSync(dir, {recursive: true, force: true});
  }
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
