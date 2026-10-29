import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import express from 'express';
import session from 'express-session';
import multer from 'multer';
import { config } from './src/config.js';
import { db, transaccion } from './src/db.js';
import { CARRERAS } from './src/materias.js';
import { hashPassword, verificarPassword, requiereLogin } from './src/auth.js';
import { palabras } from './src/normalizar.js';
import { textoBusqueda } from './src/busqueda.js';
import { cargarSemillaSiVacia } from './src/semilla.js';
import { obtenerNotasFinales, evaluarMateria, idInsweb, ErrorVerificacion } from './src/verificador/index.js';

if (cargarSemillaSiVacia()) console.log('Base vacía: se cargaron los datos de demo (contraseña: demo1234).');

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '100kb' }));
app.use(
  session({
    secret: config.secretoSesion,
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax', maxAge: 1000 * 60 * 60 * 24 * 7 },
  }),
);
app.use(express.static(path.join(config.raiz, 'public')));

const TIPOS = ['apunte', 'examen', 'resumen', 'practica'];
const PERIODOS = ['1er parcial', '2do parcial', 'final', 'recuperatorio', 'otro'];
const MIMES = {
  'application/pdf': '.pdf',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

const subida = multer({
  storage: multer.diskStorage({
    destination: config.carpetaArchivos,
    filename: (_req, file, cb) => cb(null, crypto.randomUUID() + MIMES[file.mimetype]),
  }),
  limits: { fileSize: config.maxMbArchivo * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) =>
    MIMES[file.mimetype] ? cb(null, true) : cb(new Error('Solo se aceptan PDF o imágenes (JPG, PNG, WEBP).')),
});

const usuarioActual = (req) =>
  req.session.usuarioId
    ? db.prepare('SELECT id, nombre, email, carrera, whatsapp FROM usuarios WHERE id = ?').get(req.session.usuarioId)
    : null;

const limpiarWhatsapp = (w) => {
  if (w == null || String(w).trim() === '') return null;
  let d = String(w).replace(/\D/g, '');
  if (d.startsWith('0')) d = '595' + d.slice(1); // 0981... -> 595981...
  if (!/^\d{10,15}$/.test(d)) throw new Error('El número de WhatsApp no parece válido. Ejemplo: 0981 123 456.');
  return d;
};

// ───────────────────────── Sesión ─────────────────────────

app.post('/api/registro', (req, res) => {
  const { nombre, email, password, carrera } = req.body ?? {};
  const mail = String(email ?? '').trim().toLowerCase();
  if (!nombre?.trim() || !mail || !password || !carrera) return res.status(400).json({ error: 'Completá todos los campos.' });
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mail)) return res.status(400).json({ error: 'Email inválido.' });
  if (config.dominioEmail && !mail.endsWith('@' + config.dominioEmail))
    return res.status(400).json({ error: `Usá tu correo institucional (@${config.dominioEmail}).` });
  if (String(password).length < 8) return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres.' });
  if (!CARRERAS[carrera]) return res.status(400).json({ error: 'Carrera inválida.' });
  try {
    const { id } = db
      .prepare('INSERT INTO usuarios (nombre, email, pass_hash, carrera) VALUES (?, ?, ?, ?) RETURNING id')
      .get(nombre.trim(), mail, hashPassword(String(password)), carrera);
    req.session.usuarioId = id;
    res.status(201).json(usuarioActual(req));
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return res.status(409).json({ error: 'Ya existe una cuenta con ese email.' });
    throw e;
  }
});

app.post('/api/login', (req, res) => {
  const mail = String(req.body?.email ?? '').trim().toLowerCase();
  const u = db.prepare('SELECT id, pass_hash FROM usuarios WHERE email = ?').get(mail);
  if (!u || !verificarPassword(String(req.body?.password ?? ''), u.pass_hash))
    return res.status(401).json({ error: 'Email o contraseña incorrectos.' });
  req.session.regenerate(() => {
    req.session.usuarioId = u.id;
    res.json(usuarioActual(req));
  });
});

app.post('/api/logout', (req, res) => req.session.destroy(() => res.json({ ok: true })));

app.get('/api/yo', (req, res) => res.json(usuarioActual(req)));

app.patch('/api/yo', requiereLogin, (req, res) => {
  try {
    const w = limpiarWhatsapp(req.body?.whatsapp);
    db.prepare('UPDATE usuarios SET whatsapp = ? WHERE id = ?').run(w, req.session.usuarioId);
    res.json(usuarioActual(req));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ───────────────────────── Catálogo ─────────────────────────

app.get('/api/materias', (req, res) => {
  const { carrera } = req.query;
  const filas = db
    .prepare(
      `SELECT m.id, m.nombre, m.sigla, m.semestre, group_concat(mc.carrera) AS carreras,
              (SELECT COUNT(*) FROM apuntes a WHERE a.materia_id = m.id) AS apuntes,
              (SELECT COUNT(*) FROM postulaciones p WHERE p.materia_id = m.id AND p.estado = 'verificado' AND p.disponible = 1) AS tutores
       FROM materias m JOIN materia_carrera mc ON mc.materia_id = m.id
       GROUP BY m.id
       HAVING ? IS NULL OR instr(group_concat(mc.carrera), ?) > 0
       ORDER BY m.semestre`,
    )
    .all(carrera ?? null, carrera ?? null);
  const orden = (a, b) => a.semestre - b.semestre || a.nombre.localeCompare(b.nombre, 'es');
  res.json(filas.map((f) => ({ ...f, carreras: f.carreras.split(',') })).sort(orden));
});

app.get('/api/meta', (_req, res) =>
  res.json({
    carreras: CARRERAS, tipos: TIPOS, periodos: PERIODOS, verificador: config.verificador,
    maxMb: config.maxMbArchivo, cupoTutor: config.cupoTutor,
  }),
);

// ───────────────────────── Apuntes ─────────────────────────

app.get('/api/apuntes', (req, res) => {
  const { q, materia, tipo, anio, carrera, semestre, orden, mios } = req.query;
  const cond = [];
  const params = [];
  // Cada palabra debe aparecer como inicio de una palabra del texto ("calc" encuentra "calculo").
  // Los números cortos deben coincidir completos: "2" encuentra "Cálculo 2" pero no "2025".
  for (const p of palabras(q ?? '')) {
    const exacta = /^\d{1,2}$/.test(p);
    cond.push(`(' ' || a.busqueda || ' ') LIKE ? ESCAPE '\\'`);
    params.push(`% ${p.replace(/[%_\\]/g, '\\$&')}${exacta ? ' ' : ''}%`);
  }
  if (materia) { cond.push('a.materia_id = ?'); params.push(Number(materia)); }
  if (tipo && TIPOS.includes(tipo)) { cond.push('a.tipo = ?'); params.push(tipo); }
  if (anio) { cond.push('a.anio = ?'); params.push(Number(anio)); }
  if (semestre) { cond.push('m.semestre = ?'); params.push(Number(semestre)); }
  if (carrera) { cond.push('EXISTS (SELECT 1 FROM materia_carrera mc WHERE mc.materia_id = m.id AND mc.carrera = ?)'); params.push(carrera); }

  const uid = req.session.usuarioId ?? -1;
  if (mios) { cond.push('a.usuario_id = ?'); params.push(uid); }
  // Por defecto, los más gustados primero.
  const ordenSql = orden === 'recientes' ? 'a.creado DESC' : 'likes DESC, a.creado DESC';
  const filas = db
    .prepare(
      `SELECT a.id, a.tipo, a.titulo, a.descripcion, a.anio, a.periodo, a.archivo_nombre, a.mime, a.tamano, a.creado,
              m.id AS materia_id, m.nombre AS materia, m.sigla, m.semestre,
              u.nombre AS autor, (a.usuario_id = ?) AS es_mio,
              (SELECT COUNT(*) FROM votos v WHERE v.apunte_id = a.id AND v.valor = 1) AS likes,
              EXISTS (SELECT 1 FROM votos v WHERE v.apunte_id = a.id AND v.usuario_id = ? AND v.valor = 1) AS me_gusta
       FROM apuntes a
       JOIN materias m ON m.id = a.materia_id
       JOIN usuarios u ON u.id = a.usuario_id
       ${cond.length ? 'WHERE ' + cond.join(' AND ') : ''}
       ORDER BY ${ordenSql}
       LIMIT 100`,
    )
    .all(uid, uid, ...params);
  res.json(filas.map((f) => ({ ...f, es_mio: Boolean(f.es_mio), me_gusta: Boolean(f.me_gusta) })));
});

// Valida los campos de un apunte (alta o edición). Devuelve { error } o { datos }.
function validarApunte(body, { archivo, archivoRequerido }) {
  const { materia_id, tipo, titulo, descripcion = '', anio, periodo } = body ?? {};
  const materia = db.prepare('SELECT id FROM materias WHERE id = ?').get(Number(materia_id));
  const error =
    (archivoRequerido && !archivo && 'Adjuntá un archivo.') ||
    (!materia && 'Elegí la materia.') ||
    (!TIPOS.includes(tipo) && 'Elegí el tipo de material.') ||
    (!String(titulo ?? '').trim() && 'Poné un título.') ||
    (anio && !(Number(anio) >= 1990 && Number(anio) <= new Date().getFullYear()) && 'Año inválido.') ||
    (periodo && !PERIODOS.includes(periodo) && 'Período inválido.');
  if (error) return { error };
  return {
    datos: {
      titulo: String(titulo).trim().slice(0, 150),
      descripcion: String(descripcion).trim().slice(0, 1000),
      materiaId: materia.id,
      tipo,
      periodo: tipo === 'examen' ? periodo || null : null,
      anio: anio ? Number(anio) : null,
    },
  };
}

const nombreOriginal = (file) => Buffer.from(file.originalname, 'latin1').toString('utf8').slice(0, 200);
const borrarArchivo = (nombre) => fs.rm(path.join(config.carpetaArchivos, path.basename(nombre)), { force: true }, () => {});

function conSubida(req, res, siguiente) {
  subida.single('archivo')(req, res, (err) => {
    if (err) {
      const msg = err.code === 'LIMIT_FILE_SIZE' ? `El archivo supera ${config.maxMbArchivo} MB.` : err.message;
      return res.status(400).json({ error: msg });
    }
    siguiente();
  });
}

app.post('/api/apuntes', requiereLogin, (req, res) => {
  conSubida(req, res, () => {
    const { error, datos } = validarApunte(req.body, { archivo: req.file, archivoRequerido: true });
    if (error) {
      if (req.file) borrarArchivo(req.file.filename);
      return res.status(400).json({ error });
    }
    const { id } = db
      .prepare(
        `INSERT INTO apuntes (usuario_id, materia_id, tipo, titulo, descripcion, anio, periodo, archivo, archivo_nombre, mime, tamano, busqueda)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      )
      .get(
        req.session.usuarioId, datos.materiaId, datos.tipo, datos.titulo, datos.descripcion, datos.anio, datos.periodo,
        req.file.filename, nombreOriginal(req.file), req.file.mimetype, req.file.size, textoBusqueda(datos),
      );
    res.status(201).json({ id });
  });
});

// Datos de un apunte propio, para el formulario de edición.
app.get('/api/apuntes/:id', requiereLogin, (req, res) => {
  const a = db
    .prepare(
      `SELECT id, materia_id, tipo, titulo, descripcion, anio, periodo, archivo_nombre, tamano
       FROM apuntes WHERE id = ? AND usuario_id = ?`,
    )
    .get(Number(req.params.id), req.session.usuarioId);
  if (!a) return res.status(404).json({ error: 'No existe ese apunte o no es tuyo.' });
  res.json(a);
});

// Editar un apunte propio. El archivo es opcional: si se manda uno nuevo, reemplaza al anterior.
app.put('/api/apuntes/:id', requiereLogin, (req, res) => {
  conSubida(req, res, () => {
    const id = Number(req.params.id);
    const actual = db.prepare('SELECT archivo FROM apuntes WHERE id = ? AND usuario_id = ?').get(id, req.session.usuarioId);
    if (!actual) {
      if (req.file) borrarArchivo(req.file.filename);
      return res.status(404).json({ error: 'No existe ese apunte o no es tuyo.' });
    }
    const { error, datos } = validarApunte(req.body, { archivo: req.file, archivoRequerido: false });
    if (error) {
      if (req.file) borrarArchivo(req.file.filename);
      return res.status(400).json({ error });
    }
    db.prepare(
      `UPDATE apuntes SET materia_id = ?, tipo = ?, titulo = ?, descripcion = ?, anio = ?, periodo = ?, busqueda = ? WHERE id = ?`,
    ).run(datos.materiaId, datos.tipo, datos.titulo, datos.descripcion, datos.anio, datos.periodo, textoBusqueda(datos), id);
    if (req.file) {
      db.prepare('UPDATE apuntes SET archivo = ?, archivo_nombre = ?, mime = ?, tamano = ? WHERE id = ?').run(
        req.file.filename, nombreOriginal(req.file), req.file.mimetype, req.file.size, id,
      );
      borrarArchivo(actual.archivo);
    }
    res.json({ id });
  });
});

app.delete('/api/apuntes/:id', requiereLogin, (req, res) => {
  const id = Number(req.params.id);
  const a = db.prepare('SELECT archivo FROM apuntes WHERE id = ? AND usuario_id = ?').get(id, req.session.usuarioId);
  if (!a) return res.status(404).json({ error: 'No existe ese apunte o no es tuyo.' });
  db.prepare('DELETE FROM apuntes WHERE id = ?').run(id); // los votos se borran en cascada
  borrarArchivo(a.archivo);
  res.json({ ok: true });
});

app.get('/api/apuntes/:id/archivo', (req, res) => {
  const a = db.prepare('SELECT archivo, archivo_nombre, mime FROM apuntes WHERE id = ?').get(Number(req.params.id));
  if (!a) return res.status(404).json({ error: 'No existe ese apunte.' });
  const disp = req.query.descargar ? 'attachment' : 'inline';
  res.setHeader('Content-Type', a.mime);
  res.setHeader('Content-Disposition', `${disp}; filename*=UTF-8''${encodeURIComponent(a.archivo_nombre)}`);
  res.sendFile(path.join(config.carpetaArchivos, path.basename(a.archivo)));
});

// "Me gusta" (corazón). { me_gusta: true } lo marca, { me_gusta: false } lo quita.
app.post('/api/apuntes/:id/like', requiereLogin, (req, res) => {
  const id = Number(req.params.id);
  if (!db.prepare('SELECT 1 FROM apuntes WHERE id = ?').get(id)) return res.status(404).json({ error: 'No existe ese apunte.' });
  if (req.body?.me_gusta)
    db.prepare(
      `INSERT INTO votos (apunte_id, usuario_id, valor) VALUES (?, ?, 1) ON CONFLICT(apunte_id, usuario_id) DO NOTHING`,
    ).run(id, req.session.usuarioId);
  else db.prepare('DELETE FROM votos WHERE apunte_id = ? AND usuario_id = ?').run(id, req.session.usuarioId);
  const { likes } = db.prepare('SELECT COUNT(*) AS likes FROM votos WHERE apunte_id = ? AND valor = 1').get(id);
  res.json({ likes, me_gusta: Boolean(req.body?.me_gusta) });
});

// ───────────────────────── Tutorías ─────────────────────────

const CUPOS_OCUPADOS = `(SELECT COUNT(*) FROM tutorias t WHERE t.tutor_id = u.id AND t.estado = 'activa')`;

app.get('/api/tutores', (req, res) => {
  const materia = Number(req.query.materia);
  if (!materia) return res.status(400).json({ error: 'Elegí una materia.' });
  const uid = req.session.usuarioId ?? -1;
  const filas = db
    .prepare(
      `SELECT u.id, u.nombre, u.carrera, u.email, u.whatsapp, p.nota, p.verificado_en,
              (SELECT COUNT(*) FROM apuntes a WHERE a.usuario_id = u.id AND a.materia_id = p.materia_id) AS apuntes_materia,
              ${CUPOS_OCUPADOS} AS ocupados,
              (SELECT t.id FROM tutorias t WHERE t.tutor_id = u.id AND t.alumno_id = ? AND t.materia_id = p.materia_id
                 AND t.estado = 'activa') AS mi_tutoria
       FROM postulaciones p JOIN usuarios u ON u.id = p.usuario_id
       WHERE p.materia_id = ? AND p.estado = 'verificado' AND p.disponible = 1
       ORDER BY (${CUPOS_OCUPADOS} >= ?) , p.nota DESC, p.verificado_en`,
    )
    .all(uid, materia, config.cupoTutor);
  // El contacto se muestra solo a quien ya tomó un cupo con ese tutor (así el límite de alumnos se respeta).
  res.json({
    logueado: uid > 0,
    cupo_max: config.cupoTutor,
    tutores: filas.map((t) => {
      const conAcceso = Boolean(t.mi_tutoria);
      return {
        id: t.id,
        nombre: t.nombre,
        carrera: t.carrera,
        nota: t.nota,
        apuntes_materia: t.apuntes_materia,
        cupos_libres: Math.max(0, config.cupoTutor - t.ocupados),
        mi_tutoria: t.mi_tutoria,
        es_yo: t.id === uid,
        email: conAcceso ? t.email : null,
        whatsapp: conAcceso ? t.whatsapp : null,
      };
    }),
  });
});

// Tomar un cupo con un tutor para una materia.
app.post('/api/tutorias', requiereLogin, (req, res) => {
  const alumno = req.session.usuarioId;
  const tutor = Number(req.body?.tutor_id);
  const materia = Number(req.body?.materia_id);
  if (tutor === alumno) return res.status(400).json({ error: 'No podés pedirte una tutoría a vos mismo.' });
  const ofrece = db
    .prepare(`SELECT 1 FROM postulaciones WHERE usuario_id = ? AND materia_id = ? AND estado = 'verificado' AND disponible = 1`)
    .get(tutor, materia);
  if (!ofrece) return res.status(404).json({ error: 'Ese tutor no está disponible para esta materia.' });
  try {
    const id = transaccion(() => {
      const ya = db
        .prepare(`SELECT id FROM tutorias WHERE tutor_id = ? AND alumno_id = ? AND materia_id = ? AND estado = 'activa'`)
        .get(tutor, alumno, materia);
      if (ya) return ya.id;
      const { n } = db.prepare(`SELECT COUNT(*) AS n FROM tutorias WHERE tutor_id = ? AND estado = 'activa'`).get(tutor);
      if (n >= config.cupoTutor) throw Object.assign(new Error('Este tutor ya no tiene cupos libres.'), { status: 409 });
      return db
        .prepare('INSERT INTO tutorias (tutor_id, alumno_id, materia_id) VALUES (?, ?, ?) RETURNING id')
        .get(tutor, alumno, materia).id;
    });
    const t = db.prepare('SELECT nombre, email, whatsapp FROM usuarios WHERE id = ?').get(tutor);
    const { n } = db.prepare(`SELECT COUNT(*) AS n FROM tutorias WHERE tutor_id = ? AND estado = 'activa'`).get(tutor);
    res.status(201).json({ id, tutor: t, cupos_libres: Math.max(0, config.cupoTutor - n) });
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    throw e;
  }
});

// Mis tutorías: como alumno (con el contacto del tutor) y como tutor (con el contacto de mis alumnos).
app.get('/api/tutorias', requiereLogin, (req, res) => {
  const uid = req.session.usuarioId;
  const comoAlumno = db
    .prepare(
      `SELECT t.id, t.creado, m.id AS materia_id, m.nombre AS materia, u.id AS tutor_id, u.nombre AS tutor, u.email, u.whatsapp
       FROM tutorias t JOIN usuarios u ON u.id = t.tutor_id JOIN materias m ON m.id = t.materia_id
       WHERE t.alumno_id = ? AND t.estado = 'activa' ORDER BY t.creado DESC`,
    )
    .all(uid);
  const comoTutor = db
    .prepare(
      `SELECT t.id, t.creado, m.nombre AS materia, u.nombre AS alumno, u.carrera, u.email, u.whatsapp
       FROM tutorias t JOIN usuarios u ON u.id = t.alumno_id JOIN materias m ON m.id = t.materia_id
       WHERE t.tutor_id = ? AND t.estado = 'activa' ORDER BY t.creado`,
    )
    .all(uid);
  res.json({ cupo_max: config.cupoTutor, como_alumno: comoAlumno, como_tutor: comoTutor });
});

// Liberar un cupo: el alumno cancela o el tutor da por terminada la tutoría.
app.patch('/api/tutorias/:id', requiereLogin, (req, res) => {
  const uid = req.session.usuarioId;
  const t = db.prepare(`SELECT tutor_id, alumno_id FROM tutorias WHERE id = ? AND estado = 'activa'`).get(Number(req.params.id));
  if (!t || (t.tutor_id !== uid && t.alumno_id !== uid)) return res.status(404).json({ error: 'No existe esa tutoría.' });
  const estado = t.tutor_id === uid ? 'finalizada' : 'cancelada';
  db.prepare(`UPDATE tutorias SET estado = ?, cerrado = datetime('now') WHERE id = ?`).run(estado, Number(req.params.id));
  res.json({ ok: true, estado });
});

app.get('/api/postulaciones', requiereLogin, (req, res) => {
  res.json(
    db
      .prepare(
        `SELECT p.id, p.materia_id, m.nombre AS materia, m.semestre, p.estado, p.nota, p.detalle, p.disponible, p.creado, p.verificado_en
         FROM postulaciones p JOIN materias m ON m.id = p.materia_id
         WHERE p.usuario_id = ? ORDER BY m.semestre, m.nombre`,
      )
      .all(req.session.usuarioId),
  );
});

// Paso 1: inscripción voluntaria (elige materias y, si quiere, deja su WhatsApp)
app.post('/api/postulaciones', requiereLogin, (req, res) => {
  const ids = [...new Set((req.body?.materias ?? []).map(Number))].filter(Boolean);
  if (!ids.length) return res.status(400).json({ error: 'Elegí al menos una materia.' });
  let whatsapp;
  try {
    whatsapp = limpiarWhatsapp(req.body?.whatsapp);
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
  transaccion(() => {
    if (req.body && 'whatsapp' in req.body)
      db.prepare('UPDATE usuarios SET whatsapp = ? WHERE id = ?').run(whatsapp, req.session.usuarioId);
    const ins = db.prepare(
      `INSERT INTO postulaciones (usuario_id, materia_id) VALUES (?, ?)
       ON CONFLICT(usuario_id, materia_id) DO UPDATE SET estado = 'pendiente', detalle = NULL
       WHERE postulaciones.estado = 'rechazado'`,
    );
    for (const id of ids) {
      if (db.prepare('SELECT 1 FROM materias WHERE id = ?').get(id)) ins.run(req.session.usuarioId, id);
    }
  });
  res.status(201).json({ ok: true });
});

// Paso 2: verificación contra insweb (las credenciales se usan una vez y se descartan)
const verificando = new Set();
// Límite de intentos: evita que la app se use para adivinar contraseñas de insweb.
// Los primeros 5 intentos son libres. Después, cada intento exige una espera que va creciendo:
//   tras el 5.º intento: 2 min · tras el 6.º: 5 min · tras el 7.º (y siguientes): 10 min.
// El contador se borra si la verificación sale bien, o tras 30 minutos sin intentar.
const INTENTOS_LIBRES = 5;
const ESPERAS_MS = [2, 5, 10].map((m) => m * 60 * 1000); // para los intentos 5, 6 y 7+
const OLVIDAR_MS = 30 * 60 * 1000;
const intentos = new Map(); // usuarioId -> { n, ultimo, hasta }

/** Devuelve 0 si puede intentar (y lo registra), o los ms que le faltan esperar. */
function intentar(uid) {
  const ahora = Date.now();
  let e = intentos.get(uid);
  if (!e || ahora - e.ultimo > OLVIDAR_MS) e = { n: 0, ultimo: ahora, hasta: 0 };
  if (ahora < e.hasta) {
    intentos.set(uid, e);
    return e.hasta - ahora;
  }
  e.n += 1;
  e.ultimo = ahora;
  if (e.n >= INTENTOS_LIBRES) e.hasta = ahora + ESPERAS_MS[Math.min(e.n - INTENTOS_LIBRES, ESPERAS_MS.length - 1)];
  intentos.set(uid, e);
  return 0;
}

function textoEspera(ms) {
  const min = Math.floor(ms / 60000);
  const seg = Math.ceil((ms % 60000) / 1000);
  if (min === 0) return `${seg} segundo${seg === 1 ? '' : 's'}`;
  return seg === 60 || seg === 0 ? `${seg === 60 ? min + 1 : min} minuto${(seg === 60 ? min + 1 : min) === 1 ? '' : 's'}` : `${min} min ${seg} s`;
}

app.post('/api/postulaciones/verificar', requiereLogin, async (req, res) => {
  const uid = req.session.usuarioId;
  const usuario = String(req.body?.usuario ?? '').trim();
  const password = String(req.body?.password ?? '');
  if (!usuario || !password) return res.status(400).json({ error: 'Ingresá tu usuario y contraseña de insweb.' });

  const pendientes = db
    .prepare(
      `SELECT p.id, m.id AS materia_id, m.nombre, m.alias FROM postulaciones p JOIN materias m ON m.id = p.materia_id
       WHERE p.usuario_id = ? AND p.estado = 'pendiente'`,
    )
    .all(uid);
  if (!pendientes.length) return res.status(400).json({ error: 'No tenés postulaciones pendientes de verificar.' });

  const insId = idInsweb(usuario);
  const otro = db.prepare('SELECT id FROM usuarios WHERE insweb_id = ? AND id <> ?').get(insId, uid);
  if (otro) return res.status(409).json({ error: 'Esa cuenta de insweb ya se usó para verificar otro usuario.' });

  if (verificando.has(uid)) return res.status(429).json({ error: 'Ya hay una verificación en curso.' });
  const espera = intentar(uid);
  if (espera) {
    res.setHeader('Retry-After', Math.ceil(espera / 1000));
    return res.status(429).json({ error: `Demasiados intentos. Probá de nuevo en ${textoEspera(espera)}.` });
  }
  verificando.add(uid);
  try {
    const notas = await obtenerNotasFinales({ usuario, password });
    intentos.delete(uid); // credenciales correctas: se reinicia el contador
    const resultados = transaccion(() => {
      db.prepare('UPDATE usuarios SET insweb_id = ? WHERE id = ?').run(insId, uid);
      const upd = db.prepare(
        `UPDATE postulaciones SET estado = ?, nota = ?, detalle = ?, verificado_en = datetime('now') WHERE id = ?`,
      );
      return pendientes.map((p) => {
        const r = evaluarMateria(notas, p);
        upd.run(r.cumple ? 'verificado' : 'rechazado', r.cumple ? r.nota : null, r.detalle, p.id);
        return { materia: p.nombre, cumple: r.cumple, nota: r.nota, detalle: r.detalle };
      });
    });
    res.json({ resultados });
  } catch (e) {
    if (e instanceof ErrorVerificacion) {
      const status = e.codigo === 'credenciales' ? 401 : e.codigo === 'no_disponible' ? 503 : 502;
      return res.status(status).json({ error: e.message, codigo: e.codigo });
    }
    console.error('Error verificando insweb:', e.message); // nunca loguear credenciales
    res.status(500).json({ error: 'Error inesperado al verificar.' });
  } finally {
    verificando.delete(uid);
  }
});

app.patch('/api/postulaciones/:id', requiereLogin, (req, res) => {
  const disponible = req.body?.disponible ? 1 : 0;
  const r = db
    .prepare('UPDATE postulaciones SET disponible = ? WHERE id = ? AND usuario_id = ?')
    .run(disponible, Number(req.params.id), req.session.usuarioId);
  if (!r.changes) return res.status(404).json({ error: 'No existe esa postulación.' });
  res.json({ ok: true, disponible });
});

app.delete('/api/postulaciones/:id', requiereLogin, (req, res) => {
  db.prepare('DELETE FROM postulaciones WHERE id = ? AND usuario_id = ?').run(Number(req.params.id), req.session.usuarioId);
  res.json({ ok: true });
});

// ───────────────────────── Errores ─────────────────────────

app.use('/api', (_req, res) => res.status(404).json({ error: 'Ruta no encontrada.' }));
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Error interno del servidor.' });
});

app.listen(config.puerto, async () => {
  console.log(`Apuntes FIUNA corriendo en http://localhost:${config.puerto}`);
  if (config.verificador === 'simulado') {
    console.log('Verificador de notas: SIMULADO (cuentas de prueba en data/insweb-simulado.json)');
  } else {
    console.log(`Verificador de notas: insweb real (${config.insweb.url}${config.insweb.rutaNotasFinales})`);
    const { navegadorDisponible } = await import('./src/verificador/insweb.js');
    if (!(await navegadorDisponible()))
      console.warn('⚠ Falta Chromium para leer insweb. Ejecutá: npm run instalar-navegador');
  }
});

