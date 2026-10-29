-- Esquema de Apuntes FIUNA para Postgres (Supabase). Es idempotente: se puede correr varias veces.
-- Lo aplica `npm run db:init`, o se puede pegar en el SQL Editor de Supabase.

CREATE TABLE IF NOT EXISTS usuarios (
  id         integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nombre     text NOT NULL,
  email      text NOT NULL UNIQUE,
  pass_hash  text NOT NULL,
  carrera    text NOT NULL CHECK (carrera IN ('civil','electromecanica')),
  whatsapp   text,
  insweb_id  text UNIQUE,
  creado     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS materias (
  id        integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nombre    text NOT NULL UNIQUE,
  sigla     text NOT NULL,
  semestre  integer NOT NULL CHECK (semestre BETWEEN 1 AND 10),
  alias     text NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS materia_carrera (
  materia_id  integer NOT NULL REFERENCES materias(id) ON DELETE CASCADE,
  carrera     text NOT NULL CHECK (carrera IN ('civil','electromecanica')),
  PRIMARY KEY (materia_id, carrera)
);

CREATE TABLE IF NOT EXISTS apuntes (
  id              integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  usuario_id      integer NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  materia_id      integer NOT NULL REFERENCES materias(id),
  tipo            text NOT NULL CHECK (tipo IN ('apunte','examen','resumen','practica')),
  titulo          text NOT NULL,
  descripcion     text NOT NULL DEFAULT '',
  anio            integer,
  periodo         text,
  archivo         text NOT NULL,   -- ruta del objeto en Supabase Storage
  archivo_nombre  text NOT NULL,   -- nombre original
  mime            text NOT NULL,
  tamano          integer NOT NULL,
  busqueda        text NOT NULL,
  creado          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_apuntes_materia ON apuntes(materia_id);
CREATE INDEX IF NOT EXISTS idx_apuntes_usuario ON apuntes(usuario_id);

CREATE TABLE IF NOT EXISTS votos (
  apunte_id   integer NOT NULL REFERENCES apuntes(id) ON DELETE CASCADE,
  usuario_id  integer NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  valor       integer NOT NULL CHECK (valor IN (-1, 1)),
  PRIMARY KEY (apunte_id, usuario_id)
);

CREATE TABLE IF NOT EXISTS postulaciones (
  id            integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  usuario_id    integer NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  materia_id    integer NOT NULL REFERENCES materias(id),
  estado        text NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','verificado','rechazado')),
  nota          integer CHECK (nota IS NULL OR nota IN (4, 5)),
  detalle       text,
  disponible    integer NOT NULL DEFAULT 1 CHECK (disponible IN (0, 1)),
  creado        timestamptz NOT NULL DEFAULT now(),
  verificado_en timestamptz,
  UNIQUE (usuario_id, materia_id)
);

CREATE TABLE IF NOT EXISTS tutorias (
  id          integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tutor_id    integer NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  alumno_id   integer NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  materia_id  integer NOT NULL REFERENCES materias(id),
  estado      text NOT NULL DEFAULT 'activa' CHECK (estado IN ('activa','finalizada','cancelada')),
  creado      timestamptz NOT NULL DEFAULT now(),
  cerrado     timestamptz,
  CHECK (tutor_id <> alumno_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tutoria_activa ON tutorias(tutor_id, alumno_id, materia_id) WHERE estado = 'activa';
CREATE INDEX IF NOT EXISTS idx_tutorias_tutor ON tutorias(tutor_id, estado);

-- Límite de intentos de verificación contra insweb. En serverless no hay memoria compartida
-- entre invocaciones, por eso el contador vive en la base.
CREATE TABLE IF NOT EXISTS intentos_verificacion (
  usuario_id  integer PRIMARY KEY REFERENCES usuarios(id) ON DELETE CASCADE,
  n           integer NOT NULL DEFAULT 0,
  ultimo      timestamptz NOT NULL DEFAULT now(),
  hasta       timestamptz NOT NULL DEFAULT now(),
  en_curso    timestamptz            -- si es futuro, hay una verificación en marcha
);

-- La app habla con la base solo desde el servidor (rol postgres, que ignora RLS).
-- Activar RLS sin políticas evita que la API pública de Supabase (clave anon) exponga estas tablas.
ALTER TABLE usuarios              ENABLE ROW LEVEL SECURITY;
ALTER TABLE materias              ENABLE ROW LEVEL SECURITY;
ALTER TABLE materia_carrera       ENABLE ROW LEVEL SECURITY;
ALTER TABLE apuntes               ENABLE ROW LEVEL SECURITY;
ALTER TABLE votos                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE postulaciones         ENABLE ROW LEVEL SECURITY;
ALTER TABLE tutorias              ENABLE ROW LEVEL SECURITY;
ALTER TABLE intentos_verificacion ENABLE ROW LEVEL SECURITY;
-- Catálogo de materias (Malla 2023, semestres 1 a 4). Idempotente.
INSERT INTO materias (nombre, sigla, semestre, alias) VALUES
  ('Mecánica y Calor', 'MyC', 1, '[]'),
  ('Cálculo 1', 'C1', 1, '[]'),
  ('Geometría Vectorial', 'GV', 1, '["Geo Vect"]'),
  ('Álgebra Moderna', 'AM', 1, '[]'),
  ('Geometría Descriptiva', 'GD', 1, '["Descriptiva"]'),
  ('Dibujo Técnico', 'DT', 1, '[]'),
  ('Óptica y Ondas', 'OyO', 2, '[]'),
  ('Cálculo 2', 'C2', 2, '[]'),
  ('Álgebra Lineal', 'AL', 2, '[]'),
  ('Fundamentos de la Programación', 'FP', 2, '["Fundamentos de Programacion"]'),
  ('Química General', 'QG', 2, '["Quimica"]'),
  ('Electricidad y Magnetismo', 'EyM', 3, '[]'),
  ('Ecuaciones Diferenciales', 'ED', 3, '[]'),
  ('Análisis Vectorial', 'AV', 3, '[]'),
  ('Probabilidad', 'Proba', 3, '[]'),
  ('Estática', 'Est', 3, '[]'),
  ('Ciencia y Tecnología de los Materiales', 'CyTM', 3, '["Ciencia y Tecno"]'),
  ('Materiales de Obras Civiles 1', 'MOC1', 3, '[]'),
  ('Geología Aplicada', 'GA', 3, '["Geologia A"]'),
  ('Dinámica', 'Din', 4, '[]'),
  ('Métodos Numéricos', 'MN', 4, '[]'),
  ('Mecánica de Materiales', 'MM', 4, '[]'),
  ('Estadística', 'Estad', 4, '[]'),
  ('Cálculo Avanzado', 'CA', 4, '["Calculo Av"]'),
  ('Análisis Estructural 1', 'AE1', 4, '[]'),
  ('Introducción a la Hidráulica', 'IH', 4, '["Intro Hidr"]')
ON CONFLICT (nombre) DO UPDATE SET sigla = EXCLUDED.sigla, semestre = EXCLUDED.semestre, alias = EXCLUDED.alias;

INSERT INTO materia_carrera (materia_id, carrera)
SELECT m.id, v.carrera FROM (VALUES
  ('Mecánica y Calor', 'civil'),
  ('Mecánica y Calor', 'electromecanica'),
  ('Cálculo 1', 'civil'),
  ('Cálculo 1', 'electromecanica'),
  ('Geometría Vectorial', 'civil'),
  ('Geometría Vectorial', 'electromecanica'),
  ('Álgebra Moderna', 'civil'),
  ('Álgebra Moderna', 'electromecanica'),
  ('Geometría Descriptiva', 'civil'),
  ('Geometría Descriptiva', 'electromecanica'),
  ('Dibujo Técnico', 'civil'),
  ('Dibujo Técnico', 'electromecanica'),
  ('Óptica y Ondas', 'civil'),
  ('Óptica y Ondas', 'electromecanica'),
  ('Cálculo 2', 'civil'),
  ('Cálculo 2', 'electromecanica'),
  ('Álgebra Lineal', 'civil'),
  ('Álgebra Lineal', 'electromecanica'),
  ('Fundamentos de la Programación', 'civil'),
  ('Fundamentos de la Programación', 'electromecanica'),
  ('Química General', 'civil'),
  ('Química General', 'electromecanica'),
  ('Electricidad y Magnetismo', 'civil'),
  ('Electricidad y Magnetismo', 'electromecanica'),
  ('Ecuaciones Diferenciales', 'civil'),
  ('Ecuaciones Diferenciales', 'electromecanica'),
  ('Análisis Vectorial', 'civil'),
  ('Análisis Vectorial', 'electromecanica'),
  ('Probabilidad', 'civil'),
  ('Probabilidad', 'electromecanica'),
  ('Estática', 'civil'),
  ('Estática', 'electromecanica'),
  ('Ciencia y Tecnología de los Materiales', 'electromecanica'),
  ('Materiales de Obras Civiles 1', 'civil'),
  ('Geología Aplicada', 'civil'),
  ('Dinámica', 'civil'),
  ('Dinámica', 'electromecanica'),
  ('Métodos Numéricos', 'civil'),
  ('Métodos Numéricos', 'electromecanica'),
  ('Mecánica de Materiales', 'civil'),
  ('Mecánica de Materiales', 'electromecanica'),
  ('Estadística', 'civil'),
  ('Estadística', 'electromecanica'),
  ('Cálculo Avanzado', 'electromecanica'),
  ('Análisis Estructural 1', 'civil'),
  ('Introducción a la Hidráulica', 'civil')
) AS v(nombre, carrera) JOIN materias m ON m.nombre = v.nombre
ON CONFLICT DO NOTHING;
-- Bucket privado para los archivos subidos (PDF e imágenes, máx. 20 MB).
-- La app sube/descarga con URLs firmadas generadas por el servidor (service role).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('apuntes', 'apuntes', false, 20971520, ARRAY['application/pdf','image/jpeg','image/png','image/webp'])
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;
