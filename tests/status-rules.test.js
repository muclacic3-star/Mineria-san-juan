import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeClaim, baselineProjects, evaluateProjects, BASELINE_REFERENCE_AT } from '../src/status-rules.js';

// Fictional fixtures; these names and claims never enter published source data.
const now = '2026-09-07T12:00:00.000Z';
const mine = { id: 1, nombre: 'Sierra Clara', estado: 'produccion' };
const otherMine = { id: 2, nombre: 'Valle Claro', estado: 'exploracion' };
const official = { id: 'authority', trust: 'official', statusAuthorityProjectIds: [1] };
const pressA = { id: 'press-a', trust: 'press', publisherGroup: 'editorial-a' };
const pressB = { id: 'press-b', trust: 'press', publisherGroup: 'editorial-b' };
const title = 'La mina Sierra Clara suspendió sus operaciones el 5 de septiembre de 2026';
function article(overrides = {}) {
  return { id: 'fiction-1', title, summary: '', projectIds: [1],
    publishedAt: '2026-09-06T09:00:00.000Z', sourceId: official.id,
    publisher: 'Autoridad ficticia', url: 'https://authority-fixture.org/novedad', ...overrides };
}
function evaluate(news, sources = [official], previous = baselineProjects([mine])) {
  return evaluateProjects(previous, [mine], news, sources, now);
}

test('baseline identifies inherited states without inventing an effective date', () => {
  const baseline = baselineProjects([mine])[0];
  assert.equal(baseline.verification, 'baseline');
  assert.equal(baseline.effectiveAt, null);
  assert.equal(baseline.baselineReferenceAt, BASELINE_REFERENCE_AT);
  assert.deepEqual(baseline.history, []);
});

test('editorial baseline corrections retain explicit source without inventing a transition date', () => {
  const evidence = [{ title: 'Reporte ficticio', url: 'https://authority-fixture.org/report', publishedAt: '2026-07-31T10:00:00.000Z', publisher: 'Autoridad ficticia' }];
  const baseline = baselineProjects([{ ...mine, baselineReason: 'Corrección editorial con respaldo documental.', baselineEvidence: evidence }])[0];
  assert.equal(baseline.reason, 'Corrección editorial con respaldo documental.');
  assert.deepEqual(baseline.evidence, evidence);
  assert.notEqual(baseline.evidence, evidence);
  assert.equal(baseline.verification, 'baseline');
  assert.equal(baseline.effectiveAt, null);
});

test('cessation wording is surfaced for review rather than silently ignored or guessed as suspension', async () => {
  const { projects: [result], events } = await evaluate([article({ title: 'La mina Sierra Clara dejó de estar en producción el 5 de septiembre de 2026' })]);
  assert.equal(result.estado, 'produccion');
  assert.equal(result.verification, 'review');
  assert.equal(events.length, 0);
});

test('mountain biographies, credit closing and exploration-campaign completion are ordinary news', async () => {
  for (const candidate of [
    'Pionero de Sierra Clara: la historia del perforista que tiene un cerro propio en la cordillera',
    'La operadora de Sierra Clara cerró un crédito para impulsar el desarrollo del proyecto',
    'La operadora cierra una nueva etapa de exploración en Sierra Clara y amplía su área de trabajo',
    'La mina Sierra Clara inició una campaña de perforación exploratoria',
    'La mina Sierra Clara comenzó una nueva jornada educativa',
  ]) {
    const item = article({ title: candidate });
    assert.equal(analyzeClaim(item, mine, now).kind, 'ignore', candidate);
    const { projects: [result], events } = await evaluate([item]);
    assert.equal(result.verification, 'baseline', candidate);
    assert.equal(result.estado, 'produccion', candidate);
    assert.equal(events.length, 0, candidate);
  }
});

test('operational closure remains review-worthy and explicit stage entry remains detectable', async () => {
  for (const candidate of [
    'La operadora cerró la mina Sierra Clara el 5 de septiembre de 2026',
    'Cierre definitivo de la mina Sierra Clara',
    'La mina Sierra Clara comenzó operaciones el 5 de septiembre de 2026',
  ]) {
    assert.equal(analyzeClaim(article({ title: candidate }), mine, now).kind, 'review', candidate);
  }
  const { projects: [result] } = await evaluate([article({ title: 'La mina Sierra Clara pasó a la etapa de exploración el 5 de septiembre de 2026' })]);
  assert.equal(result.estado, 'exploracion');
  assert.equal(result.verification, 'confirmed');
});

test('an unresolved real review persists when its original news is absent or too old', async () => {
  const first = await evaluate([article({ title: 'La mina Sierra Clara podría suspender sus operaciones el 5 de septiembre de 2026' })]);
  const missing = await evaluate([], [official], first.projects);
  assert.deepEqual(missing.projects, first.projects);
  const expired = await evaluateProjects(first.projects, [mine], [article()], [official], '2026-10-20T12:00:00.000Z');
  assert.deepEqual(expired.projects, first.projects);
});

test('competent official explicit dated mine-wide suspension changes state with evidence', async () => {
  const { projects: [result], events } = await evaluate([article()]);
  assert.equal(result.estado, 'suspendido');
  assert.equal(result.verification, 'confirmed');
  assert.equal(result.effectiveAt, '2026-09-05T00:00:00.000Z');
  assert.equal(result.evidence[0].url, article().url);
  assert.equal(events.length, 1);
  assert.equal(events[0].from, 'produccion');
  assert.equal(events[0].to, 'suspendido');
});

test('official source outside its jurisdiction cannot confirm this mine', async () => {
  const { projects: [result], events } = await evaluate([article()], [{ ...official, statusAuthorityProjectIds: [2] }]);
  assert.equal(result.estado, 'produccion');
  assert.equal(result.verification, 'review');
  assert.equal(events.length, 0);
});

test('missing official authority list and unknown sources cannot confirm', async () => {
  for (const sources of [[{ id: official.id, trust: 'official' }], []]) {
    const { projects: [result] } = await evaluate([article()], sources);
    assert.equal(result.estado, 'produccion');
    assert.equal(result.verification, 'review');
  }
});

test('old publication and future publication are ignored', () => {
  for (const publishedAt of ['2026-07-01T09:00:00.000Z', '2026-10-01T09:00:00.000Z', 'invalid']) {
    assert.equal(analyzeClaim(article({ publishedAt }), mine, now).kind, 'ignore');
  }
});

test('recent retrospective with old dated event does not create false review or state changes', async () => {
  for (const oldDate of ['5 de septiembre de 2025', '2026-07-01', '15 de agosto de 2026']) {
    const item = article({ title: `La mina Sierra Clara suspendió sus operaciones el ${oldDate}`,
      summary: 'El informe recordó aquel episodio histórico.' });
    assert.equal(analyzeClaim(item, mine, now).kind, 'ignore');
    const { projects: [result], events } = await evaluate([item]);
    assert.equal(result.verification, 'baseline');
    assert.equal(result.estado, 'produccion');
    assert.deepEqual(events, []);
  }
});

test('invalid, missing and future effective dates cannot become confirmed facts', async () => {
  for (const candidate of [
    'La mina Sierra Clara suspendió sus operaciones el 31 de septiembre de 2026',
    'La mina Sierra Clara suspendió sus operaciones el 8 de septiembre de 2026',
    'La mina Sierra Clara suspendió sus operaciones',
    'La mina Sierra Clara suspendió sus operaciones el 7 de septiembre de 2026',
  ]) {
    const { projects: [result], events } = await evaluate([article({ title: candidate })]);
    assert.equal(result.estado, 'produccion', candidate);
    assert.equal(events.length, 0, candidate);
  }
});

test('negation, rumor, conditional, maintenance, expansion and partial activity require review', async () => {
  for (const candidate of [
    'La mina Sierra Clara no suspendió sus operaciones el 5 de septiembre de 2026',
    'La mina Sierra Clara podría suspender sus operaciones el 5 de septiembre de 2026',
    'Un rumor dice que la mina Sierra Clara suspendió sus operaciones el 5 de septiembre de 2026',
    'La mina Sierra Clara suspendió sus operaciones por mantenimiento el 5 de septiembre de 2026',
    'La mina Sierra Clara suspendió su ampliación el 5 de septiembre de 2026',
    'La mina Sierra Clara paralizó una parte de sus operaciones el 5 de septiembre de 2026',
  ]) {
    const { projects: [result], events } = await evaluate([article({ title: candidate })]);
    assert.equal(result.estado, 'produccion', candidate);
    assert.equal(result.verification, 'review', candidate);
    assert.equal(events.length, 0, candidate);
  }
});

test('summary qualification prevents treating an unqualified headline as a fact', async () => {
  const { projects: [result] } = await evaluate([article({ summary: 'La suspensión podría ocurrir si fracasa el diálogo.' })]);
  assert.equal(result.estado, 'produccion');
  assert.equal(result.verification, 'review');
});

test('another mine is not updated by a nearby mention without a status assertion', async () => {
  const item = article({ projectIds: [1, 2], summary: 'Valle Claro recibió visitantes de la escuela.' });
  const { projects } = await evaluateProjects(baselineProjects([mine, otherMine]), [mine, otherMine], [item], [official], now);
  assert.equal(projects[0].estado, 'suspendido');
  assert.equal(projects[1].estado, 'exploracion');
  assert.equal(projects[1].verification, 'baseline');
});

test('resuming unspecified or exploration operations never asserts production', async () => {
  const exploration = { ...mine, estado: 'exploracion' };
  for (const title of [
    'La mina Sierra Clara reanudó sus operaciones el 5 de septiembre de 2026',
    'La mina Sierra Clara reinició operaciones el 5 de septiembre de 2026',
    'La mina Sierra Clara reanudó sus operaciones de exploración el 5 de septiembre de 2026',
  ]) {
    const { projects: [result], events } = await evaluateProjects(
      baselineProjects([exploration]), [exploration], [article({ title })], [official], now);
    assert.equal(result.estado, 'exploracion', title);
    assert.equal(result.verification, 'review', title);
    assert.deepEqual(events, [], title);
  }
});

test('two differently worded reports with distinct registered editorial groups corroborate', async () => {
  const a = article({ sourceId: pressA.id, url: 'https://paper-a-fixture.org/1',
    summary: 'Nuestro corresponsal entrevistó vecinos durante la jornada. Los trabajadores explicaron detalles del proceso ante representantes municipales.' });
  const b = article({ sourceId: pressB.id, url: 'https://paper-b-fixture.org/2',
    title: 'El 5 de septiembre de 2026, la mina Sierra Clara paralizó todas sus operaciones',
    summary: 'El equipo periodístico constató acceso cerrado mediante una visita independiente. Las autoridades locales mostraron documentos del expediente administrativo.' });
  const { projects: [result], events } = await evaluate([a, b], [pressA, pressB]);
  assert.equal(result.estado, 'suspendido');
  assert.equal(result.verification, 'confirmed');
  assert.equal(result.evidence.length, 2);
  assert.equal(events.length, 1);
});

test('same editorial group, same host or copied claim do not count as two independent reports', async () => {
  const a = article({ sourceId: pressA.id, url: 'https://paper-a-fixture.org/1', summary: 'Texto del corresponsal local.' });
  for (const [b, sources] of [
    [article({ sourceId: pressB.id, url: 'https://paper-b-fixture.org/2', title: 'El 5 de septiembre de 2026, la mina Sierra Clara paralizó todas sus operaciones' }), [pressA, { ...pressB, publisherGroup: pressA.publisherGroup }]],
    [article({ sourceId: pressB.id, url: 'https://paper-a-fixture.org/2', title: 'El 5 de septiembre de 2026, la mina Sierra Clara paralizó todas sus operaciones' }), [pressA, pressB]],
    [article({ sourceId: pressB.id, url: 'https://paper-b-fixture.org/2', summary: 'Párrafos agregados del servicio meteorológico y anuncios culturales para cambiar las palabras sin aportar corroboración del hecho.' }), [pressA, pressB]],
  ]) {
    const { projects: [result], events } = await evaluate([a, b], sources);
    assert.equal(result.estado, 'produccion');
    assert.equal(result.verification, 'review');
    assert.equal(events.length, 0);
  }
});

test('contradictory states for the same date keep previous state under review', async () => {
  const resume = article({ title: 'La mina Sierra Clara reanudó sus operaciones de producción el 5 de septiembre de 2026', url: 'https://authority-fixture.org/resume' });
  const { projects: [result], events } = await evaluate([article(), resume]);
  assert.equal(result.estado, 'produccion');
  assert.equal(result.verification, 'review');
  assert.equal(events.length, 0);
});

test('repeated snapshot is idempotent, then later resumption updates once', async () => {
  const first = await evaluate([article()]);
  const repeat = await evaluate([article()], [official], first.projects);
  assert.deepEqual(repeat.projects, first.projects);
  assert.deepEqual(repeat.events, []);
  const resume = article({ title: 'La mina Sierra Clara reanudó sus operaciones de producción el 6 de septiembre de 2026',
    publishedAt: '2026-09-07T09:00:00.000Z', url: 'https://authority-fixture.org/resume' });
  const last = await evaluate([article(), resume], [official], repeat.projects);
  assert.equal(last.projects[0].estado, 'produccion');
  assert.equal(last.events.length, 1);
  assert.equal(last.projects[0].history.length, 2);
});

test('confirming the same state does not fabricate a state-change event', async () => {
  const item = article({ title: 'La mina Sierra Clara inició la producción comercial el 5 de septiembre de 2026' });
  const { projects: [result], events } = await evaluate([item]);
  assert.equal(result.verification, 'confirmed');
  assert.equal(result.estado, 'produccion');
  assert.deepEqual(events, []);
});
