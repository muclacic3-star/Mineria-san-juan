# Contorno provincial del mapa de respaldo

El archivo `mapa-san-juan.js` contiene únicamente la geometría GeoJSON de San Juan, Argentina, con coordenadas en orden **longitud, latitud**. Se distribuye junto con la aplicación para que el contorno provincial no dependa de la descarga del fondo de mapas.

## Fuente y permiso de reutilización

- Fuente original: [Natural Earth, Admin 1 - States, Provinces, escala 1:10 millones](https://www.naturalearthdata.com/downloads/10m-cultural-vectors/10m-admin-1-states-provinces/).
- Edición del repositorio utilizada: `v5.1.2`, commit `f1890d9f152c896d250a77557a5751a93d494776`.
- [GeoJSON original fijado a ese commit](https://raw.githubusercontent.com/nvkelso/natural-earth-vector/f1890d9f152c896d250a77557a5751a93d494776/geojson/ne_10m_admin_1_states_provinces.geojson).
- [Condiciones oficiales de Natural Earth](https://www.naturalearthdata.com/about/terms-of-use/): datos de dominio público; permiten modificaciones y redistribución.
- Consulta y extracción: 12 de noviembre de 2026.
- SHA-256 del GeoJSON original: `22d0e3ad85eb3e27f17cabf8ba2d50e554fbc27a87796ff891d958185da62fb5`.

## Transformación y comprobaciones

Se seleccionó el único elemento con `iso_3166_2 = AR-J`, `admin = Argentina` y `name = San Juan`. La geometría es un `Polygon` de un anillo exterior cerrado, sin anillos interiores.

El contorno original de 568 posiciones se simplificó mediante Douglas-Peucker con tolerancia de **0,01 grados**, conservando los extremos, y se redondeó a cinco decimales. El resultado tiene 155 posiciones, incluida la repetición que cierra el anillo. La diferencia de área plana respecto al original es aproximadamente 0,0181 %, utilizada solo como control de la simplificación, no como medición territorial.

Extensión `[oeste, sur, este, norte]`: `[-70.58977, -32.33658, -66.73052, -28.40099]`. Se comprobaron coordenadas finitas, cierre del anillo, ausencia de cruces entre segmentos no adyacentes y coherencia de la extensión con San Juan.

Este contorno es **referencial** y está generalizado para una vista provincial. No define límites catastrales ni sustituye cartografía oficial. No incorpora imágenes de mapas, capturas ni teselas descargadas para uso sin conexión.
