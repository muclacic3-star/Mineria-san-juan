import { matchingProjectIds, normalizeText, stableId } from './ingestion.js';

export const BASELINE_REFERENCE_AT = '2026-07-31T23:59:59.000Z';
const DAY = 86400000;
const MAX_ARTICLE_AGE = 30 * DAY;
const MAX_EVENT_AGE = 14 * DAY;
const MONTHS = { enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6,
  julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12 };
const DATE = '(?:20\\d{2}-\\d{2}-\\d{2}|[0-3]?\\d de (?:' + Object.keys(MONTHS).join('|') + ') de 20\\d{2})';
// "Cerro" can name a mountain and "cerró/inició" can describe credit, a
// biography, or a drill campaign. These verbs need an operational object.
// Completing another exploration campaign is not entering a new project state.
const SIGNAL = /\b(?:suspend\w*|suspensi\w*|paraliz\w*|detuvo|detencion|reanud\w*|reinici\w*|reactiv\w*|(?:inicio|iniciara|iniciaria|comenzo|comenzara|comenzaria) (?:la |las |sus |nuevas )?(?:produccion|operaciones|explotacion)|(?:cierre|cerro|cerrara|cerrar) (?:definitivo |temporal )?(?:(?:de|del|la|el|sus|las) )*(?:mina|proyecto|operaciones|produccion)|dejo de (?:producir|estar en produccion)|cese de (?:operaciones|produccion)|volvio a producir|produccion comercial|paso a la etapa de (?:exploracion|evaluacion|reactivacion))\b/;
const CAUTION = /\b(?:no|nunca|niega|desmiente|podria\w*|podran|puede|pueden|posible|posibilidad|eventual\w*|preve\w*|previst\w*|planea\w*|proyecta\w*|anunciaria|anunciara|suspenderia|suspendera|reanudar\w*|reiniciar\w*|iniciara|iniciaria|si|condicionad\w*|rumor\w*|habria|hubiera|habia|recordo|recordaron|histori\w*|anteriormente|mantenimiento|ampliacion|expansion|construccion de|obra\w*|una parte|parcial\w*|una de|planta|turno|sector|campamento|simulacro)\b/;

const EVENTS = [
  ['suspendido', '(?:suspendio|paralizo) (?:temporalmente )?(?:todas )?sus operaciones(?: de produccion)?'],
  // Resuming unspecified operations can mean exploration or drilling. A
  // production state requires the assertion itself to identify production.
  ['produccion', '(?:reanudo|reinicio) (?:sus )?operaciones de produccion'],
  ['produccion', '(?:inicio|comenzo) (?:la )?produccion comercial'],
  ['exploracion', 'paso a la etapa de exploracion'],
  ['evaluacion', 'paso a la etapa de evaluacion'],
  ['reactivacion', 'paso a la etapa de reactivacion'],
];

export function baselineProjects(seeds) {
  return seeds.map(seed => ({ id: seed.id, estado: seed.estado,
    verification: 'baseline', effectiveAt: null, checkedAt: null,
    baselineReferenceAt: BASELINE_REFERENCE_AT,
    reason: seed.baselineReason ?? 'Estado heredado de la versión 1.2 (referencia: julio de 2026); pendiente de verificación automática.',
    evidence: structuredClone(seed.baselineEvidence ?? []), history: [],
  }));
}

function escapeRegex(text) { return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function eventDate(raw) {
  let year, month, day;
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) [, year, month, day] = iso.map(Number);
  else {
    const spanish = raw.match(/^(\d{1,2}) de ([a-z]+) de (\d{4})$/);
    if (!spanish) return null;
    day = Number(spanish[1]); month = MONTHS[spanish[2]]; year = Number(spanish[3]);
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date.toISOString();
}

function sentences(item) {
  return normalizeText(`${item.title}. ${item.summary ?? ''}`).split(/[.!?;\n]+/).map(s => s.trim()).filter(Boolean);
}

function articleFresh(item, now) {
  const publication = Date.parse(item.publishedAt);
  return Number.isFinite(publication) && publication <= Date.parse(now) + 5 * 60000
    && Date.parse(now) - publication <= MAX_ARTICLE_AGE;
}

function evidenceFor(item) {
  return { title: item.title, url: item.url, publishedAt: item.publishedAt, publisher: item.publisher };
}

// This is a deliberately narrow sentence grammar, not general language
// understanding. Unrecognised claims are review candidates, never state facts.
export function analyzeClaim(item, seed, now) {
  if (!articleFresh(item, now)) return { kind: 'ignore' };
  const lines = sentences(item);
  const relevantLines = lines.filter(line => matchingProjectIds(line, [seed]).length && SIGNAL.test(line));
  if (!relevantLines.length) return { kind: 'ignore' };
  // A newly published retrospective is not a current status dispute. A dated
  // event outside our verification window remains news but does not flag a mine.
  const explicitDates = [...lines.join(' ').matchAll(new RegExp(DATE, 'g'))]
    .map(match => eventDate(match[0])).filter(Boolean);
  if (explicitDates.length && explicitDates.every(date =>
    Date.parse(date) <= Date.parse(BASELINE_REFERENCE_AT)
    || Date.parse(now) - Date.parse(date) > MAX_EVENT_AGE)) return { kind: 'ignore' };
  const aliases = [seed.nombre, ...(seed.aliases ?? [])].map(normalizeText).filter(name => name.length >= 4);
  const subject = `(?:la mina|el proyecto) (?:${aliases.map(escapeRegex).join('|')})`;
  // A caution elsewhere in the short feed excerpt can qualify the headline.
  if (lines.some(line => CAUTION.test(line))) return { kind: 'review', reason: 'La noticia requiere interpretar su alcance, condiciones o contexto.' };
  const claims = [];
  for (const line of relevantLines) {
    for (const [estado, verb] of EVENTS) {
      const leading = new RegExp(`^(?:el )?(${DATE}),? ${subject} ${verb}$`);
      const trailing = new RegExp(`^${subject} ${verb} (?:desde )?el (${DATE})$`);
      const match = line.match(leading) ?? line.match(trailing);
      if (!match) continue;
      const effectiveAt = eventDate(match[1]);
      if (!effectiveAt) continue;
      const effective = Date.parse(effectiveAt);
      const publicationDay = item.publishedAt.slice(0, 10);
      if (effectiveAt.slice(0, 10) > publicationDay || effective > Date.parse(now)
        || Date.parse(now) - effective > MAX_EVENT_AGE || effective <= Date.parse(BASELINE_REFERENCE_AT)) continue;
      claims.push({ kind: 'claim', estado, effectiveAt, item });
    }
  }
  if (!claims.length) return { kind: 'review', reason: 'Hay una posible novedad de estado, pero no una afirmación y fecha de hecho inequívocas.' };
  const unique = new Map(claims.map(claim => [`${claim.estado}:${claim.effectiveAt}`, claim]));
  if (unique.size !== 1) return { kind: 'review', reason: 'La noticia contiene más de un cambio de estado y requiere revisión.' };
  return [...unique.values()][0];
}

function tokens(item) {
  const text = normalizeText(`${item.title} ${item.summary ?? ''}`);
  return new Set(text.replace(/[^a-z0-9 ]/g, ' ').split(' ').filter(t => t.length > 2));
}

function looksSyndicated(left, right) {
  // Publisher metadata must already establish independence; copied wording or
  // the same quoted claim is an additional reason not to count a second vote.
  // Extra unrelated paragraphs must not make an identical assertion look like
  // independent corroboration. Feed-only evidence cannot prove independence.
  const sameAssertion = sentences(left).some(line => SIGNAL.test(line)
    && sentences(right).includes(line));
  if (sameAssertion) return true;
  const a = tokens(left); const b = tokens(right);
  const intersection = [...a].filter(token => b.has(token)).length;
  const union = new Set([...a, ...b]).size;
  return union === 0 || intersection / union >= 0.72;
}

function supportedGroup(claims, sources, projectId) {
  const official = claims.filter(claim => {
    const source = sources.get(claim.item.sourceId);
    return source?.trust === 'official' && source.statusAuthorityProjectIds?.includes(projectId);
  });
  if (official.length) return { confirmed: true, evidence: official.map(c => evidenceFor(c.item)), mode: 'official' };
  const press = claims.filter(claim => {
    const source = sources.get(claim.item.sourceId);
    return source?.trust === 'press' && typeof source.publisherGroup === 'string' && source.publisherGroup.trim();
  });
  for (let left = 0; left < press.length; left++) {
    for (let right = left + 1; right < press.length; right++) {
      const a = press[left].item; const b = press[right].item;
      if (sources.get(a.sourceId).publisherGroup !== sources.get(b.sourceId).publisherGroup
        && new URL(a.url).hostname !== new URL(b.url).hostname && !looksSyndicated(a, b)) {
        return { confirmed: true, evidence: [evidenceFor(a), evidenceFor(b)], mode: 'press' };
      }
    }
  }
  return { confirmed: false, evidence: claims.map(c => evidenceFor(c.item)).slice(0, 4) };
}

function latestKnownPublication(project) {
  return Math.max(Date.parse(project.effectiveAt ?? BASELINE_REFERENCE_AT),
    ...(project.evidence ?? []).map(item => Date.parse(item.publishedAt)).filter(Number.isFinite));
}

export async function evaluateProjects(previous, seeds, news, configuredSources, now) {
  const sources = new Map(configuredSources.map(source => [source.id, source]));
  const old = new Map(previous.map(project => [project.id, project]));
  const events = [];
  const projects = [];
  for (const seed of seeds) {
    const project = structuredClone(old.get(seed.id) ?? baselineProjects([seed])[0]);
    const relevant = news.filter(item => item.projectIds.includes(seed.id));
    const claims = [], ambiguous = [];
    for (const item of relevant) {
      const result = analyzeClaim(item, seed, now);
      if (result.kind === 'claim') {
        if (Date.parse(result.effectiveAt) > Date.parse(project.effectiveAt ?? BASELINE_REFERENCE_AT)
          || (result.effectiveAt === project.effectiveAt && result.estado !== project.estado)) claims.push(result);
      } else if (result.kind === 'review' && Date.parse(item.publishedAt) > latestKnownPublication(project)) {
        ambiguous.push({ ...result, item });
      }
    }
    const groups = new Map();
    for (const claim of claims) {
      const key = `${claim.effectiveAt}:${claim.estado}`;
      const group = groups.get(key) ?? [];
      group.push(claim); groups.set(key, group);
    }
    const candidates = [...groups.values()].map(group => ({ ...group[0], ...supportedGroup(group, sources, seed.id) }))
      .sort((a, b) => b.effectiveAt.localeCompare(a.effectiveAt));
    if (candidates.length) {
      const newest = candidates[0];
      const competing = candidates.filter(candidate => candidate.effectiveAt === newest.effectiveAt && candidate.estado !== newest.estado);
      if (competing.length || (newest.effectiveAt === project.effectiveAt && newest.estado !== project.estado)) {
        project.verification = 'review'; project.checkedAt = now;
        project.reason = 'Las fuentes discrepan sobre el estado para la misma fecha; se conserva el último estado registrado.';
        project.evidence = [newest, ...competing].flatMap(candidate => candidate.evidence).slice(0, 6);
      } else if (newest.confirmed) {
        const evidence = newest.evidence.slice(0, 4);
        const event = {
          id: await stableId(`${seed.id}:${newest.estado}:${newest.effectiveAt}`),
          projectId: seed.id, from: project.estado, to: newest.estado,
          effectiveAt: newest.effectiveAt, checkedAt: now, evidence,
        };
        if (project.estado !== newest.estado && !(project.history ?? []).some(existing => existing.id === event.id)) {
          events.push(event); project.history = [event, ...(project.history ?? [])].slice(0, 30);
        }
        project.estado = newest.estado; project.verification = 'confirmed';
        project.effectiveAt = newest.effectiveAt; project.checkedAt = now;
        project.reason = newest.mode === 'official'
          ? 'Cambio explícito y fechado confirmado por una fuente oficial competente.'
          : 'Cambio explícito y fechado corroborado por dos medios con independencia editorial registrada.';
        project.evidence = evidence;
      } else {
        project.verification = 'review'; project.checkedAt = now;
        project.reason = 'El cambio necesita una fuente oficial competente o corroboración editorial independiente.';
        project.evidence = newest.evidence;
      }
    }
    const unresolved = ambiguous.filter(entry => Date.parse(entry.item.publishedAt) > latestKnownPublication(project));
    if (unresolved.length) {
      project.verification = 'review'; project.checkedAt = now;
      project.reason = unresolved[0].reason + ' Se conserva el último estado registrado.';
      project.evidence = [...unresolved.slice(0, 3).map(entry => evidenceFor(entry.item)), ...project.evidence].slice(0, 6);
    }
    projects.push(project);
  }
  return { projects, events };
}
