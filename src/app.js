import path from 'node:path';
import express from 'express';
import cookieSession from 'cookie-session';
import { config } from './config.js';
import { sql } from './db.js';
import { CARRERAS } from './materias.js';
import { hashPassword, verificarPassword, requiereLogin } from './auth.js';
import { palabras } from './normalizar.js';
import { textoBusqueda } from './busqueda.js';
import { MIMES, nuevaRuta, urlDeSubida, infoObjeto, urlDeDescarga, borrarObjeto } from './storage.js';
import { obtenerNotasFinales, evaluarMateria, idInsweb, ErrorVerificacion } from './verificador/index.js';

const enVercel = Boolean(process.env.VERCEL);
if (enVercel && config.secretoSesion.startsWith('cambiar-este-secreto'))
  throw new Error('Definí SECRETO_SESION en las variables de entorno de Vercel.');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

// Express 4 no captura errores de handlers async: se los pasamos a next().
for (const m of ['get', 'post', 'put', 'patch', 'delete']) {
  const orig = app[m].bind(app);
  app[m] = (ruta, ...hs) =>
    hs.length ? orig(ruta, ...hs.map((h) => (req, res, next) => Promise.resolve(h(req, res, next)).catch(next))) : orig(ruta);
}

app.use(express.json({ limit: '100kb' }));
// Sesión en una cookie firmada: en serverless no hay memoria compartida entre invocaciones.
app.use(
  cookieSession({
    name: 'sid',
    keys: [config.secretoSesion],
    httpOnly: true,
    sameSite: 'lax',
    secure: enVercel,
    maxAge: 1000 * 60 * 60 * 24 * 7,
  }),
);
app.use(express.static(path.join(config.raiz, 'public')));

const TIPOS = ['apunte', 'examen', 'resumen', 'practica'];
const PERIODOS = ['1er parcial', '2do parcial', 'final', 'recuperatorio', 'otro'];
const RUTA_VALIDA = /^[0-9a-f-]{36}\.(pdf|jpg|png|webp)$/;
const entero = (v) => (Number.isInteger(Number(v)) && v !== '' && v != null ? Number(v) : null);

const usuarioActual = async (req) => {
  if (!req.session.usuarioId) return null;
  const [u] = await sql`SELECT id, nombre, email, carrera, whatsapp FROM usuarios WHERE id = ${req.session.usuarioId}`;
  return u ?? null;
};

const limpiarWhatsapp = (w) => {
  if (w == null || String(w).trim() === '') return null;
  let d = String(w).replace(/\D/g, '');
  if (d.startsWith('0')) d = '595' + d.slice(1); // 0981... -> 595981...
  if (!/^\d{10,15}$/.test(d)) throw new Error('El número de WhatsApp no parece válido. Ejemplo: 0981 123 456.');
  return d;
};

// ───────────────────────── Sesión ─────────────────────────

app.post('/api/registro', async (req, res) => {
  const { nombre, email, password, carrera } = req.body ?? {};
  const mail = String(email ?? '').trim().toLowerCase();
  if (!nombre?.trim() || !mail || !password || !carrera) return res.status(400).json({ error: 'Completá todos los campos.' });
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mail)) return res.status(400).json({ error: 'Email inválido.' });
  if (config.dominioEmail && !mail.endsWith('@' + config.dominioEmail))
    return res.status(400).json({ error: `Usá tu correo institucional (@${config.dominioEmail}).` });
  if (String(password).length < 8) return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres.' });
  if (!CARRERAS[carrera]) return res.status(400).json({ error: 'Carrera inválida.' });
  try {
    const [{ id }] = await sql`
      INSERT INTO usuarios (nombre, email, pass_hash, carrera)
      VALUES (${nombre.trim()}, ${mail}, ${hashPassword(String(password))}, ${carrera}) RETURNING id`;
    req.session.usuarioId = id;
    res.status(201).json(await usuarioActual(req));
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Ya existe una cuenta con ese email.' });
    throw e;
  }
});

app.post('/api/login', async (req, res) => {
  const mail = String(req.body?.email ?? '').trim().toLowerCase();
  const [u] = await sql`SELECT id, pass_hash FROM usuarios WHERE email = ${mail}`;
  if (!u || !verificarPassword(String(req.body?.password ?? ''), u.pass_hash))
    return res.status(401).json({ error: 'Email o contraseña incorrectos.' });
  req.session = { usuarioId: u.id };
  res.json(await usuarioActual(req));
});

app.post('/api/logout', (req, res) => {
  req.session = null;
  res.json({ ok: true });
});

app.get('/api/yo', async (req, res) => res.json(await usuarioActual(req)));

app.patch('/api/yo', requiereLogin, async (req, res) => {
  let w;
  try {
    w = limpiarWhatsapp(req.body?.whatsapp);
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
  await sql`UPDATE usuarios SET whatsapp = ${w} WHERE id = ${req.session.usuarioId}`;
  res.json(await usuarioActual(req));
});

// ───────────────────────── Catálogo ─────────────────────────

app.get('/api/materias', async (req, res) => {
  const carrera = req.query.carrera ? String(req.query.carrera) : null;
  const filas = await sql`
    SELECT m.id, m.nombre, m.sigla, m.semestre, array_agg(mc.carrera) AS carreras,
           (SELECT COUNT(*)::int FROM apuntes a WHERE a.materia_id = m.id) AS apuntes,
           (SELECT COUNT(*)::int FROM postulaciones p WHERE p.materia_id = m.id AND p.estado = 'verificado' AND p.disponible = 1) AS tutores
    FROM materias m JOIN materia_carrera mc ON mc.materia_id = m.id
    GROUP BY m.id
    HAVING ${carrera}::text IS NULL OR ${carrera}::text = ANY(array_agg(mc.carrera))`;
  res.json(filas.sort((a, b) => a.semestre - b.semestre || a.nombre.localeCompare(b.nombre, 'es')));
});

app.get('/api/meta', (_req, res) =>
  res.json({
    carreras: CARRERAS, tipos: TIPOS, periodos: PERIODOS, verificador: config.verificador,
    maxMb: config.maxMbArchivo, cupoTutor: config.cupoTutor,
  }),
);

// ───────────────────────── Apuntes ─────────────────────────

app.get('/api/apuntes', async (req, res) => {
  const { q, materia, tipo, anio, carrera, semestre, orden, mios } = req.query;
  const cond = [];
  // Cada palabra debe aparecer como inicio de una palabra del texto ("calc" encuentra "calculo").
  // Los números cortos deben coincidir completos: "2" encuentra "Cálculo 2" pero no "2025".
  for (const p of palabras(q ?? '')) {
    const exacta = /^\d{1,2}$/.test(p);
    const patron = `% ${p.replace(/[%_\\]/g, '\\$&')}${exacta ? ' ' : ''}%`;
    cond.push(sql`(' ' || a.busqueda || ' ') LIKE ${patron} ESCAPE '\\'`);
  }
  if (entero(materia)) cond.push(sql`a.materia_id = ${entero(materia)}`);
  if (tipo && TIPOS.includes(tipo)) cond.push(sql`a.tipo = ${tipo}`);
  if (entero(anio)) cond.push(sql`a.anio = ${entero(anio)}`);
  if (entero(semestre)) cond.push(sql`m.semestre = ${entero(semestre)}`);
  if (carrera) cond.push(sql`EXISTS (SELECT 1 FROM materia_carrera mc WHERE mc.materia_id = m.id AND mc.carrera = ${String(carrera)})`);

  const uid = req.session.usuarioId ?? -1;
  if (mios) cond.push(sql`a.usuario_id = ${uid}`);
  const where = cond.length ? sql`WHERE ${cond.reduce((acc, c) => sql`${acc} AND ${c}`)}` : sql``;
  // Por defecto, los más gustados primero.
  const ordenSql = orden === 'recientes' ? sql`a.creado DESC` : sql`likes DESC, a.creado DESC`;
  const filas = await sql`
    SELECT a.id, a.tipo, a.titulo, a.descripcion, a.anio, a.periodo, a.archivo_nombre, a.mime, a.tamano, a.creado,
           m.id AS materia_id, m.nombre AS materia, m.sigla, m.semestre,
           u.nombre AS autor, (a.usuario_id = ${uid}) AS es_mio,
           (SELECT COUNT(*)::int FROM votos v WHERE v.apunte_id = a.id AND v.valor = 1) AS likes,
           EXISTS (SELECT 1 FROM votos v WHERE v.apunte_id = a.id AND v.usuario_id = ${uid} AND v.valor = 1) AS me_gusta
    FROM apuntes a
    JOIN materias m ON m.id = a.materia_id
    JOIN usuarios u ON u.id = a.usuario_id
    ${where}
    ORDER BY ${ordenSql}
    LIMIT 100`;
  res.json(filas);
});

// Paso 1 de la subida: el servidor valida y entrega una URL firmada; el navegador sube el archivo
// directo a Supabase Storage (Vercel no admite cuerpos de más de ~4,5 MB).
app.post('/api/apuntes/subida', requiereLogin, async (req, res) => {
  const mime = String(req.body?.mime ?? '');
  const tamano = Number(req.body?.tamano);
  if (!MIMES[mime]) return res.status(400).json({ error: 'Solo se aceptan PDF o imágenes (JPG, PNG, WEBP).' });
  if (!(tamano > 0)) return res.status(400).json({ error: 'Archivo vacío.' });
  if (tamano > config.maxMbArchivo * 1024 * 1024)
    return res.status(400).json({ error: `El archivo supera ${config.maxMbArchivo} MB.` });
  const ruta = nuevaRuta(mime);
  res.json({ ruta, url: await urlDeSubida(ruta), mime });
});

// Valida los campos de un apunte (alta o edición). Devuelve { error } o { datos }.
async function validarApunte(body, { archivoRequerido }) {
  const { materia_id, tipo, titulo, descripcion = '', anio, periodo, ruta } = body ?? {};
  const [materia] = await sql`SELECT id FROM materias WHERE id = ${entero(materia_id) ?? -1}`;
  const error =
    (archivoRequerido && !ruta && 'Adjuntá un archivo.') ||
    (!materia && 'Elegí la materia.') ||
    (!TIPOS.includes(tipo) && 'Elegí el tipo de material.') ||
    (!String(titulo ?? '').trim() && 'Poné un título.') ||
    (anio && !(Number(anio) >= 1990 && Number(anio) <= new Date().getFullYear()) && 'Año inválido.') ||
    (periodo && !PERIODOS.includes(periodo) && 'Período inválido.') ||
    (ruta && !RUTA_VALIDA.test(ruta) && 'Archivo inválido.');
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

/** Borra un objeto subido solo si ningún apunte lo usa (nunca el archivo de otro apunte). */
async function borrarSiHuerfano(ruta) {
  if (!RUTA_VALIDA.test(ruta ?? '')) return;
  const [usado] = await sql`SELECT 1 FROM apuntes WHERE archivo = ${ruta}`;
  if (!usado) await borrarObjeto(ruta);
}

/** Confirma que el objeto subido existe, es válido y todavía no pertenece a otro apunte. */
async function archivoSubido(ruta, nombre) {
  const info = await infoObjeto(ruta);
  const [usado] = await sql`SELECT 1 FROM apuntes WHERE archivo = ${ruta}`;
  if (!info || usado || !MIMES[info.mime] || info.tamano > config.maxMbArchivo * 1024 * 1024) {
    if (!usado) await borrarObjeto(ruta);
    return null;
  }
  return { ruta, nombre: String(nombre ?? 'archivo').slice(0, 200), mime: info.mime, tamano: info.tamano };
}

app.post('/api/apuntes', requiereLogin, async (req, res) => {
  const { error, datos } = await validarApunte(req.body, { archivoRequerido: true });
  if (error) {
    await borrarSiHuerfano(req.body?.ruta);
    return res.status(400).json({ error });
  }
  const f = await archivoSubido(req.body.ruta, req.body.archivo_nombre);
  if (!f) return res.status(400).json({ error: 'No se encontró el archivo subido. Probá de nuevo.' });
  const [{ id }] = await sql`
    INSERT INTO apuntes (usuario_id, materia_id, tipo, titulo, descripcion, anio, periodo, archivo, archivo_nombre, mime, tamano, busqueda)
    VALUES (${req.session.usuarioId}, ${datos.materiaId}, ${datos.tipo}, ${datos.titulo}, ${datos.descripcion}, ${datos.anio},
            ${datos.periodo}, ${f.ruta}, ${f.nombre}, ${f.mime}, ${f.tamano}, ${await textoBusqueda(datos)})
    RETURNING id`;
  res.status(201).json({ id });
});

// Datos de un apunte propio, para el formulario de edición.
app.get('/api/apuntes/:id', requiereLogin, async (req, res) => {
  const [a] = await sql`
    SELECT id, materia_id, tipo, titulo, descripcion, anio, periodo, archivo_nombre, tamano
    FROM apuntes WHERE id = ${entero(req.params.id) ?? -1} AND usuario_id = ${req.session.usuarioId}`;
  if (!a) return res.status(404).json({ error: 'No existe ese apunte o no es tuyo.' });
  res.json(a);
});

// Editar un apunte propio. La ruta del archivo es opcional: si viene una nueva, reemplaza a la anterior.
app.put('/api/apuntes/:id', requiereLogin, async (req, res) => {
  const id = entero(req.params.id) ?? -1;
  const [actual] = await sql`SELECT archivo FROM apuntes WHERE id = ${id} AND usuario_id = ${req.session.usuarioId}`;
  const ruta = RUTA_VALIDA.test(req.body?.ruta ?? '') ? req.body.ruta : null;
  if (!actual) {
    await borrarSiHuerfano(ruta);
    return res.status(404).json({ error: 'No existe ese apunte o no es tuyo.' });
  }
  const { error, datos } = await validarApunte(req.body, { archivoRequerido: false });
  if (error) {
    await borrarSiHuerfano(ruta);
    return res.status(400).json({ error });
  }
  const f = ruta ? await archivoSubido(ruta, req.body.archivo_nombre) : null;
  if (ruta && !f) return res.status(400).json({ error: 'No se encontró el archivo subido. Probá de nuevo.' });
  const busqueda = await textoBusqueda(datos);
  await sql.begin(async (tx) => {
    await tx`UPDATE apuntes SET materia_id = ${datos.materiaId}, tipo = ${datos.tipo}, titulo = ${datos.titulo},
             descripcion = ${datos.descripcion}, anio = ${datos.anio}, periodo = ${datos.periodo}, busqueda = ${busqueda}
             WHERE id = ${id}`;
    if (f)
      await tx`UPDATE apuntes SET archivo = ${f.ruta}, archivo_nombre = ${f.nombre}, mime = ${f.mime}, tamano = ${f.tamano}
               WHERE id = ${id}`;
  });
  if (f) await borrarObjeto(actual.archivo);
  res.json({ id });
});

app.delete('/api/apuntes/:id', requiereLogin, async (req, res) => {
  const [a] = await sql`
    DELETE FROM apuntes WHERE id = ${entero(req.params.id) ?? -1} AND usuario_id = ${req.session.usuarioId}
    RETURNING archivo`; // los votos se borran en cascada
  if (!a) return res.status(404).json({ error: 'No existe ese apunte o no es tuyo.' });
  await borrarObjeto(a.archivo);
  res.json({ ok: true });
});

app.get('/api/apuntes/:id/archivo', async (req, res) => {
  const [a] = await sql`SELECT archivo, archivo_nombre FROM apuntes WHERE id = ${entero(req.params.id) ?? -1}`;
  if (!a) return res.status(404).json({ error: 'No existe ese apunte.' });
  res.redirect(302, await urlDeDescarga(a.archivo, { nombre: a.archivo_nombre, descargar: Boolean(req.query.descargar) }));
});

// "Me gusta" (corazón). { me_gusta: true } lo marca, { me_gusta: false } lo quita.
app.post('/api/apuntes/:id/like', requiereLogin, async (req, res) => {
  const id = entero(req.params.id) ?? -1;
  const [existe] = await sql`SELECT 1 FROM apuntes WHERE id = ${id}`;
  if (!existe) return res.status(404).json({ error: 'No existe ese apunte.' });
  if (req.body?.me_gusta)
    await sql`INSERT INTO votos (apunte_id, usuario_id, valor) VALUES (${id}, ${req.session.usuarioId}, 1)
              ON CONFLICT (apunte_id, usuario_id) DO NOTHING`;
  else await sql`DELETE FROM votos WHERE apunte_id = ${id} AND usuario_id = ${req.session.usuarioId}`;
  const [{ likes }] = await sql`SELECT COUNT(*)::int AS likes FROM votos WHERE apunte_id = ${id} AND valor = 1`;
  res.json({ likes, me_gusta: Boolean(req.body?.me_gusta) });
});

// ───────────────────────── Tutorías ─────────────────────────

app.get('/api/tutores', async (req, res) => {
  const materia = entero(req.query.materia);
  if (!materia) return res.status(400).json({ error: 'Elegí una materia.' });
  const uid = req.session.usuarioId ?? -1;
  const filas = await sql`
    SELECT u.id, u.nombre, u.carrera, u.email, u.whatsapp, p.nota, p.verificado_en,
           (SELECT COUNT(*)::int FROM apuntes a WHERE a.usuario_id = u.id AND a.materia_id = p.materia_id) AS apuntes_materia,
           (SELECT COUNT(*)::int FROM tutorias t WHERE t.tutor_id = u.id AND t.estado = 'activa') AS ocupados,
           (SELECT t.id FROM tutorias t WHERE t.tutor_id = u.id AND t.alumno_id = ${uid} AND t.materia_id = p.materia_id
              AND t.estado = 'activa') AS mi_tutoria
    FROM postulaciones p JOIN usuarios u ON u.id = p.usuario_id
    WHERE p.materia_id = ${materia} AND p.estado = 'verificado' AND p.disponible = 1
    ORDER BY ((SELECT COUNT(*) FROM tutorias t WHERE t.tutor_id = u.id AND t.estado = 'activa') >= ${config.cupoTutor}),
             p.nota DESC, p.verificado_en`;
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
app.post('/api/tutorias', requiereLogin, async (req, res) => {
  const alumno = req.session.usuarioId;
  const tutor = entero(req.body?.tutor_id) ?? -1;
  const materia = entero(req.body?.materia_id) ?? -1;
  if (tutor === alumno) return res.status(400).json({ error: 'No podés pedirte una tutoría a vos mismo.' });
  const [ofrece] = await sql`
    SELECT 1 FROM postulaciones WHERE usuario_id = ${tutor} AND materia_id = ${materia} AND estado = 'verificado' AND disponible = 1`;
  if (!ofrece) return res.status(404).json({ error: 'Ese tutor no está disponible para esta materia.' });
  try {
    const id = await sql.begin(async (tx) => {
      await tx`SELECT 1 FROM usuarios WHERE id = ${tutor} FOR UPDATE`; // serializa a quienes piden cupo al mismo tutor
      const [ya] = await tx`
        SELECT id FROM tutorias WHERE tutor_id = ${tutor} AND alumno_id = ${alumno} AND materia_id = ${materia} AND estado = 'activa'`;
      if (ya) return ya.id;
      const [{ n }] = await tx`SELECT COUNT(*)::int AS n FROM tutorias WHERE tutor_id = ${tutor} AND estado = 'activa'`;
      if (n >= config.cupoTutor) throw Object.assign(new Error('Este tutor ya no tiene cupos libres.'), { status: 409 });
      const [t] = await tx`INSERT INTO tutorias (tutor_id, alumno_id, materia_id) VALUES (${tutor}, ${alumno}, ${materia}) RETURNING id`;
      return t.id;
    });
    const [t] = await sql`SELECT nombre, email, whatsapp FROM usuarios WHERE id = ${tutor}`;
    const [{ n }] = await sql`SELECT COUNT(*)::int AS n FROM tutorias WHERE tutor_id = ${tutor} AND estado = 'activa'`;
    res.status(201).json({ id, tutor: t, cupos_libres: Math.max(0, config.cupoTutor - n) });
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    throw e;
  }
});

// Mis tutorías: como alumno (con el contacto del tutor) y como tutor (con el contacto de mis alumnos).
app.get('/api/tutorias', requiereLogin, async (req, res) => {
  const uid = req.session.usuarioId;
  const comoAlumno = await sql`
    SELECT t.id, t.creado, m.id AS materia_id, m.nombre AS materia, u.id AS tutor_id, u.nombre AS tutor, u.email, u.whatsapp
    FROM tutorias t JOIN usuarios u ON u.id = t.tutor_id JOIN materias m ON m.id = t.materia_id
    WHERE t.alumno_id = ${uid} AND t.estado = 'activa' ORDER BY t.creado DESC`;
  const comoTutor = await sql`
    SELECT t.id, t.creado, m.nombre AS materia, u.nombre AS alumno, u.carrera, u.email, u.whatsapp
    FROM tutorias t JOIN usuarios u ON u.id = t.alumno_id JOIN materias m ON m.id = t.materia_id
    WHERE t.tutor_id = ${uid} AND t.estado = 'activa' ORDER BY t.creado`;
  res.json({ cupo_max: config.cupoTutor, como_alumno: comoAlumno, como_tutor: comoTutor });
});

// Liberar un cupo: el alumno cancela o el tutor da por terminada la tutoría.
app.patch('/api/tutorias/:id', requiereLogin, async (req, res) => {
  const uid = req.session.usuarioId;
  const id = entero(req.params.id) ?? -1;
  const [t] = await sql`SELECT tutor_id, alumno_id FROM tutorias WHERE id = ${id} AND estado = 'activa'`;
  if (!t || (t.tutor_id !== uid && t.alumno_id !== uid)) return res.status(404).json({ error: 'No existe esa tutoría.' });
  const estado = t.tutor_id === uid ? 'finalizada' : 'cancelada';
  await sql`UPDATE tutorias SET estado = ${estado}, cerrado = now() WHERE id = ${id}`;
  res.json({ ok: true, estado });
});

app.get('/api/postulaciones', requiereLogin, async (req, res) => {
  res.json(
    await sql`
      SELECT p.id, p.materia_id, m.nombre AS materia, m.semestre, p.estado, p.nota, p.detalle, p.disponible, p.creado, p.verificado_en
      FROM postulaciones p JOIN materias m ON m.id = p.materia_id
      WHERE p.usuario_id = ${req.session.usuarioId} ORDER BY m.semestre, m.nombre`,
  );
});

// Paso 1: inscripción voluntaria (elige materias y, si quiere, deja su WhatsApp)
app.post('/api/postulaciones', requiereLogin, async (req, res) => {
  const ids = [...new Set((req.body?.materias ?? []).map(Number))].filter(Number.isInteger).filter(Boolean);
  if (!ids.length) return res.status(400).json({ error: 'Elegí al menos una materia.' });
  let whatsapp;
  try {
    whatsapp = limpiarWhatsapp(req.body?.whatsapp);
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
  const uid = req.session.usuarioId;
  await sql.begin(async (tx) => {
    if (req.body && 'whatsapp' in req.body) await tx`UPDATE usuarios SET whatsapp = ${whatsapp} WHERE id = ${uid}`;
    await tx`
      INSERT INTO postulaciones (usuario_id, materia_id)
      SELECT ${uid}, m.id FROM materias m WHERE m.id IN ${tx(ids)}
      ON CONFLICT (usuario_id, materia_id) DO UPDATE SET estado = 'pendiente', detalle = NULL
      WHERE postulaciones.estado = 'rechazado'`;
  });
  res.status(201).json({ ok: true });
});

// Paso 2: verificación contra insweb (las credenciales se usan una vez y se descartan)
// Límite de intentos: evita que la app se use para adivinar contraseñas de insweb.
// Los primeros 5 intentos son libres. Después, cada intento exige una espera que va creciendo:
//   tras el 5.º intento: 2 min · tras el 6.º: 5 min · tras el 7.º (y siguientes): 10 min.
// El contador se borra si la verificación sale bien, o tras 30 minutos sin intentar.
// Vive en la tabla intentos_verificacion porque en serverless no hay memoria compartida.
const INTENTOS_LIBRES = 5;
const ESPERAS_S = [2, 5, 10].map((m) => m * 60); // para los intentos 5, 6 y 7+
const OLVIDAR_S = 30 * 60;
const MAX_VERIFICACION_S = 180; // si una verificación murió a medias, el bloqueo "en curso" caduca

/** Reserva un intento. Devuelve { ok: true } o { enCurso: true } o { esperaMs }. */
function intentar(uid) {
  return sql.begin(async (tx) => {
    await tx`INSERT INTO intentos_verificacion (usuario_id) VALUES (${uid}) ON CONFLICT DO NOTHING`;
    const [e] = await tx`
      SELECT n, (EXTRACT(EPOCH FROM (now() - ultimo)))::float8 AS desde, (EXTRACT(EPOCH FROM (hasta - now())))::float8 AS falta,
             COALESCE(en_curso > now(), false) AS en_curso
      FROM intentos_verificacion WHERE usuario_id = ${uid} FOR UPDATE`;
    if (e.en_curso) return { enCurso: true };
    const olvidado = e.desde > OLVIDAR_S;
    if (!olvidado && e.falta > 0) return { esperaMs: e.falta * 1000 };
    const n = (olvidado ? 0 : e.n) + 1;
    const espera = n >= INTENTOS_LIBRES ? ESPERAS_S[Math.min(n - INTENTOS_LIBRES, ESPERAS_S.length - 1)] : 0;
    await tx`
      UPDATE intentos_verificacion
      SET n = ${n}, ultimo = now(), hasta = now() + make_interval(secs => ${espera}::float8),
          en_curso = now() + make_interval(secs => ${MAX_VERIFICACION_S}::float8)
      WHERE usuario_id = ${uid}`;
    return { ok: true };
  });
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

  const pendientes = await sql`
    SELECT p.id, m.id AS materia_id, m.nombre, m.alias FROM postulaciones p JOIN materias m ON m.id = p.materia_id
    WHERE p.usuario_id = ${uid} AND p.estado = 'pendiente'`;
  if (!pendientes.length) return res.status(400).json({ error: 'No tenés postulaciones pendientes de verificar.' });

  const insId = idInsweb(usuario);
  const [otro] = await sql`SELECT id FROM usuarios WHERE insweb_id = ${insId} AND id <> ${uid}`;
  if (otro) return res.status(409).json({ error: 'Esa cuenta de insweb ya se usó para verificar otro usuario.' });

  const turno = await intentar(uid);
  if (turno.enCurso) return res.status(429).json({ error: 'Ya hay una verificación en curso.' });
  if (turno.esperaMs) {
    res.setHeader('Retry-After', Math.ceil(turno.esperaMs / 1000));
    return res.status(429).json({ error: `Demasiados intentos. Probá de nuevo en ${textoEspera(turno.esperaMs)}.` });
  }
  try {
    const notas = await obtenerNotasFinales({ usuario, password });
    await sql`DELETE FROM intentos_verificacion WHERE usuario_id = ${uid}`; // credenciales correctas: se reinicia el contador
    const resultados = await sql.begin(async (tx) => {
      await tx`UPDATE usuarios SET insweb_id = ${insId} WHERE id = ${uid}`;
      const salida = [];
      for (const p of pendientes) {
        const r = evaluarMateria(notas, p);
        await tx`UPDATE postulaciones SET estado = ${r.cumple ? 'verificado' : 'rechazado'}, nota = ${r.cumple ? r.nota : null},
                 detalle = ${r.detalle}, verificado_en = now() WHERE id = ${p.id}`;
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
    if (e.code === '23505') return res.status(409).json({ error: 'Esa cuenta de insweb ya se usó para verificar otro usuario.' });
    console.error('Error verificando insweb:', e.message); // nunca loguear credenciales
    res.status(500).json({ error: 'Error inesperado al verificar.' });
  } finally {
    await sql`UPDATE intentos_verificacion SET en_curso = NULL WHERE usuario_id = ${uid}`.catch(() => {});
  }
});

app.patch('/api/postulaciones/:id', requiereLogin, async (req, res) => {
  const disponible = req.body?.disponible ? 1 : 0;
  const r = await sql`UPDATE postulaciones SET disponible = ${disponible} WHERE id = ${entero(req.params.id) ?? -1} AND usuario_id = ${req.session.usuarioId}`;
  if (!r.count) return res.status(404).json({ error: 'No existe esa postulación.' });
  res.json({ ok: true, disponible });
});

app.delete('/api/postulaciones/:id', requiereLogin, async (req, res) => {
  await sql`DELETE FROM postulaciones WHERE id = ${entero(req.params.id) ?? -1} AND usuario_id = ${req.session.usuarioId}`;
  res.json({ ok: true });
});

// ───────────────────────── Errores ─────────────────────────

app.use('/api', (_req, res) => res.status(404).json({ error: 'Ruta no encontrada.' }));
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Error interno del servidor.' });
});

export default app;
