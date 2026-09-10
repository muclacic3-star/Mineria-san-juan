import { readFile, writeFile, mkdir, cp } from 'node:fs/promises';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import '../agua-impactos.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pilot = JSON.parse(await readFile(path.join(root, 'data/veladero.json'), 'utf8'));
globalThis.AguaImpactos.validateData(pilot);
const html = await readFile(path.join(root, 'index.html'), 'utf8');
const literal = html.match(/const PROYECTOS = (\[[\s\S]*?\n    \]);/);
if (!literal) throw new Error('No se encontró el catálogo de proyectos.');
const projects = vm.runInNewContext('(' + literal[1] + ')', Object.create(null), { timeout: 1000 });
if (projects.length !== 14 || new Set(projects.map(p => p.id)).size !== projects.length) {
  throw new Error('El catálogo debe conservar sus 14 identificadores únicos.');
}
const aliases = {
  6: ['Josemaria'], 8: ['Pachón', 'Pachon'],
  10: ['Rio Cenicero'], 13: ['Santa Barbara'], 14: ['Pascua-Lama', 'Pascua Lama']
};
await mkdir(path.join(root, 'src'), { recursive: true });
await writeFile(path.join(root, 'src/projects-seed.json'), JSON.stringify(projects.map(p => ({
  id: p.id, nombre: p.nombre, estado: p.estado, aliases: aliases[p.id] || [],
  ...(p.baselineReason ? { baselineReason: p.baselineReason, baselineEvidence: p.baselineEvidence } : {}),
  baselineReferenceAt: '2026-07-31T23:59:59.000Z'
})), null, 2) + '\n');
await mkdir(path.join(root, 'public'), { recursive: true });
for (const file of ['index.html', 'actualizaciones.js', 'agua-impactos.js', 'agua-impactos.css', 'data', 'sw.js', 'manifest.webmanifest', 'icons']) {
  await cp(path.join(root, file), path.join(root, 'public', file), { recursive: true });
}
console.log('Aplicación 1.4 preparada: 14 proyectos, noticias y piloto documental de Veladero.');
