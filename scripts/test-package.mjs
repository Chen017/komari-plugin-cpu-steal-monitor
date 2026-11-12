import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'

const root = fileURLToPath(new URL('../', import.meta.url))
const zip = path.join(root, 'cpu-steal-monitor.zip')
const extract = entry => execFileSync('unzip', ['-p', zip, entry])
const entries = execFileSync('unzip', ['-Z1', zip], { encoding: 'utf8' }).trim().split(/\r?\n/).sort()
assert.deepEqual(entries, ['LICENSE', 'README.md', 'assets/icon.svg', 'komari-plugin.json', 'script.js'])
for (const entry of entries.filter(entry => entry !== 'script.js'))
  assert.deepEqual(extract(entry), fs.readFileSync(path.join(root, entry)))

const manifest = JSON.parse(extract('komari-plugin.json'))
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
assert.equal(manifest.version, pkg.version)

const routes = new Map()
const schedules = []
const server = {
  route(method, route, handler) { routes.set(method + ' ' + route, handler) },
  cron(schedule) { schedules.push(schedule) },
  async call(method) {
    assert.equal(method, 'common:getNodes')
    return []
  },
}
const require = createRequire(import.meta.url)
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'komari-steal-package-'))
const runtime = {
  __storageDir__: directory,
  console,
  require(id) {
    if (id === 'server') return server
    assert.ok(id === 'fs' || id === 'path', 'Unexpected runtime import ' + id)
    return require(id)
  },
  setTimeout,
}
try {
  runInNewContext(extract('script.js').toString('utf8'), runtime, { filename: 'script.js' })
  assert.equal(typeof runtime.load, 'function')
  assert.equal(typeof runtime.unload, 'function')
  try {
    await runtime.load()
    const base = 'GET /api/plugin/cpu-steal-monitor/v1'
    for (const route of ['/history', '/summary', '/health'])
      assert.equal(typeof routes.get(base + route), 'function')
    assert.deepEqual(schedules, ['*/2 * * * *'])
    const response = { setHeader() {}, end(payload) { this.payload = JSON.parse(payload) } }
    await routes.get(base + '/health')({ context: { principal: { type: 'user', roles: ['admin'] } } }, response)
    assert.equal(response.statusCode, 200)
    assert.equal(response.payload.pluginVersion, manifest.version)
  }
  finally {
    await runtime.unload()
  }
}
finally {
  fs.rmSync(directory, { recursive: true, force: true })
}
console.log('Verified installable ZIP, Komari lifecycle, cron, routes and package version.')
