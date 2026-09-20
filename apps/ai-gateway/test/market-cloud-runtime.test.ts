import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('../cloud/portfolioMarket/index.js', import.meta.url), 'utf8');
test('market bootstrap provides fetch and timeout on Node 16 without replacing native implementations', () => {
 const bootstrap = source.slice(0, source.indexOf("const cloud ="));
 const fetcher = () => {}; const requested: string[] = [];
 const context = vm.createContext({ require: (name: string) => { requested.push(name); return { fetch: fetcher }; }, AbortSignal: {}, AbortController, setTimeout, clearTimeout });
 vm.runInContext(bootstrap, context);
 assert.equal(context.fetch, fetcher); assert.deepEqual(requested,['undici']);
 assert.equal(typeof context.AbortSignal.timeout,'function'); assert.equal(context.AbortSignal.timeout(1).aborted,false);
 vm.runInContext(bootstrap, context); assert.equal(requested.length,1);
});

test('AI bootstrap supplies fetch on Node 16 before loading providers', () => {
 const source=readFileSync(new URL('../cloud/portfolioAi/index.js',import.meta.url),'utf8');
 const fetcher=()=>{};let calls=0;const context=vm.createContext({require:(name:string)=>{assert.equal(name,'undici');calls++;return {fetch:fetcher};}});
 vm.runInContext(source.slice(0,source.indexOf('const cloud =')),context);assert.equal(context.fetch,fetcher);
 vm.runInContext(source.slice(0,source.indexOf('const cloud =')),context);assert.equal(calls,1);
});
