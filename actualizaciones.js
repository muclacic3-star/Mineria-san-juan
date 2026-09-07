/* Noticias y estados comparten una instantánea; nunca se actualiza solo el mapa. */
function escaparHTML(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[c]);
}

function enlaceSeguro(value) {
  try { const url = new URL(value); return url.protocol === 'https:' ? url.href : ''; }
  catch { return ''; }
}

function fechaVisible(value, time, calendarDate) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return 'sin fecha confirmada';
  return new Intl.DateTimeFormat('es-AR', {
    day: '2-digit', month: 'short', year: 'numeric',
    ...(calendarDate || /^\d{4}-\d{2}-\d{2}$/.test(value) ? { timeZone: 'UTC' } : {}),
    ...(time ? { hour: '2-digit', minute: '2-digit' } : {})
  }).format(date);
}

function verificacionHTML(project, compact) {
  const data = project.actualizacion || { verification: 'baseline', reason: project.baselineReason, evidence: project.baselineEvidence };
  const review = data.verification === 'review';
  const label = review ? 'Información en revisión' : data.verification === 'confirmed'
    ? 'Estado respaldado por fuentes' : 'Referencia de julio de 2026';
  let html = '<p class="text-xs mt-2 font-medium" style="color:' + (review ? '#92400e' : '#526171') + '">' + label + '</p>';
  if (compact) return html;
  if (review) html += '<p class="text-sm mt-2">Se muestra el último estado registrado mientras se contrasta la novedad.</p>';
  if (data.verification === 'baseline') html += '<p class="text-sm mt-2">Estado del catálogo de referencia, con las correcciones editoriales indicadas. Aún no tiene una confirmación nueva en el seguimiento automático.</p>';
  if (data.reason) html += '<p class="text-sm mt-2">' + escaparHTML(data.reason) + '</p>';
  if (data.effectiveAt) html += '<p class="text-xs mt-2">Fecha del hecho: ' + fechaVisible(data.effectiveAt, false, true) + '</p>';
  const evidence = Array.isArray(data.evidence) ? data.evidence : [];
  if (evidence.length) html += '<ul class="text-sm mt-3 space-y-2">' + evidence.map(item => {
    const url = enlaceSeguro(item.url);
    return '<li>' + (url ? '<a class="underline" target="_blank" rel="noopener noreferrer" href="' + escaparHTML(url) + '">' + escaparHTML(item.title) + '</a>' : escaparHTML(item.title)) +
      '<p class="text-xs mt-1">' + escaparHTML(item.publisher) + ' · ' + fechaVisible(item.publishedAt) + '</p></li>';
  }).join('') + '</ul>';
  if (Array.isArray(data.history) && data.history.length) html += '<details class="mt-4 text-sm"><summary class="cursor-pointer font-semibold">Historial de cambios</summary><ul class="mt-2 space-y-2">' + data.history.slice(0, 5).map(item =>
    '<li>' + escaparHTML(ESTADOS[item.estado || item.to]?.nombre || item.estado || item.to || 'Cambio registrado') + ' · ' + fechaVisible(item.effectiveAt || item.at || item.changedAt, false, Boolean(item.effectiveAt)) + '</li>'
  ).join('') + '</ul></details>';
  return html;
}

function popupProyectoHTML(project, mini) {
  return '<b>' + escaparHTML(project.nombre) + '</b><div style="margin:6px 0">' + badgeHTML(project.estado) + '</div>' +
    verificacionHTML(project, true) + (mini ? '' : '<button class="btn-popup" onclick="abrirDetalle(' + project.id + ')">Ver detalle</button>');
}

(function () {
  const STORAGE_KEY = 'msj-snapshot-v1.3';
  const POLL_MS = 5 * 60 * 1000;
  let snapshot = null;
  let fetching = false;
  let nextCheck = 0;
  let cached = false;

  function validSnapshot(value) {
    if (!value || value.version !== '1.3' || !Array.isArray(value.projects) || !Array.isArray(value.news)) return false;
    if (typeof value.generatedAt !== 'string' || !Number.isFinite(Date.parse(value.generatedAt)) || !Array.isArray(value.sources)) return false;
    if (value.projects.length !== PROYECTOS.length || new Set(value.projects.map(p => p.id)).size !== PROYECTOS.length) return false;
    return value.projects.every(p => Number.isInteger(p.id) && PROYECTOS.some(x => x.id === p.id) && ESTADOS[p.estado] && ['baseline', 'confirmed', 'review'].includes(p.verification));
  }

  function applySnapshot(value) {
    if (!validSnapshot(value)) throw new Error('Respuesta de actualización inválida');
    // Una respuesta demorada o una pestaña vieja no puede revertir una versión más reciente.
    if (snapshot?.generatedAt && new Date(value.generatedAt) < new Date(snapshot.generatedAt)) return;
    snapshot = value;
    for (const state of value.projects) {
      const project = PROYECTOS.find(p => p.id === state.id);
      project.estado = state.estado;
      project.actualizacion = state;
    }
    renderLista();
    document.getElementById('lista-destacados').innerHTML = [1, 5, 6, 3].map(id => tarjetaDestacadaHTML(PROYECTOS.find(p => p.id === id))).join('');
    for (const key of Object.keys(ESTADOS)) {
      const stat = document.getElementById('stat-' + key);
      if (stat) stat.textContent = PROYECTOS.filter(p => p.estado === key).length;
    }
    for (const project of PROYECTOS) {
      for (const marker of [marcadores[project.id], marcadoresMini[project.id]]) {
        if (!marker) continue;
        marker.setStyle({ fillColor: ESTADOS[project.estado].color, color: project.actualizacion.verification === 'review' ? '#92400e' : '#ffffff', dashArray: project.actualizacion.verification === 'review' ? '3 2' : null });
        marker.setPopupContent(popupProyectoHTML(project, marker === marcadoresMini[project.id]));
      }
    }
    if (proyectoAbiertoId != null && document.getElementById('hoja-detalle').classList.contains('abierta')) {
      const project = PROYECTOS.find(p => p.id === proyectoAbiertoId);
      const panel = document.getElementById('estado-detalle-actual');
      if (panel && project) panel.innerHTML = badgeHTML(project.estado) + verificacionHTML(project, false);
    }
    renderNews();
    renderSources();
  }

  function renderNews() {
    const container = document.getElementById('noticias-automaticas');
    container.replaceChildren();
    const news = snapshot.news.filter(n => enlaceSeguro(n.url) && n.title).slice(0, 60);
    if (!news.length) {
      const empty = document.createElement('p');
      empty.className = 'text-sm p-4 tarjeta';
      empty.textContent = 'Todavía no hay novedades recopiladas para estos proyectos. El archivo editorial sigue disponible debajo.';
      container.append(empty);
      return;
    }
    for (const item of news) {
      const article = document.createElement('article');
      article.className = 'tarjeta p-4';
      const meta = document.createElement('p');
      meta.className = 'text-xs mb-2';
      meta.style.color = '#526171';
      meta.textContent = String(item.publisher || 'Fuente') + ' · ' + fechaVisible(item.publishedAt);
      const heading = document.createElement('h3');
      heading.className = 'font-semibold text-base leading-snug';
      const link = document.createElement('a');
      link.href = enlaceSeguro(item.url); link.target = '_blank'; link.rel = 'noopener noreferrer';
      link.className = 'underline'; link.textContent = item.title;
      heading.append(link); article.append(meta, heading);
      const related = document.createElement('div');
      related.className = 'flex flex-wrap gap-2 mt-3';
      for (const id of Array.isArray(item.projectIds) ? item.projectIds : []) {
        const project = PROYECTOS.find(p => p.id === id);
        if (!project) continue;
        const button = document.createElement('button');
        button.type = 'button'; button.className = 'chip'; button.textContent = project.nombre;
        button.addEventListener('click', () => abrirDetalle(id)); related.append(button);
      }
      article.append(related); container.append(article);
    }
  }

  function renderSources() {
    document.getElementById('fuentes-automaticas').innerHTML = (snapshot.sources || []).map(source =>
      '<p><strong>' + escaparHTML(source.name) + '</strong><br>' + (source.lastSuccessAt ? 'Última consulta correcta: ' + fechaVisible(source.lastSuccessAt, true) : 'Sin consulta correcta registrada') +
      (source.error ? '<br><span style="color:#92400e">No se pudo completar la última consulta. Se conserva la información anterior.</span>' : '') + '</p>'
    ).join('');
  }

  function showState(message) {
    document.getElementById('aviso-actualizacion').textContent = message;
    document.getElementById('estado-noticias').textContent = message;
    document.getElementById('fecha-actualizacion').textContent = snapshot?.lastSuccessAt
      ? 'Última consulta de fuentes: ' + fechaVisible(snapshot.lastSuccessAt, true)
      : 'Referencia inicial: julio de 2026';
  }

  async function refresh(manual) {
    if (fetching || (!manual && (document.hidden || Date.now() < nextCheck))) return;
    if (!navigator.onLine) { showState('Sin conexión. Mostramos la última información guardada en este dispositivo.'); return; }
    fetching = true;
    const button = document.getElementById('btn-actualizar-noticias');
    button.disabled = true;
    button.textContent = 'Consultando…';
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 12000);
      let value;
      try {
        const response = await fetch(new URL('api/snapshot', document.baseURI), { cache: 'no-store', signal: controller.signal, headers: { Accept: 'application/json' } });
        if (!response.ok) throw new Error('No disponible');
        value = await response.json();
      } finally { clearTimeout(timer); }
      applySnapshot(value);
      cached = false;
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot)); } catch { /* Modo privado o sin espacio. */ }
      const failures = snapshot.service?.mode === 'degraded' || (snapshot.sources || []).some(s => s.error);
      const old = !snapshot.lastSuccessAt || Date.now() - new Date(snapshot.lastSuccessAt) > 24 * 60 * 60 * 1000;
      showState(failures ? 'Algunas fuentes no pudieron consultarse. Se conserva su última información disponible.' : old
        ? 'El seguimiento aún no tiene una consulta reciente. Las referencias de las fichas muestran su fecha.'
        : 'Noticias consultadas periódicamente. Cada ficha indica el respaldo y la fecha de su estado.');
    } catch {
      showState(snapshot ? 'No pudimos contactar el seguimiento. Mostramos la última copia disponible, con su fecha.'
        : 'El seguimiento no está disponible. Mostramos los datos de referencia de julio de 2026.');
    } finally {
      fetching = false; nextCheck = Date.now() + POLL_MS;
      button.disabled = false; button.textContent = 'Buscar actualizaciones';
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (validSnapshot(saved)) { applySnapshot(saved); cached = true; }
    } catch { /* Un archivo local incompleto no bloquea el catálogo. */ }
    if (cached) showState('Mostrando la última copia guardada mientras consultamos el seguimiento.');
    document.getElementById('btn-actualizar-noticias').addEventListener('click', () => refresh(true));
    refresh(false);
    setInterval(() => refresh(false), POLL_MS);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(false); });
    window.addEventListener('online', () => refresh(true));
    window.addEventListener('offline', () => showState('Sin conexión. Mostramos la última información disponible en este dispositivo.'));
  });
})();
