# Minería San Juan — Estado de Proyectos

Aplicación web educativa (PWA) sobre el estado de los proyectos mineros de la
provincia de San Juan, Argentina. Desarrollada como proyecto escolar para el
concurso de mineralogía y química de minerales 2026.

## ¿Qué ofrece?

- **14 proyectos mineros** con su estado actual (producción, reactivación,
  evaluación avanzada, exploración o suspendido), operador, minerales y
  descripción verificada con fuentes públicas.
- **Mapa interactivo** (Leaflet + OpenStreetMap) con marcadores por estado,
  popups y botón de geolocalización.
- **Química de minerales**: fórmula, sistema cristalino, dureza de Mohs y un
  dato explicativo de cada mineral asociado a los yacimientos.
- **Fuentes verificables** en cada ficha de proyecto (organismos oficiales,
  sitios de las empresas y prensa especializada).
- **Noticias** editoriales con enlace a la fuente original.
- **Instalable como app** (PWA): funciona sin conexión, salvo las teselas del
  mapa que requieren internet.

## Tecnologías

HTML5 + Tailwind CSS (CDN) + Leaflet.js + JavaScript puro, en un único
`index.html`. Sin frameworks, sin backend y sin servicios de pago.
Se publica con GitHub Pages.

## Estructura

| Archivo | Descripción |
|---|---|
| `index.html` | Toda la aplicación (vistas, datos, estilos y lógica) |
| `sw.js` | Service worker: caché y funcionamiento offline |
| `manifest.webmanifest` | Manifiesto de instalación de la PWA |
| `icons/` | Íconos de la aplicación |

## Datos y fuentes

La información proviene del Ministerio de Minería de San Juan, del IPEEM,
de los sitios oficiales de las empresas operadoras y de prensa especializada
(2024-2026). Cada proyecto muestra sus fuentes dentro de la aplicación.

*Proyecto educativo sin fines comerciales.*
