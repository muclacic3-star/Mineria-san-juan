# Cómo probar el piloto de Veladero

Esta es una vista de prueba de la 1.4. La ficha documental se puede revisar; todavía no se incorporó una campaña final de agua con sus puntos identificados. Los casos ficticios pertenecen solamente a las pruebas del código.

## Recorrido para vos y tu profesor

1. En Inicio, abrí **Agua e impactos**, debajo del aviso de noticias. Debe abrirse la ficha de Veladero directamente en el piloto.
2. Leé qué informe está disponible y desplegá **Qué falta para comparar**. No deben aparecer valores de agua, un puntaje de calidad ni afirmaciones de potabilidad.
3. Revisá los cuatro apartados de impactos. Los hechos de 2015/2016 y las cifras empresariales de 2024 deben tener su período visible. Las cifras económicas no son datos de empleo actual.
4. Abrí las fuentes. Los informes deben indicar autor y fecha; las citas a páginas del PDF deben dirigirte al folio correspondiente cuando se verificó su número.
5. Cerrá la ficha y abrí otra mina: ese proyecto no debe tener el piloto de Veladero.
6. En un celular, comprobá que el texto sea legible. Con teclado, usá Tab, Enter y Escape; el foco debe permanecer dentro de la ficha abierta y volver al botón de origen al cerrarla.
7. Después de una visita completa con conexión, desconectá internet y volvé a abrir el piloto. El aviso de noticias puede cambiar, pero la ficha documental descargada debe seguir disponible. Los documentos externos requieren conexión.

Para reportar un problema, indicá qué botón tocaste, qué esperabas y qué apareció. No hace falta conocer programación.

## Qué falta para terminar el agua

El [pedido para el profesor](veladero-fuentes.md) identifica el ensayo SGS MA25-01373, su cadena de custodia PL-4795 y los cuatro códigos de muestra. También sirve otra campaña final completa de un año anterior. No se necesitan nuevas mediciones para comenzar.

El equipo revisará el informe final y la relación entre muestras y lugares antes de publicar cifras. La ausencia de documentos no prueba contaminación ni seguridad. Una comparación entre puntos tampoco demuestra por sí sola que la mina causó sus diferencias.

## Comprobaciones antes de publicar la versión completa

- Validar y cotejar cada resultado del conjunto real, incluidos método, unidad, fracción, fecha y referencia documental. Conservar «menor que» y «no detectado» sin convertirlos en cero.
- Ejecutar las pruebas existentes y del piloto, y construir la aplicación. La construcción debe rechazar datos editoriales inválidos.
- Probar acceso y recursos con la ruta de GitHub Pages `/Mineria-san-juan/` y con la raíz de Workers `/`.
- Comprobar que una nueva instantánea de noticias no borra la ficha abierta ni cambia el selector de agua.
- Actualizar la versión de la caché al publicar cambios en recursos o datos. Probar una visita con la caché anterior y otra sin conexión tras la actualización.
- Publicar desde el mismo commit revisado en Pages y Workers y conservar el identificador de despliegue. Verificar `/api/health`, `/api/snapshot` y la versión visible.

La publicación completa queda pendiente de datos verificados y de la revisión de la vista de prueba. No se debe ejecutar una consulta remota de noticias ni una migración de D1 para probar este módulo.
