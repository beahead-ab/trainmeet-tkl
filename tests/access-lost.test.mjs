import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';

const source = await readFile(new URL('../src/access-lost.ts', import.meta.url), 'utf8');
const {outputText} = ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022}});
const {accessLost} = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);

test('removed under Klienter, or a new meet without the station: ask for the code again', () => {
  for (const message of ['Terminalen har inte tillgång till stationen', 'Parkopplingen gäller inte längre', 'HTTP Error 403: Forbidden', 'HTTP Error 401: Unauthorized',
    'Inloggning krävs', 'Authentication required', 'Saknar behörighet']) {
    assert.equal(accessLost(message), true, message);
  }
});

test('an unreachable or busy Server is not lost access', () => {
  for (const message of ['TrainMeet Server kunde inte nås: <urlopen error [Errno 111] Connection refused>', 'Servern är inte tillgänglig',
    'Sträckan är redan upptagen', 'timed out', 'HTTP Error 404: Not Found', 'Tåg 4013 saknas']) {
    assert.equal(accessLost(message), false, message);
  }
});

test('the station view uses it', async () => {
  const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.match(app, /accessLost\(error\.message\)/);
});
