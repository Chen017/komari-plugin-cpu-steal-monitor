import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const root = fileURLToPath(new URL('../', import.meta.url))
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'komari-plugin.json'), 'utf8'))
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
if (manifest.version !== pkg.version || manifest.entry !== 'script.js' || manifest.short !== 'cpu-steal-monitor')
  throw new Error('Manifest mismatch')

const source = fs.readFileSync(path.join(root, 'script.js'), 'utf8')
const logic = fs.readFileSync(path.join(root, 'logic.cjs'), 'utf8')
const marker = "const L = require('./logic.cjs');"
if (!source.includes(marker))
  throw new Error('Expected logic import missing')

// Komari executes script.js as a script, not a Node CommonJS wrapper.
// Inline the tested helper functions so loading never relies on a custom
// .cjs resolver in the embedded Komari JS runtime.
const injected = 'const L = (function(){\nvar module={exports:{}};\n' + logic + '\nreturn module.exports;\n})();'
const bundled = source.replace(marker, injected)
if (bundled.includes("require('./logic.cjs')"))
  throw new Error('Unbundled logic import')

const out = path.join(root, 'cpu-steal-monitor.zip')
const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'komari-steal-'))
try {
  fs.mkdirSync(path.join(stage, 'assets'))
  for (const file of ['komari-plugin.json', 'README.md', 'LICENSE'])
    fs.copyFileSync(path.join(root, file), path.join(stage, file))
  fs.copyFileSync(path.join(root, 'assets/icon.svg'), path.join(stage, 'assets/icon.svg'))
  fs.writeFileSync(path.join(stage, 'script.js'), bundled)
  if (fs.existsSync(out))
    fs.unlinkSync(out)
  execFileSync('zip', ['-q', '-X', out, 'komari-plugin.json', 'script.js', 'assets/icon.svg', 'README.md', 'LICENSE'], { cwd: stage })
  console.log('Built ' + out)
}
finally {
  fs.rmSync(stage, { recursive: true, force: true })
}
