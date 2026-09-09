import test from 'node:test';
import assert from 'node:assert/strict';
import sources from '../src/sources.json' with { type: 'json' };
import seeds from '../src/projects-seed.json' with { type: 'json' };
import { trustedUrl } from '../src/ingestion.js';

test('production source configuration matches the collector contract and has distinct editorial groups', () => {
  assert.equal(sources.length, 2);
  assert.equal(new Set(sources.map(s => s.publisherGroup)).size, 2);
  for (const source of sources) {
    assert.equal(source.kind, 'rss');
    assert.equal(trustedUrl(source.url, source), source.url);
    assert.equal(source.trust, 'press');
    assert.deepEqual(source.statusAuthorityProjectIds, []);
  }
  assert.equal(seeds.length, 14);
  assert.equal(seeds.find(s => s.id === 3).estado, 'produccion');
});
