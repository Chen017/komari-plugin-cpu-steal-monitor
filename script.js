'use strict';
// Runs directly in Komari's JS runtime. No user-controlled shell commands.
const server=require('server'),fs=require('fs'),path=require('path'),L=require('./logic.cjs');
const COMMAND="LC_ALL=C awk 'NR==1 && $1==\"cpu\" {total=0;for(i=2;i<=9;i++)total+=$i;printf(\"STEALV1 %.0f %.0f\\n\",total,$9);exit}' /proc/stat";
const ROUTE='/api/plugin/cpu-steal-monitor/v1/history';
let state={schemaVersion:1,nodes:{}},baselines=new Map(),running=false,stopped=false,file='';
function initStorage(){
 const dir=typeof __storageDir__==='string'&&__storageDir__?__storageDir__:'data/plugin-data/cpu-steal-monitor';
 fs.mkdirSync(dir,{recursive:true});file=path.join(dir,'history.json');
 if(!fs.existsSync(file))return;
 const saved=JSON.parse(fs.readFileSync(file,'utf8'));
 if(saved.schemaVersion!==1||!saved.nodes||typeof saved.nodes!=='object')throw Error('Invalid history file (preserved; not overwritten)');
 state=saved;
}
function save(){
 fs.writeFileSync(file+'.tmp',JSON.stringify(state),{encoding:'utf8',mode:0o600});
 fs.renameSync(file+'.tmp',file);
}
function json(res,status,data){
 res.statusCode=status;res.setHeader('Content-Type','application/json; charset=utf-8');
 res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
 res.end(JSON.stringify(data));
}
async function allowed(req,uuid){
 const p=req&&req.context&&req.context.principal;
 if(p&&((p.type==='user'&&(p.roles||[]).includes('admin'))||p.type==='api_key'||p.is_api_key===true))return true;
 const settings=await server.call('public:getPublicSettings');
 if(!settings||settings.private_site!==false)return false;
 const node=L.normalizeNodes(await server.call('common:getNodes')).get(uuid);
 return Boolean(node&&!node.hidden);
}
async function history(req,res){
 try{
  const q=req.query||{},uuid=typeof q.uuid==='string'?q.uuid:'';
  if(!uuid||uuid.length>128)return json(res,400,{error:'Invalid UUID'});
  if(!await allowed(req,uuid))return json(res,403,{error:'Forbidden'});
  const now=Date.now(),from=q.from===undefined?now-3600000:Number(q.from),to=q.to===undefined?now:Number(q.to);
  if(!Number.isFinite(from)||!Number.isFinite(to)||from>to||to-from>L.RETENTION_MS+600000||to>now+600000)return json(res,400,{error:'Invalid time range'});
  return json(res,200,{schemaVersion:1,uuid,intervalSeconds:120,samples:(state.nodes[uuid]||[]).filter(s=>s.time>=from&&s.from<=to)});
 }catch(e){console.error('[CPU-STEAL] API',String(e));return json(res,503,{error:'Unavailable'});}
}
async function execAll(ids){
 const task=await server.call('admin:exec',{command:COMMAND,clients:ids});
 const taskId=String(task&&(task.task_id||task.taskId)||'');
 if(!taskId)throw Error('Missing task ID');
 const done=new Map(),deadline=Date.now()+25000;
 while(!stopped&&Date.now()<deadline&&done.size<ids.length){
  const rows=L.normalizeResults(await server.call('admin:getTaskResultsByTaskId',{task_id:taskId}));
  for(const id of ids){
   const row=rows.get(id);if(!row||!row.terminal||done.has(id))continue;
   const sample=row.failed?null:L.parseCounters(row.output);
   done.set(id,sample?{...sample,time:Date.now()}:null);
  }
  if(done.size===ids.length)break;
  await new Promise(resolve=>setTimeout(resolve,1000));
 }
 return done;
}
async function tick(){
 if(running||stopped)return;running=true;
 try{
  const nodes=L.normalizeNodes(await server.call('common:getNodes')),ids=[...nodes.keys()];
  if(!ids.length)return;
  const measurements=await execAll(ids);
  if(stopped)return;
  let changed=false,now=Date.now();
  for(const uuid of ids){
   const curr=measurements.get(uuid);
   if(!curr){baselines.delete(uuid);continue;}
   const sample=L.delta(baselines.get(uuid),curr);baselines.set(uuid,curr);
   if(sample){L.append(state,uuid,sample,now);changed=true;}
  }
  for(const uuid of Object.keys(state.nodes))if(!nodes.has(uuid)){delete state.nodes[uuid];changed=true;}
  if(changed)save();
 }catch(e){console.error('[CPU-STEAL] collection failed',String(e));}
 finally{running=false;}
}
function load(){
 stopped=false;initStorage();server.route('GET',ROUTE,history);
 server.cron('*/2 * * * *',()=>{void tick();});void tick();
 console.log('[CPU-STEAL] scheduled every two minutes');
}
function unload(){stopped=true;baselines.clear();}
if(typeof module!=='undefined'&&module.exports)module.exports={load,unload};
