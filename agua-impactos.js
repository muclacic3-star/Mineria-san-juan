/* Piloto editorial de Veladero: independiente del seguimiento de noticias. */
(function (root) {
  'use strict';

  const PARAMETERS = {
    ph: { label: 'pH', units: ['pH', 'u.pH', 'unidades de pH', 'sin unidad', 'adimensional', '-'] },
    conductivity: { label: 'Conductividad', units: ['µS/cm', 'μS/cm', 'uS/cm', 'mS/cm'] },
    'arsenic-total': { label: 'Arsénico total', units: ['mg/L', 'µg/L', 'μg/L', 'ug/L'] },
    'cyanide-total': { label: 'Cianuro total', units: ['mg/L', 'µg/L', 'μg/L', 'ug/L'] }
  };
  const STATUSES = { documented: 'Hecho documentado', declared: 'Declaración de la fuente', undetermined: 'No determinado' };
  const DOCUMENT_STATUS = { final: 'Informe final', preliminary: 'Informe preliminar', reference: 'Documento de referencia' };
  const SOURCE_TYPES = { laboratory: 'Laboratorio', government: 'Organismo público', company: 'Empresa', academic: 'Institución académica' };
  const mounts = new WeakMap();
  let datasetPromise = null;

  function requireValue(condition, message) {
    if (!condition) throw new Error('Datos de Agua e impactos inválidos: ' + message);
  }
  function nonempty(value) { return typeof value === 'string' && value.trim().length > 0; }
  function analyticalResult(value) {
    if (!nonempty(value)) return false;
    const text = value.trim();
    return /^(?:[<>]=?|[≤≥])?\s*[+-]?(?:\d+(?:[.,]\d+)?|[.,]\d+)(?:[eE][+-]?\d+)?$/.test(text) || /^(?:n\.?\s?d\.?|no detectado|no detectable|dnc|detectado no cuantificable|detectable no cuantificable)$/i.test(text);
  }
  function calendarDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(value + 'T00:00:00Z');
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }
  function safeURL(value, page) {
    try {
      const url = new URL(value);
      if (url.protocol !== 'https:' || url.username || url.password) return '';
      if (page !== undefined) url.hash = 'page=' + page;
      return url.href;
    } catch { return ''; }
  }
  function escapeHTML(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  }
  function dateLabel(value) {
    if (value === null) return 'fecha de publicación no identificada';
    if (/^\d{4}$/.test(value)) return value;
    return new Intl.DateTimeFormat('es-AR', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(value + 'T00:00:00Z'));
  }
  function unique(values, label) {
    requireValue(values.every(nonempty) && new Set(values).size === values.length, label + ' repetidos o vacíos');
  }
  function groupKey(measurement) {
    return JSON.stringify([measurement.parameter, measurement.unit, measurement.method]);
  }
  function groupsFromValidated(data) {
    if (data.water.status !== 'ready') return [];
    return data.water.campaigns.flatMap(campaign => {
      const groups = new Map();
      for (const measurement of campaign.measurements) {
        const key = groupKey(measurement);
        if (!groups.has(key)) groups.set(key, { campaign, parameter: measurement.parameter, unit: measurement.unit, method: measurement.method, measurements: [] });
        groups.get(key).measurements.push(measurement);
      }
      return [...groups.values()].filter(group => {
        const count = new Set(group.measurements.map(m => m.pointId)).size;
        return count >= 2 && count <= 4;
      });
    }).sort((a, b) => Object.keys(PARAMETERS).indexOf(a.parameter) - Object.keys(PARAMETERS).indexOf(b.parameter));
  }

  function validateData(data) {
    requireValue(data && data.schemaVersion === 1 && data.projectId === 1, 'versión o proyecto');
    requireValue(calendarDate(data.reviewedAt), 'fecha de revisión');
    requireValue(Array.isArray(data.documents), 'documentos');
    unique(data.documents.map(d => d && d.id), 'Identificadores de documentos');
    const documents = new Map(data.documents.map(d => [d.id, d]));
    for (const doc of data.documents) {
      requireValue(nonempty(doc.title) && nonempty(doc.publisher), 'título y editor de ' + doc.id);
      requireValue(Object.hasOwn(SOURCE_TYPES, doc.sourceType) && Object.hasOwn(DOCUMENT_STATUS, doc.status), 'tipo de ' + doc.id);
      requireValue(doc.publishedAt === null || calendarDate(doc.publishedAt) || (typeof doc.publishedAt === 'string' && /^\d{4}$/.test(doc.publishedAt)), 'publicación de ' + doc.id);
      requireValue(Boolean(safeURL(doc.url)), 'enlace HTTPS de ' + doc.id);
      requireValue(doc.note === undefined || nonempty(doc.note), 'nota de ' + doc.id);
    }
    const water = data.water;
    requireValue(water && ['pending', 'ready'].includes(water.status) && nonempty(water.summary), 'disponibilidad del agua');
    requireValue(Array.isArray(water.missingDocuments) && water.missingDocuments.every(nonempty), 'documentación pendiente');
    requireValue(Array.isArray(water.campaigns) && water.campaigns.length <= 1, 'el piloto admite una sola campaña');
    requireValue(water.status !== 'pending' || water.campaigns.length === 0, 'una campaña pendiente no puede publicar mediciones');
    requireValue(water.status !== 'pending' || water.missingDocuments.length > 0, 'explicación de lo que falta');
    for (const campaign of water.campaigns) {
      requireValue(nonempty(campaign.id) && nonempty(campaign.label), 'identificación de campaña');
      requireValue(campaign.verification === 'verified' && campaign.waterType === 'surface', 'campaña verificada de agua superficial');
      requireValue(documents.get(campaign.reportId)?.status === 'final', 'informe final de la campaña');
      requireValue(calendarDate(documents.get(campaign.reportId).publishedAt) && documents.get(campaign.reportId).publishedAt <= data.reviewedAt, 'fecha completa de publicación anterior o igual a la revisión');
      requireValue(nonempty(campaign.samplingResponsible) && nonempty(campaign.laboratory), 'responsable del muestreo y laboratorio');
      requireValue(nonempty(documents.get(campaign.reportId).note), 'nota sobre quién encargó el informe o la falta de esa identificación');
      requireValue(Array.isArray(campaign.points) && campaign.points.length >= 2 && campaign.points.length <= 4, 'entre dos y cuatro puntos');
      unique(campaign.points.map(p => p && p.id), 'Identificadores de puntos');
      for (const point of campaign.points) {
        requireValue(nonempty(point.name) && nonempty(point.location), 'nombre y ubicación de ' + point.id);
        requireValue(point.evidence && documents.has(point.evidence.documentId), 'fuente de la ubicación de ' + point.id);
        requireValue(point.evidence.page === undefined || (Number.isInteger(point.evidence.page) && point.evidence.page > 0), 'página de la ubicación de ' + point.id);
        requireValue(point.evidence.section === undefined || nonempty(point.evidence.section), 'sección de la ubicación de ' + point.id);
        requireValue(point.evidence.page !== undefined || point.evidence.section !== undefined, 'página o sección que identifica ' + point.id);
        if (point.coordinates !== undefined) requireValue(point.coordinates && Number.isFinite(point.coordinates.lat) && Math.abs(point.coordinates.lat) <= 90 && Number.isFinite(point.coordinates.lon) && Math.abs(point.coordinates.lon) <= 180, 'coordenadas de ' + point.id);
      }
      requireValue(Array.isArray(campaign.measurements) && campaign.measurements.length > 0, 'mediciones de campaña');
      const measurementKeys = new Set();
      for (const measurement of campaign.measurements) {
        requireValue(measurement && campaign.points.some(p => p.id === measurement.pointId), 'punto de la medición');
        requireValue(Object.hasOwn(PARAMETERS, measurement.parameter), 'parámetro admitido');
        requireValue(PARAMETERS[measurement.parameter].units.includes(measurement.unit) && nonempty(measurement.method), 'unidad y método de la medición');
        requireValue(calendarDate(measurement.sampledAt) && analyticalResult(measurement.result), 'fecha y resultado analítico textual');
        requireValue(measurement.sampledAt <= documents.get(campaign.reportId).publishedAt && measurement.sampledAt <= data.reviewedAt, 'muestreo posterior a la publicación o revisión');
        requireValue(measurement.sourceId === campaign.reportId && documents.get(measurement.sourceId)?.status === 'final', 'medición respaldada por el informe final de la campaña');
        requireValue(Number.isInteger(measurement.page) && measurement.page > 0, 'página de la medición');
        for (const limit of ['ld', 'lq']) requireValue(measurement[limit] === undefined || measurement[limit] === null || (Number.isFinite(measurement[limit]) && measurement[limit] >= 0), 'límite analítico ' + limit);
        if (Number.isFinite(measurement.ld) && Number.isFinite(measurement.lq)) requireValue(measurement.ld <= measurement.lq, 'el límite de detección supera el de cuantificación');
        const key = JSON.stringify([measurement.pointId, groupKey(measurement)]);
        requireValue(!measurementKeys.has(key), 'medición duplicada dentro de un grupo');
        measurementKeys.add(key);
      }
    }
    requireValue(water.status !== 'ready' || groupsFromValidated(data).length > 0, 'no hay al menos dos puntos comparables');
    requireValue(Array.isArray(data.impacts) && data.impacts.length === 4, 'cuatro apartados de impactos');
    unique(data.impacts.map(section => section && section.id), 'Apartados de impactos');
    const allItems = [];
    for (const section of data.impacts) {
      requireValue(['water', 'incidents', 'economy', 'unknowns'].includes(section.id) && nonempty(section.title) && Array.isArray(section.items) && section.items.length > 0, 'apartado de impactos');
      for (const item of section.items) {
        requireValue(item && nonempty(item.id) && nonempty(item.claim) && nonempty(item.period) && Object.hasOwn(STATUSES, item.status), 'afirmación de impactos');
        allItems.push(item.id);
        requireValue(Array.isArray(item.evidence) && (item.status === 'undetermined' || item.evidence.length > 0), 'evidencia de ' + item.id);
        for (const evidence of item.evidence) {
          requireValue(evidence && documents.has(evidence.documentId), 'documento de evidencia de ' + item.id);
          requireValue(evidence.page === undefined || (Number.isInteger(evidence.page) && evidence.page > 0), 'página de evidencia');
          requireValue(evidence.section === undefined || nonempty(evidence.section), 'sección de evidencia');
        }
      }
    }
    unique(allItems, 'Identificadores de afirmaciones');
    return data;
  }

  function comparableGroups(data) { return groupsFromValidated(validateData(data)); }
  function linkHTML(doc, page, label) {
    return '<a href="' + escapeHTML(safeURL(doc.url, page)) + '" target="_blank" rel="noopener noreferrer">' + escapeHTML(label || doc.title) + (page === undefined ? '' : ' · pág. ' + page) + '</a>';
  }
  function sourceMeta(doc) {
    return escapeHTML(doc.publisher) + ' · ' + SOURCE_TYPES[doc.sourceType] + ' · Publicación: ' + escapeHTML(dateLabel(doc.publishedAt));
  }
  function comparisonHTML(data, group) {
    const report = data.documents.find(d => d.id === group.campaign.reportId);
    return '<p class="ai-meta">' + escapeHTML(group.campaign.label) + ' · Agua superficial. Método: ' + escapeHTML(group.method) + '. Publicación del informe: ' + escapeHTML(dateLabel(report.publishedAt)) + '.</p><p class="ai-meta">Muestreo: ' + escapeHTML(group.campaign.samplingResponsible) + ' · Laboratorio: ' + escapeHTML(group.campaign.laboratory) + '.</p><p class="ai-meta">' + escapeHTML(report.note) + '</p>' +
      '<div class="ai-table-wrap" tabindex="0" role="region" aria-label="Tabla de mediciones; desplazamiento horizontal si es necesario"><table class="ai-table"><caption>' + escapeHTML(PARAMETERS[group.parameter].label) + ' · ' + escapeHTML(group.unit) + '</caption><thead><tr><th scope="col">Punto y lugar</th><th scope="col">Toma de muestra</th><th scope="col">Resultado</th><th scope="col">Informe</th></tr></thead><tbody>' + group.measurements.map(measurement => {
        const point = group.campaign.points.find(p => p.id === measurement.pointId);
        const limits = ['ld', 'lq'].filter(key => measurement[key] !== undefined && measurement[key] !== null).map(key => (key === 'ld' ? 'LD' : 'LQ') + ': ' + measurement[key] + ' ' + group.unit).join(' · ');
        const locationDocument = data.documents.find(doc => doc.id === point.evidence.documentId);
        const locationSource = '<span class="ai-meta">' + linkHTML(locationDocument, point.evidence.page, 'Fuente de ubicación') + (point.evidence.section ? ' · ' + escapeHTML(point.evidence.section) : '') + '</span>';
        return '<tr><th scope="row">' + escapeHTML(point.name) + '<span class="ai-meta">' + escapeHTML(point.location) + ' · Código: ' + escapeHTML(point.id) + '</span>' + locationSource + '</th><td>' + escapeHTML(dateLabel(measurement.sampledAt)) + '</td><td><strong>' + escapeHTML(measurement.result) + '</strong> ' + escapeHTML(measurement.unit) + (limits ? '<span class="ai-meta">' + escapeHTML(limits) + '</span>' : '') + '</td><td>' + linkHTML(report, measurement.page, 'Ver resultado') + '</td></tr>';
      }).join('') + '</tbody></table></div>' +
      '<p class="ai-limits">«&lt;» indica un resultado menor al límite informado; «no detectado» no significa cero. LD: límite de detección; LQ: límite de cuantificación.</p>';
  }
  function renderValidatedHTML(data, selection) {
    const groups = groupsFromValidated(data);
    const selectedIndex = Number.isInteger(selection) && groups[selection] ? selection : 0;
    const documents = new Map(data.documents.map(doc => [doc.id, doc]));
    const waterHTML = data.water.status === 'pending'
      ? '<div class="ai-notice"><h4>Comparador pendiente de documentación</h4><p>' + escapeHTML(data.water.summary) + '</p><details><summary>Qué falta para comparar</summary><ul class="ai-checklist">' + data.water.missingDocuments.map(item => '<li>' + escapeHTML(item) + '</li>').join('') + '</ul></details></div>'
      : '<h4>Comparar mediciones de agua</h4><p>' + escapeHTML(data.water.summary) + '</p><div class="ai-field"><label for="ai-parameter-veladero">Parámetro y grupo comparable</label><select id="ai-parameter-veladero" data-ai-parameter>' + groups.map((group, index) => '<option value="' + index + '"' + (index === selectedIndex ? ' selected' : '') + '>' + escapeHTML(PARAMETERS[group.parameter].label + ' · ' + group.unit + (groups.filter(g => g.parameter === group.parameter).length > 1 ? ' · ' + group.method : '')) + '</option>').join('') + '</select></div><div data-ai-comparison aria-live="polite">' + comparisonHTML(data, groups[selectedIndex]) + '</div>';
    return '<section class="ai-panel" aria-labelledby="ai-heading-veladero"><header class="ai-header"><p class="ai-eyebrow">Piloto · Veladero</p><h3 id="ai-heading-veladero">Agua e impactos</h3><p class="ai-meta">Revisión documental: ' + escapeHTML(dateLabel(data.reviewedAt)) + '. Las fechas de los hechos y las muestras se indican por separado.</p></header>' +
      '<section class="ai-water" aria-label="Mediciones de agua">' + waterHTML + (data.water.status === 'ready' ? '<p class="ai-limits">Las mediciones describen esa campaña y esos puntos. No certifican potabilidad ni determinan, por sí solas, el origen de una sustancia o un efecto de la mina.</p>' : '') + '</section>' +
      '<div class="ai-impacts">' + data.impacts.map(section => '<section class="ai-impact"><h4>' + escapeHTML(section.title) + '</h4>' + section.items.map(item => '<article class="ai-claim"><span class="ai-badge ai-badge-' + item.status + '">' + STATUSES[item.status] + '</span><p>' + escapeHTML(item.claim) + '</p><p class="ai-meta">Período: ' + escapeHTML(item.period) + '</p>' + (item.evidence.length ? '<ul class="ai-evidence">' + item.evidence.map(evidence => {
        const doc = documents.get(evidence.documentId);
        return '<li>' + linkHTML(doc, evidence.page) + (evidence.section ? '<span class="ai-meta">Sección: ' + escapeHTML(evidence.section) + '</span>' : '') + '<span class="ai-meta">' + sourceMeta(doc) + '</span></li>';
      }).join('') + '</ul>' : '<p class="ai-meta">No se incorporó evidencia suficiente para determinarlo.</p>') + '</article>').join('') + '</section>').join('') + '</div>' +
      '<details class="ai-documents"><summary>Documentos revisados (' + data.documents.length + ')</summary>' + data.documents.map(doc => '<article class="ai-document">' + linkHTML(doc) + '<p class="ai-meta">' + sourceMeta(doc) + ' · ' + DOCUMENT_STATUS[doc.status] + '</p>' + (doc.note ? '<p>' + escapeHTML(doc.note) + '</p>' : '') + '</article>').join('') + '</details></section>';
  }
  function renderHTML(data, selection) { return renderValidatedHTML(validateData(data), selection); }

  function loadDataset() {
    if (!datasetPromise) {
      datasetPromise = root.fetch(new URL('data/veladero.json', root.document.baseURI)).then(response => {
        if (!response.ok) throw new Error('No se pudo cargar el documento');
        return response.json();
      }).then(validateData).catch(error => { datasetPromise = null; throw error; });
    }
    return datasetPromise;
  }
  async function mount(element, projectId) {
    if (!element) return;
    const token = {};
    mounts.set(element, token);
    const current = () => mounts.get(element) === token && element.isConnected !== false;
    if (projectId !== 1) { element.innerHTML = ''; element.removeAttribute('aria-busy'); return; }
    element.setAttribute('aria-busy', 'true');
    element.innerHTML = '<p class="ai-meta" role="status">Cargando agua e impactos de Veladero…</p>';
    try {
      const data = await loadDataset();
      if (!current()) return;
      element.innerHTML = renderValidatedHTML(data, 0);
      const select = element.querySelector('[data-ai-parameter]');
      if (select) select.addEventListener('change', () => {
        if (!current()) return;
        const group = groupsFromValidated(data)[Number(select.value)];
        if (group) element.querySelector('[data-ai-comparison]').innerHTML = comparisonHTML(data, group);
      });
    } catch {
      if (!current()) return;
      element.innerHTML = '<section class="ai-error" role="alert"><h3>Agua e impactos</h3><p>No pudimos cargar la ficha documental. Podés volver a intentarlo; las noticias y el resto de la ficha siguen disponibles.</p><button type="button" class="ai-retry">Volver a intentar</button></section>';
      element.querySelector('.ai-retry').addEventListener('click', () => { void mount(element, projectId); });
    } finally {
      if (current()) element.removeAttribute('aria-busy');
    }
  }
  root.AguaImpactos = Object.freeze({ mount, validateData, comparableGroups, renderHTML });
})(globalThis);
