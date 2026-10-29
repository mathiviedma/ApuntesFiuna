// Archivos en Supabase Storage (bucket privado). El navegador sube directo al bucket con una URL firmada
// (Vercel limita el cuerpo de una función a ~4,5 MB, así que los archivos no pasan por el servidor)
// y se descarga con una URL firmada de corta duración.
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { config } from './config.js';

export const MIMES = {
  'application/pdf': '.pdf',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

let cliente;
function bucket() {
  if (!config.supabaseUrl || !config.supabaseServiceKey)
    throw new Error('Faltan SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY (ver .env.example).');
  cliente ??= createClient(config.supabaseUrl, config.supabaseServiceKey, { auth: { persistSession: false } });
  return cliente.storage.from(config.bucket);
}

export const nuevaRuta = (mime) => `${crypto.randomUUID()}${MIMES[mime]}`;

/** URL firmada para que el navegador suba el archivo directo al bucket (PUT). */
export async function urlDeSubida(ruta) {
  const { data, error } = await bucket().createSignedUploadUrl(ruta);
  if (error) throw error;
  return data.signedUrl;
}

/** Metadatos del objeto ya subido (para no confiar en el tamaño/tipo que declara el cliente). */
export async function infoObjeto(ruta) {
  const { data, error } = await bucket().info(ruta);
  if (error || !data) return null;
  return { tamano: Number(data.size), mime: data.contentType };
}

export async function urlDeDescarga(ruta, { nombre, descargar }) {
  const { data, error } = await bucket().createSignedUrl(ruta, 60, descargar ? { download: nombre } : undefined);
  if (error) throw error;
  return data.signedUrl;
}

export async function borrarObjeto(ruta) {
  if (!ruta) return;
  await bucket().remove([ruta]).catch(() => {});
}

export async function subirBuffer(ruta, buffer, mime) {
  const { error } = await bucket().upload(ruta, buffer, { contentType: mime, upsert: true });
  if (error) throw error;
}

export async function asegurarBucket() {
  const { data } = await cliente_().listBuckets();
  if (data?.some((b) => b.name === config.bucket)) return false;
  const { error } = await cliente_().createBucket(config.bucket, {
    public: false,
    fileSizeLimit: config.maxMbArchivo * 1024 * 1024,
    allowedMimeTypes: Object.keys(MIMES),
  });
  if (error) throw error;
  return true;
}
function cliente_() {
  bucket();
  return cliente.storage;
}
