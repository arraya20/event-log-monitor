import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onRequest } from '../functions/api/[[path]].js';
const request = (path, init) => new Request(`https://monitor.example${path}`, init);
const context = (req, env, fetchImpl) => ({ request: req, env, next: () => new Response('next'), functionPath: '', waitUntil() {}, passThroughOnException() {}, });
test('Pages proxy only forwards allowlisted collector routes with secret', async () => {
 const calls=[];const old=globalThis.fetch;globalThis.fetch=async (url,init)=>{calls.push({url:String(url),init});return new Response(JSON.stringify({ok:true}),{status:200,headers:{'content-type':'application/json'}})};
 try { const response=await onRequest(context(request('/api/status'),{COLLECTOR_ORIGIN:'https://collector.example',COLLECTOR_TOKEN:'secret'}));assert.equal(response.status,200);assert.equal(calls[0].url,'https://collector.example/api/status');assert.equal(calls[0].init.headers.authorization,'Bearer secret');assert.equal(response.headers.get('cache-control'),'no-store'); } finally {globalThis.fetch=old;}
});
test('Pages proxy rejects query/path/method and bad origin without fetching', async()=>{
 const old=globalThis.fetch;globalThis.fetch=async()=>{throw new Error('must not fetch')};
 try {assert.equal((await onRequest(context(request('/api/status?x=https://evil'),{},{ }))).status,404);assert.equal((await onRequest(context(request('/api/other'),{},{}))).status,404);assert.equal((await onRequest(context(request('/api/status',{method:'POST'}),{},{}))).status,405);assert.equal((await onRequest(context(request('/api/events'),{COLLECTOR_ORIGIN:'http://127.0.0.1:8791'},{}))).status,503); } finally {globalThis.fetch=old;}
});
test('Pages proxy hides upstream failure and caps oversized response', async()=>{
 const old=globalThis.fetch;globalThis.fetch=async()=>new Response('x'.repeat(1_000_001),{status:200});
 try {const response=await onRequest(context(request('/api/events'),{COLLECTOR_ORIGIN:'https://collector.example'},{}));assert.equal(response.status,502);assert.equal((await response.json()).error,'Collector unavailable');} finally {globalThis.fetch=old;}
});
