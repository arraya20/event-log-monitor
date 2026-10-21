import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { Monitor } from '../src/monitor.mjs';
import { StateStore } from '../src/store.mjs';
import { DEFAULT_CONTRACT, TRANSFER_TOPIC } from '../src/events.mjs';
import { createApi } from '../src/server.mjs';
import { McpClient, parseResponse } from '../src/mcp.mjs';
const hash = '0x' + 'ab'.repeat(32);
const log = { address: DEFAULT_CONTRACT, topics: [TRANSFER_TOPIC, '0x'+'0'.repeat(24)+'12'.repeat(20), '0x'+'0'.repeat(24)+'34'.repeat(20)], data: '0x'+'1'.padStart(64,'0'), transactionHash: '0x'+'cd'.repeat(32), blockHash: hash, blockNumber:'100',logIndex:'0',removed:false };
class FakeClient {
  head = 105; logs = [log, log]; calls = []; failLogs = false; blockHash = hash;
  async connect() {} async close() {}
  async call(name,args={}) {
    this.calls.push({name,args});
    if(name==='get_chain_info') return {chainId:1672};
    if(name==='get_block_number') return {blockNumber:String(this.head)};
    if(name==='get_code') return {code:'0x6000'};
    if(name==='eth_call') return {result:args.transaction.data==='0x313ce567'?'0x'+'6'.padStart(64,'0'):'0x'+'20'.padStart(64,'0')+'4'.padStart(64,'0')+Buffer.from('USDC').toString('hex').padEnd(64,'0')};
    if(name==='get_block') return {hash:this.blockHash};
    if(name==='get_logs') {if(this.failLogs)throw new Error('upstream failed');return this.logs;}
    throw new Error(name);
  }
}
async function fixture(t, options={}) {
 const dir=await mkdtemp(join(tmpdir(),'pharos-monitor-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const client=new FakeClient();const monitor=new Monitor({client,dataDir:dir,fromBlock:100,...options});await monitor.initialize();t.after(()=>monitor.close());return {monitor,client,dir};
}
test('filtered scan decodes and atomically checkpoints; duplicates removed',async t=>{
 const {monitor,client,dir}=await fixture(t);const result=await monitor.poll();assert.equal(result.newEvents,1);
 const args=client.calls.find(c=>c.name==='get_logs').args;
 assert.deepEqual(args,{address:DEFAULT_CONTRACT,topics:[TRANSFER_TOPIC],fromBlock:'100',toBlock:'100'});
 assert.equal(monitor.events()[0].amountRaw,'1');assert.equal(monitor.status.lastScannedBlock,100);
 const state=JSON.parse(await readFile(join(dir,'state.json'),'utf8'));assert.equal(state.nextBlock,101);assert.equal(state.events.length,1);
 assert.equal((await monitor.poll()).newEvents,0);
});
test('restart resumes checkpoint; same event not re-emitted',async t=>{
 const {monitor,dir}=await fixture(t);await monitor.poll();await monitor.close();
 const client=new FakeClient();client.head=110;client.logs=[];
 const next=new Monitor({client,dataDir:dir});await next.initialize();t.after(()=>next.close());
 await next.poll();assert.equal(client.calls.find(c=>c.name==='get_logs').args.fromBlock,'101');assert.equal(next.events().length,1);
});
test('failed query or malformed event never advances checkpoint',async t=>{
 const {monitor,client}=await fixture(t);client.failLogs=true;await assert.rejects(monitor.poll(),/upstream/);assert.equal(monitor.store.state.nextBlock,100);
 client.failLogs=false;client.logs=[{...log,data:'0x1'}];await assert.rejects(monitor.poll());assert.equal(monitor.store.state.nextBlock,100);
});
test('query range never exceeds configured chunk, stale lock and config mismatch rejected',async t=>{
 const {monitor,client,dir}=await fixture(t,{fromBlock:0,chunkSize:10});client.logs=[];await monitor.poll();
 const args=client.calls.find(c=>c.name==='get_logs').args;assert.equal(args.toBlock,'9');
 const other=new StateStore(dir,'wrong');await assert.rejects(other.open(),/locked/);
 await monitor.close();await assert.rejects(other.open(),/mismatch/);
});
test('reorg mismatch fails closed; live events distinguished from bootstrap',async t=>{
 const {monitor,client}=await fixture(t);await monitor.poll();client.blockHash='0x'+'ef'.repeat(32);
 await assert.rejects(monitor.poll(),/hash mismatch/);assert.equal(monitor.store.state.nextBlock,101);
 client.blockHash=hash;client.head=115;client.logs=[{...log,blockNumber:110,transactionHash:'0x'+'ef'.repeat(32)}];
 const result=await monitor.poll();assert.equal(result.liveEvents,1);assert.equal(monitor.events()[0].mode,'live');
});
test('API validates method, route, auth and no-store headers',async t=>{
 const {monitor}=await fixture(t);const server=createApi(monitor,{token:'test-only-secret'});server.listen(0,'127.0.0.1');await once(server,'listening');
 t.after(()=>new Promise(resolve=>server.close(resolve)));const base=`http://127.0.0.1:${server.address().port}`;
 assert.equal((await fetch(base+'/api/status')).status,401);
 const headers={authorization:'Bearer test-only-secret'};
 const r=await fetch(base+'/api/status',{headers});assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'no-store');assert.equal((await r.json()).chainId,1672);
 assert.equal((await fetch(base+'/api/status',{method:'POST',headers})).status,405);
 assert.equal((await fetch(base+'/api/status?url=https://example.com',{headers})).status,404);
});
test('MCP parses JSON and finite/streaming SSE with matching ID',async()=>{
 assert.equal((await parseResponse(new Response('{"id":1,"result":{}}',{headers:{'content-type':'application/json'}}),1)).id,1);
 const r=new Response('event: message\r\ndata: {"id":0,"result":{}}\r\n\r\ndata: {"id":2,"result":{"ok":true}}\r\n\r\n');
 assert.equal((await parseResponse(r,2)).result.ok,true);
});
test('MCP refuses write tools before any network operation',async()=>{
 let calls=0;const client=new McpClient({fetchImpl:()=>{calls++;throw new Error('unexpected');}});
 await assert.rejects(client.call('send_raw_transaction',{}),/Read-only/);assert.equal(calls,0);
});
