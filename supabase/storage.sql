-- Bucket privado para los archivos subidos (PDF e imágenes, máx. 20 MB).
-- La app sube/descarga con URLs firmadas generadas por el servidor (service role).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('apuntes', 'apuntes', false, 20971520, ARRAY['application/pdf','image/jpeg','image/png','image/webp'])
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;
