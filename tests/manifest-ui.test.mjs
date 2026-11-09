import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';

const manifest = JSON.parse(fs.readFileSync(new URL('../komari-plugin.json', import.meta.url), 'utf8'));

test('managed plugin configuration contains only the no-options recommendation textbox', () => {
  assert.equal(manifest.configuration.type, 'managed');
  assert.equal(manifest.configuration.data.length, 1);
  const item = manifest.configuration.data[0];
  assert.equal(item.type, 'textbox');
  assert.equal(item.key, undefined);
  assert.equal(item.default, undefined);
  assert.equal(item.options, undefined);
  for (const lang of ['zh-CN', 'zh_CN', 'en']) {
    assert.equal(typeof item.name[lang], 'string');
    assert.match(item.name[lang], /Komari Emerald Insights/);
    assert.match(item.name[lang], /<div/);
  }
  assert.match(manifest.description['zh-CN'], /独立保存/);
  assert.match(manifest.description['zh-CN'], /强烈推荐/);
});
