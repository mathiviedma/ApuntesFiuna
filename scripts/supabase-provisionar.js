// Crea el proyecto de Supabase (base Postgres + Storage) con un token de acceso personal y deja
// listas las variables de entorno para Vercel.
//
//   SUPABASE_ACCESS_TOKEN=sbp_... npm run supabase:provisionar
//
// Opciones:  --nombre apuntes-fiuna   --region sa-east-1   --org <slug>   --mostrar (imprime los valores)
// Qué hace:
//   1. crea el proyecto (o falla si ya hay uno con ese nombre) y espera a que esté activo
//   2. lee las claves de API y la cadena de conexión del pooler (puerto 6543, apta para serverless)
//   3. escribe .env (para correr en local) y .env.vercel (para pegar en Vercel); ambos están en .gitignore
//   4. ejecuta `npm run migrar -- --semilla`: tablas, catálogo de materias, bucket privado y datos de demo
// El token NO se guarda en ningún archivo.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token) {
  console.error('Falta SUPABASE_ACCESS_TOKEN (token personal "sbp_…" de https://supabase.com/dashboard/account/tokens).');
  process.exit(1);
}
const arg = (n, def) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > 0 ? process.argv[i + 1] : def;
};
const nombre = arg('nombre', 'apuntes-fiuna');
const region = arg('region', 'sa-east-1'); // São Paulo: la más cercana a Paraguay

const API = 'https://api.supabase.com/v1';
async function api(ruta, { method = 'GET', body } = {}) {
  const r = await fetch(API + ruta, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body && JSON.stringify(body),
  });
  const texto = await r.text();
  let datos;
  try { datos = JSON.parse(texto); } catch { datos = texto; }
  if (!r.ok) throw Object.assign(new Error(`${method} ${ruta} → ${r.status}: ${typeof datos === 'string' ? datos : JSON.stringify(datos)}`), { status: r.status });
  return datos;
}
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

// 1) Organización y proyecto
const orgs = await api('/organizations');
const org = arg('org') ? orgs.find((o) => o.slug === arg('org') || o.id === arg('org')) : orgs[0];
if (!org) throw new Error('No se encontró ninguna organización en la cuenta de Supabase.');

const existente = (await api('/projects')).find((p) => p.name === nombre);
if (existente) {
  console.error(`Ya existe un proyecto "${nombre}" (${existente.id}). Como no se puede leer su contraseña de base,`);
  console.error('borrá ese proyecto o usá otro nombre con --nombre.');
  process.exit(1);
}

const dbPass = crypto.randomBytes(18).toString('base64url');
console.log(`Creando proyecto "${nombre}" en ${region} (organización ${org.name ?? org.slug})…`);
let proyecto;
try {
  proyecto = await api('/projects', {
    method: 'POST',
    body: { name: nombre, organization_slug: org.slug ?? org.id, db_pass: dbPass, region_selection: { type: 'specific', code: region } },
  });
} catch (e) {
  if (e.status !== 400 && e.status !== 422) throw e;
  proyecto = await api('/projects', {
    method: 'POST',
    body: { name: nombre, organization_id: org.id ?? org.slug, db_pass: dbPass, region },
  });
}
const ref = proyecto.id ?? proyecto.ref;

for (let i = 0; ; i++) {
  const { status } = await api(`/projects/${ref}`);
  if (status === 'ACTIVE_HEALTHY') break;
  if (i > 60) throw new Error(`El proyecto sigue en estado ${status} tras 10 minutos.`);
  process.stdout.write(`  estado: ${status}\r`);
  await dormir(10_000);
}
console.log('\n✔ Proyecto activo:', ref);

// 2) Claves y conexión
const claves = await api(`/projects/${ref}/api-keys?reveal=true`);
const clave = (n) => claves.find((k) => k.name === n)?.api_key;
const service = clave('service_role');
const anon = clave('anon');
if (!service) throw new Error('No se pudo leer la clave service_role del proyecto.');

let host = `aws-0-${region}.pooler.supabase.com`;
let puerto = 6543;
let usuario = `postgres.${ref}`;
try {
  const pooler = await api(`/projects/${ref}/config/database/pooler`);
  const p = (Array.isArray(pooler) ? pooler : [pooler]).find((x) => x.pool_mode === 'transaction') ?? (Array.isArray(pooler) ? pooler[0] : pooler);
  if (p?.db_host) { host = p.db_host; puerto = 6543; usuario = p.db_user || usuario; }
} catch (e) {
  console.warn('· No se pudo leer la config del pooler, se usa la dirección por defecto:', e.message.slice(0, 120));
}
const databaseUrl = `postgresql://${usuario}:${encodeURIComponent(dbPass)}@${host}:${puerto}/postgres`;

// 3) Variables de entorno
const vars = {
  DATABASE_URL: databaseUrl,
  SUPABASE_URL: `https://${ref}.supabase.co`,
  SUPABASE_SERVICE_ROLE_KEY: service,
  SUPABASE_BUCKET: 'apuntes',
  SECRETO_SESION: crypto.randomBytes(32).toString('hex'),
  VERIFICADOR: 'insweb',
  ...(anon ? { SUPABASE_ANON_KEY: anon } : {}),
};
const texto = Object.entries(vars).map(([k, v]) => `${k}=${v}`).join('\n') + '\n';
fs.writeFileSync(path.join(raiz, '.env.vercel'), texto, { mode: 0o600 });
fs.writeFileSync(path.join(raiz, '.env'), texto, { mode: 0o600 });
console.log('✔ Variables escritas en .env y .env.vercel (no se suben a git). Nombres:');
for (const k of Object.keys(vars)) console.log('   ', k);
if (process.argv.includes('--mostrar')) console.log('\n' + texto);

// 4) Tablas, catálogo, bucket y demo
console.log('\nPreparando la base…');
const r = spawnSync(process.execPath, ['--env-file=.env', 'scripts/migrar.js', '--semilla'], { cwd: raiz, stdio: 'inherit' });
if (r.status !== 0) {
  console.error('\nLa migración falló. Cuando la base esté lista, repetila con: npm run migrar -- --semilla');
  process.exit(r.status ?? 1);
}
console.log('\nListo. Cargá las variables de .env.vercel en Vercel (README, sección "Despliegue en Vercel").');
