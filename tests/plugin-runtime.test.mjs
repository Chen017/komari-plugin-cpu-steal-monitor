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
    await new Promise(resolve => setTimeout(resolve, 10))
    assert.equal(taskCount, 1)
    assert.ok(schedule)
    assert.ok(route)

    now += 120000
    schedule()
    await new Promise(resolve => setTimeout(resolve, 15))
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
