import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))

test('runtime collects every two minutes and restricts private/public routes', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cpu-steal-test-'))
  try {
    let now = 1_000_000
    let taskCount = 0
    let privateSite = false
    let schedule = null
    let route = null
    const server = {
      route(method, endpoint, handler) {
        assert.equal(method, 'GET')
        assert.ok(endpoint.startsWith('/api/plugin/cpu-steal-monitor/v1/'))
        if (endpoint === '/api/plugin/cpu-steal-monitor/v1/history') route = handler
      },
      cron(expr, handler) {
        assert.equal(expr, '*/2 * * * *')
        schedule = handler
      },
      async call(name, params) {
        if (name === 'common:getNodes')
          return { abc: { uuid: 'abc', hidden: false }, hidden: { uuid: 'hidden', hidden: true } }
        if (name === 'public:getPublicSettings')
          return { private_site: privateSite }
        if (name === 'admin:exec') {
          assert.ok(params.command.includes('/proc/stat'))
          assert.ok(params.command.includes('STEALV1'))
          assert.deepEqual(Array.from(params.clients), ['abc', 'hidden'])
          taskCount++
          return { task_id: String(taskCount) }
        }
        if (name === 'admin:getTaskResultsByTaskId') {
          const baseline = taskCount === 1
          const stdout = baseline ? 'STEALV1 1000 20' : 'STEALV1 3000 120'
          // The real Komari admin:getTaskResultsByTaskId RPC returns an array
          // with "client"/"result" (not a UUID-keyed stdout map).
          return [
            { task_id: String(taskCount), client: 'abc', result: stdout, exit_code: 0, finished_at: '2026-11-09T04:20:00Z' },
            { task_id: String(taskCount), client: 'hidden', result: stdout, exit_code: 0, finished_at: '2026-11-09T04:20:00Z' },
          ]
        }
        throw new Error('unexpected RPC: ' + name)
      },
    }
    class FakeDate extends Date {
      static now() { return now }
    }
    const context = {
      require(name) {
        if (name === 'server') return server
        if (name === 'fs') return fs
        if (name === 'path') return path
        if (name === './logic.cjs') {
          // Source uses helpers as CommonJS; build inlines them into ZIP.
          const mod = { exports: {} }
          const code = fs.readFileSync(path.join(root, 'logic.cjs'), 'utf8')
          vm.runInNewContext(code, { module: mod })
          return mod.exports
        }
        throw new Error('unrecognized module: ' + name)
      },
      __storageDir__: dir,
      Date: FakeDate,
      console,
      setTimeout,
    }
    vm.runInNewContext(fs.readFileSync(path.join(root, 'script.js'), 'utf8'), context)
    context.load()
    await new Promise(setImmediate)
    assert.equal(taskCount, 1)
    assert.ok(schedule)
    assert.ok(route)

    now += 120000
    schedule()
    await new Promise(setImmediate)
    const saved = JSON.parse(fs.readFileSync(path.join(dir, 'history.json'), 'utf8'))
    assert.equal(saved.nodes.abc.length, 1)
    assert.equal(saved.nodes.abc[0].value, 5)

    async function callHistory(uuid, principal) {
      let body, status
      const res = {
        setHeader() {},
        end(output) { body = JSON.parse(output) },
        set statusCode(value) { status = value },
      }
      await route({
        query: { uuid, from: String(1_000_000), to: String(now) },
        context: { principal },
      }, res)
      return { status, body }
    }
    assert.equal((await callHistory('abc', { type: 'anonymous' })).body.samples.length, 1)
    assert.equal((await callHistory('hidden', { type: 'anonymous' })).status, 403)
    privateSite = true
    assert.equal((await callHistory('abc', { type: 'anonymous' })).status, 403)
    assert.equal((await callHistory('abc', { type: 'user', roles: ['admin'] })).status, 200)
    context.unload()
  }
  finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

function createRuntime(t, { history, getNodes, getTaskResult, runtimeFs = fs }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cpu-steal-recovery-'))
  const filename = path.join(dir, 'history.json')
  const routes = new Map()
  const clock = { now: Date.UTC(2026, 10, 12) }
  let schedule
  let taskCount = 0
  const server = {
    route(_method, route, handler) { routes.set(route, handler) },
    cron(_expr, handler) { schedule = handler },
    async call(name) {
      if (name === 'common:getNodes') return getNodes()
      if (name === 'admin:exec') return { task_id: String(++taskCount) }
      if (name === 'admin:getTaskResultsByTaskId') return [getTaskResult(taskCount)]
      throw new Error('unexpected RPC: ' + name)
    },
  }
  const helpers = { exports: {} }
  vm.runInNewContext(fs.readFileSync(path.join(root, 'logic.cjs'), 'utf8'), { module: helpers })
  const modules = { server, fs: runtimeFs, path, './logic.cjs': helpers.exports }
  const context = {
    require: name => modules[name],
    __storageDir__: dir,
    Date: class extends Date { static now() { return clock.now } },
    console,
  }
  t.after(() => {
    context.unload?.()
    fs.rmSync(dir, { recursive: true, force: true })
  })
  if (history) fs.writeFileSync(filename, JSON.stringify({ schemaVersion: 1, nodes: history(clock.now) }))
  vm.runInNewContext(fs.readFileSync(path.join(root, 'script.js'), 'utf8'), context)
  context.load()
  return {
    clock,
    filename,
    getTaskCount: () => taskCount,
    readHistory: () => JSON.parse(fs.readFileSync(filename, 'utf8')).nodes,
    async tick() {
      clock.now += 120000
      schedule()
      await new Promise(setImmediate)
    },
    async health() {
      const res = { setHeader() {}, end(body) { this.body = JSON.parse(body) } }
      await routes.get('/api/plugin/cpu-steal-monitor/v1/health')(
        { context: { principal: { type: 'user', roles: ['admin'] } } },
        res,
      )
      assert.equal(res.statusCode, 200)
      return res.body
    },
  }
}

test('expires history for offline nodes and removes the last deleted node', async t => {
  let nodes = { offline: { uuid: 'offline' } }
  let recent
  const runtime = createRuntime(t, {
    history: now => {
      const expired = { from: now - 91 * 86400000 - 120000, time: now - 91 * 86400000, value: 3 }
      recent = { from: now - 120000, time: now, value: 5 }
      return { offline: [expired, recent], deleted: [recent] }
    },
    getNodes: () => nodes,
    getTaskResult: () => ({ client: 'offline', result: '', exit_code: 1 }),
  })
  await new Promise(setImmediate)
  assert.deepEqual(runtime.readHistory(), { offline: [recent] })

  nodes = null
  await runtime.tick()
  assert.deepEqual(runtime.readHistory(), { offline: [recent] })

  nodes = {}
  await runtime.tick()
  assert.deepEqual(runtime.readHistory(), {})
  assert.equal(runtime.getTaskCount(), 1)
})

test('retries a failed history replacement on a cycle without a new sample', async t => {
  let renameAttempts = 0
  const runtime = createRuntime(t, {
    getNodes: () => ({ abc: { uuid: 'abc' } }),
    getTaskResult: taskCount => {
      if (taskCount === 1) return { client: 'abc', result: 'STEALV1 1000 20', exit_code: 0 }
      if (taskCount === 2) return { client: 'abc', result: 'STEALV1 3000 120', exit_code: 0 }
      return { client: 'abc', result: 'STEALV1 5000 140', status: 'timeout' }
    },
    runtimeFs: {
      ...fs,
      renameSync(from, to) {
        if (++renameAttempts === 1) throw new Error('temporary rename failure')
        fs.renameSync(from, to)
      },
    },
  })
  await new Promise(setImmediate)
  const start = runtime.clock.now
  await runtime.tick()
  assert.equal(fs.existsSync(runtime.filename), false)
  const failed = await runtime.health()
  assert.match(failed.lastError, /temporary rename failure/)
  assert.equal(failed.lastSuccessfulCollectionAt, null)

  await runtime.tick()
  assert.deepEqual(runtime.readHistory(), { abc: [{ from: start, time: start + 120000, value: 5 }] })
  const recovered = await runtime.health()
  assert.equal(recovered.lastError, null)
  assert.equal(recovered.lastSuccessfulCollectionAt, start + 120000)
  assert.equal(recovered.nodes.abc.status, 'remote_command_failed')
})
