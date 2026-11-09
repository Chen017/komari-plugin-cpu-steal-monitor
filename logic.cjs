'use strict';
const PERIOD_MS=120000,RETENTION_MS=90*86400000;
function parseCounters(output){
 if(typeof output!=='string')return null;
 for(const line of output.split(/\r?\n/)){
  const m=/^STEALV1 ([0-9]+) ([0-9]+)$/.exec(line.trim());if(!m)continue;
  const total=Number(m[1]),steal=Number(m[2]);
  if(Number.isSafeInteger(total)&&Number.isSafeInteger(steal)&&total>0&&steal>=0&&steal<=total)return{total,steal};
 }
 return null;
}
function delta(prev,curr){
 if(!prev||!curr)return null;
 const elapsed=curr.time-prev.time;
 if(elapsed<75000||elapsed>180000)return null;
 const total=curr.total-prev.total,steal=curr.steal-prev.steal;
 if(total<=0||steal<0||steal>total)return null;
 return{from:prev.time,time:curr.time,value:100*steal/total};
}
function normalizeNodes(raw){
 const rows=Array.isArray(raw)?raw.map(v=>['',v]):Object.entries(raw||{}),res=new Map();
 for(const [key,v]of rows){
  if(!v||typeof v!=='object')continue;
  const uuid=String(v.uuid||v.id||v.client_id||key||'');
  if(uuid&&uuid.length<=128)res.set(uuid,{uuid,hidden:Boolean(v.hidden)});
 }
 return res;
}
function normalizeResults(raw){
 const val=raw&&typeof raw==='object'&&raw.results?raw.results:raw;
 const rows=Array.isArray(val)?val.map(v=>['',v]):Object.entries(val||{}),res=new Map();
 for(const [key,v]of rows){
  if(!v||typeof v!=='object')continue;
  const uuid=String(v.client||v.client_id||v.client_uuid||v.clientId||v.uuid||v.id||key||'');
  if(!uuid)continue;
  const output=typeof v.stdout==='string'?v.stdout:typeof v.output==='string'?v.output:typeof v.result==='string'?v.result:'';
  const terminal=typeof v.exit_code==='number'||typeof v.exitCode==='number'||Boolean(v.finished_at)||['completed','failed','timeout','error','finished'].includes(String(v.status||'').toLowerCase());
  const failed=(typeof v.exit_code==='number'&&v.exit_code!==0)||(typeof v.exitCode==='number'&&v.exitCode!==0)||v.success===false;
  res.set(uuid,{output,terminal,failed});
 }
 return res;
}
function append(state,uuid,sample,now){
 const prev=Array.isArray(state.nodes[uuid])?state.nodes[uuid]:[];
 state.nodes[uuid]=[...prev.filter(s=>s.time>=now-RETENTION_MS),sample].slice(-64800);
}
module.exports={PERIOD_MS,RETENTION_MS,parseCounters,delta,normalizeNodes,normalizeResults,append};
