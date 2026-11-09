import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const L=createRequire(import.meta.url)('../logic.cjs');
test('reads valid cumulative counters',()=>{
 assert.deepEqual(L.parseCounters('STEALV1 10000 400\n'),{total:10000,steal:400});
 assert.equal(L.parseCounters('STEALV1 4 5'),null);
 assert.equal(L.parseCounters('unknown'),null);
});
test('delta of /proc/stat CPU counters',()=>{
 assert.deepEqual(L.delta({time:0,total:1000,steal:20},{time:120000,total:3000,steal:120}),{from:0,time:120000,value:5});
});
test('initial, missed ticks, reboot do not fabricate data',()=>{
 assert.equal(L.delta(null,{time:120000,total:3000,steal:3}),null);
 assert.equal(L.delta({time:0,total:100,steal:2},{time:240000,total:200,steal:4}),null);
 assert.equal(L.delta({time:0,total:1000,steal:30},{time:120000,total:10,steal:1}),null);
});
test('node list normalization and task status',()=>{
 assert.equal(L.normalizeNodes({id1:{hidden:true}}).get('id1').hidden,true);
 assert.equal(L.normalizeNodes([{uuid:'id2'}]).get('id2').hidden,false);
 const items=L.normalizeResults({id1:{stdout:'STEALV1 100 3',exit_code:0},id2:{status:'running'}});
 assert.equal(items.get('id1').terminal,true);
 assert.equal(items.get('id2').terminal,false);
});
test('real Komari TaskResult array uses client, result and exit_code',()=>{
 const rows=[
  {task_id:'task-a',client:'node-uuid-1',result:'STEALV1 12000 20\n',exit_code:0,finished_at:'2026-11-09T04:20:00Z'},
  {task_id:'task-a',client:'node-uuid-2',result:'',exit_code:null,finished_at:null},
 ];
 const output=L.normalizeResults(rows);
 assert.equal(output.size,2);
 assert.equal(output.get('node-uuid-1').output,rows[0].result);
 assert.equal(output.get('node-uuid-1').terminal,true);
 assert.equal(output.get('node-uuid-1').failed,false);
 assert.equal(output.get('node-uuid-2').terminal,false);
 assert.deepEqual(L.parseCounters(output.get('node-uuid-1').output),{total:12000,steal:20});
});
test('history retention',()=>{
 const state={nodes:{a:[{time:0,from:0,value:1}]}};
 L.append(state,'a',{from:90*86400000,time:90*86400000+120000,value:2},90*86400000+120000);
 assert.equal(state.nodes.a.length,1);
});
