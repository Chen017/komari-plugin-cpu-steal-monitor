import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const filename = path.join(root, 'cpu-steal-monitor.zip');
assert.ok(fs.existsSync(filename), 'build the plugin ZIP first');

const entries = execFileSync('unzip', ['-Z1', filename], { encoding: 'utf8' }).trim().split('\n').sort();
assert.deepEqual(entries, [
  'LICENSE', 'README.md', 'assets/icon.svg', 'komari-plugin.json', 'script.js',
].sort());
const manifest = fs.readFileSync(path.join(root, 'komari-plugin.json'), 'utf8');
const packaged = execFileSync('unzip', ['-p', filename, 'komari-plugin.json'], { encoding: 'utf8' });
assert.deepEqual(JSON.parse(packaged), JSON.parse(manifest));
assert.equal(JSON.parse(packaged).version, JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version);
const bundled = execFileSync('unzip', ['-p', filename, 'script.js'], { encoding: 'utf8' });
assert.ok(bundled.includes('normalizeResults'), 'logic must be inlined');
assert.ok(bundled.includes('/summary') && bundled.includes('/health') && bundled.includes('/history'));
assert.ok(!bundled.includes("require('./logic.cjs')"), 'no runtime local CommonJS import');
console.log('Verified standalone Komari plugin ZIP contract.');
