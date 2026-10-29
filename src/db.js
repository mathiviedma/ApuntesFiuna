import postgres from 'postgres';
import { config } from './config.js';

if (!config.databaseUrl) throw new Error('Falta DATABASE_URL (cadena de conexión de Supabase). Ver .env.example.');

// prepare:false es necesario con el pooler en modo Transaction de Supabase.
// max:1 por instancia: en serverless cada invocación abre pocas conexiones y el pooler reparte.
export const sql = postgres(config.databaseUrl, {
  prepare: false,
  max: Number(process.env.DB_MAX_CONN || 1),
  idle_timeout: 20,
  connect_timeout: 15,
  ssl: /localhost|127\.0\.0\.1/.test(config.databaseUrl) ? false : 'require',
  onnotice: () => {},
});
