# Veladero: fuentes y documentación pendiente

Revisión documental: **10 de septiembre de 2026**. El piloto contiene una ficha inicial de impactos y **ninguna campaña de agua aprobada**. La búsqueda pública acotada no identificó una versión final de MA25-01373 acompañada por la ubicación de sus estaciones. Eso no implica que esa documentación no exista.

## Inventario y alcance de la revisión

Los identificadores corresponden a `data/veladero.json`. Las páginas de SGS y del comunicado empresarial son páginas del PDF; la referencia de AGN indica expresamente la numeración impresa.

| Identificador | Fuente y fecha | Localizador revisado | Uso y límite |
| --- | --- | --- | --- |
| `sgs-ma25-01373` | [Ensayo de SGS](https://veladero.com/public/pdf/noticias/1764370430_b48ea2ba1f36acc4109a.pdf), 28/11/2025 | Cinco páginas; procedencia y estado en p. 1 | Permite identificar el documento pendiente. No se transcriben ni publican resultados. Se enlaza al original. |
| `veladero-monitoreo-2025` | [Comunicación de la operadora](https://veladero.com/comunicaciones/noticia/nuevo-monitoreo-participativo-veladero-refuerza-con-hechos-su-compromiso-con-la-transparencia-y-la-calidad-del-agua), 28/11/2025 | Participantes, análisis de laboratorio y adjunto | Orienta el pedido documental. La participación de la UNSJ es informada por la empresa; no constituye una conclusión independiente del instituto. |
| `agn-168-2017` | [Auditoría de la AGN](https://www.agn.gov.ar/sites/default/files/informes/informe_168_2017.pdf), 2017 | Anexo X.2, p. impresa 96 | Sustenta el incidente y la visita técnica de 2015. Se verificó el extracto indexado del dominio oficial; la apertura completa devolvió error. No se asignó un número de página del visor sin comprobar su correspondencia. |
| `gobierno-derrame-2016` | [Comunicación de Casa Rosada](https://www.casarosada.gob.ar/informacion/eventos-destacados-presi/35675-el-gobierno-aporta-un-informe-a-la-justicia-por-derrame-de-cianuro-en-una-mina-de-san-juan), 03/03/2016 | Párrafo que atribuye hallazgos a la Policía Federal | Se documenta lo que comunicó el Gobierno, sin presentarlo como lectura del peritaje completo ni decisión judicial. |
| `veladero-balance-2024` | [Balance empresarial de 2024](https://veladero.com/public/pdf/noticias/1735325743_3078d0a2f13a0ba6c20c.pdf), 27/12/2024 | Fondos comunitarios, p. 1; empleo, p. 2 | Dos cifras históricas atribuidas a la empresa. Incluye personal contratista y aportes de contratistas; no se equiparan a recaudación fiscal, salarios provinciales ni resultados sociales auditados. |

Los antecedentes de 2015 y 2016 no indican el estado operativo o ambiental de 2026. La ficha no pretende cubrir todos los derrames, expedientes o medidas. El consumo de agua, las sanciones y la remediación requieren documentación específica antes de sumar afirmaciones. No se usa el comunicado empresarial para descartar daños ni para compensarlos con empleo.

## Pedido concreto para el profesor

Destinatario inicial: **Ministerio de Minería de San Juan**, solicitando derivación a la **Secretaría de Gestión Ambiental y Control Minero** o al área que conserve la documentación de Veladero. El [directorio oficial del organismo](https://tramite.sanjuan.gob.ar/organismo/lightbox_mapa/31) publica **mineria@sanjuan.gov.ar**. El pedido no fue enviado por esta aplicación.

Solicitar copias de documentación ya existente, sin encargar análisis nuevos:

1. Informe final completo de la campaña participativa del 27 y 28 de noviembre de 2025, correspondiente al ensayo **SGS MA25-01373**, referencia **PL-4795**, o su reemplazo final.
2. Acta de muestreo, cadena de custodia y plano o listado que permita ubicar **LARGA-17592, LARGA-17590, LARGA-17588 y LARGA-17591**. Debe poder relacionarse inequívocamente cada código con un punto real.
3. Tablas completas con fecha de toma, tipo de agua, parámetro y fracción, unidad, método, límites de detección y cuantificación, laboratorio y responsable de muestreo. Preferir PDF completo y, si existe, Excel o CSV original.
4. Si esa campaña no está disponible, otra campaña final de agua superficial vinculada a Veladero con al menos dos puntos identificados y mediciones comparables. Puede ser de un año anterior.

Como segunda vía, consultar al **Instituto de Investigaciones Hidráulicas de la UNSJ** para localizar los informes u orientar su interpretación. La nota empresarial menciona participación de técnicos, pero no confirma quién conserva el resultado final.

## Incorporación de una campaña

Antes de cargar datos reales, conservar el vínculo al informe completo y cotejar toda la transcripción. Registrar separadamente emisión/publicación y fecha de muestreo; identificar lugar, matriz, parámetro/fracción, unidad y método. Aprobar solo entre dos y cuatro puntos con al menos un parámetro compatible. No deducir ubicaciones a partir de los nombres de código.

Mantener los calificadores del laboratorio: un resultado bajo el límite de cuantificación o no detectado no equivale a cero. No mezclar fracciones totales y disueltas ni interpretar ausencia de un parámetro como ausencia de contaminación. El piloto muestra mediciones; no certifica potabilidad ni demuestra causalidad.

Hasta completar esa revisión, `water.status` sigue en `pending` y `campaigns` permanece vacío. Los datos ficticios usados en pruebas nunca se incorporan al archivo publicado.
