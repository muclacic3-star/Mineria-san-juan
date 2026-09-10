# Minería San Juan · versión 1.4 (piloto en preparación)

Aplicación educativa sobre 14 proyectos mineros de San Juan, preparada para una exposición escolar. La 1.4 incorpora una ficha de agua e impactos documentados de Veladero. Conserva mapas, química de minerales y noticias de la 1.3 en Cloudflare Workers con D1.

**Sitio público estable (1.3):** https://mineria-san-juan.muclacic3.workers.dev/

## Piloto de agua e impactos

En Inicio, **Agua e impactos** abre la sección de Veladero. La ficha distingue antecedentes históricos documentados, declaraciones empresariales y cuestiones no determinadas. Cada fuente muestra su autor, fecha y alcance. La revisión documental no equivale a una nueva medición del agua.

**Estado de esta entrega:** interfaz, ficha documental y lógica del comparador preparadas; agua pendiente. El ensayo SGS MA25-01373 disponible es preliminar y sus códigos no tienen ubicaciones geográficas incorporadas. No se publican sus cifras como una campaña verificada. La 1.4 completa requiere un informe final con dos a cuatro puntos de agua superficial identificados y al menos un parámetro comparable de una misma campaña. No hay una fecha comprometida para recibir esos documentos.

- [Fuentes y pedido exacto para el profesor](docs/veladero-fuentes.md).
- [Guía de prueba y preparación de la publicación](docs/pruebas-v1.4.md).
- Datos editoriales: `data/veladero.json`; el build valida el conjunto antes de copiarlo a los recursos públicos.
- Los datos de agua e impactos se actualizan mediante revisión documental y publicación del repositorio. El horario de noticias no extrae ni aprueba análisis ambientales.
- No se añaden bases de datos, gastos de IA, filtros globales ni nuevas minas al piloto.

**Compatibilidad:** la aplicación declara `1.4.0`; `snapshot.version: "1.3"` y la clave `msj-snapshot-v1.3` siguen siendo el contrato de noticias. No deben cambiarse por una sustitución global de versiones. El piloto nunca modifica los estados operativos.

## Antecedente: publicación de la 1.3

Publicada y comprobada el 7 de septiembre de 2026: primera consulta remota correcta con dos fuentes, diez noticias y ningún cambio automático de estado. Pasaron 59 pruebas. El horario de seis horas quedó registrado en Cloudflare; esa primera consulta se ejecutó administrativamente para iniciar el catálogo. La clave temporal se retiró después.

## Novedades

- El servidor consulta dos canales públicos cada seis horas, incluso con la computadora apagada.
- La página busca una nueva copia cada cinco minutos. «Buscar actualizaciones» consulta esa copia; no fuerza otra búsqueda en los medios.
- Una misma instantánea actualiza fichas, mapas, filtros y contadores. Ante un fallo conserva los últimos datos y muestra un aviso.
- Las noticias enlazan al artículo original, con medio y fecha. No se republican sus cuerpos.
- Cada estado distingue referencia inicial, respaldo por fuentes o información en revisión. Los cambios confirmados conservan evidencia y fecha del hecho.
- Casposo se corrige editorialmente a producción a partir del [informe Q2 2026 de Austral Gold publicado el 31 de julio](https://australgold.com/wp-quotes-api/assets/files/announcements-pdf-files/3097233.pdf). No se inventa el día exacto del reinicio.

## Alcance del seguimiento

Fuentes activas: [Minería y Desarrollo, sección Minería](https://www.mineriaydesarrollo.com/rss/mineria/) y [Tiempo de San Juan, Minería](https://www.tiempodesanjuan.com/rss/mineria.xml). Se usan canales cortos para reducir procesamiento. El historial inicial depende de lo que ofrezcan; la aplicación no busca en toda la web.

Las reglas son acotadas: requieren una afirmación explícita sobre la mina completa, una fecha del hecho reconocible y reciente y corroboración. No comprenden cualquier redacción periodística. Muchas noticias informativas no generan cambios. Una noticia reciente que recuerde una suspensión antigua no debe suspender una operación actual.

Una fuente oficial competente, si se incorpora al listado revisado, puede confirmar proyectos de su ámbito. Con las fuentes de prensa actuales se exigen reportes compatibles de grupos editoriales y dominios distintos y se rechazan copias evidentes. Esto aproxima la independencia informativa; no la demuestra exhaustivamente desde un RSS. No hay una fuente oficial automática activada todavía.

Rumores, negaciones, discrepancias y afirmaciones cuyo alcance sea incierto pueden dejar la ficha «Información en revisión», manteniendo visible el estado anterior. Una suspensión de planta, mantenimiento o financiación no equivale por sí sola a suspensión o producción de toda la mina. Las revisiones persisten hasta nueva evidencia; no desaparecen porque un artículo salga del canal.

Se consideran artículos publicados en los últimos 30 días y hechos ocurridos en los últimos 14 días, posteriores a la referencia de julio de 2026. Fechas ausentes o futuras no se convierten en hechos confirmados. La fecha de consulta de fuentes no significa que todas las minas hayan sido verificadas. Las descripciones y cifras originales se presentan como referencia fechada.

## Desarrollo y pruebas

Requiere Node.js 24 y pnpm. Wrangler tiene una versión fijada en las dependencias.

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm build
pnpm db:local
pnpm dev
```

La vista previa se abre en la dirección indicada por Wrangler. Con `--test-scheduled`, `GET /__scheduled` ejecuta la consulta local de fuentes. Es una ruta de desarrollo, no una ruta pública de producción. Los tests usan noticias ficticias; no deben cargarse en la base remota.

Se prueban fechas imposibles, hechos antiguos y futuros, negaciones, mantenimiento, distintas minas, noticias copiadas, corroboración, fallos de base, concurrencia, conservación de datos, sincronización de vistas, enlaces inseguros y ausencia de caché de API.

## Publicación en Cloudflare

1. Autorizar la herramienta oficial: `pnpm exec wrangler login`. La sesión del navegador y la autorización de Wrangler son separadas. No incluir contraseñas ni tokens en el repositorio.
2. Para esta cuenta la base D1 ya está creada y vinculada. En otra cuenta: `pnpm exec wrangler d1 create mineria-san-juan`.
3. Sólo para otra cuenta, sustituir el identificador D1 de `wrangler.jsonc` por el de su propia base.
4. Ejecutar `pnpm db:remote`, `pnpm test`, `pnpm build` y `pnpm deploy`.
5. Comprobar `/api/health` y `/api/snapshot` en el enlace que devuelva Cloudflare. `pending` significa que falta la primera consulta. Los horarios pueden demorar en propagarse.

El horario `17 */6 * * *` usa UTC: en Argentina, 03:17, 09:17, 15:17 y 21:17. Página y servidor se publican juntos en Workers. La copia en `muclacic3-star.github.io/Mineria-san-juan/` consulta ese mismo servidor de Cloudflare; el Worker debe permanecer publicado para que el seguimiento funcione en ambos enlaces.

`POST /api/refresh` permite una consulta inmediata sólo si se configura `ADMIN_TOKEN` con `pnpm exec wrangler secret put ADMIN_TOKEN` y se envía como Bearer. La interfaz nunca contiene ese secreto. Sin secreto, esta función administrativa está deshabilitada y el horario sigue funcionando.

El código no contrata planes ni usa una API de IA. Su funcionamiento gratuito depende de los límites y del procesamiento real. Ante límites o fuentes caídas conserva datos y avisa; no habilita gastos automáticamente. Comprobar consumo después de publicar: [límites de Workers](https://developers.cloudflare.com/workers/platform/limits/) y [D1](https://developers.cloudflare.com/d1/platform/limits/).

## Archivos

| Archivo | Función |
|---|---|
| `index.html` | Interfaz, catálogo educativo y mapas |
| `actualizaciones.js` | Noticias y sincronización de vistas |
| `agua-impactos.js` | Validación, comparación y ficha documental de Veladero |
| `agua-impactos.css` | Estilos accesibles del piloto |
| `data/veladero.json` | Fuentes, impactos y campañas aprobadas; actualmente agua pendiente |
| `sw.js` | Archivos sin conexión; API siempre por red |
| `src/worker.js` | API, horario y publicación transaccional |
| `src/ingestion.js` | Lectura limitada de RSS revisados |
| `src/status-rules.js` | Evidencia, reglas e historial |
| `src/sources.json` | Fuentes, dominios y grupos editoriales |
| `src/projects-seed.json` | Referencia generada por el build |
| `migrations/0001_initial.sql` | Base e historial persistente |
| `tests/` | Pruebas con datos ficticios |

La PWA conserva información descargada. Mapas y recursos externos pueden faltar sin conexión, especialmente en la primera visita.

Proyecto educativo sin fines comerciales.
