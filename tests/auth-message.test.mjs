import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
import vm from 'node:vm';

const source=await readFile(new URL('../src/auth-message.ts',import.meta.url),'utf8');
const {outputText}=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}});
const {authenticatedMessage}=await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);

test('hosted auth without a username is signed in without undefined or a made-up name',()=>{
  for(const status of [{access_mode:'external'},{access_mode:'local',username:null},{access_mode:'external',username:'  '}]) {
    assert.equal(authenticatedMessage(status),'Inloggad.');
  }
});
test('an actual username remains visible while paired terminal status remains distinct',()=>{
  assert.deepEqual(authenticatedMessage({access_mode:'external',username:' Anna '}),{source:'Inloggad som {name}.',values:{name:'Anna'}});
  assert.equal(authenticatedMessage({access_mode:'terminal',username:'Station A'}),'Terminalen är parkopplad och känns igen automatiskt.');
});
test('setup uses the safe identity message and the fallback exists in every supported language',async()=>{
  const app=await readFile(new URL('../src/App.tsx',import.meta.url),'utf8');
  assert.match(app,/messageText\(authenticatedMessage\(auth\)\)/);
  const translations=await readFile(new URL('../src/i18n/workspace-messages.js',import.meta.url),'utf8');
  const context=vm.createContext({});vm.runInContext(translations,context);
  for(const language of ['sv','en','da','nb','de']) assert.ok(context.TrainMeetMessages['Inloggad.'][language]);
});
