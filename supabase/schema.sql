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
