// Prepara Supabase: crea las tablas, sincroniza el catálogo de materias y crea el bucket de archivos.
// Es idempotente: se puede ejecutar cuantas veces haga falta (p. ej. tras cambiar src/materias.js).
//   npm run migrar            (usa DATABASE_URL, SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY del .env)
//   npm run migrar -- --semilla   además carga los datos de demo si la base está vacía
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../src/config.js';
import { db, cerrarDb } from '../src/db.js';
import { MATERIAS } from '../src/materias.js';
import { asegurarBucket } from '../src/almacen.js';

const esquema = fs.readFileSync(path.join(config.raiz, 'db', 'esquema.sql'), 'utf8');

// Un proyecto recién creado puede tardar un minuto en aceptar conexiones.
for (let intento = 1; ; intento++) {
  try {
    await db.exec(esquema);
    break;
  } catch (e) {
    if (intento >= 12) throw e;
    console.log(`Esperando a la base (${e.code || e.message.split('\n')[0]})… intento ${intento}/12`);
    await new Promise((r) => setTimeout(r, 10_000));
  }
}
console.log('✔ Tablas listas');

for (const m of MATERIAS) {
  const { id } = await db.get(
    `INSERT INTO materias (nombre, sigla, semestre, alias) VALUES (?, ?, ?, ?)
     ON CONFLICT(nombre) DO UPDATE SET sigla = excluded.sigla, semestre = excluded.semestre, alias = excluded.alias
     RETURNING id`,
    m.nombre, m.sigla, m.semestre, JSON.stringify(m.alias),
  );
  for (const c of m.carreras)
    await db.run('INSERT INTO materia_carrera (materia_id, carrera) VALUES (?, ?) ON CONFLICT DO NOTHING', id, c);
}
console.log(`✔ Catálogo: ${MATERIAS.length} materias`);

console.log(`✔ Bucket "${config.supabase.bucket}" ${await asegurarBucket()}`);

if (process.argv.includes('--semilla')) {
  const { cargarSemillaSiVacia } = await import('../src/semilla.js');
  console.log((await cargarSemillaSiVacia()) ? '✔ Datos de demo cargados (contraseña: demo1234)' : '· La base ya tenía usuarios: no se cargó la demo');
}

await cerrarDb();
