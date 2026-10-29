import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from './config.js';
import { MATERIAS } from './materias.js';

fs.mkdirSync(path.dirname(config.rutaDb), { recursive: true });
fs.mkdirSync(config.carpetaArchivos, { recursive: true });

export const db = new DatabaseSync(config.rutaDb);
db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');

db.exec(`
CREATE TABLE IF NOT EXISTS usuarios (
  id            INTEGER PRIMARY KEY,
  nombre        TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  pass_hash     TEXT NOT NULL,
  carrera       TEXT NOT NULL CHECK (carrera IN ('civil','electromecanica')),
  whatsapp      TEXT,                 -- opcional, lo carga el tutor si quiere
  insweb_id     TEXT UNIQUE,          -- hash del usuario de insweb usado para verificar (anti-duplicados)
  creado        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS materias (
  id        INTEGER PRIMARY KEY,
  nombre    TEXT NOT NULL UNIQUE,
  sigla     TEXT NOT NULL,
  semestre  INTEGER NOT NULL CHECK (semestre BETWEEN 1 AND 10),
  alias     TEXT NOT NULL DEFAULT '[]'  -- JSON
);

CREATE TABLE IF NOT EXISTS materia_carrera (
  materia_id  INTEGER NOT NULL REFERENCES materias(id) ON DELETE CASCADE,
  carrera     TEXT NOT NULL CHECK (carrera IN ('civil','electromecanica')),
  PRIMARY KEY (materia_id, carrera)
);

CREATE TABLE IF NOT EXISTS apuntes (
  id              INTEGER PRIMARY KEY,
  usuario_id      INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  materia_id      INTEGER NOT NULL REFERENCES materias(id),
  tipo            TEXT NOT NULL CHECK (tipo IN ('apunte','examen','resumen','practica')),
  titulo          TEXT NOT NULL,
  descripcion     TEXT NOT NULL DEFAULT '',
  anio            INTEGER,
  periodo         TEXT,               -- '1er parcial', '2do parcial', 'final', 'recuperatorio'...
  archivo         TEXT NOT NULL,      -- nombre en disco
  archivo_nombre  TEXT NOT NULL,      -- nombre original
  mime            TEXT NOT NULL,
  tamano          INTEGER NOT NULL,
  busqueda        TEXT NOT NULL,      -- texto normalizado (sin tildes) para el buscador
  creado          TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_apuntes_materia ON apuntes(materia_id);

CREATE TABLE IF NOT EXISTS votos (
  apunte_id   INTEGER NOT NULL REFERENCES apuntes(id) ON DELETE CASCADE,
  usuario_id  INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  valor       INTEGER NOT NULL CHECK (valor IN (-1, 1)),
  PRIMARY KEY (apunte_id, usuario_id)
);

-- Inscripción voluntaria como tutor. Un tutor visible = estado 'verificado' y disponible = 1.
CREATE TABLE IF NOT EXISTS postulaciones (
  id            INTEGER PRIMARY KEY,
  usuario_id    INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  materia_id    INTEGER NOT NULL REFERENCES materias(id),
  estado        TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','verificado','rechazado')),
  nota          INTEGER CHECK (nota IS NULL OR nota IN (4, 5)),
  detalle       TEXT,
  disponible    INTEGER NOT NULL DEFAULT 1 CHECK (disponible IN (0, 1)),
  creado        TEXT NOT NULL DEFAULT (datetime('now')),
  verificado_en TEXT,
  UNIQUE (usuario_id, materia_id)
);
`);

// Tutorías en curso: cada fila activa ocupa un cupo del tutor.
db.exec(`
CREATE TABLE IF NOT EXISTS tutorias (
  id          INTEGER PRIMARY KEY,
  tutor_id    INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  alumno_id   INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  materia_id  INTEGER NOT NULL REFERENCES materias(id),
  estado      TEXT NOT NULL DEFAULT 'activa' CHECK (estado IN ('activa','finalizada','cancelada')),
  creado      TEXT NOT NULL DEFAULT (datetime('now')),
  cerrado     TEXT,
  CHECK (tutor_id <> alumno_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tutoria_activa ON tutorias(tutor_id, alumno_id, materia_id) WHERE estado = 'activa';
CREATE INDEX IF NOT EXISTS idx_tutorias_tutor ON tutorias(tutor_id, estado);
`);

// Los votos ahora son solo "me gusta" (corazón): se descartan los negativos de versiones anteriores.
db.exec('DELETE FROM votos WHERE valor <> 1');

// Catálogo de materias (idempotente)
const insMateria = db.prepare(`
  INSERT INTO materias (nombre, sigla, semestre, alias) VALUES (?, ?, ?, ?)
  ON CONFLICT(nombre) DO UPDATE SET sigla = excluded.sigla, semestre = excluded.semestre, alias = excluded.alias
  RETURNING id`);
const insCarrera = db.prepare('INSERT OR IGNORE INTO materia_carrera (materia_id, carrera) VALUES (?, ?)');
for (const m of MATERIAS) {
  const { id } = insMateria.get(m.nombre, m.sigla, m.semestre, JSON.stringify(m.alias));
  for (const c of m.carreras) insCarrera.run(id, c);
}

export function transaccion(fn) {
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
