// Borra TODOS los datos (usuarios, apuntes, tutorías) y los archivos del bucket de la base configurada
// en DATABASE_URL. Para evitar accidentes en producción exige --si-estoy-seguro.
//   npm run reset -- --si-estoy-seguro
import { config } from '../src/config.js';
import { db, cerrarDb } from '../src/db.js';
import { supabase } from '../src/almacen.js';

if (!process.argv.includes('--si-estoy-seguro')) {
  console.error('Esto borra todos los datos de la base y del bucket. Repetí con: npm run reset -- --si-estoy-seguro');
  process.exit(1);
}

await db.exec('TRUNCATE usuarios, apuntes, votos, postulaciones, tutorias, intentos_verificacion RESTART IDENTITY CASCADE');
const bucket = supabase().storage.from(config.supabase.bucket);
for (;;) {
  const { data = [] } = await bucket.list('', { limit: 100 });
  if (!data.length) break;
  await bucket.remove(data.map((f) => f.name));
}
await cerrarDb();
console.log('Base y archivos borrados. Ejecutá "npm run migrar -- --semilla" para volver a cargar los datos de demo.');
