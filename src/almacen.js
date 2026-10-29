// Archivos en Supabase Storage (bucket privado).
//   - La subida va directo del navegador a Storage con una URL firmada: así no pasa por la función
//     de Vercel (que limita el cuerpo de la petición a 4,5 MB).
//   - La descarga redirige a una URL firmada de corta duración.
import { createClient } from '@supabase/supabase-js';
import { config } from './config.js';

export const MIMES = {
  'application/pdf': '.pdf',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};
export const RE_CLAVE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(pdf|jpg|png|webp)$/;

let cliente;
export function supabase() {
  const { url, serviceKey } = config.supabase;
  if (!url || !serviceKey) throw new Error('Faltan SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY (almacenamiento de archivos).');
  return (cliente ??= createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } }));
}
const bucket = () => supabase().storage.from(config.supabase.bucket);

const o = (r) => {
  if (r.error) throw new Error(`Storage: ${r.error.message}`);
  return r.data;
};

/** URL firmada a la que el navegador sube (PUT) el archivo con la clave dada. */
export async function urlSubida(clave) {
  return o(await bucket().createSignedUploadUrl(clave)).signedUrl;
}

/** { size, mime } del objeto ya subido, o null si no existe. */
export async function infoObjeto(clave) {
  const lista = o(await bucket().list('', { search: clave, limit: 10 }));
  const f = lista.find((x) => x.name === clave);
  return f ? { size: Number(f.metadata?.size ?? 0), mime: f.metadata?.mimetype ?? '' } : null;
}

/** URL temporal de lectura. Con `nombreDescarga` fuerza la descarga con ese nombre. */
export async function urlDescarga(clave, nombreDescarga) {
  return o(await bucket().createSignedUrl(clave, 60, nombreDescarga ? { download: nombreDescarga } : undefined)).signedUrl;
}

export async function subir(clave, contenido, mime) {
  o(await bucket().upload(clave, contenido, { contentType: mime, upsert: false }));
}

export async function borrar(clave) {
  try {
    await bucket().remove([clave]);
  } catch (e) {
    console.error('No se pudo borrar el archivo', clave, e.message);
  }
}

/** Crea el bucket privado si no existe (o actualiza sus límites). */
export async function asegurarBucket() {
  const opciones = {
    public: false,
    fileSizeLimit: config.maxMbArchivo * 1024 * 1024,
    allowedMimeTypes: Object.keys(MIMES),
  };
  const { error } = await supabase().storage.createBucket(config.supabase.bucket, opciones);
  if (!error) return 'creado';
  if (!/already exists|duplicate/i.test(error.message)) throw new Error(`Storage: ${error.message}`);
  o(await supabase().storage.updateBucket(config.supabase.bucket, opciones));
  return 'actualizado';
}
