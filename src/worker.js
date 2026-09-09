import projectsSeed from './projects-seed.json' with { type: 'json' };
import configuredSources from './sources.json' with { type: 'json' };
import { collectSource, LIMITS, mergeNews } from './ingestion.js';
import { baselineProjects, evaluateProjects } from './status-rules.js';

const ALLOWED_ORIGIN = 'https://muclacic3-star.github.io';
const LEASE_MS = 120000;
const DB_ERROR = 'El servidor no pudo consultar su base de datos. Conservá la última información disponible.';

function json(body, status = 200, additionalHeaders = {}) {
  return new Response(JSON.stringify(body), { status, headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...additionalHeaders,
  } });
}

export function baselineSnapshot(now = new Date().toISOString(), error = null, seeds = projectsSeed, sources = configuredSources) {
  return { version: '1.3', generatedAt: now, lastAttemptAt: null, lastSuccessAt: null,
    sources: sources.map(source => ({ id: source.id, name: source.name, url: source.url,
      lastAttemptAt: null, lastSuccessAt: null, error })),
    projects: baselineProjects(seeds), news: [],
    service: { mode: error ? 'unavailable' : 'pending', error },
  };
}

function publicSnapshot(snapshot) {
  return { ...snapshot, news: snapshot.news.map(({ sourceId, summary, ...item }) => item) };
}

async function storedSnapshot(db, now) {
  const row = await db.prepare('SELECT snapshot_json, last_attempt_at, last_error FROM runtime_state WHERE id = 1').first();
  if (!row) throw new Error('missing_migration');
  const snapshot = row.snapshot_json ? JSON.parse(row.snapshot_json) : baselineSnapshot(now);
  snapshot.lastAttemptAt = row.last_attempt_at ?? snapshot.lastAttemptAt;
  if (row.last_error) snapshot.service = { mode: 'degraded', error: row.last_error };
  return snapshot;
}

function corsHeaders(request) {
  const origin = request.headers.get('Origin');
  if (origin === ALLOWED_ORIGIN || origin === new URL(request.url).origin) {
    return { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' };
  }
  return { Vary: 'Origin' };
}

async function authorized(request, token) {
  const supplied = request.headers.get('Authorization') ?? '';
  // Hash both strings to fixed length rather than return after a prefix match.
  const [left, right] = await Promise.all([supplied, `Bearer ${token}`].map(text =>
    crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))));
  const a = new Uint8Array(left), b = new Uint8Array(right);
  let mismatch = 0;
  for (let index = 0; index < a.length; index++) mismatch |= a[index] ^ b[index];
  return mismatch === 0;
}

export async function runRefresh(env, options = {}) {
  if (!env.DB) return { status: 'unavailable', code: 503, message: 'La base de datos todavía no está configurada.' };
  // Tests supply a clock, not an old start time compared against the real clock.
  // Production checks wall time again at commit so a stale lease cannot publish.
  const clock = options.clock ?? (() => new Date().toISOString());
  const now = options.now ?? clock();
  const seeds = options.seeds ?? projectsSeed;
  const sources = options.sources ?? configuredSources;
  const fetchImpl = options.fetchImpl ?? fetch;
  const owner = crypto.randomUUID();
  let acquired = false;
  try {
    const row = await env.DB.prepare(`UPDATE runtime_state
      SET lease_owner = ?, lease_until = ?, last_attempt_at = ?, last_error = NULL
      WHERE id = 1 AND (lease_until IS NULL OR lease_until < ?)
      RETURNING snapshot_json, revision`).bind(owner, new Date(Date.parse(now) + LEASE_MS).toISOString(), now, now).first();
    if (!row) return { status: 'busy', code: 409, message: 'Ya hay una actualización en curso o falta inicializar la base de datos.' };
    acquired = true;
    const previous = row.snapshot_json ? JSON.parse(row.snapshot_json) : baselineSnapshot(now, null, seeds, sources);
    const activeSources = sources.slice(0, LIMITS.sources);
    const results = await Promise.all(activeSources.map(source => collectSource(source, seeds, now, fetchImpl)));
    const oldSources = new Map(previous.sources.map(source => [source.id, source]));
    const sourceStatus = results.map(result => ({ ...result.source,
      lastSuccessAt: result.source.lastSuccessAt ?? oldSources.get(result.source.id)?.lastSuccessAt ?? null,
    }));
    for (const source of sources.slice(LIMITS.sources)) {
      sourceStatus.push({ id: source.id, name: source.name, url: source.url,
        lastAttemptAt: null, lastSuccessAt: oldSources.get(source.id)?.lastSuccessAt ?? null,
        error: 'Fuente pendiente: se superó el máximo de ocho fuentes configuradas por ejecución.' });
    }
    const successCount = results.filter(result => !result.source.error).length;
    const news = mergeNews(previous.news, results.flatMap(result => result.news));
    const { projects, events } = await evaluateProjects(previous.projects, seeds, news, sources, now);
    const allGood = successCount > 0 && sourceStatus.every(source => !source.error);
    const snapshot = {
      version: '1.3', generatedAt: now, lastAttemptAt: now,
      // Global success records a complete configured-source pass; per-source
      // timestamps show partial progress without advertising a full refresh.
      lastSuccessAt: allGood ? now : previous.lastSuccessAt,
      sources: sourceStatus, projects, news,
      service: { mode: allGood ? 'ready' : 'degraded', error: allGood ? null
        : sources.length ? 'No se pudo completar la consulta de todas las fuentes. Se conserva la información disponible.'
          : 'Todavía no hay fuentes de noticias configuradas.' },
    };
    const statements = [env.DB.prepare(`UPDATE runtime_state
      SET snapshot_json = ?, revision = revision + 1, last_error = ?,
          lease_owner = NULL, lease_until = NULL, last_commit_id = ?
      WHERE id = 1 AND lease_owner = ? AND revision = ? AND lease_until > ?`)
      .bind(JSON.stringify(snapshot), snapshot.service.error, owner, owner, row.revision, clock())];
    for (const event of events) {
      statements.push(env.DB.prepare(`INSERT OR IGNORE INTO status_events
        (id, project_id, from_state, to_state, effective_at, checked_at, evidence_json)
        SELECT ?, ?, ?, ?, ?, ?, ?
        WHERE EXISTS (SELECT 1 FROM runtime_state WHERE id = 1 AND last_commit_id = ?)`)
        .bind(event.id, event.projectId, event.from, event.to, event.effectiveAt, event.checkedAt, JSON.stringify(event.evidence), owner));
    }
    // D1.batch executes the publication and its events in one transaction. An
    // expired/replaced lease cannot publish either snapshot or audit events.
    const committed = await env.DB.batch(statements);
    if (!committed[0]?.meta?.changes) return { status: 'conflict', code: 409, message: 'Otra actualización tomó el control; se mantiene la información ya guardada.' };
    acquired = false;
    return { status: allGood ? 'updated' : 'partial', code: 200,
      lastAttemptAt: now, lastSuccessAt: snapshot.lastSuccessAt,
      successfulSources: successCount, configuredSources: sources.length,
      newsCount: news.length, statusChanges: events.length };
  } catch {
    return { status: 'error', code: 503, message: 'La actualización no pudo guardarse. Se conserva la última información disponible.' };
  } finally {
    if (acquired) {
      try {
        await env.DB.prepare(`UPDATE runtime_state SET lease_owner = NULL, lease_until = NULL,
          last_error = ? WHERE id = 1 AND lease_owner = ?`)
          .bind('La actualización se interrumpió. Se conserva la última información disponible.', owner).run();
      } catch { /* The short lease will expire; never log credentials or a raw exception. */ }
    }
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/snapshot') {
      if (request.method !== 'GET') return json({ error: 'Método no permitido.' }, 405, { Allow: 'GET' });
      const now = new Date().toISOString();
      let snapshot, status = 200;
      if (!env.DB) {
        snapshot = baselineSnapshot(now, 'El servidor todavía no tiene una base de datos configurada.');
        status = 503;
      }
      else {
        try { snapshot = await storedSnapshot(env.DB, now); }
        catch { snapshot = baselineSnapshot(now, DB_ERROR); status = 503; }
      }
      return json(publicSnapshot(snapshot), status, corsHeaders(request));
    }
    if (url.pathname === '/api/health') {
      if (request.method !== 'GET') return json({ error: 'Método no permitido.' }, 405, { Allow: 'GET' });
      if (!env.DB) return json({ version: '1.3', status: 'unconfigured', database: false }, 503);
      try {
        const snapshot = await storedSnapshot(env.DB, new Date().toISOString());
        return json({ version: '1.3', status: snapshot.service?.mode ?? 'pending', database: true,
          lastAttemptAt: snapshot.lastAttemptAt, lastSuccessAt: snapshot.lastSuccessAt });
      } catch { return json({ version: '1.3', status: 'unavailable', database: false }, 503); }
    }
    if (url.pathname === '/api/refresh') {
      if (request.method !== 'POST') return json({ error: 'Método no permitido.' }, 405, { Allow: 'POST' });
      if (!env.ADMIN_TOKEN) return json({ error: 'La actualización manual todavía no está habilitada.' }, 503);
      if (!(await authorized(request, env.ADMIN_TOKEN))) return json({ error: 'No autorizado.' }, 401);
      const result = await runRefresh(env);
      const { code, ...body } = result;
      return json(body, code);
    }
    if (url.pathname.startsWith('/api/')) return json({ error: 'Ruta no encontrada.' }, 404);
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response('Minería San Juan: la aplicación web todavía no está configurada.', {
      status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  },
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(runRefresh(env).then(result => {
      // Only operational counts/codes: no feed body, token, account ID or stack.
      console.log(JSON.stringify({ job: 'refresh', status: result.status,
        successfulSources: result.successfulSources ?? 0, statusChanges: result.statusChanges ?? 0 }));
    }));
  },
};
