// Intentionally limited RSS/Atom reader: no executable XML or external entities.
// Feed and article destinations come exclusively from the reviewed sources file.
export const LIMITS = Object.freeze({
  sources: 8, bytes: 512 * 1024, redirects: 2, timeoutMs: 9000,
  entries: 500, relevantPerSource: 20, retainedNews: 300,
});

export function normalizeText(value = '') {
  return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/\s+/g, ' ').trim();
}

function decodeEntities(text) {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  return text.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (whole, code) => {
    if (code[0] !== '#') return named[code.toLowerCase()] ?? whole;
    const point = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : Number(code.slice(1));
    return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff)
      ? String.fromCodePoint(point) : '';
  });
}

export function plainText(value = '', max = 3000) {
  // Decode CDATA and entity-encoded HTML before removing tags. Returned strings
  // are data; consumers must still use textContent, never innerHTML.
  return decodeEntities(decodeEntities(String(value).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')))
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function field(block, name) {
  return block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}\\s*>`, 'i'))?.[1] ?? '';
}

function isPublicHostname(host) {
  return host.includes('.') && !host.includes(':') && !/^\d+(?:\.\d+){3}$/.test(host)
    && !/(?:^|\.)(?:localhost|local|internal|test|invalid|example)$/.test(host);
}

export function trustedUrl(input, source, base = source.url) {
  try {
    if (typeof input !== 'string' || !input.trim()) return null;
    const url = new URL(decodeEntities(input.trim()), base);
    const allowed = (source.allowedHosts ?? []).map(h => h.toLowerCase());
    if (url.protocol !== 'https:' || url.username || url.password || url.port
      || !isPublicHostname(url.hostname) || !allowed.includes(url.hostname.toLowerCase())
      || url.href.length > 2048) return null;
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|fbclid$|gclid$|msclkid$|mc_eid$)/i.test(key)) url.searchParams.delete(key);
    }
    url.searchParams.sort();
    return url.href;
  } catch { return null; }
}

export function matchingProjectIds(text, projects) {
  const normalized = ` ${normalizeText(text).replace(/[^a-z0-9]+/g, ' ')} `;
  return projects.filter(project => [project.nombre, ...(project.aliases ?? [])].some(name => {
    const alias = normalizeText(name).replace(/[^a-z0-9]+/g, ' ').trim();
    return alias.length >= 4 && normalized.includes(` ${alias} `);
  })).map(project => project.id);
}

function dateISO(text) {
  const raw = plainText(text, 120);
  // Date.parse normalizes impossible calendar dates, such as February 30.
  // Validate the calendar and clock before accepting explicit ISO/RFC feed dates.
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(Z|[+-]\d{2}:?\d{2}))?$/i);
  const rfc = raw.match(/^(?:(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun),?\s+)?(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?\s+(GMT|UTC|[+-]\d{4})$/i);
  if (!iso && !rfc) return null;
  const monthNames = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const year = Number(iso ? iso[1] : rfc[3]);
  const month = iso ? Number(iso[2]) : monthNames.indexOf(rfc[2].toLowerCase()) + 1;
  const day = Number(iso ? iso[3] : rfc[1]);
  const hour = Number((iso ? iso[4] : rfc[4]) ?? 0);
  const minute = Number((iso ? iso[5] : rfc[5]) ?? 0);
  const second = Number((iso ? iso[6] : rfc[6]) ?? 0);
  const zone = (iso ? iso[7] : rfc[7]) ?? 'Z';
  const offset = zone.match(/^[+-](\d{2}):?(\d{2})$/);
  const calendar = new Date(0);
  calendar.setUTCFullYear(year, month - 1, day);
  if (calendar.getUTCFullYear() !== year || calendar.getUTCMonth() !== month - 1
    || calendar.getUTCDate() !== day || hour > 23 || minute > 59 || second > 59
    || (offset && (Number(offset[1]) > 23 || Number(offset[2]) > 59))) return null;
  const date = new Date(raw);
  return Number.isNaN(date.valueOf()) ? null : date.toISOString();
}

function articleLink(block, source) {
  for (const match of block.matchAll(/<link\b([^>]*?)(?:\/?>)/gi)) {
    const attrs = match[1];
    const href = attrs.match(/\bhref\s*=\s*(["'])(.*?)\1/i)?.[2];
    const rel = attrs.match(/\brel\s*=\s*(["'])(.*?)\1/i)?.[2];
    if (href && (!rel || rel === 'alternate')) {
      const url = trustedUrl(href, source);
      if (url) return url;
    }
  }
  return trustedUrl(plainText(field(block, 'link'), 2048), source);
}

export async function parseFeed(xml, source, projects, now = new Date().toISOString()) {
  if (typeof xml !== 'string' || /<!\s*(?:DOCTYPE|ENTITY)\b/i.test(xml)) throw new Error('unsafe_xml');
  if (new TextEncoder().encode(xml).byteLength > LIMITS.bytes) throw new Error('too_large');
  // Markup inside comments or CDATA is article content, never a feed entry.
  xml = xml.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_, content) => content.replace(/</g, '&lt;').replace(/>/g, '&gt;'))
    .replace(/<!--[\s\S]*?-->/g, '').replace(/<\?[\s\S]*?\?>/g, '').trim();
  const root = xml.match(/^<(rss|feed|rdf:RDF)\b[^>]*>/i)?.[1];
  if (!root || !new RegExp(`<\\/${root}\\s*>$`, 'i').test(xml) || /<!/.test(xml)) throw new Error('invalid_feed');
  const observedAt = new Date(now).valueOf();
  if (!Number.isFinite(observedAt)) throw new Error('invalid_time');
  const entries = xml.matchAll(/<(item|entry)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi);
  const relevant = [];
  let count = 0;
  for (const [, , block] of entries) {
    if (++count > LIMITS.entries) break;
    const title = plainText(field(block, 'title'), 400);
    const summary = plainText(field(block, 'description') || field(block, 'summary')
      || field(block, 'content') || field(block, 'content:encoded'), 3000);
    const projectIds = matchingProjectIds(`${title} ${summary}`, projects);
    if (!title || !projectIds.length) continue;
    const url = articleLink(block, source);
    const publishedAt = dateISO(field(block, 'pubDate') || field(block, 'published')
      || field(block, 'dc:date'));
    if (!url || !publishedAt || new Date(publishedAt).valueOf() > observedAt) continue;
    relevant.push({ title, url, publisher: source.name, publishedAt, projectIds,
      summary, sourceId: source.id });
  }
  relevant.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  const seen = new Set();
  const unique = relevant.filter(item => !seen.has(item.url) && seen.add(item.url)).slice(0, LIMITS.relevantPerSource);
  return Promise.all(unique.map(async item => ({ ...item, id: await stableId(item.url) })));
}

export async function stableId(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

const ERROR_MESSAGES = {
  unsafe_url: 'La dirección no pertenece a los dominios permitidos.',
  redirect_limit: 'La fuente superó el límite de redirecciones.',
  too_large: 'El feed supera el límite de 512 KiB.',
  unsafe_xml: 'La fuente incluye XML externo no permitido.',
  invalid_feed: 'La respuesta no es un feed RSS o Atom compatible.',
  timeout: 'La fuente no respondió dentro del plazo permitido.',
  http_error: 'La fuente respondió con un error HTTP.',
  network_error: 'No se pudo consultar la fuente.',
};

async function limitedBody(response) {
  const length = Number(response.headers.get('content-length'));
  if (Number.isFinite(length) && length > LIMITS.bytes) {
    await response.body?.cancel();
    throw new Error('too_large');
  }
  if (!response.body) throw new Error('invalid_feed');
  const reader = response.body.getReader();
  let received = 0;
  const decoder = new TextDecoder('utf-8', { fatal: false });
  const chunks = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > LIMITS.bytes) { await reader.cancel(); throw new Error('too_large'); }
      chunks.push(decoder.decode(value, { stream: true }));
    }
    chunks.push(decoder.decode());
    return chunks.join('');
  } finally { reader.releaseLock(); }
}

export async function collectSource(source, projects, now, fetchImpl = fetch) {
  const meta = { id: source.id, name: source.name, url: source.url,
    lastAttemptAt: now, lastSuccessAt: null, error: null };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LIMITS.timeoutMs);
  try {
    let url = trustedUrl(source.url, source);
    if (!url || source.kind !== 'rss') throw new Error('unsafe_url');
    for (let redirects = 0; ; redirects++) {
      const response = await fetchImpl(url, {
        redirect: 'manual', signal: controller.signal,
        headers: { Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml',
          'User-Agent': 'MineriaSanJuan/1.3 (educational news reader)' },
      });
      if (response.status >= 300 && response.status < 400) {
        const destination = response.headers.get('location');
        await response.body?.cancel();
        if (redirects >= LIMITS.redirects) throw new Error('redirect_limit');
        url = destination && trustedUrl(destination, source, url);
        if (!url) throw new Error('unsafe_url');
        continue;
      }
      if (!response.ok) { await response.body?.cancel(); throw new Error('http_error'); }
      const xml = await limitedBody(response);
      // Relative article links belong to the final feed location after redirects.
      const news = await parseFeed(xml, { ...source, url }, projects, now);
      return { source: { ...meta, lastSuccessAt: now }, news };
    }
  } catch (error) {
    const key = controller.signal.aborted ? 'timeout' : error.message;
    return { source: { ...meta, error: ERROR_MESSAGES[key] ?? ERROR_MESSAGES.network_error }, news: [] };
  } finally { clearTimeout(timer); }
}

export function mergeNews(previous = [], incoming = []) {
  const merged = new Map(previous.map(item => [item.url, item]));
  for (const item of incoming) merged.set(item.url, item);
  return [...merged.values()].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
    .slice(0, LIMITS.retainedNews);
}
