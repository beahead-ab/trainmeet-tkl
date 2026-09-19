import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const source=await readFile(new URL('../src/api.ts',import.meta.url),'utf8');
const options={compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}};
const demo=ts.transpileModule(await readFile(new URL('../src/demo.ts',import.meta.url),'utf8'),options).outputText;
const demoURL=`data:text/javascript;base64,${Buffer.from(demo).toString('base64')}`;
const {outputText}=ts.transpileModule(source.replace('"./demo"',JSON.stringify(demoURL)),options);
const api=await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
test('every TKL write sends the generation of the context the operator acted on, never a fresh lookup',async()=>{
  const requests=[];globalThis.window={setTimeout,clearTimeout,dispatchEvent(){}};
  globalThis.fetch=async(path,options)=>{requests.push({path,options});return {ok:true,json:async()=>({shift:{},movement:{},connection:{}})};};
  const context={meet_generation:17};
  for(const method of ['startTklShift','finishTklShift','updateTklMovement','performTklLineAction']) {
    const input={meet_generation:context.meet_generation,station_id:'a'};
    context.meet_generation=18;
    await api[method](input);
    assert.equal(JSON.parse(requests.at(-1).options.body).meet_generation,input.meet_generation);
  }
  assert.equal(requests.length,4);assert.ok(requests.every(r=>r.options.method==='POST'));
});
test('hosted fallback preserves scope and stale rejection refreshes context without replaying',async()=>{
  const requests=[],events=[];globalThis.window={setTimeout,clearTimeout,dispatchEvent:event=>events.push(event.type)};
  globalThis.fetch=async(path,options)=>{requests.push({path,options});return {ok:false,status:path.startsWith('/terminal')?404:409,json:async()=>({message:'Meet changed'})};};
  await assert.rejects(api.performTklLineAction({meet_generation:3,station_id:'a',action:'depart'}),/Meet changed/);
  assert.equal(requests.length,2);
  assert.equal(requests[1].path,'/v1/tkl/line');
  assert.equal(JSON.parse(requests[1].options.body).meet_generation,3);
  assert.deepEqual(events,['trainmeet:context-stale']);
});
test('rendered action handlers pass their own displayed context generation',async()=>{
  const app=await readFile(new URL('../src/App.tsx',import.meta.url),'utf8');
  for(const match of app.matchAll(/await (?:startTklShift|finishTklShift|performTklLineAction|updateTklMovement)\(\{([\s\S]*?)\}\)/g)) {
    assert.match(match[1],/meet_generation: tklContext.meet_generation/);
  }
  assert.match(app,/addEventListener\("trainmeet:context-stale", refreshContext\)/);
});

test('managed browser enrolls once, waits for admin and never uses admin cookies or a local station override',async()=>{
 const requests=[],storage=new Map();
 storage.set('trainmeet-tkl.browser-config',JSON.stringify({station_id:'malicious-local-choice',configured:true}));
 globalThis.window={setTimeout,clearTimeout,location:{pathname:'/tkl/',search:'',origin:'http://local'},
  localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},dispatchEvent(){}};
 let station=null,revoked=false;
 globalThis.fetch=async(path,options)=>{
  requests.push({path,options});
  assert.equal(options.credentials,'omit');
  if(path==='/v1/browser-clients')return {ok:true,json:async()=>({client_id:'client-one',device_code:'WEB-ONE',access_token:'scoped-token',workspace:'tkl',station_id:null})};
  assert.equal(options.headers.Authorization,'Bearer scoped-token');
  if(revoked)return {ok:false,status:401,json:async()=>({message:'Revoked'})};
  if(path==='/v1/browser-clients/self')return {ok:true,json:async()=>({client_id:'client-one',device_code:'WEB-ONE',workspace:'tkl',station_id:station})};
  return {ok:true,json:async()=>({connection:{}})};
 };
 const [one,two]=await Promise.all([api.loadTerminalConfig(),api.loadTerminalConfig()]);
 assert.equal(one.configured,false);assert.equal(two.device_code,'WEB-ONE');
 assert.equal(requests.filter(r=>r.path==='/v1/browser-clients').length,1);
 await assert.rejects(api.saveTerminalConfig({...one,station_id:'a'}),/administratören/);
 await assert.rejects(api.resetTerminalConfig(),/administratören/);
 station='station-b';
 const assigned=await api.loadTerminalConfig();
 assert.equal(assigned.station_id,'station-b');assert.equal(assigned.configured,true);
 await api.performTklLineAction({meet_generation:3,station_id:'station-b',action:'request'});
 assert.equal(requests.at(-1).path,'/v1/tkl/line');
 assert.ok(!requests.some(r=>r.path.startsWith('/terminal')));
 revoked=true;
 await assert.rejects(api.loadTerminalConfig(),/Revoked/);
 assert.equal(requests.filter(r=>r.path==='/v1/browser-clients').length,1,'Revoked identity must not self-register again');
});
