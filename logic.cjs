'use strict';

// Keep these helpers free of Komari runtime dependencies: they are unit-tested
// under Node.js and inlined into the single-file Komari ZIP entry.
const PERIOD_MS = 120000;
const RETENTION_MS = 90 * 86400000;
const MAX_SAMPLES_PER_NODE = 64800; // 90 days at one sample / 120 seconds.

function parseCounters(output) {
  if (typeof output !== 'string') return null;
  for (const line of output.split(/\r?\n/)) {
    const match = /^STEALV1 ([0-9]+) ([0-9]+)$/.exec(line.trim());
    if (!match) continue;
    const total = Number(match[1]);
    const steal = Number(match[2]);
    if (Number.isSafeInteger(total) && Number.isSafeInteger(steal) && total > 0 && steal >= 0 && steal <= total) {
      return { total, steal };
    }
  }
  return null;
}

function delta(previous, current) {
  if (!previous || !current) return null;
  const elapsed = current.time - previous.time;
  if (elapsed < 75000 || elapsed > 180000) return null;
  const total = current.total - previous.total;
  const stolen = current.steal - previous.steal;
  if (total <= 0 || stolen < 0 || stolen > total) return null;
  return { from: previous.time, time: current.time, value: 100 * stolen / total };
}

function normalizeNodes(raw) {
  const rows = Array.isArray(raw) ? raw.map(value => ['', value]) : Object.entries(raw || {});
  const nodes = new Map();
  for (const [key, value] of rows) {
    if (!value || typeof value !== 'object') continue;
    const uuid = String(value.uuid || value.id || value.client_id || key || '');
    if (uuid && uuid.length <= 128) nodes.set(uuid, { uuid, hidden: Boolean(value.hidden) });
  }
  return nodes;
}

function normalizeResults(raw) {
  const body = raw && typeof raw === 'object' && raw.results ? raw.results : raw;
  const rows = Array.isArray(body) ? body.map(value => ['', value]) : Object.entries(body || {});
  const results = new Map();
  for (const [key, value] of rows) {
    if (!value || typeof value !== 'object') continue;
    // Komari official TaskResult uses "client" and "result".
    const uuid = String(value.client || value.client_id || value.client_uuid || value.clientId || value.uuid || value.id || key || '');
    if (!uuid) continue;
    const output = typeof value.stdout === 'string' ? value.stdout
      : typeof value.output === 'string' ? value.output
      : typeof value.result === 'string' ? value.result : '';
    const exitCode = typeof value.exit_code === 'number' ? value.exit_code
      : typeof value.exitCode === 'number' ? value.exitCode : null;
    const terminal = exitCode !== null || Boolean(value.finished_at || value.finishedAt)
      || ['completed', 'failed', 'timeout', 'error', 'finished'].includes(String(value.status || '').toLowerCase());
    const failed = (exitCode !== null && exitCode !== 0) || value.success === false || Boolean(value.error);
    results.set(uuid, { output, terminal, failed, exitCode });
  }
  return results;
}

function isSample(sample) {
  return sample && Number.isSafeInteger(sample.from) && Number.isSafeInteger(sample.time)
    && sample.time > sample.from && Number.isFinite(sample.value)
    && sample.value >= 0 && sample.value <= 100;
}

function append(state, uuid, sample, now) {
  if (!isSample(sample)) return false;
  const previous = Array.isArray(state.nodes[uuid]) ? state.nodes[uuid] : [];
  const cutoff = now - RETENTION_MS;
  // Deduplicate repeated task deliveries, without inventing missing samples.
  state.nodes[uuid] = [...previous.filter(s => isSample(s) && s.time >= cutoff && s.time !== sample.time), sample]
    .sort((a, b) => a.time - b.time).slice(-MAX_SAMPLES_PER_NODE);
  return true;
}

// Aggregate actual overlap with [from,to], never the mean of unweighted
// values. Missing intervals are unknown, not zero. Each sample is an average
// over its own [from,time] interval, not an instantaneous reading.
function summarize(samples, from, to) {
  let observedMs = 0;
  let weightedSum = 0;
  let maximum = null;
  let latest = null;
  let lastSampleAt = null;
  let sampleCount = 0;
  const ordered = Array.isArray(samples) ? samples.filter(isSample).sort((a, b) => a.time - b.time) : [];
  let coveredUntil = from;
  for (const sample of ordered) {
    if (sample.time < from || sample.from > to) continue;
    const start = Math.max(sample.from, from, coveredUntil);
    const end = Math.min(sample.time, to);
    if (end <= start) continue;
    const duration = end - start;
    weightedSum += duration * sample.value;
    observedMs += duration;
    coveredUntil = end;
    sampleCount++;
    maximum = maximum === null ? sample.value : Math.max(maximum, sample.value);
    if (lastSampleAt === null || sample.time >= lastSampleAt) {
      lastSampleAt = sample.time;
      latest = sample.value;
    }
  }
  const duration = Math.max(0, to - from);
  return {
    latest,
    lastSampleAt,
    average: observedMs > 0 ? weightedSum / observedMs : null,
    max: maximum,
    sampleCount,
    observedSeconds: observedMs / 1000,
    coverageRatio: duration > 0 ? Math.min(1, observedMs / duration) : 0,
  };
}

module.exports = {
  PERIOD_MS, RETENTION_MS, MAX_SAMPLES_PER_NODE,
  parseCounters, delta, normalizeNodes, normalizeResults, isSample, append, summarize,
};
