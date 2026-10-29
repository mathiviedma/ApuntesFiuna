// Datos de ejemplo para que la demo arranque con contenido.
// Se cargan solo si la base está vacía. Contraseña de todas las cuentas: demo1234
import crypto from 'node:crypto';
import { sql } from './db.js';
import { hashPassword } from './auth.js';
import { textoBusqueda } from './busqueda.js';
import { subirBuffer } from './storage.js';

const USUARIOS = [
  { nombre: 'Ana Benítez', email: 'ana.benitez@fiuna.edu.py', carrera: 'civil', whatsapp: null },
  { nombre: 'Bruno Giménez', email: 'bruno.gimenez@fiuna.edu.py', carrera: 'electromecanica', whatsapp: null },
  { nombre: 'Carla Ortiz', email: 'carla.ortiz@fiuna.edu.py', carrera: 'electromecanica', whatsapp: '595981123456' },
  { nombre: 'Diego Ramírez', email: 'diego.ramirez@fiuna.edu.py', carrera: 'civil', whatsapp: '595971654321' },
  { nombre: 'Lucía Fernández', email: 'lucia.fernandez@fiuna.edu.py', carrera: 'civil', whatsapp: null },
  { nombre: 'Matías Duarte', email: 'matias.duarte@fiuna.edu.py', carrera: 'electromecanica', whatsapp: null },
  { nombre: 'Sofía Acosta', email: 'sofia.acosta@fiuna.edu.py', carrera: 'civil', whatsapp: null },
  { nombre: 'Tomás Villalba', email: 'tomas.villalba@fiuna.edu.py', carrera: 'electromecanica', whatsapp: null },
];

// [autor, materia, tipo, título, descripción, año, periodo]
const APUNTES = [
  ['carla.ortiz', 'Cálculo 1', 'examen', 'Final de Cálculo 1 — diciembre', 'Enunciado completo con los 5 ejercicios. Límites, derivadas y una integral por partes.', 2025, 'final'],
  ['carla.ortiz', 'Cálculo 1', 'resumen', 'Resumen de límites y continuidad', 'Teoremas principales, límites notables y ejemplos resueltos paso a paso.', 2025, null],
  ['ana.benitez', 'Cálculo 1', 'examen', '1er parcial de Cálculo 1 resuelto', 'Con resolución completa. Incluye el ejercicio de asíntotas que entró.', 2024, '1er parcial'],
  ['diego.ramirez', 'Cálculo 2', 'practica', 'Práctica de integrales dobles', 'Ejercicios de la guía 3 con cambio a coordenadas polares.', 2025, null],
  ['bruno.gimenez', 'Álgebra Lineal', 'apunte', 'Apuntes de clase: espacios vectoriales', 'Clases 1 a 6, pasadas en limpio. Bases, dimensión, transformaciones lineales.', 2025, null],
  ['diego.ramirez', 'Estática', 'examen', '2do parcial de Estática', 'Armaduras por el método de nodos y secciones, más un ejercicio de rozamiento.', 2024, '2do parcial'],
  ['ana.benitez', 'Mecánica y Calor', 'resumen', 'Formulario de Mecánica y Calor', 'Todas las fórmulas de cinemática, dinámica, trabajo-energía y calorimetría en dos hojas.', 2025, null],
  ['bruno.gimenez', 'Ecuaciones Diferenciales', 'examen', 'Final de Ecuaciones Diferenciales — julio', 'Transformada de Laplace, sistemas lineales y una EDO no homogénea.', 2025, 'final'],
  ['carla.ortiz', 'Ciencia y Tecnología de los Materiales', 'apunte', 'Diagramas de fase hierro-carbono', 'Apunte con el diagrama Fe-C comentado y regla de la palanca.', 2024, null],
  ['diego.ramirez', 'Introducción a la Hidráulica', 'resumen', 'Resumen de hidrostática', 'Presión, empuje y fuerzas sobre superficies planas y curvas.', 2025, null],
  ['ana.benitez', 'Geometría Descriptiva', 'practica', 'Láminas resueltas de Descriptiva', 'Intersección de planos y verdadera magnitud.', 2024, null],
  ['bruno.gimenez', 'Métodos Numéricos', 'examen', '1er parcial de Métodos Numéricos', 'Bisección, Newton-Raphson y error de truncamiento.', 2025, '1er parcial'],
];

// Tutores ya verificados para que la búsqueda de tutorías tenga resultados.
const TUTORES = [
  ['carla.ortiz', 'Cálculo 1', 5],
  ['carla.ortiz', 'Ciencia y Tecnología de los Materiales', 4],
  ['diego.ramirez', 'Cálculo 1', 4],
  ['diego.ramirez', 'Estática', 5],
  ['bruno.gimenez', 'Álgebra Lineal', 5],
];

// PDF mínimo válido de una página con algunas líneas de texto (sin dependencias).
function pdfSimple(lineas) {
  const esc = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[()\\]/g, '\\$&');
  const contenido =
    'BT /F1 18 Tf 60 760 Td ' +
    lineas.map((l, i) => `${i === 0 ? '' : '0 -28 Td '}(${esc(l)}) Tj`).join(' ') +
    ' ET';
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(contenido)} >>\nstream\n${contenido}\nendstream`,
  ];
  let out = '%PDF-1.4\n';
  const offsets = [];
  objs.forEach((o, i) => {
    offsets.push(Buffer.byteLength(out));
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  out += offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

export async function cargarSemillaSiVacia() {
  const [{ n }] = await sql`SELECT COUNT(*)::int AS n FROM usuarios`;
  if (n > 0) return false;

  const mats = Object.fromEntries((await sql`SELECT id, nombre FROM materias`).map((m) => [m.nombre, m.id]));
  const ids = {};
  const hash = hashPassword('demo1234');

  // Primero los archivos (fuera de la transacción), después todas las filas juntas.
  const archivos = [];
  for (const [, materia, tipo, titulo, , anio, periodo] of APUNTES) {
    const pdf = pdfSimple([titulo, materia, `${tipo}${periodo ? ' - ' + periodo : ''} ${anio ?? ''}`, '', 'Archivo de ejemplo (demo).']);
    const ruta = `${crypto.randomUUID()}.pdf`;
    await subirBuffer(ruta, pdf, 'application/pdf');
    archivos.push({ ruta, tamano: pdf.length });
  }

  await sql.begin(async (tx) => {
    for (const u of USUARIOS) {
      const [{ id }] = await tx`INSERT INTO usuarios (nombre, email, pass_hash, carrera, whatsapp)
        VALUES (${u.nombre}, ${u.email}, ${hash}, ${u.carrera}, ${u.whatsapp}) RETURNING id`;
      ids[u.email.split('@')[0]] = id;
    }

    const apunteIds = [];
    for (const [i, [autor, materia, tipo, titulo, desc, anio, periodo]] of APUNTES.entries()) {
      const mId = mats[materia];
      const nombre = `${titulo.replace(/[^\p{L}\p{N} ]+/gu, '').trim().replace(/\s+/g, '_')}.pdf`;
      const busqueda = await textoBusqueda({ titulo, descripcion: desc, materiaId: mId, tipo, periodo, anio }, tx);
      const [{ id }] = await tx`INSERT INTO apuntes
        (usuario_id, materia_id, tipo, titulo, descripcion, anio, periodo, archivo, archivo_nombre, mime, tamano, busqueda, creado)
        VALUES (${ids[autor]}, ${mId}, ${tipo}, ${titulo}, ${desc}, ${anio}, ${periodo}, ${archivos[i].ruta}, ${nombre},
                'application/pdf', ${archivos[i].tamano}, ${busqueda}, now() - make_interval(hours => ${(APUNTES.length - i) * 7}))
        RETURNING id`;
      apunteIds.push(id);
    }

    // algunos "me gusta" para que el orden por popularidad se note
    for (const [i, u] of [[0, 'bruno.gimenez'], [0, 'diego.ramirez'], [0, 'lucia.fernandez'], [0, 'matias.duarte'], [1, 'bruno.gimenez'],
      [1, 'sofia.acosta'], [2, 'diego.ramirez'], [7, 'carla.ortiz'], [7, 'tomas.villalba'], [5, 'lucia.fernandez']])
      await tx`INSERT INTO votos (apunte_id, usuario_id, valor) VALUES (${apunteIds[i]}, ${ids[u]}, 1)`;

    for (const [u, materia, nota] of TUTORES)
      await tx`INSERT INTO postulaciones (usuario_id, materia_id, estado, nota, detalle, verificado_en)
        VALUES (${ids[u]}, ${mats[materia]}, 'verificado', ${nota}, ${`Nota ${nota} (datos de demo).`}, now())`;

    // Tutorías en curso: Carla tiene 2 de 5 cupos ocupados; Diego está lleno (5 de 5).
    const tut = [
      ...['bruno.gimenez', 'lucia.fernandez'].map((a) => ['carla.ortiz', a, 'Cálculo 1']),
      ...['bruno.gimenez', 'lucia.fernandez', 'matias.duarte'].map((a) => ['diego.ramirez', a, 'Cálculo 1']),
      ...['sofia.acosta', 'tomas.villalba'].map((a) => ['diego.ramirez', a, 'Estática']),
    ];
    for (const [t, a, m] of tut)
      await tx`INSERT INTO tutorias (tutor_id, alumno_id, materia_id) VALUES (${ids[t]}, ${ids[a]}, ${mats[m]})`;
  });
  return true;
}
