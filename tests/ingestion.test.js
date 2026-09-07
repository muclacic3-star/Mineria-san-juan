import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LIMITS, collectSource, matchingProjectIds, mergeNews, parseFeed,
  plainText, stableId, trustedUrl,
} from '../src/ingestion.js';

// Fictional fixtures. No fixture represents a real mine, publisher, or event.
const NOW = '2026-09-07T12:00:00.000Z';
const source = { id: 'fictional-feed', name: 'Diario de Pruebas', kind: 'rss',
  url: 'https://news.mining-qa.org/feed.xml', allowedHosts: ['news.mining-qa.org'] };
const projects = [
  { id: 'cerro-prueba', nombre: 'Cerro Prueba', aliases: ['Mina Ensayo'] },
  { id: 'loma-ficticia', nombre: 'Loma Ficticia', aliases: [] },
];
const item = ({ title = 'Cerro Prueba comunica una novedad', url = '/articulo',
  date = 'Mon, 07 Sep 2026 08:30:00 -0300', summary = 'Texto ficticio para pruebas.' } = {}) =>
  `<item><title>${title}</title><link>${url}</link><pubDate>${date}</pubDate><description>${summary}</description></item>`;
const rss = (...entries) => `<?xml version="1.0"?><rss version="2.0"><channel>${entries.join('')}</channel></rss>`;
const parse = xml => parseFeed(xml, source, projects, NOW);

test('RSS exposes source, explicit date, canonical link and bounded plain text', async () => {
  const [article] = await parse(rss(item({
    title: 'Cerro Prueba &amp; novedades', url: '/articulo?utm_source=mail&amp;b=2&amp;a=1#nota',
    summary: '<![CDATA[<p>Minería <b>educativa</b>.</p><script>malicioso()</script>]]>',
  })));
  assert.equal(article.title, 'Cerro Prueba & novedades');
  assert.equal(article.summary, 'Minería educativa .');
  assert.equal(article.url, 'https://news.mining-qa.org/articulo?a=1&b=2');
  assert.equal(article.publishedAt, '2026-09-07T11:30:00.000Z');
  assert.deepEqual(article.projectIds, ['cerro-prueba']);
  assert.equal(article.publisher, source.name);
  assert.equal(article.sourceId, source.id);
  assert.match(article.id, /^[a-f0-9]{32}$/);
  assert.equal(article.id, await stableId(article.url));
});

test('Atom selects a trusted alternate article link, not self or an untrusted alternate', async () => {
  const feed = `<feed xmlns="http://www.w3.org/2005/Atom"><entry>
    <title>Mina Ensayo y Loma Ficticia</title>
    <link rel="self" href="https://news.mining-qa.org/api/1"/>
    <link rel="alternate" href="https://untrusted.mining-qa.org/1"/>
    <link rel="alternate" href="/noticia-atom"/>
    <published>2026-09-06T10:30:00Z</published><updated>2026-09-07T11:00:00Z</updated>
    <summary type="html">&lt;p&gt;Texto &amp;amp; novedades.&lt;/p&gt;</summary>
    </entry></feed>`;
  const [article] = await parse(feed);
  assert.equal(article.url, 'https://news.mining-qa.org/noticia-atom');
  assert.equal(article.summary, 'Texto & novedades.');
  assert.equal(article.publishedAt, '2026-09-06T10:30:00.000Z');
  assert.deepEqual(article.projectIds, ['cerro-prueba', 'loma-ficticia']);
});

test('publication dates are never inferred from fetch time, updated, or malformed dates', async () => {
  for (const date of ['', 'ayer', '09/06/2026', '2026-09-06T10:00:00',
    'Mon, 07 Sep 2026 08:00:00', '2026-02-30', '2025-02-29T10:00:00Z',
    '31 Apr 2026 12:00:00 GMT', '2026-09-07T24:00:00Z', '2026-09-07T10:61:00Z',
    '2026-09-07T10:00:00+24:00']) {
    assert.deepEqual(await parse(rss(item({ date }))), [], date);
  }
  assert.deepEqual(await parse('<feed><entry><title>Cerro Prueba</title><link href="/a"/><updated>2026-09-06T10:00:00Z</updated></entry></feed>'), []);
  assert.equal((await parse(rss(item({ date: '2024-02-29' }))))[0].publishedAt, '2024-02-29T00:00:00.000Z');
});

test('future publication dates are omitted relative to the supplied observation time', async () => {
  assert.deepEqual(await parse(rss(item({ date: '2026-09-07T12:00:01Z' }))), []);
  assert.equal((await parse(rss(item({ date: NOW })))).length, 1);
  await assert.rejects(parseFeed(rss(), source, projects, 'invalid clock'), /invalid_time/);
  const result = await collectSource(source, projects, NOW,
    async () => new Response(rss(item({ date: '2026-09-08T10:00:00Z' }))));
  assert.deepEqual(result.news, []);
  assert.equal(result.source.lastSuccessAt, NOW);
});

test('project aliases respect accents and whole words', () => {
  assert.deepEqual(matchingProjectIds('Actualización: MÍNA ENSAYO, Loma Ficticia.', projects), ['cerro-prueba', 'loma-ficticia']);
  assert.deepEqual(matchingProjectIds('Cerro Pruebas y SuperMina Ensayo', projects), []);
});

test('only exact reviewed public HTTPS hosts and ordinary ports are accepted', () => {
  for (const url of ['http://news.mining-qa.org/a', 'https://user:pass@news.mining-qa.org/a',
    'https://news.mining-qa.org:8443/a', 'https://news.mining-qa.org.evil.org/a',
    'https://sub.news.mining-qa.org/a', '//evil.org/a', 'javascript:alert(1)',
    'data:text/plain,a', 'file:///tmp/a', '']) {
    assert.equal(trustedUrl(url, source), null, url);
  }
  for (const host of ['localhost', '127.0.0.1', '2130706433', '[::1]', 'metadata.internal', 'feed.local', 'feed.test', 'feed.example']) {
    assert.equal(trustedUrl(`https://${host}/`, { ...source, allowedHosts: [host] }), null, host);
  }
  assert.equal(trustedUrl('/a?utm_medium=x&gclid=a&q=mina&fbclid=b#top', source), 'https://news.mining-qa.org/a?q=mina');
  assert.equal(trustedUrl('/a', source, 'https://news.mining-qa.org/new/feed'), 'https://news.mining-qa.org/a');
  assert.equal(trustedUrl('/' + 'a'.repeat(2048), source), null);
});

test('XML declarations, non-feed responses, and oversized direct input are rejected', async () => {
  for (const xml of ['<!DOCTYPE rss [<!ENTITY x SYSTEM "file:///etc/passwd">]><rss></rss>',
    '<!ENTITY x "value"><rss></rss>']) await assert.rejects(parse(xml), /unsafe_xml/);
  for (const xml of ['<html><rss></rss></html>', '<rss>', '<html>Login required</html>',
    '<feed></rss>', '<rss></rss><html/>']) await assert.rejects(parse(xml), /invalid_feed/);
  await assert.rejects(parse(rss(' '.repeat(LIMITS.bytes))), /too_large/);
});

test('comments and CDATA cannot introduce phantom articles or fields', async () => {
  const phantom = item({ title: 'Loma Ficticia noticia falsa', url: '/fantasma' });
  const articles = await parse(rss(`<!-- ${phantom} -->`, item({
    title: '<![CDATA[Cerro Prueba <link>/falso</link>]]>',
    summary: `<![CDATA[Ejemplo de XML: ${phantom}]]>`,
  })));
  assert.equal(articles.length, 1);
  assert.equal(articles[0].url, 'https://news.mining-qa.org/articulo');
  assert.equal(articles[0].title, 'Cerro Prueba /falso');
});

test('escaped HTML, script/style contents and invalid code points are removed', () => {
  assert.equal(plainText('&lt;script&gt;bad()&lt;/script&gt;&lt;p&gt;Seguro &amp; visible&lt;/p&gt;'), 'Seguro & visible');
  assert.equal(plainText('<style>bad{}</style><b>Texto</b>&#xD800;&#0;&#1114112;'), 'Texto');
  assert.equal(plainText('abcdefgh', 4), 'abcd');
});

test('tracking URL duplicates collapse to the newest version and sort by publication date', async () => {
  const articles = await parse(rss(
    item({ url: '/duplicado?utm_source=old', date: '2026-09-05', title: 'Cerro Prueba título anterior' }),
    item({ url: '/duplicado?fbclid=new', date: '2026-09-06', title: 'Cerro Prueba título reciente' }),
    item({ url: '/otro', date: '2026-09-07' }),
    item({ url: 'https://untrusted.mining-qa.org/article' }),
    item({ url: '/unrelated', title: 'Una noticia sin relación' }),
  ));
  assert.equal(articles.length, 2);
  assert.equal(articles[0].url, 'https://news.mining-qa.org/otro');
  assert.equal(articles[1].title, 'Cerro Prueba título reciente');
});

test('entry and relevant-news caps bound feed processing', async () => {
  const entries = Array.from({ length: LIMITS.entries }, (_, n) => item({
    url: `/entry-${n}`, title: 'No tiene relación con nuestros proyectos',
  }));
  assert.deepEqual(await parse(rss(...entries, item())), []);
  const relevant = Array.from({ length: LIMITS.relevantPerSource + 5 }, (_, n) => item({ url: `/noticia-${n}` }));
  assert.equal((await parse(rss(...relevant))).length, LIMITS.relevantPerSource);
});

test('collection follows only reviewed redirects, resolves relative locations and sets bounded fetch options', async () => {
  const requests = [];
  const result = await collectSource(source, projects, NOW, async (url, options) => {
    requests.push(url);
    assert.equal(options.redirect, 'manual');
    assert.ok(options.signal instanceof AbortSignal);
    return requests.length === 1
      ? new Response(null, { status: 302, headers: { location: '/feeds/new.xml' } })
      : new Response(rss(item({ url: 'article' })));
  });
  assert.deepEqual(requests, [source.url, 'https://news.mining-qa.org/feeds/new.xml']);
  assert.equal(result.news.length, 1);
  assert.equal(result.news[0].url, 'https://news.mining-qa.org/feeds/article');
  assert.equal(result.source.lastSuccessAt, NOW);
  assert.equal(result.source.error, null);
});

test('an unreviewed redirect is never fetched', async () => {
  let calls = 0;
  const result = await collectSource(source, projects, NOW, async () => {
    calls++;
    return new Response(null, { status: 302, headers: { location: 'https://127.0.0.1/secrets' } });
  });
  assert.equal(calls, 1);
  assert.match(result.source.error, /dominios permitidos/);
  assert.deepEqual(result.news, []);
});

test('redirect loops stop after the configured number of redirects', async () => {
  let calls = 0;
  const result = await collectSource(source, projects, NOW, async () => {
    calls++;
    return new Response(null, { status: 302, headers: { location: '/loop' } });
  });
  assert.equal(calls, LIMITS.redirects + 1);
  assert.match(result.source.error, /redirecciones/);
});

test('declared and streamed body sizes are bounded and excess streams canceled', async () => {
  for (const declareSize of [true, false]) {
    let canceled = false;
    let chunks = 0;
    const body = new ReadableStream({
      pull(controller) { chunks++; controller.enqueue(new Uint8Array(300 * 1024)); },
      cancel() { canceled = true; },
    });
    const result = await collectSource(source, projects, NOW, async () => new Response(body, {
      headers: declareSize ? { 'content-length': String(LIMITS.bytes + 1) } : {},
    }));
    assert.match(result.source.error, /512 KiB/);
    assert.equal(canceled, true);
    assert.ok(chunks <= 3);
  }
});

test('timeouts abort the active request and return a readable failure', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const collecting = collectSource(source, projects, NOW, async (_, { signal }) =>
    new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })));
  t.mock.timers.tick(LIMITS.timeoutMs);
  const result = await collecting;
  assert.match(result.source.error, /plazo permitido/);
  assert.equal(result.source.lastSuccessAt, null);
});

test('failed sources expose failure without erasing previously retained articles', async () => {
  const [previous] = await parse(rss(item()));
  for (const fetchImpl of [async () => new Response('failure', { status: 503 }),
    async () => { throw new Error('network issue with private details'); },
    async () => new Response('<html>Sign in</html>')]) {
    const result = await collectSource(source, projects, NOW, fetchImpl);
    assert.equal(result.source.lastAttemptAt, NOW);
    assert.equal(result.source.lastSuccessAt, null);
    assert.ok(result.source.error);
    assert.ok(!result.source.error.includes('private details'));
    assert.deepEqual(result.news, []);
    // Retaining lastSuccessAt belongs to the caller; mergeNews preserves news.
    assert.deepEqual(mergeNews([previous], result.news), [previous]);
  }
});

test('merge replaces matching articles, preserves other sources and caps retained history', () => {
  const previous = Array.from({ length: LIMITS.retainedNews + 2 }, (_, n) => ({
    url: `https://news.mining-qa.org/old-${n}`, title: `Old ${n}`, publishedAt: '2026-09-05T00:00:00.000Z',
  }));
  const incoming = { ...previous[0], title: 'Updated', publishedAt: NOW };
  const merged = mergeNews(previous, [incoming]);
  assert.equal(merged.length, LIMITS.retainedNews);
  assert.deepEqual(merged[0], incoming);
  assert.equal(merged.filter(article => article.url === incoming.url).length, 1);
  assert.equal(previous[0].title, 'Old 0');
});
