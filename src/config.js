import path from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const config = {
  raiz,
  puerto: Number(process.env.PUERTO || 3000),
  secretoSesion: process.env.SECRETO_SESION || 'cambiar-este-secreto-en-produccion',
  esVercel: Boolean(process.env.VERCEL),
  // Postgres (Supabase). En Vercel usar la cadena del pooler en modo transacción (puerto 6543).
  databaseUrl: process.env.DATABASE_URL || '',
  // Supabase Storage: los archivos se guardan en un bucket privado y se sirven con URLs firmadas.
  supabase: {
    url: (process.env.SUPABASE_URL || '').replace(/\/$/, ''),
    serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
    bucket: process.env.SUPABASE_BUCKET || 'apuntes',
  },
  maxMbArchivo: Number(process.env.MAX_MB_ARCHIVO || 20),
  // Máximo de alumnos con tutoría activa por tutor (sumando todas sus materias).
  cupoTutor: Number(process.env.CUPO_TUTOR || 5),
  // Si se define (p. ej. "fiuna.edu.py"), solo se aceptan registros con ese dominio.
  dominioEmail: (process.env.DOMINIO_EMAIL || '').trim().toLowerCase(),
  // "insweb" (lectura real con Playwright) o "simulado" (sin conexión, datos de data/insweb-simulado.json)
  verificador: (process.env.VERIFICADOR || 'insweb').trim().toLowerCase(),
  insweb: {
    url: (process.env.INSWEB_URL || 'https://insweb.ing.una.py').replace(/\/$/, ''),
    timeoutMs: Number(process.env.INSWEB_TIMEOUT_MS || 30000),
    // Opcional: usar un Chrome/Edge ya instalado en vez de descargar Chromium.
    //   INSWEB_CANAL=chrome | msedge     o     INSWEB_CHROMIUM=/ruta/al/ejecutable
    canal: process.env.INSWEB_CANAL || undefined,
    ejecutable: process.env.INSWEB_CHROMIUM || undefined,
    rutaLogin: process.env.INSWEB_RUTA_LOGIN || '/login',
    rutaNotasFinales: process.env.INSWEB_RUTA_NOTAS_FINALES || '/main/NotasFinales',
    // Endpoint del backend de insweb que devuelve las notas finales en JSON
    // (campos: descrip, codnota, codasign, fechaacta, acta, tipo).
    apiNotasFinales: process.env.INSWEB_API_NOTAS || '/insweb-backend/notas_finales',
    // Textos del menú: solo se usan si la ruta directa no funciona.
    textoMenuNotas: process.env.INSWEB_MENU_NOTAS || 'Notas',
    textoNotasFinales: process.env.INSWEB_MENU_NOTAS_FINALES || 'Notas finales',
  },
};
