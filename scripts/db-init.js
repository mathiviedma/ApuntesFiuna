// Prepara Supabase: aplica el esquema, carga el catálogo de materias y crea el bucket de archivos.
// Es idempotente. Con --demo carga además los datos de ejemplo (si no hay usuarios).
//   npm run db:init            npm run db:init -- --demo
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../src/config.js';
import { sql } from '../src/db.js';
import { asegurarBucket } from '../src/storage.js';

const leer = (f) => fs.readFileSync(path.join(config.raiz, 'supabase', f), 'utf8');
await sql.unsafe(leer('schema.sql'));
await sql.unsafe(leer('materias.sql'));
console.log('Esquema y materias listos.');
console.log((await asegurarBucket()) ? `Bucket "${config.bucket}" creado.` : `Bucket "${config.bucket}" ya existía.`);
if (process.argv.includes('--demo')) {
  const { cargarSemillaSiVacia } = await import('../src/semilla.js');
  console.log((await cargarSemillaSiVacia()) ? 'Datos de demo cargados (contraseña: demo1234).' : 'Ya hay usuarios: no se cargó la demo.');
}
await sql.end();
