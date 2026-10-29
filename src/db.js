import pg from 'pg';
import { config } from './config.js';

// COUNT(*) llega como bigint (texto); la app espera números.
pg.types.setTypeParser(20, Number);

let pool;
function obtenerPool() {
  if (pool) return pool;
  if (!config.databaseUrl) throw new Error('Falta DATABASE_URL (cadena de conexión de Supabase). Ver README.');
  const local = /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(config.databaseUrl);
  pool = new pg.Pool({
    connectionString: config.databaseUrl,
    ssl: local || process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false },
    // En Vercel cada instancia usa pocas conexiones; el pooler de Supabase reparte el resto.
    max: config.esVercel ? 3 : 10,
    idleTimeoutMillis: 10_000,
  });
  pool.on('error', (e) => console.error('Error en conexión inactiva de Postgres:', e.message));
  return pool;
}

// Las consultas se escriben con "?" y se convierten a $1, $2… (los "?" nunca van dentro de textos literales).
const aPostgres = (sql) => {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
};

const ejecutor = (obtener) => ({
  all: async (sql, ...params) => (await obtener().query(aPostgres(sql), params)).rows,
  get: async (sql, ...params) => (await obtener().query(aPostgres(sql), params)).rows[0],
  /** Devuelve la cantidad de filas afectadas. */
  run: async (sql, ...params) => (await obtener().query(aPostgres(sql), params)).rowCount,
  /** Para scripts SQL con varias sentencias y sin parámetros. */
  exec: async (sql) => void (await obtener().query(sql)),
});

export const db = ejecutor(obtenerPool);

/** Ejecuta fn(tx) dentro de una transacción; tx tiene la misma interfaz que db. */
export async function transaccion(fn) {
  const cliente = await obtenerPool().connect();
  try {
    await cliente.query('BEGIN');
    const r = await fn(ejecutor(() => cliente));
    await cliente.query('COMMIT');
    return r;
  } catch (e) {
    await cliente.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    cliente.release();
  }
}

export async function cerrarDb() {
  await pool?.end();
  pool = undefined;
}
