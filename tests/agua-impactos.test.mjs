import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../agua-impactos.js', import.meta.url), 'utf8');
function harness(baseURI = 'https://muclacic3-star.github.io/Mineria-san-juan/') {
  const queue = [];
  const requestedURLs = [];
  const context = vm.createContext({ URL, Intl, Date, document: { baseURI },
    fetch: async url => {
      requestedURLs.push(url.href);
      const next = queue.shift();
      if (!next || next instanceof Error) throw next || new Error('offline');
      return next;
    }
  });
  vm.runInContext(source, context);
  return { api: context.AguaImpactos, queue, requestedURLs, context };
}

// These invented locations and values are test fixtures, never production records.
function fixture() {
  return {
    schemaVersion: 1, projectId: 1, reviewedAt: '2026-09-10',
    documents: [{ id: 'test-report', title: 'INFORME SINTÉTICO DE PRUEBA', publisher: 'Laboratorio ficticio de pruebas', sourceType: 'laboratory', publishedAt: '2025-12-01', url: 'https://example.org/test-report.pdf', status: 'final', note: 'Ensayo ficticio encargado por una institución de pruebas.' }],
    water: { status: 'ready', summary: 'Campaña ficticia para pruebas.', missingDocuments: [], campaigns: [{
      id: 'test-campaign', label: 'Campaña sintética', verification: 'verified', reportId: 'test-report', waterType: 'surface', samplingResponsible: 'Muestreador ficticio', laboratory: 'Laboratorio ficticio de pruebas',
      points: [{ id: 'test-a', name: 'Punto ficticio A', location: 'Ubicación sintética A', evidence: { documentId: 'test-report', page: 1 } }, { id: 'test-b', name: 'Punto ficticio B', location: 'Ubicación sintética B', evidence: { documentId: 'test-report', page: 1 } }],
      measurements: [
        { pointId: 'test-a', parameter: 'arsenic-total', sampledAt: '2025-11-27', result: '<0,01', unit: 'mg/L', method: 'Método sintético A', sourceId: 'test-report', page: 2, lq: 0.01 },
        { pointId: 'test-b', parameter: 'arsenic-total', sampledAt: '2025-11-27', result: 'no detectado', unit: 'mg/L', method: 'Método sintético A', sourceId: 'test-report', page: 3 }
      ]
    }] },
    impacts: ['water', 'incidents', 'economy', 'unknowns'].map(id => ({ id, title: 'Apartado de prueba ' + id, items: [{ id: id + '-test', claim: 'Afirmación ficticia ' + id, status: id === 'unknowns' ? 'undetermined' : 'documented', period: '2025', evidence: [{ documentId: 'test-report', page: 2, section: 'Sección sintética' }] }] }))
  };
}
function pendingFixture() {
  const data = fixture();
  data.documents[0].status = 'preliminary';
  data.water = { status: 'pending', summary: 'Falta el informe final.', missingDocuments: ['Informe final', 'Identificación de puntos'], campaigns: [] };
  return data;
}
function element() {
  const children = new Map();
  return {
    innerHTML: '', isConnected: true, attributes: {}, events: {}, value: '0',
    setAttribute(name, value) { this.attributes[name] = value; },
    removeAttribute(name) { delete this.attributes[name]; },
    addEventListener(name, listener) { this.events[name] = listener; },
    querySelector(selector) {
      if (selector === '[data-ai-parameter]' && !this.innerHTML.includes('data-ai-parameter')) return null;
      if (!children.has(selector)) children.set(selector, element());
      return children.get(selector);
    }
  };
}
const response = data => ({ ok: true, json: async () => data });

test('production records validate and every published comparison is backed by a final report', async () => {
  const data = JSON.parse(await readFile(new URL('../data/veladero.json', import.meta.url), 'utf8'));
  const { api } = harness();
  assert.equal(api.validateData(data), data);
  if (data.water.status === 'pending') {
    assert.equal(data.water.campaigns.length, 0);
    assert.equal(api.comparableGroups(data).length, 0);
    assert.doesNotMatch(api.renderHTML(data), /<table/);
  } else {
    assert.ok(api.comparableGroups(data).length > 0);
    for (const campaign of data.water.campaigns) assert.equal(data.documents.find(doc => doc.id === campaign.reportId).status, 'final');
  }
});

test('preliminary reports and unidentified sites cannot activate the water comparator', () => {
  const { api } = harness();
  const pending = pendingFixture();
  assert.equal(api.comparableGroups(pending).length, 0);
  assert.match(api.renderHTML(pending), /Comparador pendiente de documentación/);
  assert.match(api.renderHTML(pending), /Afirmación ficticia economy/);
  for (const mutate of [
    d => { d.documents[0].status = 'preliminary'; },
    d => { d.water.campaigns[0].verification = 'pending'; },
    d => { d.water.campaigns[0].points[0].location = ''; },
    d => { delete d.water.campaigns[0].points[0].evidence; },
    d => { d.water.campaigns[0].points[0].evidence = { documentId: 'test-report' }; },
    d => { d.water.campaigns[0].points[0].evidence.documentId = 'missing'; },
    d => { delete d.water.campaigns[0].samplingResponsible; },
    d => { delete d.water.campaigns[0].laboratory; },
    d => { delete d.documents[0].note; },
    d => { d.documents[0].publishedAt = null; },
    d => { d.documents[0].publishedAt = '2025'; },
    d => { d.water.campaigns[0].waterType = 'ground'; },
    d => { d.water.campaigns.push(structuredClone(d.water.campaigns[0])); },
    d => { d.water.status = 'pending'; }
  ]) {
    const data = fixture(); mutate(data);
    assert.throws(() => api.validateData(data));
  }
});

test('only separate sites sharing parameter, fraction, method and units form a comparable group', () => {
  const { api } = harness();
  for (const mutate of [
    d => { d.water.campaigns[0].measurements[1].unit = 'µg/L'; },
    d => { d.water.campaigns[0].measurements[1].method = 'Otro método'; },
    d => { d.water.campaigns[0].measurements[1].parameter = 'cyanide-total'; },
    d => { d.water.campaigns[0].measurements[1].parameter = 'arsenic-dissolved'; },
    d => { d.water.campaigns[0].measurements[1].pointId = 'test-a'; }
  ]) {
    const data = fixture(); mutate(data);
    assert.throws(() => api.validateData(data));
  }
  const data = fixture();
  const campaign = data.water.campaigns[0];
  campaign.measurements.push({ ...campaign.measurements[0], parameter: 'conductivity', result: '80', unit: 'µS/cm', method: 'Conductividad' });
  const groups = api.comparableGroups(data);
  assert.equal(groups.length, 1, 'one isolated conductivity measurement does not join the arsenic group');
  assert.equal(groups[0].measurements.length, 2);
  assert.equal(groups[0].parameter, 'arsenic-total');
});

test('below-detection and qualified results remain text, with source pages and accessible table headings', () => {
  const { api } = harness();
  const data = fixture();
  const html = api.renderHTML(data);
  assert.match(html, /&lt;0,01/);
  assert.match(html, /<strong>no detectado<\/strong>/);
  assert.match(html, /#page=2/);
  assert.match(html, /#page=3/);
  assert.match(html, /<caption>Arsénico total · mg\/L<\/caption>/);
  assert.match(html, /<th scope="col">Toma de muestra/);
  assert.match(html, /<th scope="row">Punto ficticio A/);
  assert.match(html, /<label for="ai-parameter-veladero">/);
  assert.match(html, /Fuente de ubicación · pág. 1/);
  assert.match(html, /Muestreo: Muestreador ficticio/);
  data.water.campaigns[0].measurements[1].result = 'ND';
  assert.match(api.renderHTML(data), /<strong>ND<\/strong>/);
  assert.equal(data.water.campaigns[0].measurements[0].result, '<0,01');
});

test('invalid references, dates, units and numeric coercion cannot enter the public records', () => {
  const { api } = harness();
  for (const mutate of [
    d => { d.impacts[0].items[0].evidence[0].documentId = 'missing'; },
    d => { d.impacts[0].items[0].evidence = []; },
    d => { d.water.campaigns[0].measurements[0].sourceId = 'missing'; },
    d => { d.water.campaigns[0].measurements[0].pointId = 'missing'; },
    d => { d.water.campaigns[0].measurements[0].sampledAt = '2025-02-30'; },
    d => { d.water.campaigns[0].measurements[0].sampledAt = '2025-12-02'; },
    d => { d.reviewedAt = '2025-11-20'; },
    d => { d.documents[0].publishedAt = '2025-13-02'; },
    d => { d.water.campaigns[0].measurements[0].result = 0; },
    d => { d.water.campaigns[0].measurements[0].unit = 'pH'; },
    d => { d.water.campaigns[0].measurements[0].page = 0; },
    d => { d.water.campaigns[0].measurements[0].ld = -1; },
    d => { d.water.campaigns[0].measurements[0].ld = 1; }
  ]) {
    const data = fixture(); mutate(data);
    assert.throws(() => api.validateData(data));
  }
});

test('only analytical result notation is accepted, and null limits never become zero', () => {
  const { api } = harness();
  for (const result of ['agua segura', 'Infinity', 'NaN', '0 mg/L', '0,1,2', '']) {
    const data = fixture();
    data.water.campaigns[0].measurements[0].result = result;
    assert.throws(() => api.validateData(data));
  }
  for (const result of ['<0.01', '≤ 0,01', '>=1.2e-3', '.02', 'ND', 'N.D.', 'no detectable', 'DNC', 'detectado no cuantificable']) {
    const data = fixture();
    const measurement = data.water.campaigns[0].measurements[0];
    measurement.result = result;
    measurement.ld = null;
    measurement.lq = null;
    api.validateData(data);
    assert.equal(measurement.result, result);
    assert.doesNotMatch(api.renderHTML(data), /(?:LD|LQ): 0/);
  }
});

test('source text is escaped and unsafe or credential-bearing links are rejected', () => {
  const { api } = harness();
  const data = fixture();
  data.impacts[0].items[0].claim = '<img src=x onerror=alert(1)>';
  data.documents[0].title = '<script>alert(1)</script>';
  data.water.campaigns[0].points[0].location = '<svg onload=alert(1)>';
  const html = api.renderHTML(data);
  assert.match(html, /&lt;img/);
  assert.match(html, /&lt;script/);
  assert.match(html, /&lt;svg/);
  assert.doesNotMatch(html, /<(?:img|script|svg)\b/);
  for (const url of ['javascript:alert(1)', 'http://example.org/test.pdf', 'https://user:secret@example.org/test.pdf']) {
    data.documents[0].url = url;
    assert.throws(() => api.renderHTML(data));
  }
});

test('sample dates do not shift to the previous day in Argentina', () => {
  const app = harness();
  const formatter = Intl.DateTimeFormat;
  app.context.Intl = { DateTimeFormat: function (locale, options) { return new formatter(locale, { timeZone: 'America/Argentina/Buenos_Aires', ...options }); } };
  const html = app.api.renderHTML(fixture());
  assert.match(html, />27 (?:de )?nov (?:de )?2025</);
  assert.match(html, /Publicación del informe: 01 (?:de )?dic (?:de )?2025/);
});

test('load errors can be retried and Pages and Workers use the correct static resource URL', async () => {
  for (const baseURI of ['https://muclacic3-star.github.io/Mineria-san-juan/', 'https://mineria-san-juan.muclacic3.workers.dev/']) {
    const app = harness(baseURI);
    const panel = element();
    app.queue.push(new Error('offline'));
    await app.api.mount(panel, 1);
    assert.match(panel.innerHTML, /No pudimos cargar/);
    assert.equal(panel.attributes['aria-busy'], undefined);
    app.queue.push(response(pendingFixture()));
    panel.querySelector('.ai-retry').events.click();
    for (let i = 0; i < 15; i++) await Promise.resolve();
    assert.match(panel.innerHTML, /Comparador pendiente/);
    assert.match(panel.innerHTML, /Afirmación ficticia incidents/);
    assert.equal(app.requestedURLs[0], new URL('data/veladero.json', baseURI).href);
    assert.equal(app.requestedURLs.length, 2);
  }
});

test('removed or reused project panels cannot receive a delayed Veladero response', async () => {
  const app = harness();
  let resolveJSON;
  app.queue.push({ ok: true, json: () => new Promise(resolve => { resolveJSON = resolve; }) });
  const removed = element();
  const reused = element();
  const loadingRemoved = app.api.mount(removed, 1);
  const loadingReused = app.api.mount(reused, 1);
  for (let i = 0; i < 5; i++) await Promise.resolve();
  removed.isConnected = false;
  removed.innerHTML = 'Panel retirado';
  await app.api.mount(reused, 2);
  resolveJSON(pendingFixture());
  await Promise.all([loadingRemoved, loadingReused]);
  assert.equal(removed.innerHTML, 'Panel retirado');
  assert.equal(reused.innerHTML, '');
  assert.equal(app.requestedURLs.length, 1);
});

test('changing a parameter updates only the comparison and preserves the active selector', async () => {
  const app = harness();
  const data = fixture();
  const campaign = data.water.campaigns[0];
  campaign.measurements.push(...campaign.measurements.map(m => ({ ...m, parameter: 'ph', unit: 'pH', method: 'Método pH', result: '7,2' })));
  app.queue.push(response(data));
  const panel = element();
  await app.api.mount(panel, 1);
  const originalHTML = panel.innerHTML;
  const select = panel.querySelector('[data-ai-parameter]');
  select.value = '1';
  select.events.change();
  assert.match(panel.querySelector('[data-ai-comparison]').innerHTML, /Arsénico total/);
  assert.equal(panel.innerHTML, originalHTML, 'the existing selector and impact content are not replaced');
  assert.equal(panel.querySelector('[data-ai-parameter]'), select);
});
