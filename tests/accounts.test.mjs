// TKL's own accounts (terminal/trainmeet_tkl_terminal.py): the owner is
// created at the first start, everyone signs in with the email address, the
// signal box is free at the machine and the administration is not.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
import vm from 'node:vm';

const options = {compilerOptions: {module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022}};
const demo = ts.transpileModule(await readFile(new URL('../src/demo.ts', import.meta.url), 'utf8'), options).outputText;
const demoURL = `data:text/javascript;base64,${Buffer.from(demo).toString('base64')}`;
const source = await readFile(new URL('../src/api.ts', import.meta.url), 'utf8');
const {outputText} = ts.transpileModule(source.replace('"./demo"', JSON.stringify(demoURL)), options);
const api = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');

const terminal = (status) => ({available: true, configured: true, at_the_machine: true, login_required: false, owner_setup_allowed: false, user: null, ...status});
const browser = (location, fetchImpl) => {
  const events = [];
  globalThis.window = {setTimeout, clearTimeout, location, dispatchEvent: (event) => events.push(event.type), localStorage: {getItem: () => null, setItem() {}}};
  globalThis.fetch = fetchImpl;
  return events;
};

test('the demo and the managed browser have no accounts and never ask the terminal', async () => {
  for (const location of [{pathname: '/tkl/', search: '?mode=demo', origin: 'http://local'}, {pathname: '/tkl/', search: '', origin: 'http://local'}]) {
    const requests = [];
    browser(location, async (path) => { requests.push(path); throw new Error('no network'); });
    assert.deepEqual(await api.loadSession(), api.noAccounts);
    assert.deepEqual(requests, []);
  }
});

test('without a terminal service there is nothing to sign in to, so everything stays as before', async () => {
  browser({pathname: '/', search: '', origin: 'http://127.0.0.1:8790'}, async () => ({ok: false, status: 404, json: async () => ({message: 'Sidan finns inte'})}));
  assert.deepEqual(await api.loadSession(), api.noAccounts);
  assert.equal(api.mayOperate(api.noAccounts), true);
  assert.equal(api.canAdminister(api.noAccounts), true);
});

test('the terminal says who may operate and who may administer', async () => {
  browser({pathname: '/', search: '', origin: 'http://127.0.0.1:8790'}, async () => ({ok: true, status: 200, json: async () => ({configured: true, at_the_machine: true, login_required: false, owner_setup_allowed: false, user: null})}));
  const atTheMachine = await api.loadSession();
  assert.equal(atTheMachine.available, true);
  assert.equal(api.mayOperate(atTheMachine), true, 'the signal box is free at the machine');
  assert.equal(api.canAdminister(atTheMachine), false, 'the administration is not');

  const web = terminal({at_the_machine: false, login_required: true});
  assert.equal(api.mayOperate(web), false, 'over the web nothing runs before a sign-in');
  for (const [role, operate, administer] of [['operator', true, false], ['admin', true, true], ['owner', true, true]]) {
    const session = {...web, user: {user_id: '1', display_name: 'Anna', email: 'anna@example.se', role, password_configured: true, invitation_pending: false}};
    assert.equal(api.mayOperate(session), operate, role);
    assert.equal(api.canAdminister(session), administer, role);
  }
  assert.equal(api.mayOperate(null), false);
});

test('the owner, the sign-in and the code all go to the terminal with the address, never a username', async () => {
  const requests = [];
  browser({pathname: '/', search: '', origin: 'http://127.0.0.1:8790'}, async (path, init) => {
    requests.push({path, init});
    return {ok: true, status: 200, json: async () => ({configured: true, at_the_machine: true, login_required: false, owner_setup_allowed: false, user: {role: 'owner'}})};
  });
  const created = await api.createOwner({display_name: 'Casper', email: ' Casper@Example.se ', password: 'ett-langt-losenord'});
  assert.equal(created.available, true);
  assert.equal(created.user.role, 'owner');
  await api.signIn(' casper@example.se ', 'ett-langt-losenord');
  await api.redeemInvitation('anna@example.se', ' abcd-efgh ', 'annas-losenord');
  await api.signOut();
  assert.deepEqual(requests.map((r) => r.path), ['/terminal/setup/owner', '/terminal/login', '/terminal/redeem', '/terminal/logout']);
  assert.deepEqual(JSON.parse(requests[0].init.body), {display_name: 'Casper', email: 'Casper@Example.se', password: 'ett-langt-losenord'});
  assert.deepEqual(JSON.parse(requests[1].init.body), {email: 'casper@example.se', password: 'ett-langt-losenord'});
  assert.deepEqual(JSON.parse(requests[2].init.body), {email: 'anna@example.se', code: 'abcd-efgh', password: 'annas-losenord'});
  for (const request of requests) {
    assert.equal(request.init.method, 'POST');
    assert.equal(request.init.credentials, 'same-origin', 'the session cookie travels with every call');
    assert.ok(!('username' in (JSON.parse(request.init.body) || {})));
  }
});

test('the users are the owner\'s: invite, new code, role and removal', async () => {
  const requests = [];
  browser({pathname: '/', search: '', origin: 'http://127.0.0.1:8790'}, async (path, init) => {
    requests.push({path, init});
    return {ok: true, status: 200, json: async () => ({users: [], user: {}, code: 'ABCD-EFGH', removed: true})};
  });
  await api.listUsers();
  assert.equal((await api.inviteUser({display_name: 'Anna', email: ' anna@example.se', role: 'operator'})).code, 'ABCD-EFGH');
  await api.reissueInvitation('u1');
  await api.updateUser({user_id: 'u1', role: 'admin'});
  await api.deleteUser('u1');
  await api.changePassword('gammalt', 'nytt-losenord');
  assert.deepEqual(requests.map((r) => [r.path, r.init?.method ?? 'GET']), [
    ['/terminal/users', 'GET'], ['/terminal/users', 'POST'], ['/terminal/users/reissue', 'POST'],
    ['/terminal/users/update', 'POST'], ['/terminal/users/delete', 'POST'], ['/terminal/password', 'POST'],
  ]);
  assert.deepEqual(JSON.parse(requests[1].init.body), {display_name: 'Anna', email: 'anna@example.se', role: 'operator'});
  assert.deepEqual(JSON.parse(requests[5].init.body), {current_password: 'gammalt', new_password: 'nytt-losenord'});
});

test('a sign-in that ran out asks for it again instead of treating the station as lost', async () => {
  const events = browser({pathname: '/', search: '', origin: 'http://127.0.0.1:8790'}, async (path) => ({
    ok: false, status: 401,
    json: async () => path.startsWith('/terminal/') ? {error: 'authentication_required', message: 'Inloggning krävs'} : {message: 'Administratörsinloggning krävs'},
  }));
  await assert.rejects(api.loadTklContext('cda'), (error) => error.code === 'authentication_required' && error.status === 401);
  assert.deepEqual(events, ['trainmeet:session-expired']);
  assert.match(app, /error instanceof APIError && error\.code === "authentication_required"\) return;/, 'the station view lets the sign-in view take over');
  assert.match(app, /addEventListener\("trainmeet:session-expired", expired\)/);
});

test('the screens: owner first, then sign-in over the web, administrator for the settings', () => {
  assert.match(app, /session\.available && !session\.configured && \(!terminalConfig\?\.configured \|\| !session\.at_the_machine\)/, 'the owner is created at the first start, and a paired terminal keeps running at the machine');
  assert.match(app, /if \(initialConfig \|\| !operating\) return;\n\s*void loadTerminalConfig\(\)/, 'the profile is read only once the screen may operate: over the web, after the sign-in');
  assert.match(app, /session\.available && session\.login_required && !session\.user\) return <SignInView/, 'over the web nothing shows before a sign-in');
  assert.match(app, /session\.available && !canAdminister\(session\)\) return <SignInView[^>]*admin/, 'the first installation is administration');
  assert.match(app, /overlay === "settings" && canAdminister\(session\) &&/, 'the settings open for an administrator or the owner');
  assert.match(app, /overlay === "settings" && session\.available && session\.configured && !canAdminister\(session\) &&/, 'and ask everybody else to sign in');
  assert.match(app, /overlay === "settings" && session\.available && !session\.configured &&/, 'or to create the owner when there is none');
  assert.match(app, /<UsersPanel session=\{session\} \/>/);
  assert.match(app, /if \(!terminalConfig\?\.configured \|\| !operating\) return;/, 'the terminal is not asked for anything before the screen may operate');
  assert.doesNotMatch(app, /t\("Användarnamn"\)/, 'the account is the email address');
  for (const field of ['placeholder={t("E-postadress")} type="email"', 'placeholder={t("Nuvarande lösenord")}', 'placeholder={t("Kod")} autoComplete="one-time-code"']) assert.ok(app.includes(field), field);
});

test('every account text has all five offline translations', () => {
  const context = {navigator: {languages: ['sv-SE']}};
  vm.createContext(context);
  for (const file of ['messages.js', 'workspace-messages.js', 'core.js']) vm.runInContext(fs.readFileSync(new URL('../src/i18n/' + file, import.meta.url), 'utf8'), context);
  for (const locale of ['sv', 'en', 'da', 'nb', 'de']) {
    context.TrainMeetI18n.setLanguage(locale);
    for (const text of ['Skapa ägaren', 'Klarerare', 'Jag har en kod', 'Logga in som administratör', 'Fel e-postadress eller lösenord', 'Inloggning krävs', 'Ny kod']) {
      assert.ok(context.TrainMeetI18n.t(text));
      if (locale !== 'sv') assert.notEqual(context.TrainMeetI18n.t(text), text, `${text} in ${locale}`);
    }
  }
});
