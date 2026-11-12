import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const updater = await readFile(new URL('../actualizaciones.js', import.meta.url), 'utf8');
const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(x => x[1]).filter(x => x.includes('const PROYECTOS'));
const seed = JSON.parse(await readFile(new URL('../src/projects-seed.json', import.meta.url), 'utf8'));

function element() {
  const classes = new Set();
  return { innerHTML: '', textContent: '', style: {}, children: [], events: {}, attributes: {}, scrollTop: 0, hidden: false,
    classList: { add: (...xs) => xs.forEach(x => classes.add(x)), remove: (...xs) => xs.forEach(x => classes.delete(x)), contains: x => classes.has(x) },
    setAttribute(name, value) { this.attributes[name] = value; }, removeAttribute(name) { delete this.attributes[name]; },
    append(...xs) { this.children.push(...xs); }, replaceChildren(...xs) { this.children = xs; },
    addEventListener(name, fn) { this.events[name] = fn; }
  };
}

function harness(saved = null, baseURI = 'https://app.example/', withBoundary = true) {
  const nodes = new Map();
  const get = id => { if (!nodes.has(id)) nodes.set(id, element()); return nodes.get(id); };
  const listeners = {};
  const storage = new Map(saved ? [['msj-snapshot-v1.3', JSON.stringify(saved)]] : []);
  const queue = [];
  const requestedURLs = [];
  const maps = new Map();
  const tileLayers = [];
  const geoLayers = [];
  const viewNames = ['inicio', 'proyectos', 'mapa', 'noticias', 'acerca'];
  const views = viewNames.map(name => get('vista-' + name));
  let requests = 0;
  const visibleMapView = id => get(id === 'mapa-mini' ? 'vista-inicio' : 'vista-mapa').classList.contains('activa');
  function layer(kind, id, options = {}) {
    return { kind, id, options, style: { ...options }, layers: [], events: {}, panes: {}, invalidations: [],
      visibleAtCreation: kind === 'map' ? visibleMapView(id) : undefined,
      setView(center, zoom) { this.center = Array.from(center); this.zoom = zoom; return this; },
      addTo(map) { this.map = map; map.layers.push(this); return this; },
      bindPopup(x) { this.popup = x; return this; }, setPopupContent(x) { this.popup = x; },
      setStyle(x) { this.style = x; }, openPopup() { this.popupOpened = true; return this; },
      getContainer() { return get(this.id); },
      createPane(name) { return (this.panes[name] = element()); },
      invalidateSize(options) { this.invalidations.push({ options, visible: visibleMapView(this.id) }); return this; },
      on(names, callback) { for (const name of names.split(' ')) (this.events[name] ??= []).push(callback); return this; },
      fire(name, event = {}) { for (const callback of this.events[name] || []) callback(event); return this; }
    };
  }
  const leaflet = {
    map(id, options) { const map = layer('map', id, options); maps.set(id, map); return map; },
    tileLayer(url, options) { const tiles = layer('tiles', url, options); tileLayers.push(tiles); return tiles; },
    circleMarker(coords, options) { return layer('marker', coords, options); },
    geoJSON(data, options) { const boundary = layer('boundary', null, options); boundary.data = data; geoLayers.push(boundary); return boundary; }
  };
  const context = vm.createContext({ console, URL, Intl, Date, AbortController,
    setTimeout: () => 1, clearTimeout() {}, setInterval() {}, requestAnimationFrame: f => f(),
    document: { getElementById: get, querySelector: selector => selector === '.vista.activa' ? views.find(view => view.classList.contains('activa')) || null : null,
      querySelectorAll: selector => selector === '.vista' ? views : selector === '.contenedor-mapa' ? [get('mapa-mini'), get('mapa-full')] : [],
      createElement: element, body: element(), hidden: false, baseURI, addEventListener: (n, fn) => { listeners[n] = fn; } },
    window: { scrollTo() {}, addEventListener: (n, fn) => { listeners[n] = fn; } },
    navigator: { onLine: true }, L: leaflet,
    localStorage: { getItem: k => storage.get(k) || null, setItem: (k, v) => storage.set(k, v) },
    fetch: async (url) => { requests++; requestedURLs.push(url.href); const next = queue.shift(); if (!next || next instanceof Error) throw next || Error('offline'); return next; }
  });
  if (withBoundary) context.LIMITE_SAN_JUAN = { type: 'FeatureCollection', features: [
    { type: 'Feature', properties: { name: 'Contorno sintético de prueba' }, geometry: { type: 'Polygon', coordinates: [[[-70, -31], [-69, -31], [-69, -30], [-70, -31]]] } }
  ] };
  vm.runInContext(updater, context);
  for (const script of scripts) vm.runInContext(script, context);
  const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
  return { get, maps, tileLayers, geoLayers, listeners, storage, queue, requestedURLs, context, settle, eval: code => vm.runInContext(code, context), requests: () => requests,
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
  app.eval("cambiarVista('mapa'); cambiarVista('inicio')");
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
  assert.equal(app.eval('marcadoresMini[1].style.dashArray'), '3 2');
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

test('each map initializes only in its visible view and hidden maps are not resized', async () => {
  const app = harness(); await app.start();
  assert.equal(app.maps.size, 1);
  const mini = app.maps.get('mapa-mini');
  assert.ok(mini);
  assert.equal(mini.visibleAtCreation, true);
  assert.equal(app.eval('mapaCompleto'), null);
  assert.equal(app.get('vista-inicio').classList.contains('activa'), true);

  app.eval("cambiarVista('proyectos'); prepararMapa('mapa')");
  assert.equal(app.maps.size, 1, 'preparing an invisible map must not initialize it');
  app.eval("cambiarVista('mapa')");
  const full = app.maps.get('mapa-full');
  assert.ok(full);
  assert.equal(full.visibleAtCreation, true);
  assert.equal(app.get('vista-mapa').classList.contains('activa'), true);
  assert.equal(app.get('vista-proyectos').classList.contains('activa'), false);
  assert.equal(full.layers.filter(layer => layer.kind === 'marker').length, seed.length);
  assert.equal(app.geoLayers.filter(layer => layer.map === full).length, 1);
  assert.equal(app.geoLayers.filter(layer => layer.map === mini).length, 1);

  app.eval("cambiarVista('inicio')");
  const fullResizeCount = full.invalidations.length;
  app.eval("prepararMapa('mapa')");
  assert.equal(full.invalidations.length, fullResizeCount);
  app.eval("cambiarVista('mapa'); cambiarVista('inicio')");
  assert.equal(app.maps.size, 2);
  assert.equal(app.maps.get('mapa-full'), full, 'returning to the map reuses its instance');
  assert.ok(mini.invalidations.length > 0);
  assert.ok(full.invalidations.length > 0);
  for (const map of [mini, full]) {
    for (const call of map.invalidations) {
      assert.equal(call.visible, true);
      assert.equal(call.options?.pan, false, 'resizing does not shift the selected project');
    }
  }
});

test('Ver en mapa immediately initializes, centers and opens the chosen project', async () => {
  const app = harness(); await app.start();
  app.eval('abrirDetalle(1); verEnMapa(1)');
  const full = app.maps.get('mapa-full');
  assert.ok(full);
  assert.equal(full.visibleAtCreation, true);
  assert.equal(app.get('vista-mapa').classList.contains('activa'), true);
  assert.deepEqual(full.center, Array.from(app.eval('PROYECTOS.find(p => p.id === 1).coords')));
  assert.equal(full.zoom, 11);
  assert.equal(app.eval('marcadores[1].popupOpened'), true);
  assert.equal(app.get('hoja-detalle').classList.contains('abierta'), false);
});

test('failed base tiles leave every project marker usable and recover after a successful load cycle', async () => {
  const app = harness(); await app.start();
  app.eval("cambiarVista('mapa')");
  const full = app.maps.get('mapa-full');
  const tiles = app.tileLayers.find(layer => layer.map === full);
  assert.ok(tiles);
  const notice = app.get('mapa-full').children.find(child => child.className === 'aviso-mapa');
  assert.ok(notice);
  assert.equal(notice.attributes.role, 'status');
  assert.equal(notice.hidden, true);
  tiles.fire('loading').fire('tileerror').fire('load');
  assert.equal(notice.hidden, false, 'load after a failed tile must not conceal the error');
  assert.match(notice.textContent, /mapa base|fondo|cartograf|cargar/i);
  assert.equal(full.layers.filter(layer => layer.kind === 'marker').length, seed.length);
  assert.equal(app.eval('Object.keys(marcadores).length'), seed.length);
  app.eval('marcadores[1].openPopup()');
  assert.equal(app.eval('marcadores[1].popupOpened'), true);
  tiles.fire('loading').fire('load');
  assert.equal(notice.hidden, true);
});

test('a missing optional boundary does not prevent projects from appearing on either map', async () => {
  const app = harness(null, 'https://app.example/', false); await app.start();
  app.eval("cambiarVista('mapa')");
  assert.equal(app.geoLayers.length, 0);
  for (const map of app.maps.values()) assert.equal(map.layers.filter(layer => layer.kind === 'marker').length, seed.length);
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

test('service worker leaves live APIs and OpenStreetMap tiles out of its cache', async () => {
  const handlers = {};
  const source = await readFile(new URL('../sw.js', import.meta.url), 'utf8');
  const context = vm.createContext({ URL, self: { location: { origin: 'https://app.example' }, registration: { scope: 'https://app.example/' }, addEventListener: (name, fn) => { handlers[name] = fn; } } });
  vm.runInContext(source, context);
  let intercepted = false;
  handlers.fetch({ request: { method: 'GET', url: 'https://app.example/api/snapshot', mode: 'cors' }, respondWith() { intercepted = true; } });
  handlers.fetch({ request: { method: 'GET', url: 'https://mineria-san-juan.muclacic3.workers.dev/api/snapshot', mode: 'cors' }, respondWith() { intercepted = true; } });
  handlers.fetch({ request: { method: 'GET', url: 'https://tile.openstreetmap.org/7/39/75.png', mode: 'no-cors' }, respondWith() { intercepted = true; } });
  assert.equal(intercepted, false);
});
