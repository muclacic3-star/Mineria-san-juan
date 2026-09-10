import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const updater = await readFile(new URL('../actualizaciones.js', import.meta.url), 'utf8');
const pilotModule = await readFile(new URL('../agua-impactos.js', import.meta.url), 'utf8');
const pilotData = JSON.parse(await readFile(new URL('../data/veladero.json', import.meta.url), 'utf8'));
const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(x => x[1]).filter(x => x.includes('const PROYECTOS'));
const seed = JSON.parse(await readFile(new URL('../src/projects-seed.json', import.meta.url), 'utf8'));

function element() {
  const classes = new Set();
  return { innerHTML: '', textContent: '', style: {}, children: [], events: {}, scrollTop: 0,
    classList: { add: (...xs) => xs.forEach(x => classes.add(x)), remove: (...xs) => xs.forEach(x => classes.delete(x)), contains: x => classes.has(x) },
    setAttribute() {}, removeAttribute() {},
    append(...xs) { this.children.push(...xs); }, replaceChildren(...xs) { this.children = xs; },
    addEventListener(name, fn) { this.events[name] = fn; },
    querySelector() { return null; }
  };
}

function harness(saved = null, baseURI = 'https://app.example/') {
  const nodes = new Map();
  const get = id => { if (!nodes.has(id)) nodes.set(id, element()); return nodes.get(id); };
  const listeners = {};
  const storage = new Map(saved ? [['msj-snapshot-v1.3', JSON.stringify(saved)]] : []);
  const queue = [];
  const requestedURLs = [];
  let requests = 0;
  const layer = () => ({ style: {}, setView() { return this; }, addTo() { return this; }, bindPopup(x) { this.popup = x; return this; }, setPopupContent(x) { this.popup = x; }, setStyle(x) { this.style = x; } });
  const context = vm.createContext({ console, URL, Intl, Date, AbortController,
    setTimeout: () => 1, clearTimeout() {}, setInterval() {}, requestAnimationFrame: f => f(),
    document: { getElementById: get, querySelector: () => null, querySelectorAll: () => [], createElement: element, body: element(), hidden: false, baseURI, addEventListener: (n, fn) => { listeners[n] = fn; } },
    window: { scrollTo() {}, addEventListener: (n, fn) => { listeners[n] = fn; } },
    navigator: { onLine: true }, L: { map: layer, tileLayer: layer, circleMarker: layer },
    localStorage: { getItem: k => storage.get(k) || null, setItem: (k, v) => storage.set(k, v) },
    fetch: async (url) => {
      requests++; requestedURLs.push(url.href);
      if (url.pathname.endsWith('/data/veladero.json')) return { ok: true, json: async () => structuredClone(pilotData) };
      const next = queue.shift(); if (!next || next instanceof Error) throw next || Error('offline'); return next;
    }
  });
  vm.runInContext(updater, context);
  vm.runInContext(pilotModule, context);
  for (const script of scripts) vm.runInContext(script, context);
  const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
  return { get, listeners, storage, queue, requestedURLs, context, settle, eval: code => vm.runInContext(code, context), requests: () => requests,
    async start() { listeners.DOMContentLoaded(); await settle(); },
    async refresh(value, status = 200) { queue.push({ ok: status === 200, json: async () => value }); await get('btn-actualizar-noticias').events.click(); await settle(); }
  };
}

function snapshot(time = '2026-09-06T12:00:00.000Z') {
  return { version: '1.3', generatedAt: time, lastSuccessAt: time, sources: [], news: [], service: { mode: 'ready' },
    projects: seed.map(p => ({ id: p.id, estado: p.estado, verification: 'baseline', history: [], evidence: [] })) };
}

test('one verified update synchronizes catalog, both maps, counts and an open detail without moving its scroll', async () => {
  const app = harness(); await app.start();
  app.eval('abrirDetalle(1)'); app.get('contenido-detalle').scrollTop = 123;
  const updated = snapshot(); updated.projects[0] = { ...updated.projects[0], estado: 'suspendido', verification: 'confirmed' };
  await app.refresh(updated);
  assert.equal(app.eval('PROYECTOS[0].estado'), 'suspendido');
  assert.equal(app.get('stat-suspendido').textContent, 2);
  assert.match(app.get('estado-detalle-actual').innerHTML, /Suspendido/);
  assert.equal(app.get('contenido-detalle').scrollTop, 123);
  for (const name of ['marcadores', 'marcadoresMini']) {
    assert.equal(app.eval(`${name}[1].style.fillColor`), app.eval('ESTADOS.suspendido.color'));
    assert.match(app.eval(`${name}[1].popup`), /Suspendido/);
  }
  app.eval("filtroActivo = 'produccion'; renderLista()");
  assert.doesNotMatch(app.get('lista-proyectos').innerHTML, /Veladero/);
  assert.equal(JSON.parse(app.storage.get('msj-snapshot-v1.3')).projects[0].estado, 'suspendido');
});

test('a database failure, invalid schema or older snapshot cannot revert the saved state', async () => {
  const saved = snapshot(); saved.projects[0].estado = 'suspendido'; saved.projects[0].verification = 'confirmed';
  const app = harness(saved); await app.start();
  await app.refresh(snapshot('2026-09-07T12:00:00Z'), 503);
  await app.refresh(snapshot('2026-09-05T12:00:00Z'));
  await app.refresh({ ...snapshot(), generatedAt: 'invalid' });
  await app.refresh({ ...snapshot(), projects: [] });
  assert.equal(app.eval('PROYECTOS[0].estado'), 'suspendido');
  assert.equal(JSON.parse(app.storage.get('msj-snapshot-v1.3')).projects[0].estado, 'suspendido');
  assert.match(app.get('aviso-actualizacion').textContent, /última copia/);
});

test('news content stays text, unsafe links are excluded and reviews keep the last state visible', async () => {
  const app = harness(); await app.start();
  const next = snapshot();
  next.projects[0] = { ...next.projects[0], verification: 'review', reason: '<img src=x onerror=alert(1)>' };
  next.news = [
    { title: '<script>alert(1)</script>', publisher: '<b>Fuente</b>', url: 'https://source.example/article', projectIds: [1] },
    { title: 'Unsafe', url: 'javascript:alert(1)' }
  ];
  await app.refresh(next);
  assert.equal(app.get('noticias-automaticas').children.length, 1);
  assert.equal(app.get('noticias-automaticas').children[0].children[1].children[0].textContent, '<script>alert(1)</script>');
  const detail = app.eval('verificacionHTML(PROYECTOS[0], false)');
  assert.match(detail, /Información en revisión/); assert.match(detail, /&lt;img/); assert.doesNotMatch(detail, /<img/);
  assert.equal(app.eval('marcadores[1].style.dashArray'), '3 2');
  assert.equal(app.eval('PROYECTOS[0].estado'), seed[0].estado);
});

test('offline start loads saved information without attempting the network', async () => {
  const saved = snapshot(); const app = harness(saved);
  app.context.navigator.onLine = false; await app.start();
  assert.equal(app.requests(), 0); assert.match(app.get('aviso-actualizacion').textContent, /Sin conexión/);
  assert.equal(app.eval('PROYECTOS[0].actualizacion.verification'), 'baseline');
});

test('event calendar dates and date-only source references keep the recorded day in Argentina', () => {
  const app = harness();
  const realFormatter = Intl.DateTimeFormat;
  app.context.Intl = { DateTimeFormat: function (locale, options) {
    return new realFormatter(locale, { timeZone: 'America/Argentina/Buenos_Aires', ...options });
  } };
  assert.match(app.eval("fechaVisible('2026-09-05T00:00:00.000Z', false, true)"), /^05/);
  assert.match(app.eval("fechaVisible('2026-07-31', false)"), /^31/);
  assert.match(app.eval("fechaVisible('2026-09-05T00:00:00.000Z', true)"), /^04/);
});

test('GitHub Pages reads the live Worker while other hosts use their own API', async () => {
  for (const [baseURI, expected] of [
    ['https://muclacic3-star.github.io/Mineria-san-juan/', 'https://mineria-san-juan.muclacic3.workers.dev/api/snapshot'],
    ['https://mineria-san-juan.muclacic3.workers.dev/', 'https://mineria-san-juan.muclacic3.workers.dev/api/snapshot'],
    ['http://localhost:8787/', 'http://localhost:8787/api/snapshot']
  ]) {
    const app = harness(null, baseURI);
    app.queue.push({ ok: true, json: async () => snapshot() });
    await app.start();
    assert.equal(app.requestedURLs[0], expected);
    assert.match(app.get('aviso-actualizacion').textContent, /Noticias consultadas|referencias de las fichas/);
    assert.ok(app.storage.has('msj-snapshot-v1.3'));
  }
});

test('service worker leaves live API requests out of its cache, including the Worker from Pages', async () => {
  const handlers = {};
  const source = await readFile(new URL('../sw.js', import.meta.url), 'utf8');
  const context = vm.createContext({ URL, self: { location: { origin: 'https://app.example' }, registration: { scope: 'https://app.example/' }, addEventListener: (name, fn) => { handlers[name] = fn; } } });
  vm.runInContext(source, context);
  let intercepted = false;
  handlers.fetch({ request: { method: 'GET', url: 'https://app.example/api/snapshot', mode: 'cors' }, respondWith() { intercepted = true; } });
  handlers.fetch({ request: { method: 'GET', url: 'https://mineria-san-juan.muclacic3.workers.dev/api/snapshot', mode: 'cors' }, respondWith() { intercepted = true; } });
  assert.equal(intercepted, false);
});

test('the Veladero pilot survives a live news refresh and is absent from other mine details', async () => {
  const app = harness(); await app.start();
  app.eval('abrirDetalle(2)');
  assert.doesNotMatch(app.get('contenido-detalle').innerHTML, /id="piloto-veladero"/);
  assert.equal(app.requestedURLs.filter(url => url.endsWith('data/veladero.json')).length, 0);
  app.eval('abrirDetalle(1)'); await app.settle();
  const panel = app.get('piloto-veladero');
  assert.match(panel.innerHTML, /Comparador pendiente de documentación/);
  assert.match(panel.innerHTML, /Empleo y aportes económicos/);
  const content = panel.innerHTML;
  app.get('contenido-detalle').scrollTop = 640;
  const updated = snapshot(); updated.projects[0].estado = 'suspendido';
  await app.refresh(updated);
  assert.equal(panel.innerHTML, content);
  assert.equal(app.get('contenido-detalle').scrollTop, 640);
  assert.match(app.get('estado-detalle-actual').innerHTML, /Suspendido/);
  assert.equal(app.requestedURLs.filter(url => url.endsWith('data/veladero.json')).length, 1);
});

test('upgrading the service worker precaches the pilot and keeps it available without network', async () => {
  const handlers = {};
  const stores = new Map([['msj-app-v1.3-sep2026-pickaxe-1', new Map()], ['another-app', new Map()]]);
  const scope = 'https://muclacic3-star.github.io/Mineria-san-juan/';
  const key = request => new URL(typeof request === 'string' ? request : request.url, scope).href;
  const cacheAPI = {
    keys: async () => [...stores.keys()],
    delete: async name => stores.delete(name),
    open: async name => {
      if (!stores.has(name)) stores.set(name, new Map());
      const saved = stores.get(name);
      return { addAll: async paths => { for (const path of paths) saved.set(key(path), { ok: true, path }); },
        match: async request => saved.get(key(request)) };
    },
    match: async request => { for (const saved of stores.values()) if (saved.has(key(request))) return saved.get(key(request)); }
  };
  const context = vm.createContext({ URL, caches: cacheAPI, fetch: async () => { throw Error('offline'); },
    self: { location: { origin: 'https://muclacic3-star.github.io' }, registration: { scope },
      addEventListener: (name, fn) => { handlers[name] = fn; }, skipWaiting: async () => {}, clients: { claim: async () => {} } }
  });
  vm.runInContext(await readFile(new URL('../sw.js', import.meta.url), 'utf8'), context);
  let pending;
  handlers.install({ waitUntil: promise => { pending = promise; } }); await pending;
  handlers.activate({ waitUntil: promise => { pending = promise; } }); await pending;
  assert.ok(!stores.has('msj-app-v1.3-sep2026-pickaxe-1'));
  assert.ok(stores.has('another-app'));
  for (const path of ['agua-impactos.js', 'agua-impactos.css', 'data/veladero.json']) {
    handlers.fetch({ request: { method: 'GET', mode: 'cors', url: new URL(path, scope).href }, respondWith: promise => { pending = promise; } });
    assert.equal((await pending).path, './' + path);
  }
});
