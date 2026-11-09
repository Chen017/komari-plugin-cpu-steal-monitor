'use strict';
// Server-side Komari plugin. Uses only fixed read-only agent commands.
const server = require('server');
const fs = require('fs');
const path = require('path');
const L = require('./logic.cjs');
const BASE = '/api/plugin/cpu-steal-monitor/v1';
const COMMAND = "LC_ALL=C awk 'NR==1 && $1==\"cpu\" {total=0;for(i=2;i<=9;i++)total+=$i;printf(\"STEALV1 %.0f %.0f\\n\",total,$9);exit}' /proc/stat";
const VERSION = '0.2.2';

let state = { schemaVersion: 1, nodes: {} };
let baselines = new Map();
let active = false;
let stopped = false;
let storagePath = '';
let bootAt = null;
let lastCycleAt = null;
let lastSuccessAt = null;
let lastError = null;
let nodeHealth = {};

function initializeStorage() {
  const directory = typeof __storageDir__ === 'string' && __storageDir__
    ? __storageDir__ : 'data/plugin-data/cpu-steal-monitor';
  fs.mkdirSync(directory, { recursive: true });
  storagePath = path.join(directory, 'history.json');
  if (!fs.existsSync(storagePath)) return;
  const loaded = JSON.parse(fs.readFileSync(storagePath, 'utf8'));
  if (!loaded || loaded.schemaVersion !== 1 || !loaded.nodes || typeof loaded.nodes !== 'object' || Array.isArray(loaded.nodes)) {
    throw new Error('Invalid history file; refusing to overwrite existing data');
  }
  state = loaded;
}

function persist() {
  const temporary = storagePath + '.tmp';
  fs.writeFileSync(temporary, JSON.stringify(state), { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temporary, storagePath);
}

function json(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(JSON.stringify(payload));
}

function isAdmin(req) {
  const p = req && req.context && req.context.principal;
  return Boolean(p && ((p.type === 'user' && (p.roles || []).includes('admin')) || p.type === 'api_key' || p.is_api_key === true));
}

async function visibleNodes(req) {
  const nodes = L.normalizeNodes(await server.call('common:getNodes'));
  if (isAdmin(req)) return nodes;
  const settings = await server.call('public:getPublicSettings');
  if (!settings || settings.private_site !== false) return null;
  return new Map([...nodes].filter(([, node]) => !node.hidden));
}

function validRange(q, now, defaultHours) {
  const from = q.from === undefined ? now - defaultHours * 3600000 : Number(q.from);
  const to = q.to === undefined ? now : Number(q.to);
  if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from >= to ||
      to - from > L.RETENTION_MS + 600000 || to > now + 600000 || from < 0) return null;
  return { from, to };
}

async function historyRoute(req, res) {
  try {
    const q = req.query || {};
    const uuid = typeof q.uuid === 'string' ? q.uuid : '';
    if (!uuid || uuid.length > 128) return json(res, 400, { error: 'Invalid UUID' });
    const allowed = await visibleNodes(req);
    if (allowed === null || !allowed.has(uuid)) return json(res, 403, { error: 'Forbidden' });
    const range = validRange(q, Date.now(), 1);
    if (!range) return json(res, 400, { error: 'Invalid time range' });
    const samples = (state.nodes[uuid] || []).filter(s => L.isSample(s) && s.time >= range.from && s.from <= range.to);
    return json(res, 200, { schemaVersion: 1, uuid, intervalSeconds: 120, samples });
  } catch (error) {
    console.error('[CPU-STEAL] history API:', String(error));
    return json(res, 503, { error: 'Steal history unavailable' });
  }
}

async function summaryRoute(req, res) {
  try {
    const q = req.query || {};
    const range = validRange(q, Date.now(), 24);
    if (!range) return json(res, 400, { error: 'Invalid time range' });
    const visible = await visibleNodes(req);
    if (visible === null) return json(res, 403, { error: 'Forbidden' });
    const selected = typeof q.uuids === 'string' && q.uuids.trim()
      ? [...new Set(q.uuids.split(',').map(s => s.trim()).filter(Boolean))] : [...visible.keys()];
    if (selected.length > 200) return json(res, 400, { error: 'Too many node UUIDs' });
    const nodes = selected.filter(uuid => visible.has(uuid)).map(uuid => ({
      uuid,
      ...L.summarize(state.nodes[uuid] || [], range.from, range.to),
    }));
    return json(res, 200, {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      windowStart: new Date(range.from).toISOString(),
      windowEnd: new Date(range.to).toISOString(),
      intervalSeconds: 120,
      nodes,
    });
  } catch (error) {
    console.error('[CPU-STEAL] summary API:', String(error));
    return json(res, 503, { error: 'Steal summary unavailable' });
  }
}

async function healthRoute(req, res) {
  if (!isAdmin(req)) return json(res, 403, { error: 'Admin access required' });
  try {
    const nodes = L.normalizeNodes(await server.call('common:getNodes'));
    const nodeStatus = {};
    for (const uuid of nodes.keys()) {
      const points = state.nodes[uuid] || [];
      nodeStatus[uuid] = {
        sampleCount: points.length,
        lastSampleAt: points.length ? points[points.length - 1].time : null,
        ...(nodeHealth[uuid] || { status: 'awaiting_first_sample' }),
      };
    }
    return json(res, 200, {
      schemaVersion: 1, pluginVersion: VERSION, intervalSeconds: 120,
      startedAt: bootAt, lastCycleAt, lastSuccessfulCollectionAt: lastSuccessAt,
      lastError, collecting: active, storagePath,
      nodes: nodeStatus,
    });
  } catch (error) {
    console.error('[CPU-STEAL] health API:', String(error));
    return json(res, 503, { error: 'Health unavailable' });
  }
}

async function collectRemote(uuids) {
  const created = await server.call('admin:exec', { command: COMMAND, clients: uuids });
  const id = String(created && (created.task_id || created.taskId) || '');
  if (!id) throw new Error('admin:exec returned no task ID');
  const results = new Map();
  const deadline = Date.now() + 25000;
  while (!stopped && Date.now() < deadline && results.size < uuids.length) {
    let raw;
    try {
      raw = await server.call('admin:getTaskResultsByTaskId', { task_id: id });
    } catch (error) {
      // Komari can return a not-found error before a task result is created.
      raw = null;
    }
    const parsed = L.normalizeResults(raw);
    for (const uuid of uuids) {
      const result = parsed.get(uuid);
      if (!result || !result.terminal || results.has(uuid)) continue;
      const counters = result.failed ? null : L.parseCounters(result.output);
      results.set(uuid, counters ? { counters: { ...counters, time: Date.now() }, status: 'ok' }
        : { counters: null, status: result.failed ? 'remote_command_failed' : 'invalid_counters' });
    }
    if (results.size === uuids.length) break;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  return results;
}

async function collectTick() {
  if (active || stopped) return;
  active = true;
  lastCycleAt = Date.now();
  try {
    const nodes = L.normalizeNodes(await server.call('common:getNodes'));
    const uuids = [...nodes.keys()];
    if (!uuids.length) return;
    const remote = await collectRemote(uuids);
    if (stopped) return;
    let changed = false;
    let successes = 0;
    const now = Date.now();
    for (const uuid of uuids) {
      const result = remote.get(uuid);
      if (!result || !result.counters) {
        baselines.delete(uuid);
        nodeHealth[uuid] = { status: result ? result.status : 'timeout', lastAttemptAt: now };
        continue;
      }
      const computed = L.delta(baselines.get(uuid), result.counters);
      baselines.set(uuid, result.counters);
      nodeHealth[uuid] = { status: computed ? 'ok' : 'warming_up', lastAttemptAt: now };
      if (!computed) continue;
      if (L.append(state, uuid, computed, now)) {
        nodeHealth[uuid].lastSuccessAt = now;
        successes++;
        changed = true;
      }
    }
    for (const uuid of Object.keys(state.nodes)) {
      if (!nodes.has(uuid)) { delete state.nodes[uuid]; changed = true; }
    }
    for (const uuid of Object.keys(nodeHealth)) if (!nodes.has(uuid)) delete nodeHealth[uuid];
    if (changed) persist();
    if (successes) lastSuccessAt = Date.now();
    lastError = null;
  } catch (error) {
    lastError = String(error);
    console.error('[CPU-STEAL] collection failed:', lastError);
  } finally {
    active = false;
  }
}

function load() {
  stopped = false;
  bootAt = Date.now();
  initializeStorage();
  server.route('GET', BASE + '/history', historyRoute);
  server.route('GET', BASE + '/summary', summaryRoute);
  server.route('GET', BASE + '/health', healthRoute);
  server.cron('*/2 * * * *', () => { void collectTick(); });
  void collectTick();
  console.log('[CPU-STEAL] started v' + VERSION + ': 120-second sampling, standalone API enabled');
}

function unload() {
  stopped = true;
  baselines.clear();
  console.log('[CPU-STEAL] unloaded');
}

if (typeof module !== 'undefined' && module.exports) module.exports = { load, unload };
