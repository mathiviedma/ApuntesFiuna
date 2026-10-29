import path from 'node:path';
import crypto from 'node:crypto';
import express from 'express';
import cookieSession from 'cookie-session';
import { config } from './config.js';
import { db, transaccion } from './db.js';
import { CARRERAS } from './materias.js';
import { hashPassword, verificarPassword, requiereLogin } from './auth.js';
import { palabras } from './normalizar.js';
import { textoBusqueda } from './busqueda.js';
import { MIMES, RE_CLAVE, urlSubida, infoObjeto, urlDescarga, borrar as borrarArchivo } from './almacen.js';
import { obtenerNotasFinales, evaluarMateria, idInsweb, ErrorVerificacion } from './verificador/index.js';

if (config.esVercel && config.secretoSesion === 'cambiar-este-secreto-en-produccion')
  throw new Error('Definí SECRETO_SESION en las variables de entorno de Vercel.');

export const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '100kb' }));
// Sesión en una cookie firmada (sin estado en el servidor): funciona con varias instancias serverless.
app.use(
  cookieSession({
    name: 'sesion',
    keys: [config.secretoSesion],
    httpOnly: true,
    sameSite: 'lax',
    secure: config.esVercel,
    maxAge: 1000 * 60 * 60 * 24 * 7,
  }),
);
app.use(express.static(path.join(config.raiz, 'public')));

// Express 4 no captura los errores de handlers async: se pasan a next().
const a = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const TIPOS = ['apunte', 'examen', 'resumen', 'practica'];
const PERIODOS = ['1er parcial', '2do parcial', 'final', 'recuperatorio', 'otro'];
const usuarioActual = async (req) =>
  req.session.usuarioId
    ? (await db.get('SELECT id, nombre, email, carrera, whatsapp FROM usuarios WHERE id = ?', req.session.usuarioId)) ?? null
    : null;

const limpiarWhatsapp = (w) => {
  if (w == null || String(w).trim() === '') return null;
  let d = String(w).replace(/\D/g, '');
  if (d.startsWith('0')) d = '595' + d.slice(1); // 0981... -> 595981...
  if (!/^\d{10,15}$/.test(d)) throw new Error('El número de WhatsApp no parece válido. Ejemplo: 0981 123 456.');
  return d;
};


// ───────────────────────── Sesión ─────────────────────────

app.post('/api/registro', a(async (req, res) => {
  const { nombre, email, password, carrera } = req.body ?? {};
  const mail = String(email ?? '').trim().toLowerCase();
  if (!nombre?.trim() || !mail || !password || !carrera) return res.status(400).json({ error: 'Completá todos los campos.' });
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mail)) return res.status(400).json({ error: 'Email inválido.' });
  if (config.dominioEmail && !mail.endsWith('@' + config.dominioEmail))
    return res.status(400).json({ error: `Usá tu correo institucional (@${config.dominioEmail}).` });
  if (String(password).length < 8) return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres.' });
  if (!CARRERAS[carrera]) return res.status(400).json({ error: 'Carrera inválida.' });
  try {
    const { id } = await db.get(
      'INSERT INTO usuarios (nombre, email, pass_hash, carrera) VALUES (?, ?, ?, ?) RETURNING id',
      nombre.trim(), mail, hashPassword(String(password)), carrera,
    );
    req.session.usuarioId = id;
    res.status(201).json(await usuarioActual(req));
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Ya existe una cuenta con ese email.' });
    throw e;
  }
}));

app.post('/api/login', a(async (req, res) => {
  const mail = String(req.body?.email ?? '').trim().toLowerCase();
  const u = await db.get('SELECT id, pass_hash FROM usuarios WHERE email = ?', mail);
  if (!u || !verificarPassword(String(req.body?.password ?? ''), u.pass_hash))
    return res.status(401).json({ error: 'Email o contraseña incorrectos.' });
  req.session = { usuarioId: u.id };
  res.json(await usuarioActual(req));
}));

app.post('/api/logout', (req, res) => {
  req.session = null;
  res.json({ ok: true });
});

app.get('/api/yo', a(async (req, res) => res.json(await usuarioActual(req))));

app.patch('/api/yo', requiereLogin, a(async (req, res) => {
  let w;
  try {
    w = limpiarWhatsapp(req.body?.whatsapp);
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
  await db.run('UPDATE usuarios SET whatsapp = ? WHERE id = ?', w, req.session.usuarioId);
  res.json(await usuarioActual(req));
}));

// ───────────────────────── Catálogo ─────────────────────────

app.get('/api/materias', a(async (req, res) => {
  const { carrera } = req.query;
  const filas = await db.all(
    `SELECT m.id, m.nombre, m.sigla, m.semestre, string_agg(mc.carrera, ',') AS carreras,
            (SELECT COUNT(*) FROM apuntes a WHERE a.materia_id = m.id) AS apuntes,
            (SELECT COUNT(*) FROM postulaciones p WHERE p.materia_id = m.id AND p.estado = 'verificado' AND p.disponible = 1) AS tutores
     FROM materias m JOIN materia_carrera mc ON mc.materia_id = m.id
     GROUP BY m.id
     HAVING ?::text IS NULL OR position(?::text in string_agg(mc.carrera, ',')) > 0
     ORDER BY m.semestre`,
    carrera ?? null, carrera ?? null,
  );
  const orden = (a, b) => a.semestre - b.semestre || a.nombre.localeCompare(b.nombre, 'es');
  res.json(filas.map((f) => ({ ...f, carreras: f.carreras.split(',') })).sort(orden));
}));

app.get('/api/meta', (_req, res) =>
  res.json({
    carreras: CARRERAS, tipos: TIPOS, periodos: PERIODOS, verificador: config.verificador,
    maxMb: config.maxMbArchivo, cupoTutor: config.cupoTutor,
  }),
);

// ───────────────────────── Apuntes ─────────────────────────

app.get('/api/apuntes', a(async (req, res) => {
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
  const filas = await db.all(
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
    uid, uid, ...params,
  );
  res.json(filas);
}));

// Valida los campos de un apunte (alta o edición). Devuelve { error } o { datos }.
async function validarApunte(body, { archivoRequerido }) {
  const { materia_id, tipo, titulo, descripcion = '', anio, periodo, archivo } = body ?? {};
  const materia = await db.get('SELECT id FROM materias WHERE id = ?', Number(materia_id) || 0);
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

// Paso 1 de la subida: el navegador pide una URL firmada y sube el archivo directo a Supabase Storage.
app.post('/api/apuntes/subida', requiereLogin, a(async (req, res) => {
  const { mime, tamano } = req.body ?? {};
  if (!MIMES[mime]) return res.status(400).json({ error: 'Solo se aceptan PDF o imágenes (JPG, PNG, WEBP).' });
  if (!(Number(tamano) > 0) || Number(tamano) > config.maxMbArchivo * 1024 * 1024)
    return res.status(400).json({ error: `El archivo supera ${config.maxMbArchivo} MB.` });
  const clave = crypto.randomUUID() + MIMES[mime];
  res.json({ clave, url: await urlSubida(clave), mime });
}));

// Comprueba que el archivo realmente esté en Storage y cumpla tipo y tamaño (el cliente no es confiable).
async function comprobarArchivo(clave) {
  if (!RE_CLAVE.test(String(clave))) return { error: 'Archivo inválido.' };
  const info = await infoObjeto(clave);
  if (!info) return { error: 'No se encontró el archivo subido. Probá de nuevo.' };
  const error =
    (info.size > config.maxMbArchivo * 1024 * 1024 && `El archivo supera ${config.maxMbArchivo} MB.`) ||
    (MIMES[info.mime] !== clave.slice(clave.lastIndexOf('.')) && 'Solo se aceptan PDF o imágenes (JPG, PNG, WEBP).');
  if (error) {
    await borrarArchivo(clave);
    return { error };
  }
  return { info };
}

const nombreOriginal = (b) => String(b.archivo_nombre ?? 'archivo').replace(/[\r\n]+/g, ' ').slice(0, 200) || 'archivo';

// Paso 2: con el archivo ya subido, se registra el apunte.
app.post('/api/apuntes', requiereLogin, a(async (req, res) => {
  const { error, datos } = await validarApunte(req.body, { archivoRequerido: true });
  if (error) return res.status(400).json({ error });
  const { error: errArchivo, info } = await comprobarArchivo(req.body.archivo);
  if (errArchivo) return res.status(400).json({ error: errArchivo });
  try {
    const { id } = await db.get(
      `INSERT INTO apuntes (usuario_id, materia_id, tipo, titulo, descripcion, anio, periodo, archivo, archivo_nombre, mime, tamano, busqueda)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      req.session.usuarioId, datos.materiaId, datos.tipo, datos.titulo, datos.descripcion, datos.anio, datos.periodo,
      req.body.archivo, nombreOriginal(req.body), info.mime, info.size, await textoBusqueda(datos),
    );
    res.status(201).json({ id });
  } catch (e) {
    if (e.code === '23505') return res.status(400).json({ error: 'Ese archivo ya fue registrado.' });
    throw e;
  }
}));

// Datos de un apunte propio, para el formulario de edición.
app.get('/api/apuntes/:id', requiereLogin, a(async (req, res) => {
  const ap = await db.get(
    `SELECT id, materia_id, tipo, titulo, descripcion, anio, periodo, archivo_nombre, tamano
     FROM apuntes WHERE id = ? AND usuario_id = ?`,
    Number(req.params.id) || 0, req.session.usuarioId,
  );
  if (!ap) return res.status(404).json({ error: 'No existe ese apunte o no es tuyo.' });
  res.json(ap);
}));

// Editar un apunte propio. El archivo es opcional: si se manda uno nuevo (ya subido), reemplaza al anterior.
app.put('/api/apuntes/:id', requiereLogin, a(async (req, res) => {
  const id = Number(req.params.id) || 0;
  const actual = await db.get('SELECT archivo FROM apuntes WHERE id = ? AND usuario_id = ?', id, req.session.usuarioId);
  if (!actual) return res.status(404).json({ error: 'No existe ese apunte o no es tuyo.' });
  const { error, datos } = await validarApunte(req.body, { archivoRequerido: false });
  if (error) return res.status(400).json({ error });
  let nuevo;
  if (req.body.archivo) {
    const r = await comprobarArchivo(req.body.archivo);
    if (r.error) return res.status(400).json({ error: r.error });
    nuevo = r.info;
  }
  await transaccion(async (tx) => {
    await tx.run(
      `UPDATE apuntes SET materia_id = ?, tipo = ?, titulo = ?, descripcion = ?, anio = ?, periodo = ?, busqueda = ? WHERE id = ?`,
      datos.materiaId, datos.tipo, datos.titulo, datos.descripcion, datos.anio, datos.periodo, await textoBusqueda(datos), id,
    );
    if (nuevo)
      await tx.run('UPDATE apuntes SET archivo = ?, archivo_nombre = ?, mime = ?, tamano = ? WHERE id = ?',
        req.body.archivo, nombreOriginal(req.body), nuevo.mime, nuevo.size, id);
  });
  if (nuevo) await borrarArchivo(actual.archivo);
  res.json({ id });
}));

app.delete('/api/apuntes/:id', requiereLogin, a(async (req, res) => {
  const id = Number(req.params.id) || 0;
  const ap = await db.get('SELECT archivo FROM apuntes WHERE id = ? AND usuario_id = ?', id, req.session.usuarioId);
  if (!ap) return res.status(404).json({ error: 'No existe ese apunte o no es tuyo.' });
  await db.run('DELETE FROM apuntes WHERE id = ?', id); // los votos se borran en cascada
  await borrarArchivo(ap.archivo);
  res.json({ ok: true });
}));

// El archivo se sirve desde Supabase Storage con una URL firmada de 60 s.
app.get('/api/apuntes/:id/archivo', a(async (req, res) => {
  const ap = await db.get('SELECT archivo, archivo_nombre FROM apuntes WHERE id = ?', Number(req.params.id) || 0);
  if (!ap) return res.status(404).json({ error: 'No existe ese apunte.' });
  res.setHeader('Cache-Control', 'no-store');
  res.redirect(302, await urlDescarga(ap.archivo, req.query.descargar ? ap.archivo_nombre : undefined));
}));

// "Me gusta" (corazón). { me_gusta: true } lo marca, { me_gusta: false } lo quita.
app.post('/api/apuntes/:id/like', requiereLogin, a(async (req, res) => {
  const id = Number(req.params.id) || 0;
  if (!(await db.get('SELECT 1 FROM apuntes WHERE id = ?', id))) return res.status(404).json({ error: 'No existe ese apunte.' });
  if (req.body?.me_gusta)
    await db.run(
      `INSERT INTO votos (apunte_id, usuario_id, valor) VALUES (?, ?, 1) ON CONFLICT(apunte_id, usuario_id) DO NOTHING`,
      id, req.session.usuarioId,
    );
  else await db.run('DELETE FROM votos WHERE apunte_id = ? AND usuario_id = ?', id, req.session.usuarioId);
  const { likes } = await db.get('SELECT COUNT(*) AS likes FROM votos WHERE apunte_id = ? AND valor = 1', id);
  res.json({ likes, me_gusta: Boolean(req.body?.me_gusta) });
}));

// ───────────────────────── Tutorías ─────────────────────────

const CUPOS_OCUPADOS = `(SELECT COUNT(*) FROM tutorias t WHERE t.tutor_id = u.id AND t.estado = 'activa')`;

app.get('/api/tutores', a(async (req, res) => {
  const materia = Number(req.query.materia);
  if (!materia) return res.status(400).json({ error: 'Elegí una materia.' });
  const uid = req.session.usuarioId ?? -1;
  const filas = await db.all(
    `SELECT u.id, u.nombre, u.carrera, u.email, u.whatsapp, p.nota, p.verificado_en,
            (SELECT COUNT(*) FROM apuntes a WHERE a.usuario_id = u.id AND a.materia_id = p.materia_id) AS apuntes_materia,
            ${CUPOS_OCUPADOS} AS ocupados,
            (SELECT t.id FROM tutorias t WHERE t.tutor_id = u.id AND t.alumno_id = ? AND t.materia_id = p.materia_id
               AND t.estado = 'activa') AS mi_tutoria
     FROM postulaciones p JOIN usuarios u ON u.id = p.usuario_id
     WHERE p.materia_id = ? AND p.estado = 'verificado' AND p.disponible = 1
     ORDER BY (${CUPOS_OCUPADOS} >= ?) , p.nota DESC, p.verificado_en`,
    uid, materia, config.cupoTutor,
  );
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
}));

// Tomar un cupo con un tutor para una materia.
app.post('/api/tutorias', requiereLogin, a(async (req, res) => {
  const alumno = req.session.usuarioId;
  const tutor = Number(req.body?.tutor_id) || 0;
  const materia = Number(req.body?.materia_id) || 0;
  if (tutor === alumno) return res.status(400).json({ error: 'No podés pedirte una tutoría a vos mismo.' });
  const ofrece = await db.get(
    `SELECT 1 FROM postulaciones WHERE usuario_id = ? AND materia_id = ? AND estado = 'verificado' AND disponible = 1`,
    tutor, materia,
  );
  if (!ofrece) return res.status(404).json({ error: 'Ese tutor no está disponible para esta materia.' });
  try {
    const id = await transaccion(async (tx) => {
      // Se bloquea la fila del tutor: dos alumnos a la vez no pueden quedarse con el último cupo.
      await tx.get('SELECT id FROM usuarios WHERE id = ? FOR UPDATE', tutor);
      const ya = await tx.get(
        `SELECT id FROM tutorias WHERE tutor_id = ? AND alumno_id = ? AND materia_id = ? AND estado = 'activa'`,
        tutor, alumno, materia,
      );
      if (ya) return ya.id;
      const { n } = await tx.get(`SELECT COUNT(*) AS n FROM tutorias WHERE tutor_id = ? AND estado = 'activa'`, tutor);
      if (n >= config.cupoTutor) throw Object.assign(new Error('Este tutor ya no tiene cupos libres.'), { status: 409 });
      return (await tx.get('INSERT INTO tutorias (tutor_id, alumno_id, materia_id) VALUES (?, ?, ?) RETURNING id', tutor, alumno, materia)).id;
    });
    const t = await db.get('SELECT nombre, email, whatsapp FROM usuarios WHERE id = ?', tutor);
    const { n } = await db.get(`SELECT COUNT(*) AS n FROM tutorias WHERE tutor_id = ? AND estado = 'activa'`, tutor);
    res.status(201).json({ id, tutor: t, cupos_libres: Math.max(0, config.cupoTutor - n) });
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    throw e;
  }
}));

// Mis tutorías: como alumno (con el contacto del tutor) y como tutor (con el contacto de mis alumnos).
app.get('/api/tutorias', requiereLogin, a(async (req, res) => {
  const uid = req.session.usuarioId;
  const comoAlumno = await db.all(
    `SELECT t.id, t.creado, m.id AS materia_id, m.nombre AS materia, u.id AS tutor_id, u.nombre AS tutor, u.email, u.whatsapp
     FROM tutorias t JOIN usuarios u ON u.id = t.tutor_id JOIN materias m ON m.id = t.materia_id
     WHERE t.alumno_id = ? AND t.estado = 'activa' ORDER BY t.creado DESC`,
    uid,
  );
  const comoTutor = await db.all(
    `SELECT t.id, t.creado, m.nombre AS materia, u.nombre AS alumno, u.carrera, u.email, u.whatsapp
     FROM tutorias t JOIN usuarios u ON u.id = t.alumno_id JOIN materias m ON m.id = t.materia_id
     WHERE t.tutor_id = ? AND t.estado = 'activa' ORDER BY t.creado`,
    uid,
  );
  res.json({ cupo_max: config.cupoTutor, como_alumno: comoAlumno, como_tutor: comoTutor });
}));

// Liberar un cupo: el alumno cancela o el tutor da por terminada la tutoría.
app.patch('/api/tutorias/:id', requiereLogin, a(async (req, res) => {
  const uid = req.session.usuarioId;
  const id = Number(req.params.id) || 0;
  const t = await db.get(`SELECT tutor_id, alumno_id FROM tutorias WHERE id = ? AND estado = 'activa'`, id);
  if (!t || (t.tutor_id !== uid && t.alumno_id !== uid)) return res.status(404).json({ error: 'No existe esa tutoría.' });
  const estado = t.tutor_id === uid ? 'finalizada' : 'cancelada';
  await db.run(`UPDATE tutorias SET estado = ?, cerrado = now() WHERE id = ?`, estado, id);
  res.json({ ok: true, estado });
}));

app.get('/api/postulaciones', requiereLogin, a(async (req, res) => {
  res.json(
    await db.all(
      `SELECT p.id, p.materia_id, m.nombre AS materia, m.semestre, p.estado, p.nota, p.detalle, p.disponible, p.creado, p.verificado_en
       FROM postulaciones p JOIN materias m ON m.id = p.materia_id
       WHERE p.usuario_id = ? ORDER BY m.semestre, m.nombre`,
      req.session.usuarioId,
    ),
  );
}));

// Paso 1: inscripción voluntaria (elige materias y, si quiere, deja su WhatsApp)
app.post('/api/postulaciones', requiereLogin, a(async (req, res) => {
  const ids = [...new Set((req.body?.materias ?? []).map(Number))].filter(Boolean);
  if (!ids.length) return res.status(400).json({ error: 'Elegí al menos una materia.' });
  let whatsapp;
  try {
    whatsapp = limpiarWhatsapp(req.body?.whatsapp);
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
  await transaccion(async (tx) => {
    if (req.body && 'whatsapp' in req.body)
      await tx.run('UPDATE usuarios SET whatsapp = ? WHERE id = ?', whatsapp, req.session.usuarioId);
    for (const id of ids) {
      if (!(await tx.get('SELECT 1 FROM materias WHERE id = ?', id))) continue;
      await tx.run(
        `INSERT INTO postulaciones (usuario_id, materia_id) VALUES (?, ?)
         ON CONFLICT(usuario_id, materia_id) DO UPDATE SET estado = 'pendiente', detalle = NULL
         WHERE postulaciones.estado = 'rechazado'`,
        req.session.usuarioId, id,
      );
    }
  });
  res.status(201).json({ ok: true });
}));

// Paso 2: verificación contra insweb (las credenciales se usan una vez y se descartan)
const verificando = new Set(); // por instancia: evita doble clic; el límite real de intentos vive en la base
// Límite de intentos: evita que la app se use para adivinar contraseñas de insweb.
// Los primeros 5 intentos son libres. Después, cada intento exige una espera que va creciendo:
//   tras el 5.º intento: 2 min · tras el 6.º: 5 min · tras el 7.º (y siguientes): 10 min.
// El contador se borra si la verificación sale bien, o tras 30 minutos sin intentar.
const INTENTOS_LIBRES = 5;
const ESPERAS_MS = [2, 5, 10].map((m) => m * 60 * 1000); // para los intentos 5, 6 y 7+
const OLVIDAR_MS = 30 * 60 * 1000;

/** Devuelve 0 si puede intentar (y lo registra), o los ms que le faltan esperar. */
function intentar(uid) {
  return transaccion(async (tx) => {
    const ahora = Date.now();
    let e = await tx.get('SELECT n, ultimo, hasta FROM intentos_verificacion WHERE usuario_id = ? FOR UPDATE', uid);
    if (!e || ahora - e.ultimo > OLVIDAR_MS) e = { n: 0, ultimo: ahora, hasta: 0 };
    if (ahora < e.hasta) return e.hasta - ahora;
    e.n += 1;
    e.ultimo = ahora;
    if (e.n >= INTENTOS_LIBRES) e.hasta = ahora + ESPERAS_MS[Math.min(e.n - INTENTOS_LIBRES, ESPERAS_MS.length - 1)];
    await tx.run(
      `INSERT INTO intentos_verificacion (usuario_id, n, ultimo, hasta) VALUES (?, ?, ?, ?)
       ON CONFLICT(usuario_id) DO UPDATE SET n = excluded.n, ultimo = excluded.ultimo, hasta = excluded.hasta`,
      uid, e.n, e.ultimo, e.hasta,
    );
    return 0;
  });
}

function textoEspera(ms) {
  const min = Math.floor(ms / 60000);
  const seg = Math.ceil((ms % 60000) / 1000);
  if (min === 0) return `${seg} segundo${seg === 1 ? '' : 's'}`;
  return seg === 60 || seg === 0 ? `${seg === 60 ? min + 1 : min} minuto${(seg === 60 ? min + 1 : min) === 1 ? '' : 's'}` : `${min} min ${seg} s`;
}

app.post('/api/postulaciones/verificar', requiereLogin, a(async (req, res) => {
  const uid = req.session.usuarioId;
  const usuario = String(req.body?.usuario ?? '').trim();
  const password = String(req.body?.password ?? '');
  if (!usuario || !password) return res.status(400).json({ error: 'Ingresá tu usuario y contraseña de insweb.' });

  const pendientes = await db.all(
    `SELECT p.id, m.id AS materia_id, m.nombre, m.alias FROM postulaciones p JOIN materias m ON m.id = p.materia_id
     WHERE p.usuario_id = ? AND p.estado = 'pendiente'`,
    uid,
  );
  if (!pendientes.length) return res.status(400).json({ error: 'No tenés postulaciones pendientes de verificar.' });

  const insId = idInsweb(usuario);
  const otro = await db.get('SELECT id FROM usuarios WHERE insweb_id = ? AND id <> ?', insId, uid);
  if (otro) return res.status(409).json({ error: 'Esa cuenta de insweb ya se usó para verificar otro usuario.' });

  if (verificando.has(uid)) return res.status(429).json({ error: 'Ya hay una verificación en curso.' });
  const espera = await intentar(uid);
  if (espera) {
    res.setHeader('Retry-After', Math.ceil(espera / 1000));
    return res.status(429).json({ error: `Demasiados intentos. Probá de nuevo en ${textoEspera(espera)}.` });
  }
  verificando.add(uid);
  try {
    const notas = await obtenerNotasFinales({ usuario, password });
    await db.run('DELETE FROM intentos_verificacion WHERE usuario_id = ?', uid); // credenciales correctas: se reinicia el contador
    const resultados = await transaccion(async (tx) => {
      await tx.run('UPDATE usuarios SET insweb_id = ? WHERE id = ?', insId, uid);
      const salida = [];
      for (const p of pendientes) {
        const r = evaluarMateria(notas, p);
        await tx.run(
          `UPDATE postulaciones SET estado = ?, nota = ?, detalle = ?, verificado_en = now() WHERE id = ?`,
          r.cumple ? 'verificado' : 'rechazado', r.cumple ? r.nota : null, r.detalle, p.id,
        );
        salida.push({ materia: p.nombre, cumple: r.cumple, nota: r.nota, detalle: r.detalle });
      }
      return salida;
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
}));

app.patch('/api/postulaciones/:id', requiereLogin, a(async (req, res) => {
  const disponible = req.body?.disponible ? 1 : 0;
  const n = await db.run(
    'UPDATE postulaciones SET disponible = ? WHERE id = ? AND usuario_id = ?',
    disponible, Number(req.params.id) || 0, req.session.usuarioId,
  );
  if (!n) return res.status(404).json({ error: 'No existe esa postulación.' });
  res.json({ ok: true, disponible });
}));

app.delete('/api/postulaciones/:id', requiereLogin, a(async (req, res) => {
  await db.run('DELETE FROM postulaciones WHERE id = ? AND usuario_id = ?', Number(req.params.id) || 0, req.session.usuarioId);
  res.json({ ok: true });
}));

// ───────────────────────── Errores ─────────────────────────

app.use('/api', (_req, res) => res.status(404).json({ error: 'Ruta no encontrada.' }));
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Error interno del servidor.' });
});
