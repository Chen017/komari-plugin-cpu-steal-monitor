import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const L = createRequire(import.meta.url)('../logic.cjs');

test('standalone history/summary/health work without Emerald Insights', async () => {
  const storage = fs.mkdtempSync(path.join(os.tmpdir(), 'steal-api-'));
  const now = 1700000000000;
  let currentTime = now;
  let counter = 0;
  let cron = null;
  let privateSite = false;
  const routes = new Map();
  const server = {
    route(method, url, handler) { assert.equal(method, 'GET'); routes.set(url, handler); },
    cron(schedule, cb) { assert.equal(schedule, '*/2 * * * *'); cron = cb; },
    async call(method, args) {
      if (method === 'common:getNodes') return {
        nodeA: { uuid: 'nodeA', hidden: false },
        nodeB: { uuid: 'nodeB', hidden: true },
      };
      if (method === 'public:getPublicSettings') return { private_site: privateSite };
      if (method === 'admin:exec') {
        assert.ok(args.command.includes('/proc/stat'));
        counter++;
        return { task_id: 't-' + counter };
      }
      if (method === 'admin:getTaskResultsByTaskId') {
        const output = counter === 1 ? 'STEALV1 1000 20' : 'STEALV1 3000 120';
        return [
          { client: 'nodeA', result: output, exit_code: 0, finished_at: '2026-11-09T00:00:00Z' },
          { client: 'nodeB', result: output, exit_code: 0, finished_at: '2026-11-09T00:00:00Z' },
        ];
      }
      throw new Error('Unexpected method ' + method);
    },
  };
  class FakeDate extends Date { static now() { return currentTime; } }
  const ctx = {
    require(name) {
      if (name === 'server') return server;
      if (name === 'fs') return fs;
      if (name === 'path') return path;
      if (name === './logic.cjs') return L;
      throw Error(name);
    },
    __storageDir__: storage, Date: FakeDate, console, setTimeout,
  };
  const script = fs.readFileSync(new URL('../script.js', import.meta.url), 'utf8');
  try {
    vm.runInNewContext(script, ctx);
    ctx.load();
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.ok(cron);
    currentTime += 120000;
    cron();
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(counter, 2);
    async function call(url, query, principal = { type: 'anonymous' }) {
      const handler = routes.get(url);
      assert.ok(handler, 'route registered: ' + url);
      const res = { statusCode: 0, setHeader() {}, end(text) { this.body = JSON.parse(text); } };
      await handler({ query, context: { principal } }, res);
      return { status: res.statusCode, body: res.body };
    }
    const root = '/api/plugin/cpu-steal-monitor/v1';
    const range = { from: String(now), to: String(currentTime) };
    const history = await call(root + '/history', { ...range, uuid: 'nodeA' });
    assert.equal(history.status, 200);
    assert.equal(history.body.intervalSeconds, 120);
    assert.equal(history.body.samples.length, 1);
    assert.equal(history.body.samples[0].value, 5);
    const summary = await call(root + '/summary', { ...range });
    assert.equal(summary.status, 200);
    assert.equal(summary.body.nodes.length, 1);
    assert.equal(summary.body.nodes[0].uuid, 'nodeA');
    assert.equal(summary.body.nodes[0].latest, 5);
    assert.equal(summary.body.nodes[0].coverageRatio, 1);
    assert.equal((await call(root + '/history', { ...range, uuid: 'nodeB' })).status, 403);
    assert.equal((await call(root + '/health', {})).status, 403);
    const admin = { type: 'user', roles: ['admin'] };
    const health = await call(root + '/health', {}, admin);
    assert.equal(health.status, 200);
    assert.equal(health.body.intervalSeconds, 120);
    assert.equal(health.body.nodes.nodeA.status, 'ok');
    assert.equal(health.body.nodes.nodeA.sampleCount, 1);
    const adminSummary = await call(root + '/summary', { ...range }, admin);
    assert.equal(adminSummary.body.nodes.length, 2);
    privateSite = true;
    assert.equal((await call(root + '/summary', { ...range })).status, 403);
    assert.equal((await call(root + '/history', { ...range, uuid: 'nodeA' })).status, 403);
    assert.equal((await call(root + '/summary', { from: 'garbage', to: String(currentTime) }, admin)).status, 400);
    ctx.unload();
  } finally {
    fs.rmSync(storage, { recursive: true, force: true });
  }
});
