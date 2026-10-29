// Datos de ejemplo para que la demo arranque con contenido.
// Se cargan solo si la base está vacía. Contraseña de todas las cuentas: demo1234
import crypto from 'node:crypto';
import { db, transaccion } from './db.js';
import { subir } from './almacen.js';
import { hashPassword } from './auth.js';
import { textoBusqueda } from './busqueda.js';

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

/** Carga los datos de demo si la base no tiene usuarios. Los PDF de ejemplo se suben a Supabase Storage. */
export async function cargarSemillaSiVacia() {
  const { n } = await db.get('SELECT COUNT(*) AS n FROM usuarios');
  if (n > 0) return false;

  const idMateria = async (tx, nombre) => (await tx.get('SELECT id FROM materias WHERE nombre = ?', nombre)).id;
  const ids = {};

  await transaccion(async (tx) => {
    for (const u of USUARIOS) {
      ids[u.email.split('@')[0]] = (
        await tx.get(
          'INSERT INTO usuarios (nombre, email, pass_hash, carrera, whatsapp) VALUES (?, ?, ?, ?, ?) RETURNING id',
          u.nombre, u.email, hashPassword('demo1234'), u.carrera, u.whatsapp,
        )
      ).id;
    }

    const apunteIds = [];
    for (const [i, [autor, materia, tipo, titulo, desc, anio, periodo]] of APUNTES.entries()) {
      const pdf = pdfSimple([titulo, materia, `${tipo}${periodo ? ' - ' + periodo : ''} ${anio ?? ''}`, '', 'Archivo de ejemplo (demo).']);
      const archivo = `${crypto.randomUUID()}.pdf`;
      await subir(archivo, pdf, 'application/pdf');
      const mId = await idMateria(tx, materia);
      const busqueda = await textoBusqueda({ titulo, descripcion: desc, materiaId: mId, tipo, periodo, anio });
      apunteIds.push(
        (
          await tx.get(
            `INSERT INTO apuntes
              (usuario_id, materia_id, tipo, titulo, descripcion, anio, periodo, archivo, archivo_nombre, mime, tamano, busqueda, creado)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'application/pdf', ?, ?, now() - (? * interval '1 hour'))
             RETURNING id`,
            ids[autor], mId, tipo, titulo, desc, anio, periodo, archivo,
            `${titulo.replace(/[^\p{L}\p{N} ]+/gu, '').trim().replace(/\s+/g, '_')}.pdf`, pdf.length,
            busqueda,
            (APUNTES.length - i) * 7,
          )
        ).id,
      );
    }

    // algunos "me gusta" para que el orden por popularidad se note
    for (const [i, u] of [[0, 'bruno.gimenez'], [0, 'diego.ramirez'], [0, 'lucia.fernandez'], [0, 'matias.duarte'], [1, 'bruno.gimenez'],
      [1, 'sofia.acosta'], [2, 'diego.ramirez'], [7, 'carla.ortiz'], [7, 'tomas.villalba'], [5, 'lucia.fernandez']])
      await tx.run('INSERT INTO votos (apunte_id, usuario_id, valor) VALUES (?, ?, 1)', apunteIds[i], ids[u]);

    for (const [u, materia, nota] of TUTORES)
      await tx.run(
        `INSERT INTO postulaciones (usuario_id, materia_id, estado, nota, detalle, verificado_en)
         VALUES (?, ?, 'verificado', ?, ?, now())`,
        ids[u], await idMateria(tx, materia), nota, `Nota ${nota} (datos de demo).`,
      );

    // Tutorías en curso: Carla tiene 2 de 5 cupos ocupados; Diego está lleno (5 de 5).
    const tutoria = async (tutor, alumno, materia) =>
      tx.run('INSERT INTO tutorias (tutor_id, alumno_id, materia_id) VALUES (?, ?, ?)', ids[tutor], ids[alumno], await idMateria(tx, materia));
    for (const al of ['bruno.gimenez', 'lucia.fernandez']) await tutoria('carla.ortiz', al, 'Cálculo 1');
    for (const al of ['bruno.gimenez', 'lucia.fernandez', 'matias.duarte']) await tutoria('diego.ramirez', al, 'Cálculo 1');
    for (const al of ['sofia.acosta', 'tomas.villalba']) await tutoria('diego.ramirez', al, 'Estática');
  });
  return true;
}
