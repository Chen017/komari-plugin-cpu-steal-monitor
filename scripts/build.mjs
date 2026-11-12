import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const root = fileURLToPath(new URL('../', import.meta.url))
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'komari-plugin.json'), 'utf8'))
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const source = fs.readFileSync(path.join(root, 'script.js'), 'utf8')
const scriptVersion = source.match(/\bconst\s+VERSION\s*=\s*['"]([^'"]+)['"]/)?.[1]
if (!/^\d+\.\d+\.\d+(?:-[\dA-Za-z.-]+)?$/.test(pkg.version) ||
    manifest.version !== pkg.version || scriptVersion !== pkg.version ||
    manifest.entry !== 'script.js' || manifest.short !== 'cpu-steal-monitor')
  throw new Error('Plugin manifest or version does not match the package and runtime')

const logic = fs.readFileSync(path.join(root, 'logic.cjs'), 'utf8')
const marker = "const L = require('./logic.cjs');"
if (source.split(marker).length !== 2)
  throw new Error('Expected exactly one logic import')

// Komari executes script.js without a Node module wrapper.
const injected = 'const L = (function(){\nvar module={exports:{}};\n' + logic + '\nreturn module.exports;\n})();'
const bundle = source.replace(marker, () => injected)

const out = path.join(root, 'cpu-steal-monitor.zip')
const files = ['komari-plugin.json', 'script.js', 'assets/icon.svg', 'README.md', 'LICENSE']
const timestamp = new Date('2000-01-01T00:00:00Z')
const stage = fs.mkdtempSync(path.join(root, '.package-'))
try {
  fs.mkdirSync(path.join(stage, 'assets'))
  for (const file of files) {
    const contents = file === 'script.js' ? bundle : fs.readFileSync(path.join(root, file))
    const staged = path.join(stage, file)
    fs.writeFileSync(staged, contents)
    fs.chmodSync(staged, 0o644)
    fs.utimesSync(staged, timestamp, timestamp)
  }
  const candidate = path.join(stage, 'candidate.zip')
  execFileSync('zip', ['-q', '-X', candidate, ...files], {
    cwd: stage,
    env: { ...process.env, TZ: 'UTC' },
  })
  fs.renameSync(candidate, out)
  console.log('Built ' + out)
}
finally {
  fs.rmSync(stage, { recursive: true, force: true })
}
