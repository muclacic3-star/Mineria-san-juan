import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import worker, { runRefresh } from '../src/worker.js';

const now = '2026-09-07T12:00:00.000Z';
const mine = { id: 1, nombre: 'Sierra Clara', estado: 'produccion' };
const source = { id: 'fictional-authority', name: 'Autoridad ficticia', kind: 'rss',
  trust: 'official', statusAuthorityProjectIds: [1],
  url: 'https://authority-fixture.org/feed', allowedHosts: ['authority-fixture.org'] };
const xml = '<rss><channel><item><title>La mina Sierra Clara suspendió sus operaciones el 5 de septiembre de 2026</title>'
  + '<link>https://authority-fixture.org/notice</link><pubDate>Sun, 06 Sep 2026 09:00:00 GMT</pubDate>'
  + '<description>Noticia ficticia para pruebas automatizadas.</description></item></channel></rss>';

// SQLite executes real SQL and transactions; only the D1 async surface is adapted.
class D1Fixture {
  constructor() {
    this.sqlite = new DatabaseSync(':memory:');
    this.sqlite.exec(readFileSync(new URL('../migrations/0001_initial.sql', import.meta.url), 'utf8'));
    this.failBatchAt = -1;
    this.beforeBatch = null;
  }
  prepare(sql) {
    const db = this;
    return {
      values: [],
      bind(...values) { this.values = values; return this; },
      async first() { return db.sqlite.prepare(sql).get(...this.values) ?? null; },
      async run() {
        const result = db.sqlite.prepare(sql).run(...this.values);
        return { success: true, meta: { changes: Number(result.changes) } };
      },
    };
  }
  async batch(statements) {
    if (this.beforeBatch) await this.beforeBatch(this.sqlite);
    this.sqlite.exec('BEGIN TRANSACTION');
    try {
      const results = [];
      for (let index = 0; index < statements.length; index++) {
        if (index === this.failBatchAt) throw new Error('fixture transaction fault');
        results.push(await statements[index].run());
      }
      this.sqlite.exec('COMMIT');
      return results;
    } catch (error) {
      this.sqlite.exec('ROLLBACK');
      throw error;
    }
  }
  row() { return this.sqlite.prepare('SELECT * FROM runtime_state WHERE id = 1').get(); }
  snapshot() { return this.row().snapshot_json ? JSON.parse(this.row().snapshot_json) : null; }
  events() { return this.sqlite.prepare('SELECT * FROM status_events').all(); }
  close() { this.sqlite.close(); }
}
function fixture(t) { const db = new D1Fixture(); t.after(() => db.close()); return db; }
function opts(overrides = {}) {
  return { seeds: [mine], sources: [source], clock: () => now,
    fetchImpl: async () => new Response(xml), ...overrides };
}

test('refresh publishes news, mine state and audit event atomically', async t => {
  const db = fixture(t);
  const result = await runRefresh({ DB: db }, opts());
  assert.equal(result.status, 'updated');
  assert.equal(result.code, 200);
  assert.equal(result.statusChanges, 1);
  assert.equal(db.snapshot().projects[0].estado, 'suspendido');
  assert.equal(db.snapshot().lastSuccessAt, now);
  assert.equal(db.events().length, 1);
  assert.equal(db.row().lease_owner, null);
  assert.equal(db.row().revision, 1);
});

test('repeated refresh neither duplicates a news item nor a state event', async t => {
  const db = fixture(t);
  await runRefresh({ DB: db }, opts());
  const first = db.snapshot();
  const repeat = await runRefresh({ DB: db }, opts());
  assert.equal(repeat.statusChanges, 0);
  assert.equal(db.snapshot().news.length, 1);
  assert.equal(db.events().length, 1);
  assert.deepEqual(db.snapshot().projects, first.projects);
});

test('source failure preserves last good news, state and last success', async t => {
  const db = fixture(t);
  await runRefresh({ DB: db }, opts());
  const first = db.snapshot();
  const later = '2026-09-07T18:00:00.000Z';
  const failed = await runRefresh({ DB: db }, opts({ clock: () => later,
    fetchImpl: async () => { throw new Error('network down'); } }));
  const current = db.snapshot();
  assert.equal(failed.status, 'partial');
  assert.equal(current.service.mode, 'degraded');
  assert.deepEqual(current.news, first.news);
  assert.deepEqual(current.projects, first.projects);
  assert.equal(current.lastSuccessAt, now);
  assert.equal(current.lastAttemptAt, later);
  assert.equal(current.sources[0].lastSuccessAt, now);
  assert.ok(current.sources[0].error);
});

test('partial source success does not advertise a completed global update', async t => {
  const db = fixture(t);
  const second = { ...source, id: 'fictional-second', name: 'Segunda fuente ficticia', url: 'https://second-fixture.org/feed', allowedHosts: ['second-fixture.org'] };
  const result = await runRefresh({ DB: db }, opts({ sources: [source, second],
    fetchImpl: async url => url.includes('second-fixture') ? new Response('', { status: 503 }) : new Response(xml) }));
  assert.equal(result.successfulSources, 1);
  assert.equal(result.status, 'partial');
  assert.equal(db.snapshot().lastSuccessAt, null);
  assert.equal(db.snapshot().sources[0].lastSuccessAt, now);
  assert.equal(db.snapshot().projects[0].estado, 'suspendido');
});

test('an active lease prevents overlapping requests from fetching or publishing', async t => {
  const db = fixture(t);
  db.sqlite.prepare('UPDATE runtime_state SET lease_owner = ?, lease_until = ? WHERE id = 1')
    .run('other-worker', '2026-09-07T12:02:00.000Z');
  let calls = 0;
  const result = await runRefresh({ DB: db }, opts({ fetchImpl: async () => { calls++; return new Response(xml); } }));
  assert.equal(result.status, 'busy');
  assert.equal(calls, 0);
  assert.equal(db.row().lease_owner, 'other-worker');
  assert.equal(db.row().revision, 0);
});

test('expired lease may be acquired but cannot publish after its new deadline', async t => {
  const db = fixture(t);
  db.sqlite.prepare('UPDATE runtime_state SET lease_owner = ?, lease_until = ? WHERE id = 1')
    .run('expired-worker', '2026-09-07T11:00:00.000Z');
  let clockCalls = 0;
  const result = await runRefresh({ DB: db }, opts({ clock: () => clockCalls++ ? '2026-09-07T12:02:01.000Z' : now }));
  assert.equal(result.status, 'conflict');
  assert.equal(db.snapshot(), null);
  assert.equal(db.events().length, 0);
  assert.equal(db.row().revision, 0);
  assert.equal(db.row().lease_owner, null);
});

test('replaced lease owner blocks stale snapshot and audit event publication', async t => {
  const db = fixture(t);
  db.beforeBatch = sqlite => sqlite.prepare('UPDATE runtime_state SET lease_owner = ?, lease_until = ? WHERE id = 1')
    .run('new-owner', '2026-09-07T12:04:00.000Z');
  const result = await runRefresh({ DB: db }, opts());
  assert.equal(result.status, 'conflict');
  assert.equal(db.snapshot(), null);
  assert.equal(db.events().length, 0);
  assert.equal(db.row().lease_owner, 'new-owner');
});

test('failure writing an event rolls back the corresponding snapshot transaction', async t => {
  const db = fixture(t);
  db.failBatchAt = 1;
  const result = await runRefresh({ DB: db }, opts());
  assert.equal(result.status, 'error');
  assert.equal(result.code, 503);
  assert.equal(db.snapshot(), null);
  assert.equal(db.events().length, 0);
  assert.equal(db.row().revision, 0);
  assert.equal(db.row().lease_owner, null);
  assert.ok(db.row().last_error);
});

test('a later transaction error preserves an existing successful snapshot', async t => {
  const db = fixture(t);
  await runRefresh({ DB: db }, opts());
  const previous = db.row().snapshot_json;
  db.failBatchAt = 0;
  const result = await runRefresh({ DB: db }, opts());
  assert.equal(result.status, 'error');
  assert.equal(db.row().snapshot_json, previous);
  assert.equal(db.row().revision, 1);
  assert.equal(db.events().length, 1);
});

test('missing binding and database failures return unavailable without leaking errors', async () => {
  assert.equal((await runRefresh({}, opts())).code, 503);
  const broken = { prepare() { throw new Error('sensitive raw exception'); } };
  const result = await runRefresh({ DB: broken }, opts());
  assert.equal(result.code, 503);
  assert.ok(!JSON.stringify(result).includes('sensitive'));
});

test('failed snapshot reads return 503 so browsers never replace cached truth with baseline', async () => {
  const request = new Request('https://mineria-fixture.workers.dev/api/snapshot', { headers: { Origin: 'https://muclacic3-star.github.io' } });
  for (const env of [{}, { DB: { prepare() { throw new Error('offline'); } } }]) {
    const response = await worker.fetch(request, env);
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), 'https://muclacic3-star.github.io');
    assert.equal((await response.json()).service.mode, 'unavailable');
  }
});

test('healthy snapshots expose news and operational status without internal source IDs', async t => {
  const db = fixture(t);
  await runRefresh({ DB: db }, opts());
  const response = await worker.fetch(new Request('https://mineria-fixture.workers.dev/api/snapshot'), { DB: db });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  const snapshot = await response.json();
  assert.equal(snapshot.projects[0].estado, 'suspendido');
  assert.equal(snapshot.news[0].sourceId, undefined);
  assert.equal(snapshot.news[0].summary, undefined);
  assert.equal(snapshot.news[0].publisher, source.name);
});

test('manual refresh requires POST and authentication and never reflects secrets', async () => {
  const root = 'https://mineria-fixture.workers.dev/api/refresh';
  const secret = 'fictional-secret-for-test';
  const cases = [
    [new Request(root), { ADMIN_TOKEN: secret }, 405],
    [new Request(root, { method: 'POST' }), {}, 503],
    [new Request(root, { method: 'POST' }), { ADMIN_TOKEN: secret }, 401],
    [new Request(root, { method: 'POST', headers: { Authorization: 'Bearer wrong' } }), { ADMIN_TOKEN: secret }, 401],
    [new Request(root, { method: 'POST', headers: { Authorization: `Bearer ${secret}` } }), { ADMIN_TOKEN: secret }, 503],
  ];
  for (const [request, env, status] of cases) {
    const response = await worker.fetch(request, env);
    assert.equal(response.status, status);
    assert.ok(!(await response.text()).includes(secret));
  }
});
